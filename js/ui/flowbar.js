import { listEquipment, getCart, readDb } from '../db.js';

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
  return (pricingTiers || [])
    .map(t => ({ minQty: Number(t.minQty||0), priceEach: Number(t.priceEach||0) }))
    .filter(t => t.minQty > 0 && t.priceEach > 0)
    .sort((a,b)=>a.minQty-b.minQty);
}
function annualPromoTotal(cart, equipment, datesCount){
  const PROMO = 0.75;
  let normalPerDate = 0;
  let promoPerDate = 0;
  for (const ci of cart){
    const eq = equipment.find(e => e.id === ci.id);
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
  return chosen ? chosen.priceEach : null;
}

export function setActiveStep(step){
  document.querySelectorAll('.flowstep').forEach(btn => {
    btn.classList.toggle('active', (btn.getAttribute('data-step') === step));
  });
}

export function updateFlowSummary(){
  const lines = document.getElementById('flowSummaryLines');
  const dateEl = document.getElementById('flowSummaryDate');
  const totalEl = document.getElementById('flowSummaryTotal');
  if (!lines || !dateEl || !totalEl) return;

  const db = readDb();
  const annual = !!db.checkout?.annual;
  const dates = Array.isArray(db.checkout?.dates) ? db.checkout.dates : (db.checkout?.date ? [db.checkout.date] : []);
  if (!dates.length) dateEl.textContent = '—';
  else if (!annual) dateEl.textContent = formatDateDisplay(dates[0]);
  else dateEl.textContent = `${dates.length}/5 selected`;

  const cart = getCart();
  const equipment = listEquipment();

  if (!cart.length){
    lines.textContent = 'No items selected.';
    totalEl.textContent = money(0);
    return;
  }

  
  function annualPromoPerDate(cart, equipment){
    const PROMO = 0.75;
    let perDate = 0;
    for (const ci of cart){
      const eq = equipment.find(e => e.id === ci.id);
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
  for (const ci of cart){
    const eq = equipment.find(e => e.id === ci.id);
    if (!eq) continue;
    const qty = Number(ci.qty||0);
    parts.push(`${eq.name}: ${qty}`);
    const unit = unitPriceForQty(eq.pricingTiers, qty);
    if (unit != null) perDateTotal += unit * qty;
  }

  lines.textContent = parts.join(' • ');
    if (annual){
    const promo = annualPromoTotal(cart, equipment, 5);
    totalEl.textContent = money(promo.promo);
  } else {
    const multiplier = (dates.length ? 1 : 0);
    totalEl.textContent = money(perDateTotal * (multiplier || 1));
  }
}

export function wireFlowbarNav({ gotoLanding, gotoInventory, gotoCalendar, gotoAddress, gotoReview } = {}){
  document.querySelectorAll('.flowstep').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = btn.getAttribute('data-step');
      if (step === 'login') gotoLanding?.();
      if (step === 'inventory') gotoInventory?.();
      if (step === 'date') gotoCalendar?.();
      if (step === 'address') gotoAddress?.();
      if (step === 'review') gotoReview?.();
    });
  });
}
