# Employee Equipment Allocation + Labor Estimates v19

## Employee equipment allocation
Employee cards no longer list every company inventory item by default.

Equipment Allocation now contains **Add Equipment**:
1. choose a category,
2. choose an equipment item,
3. set assigned quantity and unit cost,
4. save the allocation.

Equipment choices use the same usage-aware ranking as the order equipment picker, so commonly rented items appear first within a category.

## Inventory handling times
Each inventory item now has three optional per-unit averages, stored in minutes:
- Average cleaning time
- Average loading time
- Average unloading time

These fields do not change rental pricing or availability. They are used only for labor/hourly-rate estimates.

## Employee exchange time
Each employee profile has an admin-controlled **Average exchange time** in minutes.

Pickup labor estimates use this value twice:
`average exchange time × 2`
(one initial exchange and one return exchange).

## Estimated employee hourly rate
Paid-order rows and Upcoming Order Projections on the employee Payments tab now show:
`estimated employee earnings ÷ estimated labor hours`

Estimated labor time is:

### Pickup
`sum(quantity × (cleaning + loading + unloading)) + (employee average exchange time × 2)`

### Delivery
`sum(quantity × (cleaning + loading + unloading)) + (delivery fee ÷ 0.4175)`

The delivery formula follows the business pricing rule supplied for delivery time:
- $33.40 delivery fee ÷ 0.4175 = 80 total driving minutes
- this represents four 20-minute driving legs

The hourly figure is explicitly an estimate. Missing handling/exchange values simply contribute 0 minutes.

No Firestore rules or Firebase Functions changes are required. The new timing values are fields on existing inventory and employee documents.
