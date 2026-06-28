# Kapsanmayan Modüller — Adversarial Review (2026-06-28)

İlk turda doğrudan taranmayan modüller. **54 bulgu** (3 critical, 18 high, 24 medium, 9 low). Bulucu-raporlu (doğrulama aşaması limite takıldı).


## 🔴 CRITICAL

### EBelgeMerkezi.tsx — settings/gib bağlantı durumu tüm kiracılar arasında paylaşılan TEK global doküman — çapraz-kiracı sızıntı/kontrol
`src/components/EBelgeMerkezi.tsx` · 122-140 (okuma/yazma) ; server.ts:474 (PER_COMPANY_SETTINGS), 2170, 2148-2153 (injectTenant), 2154-2166 (ownsDoc), 2082 (SSE filtresi) · multi-tenant
- Bileşen GIB bağlantı durumunu settings/gib dokümanında tutuyor: onSnapshot(doc(db,'settings','gib')) ile okuyor (122) ve toggleGib setDoc(doc(db,'settings','gib'),...) ile yazıyor (136). Sunucuda 'settings' koleksiyonu TENANT_COLLECTIONS içinde DEĞİL ve 'gib' anahtarı PER_COMPANY_SETTINGS={'app','erpHub','workingCapital','companyProfile'} içinde DEĞİL. Bu yüzden: settingsRealId 'gib' için perCompany=false ve realId='gib' döner (server.ts:2169-2175) → namespacing yok, id sabit 'gib'. injectTenant settings için companyId enjekte etmez (server.ts:2150 yalnız TENANT_COLLECTIONS). ownsDoc settings için TENANT/USER_SCOPED olmadığından son satırda return true ile her zaman sahiplik verir (server.ts:2156-2166). Sonuç: tüm firmalar aynı tek 'gib' dokümanını paylaşır; Firma A'nın GIB'i bağlama/kesmesi Firma B için de durumu değiştirir.
- **Düzeltme:** 'gib' anahtarını server.ts:474 PER_COMPANY_SETTINGS setine ekleyin; böylece realId `${cid}__gib` olur, companyId enjekte edilir (server.ts:2207) ve SSE firma filtresi (2082/2099) çalışır. Aksi halde GIB entegrasyon durumu firmalar arası global kalır.

### HoldingModule.tsx — Consolidation sums mixed-currency balances as raw TRY (no FX conversion)
`src/components/HoldingModule.tsx` · lines 135-141, 153-158, 447-454 · currency
- The consolidation useMemo groups GL accounts by `${a.type}||${a.code}||${a.name}` and accumulates `map[key].balance += a.balance * ownershipFactor` with no exchange-rate conversion. Accounts carry per-account `currency` (USD/EUR/GBP/TRY supported in the Add-Account modal, lines 614-616), and entities have their own `currency`. A subsidiary whose books are in USD or EUR is added to TRY books at face value. `map[key].currency` is set to whichever account is seen first (line 139), so the grouped currency label is also arbitrary. The four metric cards then render the totals via `fmt(m.value)` which defaults to currency='TRY' (lines 61-62, 454). There is no use of exchangeRates anywhere in the file.
- **Düzeltme:** Convert each account balance to the holding presentation currency using exchangeRates before summing (e.g. balance * rate(a.currency -> 'TRY')). Group/aggregate only after normalization, and label totals with the actual presentation currency.

### HoldingModule.tsx — Intercompany elimination loop is an empty no-op
`src/components/HoldingModule.tsx` · lines 142-145 · correctness
- The block that is supposed to remove eliminated intercompany balances from the consolidated figures iterates over eliminated transactions but the forEach body is empty (only a comment). Consequently toggling a transaction to 'Eliminated' has zero effect on consolidated Assets, Liabilities, Revenue, or Net Income. The core purpose of a consolidation module — eliminating intercompany receivables/payables and intercompany revenue/expense (loans, trade, dividends, management fees) — is not implemented. Consolidated totals are overstated by the full amount of every intercompany transaction.
- **Düzeltme:** Implement the elimination: for each eliminated IC, reduce consolidated assets (receivable) and liabilities (payable) by the converted amount, and for trade/management_fee/dividend reduce both revenue and expense (or revenue and equity for dividends). Convert ic.amount via exchangeRates first.


## 🟠 HIGH

### CPQPanel.tsx — CPQ price summary breakdown never reconciles with charged unit price (multiplier hidden)
`src/components/CPQPanel.tsx` · calcConfiguredPrice L84-95; price summary L455-483 · correctness
- calcConfiguredPrice applies BOTH priceDelta and priceMultiplier per option (price += delta; price *= multiplier). The Price Summary UI only renders base price plus each option's priceDelta (L460-471) and then displays configuredPrice as 'Birim Fiyat'. Any option with priceMultiplier != 1 makes the listed line items NOT sum to the displayed unit price, with no row explaining the difference. The customer-facing quote line items therefore silently disagree with the total.
- **Düzeltme:** Render an explicit multiplier row (e.g. '×1.20 → +₺X') for each option with priceMultiplier !== 1, or compute and show the per-attribute applied amount so the breakdown sums to configuredPrice.

### CPQPanel.tsx — CPQ configured price is order-dependent: multiplier compounds earlier attributes' deltas
`src/components/CPQPanel.tsx` · calcConfiguredPrice L86-93 · correctness
- The loop does `price += option.priceDelta; price *= option.priceMultiplier;` sequentially over template.attributes. A multiplier on a later attribute multiplies the running total including earlier attributes' deltas AND earlier multipliers. The final price depends on attribute ordering in the template array and on which options carry deltas vs multipliers — reordering attributes changes the quoted price for the same selection. This is almost never the intended pricing semantics (delta and percent surcharges should be commutative).
- **Düzeltme:** Separate concerns: sum all deltas first, then apply the product of all multipliers once: `price = (base + sumDeltas) * prodMultipliers`. Or define and document a single deterministic rule.

### CPQPanel.tsx — CPQ ignores template.currency — multi-currency quotes summed and formatted as TRY
`src/components/CPQPanel.tsx` · currency field L48/194; fmtTRY L256; createQuote total L233; cart total L540 · currency
- ProductTemplate carries a `currency` field (default 'TRY') but it is never read in pricing or display. fmtTRY always prepends ₺ and createQuote does `cartItems.reduce((s,i)=>s+i.totalPrice,0)` with no conversion. A template priced in USD/EUR is shown and summed as if it were TRY, and a cart mixing currencies produces a meaningless total. No exchangeRates conversion is applied.
- **Düzeltme:** Either drop the currency field, or convert each item to a base currency via exchangeRates before summing and format with the actual currency symbol; block mixing currencies in one quote.

