const { transactionClient, withTransactionOperation } = require('./domain-transaction');
const { revalidateCurrentAdmin } = require('./sale-reversal');
const { applyQuantityMovements } = require('./quantity-inventory-service');
const { registerReceivedUnits } = require('./stock-unit-service');
const { updateInventoryPolicy } = require('./inventory-policy-service');
const { prepareUniqueSerialBatch } = require('./serial-number');
const { allocateCatalogCode, rejectClientCatalogCode } = require('./catalog-code-service');

class ProductWorkflowError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_PRODUCT_WORKFLOW') {
    super(message);
    this.name = 'ProductWorkflowError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sku(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized || normalized.length > 100 || normalized.startsWith('SU-')) {
    throw new ProductWorkflowError(`${label} is invalid`);
  }
  return normalized;
}

function requiredText(value, label, maximum = 255) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximum) {
    throw new ProductWorkflowError(`${label} is required and must be ${maximum} characters or less`);
  }
  return normalized;
}

function money(value, label, { positive = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0)) {
    throw new ProductWorkflowError(`${label} is invalid`);
  }
  return number;
}

function nonnegativeInteger(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ProductWorkflowError(`${label} must be a non-negative integer`);
  }
  return number;
}

function nullableId(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new ProductWorkflowError(`${label} is invalid`);
  return number;
}

function serialSetting(value, { variant = false } = {}) {
  if (variant && (value === null || value === undefined || value === 'inherit')) return null;
  if (value === true || value === false) return value;
  throw new ProductWorkflowError('serial_tracking_enabled must be boolean or inherit');
}

function normalizeSerials(values, expected, label, tracked) {
  const serials = Array.isArray(values) ? values : [];
  if (!tracked) {
    if (serials.length) throw new ProductWorkflowError(`${label} cannot include serial numbers when tracking is disabled`);
    return [];
  }
  if (serials.length !== expected) {
    throw new ProductWorkflowError(`${label} requires exactly ${expected} unique serial numbers`);
  }
  if (expected === 0) return [];
  return prepareUniqueSerialBatch(serials).map((entry) => entry.original);
}

function normalizeWorkflow(raw, { edit = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProductWorkflowError('workflow is required');
  const allowed = new Set([
    'name', 'sku', 'category_id', 'price', 'cost', 'opening_quantity',
    'low_stock_threshold', 'serial_tracking_enabled', 'serial_numbers',
    'variants', 'removed_variant_ids', 'product_code',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new ProductWorkflowError(`Unknown workflow field: ${key}`);
  }
  rejectClientCatalogCode(raw.product_code);
  const productSerial = serialSetting(raw.serial_tracking_enabled ?? false);
  const variants = Array.isArray(raw.variants) ? raw.variants : [];
  const normalizedVariants = variants.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ProductWorkflowError(`Variant ${index + 1} is invalid`);
    }
    const variantAllowed = new Set([
      'id', 'name', 'sku', 'price', 'cost', 'opening_quantity',
      'low_stock_threshold', 'serial_tracking_enabled', 'serial_numbers', 'product_code',
    ]);
    for (const key of Object.keys(entry)) {
      if (!variantAllowed.has(key)) throw new ProductWorkflowError(`Unknown variant field: ${key}`);
    }
    rejectClientCatalogCode(entry.product_code);
    const setting = serialSetting(entry.serial_tracking_enabled, { variant: true });
    const tracked = setting ?? productSerial;
    const openingQuantity = edit ? 0 : nonnegativeInteger(entry.opening_quantity, `Variant ${index + 1} opening quantity`);
    return {
      id: edit ? nullableId(entry.id, `Variant ${index + 1} id`) : null,
      name: requiredText(entry.name, `Variant ${index + 1} name`),
      legacySku: entry.sku === undefined || entry.sku === '' ? null : sku(entry.sku, `Variant ${index + 1} SKU`),
      price: money(entry.price, `Variant ${index + 1} selling price`, { positive: true }),
      cost: money(entry.cost ?? 0, `Variant ${index + 1} cost price`),
      lowStockThreshold: nonnegativeInteger(entry.low_stock_threshold ?? 2, `Variant ${index + 1} reorder level`),
      serialTrackingEnabled: setting,
      openingQuantity,
      serialNumbers: edit ? [] : normalizeSerials(entry.serial_numbers, openingQuantity, `Variant ${index + 1}`, tracked),
    };
  });
  const productSku = raw.sku === undefined || raw.sku === '' ? null : sku(raw.sku, 'Product SKU');
  const openingQuantity = edit || normalizedVariants.length ? 0 : nonnegativeInteger(raw.opening_quantity, 'Opening quantity');
  return {
    name: requiredText(raw.name, 'Product name'), legacySku: productSku,
    categoryId: nullableId(raw.category_id, 'Category'),
    price: money(raw.price, 'Selling price', { positive: true }),
    cost: money(raw.cost ?? 0, 'Cost price'),
    lowStockThreshold: nonnegativeInteger(raw.low_stock_threshold ?? 5, 'Reorder level'),
    serialTrackingEnabled: productSerial,
    openingQuantity,
    serialNumbers: edit || normalizedVariants.length ? [] : normalizeSerials(raw.serial_numbers, openingQuantity, 'Product', productSerial),
    variants: normalizedVariants,
    removedVariantIds: edit
      ? [...new Set((raw.removed_variant_ids || []).map((id) => nullableId(id, 'Removed variant id')))]
      : [],
  };
}

