const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

const OWNER_UID = "2OjzWe94F5RJrFdgx3fSF8gceuF2";

function applyCors(req, res) {
  const origin = req.get("origin") || "";
  // This is an authenticated owner-only endpoint. Allow browser origins so it
  // works from localhost during testing and from GitHub Pages in production.
  res.set("Access-Control-Allow-Origin", origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

async function verifyOwner(req) {
  const header = String(req.get("authorization") || "");
  if (!header.startsWith("Bearer ")) throw new Error("Missing authorization token.");
  const token = await admin.auth().verifyIdToken(header.slice(7));
  if (token.uid !== OWNER_UID) throw new Error("Owner authorization is required.");
  return token;
}

exports.deleteEmployeeAuth = onRequest(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST required." });

    try {
      await verifyOwner(req);
      const uid = String(req.body?.uid || "").trim();
      if (!uid || uid === OWNER_UID) {
        return res.status(400).json({ ok: false, error: "A valid employee UID is required." });
      }

      const profile = await admin.firestore().collection("users").doc(uid).get();
      if (profile.exists && profile.data()?.role !== "employee") {
        return res.status(400).json({ ok: false, error: "The requested account is not an employee." });
      }

      try {
        await admin.auth().deleteUser(uid);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") throw error;
      }

      return res.json({ ok: true, uid });
    } catch (error) {
      console.error("deleteEmployeeAuth failed", error);
      return res.status(403).json({ ok: false, error: error?.message || "Employee authentication deletion failed." });
    }
  }
);


function orderEffectiveTotal(order = {}) {
  if (order.adjustedTotal !== "" && order.adjustedTotal != null && Number.isFinite(Number(order.adjustedTotal))) {
    return Number(order.adjustedTotal || 0);
  }
  if (Number.isFinite(Number(order.total))) return Number(order.total || 0);
  return Number(order.baseTotal || 0);
}

exports.syncCompletedOrderIncome = onDocumentWritten(
  { document: "orders/{orderId}", region: "us-central1" },
  async (event) => {
    const orderId = event.params.orderId;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    const incomeRef = admin.firestore().collection("financeIncome").doc(`order_${orderId}`);

    if (!after) {
      await incomeRef.delete().catch(() => {});
      return;
    }

    const total = orderEffectiveTotal(after);
    const isFree = Boolean(after.free) || String(after.paymentStatus || "").toLowerCase() === "free" || total <= 0;
    const eligible = String(after.status || "") === "Completed" && !isFree;

    if (!eligible) {
      await incomeRef.delete().catch(() => {});
      return;
    }

    const rawDate = String(after.completedAt || after.returnDate || after.exchangeDate || new Date().toISOString());
    const date = rawDate.slice(0, 10);
    const existing = await incomeRef.get();
    const payload = {
      ownerId: OWNER_UID,
      companyId: OWNER_UID,
      recordType: "income",
      source: "completed-order",
      sourceOrderId: orderId,
      orderId,
      payer: [after.firstName, after.lastName].filter(Boolean).join(" ") || "Customer",
      grossAmount: total,
      amount: total,
      processingFee: 0,
      netDeposit: total,
      description: `Completed rental order ${after.orderNumber || orderId}`,
      paymentMethod: after.paymentMethod || "",
      date,
      taxYear: Number(date.slice(0, 4)) || new Date().getFullYear(),
      reviewStatus: "Reviewed",
      documentationStatus: "Complete",
      archived: false,
      deletedAt: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (!existing.exists) payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    await incomeRef.set(payload, { merge: true });
  }
);
