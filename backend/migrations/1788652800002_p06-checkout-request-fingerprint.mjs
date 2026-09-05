export const CONSTRAINT_NAMES = Object.freeze([
  'sales_checkout_request_fingerprint_length_chk',
  'sales_checkout_request_fingerprint_requires_key_chk',
]);

export const UP_SQL = String.raw`
ALTER TABLE public.sales
  ADD COLUMN checkout_request_fingerprint bytea,
  ADD CONSTRAINT sales_checkout_request_fingerprint_length_chk
    CHECK (
      checkout_request_fingerprint IS NULL
      OR octet_length(checkout_request_fingerprint) = 32
    ),
  ADD CONSTRAINT sales_checkout_request_fingerprint_requires_key_chk
    CHECK (
      checkout_request_fingerprint IS NULL
      OR idempotency_key IS NOT NULL
    );
`;

export const DOWN_SQL = String.raw`
ALTER TABLE public.sales
  DROP CONSTRAINT sales_checkout_request_fingerprint_requires_key_chk,
  DROP CONSTRAINT sales_checkout_request_fingerprint_length_chk,
  DROP COLUMN checkout_request_fingerprint;
`;

export function up(pgm) {
  pgm.sql(UP_SQL);
}

export function down(pgm) {
  pgm.sql(DOWN_SQL);
}
