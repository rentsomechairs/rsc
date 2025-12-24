/**
 * RentSomeChairs - Google Sheets JSON Database (v1)
 *
 * Setup:
 * 1) Create a Google Sheet.
 * 2) Add a tab named: JSON
 * 3) In JSON!A1 put {} (or leave blank).
 * 4) Extensions -> Apps Script -> paste this file as Code.gs
 * 5) Deploy -> New deployment -> Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6) Copy the Web app URL and paste into index.html window.__RSC_CONFIG.WEB_APP_URL
 *
 * Optional:
 * - Set API_KEY below and also set it in index.html to block random writes.
 */

const SHEET_TAB = "JSON";
const CELL = "A1";
const API_KEY = ""; // optional shared secret

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_TAB) || ss.insertSheet(SHEET_TAB);
  return sh;
}

function readDb_() {
  const sh = getSheet_();
  const raw = String(sh.getRange(CELL).getValue() || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function writeDb_(db) {
  const sh = getSheet_();
  const raw = JSON.stringify(db || {}, null, 0);
  sh.getRange(CELL).setValue(raw);
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? e.postData.contents : "";
    const req = body ? JSON.parse(body) : {};
    if (API_KEY && (req.apiKey || "") !== API_KEY) {
      return jsonOut({ ok:false, error:"Unauthorized" });
    }

    const action = req.action;
    const payload = req.payload || {};

    if (action === "dbGet") {
      const db = readDb_();
      return jsonOut({ ok:true, db });
    }

    if (action === "dbSet") {
      writeDb_(payload.db);
      return jsonOut({ ok:true });
    }

    return jsonOut({ ok:false, error:"Unknown action: " + action });
  } catch (err) {
    return jsonOut({ ok:false, error: String(err) });
  }
}

// Optional ping for testing in browser (GET)
function doGet() {
  return jsonOut({ ok:true, message:"RentSomeChairs DB web app is running" });
}
