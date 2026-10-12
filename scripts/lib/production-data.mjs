export const MANIFEST_FORMAT_VERSION = 2;

// These are explicit historical-data contracts, not schema discovery. Additive
// feature columns must be added here before the application begins storing data
// in them. Optional columns support installations where a reviewed migration is
// still pending without weakening protection once that column exists.
export const PROTECTED_TABLE_COLUMNS = Object.freeze({
  audit_log: Object.freeze([
    'id', 'user_id', 'action', 'details', 'created_at',
  ]),
  categories: Object.freeze([
    'id', 'name',
  ]),
  customers: Object.freeze([
    'id', 'name', 'phone', 'email', 'address', 'notes', 'created_at', 'updated_at',
  ]),
  deleted_products: Object.freeze([
    'id', 'original_product_id', 'sku', 'name', 'category_id', 'price', 'cost',
    'stock_quantity', 'low_stock_threshold', 'image_url', 'image_path',
    'variants_snapshot', 'deleted_reason', 'deleted_notes', 'deleted_by', 'deleted_at',
  ]),
  notification_preferences: Object.freeze([
    'user_id', 'low_stock', 'daily_sales_summary', 'new_staff', 'refund_activity',
    'updated_at',
  ]),
  notifications: Object.freeze([
    'id', 'user_id', 'type', 'title', 'message', 'is_read', 'related_sale_id',
    'created_at',
  ]),
  product_variants: Object.freeze([
    'id', 'product_id', 'name', 'sku', 'price', 'cost', 'stock_quantity',
    'low_stock_threshold', 'is_active', 'created_at', 'updated_at',
  ]),
  products: Object.freeze([
    'id', 'sku', 'name', 'category_id', 'price', 'cost', 'stock_quantity',
    'low_stock_threshold', 'qr_code', 'is_active', 'created_at', 'updated_at',
    'image_url', 'image_path',
  ]),
  sale_items: Object.freeze([
    'id', 'sale_id', 'product_id', 'product_name', 'quantity', 'unit_price',
    'line_total', 'variant_id', 'variant_name', 'variant_sku', 'unit_cost',
  ]),
  sales: Object.freeze([
    'id', 'invoice_number', 'user_id', 'subtotal', 'tax', 'discount', 'total',
    'payment_method', 'status', 'created_at', 'refunded_at', 'voided_at',
    'customer_id', 'customer_name', 'customer_phone', 'customer_email',
    'customer_address', 'refund_reason', 'refunded_by', 'idempotency_key',
  ]),
  store_settings: Object.freeze([
    'id', 'store_name', 'phone', 'email', 'address', 'currency', 'tax_rate',
    'updated_at',
  ]),
  users: Object.freeze([
    'id', 'name', 'username', 'password_hash', 'role', 'created_at',
  ]),
});

export const PHASE2B_PROTECTED_COLUMNS = Object.freeze({
  product_variants: Object.freeze([
    'serial_tracking_enabled', 'shop_warranty_enabled', 'shop_warranty_months',
  ]),
  products: Object.freeze([
    'serial_tracking_enabled', 'shop_warranty_enabled', 'shop_warranty_months',
  ]),
  sale_items: Object.freeze([
    'shop_warranty_eligible', 'shop_warranty_months', 'shop_warranty_start_date',
    'shop_warranty_end_date', 'product_sku_snapshot', 'variant_sku_snapshot',
  ]),
  sales: Object.freeze(['checkout_contract_version']),
});

export const OPTIONAL_PROTECTED_COLUMNS = Object.freeze({
  product_variants: PHASE2B_PROTECTED_COLUMNS.product_variants,
  products: Object.freeze([
    'deleted_at', 'deleted_by', ...PHASE2B_PROTECTED_COLUMNS.products,
  ]),
  sale_items: PHASE2B_PROTECTED_COLUMNS.sale_items,
  sales: Object.freeze([
    'checkout_request_fingerprint', 'warranty_months',
    ...PHASE2B_PROTECTED_COLUMNS.sales,
  ]),
});

