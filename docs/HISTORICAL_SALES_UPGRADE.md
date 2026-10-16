# CT barcode fixes and Historical Sales Reports — CapyTech POS v2 upgrade and import

This runbook covers the combined CT barcode checkout/printing fixes and isolated
Historical Sales Reports release. The approved **pre-documentation candidate** is:

```text
28212b7ac4c19e91b3356ec74cd23ed588e9c0e8
```

Because this runbook update changes the Git commit, that candidate is not the final
deployable SHA. After the documentation change has been reviewed and committed,
record and approve the resulting full **final release SHA** in the deployment record.
Every release checkout and client fast-forward must resolve to that final SHA; do not
deploy by a moving branch name.

This runbook is only for the installed v2 shop at `~/capytech-pos-v2`, using database
`capytech_pos_v2`, role `capytech_v2_user`, backend port `4001`, and frontend port
`5174`. The original installation at `~/capytech-pos-shop` and its `pos_store`
database are out of scope and must remain untouched.

Do not run either fresh installer: `Install CapyTech POS.command` and
`Install CapyTech POS V2.command` are both prohibited for this upgrade. Do not use
the generic `Update CapyTech POS.command`: it is not the v2-specific workflow. Use
only the reviewed manual v2 procedure below. Do not copy the archive into the
repository, edit its CSV files, restore the old shop dump, or connect the v2
application to `pos_store`.

The commands below are future operator actions. They were not run during feature
implementation. Substitute only the reviewed release folder and approved final
release commit; do not substitute a database name. No client-installation file may
be modified until the maintenance window has begun and the v2 backup in section 2
has been created and successfully restore-verified.

## 0. Release approval gate

Before production deployment is approved, the exact final release checkout must
pass all self-contained backend and frontend tests, backend syntax checks, TypeScript
typecheck, frontend production build, ESLint, and `git diff --check`. It must also
pass, against explicitly named disposable databases only:

- every guarded PostgreSQL integration suite in `backend/scripts/*.integration.test.mjs`;
- the Playwright suite using a dedicated database whose name matches
  `^capytech_e2e_[a-z0-9_]+$` and a loopback database host; and
- backup restore plus pending-migration rehearsal against an isolated
  `capytech_verify_*` database.

A skipped or unavailable database integration or Playwright suite is **NOT RUN**, not
a pass, and blocks deployment approval. Never point a test variable at
`capytech_pos_v2` or `pos_store`, and never use production credentials for testing.

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
ancestor `dbcfd0d1126408d59343aea9351129a38d779031`. Record the installed SHA, the
approved final release SHA, and their ancestry check in the deployment record. The
migration commands are read-only. Stop if `backend/.env` does not identify
`capytech_pos_v2` and
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
  --test-migrations \
  --admin-assisted \
  --admin-user phyowaiaung
```

The two administrator flags are an explicit opt-in for this Mac, where the restricted
`capytech_v2_user` role does not have `CREATEDB`. The verifier uses `phyowaiaung`
only to create a uniquely generated and validated `capytech_verify_*` database owned
by `capytech_v2_user`, and to drop that same database after successful verification.
If PostgreSQL requests the administrator password, enter it only at the terminal
prompt. Never put it in this command, export it as `PGPASSWORD`, add it to either
`.env`, or save it inside the backup. The verifier removes inherited `PG*` variables
from the administrator subprocesses. Restore, protected-data comparisons, and
migration rehearsal continue to authenticate exclusively as `capytech_v2_user` with
the application credentials copied into the backup.

On success, confirm the verifier reports that it removed the isolated database and
that `RESTORE-VERIFIED.json` records `isolatedDatabaseCleanup` as `removed`. The
receipt is written only after cleanup succeeds. With an intentional
`--keep-database`, the successful receipt instead records `retained-by-request`.

On any restore, comparison, migration, or cleanup failure, record the exact generated
`capytech_verify_*` name printed by the verifier and leave that database in place for
investigation. Cleanup after a failed rehearsal is never automatic. Only after the
investigation is complete and removal has been separately approved, set the exact
recorded name below, require the complete `^capytech_verify_[a-z0-9_]+$` pattern,
explicitly reject both live database names, confirm the name a second time, and remove
only the quoted database:

```bash
verification_database='capytech_verify_RECORDED_SUFFIX'

if [[ ! "$verification_database" =~ ^capytech_verify_[a-z0-9_]+$ ]]; then
  echo "Refusing unsafe verification database name."
  exit 1
fi
if [[ "$verification_database" == 'capytech_pos_v2' || "$verification_database" == 'pos_store' ]]; then
  echo "Refusing to remove a live database."
  exit 1
fi
read -r -p "Type the exact verification database name to approve removal: " confirmation
if [[ "$confirmation" != "$verification_database" ]]; then
  echo "Confirmation did not match. Nothing was removed."
  exit 1
fi

dropdb --host 127.0.0.1 --port 5432 \
  --username phyowaiaung --maintenance-db postgres --if-exists \
  "$verification_database"
