# Employee Access v4

- Assigned pickup orders now store `assignedEmployeePickupAddress`.
- Reminder messages use the assigned employee pickup address.
- `orderTracking` snapshots use the same assigned employee pickup address.
- Employee cards include Delete Employee.
- Deleting an employee removes the Firestore `users/{uid}` profile and unassigns their orders.

Note: browser Firebase cannot delete another person’s Firebase Authentication credential. Removing the Firestore profile immediately removes application access under the included rules. The Auth user can be permanently removed later from Firebase Console > Authentication > Users if desired.
