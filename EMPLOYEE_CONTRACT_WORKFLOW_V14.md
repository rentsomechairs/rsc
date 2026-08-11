# Employee Contract Workflow v14

## Contract setup
- Company legal name is fixed to **Rent Some LLC**.
- The employee's signup first/last name is shown when they first open Contract Agreement.
- The employee must confirm or replace that name with the legal name they want on the contract.
- At the same prompt, the employee selects one payout preference:
  - Every completed transaction
  - $500 threshold
  - $1,000 threshold
  - Every 2 weeks
  - Every month
- The employee can later request/change the saved preference from Documents; company approval of an actual payout-method change remains part of the contract language.

## Admin contract terms
The contract editor no longer asks for company/contractor names or payout schedule. It now includes the five employee-specific percentage fields:
- Employee % for unqualified units
- Qualified Unit allocation %
- Company % for unqualified units
- Employee % for Qualified Units
- Company % for Qualified Units

Saving the contract also saves those percentages as the employee's active Payment settings.

## Employee order progress
Employees can now:
- set Exchange Time
- set Return Time
- advance assigned orders to In-Progress
- mark assigned orders Completed

They cannot change customer information, equipment, assignment, pricing, fees, dates, or other order fields.

Marking a non-free order Completed also marks it Paid. A Firestore-triggered Cloud Function synchronizes completed non-free order income so employee completion follows the same financial rule as admin completion.

## Employee Payments
Payments now includes **Upcoming order projections** for Confirmed and In-Progress assigned orders. Each projection shows:
- projected employee payout
- projected Qualified Unit allocation
- projected company share

Delivery fees, setup fees, and tips are now included as 100% employee earnings in both paid history and projections.

## REQUIRED DEPLOYMENT
This version changes Firestore permissions and adds/updates a Firebase Function.

1. Publish the rules from `FIRESTORE_RULES_COPYPASTE.txt`.
2. Deploy functions:
   `firebase deploy --only functions`
3. Upload the website files to GitHub Pages.

The Firestore rules allow employees to change only their own contract acceptance field and the limited assigned-order progress fields listed above.
