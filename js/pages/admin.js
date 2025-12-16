/* js/pages/admin.js
   Minimal Admin panel (Owner/Admin only)
   - Manage Coupons (stored in Google Sheet via Apps Script)
*/

import { api } from "../api.js";
import { getSession } from "../app.js";

function esc(s){ return String(s??"").replace(/[&<>"']/g,(c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

export async function renderAdmin(ctx){
  const root = document.getElementById("page-admin");
  if (!root) return;

  const session = getSession();
  if (!session || (session.role !== "admin" && session.role !== "owner")){
    root.innerHTML = `<p>You do not have access to Admin.</p>`;
    return;
  }

  root.innerHTML = `
    <h2>Admin</h2>
    <p class="muted">Manage coupons. (More admin tools can be added later.)</p>

    <div class="card">
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between">
        <h3 style="margin:0">Coupons</h3>
        <button id="btnRefresh" class="btn-secondary">Refresh</button>
      </div>

      <div id="couponList" style="margin-top:12px"></div>

      <hr style="margin:14px 0"/>

      <h4 style="margin:0 0 8px">Add coupon</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <input id="newCode" placeholder="CODE (e.g. SAVE10)" />
        <select id="newType">
          <option value="percent">percent</option>
          <option value="amount">amount</option>
        </select>
        <input id="newAmount" type="number" step="0.01" placeholder="Amount" />
      </div>
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <input id="newActive" type="checkbox" checked />
        <span>Active</span>
      </label>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button id="btnAdd">Add</button>
        <button id="btnSave" class="btn-secondary">Save to backend</button>
      </div>

      <div id="adminMsg" style="margin-top:10px"></div>
    </div>
  `;

  const listEl = root.querySelector("#couponList");
  const msgEl = root.querySelector("#adminMsg");

  let coupons = [];

  function renderList(){
    if (!coupons.length){
      listEl.innerHTML = `<em>No coupons</em>`;
      return;
    }
    listEl.innerHTML = coupons.map((c, i)=>`
      <div class="row" style="display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08)">
        <div>
          <div><strong>${esc(c.code)}</strong> <span class="muted">(${esc(c.type)} ${esc(c.amount)})</span></div>
          <div class="muted" style="font-size:12px">${c.isActive ? "Active" : "Inactive"}</div>
        </div>
        <button data-i="${i}" class="btn-delete btn-secondary">Delete</button>
      </div>
    `).join("");

    listEl.querySelectorAll(".btn-delete").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const i = Number(btn.getAttribute("data-i"));
        coupons.splice(i,1);
        renderList();
      });
    });
  }

  async function load(){
    msgEl.textContent = "Loading…";
    try{
      const res = await api("admin.snapshot", {});
      coupons = (res.coupons || []).map(c=>({
        code: String(c.code||"").toUpperCase(),
        type: String(c.type||"percent"),
        amount: Number(c.amount||0),
        isActive: String(c.isActive||"true")==="true" || c.isActive===true
      }));
      renderList();
      msgEl.textContent = "";
    }catch(e){
      console.error(e);
      msgEl.textContent = e?.message || "Failed to load admin data.";
    }
  }

  root.querySelector("#btnRefresh").addEventListener("click", load);

  root.querySelector("#btnAdd").addEventListener("click", ()=>{
    const code = root.querySelector("#newCode").value.trim().toUpperCase();
    const type = root.querySelector("#newType").value;
    const amount = Number(root.querySelector("#newAmount").value || 0);
    const isActive = root.querySelector("#newActive").checked;

    if (!code){ msgEl.textContent = "Enter a coupon code."; return; }
    coupons.push({ code, type, amount, isActive });
    root.querySelector("#newCode").value="";
    root.querySelector("#newAmount").value="";
    root.querySelector("#newActive").checked=true;
    renderList();
    msgEl.textContent = "";
  });

  root.querySelector("#btnSave").addEventListener("click", async ()=>{
    msgEl.textContent = "Saving…";
    try{
      // Backend expects {items:[{code,type,amount,isActive}]}
      await api("admin.saveCoupons", { items: coupons });
      msgEl.textContent = "Saved.";
    }catch(e){
      console.error(e);
      msgEl.textContent = e?.message || "Save failed.";
    }
  });

  await load();
}
