# Update v31

Fixed Quick Picker delivery-address geocoding during Review.

- Added the US Census geocoder as the primary no-key fallback for complete US street/city/state/ZIP addresses.
- Google Maps geocoding is still used first when configured.
- Photon remains a final fallback.
- A failed fallback provider no longer prevents the remaining providers from being tried.
- Cache version bumped to `rental-ux-v46`.
