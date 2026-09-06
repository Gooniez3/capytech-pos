// P0.8: Product recycle-bin metadata. Existing inactive products remain valid
// legacy entries with NULL metadata; this migration deliberately does not backfill.
export const CONSTRAINT_NAMES = Object.freeze([
  'products_deleted_by_requires_deleted_at_chk',
  'products_active_deletion_metadata_clear_chk',
]);

export const UP_SQL = String.raw`
ALTER TABLE public.products
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by integer,
  ADD CONSTRAINT products_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT products_deleted_by_requires_deleted_at_chk
    CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL),
  ADD CONSTRAINT products_active_deletion_metadata_clear_chk
    CHECK (NOT is_active OR (deleted_at IS NULL AND deleted_by IS NULL));

CREATE INDEX idx_products_recycle_bin
  ON public.products (deleted_at DESC, id DESC)
  WHERE is_active = FALSE;
`;

export const DOWN_SQL = String.raw`
DROP INDEX public.idx_products_recycle_bin;

ALTER TABLE public.products
  DROP CONSTRAINT products_active_deletion_metadata_clear_chk,
  DROP CONSTRAINT products_deleted_by_requires_deleted_at_chk,
  DROP CONSTRAINT products_deleted_by_fkey,
  DROP COLUMN deleted_by,
  DROP COLUMN deleted_at;
`;

export function up(pgm) {
  pgm.sql(UP_SQL);
}

export function down(pgm) {
  pgm.sql(DOWN_SQL);
}
