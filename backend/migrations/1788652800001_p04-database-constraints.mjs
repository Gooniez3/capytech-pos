// P0.4: production data-integrity constraints. No data repair is performed here.
// The preflight audit confirmed current pos_store data satisfies these rules.

export const CONSTRAINT_NAMES = Object.freeze([
  'products_price_nonnegative_chk',
  'products_cost_nonnegative_chk',
  'products_stock_quantity_nonnegative_chk',
  'products_low_stock_threshold_nonnegative_chk',
  'product_variants_price_nonnegative_chk',
  'product_variants_cost_nonnegative_chk',
  'product_variants_stock_quantity_nonnegative_chk',
  'product_variants_low_stock_threshold_nonnegative_chk',
  'sales_status_valid_chk',
  'sales_payment_method_valid_chk',
  'sales_amounts_nonnegative_chk',
  'sales_discount_within_subtotal_tax_chk',
  'sales_total_matches_components_chk',
  'sale_items_quantity_positive_chk',
  'sale_items_unit_price_nonnegative_chk',
  'sale_items_unit_cost_nonnegative_chk',
  'sale_items_line_total_nonnegative_chk',
  'sale_items_line_total_matches_quantity_price_chk',
  'store_settings_tax_rate_range_chk',
]);

export const UP_SQL = String.raw`
ALTER TABLE public.products
  ADD CONSTRAINT products_price_nonnegative_chk CHECK (price >= 0),
  ADD CONSTRAINT products_cost_nonnegative_chk CHECK (cost IS NULL OR cost >= 0),
  ADD CONSTRAINT products_stock_quantity_nonnegative_chk CHECK (stock_quantity >= 0),
  ADD CONSTRAINT products_low_stock_threshold_nonnegative_chk CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0),
  ALTER COLUMN is_active SET NOT NULL;

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_price_nonnegative_chk CHECK (price IS NULL OR price >= 0),
  ADD CONSTRAINT product_variants_cost_nonnegative_chk CHECK (cost IS NULL OR cost >= 0),
  ADD CONSTRAINT product_variants_stock_quantity_nonnegative_chk CHECK (stock_quantity >= 0),
  ADD CONSTRAINT product_variants_low_stock_threshold_nonnegative_chk CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0),
  ALTER COLUMN is_active SET NOT NULL;

ALTER TABLE public.sales
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN payment_method SET NOT NULL,
  ALTER COLUMN tax SET NOT NULL,
  ALTER COLUMN discount SET NOT NULL,
  ADD CONSTRAINT sales_status_valid_chk CHECK (status IN ('completed', 'voided', 'refunded')),
  ADD CONSTRAINT sales_payment_method_valid_chk CHECK (payment_method IN ('cash', 'banking', 'kbzpay', 'wavepay', 'mmqr')),
  ADD CONSTRAINT sales_amounts_nonnegative_chk CHECK (subtotal >= 0 AND tax >= 0 AND discount >= 0 AND total >= 0),
  ADD CONSTRAINT sales_discount_within_subtotal_tax_chk CHECK (discount <= subtotal + tax),
  ADD CONSTRAINT sales_total_matches_components_chk CHECK (total = subtotal + tax - discount);

ALTER TABLE public.sale_items
  ALTER COLUMN sale_id SET NOT NULL,
  ADD CONSTRAINT sale_items_quantity_positive_chk CHECK (quantity > 0),
  ADD CONSTRAINT sale_items_unit_price_nonnegative_chk CHECK (unit_price >= 0),
  ADD CONSTRAINT sale_items_unit_cost_nonnegative_chk CHECK (unit_cost >= 0),
  ADD CONSTRAINT sale_items_line_total_nonnegative_chk CHECK (line_total >= 0),
  ADD CONSTRAINT sale_items_line_total_matches_quantity_price_chk CHECK (line_total = quantity * unit_price);

ALTER TABLE public.store_settings
  ADD CONSTRAINT store_settings_tax_rate_range_chk CHECK (tax_rate >= 0 AND tax_rate <= 100);
`;

export const DOWN_SQL = String.raw`
ALTER TABLE public.store_settings
  DROP CONSTRAINT store_settings_tax_rate_range_chk;

ALTER TABLE public.sale_items
  DROP CONSTRAINT sale_items_quantity_positive_chk,
  DROP CONSTRAINT sale_items_unit_price_nonnegative_chk,
  DROP CONSTRAINT sale_items_unit_cost_nonnegative_chk,
  DROP CONSTRAINT sale_items_line_total_nonnegative_chk,
  DROP CONSTRAINT sale_items_line_total_matches_quantity_price_chk,
  ALTER COLUMN sale_id DROP NOT NULL;

ALTER TABLE public.sales
  DROP CONSTRAINT sales_status_valid_chk,
  DROP CONSTRAINT sales_payment_method_valid_chk,
  DROP CONSTRAINT sales_amounts_nonnegative_chk,
  DROP CONSTRAINT sales_discount_within_subtotal_tax_chk,
  DROP CONSTRAINT sales_total_matches_components_chk,
  ALTER COLUMN status DROP NOT NULL,
  ALTER COLUMN payment_method DROP NOT NULL,
  ALTER COLUMN tax DROP NOT NULL,
  ALTER COLUMN discount DROP NOT NULL;

ALTER TABLE public.product_variants
  DROP CONSTRAINT product_variants_price_nonnegative_chk,
  DROP CONSTRAINT product_variants_cost_nonnegative_chk,
  DROP CONSTRAINT product_variants_stock_quantity_nonnegative_chk,
  DROP CONSTRAINT product_variants_low_stock_threshold_nonnegative_chk,
  ALTER COLUMN is_active DROP NOT NULL;

ALTER TABLE public.products
  DROP CONSTRAINT products_price_nonnegative_chk,
  DROP CONSTRAINT products_cost_nonnegative_chk,
  DROP CONSTRAINT products_stock_quantity_nonnegative_chk,
  DROP CONSTRAINT products_low_stock_threshold_nonnegative_chk,
  ALTER COLUMN is_active DROP NOT NULL;
`;

export function up(pgm) {
  pgm.sql(UP_SQL);
}

export function down(pgm) {
  pgm.sql(DOWN_SQL);
}
