# Cetpa — Tüm Uygulama Adversarial Review (2026-06-22)

Çok-ajanlı adversarial review (20 kapsamlı bulucu × bağımsız doğrulama). Oturum limitleri nedeniyle otomatik doğrulama+sentez kesildi; server/çok-kiracılı kritik bulgular kod okunarak elle doğrulandı, component bulguları bulucu-raporlu (dosya:satır atıflı).

**Toplam: 100 benzersiz bulgu** — 9 critical, 35 high, 35 medium, 21 low


## 🔴 CRITICAL

### P&L income summed from debit (borc) instead of credit (alacak)
- **Kategori:** correctness · **Dosya:** `src/components/AccountingModule.tsx` · lines 1736-1740, 1750-1751, 1757-1760
- **Sorun:** Income entries are correctly identified by their credit account (alacakHesap.startsWith('6')) but the amount is then taken from e.borc (the debit side). For a normal sales posting the revenue lives on the CREDIT side, so e.borc on that line is typically 0. toplamGelir, the monthly gelir chart, and gelirBreakdown will be wrong (usually understated/zero). netKar = toplamGelir - toplamGider is therefore wrong. Because entries aren't forced to balance, you cannot even rely on borc==alacak to mask this.
- **Kanıt:** const gelirEntries = filteredEntries.filter(e => e.alacakHesap.startsWith('6'));
const toplamGelir = gelirEntries.reduce((s, e) => s + e.borc, 0); // should be e.alacak
...
gelirEntries.forEach(e => { gelirBreakdown[e.alacakHesap] = (gelirBreakdown[e.alacakHesap] || 0) + e.borc; });
- **Düzeltme:** Sum income from the credit side: reduce((s,e)=>s+e.alacak,0) for gelirEntries/gelirBreakdown/monthly gelir. Keep giderEntries on e.borc (expenses are debit-side, which is correct).

### Journal entries never validated to balance (debit ≠ credit allowed)
- **Kategori:** data-integrity · **Dosya:** `src/components/AccountingModule.tsx` · saveJournal, lines 1038-1056; inputs 4318-4322
- **Sorun:** saveJournal only checks that aciklama is non-empty. borc and alacak are two independent number inputs (lines 4318, 4322) and are persisted as-is with no assertion that they are equal. Double-entry bookkeeping requires every posting to balance. A user can save borc=100 / alacak=50 (or borc=0 / alacak=100). The trial balance (mizan) then never ties — mizanDengeli (line 1562) merely *reports* the imbalance but nothing prevents creating it. The whole ledger can be permanently out of balance.
- **Kanıt:** if (!journalForm.aciklama.trim()) return showToast(t.descRequired, 'error');
... await addDoc(collection(db, 'journalEntries'), { ...journalForm, ... }); // no borc===alacak check
- **Düzeltme:** In saveJournal, reject when Math.abs(Number(journalForm.borc) - Number(journalForm.alacak)) >= 0.005 (or design the form as a true balanced entry). Block save and show an error until debit total equals credit total.

### Orders/shipments never decrement inventory stock — stock and sales are fully decoupled
- **Kategori:** data-integrity · **Dosya:** `src/App.tsx` · handleAddOrder (~2515-2659), handleUpdateOrderStatus (~2661-2776)
- **Sorun:** Creating an order, marking it Shipped, or marking it Delivered does NOT write inventory.stockLevel nor an inventoryMovements record anywhere. handleAddOrder only writes the order doc + journal + Mikro sync; handleUpdateOrderStatus on 'Shipped'/'Delivered' only fires e-irsaliye/email/WhatsApp. stockLevel is mutated in exactly three client places: the +/- quick buttons, the Quick Stock Count modal, and ProductForm edits — none tied to fulfillment. Result: stockLevel reflects only manual edits and Mikro overwrites, never actual sales, so on-hand quantities silently drift above reality and 'low stock'/auto-reorder/value reports are wrong. The 'reserved' panel at line 13140 (reservedMap, avail = r.stockLevel - r.reserved) is a read-only display computed from open orders; it does not reserve or deduct anything.
- **Kanıt:** // handleUpdateOrderStatus, status==='Shipped' branch only does notifications + e-irsaliye:
if (status === 'Shipped') { ... authFetch('/api/mikro/irsaliye/kaydet', ...) }
// no updateDoc(doc(db,'inventory',...)) and no addDoc(collection(db,'inventoryMovements')) in the whole function
- **Düzeltme:** On the authoritative fulfillment transition (Shipped, or order create for immediate-stock workflows) decrement each lineItem's stockLevel by quantity and write a corresponding inventoryMovements 'out' record, ideally server-side in one atomic operation keyed by orderId to make it idempotent.

### Non-tenant collections written from App.tsx leak across companies (no companyId)
- **Kategori:** multi-tenant · **Dosya:** `src/App.tsx` · writes: masraflar L7845, timeAttendance L10651, journalEntries L2587/L2600, bankAccounts/sabitKiymetler/rmaRequests/warehouseBins/webhookConfigs reads L1615-1691
- **Sorun:** Several collections written/read in App.tsx are NOT in the server's TENANT_COLLECTIONS set (server.ts L405-416), so the server neither injects companyId on write (injectTenant, server.ts L2062) nor scopes reads (tenantWhere, server.ts L2049-2052) nor filters the SSE stream (L1992/L2009). The client also never adds companyId to these payloads and never filters them on read. Result: every tenant reads and writes every other tenant's expense reports (masraflar), timekeeping (timeAttendance), accounting journal entries (journalEntries), bank accounts, fixed assets (sabitKiymetler), RMA requests, warehouse bins and webhook configs. journalEntries is especially severe: financial ledger entries created at L2587/L2600 carry no companyId and are globally visible/editable.
- **Kanıt:** server.ts L405-416 TENANT_COLLECTIONS has NO 'masraflar','timeAttendance','journalEntries','bankAccounts','sabitKiymetler','rmaRequests','warehouseBins','webhookConfigs'. App.tsx L2587: await addDoc(collection(db,'journalEntries'),{date:..., borc:kdvHaricTutar, ... createdAt:serverTimestamp()}) // no companyId. App.tsx L1649: onSnapshot(query(collection(db,'masraflar')), ...) // no where('companyId').
- **Düzeltme:** Add these collections to TENANT_COLLECTIONS in server.ts (so the server injects companyId on write and scopes reads/SSE), and add where('companyId','==', companyId) to their onSnapshot queries in App.tsx (L1627/1635/1649/1659/1669/1679/1615).

### Hourly Mikro cron writes ALL synced stock/cari into ONE arbitrary tenant
- **Kategori:** multi-tenant · **Dosya:** `server.ts` · cronCompanyId() lines 1483-1488; used at 1510, 1544, 1587
- **Sorun:** cronCompanyId() resolves the target tenant by reading the FIRST document of the global `inventory` collection (`adminDb.collection('inventory').limit(1).get()`) and uses its companyId for every record the cron creates. In a multi-tenant DB this picks an effectively random tenant. The hourly sync then (a) builds invBySku/leadByKod maps from the ENTIRE collection across all tenants (`adminDb.collection('inventory').get()` line 1519, `.collection('leads').get()` line 1561 — no companyId filter), so it can update another tenant's row, and (b) stamps every NEWLY created stock/cari doc with that single arbitrary companyId (lines 1544, 1587). Result: one tenant receives Mikro data that may belong to a different tenant, and SKU/cariKod collisions across tenants cause cross-tenant overwrites. The 04:00 quantity sync (lines 1609-1612) has the same unscoped global `inventory.get()` and updates stockLevel/costPrice on any tenant's row matching the SKU.
- **Kanıt:** const snap = await adminDb.collection('inventory').limit(1).get();
    return (snap.docs[0]?.data()?.companyId as string) || '';
...
const invSnap = await adminDb.collection('inventory').get(); // ALL tenants
...
batch.set(adminDb.collection('inventory').doc(), { ...fields, companyId, ... }); // companyId from random first doc
- **Düzeltme:** Mikro creds are global (single ERP connection), but the synced data must be attributed to a deterministic, configured tenant. Store the ERP-owner companyId explicitly in settings/mikro (e.g. ownerCompanyId) and scope ALL reads/writes with `.where('companyId','==',ownerCompanyId)`. Never derive tenant from `limit(1)`. If the platform is truly single-ERP-per-deployment, assert there is exactly one companyId and fail loudly otherwise.

### Dozens of tenant-private collections are completely unscoped (full cross-tenant read/write/delete)
- **Kategori:** multi-tenant · **Dosya:** `server.ts` · validColl (1845-1849), TENANT_COLLECTIONS (405-416), tenantWhere (2049-2058), ownsDoc (2067-2079)
- **Sorun:** validColl only checks a regex (COLL_RE), NOT an allowlist — so ANY collection name matching /^[A-Za-z0-9_-]{1,64}$/ is reachable through /api/db/:coll for all verbs. Tenant isolation is applied ONLY when the collection is a member of TENANT_COLLECTIONS or USER_SCOPED_COLLECTIONS. For any other collection: tenantWhere returns {sql:'',params:[]} (no companyId filter), ownsDoc returns true unconditionally (final `return true`), and injectTenant returns data unchanged. The client uses ~140 collections but TENANT_COLLECTIONS has only ~52. ~90 collections fall through unscoped, including clearly tenant-private financial/HR/operational data: invoices, payments, journalEntries, bankAccounts, bankTransactions, kasalar, kasaHareketleri, tahsilatOdemeleri, payrollEntries, performanceReviews, legalCases, legalDocs, sabitKiymetler, projects, bom, invoices, akreditifler, gumrukBeyannameleri, masraflar, etc. Concrete attack: a user in Company A calls GET /api/db/invoices and receives EVERY company's invoices; PUT/PATCH/DELETE /api/db/invoices/{anyId} mutates/deletes Company B's records because ownsDoc returns true. RBAC (rbac.ts isAllowed) is purely role-based with no tenant dimension, so an Accounting/Sales/Admin role in Company A passes the 'denied' gate for these collections.
- **Kanıt:** const validColl = (c, res) => { if (COLL_RE.test(c)) return true; ... }  // no allowlist
// tenantWhere: only TENANT_COLLECTIONS/USER_SCOPED_COLLECTIONS get a filter; else returns {sql:'',params:[]}
// ownsDoc: if (TENANT_COLLECTIONS.has(coll)){...} if(USER_SCOPED...){...} return true;
- **Düzeltme:** Make /api/db enforce an explicit allowlist of known collections in validColl, and default ANY non-system collection to tenant scoping. Add every tenant-private collection (invoices, payments, journalEntries, bankAccounts, bankTransactions, kasalar, kasaHareketleri, tahsilatOdemeleri/tahsilatKayitlari, payrollEntries, performanceReviews, leaveRequests-already, legalCases, legalDocs, sabitKiymetler/sabitKiymetBakim/sabitKiymetSigorta, amortismanKayitlari, projects, projectCosts-already, bom, akreditifler, ihracatlar/ithalatlar, gumrukBeyannameleri, masraflar, maliyetKalemleri/maliyetMerkezleri, isEmirleri, qcRecords, lotKayitlari/lotHareketleri/seriNolar, invoices, orderReturns, rmaRequests, revenueSchedules, dunningInvoices/dunningPolicies, cpqQuotes/cpqTemplates, complaints, complianceItems, ctpatRecords, *Records, ekipmanlar/machines/workCenters, teknisyenler/servisTalepleri/arizalar, garantiler, taxDeclarations, timeAttendance, trainings, travelRequests, holding*, subscriptions, skuMappings, warehouseBins, wmsTasks/wmsCycleCounts, subeTransferler, cargoTracking, campaigns, documentTemplates, routingTemplates, resources, tasks, jobs, shareholders, boardMeetings/assemblyMeetings, bankAccounts, etc.) to TENANT_COLLECTIONS. Treat the default as scoped, not unscoped.

### SSE /api/db/stream leaks all tenants' rows for every unscoped collection
- **Kategori:** multi-tenant · **Dosya:** `server.ts` · rowVisible (1990-1996), onChange (2006-2013), GET /api/db/stream (1965-2017)
- **Sorun:** rowVisible only filters when coll is in TENANT_COLLECTIONS, USER_SCOPED_COLLECTIONS, or === 'settings'; for every other collection it returns true. The initial snapshot query `SELECT coll,id,data FROM docs WHERE coll = ANY($1)` is NOT filtered by companyId in SQL, so for any unscoped collection (invoices, payments, journalEntries, bankAccounts, etc.) Company A's EventSource receives every tenant's documents in the init event. Likewise onChange only suppresses cross-tenant events for the same three categories, so live change broadcasts for unscoped collections are delivered to all connected tenants. The client merely subscribes with ?colls=invoices,payments,... and receives global data.
- **Kanıt:** const rowVisible = (coll, data) => { if(!data) return true; if(TENANT_COLLECTIONS.has(coll)){...} if(USER_SCOPED_COLLECTIONS.has(coll)){...} if(coll==='settings'){...} return true; };
const { rows } = await docsDb.query('SELECT coll, id, data FROM docs WHERE coll = ANY($1)', [colls]);  // no companyId filter
// onChange: only TENANT/USER/settings get the `ev.cid !== streamCid` suppression
- **Düzeltme:** Once the collections above are added to TENANT_COLLECTIONS the stream inherits scoping. Additionally harden: filter the snapshot query by companyId in SQL for tenant collections, and make rowVisible/onChange default-deny (return false) for any collection not explicitly classified as global, rather than default-allow.

### Cross-tenant privilege escalation: user can rewrite own users/{uid}.companyId to any company
- **Kategori:** multi-tenant · **Dosya:** `server.ts` · isSelfDocAccess use in denied() (server.ts:2032) + guardRoleEscalation (2039-2045) + getUserCompanyId (425-437); rbac.ts blocksRoleEscalation (54-58)
- **Sorun:** Any authenticated non-admin (e.g. a Sales/B2B user) may write to their own users/{uid} document because isSelfDocAccess() makes denied() return false for coll==='users' && docId===uid on write. The ONLY field protected on that write is 'role' (guardRoleEscalation -> blocksRoleEscalation checks only `'role' in body`). 'users' is NOT in TENANT_COLLECTIONS, so injectTenant() does NOT override companyId on write. getUserCompanyId() then reads users/{uid}.companyId (cid = data.companyId || uid). Therefore a user can PATCH/PUT /api/db/users/{ownUid} with {"companyId":"<victimCompanyId>"} and, after the 60s role/company cache expires, every tenant-scoped read/write/delete (tenantWhere/ownsDoc/injectTenant) and the SSE stream resolve to the victim's companyId — full cross-tenant read AND write access to another company's inventory, orders, leads, quotations, etc. This defeats the entire multi-tenant isolation model.
- **Kanıt:** denied(): if (isSelfDocAccess(coll, docId, uid, op)) return false;  // server.ts:2032
blocksRoleEscalation: if (!('role' in body)) return false;  // rbac.ts:56 — companyId not guarded
injectTenant: if (TENANT_COLLECTIONS.has(coll)) {...}  // 'users' not in set, so companyId from client body is persisted verbatim
getUserCompanyId: cid = (snap.data()?.companyId as string) || uid;  // server.ts:432
- **Düzeltme:** On any write to users/{uid}, strip/override server-controlled identity fields (companyId, role, uid, email, status) from the client body — only an Admin (and only within their own company) may set companyId/role. Extend blocksRoleEscalation into a guardProtectedUserFields that rejects companyId changes by non-admins, or maintain companyId in a separate server-only collection that /api/db never writes.