### EBelgeMerkezi.tsx — SSE yayını settings/gib için tüm kiracılara sızıyor
`src/components/EBelgeMerkezi.tsx` · 122-133 ; server.ts:2082, 2099 · multi-tenant
- settings/gib dokümanına companyId yazılmadığı için SSE izolasyon filtresi data.companyId'yi boş görür: server.ts:2082 'if (coll===settings) { const dc=data.companyId; return !dc || dc===streamCid; }' — dc undefined olduğundan !dc=true → değişiklik tüm bağlı kiracı stream'lerine yayınlanır. Bir firmanın toggleGib'i diğer tüm firmaların onSnapshot dinleyicisini (122) tetikler ve gibConnected/gibLastCheck UI'ını canlı değiştirir.
- **Düzeltme:** Üstteki düzeltme (gib'i PER_COMPANY_SETTINGS'e ekleme) companyId'yi enjekte ederek bu yayını da firma-bazlı kapatır.

### HoldingModule.tsx — Account-type sign convention defined but never applied; balance-sheet identity not enforced
`src/components/HoldingModule.tsx` · lines 53-59, 140, 153-158 · correctness
- ACCOUNT_TYPES declares a `sign` (asset/revenue=+1, liability/equity/expense=-1) clearly intended to normalize natural balances, but consolidation adds raw `a.balance` (line 140) and every total is a plain `reduce((s,a)=>s+a.balance,0)` (lines 153-157). The sign field is dead code. As a result there is no guarantee or check that Assets = Liabilities + Equity + NetIncome; the two balance-sheet panel numbers are just independent sums of whatever sign the user happened to type into the Balance field. A liability entered as a positive number inflates 'Total Liabilities' as a positive, and the balance sheet will not balance.
- **Düzeltme:** Apply the type sign when normalizing balances, and add a balance-check (Assets - (Liabilities+Equity+NetIncome)) surfaced to the user when non-zero.

### HoldingModule.tsx — Intercompany receivable/payable totals sum across currencies, mislabeled with entity currency
`src/components/HoldingModule.tsx` · lines 162-173, 284-285 · currency
- icByEntity sums `ic.amount` into receivable/payable per entity with no regard for ic.currency (IC transactions can be TRY/USD/EUR, modal lines 653-655). The Entities table then renders these mixed-currency sums formatted as the entity's own currency: `fmt(ic.receivable, e.currency)` (line 284) and `fmt(ic.payable, e.currency)` (line 285). A USD 1000 loan plus a TRY 1000 trade shows as a single '2000' stamped with the entity currency symbol — an arithmetically meaningless and mislabeled figure.
- **Düzeltme:** Convert each ic.amount to a single presentation currency via exchangeRates before accumulating, and format with that presentation currency (or bucket totals per currency).

### IhracatModule.tsx — KPI sums USD and EUR amounts together, labels the total USD
`src/components/IhracatModule.tsx` · 195, 212 · currency
- ihracatToplam = ihracatlar.reduce((s, i) => s + (i.tutar || 0), 0) adds every record's tutar with no regard for i.doviz, which is 'USD' | 'EUR' per record (line 18, form default 'USD'). The KPI then renders it as { label: 'Aylık Tutar (USD)', value: `$${ihracatToplam.toLocaleString()}` }. A 1000 EUR export is added to a 1000 USD export and displayed as $2000. No exchangeRates conversion is imported or used anywhere in the file.
- **Düzeltme:** Either group the sum by i.doviz and show per-currency totals, or convert each tutar to a single base currency via exchangeRates before summing. Do not hardcode the USD label/$ prefix while mixing currencies.

### LegalModule.tsx — Contract & case value KPIs sum mixed currencies but label everything ₺
`src/components/LegalModule.tsx` · lines 357-358 (KPI calc), rendered lines 420, 466, 524, 576 · currency
- Contract carries a currency field (type 'TRY'|... ; the Add/Edit modal exposes a TRY/USD/EUR <select> at lines 1082-1088). But activeContractsValue = contracts.filter(Aktif).reduce((s,c)=>s+c.value,0) adds raw numeric values across currencies with no exchangeRate conversion, then the card prints `${activeContractsValue.toLocaleString('tr-TR')} ₺` (line 420). A 10,000 USD contract is added as 10,000 TRY. Per-row value cells (line 466) likewise always append ₺ and ignore contract.currency. LegalCase amounts (totalCasesValue, line 358 / row line 576) have no currency field at all but are also shown as ₺, which is at least internally consistent; the contract path is the concrete data-correctness bug.
- **Düzeltme:** Convert each contract.value to TRY via exchangeRates before summing (or group totals per currency). At minimum, render each row's amount with its own contract.currency symbol instead of a hardcoded ₺.

### MobileWMSModule.tsx — Cycle-count writes absolute quantity from a stale snapshot (lost-update race)
`src/components/MobileWMSModule.tsx` · startCycleCount L191-203, submitCycleCount L223-227 · data-integrity
- startCycleCount captures systemQty from the inventory prop at the moment the count begins (L197: systemQty: i.quantity || i.stock || 0). submitCycleCount later writes the counted value as an ABSOLUTE overwrite: updateDoc(doc(db,'inventory', item.productId), { quantity: item.countedQty }) (L225). Counting on a tablet typically spans minutes; any sale, pick, or Mikro sync that changes inventory.quantity in between is silently clobbered when the operator submits. This is a textbook read-modify-write / lost-update race: there is no compare-against-current-systemQty, no transaction, no delta. Two concurrent operators counting overlapping items also stomp each other.
- **Düzeltme:** Compute and apply a delta inside a server-side transaction: re-read current quantity, and only adjust by (countedQty - countedQtyAtScanTime), or reject/flag if current quantity != the systemQty the count was based on. Move the adjustment to a dedicated server endpoint that does this atomically rather than a client updateDoc.

