import { listEquipment, getCart, getCheckout, getSession, upgradeGuestToUser } from '../db.js';

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

function unitPriceForQty(pricingTiers, qty){
  const tiers = normalizeTiers(pricingTiers);
  const q = Number(qty||0);
  let chosen = null;
  for (const t of tiers){
    if (q >= t.minQty) chosen = t;
  }
  if (!chosen && tiers.length) chosen = tiers[0];
  return chosen ? chosen.priceEach : null;
}

function guestFlatUnit(pricingTiers){
  const tiers = normalizeTiers(pricingTiers);
  if (!tiers.length) return null;
  // Highest price is the smallest tier
  return tiers[0].priceEach;
}

export function computeTotals({ roleOverride } = {}){
  const sess = getSession();
  const role = roleOverride || sess?.role || '';
  const equipment = listEquipment();
  const cart = getCart();

  let perDateMember = 0;
  let perDateGuest = 0;
  for (const ci of cart){
    const eq = equipment.find(e => String(e.id) === String(ci.id));
    if (!eq) continue;
    const qty = Number(ci.qty||0);
    const memberUnit = unitPriceForQty(eq.pricingTiers, qty);
    const guestUnit = guestFlatUnit(eq.pricingTiers);
    if (memberUnit != null) perDateMember += memberUnit * qty;
    if (guestUnit != null) perDateGuest += guestUnit * qty;
  }

  // NOTE: Guests do not have 5-year option in UI.
  const checkout = getCheckout() || {};
  const annual = !!checkout.annual;
  const dates = Array.isArray(checkout.dates) ? checkout.dates : (checkout.date ? [checkout.date] : []);

  // For member totals in annual mode, apply promo logic that exists elsewhere.
  if (annual && dates.length === 5){
    const PROMO = 0.75;
    let promoPerDate = 0;
    for (const ci of cart){
      const eq = equipment.find(e => String(e.id) === String(ci.id));
      if (!eq) continue;
      const qty = Number(ci.qty||0);
      const memberUnit = unitPriceForQty(eq.pricingTiers, qty);
      const name = (eq.name||'').toLowerCase();
      if (name.includes('chair')) promoPerDate += PROMO * qty;
      else if (memberUnit != null) promoPerDate += memberUnit * qty;
    }
    const memberTotal = promoPerDate * 5;
    const guestTotal = perDateGuest * 5;
    const save = Math.max(0, guestTotal - memberTotal);
    return { guestTotal, memberTotal, save, money };
  }

  const guestTotal = perDateGuest;
  const memberTotal = perDateMember;
  const save = Math.max(0, guestTotal - memberTotal);
  return { guestTotal, memberTotal, save, money };
}

