/* js/ui/flowbar.js
   Flow/progress bar renderer
   Uses sessionStorage helpers from app.js, not db.js
*/

import { getCart, getCheckout } from "../app.js";

export function renderFlowbar(ctx) {
  const { routeKey } = ctx;
  const el = document.getElementById("flowbar");
  if (!el) return;

  const cart = getCart();
  const checkout = getCheckout();

  const steps = [
    { key: "inventory", label: "Inventory" },
    { key: "calendar", label: "Date" },
    { key: "address", label: "Address" },
    { key: "review", label: "Review" },
  ];

  el.innerHTML = steps
    .map((s) => {
      const active = s.key === routeKey ? "active" : "";
      const done =
        (s.key === "inventory" && cart.length > 0) ||
        (s.key === "calendar" && checkout?.date) ||
        (s.key === "address" && checkout?.address);

      return `
        <div class="flow-step ${active} ${done ? "done" : ""}">
          <span>${s.label}</span>
        </div>
      `;
    })
    .join("");
}
