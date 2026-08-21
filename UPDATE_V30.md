# Update v30

1. Completed Archive now has **Back to Active Orders & Unload Completed**. It removes completed orders from the current in-memory admin session and restores the lightweight active-order view.
2. Quick Picker categories and equipment now only show inventory stocked at the selected pickup location. Previously selected items remain visible only when necessary to show a location-shortage warning after switching locations.
3. Delivery entry now asks only for Street, City, State, and ZIP. No estimated fee is shown while entering the address. Clicking **Review** geocodes both the chosen pickup location (even if only its address is saved) and the delivery address, calculates the route, and shows the delivery estimate in Review. If calculation fails, Review stays blocked with a visible address/error message rather than silently submitting a $0 estimate.

Cache version: `rental-ux-v33`.