function openModal({ title, bodyHtml, actions=[] }){
  const modal = document.getElementById('uiModal');
  const backdrop = document.getElementById('uiModalBackdrop');
  const closeBtn = document.getElementById('uiModalClose');
  const t = document.getElementById('uiModalTitle');
  const body = document.getElementById('uiModalBody');
  const act = document.getElementById('uiModalActions');
  if (!modal || !backdrop || !closeBtn || !t || !body || !act) return null;

  t.textContent = title || 'Modal';
  body.innerHTML = bodyHtml || '';
  act.innerHTML = '';

  const close = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');
    closeBtn.onclick = null;
    backdrop.onclick = null;
  };

  closeBtn.onclick = close;
  backdrop.onclick = close;

  for (const a of actions){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${a.kind || ''}`.trim();
    b.textContent = a.label || 'OK';
    b.onclick = () => {
      const res = a.onClick?.();
      if (res !== false) close();
    };
    act.appendChild(b);
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
  return { close, body, act };
}

export function wireGuestSignup({
  button,
  onUpgraded,
} = {}){
  if (!button) return;
  button.addEventListener('click', () => {
    const totalsBefore = computeTotals({ roleOverride: 'guest' });

    const signupModal = openModal({
      title: 'Create your account',
      bodyHtml: `
        <div class="muted" style="margin-bottom:10px;">Create a free account to unlock member pricing. <strong>We will ask you to verify your email after launch.</strong></div>
        <div class="grid2" style="gap:10px;">
          <div>
            <label>Email</label>
            <input class="input" id="signupEmail" type="email" placeholder="you@example.com" autocomplete="email" />
          </div>
          <div>
            <label>Password</label>
            <div class="pw-row">
              <input class="input" id="signupPass" type="password" placeholder="••••••••" autocomplete="new-password" />
              <button class="btn btn-ghost pw-toggle" id="togglePass" type="button">Show</button>
            </div>
          </div>
          <div>
            <label>Confirm password</label>
            <div class="pw-row">
              <input class="input" id="signupPass2" type="password" placeholder="••••••••" autocomplete="new-password" />
              <button class="btn btn-ghost pw-toggle" id="togglePass2" type="button">Show</button>
            </div>
          </div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:10px;">By signing up you agree to verify your email (coming soon).</div>
      `,
      actions: [
        { label: 'Cancel', kind: 'btn-ghost' },
        { label: 'Create account', kind: 'btn-good', onClick: () => {
            const email = String(document.getElementById('signupEmail')?.value || '').trim();
            const pass = String(document.getElementById('signupPass')?.value || '');
            const pass2 = String(document.getElementById('signupPass2')?.value || '');
            if (!email || !email.includes('@')) return alert('Please enter a valid email.'), false;
            if (!pass || pass.length < 4) return alert('Password must be at least 4 characters.'), false;
            if (pass !== pass2) return alert('Passwords do not match.'), false;

            const next = upgradeGuestToUser(email, pass);
            if (!next) return alert('Unable to create account.'), false;

            // Close the signup modal now that the account is created.
            try { signupModal?.close?.(); } catch {}

            // Apply upgraded session state immediately in the current view.
            try { onUpgraded?.(); } catch {}

            const totalsAfter = computeTotals({ roleOverride: 'user' });
            const oldPrice = totalsBefore.guestTotal;
            const newPrice = totalsAfter.memberTotal;

            // Congratulatory modal (continue stays on the same page/step).
            openModal({
              title: 'Congrats! Member pricing applied',
              bodyHtml: `
                <div style="display:flex;justify-content:space-between;gap:14px;align-items:baseline;">
                  <div>
                    <div class="muted" style="font-size:12px;">Old total</div>
                    <div style="font-weight:950;font-size:18px;opacity:.75;text-decoration:line-through;">${money(oldPrice)}</div>
                  </div>
                  <div style="text-align:right;">
                    <div class="muted" style="font-size:12px;">New member total</div>
                    <div style="font-weight:980;font-size:22px;">${money(newPrice)}</div>
                  </div>
                </div>
                <div class="muted" style="margin-top:10px;">Your order has been updated with our member pricing.</div>
              `,
              actions: [
                { label: 'Continue order', kind: 'btn-good', onClick: () => {
                    onUpgraded?.();
                    // Ensure the page fully reflects the new session (fixes calendar annual toggle edge cases).
                    setTimeout(() => { try { location.reload(); } catch {} }, 60);
                  } }
              ]
            });
            return false;
          } }
      ]
    });

    // Wire show/hide password buttons
    setTimeout(() => {
      const p = document.getElementById('signupPass');
      const p2 = document.getElementById('signupPass2');
      const t1 = document.getElementById('togglePass');
      const t2 = document.getElementById('togglePass2');
      if (t1 && p){
        t1.onclick = () => {
          const show = p.type === 'password';
          p.type = show ? 'text' : 'password';
          t1.textContent = show ? 'Hide' : 'Show';
        };
      }
      if (t2 && p2){
        t2.onclick = () => {
          const show = p2.type === 'password';
          p2.type = show ? 'text' : 'password';
          t2.textContent = show ? 'Hide' : 'Show';
        };
      }
    }, 0);
  });
}
