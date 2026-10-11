// Additive, forward-only warranty metadata.
// NULL is preserved for legacy invoices, while 0 explicitly means no warranty.

export const CONSTRAINT_NAME = 'sales_warranty_months_valid_chk';

export const UP_SQL = String.raw`
ALTER TABLE public.sales
  ADD COLUMN warranty_months smallint;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_warranty_months_valid_chk
  CHECK (warranty_months IS NULL OR warranty_months IN (0, 1, 3, 6, 12))
  NOT VALID;

ALTER TABLE public.sales
  VALIDATE CONSTRAINT sales_warranty_months_valid_chk;
`;

export function up(pgm) {
  pgm.sql(UP_SQL);
}

export function down() {
  throw new Error(
    'Warranty migration rollback is intentionally blocked. Older releases safely ignore the additive column.'
  );
}
