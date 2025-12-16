// js/api.js
import { CONFIG } from "./config.js";

function mock(action, payload){
  console.log("[MOCK API]", action, payload);

  if(action==="equipment.list"){
    return { ok:true, items:[
      { id:"chairs_white", name:"White Folding Chairs", description:"Clean, sturdy chairs.", imageUrl:"", totalQty:300,
        pricingTiers:[{ label:"Per chair", priceEach:2.50 }] },
      { id:"tables_round", name:"Round Tables (60in)", description:"60-inch round tables.", imageUrl:"", totalQty:10,
        pricingTiers:[{ label:"Per table", priceEach:12.00 }] }
    ]};
  }

  if(action==="auth.guest"){
    return { ok:true, session:{ role:"guest", email:null, token:"mock_guest" } };
  }

  if(action==="auth.email"){
    // Always succeed in mock
    return { ok:true, session:{ role:"user", email:(payload.email||"").toLowerCase(), token:"mock_user" } };
  }

  if(action==="auth.resendVerify"){
    return { ok:true };
  }

  if(action==="auth.verify"){
    return { ok:true, session:{ role:"user", email:(payload.email||"").toLowerCase(), token:"mock_user" } };
  }

  if(action==="auth.google"){
    return { ok:true, session:{ role:"user", email:"google.user@example.com", token:"mock_google" } };
  }

  if(action==="me.get"){
    return { ok:true, me:{ email:"mock@example.com", role:"user" } };
  }

  if(action==="booking.my"){
    return { ok:true, bookings:[] };
  }

  if(action==="delivery.quote"){
    return { ok:true, deliveryFee: Number(payload?.distanceMiles||0) * 1.5 };
  }

  if(action==="booking.quote"){
    const cart = Array.isArray(payload.cart)?payload.cart:[];
    const subtotal = cart.reduce((s,it)=>s+(Number(it.price)||0)*(Number(it.qty)||0),0);
    const delivery = Number(payload.checkout?.deliveryFee||0);
    return { ok:true, subtotal, deliveryFee: delivery, total: subtotal + delivery };
  }

  if(action==="booking.create"){
    return { ok:true, bookingId:"MOCK-"+Math.random().toString(36).slice(2,8).toUpperCase() };
  }

  return { ok:true };
}

export async function api(action, payload = {}) {
  const url = (CONFIG.APPS_SCRIPT_URL || "").trim();
  const mockMode = !!CONFIG.MOCK_MODE || !url;

  if (mockMode) return mock(action, payload);

  if (!url.includes("/exec")) {
    throw new Error("CONFIG.APPS_SCRIPT_URL must be your Apps Script Web App URL that ends with /exec.");
  }

  const sessionRaw = sessionStorage.getItem("rsc_session_v1");
  const session = sessionRaw ? JSON.parse(sessionRaw) : null;

  const body = {
    action,
    payload,
    sessionToken: session?.token || null,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Backend returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }

  return data;
}
