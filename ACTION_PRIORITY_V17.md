# Action Priority v17

1. Quick Peek is now a single gallery sorted from most-rented to least-rented across all inventory, not grouped by category. Cards are roughly half the previous visual size.
2. Order emojis are restored for Delivery, Paid, Deposit Paid, and missing contact information.
3. Expanded orders receive a clear active outline/shadow so the entire expanded object is visually contained.
4. Each employee now has an Order Highlight Color setting. Assigned orders use that employee's selected color in Admin.
5. Active order sorting is based on the next action:
   - Pending/Confirmed => exchange date/time
   - In-Progress => return date/time
   In-Progress cards also display Return instead of Exchange in the collapsed summary.

No Firestore rules or Firebase Functions changes are required for this version. Employee highlight color is stored on the existing employee profile using the existing admin-only profile write access.
