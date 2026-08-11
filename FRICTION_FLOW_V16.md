# Friction Flow v16

This update builds directly on Cohesive UX v15 and targets five specific daily-use friction points.

## 1. Order editing is sectioned
Expanded inline orders and the Full Editor now use the same five-section navigation:
- Overview
- Schedule
- Equipment
- Money
- Contact & Notes

Only one section is visible at a time. All existing order fields are preserved. The Full Editor keeps Save Order visible in a sticky footer.

## 2. Equipment picker learns from actual use
After choosing an equipment category, items are ranked dynamically using order history. Completed rentals receive the strongest weight; Confirmed/In-Progress orders also contribute; Pending orders contribute lightly.

Within a category, the most-used item rises to the top automatically. The picker shows:
- item image
- price
- usage meter
- historical units rented
- Most used badge for the leading item

There is no manual ranking field to maintain.

## 3. Orders are optimized for glancing
The collapsed order hierarchy is now:
1. exchange/return-relevant time
2. customer name
3. order total
4. equipment summary
5. fulfillment, event, payment, remaining balance, assignment

A visible Details control makes the expandable area obvious while preserving the ability to click the whole order header. Date/group headings are visually separated from order cards.

## 4. Quick Peek uses inventory-style cards
Availability is no longer presented primarily as text rows. Each item uses its inventory image and a large Remaining overlay. Stock, Confirmed, and Pending values are secondary underneath.

Remaining changes visual state:
- green: healthy availability
- amber: low availability
- red: none remaining

## 5. Settings is reorganized without removing functionality
All existing settings fields and element IDs are preserved, but the page is divided into:
- Business & pickup
- Order defaults
- Notifications
- Maps & addresses
- Payment options
- Homepage images
- Backup & recovery

Technical EmailJS fields are collapsed under an advanced disclosure. Save Settings stays visible in a sticky bottom bar.

## Safety / compatibility
- No Firestore schema changes
- No Firestore rule changes
- No Firebase Function changes
- No setting field names removed
- No order field names removed
- Employee/contract/payment logic from v14/v15 remains intact
