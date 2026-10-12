const {
  transactionClient,
  withTransactionOperation,
} = require('./domain-transaction');
const { resolveEffectiveStockPolicy } = require('./stock-unit-policy');
const {
  SerialNumberError,
  prepareUniqueSerialBatch,
} = require('./serial-number');

const UNIT_STATES = Object.freeze(['available', 'sold', 'quarantined', 'retired']);
const LIFECYCLE_TRANSITIONS = Object.freeze({
  received: Object.freeze([[null, 'available']]),
  sold: Object.freeze([['available', 'sold']]),
  refunded: Object.freeze([['sold', 'quarantined']]),
  voided: Object.freeze([['sold', 'quarantined']]),
  released: Object.freeze([['quarantined', 'available']]),
  retired: Object.freeze([
    ['available', 'retired'],
    ['quarantined', 'retired'],
  ]),
});

class StockUnitDomainError extends Error {
  constructor(message, code = 'STOCK_UNIT_CONFLICT', statusCode = 409) {
    super(message);
    this.name = 'StockUnitDomainError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function assertLifecycleTransition(eventType, fromState, toState) {
  const allowed = LIFECYCLE_TRANSITIONS[eventType] || [];
  if (!allowed.some(([from, to]) => from === fromState && to === toState)) {
    throw new StockUnitDomainError(
      `Invalid stock-unit transition: ${eventType} ${fromState ?? 'null'} -> ${toState}`,
      'INVALID_UNIT_TRANSITION'
    );
  }
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new StockUnitDomainError(`${field} must be a positive integer`, 'INVALID_ARGUMENT', 400);
  }
  return parsed;
}

function nonnegativeInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new StockUnitDomainError(`${field} must be a nonnegative integer`, 'INVALID_ARGUMENT', 400);
  }
  return parsed;
}

function optionalPositiveInteger(value, field) {
  return value === null || value === undefined ? null : positiveInteger(value, field);
}

function stockUnitId(value) {
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) {
    throw new StockUnitDomainError('stock unit id must be a positive integer', 'INVALID_ARGUMENT', 400);
  }
  return text;
}

function targetSpec(input) {
  if (!input || typeof input !== 'object') {
    throw new StockUnitDomainError('Inventory target is required', 'INVALID_ARGUMENT', 400);
  }
  return Object.freeze({
    productId: positiveInteger(input.productId, 'product id'),
    variantId: optionalPositiveInteger(input.variantId, 'variant id'),
  });
}

function targetKey(target) {
  return `${target.productId}:${target.variantId ?? 0}`;
}

function compareTargets(left, right) {
  return left.productId - right.productId
    || (left.variantId ?? 0) - (right.variantId ?? 0);
}

function uniqueTargets(inputs) {
  const targets = inputs.map(targetSpec).sort(compareTargets);
  const seen = new Set();
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) {
      throw new StockUnitDomainError(`Duplicate inventory target ${key}`, 'DUPLICATE_TARGET', 400);
    }
    seen.add(key);
  }
  return targets;
}

