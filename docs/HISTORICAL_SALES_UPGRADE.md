# Historical Sales Reports — CapyTech POS v2 upgrade and import

This runbook is only for the installed v2 shop at `~/capytech-pos-v2`, using database
`capytech_pos_v2`, role `capytech_v2_user`, backend port `4001`, and frontend port
`5174`. The original installation at `~/capytech-pos-shop` and its `pos_store`
database are out of scope and must remain untouched.

Do not run either fresh installer. Do not use `Update CapyTech POS.command` for this
v2 release: the current generic updater is not the v2-specific workflow. Do not copy
the archive into the repository, edit its CSV files, restore the old shop dump, or
connect the v2 application to `pos_store`.

The commands below are future operator actions. They were not run during feature
implementation. Substitute only the reviewed release folder and approved release
commit; do not substitute a database name.

## 1. Schedule and record the preflight

Use an approved maintenance window. Finish all current transactions, close the
window started by `Start CapyTech POS V2.command`, and confirm nothing is listening
on ports 4001 or 5174. Keep the original POS closed only if the store's operating
procedure requires it; none of these commands targets its folder, ports, role, or
database.

In Terminal:

```bash
cd "$HOME/capytech-pos-v2"
git status --porcelain=v1 --untracked-files=all
git rev-parse HEAD
cd backend
npm run migrate:status
npm run migrate:check
```

The Git status must be empty. Before this release, HEAD should be the approved
ancestor `dbcfd0d1126408d59343aea9351129a38d779031`. The migration commands are
read-only. Stop if `backend/.env` does not identify `capytech_pos_v2` and
`capytech_v2_user`, if schema drift is reported, or if any command mentions
`pos_store` or `pos_shop`. Never print or copy `DB_PASSWORD` or `JWT_SECRET` into a
ticket, terminal transcript, or chat.

## 2. Create and verify a v2 backup

With v2 stopped, double-click `Backup CapyTech POS V2.command` in
`~/capytech-pos-v2`. This launcher is intentionally v2-specific and refuses an
unexpected database, role, port, or running v2 process. Plug in the approved backup
volume first so it also receives a verified copy.

Identify the one new `~/capytech-pos-v2/backups/CapyTech_V2_*` folder. Confirm it
contains `BACKUP-COMPLETE.json`, then use the reviewed release's verifier to restore
and rehearse all pending migrations in a disposable `capytech_verify_*` database:

```bash
cd "/absolute/path/to/reviewed/capytech-pos-release"
node scripts/verify-backup.mjs \
  --backup "$HOME/capytech-pos-v2/backups/CapyTech_V2_TIMESTAMP" \
  --test-migrations
```

Proceed only if `RESTORE-VERIFIED.json` is created and reports both protected-data
matching and migration testing as successful. The rehearsal must show the four new
historical tables are empty and that active sales, inventory, images, users,
settings, invoices, and every protected sequence—including `invoice_number_seq`—are
unchanged.

## 3. Install the reviewed code without the installer

The reviewed release must be a clean Git checkout of this repository, with a commit
approved for deployment. Record its full commit as `APPROVED_RELEASE_COMMIT`.
Create a rollback branch in the v2 installation, fetch that exact reviewed commit
from the separate release folder, and require a fast-forward:

```bash
cd "$HOME/capytech-pos-v2"
git branch "rollback/pre-historical-sales-$(date +%Y%m%d-%H%M%S)" HEAD
git fetch "/absolute/path/to/reviewed/capytech-pos-release" APPROVED_RELEASE_COMMIT
git merge --ff-only APPROVED_RELEASE_COMMIT

cd backend
npm ci
cd ../frontend
npm ci
npm run typecheck
npm run build
```

Do not copy or replace `backend/.env`, `frontend/certs`, `backend/storage`, the
product-image directory, or `backups`. Do not run `Install CapyTech POS V2.command`,
`scripts/install-shop-v2.mjs`, or `scripts/prepare-customer-shop.mjs`.

## 4. Apply the additive migration

Keep v2 stopped. From the updated v2 folder, repeat the read-only checks and inspect
the target shown in their output:

```bash
cd "$HOME/capytech-pos-v2/backend"
npm run migrate:status
npm run migrate:check
npm run test:migrations
npm run migrate:up -- --database capytech_pos_v2
npm run migrate:status
```