```

Never substitute `capytech_pos_v2`, `pos_store`, or any other database name in the
verification or cleanup commands, and never run this cleanup merely because a
rehearsal failed.

Proceed only if `RESTORE-VERIFIED.json` is created and reports both protected-data
matching and migration testing as successful. The rehearsal must show the four new
historical tables are empty and that active sales, inventory, images, users,
settings, invoices, and every protected sequence—including `invoice_number_seq`—are
unchanged. Do not modify the client checkout, install dependencies there, or apply a
migration until this verified v2 backup and isolated restore rehearsal have passed.

## 3. Install the reviewed code without the installer

The reviewed release must be a clean Git checkout of this repository, with a commit
approved for deployment. Record its full post-documentation commit as
`APPROVED_RELEASE_COMMIT`; it must not still be the pre-documentation candidate SHA.
Create a rollback branch in the v2 installation, fetch that exact reviewed commit
from the separate release folder, and require a fast-forward:

```bash
cd "$HOME/capytech-pos-v2"
git branch "rollback/pre-ct-history-$(date +%Y%m%d-%H%M%S)" HEAD
git fetch "/absolute/path/to/reviewed/capytech-pos-release" APPROVED_RELEASE_COMMIT
git merge --ff-only APPROVED_RELEASE_COMMIT

cd backend
npm ci
cd ../frontend
npm ci
npm run typecheck
npm run build
```

After the merge, confirm `git rev-parse HEAD` exactly equals the recorded final
release SHA before continuing. Do not copy or replace `backend/.env`,
`frontend/certs`, `backend/storage`, the
product-image directory, or `backups`. Do not run `Install CapyTech POS V2.command`,
`Install CapyTech POS.command`, `scripts/install-shop-v2.mjs`,
`scripts/install-shop.mjs`, or `scripts/prepare-customer-shop.mjs`. Do not run the
generic `Update CapyTech POS.command`.

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

### CT and CP barcode acceptance

Perform these checks without completing a production sale. Cancel any product or
physical-unit confirmation after verifying its identity.

1. In POS checkout, manually enter `CT000003` and press Return. Confirm it resolves
   the exact available physical unit for **Aula S12 pro 1000hz**, variant **White**,
   manufacturer serial **MSS12ProBk260800851**. It must not display “Product not
   found,” fall back to a CP/product lookup, or select another unit.
2. Scan an available CT label through each supported input path at the actual till:
   the USB barcode scanner, built-in camera scanner, and wireless phone scanner.
   Each path must resolve the same exact stock unit, product, variant, and serial.
3. Scan representative CP product and variant barcodes. Confirm their existing
   catalog lookup and cart behavior is unchanged and that a serialized product still
   requires selection of its unique CT unit.
4. Scan or manually enter known sold, retired, quarantined, assigned, inactive, and
   otherwise unavailable CT units where such test records are safely available.
   Every ineligible unit must be rejected before it enters the cart. Do not alter a
   production unit merely to manufacture a test state.
5. From Stock Units, open **Print CT Barcode** for `CT000003`. Confirm the popup shows
   the exact CT code, product, White variant, and manufacturer serial. Open print
   preview, cancel it, close or reuse the popup as appropriate, return to Stock Units,
   reopen the label, and repeat printing and cancellation several times. The Stock
   Units page and print controls must remain responsive with no automatic reprint or
   repeated dialog loop.
6. Verify the physical and previewed label is **50 mm × 30 mm**, is not clipped, and
   is printed at 100%/actual size without browser “fit to page” scaling. Confirm the
   Code 128 bars, human-readable `CT000003`, product/variant line, and serial remain
   legible on the client printer. Scan the newly printed label through the USB
   scanner and confirm it resolves `CT000003` exactly; cancel before sale.

Any mismatch, freeze, duplicate print dialog, wrong unit, unavailable-unit acceptance,
or CP regression blocks reopening the till. Record the browser, scanner path, printer,
label stock, observed CT/CP code, and result in the deployment record.

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

## 8. Failure and combined-release rollback

- Validation failure: correct the operator's file selection or obtain a corrected
  archive from the record owner. Never edit the source CSVs in place.
- Import failure: the transaction rolls back all four historical writes. Preserve the
  error message and application logs, which intentionally omit CSV contents. Retry
  only after the cause is understood.
- Different-archive refusal: stop and design a separately reviewed replacement
  workflow. Do not delete/truncate tables or disable immutability triggers.
- Application, CT lookup, or printing failure before any new v2 transaction: stop v2,
  switch to the recorded `rollback/pre-ct-history-*` branch, run `npm ci` in backend
  and frontend, and start the old application. Verify that the checked-out SHA equals
  the recorded pre-update SHA before starting. The old code ignores the additive
  historical tables; do not drop them or run a down migration.
- Migration failure: its transaction rolls back. Do not run `migrate:down`, manually
  drop tables, rerun the installer, or reset a sequence.
- Suspected active-data change: stop v2 and investigate against the verified manifest.
  Do not continue sales or import again.

Restoring a backup is disaster recovery, not routine rollback, and can lose later
transactions. Never restore over the existing v2 database and never restore into
`pos_store`. A separately approved recovery must first restore to a new isolated
database, verify it, preserve the failed database, stop all writers, and reconcile
every post-backup v2 transaction before any cutover.

For a normal code rollback before new active sales, use the recorded rollback branch:

```bash
cd "$HOME/capytech-pos-v2"
git status --porcelain=v1 --untracked-files=all
git switch rollback/pre-ct-history-TIMESTAMP
cd backend && npm ci
cd ../frontend && npm ci
```

Start only `Start CapyTech POS V2.command`, then repeat the read-only v2 data checks.
If the historical archive was already imported, leave it intact; the previous code
does not query those tables. Never delete or truncate archived rows to make rollback
appear clean. If any new current sale, refund, void, stock change, or other live write
occurred after the upgrade, do not switch application versions or restore a database
until a new verified backup has been made and those writes have been explicitly
reconciled.
