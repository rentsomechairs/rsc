# Finance reset + employee Authentication deletion (v8)

## One-time Firebase Functions setup
These two actions require Firebase Admin privileges and cannot safely be performed from GitHub Pages/browser JavaScript.

1. Install Firebase CLI if needed: `npm install -g firebase-tools`
2. From this project folder run: `firebase login`
3. Select the existing project: `firebase use rent-some-light`
4. Install function dependencies: `cd functions && npm install && cd ..`
5. Deploy: `firebase deploy --only functions`

Firebase Cloud Functions generally requires the Firebase project to be on the Blaze billing plan.

## Restored Nuke All Finances
Financial Records > Dashboard now contains **Nuke All Finances**.
It requires:
- re-entering the currently signed-in owner's Firebase password,
- typing `DELETE ALL FINANCES`,
- checking the final permanent-delete acknowledgement.

The callable backend verifies the signed-in UID is the hard-coded owner UID before deleting finance collections and finance attachment files.

## Employee deletion
The Employees > Delete action now:
1. unassigns the employee's orders,
2. calls `deleteEmployeeAuth` to delete the Firebase Authentication user,
3. deletes the employee Firestore profile.

The backend verifies the caller is the owner and refuses to delete the owner UID.