async function lockSkus(client, values) {
  for (const value of [...values].sort()) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`product-sku:${value}`]);
  }
}

async function assertSkusAvailable(client, values, { productId = null, variantIds = [] } = {}) {
  await lockSkus(client, values);
  const result = await client.query(`
    SELECT sku FROM products WHERE UPPER(sku)=ANY($1::text[]) AND ($2::integer IS NULL OR id<>$2)
    UNION ALL
    SELECT sku FROM product_variants WHERE UPPER(sku)=ANY($1::text[]) AND NOT (id=ANY($3::integer[]))
  `, [values, productId, variantIds]);
  if (result.rowCount) throw new ProductWorkflowError(`SKU "${result.rows[0].sku}" already exists`, 409, 'DUPLICATE_SKU');
}

async function createProductWorkflowOperation(transaction, input) {
  const client = transactionClient(transaction);
  const workflow = normalizeWorkflow(input.workflow);
  await revalidateCurrentAdmin(client, input.actorUserId);
  const productCode = await allocateCatalogCode(client);
  const variantCodes = [];
  for (let index = 0; index < workflow.variants.length; index += 1) variantCodes.push(await allocateCatalogCode(client));
  await assertSkusAvailable(client, [productCode, ...variantCodes]);
  const productResult = await client.query(`
    INSERT INTO products
      (sku,product_code,name,category_id,price,cost,stock_quantity,low_stock_threshold,image_url,image_path,serial_tracking_enabled)
    VALUES ($1,$1,$2,$3,$4,$5,0,$6,$7,$8,$9) RETURNING *
  `, [productCode, workflow.name, workflow.categoryId, workflow.price, workflow.cost,
    workflow.lowStockThreshold, input.imageUrl || null, input.imagePath || null, workflow.serialTrackingEnabled]);
  const product = productResult.rows[0];
  const variants = [];
  for (const [index, item] of workflow.variants.entries()) {
    const variantCode = variantCodes[index];
    const result = await client.query(`
      INSERT INTO product_variants
        (product_id,name,sku,product_code,price,cost,stock_quantity,low_stock_threshold,serial_tracking_enabled)
      VALUES ($1,$2,$3,$3,$4,$5,0,$6,$7) RETURNING *
    `, [product.id, item.name, variantCode, item.price, item.cost, item.lowStockThreshold, item.serialTrackingEnabled]);
    variants.push({ row: result.rows[0], input: item });
  }
  const targets = variants.length
    ? variants.map(({ row, input: item }) => ({ productId: product.id, variantId: row.id, input: item,
      tracked: item.serialTrackingEnabled ?? workflow.serialTrackingEnabled }))
    : [{ productId: product.id, variantId: null, input: workflow, tracked: workflow.serialTrackingEnabled }];
  const quantityMovements = targets.filter((target) => !target.tracked && target.input.openingQuantity > 0)
    .map((target) => ({ productId: target.productId, variantId: target.variantId,
      movementType: 'opening', quantityChange: target.input.openingQuantity,
      reason: 'Opening stock entered during product creation', sourceReference: `product:${product.id}` }));
  if (quantityMovements.length) await applyQuantityMovements(transaction, { actorUserId: input.actorUserId, movements: quantityMovements });
  const serialBatches = targets.filter((target) => target.tracked && target.input.openingQuantity > 0)
    .map((target) => ({ productId: target.productId, variantId: target.variantId, serialNumbers: target.input.serialNumbers }));
  if (serialBatches.length) await registerReceivedUnits(transaction, { actorUserId: input.actorUserId, batches: serialBatches });
  await client.query(`INSERT INTO audit_log(user_id,action,details) VALUES($1,'CREATE_PRODUCT_WORKFLOW',$2)`, [
    input.actorUserId, JSON.stringify({ productId: Number(product.id), variantIds: variants.map(({ row }) => Number(row.id)),
      openingQuantity: targets.reduce((sum, target) => sum + target.input.openingQuantity, 0) }),
  ]);
  return { product, variants: variants.map(({ row }) => row) };
}

