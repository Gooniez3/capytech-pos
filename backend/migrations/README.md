# PostgreSQL migrations

Migrations use **node-pg-migrate 9.0.0**, pinned exactly in the backend dependencies.
Use Node.js 24 on the store PC and PostgreSQL 14+. Node 24.19.0 was validated here;
the pinned dependency tree also includes CLI packages with stricter Node requirements
than node-pg-migrate's own declared minimum of 20.11.0.
The baseline was captured from PostgreSQL 17.11 catalog metadata on 2026-09-06.
Commands below run in PowerShell from `backend`. No migration runs on server startup,
`npm install`, `npm ci`, `migrate:check`, or `migrate:status`.

## Connection and read-only checks

The standalone runner reads `backend/.env` by absolute path and uses the same
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` settings as the existing
application pool. Environment variables take precedence. All five are required;
there is no fallback to a different database or `DATABASE_URL`. Credentials are not
printed. The application pool and business logic are unchanged.

```powershell
npm run migrate:status
npm run migrate:check
npm run test:migrations
```

Both database checks enforce `default_transaction_read_only=on` at connection
startup and use a repeatable-read, read-only transaction. They inspect catalogs
and, only if it already exists and passes structural checks, read migration history.
They never invoke node-pg-migrate's runner: even its dry-run mode may create
bookkeeping. No application rows or sequence counters are read. Sequence default
expressions are retrieved as text; `nextval()` and `setval()` are never evaluated.

The output lists the target database, applied/pending migration names, state, and
schema differences. A matching but unregistered database is reported as
`matching-unbaselined`; this is a successful check, not authorization to apply it.
Schema drift and malformed/unknown/duplicate/out-of-order history cause a nonzero
exit status. Neither command creates `public.pgmigrations`.

## Baseline and existing customer databases

`1788652800000_baseline.mjs` is immutable, deterministic, schema-only DDL derived
from the inspected database, **not** from `src/db/schema.sql`. Its snapshot is
`baseline-schema.json`. Do not regenerate either from an arbitrary customer DB or
edit them after deployment. Do not run the historical `schema.sql` or
`add-sales-idempotency.js` as migration steps.

The baseline includes 12 application tables, 115 columns, 30 constraints,
25 indexes (17 supplied by constraints and 8 standalone), and 11 sequences.
This includes customers and customer sale snapshots, refunds/VOID metadata,
variant snapshots and unit cost, product soft deletion, notification/settings
tables, and the existing partial unique idempotency index.

For an existing database, first take and verify a full backup including sequence
state, stop the POS for the maintenance window, and prevent concurrent schema
changes. Run the read-only checks and review the target and results. Only after
separate approval for database writes, the explicit adoption command is:

```powershell
# FUTURE OPERATOR ACTION ONLY. This was not run during implementation.
npm run migrate:baseline -- --database pos_store
```

The explicit database name must exactly equal `DB_NAME`; it is a target assertion,
not an override. The command acquires the migration advisory lock, validates the
existing schema, and revalidates it inside the registration transaction. It uses
node-pg-migrate's `fake` option restricted to **one named baseline file**, never all
pending migrations. The only writes are creation of the migration bookkeeping
table/index/sequence if absent and insertion of its baseline history row. It does
not execute baseline application DDL, reset sequences, copy records, insert seed
data, or update customer/application tables. Future migrations remain pending.

The validator fails closed on missing or extra tables/columns, type or length or
precision differences, nullability/default/collation changes, generated/identity
differences, missing or changed constraints and indexes (including predicates,
validity, and foreign-key actions), sequence definitions/ownership differences,
and unexpected schemas, routines, triggers, types, policies, rules, extensions,
inheritance, or event triggers. Table persistence, RLS, access method, storage
options, and replica identity are also compared. It reports differences and stops;
there is no automatic repair, blanket `IF NOT EXISTS`, or force/skip-validation flag.
An older or customized customer schema needs a separately reviewed compatibility
plan before adoption. Never fake the baseline merely because some tables exist.

Physical OIDs, physical column order, role names/ownership, grants, comments,
statistics, and live sequence counters are not part of the portable schema
comparison. Database/role provisioning, privileges, and database locale remain
installation responsibilities. The migration role must be able to inspect and
manage the application's schema; the baseline does not copy store credentials or
machine-specific privileges.

## Fresh empty installation

Provision PostgreSQL and a **new, empty** database with the intended database
locale and owner, install backend dependencies, and configure `backend/.env`.
Do not use this workflow on an existing customer database.

```powershell
# FUTURE INSTALLATION ACTIONS ONLY. Use a new database name.
createdb pos_store_new
# Configure DB_NAME=pos_store_new and the other DB_* values in backend/.env.
npm ci
npm run migrate:check
# Confirm state is empty and approve initializing that database, then:
npm run migrate:up -- --database pos_store_new
```

The baseline accepts only an empty application schema (apart from verified
migration bookkeeping and the standard public schema/plpgsql extension). It
creates sequences, then tables, sequence ownership, primary/unique/check
constraints, foreign keys, and standalone indexes. There is no seed/customer data.
Fresh sequences use their captured start definition of 1, not any live store's
counter. Column defaults containing `nextval` are installed as expressions, not
called during baseline construction. Initial admin provisioning remains the
separate setup step in the backend README.

Both the wrapper and the baseline itself reject an existing application schema.
The wrapper rejects it before invoking the library or creating bookkeeping.
An already-baselined database skips this migration through the normal history.

## Future migrations and rollback

```powershell
npm run migrate:create -- describe-change
```

This creates a timestamped `.mjs` file locally without a database connection.
Unimplemented `up` and unreviewed `down` both throw, so a forgotten stub cannot be
marked as a successful migration. Use the node-pg-migrate builder API to implement
the change. Review the SQL, test it on a separate disposable/restored database,
back up the store, and apply explicitly in a maintenance window:

```powershell
npm run migrate:up -- --database pos_store
```

The runner uses node-pg-migrate's migration lock, ordering checks, and a single
transaction for ordinary transactional migrations. A failed migration rolls back
that transaction. The library creates bookkeeping before that transaction on a
fresh installation; if migration DDL fails, an empty history table can remain and
is supported on retry. Nontransactional operations such as concurrent indexes
need separate review; do not add `noTransaction()` casually.

`migrate:check` compares the baseline schema before adoption and while the baseline
is the only applied migration. After later migrations have been recorded, it
checks history and reports that comparison against the original schema is no
longer applicable. Include version-specific schema checks with future changes;
do not mutate the immutable baseline snapshot to make new schemas match it.

```powershell
# Only for a separately reviewed, safe reversal of a later migration:
npm run migrate:down -- --database pos_store
```

`down` selects one most recent migration. **Baseline down is intentionally blocked**
both in the wrapper and the migration itself; there is no inferred teardown.
Never roll back the production baseline, invoice numbering sequence, idempotency
protection, or schema holding customer/sales/refund/audit history. Dropping a new
column after it contains data is not a safe reversal. Prefer a reviewed forward
correction in production. Restoring a backup is a separate recovery procedure
that can lose transactions after the backup; it is not an ordinary migration down.

## Implementation validation boundary

Unit tests use in-memory metadata fixtures and compile SQL with the actual pinned
migration library without executing it. Static checks and read-only check/status
are safe to run against the current store. Fresh-database application, live
baseline registration, and real rollback have **not** been executed as part of
this implementation and require a separately authorized validation/deployment step.
