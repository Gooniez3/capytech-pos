// Phase 3A: additive ledger for non-serialized aggregate inventory.
// No historical rows are fabricated and no existing quantities are changed.

export const MIGRATION_NAME = '1791849600000_p3a-inventory-movements';
export const NEW_TABLES = Object.freeze(['inventory_movements']);
export const NEW_SEQUENCES = Object.freeze(['inventory_movements_id_seq']);

export const UP_SQL = String.raw`
CREATE SEQUENCE public.inventory_movements_id_seq AS bigint;

CREATE TABLE public.inventory_movements (
  id bigint NOT NULL DEFAULT nextval('public.inventory_movements_id_seq'::regclass),
  product_id integer NOT NULL,
  variant_id integer,
  movement_type character varying(20) NOT NULL,
  quantity_change integer NOT NULL,
  quantity_before integer NOT NULL,
  quantity_after integer NOT NULL,
  actor_user_id integer,
  reason text,
  source_reference text,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_movements_type_chk
    CHECK (movement_type IN ('opening', 'received', 'adjusted', 'sold', 'refunded', 'voided')),
  CONSTRAINT inventory_movements_change_chk CHECK (quantity_change <> 0),
  CONSTRAINT inventory_movements_direction_chk CHECK (
    (movement_type IN ('opening', 'received', 'refunded', 'voided') AND quantity_change > 0)
    OR movement_type = 'adjusted'
    OR (movement_type = 'sold' AND quantity_change < 0)
  ),
  CONSTRAINT inventory_movements_quantities_chk CHECK (
    quantity_before >= 0
    AND quantity_after >= 0
    AND quantity_after = quantity_before + quantity_change
  ),
  CONSTRAINT inventory_movements_product_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movements_product_variant_fkey
    FOREIGN KEY (product_id, variant_id)
    REFERENCES public.product_variants(product_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movements_actor_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

ALTER SEQUENCE public.inventory_movements_id_seq
  OWNED BY public.inventory_movements.id;

CREATE INDEX idx_inventory_movements_target_time
  ON public.inventory_movements (product_id, variant_id, occurred_at, id);
CREATE INDEX idx_inventory_movements_actor_time
  ON public.inventory_movements (actor_user_id, occurred_at, id)
  WHERE actor_user_id IS NOT NULL;

CREATE FUNCTION public.reject_inventory_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'inventory movements are immutable';
END;
$function$;

CREATE TRIGGER inventory_movements_immutable_row_trg
BEFORE UPDATE OR DELETE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.reject_inventory_movement_mutation();

CREATE TRIGGER inventory_movements_immutable_truncate_trg
BEFORE TRUNCATE ON public.inventory_movements
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_inventory_movement_mutation();
`;

export function up(pgm) {
  pgm.sql(UP_SQL);
}

export function down() {
  throw new Error(
    'Phase 3A inventory movement schema rollback is intentionally blocked. Use a reviewed forward correction or restore procedure.'
  );
}
