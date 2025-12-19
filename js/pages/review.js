import { listEquipment, getCart, clearCart, readDb, writeDb, getSession, getCheckout, clearCheckout } from '../db.js';
import { updateFlowSummary } from '../ui/flowbar.js';

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
function unitPriceForQty(pricingTiers, qty){
  const tiers = normalizeTiers(pricingTiers);
  const q = Number(qty||0);
  let chosen=null;
  for (const t of tiers){ if (q >= t.minQty) chosen=t; }
  if (!chosen && tiers.length) chosen = tiers[0];
  return chosen ? chosen.priceEach : null;
}

function annualPromoTotals(cart, equipment, datesCount){
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
  const save = Math.max(0, normal - promo);
  return { normal, promo, save, promoRate: PROMO };
}

export function initReview({ gotoAddress, gotoDone } = {}){
  const itemsEl = document.getElementById('revItems');
  const dateEl = document.getElementById('revDate');
  const addrEl = document.getElementById('revAddress');
  const totalEl = document.getElementById('revTotal');
  const btnBack = document.getElementById('btnRevBack');
  const btnBackBottom = document.getElementById('btnRevBackBottom');
  const btnPlace = document.getElementById('btnPlaceBooking');
  const btnPlaceBottom = document.getElementById('btnPlaceBookingBottom');

  const couponInput = document.getElementById('revCoupon');
  const couponBtn = document.getElementById('btnApplyCoupon');
  const couponMsg = document.getElementById('revCouponMsg');

  if (!itemsEl || !dateEl || !addrEl || !totalEl || !btnBack || !btnPlace) return;

  const backHtml = `<div class="btn-main">Back</div><div class="btn-sub">to Address</div>`;
  const placeHtml = `<div class="btn-main">Place booking</div><div class="btn-sub">submit order</div>`;
  btnBack.innerHTML = backHtml;
  btnPlace.innerHTML = placeHtml;
  if (btnBackBottom) btnBackBottom.innerHTML = backHtml;
  if (btnPlaceBottom) btnPlaceBottom.innerHTML = placeHtml;

  btnBack.onclick = () => gotoAddress?.();
  if (btnBackBottom) btnBackBottom.onclick = () => btnBack.click();
  if (btnPlaceBottom) btnPlaceBottom.onclick = () => btnPlace.click();

  const db = readDb();
  const cart = getCart();
  const equipment = listEquipment();

  let coupon = null;
  couponBtn?.addEventListener('click', () => {
    const code = (couponInput?.value || '').trim().toUpperCase();
    if (!code){
      couponMsg.textContent = '';
      coupon = null;
      render();
      return;
    }
    const found = (db.coupons || []).find(c => (c.code||'').toUpperCase() === code && c.enabled);
    if (!found){
      couponMsg.textContent = 'Coupon not found (or disabled).';
      coupon = null;
      render();
      return;
    }
    couponMsg.textContent = `Coupon applied: ${found.code}`;
    coupon = found;
    render();
  });

  function render(){
    const checkout = getCheckout() || {};
    const annual = !!checkout.annual;
    const dates = Array.isArray(checkout.dates) ? checkout.dates : (checkout.date ? [checkout.date] : []);
    const addr = checkout.address || null;
    const timesByDate = (checkout.timesByDate && typeof checkout.timesByDate === 'object') ? checkout.timesByDate : {};

    itemsEl.innerHTML = '';
    let perDateTotal = 0;

    for (const ci of cart){
      const eq = equipment.find(e => String(e.id) === String(ci.id));
      if (!eq) continue;
      const qty = Number(ci.qty||0);
      const unit = unitPriceForQty(eq.pricingTiers, qty);
      const lineTotal = unit != null ? unit * qty : 0;
      perDateTotal += lineTotal;

      if (!annual){
        const row = document.createElement('div');
        row.className = 'rev-item';
        row.innerHTML = `
          <div>
            <div class="rev-item-name">${eq.name}</div>
            <div class="rev-item-meta">Qty: ${qty} • ${unit != null ? money(unit)+'/ea' : 'Price TBD'}</div>
          </div>
          <div class="rev-item-price">${money(lineTotal)}</div>
        `;
        itemsEl.appendChild(row);
      }
    }

    // Same-day delivery fee (admin controlled)
    const today = new Date(); today.setHours(0,0,0,0);
    const todayIso = today.toISOString().slice(0,10);
    const sameDayFee = Number(db.settings?.sameDayFee || 0);
    const firstDate = dates?.[0] || null;
    const applySameDay = !annual && firstDate === todayIso && sameDayFee > 0;

    // Optional fee line item
    if (applySameDay){
      const row = document.createElement('div');
      row.className = 'rev-item';
      row.innerHTML = `
        <div>
          <div class="rev-item-name">Same-day delivery fee</div>
          <div class="rev-item-meta">Applied because your delivery date is today.</div>
        </div>
        <div class="rev-item-price">${money(sameDayFee)}</div>
      `;
      itemsEl.appendChild(row);
    }

    let total = perDateTotal * (annual ? 5 : 1);
    if (applySameDay) total += sameDayFee;

    if (annual){
      const promo = annualPromoTotals(cart, equipment, 5);

      const row = document.createElement('div');
      row.className = 'rev-item';
      row.innerHTML = `
        <div>
          <div class="rev-item-name">5-Year Annual Deal</div>
          <div class="rev-item-meta">You save <span class="save-amt">${money(promo.save)}</span> over 5 years (${money(promo.normal)} → ${money(promo.promo)}).</div>
        </div>
        <div class="rev-item-price">${money(promo.promo)}</div>
      `;
      itemsEl.appendChild(row);

      total = promo.promo;
    }

    // Coupon applied after total
    let discount = 0;
    if (coupon){
      if (coupon.type === 'percent'){
        discount = total * (Number(coupon.amount||0)/100);
      } else if (coupon.type === 'fixed'){
        discount = Number(coupon.amount||0);
      }
      discount = Math.max(0, Math.min(discount, total));
    }
    const finalTotal = total - discount;

    if (coupon && discount > 0){
      const row = document.createElement('div');
      row.className = 'rev-item';
      row.innerHTML = `
        <div>
          <div class="rev-item-name">Discount (${coupon.code})</div>
          <div class="rev-item-meta">Applied at checkout (prototype)</div>
        </div>
        <div class="rev-item-price">- ${money(discount)}</div>
      `;
      itemsEl.appendChild(row);
    }

    totalEl.textContent = money(finalTotal);

    if (!annual) dateEl.textContent = dates[0] ? formatDateDisplay(dates[0]) : '—';
    else dateEl.textContent = dates.length ? dates.map(formatDateDisplay).join(' • ') : '—';

    if (addr){
      const parts = [addr.street, `${addr.city}, ${addr.state} ${addr.zip}`].filter(Boolean);
      const note = addr.notes ? ` (Notes: ${addr.notes})` : '';
      addrEl.textContent = parts.join(' • ') + note;
    } else {
      addrEl.textContent = '—';
    }

    btnPlace.disabled = !(cart.length && dates.length && addr && (!annual || dates.length === 5));
    updateFlowSummary?.();
  }

  btnPlace.onclick = () => {
    const db2 = readDb();
    const checkout2 = getCheckout() || {};
    const annual2 = !!checkout2.annual;
    const dates2 = Array.isArray(checkout2.dates) ? checkout2.dates : (checkout2.date ? [checkout2.date] : []);

    if (!cart.length || !dates2.length || !checkout2.address){
      alert('Missing items, date(s), or address.');
      return;
    }
    if (annual2 && dates2.length !== 5){
      alert('Annual deal requires 5 dates.');
      return;
    }

    
    // Compute totals snapshot for booking record(s)
    let perDateTotalPlaced = 0;
    for (const ci of cart){
      const eq = equipment.find(e => String(e.id) === String(ci.id));
      if (!eq) continue;
      const qty = Number(ci.qty||0);
      const unit = unitPriceForQty(eq.pricingTiers, qty);
      perDateTotalPlaced += (unit != null ? unit * qty : 0);
    }

    let normalTotalPlaced = perDateTotalPlaced * (annual2 ? 5 : 1);
    let promoTotalPlaced = null;

    if (annual2){
      const promo = annualPromoTotals(cart, equipment, 5);
      normalTotalPlaced = promo.normal;
      promoTotalPlaced = promo.promo;
    }

    const totalBeforeCouponPlaced = annual2 ? (promoTotalPlaced ?? normalTotalPlaced) : normalTotalPlaced;

    // Coupon applied after annual pricing (prototype)
    let discountPlaced = 0;
    if (coupon){
      if (coupon.type === 'percent'){
        discountPlaced = totalBeforeCouponPlaced * (Number(coupon.amount||0)/100);
      } else if (coupon.type === 'fixed'){
        discountPlaced = Number(coupon.amount||0);
      }
      discountPlaced = Math.max(0, Math.min(discountPlaced, totalBeforeCouponPlaced));
    }

    const finalTotalPlaced = totalBeforeCouponPlaced - discountPlaced;

const session = getSession();
    db2.bookings = db2.bookings || [];

    const bookingId = 'bk_' + Math.random().toString(36).slice(2,10);

    const firstDt = dates2[0];

    for (const dt of (annual2 ? dates2 : [dates2[0]])){
      const booking = {
        id: 'b_' + Math.random().toString(36).slice(2,10),
        bookingId,
        createdAt: new Date().toISOString(),
        customerEmail: session?.email || 'guest',
        date: dt,
        address: checkout2.address,
        items: Object.fromEntries(cart.map(c => [c.id, c.qty])),
        coupon: coupon ? coupon.code : null,
        annual: annual2 ? true : false,
        // Totals are stored on the first record for this bookingId (annual creates 5 records)
        total: (dt === firstDt) ? finalTotalPlaced : null,
        promoTotal: (annual2 && dt === firstDt) ? promoTotalPlaced : null,
        normalTotal: (annual2 && dt === firstDt) ? normalTotalPlaced : null,
        discount: (dt === firstDt) ? discountPlaced : null

      };
      db2.bookings.push(booking);
    }

    writeDb(db2);
    clearCheckout();
    clearCart();
    updateFlowSummary?.();

    alert(annual2 ? '5 bookings placed! (Prototype stored locally)' : 'Booking placed! (Prototype stored locally)');
    gotoDone?.();
  };

  render();
}
