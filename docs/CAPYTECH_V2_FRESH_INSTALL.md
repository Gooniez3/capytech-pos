# CapyTech POS V2 fresh installation

This procedure creates an independent empty V2 shop. It does not upgrade or
import the original shop.

## Fixed identities

- Original folder: `~/capytech-pos-shop`
- Original database and role: `pos_store` / `pos_shop`
- Original ports: `4000` / `5173`
- V2 folder: `~/capytech-pos-v2`
- V2 database and role: `capytech_pos_v2` / `capytech_v2_user`
- V2 ports: `4001` / `5174`

Never copy the original `.env`, database dump, product-image directory, or
launchers into the V2 folder. Historical exports remain separate archives.

## Before installation

1. Make and verify a final backup of the original shop. Do not remove or rename
   the original folder, database, role, launchers, images, or backups.
2. Confirm ports 4001 and 5174 are unused.
3. Copy the reviewed release into exactly `~/capytech-pos-v2`.
4. Confirm `~/capytech-pos-v2/backend/.env` does not exist.
5. Confirm PostgreSQL has neither `capytech_pos_v2` nor `capytech_v2_user`.
   If either exists, stop for review; the installer never reuses it.

## Install

From Finder, double-click `Install CapyTech POS V2.command`. The installer:

- refuses Windows, non-macOS systems, and any folder other than
  `~/capytech-pos-v2`;
- installs locked dependencies before creating database resources;
- refuses database or role collisions;
- creates a least-privilege V2-only role and empty V2-only database;
- writes a private V2 `.env` with local PostgreSQL, V2 ports, and image storage
  inside the V2 folder;
- applies the reviewed migrations only to `capytech_pos_v2`;
- creates only V2-named Desktop launchers and never overwrites a different file.

## Interrupted installation

Do not delete or modify the original shop. Preserve the V2 folder and copy the
installer output. If `backend/.env`, `capytech_pos_v2`, or
`capytech_v2_user` exists after failure, do not rerun or manually reuse it.
An administrator must inspect that V2-only partial state and approve a scoped
recovery. Never drop `pos_store` or alter `pos_shop`.

## Acceptance

1. Double-click `Start CapyTech POS V2.command`.
2. Confirm the browser opens `https://localhost:5174` and the API uses port
   4001. The original POS may remain installed on 4000/5173.
3. Create the new owner account and verify admin/staff permissions.
4. Add one ordinary product and one serialized product, print CP/CT labels, and
   test USB, camera, and wireless-phone scanning.
5. Complete ordinary, serialized, and mixed checkouts. Verify exact prices,
   serial assignments, warranty snapshots, duplicate-submit protection, sales
   history, refund/void quarantine, and A4 printing.
6. Confirm the original shop still opens from its original launcher and its
   historical exports remain readable. Do not create test sales in the original.

## Backup and rollback

Stop V2, then double-click `Backup CapyTech POS V2.command`. V2 backups stay in
`~/capytech-pos-v2/backups` and use `CapyTech POS V2 Backups` on USB volumes.
Verify a V2 backup restoration before relying on it.

Before the first real V2 sale, rollback is simply to stop V2 and continue using
the untouched original installation. After V2 begins real sales, never delete
or recreate its database; preserve it and use a verified V2 backup for any
reviewed recovery.
