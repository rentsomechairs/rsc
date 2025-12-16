/* js/app.js
   Drop-in router + boot file (vanilla JS, hash routing)
   Fixes SyntaxError at app.js:162 and keeps the app from dying if a page module is missing.
*/

import { db } from "./db.js";
import { api } from "./api.js";
import { renderFlowbar } from "./ui/flowbar.js";

// Page modules (must exist in your project structure)
import { renderLanding } from "./pages/landing.js";
import { renderInventory } from "./pages/inventory.js";
import { renderCalendar } from "./pages/calendar.js";
import { renderAddress } from "./pages/address.js";
import { renderReview } from "./pages/review.js";
import { renderProfile } from "./pages/profile.js";
import { renderAdmin } from "./pages/admin.js";
import { renderVerify } from "./pages/verify.js";

// ---------- Storage helpers (session-only) ----------
const CART_KEY = "rsc_cart_v1";
const CHECKOUT_KEY = "rsc_checkout_v1";
const SESSION_KEY = "rsc_session_v1";

export function getCart() {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setCart(cart) {
  sessionStorage.setItem(CART_KEY, JSON.stringify(Array.isArray(cart) ? cart : []));
}

export function getCheckout() {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setCheckout(obj) {
  sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(obj || {}));
}

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(sessionObj) {
  if (!sessionObj) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionObj));
}

// ---------- DOM helpers ----------
function $(sel) {
  return document.querySelector(sel);
}

function showSection(id) {
  // All app sections should have class="page" and id like "page-landing"
  const pages = document.querySelectorAll(".page");
  pages.forEach((p) => (p.style.display = "none"));

  const el = document.getElementById(id);
  if (el) el.style.display = "block";
}

function setTopStatus(text) {
  const pill = $("#topStatusPill");
  if (pill) pill.textContent = text || "";
}

function safeCall(fn, ...args) {
  try {
    if (typeof fn === "function") fn(...args);
  } catch (e) {
    console.error("Render error:", e);
    // show a minimal error for visibility
    const errBox = $("#appErrorBox");
    if (errBox) {
      errBox.style.display = "block";
      errBox.textContent = `Error: ${e?.message || e}`;
    }
  }
}

// ---------- Routing ----------
const ROUTES = {
  landing: { sectionId: "page-landing", title: "Welcome", render: renderLanding },
  inventory: { sectionId: "page-inventory", title: "Inventory", render: renderInventory },
  calendar: { sectionId: "page-calendar", title: "Date", render: renderCalendar },
  address: { sectionId: "page-address", title: "Address", render: renderAddress },
  review: { sectionId: "page-review", title: "Review", render: renderReview },
  profile: { sectionId: "page-profile", title: "Profile", render: renderProfile },
  admin: { sectionId: "page-admin", title: "Admin", render: renderAdmin },
  verify: { sectionId: "page-verify", title: "Verify Email", render: renderVerify },
};

function normalizeHash() {
  const h = (location.hash || "").replace("#", "").trim();
  return h || "landing";
}

function enforceFlow(routeKey) {
  // Only enforce flow for customer checkout pages; admin/profile/landing/verify are allowed.
  if (["landing", "admin", "profile", "verify"].includes(routeKey)) return routeKey;

  const checkout = getCheckout();
  const cart = getCart();

  const hasCart = Array.isArray(cart) && cart.length > 0;
  const hasDate = !!(checkout && checkout.date);
  const hasAddress = !!(checkout && checkout.address);

  // If user tries to skip ahead, route them back to where they belong.
  if (routeKey === "calendar" && !hasCart) return "inventory";
  if (routeKey === "address" && (!hasCart || !hasDate)) return !hasCart ? "inventory" : "calendar";
  if (routeKey === "review" && (!hasCart || !hasDate || !hasAddress)) {
    if (!hasCart) return "inventory";
    if (!hasDate) return "calendar";
    return "address";
  }

  return routeKey;
}

function handleRoute() {
  // Clear visible error box each route
  const errBox = $("#appErrorBox");
  if (errBox) {
    errBox.style.display = "none";
    errBox.textContent = "";
  }

  let routeKey = normalizeHash();
  if (!ROUTES[routeKey]) routeKey = "landing";

  routeKey = enforceFlow(routeKey);

  // If enforceFlow changed it, update hash without extra history entries
  if (normalizeHash() !== routeKey) {
    history.replaceState(null, "", `#${routeKey}`);
  }

  const route = ROUTES[routeKey];
  setTopStatus(route.title);

  // show the correct section
  showSection(route.sectionId);

  // render flowbar + page
  // renderFlowbar can use cart/checkout + routeKey to draw progress
  safeCall(renderFlowbar, {
    routeKey,
    cart: getCart(),
    checkout: getCheckout(),
    session: getSession(),
    navigate: (key) => (location.hash = `#${key}`),
  });

  // render current page
  safeCall(route.render, {
    db,
    routeKey,
    cart: getCart(),
    setCart,
    checkout: getCheckout(),
    setCheckout,
    session: getSession(),
    setSession,
    navigate: (key) => (location.hash = `#${key}`),
  });
  updateAuthUI();
}

// ---------- Boot ----------
function wireGlobalNav() {
  const btnProfile = $("#btnTopProfile");
  if (btnProfile) btnProfile.addEventListener("click", () => (location.hash = "#profile"));

  const btnAdmin = $("#btnTopAdmin");
  if (btnAdmin) btnAdmin.addEventListener("click", () => (location.hash = "#admin"));

  const btnLogout = $("#btnTopLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try { await api("auth.logout", {}); } catch(_) {}
      setSession(null);
      setCart([]);
      setCheckout({});
      location.hash = "#landing";
    });
  }
}

function updateAuthUI(){
  const session = getSession();
  const statusText = $("#statusText");
  const btnProfile = $("#btnTopProfile");
  const btnAdmin = $("#btnTopAdmin");
  const btnLogout = $("#btnTopLogout");

  if (!session){
    if (statusText) statusText.textContent = "Not signed in";
    if (btnProfile) btnProfile.classList.add("hidden");
    if (btnAdmin) btnAdmin.classList.add("hidden");
    if (btnLogout) btnLogout.classList.add("hidden");
    return;
  }

  const label = session.role === "guest"
    ? "Guest"
    : (session.email ? session.email : "Signed in");

  if (statusText) statusText.textContent = label;

  if (btnProfile) btnProfile.classList.remove("hidden");
  if (btnLogout) btnLogout.classList.remove("hidden");

  const isAdmin = session.role === "admin" || session.role === "owner";
  if (btnAdmin){
    if (isAdmin) btnAdmin.classList.remove("hidden");
    else btnAdmin.classList.add("hidden");
  }
}

function init() {
  wireGlobalNav();
  window.addEventListener("hashchange", handleRoute);
  handleRoute();
}

document.addEventListener("DOMContentLoaded", init);
