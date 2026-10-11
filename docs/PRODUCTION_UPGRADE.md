# Production-safe macOS upgrade

This runbook is for an **existing CapyTech POS installation with real store data**. It is not an installation guide. Never run `Install CapyTech POS.command` or `scripts/prepare-customer-shop.mjs` against an existing shop. Those workflows are only for a new, empty shop.

The database, image directory, `.env`, certificates, backups, and browser profile are part of the installation. The update must be performed during a maintenance window with the POS stopped and no sales in progress.

## Information required before scheduling the update

Record and review all of the following on the MacBook Air without changing anything:

- Absolute path of the existing installation and the deployed Git commit (`git rev-parse HEAD`).
- `git status --porcelain=v1 --untracked-files=all`; source changes require a separate reconciliation plan.
- PostgreSQL server and client-tool versions, available disk space, and whether the database role can create an isolated verification database.
- The database host, port, and name from `backend/.env` (do not copy its password into tickets or chat).
- Output of `npm run migrate:status` and `npm run migrate:check` from `backend`; both are read-only.
- The resolved `PRODUCT_IMAGES_DIR`, its size/file count, and whether every database image reference opens in the POS.
- Current counts for users, products, variants, customers, sales, sale items, audit records, and notifications; current stock digest; latest invoice number; and every protected sequence value.
- Location and free space of a writable external backup volume, plus a current Time Machine status.
- The browser/profile used at the till, because unsold cart drafts live in browser local storage for the existing HTTPS origin.
- An administrator login for post-update verification and an agreed maintenance/rollback window.

Do not proceed if the current commit is not an ancestor of the reviewed update, the working tree is dirty, migrations report drift, PostgreSQL tools are unavailable, the POS is still running, the image root is missing, or there is insufficient space for the local backup, external copy, and isolated restored database.

## Prepare the reviewed release

1. Put the reviewed release in a **separate folder** from the live installation.
2. Confirm that the release commit is approved and its working tree is clean.
3. Run all tests and builds documented in the release report.
4. Ensure `Update CapyTech POS.command` is executable (`chmod +x "Update CapyTech POS.command"`).
5. Keep the live installation, release folder, and backup volume connected until verification finishes.

The dedicated updater refuses to run outside macOS. It never calls the installer or customer-preparation scripts and never replaces the live `.env`, product-image directory, or backup directory.

## Backup and restore rehearsal

Close CapyTech POS first. From the reviewed release folder, a technical operator can run the same guarded steps independently before using the updater:

```bash
node scripts/backup-shop.mjs --root "/absolute/path/to/existing/capytech-pos"
node scripts/verify-backup.mjs \
  --backup "/absolute/path/to/existing/capytech-pos/backups/CapyTech_TIMESTAMP" \
  --test-migrations
```

The backup script:

- reads the live `backend/.env` and resolves `PRODUCT_IMAGES_DIR` using the same backend-relative rules as the application;
- makes a custom-format PostgreSQL dump without changing the database;
- captures counts/digests for protected tables, stock, invoices, image references, and sequence values;
- copies the complete image root, including product files, trash, and sidecar metadata;
- copies `.env`, frontend certificates, launchers, dependency lockfiles, and Git revision/status metadata;
- writes SHA-256 checksums and immediately verifies them;
- writes `BACKUP-COMPLETE.json` only after those checks pass; and
- copies the completed folder to every writable external macOS volume it finds and re-verifies its checksums.

The restore verifier does not trust a successful dump command. It verifies SHA-256 hashes, creates a uniquely named `capytech_verify_*` database, restores the dump with `--single-transaction --exit-on-error`, compares protected data and image references, applies pending migrations only to that isolated database, and verifies that historical rows, stock, invoices, images, and sequences are unchanged. Failed verification databases are retained for diagnosis. A successful one is removed unless `--keep-database` is supplied.

The backup does not export Safari/Chrome private local storage. Keep the existing browser profile and `https://localhost:5173` origin unchanged, and retain a Time Machine backup. The authentication fix removes only the stored user and token; it does not clear the cart-draft key.

## Run the update

1. Confirm the store is closed and both POS ports are stopped.
2. Double-click **Update CapyTech POS.command** in the separate reviewed release folder.
3. Drag the **existing** CapyTech POS folder into the prompt and press Return.
4. Read every preflight result. Any failure stops the update; do not bypass it.
5. The updater installs/builds the candidate, creates and restores a new backup, rehearses the migration in the isolated database, records a live read-only manifest, applies only reviewed migrations to the configured database, checks protected data again, creates a rollback branch, and fast-forwards the application source.
6. Do not reopen the counter until the verification below is complete.

The warranty migration is additive and forward-only: it adds a nullable, default-free `sales.warranty_months` column plus a value constraint. Existing invoice rows remain `NULL`; no row is updated and no sequence is reset.

## Post-update verification

Using read-only screens and queries first, compare the preflight manifest and backup manifest with the live installation:

- All protected table counts and content digests match.
- Products, categories, customers, users/roles, settings, and historical sales are present.
- Product and variant quantities match, including low-stock items.
- Historical invoice totals/statuses and the newest invoice number match.
- Every protected sequence, especially `invoice_number_seq`, has the same value/state.
- All active product images open; image trash and sidecar metadata remain present.
- `backend/.env` SHA-256 and the complete product-image directory SHA-256 listing are unchanged.
- Existing backups remain present and the new backup contains `BACKUP-COMPLETE.json` and `RESTORE-VERIFIED.json`.

Then start the POS, sign in, and verify dashboard, notifications, product images, sales history, and printing. An expired token should return to login with a friendly message while retaining the unsold cart draft. With an approved test transaction, verify automatic warranty boundaries, override/no-warranty choices, one invoice only on retry, stock decrement, and printed warranty text.

## Rollback

If startup or application verification fails **before any new sale is accepted**:

1. Stop CapyTech POS.
2. In the existing installation, switch to the rollback branch named in `backups/CapyTech_TIMESTAMP/UPDATE-RESULT.json`:

   ```bash
   git switch rollback/pre-update-TIMESTAMP
   cd backend && npm ci
   cd ../frontend && npm ci
   ```

3. Start the old application and repeat the read-only checks. The additive nullable warranty column may safely remain; the old application ignores it. Do not run migration-down because it intentionally refuses to drop the column.

If a migration transaction fails, PostgreSQL rolls it back and the updater stops before replacing application source. If verification detects protected-data drift, stop and investigate; do not continue automatically.

Restoring the production database from backup is a disaster-recovery action, not a normal application rollback. It can erase transactions created after the backup. Never restore over the live database while it exists. A separately approved recovery procedure must restore into a new database first, verify it, stop all writers, preserve the failed database under a different name, and explicitly reconcile any post-backup transactions.

If any new sales occurred after the update, do not switch versions or restore a database until those transactions have been reconciled and a new verified backup has been made.
