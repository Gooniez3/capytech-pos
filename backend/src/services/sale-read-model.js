async function loadSaleItemsWithStockUnits(queryable, saleId) {
  const itemsResult = await queryable.query(
    `
      SELECT id, sale_id, product_id, variant_id, product_name, variant_name,
             variant_sku, quantity, unit_cost, unit_price, line_total,
             shop_warranty_eligible, shop_warranty_months,
             shop_warranty_start_date::text AS shop_warranty_start_date,
             shop_warranty_end_date::text AS shop_warranty_end_date,
             product_sku_snapshot, variant_sku_snapshot,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'sale_item_id', sis.sale_item_id,
                 'stock_unit_id', sis.stock_unit_id,
                 'internal_sku_snapshot', sis.internal_sku_snapshot,
                 'manufacturer_serial_number_snapshot', sis.manufacturer_serial_number_snapshot,
                 'assigned_at', sis.assigned_at,
                 'released_at', sis.released_at,
                 'release_reason', sis.release_reason,
                 'current_state', su.state
               ) ORDER BY sis.id)
               FROM sale_item_stock_units sis
               LEFT JOIN stock_units su ON su.id = sis.stock_unit_id
               WHERE sis.sale_item_id = sale_items.id
             ), '[]'::json) AS stock_units
      FROM sale_items
      WHERE sale_id = $1
      ORDER BY id
    `,
    [saleId]
  );
  return itemsResult.rows.map((item) => ({ ...item, stock_units: item.stock_units || [] }));
}

module.exports = { loadSaleItemsWithStockUnits };