### MFA login challenge does not actually gate data access — full app + data fetch render behind the modal
- **Kategori:** security · **Dosya:** `src/App.tsx` · onAuthStateChanged setter (1829-1888), data-fetch effect (2122-2123), MfaChallengeModal render (4048-4055)
- **Sorun:** The comment at line 4048 claims "oturum doğrulanana dek veri yüklenmez" (data is not loaded until the session is verified), but this is false. `mfaChallenge` only controls rendering of an overlay <MfaChallengeModal> at line 4049, which sits INSIDE the fully-rendered authenticated app tree. The actual data-fetching effect at line 2122 gates only on `if (!isAuthReady || !user || !userRole) return;` — it never checks `mfaChallenge`. So when a user with 2FA enabled but an unverified session logs in, every onSnapshot listener (leads, orders, inventory, subscriptions, settings, audit log, etc.) fires and loads company data underneath the modal. A user can dismiss/inspect the DOM, or the data is simply present in memory/network before any code is entered. The TOTP step is purely cosmetic.
- **Kanıt:** useEffect(() => { if (!isAuthReady || !user || !userRole) return; ... onSnapshot(leadsQuery,...) }  // line 2122-2134, no mfaChallenge check
{mfaChallenge && (<MfaChallengeModal ... />)} // line 4049, overlay only
- **Düzeltme:** Gate the entire authenticated render and all data effects on `!mfaChallenge`. Either return the challenge screen as an early `if (mfaChallenge) return <MfaChallengeOnly/>;` before the main app body (like the `!isAuthReady` / `!user` early returns at 2922/3118), AND add `|| mfaChallenge` to the guard in the data-fetch effect at line 2123 (plus the other per-`user` listener effects).


## 🟠 HIGH

### Account statement (cari ekstre) ignores payments — "outstanding" balance is status-only, not money owed
- **Kategori:** correctness · **Dosya:** `src/utils/pdf.ts` · exportCustomerStatement, lines 289-293
- **Sorun:** The customer Account Statement (HESAP EKSTRESI) computes Outstanding = orders whose status is not Delivered/Cancelled, and Delivered = orders with status Delivered. It never consults the order's payment state. The Order type and CRMPage itself track an `o.paid` flag (CRMPage.tsx:2755 filters on `o.paid`), but the statement uses status only. Consequence: a Delivered-but-unpaid order shows as 0 outstanding (understates receivables), while a Shipped order that has already been paid still counts as outstanding (overstates receivables). There is no payments ledger and no running balance, so this is an order list, not a true cari ekstre / account statement. Any AR decision (credit hold, collections) based on this figure is wrong.
- **Kanıt:** const delivered    = sorted.filter(o => o.status === 'Delivered');
const outstanding  = sorted.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled');
const totalOutstanding = outstanding.reduce((s, o) => s + o.totalPrice, 0);
const grandTotal       = sorted.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + o.totalPrice, 0);
- **Düzeltme:** Drive outstanding/paid from the `o.paid` (and any payment-amount/partial-payment) fields, not order status. Outstanding = sum of non-Cancelled, non-fully-paid orders; show a Paid line and a true Balance = total billed − total paid. Mirror the same logic in the modal (CariEkstrePanel).

