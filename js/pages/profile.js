import { getSession, setSession, getUserByEmail, updateUserByEmail, listBookingsByEmail, getCart, setCart, getCheckout, setCheckout, listEquipment, getPrefs, patchPrefs } from '../db.js';
import { updateFlowSummary } from '../ui/flowbar.js';

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function money(n){ return `$${Number(n||0).toFixed(2)}`; }

function formatDateDisplay(iso){
  if (!iso) return '—';
  const [y,m,d] = String(iso).split('-').map(Number);
  if (!y||!m||!d) return iso;
  const dt = new Date(y, m-1, d);
  const mon = dt.toLocaleString(undefined,{month:'short'});
  const day = d;
  const yr = y;
  const suf = (day % 100 >= 11 && day % 100 <= 13) ? 'th' : ({1:'st',2:'nd',3:'rd'}[day%10]||'th');
  return `${mon}. ${day}${suf}, ${yr}`;
}

function groupBookings(bookings){
  const map = new Map();
  for (const b of bookings){
    const key = b.bookingId || b.groupId || b.id;
    if (!map.has(key)){
      map.set(key, {
        key,
        createdAt: b.createdAt,
        customerEmail: b.customerEmail,
        address: b.address,
        coupon: b.coupon || null,
        annual: !!b.annual,
        status: b.status || 'Pending',
        dates: [],
        items: b.items || {},
        totals: []
      });
    }
    const g = map.get(key);
    g.dates.push(b.date);
    // Keep latest address/status
    g.address = b.address || g.address;
    g.status = b.status || g.status;
    g.annual = g.annual || !!b.annual;
    g.items = b.items || g.items;
    g.totals.push(b.total || b.promoTotal || null);
  }
  const groups = Array.from(map.values());
  for (const g of groups){
    g.dates = g.dates.filter(Boolean).sort();
    g.createdAt = g.createdAt || (g.dates[0] ? g.dates[0] : null);
  }
  groups.sort((a,b) => String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  return groups;
}

function itemsSummary(items, equipment){
  const parts = [];
  for (const [id, qty] of Object.entries(items||{})){
    const eq = equipment.find(e => e.id === id);
    const name = eq ? eq.name : id;
    parts.push(`${name}: ${qty}`);
  }
  return parts.join(' • ') || '—';
}

export function initProfile({ gotoLanding, gotoInventory } = {}){
  const sess = getSession();
  const email = sess?.email || '';
  const role = sess?.role || 'guest';

  const btnOrderNow = document.getElementById('btnProfileOrderNow');

  // Profile tabs (Account / Orders / Settings)
  const tabsEl = document.getElementById('profileTabs');
  const tabAccount = document.getElementById('profileTabAccount');
  const tabOrders = document.getElementById('profileTabOrders');
  const tabSettings = document.getElementById('profileTabSettings');

  function showTab(key){
    if (!tabAccount || !tabOrders || !tabSettings) return;
    tabAccount.classList.toggle('hidden', key !== 'account');
    tabOrders.classList.toggle('hidden', key !== 'orders');
    tabSettings.classList.toggle('hidden', key !== 'settings');

    if (tabsEl){
      const btns = Array.from(tabsEl.querySelectorAll('.admin-tab'));
      btns.forEach(b => b.classList.toggle('active', b.dataset.tab === key));
    }
  }

  if (tabsEl){
    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.admin-tab');
      if (!btn) return;
      showTab(btn.dataset.tab || 'account');
    });
  }
  // default
  showTab('account');


  const promoToggle = document.getElementById('profileToggleUpsell');
  const prefs = getPrefs(sess) || {};
  if (promoToggle){
    promoToggle.checked = !prefs.hideUpsell;
    promoToggle.addEventListener('change', () => {
      patchPrefs({ hideUpsell: !promoToggle.checked }, sess);
    });
  }

  const annualToggle = document.getElementById('profileToggleAnnual');
  if (annualToggle){
    annualToggle.checked = !prefs.annualUpsellOff;
    annualToggle.addEventListener('change', () => {
      patchPrefs({ annualUpsellOff: !annualToggle.checked }, sess);
    });
  }

  const btnBack = document.getElementById('btnProfileBack');
    const badges = document.getElementById('profileBadges');
  const sub = document.getElementById('profileSub');

  const profEmail = document.getElementById('profEmail');
  const profRole = document.getElementById('profRole');
  const profName = document.getElementById('profName');
  const profPhone = document.getElementById('profPhone');

  const street = document.getElementById('profStreet');
  const city = document.getElementById('profCity');
  const state = document.getElementById('profState');
  const zip = document.getElementById('profZip');
  const notes = document.getElementById('profNotes');

  const btnSave = document.getElementById('btnProfSave');
  const btnClearAddr = document.getElementById('btnProfResetAddress');
  const savedMsg = document.getElementById('profSavedMsg');

  const guestUpgrade = document.getElementById('guestUpgrade');
  const guestPass = document.getElementById('guestNewPass');
  const guestPass2 = document.getElementById('guestNewPass2');
  const btnGuestUpgrade = document.getElementById('btnGuestUpgrade');

  const ordersList = document.getElementById('ordersList');
  const ordersEmpty = document.getElementById('ordersEmpty');
  const search = document.getElementById('orderSearch');

  // Back button removed from UI (kept safe if markup still has it)
  if (btnBack) btnBack.style.display = 'none';

  const user = getUserByEmail(email) || { email, role };

  function continueTarget(){
    const cart = getCart();
    const checkout = getCheckout() || {};
    const hasCart = cart.some(ci => Number(ci.qty || 0) > 0);
    const dates = Array.isArray(checkout.dates) ? checkout.dates : (checkout.date ? [checkout.date] : []);
    const hasDate = dates.length > 0;
    const addr = checkout.address || null;
    const hasAddr = !!(addr && (addr.street || addr.address1 || '').trim());

    if (!hasCart) return '#inventory';
    if (!hasDate) return '#calendar';
    if (!hasAddr) return '#address';
    return '#review';
  }

  function updateOrderButton(){
    const cart = getCart();
    const checkout = getCheckout() || {};
    const hasCart = cart.some(ci => Number(ci.qty || 0) > 0);
    const dates = Array.isArray(checkout.dates) ? checkout.dates : (checkout.date ? [checkout.date] : []);
    const started = hasCart || dates.length > 0 || !!(checkout.address && (checkout.address.street||'').trim());
    if (btnOrderNow) btnOrderNow.textContent = started ? 'Continue order' : 'Order Now';
  }

  btnOrderNow.onclick = () => {
    const h = continueTarget();
    location.hash = h;
    if (h === '#inventory') gotoInventory?.();
  };
  updateOrderButton();
  profEmail.value = user.email || '';
  profRole.value = user.role || role;

  profName.value = user.name || '';
  profPhone.value = user.phone || '';

  const addr = user.defaultAddress || {};
  street.value = addr.street || '';
  city.value = addr.city || '';
  state.value = addr.state || '';
  zip.value = addr.zip || '';
  notes.value = addr.notes || '';

  // Badges
  badges.innerHTML = '';
  if (role === 'admin') badges.innerHTML += '<span class="pill good">Admin</span>';
  if (role === 'guest') badges.innerHTML += '<span class="pill warn">Guest</span>';
  if (user.isVerified) badges.innerHTML += '<span class="pill good">Verified</span>';
  else badges.innerHTML += '<span class="pill warn">Not verified</span>';

  if (role === 'guest'){
    sub.textContent = 'You are browsing as a guest. You can upgrade to an account any time.';
    guestUpgrade.classList.remove('hidden');
  } else {
    guestUpgrade.classList.add('hidden');
  }

  function showSaved(){
    savedMsg.style.display = 'block';
    savedMsg.textContent = 'Saved.';
    setTimeout(()=> savedMsg.style.display='none', 1200);
  }

  btnClearAddr.onclick = () => {
    street.value=''; city.value=''; state.value=''; zip.value=''; notes.value='';
  };

  btnSave.onclick = () => {
    const patch = {
      name: profName.value.trim(),
      phone: profPhone.value.trim(),
      defaultAddress: {
        street: street.value.trim(),
        city: city.value.trim(),
        state: state.value.trim(),
        zip: zip.value.trim(),
        notes: notes.value.trim()
      }
    };
    updateUserByEmail(email, patch);
    showSaved();
  };

  btnGuestUpgrade.onclick = () => {
    const p1 = guestPass.value;
    const p2 = guestPass2.value;
    if (!p1 || p1.length < 4) { alert('Please choose a password (4+ chars).'); return; }
    if (p1 !== p2) { alert('Passwords do not match.'); return; }

    // Set password and flip role to user
    updateUserByEmail(email, { password: p1, role: 'user' });
    // Update session (keep email; flip role)
    const upgraded = getUserByEmail(email);
    setSession({ userId: upgraded?.id || null, email, role: upgraded?.role || 'user', createdAt: new Date().toISOString() });
    alert('Account created! You can now sign in with email + password.');
    guestUpgrade.classList.add('hidden');
    badges.innerHTML = '<span class="pill warn">Not verified</span>';
    updateFlowSummary?.();
  };

  // Orders
  const equipment = listEquipment();
  const bookings = listBookingsByEmail((email || 'guest'));
  const groups = groupBookings(bookings);

  function renderOrders(){
    const q = (search.value || '').trim().toLowerCase();
    const filtered = !q ? groups : groups.filter(g => {
      const txt = [
        g.key, g.status,
        (g.dates||[]).join(' '),
        itemsSummary(g.items, equipment),
        (g.address?.street||''),
        (g.address?.city||''),
        (g.address?.state||''),
        (g.address?.zip||'')
      ].join(' ').toLowerCase();
      return txt.includes(q);
    });

    ordersList.innerHTML = '';
    if (!filtered.length){
      ordersEmpty.style.display = 'block';
      return;
    }
    ordersEmpty.style.display = 'none';

    for (const g of filtered){
      const isAnnual = !!g.annual || (g.dates && g.dates.length === 5);
      const datesLabel = isAnnual ? g.dates.map(formatDateDisplay).join(' • ') : formatDateDisplay(g.dates[0]);
      const addrLabel = g.address ? `${g.address.street || ''} • ${g.address.city || ''}, ${g.address.state || ''} ${g.address.zip || ''}` : '—';
      const itemsLabel = itemsSummary(g.items, equipment);

      // Try to compute total from stored totals; fallback to 0
      const stored = g.totals.filter(x => x != null);
      const total = stored.length ? stored[0] : null;

      const el = document.createElement('div');
      el.className = 'order-card';
      el.innerHTML = `
        <div class="order-top">
          <div>
            <div class="order-title">${isAnnual ? '5-Year Annual Booking' : 'Single Booking'} <span class="muted">• ${esc(g.status)}</span></div>
            <div class="order-meta">
              <div><strong>Dates:</strong> ${esc(datesLabel)}</div>
              <div><strong>Items:</strong> ${esc(itemsLabel)}</div>
              <div><strong>Address:</strong> ${esc(addrLabel)}</div>
            </div>
          </div>
          <div class="order-right">
            <div class="order-total">${total != null ? money(total) : ''}</div>
            <div class="muted" style="font-size:12px;">${g.key}</div>
          </div>
        </div>

        <div class="order-actions">
          <button class="btn btn-ghost btn-mini" type="button" data-action="reorder">Order again</button>
          <button class="btn btn-ghost btn-mini" type="button" data-action="toReview">Jump to review</button>
        </div>
      `;

      el.querySelector('[data-action="reorder"]').onclick = () => {
        // Prefill cart + checkout
        setCart(Object.entries(g.items||{}).map(([id, qty]) => ({ id, qty })));
        setCheckout({
          annual: isAnnual,
          dates: isAnnual ? (g.dates || []) : [g.dates[0]],
          date: isAnnual ? null : g.dates[0],
          address: g.address || null
        });
        updateFlowSummary?.();
        alert('Loaded this order. You can review and adjust before placing again.');
        location.hash = '#inventory';
        gotoInventory?.();
      };

      el.querySelector('[data-action="toReview"]').onclick = () => {
        location.hash = '#review';
      };

      ordersList.appendChild(el);
    }
  }

  search.addEventListener('input', renderOrders);
  renderOrders();
}
