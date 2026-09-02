import { APP_CONFIG } from './config.js?v=rental-ux-v60';

let firebaseApp;
let auth;
let db;
let storage;
let authReadyPromise;

function hasFirebaseConfig() {
  const cfg = APP_CONFIG.firebase?.config || {};
  return APP_CONFIG.firebase?.enabled && cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId;
}

export function isFirebaseEnabled() {
  return Boolean(hasFirebaseConfig());
}

export async function initFirebase() {
  if (!hasFirebaseConfig()) return null;
  if (firebaseApp) return { firebaseApp, auth, db, storage };

  const appMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js');
  const authMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js');
  const fireMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  const storageMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js');

  firebaseApp = appMod.initializeApp(APP_CONFIG.firebase.config);
  auth = authMod.getAuth(firebaseApp);
  db = fireMod.getFirestore(firebaseApp);
  storage = storageMod.getStorage(firebaseApp);

  authReadyPromise = new Promise((resolve) => {
    const unsub = authMod.onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user || null);
    });
  });

  return { firebaseApp, auth, db, storage };
}

export async function waitForAuthReady() {
  if (!isFirebaseEnabled()) return null;
  await initFirebase();
  return authReadyPromise;
}

export async function firebaseSignup(email, password) {
  const { auth } = await initFirebase();
  const authMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js');
  return authMod.createUserWithEmailAndPassword(auth, email, password);
}

export async function firebaseLogin(email, password) {
  const { auth } = await initFirebase();
  const authMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js');
  return authMod.signInWithEmailAndPassword(auth, email, password);
}

export async function firebaseLogout() {
  const { auth } = await initFirebase();
  const authMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js');
  return authMod.signOut(auth);
}

export async function getCurrentFirebaseUser() {
  if (!isFirebaseEnabled()) return null;
  await waitForAuthReady();
  return auth.currentUser || null;
}

export async function listCollection(name) {
  const { db } = await initFirebase();
  const fireMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  const snap = await fireMod.getDocs(fireMod.collection(db, name));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function listCollectionWhere(name, field, op, value) {
  const { db } = await initFirebase();
  const fireMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  const q = fireMod.query(fireMod.collection(db, name), fireMod.where(field, op, value));
  const snap = await fireMod.getDocs(q);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function listCollectionWhereAll(name, filters = []) {
  const { db } = await initFirebase();
  const fireMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  const clauses = (filters || []).map((filter) => fireMod.where(filter.field, filter.op || '==', filter.value));
  const q = fireMod.query(fireMod.collection(db, name), ...clauses);
  const snap = await fireMod.getDocs(q);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function getDocById(collectionName, id) {
  const { db } = await initFirebase();
  const fireMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  const snap = await fireMod.getDoc(fireMod.doc(db, collectionName, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function upsertDoc(collectionName, id, data) {
  const { db } = await initFirebase();
  const fireMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  await fireMod.setDoc(fireMod.doc(db, collectionName, id), data, { merge: false });
}

export async function updateDocFields(collectionName, id, data = {}) {
  const { db } = await initFirebase();
  const fireMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  await fireMod.updateDoc(fireMod.doc(db, collectionName, id), data);
}

export async function deleteDocById(collectionName, id) {
  const { db } = await initFirebase();
  const fireMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  await fireMod.deleteDoc(fireMod.doc(db, collectionName, id));
}

export async function uploadFile(path, file) {
  const { storage } = await initFirebase();
  const storageMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js');
  const storageRef = storageMod.ref(storage, path);
  await storageMod.uploadBytes(storageRef, file);
  return storageMod.getDownloadURL(storageRef);
}


export async function bootstrapOrGetUserProfile(user) {
  if (!user) return null;
  const { db } = await initFirebase();
  const fireMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  const userRef = fireMod.doc(db, 'users', user.uid);
  const existing = await fireMod.getDoc(userRef);
  if (existing.exists()) return { id: existing.id, ...existing.data() };
  const securityRef = fireMod.doc(db, 'appSecurity', 'main');
  return fireMod.runTransaction(db, async (tx) => {
    const securitySnap = await tx.get(securityRef);
    const isBootstrapAdmin = !securitySnap.exists() || !securitySnap.data()?.adminUid;
    const now = new Date().toISOString();
    const profile = {
      uid: user.uid,
      email: user.email || '',
      firstName: '',
      lastName: '',
      phone: '',
      pickupAddress: '',
      role: isBootstrapAdmin ? 'admin' : 'employee',
      status: isBootstrapAdmin ? 'approved' : 'pending',
      createdAt: now,
      updatedAt: now
    };
    tx.set(userRef, profile, { merge: false });
    if (isBootstrapAdmin) tx.set(securityRef, { adminUid: user.uid, adminEmail: user.email || '', createdAt: now }, { merge: false });
    return { id: user.uid, ...profile };
  });
}


export async function reauthenticateCurrentUser(password) {
  const { auth } = await initFirebase();
  const user = auth.currentUser;
  if (!user?.email) throw new Error('No signed-in email/password user was found.');
  const authMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js');
  const credential = authMod.EmailAuthProvider.credential(user.email, String(password || ''));
  await authMod.reauthenticateWithCredential(user, credential);
  return true;
}

export async function callAdminFunction(name, data = {}) {
  const { firebaseApp } = await initFirebase();
  const functionsMod = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js');
  const functions = functionsMod.getFunctions(firebaseApp, 'us-central1');
  const callable = functionsMod.httpsCallable(functions, name);
  const result = await callable(data);
  return result.data;
}

export async function callAdminHttpFunction(name, data = {}) {
  const { auth } = await initFirebase();
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in.');
  const token = await user.getIdToken(true);
  const projectId = APP_CONFIG.firebase?.config?.projectId;
  const url = `https://us-central1-${projectId}.cloudfunctions.net/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Admin action failed (${response.status}).`);
  }
  return payload;
}
