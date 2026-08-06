# Employee Access Cache Fix v3

This version cache-busts the complete admin module chain:

- admin/index.html -> app-admin.js?v=employee-access-load-fix-v3
- app-admin.js -> store.js?v=employee-access-load-fix-v3
- store.js -> firebase-service.js?v=employee-access-load-fix-v3

Upload all files, not only app-admin.js. Then hard-refresh the deployed admin page.
