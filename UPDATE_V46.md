# Update V46 — Verified persistent transparent inventory images

- Transparent inventory replacements are encoded as alpha-preserving WebP to keep Firestore documents safely below the 1 MiB limit.
- Inventory saves now read the exact document back from Firebase and verify `imageData` and `imageUrl` before reporting success.
- A replacement clears the legacy `imageUrl`; the old image cannot silently remain as a fallback.
- If Firebase does not persist the replacement, the editor reports an error instead of showing a false successful local preview.
- Cache version bumped to `rental-ux-v46`.
