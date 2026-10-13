const crypto = require('crypto');
const { transactionClient, withTransactionOperation } = require('./domain-transaction');
const { revalidateCurrentAdmin } = require('./sale-reversal');
const { normalizeRequiredIdempotencyKey } = require('./checkout-validation');
const { prepareUniqueSerialBatch } = require('./serial-number');
const { receiveQuantityInventory } = require('./quantity-inventory-service');
const { registerReceivedUnits } = require('./stock-unit-service');

class ProductRestockError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_RESTOCK_REQUEST') {
    super(message); this.name = 'ProductRestockError'; this.statusCode = statusCode; this.code = code;
  }
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new ProductRestockError(`${label} must be a positive integer`);
  return number;
}
function optionalId(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, label);
}
function optionalReason(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 1000) throw new ProductRestockError('reason must be 1000 characters or less');
  return value.trim() || null;
}

function normalizeRestockRequest(productId, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProductRestockError('Request body is required');
  const allowed = new Set(['idempotency_key', 'variant_id', 'quantity', 'serial_numbers', 'reason']);
  for (const field of Object.keys(body)) if (!allowed.has(field)) throw new ProductRestockError(`Unknown request body field: ${field}`);
  let idempotencyKey;
  try { idempotencyKey = normalizeRequiredIdempotencyKey(body.idempotency_key); } catch (error) {
    throw new ProductRestockError(error.message, 400, 'INVALID_IDEMPOTENCY_KEY');
  }
  const serials = body.serial_numbers === undefined ? [] : body.serial_numbers;
  if (!Array.isArray(serials)) throw new ProductRestockError('serial_numbers must be an array');
  const prepared = serials.length ? prepareUniqueSerialBatch(serials) : [];
  const quantity = body.quantity === null || body.quantity === undefined || body.quantity === ''
    ? null : positiveInteger(body.quantity, 'quantity');
  if (quantity === null && prepared.length === 0) throw new ProductRestockError('A positive quantity or serial numbers are required');
  return {
    productId: positiveInteger(productId, 'product id'),
    variantId: optionalId(body.variant_id, 'variant id'), idempotencyKey, quantity,
    serialNumbers: prepared.map((serial) => serial.original),
    normalizedSerials: prepared.map((serial) => serial.normalized).sort(),
    reason: optionalReason(body.reason),
  };
}

function fingerprint(request) {
  return crypto.createHash('sha256').update(JSON.stringify({
    productId: request.productId, variantId: request.variantId, quantity: request.quantity,
    serials: request.normalizedSerials, reason: request.reason,
  })).digest();
}

function sameFingerprint(left, right) {
  return Buffer.isBuffer(left) && left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function restockProductOperation(transaction, input) {
  const client = transactionClient(transaction);
  const request = normalizeRestockRequest(input.productId, input.body);
  const requestFingerprint = fingerprint(request);
  await revalidateCurrentAdmin(client, input.actorUserId);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`inventory-receipt:${request.idempotencyKey}`]);
  const existing = await client.query(`SELECT * FROM inventory_receipts WHERE idempotency_key=$1`, [request.idempotencyKey]);
  if (existing.rowCount) {
    const receipt = existing.rows[0];
    if (Number(receipt.actor_user_id) !== Number(input.actorUserId)
      || !sameFingerprint(receipt.request_fingerprint, requestFingerprint)) {
      throw new ProductRestockError('Idempotency key was already used for a different restock request', 409, 'IDEMPOTENCY_CONFLICT');
    }
    return { receipt, replayed: true };
  }

  // The domain services acquire product locks before variant locks in stable ID order.
  // They also validate ownership and effective serial policy before mutation.
  let trackingMode;
  let quantityReceived;
  let quantityBefore;
  let quantityAfter;
  let stockUnitIds = [];
  const sourceReference = `restock:${request.idempotencyKey}`;
  if (request.serialNumbers.length) {
    if (request.quantity !== null && request.quantity !== request.serialNumbers.length) {
      throw new ProductRestockError('Serialized quantity is derived from serial numbers and must not conflict', 400, 'SERIAL_QUANTITY_MISMATCH');
    }
    const units = await registerReceivedUnits(transaction, {
      actorUserId: input.actorUserId,
      batches: [{ productId: request.productId, variantId: request.variantId, serialNumbers: request.serialNumbers }],
    });
    trackingMode = 'serialized';
    quantityReceived = units.length;
    stockUnitIds = units.map((unit) => String(unit.id));
    const current = await client.query(`
      SELECT stock_quantity::integer AS quantity FROM ${request.variantId === null ? 'products' : 'product_variants'} WHERE id=$1
    `, [request.variantId ?? request.productId]);
    quantityAfter = Number(current.rows[0].quantity);
    quantityBefore = quantityAfter - quantityReceived;
  } else {
    const rows = await receiveQuantityInventory(transaction, {
      actorUserId: input.actorUserId,
      movements: [{ productId: request.productId, variantId: request.variantId,
        quantity: request.quantity, reason: request.reason || 'Product restock', sourceReference }],
    });
    trackingMode = 'quantity';
    quantityReceived = request.quantity;
    quantityBefore = Number(rows[0].quantity_before);
    quantityAfter = Number(rows[0].quantity_after);
  }
  const inserted = await client.query(`
    INSERT INTO inventory_receipts
      (idempotency_key,request_fingerprint,product_id,variant_id,actor_user_id,tracking_mode,
       quantity_received,quantity_before,quantity_after,reason,source_reference,stock_unit_ids)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::bigint[]) RETURNING *
  `, [request.idempotencyKey, requestFingerprint, request.productId, request.variantId, input.actorUserId,
    trackingMode, quantityReceived, quantityBefore, quantityAfter, request.reason, sourceReference, stockUnitIds]);
  await client.query(`INSERT INTO audit_log(user_id,action,details) VALUES($1,'RESTOCK_PRODUCT',$2)`, [
    input.actorUserId, JSON.stringify({ idempotencyKey: request.idempotencyKey, productId: request.productId,
      variantId: request.variantId, trackingMode, quantityReceived, sourceReference }),
  ]);
  return { receipt: inserted.rows[0], replayed: false };
}

function restockProduct(transaction, input) {
  return withTransactionOperation(transaction, 'restock_product', () => restockProductOperation(transaction, input));
}

module.exports = { ProductRestockError, fingerprint, normalizeRestockRequest, restockProduct };