The write command's explicit database argument must exactly match `DB_NAME` in the
existing v2 `.env`; it is a target assertion, not an override. The migration creates
only these empty tables:

- `historical_sales_archives`
- `historical_sales`
- `historical_monthly_summaries`
- `historical_all_time_summaries`

It adds indexes, foreign keys, checks, and update/delete/truncate rejection triggers.
It does not alter or populate `sales`, `sale_items`, payments, inventory, stock units,
products, users, or invoice sequences. The migration is transactional and has no
destructive down migration.

## 5. Start and verify before importing

Double-click `Start CapyTech POS V2.command`, open `https://localhost:5174`, sign in
as the owner, and perform read-only verification first:

1. Existing products, stock quantities, users, settings, customers, images, current
   reports, sales history, and invoices are present.
2. The latest v2 invoice number is unchanged.
3. Reports → Current Reports still loads.
4. Reports → Historical Sales shows the empty owner-only import workflow.
5. A cashier account receives HTTP 403/admin-required behavior for every historical
   report, preview, and import endpoint.

Do not create a test sale on the production shop merely to verify this feature.

## 6. Preview and import the archive

Keep the source files in
`~/capytech-historical-sales-archive-20261015/` unchanged. In Reports → Historical
Sales, select exactly:

1. `historical-sales.csv`
2. `monthly-sales-summary.csv`
3. `all-time-sales-summary.csv`

Choose **Validate & Preview**. Preview reads the upload in memory, enforces the
limits and reconciliation rules, and writes nothing. Review the displayed totals:

- total transactions: **14**
- completed transactions: **9**
- completed amount: **592,200 Ks**
- refunded transactions: **5**
- refunded amount: **201,700 Ks**
- September 2026: **1 / 75,000 Ks completed**, **3 / 42,200 Ks refunded**
- October 2026: **8 / 517,200 Ks completed**, **2 / 159,500 Ks refunded**

Completed amount is completed business only; do not subtract the separately shown
refund amount from it. If every value matches, choose **Review & Confirm Import**,
read the warning, and explicitly choose **Import Archived Sales**. The server
revalidates the same bytes and the short-lived signed preview token before beginning
one database transaction.

Submitting the identical archive again is a no-op success. A different archive is
refused; there is no replacement workflow. Historical invoice numbers are scoped to
the archive, so a number matching a current v2 invoice remains a separate record.

## 7. Verify isolation after import

In the Historical Sales tab, verify the all-time and monthly figures above, all 14
rows, invoice search, status filtering, and the `Archived / Legacy POS` label. Export
a CSV if required and confirm spreadsheet-leading formula characters are prefixed
safely. Legacy transaction date text is displayed without browser timezone shifting.

Then verify current Reports and Sales History still show only v2 transactions. Compare
the pre-upgrade protected-data manifest or recorded values for:

- active `sales` and `sale_items` counts and newest invoice;
- `invoice_number_seq` state;
- product/variant quantities and stock-unit states;
- inventory movements and receipts;
- users, settings, customers, image references, and current report totals.

Only the four historical tables should gain rows. No archived row can refund, edit,
delete, restore inventory, or generate a v2 invoice.

## 8. Failure and recovery

- Validation failure: correct the operator's file selection or obtain a corrected
  archive from the record owner. Never edit the source CSVs in place.
- Import failure: the transaction rolls back all four historical writes. Preserve the
  error message and application logs, which intentionally omit CSV contents. Retry
  only after the cause is understood.
- Different-archive refusal: stop and design a separately reviewed replacement
  workflow. Do not delete/truncate tables or disable immutability triggers.
- Application failure before any new v2 transaction: stop v2, switch to the recorded
  `rollback/pre-historical-sales-*` branch, run `npm ci` in backend and frontend, and
  start the old application. The old code ignores the additive historical tables.
- Migration failure: its transaction rolls back. Do not run `migrate:down`, manually
  drop tables, rerun the installer, or reset a sequence.
- Suspected active-data change: stop v2 and investigate against the verified manifest.
  Do not continue sales or import again.

Restoring a backup is disaster recovery, not routine rollback, and can lose later
transactions. Never restore over the existing v2 database and never restore into
`pos_store`. A separately approved recovery must first restore to a new isolated
database, verify it, preserve the failed database, stop all writers, and reconcile
every post-backup v2 transaction before any cutover.
