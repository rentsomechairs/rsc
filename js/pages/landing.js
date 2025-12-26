import * as db from '../db.js';

export function initLanding({ gotoAdmin, gotoInventory, gotoCatalog }) {
  const btnViewCatalog = document.getElementById('btnViewCatalog');
  const btnGmail = document.getElementById('btnGmail');
  const gmailHelper = document.getElementById('gmailHelper');

  const btnEmailLogin = document.getElementById('btnEmailLogin');
  const emailInput = document.getElementById('emailInput');
  const passInput = document.getElementById('passInput');
  const passConfirmInput = document.getElementById('passConfirmInput');

  const btnGuestToggle = document.getElementById('btnGuestToggle');

  btnGmail?.addEventListener('click', () => {
    if (gmailHelper) gmailHelper.textContent = 'Gmail login will be added later (requires hosted OAuth).';
    alert('Gmail login not wired yet.');
  });

  btnViewCatalog?.addEventListener('click', () => gotoCatalog?.());

  // Guest should be 1-click: no expanders, no explanation.
  btnGuestToggle?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    db.createGuestSession();
    gotoInventory?.();
  });

  btnEmailLogin?.addEventListener('click', () => {
    const email = (emailInput?.value || '').trim();
    const pass = passInput?.value || '';
    const pass2 = passConfirmInput?.value || '';

    if (!email || !pass) return alert('Enter email and password.');

    if (email.toLowerCase() === db.ADMIN.email.toLowerCase() && pass === db.ADMIN.password) {
      db.setSession({ userId: 'admin_1', email, role: 'admin' });
      gotoAdmin?.();
      return;
    }

    const v = db.verifyUser(email, pass);
    if (!v.ok) {
      if (v.reason === 'bad_password') return alert('Wrong password.');
      // New account (sign up): require confirmation password
      if (!pass2 || pass2 !== pass) return alert('Passwords do not match.');
      const created = db.upsertUser(email, pass, 'user');
      db.setSession({ userId: created.id, email: created.email, role: 'user' });
      gotoInventory?.();
      return;
    }

    db.setSession({ userId: v.user.id, email: v.user.email, role: v.user.role || 'user' });
    gotoInventory?.();
  });
}
