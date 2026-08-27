# Update V34 — Employee deletion CORS fix

- Replaced the admin employee-deletion frontend call with a Firebase callable function.
- Added `deleteEmployeeAuthCallable` in `functions/index.js`.
- Callable authentication checks the signed-in Firebase user and restricts deletion to the owner UID.
- Existing `deleteEmployeeAuth` HTTP function remains in place for compatibility, but the admin UI no longer uses it.
- Cache-busting version updated to `rental-ux-v35`.

## Deployment

Deploy both the site files and Cloud Functions. The new callable function must exist in Firebase before employee deletion will work.
