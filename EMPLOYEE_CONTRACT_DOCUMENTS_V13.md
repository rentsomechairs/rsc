# Employee Contract + Documents + View As (v13)

## Admin > Employees
Each employee card now includes a Contract Agreement area:
- Create Contract / Edit Contract
- Contract status: Draft, Ready for Signature, Signed
- Company legal name
- Contractor legal name
- Effective date
- Payout method
- Threshold amount when applicable
- Fully editable contract body
- Load Blank Template

The blank agreement is generated from the business terms established for the contractor relationship. Employee-specific payment percentages and the current equipment assignment schedule are incorporated into the template. The saved agreement is stored on the employee's existing `users/{uid}` Firestore profile.

No new Firestore collection or security-rule change is required: the existing rules already allow the owner to write employee profiles and the employee to read their own profile.

## Employee > Documents
Employees now have:
- Orders
- Payments
- Documents

Documents contains a read-only Contract Agreement. If no agreement has been saved, it clearly says one has not been provided yet.

## Admin View As
Each employee card has a View as Employee button.
This does NOT sign in as the employee, exchange credentials, or alter Firebase Authentication. It keeps the owner session active and switches the UI through the same employee-facing rendering path:
- only assigned orders
- read-only order details
- Payments
- Documents
- admin menus/actions hidden

A banner appears at the top with Exit View As. Exiting returns directly to the Employees tab.
