import { listEquipment, getSession, createGuestSession } from '../db.js';

function esc(s){
  return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function money(n){ return `$${Number(n||0).toFixed(2)}`; }

function normalizeTiers(pricingTiers){
  let tiers = pricingTiers;
  if (typeof tiers === 'string'){
    try { tiers = JSON.parse(tiers); } catch { tiers = []; }
  }
  if (tiers && !Array.isArray(tiers) && typeof tiers === 'object'){
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

function minMaxPrice(pricingTiers){
  const tiers = normalizeTiers(pricingTiers);
  if (!tiers.length) return null;
  const max = tiers[0].priceEach; // highest price
  const min = tiers[tiers.length-1].priceEach; // lowest price
  return { min, max };
}

export function initCatalog({ gotoLanding, gotoInventory } = {}){
  const grid = document.getElementById('catGrid');
  const btnBack = document.getElementById('btnCatBack');
  if (!grid) return;

  // Back button is only needed when browsing the catalog while logged out.
  // If the user is signed in (guest or member), we hide it to keep the flow inside the app.
  const sess = getSession();
  if (btnBack){
    btnBack.style.display = sess ? 'none' : '';
    if (!sess) btnBack.addEventListener('click', () => gotoLanding?.());
  }

  const equipment = listEquipment();
  if (!equipment.length){
    grid.innerHTML = `<div class="inv-empty"><div class="inv-empty-title">No inventory yet.</div><div class="inv-empty-sub">An admin can add items from the Admin page.</div></div>`;
    return;
  }

  grid.innerHTML = equipment.map(eq => {
    const mm = minMaxPrice(eq.pricingTiers);
    const img = eq.imageUrl
      ? `<img src="${esc(eq.imageUrl)}" alt="">`
      : `<div class="cat-ph" aria-hidden="true">📦</div>`;
    const guest = mm ? `${money(mm.max)}` : '—';
    const member = mm ? `${money(mm.min)}` : '—';

    return `
      <article class="cat-card" data-id="${esc(eq.id)}" role="button" tabindex="0" aria-label="Rent ${esc(eq.name)} now">
        <div class="cat-thumb">${img}</div>
        <div class="cat-body">
          <div class="cat-name">${esc(eq.name)}</div>
          <div class="cat-prices">
            <div class="cat-price-main">${guest} <span class="muted">as a guest</span></div>
            <div class="cat-price-sub">As low as ${member} <span class="muted">when logged in</span></div>
          </div>
          <button class="btn btn-good cat-cta" type="button">Rent ${esc(eq.name)} now</button>
        </div>
      </article>
    `;
  }).join('');

  function pick(eqId){
    // Ensure an active session exists. If none, start as anonymous guest.
    const session = getSession();
    if (!session) createGuestSession();
    // Tell inventory page which item to auto-select.
    try { sessionStorage.setItem('rsc_preselect_item', String(eqId)); } catch {}
    gotoInventory?.();
  }

  grid.querySelectorAll('.cat-card').forEach(card => {
    const id = card.getAttribute('data-id');
    if (!id) return;
    const btn = card.querySelector('.cat-cta');
    btn?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); pick(id); });
    card.addEventListener('click', () => pick(id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(id); }
    });
  });
}
