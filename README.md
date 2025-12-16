# Rent Some Chairs - Local Dev

## Run
Double-click `start-server.bat`.
It will open http://localhost:5500/

## Admin (temporary)
Email: r@g.com
Password: 1

## Dev shortcuts
- Reset session button (bottom-left)
- Emergency reset URL: http://localhost:5500/?reset=1
- Open admin: http://localhost:5500/#admin


## Fix in this version
- Admin panel buttons now work after admin login (admin JS initializes properly).


## Inventory
After signing in (user/guest), you are routed to #inventory.

- Inventory now shows current unit price ($/ea) per item and an estimated total in a sidebar.


## Calendar
After selecting inventory, Continue goes to #calendar. Calendar shows remaining quantities per selected item (based on bookings).


## New in v3_4
- Persistent flow bar (Login → Review) with live order summary.
- Inventory shows 'Add N more for only $X' when adding the next increment changes total.
- Added Address and Review pages. Review places a booking (stored locally) and calendar availability subtracts bookings.


## v3_5
- Inventory cards are select-first: image grid, click to select/expand, green check overlay.
- Add-more callout is highlighted with an ! and stronger styling.
- Calendar blocks past dates and supports optional 5-year annual booking mode with 10–14 month spacing.
- Review places 1 or 5 bookings accordingly.


## v3_5_2
- Inventory: click image selects & expands only that item; clicking again unselects.
- Calendar: today is highlighted; past dates disabled.
- Annual 5-year block moved above calendar grid for visibility.
