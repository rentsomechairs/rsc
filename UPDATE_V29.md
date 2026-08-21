# Rental UX v29

Implemented the requested rental-tool updates:

1. Default exchange time changed from 10:00 AM to 7:00 PM.
2. Unassigned admin-created orders no longer get a false "Assigned to Employee" label.
3. Mobile order cards were reworked so equipment summaries wrap instead of being cut off.
4. Copy/Paste now includes approved employee pickup addresses.
5. Admin startup loads only active orders. Completed orders are lazy-loaded when the Completed Archive, Numbers, or Employees area needs them.
6. Admin "Open Tracking" links include an admin-only hint; when the admin session is active, the 4-character customer gate is bypassed. Customer links remain protected.
7. Pending and confirmed orders now share one Active Orders view. Pending cards are strongly red-highlighted, while pending/confirmed totals remain separate.
8. Quick Quote pickup choices display addresses. Location changes keep selected equipment, check stock at the new location, warn on shortages, and mark affected equipment.
9. Delivery address entry now uses Street / City / State / ZIP fields. Delivery cost is calculated during Review and recalculated automatically on Submit if the address/location changed.
10. Exchange auto-fill wording was replaced with a message that exchange dates/times will be discussed.
11. Exchange and return timing were removed from the customer Review summary.
12. Post-submit part-time response-time warning added in red.
13. Once Review has been opened, later edits no longer force the customer to click Review again. Delivery pricing still refreshes automatically when necessary.
14. New inquiries are grouped at the very top regardless of rental date and are cleared from "New Inquiry" when opened.
15. Creating a new order in Admin automatically copies its reminder message after save.

Cache-busting versions were bumped to `rental-ux-v33`.
