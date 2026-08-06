# Employee Access Update

## Included
- Admin **Employees** tab.
- Private employee signup page at `/employee-signup/`.
- Pending/approved employee workflow.
- Employee assignment field on order tickets.
- Employee login restricted to orders assigned to that employee.
- Existing orders are automatically backfilled with empty `assignedEmployeeId` and `assignedEmployeeName` fields. No existing status, payment, customer, item, or date fields are changed.

## Required Firebase deployment
Deploy the updated Firestore rules before testing employee accounts:

```bash
firebase deploy --only firestore:rules
```

The repository currently uses `firestore.rules.sample`. Copy its contents into the active Firebase rules file used by your deployment if your Firebase CLI is configured to another filename.

## First login after deployment
The first existing authenticated account that logs in after this update claims the administrator profile. Log in with the current owner/admin account before sending the employee signup link.

## Employee flow
1. Admin opens **Employees** and clicks **Copy Signup Link**.
2. Employee completes signup and receives `pending` status.
3. Admin approves the employee.
4. Admin edits an order and selects the employee under **Assigned Employee**.
5. Employee signs into the normal admin login and sees only assigned orders.
