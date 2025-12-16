import {
  listEquipment, saveEquipment, deleteEquipment,
  listLocations, saveLocation, deleteLocation,
  listCoupons, saveCoupon, deleteCoupon, toggleCouponEnabled,
  resetDb
} from "../db.js";

function $(id){ return document.getElementById(id); }

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function money(n){
  const v = Number(n || 0);
  return `$${v.toFixed(2)}`;
}

function normalizeTiers(tiers){
  const cleaned = (tiers || [])
    .map(t => ({ minQty: Number(t.minQty||0), priceEach: Number(t.priceEach||0) }))
    .filter(t => t.minQty > 0 && t.priceEach > 0)
    .sort((a,b)=>a.minQty-b.minQty);

  const map = new Map();
  for (const t of cleaned) map.set(t.minQty, t.priceEach);
  return [...map.entries()].map(([minQty, priceEach]) => ({ minQty, priceEach }))
    .sort((a,b)=>a.minQty-b.minQty);
}

function tiersSummary(tiers){
  const t = normalizeTiers(tiers);
  if (!t.length) return "No tiers set";
  return t.map(x => `${x.minQty} → ${money(x.priceEach)}`).join(" • ");
}

/* ---------------- Tabs ---------------- */
function initTabs(){
  const tabs = [...document.querySelectorAll(".admin-tab")];
  const panels = [...document.querySelectorAll(".admin-panel")];

  function show(tabName){
    tabs.forEach(t => {
      const active = t.dataset.tab === tabName;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
    });
    panels.forEach(p => {
      const active = p.dataset.panel === tabName;
      p.classList.toggle("hidden", !active);
    });
  }

  tabs.forEach(t => t.addEventListener("click", () => show(t.dataset.tab)));
  show("equipment");
}

/* ---------------- Equipment ---------------- */
function addTierRow(minQty="", priceEach=""){
  const wrap = $("eqTiersWrap");
  const row = document.createElement("div");
  row.className = "tier-row";
  row.innerHTML = `
    <div>
      <label>Min Qty</label>
      <input class="input tier-min" type="number" min="1" step="1" value="${esc(minQty)}" />
    </div>
    <div>
      <label>Price Each</label>
      <input class="input tier-price" type="number" min="0" step="0.01" value="${esc(priceEach)}" />
    </div>
    <button class="btn btn-ghost tier-remove" type="button">Remove</button>
  `;
  row.querySelector(".tier-remove").addEventListener("click", () => row.remove());
  wrap.appendChild(row);
}

function clearTierRows(){
  $("eqTiersWrap").innerHTML = "";
}

function readTierRows(){
  const rows = [...$("eqTiersWrap").querySelectorAll(".tier-row")];
  return normalizeTiers(rows.map(r => ({
    minQty: Number(r.querySelector(".tier-min").value || 0),
    priceEach: Number(r.querySelector(".tier-price").value || 0)
  })));
}

function setEquipmentForm(item){
  $("eqEditingId").value = item?.id || "";
  $("eqFormTitle").textContent = item?.id ? "Edit Equipment" : "Add Equipment";
  $("eqName").value = item?.name || "";
  $("eqImageUrl").value = item?.imageUrl || "";
  $("eqQuantity").value = String(item?.quantity ?? 0);
  $("eqMaxPerOrder").value = String(item?.maxPerOrder ?? 0);
  $("eqDescription").value = item?.description || "";

  clearTierRows();
  (item?.pricingTiers || []).forEach(t => addTierRow(t.minQty, t.priceEach));
}

function clearEquipmentForm(){
  setEquipmentForm(null);
  clearTierRows();
  $("eqHelper").textContent = "";
}

