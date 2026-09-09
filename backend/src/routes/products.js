const express = require('express');
const bwipjs = require('bwip-js');
const pool = require('../db/pool');

const {
  requireAuth,
  requireAdmin,
} = require('../middleware/auth');

const uploadProductImageMiddleware = require(
  '../middleware/productImageUpload'
);

const {
  uploadProductImage,
  deleteProductImage,
  trashProductImage,
  restoreProductImage,
  getLatestTrashedImage,
  ProductImageError,
} = require('../services/productImageService');

const {
  ProductRecycleBinError,
  revalidateCurrentProductAdmin,
  assertProductCanBeRestored,
} = require('../services/product-recycle-bin');

const router = express.Router();

/**
 * Generate Code 128 barcode PNG as a data URL.
 */
async function generateBarcodeDataUrl(value) {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text: value,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
    paddingwidth: 8,
    paddingheight: 8,
  });

  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * Normalize all SKUs.
 */
function cleanSku(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function imageStatusPayload(product, trash) {
  return {
    image_url: product.image_url || null,
    image_path: product.image_path || null,
    has_trashed_image: Boolean(trash),
    trashed_image_url: trash?.publicUrl || null,
    trashed_at: trash?.trashedAt || null,
  };
}

/**
 * Make sure an SKU does not already exist in either:
 * products
 * product_variants
 */
async function skuAlreadyExists(
  sku,
  {
    ignoreProductId = null,
    ignoreVariantId = null,
  } = {}
) {
  const productResult = await pool.query(
    `SELECT id
     FROM products
     WHERE UPPER(sku) = UPPER($1)
       AND ($2::integer IS NULL OR id <> $2)
     LIMIT 1`,
    [sku, ignoreProductId]
  );

  if (productResult.rows.length > 0) {
    return true;
  }

  const variantResult = await pool.query(
    `SELECT id
     FROM product_variants
     WHERE UPPER(sku) = UPPER($1)
       AND ($2::integer IS NULL OR id <> $2)
     LIMIT 1`,
    [sku, ignoreVariantId]
  );

  return variantResult.rows.length > 0;
}

/* =========================================================
   PRODUCTS
   ========================================================= */

/**
 * GET /api/products
 *
 * Returns active products.
 *
 * If a product has variants:
 * stock_quantity becomes the total active variant stock.
 *
 * base_stock_quantity keeps the original parent stock.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        p.*,
        c.name AS category_name,

        p.stock_quantity AS base_stock_quantity,

        COUNT(pv.id)::integer AS variant_count,

        CASE
          WHEN COUNT(pv.id) > 0
          THEN COALESCE(SUM(pv.stock_quantity), 0)::integer
          ELSE p.stock_quantity
        END AS effective_stock_quantity

      FROM products p

      LEFT JOIN categories c
        ON p.category_id = c.id

      LEFT JOIN product_variants pv
        ON pv.product_id = p.id
       AND pv.is_active = TRUE

      WHERE p.is_active = TRUE

      GROUP BY
        p.id,
        c.name

      ORDER BY p.name
      `
    );

    const products = result.rows.map((product) => ({
      ...product,

      has_variants:
        Number(product.variant_count) > 0,

      stock_quantity:
        Number(product.effective_stock_quantity),
    }));

    res.json(products);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Server error',
    });
  }
});

/**
 * GET /api/products/deleted
 *
 * Admin recycle-bin view. Legacy inactive products with no deletion metadata
 * remain visible and are explicitly marked for the UI.
 */
router.get('/deleted', requireAuth, requireAdmin, async (req, res) => {
  try {
    await revalidateCurrentProductAdmin(pool, req.user.id);

    const result = await pool.query(
      `
        SELECT
          p.id, p.sku, p.name, p.category_id, c.name AS category_name,
          p.image_url, p.image_path, p.deleted_at, p.deleted_by,
          u.username AS deleted_by_username,
          COUNT(pv.id)::integer AS variant_count,
          COUNT(pv.id) FILTER (WHERE pv.is_active = TRUE)::integer AS active_variant_count,
          COUNT(pv.id) FILTER (WHERE pv.is_active = FALSE)::integer AS inactive_variant_count,
          (p.deleted_at IS NULL AND p.deleted_by IS NULL) AS is_legacy_deleted
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN users u ON u.id = p.deleted_by
        LEFT JOIN product_variants pv ON pv.product_id = p.id
        WHERE p.is_active = FALSE
        GROUP BY p.id, c.name, u.username
        ORDER BY p.deleted_at DESC NULLS LAST, p.id DESC
      `
    );

    return res.json(result.rows);
  } catch (err) {
    if (err instanceof ProductRecycleBinError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('Failed to load deleted products:', err);
    return res.status(500).json({ error: 'Failed to load deleted products' });
  }
});

/**
 * GET /api/products/lookup/:sku
 *
 * Used by a physical barcode scanner.
 *
 * First searches variant SKU.
 * If none exists, searches normal product SKU.
 */
router.get(
  '/lookup/:sku',
  requireAuth,
  async (req, res) => {
    try {
      const sku = cleanSku(req.params.sku);

      if (!sku) {
        return res.status(400).json({
          error: 'SKU is required',
        });
      }

      /*
       * Look for exact variant first.
       */
      const variantResult = await pool.query(
        `
        SELECT
          pv.id AS variant_id,
          pv.product_id,

          pv.name AS variant_name,
          pv.sku AS variant_sku,

          COALESCE(pv.price, p.price) AS price,
          COALESCE(pv.cost, p.cost) AS cost,

          pv.stock_quantity,
          pv.low_stock_threshold,

          p.id,
          p.name,
          p.sku,
          p.category_id,
          p.image_url,
          p.image_path,

          c.name AS category_name

        FROM product_variants pv

        JOIN products p
          ON p.id = pv.product_id

        LEFT JOIN categories c
          ON c.id = p.category_id

        WHERE UPPER(pv.sku) = UPPER($1)
          AND pv.is_active = TRUE
          AND p.is_active = TRUE

        LIMIT 1
        `,
        [sku]
      );

      if (variantResult.rows.length > 0) {
        return res.json({
          type: 'variant',
          ...variantResult.rows[0],
        });
      }

      /*
       * Otherwise look for base product.
       */
      const productResult = await pool.query(
        `
        SELECT
          p.*,
          c.name AS category_name

        FROM products p

        LEFT JOIN categories c
          ON c.id = p.category_id

        WHERE UPPER(p.sku) = UPPER($1)
          AND p.is_active = TRUE

        LIMIT 1
        `,
        [sku]
      );

      if (productResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Product not found',
        });
      }

      const product = productResult.rows[0];

      /*
       * Determine whether this parent product
       * actually contains variants.
       */
      const variantCount = await pool.query(
        `
        SELECT COUNT(*)::integer AS count
        FROM product_variants
        WHERE product_id = $1
          AND is_active = TRUE
        `,
        [product.id]
      );

      res.json({
        type: 'product',
        ...product,
        has_variants:
          Number(variantCount.rows[0].count) > 0,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

/**
 * POST /api/products
 *
 * Create normal parent product.
 */
router.post(
  '/',
  requireAuth,
  requireAdmin,
  uploadProductImageMiddleware.single('image'),
  async (req, res) => {
    const {
      sku,
      name,
      category_id,
      price,
      cost,
      stock_quantity,
      low_stock_threshold,
      variants: variantsJson,
    } = req.body;

    if (
      !sku ||
      !name ||
      price === undefined
    ) {
      return res.status(400).json({
        error:
          'sku, name, and price are required',
      });
    }

    const normalizedSku =
      cleanSku(sku);

    let variants = [];

    try {
      variants = variantsJson
        ? JSON.parse(variantsJson)
        : [];
    } catch {
      return res.status(400).json({
        error: 'Invalid variants data',
      });
    }

    const client =
      await pool.connect();

    let uploadedImage = null;

    try {
      await client.query('BEGIN');

      // ---------------------------------
      // 1. Validate parent SKU
      // ---------------------------------
      const parentSkuCheck =
        await client.query(
          `
          SELECT sku
          FROM products
          WHERE UPPER(sku) = UPPER($1)

          UNION ALL

          SELECT sku
          FROM product_variants
          WHERE UPPER(sku) = UPPER($1)

          LIMIT 1
          `,
          [normalizedSku]
        );

      if (
        parentSkuCheck.rows.length > 0
      ) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error:
            `Product SKU "${normalizedSku}" already exists`,
        });
      }

      // ---------------------------------
      // 2. Validate variant SKUs
      // ---------------------------------
      const normalizedVariants =
        variants.map((variant) => ({
          ...variant,

          sku: cleanSku(
            variant.sku
          ),
        }));

      const variantSkuSet =
        new Set();

      for (
        const variant
        of normalizedVariants
      ) {
        if (
          !variant.name ||
          !variant.sku
        ) {
          await client.query(
            'ROLLBACK'
          );

          return res.status(400).json({
            error:
              'Every variant must have a name and SKU',
          });
        }

        if (
          variant.sku ===
          normalizedSku
        ) {
          await client.query(
            'ROLLBACK'
          );

          return res.status(409).json({
            error:
              `Variant SKU "${variant.sku}" cannot match the product SKU`,
          });
        }

        if (
          variantSkuSet.has(
            variant.sku
          )
        ) {
          await client.query(
            'ROLLBACK'
          );

          return res.status(409).json({
            error:
              `Duplicate variant SKU "${variant.sku}" in this product`,
          });
        }

        variantSkuSet.add(
          variant.sku
        );

        const existingSku =
          await client.query(
            `
            SELECT sku
            FROM products
            WHERE UPPER(sku) =
              UPPER($1)

            UNION ALL

            SELECT sku
            FROM product_variants
            WHERE UPPER(sku) =
              UPPER($1)

            LIMIT 1
            `,
            [variant.sku]
          );

        if (
          existingSku.rows.length > 0
        ) {
          await client.query(
            'ROLLBACK'
          );

          return res.status(409).json({
            error:
              `Variant SKU "${variant.sku}" already exists`,
          });
        }
      }

      // ---------------------------------
      // 3. Upload image
      // ---------------------------------
      if (req.file) {
        uploadedImage =
          await uploadProductImage(
            req.file,
            normalizedSku
          );
      }

      // ---------------------------------
      // 4. Create parent product
      // ---------------------------------
      const productResult =
        await client.query(
          `
          INSERT INTO products
          (
            sku,
            name,
            category_id,
            price,
            cost,
            stock_quantity,
            low_stock_threshold,
            image_url,
            image_path
          )

          VALUES
          (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9
          )

          RETURNING *
          `,
          [
            normalizedSku,
            name.trim(),

            category_id ||
              null,

            price,

            cost || 0,

            normalizedVariants.length > 0
              ? 0
              : stock_quantity || 0,

            low_stock_threshold ?? 5,

            uploadedImage?.imageUrl ||
              null,

            uploadedImage?.imagePath ||
              null,
          ]
        );

      const product =
        productResult.rows[0];

      // ---------------------------------
      // 5. Create variants
      // ---------------------------------
      for (
        const variant
        of normalizedVariants
      ) {
        await client.query(
          `
          INSERT INTO product_variants
          (
            product_id,
            name,
            sku,
            price,
            cost,
            stock_quantity,
            low_stock_threshold
          )

          VALUES
          (
            $1, $2, $3, $4,
            $5, $6, $7
          )
          `,
          [
            product.id,
            String(
              variant.name
            ).trim(),

            variant.sku,

            variant.price === null ||
            variant.price === undefined
              ? null
              : variant.price,

            variant.cost === null ||
            variant.cost === undefined
              ? null
              : variant.cost,

            Number(
              variant.stock_quantity ||
                0
            ),

            Number(
              variant.low_stock_threshold ??
                2
            ),
          ]
        );
      }

      await client.query('COMMIT');

      return res
        .status(201)
        .json(product);

    } catch (err) {
      try {
        await client.query(
          'ROLLBACK'
        );
      } catch {
        // ignore rollback failure
      }

      if (
        uploadedImage?.imagePath
      ) {
        try {
          await deleteProductImage(
            uploadedImage.imagePath
          );
        } catch (
          imageCleanupError
        ) {
          console.error(
            'Failed to clean up uploaded image:',
            imageCleanupError
          );
        }
      }

      console.error(
        'Create product transaction failed:',
        err
      );

      if (
        err.code === '23505'
      ) {
        return res
          .status(409)
          .json({
            error:
              'A product or variant SKU already exists',
          });
      }

      return res
        .status(500)
        .json({
          error:
            'Failed to create product',
        });
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/products/search?q=...
 *
 * Behavior:
 * - Exact variant SKU -> return only that variant
 * - Otherwise -> return matching parent products only
 */
router.get(
  '/search',
  requireAuth,
  async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();

      if (!q) {
        return res.json([]);
      }

      /*
       * 1. Exact variant SKU match
       */
      const exactVariant = await pool.query(
        `
        SELECT
          'variant' AS type,

          p.id AS product_id,
          pv.id AS variant_id,

          p.name AS product_name,
          pv.name AS variant_name,

          pv.sku AS sku,

          COALESCE(
            pv.price,
            p.price
          ) AS price,

          COALESCE(
            pv.cost,
            p.cost
          ) AS cost,

          pv.stock_quantity,
          pv.low_stock_threshold,

          p.image_url,
          p.image_path,

          c.name AS category_name

        FROM product_variants pv

        JOIN products p
          ON p.id = pv.product_id

        LEFT JOIN categories c
          ON c.id = p.category_id

        WHERE UPPER(pv.sku) = UPPER($1)
          AND pv.is_active = TRUE
          AND p.is_active = TRUE

        LIMIT 1
        `,
        [q]
      );

      if (exactVariant.rows.length > 0) {
        return res.json(exactVariant.rows);
      }

      /*
       * 2. General product search
       */
      const search = `%${q}%`;

      const products = await pool.query(
        `
        SELECT
          'product' AS type,

          p.id AS product_id,
          NULL::integer AS variant_id,

          p.name AS product_name,
          NULL::varchar AS variant_name,

          p.sku AS sku,

          p.price,
          p.cost,

          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_variants pv_check
              WHERE pv_check.product_id = p.id
                AND pv_check.is_active = TRUE
            )
            THEN (
              SELECT COALESCE(
                SUM(pv_stock.stock_quantity),
                0
              )
              FROM product_variants pv_stock
              WHERE pv_stock.product_id = p.id
                AND pv_stock.is_active = TRUE
            )
            ELSE p.stock_quantity
          END AS stock_quantity,

          p.low_stock_threshold,
          p.image_url,
          p.image_path,

          c.name AS category_name

        FROM products p

        LEFT JOIN categories c
          ON c.id = p.category_id

        WHERE p.is_active = TRUE
          AND (
            p.name ILIKE $1
            OR p.sku ILIKE $1

            OR EXISTS (
              SELECT 1
              FROM product_variants pv_search
              WHERE pv_search.product_id = p.id
                AND pv_search.is_active = TRUE
                AND (
                  pv_search.name ILIKE $1
                  OR pv_search.sku ILIKE $1
                )
            )
          )

        ORDER BY p.name

        LIMIT 50
        `,
        [search]
      );

      res.json(products.rows);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Search failed',
      });
    }
  }
);

/**
 * GET /api/products/:id/image
 *
 * Current photo plus the latest file in this product's image trash.
 */
router.get(
  '/:id/image',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT id, sku, image_url, image_path
        FROM products
        WHERE id = $1
        `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const product = result.rows[0];
      const trash = await getLatestTrashedImage(product.id);
      return res.json(imageStatusPayload(product, trash));
    } catch (err) {
      if (err instanceof ProductImageError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      console.error('Failed to load product image status:', err);
      return res.status(500).json({ error: 'Failed to load product image' });
    }
  }
);

/**
 * POST /api/products/:id/image/trash
 *
 * Moves the current local photo to trash and clears image_url / image_path.
 */
router.post(
  '/:id/image/trash',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await revalidateCurrentProductAdmin(client, req.user.id, { lock: true });

      const productResult = await client.query(
        `
        SELECT id, sku, image_url, image_path
        FROM products
        WHERE id = $1
        FOR UPDATE
        `,
        [req.params.id]
      );

      if (productResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Product not found' });
      }

      const product = productResult.rows[0];
      if (!product.image_url && !product.image_path) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Product has no image to move to trash' });
      }

      const oldImagePath = product.image_path;

      const updated = await client.query(
        `
        UPDATE products
        SET image_url = NULL, image_path = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id, sku, image_url, image_path
        `,
        [product.id]
      );

      await client.query(
        `INSERT INTO audit_log (user_id, action, details)
         VALUES ($1, 'TRASH_PRODUCT_IMAGE', $2)`,
        [req.user.id, `Moved product image to trash for ${product.id} (${product.sku})`]
      );

      await client.query('COMMIT');

      await trashProductImage(product.id, oldImagePath);
      const trash = await getLatestTrashedImage(product.id);
      return res.json({
        message: trash
          ? 'Image moved to trash.'
          : 'Image removed. No local copy was available to restore.',
        ...imageStatusPayload(updated.rows[0], trash),
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failure.
      }

      if (err instanceof ProductImageError || err instanceof ProductRecycleBinError) {
        return res.status(err.statusCode).json({ error: err.message });
      }

      console.error('Failed to trash product image:', err);
      return res.status(500).json({ error: 'Failed to move image to trash' });
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/products/:id/image/restore
 *
 * Restores the latest trashed photo. If the product already has a photo,
 * that file is moved to trash first so restore stays reversible.
 */
router.post(
  '/:id/image/restore',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await revalidateCurrentProductAdmin(client, req.user.id, { lock: true });

      const productResult = await client.query(
        `
        SELECT id, sku, image_url, image_path
        FROM products
        WHERE id = $1
        FOR UPDATE
        `,
        [req.params.id]
      );

      if (productResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Product not found' });
      }

      const product = productResult.rows[0];
      const restoredImage = await restoreProductImage(product.id, {
        currentImagePath: product.image_path,
      });

      const updated = await client.query(
        `
        UPDATE products
        SET image_url = $2, image_path = $3, updated_at = NOW()
        WHERE id = $1
        RETURNING id, sku, image_url, image_path
        `,
        [product.id, restoredImage.imageUrl, restoredImage.imagePath]
      );

      await client.query(
        `INSERT INTO audit_log (user_id, action, details)
         VALUES ($1, 'RESTORE_PRODUCT_IMAGE', $2)`,
        [req.user.id, `Restored product image for ${product.id} (${product.sku})`]
      );

      await client.query('COMMIT');

      const trash = await getLatestTrashedImage(product.id);
      return res.json({
        message: 'Image restored.',
        ...imageStatusPayload(updated.rows[0], trash),
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failure.
      }

      if (err instanceof ProductImageError || err instanceof ProductRecycleBinError) {
        return res.status(err.statusCode).json({ error: err.message });
      }

      console.error('Failed to restore product image:', err);
      return res.status(500).json({ error: 'Failed to restore image' });
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/products/:id/barcode
 *
 * Generate parent product barcode.
 */
router.get(
  '/:id/barcode',
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          id,
          sku,
          name,
          price

        FROM products

        WHERE id = $1
          AND is_active = TRUE
        `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Product not found',
        });
      }

      const product = result.rows[0];

      const barcode =
        await generateBarcodeDataUrl(
          product.sku
        );

      res.json({
        id: product.id,
        sku: product.sku,
        name: product.name,
        price: product.price,
        barcode,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          'Failed to generate barcode',
      });
    }
  }
);

