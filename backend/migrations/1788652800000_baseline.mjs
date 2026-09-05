// Immutable baseline captured from PostgreSQL catalog definitions, not schema.sql.
// nextval appears only in stored column defaults; this file does not evaluate sequences.
import { inspectSchema, isEmptySchema } from '../scripts/lib/schema-inspection.mjs';

export const BASELINE_SQL = String.raw`CREATE SEQUENCE "public"."audit_log_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."categories_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."customers_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."deleted_products_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."invoice_number_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."notifications_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."product_variants_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."products_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."sale_items_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."sales_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."users_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE TABLE "public"."audit_log" (
  "id" integer DEFAULT nextval('audit_log_id_seq'::regclass) NOT NULL,
  "user_id" integer,
  "action" character varying(100) NOT NULL,
  "details" text,
  "created_at" timestamp without time zone DEFAULT now()
);

CREATE TABLE "public"."categories" (
  "id" integer DEFAULT nextval('categories_id_seq'::regclass) NOT NULL,
  "name" character varying(100) NOT NULL
);

CREATE TABLE "public"."customers" (
  "id" integer DEFAULT nextval('customers_id_seq'::regclass) NOT NULL,
  "name" character varying(200) NOT NULL,
  "phone" character varying(50),
  "email" character varying(200),
  "address" text,
  "notes" text,
  "created_at" timestamp without time zone DEFAULT now(),
  "updated_at" timestamp without time zone DEFAULT now()
);

CREATE TABLE "public"."deleted_products" (
  "id" integer DEFAULT nextval('deleted_products_id_seq'::regclass) NOT NULL,
  "original_product_id" integer,
  "sku" character varying(50),
  "name" character varying(200),
  "category_id" integer,
  "price" numeric(10,2),
  "cost" numeric(10,2),
  "stock_quantity" integer,
  "low_stock_threshold" integer,
  "image_url" character varying(1000),
  "image_path" character varying(500),
  "variants_snapshot" jsonb,
  "deleted_reason" character varying(100),
  "deleted_notes" text,
  "deleted_by" integer,
  "deleted_at" timestamp without time zone DEFAULT now()
);

CREATE TABLE "public"."notification_preferences" (
  "user_id" integer NOT NULL,
  "low_stock" boolean DEFAULT true NOT NULL,
  "daily_sales_summary" boolean DEFAULT true NOT NULL,
  "new_staff" boolean DEFAULT false NOT NULL,
  "refund_activity" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."notifications" (
  "id" integer DEFAULT nextval('notifications_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "type" character varying(50) NOT NULL,
  "title" character varying(200) NOT NULL,
  "message" text NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "related_sale_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."product_variants" (
  "id" integer DEFAULT nextval('product_variants_id_seq'::regclass) NOT NULL,
  "product_id" integer NOT NULL,
  "name" character varying(100) NOT NULL,
  "sku" character varying(80) NOT NULL,
  "price" numeric(10,2),
  "cost" numeric(10,2),
  "stock_quantity" integer DEFAULT 0 NOT NULL,
  "low_stock_threshold" integer DEFAULT 2,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp without time zone DEFAULT now(),
  "updated_at" timestamp without time zone DEFAULT now()
);

CREATE TABLE "public"."products" (
  "id" integer DEFAULT nextval('products_id_seq'::regclass) NOT NULL,
  "sku" character varying(50) NOT NULL,
  "name" character varying(200) NOT NULL,
  "category_id" integer,
  "price" numeric(10,2) NOT NULL,
  "cost" numeric(10,2) DEFAULT 0,
  "stock_quantity" integer DEFAULT 0 NOT NULL,
  "low_stock_threshold" integer DEFAULT 5,
  "qr_code" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp without time zone DEFAULT now(),
  "updated_at" timestamp without time zone DEFAULT now(),
  "image_url" character varying(1000),
  "image_path" character varying(500)
);

CREATE TABLE "public"."sale_items" (
  "id" integer DEFAULT nextval('sale_items_id_seq'::regclass) NOT NULL,
  "sale_id" integer,
  "product_id" integer,
  "product_name" character varying(200) NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price" numeric(10,2) NOT NULL,
  "line_total" numeric(10,2) NOT NULL,
  "variant_id" integer,
  "variant_name" character varying(100),
  "variant_sku" character varying(80),
  "unit_cost" numeric(10,2) DEFAULT 0 NOT NULL
);

CREATE TABLE "public"."sales" (
  "id" integer DEFAULT nextval('sales_id_seq'::regclass) NOT NULL,
  "invoice_number" character varying(30) NOT NULL,
  "user_id" integer,
  "subtotal" numeric(10,2) NOT NULL,
  "tax" numeric(10,2) DEFAULT 0,
  "discount" numeric(10,2) DEFAULT 0,
  "total" numeric(10,2) NOT NULL,
  "payment_method" character varying(20) DEFAULT 'cash'::character varying,
  "status" character varying(20) DEFAULT 'completed'::character varying,
  "created_at" timestamp without time zone DEFAULT now(),
  "refunded_at" timestamp with time zone,
  "voided_at" timestamp with time zone,
  "customer_id" integer,
  "customer_name" character varying(200),
  "customer_phone" character varying(50),
  "customer_email" character varying(200),
  "customer_address" text,
  "refund_reason" text,
  "refunded_by" integer,
  "idempotency_key" uuid
);

CREATE TABLE "public"."store_settings" (
  "id" integer DEFAULT 1 NOT NULL,
  "store_name" character varying(200) DEFAULT 'CAPY TECH'::character varying NOT NULL,
  "phone" character varying(50),
  "email" character varying(200),
  "address" text,
  "currency" character varying(20) DEFAULT 'ks'::character varying NOT NULL,
  "tax_rate" numeric(5,2) DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."users" (
  "id" integer DEFAULT nextval('users_id_seq'::regclass) NOT NULL,
  "name" character varying(100) NOT NULL,
  "username" character varying(50) NOT NULL,
  "password_hash" text NOT NULL,
  "role" character varying(20) DEFAULT 'cashier'::character varying NOT NULL,
  "created_at" timestamp without time zone DEFAULT now()
);

ALTER SEQUENCE "public"."audit_log_id_seq" OWNED BY "public"."audit_log"."id";

ALTER SEQUENCE "public"."categories_id_seq" OWNED BY "public"."categories"."id";

ALTER SEQUENCE "public"."customers_id_seq" OWNED BY "public"."customers"."id";

ALTER SEQUENCE "public"."deleted_products_id_seq" OWNED BY "public"."deleted_products"."id";

ALTER SEQUENCE "public"."notifications_id_seq" OWNED BY "public"."notifications"."id";

ALTER SEQUENCE "public"."product_variants_id_seq" OWNED BY "public"."product_variants"."id";

ALTER SEQUENCE "public"."products_id_seq" OWNED BY "public"."products"."id";

ALTER SEQUENCE "public"."sale_items_id_seq" OWNED BY "public"."sale_items"."id";

ALTER SEQUENCE "public"."sales_id_seq" OWNED BY "public"."sales"."id";

ALTER SEQUENCE "public"."users_id_seq" OWNED BY "public"."users"."id";

ALTER TABLE "public"."audit_log" ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."categories" ADD CONSTRAINT "categories_name_key" UNIQUE (name);

ALTER TABLE "public"."categories" ADD CONSTRAINT "categories_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."customers" ADD CONSTRAINT "customers_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."deleted_products" ADD CONSTRAINT "deleted_products_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY (user_id);

ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."product_variants" ADD CONSTRAINT "product_variants_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."product_variants" ADD CONSTRAINT "product_variants_sku_key" UNIQUE (sku);

ALTER TABLE "public"."products" ADD CONSTRAINT "products_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."products" ADD CONSTRAINT "products_sku_key" UNIQUE (sku);

ALTER TABLE "public"."sale_items" ADD CONSTRAINT "sale_items_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."sales" ADD CONSTRAINT "sales_invoice_number_key" UNIQUE (invoice_number);

ALTER TABLE "public"."sales" ADD CONSTRAINT "sales_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."store_settings" ADD CONSTRAINT "store_settings_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."store_settings" ADD CONSTRAINT "store_settings_single_row" CHECK ((id = 1));

ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."users" ADD CONSTRAINT "users_username_key" UNIQUE (username);

ALTER TABLE "public"."audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_related_sale_id_fkey" FOREIGN KEY (related_sale_id) REFERENCES sales(id) ON DELETE SET NULL;

ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE "public"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id);

ALTER TABLE "public"."sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE "public"."sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;

ALTER TABLE "public"."sale_items" ADD CONSTRAINT "sale_items_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES product_variants(id);

ALTER TABLE "public"."sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE "public"."sales" ADD CONSTRAINT "sales_refunded_by_fkey" FOREIGN KEY (refunded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."sales" ADD CONSTRAINT "sales_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read, created_at DESC);

CREATE INDEX idx_product_variants_product_id ON public.product_variants USING btree (product_id);

CREATE INDEX idx_product_variants_sku ON public.product_variants USING btree (sku);

CREATE INDEX idx_products_sku ON public.products USING btree (sku);

CREATE INDEX idx_sale_items_sale ON public.sale_items USING btree (sale_id);

CREATE INDEX idx_sales_customer_id ON public.sales USING btree (customer_id);

CREATE UNIQUE INDEX idx_sales_idempotency_key ON public.sales USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE INDEX idx_sales_invoice ON public.sales USING btree (invoice_number);`;

export async function up(pgm) {
  if (!isEmptySchema(await inspectSchema(pgm.db))) {
    throw new Error('Fresh baseline requires an empty application schema. Existing databases must be validated and explicitly registered.');
  }
  pgm.sql(BASELINE_SQL);
}

export function down() {
  throw new Error('Baseline rollback is intentionally blocked. Use a reviewed forward migration.');
}
