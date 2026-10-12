// Phase 2B: additive stock-unit and per-item shop-warranty schema.
// This migration is deliberately forward-only and contains no historical DML.

export const MIGRATION_NAME = '1791763200000_p2b-stock-unit-warranty-schema';

export const NEW_TABLES = Object.freeze([
  'stock_units',
  'stock_unit_events',
  'sale_item_stock_units',
]);

export const NEW_SEQUENCES = Object.freeze([
  'stock_units_id_seq',
  'stock_unit_internal_sku_seq',
  'stock_unit_events_id_seq',
  'sale_item_stock_units_id_seq',
]);

export const UP_SQL = String.raw`
ALTER TABLE public.products
  ADD COLUMN serial_tracking_enabled boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN shop_warranty_enabled boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN shop_warranty_months smallint,
  ADD CONSTRAINT products_shop_warranty_policy_chk
    CHECK (
      (shop_warranty_enabled = FALSE AND shop_warranty_months IS NULL)
      OR
      (shop_warranty_enabled = TRUE AND shop_warranty_months IN (1, 3, 6, 12))
    ) NOT VALID,
  ADD CONSTRAINT products_sku_reserved_namespace_chk
    CHECK (upper(btrim(sku)) NOT LIKE 'SU-%') NOT VALID;

ALTER TABLE public.product_variants
  ADD COLUMN serial_tracking_enabled boolean,
  ADD COLUMN shop_warranty_enabled boolean,
  ADD COLUMN shop_warranty_months smallint,
  ADD CONSTRAINT product_variants_shop_warranty_policy_chk
    CHECK (
      (shop_warranty_enabled IS NULL AND shop_warranty_months IS NULL)
      OR
      (shop_warranty_enabled = FALSE AND shop_warranty_months IS NULL)
      OR
      (shop_warranty_enabled = TRUE AND shop_warranty_months IN (1, 3, 6, 12))
    ) NOT VALID,
  ADD CONSTRAINT product_variants_sku_reserved_namespace_chk
    CHECK (upper(btrim(sku)) NOT LIKE 'SU-%') NOT VALID,
  ADD CONSTRAINT product_variants_product_id_id_key UNIQUE (product_id, id);

ALTER TABLE public.sale_items
  ADD COLUMN shop_warranty_eligible boolean,
  ADD COLUMN shop_warranty_months smallint,
  ADD COLUMN shop_warranty_start_date date,
  ADD COLUMN shop_warranty_end_date date,
  ADD COLUMN product_sku_snapshot character varying(50),
  ADD COLUMN variant_sku_snapshot character varying(80),
  ADD CONSTRAINT sale_items_shop_warranty_snapshot_chk
    CHECK (
      (
        shop_warranty_eligible IS NULL
        AND shop_warranty_months IS NULL
        AND shop_warranty_start_date IS NULL
        AND shop_warranty_end_date IS NULL
      )
      OR
      (
        shop_warranty_eligible = FALSE
        AND shop_warranty_months IS NULL
        AND shop_warranty_start_date IS NULL
        AND shop_warranty_end_date IS NULL
      )
      OR
      (
        shop_warranty_eligible = TRUE
        AND shop_warranty_months IN (1, 3, 6, 12)
        AND shop_warranty_start_date IS NOT NULL
        AND shop_warranty_end_date IS NOT NULL
        AND shop_warranty_end_date >= shop_warranty_start_date
      )
    ) NOT VALID;

ALTER TABLE public.sales
  ADD COLUMN checkout_contract_version smallint,
  ADD CONSTRAINT sales_checkout_contract_version_valid_chk
    CHECK (checkout_contract_version IS NULL OR checkout_contract_version > 0)
    NOT VALID;

ALTER TABLE public.products
  VALIDATE CONSTRAINT products_shop_warranty_policy_chk,
  VALIDATE CONSTRAINT products_sku_reserved_namespace_chk;

ALTER TABLE public.product_variants
  VALIDATE CONSTRAINT product_variants_shop_warranty_policy_chk,
  VALIDATE CONSTRAINT product_variants_sku_reserved_namespace_chk;

ALTER TABLE public.sale_items
  VALIDATE CONSTRAINT sale_items_shop_warranty_snapshot_chk;

ALTER TABLE public.sales
  VALIDATE CONSTRAINT sales_checkout_contract_version_valid_chk;

CREATE SEQUENCE public.stock_units_id_seq AS bigint;
CREATE SEQUENCE public.stock_unit_internal_sku_seq AS bigint;
CREATE SEQUENCE public.stock_unit_events_id_seq AS bigint;
CREATE SEQUENCE public.sale_item_stock_units_id_seq AS bigint;

CREATE TABLE public.stock_units (
  id bigint NOT NULL DEFAULT nextval('public.stock_units_id_seq'::regclass),
  internal_sku character varying(64) NOT NULL
    DEFAULT ('SU-' || nextval('public.stock_unit_internal_sku_seq'::regclass)::text),
  manufacturer_serial_number text NOT NULL,
  normalized_serial_number text GENERATED ALWAYS AS (
    upper(regexp_replace(btrim(manufacturer_serial_number), '[^A-Za-z0-9]', '', 'g'))
  ) STORED,
  product_id integer NOT NULL,
  variant_id integer,
  state character varying(20) NOT NULL DEFAULT 'available',
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stock_units_pkey PRIMARY KEY (id),
  CONSTRAINT stock_units_internal_sku_key UNIQUE (internal_sku),
  CONSTRAINT stock_units_normalized_serial_number_key UNIQUE (normalized_serial_number),
  CONSTRAINT stock_units_internal_sku_namespace_chk
    CHECK (internal_sku ~ '^SU-[0-9]+$'),
  CONSTRAINT stock_units_normalized_serial_not_empty_chk
    CHECK (normalized_serial_number <> ''),
  CONSTRAINT stock_units_state_valid_chk
    CHECK (state IN ('available', 'sold', 'quarantined', 'retired')),
  CONSTRAINT stock_units_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT,
  CONSTRAINT stock_units_product_variant_fkey
    FOREIGN KEY (product_id, variant_id)
    REFERENCES public.product_variants(product_id, id) ON DELETE RESTRICT
);

ALTER SEQUENCE public.stock_units_id_seq OWNED BY public.stock_units.id;
ALTER SEQUENCE public.stock_unit_internal_sku_seq OWNED BY public.stock_units.internal_sku;

CREATE INDEX idx_stock_units_product_variant
  ON public.stock_units (product_id, variant_id);
CREATE INDEX idx_stock_units_state
  ON public.stock_units (state);
CREATE INDEX idx_stock_units_available_product_variant
  ON public.stock_units (product_id, variant_id, id)
  WHERE state = 'available';

CREATE TABLE public.stock_unit_events (
  id bigint NOT NULL DEFAULT nextval('public.stock_unit_events_id_seq'::regclass),
  stock_unit_id bigint NOT NULL,
  event_type character varying(20) NOT NULL,
  from_state character varying(20),
  to_state character varying(20) NOT NULL,
  sale_id integer,
  sale_item_id integer,
  actor_user_id integer,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stock_unit_events_pkey PRIMARY KEY (id),
  CONSTRAINT stock_unit_events_event_type_valid_chk
    CHECK (event_type IN ('received', 'sold', 'refunded', 'voided', 'quarantined', 'released', 'retired')),
  CONSTRAINT stock_unit_events_from_state_valid_chk
    CHECK (from_state IS NULL OR from_state IN ('available', 'sold', 'quarantined', 'retired')),
  CONSTRAINT stock_unit_events_to_state_valid_chk
    CHECK (to_state IN ('available', 'sold', 'quarantined', 'retired')),
  CONSTRAINT stock_unit_events_transition_valid_chk
    CHECK (
      (event_type = 'received' AND from_state IS NULL AND to_state = 'available')
      OR (event_type = 'sold' AND from_state = 'available' AND to_state = 'sold')
      OR (event_type IN ('refunded', 'voided') AND from_state = 'sold' AND to_state = 'quarantined')
      OR (event_type = 'quarantined' AND from_state IN ('available', 'sold') AND to_state = 'quarantined')
      OR (event_type = 'released' AND from_state = 'quarantined' AND to_state = 'available')
      OR (event_type = 'retired' AND from_state IN ('available', 'quarantined') AND to_state = 'retired')
    ),
  CONSTRAINT stock_unit_events_stock_unit_id_fkey
    FOREIGN KEY (stock_unit_id) REFERENCES public.stock_units(id) ON DELETE RESTRICT,
  CONSTRAINT stock_unit_events_sale_id_fkey
    FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE RESTRICT,
  CONSTRAINT stock_unit_events_sale_item_id_fkey
    FOREIGN KEY (sale_item_id) REFERENCES public.sale_items(id) ON DELETE RESTRICT,
  CONSTRAINT stock_unit_events_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

ALTER SEQUENCE public.stock_unit_events_id_seq OWNED BY public.stock_unit_events.id;

CREATE INDEX idx_stock_unit_events_unit_occurred
  ON public.stock_unit_events (stock_unit_id, occurred_at, id);
CREATE INDEX idx_stock_unit_events_sale_item
  ON public.stock_unit_events (sale_item_id)
  WHERE sale_item_id IS NOT NULL;

CREATE TABLE public.sale_item_stock_units (
  id bigint NOT NULL DEFAULT nextval('public.sale_item_stock_units_id_seq'::regclass),
  sale_item_id integer NOT NULL,
  stock_unit_id bigint NOT NULL,
  internal_sku_snapshot character varying(64) NOT NULL,
  manufacturer_serial_number_snapshot text NOT NULL,
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  released_at timestamp with time zone,
  release_reason character varying(20),
  CONSTRAINT sale_item_stock_units_pkey PRIMARY KEY (id),
  CONSTRAINT sale_item_stock_units_sale_item_stock_unit_key
    UNIQUE (sale_item_id, stock_unit_id),
  CONSTRAINT sale_item_stock_units_release_chk
    CHECK (
      (released_at IS NULL AND release_reason IS NULL)
      OR
      (released_at IS NOT NULL AND release_reason IN ('refunded', 'voided', 'correction'))
    ),
  CONSTRAINT sale_item_stock_units_sale_item_id_fkey
    FOREIGN KEY (sale_item_id) REFERENCES public.sale_items(id) ON DELETE RESTRICT,
  CONSTRAINT sale_item_stock_units_stock_unit_id_fkey
    FOREIGN KEY (stock_unit_id) REFERENCES public.stock_units(id) ON DELETE RESTRICT
);

ALTER SEQUENCE public.sale_item_stock_units_id_seq
  OWNED BY public.sale_item_stock_units.id;

CREATE UNIQUE INDEX sale_item_stock_units_one_active_unit_idx
  ON public.sale_item_stock_units (stock_unit_id)
  WHERE released_at IS NULL;
CREATE INDEX idx_sale_item_stock_units_sale_item
  ON public.sale_item_stock_units (sale_item_id);

CREATE FUNCTION public.reject_stock_unit_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock units must be retired, not deleted';
  END IF;
  IF NEW.internal_sku IS DISTINCT FROM OLD.internal_sku
    OR NEW.manufacturer_serial_number IS DISTINCT FROM OLD.manufacturer_serial_number
    OR NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.variant_id IS DISTINCT FROM OLD.variant_id THEN
    RAISE EXCEPTION 'stock unit identity is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stock_units_identity_immutable_trg
BEFORE DELETE OR UPDATE OF internal_sku, manufacturer_serial_number, product_id, variant_id
ON public.stock_units
FOR EACH ROW EXECUTE FUNCTION public.reject_stock_unit_identity_mutation();

CREATE FUNCTION public.reject_stock_unit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'stock unit events are immutable';
END;
$function$;

CREATE TRIGGER stock_unit_events_immutable_row_trg
BEFORE UPDATE OR DELETE ON public.stock_unit_events
FOR EACH ROW EXECUTE FUNCTION public.reject_stock_unit_event_mutation();

CREATE TRIGGER stock_unit_events_immutable_truncate_trg
BEFORE TRUNCATE ON public.stock_unit_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_stock_unit_event_mutation();

CREATE FUNCTION public.reject_sale_item_stock_unit_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sale item stock-unit assignments are historical records';
  END IF;
  IF NEW.sale_item_id IS DISTINCT FROM OLD.sale_item_id
    OR NEW.stock_unit_id IS DISTINCT FROM OLD.stock_unit_id
    OR NEW.internal_sku_snapshot IS DISTINCT FROM OLD.internal_sku_snapshot
    OR NEW.manufacturer_serial_number_snapshot IS DISTINCT FROM OLD.manufacturer_serial_number_snapshot
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
    RAISE EXCEPTION 'sale item stock-unit identity snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER sale_item_stock_units_snapshot_immutable_trg
BEFORE DELETE OR UPDATE ON public.sale_item_stock_units
FOR EACH ROW EXECUTE FUNCTION public.reject_sale_item_stock_unit_snapshot_mutation();
`;

export function up(pgm) {
  pgm.sql(UP_SQL);
}

export function down() {
  throw new Error(
    'Phase 2B stock-unit schema rollback is intentionally blocked. Use a reviewed forward correction or restore procedure.'
  );
}
