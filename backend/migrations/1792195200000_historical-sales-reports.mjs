export const MIGRATION_NAME = '1792195200000_historical-sales-reports';
export const NEW_TABLES = Object.freeze([
  'historical_sales_archives',
  'historical_sales',
  'historical_monthly_summaries',
  'historical_all_time_summaries',
]);

export const UP_SQL = `
CREATE TABLE public.historical_sales_archives (
  id smallint PRIMARY KEY,
  archive_digest character(64) NOT NULL UNIQUE,
  source_label character varying(120) NOT NULL,
  transaction_count integer NOT NULL,
  imported_by integer NOT NULL,
  imported_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT historical_sales_archives_singleton_chk CHECK (id = 1),
  CONSTRAINT historical_sales_archives_digest_chk CHECK (archive_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT historical_sales_archives_count_chk CHECK (transaction_count >= 0),
  CONSTRAINT historical_sales_archives_user_fk FOREIGN KEY (imported_by)
    REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE TABLE public.historical_sales (
  archive_id smallint NOT NULL,
  legacy_id bigint NOT NULL,
  invoice_number character varying(120) NOT NULL,
  created_at_text character varying(80) NOT NULL,
  sale_month date NOT NULL,
  status character varying(20) NOT NULL,
  subtotal numeric(18,2) NOT NULL,
  tax numeric(18,2) NOT NULL,
  discount numeric(18,2) NOT NULL,
  total numeric(18,2) NOT NULL,
  payment_method character varying(80) NOT NULL,
  refunded_at_text character varying(80),
  voided_at_text character varying(80),
  PRIMARY KEY (archive_id, legacy_id),
  CONSTRAINT historical_sales_invoice_key UNIQUE (archive_id, invoice_number),
  CONSTRAINT historical_sales_archive_fk FOREIGN KEY (archive_id)
    REFERENCES public.historical_sales_archives(id) ON DELETE RESTRICT,
  CONSTRAINT historical_sales_status_chk CHECK (status IN ('completed', 'refunded', 'voided')),
  CONSTRAINT historical_sales_amounts_chk CHECK (
    subtotal >= 0 AND tax >= 0 AND discount >= 0 AND total >= 0
  ),
  CONSTRAINT historical_sales_month_chk CHECK (sale_month = date_trunc('month', sale_month)::date)
);

CREATE INDEX historical_sales_created_idx
  ON public.historical_sales (archive_id, created_at_text, legacy_id);
CREATE INDEX historical_sales_status_idx
  ON public.historical_sales (archive_id, status);

CREATE TABLE public.historical_monthly_summaries (
  archive_id smallint NOT NULL,
  sale_month date NOT NULL,
  completed_transactions integer NOT NULL,
  completed_amount numeric(18,2) NOT NULL,
  refunded_transactions integer NOT NULL,
  refunded_amount numeric(18,2) NOT NULL,
  PRIMARY KEY (archive_id, sale_month),
  CONSTRAINT historical_monthly_archive_fk FOREIGN KEY (archive_id)
    REFERENCES public.historical_sales_archives(id) ON DELETE RESTRICT,
  CONSTRAINT historical_monthly_month_chk CHECK (sale_month = date_trunc('month', sale_month)::date),
  CONSTRAINT historical_monthly_values_chk CHECK (
    completed_transactions >= 0 AND refunded_transactions >= 0
    AND completed_amount >= 0 AND refunded_amount >= 0
  )
);

CREATE TABLE public.historical_all_time_summaries (
  archive_id smallint PRIMARY KEY,
  total_transactions integer NOT NULL,
  completed_transactions integer NOT NULL,
  completed_amount numeric(18,2) NOT NULL,
  refunded_transactions integer NOT NULL,
  refunded_amount numeric(18,2) NOT NULL,
  CONSTRAINT historical_all_time_archive_fk FOREIGN KEY (archive_id)
    REFERENCES public.historical_sales_archives(id) ON DELETE RESTRICT,
  CONSTRAINT historical_all_time_values_chk CHECK (
    total_transactions >= 0 AND completed_transactions >= 0 AND refunded_transactions >= 0
    AND completed_amount >= 0 AND refunded_amount >= 0
    AND total_transactions >= completed_transactions + refunded_transactions
  )
);

CREATE FUNCTION public.reject_historical_sales_mutation() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'historical sales archives are append-only';
END $function$;

CREATE TRIGGER historical_sales_archives_immutable_trg
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.historical_sales_archives
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_historical_sales_mutation();
CREATE TRIGGER historical_sales_immutable_trg
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.historical_sales
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_historical_sales_mutation();
CREATE TRIGGER historical_monthly_immutable_trg
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.historical_monthly_summaries
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_historical_sales_mutation();
CREATE TRIGGER historical_all_time_immutable_trg
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.historical_all_time_summaries
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_historical_sales_mutation();
`;

export function up(pgm) { pgm.sql(UP_SQL); }
export function down() {
  throw new Error('Historical sales rollback is intentionally blocked; restore a verified backup instead.');
}
