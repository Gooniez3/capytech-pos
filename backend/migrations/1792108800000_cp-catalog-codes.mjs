export const MIGRATION_NAME = '1792108800000_cp-catalog-codes';
export const NEW_SEQUENCES = Object.freeze(['catalog_code_seq']);

export const UP_SQL = `
DO $block$
DECLARE collision text;
BEGIN
  SELECT identifier INTO collision FROM (
    SELECT 'product SKU ' || quote_literal(sku) identifier FROM public.products
      WHERE UPPER(BTRIM(sku)) ~ '^CP[0-9]{6,}$'
    UNION ALL SELECT 'variant SKU ' || quote_literal(sku) FROM public.product_variants
      WHERE UPPER(BTRIM(sku)) ~ '^CP[0-9]{6,}$'
    UNION ALL SELECT 'manufacturer serial ' || quote_literal(manufacturer_serial_number) FROM public.stock_units
      WHERE normalized_serial_number ~ '^CP[0-9]{6,}$'
    UNION ALL SELECT 'stock-unit internal SKU ' || quote_literal(internal_sku) FROM public.stock_units
      WHERE UPPER(BTRIM(internal_sku)) ~ '^CP[0-9]{6,}$'
    UNION ALL SELECT 'stock-unit code ' || quote_literal(unit_code) FROM public.stock_units
      WHERE UPPER(BTRIM(unit_code)) ~ '^CP[0-9]{6,}$'
  ) found ORDER BY identifier LIMIT 1;
  IF collision IS NOT NULL THEN
    RAISE EXCEPTION 'CP catalog-code namespace collision: %', collision;
  END IF;
END $block$;

CREATE SEQUENCE public.catalog_code_seq AS bigint;
CREATE FUNCTION public.format_catalog_code(value bigint) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $function$
  SELECT 'CP' || lpad(value::text, GREATEST(6, length(value::text)), '0')
$function$;

CREATE TABLE public.catalog_codes (
  code character varying(32) PRIMARY KEY,
  product_id integer UNIQUE,
  variant_id integer UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT catalog_codes_namespace_chk CHECK (code ~ '^CP[0-9]{6,}$'),
  CONSTRAINT catalog_codes_owner_chk CHECK ((product_id IS NOT NULL)::integer + (variant_id IS NOT NULL)::integer = 1),
  CONSTRAINT catalog_codes_product_fk FOREIGN KEY (product_id) REFERENCES public.products(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT catalog_codes_variant_fk FOREIGN KEY (variant_id) REFERENCES public.product_variants(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE public.products ADD COLUMN product_code character varying(32);
ALTER TABLE public.product_variants ADD COLUMN product_code character varying(32);

CREATE FUNCTION public.register_catalog_code() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.product_code IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'products' THEN
    INSERT INTO public.catalog_codes(code, product_id) VALUES (NEW.product_code, NEW.id);
  ELSE
    INSERT INTO public.catalog_codes(code, variant_id) VALUES (NEW.product_code, NEW.id);
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER products_register_catalog_code_insert_trg AFTER INSERT ON public.products
FOR EACH ROW WHEN (NEW.product_code IS NOT NULL)
EXECUTE FUNCTION public.register_catalog_code();
CREATE TRIGGER products_register_catalog_code_update_trg AFTER UPDATE OF product_code ON public.products
FOR EACH ROW WHEN (NEW.product_code IS NOT NULL AND OLD.product_code IS DISTINCT FROM NEW.product_code)
EXECUTE FUNCTION public.register_catalog_code();
CREATE TRIGGER variants_register_catalog_code_insert_trg AFTER INSERT ON public.product_variants
FOR EACH ROW WHEN (NEW.product_code IS NOT NULL)
EXECUTE FUNCTION public.register_catalog_code();
CREATE TRIGGER variants_register_catalog_code_update_trg AFTER UPDATE OF product_code ON public.product_variants
FOR EACH ROW WHEN (NEW.product_code IS NOT NULL AND OLD.product_code IS DISTINCT FROM NEW.product_code)
EXECUTE FUNCTION public.register_catalog_code();

WITH ordered AS MATERIALIZED (
  SELECT id, public.format_catalog_code(nextval('public.catalog_code_seq')) code
  FROM public.products WHERE product_code IS NULL ORDER BY id
)
UPDATE public.products p SET product_code=o.code FROM ordered o WHERE p.id=o.id;
WITH ordered AS MATERIALIZED (
  SELECT id, public.format_catalog_code(nextval('public.catalog_code_seq')) code
  FROM public.product_variants WHERE product_code IS NULL ORDER BY id
)
UPDATE public.product_variants v SET product_code=o.code FROM ordered o WHERE v.id=o.id;

ALTER TABLE public.products
  ALTER COLUMN product_code SET NOT NULL,
  ADD CONSTRAINT products_product_code_key UNIQUE(product_code),
  ADD CONSTRAINT products_product_code_namespace_chk CHECK (product_code ~ '^CP[0-9]{6,}$'),
  ADD CONSTRAINT products_product_code_registry_fk FOREIGN KEY(product_code) REFERENCES public.catalog_codes(code)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT products_sku_cp_namespace_chk CHECK (UPPER(BTRIM(sku)) !~ '^CP[0-9]{6,}$' OR UPPER(BTRIM(sku)) = product_code);
ALTER TABLE public.product_variants
  ALTER COLUMN product_code SET NOT NULL,
  ADD CONSTRAINT product_variants_product_code_key UNIQUE(product_code),
  ADD CONSTRAINT product_variants_product_code_namespace_chk CHECK (product_code ~ '^CP[0-9]{6,}$'),
  ADD CONSTRAINT product_variants_product_code_registry_fk FOREIGN KEY(product_code) REFERENCES public.catalog_codes(code)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT product_variants_sku_cp_namespace_chk CHECK (UPPER(BTRIM(sku)) !~ '^CP[0-9]{6,}$' OR UPPER(BTRIM(sku)) = product_code);
ALTER TABLE public.stock_units
  ADD CONSTRAINT stock_units_serial_cp_namespace_chk CHECK (normalized_serial_number !~ '^CP[0-9]{6,}$'),
  ADD CONSTRAINT stock_units_internal_sku_cp_namespace_chk CHECK (UPPER(BTRIM(internal_sku)) !~ '^CP[0-9]{6,}$'),
  ADD CONSTRAINT stock_units_unit_code_cp_namespace_chk CHECK (UPPER(BTRIM(unit_code)) !~ '^CP[0-9]{6,}$');

CREATE FUNCTION public.reject_catalog_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'catalog codes are permanent and cannot be deleted'; END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.variant_id IS DISTINCT FROM OLD.variant_id THEN
    RAISE EXCEPTION 'catalog code ownership is immutable';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER catalog_codes_immutable_trg BEFORE UPDATE OR DELETE ON public.catalog_codes
FOR EACH ROW EXECUTE FUNCTION public.reject_catalog_identity_mutation();

CREATE FUNCTION public.reject_entity_catalog_code_mutation() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.product_code IS DISTINCT FROM OLD.product_code THEN RAISE EXCEPTION 'catalog code is immutable'; END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER products_catalog_code_immutable_trg BEFORE UPDATE OF product_code ON public.products
FOR EACH ROW EXECUTE FUNCTION public.reject_entity_catalog_code_mutation();
CREATE TRIGGER variants_catalog_code_immutable_trg BEFORE UPDATE OF product_code ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.reject_entity_catalog_code_mutation();
`;

export function up(pgm) { pgm.sql(UP_SQL); }
export function down() { throw new Error('CP catalog-code rollback is intentionally blocked; restore a verified backup instead.'); }
