# Firestore Targeted Writes v27

This release removes routine collection-wide save behavior from Admin load and common admin actions.

- Admin `loadData()` is read-only. Runtime normalization no longer writes orders, tracking records, or audit records.
- Quick Quote submissions now include tracking and access codes at creation and create only their own tracking snapshot.
- Inventory create/edit writes only the affected inventory document.
- Inventory delete deletes only the affected inventory document.
- Deposit-threshold changes save only orders whose derived deposit/payment fields actually changed.
- Cost collection saves no longer refresh `updatedAt` on every row, so unchanged cost records no longer become writes.
- Full order/inventory synchronization remains only in the explicitly confirmed backup-import workflow.

Expected console version: `ADMIN VERSION: targeted-firestore-writes-v27`
