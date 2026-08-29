# V45 — True Inventory Image Replacement

- Transparent inventory uploads continue to be written to the inventory Firestore document as `imageData`.
- Uploading a replacement now clears the legacy `imageUrl` field on that inventory item.
- This prevents an older image from remaining as a fallback and ever reappearing after a refresh.
- Items that have not yet been given a new transparent image keep their existing legacy image URL for backward compatibility.
