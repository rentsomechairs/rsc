# V36 Update

- Orders can switch between List and monthly Calendar views.
- Added Schedule workspace for admin and employees with a typical 7-day week and date-specific changes.
- Quick Peek now starts with Event Date only and reveals exchange/return/location after selection; saved schedule changes are shown there.
- Order edits automatically copy a customer update containing the changes, including status changes.
- Time references in generated updates use 12-hour AM/PM formatting.
- Full Editor time controls wrap correctly on narrow/mobile screens.
- Employee schedule data is stored in `schedules/{uid}`; the included Firestore rules allow an approved employee to update only their own schedule document while the admin can manage all schedules.