// These tables are absent before their reviewed additive migration. Once any
// one exists, its complete explicit contract and owned sequences are required.
export const ADDITIVE_PROTECTED_TABLE_COLUMNS = Object.freeze({
  stock_units: Object.freeze([
    'id', 'internal_sku', 'manufacturer_serial_number', 'normalized_serial_number',
    'product_id', 'variant_id', 'state', 'received_at', 'created_at', 'updated_at',
  ]),
  stock_unit_events: Object.freeze([
    'id', 'stock_unit_id', 'event_type', 'from_state', 'to_state', 'sale_id',
    'sale_item_id', 'actor_user_id', 'reason', 'metadata', 'occurred_at',
  ]),
  sale_item_stock_units: Object.freeze([
    'id', 'sale_item_id', 'stock_unit_id', 'internal_sku_snapshot',
    'manufacturer_serial_number_snapshot', 'assigned_at', 'released_at',
    'release_reason',
  ]),
});

export const ADDITIVE_PROTECTED_SEQUENCES = Object.freeze({
  stock_units: Object.freeze([
    'stock_units_id_seq', 'stock_unit_internal_sku_seq',
  ]),
  stock_unit_events: Object.freeze(['stock_unit_events_id_seq']),
  sale_item_stock_units: Object.freeze(['sale_item_stock_units_id_seq']),
});

export const PROTECTED_TABLES = Object.freeze(
  Object.keys(PROTECTED_TABLE_COLUMNS)
);

export const PROTECTED_SEQUENCES = Object.freeze([
  'audit_log_id_seq',
  'categories_id_seq',
  'customers_id_seq',
  'deleted_products_id_seq',
  'invoice_number_seq',
  'notifications_id_seq',
  'product_variants_id_seq',
  'products_id_seq',
  'sale_items_id_seq',
  'sales_id_seq',
  'users_id_seq',
]);

function identifier(name) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe database identifier: ${name}`);
  }
  return `"${name}"`;
}

async function relationExists(client, name) {
  const result = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [`public.${name}`]
  );
  return Boolean(result.rows[0]?.present);
}

async function tableColumnNames(client, table) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `,
    [table]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function validateProtectedShape(shape) {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
    throw new Error('Protected-data manifest shape is missing or invalid.');
  }
  if (!shape.tables || typeof shape.tables !== 'object' || Array.isArray(shape.tables)) {
    throw new Error('Protected-data manifest table shape is missing or invalid.');
  }
  if (!Array.isArray(shape.sequences)) {
    throw new Error('Protected-data manifest sequence shape is missing or invalid.');
  }
  for (const [table, columns] of Object.entries(shape.tables)) {
    identifier(table);
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new Error(`Protected-data columns are missing for public.${table}.`);
    }
    if (new Set(columns).size !== columns.length) {
      throw new Error(`Protected-data columns are duplicated for public.${table}.`);
    }
    for (const column of columns) identifier(column);
  }
  if (new Set(shape.sequences).size !== shape.sequences.length) {
    throw new Error('Protected-data sequence shape contains duplicates.');
  }
  for (const sequence of shape.sequences) identifier(sequence);
  return shape;
}

