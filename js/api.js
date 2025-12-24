// Simple Apps Script Web App client (no localStorage).
// Configure window.__RSC_CONFIG in index.html (see README).
export async function apiCall(action, payload = {}) {
  const cfg = window.__RSC_CONFIG || {};
  const url = cfg.WEB_APP_URL;
  if (!url) throw new Error("Missing WEB_APP_URL in window.__RSC_CONFIG");

  const body = JSON.stringify({
    action,
    payload,
    apiKey: cfg.API_KEY || ""
  });

  // Use text/plain to avoid CORS preflight in many cases.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error("Bad JSON from web app: " + text.slice(0, 200)); }

  if (!res.ok || data.ok === false) {
    const msg = data && data.error ? data.error : ("HTTP " + res.status);
    throw new Error(msg);
  }
  return data;
}
