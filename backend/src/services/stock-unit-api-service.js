const { revalidateCurrentAdmin } = require('./sale-reversal');
const { normalizeManufacturerSerial, prepareManufacturerSerial } = require('./serial-number');
const {
  registerReceivedUnits,
  retireStockUnits,
} = require('./stock-unit-service');
const { transactionClient, withTransactionOperation } = require('./domain-transaction');
const {
  InventoryApiError,
  boundedInteger,
  optionalPositiveInteger,
  positiveInteger,
} = require('./inventory-api-validation');

const UNIT_STATES = Object.freeze(['available', 'sold', 'quarantined', 'retired']);

function listParameters(query = {}) {
  const page = boundedInteger(query.page, 'page', { minimum: 1, maximum: 1_000_000, defaultValue: 1 });
  const limit = boundedInteger(query.limit, 'limit', { minimum: 1, maximum: 100, defaultValue: 25 });
  const state = query.state === undefined || query.state === '' ? null : String(query.state);
  if (state !== null && !UNIT_STATES.includes(state)) {
    throw new InventoryApiError('state must be available, sold, quarantined, or retired');
  }
  const search = query.q === undefined || query.q === '' ? null : String(query.q).trim();
  if (search && search.length > 200) throw new InventoryApiError('q is too long');
  return {
    page,
    limit,
    offset: (page - 1) * limit,
    state,
    productId: optionalPositiveInteger(query.product_id, 'product_id'),
    variantId: optionalPositiveInteger(query.variant_id, 'variant_id'),
    search,
  };
}

async function listStockUnits(queryable, query) {
  const filters = listParameters(query);
  const values = [];
  const clauses = [];
  const add = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.state) clauses.push(`su.state = ${add(filters.state)}`);
  if (filters.productId) clauses.push(`su.product_id = ${add(filters.productId)}`);
  if (filters.variantId) clauses.push(`su.variant_id = ${add(filters.variantId)}`);
  if (filters.search) {
    const parameter = add(`%${filters.search}%`);
    let normalizedSearch = null;
    try {
      normalizedSearch = normalizeManufacturerSerial(filters.search);
    } catch (error) {
      if (error.code !== 'INVALID_SERIAL_NUMBER') throw error;
    }
    const normalizedClause = normalizedSearch === null
      ? ''
      : `OR su.normalized_serial_number = ${add(normalizedSearch)}`;
    clauses.push(`(
      su.unit_code ILIKE ${parameter}
      OR su.internal_sku ILIKE ${parameter}
      OR su.manufacturer_serial_number ILIKE ${parameter}
      ${normalizedClause}
      OR p.name ILIKE ${parameter}
      OR pv.name ILIKE ${parameter}
    )`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const countResult = await queryable.query(
    `
      SELECT COUNT(*)::integer AS count
      FROM stock_units su
      JOIN products p ON p.id = su.product_id
      LEFT JOIN product_variants pv ON pv.id = su.variant_id
      ${where}
    `,
    values
  );
  const limitParameter = add(filters.limit);
  const offsetParameter = add(filters.offset);
  const rows = await queryable.query(
    `
      SELECT su.id, su.internal_sku, su.unit_code, su.manufacturer_serial_number,
             su.normalized_serial_number, su.product_id, su.variant_id,
             su.state, su.received_at, su.created_at, su.updated_at,
             p.name AS product_name, p.sku AS product_sku, p.product_code,
             p.price AS product_price, pv.name AS variant_name, pv.sku AS variant_sku,
             pv.product_code AS variant_product_code, pv.price AS variant_price,
             COALESCE(pv.price, p.price) AS effective_price,
             COALESCE(pv.stock_quantity, p.stock_quantity) AS effective_stock_quantity,
             COALESCE(pv.serial_tracking_enabled, p.serial_tracking_enabled)
               AS effective_serial_tracking_enabled,
             COALESCE(pv.shop_warranty_enabled, p.shop_warranty_enabled)
               AS effective_shop_warranty_enabled,
             CASE
               WHEN COALESCE(pv.shop_warranty_enabled, p.shop_warranty_enabled) = TRUE
               THEN CASE WHEN pv.shop_warranty_enabled IS NULL
                 THEN p.shop_warranty_months ELSE pv.shop_warranty_months END
               ELSE NULL
             END AS effective_shop_warranty_months
      FROM stock_units su
      JOIN products p ON p.id = su.product_id
      LEFT JOIN product_variants pv ON pv.id = su.variant_id
      ${where}
      ORDER BY su.id DESC
      LIMIT ${limitParameter} OFFSET ${offsetParameter}
    `,
    values
  );
  const total = Number(countResult.rows[0].count);
  return {
    items: rows.rows,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.ceil(total / filters.limit),
    },
  };
}

