import { initFirebase, isFirebaseEnabled, waitForAuthReady, reauthenticateCurrentUser } from './firebase-service.js?v=completed-revenue-fix-v12';

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


export async function syncCompletedOrderIncome(order = {}) {
  const {db,user,fire}=await ctx();
  if(!order?.id) throw new Error('Order ID is required for financial income sync.');
  const ref=fire.doc(db,FINANCE_COLLECTIONS.income,`order_${order.id}`);
  const isFree=Boolean(order.free) || String(order.paymentStatus||'').toLowerCase()==='free' || Number(order.total||0)===0;
  const isCompleted=String(order.status||'')==='Completed';
  if(!isCompleted || isFree){
    const existing=await fire.getDoc(ref);
    if(existing.exists()) await fire.deleteDoc(ref);
    return;
  }
  const gross=Number(order.adjustedTotal !== '' && order.adjustedTotal != null ? order.adjustedTotal : (order.total||order.baseTotal||0));
  const date=String(order.completedAt||order.returnDate||order.exchangeDate||new Date().toISOString()).slice(0,10);
  const payload={
    ownerId:user.uid, companyId:user.uid, recordType:'income', source:'completed-order',
    sourceOrderId:order.id, orderId:order.id, payer:[order.firstName,order.lastName].filter(Boolean).join(' ')||order.customerName||'Customer',
    grossAmount:gross, amount:gross, processingFee:0, netDeposit:gross,
    description:`Completed rental order ${order.orderNumber||order.id}`,
    paymentMethod:order.paymentMethod||'', date, taxYear:Number(date.slice(0,4))||new Date().getFullYear(),
    reviewStatus:'Reviewed', documentationStatus:'Complete', archived:false, deletedAt:null,
    updatedAt:fire.serverTimestamp()
  };
  const existing=await fire.getDoc(ref);
  await fire.setDoc(ref,{...payload,...(!existing.exists()?{createdAt:fire.serverTimestamp()}:{})},{merge:true});
}

export async function nukeAllFinancialRecords(password, confirmationPhrase) {
  if (String(confirmationPhrase || '').trim() !== 'DELETE ALL FINANCES') {
    throw new Error('Confirmation phrase does not match.');
  }

  // Password re-authentication is the first destructive-action gate.
  await reauthenticateCurrentUser(password);

  const { db, storage, user, fire } = await ctx();
  const collections = Object.values(FINANCE_COLLECTIONS);
  let deleted = 0;

  // Delete only records owned by the signed-in owner. Work in small batches so
  // the browser never floods Firestore's write queue.
  for (const collectionName of collections) {
    while (true) {
      const snap = await fire.getDocs(
        fire.query(
          fire.collection(db, collectionName),
          fire.where('ownerId', '==', user.uid),
          fire.limit(200)
        )
      );
      if (snap.empty) break;

      const batch = fire.writeBatch(db);
      snap.docs.forEach(docSnap => batch.delete(docSnap.ref));
      await batch.commit();
      deleted += snap.size;

      if (snap.size < 200) break;
    }
  }


  // Do not enumerate Firebase Storage from the browser here. Storage folder
  // listing can be blocked by browser CORS (especially on localhost) and would
  // keep the destructive reset stuck on "Deleting…". Finance attachment
  // metadata has already been deleted from Firestore, so any old receipt files
  // are now orphaned and inaccessible from Financial Records.

  return { ok: true, deleted };
}


const MASTER_FINANCE_TYPES = new Set(['expense','income','mileage','vehicle','asset','incident','homeOffice']);

