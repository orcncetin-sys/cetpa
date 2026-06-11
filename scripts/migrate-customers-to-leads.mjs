/**
 * migrate-customers-to-leads.mjs — eski `customers` koleksiyonunu `leads`'e taşır.
 *
 * Muhasebe > Müşteriler sekmesi artık CRM ile ortak kaynak (leads) kullanıyor;
 * bu script eski ayrı koleksiyonda kalmış kayıtları bir kez taşır.
 *
 * Eşleşme: aynı taxId VEYA aynı (name) zaten leads'te varsa atlanır (duplike yok).
 * Eski doküman SİLİNMEZ (güvenlik) — sadece migrated:true işaretlenir.
 *
 * Çalıştırma: docker exec cetpa-app node scripts/migrate-customers-to-leads.mjs
 */

import admin from 'firebase-admin';

const PROJECT_ID = 'gen-lang-client-0628151245';
const DB_ID = 'ai-studio-d243947a-133d-4934-af2e-eff3bb6aeea7';

const fbEmail = process.env.FIREBASE_CLIENT_EMAIL;
const fbKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
if (!fbEmail || !fbKey) { console.error('Firebase env eksik'); process.exit(1); }

const app = admin.initializeApp({
  credential: admin.credential.cert({ projectId: PROJECT_ID, clientEmail: fbEmail, privateKey: fbKey }),
  projectId: PROJECT_ID,
});
const db = app.firestore();
db.settings({ databaseId: DB_ID });

const customersSnap = await db.collection('customers').get();
console.log(`customers koleksiyonu: ${customersSnap.size} doküman`);
if (customersSnap.size === 0) { console.log('Taşınacak kayıt yok ✓'); process.exit(0); }

const leadsSnap = await db.collection('leads').get();
const byTaxId = new Set();
const byName = new Set();
let ownerUid = null;
for (const d of leadsSnap.docs) {
  const x = d.data();
  if (x.taxId) byTaxId.add(String(x.taxId).trim());
  if (x.name) byName.add(String(x.name).trim().toLowerCase());
  if (!ownerUid && x.companyId) ownerUid = x.companyId;
}

let migrated = 0, skipped = 0;
for (const d of customersSnap.docs) {
  const c = d.data();
  if (c.migrated) { skipped++; continue; }
  const taxNo = String(c.taxNo ?? '').trim();
  const nameKey = String(c.name ?? '').trim().toLowerCase();
  if ((taxNo && byTaxId.has(taxNo)) || (nameKey && byName.has(nameKey))) {
    await d.ref.update({ migrated: true, migratedNote: 'leads içinde zaten mevcut' });
    skipped++;
    continue;
  }
  await db.collection('leads').add({
    name:        c.name ?? '—',
    company:     c.company ?? '',
    email:       c.email ?? '',
    phone:       c.phone ?? '',
    address:     c.address ?? '',
    taxId:       taxNo,
    taxOffice:   c.taxOffice ?? '',
    notes:       c.notes ?? '',
    creditLimit: Number(c.creditLimit ?? 0),
    riskGroup:   c.riskGroup ?? 'Düşük',
    type:        'Customer',
    status:      'Active',
    customerType:'B2B',
    source:      'customers_migration',
    companyId:   ownerUid,
    createdAt:   c.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
  });
  await d.ref.update({ migrated: true });
  migrated++;
  console.log(`taşındı: ${c.name}`);
}
console.log(`✓ Bitti — taşınan: ${migrated}, atlanan (zaten var/işaretli): ${skipped}`);
process.exit(0);
