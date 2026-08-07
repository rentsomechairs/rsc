# Employee Inventory & Payments v5

## Added
- Equipment allocations per employee with quantity and per-unit equipment cost.
- Company inventory remains unchanged; main-location stock is company stock minus employee allocations.
- Public Quick Picker location selector with location-specific availability.
- Admin Quick Peek location selector (Company Total, Main, or employee location).
- Employee Payments tab with 65/30/5 payoff split and 95/5 paid-off split.
- Employee order expansion is compact/read-only.
- Employee-assigned orders are highlighted in admin.
- Financial Records and admin edit controls are hidden from employee accounts.

## Important
Publish the Firestore rules in FIRESTORE_RULES_COPYPASTE.txt. The new rules keep equipment allocation and payment fields admin-only.

## Calculation behavior
Payments are calculated from the amount actually marked paid on assigned orders. Equipment payoff is tracked by equipment type using the assigned quantity and unit cost. Paid-off units receive 95% on future recognized rental revenue; unpaid units receive 65%, 30% goes to equipment payoff, and 5% to the company.