async function currentProtectedShape(client) {
  const tables = {};
  const availableColumns = {};
  for (const [table, requiredColumns] of Object.entries(PROTECTED_TABLE_COLUMNS)) {
    if (!(await relationExists(client, table))) {
      throw new Error(`Required table is missing: public.${table}`);
    }
    const available = await tableColumnNames(client, table);
    availableColumns[table] = available;
    const missing = requiredColumns.filter((column) => !available.has(column));
    if (missing.length > 0) {
      throw new Error(`Required protected columns are missing from public.${table}: ${missing.join(', ')}`);
    }
    const optional = (OPTIONAL_PROTECTED_COLUMNS[table] || [])
      .filter((column) => available.has(column));
    tables[table] = [...requiredColumns, ...optional];
  }
  const phase2BColumnSets = Object.entries(PHASE2B_PROTECTED_COLUMNS);
  const phase2BColumnPresent = phase2BColumnSets.some(([table, columns]) =>
    columns.some((column) => availableColumns[table].has(column))
  );
  const phase2BColumnsComplete = phase2BColumnSets.every(([table, columns]) =>
    columns.every((column) => availableColumns[table].has(column))
  );
  const sequences = [...PROTECTED_SEQUENCES];
  let additiveTableCount = 0;
  for (const [table, columns] of Object.entries(ADDITIVE_PROTECTED_TABLE_COLUMNS)) {
    const tablePresent = await relationExists(client, table);
    const tableSequences = ADDITIVE_PROTECTED_SEQUENCES[table] || [];
    const sequencePresence = await Promise.all(
      tableSequences.map((sequence) => relationExists(client, sequence))
    );
    if (!tablePresent) {
      if (sequencePresence.some(Boolean)) {
        throw new Error(`Protected additive schema is incomplete for public.${table}.`);
      }
      continue;
    }
    if (sequencePresence.some((present) => !present)) {
      throw new Error(`Protected additive sequences are missing for public.${table}.`);
    }
    const available = await tableColumnNames(client, table);
    const missing = columns.filter((column) => !available.has(column));
    if (missing.length > 0) {
      throw new Error(`Protected additive columns are missing from public.${table}: ${missing.join(', ')}`);
    }
    tables[table] = [...columns];
    sequences.push(...tableSequences);
    additiveTableCount += 1;
  }
  if (
    (phase2BColumnPresent || additiveTableCount > 0)
    && (!phase2BColumnsComplete
      || additiveTableCount !== Object.keys(ADDITIVE_PROTECTED_TABLE_COLUMNS).length)
  ) {
    throw new Error('Protected Phase 2B schema is incomplete.');
  }
  return validateProtectedShape({
    tables,
    sequences,
  });
}

export async function assertPhase2BMigrationInitialState(client) {
  for (const [table, columns] of Object.entries(ADDITIVE_PROTECTED_TABLE_COLUMNS)) {
    if (!(await relationExists(client, table))) {
      throw new Error(`Phase 2B table is missing: public.${table}`);
    }
    const available = await tableColumnNames(client, table);
    const missing = columns.filter((column) => !available.has(column));
    if (missing.length > 0) {
      throw new Error(`Phase 2B columns are missing from public.${table}: ${missing.join(', ')}`);
    }
    const count = await client.query(
      `SELECT COUNT(*)::text AS count FROM public.${identifier(table)}`
    );
    if (count.rows[0]?.count !== '0') {
      throw new Error(`Phase 2B migration unexpectedly populated public.${table}.`);
    }
  }
  for (const sequences of Object.values(ADDITIVE_PROTECTED_SEQUENCES)) {
    for (const sequence of sequences) {
      if (!(await relationExists(client, sequence))) {
        throw new Error(`Phase 2B sequence is missing: public.${sequence}`);
      }
      const state = await client.query(
        `SELECT last_value::text AS last_value, is_called FROM public.${identifier(sequence)}`
      );
      if (state.rows[0]?.last_value !== '1' || state.rows[0]?.is_called !== false) {
        throw new Error(`Phase 2B migration unexpectedly advanced public.${sequence}.`);
      }
    }
  }
}

async function assertShapeExists(client, shape) {
  validateProtectedShape(shape);
  for (const [table, columns] of Object.entries(shape.tables)) {
    if (!(await relationExists(client, table))) {
      throw new Error(`Required table is missing: public.${table}`);
    }
    const available = await tableColumnNames(client, table);
    const missing = columns.filter((column) => !available.has(column));
    if (missing.length > 0) {
      throw new Error(`Protected columns are missing from public.${table}: ${missing.join(', ')}`);
    }
  }
}

async function digestExplicitTable(client, table, columns) {
  const projection = columns.map(identifier).join(', ');
  const result = await client.query(`
    SELECT
      COUNT(*)::text AS count,
      md5(COALESCE(string_agg(canonical, E'\\n' ORDER BY canonical), '')) AS digest
    FROM (
      SELECT to_jsonb(protected_row)::text AS canonical
      FROM (
        SELECT ${projection}
        FROM public.${identifier(table)}
      ) AS protected_row
    ) AS protected_rows
  `);
  return result.rows[0];
}

