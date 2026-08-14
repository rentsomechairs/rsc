# Mobile Safari Drawer Fix v25

The dark overlay appearing without the drawer confirmed that the menu click and JavaScript state were working. The failure was the mobile Safari rendering/positioning of the off-canvas sidebar.

v25 adds:
- a final high-specificity CSS override placed after all earlier sidebar/mobile rules,
- explicit `translate3d()` positioning for Safari,
- extremely high and ordered z-index values for drawer and overlay,
- `100dvh` with `100vh` fallback,
- forced visibility/display for the drawer and its navigation,
- removal of transformed containing blocks on the mobile app shell,
- an inline transform safety net when the menu is opened.

No Firestore, Functions, or data changes are required.
