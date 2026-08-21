# Quick Picker Delivery Simplification v32

Automatic delivery-fee calculation has been completely removed from the Quick Picker for now.

- Customers still enter Street, City, State, and ZIP.
- No geocoding, route lookup, mileage calculation, time calculation, or automatic delivery pricing runs from the Quick Picker.
- The delivery section now says: **“A delivery fee will be discussed.”**
- Review shows the same delivery-fee message instead of an estimate.
- Submitted delivery inquiries store the address but use a $0 delivery fee until it is discussed/entered manually by staff.
- Delivery inquiries are marked as needing delivery review.
- Cache version bumped to `rental-ux-v33`.