async function stockUnitDetails(queryable, unitId) {
  const id = positiveInteger(unitId, 'stock unit id');
  const unitResult = await queryable.query(
    `
      SELECT su.*, p.name AS product_name, p.sku AS product_sku, p.product_code,
             p.price AS product_price, pv.name AS variant_name, pv.sku AS variant_sku,
             pv.product_code AS variant_product_code, pv.price AS variant_price,
             COALESCE(pv.price, p.price) AS effective_price,
             COALESCE(pv.stock_quantity, p.stock_quantity) AS effective_stock_quantity,
             COALESCE(pv.serial_tracking_enabled, p.serial_tracking_enabled)
               AS effective_serial_tracking_enabled,
             COALESCE(pv.shop_warranty_enabled, p.shop_warranty_enabled)
               AS effective_shop_warranty_enabled,
             CASE
               WHEN COALESCE(pv.shop_warranty_enabled, p.shop_warranty_enabled) = TRUE
               THEN CASE WHEN pv.shop_warranty_enabled IS NULL
                 THEN p.shop_warranty_months ELSE pv.shop_warranty_months END
               ELSE NULL
             END AS effective_shop_warranty_months,
             sis.id AS active_assignment_id, sis.sale_item_id,
             sis.internal_sku_snapshot, sis.manufacturer_serial_number_snapshot,
             s.id AS sale_id, s.invoice_number, s.status AS sale_status
      FROM stock_units su
      JOIN products p ON p.id = su.product_id
      LEFT JOIN product_variants pv ON pv.id = su.variant_id
      LEFT JOIN sale_item_stock_units sis
        ON sis.stock_unit_id = su.id AND sis.released_at IS NULL
      LEFT JOIN sale_items si ON si.id = sis.sale_item_id
      LEFT JOIN sales s ON s.id = si.sale_id
      WHERE su.id = $1
    `,
    [id]
  );
  const unit = unitResult.rows[0];
  if (!unit) throw new InventoryApiError('Stock unit not found', 404, 'STOCK_UNIT_NOT_FOUND');
  const history = await queryable.query(
    `
      SELECT e.id, e.event_type, e.from_state, e.to_state, e.sale_id,
             e.sale_item_id, e.actor_user_id, u.username AS actor_username,
             e.reason, e.metadata, e.occurred_at
      FROM stock_unit_events e
      LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.stock_unit_id = $1
      ORDER BY e.occurred_at, e.id
    `,
    [id]
  );
  return { ...unit, history: history.rows };
}

async function lookupStockUnit(queryable, code) {
  if (typeof code !== 'string' || code.trim() === '' || code.length > 500) {
    throw new InventoryApiError('Lookup code is required');
  }
  const original = code.trim();
  const normalized = normalizeManufacturerSerial(code);
  const result = await queryable.query(
    `
      SELECT id,
             CASE WHEN UPPER(unit_code) = UPPER($1) THEN 'unit_code'
                  WHEN UPPER(internal_sku) = UPPER($1) THEN 'internal_sku'
                  ELSE 'manufacturer_serial' END AS matched_by
      FROM stock_units
      WHERE UPPER(unit_code) = UPPER($1)
         OR UPPER(internal_sku) = UPPER($1)
         OR normalized_serial_number = $2
      ORDER BY id
    `,
    [original, normalized]
  );
  const ids = [...new Set(result.rows.map((row) => Number(row.id)))];
  if (ids.length === 0) throw new InventoryApiError('Stock unit not found', 404, 'STOCK_UNIT_NOT_FOUND');
  if (ids.length > 1) {
    throw new InventoryApiError('Lookup code is ambiguous', 409, 'AMBIGUOUS_STOCK_UNIT_CODE');
  }
  const details = await stockUnitDetails(queryable, ids[0]);
  return { ...details, matched_by: result.rows[0].matched_by };
}

async function correctAvailableSerialOperation(transaction, {
  unitId, serialNumber, actorUserId, reason = null,
}) {
  const client = transactionClient(transaction);
  const id = positiveInteger(unitId, 'stock unit id');
  const prepared = prepareManufacturerSerial(serialNumber);
  await revalidateCurrentAdmin(client, actorUserId);
  const preview = await client.query(
    `
      SELECT id, internal_sku, manufacturer_serial_number,
             normalized_serial_number, product_id, variant_id, state,
             EXISTS (
               SELECT 1 FROM sale_item_stock_units sis
               WHERE sis.stock_unit_id = stock_units.id
                 AND sis.released_at IS NULL
             ) AS has_active_sale_assignment
      FROM stock_units
      WHERE id = $1
    `,
    [id]
  );
  const oldUnit = preview.rows[0];
  if (!oldUnit) throw new InventoryApiError('Stock unit not found', 404, 'STOCK_UNIT_NOT_FOUND');
  if (oldUnit.state !== 'available') {
    throw new InventoryApiError(
      'Only an available unit can have its serial corrected',
      409,
      'SERIAL_CORRECTION_STATE_CONFLICT'
    );
  }
  if (oldUnit.has_active_sale_assignment === true) {
    throw new InventoryApiError(
      'A unit assigned to an active sale cannot have its serial corrected',
      409,
      'SERIAL_CORRECTION_ACTIVE_SALE'
    );
  }
  if (oldUnit.normalized_serial_number === prepared.normalized) {
    throw new InventoryApiError('The corrected serial is unchanged');
  }

  await retireStockUnits(transaction, {
    unitIds: [id], actorUserId, reason: reason || 'serial correction',
  });
  const [replacement] = await registerReceivedUnits(transaction, {
    actorUserId,
    batches: [{
      productId: Number(oldUnit.product_id),
      variantId: oldUnit.variant_id === null ? null : Number(oldUnit.variant_id),
      serialNumbers: [prepared.original],
    }],
  });
  await client.query(
    `INSERT INTO audit_log (user_id, action, details) VALUES ($1, 'CORRECT_STOCK_UNIT_SERIAL', $2)`,
    [actorUserId, JSON.stringify({
      retiredUnitId: Number(oldUnit.id),
      retiredInternalSku: oldUnit.internal_sku,
      previousSerial: oldUnit.manufacturer_serial_number,
      replacementUnitId: Number(replacement.id),
      replacementInternalSku: replacement.internal_sku,
      correctedSerial: replacement.manufacturer_serial_number,
      reason,
    })]
  );
  return { retired_unit: oldUnit, replacement_unit: replacement };
}

function correctAvailableSerial(transaction, input) {
  return withTransactionOperation(transaction, 'correct_serial', () =>
    correctAvailableSerialOperation(transaction, input)
  );
}

module.exports = {
  UNIT_STATES,
  correctAvailableSerial,
  listParameters,
  listStockUnits,
  lookupStockUnit,
  stockUnitDetails,
};