/**
 * PUT /api/products/:id
 */
router.put(
  '/:id',
  requireAuth,
  requireAdmin,
  uploadProductImageMiddleware.single('image'),
  async (req, res) => {
    const {
      sku,
      name,
      category_id,
      price,
      cost,
      stock_quantity,
      low_stock_threshold,
    } = req.body;

    if (!sku || !name || price === undefined) {
      return res.status(400).json({
        error: 'sku, name, and price are required',
      });
    }

    const normalizedSku = cleanSku(sku);

    const client = await pool.connect();

    let newUploadedImage = null;
    let oldImagePath = null;

    try {
      await client.query('BEGIN');

      // ---------------------------------
      // 1. Load existing product
      // ---------------------------------
      const existingResult =
        await client.query(
          `
          SELECT *
          FROM products
          WHERE id = $1
          `,
          [req.params.id]
        );

      if (existingResult.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Product not found',
        });
      }

      const existingProduct =
        existingResult.rows[0];

      if (!existingProduct.is_active) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Restore the product from the Recycle Bin before editing it',
        });
      }

      oldImagePath =
        existingProduct.image_path || null;

      // ---------------------------------
      // 2. Check product SKU
      // ---------------------------------
      const skuCheck =
        await client.query(
          `
          SELECT id
          FROM products
          WHERE UPPER(sku) = UPPER($1)
            AND id <> $2
          LIMIT 1
          `,
          [
            normalizedSku,
            req.params.id,
          ]
        );

      if (skuCheck.rows.length > 0) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error:
            `Product SKU "${normalizedSku}" already exists`,
        });
      }

      // Also make sure product SKU does not
      // conflict with any variant SKU.
      const variantSkuCheck =
        await client.query(
          `
          SELECT id
          FROM product_variants
          WHERE UPPER(sku) = UPPER($1)
          LIMIT 1
          `,
          [normalizedSku]
        );

      if (
        variantSkuCheck.rows.length > 0
      ) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error:
            `SKU "${normalizedSku}" is already used by a variant`,
        });
      }

      // ---------------------------------
      // 3. Upload replacement image
      // ---------------------------------
      if (req.file) {
        newUploadedImage =
          await uploadProductImage(
            req.file,
            normalizedSku
          );
      }

      // If no new image was uploaded,
      // preserve existing image.
      const nextImageUrl =
        newUploadedImage?.imageUrl ??
        existingProduct.image_url ??
        null;

      const nextImagePath =
        newUploadedImage?.imagePath ??
        existingProduct.image_path ??
        null;

      // ---------------------------------
      // 4. Update product
      // ---------------------------------
      const result =
        await client.query(
          `
          UPDATE products

          SET
            sku = $1,
            name = $2,
            category_id = $3,
            price = $4,
            cost = $5,
            stock_quantity = $6,
            low_stock_threshold = $7,
            image_url = $8,
            image_path = $9,
            updated_at = NOW()

          WHERE id = $10

          RETURNING *
          `,
          [
            normalizedSku,
            name.trim(),

            category_id || null,

            price,

            cost || 0,

            stock_quantity || 0,

            low_stock_threshold ?? 5,

            nextImageUrl,
            nextImagePath,

            req.params.id,
          ]
        );

      await client.query('COMMIT');

      // ---------------------------------
      // 5. Move OLD image to trash
      // ---------------------------------
      // Only after DB commit succeeds.
      if (
        newUploadedImage &&
        oldImagePath &&
        oldImagePath !==
          newUploadedImage.imagePath
      ) {
        try {
          await trashProductImage(
            result.rows[0].id,
            oldImagePath
          );
        } catch (imageError) {
          console.error(
            'Product updated, but old image could not be moved to trash:',
            imageError
          );
        }
      }

      return res.json(
        result.rows[0]
      );
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback error
      }

      // DB failed after uploading a new image.
      // Remove that newly uploaded orphan file.
      if (
        newUploadedImage?.imagePath
      ) {
        try {
          await deleteProductImage(
            newUploadedImage.imagePath
          );
        } catch (cleanupError) {
          console.error(
            'Failed to clean up new image:',
            cleanupError
          );
        }
      }

      console.error(
        'Update product failed:',
        err
      );

      if (err.code === '23505') {
        return res.status(409).json({
          error:
            'A product with this SKU already exists',
        });
      }

      return res.status(500).json({
        error: 'Failed to update product',
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   PRODUCT VARIANTS
   ========================================================= */

/**
 * GET /api/products/:id/variants
 */
router.get(
  '/:id/variants',
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          pv.*,

          COALESCE(
            pv.price,
            p.price
          ) AS effective_price,

          COALESCE(
            pv.cost,
            p.cost
          ) AS effective_cost

        FROM product_variants pv

        JOIN products p
          ON p.id = pv.product_id

        WHERE pv.product_id = $1
          AND pv.is_active = TRUE
          AND p.is_active = TRUE

        ORDER BY pv.name
        `,
        [req.params.id]
      );

      res.json(result.rows);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

/**
 * POST /api/products/:id/variants
 */
router.post(
  '/:id/variants',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const {
      name,
      sku,
      price,
      cost,
      stock_quantity,
      low_stock_threshold,
    } = req.body;

    if (!name || !sku) {
      return res.status(400).json({
        error:
          'Variant name and SKU are required',
      });
    }

    const normalizedSku =
      cleanSku(sku);

    try {
      const productResult =
        await pool.query(
          `
          SELECT id
          FROM products
          WHERE id = $1
            AND is_active = TRUE
          `,
          [req.params.id]
        );

      if (
        productResult.rows.length === 0
      ) {
        return res.status(404).json({
          error: 'Product not found',
        });
      }

      if (
        await skuAlreadyExists(
          normalizedSku
        )
      ) {
        return res.status(409).json({
          error:
            `Variant SKU "${normalizedSku}" already exists`,
        });
      }

      const result = await pool.query(
        `
        INSERT INTO product_variants
        (
          product_id,
          name,
          sku,
          price,
          cost,
          stock_quantity,
          low_stock_threshold
        )

        VALUES
        ($1, $2, $3, $4, $5, $6, $7)

        RETURNING *
        `,
        [
          req.params.id,
          name.trim(),
          normalizedSku,

          price === '' ||
          price === undefined
            ? null
            : price,

          cost === '' ||
          cost === undefined
            ? null
            : cost,

          stock_quantity || 0,
          low_stock_threshold ?? 2,
        ]
      );

      return res
        .status(201)
        .json(result.rows[0]);
    } catch (err) {
      console.error(err);

      if (err.code === '23505') {
        return res.status(409).json({
          error:
            `Variant SKU "${normalizedSku}" already exists`,
        });
      }

      return res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

/**
 * PUT /api/products/:id/variants/:variantId
 */
router.put(
  '/:id/variants/:variantId',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const {
      name,
      sku,
      price,
      cost,
      stock_quantity,
      low_stock_threshold,
    } = req.body;

    try {
      /*
       * If SKU is changing, validate uniqueness.
       */
      let normalizedSku;

      if (sku !== undefined) {
        normalizedSku =
          cleanSku(sku);

        if (
          await skuAlreadyExists(
            normalizedSku,
            {
              ignoreVariantId:
                Number(
                  req.params.variantId
                ),
            }
          )
        ) {
          return res.status(409).json({
            error:
              'SKU already exists',
          });
        }
      }

      const result = await pool.query(
        `
        UPDATE product_variants

        SET
          name =
            COALESCE($1, name),

          sku =
            COALESCE($2, sku),

          price =
            COALESCE($3, price),

          cost =
            COALESCE($4, cost),

          stock_quantity =
            COALESCE(
              $5,
              stock_quantity
            ),

          low_stock_threshold =
            COALESCE(
              $6,
              low_stock_threshold
            ),

          updated_at = NOW()

        WHERE id = $7
          AND product_id = $8
          AND is_active = TRUE

        RETURNING *
        `,
        [
          name,
          normalizedSku,
          price,
          cost,
          stock_quantity,
          low_stock_threshold,
          req.params.variantId,
          req.params.id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Variant not found',
        });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

/**
 * DELETE /api/products/:id/variants/:variantId
 *
 * Soft delete variant.
 */
router.delete(
  '/:id/variants/:variantId',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE product_variants

        SET
          is_active = FALSE,
          updated_at = NOW()

        WHERE id = $1
          AND product_id = $2

        RETURNING id
        `,
        [
          req.params.variantId,
          req.params.id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Variant not found',
        });
      }

      res.json({
        message:
          'Variant deactivated',
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

/**
 * GET /api/products/:id/variants/:variantId/barcode
 *
 * Generate barcode for exact variant.
 */
router.get(
  '/:id/variants/:variantId/barcode',
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          pv.id,
          pv.product_id,
          pv.name AS variant_name,
          pv.sku,

          p.name AS product_name,

          COALESCE(
            pv.price,
            p.price
          ) AS price

        FROM product_variants pv

        JOIN products p
          ON p.id = pv.product_id

        WHERE pv.id = $1
          AND pv.product_id = $2
          AND pv.is_active = TRUE
          AND p.is_active = TRUE
        `,
        [
          req.params.variantId,
          req.params.id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Variant not found',
        });
      }

      const variant =
        result.rows[0];

      const barcode =
        await generateBarcodeDataUrl(
          variant.sku
        );

      res.json({
        id: variant.id,
        product_id:
          variant.product_id,

        product_name:
          variant.product_name,

        variant_name:
          variant.variant_name,

        sku: variant.sku,
        price: variant.price,

        barcode,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          'Failed to generate barcode',
      });
    }
  }
);

/* =========================================================
   DELETE PRODUCT
   ========================================================= */

/**
 * POST /api/products/:id/restore
 *
 * Restores only the parent product. Child variant activation states are never
 * changed, so independently inactive variants stay inactive.
 */
router.post('/:id/restore', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await revalidateCurrentProductAdmin(client, req.user.id, { lock: true });

    const productResult = await client.query(
      `
        SELECT id, sku, name, is_active, deleted_at, deleted_by
        FROM products
        WHERE id = $1
        FOR UPDATE
      `,
      [req.params.id]
    );

    if (productResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];
    if (product.is_active) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Product is already active' });
    }

    await assertProductCanBeRestored(client, product);

    const restored = await client.query(
      `
        UPDATE products
        SET is_active = TRUE, deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, sku, is_active, deleted_at, deleted_by, updated_at
      `,
      [product.id]
    );

    if (restored.rowCount !== 1) {
      throw new ProductRecycleBinError('Product restoration could not be completed', 409);
    }

    await client.query(
      `INSERT INTO audit_log (user_id, action, details)
       VALUES ($1, 'RESTORE_PRODUCT', $2)`,
      [req.user.id, `Restored product ${product.id} (${product.sku})`]
    );

    await client.query('COMMIT');
    return res.json({
      message: 'Product restored successfully.',
      product: restored.rows[0],
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failure.
    }

    if (err instanceof ProductRecycleBinError) {
      return res.status(err.statusCode).json({
        error: err.message,
      });
    }

    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Cannot restore product because its SKU conflicts with existing inventory',
      });
    }

    console.error('Product restore failed:', err);
    return res.status(500).json({ error: 'Failed to restore product' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/products/:id
 *
 * Soft delete product.
 *
 * IMPORTANT:
 * - Product row is preserved.
 * - Variant rows are preserved.
 * - Historical sale_items links are preserved.
 * - Product image is preserved.
 * - Refunds can still restore stock using the original IDs.
 */
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await revalidateCurrentProductAdmin(client, req.user.id, { lock: true });

      /*
       * Lock the product so two delete/update operations
       * cannot modify it at the same time.
       */
      const productResult =
        await client.query(
          `
            SELECT
              id,
              name,
              sku,
              is_active
            FROM products
            WHERE id = $1
            FOR UPDATE
          `,
          [req.params.id]
        );

      if (productResult.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Product not found',
        });
      }

      const product =
        productResult.rows[0];

      if (!product.is_active) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error: 'Product is already inactive',
        });
      }

      /*
       * Deactivate the parent product.
       *
       * We intentionally DO NOT:
       * - delete the product
       * - delete variants
       * - null sale_items.product_id
       * - null sale_items.variant_id
       * - delete the product image
       */
      const result =
        await client.query(
          `
            UPDATE products

            SET
              is_active = FALSE,
              deleted_at = NOW(),
              deleted_by = $2,
              updated_at = NOW()

            WHERE id = $1

            RETURNING
              id,
              name,
              sku,
              is_active,
              deleted_at,
              deleted_by,
              updated_at
          `,
          [req.params.id, req.user.id]
        );

      if (result.rowCount !== 1) {
        throw new ProductRecycleBinError('Product deactivation could not be completed', 409);
      }

      await client.query(
        `INSERT INTO audit_log (user_id, action, details)
         VALUES ($1, 'DEACTIVATE_PRODUCT', $2)`,
        [req.user.id, `Deactivated product ${product.id} (${product.sku})`]
      );

      await client.query('COMMIT');

      return res.json({
        message: 'Product deactivated successfully.',
        product: result.rows[0],
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failure
      }

      if (err instanceof ProductRecycleBinError) {
        return res.status(err.statusCode).json({ error: err.message });
      }

      console.error(
        'Product soft delete failed:',
        err
      );

      return res.status(500).json({
        error: 'Failed to delete product',
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
