# v9 CORS fix

## Finance reset
`Nuke All Finances` no longer calls a Cloud Function. The signed-in owner is reauthenticated with the entered Firebase password and the browser deletes only the owner's finance records directly through Firestore in batches of 200. This avoids the Cloud Functions CORS failure entirely.

The confirmation phrase and final acknowledgement remain required.

## Employee Authentication deletion
Employee Authentication deletion still requires Firebase Admin privileges. The backend is now an explicit HTTPS `onRequest` function that:
- handles OPTIONS preflight,
- returns CORS headers,
- accepts localhost and GitHub Pages browser origins,
- requires a current Firebase ID token,
- verifies the token UID is the hard-coded owner UID,
- refuses to delete the owner account.

Redeploy functions after uploading v9:
`firebase deploy --only functions`

The old `nukeFinancialRecords` Cloud Function is no longer used and may be deleted from Firebase if it remains deployed.
