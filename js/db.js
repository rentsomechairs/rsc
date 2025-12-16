/* js/db.js
   App state + constants only.
   No API calls. No localStorage database.
*/

export const db = {
  // reserved for future shared state if needed
};

// Versioning (useful for future migrations)
export const APP_VERSION = "4.0.0";

// Simple helpers (optional, safe)
export function nowISO() {
  return new Date().toISOString();
}