### MobileWMSModule.tsx — Cycle-count accepts negative / NaN counted quantities and writes them to stock
`src/components/MobileWMSModule.tsx` · L531-536 onChange, L225 write · data-integrity
- The counted-qty input does const val = Number(e.target.value) with no validation (L532). A negative number, or any non-numeric producing NaN, is stored as countedQty and flagged counted:true. submitCycleCount then writes it straight to inventory.quantity (L225), producing negative on-hand stock or a NaN quantity. There is no >=0 clamp anywhere in the WMS adjustment path.
- **Düzeltme:** Validate the input (Number.isFinite, val >= 0) before marking counted; clamp/refuse negatives; guard the write with quantity < 0 ? reject.

### MobileWMSModule.tsx — Receive/Pick task completion never moves stock
`src/components/MobileWMSModule.tsx` · completeTask L181-188; createPickTask L154-179; createReceiveTask L130-151 · correctness
- completeTask only flips task.status to 'completed' and stamps completedAt; it does not increment inventory on a receive nor decrement it on a pick. So confirming a pick task ships goods out of the warehouse with zero effect on inventory.quantity, and receiving goods never raises stock. Combined with cycle-count being the only path that writes inventory, the WMS module's core stock-atomicity guarantees do not exist - the books only move when someone runs a count.
- **Düzeltme:** On pick complete, decrement inventory (with negative-stock guard) and log an outbound movement; on receive complete, increment and log inbound - ideally via an atomic server endpoint.

### ProjectModule.tsx — Deleting a project leaves orphaned tasks (no delete cascade)
`src/components/ProjectModule.tsx` · handleDelete lines 338-355; tasks subscription lines 247-251 · data-integrity
- handleDelete for type 'project' deletes only the single projects/{id} doc. Tasks store their parent in task.projectId (interface line 62) but are never deleted or reparented. After deleting a project, its tasks survive with a dangling projectId. These orphans still load into the global `tasks` state, still render on the Kanban board under 'All Projects' (line 576), still appear on the calendar (line 731) and in the Gantt flatMap is harmless only because it iterates projects — but updateProjectProgress (line 286) will also keep firing updateDoc against a now-deleted project id during drag. There is no way to ever surface or clean these tasks from the UI since the project filter dropdown (line 561) only lists existing projects.
- **Düzeltme:** In the project branch of handleDelete, query tasks where projectId === id and batch-delete (or block deletion / reassign) before/after removing the project doc. Same applies to resources referenced by task.assignee.

### ProjectModule.tsx — Gantt timeline crashes / renders NaN when a project has an invalid or empty startDate
`src/components/ProjectModule.tsx` · lines 607-633 (ComposedChart data) and line 659 (ReferenceLine) · correctness
- minDate is computed as new Date(Math.min(...projects.map(p => parseISO(p.startDate).getTime()))). Project.startDate is a free-form string from Firestore/import. If any project has a missing/empty/malformed startDate, parseISO returns Invalid Date, getTime() returns NaN, Math.min returns NaN, so minDate is an Invalid Date and every differenceInDays(...) yields NaN — all bars collapse/disappear and recharts can throw on NaN domain. The identical Math.min expression is duplicated at line 659 for the 'Today' ReferenceLine, doubling the failure surface. Additionally, with zero projects Math.min(...[]) returns Infinity, producing an Infinity-based date.
- **Düzeltme:** Filter to projects with a valid parseable startDate first, guard against empty array (skip rendering or default to today), and compute minDate once (hoist it) instead of recomputing in the ReferenceLine.

### PurchasingModule.tsx — Goods-receipt is not idempotent → duplicate stock-in on re-click/re-trigger
`src/components/PurchasingModule.tsx` · handleUpdateStatus, lines 223-257 · data-integrity
- When status is set to 'Teslim Alındı', the handler loops order.items and does updateDoc(inventory, stockLevel + qty) plus addDoc(inventoryMovements). There is no idempotency guard: it does not read/set a receivedAt flag, does not re-check the order's current status from the DB, and the server has no guard (grep of server.ts for receivedAt/'Teslim Alındı' is empty). The 'Mark as Received' button is gated only on the in-memory order.status, which is hydrated asynchronously via onSnapshot (lines 274-287). A double-click before the snapshot round-trips, or editing a received order's status back and forward, re-runs the increment and logs a second inventoryMovements row — silently inflating stock.
- **Düzeltme:** Read the order doc (or check order.status === 'Sipariş Edildi') before applying receipt; write a receivedAt/received:true flag in the same update and short-circuit if already set. Ideally move the stock increment to a server transaction keyed on PO id so concurrent clicks cannot double-apply.

### PurchasingModule.tsx — updateDoc/updateStatus/delete bypass the approval-queue role gate
`src/components/PurchasingModule.tsx` · handleUpdateOrder 200-221, handleUpdateStatus 223-257, handleDeleteOrder 259-272 · security
- On create (handleSubmitOrder, 141-190) non-privileged roles are correctly routed through submitApprovalRequest instead of writing the PO. But every other mutation enforces nothing: handleUpdateOrder calls updateDoc('purchaseOrders', id, {...}) directly, handleUpdateStatus advances status (including to 'Teslim Alındı', which moves real inventory) directly, and handleDeleteOrder deletes directly. The isPrivileged check only hides the create button in the footer (line 864); the update/status/delete code paths and the rendered Edit/status/Delete row buttons (552-609) are available to any authenticated role. An Employee can edit totals, advance a PO to received (booking stock), or delete a PO with no approval and no role check.
- **Düzeltme:** Gate handleUpdateOrder/handleUpdateStatus/handleDeleteOrder on isPrivileged (or route through approval), and enforce role server-side on purchaseOrders writes rather than trusting the client.

### SabitKiymetModule.tsx — Manual birikmisSalinma override is silently discarded — saved NBV contradicts the form preview
`src/components/SabitKiymetModule.tsx` · calcBirikmisSalinma L103-128; modal preview L1078-1083; interface/label L34,L1072 · data-integrity
- The SabitKiymet.birikmisSalinma field is documented as a manual override (interface comment L34: 'manuel override, 0 = hesaplansın'; form label L1072: '0 = otomatik hesapla'). The modal's live NBV preview honors it: L1081 computes Math.max(0, alisBedeli - (varlikForm.birikmisSalinma||0)). But calcBirikmisSalinma (L103) NEVER reads item.birikmisSalinma — it unconditionally recomputes accumulated depreciation from alisTarihi/faydaliOmur. So every table cell, KPI, and saved amortismanKayitlari record ignores the override. A user entering an opening accumulated-depreciation balance (e.g. an asset migrated mid-life) sees one NBV in the form and a different, wrong NBV everywhere after save. The override field is dead data.
- **Düzeltme:** In calcBirikmisSalinma, return item.birikmisSalinma when it is > 0 (matching the documented '0 = auto' contract), or remove the override field and its preview entirely so the UI and computed values agree.

