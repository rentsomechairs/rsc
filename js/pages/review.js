import { listEquipment, getCart, clearCart, readDb, writeDb, getSession } from '../db.js';
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
  return (pricingTiers || [])
    .map(t => ({ minQty: Number(t.minQty||0), priceEach: Number(t.priceEach||0) }))
    .filter(t => t.minQty > 0 && t.priceEach > 0)
    .sort((a,b)=>a.minQty-b.minQty);
}
function unitPriceForQty(pricingTiers, qty){
  const tiers = normalizeTiers(pricingTiers);
  const q = Number(qty||0);
  let chosen=null;
  for (const t of tiers){ if (q >= t.minQty) chosen=t; }
  return chosen ? chosen.priceEach : null;
}

function annualPromoTotals(cart, equipment, datesCount){
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
  const save = Math.max(0, normal - promo);
  return { normal, promo, save, promoRate: PROMO };
}

export function initReview({ gotoAddress, gotoDone } = {}){
  const itemsEl = document.getElementById('revItems');
  const dateEl = document.getElementById('revDate');
  const addrEl = document.getElementById('revAddress');
  const totalEl = document.getElementById('revTotal');
  const btnBack = document.getElementById('btnRevBack');
  const btnPlace = document.getElementById('btnPlaceBooking');

  const couponInput = document.getElementById('revCoupon');
  const couponBtn = document.getElementById('btnApplyCoupon');
  const couponMsg = document.getElementById('revCouponMsg');

  if (!itemsEl || !dateEl || !addrEl || !totalEl || !btnBack || !btnPlace) return;

  btnBack.onclick = () => gotoAddress?.();

  const db = readDb();
  const checkout = db.checkout || {};
  const annual = !!checkout.annual;
  const dates = Array.isArray(checkout.dates) ? checkout.dates : (checkout.date ? [checkout.date] : []);
  const addr = checkout.address || null;

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
    itemsEl.innerHTML = '';
    let perDateTotal = 0;

    for (const ci of cart){
      const eq = equipment.find(e => e.id === ci.id);
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

    let total = perDateTotal * (annual ? 5 : 1);

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
      } else if (coupon.type === 'flat'){
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
    const checkout2 = db2.checkout || {};
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

    const session = getSession();
    db2.bookings = db2.bookings || [];

    for (const dt of (annual2 ? dates2 : [dates2[0]])){
      const booking = {
        id: 'b_' + Math.random().toString(36).slice(2,10),
        createdAt: new Date().toISOString(),
        customerEmail: session?.email || 'guest',
        date: dt,
        address: checkout2.address,
        items: Object.fromEntries(cart.map(c => [c.id, c.qty])),
        coupon: coupon ? coupon.code : null,
        annual: annual2 ? true : false
      };
      db2.bookings.push(booking);
    }

    db2.checkout = {};
    writeDb(db2);
    clearCart();
    updateFlowSummary?.();

    alert(annual2 ? '5 bookings placed! (Prototype stored locally)' : 'Booking placed! (Prototype stored locally)');
    gotoDone?.();
  };

  render();
}
