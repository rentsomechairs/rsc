# Qualified Unit Same-Day Priority v24

## Previous behavior
Completed payout calculations were ordered by completion/update timestamps.
Upcoming projections were calculated independently, so one projected order did not unlock Qualified Units for another projected order.

## New behavior
Employee payout processing uses the rental exchange date as the processing day.

Within the same exchange date:
1. orders are sorted by equipment-rental value from largest to smallest,
2. the largest order is processed first,
3. Qualified Unit progress created by that order carries into the next order,
4. later same-day orders can therefore use newly Qualified Units.

This ordering is used by both the final completed ledger and Upcoming Order Projections so the two views use the same logic.

Delivery/setup/tip amounts are intentionally excluded from the "largest order" comparison because they are 100% employee earnings and do not create Qualified Unit progress.

## Projection visuals
Same-day projections display:
- processing priority (e.g. Same-day priority 1 of 2),
- "Largest equipment order first",
- green chips when the order uses already-qualified units,
- amber chips when the order unlocks new Qualified Units for later orders.

Example:
`+1 🪑 White Folding Chair at qualified rate`

No Firestore rule or Firebase Function changes are required.
