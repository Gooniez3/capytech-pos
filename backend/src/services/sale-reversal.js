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

async function restoreExactInventory(client, items) {
  for (const item of items) {
    if (item.variant_id == null && item.product_id == null) {
      throw new SaleReversalError(
        'Inventory restoration could not be completed; manual reconciliation is required',
        409
      );
    }
  }

  for (const item of items) {
    let result;

    if (item.variant_id != null) {
      result = await client.query(
        `
          UPDATE product_variants
          SET
            stock_quantity = stock_quantity + $1,
            updated_at = NOW()
          WHERE id = $2
        `,
        [item.quantity, item.variant_id]
      );
    } else {
      result = await client.query(
        `
          UPDATE products
          SET
            stock_quantity = stock_quantity + $1,
            updated_at = NOW()
          WHERE id = $2
        `,
        [item.quantity, item.product_id]
      );
    }

    if (result.rowCount !== 1) {
      throw new SaleReversalError(
        'Inventory restoration could not be completed; manual reconciliation is required',
        409
      );
    }
  }
}

module.exports = {
  SaleReversalError,
  assertSaleCanBeReversed,
  assertSaleItemsCanBeReversed,
  revalidateCurrentAdmin,
  restoreExactInventory,
};