async function lockInventoryTargets(
  client,
  inputTargets,
  { requireActive = true, enforceVariantTarget = true } = {}
) {
  const targets = uniqueTargets(inputTargets);
  if (targets.length === 0) {
    throw new StockUnitDomainError('At least one inventory target is required', 'INVALID_ARGUMENT', 400);
  }
  const productIds = [...new Set(targets.map((target) => target.productId))].sort((a, b) => a - b);
  const productResult = await client.query(
    `
      SELECT
        id, sku, name, stock_quantity, is_active,
        serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months
      FROM products
      WHERE id = ANY($1::integer[])
      ORDER BY id
      FOR UPDATE
    `,
    [productIds]
  );
  const products = new Map(productResult.rows.map((row) => [Number(row.id), row]));
  for (const productId of productIds) {
    const product = products.get(productId);
    if (!product || (requireActive && product.is_active !== true)) {
      throw new StockUnitDomainError(
        `${requireActive ? 'Active ' : ''}product ${productId} was not found`,
        'INVENTORY_TARGET_NOT_FOUND',
        404
      );
    }
  }

  const variantIds = targets
    .filter((target) => target.variantId !== null)
    .map((target) => target.variantId)
    .sort((a, b) => a - b);
  const variants = new Map();
  if (variantIds.length > 0) {
    const variantResult = await client.query(
      `
        SELECT
          id, product_id, sku, name, stock_quantity, is_active,
          serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months
        FROM product_variants
        WHERE id = ANY($1::integer[])
        ORDER BY product_id, id
        FOR UPDATE
      `,
      [variantIds]
    );
    for (const row of variantResult.rows) variants.set(Number(row.id), row);
  }

  const parentOnlyProductIds = enforceVariantTarget
    ? targets.filter((target) => target.variantId === null).map((target) => target.productId)
    : [];
  const activeVariantCounts = new Map();
  if (parentOnlyProductIds.length > 0) {
    const counts = await client.query(
      `
        SELECT product_id, COUNT(*)::integer AS count
        FROM product_variants
        WHERE product_id = ANY($1::integer[]) AND is_active = TRUE
        GROUP BY product_id
        ORDER BY product_id
      `,
      [parentOnlyProductIds]
    );
    for (const row of counts.rows) {
      activeVariantCounts.set(Number(row.product_id), Number(row.count));
    }
  }

  return targets.map((target) => {
    const product = products.get(target.productId);
    const variant = target.variantId === null ? null : variants.get(target.variantId);
    if (target.variantId !== null) {
      if (
        !variant
        || (requireActive && variant.is_active !== true)
        || Number(variant.product_id) !== target.productId
      ) {
        throw new StockUnitDomainError(
          `Active variant ${target.variantId} does not belong to product ${target.productId}`,
          'INVENTORY_TARGET_NOT_FOUND',
          404
        );
      }
    } else if ((activeVariantCounts.get(target.productId) || 0) > 0) {
      throw new StockUnitDomainError(
        `Product ${target.productId} requires a variant inventory target`,
        'VARIANT_TARGET_REQUIRED'
      );
    }
    return Object.freeze({
      ...target,
      key: targetKey(target),
      product,
      variant,
      policy: resolveEffectiveStockPolicy(product, variant),
      stockQuantity: Number(variant ? variant.stock_quantity : product.stock_quantity),
      table: variant ? 'product_variants' : 'products',
      rowId: Number(variant ? variant.id : product.id),
    });
  });
}

function requireSerialTracking(target) {
  if (!target.policy.serialTrackingEnabled) {
    throw new StockUnitDomainError(
      `Serial tracking is disabled for inventory target ${target.key}`,
      'SERIAL_TRACKING_DISABLED'
    );
  }
}

async function stateCounts(client, target) {
  const result = await client.query(
    `
      SELECT state, COUNT(*)::integer AS count
      FROM stock_units
      WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2::integer
      GROUP BY state
      ORDER BY state
    `,
    [target.productId, target.variantId]
  );
  const counts = Object.fromEntries(UNIT_STATES.map((state) => [state, 0]));
  for (const row of result.rows) counts[row.state] = Number(row.count);
  return counts;
}

async function reconciliationForLockedTarget(client, target) {
  const counts = await stateCounts(client, target);
  const quantityResult = await client.query(
    `SELECT stock_quantity::integer AS stock_quantity FROM ${target.table} WHERE id = $1`,
    [target.rowId]
  );
  if (quantityResult.rowCount !== 1) {
    throw new StockUnitDomainError('Inventory target disappeared during reconciliation');
  }
  const aggregateQuantity = Number(quantityResult.rows[0].stock_quantity);
  return Object.freeze({
    productId: target.productId,
    variantId: target.variantId,
    aggregateQuantity,
    availableUnitCount: counts.available,
    difference: aggregateQuantity - counts.available,
    consistent: aggregateQuantity === counts.available,
    stateCounts: Object.freeze(counts),
  });
}

async function requireReconciled(client, target) {
  const reconciliation = await reconciliationForLockedTarget(client, target);
  if (!reconciliation.consistent) {
    throw new StockUnitDomainError(
      `Serialized inventory target ${target.key} is out of reconciliation`,
      'INVENTORY_RECONCILIATION_REQUIRED'
    );
  }
  return reconciliation;
}