function renderEquipmentList(){
  const list = $("eqList");
  const items = listEquipment();

  if (!items.length){
    list.innerHTML = `<div class="helper subtle">No equipment yet. Add your first item on the left.</div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    const soon = Number(item.quantity || 0) === 0;
    const badge = soon ? `<span class="badge soon">Coming Soon</span>` : "";
    const img = item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="">` : `<span aria-hidden="true">📦</span>`;
    const desc = item.description ? esc(item.description) : "—";
    const maxTxt = Number(item.maxPerOrder||0) > 0 ? `Increment: ${Number(item.maxPerOrder)}` : "Increment: —";

    return `
      <div class="item-row" data-id="${esc(item.id)}">
        <div class="thumb">${img}</div>
        <div>
          <div class="item-title">${esc(item.name)} ${badge}</div>
          <div class="item-sub">Qty: ${Number(item.quantity||0)} • ${esc(maxTxt)}</div>
          <div class="item-sub">${esc(desc)}</div>
          <div class="item-sub">${esc(tiersSummary(item.pricingTiers))}</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-edit" type="button">Edit</button>
          <button class="btn btn-ghost btn-del" type="button">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".item-row").forEach(row => {
    const id = row.getAttribute("data-id");
    row.querySelector(".btn-edit").addEventListener("click", () => {
      const item = listEquipment().find(x => x.id === id);
      if (!item) return;
      setEquipmentForm(item);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    row.querySelector(".btn-del").addEventListener("click", () => {
      if (!confirm("Delete this equipment item?")) return;
      deleteEquipment(id);
      if ($("eqEditingId").value === id) clearEquipmentForm();
      renderEquipmentList();
    });
  });
}

function initEquipment(){
  $("btnAddTier").addEventListener("click", () => addTierRow("", ""));
  $("btnClearTiers").addEventListener("click", () => clearTierRows());

  $("btnCancelEditEquipment").addEventListener("click", () => clearEquipmentForm());

  if ($("eqTiersWrap").children.length === 0){
    addTierRow(10, 1.90);
    addTierRow(20, 1.80);
    addTierRow(50, 1.50);
    addTierRow(100, 1.00);
  }

  $("btnSaveEquipment").addEventListener("click", () => {
    const id = $("eqEditingId").value.trim() || null;
    const name = $("eqName").value.trim();
    const imageUrl = $("eqImageUrl").value.trim();
    const quantity = Math.max(0, Math.floor(Number($("eqQuantity").value || 0)));
    const maxPerOrder = Math.max(0, Math.floor(Number($("eqMaxPerOrder").value || 0)));
    const description = $("eqDescription").value.trim();
    const pricingTiers = readTierRows();

    if (!name) {
      $("eqHelper").textContent = "Name is required.";
      return;
    }

    const saved = saveEquipment({
      id: id || undefined,
      name,
      imageUrl,
      quantity,
      maxPerOrder,
      description,
      pricingTiers
    });

    $("eqHelper").textContent = id ? "Saved changes." : "Equipment added.";
    renderEquipmentList();

    if (!id) {
      clearEquipmentForm();
      addTierRow("", "");
    } else {
      setEquipmentForm(saved);
    }
  });

  renderEquipmentList();
}

/* ---------------- Locations ---------------- */
function setLocationForm(loc){
  $("locEditingId").value = loc?.id || "";
  $("locFormTitle").textContent = loc?.id ? "Edit Storage Location" : "Add Storage Location";
  $("locStreet").value = loc?.street || "";
  $("locCity").value = loc?.city || "";
  $("locState").value = loc?.state || "";
  $("locZip").value = loc?.zip || "";
}

function clearLocationForm(){
  setLocationForm(null);
  $("locHelper").textContent = "";
}

function renderLocations(){
  const list = $("locList");
  const items = listLocations();

  if (!items.length){
    list.innerHTML = `<div class="helper subtle">No locations yet. Add your storage address on the left.</div>`;
    return;
  }

  list.innerHTML = items.map(loc => {
    const line = `${loc.street}, ${loc.city}, ${loc.state} ${loc.zip}`;
    return `
      <div class="item-row" data-id="${esc(loc.id)}" style="grid-template-columns:52px 1fr auto;">
        <div class="thumb">📍</div>
        <div>
          <div class="item-title">${esc(line)}</div>
          <div class="item-sub">Used later as delivery start point.</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-edit" type="button">Edit</button>
          <button class="btn btn-ghost btn-del" type="button">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".item-row").forEach(row => {
    const id = row.getAttribute("data-id");
    row.querySelector(".btn-edit").addEventListener("click", () => {
      const loc = listLocations().find(x => x.id === id);
      if (!loc) return;
      setLocationForm(loc);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    row.querySelector(".btn-del").addEventListener("click", () => {
      if (!confirm("Delete this location?")) return;
      deleteLocation(id);
      if ($("locEditingId").value === id) clearLocationForm();
      renderLocations();
    });
  });
}

function initLocations(){
  $("btnCancelEditLocation").addEventListener("click", () => clearLocationForm());

  $("btnSaveLocation").addEventListener("click", () => {
    const id = $("locEditingId").value.trim() || null;
    const street = $("locStreet").value.trim();
    const city = $("locCity").value.trim();
    const state = $("locState").value.trim();
    const zip = $("locZip").value.trim();

    if (!street || !city || !state || !zip) {
      $("locHelper").textContent = "Please fill street, city, state, and zip.";
      return;
    }

    saveLocation({ id: id || undefined, street, city, state, zip });
    $("locHelper").textContent = id ? "Saved changes." : "Location added.";
    renderLocations();
    if (!id) clearLocationForm();
  });

  renderLocations();
}

/* ---------------- Coupons ---------------- */
function setCouponForm(c){
  $("cpnEditingId").value = c?.id || "";
  $("cpnFormTitle").textContent = c?.id ? "Edit Coupon" : "Add Coupon";
  $("cpnCode").value = c?.code || "";
  $("cpnType").value = c?.type || "percent";
  $("cpnAmount").value = String(c?.amount ?? 10);
  $("cpnEnabled").checked = !!(c?.enabled ?? true);
}

function clearCouponForm(){
  setCouponForm(null);
  $("cpnHelper").textContent = "";
}

function renderCoupons(){
  const list = $("cpnList");
  const items = listCoupons();

  if (!items.length){
    list.innerHTML = `<div class="helper subtle">No coupons yet. Add one on the left.</div>`;
    return;
  }

  list.innerHTML = items.map(c => {
    const typeTxt = c.type === "fixed" ? `${money(c.amount)} off` : `${Number(c.amount||0)}% off`;
    const status = c.enabled ? `<span class="badge">Enabled</span>` : `<span class="badge soon">Disabled</span>`;
    return `
      <div class="item-row" data-id="${esc(c.id)}" style="grid-template-columns:52px 1fr auto;">
        <div class="thumb">🏷️</div>
        <div>
          <div class="item-title">${esc(c.code)} ${status}</div>
          <div class="item-sub">${esc(typeTxt)}</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-toggle" type="button">${c.enabled ? "Disable" : "Enable"}</button>
          <button class="btn btn-ghost btn-edit" type="button">Edit</button>
          <button class="btn btn-ghost btn-del" type="button">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".item-row").forEach(row => {
    const id = row.getAttribute("data-id");
    row.querySelector(".btn-toggle").addEventListener("click", () => {
      toggleCouponEnabled(id);
      renderCoupons();
    });
    row.querySelector(".btn-edit").addEventListener("click", () => {
      const c = listCoupons().find(x => x.id === id);
      if (!c) return;
      setCouponForm(c);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    row.querySelector(".btn-del").addEventListener("click", () => {
      if (!confirm("Delete this coupon?")) return;
      deleteCoupon(id);
      if ($("cpnEditingId").value === id) clearCouponForm();
      renderCoupons();
    });
  });
}

function initCoupons(){
  $("btnCancelEditCoupon").addEventListener("click", () => clearCouponForm());

  $("btnSaveCoupon").addEventListener("click", () => {
    const id = $("cpnEditingId").value.trim() || null;
    const code = $("cpnCode").value.trim().toUpperCase();
    const type = $("cpnType").value === "fixed" ? "fixed" : "percent";
    const amount = Number($("cpnAmount").value || 0);
    const enabled = $("cpnEnabled").checked;

    if (!code) {
      $("cpnHelper").textContent = "Code is required.";
      return;
    }
    if (amount <= 0) {
      $("cpnHelper").textContent = "Amount must be greater than 0.";
      return;
    }

    saveCoupon({ id: id || undefined, code, type, amount, enabled });
    $("cpnHelper").textContent = id ? "Saved changes." : "Coupon added.";
    renderCoupons();
    if (!id) clearCouponForm();
  });

  renderCoupons();
}

/* ---------------- Admin Boot ---------------- */
export function initAdmin({ route } = {}){
  initTabs();
  initEquipment();
  initLocations();
  initCoupons();

  const btnBack = $("btnAdminToLanding");
  if (btnBack && route) btnBack.addEventListener("click", () => {
    location.hash = "";
    route("landing");
  });

  const btnWipe = $("btnDevWipeDb");
  if (btnWipe) {
    btnWipe.addEventListener("click", () => {
      if (!confirm("DEV ONLY: wipe all saved data (equipment, locations, coupons)?")) return;
      resetDb();
      location.reload();
    });
  }
}
