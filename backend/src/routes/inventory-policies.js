const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { withTransaction } = require('../services/domain-transaction');
const { updateInventoryPolicy } = require('../services/inventory-policy-service');

const router = express.Router();

function sendError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code || 'INVENTORY_POLICY_ERROR',
    });
  }
  if (error.code === '23505') {
    return res.status(409).json({ error: 'Policy update conflicts with existing inventory' });
  }
  console.error('Inventory policy update failed:', error);
  return res.status(500).json({ error: 'Failed to update inventory policy' });
}

async function updatePolicy(req, res, variantId = null) {
  try {
    const policy = await withTransaction(pool, (transaction) =>
      updateInventoryPolicy(transaction, {
        actorUserId: req.user.id,
        productId: req.params.productId,
        variantId,
        body: req.body,
      })
    );
    return res.json({ policy });
  } catch (error) {
    return sendError(res, error);
  }
}

router.patch(
  '/:productId/inventory-policy',
  requireAuth,
  requireAdmin,
  (req, res) => updatePolicy(req, res)
);

router.patch(
  '/:productId/variants/:variantId/inventory-policy',
  requireAuth,
  requireAdmin,
  (req, res) => updatePolicy(req, res, req.params.variantId)
);

module.exports = router;