### SabitKiymetModule.tsx — USD/EUR asset values summed and formatted as TRY without exchangeRates conversion
`src/components/SabitKiymetModule.tsx` · KPI L437-438; table L744-747; depreciation tab L816-819; saved log L849-851 · currency
- alisBedeli is stored in the asset's paraBirimi (TRY/USD/EUR, type L19). All aggregation and display treats the raw number as TRY. kpi.toplamDeger/toplamBirikmiS (L437-438) reduce calcNetDeger/calcBirikmisSalinma across mixed-currency assets with no conversion, then render via formatTRY (L673-674). A 50,000 USD asset adds 50,000 to the TRY 'Toplam Defter Değeri'. The asset row (L744) prefixes the currency code as a string but still feeds the raw amount to formatTRY, and the entire Amortisman tab (L816-819) plus saved period records (yillikAmort/netDegerDefter, written at L522-525) are all formatted with formatTRY regardless of currency. Book-value and accumulated-depreciation totals are arithmetically wrong for any non-TRY asset.
- **Düzeltme:** Convert each asset's amounts to TRY via exchangeRates before reducing/formatting (or keep per-currency subtotals). At minimum the KPI strip must not sum heterogeneous currencies into a single formatTRY value.

### ServisModule.tsx — Technician workload/rating stats are manual free-text fields, never derived — guaranteed to drift from reality
`src/components/ServisModule.tsx` · closeTalep L168-178; saveTalep L158-166; teknisyen form L637-647; SLA dashboard L374-384 · data-integrity
- acikTalep, tamamlanan and ortPuan on Teknisyen are plain number inputs typed by hand in the Teknisyen modal (L638-645). Nothing in the code derives them from servisTalepleri. saveTalep() assigns a technician via a free-text 'atanan' field (emptyTalep L113, input L515) but never increments that technician's acikTalep. closeTalep() (L168-178) sets durum='Çözüldü' and writes memnuniyetPuani onto the talep, but never decrements acikTalep, never increments tamamlanan, and never recomputes ortPuan from the new memnuniyetPuani. The 'Teknisyen Bazlı Yük' (L365-392) and 'Ort. Puan' columns therefore display whatever number an admin last typed, diverging from actual open/closed counts and satisfaction the moment any talep is created or closed.
- **Düzeltme:** Either compute these per-technician on the client from `talepler` (filter by atanan: open count, resolved count, avg memnuniyetPuani) and drop the manual inputs, or have saveTalep/closeTalep transactionally update the matching teknisyen doc. Link 'atanan' to a real teknisyen id instead of free text.


## 🟡 MEDIUM

### BakimModule.tsx — deleteEkipman hard-deletes equipment with no check for referencing iş emirleri / arızalar — orphans work orders
`src/components/BakimModule.tsx` · deleteEkipman L166-169; isEmri/ariza carry ekipmanId L35,L49 · data-integrity
- deleteEkipman() does a single confirm() then deleteDoc on 'ekipmanlar' (L168). IsEmri and Ariza both store ekipmanId (L35, L49) referencing that equipment. After deletion the work orders and fault records keep a dangling ekipmanId and a now-stale denormalized ekipmanAd, with no cascade, soft-delete, or 'in use' guard. The İş Emirleri / Arızalar tabs keep showing rows pointing at a deleted asset, and the equipment dropdown in the iş-emri modal (L503) no longer offers it for reassignment.
- **Düzeltme:** Before deleting, count open isEmirleri/arizalar with this ekipmanId and block (or warn) if any exist; or soft-delete (durum='Emekli') instead of hard delete.

### BakimModule.tsx — Editing equipment name leaves denormalized ekipmanAd stale on existing iş emirleri and arızalar
`src/components/BakimModule.tsx` · saveIsEmri L171-183 (ekipmanAd copy L177); saveAriza L189-194; saveEkipman edit path L156-157 · correctness
- saveIsEmri snapshots the equipment name once at creation: `ekipmanAd: ekipman?.ad ?? ''` (L177). Arıza stores ekipmanAd as a typed free-text field (L563). When an equipment's `ad` is later changed via saveEkipman's edit branch (updateDoc on 'ekipmanlar', L157), no propagation updates the ekipmanAd copies on existing isEmirleri/arizalar. The İş Emirleri table (L323) and Arızalar table (L414) then display the old name while the Ekipmanlar tab shows the new one.
- **Düzeltme:** Render the name by looking up ekipmanlar.find(e=>e.id===ie.ekipmanId)?.ad at display time, or on equipment edit also update child docs sharing that ekipmanId.

### CPQPanel.tsx — CPQ quote has no KDV/VAT — totals are net with no tax line
`src/components/CPQPanel.tsx` · createQuote L231-242; cart total L538-541 · correctness
- CPQ quotes store and display only totalAmount = sum of line totals. There is no KDV/VAT rate, no tax line, and no gross total, despite this being a Turkish B2B quoting flow where KDV is mandatory on quotations. Quotes saved to cpqQuotes therefore omit tax entirely, diverging from the rest of the ERP's invoicing.
- **Düzeltme:** Add a KDV rate per template/quote, compute tax and gross total, and persist net/tax/gross on the cpqQuotes doc.

### CorporateGovernanceModule.tsx — Shareholder create writes updatedAt instead of createdAt, breaking the list sort
`src/components/CorporateGovernanceModule.tsx` · handleSaveShareholder, line 185-189; subscription line 124-126 · correctness
- On shareholder creation, addDoc writes only `updatedAt: serverTimestamp()` and never sets `createdAt`. The shareholders onSnapshot subscription sorts the list with `sortByCreatedAt(...)`. In fsSort.ts, `toMs(undefined)` returns 0 for any doc lacking createdAt, so every newly created shareholder gets sort key 0 and lands at the bottom of the table in arbitrary order. Board/assembly/contract creates correctly use createdAt; only shareholder create diverges.
- **Düzeltme:** In the create branch of handleSaveShareholder, write `createdAt: serverTimestamp()` (keep updatedAt for the edit branch). This matches the other three entities and restores newest-first ordering.

