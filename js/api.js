import { CONFIG } from './config.js';

/**
 * Calls the Apps Script backend.
 * Expected request shape: { action, payload, session }
 * Expected response shape: { ok: boolean, ... }
 */
export async function callApi(action, payload = {}, session = null){
  if (!CONFIG.APPS_SCRIPT_URL) {
    throw new Error("Missing CONFIG.APPS_SCRIPT_URL");
  }
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload, session })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e){ throw new Error(`API returned non-JSON: ${text.slice(0,200)}`); }
  if (!data || data.ok !== true) {
    const msg = (data && (data.error || data.message)) ? (data.error || data.message) : 'API error';
    throw new Error(msg);
  }
  return data;
}
