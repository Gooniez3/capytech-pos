// Phase 3D: durable idempotency receipts for product-scoped restocking.
// Additive only; no existing inventory or history is rewritten.

export const MIGRATION_NAME = '1791936000000_p3d-inventory-receipts';
export const NEW_TABLES = Object.freeze(['inventory_receipts']);
export const NEW_SEQUENCES = Object.freeze([]);

export const UP_SQL = String.raw`
CREATE TABLE public.inventory_receipts (
  idempotency_key uuid NOT NULL,
  request_fingerprint bytea NOT NULL,
  product_id integer NOT NULL,
  variant_id integer,
  actor_user_id integer NOT NULL,
  tracking_mode character varying(20) NOT NULL,
  quantity_received integer NOT NULL,
  quantity_before integer NOT NULL,
  quantity_after integer NOT NULL,
  reason text,
  source_reference text NOT NULL,
  stock_unit_ids bigint[] NOT NULL DEFAULT ARRAY[]::bigint[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inventory_receipts_pkey PRIMARY KEY (idempotency_key),
  CONSTRAINT inventory_receipts_fingerprint_chk CHECK (octet_length(request_fingerprint) = 32),
  CONSTRAINT inventory_receipts_mode_chk CHECK (tracking_mode IN ('quantity', 'serialized')),
  CONSTRAINT inventory_receipts_quantity_chk CHECK (
    quantity_received > 0 AND quantity_before >= 0
    AND quantity_after = quantity_before + quantity_received
  ),
  CONSTRAINT inventory_receipts_product_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT,
  CONSTRAINT inventory_receipts_product_variant_fkey
    FOREIGN KEY (product_id, variant_id)
    REFERENCES public.product_variants(product_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_receipts_actor_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_inventory_receipts_target_time
  ON public.inventory_receipts (product_id, variant_id, created_at);

CREATE TRIGGER inventory_receipts_immutable_row_trg
BEFORE UPDATE OR DELETE ON public.inventory_receipts
FOR EACH ROW EXECUTE FUNCTION public.reject_inventory_movement_mutation();

CREATE TRIGGER inventory_receipts_immutable_truncate_trg
BEFORE TRUNCATE ON public.inventory_receipts
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_inventory_movement_mutation();
`;

export function up(pgm) { pgm.sql(UP_SQL); }
export function down() {
  throw new Error('Phase 3D inventory receipt rollback is intentionally blocked. Use a reviewed forward correction or restore procedure.');
}
