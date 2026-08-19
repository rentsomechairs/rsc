# Ticket Single Read / iPhone Reliability V28

- Public ticket links no longer wait for Firebase Auth.
- Public ticket links query only the requested trackingCode instead of downloading the entire orderTracking collection.
- No-code admin tracking list retains the existing authenticated full-list behavior.
- Public ticket startup has a 12-second timeout and exits the spinner with a useful error instead of loading forever.
- Tracking page cache/version bumped to `v28-single-ticket-ios-safe`.
