export const MIGRATION_NAME = '1792022400000_fix01-stock-unit-barcode-codes';
export const NEW_SEQUENCES = Object.freeze(['stock_unit_code_seq']);

export const UP_SQL = `
DO $block$
DECLARE
  collision text;
BEGIN
  SELECT identifier INTO collision
  FROM (
    SELECT 'product SKU ' || quote_literal(sku) AS identifier
    FROM public.products
    WHERE UPPER(BTRIM(sku)) ~ '^CT[0-9]{6,}$'
    UNION ALL
    SELECT 'variant SKU ' || quote_literal(sku)
    FROM public.product_variants
    WHERE UPPER(BTRIM(sku)) ~ '^CT[0-9]{6,}$'
    UNION ALL
    SELECT 'manufacturer serial ' || quote_literal(manufacturer_serial_number)
    FROM public.stock_units
    WHERE normalized_serial_number ~ '^CT[0-9]{6,}$'
  ) collisions
  ORDER BY identifier
  LIMIT 1;

  IF collision IS NOT NULL THEN
    RAISE EXCEPTION 'CT stock-unit barcode namespace collision: %', collision;
  END IF;
END;
$block$;

CREATE SEQUENCE public.stock_unit_code_seq AS bigint;

CREATE FUNCTION public.format_stock_unit_code(value bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $function$
  SELECT 'CT' || lpad(value::text, GREATEST(6, length(value::text)), '0')
$function$;

ALTER TABLE public.stock_units
  ADD COLUMN unit_code character varying(32)
  DEFAULT public.format_stock_unit_code(nextval('public.stock_unit_code_seq'::regclass));

UPDATE public.stock_units
SET unit_code = DEFAULT
WHERE unit_code IS NULL;

ALTER TABLE public.stock_units
  ALTER COLUMN unit_code SET NOT NULL,
  ADD CONSTRAINT stock_units_unit_code_key UNIQUE (unit_code),
  ADD CONSTRAINT stock_units_unit_code_namespace_chk
    CHECK (unit_code ~ '^CT[0-9]{6,}$');

ALTER SEQUENCE public.stock_unit_code_seq OWNED BY public.stock_units.unit_code;

ALTER TABLE public.products
  ADD CONSTRAINT products_sku_ct_namespace_chk
    CHECK (UPPER(BTRIM(sku)) !~ '^CT[0-9]{6,}$');

ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_sku_ct_namespace_chk
    CHECK (UPPER(BTRIM(sku)) !~ '^CT[0-9]{6,}$');

ALTER TABLE public.stock_units
  ADD CONSTRAINT stock_units_serial_ct_namespace_chk
    CHECK (normalized_serial_number !~ '^CT[0-9]{6,}$');

CREATE OR REPLACE FUNCTION public.reject_stock_unit_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock units must be retired, not deleted';
  END IF;
  IF NEW.internal_sku IS DISTINCT FROM OLD.internal_sku
    OR NEW.unit_code IS DISTINCT FROM OLD.unit_code
    OR NEW.manufacturer_serial_number IS DISTINCT FROM OLD.manufacturer_serial_number
    OR NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.variant_id IS DISTINCT FROM OLD.variant_id THEN
    RAISE EXCEPTION 'stock unit identity is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER stock_units_identity_immutable_trg ON public.stock_units;
CREATE TRIGGER stock_units_identity_immutable_trg
BEFORE DELETE OR UPDATE OF internal_sku, unit_code, manufacturer_serial_number, product_id, variant_id
ON public.stock_units
FOR EACH ROW EXECUTE FUNCTION public.reject_stock_unit_identity_mutation();
`;

export function up(pgm) { pgm.sql(UP_SQL); }

export function down() {
  throw new Error('FIX-01 stock-unit barcode rollback is intentionally blocked. Use a reviewed forward correction or restore procedure.');
}
