export const PROTECTED_TABLES = Object.freeze([
  'audit_log',
  'categories',
  'customers',
  'deleted_products',
  'notification_preferences',
  'notifications',
  'product_variants',
  'products',
  'sale_items',
  'sales',
  'store_settings',
  'users',
]);

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

async function relationExists(client, kind, name) {
  const result = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [`public.${name}`]
  );
  return Boolean(result.rows[0]?.present);
}

async function digestTable(client, table) {
  if (!(await relationExists(client, 'table', table))) {
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

export async function captureProductionDataManifest(client) {
  const identityResult = await client.query(`
    SELECT current_database() AS database, version() AS server_version
  `);

  const tables = {};
  for (const table of PROTECTED_TABLES) {
    tables[table] = await digestTable(client, table);
  }

  const sequences = {};
  for (const sequence of PROTECTED_SEQUENCES) {
    if (!(await relationExists(client, 'sequence', sequence))) {
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
    formatVersion: 1,
    capturedAt: new Date().toISOString(),
    identity: identityResult.rows[0],
    tables,
    sequences,
    inventory,
    invoices,
    imageReferences: imageResult.rows,
  };
}
