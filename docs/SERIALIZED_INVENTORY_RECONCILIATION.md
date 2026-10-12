# Serialized Inventory Reconciliation

## Legacy-sale return after serialization

This procedure applies when a sale was completed as quantity-based inventory and
the product or variant was later converted to serialized tracking. The historical
sale has no stock-unit assignment or serial snapshot. A refund or void therefore
fails closed rather than increasing the tracked aggregate quantity without a
matching available stock unit.

1. Stop the refund or void when the API reports that serialized assignments are
   incomplete. Do not retry through a legacy endpoint or edit `stock_quantity`.
2. Keep the returned physical item out of sellable inventory. Label it with the
   invoice number, product/variant SKU, observed manufacturer serial number, and
   the date and staff member who received it.
3. Record the attempted action and reason through the shop's operational incident
   log. Preserve the original invoice and do not alter its warranty or line-item
   snapshots.
4. Create and verify a complete backup using the production upgrade procedure,
   including a successful isolated restoration, before any corrective work.
5. In read-only mode, collect the sale, sale item, current policy, aggregate
   quantity, available-unit count, lifecycle history, and normalized-serial
   collision result. If any identity or count is uncertain, leave the item
   isolated and escalate for review.
6. Do not use receive, adopt, release, direct SQL, a sequence reset, or a temporary
   policy change as a workaround. Those operations cannot reconstruct the missing
   historical identity safely and may make sellable quantity inconsistent.
7. Prepare a separately reviewed, tested, transaction-safe reconciliation change.
   It must preserve the original sale and invoice, register the observed unit in
   quarantine without increasing sellable quantity, append auditable lifecycle
   history, and make the refund/void outcome explicit. Rehearse it against a
   restored copy of the affected database and compare protected-data manifests.
8. Apply an approved correction only during a controlled maintenance window with
   writers stopped. Verify aggregate quantity versus available units, the unit's
   quarantined state, invoice history, audit history, and all relevant sequences
   before reopening the POS.

Until such a corrective workflow is implemented and approved, the safe outcome is
to leave the database unchanged and the physical item quarantined outside sellable
stock.
