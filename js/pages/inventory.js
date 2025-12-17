import { listEquipment, getCart, setCart } from '../db.js';
import { updateFlowSummary } from '../ui/flowbar.js';

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function money(n){ return `$${Number(n||0).toFixed(2)}`; }

function normalizeTiers(pricingTiers){
  return (pricingTiers || [])
    .map(t => ({ minQty: Number(t.minQty||0), priceEach: Number(t.priceEach||0) }))
    .filter(t => t.minQty > 0 && t.priceEach > 0)
    .sort((a,b)=>a.minQty-b.minQty);
}
function unitPriceForQty(pricingTiers, qty){
  const tiers = normalizeTiers(pricingTiers);
  const q = Number(qty || 0);
  let chosen = null;
  for (const t of tiers){ if (q >= t.minQty) chosen = t; }
  return chosen ? chosen.priceEach : null;
}
function minMaxPrice(pricingTiers){
  const tiers = normalizeTiers(pricingTiers);
  if (!tiers.length) return null;
  const max = tiers[0].priceEach; // highest at smallest minQty
  const min = tiers[tiers.length-1].priceEach;
  return { max, min };
}

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function snapToIncrement(qty, inc){
  const q = Math.floor(Number(qty || 0));
  const step = Math.max(0, Math.floor(Number(inc || 0)));
  if (!step) return Math.max(0, q);
  return Math.max(0, Math.floor(q / step) * step);
}