function normalizeCsvKey(value=''){
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ');
}
function parseCsvNumber(value){
  const text=String(value??'').trim().replace(/[$,%]/g,'').replace(/,/g,'');
  if(text==='') return undefined;
  const n=Number(text);
  return Number.isFinite(n)?n:undefined;
}
function parseCsvBoolean(value){
  const text=String(value??'').trim().toLowerCase();
  if(!text) return undefined;
  if(['true','yes','y','1','active'].includes(text)) return true;
  if(['false','no','n','0','inactive'].includes(text)) return false;
  return undefined;
}
function csvDate(value){
  const text=String(value||'').trim();
  if(!text) return '';
  const direct=/^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
  if(direct) return direct;
  const d=new Date(text);
  if(Number.isNaN(d.getTime())) return text;
  return d.toISOString().slice(0,10);
}
function compactData(obj){
  return Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==undefined && v!==''));
}
async function getOwnerCollection(collectionName){
  const {db,user,fire}=await ctx();
  const snap=await fire.getDocs(fire.query(fire.collection(db,collectionName),fire.where('ownerId','==',user.uid)));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

export async function importMasterFinancialRows(rows=[]){
  if(!Array.isArray(rows) || !rows.length) throw new Error('The Financial CSV did not contain any data rows.');
  const {user}=await ctx();

  const categories=await getOwnerCollection(FINANCE_COLLECTIONS.category);
  const vehicles=await getOwnerCollection(FINANCE_COLLECTIONS.vehicle);
  const assets=await getOwnerCollection(FINANCE_COLLECTIONS.asset);
  const incidents=await getOwnerCollection(FINANCE_COLLECTIONS.incident);

  const categoryMap=new Map(categories.map(x=>[normalizeCsvKey(x.name),x]));
  const vehicleMap=new Map(vehicles.map(x=>[normalizeCsvKey(x.vehicleName||x.name),x]));
  const assetMap=new Map(assets.map(x=>[normalizeCsvKey(x.assetName||x.name),x]));
  const incidentMap=new Map(incidents.map(x=>[normalizeCsvKey(x.description||x.name),x]));

  const results={imported:0,skipped:0,errors:[],byType:{}};
  const ordered=[...rows].sort((a,b)=>{
    const priority={vehicle:0,asset:1,incident:2,expense:3,income:3,mileage:3,homeOffice:3,home_office:3,'home office':3};
    const at=String(a.record_type||a.recordType||'').trim();
    const bt=String(b.record_type||b.recordType||'').trim();
    return (priority[at]??priority[at.toLowerCase()]??9)-(priority[bt]??priority[bt.toLowerCase()]??9);
  });

  for(let index=0;index<ordered.length;index++){
    const row=ordered[index];
    const rawType=String(row.record_type||row.recordType||'').trim();
    const typeAliases={'home_office':'homeOffice','home office':'homeOffice','homeoffice':'homeOffice','damage':'incident','damage_loss':'incident','damage / loss':'incident','trip':'mileage','miles':'mileage'};
    const type=typeAliases[rawType.toLowerCase()]||rawType;
    if(!MASTER_FINANCE_TYPES.has(type)){
      results.skipped++;
      results.errors.push(`Row ${index+2}: unknown record_type "${type||'(blank)'}".`);
      continue;
    }
    if(type==='income' && String(row.source||'').trim().toLowerCase()==='completed-order'){
      results.skipped++;
      results.errors.push(`Row ${index+2}: completed-order income must be created with Sync Completed Orders, not the CSV.`);
      continue;
    }

    try{
      const date=csvDate(row.date||row.purchase_date||row.purchaseDate);
      const taxYear=parseCsvNumber(row.tax_year||row.taxYear) ?? (date?Number(date.slice(0,4)):new Date().getFullYear());
      const categoryName=String(row.category||row.category_name||row.categoryName||'').trim();
      const vehicleName=String(row.vehicle||row.vehicle_name||row.vehicleName||'').trim();
      const assetName=String(row.asset||row.asset_name||row.assetName||'').trim();
      const incidentName=String(row.incident||row.incident_name||row.incidentName||'').trim();
      const category=categoryMap.get(normalizeCsvKey(categoryName));
      const vehicle=vehicleMap.get(normalizeCsvKey(vehicleName));
      const asset=assetMap.get(normalizeCsvKey(assetName));
      const incident=incidentMap.get(normalizeCsvKey(incidentName));

      let data={
        date,taxYear,
        reviewStatus:String(row.review_status||row.reviewStatus||'Needs information').trim(),
        documentationStatus:String(row.documentation_status||row.documentationStatus||'Needs review').trim(),
        notes:String(row.notes||'').trim()
      };

      if(type==='expense'){
        const total=parseCsvNumber(row.amount||row.total_amount||row.totalAmount);
        const businessUse=parseCsvNumber(row.business_use_percent||row.businessUsePercent) ?? 100;
        data={...data,
          vendor:String(row.vendor||'').trim(), totalAmount:total,
          categoryId:category?.id||'', categoryName:category?.name||categoryName,
          subcategory:String(row.subcategory||'').trim(),
          description:String(row.description||'').trim(),
          businessPurpose:String(row.business_purpose||row.businessPurpose||'').trim(),
          useClassification:String(row.use_classification||row.useClassification||'100% business').trim(),
          businessUsePercent:businessUse,
          businessPortion:Number(((total||0)*businessUse/100).toFixed(2)),
          businessUseExplanation:String(row.business_use_explanation||row.businessUseExplanation||'').trim(),
          paymentMethod:String(row.payment_method||row.paymentMethod||'').trim(),
          accountUsed:String(row.account_used||row.accountUsed||'').trim(),
          customer:String(row.customer||'').trim(),
          vehicleId:vehicle?.id||'', assetId:asset?.id||''
        };
      } else if(type==='income'){
        const gross=parseCsvNumber(row.amount||row.gross_amount||row.grossAmount);
        const fee=parseCsvNumber(row.processing_fee||row.processingFee)??0;
        data={...data,
          payer:String(row.payer||row.customer||'').trim(),
          grossAmount:gross, amount:gross, processingFee:fee,
          netDeposit:parseCsvNumber(row.net_deposit||row.netDeposit)??Number(((gross||0)-fee).toFixed(2)),
          categoryId:category?.id||'', categoryName:category?.name||categoryName,
          paymentMethod:String(row.payment_method||row.paymentMethod||'').trim(),
          description:String(row.description||'').trim(),
          incidentId:incident?.id||'', assetId:asset?.id||'',
          source:String(row.source||'manual-csv').trim()
        };
      } else if(type==='mileage'){
        data={...data,
          vehicleId:vehicle?.id||'',
          startingLocation:String(row.starting_location||row.startingLocation||'').trim(),
          destination:String(row.destination||'').trim(),
          businessPurpose:String(row.business_purpose||row.businessPurpose||'').trim(),
          startingOdometer:parseCsvNumber(row.starting_odometer||row.startingOdometer),
          endingOdometer:parseCsvNumber(row.ending_odometer||row.endingOdometer),
          milesDriven:parseCsvNumber(row.miles||row.miles_driven||row.milesDriven),
          parking:parseCsvNumber(row.parking)??0, tolls:parseCsvNumber(row.tolls)??0,
          customer:String(row.customer||'').trim(), vendor:String(row.vendor||'').trim()
        };
      } else if(type==='vehicle'){
        data={...data,
          vehicleName:String(row.name||row.vehicle||row.vehicle_name||row.vehicleName||'').trim(),
          year:parseCsvNumber(row.year), make:String(row.make||'').trim(), model:String(row.model||'').trim(),
          purchaseDate:csvDate(row.purchase_date||row.purchaseDate), purchasePrice:parseCsvNumber(row.purchase_price||row.purchasePrice),
          businessUseStartDate:csvDate(row.business_use_start_date||row.businessUseStartDate),
          currentOdometer:parseCsvNumber(row.current_odometer||row.currentOdometer),
          ownershipType:String(row.ownership_type||row.ownershipType||'Owned').trim(),
          businessUsePercent:parseCsvNumber(row.business_use_percent||row.businessUsePercent)??100,
          deductionMethod:String(row.deduction_method||row.deductionMethod||'Undecided').trim(),
          active:parseCsvBoolean(row.active)??true
        };
      } else if(type==='asset'){
        const quantity=parseCsvNumber(row.quantity)??1;
        const purchaseAmount=parseCsvNumber(row.amount||row.purchase_amount||row.purchaseAmount);
        data={...data,
          assetName:String(row.name||row.asset||row.asset_name||row.assetName||'').trim(),
          assetCategory:String(row.asset_category||row.assetCategory||row.category||'').trim(),
          description:String(row.description||'').trim(), inventoryId:String(row.inventory_id||row.inventoryId||'').trim(),
          vendor:String(row.vendor||'').trim(), purchaseDate:csvDate(row.purchase_date||row.purchaseDate||date),
          purchaseAmount, quantity,
          perUnitCost:parseCsvNumber(row.per_unit_cost||row.perUnitCost)??((purchaseAmount&&quantity)?purchaseAmount/quantity:undefined),
          activeQuantity:parseCsvNumber(row.active_quantity||row.activeQuantity)??quantity,
          damagedQuantity:parseCsvNumber(row.damaged_quantity||row.damagedQuantity)??0,
          lostQuantity:parseCsvNumber(row.lost_quantity||row.lostQuantity)??0,
          soldQuantity:parseCsvNumber(row.sold_quantity||row.soldQuantity)??0,
          retiredQuantity:parseCsvNumber(row.retired_quantity||row.retiredQuantity)??0,
          placedInServiceDate:csvDate(row.placed_in_service_date||row.placedInServiceDate),
          businessUsePercent:parseCsvNumber(row.business_use_percent||row.businessUsePercent)??100
        };
      } else if(type==='incident'){
        data={...data,
          description:String(row.description||row.name||'').trim(),
          incidentType:String(row.incident_type||row.incidentType||'').trim(),
          assetId:asset?.id||'', vehicleId:vehicle?.id||'',
          quantityAffected:parseCsvNumber(row.quantity_affected||row.quantityAffected),
          repairEstimate:parseCsvNumber(row.repair_estimate||row.repairEstimate),
          actualRepairCost:parseCsvNumber(row.actual_repair_cost||row.actualRepairCost),
          replacementCost:parseCsvNumber(row.replacement_cost||row.replacementCost),
          amountCharged:parseCsvNumber(row.amount_charged||row.amountCharged),
          amountCollected:parseCsvNumber(row.amount_collected||row.amountCollected),
          amountWaived:parseCsvNumber(row.amount_waived||row.amountWaived),
          insuranceReimbursement:parseCsvNumber(row.insurance_reimbursement||row.insuranceReimbursement)
        };
      } else if(type==='homeOffice'){
        data={...data,
          description:String(row.description||row.name||'Home office').trim(),
          businessSquareFeet:parseCsvNumber(row.business_square_feet||row.businessSquareFeet),
          totalSquareFeet:parseCsvNumber(row.total_square_feet||row.totalSquareFeet),
          businessUsePercent:parseCsvNumber(row.business_use_percent||row.businessUsePercent),
          regularUse:parseCsvBoolean(row.regular_use||row.regularUse),
          exclusiveUse:parseCsvBoolean(row.exclusive_use||row.exclusiveUse)
        };
      }

      data=compactData(data);
      const id=await saveFinanceRecord(type,data);
      const saved={id,...data};

      if(type==='vehicle' && saved.vehicleName) vehicleMap.set(normalizeCsvKey(saved.vehicleName),saved);
      if(type==='asset' && saved.assetName) assetMap.set(normalizeCsvKey(saved.assetName),saved);
      if(type==='incident' && saved.description) incidentMap.set(normalizeCsvKey(saved.description),saved);

      results.imported++;
      results.byType[type]=(results.byType[type]||0)+1;
    } catch(error){
      results.skipped++;
      results.errors.push(`Row ${index+2}: ${error?.message||error}`);
    }
  }
  return results;
}

export async function reconcileCompletedOrdersIncome(){
  const {db,user,fire}=await ctx();
  const ordersSnap=await fire.getDocs(fire.collection(db,'orders'));
  const orders=ordersSnap.docs.map(d=>({id:d.id,...d.data()}));
  const eligible=orders.filter(order=>{
    const completed=String(order.status||'')==='Completed';
    const free=Boolean(order.free)||String(order.paymentStatus||'').toLowerCase()==='free';
    const gross=Number(order.adjustedTotal !== '' && order.adjustedTotal != null ? order.adjustedTotal : (order.total||order.baseTotal||0));
    return completed && !free && gross>0;
  });
  const eligibleIds=new Set(eligible.map(o=>o.id));

  const existingSnap=await fire.getDocs(
    fire.query(fire.collection(db,FINANCE_COLLECTIONS.income),fire.where('ownerId','==',user.uid))
  );
  const existingOrderIncome=existingSnap.docs
    .map(d=>({id:d.id,...d.data()}))
    .filter(x=>x.source==='completed-order');

  let synced=0,removed=0;
  for(const order of eligible){
    await syncCompletedOrderIncome(order);
    synced++;
  }
  for(const income of existingOrderIncome){
    const sourceId=String(income.sourceOrderId||income.orderId||'');
    if(!eligibleIds.has(sourceId)){
      await fire.deleteDoc(fire.doc(db,FINANCE_COLLECTIONS.income,income.id));
      removed++;
    }
  }
  return {eligible:eligible.length,synced,removed};
}
