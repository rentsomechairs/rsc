const CART_KEY = "rsc_cart_v1";
const CHECKOUT_KEY = "rsc_checkout_v1";
const SESSION_KEY = "rsc_session_v1";
const PENDING_EMAIL_KEY = "rsc_pending_email_v1";

export function getCart(){ try{ const v=JSON.parse(sessionStorage.getItem(CART_KEY)||"[]"); return Array.isArray(v)?v:[] }catch{ return [] } }
export function setCart(v){ sessionStorage.setItem(CART_KEY, JSON.stringify(Array.isArray(v)?v:[])); }

export function getCheckout(){ try{ return JSON.parse(sessionStorage.getItem(CHECKOUT_KEY)||"{}")||{} }catch{ return {} } }
export function setCheckout(v){ sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(v||{})); }

export function getSession(){ try{ return JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null") }catch{ return null } }
export function setSession(v){ if(!v) sessionStorage.removeItem(SESSION_KEY); else sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); }

export function getPendingEmail(){ return (sessionStorage.getItem(PENDING_EMAIL_KEY)||"").trim().toLowerCase(); }
export function setPendingEmail(email){ if(!email) sessionStorage.removeItem(PENDING_EMAIL_KEY); else sessionStorage.setItem(PENDING_EMAIL_KEY, String(email).trim().toLowerCase()); }
