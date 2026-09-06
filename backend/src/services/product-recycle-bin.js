class ProductRecycleBinError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'ProductRecycleBinError';
    this.statusCode = statusCode;
  }
}

function normalizedSku(value) {
  return String(value || '').trim().toUpperCase();
}

async function revalidateCurrentProductAdmin(client, userId, { lock = false } = {}) {
  const result = await client.query(
    `
      SELECT id, role
      FROM users
      WHERE id = $1
      ${lock ? 'FOR UPDATE' : ''}
    `,
    [userId]
  );

  const user = result.rows[0];
  if (!user || user.role !== 'admin') {
    throw new ProductRecycleBinError(
      'Current administrator authorization is required',
      403
    );
  }

  return user;
}

async function assertProductCanBeRestored(client, product) {
  const productSku = normalizedSku(product.sku);

  const productConflict = await client.query(
    `
      SELECT id, sku
      FROM products
      WHERE UPPER(sku) = $1
        AND id <> $2
      LIMIT 1
      FOR UPDATE
    `,
    [productSku, product.id]
  );
  if (productConflict.rows.length > 0) {
    throw new ProductRecycleBinError(
      `Cannot restore product: SKU ${productSku} conflicts with another product`,
      409
    );
  }

  const productVariantConflict = await client.query(
    `
      SELECT id, sku
      FROM product_variants
      WHERE UPPER(sku) = $1
      LIMIT 1
      FOR UPDATE
    `,
    [productSku]
  );
  if (productVariantConflict.rows.length > 0) {
    throw new ProductRecycleBinError(
      `Cannot restore product: SKU ${productSku} conflicts with a variant`,
      409
    );
  }

  const variantsResult = await client.query(
    `
      SELECT id, product_id, sku, is_active
      FROM product_variants
      WHERE product_id = $1
      ORDER BY id
      FOR UPDATE
    `,
    [product.id]
  );

  const seenVariantSkus = new Set();
  for (const variant of variantsResult.rows) {
    if (variant.product_id !== product.id) {
      throw new ProductRecycleBinError(
        'Cannot restore product: variant relationship could not be verified',
        409
      );
    }

    const variantSku = normalizedSku(variant.sku);
    if (!variantSku || variantSku === productSku || seenVariantSkus.has(variantSku)) {
      throw new ProductRecycleBinError(
        'Cannot restore product: product and variant SKUs must be unique',
        409
      );
    }
    seenVariantSkus.add(variantSku);

    const variantProductConflict = await client.query(
      `
        SELECT id, sku
        FROM products
        WHERE UPPER(sku) = $1
        LIMIT 1
        FOR UPDATE
      `,
      [variantSku]
    );
    if (variantProductConflict.rows.length > 0) {
      throw new ProductRecycleBinError(
        `Cannot restore product: variant SKU ${variantSku} conflicts with a product`,
        409
      );
    }

    const variantConflict = await client.query(
      `
        SELECT id, sku
        FROM product_variants
        WHERE UPPER(sku) = $1
          AND product_id <> $2
        LIMIT 1
        FOR UPDATE
      `,
      [variantSku, product.id]
    );
    if (variantConflict.rows.length > 0) {
      throw new ProductRecycleBinError(
        `Cannot restore product: variant SKU ${variantSku} conflicts with another variant`,
        409
      );
    }
  }

  return variantsResult.rows;
}

module.exports = {
  ProductRecycleBinError,
  normalizedSku,
  revalidateCurrentProductAdmin,
  assertProductCanBeRestored,
};