async function editProductWorkflowOperation(transaction, input) {
  const client = transactionClient(transaction);
  const workflow = normalizeWorkflow(input.workflow, { edit: true });
  await revalidateCurrentAdmin(client, input.actorUserId);
  const locked = await client.query(`SELECT * FROM products WHERE id=$1 AND is_active=TRUE FOR UPDATE`, [input.productId]);
  const product = locked.rows[0];
  if (!product) throw new ProductWorkflowError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  const existingResult = await client.query(`SELECT * FROM product_variants WHERE product_id=$1 AND is_active=TRUE ORDER BY id FOR UPDATE`, [product.id]);
  const existing = new Map(existingResult.rows.map((row) => [Number(row.id), row]));
  const retainedIds = workflow.variants.filter((item) => item.id !== null).map((item) => item.id);
  for (const id of retainedIds) if (!existing.has(id)) throw new ProductWorkflowError(`Variant ${id} does not belong to this product`, 409);
  for (const id of workflow.removedVariantIds) {
    if (!existing.has(id) || retainedIds.includes(id)) throw new ProductWorkflowError(`Removed variant ${id} is invalid`, 409);
    const references = await client.query(`
      SELECT
        EXISTS(SELECT 1 FROM sale_items WHERE variant_id=$1) AS sales,
        EXISTS(SELECT 1 FROM stock_units WHERE variant_id=$1) AS units
    `, [id]);
    if (references.rows[0].sales || references.rows[0].units || Number(existing.get(id).stock_quantity) !== 0) {
      throw new ProductWorkflowError('A variant with stock, sales, stock units, or warranty snapshots cannot be removed', 409, 'VARIANT_REFERENCED');
    }
  }
  const updatedProduct = (await client.query(`
    UPDATE products SET name=$1,category_id=$2,price=$3,cost=$4,low_stock_threshold=$5,
      image_url=COALESCE($6,image_url),image_path=COALESCE($7,image_path),updated_at=NOW()
    WHERE id=$8 RETURNING *
  `, [workflow.name, workflow.categoryId, workflow.price, workflow.cost,
    workflow.lowStockThreshold, input.imageUrl, input.imagePath, product.id])).rows[0];
  const outputVariants = [];
  for (const item of workflow.variants) {
    if (item.id === null) {
      const variantCode = await allocateCatalogCode(client);
      await assertSkusAvailable(client, [variantCode]);
      const row = (await client.query(`
        INSERT INTO product_variants(product_id,name,sku,product_code,price,cost,stock_quantity,low_stock_threshold,serial_tracking_enabled)
        VALUES($1,$2,$3,$3,$4,$5,0,$6,$7) RETURNING *
      `, [product.id, item.name, variantCode, item.price, item.cost, item.lowStockThreshold, item.serialTrackingEnabled])).rows[0];
      outputVariants.push(row);
    } else {
      const row = (await client.query(`
        UPDATE product_variants SET name=$1,price=$2,cost=$3,low_stock_threshold=$4,updated_at=NOW()
        WHERE id=$5 AND product_id=$6 RETURNING *
      `, [item.name, item.price, item.cost, item.lowStockThreshold, item.id, product.id])).rows[0];
      outputVariants.push(row);
    }
  }
  if (workflow.removedVariantIds.length) await client.query(`UPDATE product_variants SET is_active=FALSE,updated_at=NOW() WHERE id=ANY($1::integer[])`, [workflow.removedVariantIds]);
  // Apply explicit existing-variant overrides before the product default so a
  // single edit can safely exempt a variant from a new inherited policy.
  for (const item of workflow.variants.filter((entry) => entry.id !== null)) {
    const before = existing.get(item.id);
    if (item.serialTrackingEnabled !== before.serial_tracking_enabled) {
      await updateInventoryPolicy(transaction, { actorUserId: input.actorUserId, productId: product.id, variantId: item.id,
        body: { serial_tracking_enabled: item.serialTrackingEnabled } });
    }
  }
  if (workflow.serialTrackingEnabled !== product.serial_tracking_enabled) {
    await updateInventoryPolicy(transaction, { actorUserId: input.actorUserId, productId: product.id,
      body: { serial_tracking_enabled: workflow.serialTrackingEnabled } });
  }
  await client.query(`INSERT INTO audit_log(user_id,action,details) VALUES($1,'UPDATE_PRODUCT_WORKFLOW',$2)`, [
    input.actorUserId, JSON.stringify({ productId: Number(product.id), retainedVariantIds: retainedIds,
      addedVariantIds: outputVariants.filter((row) => !retainedIds.includes(Number(row.id))).map((row) => Number(row.id)),
      removedVariantIds: workflow.removedVariantIds }),
  ]);
  return { product: updatedProduct, variants: outputVariants, previousImagePath: product.image_path || null };
}

function createProductWorkflow(transaction, input) {
  return withTransactionOperation(transaction, 'create_product', () => createProductWorkflowOperation(transaction, input));
}
function editProductWorkflow(transaction, input) {
  return withTransactionOperation(transaction, 'edit_product', () => editProductWorkflowOperation(transaction, input));
}

module.exports = { ProductWorkflowError, createProductWorkflow, editProductWorkflow, normalizeWorkflow };
