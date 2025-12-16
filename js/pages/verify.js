/* js/pages/verify.js
   Email verification page
*/

import { api } from "../api.js";
import { setSession } from "../app.js";

const PENDING_EMAIL_KEY = "rsc_pending_email_v1";

export function renderVerify(root){
  const pendingEmail = (sessionStorage.getItem(PENDING_EMAIL_KEY)||"").trim();

  root.innerHTML = `
    <h2>Verify your email</h2>
    <p class="muted">Enter the code we emailed you. Codes expire after ~15 minutes.</p>

    <div class="card">
      <label class="muted" style="display:block;margin-bottom:6px">Email</label>
      <input id="verifyEmailInput" type="email" placeholder="you@example.com" value="${pendingEmail.replace(/"/g,'&quot;')}" />

      <label class="muted" style="display:block;margin:10px 0 6px">Verification code</label>
      <input id="verifyCodeInput" type="text" placeholder="6-digit code" />

      <div style="margin-top:10px">
        <button id="verifyBtn">Verify</button>
        <button id="resendBtn" class="btn-secondary" style="margin-left:8px">Resend code</button>
      </div>

      <div id="verifyMsg" style="margin-top:10px"></div>
    </div>
  `;

  const msg = root.querySelector("#verifyMsg");

  root.querySelector("#verifyBtn").onclick = async () => {
    const email = root.querySelector("#verifyEmailInput").value.trim().toLowerCase();
    const code = root.querySelector("#verifyCodeInput").value.trim();
    if (!email || !code) {
      msg.textContent = "Enter your email and the verification code.";
      return;
    }

    msg.textContent = "Verifying…";

    try {
      const res = await api("auth.verify", { email, code });
      if (res.session){
        setSession(res.session);
        sessionStorage.removeItem(PENDING_EMAIL_KEY);
        location.hash = "#inventory";
      }else{
        msg.textContent = "Unexpected verification response.";
      }
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || "Verification failed.";
    }
  };

  root.querySelector("#resendBtn").onclick = async () => {
    const email = root.querySelector("#verifyEmailInput").value.trim().toLowerCase();
    if (!email){
      msg.textContent = "Enter your email first.";
      return;
    }

    msg.textContent = "Sending new code…";
    try {
      await api("auth.resendVerify", { email });
      msg.textContent = "Verification code resent.";
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || "Failed to resend code.";
    }
  };
}