async function digestLegacyTable(client, table) {
  if (!(await relationExists(client, table))) {
    throw new Error(`Required table is missing: public.${table}`);
  }
  const expression = table === 'sales'
    ? `(to_jsonb(row_data) - 'warranty_months')::text`
    : 'to_jsonb(row_data)::text';
  const result = await client.query(`
    SELECT
      COUNT(*)::text AS count,
      md5(COALESCE(string_agg(canonical, E'\\n' ORDER BY canonical), '')) AS digest
    FROM (
      SELECT ${expression} AS canonical
      FROM public.${identifier(table)} AS row_data
    ) AS protected_rows
  `);
  return result.rows[0];
}

async function digestQuery(client, sql) {
  const result = await client.query(`
    SELECT
      COUNT(*)::text AS count,
      md5(COALESCE(string_agg(canonical, E'\\n' ORDER BY canonical), '')) AS digest
    FROM (${sql}) AS protected_rows
  `);
  return result.rows[0];
}

function comparisonMode(comparisonManifest) {
  if (!comparisonManifest) return { formatVersion: MANIFEST_FORMAT_VERSION };
  if (comparisonManifest.formatVersion === 1) return { formatVersion: 1 };
  if (comparisonManifest.formatVersion === MANIFEST_FORMAT_VERSION) {
    return {
      formatVersion: MANIFEST_FORMAT_VERSION,
      protectedShape: validateProtectedShape(comparisonManifest.protectedShape),
    };
  }
  throw new Error(`Unsupported protected-data manifest format: ${comparisonManifest.formatVersion}`);
}

export async function captureProductionDataManifest(
  client,
  { comparisonManifest = null } = {}
) {
  const mode = comparisonMode(comparisonManifest);
  const identityResult = await client.query(`
    SELECT current_database() AS database, version() AS server_version
  `);

  const protectedShape = mode.formatVersion === 1
    ? null
    : mode.protectedShape || await currentProtectedShape(client);
  if (protectedShape) await assertShapeExists(client, protectedShape);

  const tables = {};
  if (mode.formatVersion === 1) {
    for (const table of PROTECTED_TABLES) {
      tables[table] = await digestLegacyTable(client, table);
    }
  } else {
    for (const [table, columns] of Object.entries(protectedShape.tables)) {
      tables[table] = await digestExplicitTable(client, table, columns);
    }
  }

  const sequenceNames = mode.formatVersion === 1
    ? PROTECTED_SEQUENCES
    : protectedShape.sequences;
  const sequences = {};
  for (const sequence of sequenceNames) {
    if (!(await relationExists(client, sequence))) {
      throw new Error(`Required sequence is missing: public.${sequence}`);
    }
    const result = await client.query(
      `SELECT last_value::text AS last_value, is_called FROM public.${identifier(sequence)}`
    );
    sequences[sequence] = result.rows[0];
  }

  const inventory = await digestQuery(client, `
    SELECT concat_ws(':', 'product', id, stock_quantity) AS canonical
    FROM public.products
    UNION ALL
    SELECT concat_ws(':', 'variant', id, stock_quantity) AS canonical
    FROM public.product_variants
  `);

  const invoices = await digestQuery(client, `
    SELECT concat_ws(':', id, invoice_number, subtotal, discount, tax, total,
      payment_method, status, created_at) AS canonical
    FROM public.sales
  `);

  const imageResult = await client.query(`
    SELECT id::text AS product_id, image_path
    FROM public.products
    WHERE image_path IS NOT NULL
    ORDER BY id
  `);

  return {
    formatVersion: mode.formatVersion,
    ...(protectedShape ? { protectedShape } : {}),
    capturedAt: new Date().toISOString(),
    identity: identityResult.rows[0],
    tables,
    sequences,
    inventory,
    invoices,
    imageReferences: imageResult.rows,
  };
}