async function updateAggregateQuantity(client, target, delta) {
  if (!Number.isSafeInteger(delta) || delta === 0) return target.stockQuantity;
  const result = await client.query(
    `
      UPDATE ${target.table}
      SET stock_quantity = stock_quantity + $1, updated_at = NOW()
      WHERE id = $2 AND stock_quantity + $1 >= 0
      RETURNING stock_quantity::integer AS stock_quantity
    `,
    [delta, target.rowId]
  );
  if (result.rowCount !== 1) {
    throw new StockUnitDomainError(
      `Inventory quantity for ${target.key} cannot be adjusted by ${delta}`,
      'INSUFFICIENT_INVENTORY'
    );
  }
  return Number(result.rows[0].stock_quantity);
}

function normalizedBatches(batches) {
  if (!Array.isArray(batches) || batches.length === 0) {
    throw new StockUnitDomainError('At least one receiving batch is required', 'INVALID_ARGUMENT', 400);
  }
  const seenTargets = new Set();
  const seenSerials = new Set();
  return batches.map((batch) => {
    const target = targetSpec(batch);
    const key = targetKey(target);
    if (seenTargets.has(key)) {
      throw new StockUnitDomainError(`Duplicate receiving target ${key}`, 'DUPLICATE_TARGET', 400);
    }
    seenTargets.add(key);
    let serials;
    try {
      serials = prepareUniqueSerialBatch(batch.serialNumbers);
    } catch (error) {
      if (error instanceof SerialNumberError) {
        throw new StockUnitDomainError(error.message, error.code, error.statusCode);
      }
      throw error;
    }
    for (const serial of serials) {
      if (seenSerials.has(serial.normalized)) {
        throw new StockUnitDomainError(
          `Duplicate normalized manufacturer serial number: ${serial.normalized}`,
          'DUPLICATE_SERIAL_NUMBER',
          400
        );
      }
      seenSerials.add(serial.normalized);
    }
    return { ...target, key, serials };
  }).sort(compareTargets);
}

async function rejectExistingSerials(client, batches) {
  const normalized = batches.flatMap((batch) => batch.serials.map((serial) => serial.normalized));
  const result = await client.query(
    `
      SELECT normalized_serial_number
      FROM stock_units
      WHERE normalized_serial_number = ANY($1::text[])
      ORDER BY normalized_serial_number
    `,
    [normalized]
  );
  if (result.rows.length > 0) {
    throw new StockUnitDomainError(
      `Manufacturer serial number already exists: ${result.rows[0].normalized_serial_number}`,
      'DUPLICATE_SERIAL_NUMBER'
    );
  }
}

