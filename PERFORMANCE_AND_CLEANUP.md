# Performance and cleanup

- Admin startup now loads independent Firestore resources concurrently.
- Image library loading no longer blocks the start of other admin data requests.
- Firebase SDK modules initialize concurrently and share one in-flight initialization promise.
- Removed 52 historical notes and redundant rule copies. Kept FIRESTORE_RULES.txt, firestore.rules.sample, application assets, and deployment files.
- Open orders still use targeted status queries so completed archives remain unloaded until requested.

## Verification
Static syntax checks passed; live Firebase/authenticated browser timing was not available. Test admin, employee, image library, orders, and finance after deployment.

## Removed files
- UPDATE_V47.md
- CORS_FIX_V9.md
- UPDATE_V34.md
- CACHE_FIX_V3.md
- EMPLOYEE_CONTRACT_WORKFLOW_V14.md
- UPDATE_V43.md
- COMPLETED_REVENUE_FIX_V12.md
- EMPLOYEE_LABOR_ESTIMATES_V19.md
- UPDATE_V29.md
- MOBILE_SIDEBAR_V23.md
- DEPLOYMENT_CHECK.txt
- EMPLOYEE_V4_UPDATE.md
- FINANCE_RESET_AND_EMPLOYEE_AUTH_V8.md
- UPDATE_V45.md
- CLEANUP_NOTES.txt
- EMPLOYEE_FEATURE_DEPLOYMENT.md
- FRICTION_FLOW_V16.md
- UPDATE_V31.md
- FINANCIAL_CSV_V11.md
- UPDATE_V32.md
- FIRESTORE_TARGETED_WRITES_V27.md
- REMINDER_COPY_PASTE_UPDATE.md
- EMPLOYEE_COLOR_CONTROL_V18.md
- UPDATE_V35.md
- FINANCIAL_WIZARD_V7.md
- QUALIFIED_PRIORITY_V24.md
- FINANCIAL_RECORDS_IMPLEMENTATION.md
- UPDATE_V42.md
- UPDATE_V36.md
- EMPLOYEE_CONTRACT_DOCUMENTS_V13.md
- UPDATE_V46.md
- UPDATE_V50.md
- COHESIVE_UX_V15.md
- UPDATE_V39.md
- UPDATE_V44.md
- ACTION_PRIORITY_V17.md
- MOBILE_SAFARI_DRAWER_V25.md
- EMPLOYEE_MOBILE_PAYMENTS_V22.md
- UPDATE_V37.md
- UPDATE_V30.md
- EMPLOYEE_UNIT_PAYMENTS_V6.md
- FIRESTORE_RULES_COPYPASTE.txt
- UPDATE_V40.md
- FIRESTORE_RULES_REFERENCE.txt
- FINANCE_RESET_STABLE_V10.md
- UPDATE_V38.md
- UPDATE_V49.md
- EMPLOYEE_INVENTORY_PAYMENTS_V5.md
- UPDATE_V41.md
- UPDATE_V33.md
- TICKET_SINGLE_READ_V28.md
- UPDATE_V48.md
