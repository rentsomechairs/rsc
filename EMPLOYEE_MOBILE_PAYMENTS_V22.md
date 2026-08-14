# Employee Mobile Navigation + Payments v22

## Mobile navigation
Employees now receive a dedicated fixed bottom navigation bar for:
- Orders
- Payments
- Documents

It is enabled through 1024px viewport width so it remains available on iOS/iPad Safari even when Request Desktop Website produces a tablet-sized CSS viewport. The bar uses iOS safe-area insets.

The normal desktop employee sidebar remains available on larger desktop viewports.

## Completed earnings rule
The actual employee payment ledger now requires:
- assigned to employee
- status == Completed
- paid amount > 0
- not Free

An order that is Confirmed or In-Progress but already marked Paid remains only in Upcoming Order Projections. It does not appear in Completed Order Breakdown and does not increase the earned balance until status becomes Completed.

## Earned balance bubble
A compact Balance bubble appears beside the notification bell in employee view. It shows employee earnings recognized from completed orders only.

## Payments visual redesign
The Payments page now includes:
- prominent completed-order earnings header
- overall Qualified Unit progress bar
- compact summary cards
- graphical payout split bars
- equipment-specific progress cards with overall and next-unit progress bars
- polished Upcoming Order Projection cards
- polished Completed Order Breakdown cards

No Firestore rule, schema, or Firebase Function changes are required.
