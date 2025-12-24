import { listEquipment, listCategories, getCart, setCart, getSession, getPrefs, patchPrefs } from '../db.js';
import { updateFlowSummary } from '../ui/flowbar.js';

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}
function money(n){ return `$${Number(n||0).toFixed(2)}`; }

function normalizeTiers(pricingTiers){
  let tiers = pricingTiers;

  // Support tiers saved as JSON strings (e.g., from imports or form serialization)
  if (typeof tiers === 'string'){
    try { tiers = JSON.parse(tiers); } catch (e) { tiers = []; }
  }

  // Support tiers saved as an object/map: { "1": 2.5, "50": 1.75 }
  if (tiers && !Array.isArray(tiers) && typeof tiers === 'object'){
    // If wrapped (e.g., { tiers: [...] })
    if (Array.isArray(tiers.tiers)) tiers = tiers.tiers;
    else {
      const out = [];
      for (const [k,v] of Object.entries(tiers)){
        const minQty = Number(k);
        const priceEach = Number(v);
        if (Number.isFinite(minQty) && Number.isFinite(priceEach)) out.push({ minQty, priceEach });
      }
      tiers = out;
    }
  }

  if (!Array.isArray(tiers)) tiers = [];
  return tiers
    .map(t => ({ minQty: Number(t?.minQty ?? 0), priceEach: Number(t?.priceEach ?? 0) }))
    .filter(t => Number.isFinite(t.minQty) && t.minQty >= 0 && Number.isFinite(t.priceEach) && t.priceEach > 0)
    .sort((a,b)=>a.minQty-b.minQty);
}

function unitPriceForQty(pricingTiers, qty){
  const tiers = normalizeTiers(pricingTiers);
  const q = Number(qty || 0);
  let chosen = null;
  for (const t of tiers){
    if (q >= t.minQty) chosen = t;
  }
  // If qty is smaller than the smallest tier's minQty, use the smallest tier as base price.
  if (!chosen && tiers.length) chosen = tiers[0];
  return chosen ? chosen.priceEach : null;
}

function minMaxPrice(pricingTiers){
  const tiers = normalizeTiers(pricingTiers);
  if (!tiers.length) return null;
  // smallest minQty is the highest price, last tier is the lowest price
  const max = tiers[0].priceEach;
  const min = tiers[tiers.length-1].priceEach;
  return { max, min };
}

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function computeUpsell(eq, current, increment, maxSelectable){
  const tiers = normalizeTiers(eq.pricingTiers);
  if (!tiers.length) return null;
  if (!increment || increment <= 0) return null;
  const nextQty = current + increment;
  if (nextQty <= 0 || nextQty > maxSelectable) return null;

  const unitNow = unitPriceForQty(eq.pricingTiers, current);
  const unitNext = unitPriceForQty(eq.pricingTiers, nextQty);
  if (unitNow == null || unitNext == null) return null;

  const totalNow = unitNow * current;
  const totalNext = unitNext * nextQty;
  const delta = totalNext - totalNow;
  if (!isFinite(delta) || delta <= 0) return null;

  return { add: increment, nextQty, delta, unitNext };
}
function roundUpToIncrement(qty, increment){
  const q = Math.max(0, Math.floor(Number(qty||0)));
  const inc = Math.max(1, Math.floor(Number(increment||1)));
  if (q <= 0) return 0;
  return Math.ceil(q / inc) * inc;
}

function desiredQtyFromTyped(eq, raw){
  const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity || 0)));
  const increment = Math.max(1, Math.floor(Number(eq.maxPerOrder || 1)));
  const entered = Math.max(0, Math.floor(Number(raw || 0)));
  if (!entered) return 0;
  let next = roundUpToIncrement(entered, increment);
  next = clamp(next, 0, qtyAvail);
  return next;
}