### CorporateGovernanceModule.tsx — No validation that share counts/percentages are sane or sum to 100%
`src/components/CorporateGovernanceModule.tsx` · shareholder form lines 745-751; save line 176-198; render line 452-453 · data-integrity
- shareCount and sharePercentage are free numeric inputs with no bounds. A user can enter sharePercentage > 100, negative values, or a set of shareholders whose percentages sum to more than 100% (or less). For a cap table this is the core invariant, yet nothing computes or displays the total, and Number(e.target.value) on an empty field yields NaN which is persisted. The table shows each row's % but never a footer total, so an inconsistent cap table is silently accepted.
- **Düzeltme:** Clamp inputs (min=0 max=100), guard against NaN (`Number(e.target.value)||0`), and add a footer row summing sharePercentage with a warning when the total != 100. Optionally block save when the projected total exceeds 100%.

### EBelgeMerkezi.tsx — fmt(belge.tutar) null/undefined tutarda render'ı çökertir
`src/components/EBelgeMerkezi.tsx` · 237-238 (fmt), 362 (kullanım), 159 (tipsiz spread) · react
- Belgeler Firestore'dan tip kontrolsüz alınıyor: snap.docs.map(d => ({ id:d.id, ...(d.data() as Omit<EBelge,'id'>) })) (159). tutar eksik veya string ise (legacy/bozuk doküman), fmt n.toLocaleString('tr-TR',...) çağrısı (238) TypeError fırlatır ve o satırın — pratikte tüm tablonun — render'ı patlar. Kaydetmede parseFloat(form.tutar)||0 var ama dışarıdan/eski yazılmış dokümanlar için garanti yok.
- **Düzeltme:** fmt(Number(belge.tutar) || 0) kullanın veya fmt içinde 'const x = Number(n); if (!isFinite(x)) return '0,00';' guard'ı ekleyin.

### EBelgeMerkezi.tsx — handleResend gerçek GIB gönderimi yapmadan durumu 'Gönderildi'ye çeviriyor; gibConnected kontrolü yok
`src/components/EBelgeMerkezi.tsx` · 200-207 · correctness
- handleResend yalnızca updateDoc(...,{ durum:'Gönderildi' }) yapıyor — GIB'e hiçbir gönderim/çağrı yok, yanıt/ret işlenmiyor. Ayrıca gibConnected false iken bile çalışır: GIB bağlı değilken kullanıcı belgeyi 'Gönderildi' olarak işaretleyebilir, bu da gönderim/ret akışını ve KPI'ları (gonderilen sayacı, 233) yanıltır. Durum tamamen kozmetik bir bayrak.
- **Düzeltme:** Gönderimi gerçek GIB servisine bağlayın; en azından !gibConnected iken handleResend'i engelleyip kullanıcıyı uyarın ve gerçek yanıt gelene dek 'Bekliyor' bırakın.

