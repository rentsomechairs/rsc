/* js/pages/inventory.js
   Inventory page
   Uses session helpers from app.js (NOT db.js)
*/

import { getCart, setCart } from "../app.js";
import { api } from "../api.js";

export async function renderInventory(ctx) {
  const root = document.getElementById("page-inventory");
  if (!root) return;

  let cart = getCart();

  root.innerHTML = `
    <h2>Select Items</h2>
    <div id="inventoryList">Loading…</div>
  `;

  const listEl = root.querySelector("#inventoryList");

  // Load inventory from backend
  const res = await api("equipment.list", {});
  // Backend returns: {items:[{id,name,description,imageUrl,totalQty,pricingTiers:[{priceEach,...}], ...}]}
  // UI expects simpler fields (price, available, desc)
  const items = (res.items || []).map((it) => {
    const tiers = Array.isArray(it.pricingTiers) ? it.pricingTiers : [];
    const base = tiers[0] || {};
    const price = Number(base.priceEach ?? base.price ?? 0) || 0;
    return {
      id: it.id,
      name: it.name,
      desc: it.description || it.desc || "",
      imageUrl: it.imageUrl || "",
      price,
      available: Number(it.totalQty ?? it.available ?? 0) || 0,
    };
  });

  listEl.innerHTML = items
    .map((item) => {
      const existing = cart.find((c) => c.id === item.id);
      const qty = existing ? existing.qty : 0;
      const selected = qty > 0 ? "selected" : "";

      return `
        <div class="inv-item ${selected}" data-id="${item.id}">
          <div class="inv-header">
            <strong>${item.name}</strong>
            <span>$${item.price}</span>
          </div>
          <div class="inv-controls">
            <button class="dec">−</button>
            <input type="number" min="0" value="${qty}" />
            <button class="inc">+</button>
          </div>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".inv-item").forEach((row) => {
    const id = row.dataset.id;
    const input = row.querySelector("input");
    const inc = row.querySelector(".inc");
    const dec = row.querySelector(".dec");

    function update(qty) {
      qty = Math.max(0, qty);
      cart = cart.filter((c) => c.id !== id);
      if (qty > 0) cart.push({ id, qty });
      setCart(cart);
      input.value = qty;
      row.classList.toggle("selected", qty > 0);
    }

    inc.onclick = () => update(Number(input.value) + 1);
    dec.onclick = () => update(Number(input.value) - 1);
    input.onchange = () => update(Number(input.value));
  });
}