function commitAllTypedQty(equipment){
  // Commits any typed values before continuing (so blur isn't required)
  const inputs = Array.from(document.querySelectorAll('.inv-qty-input'));
  const changes = [];
  for (const inp of inputs){
    const card = inp.closest('.inv-card');
    const id = card?.getAttribute('data-id');
    if (!id) continue;
    const eq = (equipment || []).find(e => String(e.id) === String(id));
    if (!eq) continue;
    const cur = cartQty(String(id));
    const typed = inp.value;
    if (typed == null || typed === '') continue;
    const desired = desiredQtyFromTyped(eq, typed);
    if (desired !== cur){
      changes.push({ id: String(id), qty: desired });
    }
  }
  if (!changes.length) return false;
  for (const ch of changes){
    setQty(ch.id, ch.qty);
  }
  return true;
}


export function initInventory({ gotoLanding, gotoCalendar, softRefresh=false } = {}) {
  const grid = document.getElementById('invGrid');
  const summary = document.getElementById('invSummary');
  const btnBack = document.getElementById('btnInvBack');
  const btnContinue = document.getElementById('btnInvContinue');

  const linesWrap = document.getElementById('invLines');
  const totalEl = document.getElementById('invTotal');
  const sideHint = document.getElementById('invSideHint');
  const upsellBox = document.getElementById('invUpsell');
  const catsBar = document.getElementById('invCats');

  const btnBackBottom = document.getElementById('btnInvBackBottom');
  const btnContinueBottom = document.getElementById('btnInvContinueBottom');

  if (!grid || !summary || !btnBack || !btnContinue) return;

  const session = getSession() || undefined;
  const categories = listCategories();
  const equipment = listEquipment();
  let cart = getCart(session);

  // category filter
  let activeCatId = (getPrefs()?.inventoryCategoryId) || '';



  function inferCatIdFromLegacy(legacy){
    const v = String(legacy||"").toLowerCase();
    if (!v) return "";
    const hit = categories.find(c => String(c.id)===legacy);
    if (hit) return hit.id;
    // legacy values like "chairs"/"tables"/"other"
    const byName = categories.find(c => String(c.name||"").toLowerCase() === v);
    if (byName) return byName.id;
    const contains = categories.find(c => String(c.name||"").toLowerCase().includes(v));
    return contains ? contains.id : "";
  }
  function eqCatId(eq){
    return eq.categoryId || inferCatIdFromLegacy(eq.category);
  }
  function renderCategoriesBar(){
    if (!catsBar) return;
    const cats = categories;
    const allId = "__all__";
    const buttons = [
      { id: allId, name: "All", imageUrl: "" },
      ...cats
    ];
    catsBar.innerHTML = buttons.map(c => {
      const active = (activeCatId || allId) === c.id;
      const img = c.imageUrl ? `<img class="inv-cat-img" src="${esc(c.imageUrl)}" alt="" />` : "";
      return `<button class="inv-cat-btn ${active ? "active":""}" data-cat="${esc(c.id)}">${img}<span class="inv-cat-name">${esc(c.name)}</span></button>`;
    }).join("");
    catsBar.querySelectorAll("[data-cat]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-cat");
        activeCatId = (id === allId) ? "" : id;
        patchPrefs({ inventoryCategoryId: activeCatId });
        renderCategoriesBar();
        render();
      });
    });
  }
  // ---- footer nav buttons ----
  function decorateNavButtons(){
    const backHtml = `<div class="btn-main">Back</div><div class="btn-sub">to Home</div>`;
    const nextHtml = `<div class="btn-main">Continue</div><div class="btn-sub">to Date</div>`;
    btnBack.innerHTML = backHtml;
    btnContinue.innerHTML = nextHtml;
    if (btnBackBottom) btnBackBottom.innerHTML = backHtml;
    if (btnContinueBottom) btnContinueBottom.innerHTML = nextHtml;
  }
  decorateNavButtons();

  btnBack.onclick = () => gotoLanding?.();
  if (btnBackBottom) btnBackBottom.onclick = () => btnBack.click();
  if (btnContinueBottom) btnContinueBottom.onclick = () => btnContinue.click();

  // ---- modal helper ----
  function openModal({ title, bodyHtml, actions=[] }){
    const modal = document.getElementById('uiModal');
    const backdrop = document.getElementById('uiModalBackdrop');
    const closeBtn = document.getElementById('uiModalClose');
    const t = document.getElementById('uiModalTitle');
    const body = document.getElementById('uiModalBody');
    const act = document.getElementById('uiModalActions');
    if (!modal || !backdrop || !closeBtn || !t || !body || !act) return;

    t.textContent = title || 'Modal';
    body.innerHTML = bodyHtml || '';
    act.innerHTML = '';

    const close = () => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden','true');
      closeBtn.onclick = null;
      backdrop.onclick = null;
    };

    for (const a of actions){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = a.className || 'btn btn-ghost';
      b.textContent = a.label || 'OK';
      b.onclick = () => {
        try { a.onClick?.(); } finally { close(); }
      };
      act.appendChild(b);
    }

    closeBtn.onclick = close;
    backdrop.onclick = close;

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
  }

  function confirmRemove(eq){
    return new Promise(resolve => {
      openModal({
        title: 'Warning',
        bodyHtml: `<div style="margin-bottom:10px;">You are about to remove <strong>${esc(eq.name)}</strong> from your cart.</div>`,
        actions: [
          { label:'Cancel', className:'btn btn-ghost', onClick: () => resolve(false) },
          { label:'Continue', className:'btn btn-bad', onClick: () => resolve(true) }
        ]
      });
    });
  }

  // ---- upsell prefs + session gating ----
  const prefs = getPrefs(session) || {};
  const hideUpsell = !!prefs.hideUpsell;
  const upsellSeenKey = 'rsc_upsell_seen';
  function markUpsellSeen(){ try{ sessionStorage.setItem(upsellSeenKey,'1'); }catch{} }
  function hasSeenUpsell(){ try{ return sessionStorage.getItem(upsellSeenKey)==='1'; }catch{ return false; } }

  function cartItem(id){
    return cart.find(x => String(x.id) === String(id));
  }
  function cartQty(id){
    return Number(cartItem(id)?.qty || 0);
  }
  function persist(){
    setCart(cart, session);
    updateFlowSummary();
  }
  function setQty(id, qty){
    const q = Math.max(0, Math.floor(Number(qty||0)));
    const idx = cart.findIndex(x => String(x.id) === String(id));
    if (q <= 0){
      if (idx !== -1) cart.splice(idx, 1);
    } else {
      if (idx === -1) cart.push({ id: String(id), qty: q });
      else cart[idx].qty = q;
    }
    persist();
    render();
  }

  function renderContinueState(){
    const disabled = cart.length === 0;
    btnContinue.disabled = disabled;
    if (btnContinueBottom) btnContinueBottom.disabled = disabled;
  }

  function getBestUpsell(){
    // Pick the upsell with the strongest value signal (largest savings per added item)
    let best = null;
    for (const ci of cart){
      const eq = equipment.find(e => String(e.id) === String(ci.id));
      if (!eq) continue;
      const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity || 0)));
      const increment = Math.max(1, Math.floor(Number(eq.maxPerOrder || 1)));
      const qty = Number(ci.qty || 0);
      const upsell = computeUpsell(eq, qty, increment, qtyAvail);
      if (!upsell) continue;
      const score = (upsell.delta / Math.max(1, upsell.add));
      if (!best || score < best.score){
        best = { eq, upsell, score };
      }
    }
    return best;
  }

  function renderUpsellCta(){
    // We now show tier-upsell prompts inside the item summary (and optionally as a modal).
    // Keep this top-right slot hidden to avoid duplicate CTAs.
    if (!upsellBox) return;
    upsellBox.hidden = true;
    upsellBox.innerHTML = '';
  }

  function showUpsellOnContinue(){
    if (hideUpsell) return false;
    const categories = listCategories();
// Build a list of "next tier" offers for every cart item that can unlock a better unit price.
    const offers = [];
    for (const ci of cart){
      const eq = equipment.find(e => String(e.id) === String(ci.id));
      if (!eq) continue;

      const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity || 0)));
      const qty = Math.max(0, Math.floor(Number(ci.qty || 0)));
      if (!qty) continue;

      const tiers = normalizeTiers(eq.pricingTiers);
      if (!tiers.length) continue;

      // Compute current unit price and locate the *next* tier that actually lowers it.
      // This avoids excluding items where the first tier is treated as the base price
      // (e.g., tiers start at 10, but qty < 10 still prices at that same tier).
      const unitNow = unitPriceForQty(eq.pricingTiers, qty);
      if (unitNow == null) continue;

      let nextTier = null;
      let unitNext = null;
      for (const t of tiers){
        const minQty = Math.max(0, Math.floor(Number(t.minQty || 0)));
        if (minQty <= qty) continue;
        const u = unitPriceForQty(eq.pricingTiers, minQty);
        if (u == null) continue;
        if (u < unitNow){
          nextTier = { ...t, minQty };
          unitNext = u;
          break;
        }
      }
      if (!nextTier || unitNext == null) continue;

      const add = Math.max(0, Math.floor(Number(nextTier.minQty || 0) - qty));
      if (!add) continue;

      const nextQty = qty + add;
      if (nextQty > qtyAvail) continue;

      // unitNext is already computed from nextTier.minQty, but keep this consistent
      // in case unit pricing logic changes.
      unitNext = unitPriceForQty(eq.pricingTiers, nextQty);
      if (unitNext == null) continue;
      if (!(unitNext < unitNow)) continue; // only prompt when it truly lowers the rate

      const totalNow = unitNow * qty;
      const totalNext = unitNext * nextQty;
      const delta = totalNext - totalNow; // additional cost to upgrade
      const savings = (unitNow * nextQty) - totalNext; // savings vs paying old rate on all items
      const perAdded = delta / Math.max(1, add);

      if (!isFinite(delta) || !isFinite(savings)) continue;
      if (delta <= 0) continue;

      // Category grouping for the modal UI
      const catId = String(eq.categoryId || '');
      const catName = String((categories || []).find(c => String(c.id) === catId)?.name || 'Other');

      offers.push({
        id: String(eq.id),
        name: String(eq.name || 'Item'),
        categoryId: catId,
        categoryName: catName,
        qty,
        add,
        nextQty,
        unitNow,
        unitNext,
        delta,
        savings,
        perAdded
      });
    }

    if (!offers.length) return false;

    // Sort by category then most savings first so the best opportunities are visible.
    offers.sort((a,b) => {
      const ca = String(a.categoryName || '');
      const cb = String(b.categoryName || '');
      if (ca !== cb) return ca.localeCompare(cb);
      return (b.savings - a.savings);
    });

    // Group into category sections and show in a multi-column grid so the footer stays reachable.
    const groups = new Map();
    for (const o of offers){
      const key = String(o.categoryName || 'Other');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }

    const rowCard = (o) => `
      <div class="upsellRow" data-upsell-id="${esc(o.id)}" data-orig-qty="${o.qty}" data-next-qty="${o.nextQty}" data-add="${o.add}" data-unit-next="${o.unitNext}">
        <div class="upsellRowTop">
          <div class="upsellRowLeft">
            <div class="upsellName">${esc(o.name)}</div>
            <div class="upsellLine">Current: <strong class="uNowQty">${o.qty}</strong> @ <strong class="uNowUnit">${money(o.unitNow)}</strong>/ea</div>
            <div class="upsellLine">Add <strong class="uAdd">${o.add}</strong> to reach <strong class="uNextQty">${o.nextQty}</strong> @ <strong>${money(o.unitNext)}</strong>/ea</div>
            <div class="upsellLine">Additional cost: <strong>${money(o.delta)}</strong> <span class="upsellMuted">(≈ ${money(o.perAdded)}/each added)</span></div>
            <div class="upsellLine">You save: <strong>${money(o.savings)}</strong> total</div>
          </div>
          <div class="upsellRowRight">
            <button type="button" class="btn btn-good" data-upsell-action="add">Yes, add ${o.add} more</button>
            <div class="uAdded">✅ Added</div>
          </div>
        </div>
      </div>
    `;

    const groupsHtml = Array.from(groups.entries()).map(([cat, items]) => `
      <div class="upsellGroup">
        <div class="upsellGroupTitle">${esc(cat)}</div>
        <div class="upsellGrid">
          ${items.map(rowCard).join('')}
        </div>
      </div>
    `).join('');

    openModal({
      title: 'Quantity discount',
      bodyHtml: `
        <div style="margin-bottom:8px;opacity:.95;">
          You have quantity discounts available. Review each item below to see the new rate and total savings.
        </div>
        <div id="upsellList">${groupsHtml}</div>
        <label style="display:flex;gap:8px;align-items:center;font-size:13px;opacity:.9;margin-top:10px;">
          <input type="checkbox" id="chkNoMoreUpsell">
          Do not show this again
        </label>
      `,
      actions: [
        { label:'No thank you', className:'btn btn-primary', onClick: () => {
            const c = document.getElementById('chkNoMoreUpsell');
            if (c?.checked) patchPrefs({ hideUpsell: true }, session);
            gotoCalendar?.();
          }
        }
      ]
    });

    // Wire up row-level add buttons + dynamic footer label.
    const accepted = new Set();
    const modalBody = document.getElementById('uiModalBody');
    const modalActions = document.getElementById('uiModalActions');
    const footerBtn = modalActions?.querySelector('button');
    const refreshFooter = () => {
      if (!footerBtn) return;
      footerBtn.textContent = accepted.size ? 'Continue' : 'No thank you';
    };
    refreshFooter();

    modalBody?.querySelectorAll('[data-upsell-action="add"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('[data-upsell-id]');
        const id = row?.getAttribute('data-upsell-id');
        if (!id) return;

        const offer = offers.find(o => String(o.id) === String(id));
        if (!offer) return;

        const origQty = Math.max(0, Math.floor(Number(row?.getAttribute('data-orig-qty') || offer.qty || 0)));
        const nextQty = Math.max(0, Math.floor(Number(row?.getAttribute('data-next-qty') || offer.nextQty || 0)));
        const addQty  = Math.max(0, Math.floor(Number(row?.getAttribute('data-add') || offer.add || 0)));
        const nextUnit = Number(row?.getAttribute('data-unit-next') || offer.unitNext || 0);

        const qtyEl = row?.querySelector('.uNowQty');
        const unitEl = row?.querySelector('.uNowUnit');
        const addedEl = row?.querySelector('.uAdded');
        const addEl = row?.querySelector('.uAdd');

        // Toggle behavior: clicking again undoes the change back to original qty.
        if (accepted.has(id)){
          setQty(id, origQty);
          accepted.delete(id);

          btn.textContent = `Yes, add ${addQty} more`;
          if (addedEl) addedEl.style.display = 'none';
          if (qtyEl) qtyEl.textContent = String(origQty);
          if (unitEl) unitEl.textContent = money(offer.unitNow);
          if (addEl) addEl.textContent = String(addQty);
          refreshFooter();
          return;
        }

        // Apply the quantity change and persist.
        setQty(id, nextQty);
        accepted.add(id);

        // UI update: show check, update qty + current rate, allow undo.
        btn.textContent = 'Undo';
        if (addedEl) addedEl.style.display = 'block';
        if (qtyEl) qtyEl.textContent = String(nextQty);
        if (unitEl) unitEl.textContent = money(nextUnit);
        if (addEl) addEl.textContent = '0';

        refreshFooter();
      });
    });