### EBelgeMerkezi.tsx — Gönderilmiş e-Belge durum/iptal koruması olmadan silinebiliyor
`src/components/EBelgeMerkezi.tsx` · 209-219 (handleDelete), 386-408 (silme UI) · data-integrity
- handleDelete herhangi bir durum kontrolü yapmıyor; 'Gönderildi' (yasal olarak GIB'e iletilmiş) bir e-Fatura da deleteDoc ile kalıcı silinebiliyor. e-Belge mevzuatında gönderilen fatura silinemez, yalnızca iptal/itiraz edilir. Silme UI'ı (Trash2) tüm satırlarda koşulsuz gösteriliyor.
- **Düzeltme:** durum==='Gönderildi' olan belgeler için silmeyi engelleyin (sadece 'İptal' akışına izin verin) ve UI'da o satırlarda Trash2'yi gizleyin.

### HoldingModule.tsx — Equity metric double-counts net income vs balance-sheet panel
`src/components/HoldingModule.tsx` · lines 447, 501-508 · correctness
- The top metric card computes Equity as `totalEquity + netIncome` (line 447), while the Consolidated Balance Sheet panel lists 'Equity' = totalEquity (line 503) AND a separate 'Period Net Income' = netIncome line (line 507). The two views present different equity figures for the same consolidation. If revenue/expense have already been closed into equity accounts, netIncome is being added on top of equity that already includes it (double count); if not closed, the metric card and the panel simply disagree. Either way users see inconsistent equity numbers.
- **Düzeltme:** Pick one convention (closed vs open books) and use it consistently across the metric card and the balance-sheet panel; if showing net income separately, the Equity card should not pre-add it.

### HoldingModule.tsx — Ownership weighting applied to revenue/expense and inconsistent with per-entity view
`src/components/HoldingModule.tsx` · lines 137-140, 531-542 · correctness
- Consolidation multiplies ALL account types — including revenue and expense — by ownershipFactor (lines 137-140), i.e. it proportionally consolidates the P&L. For a 'subsidiary' (entityType, line 20) accounting standards require full (100%) line consolidation with a separate minority/non-controlling interest, not pro-rata revenue. Pro-rata is only appropriate for affiliates (equity method), and even then you would not line-consolidate at all. Meanwhile the Per-Entity Summary (lines 533-535) computes eRevenue/eExpense from RAW balances with no ownership factor. So the sum of per-entity net incomes will not equal the consolidated net income, and the consolidation method is wrong for the declared entityType in every case.
- **Düzeltme:** Branch consolidation by entityType: full line-consolidation for subsidiaries (compute NCI separately), equity method for affiliates; do not pro-rata revenue/expense for subsidiaries. Make the per-entity view use the same basis so the two reconcile.

### IhracatModule.tsx — 'Aylık' (monthly) KPI label but the sum has no date filter
`src/components/IhracatModule.tsx` · 195-196, 212 · correctness
- The KPI is labeled 'Aylık Tutar' (Monthly Amount) but ihracatToplam sums ALL ihracat records ever created — there is no filter on sevkTarihi or createdAt for the current month. The number grows unbounded over time and never represents a monthly figure. Same class of issue: bekleyenGumruk and ihracatlar.length are all-time, not monthly.
- **Düzeltme:** Filter ihracatlar by current month (using createdAt or sevkTarihi) before computing the 'Aylık' total, or rename the label to 'Toplam Tutar'.

### IhracatModule.tsx — Akreditif vadesi (L/C expiry) is never checked against today; status is manual-only
`src/components/IhracatModule.tsx` · 112, 342, 507-511 · correctness
- Akreditif.durum is set entirely by hand via a dropdown (Açıldı / Kullanıldı / Süresi Doldu) and defaults to 'Açıldı'. The vadesi (expiry date) field is stored and displayed but never compared to the current date. An L/C past its vadesi keeps showing the green/blue 'Açıldı' badge until a human manually flips it to 'Süresi Doldu'. There is no computed expiry, no warning, no derived status. For letters of credit this is a material operational risk (expired L/C still appears live).
- **Düzeltme:** Derive an 'expired' state when new Date(a.vadesi) < today and surface it (badge override or warning), independent of the manually-entered durum.

### IhracatModule.tsx — Auto-generated document numbers collide on concurrent/deleted records
`src/components/IhracatModule.tsx` · 133-134, 141, 173 · data-integrity
- autoNo = `${prefix}-2026-${String(list.length + 1).padStart(4,'0')}` derives the sequence purely from current client-side array length. Two users saving at once both compute the same length+1 and produce duplicate ihracatNo/ithalatNo/akreditifNo/beyanNo. Deleting any earlier record also makes the next insert reuse an existing number. These act as business document identifiers (export/customs/L/C numbers) where uniqueness matters.
- **Düzeltme:** Generate the sequence server-side with an atomic counter, or derive from max existing suffix +1 inside a transaction; do not base it on client array length. Also hardcoded '2026' will be wrong from 2027 on.

### LegalModule.tsx — KPI sums crash if any contract/case/project row has undefined value/amount/budget
`src/components/LegalModule.tsx` · LegalModule lines 357-358, 420, 466, 524, 576; ProjectModule line 481, 521 · correctness
- value/amount/budget are required in the types, but Firestore/import data is unvalidated. reduce((sum,c)=>sum+c.value,0) yields NaN if any value is undefined, and the per-row `c.value.toLocaleString('tr-TR')` (LegalModule line 466) / `item.amount.toLocaleString` (line 576) / `project.budget.toLocaleString()` (ProjectModule line 521) throw TypeError 'Cannot read properties of undefined' on a single malformed doc, blanking the whole table. No `?? 0` guard anywhere, unlike the project-memory note #4 which previously fixed exactly this pattern (item.prices null-coalescing) elsewhere.
- **Düzeltme:** Null-coalesce in both the reduce accumulators and the render: (c.value ?? 0), (item.amount ?? 0), (project.budget ?? 0).toLocaleString().

### MRPModule.tsx — MRP shared draw-down bucket collides for all free-text (empty inventoryId) components
`src/components/MRPModule.tsx` · runMRP L231-249 · correctness
- Component availability is tracked in `remaining[comp.inventoryId]`. BOM components support free-text entries with inventoryId === '' (see BOMPanel emptyComponent L65-67). All such components share the single key remaining[''], so two distinct manually-entered materials draw down and overwrite the same phantom stock figure, corrupting shortage math across unrelated items. inventory.find(i=>i.id==='') is also always undefined so onHand starts at 0 then gets cross-mutated.
- **Düzeltme:** Key the remaining map by a stable identifier that falls back to sku or name when inventoryId is empty (e.g. comp.inventoryId || comp.sku || comp.name), or skip stock netting for unlinked components.

### MRPModule.tsx — MRP production suggestion ignores finished-goods on-hand stock
`src/components/MRPModule.tsx` · runMRP L218-227 · correctness
- For every product with demandQty>0 MRP always emits a 'produce' suggestion for the full demandQty without checking existing finished-product inventory. Unlike component netting (which uses on-hand stock), the parent item is never netted against stock, so MRP over-recommends production whenever finished goods already exist.
- **Düzeltme:** Look up on-hand stock for the finished product (by SKU/name) and suggest producing max(0, demandQty - onHand); skip the suggestion when fully covered.

### MobileWMSModule.tsx — Cycle-count stock adjustment writes no inventoryMovements record
`src/components/MobileWMSModule.tsx` · submitCycleCount L222-227 · data-integrity
- The discrepancy loop directly mutates inventory.quantity but never appends an inventoryMovements log entry (that collection is the system of record for stock history, server.ts L442). Cycle-count adjustments therefore leave no audit trail of who changed stock and by how much, and the on-hand will diverge from the sum of movements used for reconciliation/Mikro stock-history.
- **Düzeltme:** For each adjustment also write an inventoryMovements doc {productId, type:'adjustment', delta, reason:'cycle_count', ...} so stock history stays consistent.

### ProjectModule.tsx — Project progress recompute uses stale closure during drag, can write wrong %
`src/components/ProjectModule.tsx` · handleDragEnd lines 183-194, updateProjectProgress 278-290, updateResourceLoad 292-306 · correctness
- On drag end the code optimistically builds updatedTasks from the current `tasks` state and passes it to updateProjectProgress/updateResourceLoad. updateResourceLoad also reads `resources` from closure to find the row. Because all three writes (task status, project progress, resource load) are separate awaited updateDoc calls with no transaction, a second drag fired before the onSnapshot refresh recomputes progress/load from a tasks array that does not yet reflect the prior in-flight change, so progress can be written based on stale data. Counts derived (doneTasks/projectTasks.length) momentarily diverge from the persisted truth.
- **Düzeltme:** Recompute progress/load on the server or within a single transaction/batch keyed off freshly read task docs, rather than from the component's possibly-stale `tasks`/`resources` snapshot.

### PurchasingModule.tsx — Purchase order total carries no KDV; PO PDF prints flat total with no VAT line
`src/components/PurchasingModule.tsx` · calculateTotal 130-132; setDoc 150-159; pdf.ts exportPurchaseOrderPDF 466-477 · correctness
- calculateTotal = Σ(purchasePrice*quantity) with no tax. The setDoc/updateDoc payloads write only totalAmount and never any kdvOran/kdvTutari/kdvHaricTutar fields. exportPurchaseOrderPDF (pdf.ts:466-477) prints po.totalAmount as 'GENEL TOPLAM' with no KDV breakdown at all. For a Turkish satınalma belgesi this is a missing legal field — net, KDV% and KDV tutarı are absent, and the figure pushed to Mikro via SatinAlmaTalepKaydetV2 (line 503) is a tax-less amount, so downstream accounting must guess the VAT.
- **Düzeltme:** Capture a KDV rate per line/order, store kdvHaricTutar/kdvTutari/kdvOran on the PO, and render the net+KDV+total breakdown in exportPurchaseOrderPDF.

### PurchasingModule.tsx — No supplier balance or payment-calendar record created on PO/receipt
`src/components/PurchasingModule.tsx` · handleSubmitOrder 134-198, handleUpdateStatus receipt branch 231-253 · data-integrity
- Receiving goods increments inventory and logs an inventoryMovements row but creates no payable/liability, no supplier ledger entry, and no payment-due record — despite the module subtitle covering supplier orders and the focus on tedarikçi bakiye / ödeme takvimi. supplier is a free-text string (line 680), not a reference to the suppliers collection (which exists in TENANT_COLLECTIONS). So there is no way to compute what is owed to a supplier or when payment is due; expectedDate is a delivery ETA, not a payment date.
- **Düzeltme:** On PO confirmation/receipt, write a payable record (supplierId, amount incl. KDV, dueDate, status) and link supplier to the suppliers collection so balances and a payment calendar can be derived.

### PurchasingModule.tsx — Quantity/purchasePrice inputs accept NaN/negative → corrupt totalAmount
`src/components/PurchasingModule.tsx` · handleUpdateItem 123-128; inputs 766-783; submit 134-159 · correctness
- The qty and cost inputs call Number(e.target.value) with no clamping. Clearing the field yields NaN (Number('')===NaN→ via empty, actually 0; but partial like '-' or 'e' yields NaN), and negative values are accepted. calculateTotal then produces NaN or a negative totalAmount, which is written verbatim by setDoc (line 157) and drives the approval priority threshold (line 174) and KPI sums (line 404). No validation runs before persisting beyond the supplier/empty-items check.
- **Düzeltme:** Validate each item (quantity > 0, purchasePrice >= 0, both finite) before setDoc/updateDoc and reject/normalize NaN in handleUpdateItem.

### SabitKiymetModule.tsx — Declining-balance assets show perpetual annual depreciation past end of useful life
`src/components/SabitKiymetModule.tsx` · calcYillikAmort L97-100; calcBirikmisSalinma L116-127 · correctness
- For 'Azalan Bakiyeler', calcBirikmisSalinma caps elapsed years at yilCapped=min(elapsed, faydaliOmur) (L111) and caps the running total at alisBedeli (L127). But DDB mathematically never reaches alisBedeli, so calcBirikmisSalinma returns a value strictly below alisBedeli even after the asset is fully past its useful life. calcYillikAmort then computes kalanDeger = alisBedeli - calcBirikmisSalinma > 0 (L99) and returns a positive annual depreciation forever. The Amortisman tab (L816) will keep showing yearly depreciation for assets older than faydaliOmur, and handleDonemHesapla (L522) will persist non-zero yillikAmort indefinitely. Standard DDB switches to straight-line / fully writes off in the final year.
- **Düzeltme:** Return 0 from calcYillikAmort when elapsed full years >= faydaliOmur, and in the DDB loop write off remaining book value in the final year so accumulated depreciation reaches alisBedeli at end of life.

### SabitKiymetModule.tsx — Assets in 'Bakımda' status are excluded from book value and depreciation
`src/components/SabitKiymetModule.tsx` · aktifVarliklar L434; KPI L437-438; Amortisman tab L798-800; handleDonemHesapla L511 · correctness
- KPIs, the entire Depreciation tab, and the period-calculation job all operate on aktifVarliklar = varliklar.filter(v => v.durum === 'Aktif') (L434, L511). An asset with durum 'Bakımda' (in maintenance) is still owned and must still depreciate and count toward book value, but it is dropped from Toplam Defter Değeri (L437), Birikmiş Amortisman (L438), the Amortisman table (L800), and handleDonemHesapla (L517). Only 'Elden Çıkarıldı'/'Hurdaya Ayrıldı' should be excluded from active depreciation. This understates total book value and skips depreciation entries whenever an asset is temporarily in maintenance.
- **Düzeltme:** Include 'Bakımda' (i.e. exclude only disposed/scrapped statuses) when computing book value, the depreciation register, and period calculations.

### SabitKiymetModule.tsx — Deleting an asset orphans its depreciation, maintenance, and insurance records (no cascade)
`src/components/SabitKiymetModule.tsx` · handleDelete L606-617; delete trigger L761 · data-integrity
- amortismanKayitlari, sabitKiymetBakim, and sabitKiymetSigorta all reference an asset via varlikId (L42, L53, L64). Deleting an asset (setDeleteTarget({col:'sabitKiymetler'}) at L761 -> handleDelete) calls a single deleteDoc on sabitKiymetler only (L609). All child records keyed by that varlikId are left orphaned: they persist in their tabs showing the asset's name (varlikAd snapshot) with a dangling varlikId, inflating maintenance-cost/insurance views and the saved depreciation log indefinitely. There is no FK/cascade on the dbClient side either.
- **Düzeltme:** On asset delete, also delete (or reassign/flag) related docs in amortismanKayitlari, sabitKiymetBakim, sabitKiymetSigorta where varlikId === deleted id, or block deletion while children exist.


## ⚪ LOW

### CorporateGovernanceModule.tsx — Contract expiry date can precede signing date with no validation
`src/components/CorporateGovernanceModule.tsx` · handleSaveContract line 215-228; form lines 827-833 · data-integrity
- contractForm.date (signed) and contractForm.expiryDate are independent date inputs. handleSaveContract persists them with no check that expiryDate >= date. An expiry before the signing date is accepted and rendered, and there is no logic deriving the 'Süresi Dolmuş' status from expiryDate vs today, so status and dates can contradict each other.
- **Düzeltme:** Validate expiryDate >= date before save and surface an error toast; optionally auto-flag status as expired when expiryDate < today.

### CorporateGovernanceModule.tsx — Board and shareholder 'View' (Eye) button is identical to Edit — opens a fully editable modal
`src/components/CorporateGovernanceModule.tsx` · board lines 347-364 vs 365-382; shareholder lines 457-473 vs 474-490 · react
- The Eye/'İncele' (View) button and the Edit button run byte-identical onClick handlers: both populate the form, set the editing id, and open the editable modal. A read-only view is implied by the icon and tooltip but does not exist, so a user intending only to inspect a board decision or shareholder record is dropped into an editable form titled 'New ...' (see separate modal-title issue) and can silently overwrite it.
- **Düzeltme:** Either implement a true read-only view mode (e.g. a viewOnly flag disabling inputs and hiding Save) or remove the redundant Eye button to avoid the misleading affordance.

### CorporateGovernanceModule.tsx — Add/Edit modals always show 'New ...' title even when editing an existing record
`src/components/CorporateGovernanceModule.tsx` · board modal header line 695; shareholder modal header line 735 · react
- editingMeetingId / editingShareholderId drive update-vs-create in the save handlers, but the modal headers are hardcoded to 'Yeni Toplantı Kaydı' / 'Yeni Pay Sahibi' ('New Meeting Record' / 'New Shareholder'). When a user clicks Edit, the modal opens prefilled yet titled 'New', which misrepresents that the existing record is about to be overwritten rather than a new one created.
- **Düzeltme:** Make each header conditional on the editing id, e.g. `editingMeetingId ? 'Toplantıyı Düzenle' : 'Yeni Toplantı Kaydı'`.

### IhracatModule.tsx — Beyanname No required label but no uniqueness/format validation; numeric fields coerce blank to 0
`src/components/IhracatModule.tsx` · 137, 142-143, 159-160, 174, 187 · data-integrity
- All save functions do Number(form.field) on optional numeric inputs that start as '' (miktar, tutar, gumrukVergi, kdv, deger). Number('') === 0, so a left-blank Tutar/Değer is silently persisted as 0 rather than null/undefined, which then flows into the USD KPI sum and ₺ customs-value displays as a real 0 amount. Validation only checks two text fields per form (e.g. aliciFirma & ulke) and silently returns with no user feedback when they're empty.
- **Düzeltme:** Treat empty numeric inputs as undefined (e.g. form.tutar === '' ? null : Number(form.tutar)) and surface a validation message instead of a silent return.

### MobileWMSModule.tsx — Task from/to locations are picked arbitrarily and never validated against the product's bin
`src/components/MobileWMSModule.tsx` · createPickTask L156/163-164, createReceiveTask L137, startCycleCount L198 · correctness
- fromLocation/toLocation are filled with locations.find(l=>l.zone==='storage') / zone==='ship' / zone==='receive' - i.e. the FIRST bin of that zone for the whole tenant, regardless of which bin actually holds the SKU. Cycle count hard-codes location to the first 'storage' bin (L198). Location tracking is therefore cosmetic: the WMS cannot tell an operator the real pick face, and multi-bin stock is invisible. There is also no per-location quantity model at all (inventory has a single quantity).
- **Düzeltme:** Track stock per location (bin-level quantities) and resolve from/to locations by where the product actually sits, not the first zone bin.

### ProjectModule.tsx — Task assignee avatar reads assignee[0] without guarding empty string
`src/components/ProjectModule.tsx` · SortableTask line 119 · react
- {task.assignee[0]} renders the first character for the avatar. The Add/Edit form marks assignee required so UI-created tasks are safe, but imported/legacy task docs (or a doc written with assignee: '') yield ''[0] === undefined (renders nothing, harmless) — however if assignee is undefined entirely (missing field on an imported doc, since `as Task` casting at line 249 does not enforce presence), task.assignee[0] throws 'Cannot read properties of undefined'. The cast `d.data() as Task` provides no runtime guarantee.
- **Düzeltme:** Use (task.assignee?.[0] ?? '?') and similarly guard the assignee label on line 121.

### SabitKiymetModule.tsx — alisBedeli not floored to >0 on amount input; faydaliOmur accepts unbounded values bypassing max
`src/components/SabitKiymetModule.tsx` · alisBedeli input L1049-1050; faydaliOmur input L1065-1066; validateVarlik L484-485 · correctness
- The number inputs have min attributes (alisBedeli min=0, faydaliOmur min=1 max=50) but onChange uses parseFloat/parseInt without clamping, and HTML min/max are not enforced on typed input. faydaliOmur can be set to e.g. 999 (max=50 is ignored when typed) producing distorted straight-line rates, and validateVarlik only checks faydaliOmur<=0 (L485), not the documented 50-year ceiling. While alisBedeli<=0 is caught by validation, there is no upper sanity bound. Lower severity since core <=0 cases are guarded, but the max=50 contract is silently violated.
- **Düzeltme:** Clamp faydaliOmur to [1,50] in onChange and/or add an upper-bound check in validateVarlik so the persisted value matches the input's stated max.

### ServisModule.tsx — closeTalep allows closing a service request with an empty resolution note
`src/components/ServisModule.tsx` · closeTalep L168-178; modal L559-585 · correctness
- The 'Talebi Kapat' modal collects a Çözüm Açıklaması (L569) but closeTalep() performs no validation: it writes durum='Çözüldü' with cozumAciklamasi=cozumAciklama even when the textarea is blank. A request can be marked resolved with no record of what was done, undermining the SLA/audit value of the close flow. Contrast with saveTalep (L159) and saveEkipman (L155) which at least guard required fields.
- **Düzeltme:** Require a non-empty cozumAciklama (and optionally a valid memnuniyet) before allowing 'Çözüldü Olarak Kapat'.

### ServisModule.tsx — SLA deadline and maintenance-due calcs parse date-only strings as UTC midnight, skewing the <24h warning boundary in UTC+3
`src/components/ServisModule.tsx` · slaDeadline L75-79 / slaStatus L81-88; BakimModule daysUntil L66-69 · correctness
- acilisTarihi/garantiBitis/sonBakim are 'YYYY-MM-DD' strings. new Date('2026-06-28') parses as UTC midnight, but the deadline is then compared to Date.now() in local (Turkey UTC+3) time (L84: diffH=(deadline-Now)/3600000). This shifts every deadline ~3h earlier than the operator's wall-clock intent, which flips the 'warning' (diffH<24, L87) and 'breach' (diffH<0, L85) classification near boundaries. The same UTC-parse pattern drives daysUntil/garantiDurum and the 'next 30 days' maintenance filter, so an item can show as breached/due a few hours off from local expectation.
- **Düzeltme:** Parse date-only strings at local midnight (e.g. new Date(y,m-1,d)) or compare on whole-day granularity rather than fractional hours.
