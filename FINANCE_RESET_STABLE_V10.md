# Finance Reset Stable v10

The Nuke All Finances workflow no longer performs Firebase Storage folder listing from browser JavaScript.

Why:
Firebase Storage `listAll()` can fail CORS preflight from localhost and then retry/back off, leaving the reset button stuck on "Deleting…".

Current reset:
1. Re-authenticates the signed-in owner with the entered Firebase password.
2. Requires `DELETE ALL FINANCES` plus the final acknowledgement.
3. Deletes all owner finance Firestore records in batches of 200.
4. Returns immediately when Firestore deletion is complete.

Receipt files that were previously uploaded may remain as orphaned Storage objects, but their Firestore attachment records are deleted so they no longer appear or connect to Financial Records. Storage cleanup can be handled server-side separately without blocking the reset.