async function insertLifecycleEvent(client, {
  unitId, eventType, fromState, toState, saleId = null, saleItemId = null,
  actorUserId = null, reason = null, metadata = {},
}) {
  assertLifecycleTransition(eventType, fromState, toState);
  await client.query(
    `
      INSERT INTO stock_unit_events
        (stock_unit_id, event_type, from_state, to_state, sale_id, sale_item_id,
         actor_user_id, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    [
      unitId, eventType, fromState, toState, saleId, saleItemId,
      actorUserId, reason, JSON.stringify(metadata || {}),
    ]
  );
}

async function createUnits(client, target, serials, actorUserId, source) {
  const created = [];
  for (const serial of [...serials].sort((a, b) => a.normalized.localeCompare(b.normalized))) {
    let result;
    try {
      result = await client.query(
        `
          INSERT INTO stock_units
            (manufacturer_serial_number, product_id, variant_id)
          VALUES ($1, $2, $3)
          RETURNING id, internal_sku, manufacturer_serial_number,
                    normalized_serial_number, product_id, variant_id, state
        `,
        [serial.original, target.productId, target.variantId]
      );
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'stock_units_normalized_serial_number_key') {
        throw new StockUnitDomainError(
          `Manufacturer serial number already exists: ${serial.normalized}`,
          'DUPLICATE_SERIAL_NUMBER'
        );
      }
      throw error;
    }
    const unit = result.rows[0];
    if (unit.normalized_serial_number !== serial.normalized || unit.state !== 'available') {
      throw new StockUnitDomainError('Database serial normalization contract mismatch');
    }
    await insertLifecycleEvent(client, {
      unitId: unit.id,
      eventType: 'received',
      fromState: null,
      toState: 'available',
      actorUserId,
      metadata: { source },
    });
    created.push(unit);
  }
  return created;
}

async function registerReceivedUnitsOperation(transaction, { batches, actorUserId = null }) {
  const client = transactionClient(transaction);
  const prepared = normalizedBatches(batches);
  const lockedTargets = await lockInventoryTargets(client, prepared);
  const targets = new Map(lockedTargets.map((target) => [target.key, target]));
  for (const target of lockedTargets) {
    requireSerialTracking(target);
    await requireReconciled(client, target);
  }
  await rejectExistingSerials(client, prepared);

  const created = [];
  for (const batch of prepared) {
    const target = targets.get(batch.key);
    const units = await createUnits(client, target, batch.serials, actorUserId, 'received');
    await updateAggregateQuantity(client, target, units.length);
    await requireReconciled(client, target);
    created.push(...units);
  }
  return created;
}

async function adoptExistingInventoryOperation(transaction, { batches, actorUserId = null }) {
  const client = transactionClient(transaction);
  const prepared = normalizedBatches(batches);
  const lockedTargets = await lockInventoryTargets(client, prepared);
  const targets = new Map(lockedTargets.map((target) => [target.key, target]));
  for (const target of lockedTargets) {
    requireSerialTracking(target);
    const counts = await stateCounts(client, target);
    const totalUnits = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (totalUnits !== 0) {
      throw new StockUnitDomainError(
        `Inventory target ${target.key} already has serialized units`,
        'ADOPTION_ALREADY_STARTED'
      );
    }
    const batch = prepared.find((entry) => entry.key === target.key);
    if (batch.serials.length !== target.stockQuantity) {
      throw new StockUnitDomainError(
        `Adoption for ${target.key} requires exactly ${target.stockQuantity} serial numbers`,
        'ADOPTION_QUANTITY_MISMATCH'
      );
    }
  }
  await rejectExistingSerials(client, prepared);

  const created = [];
  for (const batch of prepared) {
    const target = targets.get(batch.key);
    const units = await createUnits(client, target, batch.serials, actorUserId, 'adopted');
    await requireReconciled(client, target);
    created.push(...units);
  }
  return created;
}

function normalizedUnitIds(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new StockUnitDomainError('At least one stock unit is required', 'INVALID_ARGUMENT', 400);
  }
  const ids = [...new Set(values.map(stockUnitId))];
  if (ids.length !== values.length) {
    throw new StockUnitDomainError('Stock unit ids must be unique', 'DUPLICATE_STOCK_UNIT', 400);
  }
  return ids.sort((left, right) => {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

async function lockUnitsAfterInventory(client, unitIds) {
  const preview = await client.query(
    `SELECT id, product_id, variant_id FROM stock_units WHERE id = ANY($1::bigint[])`,
    [unitIds]
  );
  if (preview.rows.length !== unitIds.length) {
    throw new StockUnitDomainError('One or more stock units were not found', 'STOCK_UNIT_NOT_FOUND', 404);
  }
  const specsByKey = new Map();
  for (const row of preview.rows) {
    const spec = targetSpec({ productId: row.product_id, variantId: row.variant_id });
    specsByKey.set(targetKey(spec), spec);
  }
  const targets = await lockInventoryTargets(client, [...specsByKey.values()], {
    requireActive: false,
    enforceVariantTarget: false,
  });
  const targetMap = new Map(targets.map((target) => [target.key, target]));
  const locked = await client.query(
    `
      SELECT id, internal_sku, manufacturer_serial_number, normalized_serial_number,
             product_id, variant_id, state
      FROM stock_units
      WHERE id = ANY($1::bigint[])
      ORDER BY product_id, COALESCE(variant_id, 0), id
      FOR UPDATE
    `,
    [unitIds]
  );
  if (locked.rows.length !== unitIds.length) {
    throw new StockUnitDomainError('Stock units changed while acquiring locks');
  }
  for (const unit of locked.rows) {
    const key = targetKey(targetSpec({ productId: unit.product_id, variantId: unit.variant_id }));
    if (!targetMap.has(key)) throw new StockUnitDomainError('Stock unit inventory target changed');
  }
  return { units: locked.rows, targets, targetMap };
}

function groupUnitsByTarget(units) {
  const grouped = new Map();
  for (const unit of units) {
    const key = targetKey(targetSpec({ productId: unit.product_id, variantId: unit.variant_id }));
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(unit);
  }
  return grouped;
}

async function transitionUnitState(client, unit, expectedState, nextState) {
  const result = await client.query(
    `
      UPDATE stock_units
      SET state = $1, updated_at = NOW()
      WHERE id = $2 AND state = $3
      RETURNING id, state
    `,
    [nextState, unit.id, expectedState]
  );
  if (result.rowCount !== 1) {
    throw new StockUnitDomainError(
      `Stock unit ${unit.id} is not ${expectedState}`,
      'INVALID_UNIT_TRANSITION'
    );
  }
}

async function sellStockUnitsOperation(transaction, {
  unitIds, saleId, saleItemId, actorUserId = null,
}) {
  const client = transactionClient(transaction);
  const ids = normalizedUnitIds(unitIds);
  const normalizedSaleId = positiveInteger(saleId, 'sale id');
  const normalizedSaleItemId = positiveInteger(saleItemId, 'sale item id');
  const locked = await lockUnitsAfterInventory(client, ids);
  if (locked.targets.length !== 1) {
    throw new StockUnitDomainError('A sale item can contain units from only one inventory target');
  }
  const target = locked.targets[0];
  if (
    target.product.is_active !== true
    || (target.variant && target.variant.is_active !== true)
  ) {
    throw new StockUnitDomainError(
      `Inventory target ${target.key} is inactive`,
      'INVENTORY_TARGET_NOT_FOUND',
      404
    );
  }
  requireSerialTracking(target);
  await requireReconciled(client, target);
  for (const unit of locked.units) {
    if (unit.state !== 'available') {
      throw new StockUnitDomainError(`Stock unit ${unit.id} is not available`, 'INVALID_UNIT_TRANSITION');
    }
  }

  const itemResult = await client.query(
    `
      SELECT
        si.id, si.sale_id, si.product_id, si.variant_id, si.quantity,
        (
          SELECT COUNT(*)::integer
          FROM sale_item_stock_units sis
          WHERE sis.sale_item_id = si.id AND sis.released_at IS NULL
        ) AS active_unit_count
      FROM sale_items si
      WHERE si.id = $1 AND si.sale_id = $2
      FOR UPDATE OF si
    `,
    [normalizedSaleItemId, normalizedSaleId]
  );
  const item = itemResult.rows[0];
  if (
    !item
    || Number(item.product_id) !== target.productId
    || (item.variant_id === null ? null : Number(item.variant_id)) !== target.variantId
    || Number(item.quantity) < Number(item.active_unit_count) + locked.units.length
  ) {
    throw new StockUnitDomainError(
      'Sale item does not match the selected stock units or has no unassigned quantity',
      'SALE_ITEM_UNIT_MISMATCH'
    );
  }

  for (const unit of locked.units) {
    await transitionUnitState(client, unit, 'available', 'sold');
    await client.query(
      `
        INSERT INTO sale_item_stock_units
          (sale_item_id, stock_unit_id, internal_sku_snapshot,
           manufacturer_serial_number_snapshot)
        VALUES ($1, $2, $3, $4)
      `,
      [normalizedSaleItemId, unit.id, unit.internal_sku, unit.manufacturer_serial_number]
    );
    await insertLifecycleEvent(client, {
      unitId: unit.id,
      eventType: 'sold',
      fromState: 'available',
      toState: 'sold',
      saleId: normalizedSaleId,
      saleItemId: normalizedSaleItemId,
      actorUserId,
    });
  }
  await updateAggregateQuantity(client, target, -locked.units.length);
  await requireReconciled(client, target);
  return locked.units.map((unit) => ({ ...unit, state: 'sold' }));
}

async function quarantineSoldUnitsOperation(transaction, {
  unitIds, action, saleId = null, actorUserId = null, reason = null,
}) {
  const client = transactionClient(transaction);
  if (!['refunded', 'voided'].includes(action)) {
    throw new StockUnitDomainError('Quarantine action must be refunded or voided', 'INVALID_ARGUMENT', 400);
  }
  const ids = normalizedUnitIds(unitIds);
  const locked = await lockUnitsAfterInventory(client, ids);
  for (const target of locked.targets) {
    await requireReconciled(client, target);
  }
  for (const unit of locked.units) {
    if (unit.state !== 'sold') {
      throw new StockUnitDomainError(`Stock unit ${unit.id} is not sold`, 'INVALID_UNIT_TRANSITION');
    }
  }

  const assignments = await client.query(
    `
      SELECT sis.id, sis.stock_unit_id, sis.sale_item_id, si.sale_id
      FROM sale_item_stock_units sis
      JOIN sale_items si ON si.id = sis.sale_item_id
      WHERE sis.stock_unit_id = ANY($1::bigint[]) AND sis.released_at IS NULL
      ORDER BY sis.stock_unit_id
      FOR UPDATE OF sis
    `,
    [ids]
  );
  if (assignments.rows.length !== ids.length) {
    throw new StockUnitDomainError('Every sold unit must have one active sale assignment');
  }
  const requestedSaleId = optionalPositiveInteger(saleId, 'sale id');
  if (
    requestedSaleId !== null
    && assignments.rows.some((assignment) => Number(assignment.sale_id) !== requestedSaleId)
  ) {
    throw new StockUnitDomainError('Stock unit assignment does not belong to the requested sale');
  }
  const assignmentsByUnit = new Map(
    assignments.rows.map((assignment) => [String(assignment.stock_unit_id), assignment])
  );

  for (const unit of locked.units) {
    const assignment = assignmentsByUnit.get(String(unit.id));
    await transitionUnitState(client, unit, 'sold', 'quarantined');
    await client.query(
      `
        UPDATE sale_item_stock_units
        SET released_at = NOW(), release_reason = $1
        WHERE id = $2 AND released_at IS NULL
      `,
      [action, assignment.id]
    );
    await insertLifecycleEvent(client, {
      unitId: unit.id,
      eventType: action,
      fromState: 'sold',
      toState: 'quarantined',
      saleId: Number(assignment.sale_id),
      saleItemId: Number(assignment.sale_item_id),
      actorUserId,
      reason,
    });
  }
  for (const target of locked.targets) await requireReconciled(client, target);
  return locked.units.map((unit) => ({ ...unit, state: 'quarantined' }));
}

async function releaseQuarantinedUnitsOperation(transaction, {
  unitIds, actorUserId = null, reason = null,
}) {
  const client = transactionClient(transaction);
  const ids = normalizedUnitIds(unitIds);
  const locked = await lockUnitsAfterInventory(client, ids);
  const grouped = groupUnitsByTarget(locked.units);
  for (const target of locked.targets) {
    await requireReconciled(client, target);
  }
  for (const unit of locked.units) {
    if (unit.state !== 'quarantined') {
      throw new StockUnitDomainError(`Stock unit ${unit.id} is not quarantined`, 'INVALID_UNIT_TRANSITION');
    }
    await transitionUnitState(client, unit, 'quarantined', 'available');
    await insertLifecycleEvent(client, {
      unitId: unit.id,
      eventType: 'released',
      fromState: 'quarantined',
      toState: 'available',
      actorUserId,
      reason,
    });
  }
  for (const target of locked.targets) {
    await updateAggregateQuantity(client, target, grouped.get(target.key).length);
    await requireReconciled(client, target);
  }
  return locked.units.map((unit) => ({ ...unit, state: 'available' }));
}

async function retireStockUnitsOperation(transaction, {
  unitIds, actorUserId = null, reason = null,
}) {
  const client = transactionClient(transaction);
  const ids = normalizedUnitIds(unitIds);
  const locked = await lockUnitsAfterInventory(client, ids);
  const availableByTarget = new Map();
  for (const target of locked.targets) {
    await requireReconciled(client, target);
    availableByTarget.set(target.key, 0);
  }
  for (const unit of locked.units) {
    if (!['available', 'quarantined'].includes(unit.state)) {
      throw new StockUnitDomainError(
        `Stock unit ${unit.id} cannot be retired from ${unit.state}`,
        'INVALID_UNIT_TRANSITION'
      );
    }
    if (unit.state === 'available') {
      const key = targetKey(targetSpec({ productId: unit.product_id, variantId: unit.variant_id }));
      availableByTarget.set(key, availableByTarget.get(key) + 1);
    }
    await transitionUnitState(client, unit, unit.state, 'retired');
    await insertLifecycleEvent(client, {
      unitId: unit.id,
      eventType: 'retired',
      fromState: unit.state,
      toState: 'retired',
      actorUserId,
      reason,
    });
  }
  for (const target of locked.targets) {
    const availableCount = availableByTarget.get(target.key);
    if (availableCount > 0) await updateAggregateQuantity(client, target, -availableCount);
    await requireReconciled(client, target);
  }
  return locked.units.map((unit) => ({ ...unit, state: 'retired' }));
}

async function checkInventoryReconciliation(transaction, inputTarget) {
  const client = transactionClient(transaction);
  const [target] = await lockInventoryTargets(client, [inputTarget], {
    requireActive: false,
    enforceVariantTarget: false,
  });
  return reconciliationForLockedTarget(client, target);
}

async function setUntrackedInventoryQuantityOperation(transaction, inputTarget, quantity) {
  const client = transactionClient(transaction);
  const nextQuantity = nonnegativeInteger(quantity, 'stock quantity');
  const [target] = await lockInventoryTargets(client, [inputTarget]);
  if (target.policy.serialTrackingEnabled) {
    throw new StockUnitDomainError(
      'Direct aggregate quantity editing is disabled for serialized inventory',
      'DIRECT_QUANTITY_EDIT_FORBIDDEN'
    );
  }
  const liveUnits = await client.query(
    `
      SELECT COUNT(*)::integer AS count
      FROM stock_units
      WHERE product_id = $1
        AND variant_id IS NOT DISTINCT FROM $2::integer
        AND state <> 'retired'
    `,
    [target.productId, target.variantId]
  );
  if (Number(liveUnits.rows[0].count) > 0) {
    throw new StockUnitDomainError(
      'Direct aggregate quantity editing is disabled while live serialized units exist',
      'DIRECT_QUANTITY_EDIT_FORBIDDEN'
    );
  }
  const result = await client.query(
    `
      UPDATE ${target.table}
      SET stock_quantity = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING stock_quantity::integer AS stock_quantity
    `,
    [nextQuantity, target.rowId]
  );
  return Number(result.rows[0].stock_quantity);
}

function registerReceivedUnits(transaction, input) {
  return withTransactionOperation(transaction, 'receive_units', () =>
    registerReceivedUnitsOperation(transaction, input)
  );
}

function adoptExistingInventory(transaction, input) {
  return withTransactionOperation(transaction, 'adopt_units', () =>
    adoptExistingInventoryOperation(transaction, input)
  );
}

function sellStockUnits(transaction, input) {
  return withTransactionOperation(transaction, 'sell_units', () =>
    sellStockUnitsOperation(transaction, input)
  );
}

function quarantineSoldUnits(transaction, input) {
  return withTransactionOperation(transaction, 'quarantine_units', () =>
    quarantineSoldUnitsOperation(transaction, input)
  );
}

function releaseQuarantinedUnits(transaction, input) {
  return withTransactionOperation(transaction, 'release_units', () =>
    releaseQuarantinedUnitsOperation(transaction, input)
  );
}

function retireStockUnits(transaction, input) {
  return withTransactionOperation(transaction, 'retire_units', () =>
    retireStockUnitsOperation(transaction, input)
  );
}

function setUntrackedInventoryQuantity(transaction, inputTarget, quantity) {
  return withTransactionOperation(transaction, 'set_quantity', () =>
    setUntrackedInventoryQuantityOperation(transaction, inputTarget, quantity)
  );
}

module.exports = {
  LIFECYCLE_TRANSITIONS,
  StockUnitDomainError,
  UNIT_STATES,
  adoptExistingInventory,
  assertLifecycleTransition,
  checkInventoryReconciliation,
  registerReceivedUnits,
  releaseQuarantinedUnits,
  retireStockUnits,
  sellStockUnits,
  setUntrackedInventoryQuantity,
  quarantineSoldUnits,
};
