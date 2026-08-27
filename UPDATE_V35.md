# V35 — Free-plan employee deletion

- Employee Delete no longer calls a Firebase Cloud Function.
- Delete removes the employee profile from Firestore and unassigns their orders.
- Because Firestore access requires an existing approved employee profile, the old Firebase Auth login no longer has employee access after the profile is deleted.
- The Firebase Authentication user itself remains in Authentication and can be manually deleted from the Firebase Console if desired.
- No Blaze plan or Cloud Functions deployment is required.
