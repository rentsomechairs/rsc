import { initFirebase, isFirebaseEnabled, waitForAuthReady } from './firebase-service.js';

export const FINANCE_COLLECTIONS = {
  expense: 'financeExpenses', income: 'financeIncome', mileage: 'financeMileage',
  vehicle: 'financeVehicles', asset: 'financeAssets', incident: 'financeIncidents',
  homeOffice: 'financeHomeOffice', category: 'financeCategories', attachment: 'financeAttachments',
  audit: 'financeAudit', rate: 'financeMileageRates'
};

let fire;
async function ctx() {
  if (!isFirebaseEnabled()) throw new Error('Firebase is not configured.');
  const user = await waitForAuthReady();
  if (!user) throw new Error('Please sign in through the admin page first.');
  const { db, storage } = await initFirebase();
  fire ||= await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  return { db, storage, user, fire };
}
export async function currentFinanceUser(){ return (await ctx()).user; }
function clean(obj){ return Object.fromEntries(Object.entries(obj).filter(([,v]) => v !== undefined)); }
export async function saveFinanceRecord(type, data, id='') {
  const {db,user,fire}=await ctx(); const collection=FINANCE_COLLECTIONS[type];
  if(!collection) throw new Error(`Unknown finance record type: ${type}`);
  const ref=id?fire.doc(db,collection,id):fire.doc(fire.collection(db,collection));
  const old=id?(await fire.getDoc(ref)).data():null;
  const now=fire.serverTimestamp();
  const payload=clean({...data, ownerId:user.uid, companyId:data.companyId||user.uid, recordType:type,
    updatedAt:now, ...(id?{}:{createdAt:now}), archived:Boolean(data.archived), deletedAt:data.deletedAt||null});
  await fire.setDoc(ref,payload,{merge:true});
  const tracked=['amount','totalAmount','businessUsePercent','categoryId','date','reviewStatus','documentationStatus','archived'];
  const changes={}; tracked.forEach(k=>{if(old && JSON.stringify(old[k])!==JSON.stringify(payload[k])) changes[k]={from:old[k]??null,to:payload[k]??null};});
  if(!old || Object.keys(changes).length){ await fire.addDoc(fire.collection(db,FINANCE_COLLECTIONS.audit),{
    ownerId:user.uid,companyId:user.uid,recordType:type,recordId:ref.id,action:old?'updated':'created',changes,createdAt:now
  }); }
  return ref.id;
}
export async function archiveFinanceRecord(type,id,reason=''){
  return saveFinanceRecord(type,{archived:true,deletedAt:new Date().toISOString(),deleteReason:reason},id);
}
export async function restoreFinanceRecord(type,id){return saveFinanceRecord(type,{archived:false,deletedAt:null,deleteReason:''},id);}
export async function permanentlyDeleteFinanceRecord(type,id){const {db,fire}=await ctx();await fire.deleteDoc(fire.doc(db,FINANCE_COLLECTIONS[type],id));}
export async function getFinanceRecord(type,id){const {db,fire}=await ctx();const s=await fire.getDoc(fire.doc(db,FINANCE_COLLECTIONS[type],id));return s.exists()?{id:s.id,...s.data()}:null;}
export async function listFinanceRecords(type,{taxYear='',reviewStatus='',categoryId='',limit=100,archived=false,startAfterDoc=null}={}){
  const {db,user,fire}=await ctx();
  const collectionName=FINANCE_COLLECTIONS[type];
  if(!collectionName) throw new Error(`Unknown finance record type: ${type}`);
  const clauses=[fire.where('archived','==',archived),fire.where('ownerId','==',user.uid)];
  if(taxYear!=='') clauses.push(fire.where('taxYear','==',Number(taxYear)));
  if(reviewStatus) clauses.push(fire.where('reviewStatus','==',reviewStatus));
  if(categoryId) clauses.push(fire.where('categoryId','==',categoryId));
  clauses.push(fire.orderBy('date','desc'),fire.limit(limit));
  if(startAfterDoc) clauses.push(fire.startAfter(startAfterDoc));
  try {
    const snap=await fire.getDocs(fire.query(fire.collection(db,collectionName),...clauses));
    return {records:snap.docs.map(d=>({id:d.id,...d.data()})),lastDoc:snap.docs.at(-1)||null,indexFallback:false};
  } catch(err) {
    // Keep the finance area usable while newly deployed composite indexes are building.
    // This fallback only runs for missing-index errors and never rewrites data.
    if(err?.code!=='failed-precondition' || !String(err?.message||'').toLowerCase().includes('index')) throw err;
    const fallbackLimit=Math.max(Number(limit)||100,2000);
    const snap=await fire.getDocs(fire.query(
      fire.collection(db,collectionName),
      fire.where('ownerId','==',user.uid),
      fire.limit(fallbackLimit)
    ));
    let records=snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>Boolean(r.archived)===Boolean(archived));
    if(taxYear!=='') records=records.filter(r=>Number(r.taxYear)===Number(taxYear));
    if(reviewStatus) records=records.filter(r=>r.reviewStatus===reviewStatus);
    if(categoryId) records=records.filter(r=>r.categoryId===categoryId);
    records.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || String(b.id).localeCompare(String(a.id)));
    records=records.slice(0,Number(limit)||100);
    return {records,lastDoc:null,indexFallback:true};
  }
}
export async function listReferenceRecords(type,limit=500){
  const {db,user,fire}=await ctx(); const snap=await fire.getDocs(fire.query(fire.collection(db,FINANCE_COLLECTIONS[type]),fire.where('ownerId','==',user.uid),fire.where('archived','==',false),fire.limit(limit)));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
export async function uploadFinanceAttachment({recordType,recordId,file,documentType='Other',notes=''}){
  const {db,storage,user,fire}=await ctx(); const sm=await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js');
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'); const path=`finance/${user.uid}/${recordType}/${recordId}/${Date.now()}-${safe}`;
  const ref=sm.ref(storage,path); await sm.uploadBytes(ref,file,{contentType:file.type||'application/octet-stream'}); const downloadURL=await sm.getDownloadURL(ref);
  const docRef=await fire.addDoc(fire.collection(db,FINANCE_COLLECTIONS.attachment),{ownerId:user.uid,companyId:user.uid,recordType,recordId,documentType,notes,
    originalFilename:file.name,fileType:file.type||'',size:file.size,storagePath:path,downloadURL,uploadedAt:fire.serverTimestamp(),archived:false});
  return {id:docRef.id,downloadURL,storagePath:path};
}
export async function listAttachments(recordType,recordId){const {db,user,fire}=await ctx();const s=await fire.getDocs(fire.query(fire.collection(db,FINANCE_COLLECTIONS.attachment),fire.where('ownerId','==',user.uid),fire.where('recordType','==',recordType),fire.where('recordId','==',recordId)));return s.docs.map(d=>({id:d.id,...d.data()}));}
export async function seedFinanceCategories(){
  const existing=await listReferenceRecords('category',5); if(existing.length) return;
  const expense=['Equipment and inventory','Repairs and maintenance','General supplies','Advertising','Software and subscriptions','Phone and internet','Vehicle expenses','Payment-processing fees','Home-office expenses','Startup costs','Professional services','Insurance','Storage','Taxes and fees','Other'];
  const income=['Rental income','Delivery fees','Setup fees','Damage payments','Customer reimbursements','Cancellation fees','Other income'];
  for(const [kind,names] of [['expense',expense],['income',income]]) for(let i=0;i<names.length;i++) await saveFinanceRecord('category',{name:names[i],kind,subcategories:[],sortOrder:i,defaultBusinessUsePercent:100,receiptNormallyRequired:kind==='expense',reviewStatus:'Reviewed',date:'1900-01-01',taxYear:0});
}
