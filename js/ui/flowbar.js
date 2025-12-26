import { listEquipment, getCart, getCheckout, getSession, upgradeGuestToUser } from '../db.js';

function formatDateDisplay(iso){
  if (!iso) return '—';
  const [y,m,d] = String(iso).split('-').map(Number);
  if (!y||!m||!d) return iso;
  const dt = new Date(y, m-1, d);
  const mon = dt.toLocaleString(undefined,{month:'short'});
  const day = d;
  const yr = y;
  const suf = (day % 100 >= 11 && day % 100 <= 13) ? 'th' : ({1:'st',2:'nd',3:'rd'}[day%10]||'th');
  // Add period after month abbrev
  return `${mon}. ${day}${suf}, ${yr}`;
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
function annualPromoTotal(cart, equipment, datesCount){
  const PROMO = 0.75;
  let normalPerDate = 0;
  let promoPerDate = 0;
  for (const ci of cart){
    const eq = equipment.find(e => String(e.id) === String(ci.id));
    if (!eq) continue;
    const qty = Number(ci.qty||0);
    const unit = unitPriceForQty(eq.pricingTiers, qty);
    if (unit != null) normalPerDate += unit * qty;
    const name = (eq.name||'').toLowerCase();
    if (name.includes('chair')) promoPerDate += PROMO * qty;
    else if (unit != null) promoPerDate += unit * qty;
  }
  const normal = normalPerDate * datesCount;
  const promo = promoPerDate * datesCount;
  return { normal, promo, promoRate: PROMO };
}

function unitPriceForQty(pricingTiers, qty){
  const tiers = normalizeTiers(pricingTiers);
  const q = Number(qty||0);
  let chosen=null;
  for (const t of tiers){ if (q >= t.minQty) chosen=t; }
  if (!chosen && tiers.length) chosen = tiers[0];
  return chosen ? chosen.priceEach : null;
}

export function setActiveStep(step){
  document.querySelectorAll('.flowstep').forEach(btn => {
    const on = (btn.getAttribute('data-step') === step);
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current','step');
    else btn.removeAttribute('aria-current');
  });
}

export function updateFlowSummary(){
  const lines = document.getElementById('flowSummaryLines');
  const dateEl = document.getElementById('flowSummaryDate');
  const totalEl = document.getElementById('flowSummaryTotal');
  const memberWrap = document.getElementById('flowSummaryMemberWrap');
  const memberEl = document.getElementById('flowSummaryMember');
  // Signup/upsell is no longer shown in the flowbar summary.
  const upsellBox = document.getElementById('flowSummaryUpsell');
  if (!lines || !dateEl || !totalEl) return;

  const sess = getSession();

  const checkout = getCheckout();
  const annual = !!checkout?.annual;
  const dates = Array.isArray(checkout?.dates) ? checkout.dates : (checkout?.date ? [checkout.date] : []);
  if (!dates.length) dateEl.textContent = '—';
  else if (!annual) dateEl.textContent = formatDateDisplay(dates[0]);
  else dateEl.textContent = `${dates.length}/5 selected`;

  
  const cart = getCart();

  // Control which flow steps are clickable based on progress.
  const cartHasQty = cart.some(ci => Number(ci.qty || 0) > 0);
  const hasDate = annual ? (dates.length === 5) : (dates.length > 0);
  const addr = checkout?.address || null;
  const hasAddress = !!(addr && (addr.street || addr.address1 || '').trim());
  const canDate = cartHasQty;
  const canAddress = cartHasQty && hasDate;
  const canReview = cartHasQty && hasDate && hasAddress;

  const btnInv = document.querySelector('.flowstep[data-step="inventory"]');
  const btnDate = document.querySelector('.flowstep[data-step="date"]');
  const btnAddr = document.querySelector('.flowstep[data-step="address"]');
  const btnRev = document.querySelector('.flowstep[data-step="review"]');

  if (btnInv) btnInv.disabled = false;
  if (btnDate) btnDate.disabled = !canDate;
  if (btnAddr) btnAddr.disabled = !canAddress;
  if (btnRev) btnRev.disabled = !canReview;

  const equipment = listEquipment();

  if (!cart.length){
    lines.textContent = 'No items selected.';
    totalEl.textContent = money(0);
    if (memberWrap) memberWrap.classList.add('hidden');
    if (upsellBox) upsellBox.classList.add('hidden');
    return;
  }

  
  function annualPromoPerDate(cart, equipment){
    const PROMO = 0.75;
    let perDate = 0;
    for (const ci of cart){
      const eq = equipment.find(e => String(e.id) === String(ci.id));
      if (!eq) continue;
      const qty = Number(ci.qty||0);
      const unit = unitPriceForQty(eq.pricingTiers, qty);
      const name = (eq.name||'').toLowerCase();
      if (name.includes('chair')) perDate += PROMO * qty;
      else if (unit != null) perDate += unit * qty;
    }
    return perDate;
  }
const parts = [];
  let perDateTotal = 0;
  let guestPerDateTotal = 0;
  for (const ci of cart){
    const eq = equipment.find(e => String(e.id) === String(ci.id));
    if (!eq) continue;
    const qty = Number(ci.qty||0);
    parts.push(`${eq.name}: ${qty}`);
    const unit = unitPriceForQty(eq.pricingTiers, qty); // member tier pricing
    if (unit != null) perDateTotal += unit * qty;
    // Guest pricing = highest tier (flat)
    const tiers = normalizeTiers(eq.pricingTiers);
    const guestUnit = tiers.length ? tiers[0].priceEach : null;
    if (guestUnit != null) guestPerDateTotal += guestUnit * qty;
  }

  lines.textContent = parts.join(' • ');

  // Totals & guest upsell block
  if (sess?.role === 'guest'){
    // Guest total displayed as the primary total.
    const guestTotal = annual ? (annualPromoTotal(cart, equipment, 5).promo) : guestPerDateTotal;
    const memberTotal = annual ? (annualPromoTotal(cart, equipment, 5).normal) : perDateTotal;
    totalEl.textContent = money(guestTotal);
    if (memberWrap && memberEl){
      memberWrap.classList.remove('hidden');
      memberEl.textContent = money(memberTotal);
    }
    // No signup prompt here (moved to page-level summaries).
    if (upsellBox) upsellBox.classList.add('hidden');
    return;
  }

  // Non-guest (member/admin): show tier totals only
  if (memberWrap) memberWrap.classList.add('hidden');
  if (upsellBox) upsellBox.classList.add('hidden');
  if (annual){
    const promo = annualPromoTotal(cart, equipment, 5);
    totalEl.textContent = money(promo.promo);
  } else {
    totalEl.textContent = money(perDateTotal);
  }
}

export function wireFlowbarNav({ gotoInventory, gotoCalendar, gotoAddress, gotoReview } = {}){
  document.querySelectorAll('.flowstep').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const step = btn.getAttribute('data-step');
      if (step === 'inventory') gotoInventory?.();
      if (step === 'date') gotoCalendar?.();
      if (step === 'address') gotoAddress?.();
      if (step === 'review') gotoReview?.();
    });
  });
}
