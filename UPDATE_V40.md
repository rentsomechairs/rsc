# V40 — Secondary login, order location filter, calendar times, time-control hardening

## Added
- Employee-specific secondary-login invite links.
- Secondary signup requires primary employee approval before operational access.
- Primary employee can approve or revoke secondary access from Schedule.
- Approved secondary accounts can access the primary employee's assigned orders and schedule; Payments/Documents remain hidden.
- Orders location filter: All Locations, Main Location, or an approved employee location.
- Group equipment totals separate by location while All Locations is selected.
- Orders calendar starts each rental bar with exchange time and ends it with return time.
- Strong full-cell Today treatment and muted past dates in Orders calendar.

## Fixed
- Reworked full order editor date/time grid and widened the order modal so hour/minute/AM-PM/TBD controls cannot be clipped on desktop.
- Responsive time controls collapse cleanly at tablet/mobile widths.

## Firebase rule update required
Secondary login approval and delegated access use Firestore security rules, not Cloud Functions or Blaze.
Copy FIRESTORE_RULES_COPYPASTE.txt into Firebase Console > Firestore Database > Rules and publish it once when installing V40.
