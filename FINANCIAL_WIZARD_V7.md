# Financial Wizard v7

- Completing a non-free order marks it Paid and synchronizes a deterministic income record (`financeIncome/order_<orderId>`).
- Free / $0 completed orders do not create income.
- Expense and income entry now use a step-by-step wizard.
- Expense connections are category-aware: vehicle fields only appear for vehicle-related categories; asset fields appear for equipment/inventory categories.
- Wizard steps can be skipped; incomplete records remain compatible with Needs information / review workflows.
- Existing finance collections and records remain compatible.
