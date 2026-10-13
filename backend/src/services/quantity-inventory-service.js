const { transactionClient, withTransactionOperation } = require('./domain-transaction');
const { lockInventoryTargets, StockUnitDomainError } = require('./stock-unit-service');

// Phase 3A provides the transaction-aware foundation only. Existing checkout,
// refund/void, and legacy product stock-update paths are integrated later; this
// ledger must not be treated as complete historical inventory before then.

const MOVEMENT_TYPES = Object.freeze([
  'opening', 'received', 'adjusted', 'sold', 'refunded', 'voided',
]);

class QuantityInventoryError extends Error {
  constructor(message, code = 'QUANTITY_INVENTORY_ERROR', statusCode = 409) {
    super(message);
    this.name = 'QuantityInventoryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new QuantityInventoryError(`${label} must be an integer`, 'INVALID_ARGUMENT', 400);
  }
  return parsed;
}

function optionalPositiveInteger(value, label) {
  if (value === null || value === undefined) return null;
  const parsed = integer(value, label);
  if (parsed <= 0) throw new QuantityInventoryError(`${label} must be positive`, 'INVALID_ARGUMENT', 400);
  return parsed;
}

function text(value, label, maximum) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maximum) {
    throw new QuantityInventoryError(`${label} must be ${maximum} characters or less`, 'INVALID_ARGUMENT', 400);
  }
  return value.trim() || null;
}

function normalizeMovements(movements) {
  if (!Array.isArray(movements) || movements.length === 0) {
    throw new QuantityInventoryError('At least one quantity movement is required', 'INVALID_ARGUMENT', 400);
  }
  const targets = new Set();
  return movements.map((movement) => {
    const productId = optionalPositiveInteger(movement.productId, 'product id');
    const variantId = optionalPositiveInteger(movement.variantId, 'variant id');
    const quantityChange = integer(movement.quantityChange, 'quantity change');
    const movementType = String(movement.movementType || '');
    if (!productId || quantityChange === 0 || !MOVEMENT_TYPES.includes(movementType)) {
      throw new QuantityInventoryError('Invalid quantity movement', 'INVALID_ARGUMENT', 400);
    }
    if (['opening', 'received', 'refunded', 'voided'].includes(movementType) && quantityChange < 1) {
      throw new QuantityInventoryError(`${movementType} quantity must be positive`, 'INVALID_ARGUMENT', 400);
    }
    if (movementType === 'sold' && quantityChange > -1) {
      throw new QuantityInventoryError('sold quantity must be negative', 'INVALID_ARGUMENT', 400);
    }
    const key = `${productId}:${variantId ?? 0}`;
    if (targets.has(key)) throw new QuantityInventoryError(`Duplicate inventory target ${key}`, 'DUPLICATE_TARGET', 400);
    targets.add(key);
    return {
      productId, variantId, quantityChange, movementType,
      reason: text(movement.reason, 'reason', 1000),
      sourceReference: text(movement.sourceReference, 'source reference', 255),
      key,
    };
  });
}

async function applyQuantityMovementsOperation(transaction, input) {
  const client = transactionClient(transaction);
  const movements = normalizeMovements(input.movements);
  const actorUserId = optionalPositiveInteger(input.actorUserId, 'actor user id');
  let targets;
  try {
    targets = await lockInventoryTargets(client, movements);
  } catch (error) {
    if (error instanceof StockUnitDomainError) {
      throw new QuantityInventoryError(error.message, error.code, error.statusCode);
    }
    throw error;
  }
  const targetMap = new Map(targets.map((target) => [target.key, target]));
  const results = [];
  for (const movement of movements) {
    const target = targetMap.get(movement.key);
    if (target.policy.serialTrackingEnabled) {
      throw new QuantityInventoryError(
        'Quantity operations are disabled for serialized inventory',
        'DIRECT_QUANTITY_EDIT_FORBIDDEN'
      );
    }
    const liveUnits = await client.query(`
      SELECT COUNT(*)::integer AS count FROM stock_units
      WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2::integer
        AND state <> 'retired'
    `, [target.productId, target.variantId]);
    if (Number(liveUnits.rows[0].count) !== 0) {
      throw new QuantityInventoryError(
        'Quantity operations are disabled while serialized units exist',
        'DIRECT_QUANTITY_EDIT_FORBIDDEN'
      );
    }
    const before = Number(target.stockQuantity);
    const after = before + movement.quantityChange;
    if (after < 0) throw new QuantityInventoryError('Insufficient inventory', 'INSUFFICIENT_INVENTORY');
    const updated = await client.query(`
      UPDATE ${target.table}
      SET stock_quantity = $1, updated_at = NOW()
      WHERE id = $2 AND stock_quantity = $3
      RETURNING stock_quantity::integer AS stock_quantity
    `, [after, target.rowId, before]);
    if (updated.rowCount !== 1) throw new QuantityInventoryError('Inventory changed concurrently', 'INVENTORY_CONFLICT');
    const ledger = await client.query(`
      INSERT INTO inventory_movements
        (product_id, variant_id, movement_type, quantity_change,
         quantity_before, quantity_after, actor_user_id, reason, source_reference)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      target.productId, target.variantId, movement.movementType, movement.quantityChange,
      before, after, actorUserId, movement.reason, movement.sourceReference,
    ]);
    results.push(ledger.rows[0]);
  }
  return results;
}

function applyQuantityMovements(transaction, input) {
  return withTransactionOperation(transaction, 'quantity_inventory', () =>
    applyQuantityMovementsOperation(transaction, input)
  );
}

function receiveQuantityInventory(transaction, input) {
  if (!input || !Array.isArray(input.movements)) {
    throw new QuantityInventoryError('At least one receiving movement is required', 'INVALID_ARGUMENT', 400);
  }
  return applyQuantityMovements(transaction, {
    ...input,
    movements: input.movements.map((movement) => ({
      ...movement,
      movementType: 'received',
      quantityChange: movement.quantity,
    })),
  });
}

module.exports = {
  MOVEMENT_TYPES,
  QuantityInventoryError,
  applyQuantityMovements,
  normalizeMovements,
  receiveQuantityInventory,
};
