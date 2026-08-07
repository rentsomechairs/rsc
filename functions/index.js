const { onRequest } = require("firebase-functions/v2/https");
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
