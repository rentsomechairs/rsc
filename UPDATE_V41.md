# V41 — Employee payout requests

- Employee balance in the top-right is clickable for primary employee accounts.
- Request Payout modal supports All, rounded whole-dollar, rounded-to-$10, and custom amounts.
- Employees can save payout accounts with nickname, method, and payout details/link.
- Pending and paid payout requests reduce the available balance to prevent duplicate requests.
- Admin Employees page shows pending payout requests and can mark them Paid or Declined.
- Secondary logins cannot access payout controls.
- Firestore rules include the new `payoutRequests` collection while preserving V40 secondary-login and schedule permissions.
