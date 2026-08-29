# V50 – Public Website Polish

Customer-facing pages were rebuilt around one shared visual system so they feel like one complete website instead of separate utilities.

## Updated public pages
- Home
- Browse Rentals / Gallery
- Quick Quote
- Track Order
- Reviews

## Main changes
- Added one consistent branded header/navigation across every public page.
- Added one consistent footer and service-area messaging across every public page.
- Added `assets/css/public-site.css` so the public website has a separate, cohesive presentation layer without changing the admin interface.
- Reworked the homepage into a more complete customer-facing landing page with clearer calls to action, service cards, a simple three-step process, and stronger visual hierarchy.
- Reworked Gallery, Quick Quote, Tracking, and Reviews with matching page headers, spacing, buttons, card treatment, typography, and background styling.
- Renamed customer-facing "Quick Picker" language to "Quick Quote" where visible in the page chrome.
- Standardized customer-facing page titles from "Rent Some Orders" to "Rent Some Event Rentals".
- Kept the V49 gallery accessory behavior and existing quote/tracking/review logic intact.
- Added mobile navigation and responsive layouts without adding any new JavaScript dependencies.

## Cache
Public CSS references use `rental-ux-v50`.
