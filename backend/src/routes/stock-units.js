const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { revalidateCurrentAdmin } = require('../services/sale-reversal');
const { withTransaction } = require('../services/domain-transaction');
const {
  adoptExistingInventory,
  registerReceivedUnits,
  releaseQuarantinedUnits,
  retireStockUnits,
} = require('../services/stock-unit-service');
const {
  correctAvailableSerial,
  listStockUnits,
  lookupStockUnit,
  stockUnitDetails,
} = require('../services/stock-unit-api-service');
const {
  optionalText,
  rejectUnknownFields,
} = require('../services/inventory-api-validation');

const router = express.Router();

function sendError(res, error, fallback) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code || 'STOCK_UNIT_ERROR',
    });
  }
  if (error.code === '23505') {
    return res.status(409).json({ error: 'A serial number or stock unit already exists' });
  }
  if (error.code === '23503') {
    return res.status(409).json({ error: 'The inventory relationship is no longer valid' });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ error: fallback });
}

function normalizeBatches(body) {
  const value = rejectUnknownFields(body, ['batches']);
  if (!Array.isArray(value.batches) || value.batches.length === 0 || value.batches.length > 100) {
    const error = new Error('batches must contain between 1 and 100 entries');
    error.statusCode = 400;
    throw error;
  }
  return value.batches.map((batch) => {
    const item = rejectUnknownFields(
      batch,
      ['product_id', 'variant_id', 'serial_numbers'],
      'batch'
    );
    return {
      productId: item.product_id,
      variantId: item.variant_id ?? null,
      serialNumbers: item.serial_numbers,
    };
  });
}

function normalizeUnitAction(body) {
  const value = rejectUnknownFields(body, ['unit_ids', 'reason']);
  if (!Array.isArray(value.unit_ids) || value.unit_ids.length === 0 || value.unit_ids.length > 500) {
    const error = new Error('unit_ids must contain between 1 and 500 entries');
    error.statusCode = 400;
    throw error;
  }
  return {
    unitIds: value.unit_ids,
    reason: optionalText(value.reason, 'reason', 1000),
  };
}

async function audit(client, userId, action, details) {
  await client.query(
    `INSERT INTO audit_log (user_id, action, details) VALUES ($1, $2, $3)`,
    [userId, action, JSON.stringify(details)]
  );
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const query = rejectUnknownFields(
      req.query,
      ['page', 'limit', 'state', 'product_id', 'variant_id', 'q'],
      'query'
    );
    return res.json(await listStockUnits(pool, query));
  } catch (error) {
    return sendError(res, error, 'Failed to list stock units');
  }
});

router.get('/lookup', requireAuth, async (req, res) => {
  try {
    const query = rejectUnknownFields(req.query, ['code'], 'query');
    return res.json(await lookupStockUnit(pool, query.code));
  } catch (error) {
    return sendError(res, error, 'Failed to look up stock unit');
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    return res.json(await stockUnitDetails(pool, req.params.id));
  } catch (error) {
    return sendError(res, error, 'Failed to load stock unit');
  }
});

async function batchMutation(req, res, { mode }) {
  try {
    const batches = normalizeBatches(req.body);
    const units = await withTransaction(pool, async (transaction) => {
      await revalidateCurrentAdmin(transaction.client, req.user.id);
      const created = mode === 'receive'
        ? await registerReceivedUnits(transaction, { batches, actorUserId: req.user.id })
        : await adoptExistingInventory(transaction, { batches, actorUserId: req.user.id });
      await audit(transaction.client, req.user.id,
        mode === 'receive' ? 'RECEIVE_STOCK_UNITS' : 'ADOPT_STOCK_UNITS', {
          unitIds: created.map((unit) => Number(unit.id)),
          batches: batches.map((batch) => ({
            productId: Number(batch.productId),
            variantId: batch.variantId == null ? null : Number(batch.variantId),
            quantity: batch.serialNumbers?.length,
          })),
        });
      return created;
    });
    return res.status(201).json({ units });
  } catch (error) {
    return sendError(res, error, `Failed to ${mode} stock units`);
  }
}

router.post('/receive', requireAuth, requireAdmin, (req, res) =>
  batchMutation(req, res, { mode: 'receive' }));

router.post('/adopt', requireAuth, requireAdmin, (req, res) =>
  batchMutation(req, res, { mode: 'adopt' }));

router.patch('/:id/serial', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = rejectUnknownFields(req.body, ['serial_number', 'reason']);
    const result = await withTransaction(pool, (transaction) =>
      correctAvailableSerial(transaction, {
        unitId: req.params.id,
        serialNumber: body.serial_number,
        reason: optionalText(body.reason, 'reason', 1000),
        actorUserId: req.user.id,
      })
    );
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to correct stock-unit serial');
  }
});

async function lifecycleMutation(req, res, { mode }) {
  try {
    const input = normalizeUnitAction(req.body);
    const units = await withTransaction(pool, async (transaction) => {
      await revalidateCurrentAdmin(transaction.client, req.user.id);
      const updated = mode === 'release'
        ? await releaseQuarantinedUnits(transaction, { ...input, actorUserId: req.user.id })
        : await retireStockUnits(transaction, { ...input, actorUserId: req.user.id });
      await audit(transaction.client, req.user.id,
        mode === 'release' ? 'RELEASE_STOCK_UNITS' : 'RETIRE_STOCK_UNITS', {
          unitIds: updated.map((unit) => Number(unit.id)),
          reason: input.reason,
        });
      return updated;
    });
    return res.json({ units });
  } catch (error) {
    return sendError(res, error, `Failed to ${mode} stock units`);
  }
}

router.post('/release', requireAuth, requireAdmin, (req, res) =>
  lifecycleMutation(req, res, { mode: 'release' }));

router.post('/retire', requireAuth, requireAdmin, (req, res) =>
  lifecycleMutation(req, res, { mode: 'retire' }));

module.exports = router;
module.exports.normalizeBatches = normalizeBatches;
module.exports.normalizeUnitAction = normalizeUnitAction;