### MRP netting double-allocates shared component stock across demand lines
- **Kategori:** correctness · **Dosya:** `src/components/MRPModule.tsx` · runMRP, lines 209-245
- **Sorun:** The MRP run iterates each demanded finished product independently and computes component shortage as required - onHand against the CURRENT inventory snapshot every time. If two (or more) demanded products consume the same component (same comp.inventoryId), each demand line subtracts the full on-hand quantity separately, so the same available stock is netted against both. Net requirement is under-stated and the suggested purchase qty is too low — classic MRP gross-to-net error. There is also no aggregation of shortage for the same component across BOMs (you get multiple separate purchase suggestions for one item) and no consideration of open production/purchase orders already covering demand.
- **Kanıt:** Object.entries(mrpQtyInput).forEach(([productName, demandQty]) => {
  ...
  bom.components.forEach(comp => {
    const required = comp.quantity * demandQty;
    const stock = inventory.find(i => i.id === comp.inventoryId);
    const onHand = stock?.quantity ?? stock?.stockLevel ?? 0;
    const shortage = required - onHand;   // onHand reused per demand line
- **Düzeltme:** Aggregate gross requirements per comp.inventoryId across ALL demand lines first (into a Map), then net once against on-hand (optionally minus already-allocated/open-PO qty), and emit one purchase suggestion per component. Track a running 'remaining stock' ledger so each allocation decrements it.

### B2B "Quote Total" KPI reads non-existent field q.total, always shows ₺0
- **Kategori:** correctness · **Dosya:** `src/components/B2BPortal.tsx` · Dealers tab KPI, line 355
- **Sorun:** The Quote Total KPI sums `Number(q.total)`, but quotations are persisted with the field `totalAmount` (QuotationForm.tsx:96 writes `totalAmount: grandTotal`; there is no `total` field anywhere on the Quotation type, types.ts:73). The same component's quotation table at line 500 correctly reads `q.totalAmount`. As a result this KPI is permanently 0 for every tenant, silently under-reporting the dealer quotation pipeline.
- **Kanıt:** quotations.reduce((s, q) => s + (Number(q.total) || 0), 0)   // line 355 — field is actually q.totalAmount
- **Düzeltme:** Replace `Number(q.total)` with `Number(q.totalAmount)` in both branches of the line-355 reduce.

### QuotationDetail hardcodes 20% VAT to back out net/tax from total
- **Kategori:** correctness · **Dosya:** `src/components/QuotationDetail.tsx` · lines 390, 394
- **Sorun:** The detail view computes the displayed net total as `totalAmount / 1.2` and VAT as `totalAmount - totalAmount/1.2`, assuming every line is 20% VAT. But QuotationForm lets each line item pick a VAT rate of 0/1/10/20 (QuotationForm.tsx:304-307) and stores `totalAmount = grandTotal` (net+VAT mixed across rates). Any quotation containing non-20% lines will display an incorrect net subtotal and KDV figure on the customer-facing detail/PDF, and the numbers won't reconcile to the line items.
- **Kanıt:** formatInCurrency(quotation.totalAmount / 1.2, quotation.currency)   // assumes 20% on whole total
- **Düzeltme:** Recompute net and VAT by iterating the stored lineItems (`sum(price*qty)` for net, `sum(price*qty*vatRate/100)` for VAT) instead of dividing the grand total by a fixed 1.2.

### Kasa balances sum across currencies into one ₺ figure
- **Kategori:** correctness · **Dosya:** `src/components/KasaModule.tsx` · toplamBakiye 126-130; bugunGiris/bugunCikis 134-141; daily close 212-230, 412-419
- **Sorun:** Kasalar are typed per-currency (TRY/USD/EUR, lines 17/23). But toplamBakiye, bugunGiris, bugunCikis and the daily-closing math sum h.tutar across ALL movements regardless of the owning kasa's currency, then render the result with fmtMoney's default ₺ symbol (lines 280, 331, 423). USD and EUR amounts are added to TRY at 1:1. The per-kasa card (kasaBakiye, lines 144-151) is correct, but every aggregate and the persisted günlük kapanış (kasaKapanislar, lines 217-225) store a meaningless cross-currency sum.
- **Kanıt:** const giris = hareketler.filter(h => h.tur === 'Giriş').reduce((s, h) => s + h.tutar, 0);
const cikis = hareketler.filter(h => h.tur === 'Çıkış').reduce((s, h) => s + h.tutar, 0);
return giris - cikis; // no currency separation, displayed as ₺
- **Düzeltme:** Group aggregates by kasa currency (join movement -> kasa.doviz) and either show separate totals per currency or convert via an explicit rate. Do the same for the daily closing record.

### processPendingSyncJobs claims jobs non-atomically — concurrent runs double-execute (duplicate Mikro pushes)
- **Kategori:** correctness · **Dosya:** `src/services/syncRetryService.ts` · processPendingSyncJobs, lines 94-159
- **Sorun:** The function reads all status=='queued' jobs (getDocs, line 106) and only THEN marks each 'in-progress' via a plain updateDoc (lines 117-120). There is no atomic claim (no transaction / conditional write), and dbClient's runTransaction is explicitly 'emulated as sequential writes (NOT atomic)' per src/lib/dbClient.ts:19. If processMikroRetries() runs concurrently — two browser tabs, or a periodic poller firing again before the prior promise chain resolves — both invocations read the SAME queued jobs and both call executor(job). The executor (src/services/mikroEvrak.ts:66-74) calls rawMikroPush, so the same Mikro evrak (order/quotation) is pushed to the ERP twice. The read-to-mark window is wide because getDocs awaits a network round-trip before any job is marked in-progress.
- **Kanıt:** const snapshot = await getDocs(q);
...
jobs.map(async (job) => {
  const ref = jobRef(job.id);
  await updateDoc(ref, { status: 'in-progress', updatedAt: Date.now() });
  try { await executor(job); ...
- **Düzeltme:** Claim each job atomically before executing: conditional compare-and-set status queued->in-progress and skip if the claim affected zero rows, or add an in-process isRunning mutex so processPendingSyncJobs cannot overlap itself. A claimedBy token would also stop cross-tab double execution.

### Client-side retry queue has no tenant scoping and a read-then-write claim race causing duplicate Mikro pushes
- **Kategori:** correctness · **Dosya:** `src/services/syncRetryService.ts` · processPendingSyncJobs lines 99-159; loop in src/App.tsx:867-874
- **Sorun:** processMikroRetries() runs in every logged-in browser tab every 90s (App.tsx:872 setInterval(tick, 90_000)). processPendingSyncJobs queries the GLOBAL `syncJobs` collection with no companyId filter (lines 99-104), fetches up to 20 'queued' jobs, then marks each in-progress via a plain updateDoc (line 117) with NO atomic conditional/transaction. Two concurrent tabs (same or different tenants) both read the same 20 'queued' jobs and both call the executor (rawMikroPush) — duplicate Mikro evrak pushes (duplicate quotations, stock movements, dekonts). Cross-tenant: any user's client can pick up and execute another tenant's queued Mikro job because there is no companyId on the job or in the query.
- **Kanıt:** const q = query(collection(db, COLLECTION), where('status','==','queued'), where('nextRetryAt','<=',now), limit(20));
const snapshot = await getDocs(q);
...
await updateDoc(ref, { status: 'in-progress', updatedAt: Date.now() }); // no compare-and-set
- **Düzeltme:** Claim jobs atomically (runTransaction / conditional update that only succeeds if status is still 'queued'); scope the query by companyId; move retry processing to a single server-side cron instead of every client tab to eliminate the fan-out.

### Leave 'days' is never computed from start/end dates — every leave request is recorded as 1 day
- **Kategori:** correctness · **Dosya:** `src/components/HRModule.tsx` · leaveForm default (159), leave modal (1156-1192), handleSaveLeave (295-324)
- **Sorun:** The leave form defaults days:1 (line 159). The leave modal renders only employee, startDate, endDate and type inputs — there is NO 'days' field and NO onChange that recomputes days from the date range. handleSaveLeave spreads `...leaveForm` directly into the doc without recalculating days. Result: a leave request spanning e.g. 2026-07-01 to 2026-07-15 is persisted with days=1. The wrong value is displayed in the table (line 753) and, worse, is the exact value pushed to the Mikro ERP via izinTalepPayload `days: req.days` (line 774), so the official SGK/leave-balance record in the accounting system is also 1 day. Annual leave entitlement tracking is silently broken.
- **Kanıt:** endDate: format(new Date(), 'yyyy-MM-dd'), days: 1, status: 'Bekliyor'  // line 159 — modal has start/end inputs but no days field; handleSaveLeave does `await addDoc(... {...leaveForm ...})` with no days recompute
- **Düzeltme:** In handleSaveLeave, compute days from the date range before persisting, e.g. `const days = Math.max(1, differenceInDays(parseISO(leaveForm.endDate), parseISO(leaveForm.startDate)) + 1);` (date-fns is already imported) and write that instead of the static form value. Also recompute on endDate/startDate onChange so the UI reflects it.

### Salary/payroll totals ignore per-employee currency — EUR/USD salaries summed as if TRY
- **Kategori:** correctness · **Dosya:** `src/components/HRModule.tsx` · Monthly Total Salary card (578-591); handleAddPayroll (326-356); payroll net display (646)
- **Sorun:** Employee has salaryCurrency (EUR/USD/TRY) — confirmed in types.ts line 218 and the employee form select at line 1103. But the 'Aylık Toplam Maaş' card sums `e.salary` raw (line 579: `employees.reduce((s,e)=>s+(e.salary||0),0)`) treating every salary as TRY, then converts that TRY-labelled sum to USD/EUR. An employee paid 5000 EUR is counted as 5000 TRY (~6x understated). Likewise handleAddPayroll seeds baseSalary from `emp.salary` (line 1217) and computes net = base+bonus+perfBonus-deduction (line 336) with no currency normalization; the payroll table then hard-prints every amount with a ₺ sign (lines 643-646) even when payrollForm.currency is USD/EUR. Net pay figures and company salary cost are wrong for any non-TRY employee.
- **Kanıt:** const totalTRY = employees.reduce((s, e) => s + (e.salary || 0), 0);  // line 579 — ignores e.salaryCurrency; then converted with `totalTRY / rate`
- **Düzeltme:** Normalize each salary to TRY using exchangeRates and e.salaryCurrency before summing (e.g. salary * (rate[e.salaryCurrency] ?? 1)). In the payroll table, render with the row's currency symbol (p.currency) instead of a hardcoded ₺, and ensure net math uses a single consistent currency.

### Phase 580 Budget-vs-Actual: fmtKpi output gets a hardcoded ₺ suffix, double/wrong currency symbol when kpiCurrency is USD/EUR
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · Phase 580 'butce-gercek' block, lines 8931-8932 and 8958-8961
- **Sorun:** fmtKpi (defined at 676-685) ALWAYS converts its TRY argument by dividing by the active kpiCurrency rate AND prepends the matching symbol ('$'/'€'/'₺'). In the Budget vs Actual tab the results are then concatenated with a literal ' ₺'. When kpiCurrency is USD or EUR, the KPI cards and every monthly-table cell render the USD/EUR-converted number but tag it with BOTH the converted symbol and ₺, e.g. fmtKpi(totalBudget580,'K',1)+' ₺' produces "$12.5K ₺". The figure is in dollars/euros but visually labeled as Turkish Lira — directly misleading on a budget-vs-actual financial screen.
- **Kanıt:** {label:tr580?'Bütçe':'Budget', val:fmtKpi(totalBudget580,'K',1)+' ₺', ...}
{label:tr580?'Gerçekleşen':'Actual', val:fmtKpi(totalActual580,'K',1)+' ₺', ...}
<td ...>{fmtKpi(bud,'K',0)} ₺</td>
<td ...>{fmtKpi(act,'K',0)} ₺</td>
... {diff>=0?'+':''}{fmtKpi(diff,'K',0)} ₺
- **Düzeltme:** Drop the trailing ' ₺' in all five spots (8931, 8932, 8958, 8959, 8961). fmtKpi already emits the correct symbol for the active currency. Either rely on fmtKpi's symbol alone, or stop using fmtKpi here and format TRY explicitly if these cards are meant to always show TRY.

### Expense module sums mixed-currency amounts as a single ₺ total without conversion
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · Phase 548 'masraf' block, lines 7795-7796 (totals) vs 7812-7813 (display) and 7835 (currency field)
- **Sorun:** Expense claims store a per-record currency (TRY/USD/EUR, set at line 7835) and are correctly displayed per-row via fE(m.amount, m.currency) at line 7872. But the summary KPIs total raw amounts with no FX conversion — totalPending/totalApproved just add m.amount across all currencies — then render the sum with a hardcoded ₺ symbol. A 100 USD expense and a 100 TRY expense both contribute 100 to the same ₺ total, understating real liabilities by the FX factor (~30x for USD). The 'Pending'/'Approved' summary figures are financially wrong whenever any non-TRY expense exists.
- **Kanıt:** const totalPending = pending548.reduce((s,m)=>s+(m.amount||0),0);
const totalApproved = approved548.reduce((s,m)=>s+(m.amount||0),0);
...
{ label:..., sub: `₺${Math.round(totalPending).toLocaleString('tr-TR')}`, ... },
{ label:..., sub: `₺${Math.round(totalApproved).toLocaleString('tr-TR')}`, ... },
- **Düzeltme:** Convert each expense to TRY before summing, using exchangeRates: s + (m.currency==='USD'? m.amount*(rates.USD): m.currency==='EUR'? m.amount*(rates.EUR): m.amount). Then the ₺ label is correct.

### Stock writes are non-atomic read-modify-write — concurrent movements lose updates
- **Kategori:** correctness · **Dosya:** `src/components/InventoryView.tsx` · quick +/- buttons lines 731 & 738; also Quick Stock Count App.tsx ~15238-15244
- **Sorun:** The decrement/increment buttons compute newStock from the in-memory item.stockLevel snapshot then updateDoc it: last-write-wins with no atomic increment or transaction. Two users (or the same user double-clicking faster than the onSnapshot round-trip) both read stock=10, both write 9, net effect -1 instead of -2; the matching two inventoryMovements 'out' rows are still both written, so the movement log and stockLevel diverge. dbClient confirms there is no atomic primitive: src/lib/dbClient.ts:17 lists increment as 'Not supported' and line 19 states runTransaction/writeBatch are 'emulated as sequential writes (NOT atomic)'.
- **Kanıt:** onClick={async (e) => { ... const newStock = Math.max(0, (item.stockLevel ?? 0) - 1); await updateDoc(doc(db, 'inventory', item.id), { stockLevel: newStock }); if (newStock !== (item.stockLevel ?? 0)) await addDoc(collection(db, 'inventoryMovements'), { ... type:'out', quantity:1 ... }); }
- **Düzeltme:** Perform stock mutations server-side with an atomic SQL UPDATE (stockLevel = stockLevel - :qty) inside the same transaction that inserts the movement row, and reject if the result would go negative; do not derive newStock from a stale client snapshot.

### Dashboard KPI currency conversion uses `|| 1` fallback — mislabels raw TRY as USD/EUR when rates are null
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · Revenue/MTD/AOV/insight KPI IIFEs: lines 4290-4291, 4631-4635, 4701-4704, 4821-4823, 4951-4953, 5013-5015, 5230-5232, 5280-5281, 5371-5374, 5422-5423
- **Sorun:** Every dashboard KPI computes its FX rate as `kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : ...`. `exchangeRates` starts as `null` (line 669) and is populated asynchronously (fetch in useEffect at 1042-1066), and stays null if both the local endpoint and the Frankfurter fallback fail. The currency toggle buttons are rendered unconditionally (e.g. lines 4306-4313, 4649-4654) — unlike the budget toggle which is gated by `exchangeRates &&` (line 6707). So a user can select USD/EUR before/without rates loaded: `rate` becomes 1, and `converted = totalTRY / 1`. A ₺1,000,000 revenue is then displayed as `$1,000,000` / `€1,000,000` — off by ~38x and presented as a real foreign-currency figure on the primary financial dashboard. The `|| 1` also masks a legitimately-zero rate. Note the same code uses three different fallbacks elsewhere (`?? 32`/`?? 35` at 677-679; `?? 38`/`?? 41` in P&L at 7287-7288), so 1 is clearly an unintended sentinel, not a chosen rate.
- **Kanıt:** const rate = kpiCurrency === 'USD' ? (exchangeRates?.USD || 1) : kpiCurrency === 'EUR' ? (exchangeRates?.EUR || 1) : 1;
const converted = kpiCurrency === 'TRY' ? totalTRY : totalTRY / rate;
- **Düzeltme:** Either gate the currency toggle behind `exchangeRates &&` like the budget tab (line 6707), or guard conversion: if rates are missing for the selected currency, force-display TRY (or show a placeholder) instead of dividing by 1. At minimum replace `|| 1` with the same `?? 38`/`?? 41` fallbacks used in the P&L tab so the magnitude is at least plausible.

### Detail-panel status dropdown lets you set Delivered without the delivery-note flow, and never writes deliveredAt
- **Kategori:** correctness · **Dosya:** `src/pages/OrdersPage.tsx` · detail status <select> onChange, lines 1842-1853 vs table flow 993-1002 / 3077-3082
- **Sorun:** The orders TABLE intercepts a transition to 'Delivered' and routes it through the delivery-note modal, which writes status:'Delivered' PLUS deliveredAt: serverTimestamp() (line 3079). The DETAIL panel status <select> has the same five options including <option value="Delivered"> but its onConfirm calls handleUpdateOrderStatus directly (line 1845), which only writes { status, updatedAt } (line 266). Result: an order delivered from the detail panel gets no deliveredAt and no delivery note, while one delivered from the table does. SLA / lead-time analytics that read created vs synced/delivered timestamps (lines 2602-2614) become inconsistent depending on which UI path the user used.
- **Kanıt:** onConfirm: () => { handleUpdateOrderStatus(selectedOrder.id, e.target.value as ...); setSelectedOrder({ ...selectedOrder, status: ... }); }   // line 1845, vs table line 997: if (newStatus === 'Delivered') { setDeliveryNoteOrder(order); ...; return; }
- **Düzeltme:** In the detail <select> onChange, replicate the table guard: if the chosen value is 'Delivered', open the deliveryNote modal (setDeliveryNoteOrder/​setDeliveryNoteText) instead of calling handleUpdateOrderStatus, so deliveredAt is always written.

### Order-detail line-item table renders money as '$' and recomputes its own total, diverging from stored totalPrice (shown as ₺ everywhere else)
- **Kategori:** correctness · **Dosya:** `src/pages/OrdersPage.tsx` · detail line-item table, lines 1994-2003 (and total_price at 1856-1857)
- **Sorun:** The whole app treats order money as TRY and renders ₺ (e.g. line 1018, 1159-1167, 1629). But the order-detail line-item table hardcodes a '$' prefix on unit price (1994), line total (1995) and the footer grand total (2003), and the detail header total_price also uses '$' (1857). Worse, the footer total is recomputed as Σ(price×quantity) (line 2003) independently of order.totalPrice, with no reconciliation. If the stored totalPrice includes KDV/discount/shipping (the order carries kdvOran, line 1022) or simply drifted, the detail screen shows a different number than the list/PDF (which use order.totalPrice). Currency symbol is also wrong for a TRY ledger.
- **Kanıt:** <td ...>${item.price.toFixed(2)}</td> ... <td ...>${(item.price * item.quantity).toFixed(2)}</td>  // 1994-1995;  footer: ${selectedOrder.lineItems.reduce((s, l) => s + l.price * l.quantity, 0).toFixed(2)}  // 2003
- **Düzeltme:** Use the ₺ symbol (or the kpiCurrency-aware formatter used at line 1018) and decide a single source of truth: either show order.totalPrice consistently, or show the recomputed sum and flag when it disagrees with order.totalPrice — don't silently present a second, unreconciled total.

### Operator-precedence bug collapses all categories into 'Diğer' in Inventory Turnover chart
- **Kategori:** correctness · **Dosya:** `src/components/ReportsDashboard.tsx` · Phase 176 'Inventory Turnover by Category', line 1102 (block starts ~1099)
- **Sorun:** The category key is computed without parentheses: `const cat = i.category || currentLanguage === 'tr' ? 'Diğer' : 'Other';`. Because `||` binds tighter than the conditional operator, this parses as `(i.category || (currentLanguage === 'tr')) ? 'Diğer' : 'Other'`. Whenever an item has a non-empty `category` (the normal case), the condition is truthy and `cat` is ALWAYS the literal string 'Diğer' — the real category name is discarded. As a result the entire inventory `avgStock` (stock value denominator) is accumulated into a single 'Diğer' bucket, while the orders loop at line 1110 correctly buckets COGS by real category. Turnover = totalCOGS / avgStock is therefore computed against a wrong/missing denominator: 'Diğer' shows COGS/0-or-misaligned-stock and real categories show COGS with zero avgStock (filtered out by `.filter(c => c.avgStock > 0)`). The chart is effectively a single meaningless bar. Every sibling in the file (lines 932, 1110, 3481, 3531, 4584, 4590) correctly wraps the ternary in parentheses — this is the lone instance missing them.
- **Kanıt:** const cat = i.category || currentLanguage === 'tr' ? 'Diğer' : 'Other';   // line 1102
// vs correct sibling line 1110:
const cat = inv?.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');
- **Düzeltme:** Wrap the ternary: `const cat = i.category || (currentLanguage === 'tr' ? 'Diğer' : 'Other');` so the category name is preserved and avgStock is bucketed correctly.

### Two views of the same customer statement disagree: PDF includes name-matched orders, modal only includes leadId-matched orders
- **Kategori:** data-integrity · **Dosya:** `src/components/CariEkstrePanel.tsx` · CariEkstrePanel useEffect lines 138-144 vs CRMPage.tsx:2992-2994
- **Sorun:** For a single customer, the "Ekstre PDF" button (CRMPage.tsx:2992) collects orders via `o.leadId === selectedLead.id || o.customerName === selectedLead.name`, so it includes orders that carry only customerName and no leadId (e.g. Shopify-synced or manually-entered orders). The in-app "Ekstre Görüntüle" modal renders CariEkstrePanel with leadId, and CariEkstrePanel queries strictly `where('leadId','==',leadId)`. Orders without leadId are therefore present in the PDF statement but missing from the on-screen statement for the same customer — two different balances for one customer. After a lead is deleted (handleDeleteLead, CRMPage.tsx:245), its orders keep the stale leadId and silently vanish from every leadId-scoped statement while still appearing in the global orders list by name.
- **Kanıt:** // CariEkstrePanel.tsx (modal path)
q = query(ordersRef, where('leadId','==',leadId), where('status','in',['Pending','Processing','Shipped']));
// CRMPage.tsx (PDF path)
const leadOrders = orders.filter(o => o.leadId === selectedLead.id || o.customerName === selectedLead.name);
- **Düzeltme:** Pick one canonical customer-order association and use it in both paths. Pass customerName into CariEkstrePanel and query/match on leadId OR customerName consistently, or backfill leadId on all orders so name-matching is never needed.

### Credit-limit edit writes to the wrong lead / silently no-ops, and is self-service for the dealer
- **Kategori:** data-integrity · **Dosya:** `src/components/B2BPortal.tsx` · credit card save handler, line 545; displayed via creditInfo listener lines 115-120
- **Sorun:** The Save button finds the lead via `leads.find(l => l.email === user?.email)` (the companyId-scoped `leads` prop). If no lead matches the logged-in user's email (common for Admin/Manager viewing the portal, or when the dealer's lead email differs), the update is silently skipped — the UI shows the new limit (local `creditInfo` state) but nothing is persisted, so on reload it reverts. Worse, when a Dealer-role user IS viewing their own portal the button persists `creditLimit` on their own lead with no role gate (the edit button at line 538 is rendered for all roles), letting a customer raise their own credit limit. The credit limit is the only guardrail enforced by the over-limit alert at lines 363-369 and 555.
- **Kanıt:** onClick={async () => { const lead = leads.find(l => l.email === user?.email); if (lead) { await updateDoc(doc(db, 'leads', lead.id), { creditLimit: creditInfo.limit }); } setIsEditingCredit(false); }}
- **Düzeltme:** Gate the edit button behind `userRole === 'Admin' || userRole === 'Manager'`; key the lookup by the lead being viewed (selected dealer id) rather than the current user's email; and surface an error toast when no lead is matched instead of silently closing the editor.

### Audit log entries written with companyId = user.uid disappear for company members
- **Kategori:** data-integrity · **Dosya:** `src/App.tsx` · logAuditAction L1196-1207; audit read L2282
- **Sorun:** logAuditAction writes auditLog with companyId: user.uid (L1203). auditLog is not in TENANT_COLLECTIONS so the server does not override this value. The audit viewer reads where('companyId','==', companyId) with companyId=user.uid (L2280-2282). For a non-owner member (companyId != uid) the entry's stored companyId (the member's uid) will never match the company's real companyId, so member-performed actions silently vanish from the company audit trail — an append-only audit log that loses records is a compliance hole.
- **Kanıt:** App.tsx L1199-1203: await addDoc(collection(db,'auditLog'),{ action, details, userId:user.uid, companyId: user.uid, ...}). App.tsx L2282: query(collection(db,'auditLog'), where('companyId','==',companyId), ...) with L2280 companyId = user.uid.
- **Düzeltme:** Stamp auditLog with the resolved company id (users/{uid}.companyId ?? uid) on write, or add auditLog to TENANT_COLLECTIONS so the server injects the correct companyId, and use the same resolved id in the read query.

### Payment can exceed open balance, silently driving tahsilEdilen past toplamTutar
- **Kategori:** data-integrity · **Dosya:** `src/components/TahsilatModule.tsx` · handlePaymentSave, lines 550-586
- **Sorun:** The only validation is tutar > 0 (line 554). There is no cap against the open balance (toplamTutar - tahsilEdilen). An over-payment makes newTahsilEdilen > toplamTutar, so acik becomes negative; calcDurum returns 'Tahsil Edildi' for acik <= 0 (line 63), hiding the over-collection. The negative open balance then feeds the aging report and total-open-balance card (lines 380, 436) as a negative contribution, understating real receivables.
- **Kanıt:** const tutar = parseFloat(paymentForm.tutar) || 0;
if (tutar <= 0) { showToast('Geçerli bir tutar girin.', 'error'); return; }
...
const newTahsilEdilen = paymentKaydi.tahsilEdilen + tutar; // no upper bound
- **Düzeltme:** Reject (or warn) when tutar > (toplamTutar - tahsilEdilen) + epsilon, or clamp newTahsilEdilen to toplamTutar and surface the overage explicitly.

### Staff users can forge/tamper audit-log entries via POST /api/db/auditLog
- **Kategori:** data-integrity · **Dosya:** `server.ts` · POST route lines 2123-2137; rbac.ts isAllowed lines 31-33; writeAuditLog lines 1454-1476
- **Sorun:** auditLog is append-only, but APPEND_ONLY collections still permit POST (insert) for STAFF_ROLES (src/lib/rbac.ts:32: `return op === 'write' && STAFF_ROLES.includes(role)`). The POST handler inserts client-supplied body verbatim: it calls injectTenant(req, coll, req.body), but auditLog is NOT in TENANT_COLLECTIONS (server.ts:405-416) nor USER_SCOPED_COLLECTIONS (server.ts:417), so injectTenant returns the body unchanged. There is no server-side overwrite of userId/userEmail/timestamp/source on POST. A logged-in staff user can therefore write a fully attacker-controlled audit document — fabricating actions, attributing them to another userId/userEmail or another companyId, and even setting source:'server' so forged entries are indistinguishable from the trusted server-generated ones produced by writeAuditLog(). This breaks the integrity/non-repudiation guarantee the append-only audit log exists to provide.
- **Kanıt:** app.post('/api/db/:coll', dbLimiter, requireAuth, requireMfaVerified, dbJson, async (req, res) => { ... const data = await injectTenant(req, coll, resolveSentinels(req.body ?? {})); await docsDb.query('INSERT INTO docs (coll, id, data) VALUES ($1,$2,$3)', [coll, id, JSON.stringify(data)]); ... }  // rbac: APPEND_ONLY allows op==='write' for STAFF_ROLES
- **Düzeltme:** For APPEND_ONLY collections (auditLog/syncLog/clientErrors), server-side overwrite the identity/provenance fields on POST: force userId/userEmail = reqActor(req), set source server-side, set timestamp = pgServerTimestamp(), and reject/ignore client-supplied companyId. Alternatively block direct client POSTs to auditLog entirely and only allow server-internal writeAuditLog().

### Mikro import overwrites stockLevel wholesale, clobbering local movements and decrements
- **Kategori:** data-integrity · **Dosya:** `server.ts` · ImportStok loop ~3422-3449
- **Sorun:** Every Mikro import does batch.update(existingRef, item) with item.stockLevel = Number(s.sto_mevcut_mik ?? s.toplam_miktar ?? 0), unconditionally replacing the local stockLevel for existing SKUs. Any local stock changes made via the +/- buttons or Quick Stock Count since the last import are silently discarded, while the corresponding inventoryMovements rows remain — so the movement ledger no longer reconciles to stockLevel. There is no merge, no delta, and no movement row recording the adjustment caused by the overwrite.
- **Kanıt:** const item = { ... stockLevel: Number(s.sto_mevcut_mik ?? s.toplam_miktar ?? 0), ... };
const existingRef = existingBySku.get(sku);
if (existingRef) { batch.update(existingRef, item); updated++; }
- **Düzeltme:** On import, compute the delta between incoming Mikro qty and current stockLevel and write an inventoryMovements adjustment row, or treat Mikro as the source of truth and disable local stock editing for mikro_import items; either way keep the ledger consistent with stockLevel.

### Read queries use companyId = user.uid, breaking all non-owner company members
- **Kategori:** multi-tenant · **Dosya:** `src/App.tsx` · L2127 and L2280; queries L2130-2143, L2172, L2282
- **Sorun:** App.tsx hardcodes `const companyId = user.uid` then filters leads/orders/inventory/inventoryMovements/auditLog with where('companyId','==', companyId) (applied client-side by dbClient.applyConstraints, dbClient.ts L172-188). But the authoritative companyId is users/{uid}.companyId ?? uid (server getUserCompanyId, server.ts L425-436). For any user who is a member of a company they do not own (companyId != uid), company documents carry the OWNER's uid as companyId; the client's local where('companyId','==', user.uid) filters them all out. Such users see an empty leads/orders/inventory list and an empty audit log. Works today only because owners have uid == companyId.
- **Kanıt:** App.tsx L2127: const companyId = user.uid;  L2130: query(collection(db,'leads'), where('companyId','==',companyId)). dbClient.ts L173-176 applies the where filter locally: out = out.filter(d => ... case '==': return v === c.value ...). server.ts L432: cid = (snap.exists ? (snap.data()?.companyId as string):'') || uid.
- **Düzeltme:** Resolve the real companyId once (fetch users/{uid}.companyId, fallback uid) and use it in these queries instead of user.uid, or drop the redundant client-side companyId filter entirely since the server already scopes reads via tenantWhere.

### Shopify webhook creates/updates orders with no companyId and queries across all tenants
- **Kategori:** multi-tenant · **Dosya:** `server.ts` · /api/shopify/webhook handler, lines 2474-2549
- **Sorun:** The webhook looks up orders by `shopifyOrderId` with no companyId filter (`adminDb.collection('orders').where('shopifyOrderId','==',shopifyOrderId).limit(1)`) and, on orders/create, inserts a new order document (line 2502 `adminDb.collection('orders').add({...})`) that contains NO companyId field at all. So Shopify-sourced orders are orphaned from any tenant (invisible to tenant-scoped queries) and cancel/fulfill updates can match the first order of ANY tenant that happens to share the synthetic shopifyOrderId (`#<order_number>`), which is not globally unique across stores.
- **Kanıt:** await adminDb.collection('orders').add({
  ...orderData,
  lineItems: ...,
  createdAt: pgServerTimestamp(),
  source: 'shopify_webhook',
}); // no companyId
- **Düzeltme:** Resolve the owning tenant for the Shopify store (store companyId in settings/shopify) and (a) include `companyId` on every created order, (b) add `.where('companyId','==',companyId)` to every lookup.

### StreamManager cache never cleared on logout/user-switch — cross-tenant data persists in memory
- **Kategori:** multi-tenant · **Dosya:** `src/lib/dbClient.ts` · StreamManager (cache field line 258, singleton line 377); logout path src/App.tsx:2111-2119
- **Sorun:** `const stream = new StreamManager()` is a module-level singleton whose `cache = new Map<...>()` (line 258), `ready` set, `sessionReady` flag, and EventSource live for the lifetime of the page. There is NO reset/clear method and nothing calls one on sign-out. `handleLogout()` only does `signOut(auth)` with no `window.location.reload()`, and the `onAuthStateChanged` handler in App.tsx has no branch that tears down `stream` when the user becomes null. Because this is a SPA, if a second user signs in without a hard reload, every `stream.getDocs(coll)` (used by onSnapshot at lines 394-402) returns the PREVIOUS tenant's cached documents until/unless a fresh SSE `init` event overwrites that exact collection. Collections the new user does not subscribe to are never overwritten and leak indefinitely. This is a concrete multi-tenant data-isolation hole on the client even though the server filters correctly.
- **Kanıt:** private cache = new Map<string, Map<string, Record<string, unknown>>>();  // line 258 — never cleared
...
const stream = new StreamManager();  // line 377 — module singleton
// App.tsx:2111
const handleLogout = () => {
  if (isGuestMode) { ... } else { signOut(auth); }  // no reload, no stream reset
};
- **Düzeltme:** Add a `reset()` method to StreamManager that closes `this.es`, clears `cache`/`ready`/`listeners`, resets `sessionReady=false`, `connectedColls=''`, and clears timers. Call it from `onAuthStateChanged` whenever the user transitions to null (and on user-id change), or force `window.location.reload()` in handleLogout to guarantee a clean module state.

### GET /api/db/users and /api/db/companies expose all tenants' users/companies to any Admin/Manager
- **Kategori:** multi-tenant · **Dosya:** `server.ts` · tenantWhere (2049-2058), TENANT_COLLECTIONS (405-416); rbac.ts ADMIN_ONLY_COLLECTIONS (18)
- **Sorun:** 'users' and 'companies' are gated to Admin/Manager via ADMIN_ONLY_COLLECTIONS, but they are NOT in TENANT_COLLECTIONS, so tenantWhere adds no companyId filter. An Admin of Company A calling GET /api/db/users receives the user documents of EVERY tenant (emails, roles, companyId, MFA flags), and GET /api/db/companies returns all tenant company records. ownsDoc also returns true for these, so an Admin of A can PATCH/PUT another tenant's user document (subject only to the role-escalation guard, which only blocks the 'role' field). users/{uid} self-access exception aside, the list endpoint is fully cross-tenant.
- **Kanıt:** ADMIN_ONLY_COLLECTIONS = new Set(['users','settings','invites','subscriptions','paymentHistory']);  // role gate, no tenant gate
// 'users','companies' absent from TENANT_COLLECTIONS -> tenantWhere returns {sql:'',params:[]}
- **Düzeltme:** Scope users/companies by companyId. For 'users', add ` AND (data->>'companyId' = $2 OR id = <uid>)` semantics in tenantWhere (special-cased), and make ownsDoc for users compare companyId. For 'companies', restrict GET to the caller's own company (or super-admin only).

### CSV import writes inventory items with no companyId — items vanish from the tenant's own list
- **Kategori:** multi-tenant · **Dosya:** `src/components/InventoryView.tsx` · handleConfirmImport payload lines 219-241
- **Sorun:** The CSV import payload sets sku/name/prices/stockLevel/... but never sets companyId, on either the updateDoc or addDoc path. The inventory subscription filters where('companyId','==',companyId) (src/App.tsx:2143), so freshly CSV-imported products have companyId=undefined and never appear in the importing user's inventory grid, low-stock panels, or reports — looks like data loss. addDoc-created rows with undefined companyId also fall outside every tenant's filter (orphaned), while any pre-existing row matched by SKU keeps whatever companyId it had regardless of who is importing.
- **Kanıt:** const payload = { sku, source: 'csv', name: ..., stockLevel: Number(row.stockLevel) || 0, ..., prices: {...}, supplier: ..., warehouseId: ..., updatedAt: serverTimestamp() };
if (existingId) { await updateDoc(doc(db, 'inventory', existingId), payload); } else { await addDoc(collection(db, 'inventory'), { ...payload, createdAt: serverTimestamp() }); }
// no companyId anywhere in payload
- **Düzeltme:** Add companyId (the resolved tenant id) to the CSV import payload on both create and update paths, matching ProductForm which sets companyId on add.

### Stripe webhook has no event idempotency — duplicate deliveries double-bill / re-extend subscription
- **Kategori:** payment · **Dosya:** `server.ts` · /api/stripe/webhook handler, ~lines 6371-6431
- **Sorun:** The webhook verifies the Stripe signature correctly (constructEvent at 6380) but never records or checks event.id. Stripe explicitly retries webhook delivery and may send the same event multiple times. On each checkout.session.completed the handler unconditionally calls adminDb.collection('payments').add({...}) (6417) creating a NEW payment record, and re-sets the subscription with a freshly computed endDate (6403-6414). A retried/duplicated delivery therefore produces duplicate 'paid' payment rows and re-extends the billing period. grep for event.id/idempot across server.ts returns no dedupe logic (only an unrelated hash-dedupe helper at line 850).
- **Kanıt:** event = stripeClient.webhooks.constructEvent(req.rawBody ?? Buffer.from(''), sig, webhookSecret);
...
await adminDb.collection('payments').add({ userId: firebaseUid, plan, cycle, amount, currency: 'TRY', status: 'paid', stripeSessionId: session.id, ... });
- **Düzeltme:** Before processing, persist event.id (e.g. to a stripeEvents collection) inside a transaction and short-circuit with 200 if already seen; or at minimum dedupe the payments record by session.id (use .doc(session.id).set(..., {merge}) instead of .add).

### iyzico /api/iyzico/payment-link trusts client-supplied amount and orderId with no order ownership or amount reconciliation
- **Kategori:** payment · **Dosya:** `server.ts` · app.post('/api/iyzico/payment-link', ~lines 5883-5990
- **Sorun:** The endpoint is requireAuth only — no RBAC, no company scoping. Both orderId and amount come straight from req.body (5888) and are never validated against the actual order's stored total or against the caller's companyId. The handler builds the iyzico checkout for that arbitrary amount (price/paidPrice = amount.toFixed(2), 5904/5923-5924) and then writes iyzicoPaymentUrl/iyzicoToken onto orders/{orderId} (5977) for an order it never confirmed the caller owns. Result: (a) amount tampering — a payment link can be generated for any amount unrelated to the real order total, and (b) cross-tenant write — any authenticated user from any tenant can attach a payment URL/token to any other tenant's order id. No getUserCompanyId/companyId reference exists anywhere in this handler.
- **Kanıt:** const { orderId, amount, currency = 'TRY', ... } = req.body as {...};
if (!orderId || !amount || !customerName || !customerEmail) { return res.status(400)... }
const amountStr = amount.toFixed(2);
...
await adminDb.collection('orders').doc(orderId).set({ iyzicoPaymentUrl: d.paymentPageUrl, iyzicoToken: d.token, ... }, { merge: true });
- **Düzeltme:** Load orders/{orderId}, verify its companyId === getUserCompanyId(req.uid), and derive the amount server-side from the stored order total/line items instead of accepting req.body.amount. Reject if mismatch.

### KDV-by-rate matrah/amount fabricated from every debit line
- **Kategori:** payment · **Dosya:** `src/components/AccountingModule.tsx` · kdvOranBreakdown, lines 1771-1777
- **Sorun:** The VAT-by-rate breakdown takes EVERY filtered journal entry, uses e.borc as the taxable base (matrah) and recomputes KDV as e.borc * oran/100. This is unrelated to the actual hesaplananKDV/indirilecekKDV (lines 1768-1769, which read the 391/191 KDV accounts). It double-counts: the 191/391 KDV postings themselves, payments, and transfers all get a 'matrah' and a synthetic VAT. Output VAT also sits on the credit side, so using e.borc is the wrong side anyway. The breakdown shown on the VAT declaration screen and exported to the beyanname TXT (line 645) will not reconcile to hesaplananKDV.
- **Kanıt:** kdvOranBreakdown[oran].matrah += e.borc;
kdvOranBreakdown[oran].kdv += e.borc * (oran / 100);
- **Düzeltme:** Derive matrah/KDV only from the revenue/purchase lines (6xx credit for sales base, 191/391 for the VAT amount) and reconcile the per-rate KDV sum back to hesaplananKDV/indirilecekKDV. Do not multiply arbitrary debit lines by the rate.

### getMfaStatus fails open — MFA challenge silently skipped on any error or non-OK response
- **Kategori:** security · **Dosya:** `src/lib/mfa.ts` · getMfaStatus (27-33), consumed at src/App.tsx:1834-1836
- **Sorun:** getMfaStatus returns `{ enabled: false, verified: true }` for both the catch branch and any non-OK response. The caller then computes `setMfaChallenge(mfa.enabled && !mfa.verified)` → always false. So if the /api/mfa/status endpoint is down, returns 500, times out, or the network blip occurs, a 2FA-enabled account is admitted with no challenge at all. The onAuthStateChanged handler also wraps it in `try { ... } catch { /* status alınamazsa engelleme */ }` (line 1833-1836), explicitly choosing not to block — a double fail-open. For a security control, failure should deny, not allow.
- **Kanıt:** if (!res.ok) return { enabled: false, verified: true };
} catch { return { enabled: false, verified: true }; }  // mfa.ts:30-32
setMfaChallenge(mfa.enabled && !mfa.verified);  // App.tsx:1835
- **Düzeltme:** On error/non-OK, return a state that forces the challenge (e.g. `{ enabled: true, verified: false }`) or surface the error so the app blocks rather than admits. The real enforcement must be server-side on every /api/db request anyway — confirm the server rejects unverified-MFA sessions regardless of this client value.

### Shopify webhook accepts unauthenticated payloads when SHOPIFY_WEBHOOK_SECRET is unset
- **Kategori:** security · **Dosya:** `server.ts` · /api/shopify/webhook HMAC block, lines 2451-2461
- **Sorun:** HMAC verification only runs when `webhookSecret && shopifyHmac && req.rawBody` are ALL truthy. If SHOPIFY_WEBHOOK_SECRET is not configured (or an attacker simply omits the x-shopify-hmac-sha256 header / sends an empty body), the verification block is skipped entirely and the request is processed and written to the DB. The route has no requireAuth either. Anyone who knows the URL can forge orders/create, orders/cancelled, and fulfillments/create events — injecting fake orders, cancelling real ones, or marking them shipped with attacker-controlled tracking numbers.
- **Kanıt:** if (webhookSecret && shopifyHmac && req.rawBody) {
  const computed = createHmac('sha256', webhookSecret).update(req.rawBody).digest('base64');
  if (computed !== shopifyHmac) { res.status(401).send('Invalid signature'); return; }
}
// else: falls through and processes the webhook
- **Düzeltme:** Require the secret at boot; if missing, reject all webhook calls (503). If secret present but hmac/rawBody missing or mismatched, return 401. Never process an unverified webhook. Use crypto.timingSafeEqual for the comparison.

### MFA challenge gates only the modal, not data loading — all tenant data loads during 2FA challenge
- **Kategori:** security · **Dosya:** `src/App.tsx` · onAuthStateChanged 1829-1888 (sets mfaChallenge 1835); data-loader effect guard 2122-2123; modal render 4049-4055; mfaChallenge usages 538/4049 only
- **Sorun:** On login, getMfaStatus() sets mfaChallenge=true when 2FA is enabled but the session is unverified (line 1835). The inline comment at 1831-1832 claims 'Veri yükleyiciler /api/db'ye erişmeden önce doğrulama gerekir' (data loaders require verification before hitting /api/db). That is false. The only consumer of mfaChallenge is the modal render at 4049. The render path that hosts that modal is the fully-authenticated app shell, so to even show the MFA modal the component renders the whole app, and the data effects have already run. The main loader effect (2122) gates on `if (!isAuthReady || !user || !userRole) return;` and never checks mfaChallenge — so onSnapshot subscriptions for leads/orders/inventory/auditLog/etc. all fire and stream the tenant's data into state while the user is still sitting on the 2FA prompt. A user who never passes the second factor (or closes the modal) has already received the protected data. The second factor is purely cosmetic on the client.
- **Kanıt:** // 1831-1835
// (Veri yükleyiciler /api/db'ye erişmeden önce doğrulama gerekir.)
const mfa = await getMfaStatus();
setMfaChallenge(mfa.enabled && !mfa.verified);
...
// 2122-2123 — loader guard, no mfaChallenge
if (!isAuthReady || !user || !userRole) return;
...
// grep mfaChallenge -> only 538 (declare) and 4049 (modal)
- **Düzeltme:** Gate rendering on mfaChallenge before the app shell: add `if (mfaChallenge) return <MfaChallengeModal .../>;` near the other early returns (around 2922/3118) so the data-loading effects and app body never mount. Equally important, this is client-only theatre regardless — the server must reject /api/db requests for sessions whose 2FA is enabled-but-unverified; do not rely on the client to withhold the data.

### TOTP MFA verification endpoints are brute-forceable (loose dbLimiter, no attempt lockout)
- **Kategori:** security · **Dosya:** `server.ts` · /api/mfa/verify (1928-1939), /api/mfa/enroll/verify (1912-1925), /api/mfa/disable (1942-1955); dbLimiter (1836-1842); totpCheck (1884-1885)
- **Sorun:** The MFA challenge endpoints validate a 6-digit TOTP code but are rate-limited only by dbLimiter (max 2000 requests / 60s, default IP key) — not by authLimiter (20/15min) used for /api/admin/invite. totpCheck uses window:1 (≈3 acceptable codes per 30s step) with no per-account failed-attempt counter or lockout. An attacker who already holds a valid Firebase ID token for an account (requireAuth passes) can fire ~2000 guesses/min against /api/mfa/verify to satisfy the MFA gate, or against /api/mfa/disable to turn MFA off — making the MFA second factor effectively bypassable by online brute force. The verified result is stored in the long-lived (5-day) signed __cetpa_mfa cookie, so one success persists.
- **Kanıt:** app.post('/api/mfa/verify', dbLimiter, requireAuth, dbJson, ...)  // server.ts:1928 — dbLimiter = max:2000, windowMs:60_000
const totpCheck = (token, secret) => (totpVerifyRaw({ secret, token, window: 1 }).valid === true);  // 1884 — no attempt counter
if (!rows[0]?.enabled || !totpCheck(code, rows[0].secret)) return res.status(400)...  // 1933
- **Düzeltme:** Apply authLimiter (or a stricter dedicated limiter keyed by uid) to /api/mfa/verify, /api/mfa/enroll/verify and /api/mfa/disable, and add a per-uid failed-attempt counter with exponential backoff / temporary lockout after ~5 failures.

### SSRF: /api/webhooks/test fetches arbitrary user-supplied URL
- **Kategori:** security · **Dosya:** `server.ts` · app.post('/api/webhooks/test') lines 5503-5517
- **Sorun:** Any authenticated user (no admin gate, only requireAuth) POSTs {url} and the server issues a POST fetch() to it with the only validation being url.startsWith('http'). No host/IP allow-list, no block on private/link-local ranges. An attacker can hit cloud metadata (http://169.254.169.254/latest/meta-data/), internal services (http://localhost:5432, http://10.x.x.x), or scan internal ports — the response r.ok/r.status is returned to the caller, enabling blind/semi-blind SSRF and internal recon. The stored-config path fireWebhooks() (line 5482, fetch(c.url) from webhookConfigs docs) has the same issue with persisted attacker URLs.
- **Kanıt:** const { url } = req.body as { url: string };
if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'valid url required' });
const r = await fetch(url, { method: 'POST', ... signal: AbortSignal.timeout(5000) });
return res.json({ ok: r.ok, status: r.status });
- **Düzeltme:** Parse with new URL(), require https, resolve the hostname and reject RFC1918/loopback/link-local/ULA/metadata IPs (and re-check after DNS to prevent rebinding), enforce a host allow-list or at minimum block internal ranges. Apply the same guard to webhookConfigs.url before fireWebhooks() fetches it. Consider gating the endpoint behind requireAdmin.


## 🟡 MEDIUM

### onAuthStateChanged blocks app boot on a third-party IP-geolocation fetch with no timeout
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · fetchLocation + await chain in onAuthStateChanged (1841-1885)
- **Sorun:** Inside the auth-state callback, `await fetchLocation()` (which calls `fetch('https://ipapi.co/json/')`) runs before `setUser(u)` and `setIsAuthReady(true)` (lines 1882-1885). There is no timeout/AbortController. If ipapi.co is slow, rate-limited (it throttles free usage), or blocked by an ad-blocker that hangs rather than rejects, the entire app is stuck on the `!isAuthReady` spinner (line 2922) for the full fetch duration on EVERY login/refresh. The geolocation is only cosmetic profile metadata (`location` field) yet it is on the critical auth path.
- **Kanıt:** const location = await fetchLocation(); // line 1851 — blocks
... 
setUser(u); storeSetUser(u); ... setIsAuthReady(true); // lines 1882-1885 run only after
- **Düzeltme:** Move the location fetch off the critical path: set `setUser`/`setIsAuthReady` first, then update the user doc with location in a fire-and-forget follow-up. At minimum add an AbortController timeout (2-3s) to the fetch.

### Capacity routing match compares routing SKU against production order productName
- **Kategori:** correctness · **Dosya:** `src/components/MRPModule.tsx` · capacityLoads useMemo, lines 172-176
- **Sorun:** When matching a production order to its routing template, the second OR clause compares the routing's productSku to the order's productName (there is no sku field on the order, but the intent was clearly to match SKUs). This makes SKU-based matching effectively dead/incorrect: a routing only matches if productName equals productName, or if productSku coincidentally equals the order's productName. Orders that should match a routing by SKU will silently fall through to the crude 0.5h/unit fallback, mis-stating capacity load.
- **Kanıt:** const routing = routings.find(r =>
  r.productName.toLowerCase() === po.productName.toLowerCase() ||
  r.productSku.toLowerCase() === (po.productName || '').toLowerCase()
);
- **Düzeltme:** Add a sku field to the productionOrders prop shape and compare r.productSku against po.sku, or drop the second clause entirely since it can never correctly match a SKU.

### QC KPI/trend crashes (substring on undefined) and produces NaN when records lack date/defectRate
- **Kategori:** correctness · **Dosya:** `src/components/QualityModule.tsx` · kpiData useMemo line 508; QC KPI cards line 644
- **Sorun:** kpiData reduces over qcRecords and calls r.date.substring(5,7) with no guard. Any QC record missing date (e.g. records seeded inline, or imported via the PG migration which bypasses the form's required attribute) throws 'Cannot read properties of undefined (reading substring)', crashing the whole KPI tab render. Separately, the QC tab Avg Defect Rate card sums r.defectRate with no fallback, so a record missing defectRate yields NaN and renders '%NaN'. The HTML form's required attribute does not protect records created through any non-form path.
- **Kanıt:** const month = r.date.substring(5, 7); // YYYY-MM-DD -> MM   // line 508
...
{(qcRecords.reduce((sum, r) => sum + r.defectRate, 0) / qcRecords.length).toFixed(1)}  // line 644
- **Düzeltme:** Guard: const d = r.date || ''; if (d.length < 7) skip/bucket as 'Unknown'; and use (r.defectRate ?? 0) and (r.sampleSize ?? 0)/(r.defects ?? 0) in all reducers.

### Commission effectiveRate has a discontinuous cliff at the target boundary
- **Kategori:** correctness · **Dosya:** `src/components/DealerCommissionPanel.tsx` · dealerPerformance memo, line 209-210
- **Sorun:** effectiveRate = achievementRate>=100 ? base+bonus : base*(achievementRate/100). Below target the per-lira rate is scaled down by the achievement ratio (so a dealer at 50% of target earns only base*0.5%, far below the configured base rate), then jumps discontinuously to base+bonus at exactly 100%. Example (Dealer base 5, bonus 2): at 99% the dealer earns 4.95% of sales; at 100% they earn 7%. Crossing the target by 1 lira can nearly double total commission, and just-under-target performers are paid below the advertised base rate. The UI/Card text (line 575, 584) advertises a flat base rate, so this scaling is not what the rule author configured.
- **Kanıt:** const effectiveRate = achievementRate >= 100 ? baseRate + bonusRate : baseRate * (achievementRate / 100);
- **Düzeltme:** Pay the flat baseRate on actual sales below target and add the bonusRate only on achievement>=100% (e.g. effectiveRate = achievementRate>=100 ? baseRate+bonusRate : baseRate), or document the linear ramp explicitly so it matches the rule cards.

### Expense approve/reject writes have no await and no error handling -> optimistic desync
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · L7881-7882
- **Sorun:** The expense (masraflar) Approve/Reject buttons call updateDoc without await and without try/catch. dbClient.updateDoc applies an optimistic local merge (dbClient.ts L447) before the server PATCH; if the server rejects (auth/MFA/network), the rejection is an unhandled promise and the UI keeps showing the optimistic 'Onaylandı'/'Reddedildi' status with no error toast — a financial approval can appear successful while the server never persisted it.
- **Kanıt:** App.tsx L7881: onClick={()=>updateDoc(doc(db,'masraflar',m.id),{status:'Onaylandı',approvedBy:user?.displayName||user?.email||''})}  // no await, no catch.  dbClient.ts L447: stream.applyLocal(ref.coll,'merge',ref.id,data) runs before the PATCH at L448.
- **Düzeltme:** Wrap in an async handler with await + try/catch and surface a toast on failure (matching the pattern used elsewhere, e.g. handleSaveSupplier L765-773).

### Dateless journal entries counted in every KDV period
- **Kategori:** correctness · **Dosya:** `src/components/AccountingModule.tsx` · lines 1763-1767 (KDV); compare 1745-1748 (monthly)
- **Sorun:** kdvFilteredEntries returns true for any entry with no date (if (!e.date) return true), so a dateless entry is included in the KDV computation of EVERY selected month/year simultaneously, inflating hesaplananKDV/indirilecekKDV/odenecekKDV. The monthly P&L filter (line 1746) correctly returns false for missing dates, so the two code paths are inconsistent.
- **Kanıt:** const kdvFilteredEntries = journalEntries.filter(e => {
  if (!e.date) return true;   // dateless -> matches ALL months
  const d = new Date(e.date);
  return d.getMonth() + 1 === kdvMonth && d.getFullYear() === kdvYear;
});
- **Düzeltme:** Return false for entries without a valid date in the KDV filter, matching the P&L behavior, or require a date at save time.

### Payment modal open-balance display hardcodes TRY, ignoring record currency
- **Kategori:** correctness · **Dosya:** `src/components/TahsilatModule.tsx` · line 1074 (payment modal)
- **Sorun:** formatCurrency defaults currency to 'TRY' (lines 82-83). In the payment modal the open balance is formatted without passing the record's currency, so a USD or EUR receivable shows its open balance with a ₺ symbol while every other column in the same row (lines 840-846) correctly uses k.currency. Misleads the operator entering a payment on a foreign-currency invoice.
- **Kanıt:** {formatCurrency(paymentKaydi.toplamTutar - paymentKaydi.tahsilEdilen)} // no currency arg -> TRY
- **Düzeltme:** Pass the record currency: formatCurrency(paymentKaydi.toplamTutar - paymentKaydi.tahsilEdilen, paymentKaydi.currency || 'TRY').

### TR-carrier tracking response cast to TrackingResult with zero validation — events may be undefined and crash UI
- **Kategori:** correctness · **Dosya:** `src/services/trackingService.ts` · trackShipment, lines 176-182
- **Sorun:** For Yurtici/MNG/Aras/PTT the server JSON is blindly cast (`return data as unknown as TrackingResult`) with no normalization, unlike DHL/UPS/FedEx which validate and default fields. This branch also does NOT check `data.error` like the other three carrier branches do. If the server returns a payload missing `events`, the caller iterating result.events.map(...) hits undefined and throws. The outer try/catch only converts thrown exceptions into an error result; a malformed-but-non-throwing payload (events:undefined) passes straight through unguarded.
- **Kanıt:** const data = await res.json() as Record<string, unknown>;
// Server already returns a normalized TrackingResult-compatible object
return data as unknown as TrackingResult;
- **Düzeltme:** Validate/normalize the TR-carrier payload like the other carriers: check data.error and coerce defaults (events: Array.isArray(data.events) ? data.events : [], statusCode fallback, origin/destination '-') before returning.

### Performance bonus added to payroll without checking employee currency or score validity
- **Kategori:** correctness · **Dosya:** `src/components/HRModule.tsx` · handleAddPayroll (331-342)
- **Sorun:** performanceBonus = latestPerformance.score * 1000 (line 334) is added to bonus and netSalary unconditionally. `score` comes from approved performanceReviews with no bound check, and the 1000 multiplier is a raw TRY amount mixed into a payroll whose currency may be USD/EUR (see payrollForm.currency). For a USD-paid employee with score 5 this silently adds 5000 'units' interpreted as USD in the stored doc but displayed as ₺. There is also no idempotency: re-creating a payroll for the same employee/month re-applies the full performance bonus, and nothing dedupes month+year+employee so duplicate payrolls for the same period are allowed.
- **Kanıt:** const performanceBonus = latestPerformance ? latestPerformance.score * 1000 : 0;  // line 334 — added into bonus (340) and net (336) regardless of currency; no month/employee uniqueness guard
- **Düzeltme:** Currency-normalize the performance bonus, clamp/validate score, and guard against duplicate payroll for the same employeeId+month+year before addDoc.

### setIsAuthReady blocked on un-timed external geolocation fetch in auth bootstrap
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · onAuthStateChanged 1841-1885
- **Sorun:** Inside the auth state handler, for every signed-in user the code does `const location = await fetchLocation();` (1851) which awaits a fetch to the third-party https://ipapi.co/json/ before continuing to setDoc/updateDoc and ultimately setIsAuthReady(true) at 1885. The whole app is blocked behind `if (!isAuthReady) return <spinner>` (2922). ipapi.co is rate-limited (free tier) and frequently blocked by adblockers/privacy extensions/corporate proxies; there is no timeout/AbortController on this fetch, so a slow or hung response stalls the entire login on a spinner for the browser's default fetch timeout. The location is only telemetry written to the user doc — it must not be on the critical path to readiness.
- **Kanıt:** const fetchLocation = async () => { try { const res = await fetch('https://ipapi.co/json/'); ... } catch { return 'Antalya, TR'; } };
const location = await fetchLocation();   // blocks before setIsAuthReady(true)
...
setIsAuthReady(true);
- **Düzeltme:** Move the location enrichment off the critical path: set isAuthReady/user immediately after resolving role, then fire the profile-location update fire-and-forget. At minimum wrap fetchLocation in an AbortController with a short timeout (e.g. 2s).

### Real logout does not await signOut and leaves user/store/route state stale
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · handleLogout 2111-2119
- **Sorun:** For the non-guest branch handleLogout calls `signOut(auth)` (2117) without awaiting it and without clearing local React state. Unlike the guest branch (which explicitly does setUser(null)/storeSetUser(null)), the authenticated branch relies entirely on onAuthStateChanged firing to clear state. signOut returns a promise; if it rejects (network) the rejection is unhandled and the UI silently stays logged-in. Even on success there is a window where activeTab/URL (useRouteSync) and the in-memory leads/orders/inventory arrays remain populated until the listener round-trips. Caller can't know logout failed because nothing is awaited and no catch exists.
- **Kanıt:** const handleLogout = () => {
  if (isGuestMode) { setIsGuestMode(false); setUser(null); storeSetUser(null); }
  else { signOut(auth); }   // not awaited, no catch, no local state reset
};
- **Düzeltme:** Make handleLogout async, `await signOut(auth)` inside try/catch, surface a toast on failure, and proactively clear sensitive in-memory collections + reset activeTab to dashboard rather than waiting for the auth listener.

### Inconsistent hardcoded FX fallback rates across modules (32/35 vs 38/41 vs 1)
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · useFx helper 677-679; P&L 7287-7288; dashboard KPIs (many, e.g. 4290)
- **Sorun:** Three different hardcoded TRY-per-unit fallbacks exist for the same currencies when live rates are unavailable: the `useFx` helper uses `USD ?? 32, EUR ?? 35` (lines 677-678), the P&L tab uses `USD ?? 38, EUR ?? 41` (lines 7287-7288), and all dashboard KPIs use `|| 1`. The same TRY amount therefore converts to materially different USD/EUR figures depending on which screen the user is on, all presented as authoritative. EUR fallback being only ~8% above USD (35 vs 32, and 41 vs 38) is also implausible for TRY where EUR>USD by a larger margin, but the core issue is the divergence itself.
- **Kanıt:** const usd = exchangeRates?.USD ?? 32;
const eur = exchangeRates?.EUR ?? 35;
// ...vs...
const pnlUsd = exchangeRates?.USD ?? 38;
const pnlEur = exchangeRates?.EUR ?? 41;
- **Düzeltme:** Define a single shared `fxRate(currency)` helper with one agreed fallback constant (or no conversion at all when rates are missing) and use it everywhere instead of duplicating the rate-selection ternary with divergent defaults.

### Detail line-item table crashes on a null/undefined price (item.price.toFixed) — the collapsed table guards it, this one does not
- **Kategori:** correctness · **Dosya:** `src/pages/OrdersPage.tsx` · detail line-item rows, lines 1994-1995, 2003, 2021-2022
- **Sorun:** The inline expanded table guards price as (li.price ?? 0) (line 1159-1160) and PDF export uses (li.price || 0) (line 1619). The order-detail line-item table does NOT: it calls item.price.toFixed(2) and item.price * item.quantity directly (1994-1995), and the footer/GP blocks do l.price * l.quantity (2003, 2021). A line item with a missing price (very possible for Shopify-imported or manually-added items) throws 'Cannot read properties of undefined (reading toFixed)' and blanks the whole order-detail panel. quantity is likewise unguarded, so an undefined quantity yields NaN in the displayed line total.
- **Kanıt:** <td ...>${item.price.toFixed(2)}</td>  // 1994 — no ?? 0, unlike line 1159: ₺{(li.price ?? 0).toLocaleString(...)}
- **Düzeltme:** Null-coalesce consistently: (item.price ?? 0).toFixed(2), ((item.price ?? 0) * (item.quantity ?? 0)), and same in the reduce() at 2003/2021/2022.

### Backflush (ters kayıt) drives inventory negative — stock warning is preview-only, not enforced
- **Kategori:** data-integrity · **Dosya:** `src/components/ProductionModule.tsx` · executeTersKayit lines 600-650; preview hasStockWarning lines 571-575
- **Sorun:** openTersKayit computes hasStockWarning = currentStock < consumed and shows it in red, but executeTersKayit's runTransaction unconditionally writes currentQty + line.delta with no floor and no abort on insufficient stock. Confirming the modal with a red 'Yetersiz stok!' warning will post negative on-hand quantities. The transaction also re-reads current qty inside the tx (good for concurrency) but never re-checks the warning, so the preview's safety signal has no effect on the actual posting.
- **Kanıt:** const currentQty = (snap.exists() ? (snap.data().quantity as number) : 0) || 0;
tx.update(invRef, { quantity: currentQty + line.delta });  // no Math.max(0, ...), no insufficiency check
- **Düzeltme:** In executeTersKayit, after reading currentQty inside the tx, if currentQty + line.delta < 0 for a consumption line, either throw to abort the transaction or clamp and surface an error. At minimum require explicit confirmation when any line.hasStockWarning is true.

### Invoice VAT split stored as unrounded floats
- **Kategori:** data-integrity · **Dosya:** `src/components/AccountingModule.tsx` · handleCreateInvoice, lines 343-351
- **Sorun:** kdvHaric = totalPrice / (1 + kdvOran/100) and kdvTutari = totalPrice - kdvHaric are persisted to the invoices collection without rounding to 2 decimals. The base (matrah) and VAT amount can each carry many fractional digits; when these are later summed across invoices for reporting/declaration they accumulate float error and individual invoices won't reconcile (base + VAT should equal totalPrice to the kuruş). There is also no guard for totalPrice <= 0.
- **Kanıt:** const kdvHaric = totalPrice / (1 + invoiceForm.kdvOran / 100);
const kdvTutari = totalPrice - kdvHaric;
await addDoc(collection(db, 'invoices'), { ...invoiceForm, totalPrice, kdvHaric, kdvTutari, ... });
- **Düzeltme:** Round to 2 decimals on store: const kdvHaric = Math.round((totalPrice/(1+rate))*100)/100; const kdvTutari = Math.round((totalPrice - kdvHaric)*100)/100; ensure kdvHaric + kdvTutari === totalPrice and guard when totalPrice <= 0.

### Deleting a cost center orphans all its expense items (no cascade)
- **Kategori:** data-integrity · **Dosya:** `src/components/MaliyetMerkeziModule.tsx` · deleteMerkez (348-355)
- **Sorun:** deleteMerkez only deletes the maliyetMerkezleri doc. Expense items (maliyetKalemleri) reference the center via merkezId/merkezAd but are never deleted or reparented. After deletion these kalemler remain in the collection with a dangling merkezId: they vanish from merkezlerWithActual rollups (filter by m.id no longer matches any center, line 307) so their tutar silently drops out of all budget/variance/category analysis, yet they still appear in the Gider Kalemleri table and CSV export with a stale merkezAd. Cost totals become inconsistent depending on which view you look at.
- **Kanıt:** const deleteMerkez = async (id: string) => { await deleteDoc(doc(db, 'maliyetMerkezleri', id)); ... }  // lines 348-350 — no query/delete of related maliyetKalemleri
- **Düzeltme:** Before deleting the center, query maliyetKalemleri where merkezId == id and either block deletion if any exist, or delete/reassign them (mirror the cascade pattern used in HRModule.handleDeleteEmployee, lines 245-263).

### Expense amount stored via parseFloat with no NaN guard — NaN persisted and poisons totals
- **Kategori:** data-integrity · **Dosya:** `src/App.tsx` · Phase 548 'masraf' save button, lines 7844-7845
- **Sorun:** The save guard only checks falsy/empty (if(!p548Draft.employeeName||!p548Draft.amount) return;). p548Draft.amount is a free-text string. A value like 'abc' is truthy so it passes the guard, but parseFloat('abc') === NaN, which is written straight to Firestore. The row then renders as ₺NaN/$NaN via fE, and because NaN propagates through the reduce() calls, totalPending/totalApproved become NaN, breaking the whole summary panel. Unlike most other inputs in this file which use Number(...) || 0, this path has no fallback.
- **Kanıt:** if(!p548Draft.employeeName||!p548Draft.amount) return;
await addDoc(collection(db,'masraflar'),{...p548Draft,amount:parseFloat(p548Draft.amount),status:'Bekliyor',createdAt:serverTimestamp()});
- **Düzeltme:** Compute const amt = parseFloat(p548Draft.amount); guard with if(!isFinite(amt) || amt<=0) return; and store amount: amt. Optionally use Number(p548Draft.amount) || 0 to match the rest of the file.

### Negative-stock prevention is inconsistent — only the -1 button clamps, ProductForm/CSV/quick-count allow negatives
- **Kategori:** data-integrity · **Dosya:** `src/components/InventoryView.tsx` · -1 button line 731 (Math.max(0,...)); ProductForm.tsx setFormData stockLevel line 275; App.tsx stock count parseInt ~15212
- **Sorun:** Only the quick -1 button clamps with Math.max(0, ...). ProductForm's stock field (onChange={e => setFormData({...formData, stockLevel: Number(e.target.value)})}) and the Quick Stock Count input accept any value including negatives (parseInt of '-5'), and these write directly to stockLevel. There is no server-side validation either. A negative stockLevel then flows into value/COGS reductions (e.g. App.tsx retailValue/costValue reduce over stockLevel) producing negative inventory valuation and misleading 'critical' badges.
- **Kanıt:** // -1 button clamps:
const newStock = Math.max(0, (item.stockLevel ?? 0) - 1);
// ProductForm has no clamp:
onChange={e => setFormData({ ...formData, stockLevel: Number(e.target.value) })}
- **Düzeltme:** Validate stockLevel >= 0 on all write paths (ProductForm, Quick Stock Count, CSV import) and enforce a non-negative CHECK / guard server-side.

### Return amount is unvalidated: editable to any/negative value, never capped to order total, and the return touches no stock/refund/paid state
- **Kategori:** data-integrity · **Dosya:** `src/pages/OrdersPage.tsx` · return modal amount input (2962) + create handler (2977-2989); prefill at 1786
- **Sorun:** returnAmount is prefilled to the full order.totalPrice (line 1786) and bound to a free number input (line 2962, Number(e.target.value)) with no min, no cap against order.totalPrice, and no relation to the lineItems actually being returned (returnItems is a free-text string, line 2966). A user can submit a return for more than the order value, or a negative amount, and it is written verbatim to orderReturns (line 2981). The created return also performs NO inventory restock and NO adjustment to the order's paid flag or a refund record — it is a pure note. Combined with the unpaid/Outstanding aggregation (lines 383-384) and returns amount display (line 1283), this lets refund/return figures exceed what was actually billed with no guardrail.
- **Kanıt:** <input type="number" ... value={returnAmount || ''} onChange={e => setReturnAmount(Number(e.target.value))} />  // 2962  — then  amount: returnAmount  // 2981, written with no clamp/validation
- **Düzeltme:** Clamp returnAmount to [0, order.totalPrice] (or to the sum of selected returned line items), reject submit when out of range, and decide whether an approved return should restock inventory and/or flag the order for refund rather than being a free-form note.

### No stock decrement / restock anywhere in the orders unit on confirm, ship, deliver, cancel, or return
- **Kategori:** data-integrity · **Dosya:** `src/pages/OrdersPage.tsx` · handleUpdateOrderStatus (264-270), delivery-note confirm (3077-3082), return create (2977-2989)
- **Sorun:** Across the entire orders unit there is no write to inventory / inventoryMovements. Approving an order to 'Processing' (handleUpdateOrderStatus, line 264-270, and 1068-1072), shipping, marking Delivered (3079), cancelling, or creating a return (2980) never decrements or restores stock — the only inventory reads are for COGS display (1713, 2129). If stock is expected to move with order lifecycle, fulfilled orders silently leave inventory unchanged and cancellations/returns never restock. (If decrement is intentionally handled server-side at order creation, the cancel/return paths here still have no compensating restock.)
- **Kanıt:** const handleUpdateOrderStatus = async (orderId, status) => { await updateDoc(doc(db,'orders',orderId), { status, updatedAt: serverTimestamp() }); }  // 264-270 — no inventory write; grep for inventoryMovements/adjustStock/decrement in this file returns nothing
- **Düzeltme:** On status transitions that consume/return stock (e.g. ship/deliver vs cancel/return), write the corresponding inventoryMovements and adjust on-hand quantities, ideally in a single server transaction to keep order and stock consistent.

### Sticky sessionReady flag reuses previous user's SSE session cookie after user switch
- **Kategori:** multi-tenant · **Dosya:** `src/lib/dbClient.ts` · ensureSession() lines 297-313 (sessionReady declared 297, short-circuit 301, set 310)
- **Sorun:** `sessionReady` is set true after the first successful POST /api/db/session and is only ever reset inside the EventSource `onerror` handler (line 351). On a clean logout+login in the same tab (no reload), `ensureSession()` short-circuits at `if (this.sessionReady) return true` (line 301) and `connect()` skips re-establishing the session cookie, so the SSE opens relying on the httpOnly cookie minted for the PREVIOUS uid. The server-side stream auth (`verifySessionTokenUid` of the cookie, server.ts:1970) then scopes the stream to the old user/company. Combined with the un-cleared cache, the new user can receive the prior tenant's stream scope.
- **Kanıt:** private sessionReady = false;                         // 297
private async ensureSession(): Promise<boolean> {
  if (this.sessionReady) return true;                 // 301 — short-circuits across user switch
  ...
  this.sessionReady = res.ok;                          // 310
}
- **Düzeltme:** Reset sessionReady (and re-POST the session) whenever auth.currentUser.uid changes, not only on SSE error. Tie session establishment to the current uid (store the uid the session was minted for and invalidate when it differs).

### Stock-mutation companyId uses raw auth.currentUser.uid, mismatching the tenant's resolved companyId
- **Kategori:** multi-tenant · **Dosya:** `src/components/InventoryView.tsx` · quick +/- movement writes lines 731 & 738 (companyId: item.companyId ?? null); ProductForm.tsx lines 103/109/128
- **Sorun:** Per the documented model companyId = users/{uid}.companyId ?? uid, but inventory/movement writes use auth.currentUser.uid (ProductForm.tsx:109 `const companyId = auth.currentUser?.uid ?? 'unknown'`) or item.companyId ?? null (InventoryView +/- buttons). For a sub-user/employee whose companyId differs from their uid, newly created products and movements are stamped with the wrong tenant id, and the +/- buttons writing companyId:null produce movements that the listener (where('companyId','==',companyId), App.tsx:2172) can never load — so the movement appears to silently fail and last-movement/30-day-consumption analytics undercount.
- **Kanıt:** // InventoryView +/- write:
companyId: (item as unknown as { companyId?: string }).companyId ?? null
// ProductForm:
const companyId = auth.currentUser?.uid ?? 'unknown';
- **Düzeltme:** Resolve the canonical companyId (users/{uid}.companyId ?? uid) once and use it for every inventory and inventoryMovements write; never write companyId:null on a movement.

### Convert-to-order sends VAT-exclusive line prices, dropping tax from the Shopify order
- **Kategori:** payment · **Dosya:** `src/components/B2BPortal.tsx` · handleConvertToOrder, lines 181-184
- **Sorun:** When converting a quotation to a Shopify draft order, each line is sent with `price: item.price` (the VAT-exclusive unit price from QuotationItem). The quotation's `totalAmount` is VAT-inclusive (QuotationForm.tsx:83 grandTotal = net + VAT). The resulting Shopify order therefore omits VAT entirely, so the order total will not match the approved quotation total the customer agreed to.
- **Kanıt:** lineItems: (q.lineItems || q.items || []).map((item: QuotationItem) => ({ title: item.name, sku: item.sku, price: item.price, quantity: item.quantity }))
- **Düzeltme:** Either include the per-line vatRate so the order applies tax, or send the VAT-inclusive unit price; ensure the order grand total reconciles with q.totalAmount.

### iyzico payments are never verified server-side — callbackUrl points to a non-existent /payment/result handler
- **Kategori:** payment · **Dosya:** `server.ts` · callbackUrl set at 5891 and 6791; no matching route
- **Sorun:** Both iyzico payment-link builders set callbackUrl to `${proto}://${host}/payment/result`, but grep shows no route handling /payment/result and no call to iyzico's retrieve / payment/auth verification API. Nothing confirms a payment actually completed: orders get an iyzicoPaymentUrl but no paid status transition, and superadmin tenantInvoices are written with status:'pending' (6824) and never advanced. Because completion is never validated against iyzico, the system cannot distinguish a paid invoice from an unpaid one server-side, and any later UI/manual flow that treats 'link created' as 'paid' would be trusting an unverified state.
- **Kanıt:** callbackUrl = `${req.protocol}://${req.get('host')}/payment/result`  // line 5891
... grep 'payment/result' -> only the two callbackUrl assignments; no app.get/app.post('/payment/result') and no /payment/auth retrieve call exist.
- **Düzeltme:** Implement the callback endpoint to call iyzico's payment retrieve (POST /payment/auth or /payment/detail) with the returned token, verify status==='success' AND that the returned paidPrice/currency match the stored invoice/order amount, then atomically transition status to 'paid'. Never mark paid based on link creation alone.

### All report aggregations recompute on every render — zero memoization across a 16k-line component
- **Kategori:** performance · **Dosya:** `src/components/ReportsDashboard.tsx` · Component body lines 58–203 (top-level derived data) plus every inline IIFE in the render tree
- **Sorun:** The component imports only `useState, useEffect` (line 8) and uses no `useMemo`/`useCallback` anywhere (grep for `useMemo` returns nothing). Every heavy aggregation is recomputed on each render: top-level `salesByDate`/`trendData` (orders.reduce + sort + slice, 144–168), `categoryData` (171), `ordersByStatus`/`topCustomers` (179–189), `totalInventoryValueTRY`/`categoryValueData` (192–200), and dozens of per-section IIFEs that each re-iterate `orders`, `inventory`, and `inventoryMovements` (e.g. SKU velocity 1052–1065, turnover 1101–1114, LTV 2044–2053, RFM/forecast/cohort sections). Several do O(orders × inventory) work via `inventory.find(...)` inside nested `orders[].lineItems[]` loops (e.g. lines 1058, 1109, 1690). Because state like `timeRange`, `revenueCurrency`, `reportsTab`, and two sort objects live in this same component, every tab switch, currency toggle, or sort click re-runs ALL aggregations for ALL tabs, not just the visible one. On a tenant with thousands of orders/movements this causes visible jank on each interaction.
- **Kanıt:** import React, { useState, useEffect } from 'react';   // line 8 — no useMemo
const salesByDate = orders.reduce(...)   // line 144, recomputed every render
const skus = Object.values(skuMap)...    // 1065, inside render, inv.find per lineItem (1058)
// grep 'useMemo' src/components/ReportsDashboard.tsx => 0 matches
- **Düzeltme:** Wrap the top-level derived datasets (salesByDate, trendData, categoryChartData, statusChartData, topCustomers, totalInventoryValueTRY, categoryValueData) in `useMemo` keyed on [orders]/[inventory]. For the per-tab IIFEs, gate computation by the active `reportsTab` (already partly done) and/or extract each tab into a child component so React skips inactive subtrees. Build an `inventory` lookup Map once per render instead of repeated `inventory.find` inside nested order loops.

### Orders table crashes if any order doc lacks customerName
- **Kategori:** react · **Dosya:** `src/pages/CRMPage.tsx` · orders filter, lines 462-465
- **Sorun:** The orders-tab filter calls `o.customerName.toLowerCase()` with no null guard, while the sibling fields use optional chaining (`o.shopifyOrderId?.`, `o.shippingAddress?.`). Data comes from PostgreSQL JSONB cast as `Order` via the dbClient shim, so the non-optional TS type is not enforced at runtime. A single order row with a missing/null customerName throws `Cannot read properties of undefined (reading 'toLowerCase')` and the entire orders table (whole IIFE) fails to render.
- **Kanıt:** const filtered = orders.filter(o =>
  o.customerName.toLowerCase().includes(orderSearch.toLowerCase()) ||
  o.shopifyOrderId?.toLowerCase().includes(orderSearch.toLowerCase()) ||
  o.shippingAddress?.toLowerCase().includes(orderSearch.toLowerCase())
);
- **Düzeltme:** Guard: `(o.customerName || '').toLowerCase().includes(...)`.

### order.totalPrice.toLocaleString crashes the row / PDF when totalPrice is absent
- **Kategori:** react · **Dosya:** `src/pages/CRMPage.tsx` · orders table cell line 516; also src/utils/pdf.ts:265
- **Sorun:** The orders table renders `order.totalPrice.toLocaleString('tr-TR', …)` and the statement PDF renders `o.totalPrice.toLocaleString(...)` with no fallback. CariEkstrePanel.tsx:154 proves the codebase knows totalPrice can be missing on real docs — it reads `Number(o.totalPrice ?? o.totalAmount ?? 0)`. An order lacking totalPrice (e.g. legacy/synced doc storing totalAmount instead) throws `Cannot read properties of undefined` and crashes the orders table render or the PDF generation.
- **Kanıt:** ₺{order.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}   // CRMPage.tsx:516
o.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 }),                                    // pdf.ts:265
- **Düzeltme:** Use the same coalescing pattern already used in CariEkstrePanel: `(order.totalPrice ?? order.totalAmount ?? 0).toLocaleString(...)`.

### Main data-load snapshot effect captures stale `currentLanguage` for low-stock notification text
- **Kategori:** react · **Dosya:** `src/App.tsx` · useEffect at line 2122-2275; listener body 2143-2165; deps line 2275
- **Sorun:** The mega snapshot effect runs onSnapshot for `inventory` and inside the listener composes a notification title/message from `currentLanguage` (lines 2158-2161). The effect's dependency array is `[user, userRole, isAuthReady]` — `currentLanguage` is NOT a dependency. The onSnapshot listener closure is created once when the effect runs and never re-subscribes when the user toggles language, so the listener keeps emitting notifications in whatever language was active at login. Same stale-closure issue affects `monthlyTargets`/`setMonthlyTarget` date logic but the language one has visible user impact.
- **Kanıt:** const unsubInventory = onSnapshot(query(collection(db, 'inventory'), where('companyId','==',companyId)), (snapshot) => {
  ...
  title: currentLanguage === 'tr' ? 'Düşük Stok Uyarısı' : 'Low Stock Alert',
  message: currentLanguage === 'tr' ? `${lowCount} ürün...` : `${lowCount} product(s)...`,
  ...
}, ...);
// }, [user, userRole, isAuthReady]);  (line 2275) — currentLanguage missing
- **Düzeltme:** Read the language at fire-time rather than from the closure (e.g. via a ref: `const langRef = useRef(currentLanguage); langRef.current = currentLanguage;` then use `langRef.current` inside the listener), or move notification composition out of the listener. Adding `currentLanguage` to the dep array would force tearing down/re-subscribing all ~18 listeners on every language toggle, which is worse — prefer the ref.

### Second Firestore listener (maliyetKalemleri) leaks — unsubscribe is never called
- **Kategori:** react · **Dosya:** `src/components/MaliyetMerkeziModule.tsx` · useEffect subscriptions (275-302)
- **Sorun:** unsub2 (the onSnapshot for maliyetKalemleri) is created inside a setTimeout and `return`ed from the timeout callback — that return value is discarded. The effect's own cleanup (lines 298-301) only calls unsub1() and clearTimeout(timer); it never calls unsub2. If the 200ms timer has already fired (the common case), the kalemler snapshot listener stays attached after unmount or when isAuthenticated changes, leaking listeners and firing setKalemler on an unmounted component. The effect deps also omit `t` / `addToast` used inside, but the dangling listener is the real bug.
- **Kanıt:** const timer = setTimeout(() => { const unsub2 = onSnapshot(...); return unsub2; }, 200);  // line 286 — return value lost
 return () => { unsub1(); clearTimeout(timer); };  // line 298 — unsub2 never invoked
- **Düzeltme:** Hoist a `let unsub2: (()=>void)|undefined;` in the effect, assign it inside the timeout (no inner return), and call `unsub2?.()` in the cleanup alongside clearTimeout.

### Email-verification gate is advisory only — unverified password accounts get full app + data access
- **Kategori:** security · **Dosya:** `src/App.tsx` · signup (2042-2078), verification banner (14618-14632)
- **Sorun:** handleEmailSignUp sends a verification email (line 2062) but nothing blocks an unverified user. The only consequence of `!user.emailVerified` is a dismissible amber banner at line 14618; the user proceeds through onAuthStateChanged → data-fetch effect (2122) → full module access with no verification check. Anyone can sign up with an email they don't own and immediately operate inside a (new) company tenant. Combined with the new-user role assignment at line 1863, an unverified self-signup auto-provisions an account.
- **Kanıt:** await sendEmailVerification(cred.user); // 2062, then nothing gates
{user && ... !user.emailVerified && (<div ...banner... />)} // 14618 — banner only, no return
- **Düzeltme:** If email verification is intended as a gate, add an early return rendering a "verify your email" screen when `providerId === 'password' && !user.emailVerified` (mirroring the MFA/auth early returns), and enforce verification server-side before serving /api/db data.

### QualityModule ignores isAuthenticated — all CRUD (add/edit/delete) exposed to unauthenticated users
- **Kategori:** security · **Dosya:** `src/components/QualityModule.tsx` · component signature line 107; Props line 104
- **Sorun:** The component declares isAuthenticated in its props but destructures only currentLanguage: `({ currentLanguage })`. isAuthenticated is never read, so the Add button, per-row Edit/Delete buttons, and the save/delete handlers are always rendered and callable regardless of auth state. Compare ProductionModule and MRPModule which gate their mutating UI on isAuthenticated. Client gating is not the real security boundary, but the inconsistency means QC/complaint/audit/FMEA records can be created/edited/deleted from the UI when other modules would hide those controls.
- **Kanıt:** const QualityModule: React.FC<QualityModuleProps> = ({ currentLanguage }) => {  // isAuthenticated dropped
...
interface QualityModuleProps { currentLanguage: 'tr' | 'en'; isAuthenticated: boolean; }
- **Düzeltme:** Destructure isAuthenticated and gate the Add button and row action buttons (and ideally the save/delete handlers) on it, matching ProductionModule.

### CSP allows 'unsafe-inline' in script-src, negating CSP's XSS mitigation
- **Kategori:** security · **Dosya:** `server.ts` · helmet contentSecurityPolicy directives, line 1803
- **Sorun:** The production CSP scriptSrc includes 'unsafe-inline'. With unsafe-inline enabled, any injected inline <script> or inline event handler executes, so the CSP provides no meaningful protection against reflected/stored XSS — the primary thing script-src CSP is meant to stop. Given this is a multi-tenant ERP rendering user/tenant-supplied data, that is the exact threat CSP should harden against.
- **Kanıt:** scriptSrc: ["'self'", "'unsafe-inline'", 'https://apis.google.com', 'https://www.gstatic.com', 'https://accounts.google.com'],
- **Düzeltme:** Drop 'unsafe-inline' from scriptSrc and adopt nonce- or hash-based inline script allowance (helmet supports generating a per-response nonce). If the bundled React app emits no inline scripts, removing 'unsafe-inline' may be sufficient with no nonce needed.

### getMfaStatus fails open — network/parse error treats session as verified
- **Kategori:** security · **Dosya:** `src/lib/mfa.ts` · getMfaStatus 27-33 (consumed in App.tsx 1834-1835)
- **Sorun:** getMfaStatus returns `{ enabled: false, verified: true }` on a non-ok response or any thrown error. The App.tsx caller additionally swallows errors entirely (`catch { /* status alınamazsa engelleme */ }` at 1836, comment literally says 'if status can't be fetched, don't block'). Combined, a user with 2FA enabled who hits a transient /api/mfa error (or simply blocks the request) is treated as verified and mfaChallenge stays false — the 2FA gate is bypassable by inducing a request failure. Security controls should fail closed.
- **Kanıt:** // mfa.ts
if (!res.ok) return { enabled: false, verified: true };
...
} catch { return { enabled: false, verified: true }; }
// App.tsx 1836
} catch { /* status alınamazsa engelleme */ }
- **Düzeltme:** On error, fail closed: if the user previously/possibly has 2FA, treat as unverified and block, or surface a hard error rather than defaulting verified:true. The server must in any case enforce 2FA independently of this client status call.

### HTML injection in order-notification email (unescaped customerName/status/orderNo)
- **Kategori:** security · **Dosya:** `server.ts` · app.post('/api/email/order-notification') lines 5274-5331
- **Sorun:** customerName, status, and orderNo come straight from req.body and are interpolated into the email HTML template with no escaping. An escapeHtml() helper exists (line 163) specifically 'for tenant-sourced text embedded in outbound email HTML' and is used in the payment-link email (lines 6833-6843), but this handler does not use it. status falls through to `lbl = { tr: status, en: status }` when unknown, so an arbitrary status string is rendered raw; customerName is rendered raw at line 5305. This allows injecting arbitrary markup/links (phishing, content spoofing) into branded Cetpa emails.
- **Kanıt:** const lbl = statusLabel[status] ?? { tr: status, en: status, color: '#6b7280' };
...
<p ...>${tr ? `Sayın ${customerName},` : `Dear ${customerName},`}</p>
...
<p ...>#${orderNo ?? orderId.slice(0, 8).toUpperCase()}</p>
- **Düzeltme:** Wrap each interpolated dynamic value in escapeHtml(): escapeHtml(customerName), escapeHtml(orderNo), and escapeHtml(status) (or only render from the known statusLabel map). Same treatment for any tenant-sourced field rendered into email HTML.

### SSRF / token exfiltration via Shopify storeUrl host normalization bypass
- **Kategori:** security · **Dosya:** `server.ts` · app.post('/api/shopify/sync') lines 2305-2353
- **Sorun:** storeDomain is taken from body.storeUrl (user-controlled). Normalization only appends '.myshopify.com' when the string does NOT already include 'myshopify.com' (line 2328). A value like 'evil.com#.myshopify.com' or 'evil.com/x?=.myshopify.com' passes the includes() check unchanged, so the server fetches https://evil.com#.myshopify.com/admin/api/... — sending the X-Shopify-Access-Token header (which can also be supplied as body.accessToken, but env token leaks here) to an attacker-controlled host. Also enables SSRF to internal hosts that contain the substring.
- **Kanıt:** let storeDomain = body.storeUrl || process.env.SHOPIFY_STORE_DOMAIN || ...;
storeDomain = storeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
...
} else if (!storeDomain.includes('myshopify.com')) { storeDomain = `${storeDomain}.myshopify.com`; }
...
await fetch(`https://${storeDomain}/admin/api/2024-01/products.json?limit=50`, { headers });
- **Düzeltme:** Validate storeDomain against a strict regex like /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/ (anchored) after stripping scheme/path, rather than a substring includes() check. Reject anything containing '#', '/', '@', ':' or not matching the canonical *.myshopify.com pattern.


## ⚪ LOW

### Customer revenue/portfolio analysis aggregates by customerName, merging distinct customers
- **Kategori:** correctness · **Dosya:** `src/pages/CRMPage.tsx` · custRevMap build, lines 2691-2697
- **Sorun:** The Customer Portfolio Analysis keys revenue and order counts by `o.customerName` rather than a stable id. Two different leads/customers that share a display name (common for company branches or generic names) are silently merged into one row, inflating that name's revenue, order count and Pareto share, and distorting the 80/20 figure. Orders with an undefined customerName collapse into a single phantom row.
- **Kanıt:** orders.filter(o=>o.status!=='Cancelled').forEach(o=>{
  if(!custRevMap[o.customerName]) custRevMap[o.customerName]={revenue:0,orderCount:0,customerType:o.customerType||'Retail'};
  custRevMap[o.customerName].revenue += o.totalPrice||0;
  custRevMap[o.customerName].orderCount++;
});
- **Düzeltme:** Aggregate by leadId (fall back to a normalized customerName only when no leadId), and display the name as a label.

### Logout for real (non-guest) users does not await signOut and does not clear local app state
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · handleLogout (2111-2119)
- **Sorun:** In the non-guest branch, `signOut(auth)` is called without await and its rejection is unhandled. More importantly, unlike the guest branch (which clears state), the real branch relies entirely on onAuthStateChanged firing to reset state. Until that callback runs, in-memory data (leads/orders/etc.) and `mfaChallenge`/`userRole` remain set. There is no explicit reset of sensitive client state on logout, and a rejected signOut leaves the user silently still logged in with no error shown.
- **Kanıt:** } else {
  signOut(auth); // not awaited, no .catch, no state reset
}
- **Düzeltme:** Make handleLogout async, `await signOut(auth)` in a try/catch with a user-visible error on failure, and proactively clear sensitive state (or let the onAuthStateChanged null-user path do a comprehensive reset).

### Money formatted/aggregated with floating-point and no rounding to currency precision
- **Kategori:** correctness · **Dosya:** `src/components/DealerCommissionPanel.tsx` · commissionEarned line 210; totals lines 226-227; FX conversion lines 232-233
- **Sorun:** commissionEarned = actualSales * (effectiveRate/100) and the totals/FX conversions (`/ rate`) are raw JS floats never rounded to 2 decimals; they are only masked at render time via toLocaleString(maximumFractionDigits:0). The unrounded values feed the totals row (lines 488,490) and could be persisted/compared elsewhere, accumulating sub-cent drift across many dealers. The same float-then-divide-by-FX pattern is used for credit/quote totals in B2BPortal (lines 333,355,404,529-530).
- **Kanıt:** const commissionEarned = actualSales * (effectiveRate / 100);  // no Math.round to 2dp
- **Düzeltme:** Round monetary results to 2 decimals (e.g. Math.round(x*100)/100) at computation time before summing/displaying.

### Several deletes/writes run without try/catch -> silent unhandled rejections
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · handleDeleteSupplier L779; workflowTasks toggle L6249; letterOfCredit/productionOrders/warranties status selects L6964/L12157/L13735; projectTimelines slider L11859
- **Sorun:** These writes are confirmed/intended but their promises are not awaited inside a try/catch (or not awaited at all), so a failed server write produces an unhandled rejection and the optimistic local state silently diverges from the server with no user feedback. handleDeleteSupplier does confirm() (good) but the deleteDoc at L779 is unguarded.
- **Kanıt:** App.tsx L779: await deleteDoc(doc(db,'suppliers',id)); // outside any try/catch in handleDeleteSupplier. L6249: onClick={async ()=>{try{await updateDoc(...)}catch(e){console.error('[firestore]',e);}}} logs but shows no toast.
- **Düzeltme:** Wrap each in try/catch and show an error toast on failure so optimistic UI is reconciled; at minimum surface failures to the user rather than only console.error.

### backoffMs overflows to Infinity for large attempt counts, stranding jobs permanently as 'queued'
- **Kategori:** correctness · **Dosya:** `src/services/syncRetryService.ts` · backoffMs (lines 41-44) used at line 152
- **Sorun:** backoffMs = Math.pow(2, attempts) * 30_000. enqueueSyncJob accepts an arbitrary job.maxAttempts, so attempts can grow large. Once Math.pow(2, attempts) overflows, nextRetryAt = Date.now() + Infinity = Infinity, and the nextRetryAt<=now query (line 102) never matches again — the job sits forever as 'queued' instead of being marked 'dead'. Even pre-overflow, attempts in the 20s yields backoffs of weeks. Default maxAttempts=5 keeps it bounded, but there is no cap.
- **Kanıt:** function backoffMs(attempts: number): number {
  return Math.pow(2, attempts) * 30_000;
}
...
nextRetryAt: Date.now() + backoffMs(newAttempts),
- **Düzeltme:** Cap the backoff, e.g. Math.min(Math.pow(2, attempts) * 30_000, 60 * 60_000) (1h ceiling), so retries stay schedulable regardless of attempt count.

### getSyncQueueStats.lastSuccess is an arbitrary success doc, not the most recent
- **Kategori:** correctness · **Dosya:** `src/services/syncRetryService.ts` · getSyncQueueStats, lines 175-190
- **Sorun:** The 'success' query uses limit(1) with no orderBy, so successSnap.docs[0] is an arbitrary success job, not the latest. lastSuccess (its updatedAt) is therefore misleading — it can report an old timestamp while newer successes exist.
- **Kanıt:** getDocs(query(col, where('status', '==', 'success'), limit(1)))
...
const lastSuccessDoc = successSnap.docs[0]?.data() as SyncJob | undefined;
return { ... lastSuccess: lastSuccessDoc?.updatedAt ?? null };
- **Düzeltme:** Add orderBy('updatedAt','desc') before limit(1) so the single fetched doc is genuinely the most recent success.

### No global unhandledRejection/uncaughtException handler; cron fire-and-forget rejections are unguarded
- **Kategori:** correctness · **Dosya:** `server.ts` · process handlers (only SIGTERM at 7185); cron at 1518/1560
- **Sorun:** There is no process.on('unhandledRejection') or 'uncaughtException' handler anywhere (only a SIGTERM handler at line 7185). The cron fires mirror writes as `void mirrorMikroStoklar(stoklar)` / `void mirrorMikroCariler(cariler)` (lines 1518, 1560) without awaiting or catching at the call site. mirrorMikroStoklar/Cariler do wrap their bodies in try/catch (lines 876/924, 930) so today they don't reject — but the pattern is fragile: any future early throw (e.g. before the try, or a synchronous throw building the query) becomes an unhandled rejection that, under Node's default, can crash the long-lived server process and kill all crons. Cron callbacks themselves are wrapped in try/catch (good), but there is no last-resort net.
- **Kanıt:** void mirrorMikroStoklar(stoklar);   // line 1518 — no .catch
void mirrorMikroCariler(cariler);   // line 1560 — no .catch
// grep: only process.on('SIGTERM', ...) at 7185; no unhandledRejection handler
- **Düzeltme:** Add `process.on('unhandledRejection', err => console.error(...))` and `process.on('uncaughtException', ...)` at boot, and attach `.catch()` to the fire-and-forget mirror calls.

### SPA catch-all serves index.html (HTTP 200 HTML) for unmatched /api/* routes instead of a JSON 404
- **Kategori:** correctness · **Dosya:** `server.ts` · static/SPA fallback lines 7168-7177
- **Sorun:** The production catch-all only 404s for asset-looking paths (/assets/ or .js/.css/.map/.woff). Every other unmatched path — including any unmatched /api/... endpoint — falls through to res.sendFile(index.html) with status 200. So a request to a mistyped or removed API route (e.g. GET /api/does-not-exist) returns the SPA HTML with a 200, not a JSON 404. Clients/fetch code expecting JSON get HTML, masking routing bugs and making API errors hard to detect; it also means the API surface has no canonical 404.
- **Kanıt:** app.use((req, res) => { if (req.path.startsWith('/assets/') || /\.(js|css|map|woff2?)$/.test(req.path)) { res.status(404)...; return; } res.sendFile(path.join(distPath, 'index.html')); });
- **Düzeltme:** Before the SPA fallback, add: if (req.path.startsWith('/api/')) { res.status(404).json({ error: 'Not found' }); return; } so unmatched API routes return JSON 404 and only genuine app routes get index.html.

### Cost-center 'gerceklesen' (actual spend) includes unapproved expense items
- **Kategori:** correctness · **Dosya:** `src/components/MaliyetMerkeziModule.tsx` · merkezlerWithActual (305-308), deptChartData (460), kategoriTotals (467), sapmaData (476-480)
- **Sorun:** Every spend rollup sums k.tutar with no filter on k.onaylandi. The module has an explicit approval workflow (onaylandi flag, toggleOnay, Onayla/Onay Kaldır UI), implying only approved expenses should count against budget. Because unapproved/draft items are included, budget-usage %, 'Bütçe Aşımı' status, and variance analysis can show a center as over budget purely from pending/unapproved entries. If the intent is that approval gates budget consumption, this is a logic error; at minimum it is inconsistent with having an approval flag that affects nothing financial.
- **Kanıt:** gerceklesen: kalemler.filter(k => k.merkezId === m.id).reduce((sum, k) => sum + k.tutar, 0)  // line 307 — no `&& k.onaylandi`
- **Düzeltme:** Decide the policy: if approval should gate spend, add `&& k.onaylandi` to the actual-spend reducers (line 307 and the analysis aggregations), or surface approved-vs-pending totals separately.

### Null/undefined numeric fields crash row rendering (.toLocaleString on possibly-missing values)
- **Kategori:** correctness · **Dosya:** `src/components/HRModule.tsx` · employees table (513); payroll table (643-646); travel table (990)
- **Sorun:** Rows call `.toLocaleString()` directly on emp.salary (513), p.baseSalary/p.bonus/p.deduction/p.netSalary (643-646), and req.advanceAmount (990) with no null-guard. Documents created outside the HR forms (legacy/imported data, Mikro/Parasut sync, or older schema rows lacking these fields) will have undefined here, throwing 'Cannot read properties of undefined (reading toLocaleString)' and white-screening the whole tab via the .map render. The same pattern was previously a documented bug class in this codebase (MEMORY: 'item.price?.toLocaleString()' fixes).
- **Kanıt:** <td className="py-3 px-5 text-right font-medium">₺{emp.salary.toLocaleString()}</td>  // line 513 — emp.salary may be undefined; same for p.baseSalary etc. (643-646), req.advanceAmount (990)
- **Düzeltme:** Null-coalesce before formatting, e.g. `(emp.salary ?? 0).toLocaleString()` and likewise for baseSalary, bonus, deduction, netSalary, advanceAmount.

### Inconsistent FX fallback rates across modules (P&L uses 38/41, global/Bilanço use 32/35)
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · fmtKpi line 677-678 (32/35); P&L line 7287-7288 (38/41); Bilanço line 7622 (32/35); dashboard loader line 1048 (38)
- **Sorun:** When exchangeRates is null (initial render before the fetch resolves), each module hardcodes a different fallback. fmtKpi and the Balance Sheet (Phase 547) assume USD=32, EUR=35; the P&L (Phase 143/563) assumes USD=38, EUR=41. So during the pre-load window the same TRY revenue converts to materially different USD/EUR figures depending on which tab is open (a ~16-19% discrepancy on USD). It self-corrects once rates load, but any screenshot/print taken before load, or a permanently-failing rate fetch, shows internally inconsistent currency conversions.
- **Kanıt:** // fmtKpi:
const usd = exchangeRates?.USD ?? 32; const eur = exchangeRates?.EUR ?? 35;
// P&L:
const pnlUsd = exchangeRates?.USD ?? 38; const pnlEur = exchangeRates?.EUR ?? 41;
// Bilanço:
const usd547 = exchangeRates?.USD ?? 32; const eur547 = exchangeRates?.EUR ?? 35;
- **Düzeltme:** Define one shared fallback constant (e.g. FX_FALLBACK = {USD:38, EUR:41}) and reference it everywhere, or render '—'/a spinner until exchangeRates is non-null instead of converting with a guessed rate.

### getToken() auth-state race can resolve a stale/null user under sign-out timing
- **Kategori:** correctness · **Dosya:** `src/lib/dbClient.ts` · getToken() lines 212-221
- **Sorun:** When `auth.currentUser` is null, getToken subscribes to onAuthStateChanged, immediately unsubscribes on the first callback, and resolves with whatever user that first emission carries (line 215-218). During a logout-then-login transition the first emission may be the null (sign-out) event, throwing 'not authenticated' and aborting an in-flight write/stream connect even though a new user is about to be present; conversely a write queued before sign-out can resolve against the new user's token. There is no guard binding the resolved token to the originally intended uid. Lower severity because it surfaces as transient failures rather than data leakage, but it compounds the user-switch issues above.
- **Kanıt:** let u = auth.currentUser;
if (!u) {
  u = await new Promise(resolve => {
    const off = auth.onAuthStateChanged(usr => { off(); resolve(usr); }); // first emission wins
  });
}
if (!u) throw new Error('dbClient: not authenticated');
- **Düzeltme:** Resolve against a stable current-user reference and re-check auth.currentUser after the await; deduplicate concurrent getToken calls; cancel/abort in-flight requests on auth-state change rather than letting them bind to a new identity.

### Budget edit field always shows/saves TRY with hardcoded ₺ symbol while summary shows selected currency
- **Kategori:** correctness · **Dosya:** `src/App.tsx` · butce tab, lines 6745-6761 (input) vs 6691-6726 (currency toggle + fmtButce)
- **Sorun:** In the Budget Plan tab the user can toggle butceCurrency to USD/EUR (summary cards and per-dept actual/over labels then convert via fmtButce, lines 6720/6725/6776/6780). But the per-department budget input keeps a hardcoded `₺` prefix (line 6745), shows the raw TRY value `String(budget)` (line 6748), and saves the typed value directly as `budgetTRY: val` (line 6754) with no inverse conversion. While viewing in USD/EUR, the edit box shows e.g. `₺500000` next to a card reading `$13,158`. Data integrity is preserved (storage is always TRY), but the mixed-currency display is misleading and a user could mistakenly type a USD figure into a TRY field.
- **Kanıt:** <span className="absolute left-2 ...">₺</span>
<input type="number" value={budgetDraft[dept.key] ?? String(budget)} ... onBlur={() => { const val = Number(budgetDraft[dept.key]); if (!isNaN(val) && val >= 0) { ... updated.push({ dept: dept.key, budgetTRY: val }); ...
- **Düzeltme:** Either disable budget editing when butceCurrency !== 'TRY', or convert the displayed value (budget / butceRate) and the symbol to match butceCurrency, then multiply back by butceRate before storing as budgetTRY.

### FMEA/PFMEA/CTPAT/Kaizen/5S/8D seed defaults render before snapshot, can be silently overwritten or duplicated
- **Kategori:** data-integrity · **Dosya:** `src/components/QualityModule.tsx` · useState seeds lines 137-162; onSnapshot setters lines 262-279
- **Sorun:** These six lists are initialized with hardcoded mock records (ids '1','2','3'). The onSnapshot subscriptions later replace state with Firestore docs. Until the (staggered up to 800ms) snapshot fires, the UI shows fake records with id '1'/'2'/'3'; editing/deleting one of these before the snapshot arrives issues updateDoc/deleteDoc against doc ids '1'/'2' that almost certainly don't exist in the backing store (deleteDoc no-ops or errors, update may create/miss). This is a confusing CRUD-on-phantom-records hazard distinct from the QC/complaints/audit lists which correctly start empty.
- **Kanıt:** const [fmeaRecords, setFmeaRecords] = useState<FMEARecord[]>([{ id: '1', process: 'Montaj', ... }, { id: '2', ... }, { id: '3', ... }]);
- **Düzeltme:** Initialize these arrays to [] like qcRecords/complaints/auditItems, or render a loading state until the first snapshot resolves.

### autoNotify effect reads stale `currentLanguage` with exhaustive-deps suppressed
- **Kategori:** react · **Dosya:** `src/App.tsx` · useEffect line 1110-1194; lang read line 1149; deps line 1194
- **Sorun:** The auto-notification effect's inner `run()` reads `const lang = currentLanguage` (line 1149) to build all notification copy, but `currentLanguage` is omitted from the dependency array and the lint rule is explicitly disabled (line 1193). Because the effect is also gated by a once-per-day sessionStorage key (line 1113-1115) and an hourly throttle, in practice it fires at most once with whatever language was current at first qualifying render, so notifications can be written in the wrong language after a language switch. Lower impact than the snapshot case because it self-throttles to once/day.
- **Kanıt:** const run = async () => {
  const lang = currentLanguage;
  ...
};
run();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user, inventory, orders]);
- **Düzeltme:** Pull the language from a ref at call time, or accept that this is fire-once-per-day and document that notification language follows login language. The eslint-disable hides the real omission — at minimum read currentLanguage via a ref.

### darkMode effect writes to Firestore on every value sync, racing the userPrefs listener
- **Kategori:** react · **Dosya:** `src/App.tsx` · write effect lines 500-505; reader listener lines 2231-2238
- **Sorun:** The darkMode effect (500-505) writes `setDoc(userPrefs/{uid}, {darkMode}, {merge:true})` whenever `darkMode` changes. The userPrefs onSnapshot listener (line 2231-2238) calls `setDarkMode(d.darkMode)` from the server doc. On login the listener pushes the stored value into state, which re-runs the write effect and writes the same value straight back. It is NOT an infinite loop (React bails when the boolean is unchanged, so no re-render → no re-fire), but it does produce a redundant Firestore write on every login and on every remote prefs change, and a self-echo write each time the user toggles. The write also fires even before auth is ready (guarded only by `auth.currentUser?.uid`).
- **Kanıt:** React.useEffect(() => {
  const html = document.documentElement;
  if (darkMode) { html.classList.add('dark'); } else { html.classList.remove('dark'); }
  const uid = auth.currentUser?.uid;
  if (uid) setDoc(doc(db, 'userPrefs', uid), { darkMode }, { merge: true }).catch(() => {});
}, [darkMode]);
- **Düzeltme:** Separate the DOM-class side effect (keep on [darkMode]) from persistence; only persist on an explicit user toggle handler rather than on every darkMode state change, or guard the write with a ref that suppresses the first sync-driven value coming from the listener.

### Components `KpiCurrencyToggle` and `DeltaBadge` defined inside AppContent render scope
- **Kategori:** react · **Dosya:** `src/App.tsx` · KpiCurrencyToggle def 686-695; DeltaBadge def 4255-4263
- **Sorun:** `KpiCurrencyToggle` (line 686) is declared in the AppContent body and `DeltaBadge` (line 4255) is declared inside an IIFE in JSX; both are rendered as JSX elements (`<KpiCurrencyToggle />` at 9653/10908/12769, `<DeltaBadge .../>` at 4277). Each render gives them a new function identity, so React unmounts/remounts the subtree every parent render instead of reconciling. Both are stateless leaf components (no internal state, no inputs that lose focus), so the only cost is wasted reconciliation — no data-loss bug. Worth noting because the codebase already hit the real version of this bug with `FxInput` and hoisted it to module scope with an explicit comment (lines 455-460), making these two inconsistent leftovers.
- **Kanıt:** const KpiCurrencyToggle = () => ( ... )  // line 686, inside AppContent
... <KpiCurrencyToggle />  // 9653, 10908, 12769
// compare module-scope FxInput at 457 with comment: "render içinde tanımlanırsa her tuşta yeniden mount olur"
- **Düzeltme:** Hoist both to module scope alongside FxInput, passing needed values (kpiCurrency/setKpiCurrency) as props. Harmless today since they are stateless, but consistent with the existing FxInput fix.

### Shopify sync error leaks environment variable key names to the client
- **Kategori:** security · **Dosya:** `server.ts` · /api/shopify/sync, lines 2311-2314
- **Sorun:** When the access token is missing, the 400 response enumerates every process.env key containing 'SHOPIFY' and returns them to the caller. This discloses server env var naming/structure (e.g. presence of VITE_SHOPIFY_ACCESS_TOKEN, SHOPIFY_API_KEY) to any authenticated user, aiding reconnaissance.
- **Kanıt:** const shopifyKeys = Object.keys(process.env).filter(k => k.includes('SHOPIFY'));
return res.status(400).json({ error: `Shopify Access Token missing. Please set SHOPIFY_ACCESS_TOKEN in secrets. Found keys: ${shopifyKeys.join(', ')}` });
- **Düzeltme:** Return a generic 'Shopify access token not configured' message; log the available keys server-side only.

### No global Express error-handler; unhandled/body-parser errors fall to Express default handler
- **Kategori:** security · **Dosya:** `server.ts` · no (err,req,res,next) middleware anywhere; body parser express.json() line 2296; listen at 7180
- **Sorun:** There is no Express error-handling middleware (no 4-arg (err,req,res,next) handler) registered anywhere in server.ts. Most routes wrap logic in try/catch (good), but errors thrown by body parsing (e.g. malformed JSON, payload exceeding the express.json limit) and any route paths without try/catch are handled by Express's built-in default error handler. That handler includes the error stack in the response body when NODE_ENV !== 'production'. In production the stack is suppressed, so the leak risk is limited to misconfigured/non-prod deployments, but the absence of a centralized handler also means parser errors return Express's default HTML rather than the app's generic JSON shape.
- **Kanıt:** app.use(express.json({ verify: (req,_res,buf)=>{ req.rawBody = buf; } }));  // no { limit } override here, and no app.use((err,req,res,next)=>{...}) registered before app.listen
- **Düzeltme:** Add a final error-handling middleware before app.listen that logs the error server-side and returns a generic JSON 500 (never the stack), e.g. app.use((err,_req,res,_next)=>{ console.error(err); res.status(err.status||500).json({ error: 'Sunucu hatası.' }); }); ensure it is registered after all routes.

### HTML injection in admin invite email (unescaped role)
- **Kategori:** security · **Dosya:** `server.ts` · app.post('/api/admin/invite') lines 5347-5403
- **Sorun:** The role value from req.body is interpolated raw into the invite email HTML at line 5391. Defaults to 'Sales' but no validation against allowed roles; an attacker (admin-gated via requireAdmin, so lower severity) can inject markup into the invite email body. Inconsistent with the existing escapeHtml() helper used elsewhere.
- **Kanıt:** const { email, role = 'Sales' } = req.body as { email: string; role?: string };
...
CETPA B2B platformuna <strong>${role}</strong> rolüyle davet edildiniz.
- **Düzeltme:** Validate role against an enum of known roles, or escapeHtml(role) before interpolation.

### Settings-controlled ERP base URLs fetched server-side without host validation (SSRF)
- **Kategori:** security · **Dosya:** `server.ts` · getLucaCreds() lines 5612-5623 and fetch(`${creds.baseUrl}/v1/company`) line 5685; same pattern for Parasut PARASUT_BASE / iyzico baseUrl
- **Sorun:** baseUrl for Luca (and analogously iyzico/Parasut) is read from settings/luca doc (d.baseUrl) which is writable through the generic /api/db settings API. The server then issues authenticated fetches to `${creds.baseUrl}/...`, attaching the API key in headers (lucaHeaders). A user who can write the settings doc can point baseUrl at an internal host or attacker host and exfiltrate the configured API key / probe internal services. Lower severity because, per project notes, these creds are intended to be deployment-level/global and writing them may be restricted, but there is no host validation in code.
- **Kanıt:** const baseUrl = process.env.LUCA_BASE_URL || 'https://api.luca.com.tr';
...
return { apiKey: d.apiKey, companyId: d.companyId, baseUrl: d.baseUrl || 'https://api.luca.com.tr' };
...
const r = await fetch(`${creds.baseUrl}/v1/company`, { headers: lucaHeaders(creds), ... });
- **Düzeltme:** Pin integration base URLs to env-only (ignore client-supplied baseUrl), or validate against an allow-list of known provider hostnames before fetching. Do not let a settings document override the outbound host that receives secret API keys.
