const { applyQuantityMovements } = require('./quantity-inventory-service');

class SaleReversalError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'SaleReversalError';
    this.statusCode = statusCode;
  }
}

function assertSaleItemsCanBeReversed(items, action) {
  if (items.length === 0) {
    throw new SaleReversalError(
      `This sale has no items to ${action}`,
      409
    );
  }
}

function assertSaleCanBeReversed(sale, action) {
  if (sale.status === 'completed') {
    return;
  }

  if (sale.status === (action === 'void' ? 'voided' : 'refunded')) {
    throw new SaleReversalError(
      `This sale has already been ${action === 'void' ? 'voided' : 'refunded'}`,
      409
    );
  }

  if (sale.status === (action === 'void' ? 'refunded' : 'voided')) {
    throw new SaleReversalError(
      action === 'void'
        ? 'A refunded sale cannot be voided'
        : 'A voided sale cannot be refunded',
      409
    );
  }

  throw new SaleReversalError(
    `Only completed sales can be ${action === 'void' ? 'voided' : 'refunded'}`,
    409
  );
}

async function revalidateCurrentAdmin(client, userId) {
  const result = await client.query(
    `
      SELECT id, role
      FROM users
      WHERE id = $1
      FOR UPDATE
    `,
    [userId]
  );

  const user = result.rows[0];

  if (!user || user.role !== 'admin') {
    throw new SaleReversalError(
      'Current administrator authorization is required',
      403
    );
  }

  return user;
}

async function restoreExactInventory(transaction, items, {
  action, saleId, actorUserId, reason = null,
}) {
  for (const item of items) {
    if (item.variant_id == null && item.product_id == null) {
      throw new SaleReversalError(
        'Inventory restoration could not be completed; manual reconciliation is required',
        409
      );
    }
  }

  if (!['refunded', 'voided'].includes(action)) {
    throw new SaleReversalError('Inventory restoration action is invalid', 400);
  }
  const aggregated = new Map();
  for (const item of items) {
    const productId = Number(item.product_id);
    const variantId = item.variant_id == null ? null : Number(item.variant_id);
    const key = `${productId}:${variantId ?? 'null'}`;
    const existing = aggregated.get(key);
    aggregated.set(key, {
      productId, variantId,
      quantity: Number(item.quantity) + (existing?.quantity || 0),
    });
  }
  return applyQuantityMovements(transaction, {
    actorUserId,
    requireActive: false,
    enforceVariantTarget: false,
    movements: [...aggregated.values()].map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      movementType: action,
      quantityChange: item.quantity,
      reason,
      sourceReference: `sale:${saleId}:${action}`,
    })),
  });
}

module.exports = {
  SaleReversalError,
  assertSaleCanBeReversed,
  assertSaleItemsCanBeReversed,
  revalidateCurrentAdmin,
  restoreExactInventory,
};
