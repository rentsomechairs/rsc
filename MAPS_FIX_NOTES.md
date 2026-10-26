# Google Maps and slow-save fix

- Inline order saves no longer wait for financial/mileage geocoding. Financial synchronization still runs asynchronously in the open page. Keep the page open until it completes; failures appear in the console.
- Google location requests now have short timeouts, with Census/Photon/OSRM fallback and a 30-minute in-memory geocode cache.
- A rejected Google key cannot be authorized by website code. In Google Cloud Console, authorize `https://rentsomechairs.github.io/rsc/*` in the Maps JavaScript API key HTTP referrer restrictions. Also check the Maps JavaScript API is enabled and billing is active.
- Version identifiers changed to rental-ux-v70 to invalidate older cached scripts.
- No live Firebase integration testing was possible.
