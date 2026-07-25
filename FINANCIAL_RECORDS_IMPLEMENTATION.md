# Financial Records Implementation

## Files added
- `finance/index.html` — financial dashboard, record lists, forms, categories, reports, review queue, and trash.
- `assets/js/finance-app.js` — UI, calculations, validation flags, CSV exports, editable categories, attachments, and soft-delete workflows.
- `assets/js/finance-service.js` — isolated Firestore document CRUD, owner-scoped queries, Storage uploads, and lightweight audit entries.
- `firestore.indexes.json` — required owner/year/date indexes.

## Files changed
- `admin/index.html` — added a Financial Records navigation link.
- `firestore.rules.sample` — added owner-scoped rules for all financial collections.
- `storage.rules.sample` — added owner-scoped rules for financial attachments.

## Collections
- `financeExpenses`
- `financeIncome`
- `financeMileage`
- `financeVehicles`
- `financeAssets`
- `financeIncidents`
- `financeHomeOffice`
- `financeCategories`
- `financeMileageRates`
- `financeAttachments`
- `financeAudit`

Every normal financial record is a separate document. Common indexed fields include `ownerId`, `companyId`, `recordType`, `taxYear`, `date`, `categoryId`, `reviewStatus`, `documentationStatus`, and `archived`. Related records use IDs instead of embedded copies.

## Storage
Files are uploaded to `finance/{uid}/{recordType}/{recordId}/...`. Firestore stores metadata and the Storage reference/download URL only. Attachments load only when a record is edited.

## Migration
No migration is required. Existing orders, inventory, settings, costs, reviews, tracking, and related records are unchanged. The editable starter categories are created only when the signed-in user has no finance categories.

## Deployment
1. Merge the added Firestore matches into the active Firestore rules and deploy them.
2. Merge the Storage match into the active Storage rules and deploy it.
3. Deploy `firestore.indexes.json` or create the listed indexes from Firebase console links if prompted.
4. Upload the site files normally.

## Testing
1. Sign in through Admin and open Financial Records.
2. Add/edit/duplicate/archive/restore one record of each type.
3. Confirm mixed-use expense business-portion calculation preserves total amount.
4. Confirm gross income, processing fee, and net deposit remain separate.
5. Upload an attachment and verify it is stored under the owner-specific Storage path.
6. Add and edit categories/subcategories.
7. Verify dashboard totals and CSV exports for a selected year.
8. Confirm existing Admin, Orders, Inventory, Quick Picker, Gallery, Reviews, and Tracking pages still load.