export async function initInventory({ gotoLanding, gotoCalendar, softRefresh=false } = {}) {
  const grid = document.getElementById('invGrid');
  const summary = document.getElementById('invSummary');
  const btnBack = document.getElementById('btnInvBack');
  const btnContinue = document.getElementById('btnInvContinue');
  const upsellEl = document.getElementById('invUpsell');

  const linesWrap = document.getElementById('invLines');
  const totalEl = document.getElementById('invTotal');
  const sideHint = document.getElementById('invSideHint');

  if (!grid || !summary || !btnBack || !btnContinue) return;

  btnBack.onclick = () => gotoLanding?.();
  btnContinue.onclick = () => gotoCalendar?.();

  const equipment = await listEquipment();
  const cart = getCart();
  let openId = null;

  function cartQty(id){ return Number(cart.find(x => x.id === id)?.qty || 0); }

  function setQty(id, qty, inc, maxSelectable){
    const step = Math.max(0, Math.floor(Number(inc || 0)));
    let q = snapToIncrement(qty, step);
    q = clamp(q, 0, maxSelectable);

    const idx = cart.findIndex(x => x.id === id);
    if (q <= 0) {
      if (idx !== -1) cart.splice(idx, 1);
      if (openId === id) openId = null;
    } else {
      if (idx === -1) cart.push({ id, qty: q });
      else cart[idx].qty = q;
    }

    setCart(cart);
    renderSummaryAndTotals();
    renderContinueState();
    updateFlowSummary?.();
    render();
    flashCard(id);
  }

  function flashCard(id){
    const card = grid.querySelector(`.inv-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    card.classList.remove('flash');
    // reflow
    void card.offsetWidth;
    card.classList.add('flash');
  }

  function renderContinueState(){
    btnContinue.disabled = cart.length === 0;
  }

  function renderSummaryAndTotals(){
    if (!cart.length) {
      summary.textContent = 'No items selected.';
      if (linesWrap) linesWrap.innerHTML = '';
      if (totalEl) totalEl.textContent = money(0);
      if (sideHint) sideHint.textContent = 'Pick quantities to see totals.';
      if (upsellEl){ upsellEl.hidden = true; upsellEl.innerHTML = ''; }
      return;
    }

    const parts = [];
    let total = 0;
    if (linesWrap) linesWrap.innerHTML = '';

    for (const ci of cart){
      const eq = equipment.find(e => e.id === ci.id);
      if (!eq) continue;
      const qty = Number(ci.qty || 0);
      const unit = unitPriceForQty(eq.pricingTiers, qty);
      const lineTotal = unit != null ? (unit * qty) : 0;
      total += lineTotal;

      parts.push(`${eq.name}: ${qty}`);

      if (linesWrap){
        const div = document.createElement('div');
        div.className = 'inv-line';
        div.innerHTML = `
          <div class="inv-line-top">
            <div>
              <div class="inv-line-name">${esc(eq.name)}</div>
              <div class="inv-line-qty">Qty: <strong>${qty}</strong></div>
            </div>
            <div>
              <div class="inv-line-price">${money(lineTotal)}</div>
              <div class="inv-line-unit">${unit != null ? `${money(unit)}/ea` : ''}</div>
            </div>
          </div>
        `;
        linesWrap.appendChild(div);
      }
    }

    summary.textContent = `Selected: ${parts.join(' • ')}`;
    if (totalEl) totalEl.textContent = money(total);
    if (sideHint) sideHint.textContent = 'Estimated item total (delivery/coupons later).';

    renderUpsell();
  }

  function computeUpsell(eq, current, increment, maxSelectable){
    const tiers = normalizeTiers(eq.pricingTiers);
    if (!tiers.length) return null;
    if (!increment || increment <= 0) return null;
    const next = current + increment;
    if (next <= 0 || next > maxSelectable) return null;

    const unitNow = unitPriceForQty(eq.pricingTiers, current);
    const unitNext = unitPriceForQty(eq.pricingTiers, next);
    if (unitNow == null || unitNext == null) return null;

    const totalNow = unitNow * current;
    const totalNext = unitNext * next;
    const delta = totalNext - totalNow;
    if (!isFinite(delta) || delta <= 0) return null;

    return { increment, delta, unitNext, next };
  }

  function renderUpsell(){
    if (!upsellEl) return;

    // Prefer currently open item; fallback to first item in cart
    const targetId = openId || (cart[0]?.id || null);
    const eq = equipment.find(e => e.id === targetId);
    if (!eq) { upsellEl.hidden = true; upsellEl.innerHTML=''; return; }

    const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity||0)));
    const comingSoon = qtyAvail === 0;
    const increment = Math.max(0, Math.floor(Number(eq.maxPerOrder||0)));
    const maxSelectable = comingSoon ? 0 : qtyAvail;

    const current = clamp(snapToIncrement(cartQty(eq.id), increment), 0, maxSelectable);
    const u = computeUpsell(eq, current, increment, maxSelectable);
    if (!u) { upsellEl.hidden = true; upsellEl.innerHTML=''; return; }

    upsellEl.hidden = false;
    upsellEl.innerHTML = `<span class="bang">!</span><div>Add <strong>${u.increment}</strong> more for only <strong>${money(u.delta)}</strong> <span class="muted">(new rate: ${money(u.unitNext)}/ea)</span></div>`;

    upsellEl.onclick = () => {
      setQty(eq.id, u.next, increment, maxSelectable);
      openId = eq.id;
      render();
    };
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

    grid.innerHTML = equipment.map(eq => {
      const qtyAvail = Math.max(0, Math.floor(Number(eq.quantity||0)));
      const comingSoon = qtyAvail === 0;
      const increment = Math.max(0, Math.floor(Number(eq.maxPerOrder||0)));
      const maxSelectable = comingSoon ? 0 : qtyAvail;

      const currentRaw = cartQty(eq.id);
      const current = clamp(snapToIncrement(currentRaw, increment), 0, maxSelectable);
      const selected = current > 0;

      const mm = minMaxPrice(eq.pricingTiers);
      const badge = comingSoon
        ? `<span class="inv-badge soon">Coming Soon</span>`
        : (mm ? `<span class="inv-badge">${money(mm.max)}/ea • As low as ${money(mm.min)}/ea</span>` : `<span class="inv-badge">Price TBD</span>`);

      const img = eq.imageUrl
        ? `<img src="${esc(eq.imageUrl)}" alt="">`
        : `<div class="inv-ph" aria-hidden="true">📦</div>`;

      const desc = eq.description ? esc(eq.description) : '—';
      const disabledAttr = comingSoon ? 'disabled' : '';
      const stepAttr = increment > 0 ? `step="${increment}"` : 'step="1"';
      const incHint = increment > 0 ? `Increment: ${increment}` : 'Increment: any';

      const isOpen = openId === eq.id;

      return `
        <article class="inv-card ${comingSoon ? 'is-soon':''} ${selected ? 'is-selected':''} ${isOpen ? 'is-open':''}" data-id="${esc(eq.id)}" data-inc="${increment}">
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
              <div class="inv-meta-line">${incHint}</div>
            </div>

            <div class="inv-controls">
              <button class="inv-btn inv-minus" type="button" ${disabledAttr}>−</button>
              <input class="inv-qty" type="number" min="0" max="${maxSelectable}" ${stepAttr} value="${current}" ${disabledAttr} />
              <button class="inv-btn inv-plus" type="button" ${disabledAttr}>+</button>
              <div class="inv-maxhint">${comingSoon ? 'Not available yet' : `Max: ${maxSelectable}`}</div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    grid.querySelectorAll('.inv-card').forEach(card => {
      const id = card.getAttribute('data-id');
      const inc = Math.max(0, Math.floor(Number(card.getAttribute('data-inc') || 0)));
      const step = inc > 0 ? inc : 1;

      const thumb = card.querySelector('.inv-thumb');
      const qtyInput = card.querySelector('.inv-qty');
      const minus = card.querySelector('.inv-minus');
      const plus = card.querySelector('.inv-plus');

      const getMax = () => Number(qtyInput.getAttribute('max') || 0);

      function selectAndOpen(){
        const max = getMax();
        const cur = Number(qtyInput.value||0);
        if (cur <= 0){
          const initial = Math.min(max, inc > 0 ? inc : 1);
          qtyInput.value = String(initial);
          setQty(id, initial, inc, max);
        }
        openId = id;
        render();
      }

      function unselect(){
        const max = getMax();
        qtyInput.value = '0';
        setQty(id, 0, inc, max);
        openId = null;
        render();
      }

      thumb?.addEventListener('click', () => {
        if (card.classList.contains('is-soon')) return;
        const cur = Number(qtyInput.value||0);
        // Clicking image toggles selection
        if (cur > 0) unselect();
        else selectAndOpen();
      });
      thumb?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); thumb.click(); }
      });

      qtyInput.addEventListener('focus', () => { openId = id; render(); });

      qtyInput.addEventListener('input', () => {
        const max = getMax();
        const snapped = snapToIncrement(qtyInput.value, inc);
        const v = clamp(snapped, 0, max);
        qtyInput.value = String(v);
        setQty(id, v, inc, max);
        openId = (v > 0) ? id : null;
        render();
      });

      minus.addEventListener('click', () => {
        const max = getMax();
        const v = clamp(snapToIncrement(Number(qtyInput.value || 0) - step, inc), 0, max);
        qtyInput.value = String(v);
        setQty(id, v, inc, max);
        openId = (v > 0) ? id : null;
        render();
      });

      plus.addEventListener('click', () => {
        const max = getMax();
        const v = clamp(snapToIncrement(Number(qtyInput.value || 0) + step, inc), 0, max);
        qtyInput.value = String(v);
        setQty(id, v, inc, max);
        openId = id;
        render();
      });
    });

    renderSummaryAndTotals();
    renderContinueState();
  }

  render();
  if (softRefresh) render();
}
