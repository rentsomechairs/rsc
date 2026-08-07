# Master Financial CSV v11

The Finance > Reports tab now uses one master Financial CSV rather than separate per-record CSV tools.

## Import
Every row requires `record_type`. Supported values:
- expense
- income (non-order income only)
- mileage
- vehicle
- asset
- incident
- homeOffice (also accepts `home_office` or `home office`)

Readable names are preferred instead of Firebase IDs. For example:
- category: `Equipment and inventory`
- vehicle: `2003 Chevy 3500`
- asset: `White Folding Chairs`

Vehicle, asset, and incident rows are imported before dependent expense/mileage rows so the same CSV can establish references and then use them.

Missing fields are allowed. Imported records default to `Needs information` / `Needs review` so the existing review workflow can catch incomplete history.

## Orders
Rental-order income should not be entered in the Financial CSV.

Use **Sync Completed Orders to Income** on the Financial Dashboard. It:
1. scans the Orders collection,
2. includes every order with status `Completed`,
3. excludes `Free` and $0 orders,
4. writes one deterministic income record per eligible order,
5. updates existing order income to match the order,
6. removes stale generated order-income records if an order is no longer eligible.

The existing automatic behavior when an order is newly marked Completed remains in place.