return true;
  }

  btnContinue.onclick = () => {
    if (cart.length === 0) return;
    // Upsell popup should appear when continuing to date, not when selecting items.
    if (showUpsellOnContinue()) return;
    gotoCalendar?.();
  };
  if (btnContinueBottom) btnContinueBottom.onclick = () => btnContinue.click();

  function renderSummaryAndTotals(){
    if (!cart.length) {
      summary.textContent = 'No items selected.';
      if (linesWrap) linesWrap.innerHTML = '';
      if (totalEl) totalEl.textContent = money(0);
      if (sideHint) sideHint.textContent = 'Pick quantities to see totals.';
      return;
    }

    const parts = [];
    let total = 0;
    if (linesWrap) linesWrap.innerHTML = '';

    for (const ci of cart){
      const eq = equipment.find(e => String(e.id) === String(ci.id));
      if (!eq) continue;

      const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity || 0)));
      const increment = Math.max(1, Math.floor(Number(eq.maxPerOrder || 1)));
      const maxSelectable = qtyAvail;

      const qty = Number(ci.qty || 0);
      const unit = unitPriceForQty(eq.pricingTiers, qty);
      const lineTotal = unit != null ? (unit * qty) : 0;
      total += lineTotal;

      parts.push(`${eq.name}: ${qty}`);

      const upsell = computeUpsell(eq, qty, increment, maxSelectable);

      if (linesWrap){
        const div = document.createElement('div');
        div.className = 'inv-line';
        div.innerHTML = `
          <div class="inv-line-top">
            <div>
              <div class="inv-line-name">${esc(eq.name)}</div>
              <div class="inv-line-qty">Qty: <strong>${qty}</strong> <span class="muted">(increments of ${increment})</span></div>
              ${upsell ? `<div class="inv-line-upsell"><button class="btn btn-ghost inv-upsell-btn" type="button" data-upsell="${esc(eq.id)}">Add ${upsell.add} more for only ${money(upsell.delta)}</button></div>` : ``}
            </div>
            <div>
              <div class="inv-line-price">${money(lineTotal)}</div>
              <div class="inv-line-unit">${unit != null ? `${money(unit)}/ea` : ''}</div>
            </div>
          </div>
        `;
        linesWrap.appendChild(div);

        if (upsell){
          div.querySelector('[data-upsell]')?.addEventListener('click', () => {
            setQty(eq.id, upsell.nextQty);
          });
        }
      }

    }

    summary.textContent = `Selected: ${parts.join(' • ')}`;
    if (totalEl) totalEl.textContent = money(total);
    if (sideHint) sideHint.textContent = 'Estimated item total (delivery/coupons later).';
  }

  async function handleToggleSelect(eq){
    const id = String(eq.id);
    const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity || 0)));
    if (qtyAvail <= 0) return;

    const increment = Math.max(1, Math.floor(Number(eq.maxPerOrder || 1)));
    const current = cartQty(id);

    if (current > 0){
      const ok = await confirmRemove(eq);
      if (!ok) return;
      setQty(id, 0);
    } else {
      setQty(id, Math.min(qtyAvail, increment));
    }
  }

  async function handleDec(eq){
    const id = String(eq.id);
    const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity || 0)));
    const increment = Math.max(1, Math.floor(Number(eq.maxPerOrder || 1)));
    const current = cartQty(id);
    if (current <= 0) return;

    const next = clamp(current - increment, 0, qtyAvail);
    if (next === 0){
      const ok = await confirmRemove(eq);
      if (!ok) return;
    }
    setQty(id, next);
  }

  function handleInc(eq){
    const id = String(eq.id);
    const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity || 0)));
    const increment = Math.max(1, Math.floor(Number(eq.maxPerOrder || 1)));
    const current = cartQty(id);
    const next = clamp(current + increment, 0, qtyAvail);
    if (next === current) return;
    setQty(id, next);
  }

  function render(){
    if (!equipment.length) {
      grid.innerHTML = `
        <div class="inv-empty">
          <div class="inv-empty-title">No equipment added yet.</div>
          <div class="inv-empty-sub">Log in as admin and add your first item.</div>
        </div>
      `;
      renderSummaryAndTotals();
      renderContinueState();
      return;
    }

    const filtered = activeCatId ? equipment.filter(eq => eqCatId(eq) === activeCatId) : equipment;
    if (!filtered.length){
      grid.innerHTML = `<div class="inv-empty"><div class="inv-empty-title">No items in this category.</div><div class="inv-empty-sub">Pick another category above, or add items in Admin.</div></div>`;
      return;
    }

    grid.innerHTML = filtered.map(eq => {
      const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity || 0)));
      const comingSoon = qtyAvail === 0;
      const increment = Math.max(1, Math.floor(Number(eq.maxPerOrder || 1)));

      const current = cartQty(eq.id);
      const selected = current > 0;
      const isOpen = selected; // show details/controls for every selected item

      const mm = minMaxPrice(eq.pricingTiers);
      const badge = comingSoon
        ? `<span class="inv-badge soon">Coming Soon</span>`
        : (mm ? `<span class="inv-badge">${money(mm.max)}/ea • As low as ${money(mm.min)}/ea</span>` : `<span class="inv-badge">Price TBD</span>`);

      const img = eq.imageUrl
        ? `<img src="${esc(eq.imageUrl)}" alt="">`
        : `<div class="inv-ph" aria-hidden="true">📦</div>`;

      const desc = eq.description ? esc(eq.description) : '—';
      const disabledAttr = comingSoon ? 'disabled' : '';

      return `
        <article class="inv-card ${comingSoon ? 'is-soon':''} ${selected ? 'is-selected':''} ${isOpen ? 'is-open':''}" data-id="${esc(eq.id)}">
          <div class="inv-thumb" role="button" tabindex="0" aria-label="Select ${esc(eq.name)}">
            ${img}
            <div class="inv-check">✓</div>
          </div>
          <div class="inv-body">
            <div class="inv-topline">
              <div class="inv-name">${esc(eq.name)}</div>
              ${badge}
            </div>

            <div class="inv-desc">${desc}</div>

            <div class="inv-meta">
              <div class="inv-meta-line">Available: <strong>${qtyAvail}</strong></div>
              <div class="inv-meta-line">Increment: <strong>${increment}</strong></div>
            </div>

            <div class="inv-controls">
              <div class="qty-controls">
                <button class="inv-btn inv-minus qty-btn" type="button" ${disabledAttr}>(-${increment})</button>
                <input class="inv-qty inv-qty-input qty-value" aria-label="Quantity" inputmode="numeric" pattern="[0-9]*" value="${selected ? current : 0}">
                <button class="inv-btn inv-plus qty-btn" type="button" ${disabledAttr}>(+${increment})</button>
              </div>
              <div class="inv-maxhint">${comingSoon ? 'Not available yet' : `Max: ${qtyAvail}`}</div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // bind card events
    grid.querySelectorAll('.inv-card').forEach(card => {
      const id = card.getAttribute('data-id');
      const eq = equipment.find(e => String(e.id) === String(id));
      if (!eq) return;

      const thumb = card.querySelector('.inv-thumb');
      const minus = card.querySelector('.inv-minus');
      const plus = card.querySelector('.inv-plus');
      const qtyInput = card.querySelector('.inv-qty-input');

      thumb?.addEventListener('click', () => {
        if (card.classList.contains('is-soon')) return;
        handleToggleSelect(eq);
      });
      thumb?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          thumb.click();
        }
      });

      minus?.addEventListener('click', () => {
        if (card.classList.contains('is-soon')) return;
        if (qtyInput) qtyInput.blur();
        handleDec(eq);
      });
      plus?.addEventListener('click', () => {
        if (card.classList.contains('is-soon')) return;
        if (qtyInput) qtyInput.blur();
        handleInc(eq);
      });
    
// Allow typing a quantity directly. Rounds UP to the nearest increment.
if (qtyInput){
  qtyInput.addEventListener('focus', () => { qtyInput.select?.(); });

  qtyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){
      e.preventDefault();
      const desired = desiredQtyFromTyped(eq, qtyInput.value);
      setQty(String(eq.id), desired);
      qtyInput.blur();
    }
    if (e.key === 'Escape'){
      e.preventDefault();
      qtyInput.value = String(cartQty(String(eq.id)) || 0);
      qtyInput.blur();
    }
  });

  qtyInput.addEventListener('blur', async () => {
    const desired = desiredQtyFromTyped(eq, qtyInput.value);
    if (desired === 0){
      const cur0 = cartQty(String(eq.id));
      if (cur0 > 0){
        const ok = await confirmRemove(eq);
        if (!ok) { qtyInput.value = String(cur0); return; }
      }
    }
    setQty(String(eq.id), desired);
    qtyInput.value = String(cartQty(String(eq.id)) || 0);
  });
}
});

    renderContinueState();
    renderSummaryAndTotals();
    renderUpsellCta();
  }

  render();
  if (!softRefresh) updateFlowSummary();
}