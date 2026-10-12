const { normalizeManufacturerSerial } = require('./serial-number');
const { InventoryApiError, rejectUnknownFields } = require('./inventory-api-validation');

function normalizeWarrantyLookup(query = {}) {
  rejectUnknownFields(query, ['invoice_number', 'serial_number', 'internal_sku'], 'query');
  const provided = ['invoice_number', 'serial_number', 'internal_sku']
    .filter((field) => typeof query[field] === 'string' && query[field].trim() !== '');
  if (provided.length !== 1) {
    throw new InventoryApiError(
      'Provide exactly one of invoice_number, serial_number, or internal_sku'
    );
  }
  const field = provided[0];
  if (query[field].length > 500) throw new InventoryApiError(`${field} is too long`);
  return { field, value: query[field].trim() };
}

const WARRANTY_SELECT = `
  SELECT s.id AS sale_id, s.invoice_number, s.status AS sale_status,
         s.created_at AS purchase_date, s.warranty_months AS legacy_warranty_months,
         si.id AS sale_item_id, si.product_id, si.variant_id,
         si.product_name, si.variant_name,
         si.product_sku_snapshot, si.variant_sku_snapshot,
         si.shop_warranty_eligible, si.shop_warranty_months,
         si.shop_warranty_start_date::text AS shop_warranty_start_date,
         si.shop_warranty_end_date::text AS shop_warranty_end_date,
         sis.internal_sku_snapshot, sis.manufacturer_serial_number_snapshot,
         sis.assigned_at, sis.released_at, sis.release_reason,
         su.id AS stock_unit_id, su.internal_sku AS current_internal_sku,
         su.manufacturer_serial_number AS current_manufacturer_serial,
         su.state AS stock_unit_state
  FROM sales s
  JOIN sale_items si ON si.sale_id = s.id
  LEFT JOIN sale_item_stock_units sis ON sis.sale_item_id = si.id
  LEFT JOIN stock_units su ON su.id = sis.stock_unit_id
`;

async function lookupWarranty(queryable, query) {
  const lookup = normalizeWarrantyLookup(query);
  let result;
  if (lookup.field === 'invoice_number') {
    result = await queryable.query(
      `${WARRANTY_SELECT}
       WHERE UPPER(s.invoice_number) = UPPER($1)
       ORDER BY si.id, sis.id`,
      [lookup.value]
    );
  } else if (lookup.field === 'internal_sku') {
    result = await queryable.query(
      `${WARRANTY_SELECT}
       WHERE UPPER(su.internal_sku) = UPPER($1)
          OR UPPER(sis.internal_sku_snapshot) = UPPER($1)
       ORDER BY sis.assigned_at DESC, sis.id DESC`,
      [lookup.value]
    );
  } else {
    result = await queryable.query(
      `${WARRANTY_SELECT}
       WHERE su.normalized_serial_number = $1
          OR upper(regexp_replace(btrim(sis.manufacturer_serial_number_snapshot), '[^A-Za-z0-9]', '', 'g')) = $1
       ORDER BY sis.assigned_at DESC, sis.id DESC`,
      [normalizeManufacturerSerial(lookup.value)]
    );
  }
  if (result.rows.length === 0) {
    throw new InventoryApiError('Warranty record not found', 404, 'WARRANTY_NOT_FOUND');
  }
  return {
    lookup: { type: lookup.field, value: lookup.value },
    records: result.rows,
  };
}

module.exports = {
  normalizeWarrantyLookup,
  lookupWarranty,
};
