import * as db from '../db.js';

export function initLanding({ gotoAdmin, gotoInventory }) {
  const btnGmail = document.getElementById('btnGmail');
  const gmailHelper = document.getElementById('gmailHelper');

  const btnEmailLogin = document.getElementById('btnEmailLogin');
  const emailInput = document.getElementById('emailInput');
  const passInput = document.getElementById('passInput');

  const btnGuestToggle = document.getElementById('btnGuestToggle');
  const guestPanel = document.getElementById('guestPanel');
  const guestEmail = document.getElementById('guestEmail');
  const btnGuestContinue = document.getElementById('btnGuestContinue');

  btnGmail?.addEventListener('click', () => {
    if (gmailHelper) gmailHelper.textContent = 'Gmail login will be added later (requires hosted OAuth).';
    alert('Gmail login not wired yet.');
  });

  btnGuestToggle?.addEventListener('click', () => {
    guestPanel?.classList.toggle('open');
    const isOpen = guestPanel?.classList.contains('open');
    btnGuestToggle.setAttribute('aria-expanded', String(!!isOpen));
    const chev = btnGuestToggle.querySelector('.chev');
    if (chev) chev.textContent = isOpen ? '▴' : '▾';
  });

  btnGuestContinue?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const email = (guestEmail?.value || '').trim();
    if (!email) return alert('Guest email is required.');
    const u = db.upsertUser(email, '', 'guest');
    db.setSession({ userId: u.id, email: u.email, role: 'guest' });
    gotoInventory?.();
  });

  btnEmailLogin?.addEventListener('click', () => {
    const email = (emailInput?.value || '').trim();
    const pass = passInput?.value || '';

    if (!email || !pass) return alert('Enter email and password.');

    if (email.toLowerCase() === db.ADMIN.email.toLowerCase() && pass === db.ADMIN.password) {
      db.setSession({ userId: 'admin_1', email, role: 'admin' });
      gotoAdmin?.();
      return;
    }

    const v = db.verifyUser(email, pass);
    if (!v.ok) {
      if (v.reason === 'bad_password') return alert('Wrong password.');
      const created = db.upsertUser(email, pass, 'user');
      db.setSession({ userId: created.id, email: created.email, role: 'user' });
      gotoInventory?.();
      return;
    }

    db.setSession({ userId: v.user.id, email: v.user.email, role: v.user.role || 'user' });
    gotoInventory?.();
  });
}
