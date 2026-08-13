import { useEffect, useRef } from 'react';
import {
  collection, query, where, limit, orderBy, onSnapshot,
  addDoc, serverTimestamp, doc, setDoc, getDocs
} from '../lib/dbClient';
import { db, auth } from '../firebase';
import { useDataStore } from '../store/dataStore';
import { koleksiyonAktif } from '../lib/lazyCollections';
import { logFirestoreError as importedLogFirestoreError, OperationType } from '../utils/firebase';
import type { Lead, Order, InventoryItem, Warehouse, InventoryMovement, Consignment, StockDiscrepancy, Employee, Payroll, Shipment, Quotation, Vehicle, LocationStock } from '../types';
import { UserRole } from '../types';
import { User } from 'firebase/auth';

interface DataSyncOptions {
  user: User | null;
  userRole: UserRole | null;
  isAuthReady: boolean;
  storeCompanyId: string | null;
  mfaChallenge: boolean;
  activeTab: string;
  muhasebeTab: string;
  lojistikTab: string;
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  setNotifPrefs: (val: Record<string, boolean>) => void;
  setQuickNote: (val: string) => void;
  setRecentlyViewed: (val: any[]) => void;
  currentLanguage: 'tr' | 'en';
}

export function useDataSync({
  user, userRole, isAuthReady, storeCompanyId, mfaChallenge,
  activeTab, muhasebeTab, lojistikTab,
  darkMode, setDarkMode, setNotifPrefs, setQuickNote, setRecentlyViewed,
  currentLanguage
}: DataSyncOptions) {
  const darkModeFromServerRef = useRef(false);

  const {
    setLeads, setOrders, setInventory, setWarehouses, setInventoryMovements,
    setConsignments, setStockDiscrepancies, setEmployees, setPayrolls,
    setShipments, setApPurchaseOrders, setSupportTickets, setContracts,
    setRecurringOrders, setLeaveRequests, setPriceOverrides, setAppQuotations,
    setMonthlyTargets, setMonthlyTarget, setAllBudgetsFirestore,
    setAuditLogs, setWebhookConfigs, setP547BankAccounts, setP547FixedAssets,
    setP548Masraflar, setP552Records, setP554Bins, setP549Iadeler,
    setDashVergiDeadlines,
    setP582Projects, setP595Tasks, setP597Contracts, setP605Capacity,
    setP618Projects, setP621Demands, setP623LCs, setP624Orders,
    setP639Returns, setP640Subs, setP642Warranties, setP643Txns, leads, orders,
    setCommissionRules, setSuppliers, setUserSubscription, setPaymentHistory,
    setNotifications, setFxPos, setCompanySettings, setLogoUrl,
    setGeminiApiKeySetting, setMikroSettings, setLucaSettings, setGibConnected,
    setBranchNames, setVehicles, setLocationStocks
  } = useDataStore();

  const sortByCreatedAt = (arr: any[]) =>
    arr.sort((a, b) => {
      const ta = a.createdAt?.seconds || Date.now() / 1000;
      const tb = b.createdAt?.seconds || Date.now() / 1000;
      return tb - ta;
    });

  // ── Phase 649: Subscribe to webhookConfigs collection ────────────────────
  useEffect(() => {
    if (!user || activeTab !== 'settings') return;
    return onSnapshot(collection(db, 'webhookConfigs'), s =>
      setWebhookConfigs(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => setWebhookConfigs([])
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, activeTab]);

  // ── Phase 547: Fetch bank accounts + fixed assets for Bilanço ───────────
  useEffect(() => {
    if (activeTab !== 'muhasebe' || muhasebeTab !== 'bilanco') return;
    const unsubBank = onSnapshot(collection(db, 'bankAccounts'), snap => {
      setP547BankAccounts(sortByCreatedAt(snap.docs.map(d => ({
        id: d.id, bankName: d.data().bankName || d.data().bank || '—',
        accountType: d.data().accountType || 'Vadesiz',
        balance: Number(d.data().balance) || 0,
        currency: d.data().currency || 'TRY',
      }))));
    }, () => setP547BankAccounts([]));
    const unsubFA = onSnapshot(collection(db, 'sabitKiymetler'), snap => {
      setP547FixedAssets(sortByCreatedAt(snap.docs.map(d => ({
        id: d.id, name: d.data().name || '—',
        cost: Number(d.data().cost) || Number(d.data().edinimBedeli) || 0,
        depreciation: Number(d.data().birikimliAmortisman) || 0,
      }))));
    }, () => setP547FixedAssets([]));
    return () => { unsubBank(); unsubFA(); };
  }, [activeTab, muhasebeTab]);

  // ── Phase 548: Fetch expense claims (masraf) ───────────────────────────
  useEffect(() => {
    if (activeTab !== 'muhasebe' || muhasebeTab !== 'masraf') return;
    const unsub = onSnapshot(query(collection(db, 'masraflar')), snap => {
      setP548Masraflar(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }, () => {});
    return () => unsub();
  }, [activeTab, muhasebeTab]);

  // ── Phase 552: Fetch time & attendance when on IK tab ────────────────────
  useEffect(() => {
    if (activeTab !== 'ik') return;
    const unsub = onSnapshot(query(collection(db, 'timeAttendance')), snap => {
      setP552Records(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }, () => {});
    return () => unsub();
  }, [activeTab]);

  // ── Phase 554: Fetch WMS bins when on lojistik/wms tab ──────────────────
  useEffect(() => {
    if (activeTab !== 'lojistik' || lojistikTab !== 'wms') return;
    const unsub = onSnapshot(collection(db, 'warehouseBins'), snap => {
      setP554Bins(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }, () => {});
    return () => unsub();
  }, [activeTab, lojistikTab]);

  // ── Phase 549: Fetch RMA/İade requests ──────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'iade') return;
    const unsub = onSnapshot(query(collection(db, 'rmaRequests')), snap => {
      setP549Iadeler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }, () => {});
    return () => unsub();
  }, [activeTab]);

  // ── Phase 543: Subscribe to vergiTakvimi when on dashboard ───────────────
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    const today543 = new Date().toISOString().slice(0, 10);
    const unsub = onSnapshot(
      query(collection(db, 'vergiTakvimi')),
      snap => {
        const upcoming = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as { vergiTuru: string; sonTarih: string; durum: string }) }))
          .filter(d => d.sonTarih >= today543 && d.durum !== 'Tamamlandı')
          .slice(0, 4);
        setDashVergiDeadlines(upcoming);
      },
      () => setDashVergiDeadlines([])
    );
    return () => unsub();
  }, [activeTab]);

  // --- Data Fetching ---
  useEffect(() => {
    if (!isAuthReady || !user || !userRole) return;
    if (mfaChallenge) return; // 2FA doğrulanana kadar tenant verisi yüklenmez

    // Data is scoped by companyId (= uid of the account owner).
    // Documents without a companyId field are legacy/test data and are excluded.
    const companyId = storeCompanyId ?? user.uid;

    const leadsQuery = (userRole === UserRole.Admin || userRole === UserRole.Manager)
      ? query(collection(db, 'leads'), where('companyId', '==', companyId))
      : query(collection(db, 'leads'), where('companyId', '==', companyId), where('assignedTo', '==', user.uid));
    const unsubLeads = onSnapshot(leadsQuery, (snapshot) => {
      setLeads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lead)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'leads', auth.currentUser?.uid));

    const ordersQuery = (userRole === UserRole.Dealer)
      ? query(collection(db, 'orders'), where('companyId', '==', companyId), where('assignedTo', '==', user.uid))
      : query(collection(db, 'orders'), where('companyId', '==', companyId));
    const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'orders', auth.currentUser?.uid));

    const unsubInventory = onSnapshot(query(collection(db, 'inventory'), where('companyId', '==', companyId)), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setInventory(items);

      const uid = auth.currentUser?.uid;
      const lowCount = items.filter(i => (i.stockLevel ?? 0) <= (i.lowStockThreshold ?? 5)).length;
      const DAY = 24 * 60 * 60 * 1000;
      const last = Number(sessionStorage.getItem('lowStockNotifyAt') || 0);
      if (uid && lowCount > 0 && Date.now() - last > DAY) {
        sessionStorage.setItem('lowStockNotifyAt', String(Date.now()));
        void addDoc(collection(db, 'notifications'), {
          userId: uid,
          title: currentLanguage === 'tr' ? 'Düşük Stok Uyarısı' : 'Low Stock Alert',
          message: currentLanguage === 'tr'
            ? `${lowCount} ürün kritik stok seviyesinde.`
            : `${lowCount} product(s) at critical stock level.`,
          type: 'warning', read: false, createdAt: serverTimestamp(),
        }).catch(() => { /* non-critical */ });
      }
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'inventory', auth.currentUser?.uid));


    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snapshot) => {
      setWarehouses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Warehouse)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'warehouses', auth.currentUser?.uid));

    const unsubVehicles = onSnapshot(collection(db, 'vehicles'), (snapshot) => {
      setVehicles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'vehicles', auth.currentUser?.uid));

    const unsubLocationStocks = onSnapshot(query(collection(db, 'locationStocks'), where('companyId', '==', companyId)), (snapshot) => {
      setLocationStocks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LocationStock)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'locationStocks', auth.currentUser?.uid));

    const unsubMovements = onSnapshot(query(collection(db, 'inventoryMovements'), where('companyId', '==', companyId), limit(200)), (snapshot) => {
      setInventoryMovements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryMovement)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'inventoryMovements', auth.currentUser?.uid));

    const unsubConsignments = onSnapshot(query(collection(db, 'consignments'), where('companyId', '==', companyId)), (snapshot) => {
      setConsignments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Consignment)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'consignments', auth.currentUser?.uid));

    const unsubDiscrepancies = onSnapshot(query(collection(db, 'stockDiscrepancies'), where('companyId', '==', companyId), where('resolved', '==', false), limit(100)), (snapshot) => {
      setStockDiscrepancies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockDiscrepancy)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'stockDiscrepancies', auth.currentUser?.uid));

    const unsubEmployees = onSnapshot(collection(db, 'employees'), (snapshot) => {
      setEmployees(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'employees', auth.currentUser?.uid));

    const unsubPayrolls = onSnapshot(collection(db, 'payrolls'), (snapshot) => {
      setPayrolls(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payroll)));
    }, () => { /* non-critical */ });

    const unsubShipments = onSnapshot(collection(db, 'shipments'), (snapshot) => {
      setShipments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shipment)));
    }, (error) => importedLogFirestoreError(error, OperationType.LIST, 'shipments', auth.currentUser?.uid));

    // ── Phase 110: Fetch purchaseOrders for AP Tracker ───────────────────────
    const unsubAPOrders = onSnapshot(collection(db, 'purchaseOrders'), (snapshot) => {
      setApPurchaseOrders(snapshot.docs.map(d => ({
        id: d.id, orderNumber: d.data().orderNumber || d.id.slice(0, 8),
        supplier: d.data().supplier || '—', totalAmount: d.data().totalAmount || 0,
        status: d.data().status || '', expectedDate: d.data().expectedDate,
        createdAt: d.data().createdAt
      })));
    }, () => { /* non-critical */ });

    // ── Phase 111: Support Tickets ────────────────────────────────────────────
    const unsubTickets = onSnapshot(query(collection(db, 'supportTickets'), limit(100)), (snapshot) => {
      setSupportTickets(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => { /* non-critical */ });

    // ── Phase 116: Contracts ──────────────────────────────────────────────────
    const unsubContracts = onSnapshot(collection(db, 'contracts'), (snapshot) => {
      setContracts(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => { /* non-critical */ });

    // ── Phase 119: Recurring Orders ───────────────────────────────────────────
    const unsubRecurring = onSnapshot(collection(db, 'recurringOrders'), (snapshot) => {
      setRecurringOrders(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => { /* non-critical */ });

    // ── Phase 121: Leave Requests ─────────────────────────────────────────────
    const unsubLeave = onSnapshot(query(collection(db, 'leaveRequests'), limit(100)), (snapshot) => {
      setLeaveRequests(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => { /* non-critical */ });

    // ── Phase 122: Price Override Approvals ──────────────────────────────────
    const unsubPriceOverrides = onSnapshot(query(collection(db, 'priceOverrides'), limit(100)), (snapshot) => {
      setPriceOverrides(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => { /* non-critical */ });

    // ── Phase 145: App-level quotations for Reports Dashboard ─────────────────
    const unsubAppQuotations = onSnapshot(query(collection(db, 'quotations'), limit(200)), (snapshot) => {
      setAppQuotations(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Quotation)));
    }, () => { /* non-critical */ });

    // ── userPrefs listener — dark mode, notif prefs, starred orders, quick note, recently viewed ──
    const unsubUserPrefs = onSnapshot(doc(db, 'userPrefs', user.uid), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.darkMode !== undefined && d.darkMode !== darkMode) { darkModeFromServerRef.current = true; setDarkMode(d.darkMode as boolean); }
      if (d.notifPrefs) setNotifPrefs(d.notifPrefs as Record<string, boolean>);
      if (typeof d.quickNote === 'string') setQuickNote(d.quickNote);
      if (Array.isArray(d.recentlyViewed)) setRecentlyViewed(d.recentlyViewed);
    }, () => { /* non-critical */ });

    // ── Monthly targets listener ──────────────────────────────────────────────
    const unsubTargets = onSnapshot(doc(db, 'settings', 'targets'), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as Record<string, number>;
      setMonthlyTargets(d);
      const curKey = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();
      if (d[curKey] !== undefined) setMonthlyTarget(d[curKey]);
    }, () => { /* non-critical */ });

    // ── Budget vs Actuals listener ────────────────────────────────────────────
    const unsubBudgets = onSnapshot(doc(db, 'settings', 'budgets'), (snap) => {
      if (!snap.exists()) return;
      setAllBudgetsFirestore(snap.data() as Record<string, any[]>);
    }, () => { /* non-critical */ });

    return () => {
      unsubLeads();
      unsubOrders();
      unsubInventory();
      unsubWarehouses();
      unsubVehicles();
      unsubLocationStocks();
      unsubMovements();
      unsubConsignments();
      unsubDiscrepancies();
      unsubEmployees();
      unsubPayrolls();
      unsubShipments();
      unsubAPOrders();
      unsubTickets();
      unsubContracts();
      unsubRecurring();
      unsubLeave();
      unsubPriceOverrides();
      unsubAppQuotations();
      unsubUserPrefs();
      unsubTargets();
      unsubBudgets();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userRole, isAuthReady, storeCompanyId, mfaChallenge]);

  // ── auditLog: yalnızca Admin > Denetim Kaydı açıkken dinle ────────────────
  useEffect(() => {
    if (!user || activeTab !== 'admin') return;
    const companyId = storeCompanyId ?? user.uid;
    const unsub = onSnapshot(
      query(collection(db, 'auditLog'), where('companyId', '==', companyId), orderBy('timestamp', 'desc'), limit(100)),
      (snapshot) => setAuditLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))),
      (error) => importedLogFirestoreError(error, OperationType.LIST, 'auditLog', auth.currentUser?.uid)
    );
    return () => unsub();

  }, [user, activeTab, storeCompanyId]);

  // ── Phase extended collections — Firestore subscriptions ─────────────────
  useEffect(() => {
    if (!user) return;
    const u: (() => void)[] = [];
    // Modül-özel koleksiyonlar ilgili sekme ilk açılana kadar dinlenmez —
    // hiç girilmeyen modülün verisi hiç indirilmez (bkz. lazyCollections.ts).
    const sub = (col: string, setter: (d: unknown[]) => void) => {
      if (!koleksiyonAktif(col, activeTab)) return;
      u.push(onSnapshot(collection(db, col), s => setter(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => setter([])));
    };

    sub('projectCosts',    setP582Projects);
    sub('workflowTasks',   setP595Tasks);
    sub('revenueContracts',setP597Contracts);
    sub('capacityLines',   setP605Capacity);
    sub('projectTimelines',setP618Projects);
    sub('demandRequests',  setP621Demands);
    sub('letterOfCredit',  setP623LCs);
    sub('productionOrders',setP624Orders);
    sub('returns',         setP639Returns);
    sub('recurringBilling',setP640Subs);
    sub('warranties',      setP642Warranties);
    sub('intercompanyTxns',setP643Txns);

    return () => u.forEach(fn => fn());
    // activeTab bağımlılık: modül sekmesi ilk açıldığında o koleksiyon dinlemeye
    // girsin (koleksiyonAktif yapışkandır, sekmeden çıkınca kapanmaz).
  }, [user?.uid, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Customer Risk Scoring — writes to customerRisks collection ──────────
  useEffect(() => {
    if (!user || leads.length === 0) return;
    const lastRisk = Number(sessionStorage.getItem('riskScoreAt') || 0);
    if (Date.now() - lastRisk < 24 * 60 * 60 * 1000) return;
    const timer = setTimeout(async () => {
      sessionStorage.setItem('riskScoreAt', String(Date.now()));
      const now = new Date();
      // Mikro-farkında hale getirildi (2026-08-13 KPI denetimi bulgusu): önceden
      // yalnız native orders'a bakıyordu, Mikro-ağırlıklı caride customerOrders
      // hep boş kalıp yazma sessizce atlanıyordu ("continue" satırı). RiskPanel.tsx
      // zaten canlı olarak cariBalances'a (Mikro, gerçek bakiye) fallback yapıyordu
      // — bu günlük özet artık AYNI kaynağı kullanır, ikisi birbirinden sapmaz.
      const cariBalanceMap = new Map<string, number>();
      try {
        const snap = await getDocs(collection(db, 'cariBalances'));
        snap.docs.forEach(d => {
          const x = d.data() as Record<string, unknown>;
          const kod = String(x.cariKod ?? d.id).trim();
          if (kod) cariBalanceMap.set(kod, Number(x.bakiye ?? 0));
        });
      } catch { /* Mikro bakiyesi çekilemedi — native hesaba devam */ }
      for (const lead of leads) {
        try {
          const cariKod = String((lead as unknown as { mikroCariKod?: string }).mikroCariKod ?? '').trim();
          const mikroBakiye = cariKod ? Math.max(0, cariBalanceMap.get(cariKod) ?? 0) : 0; // pozitif=bize borçlu
          const customerOrders = orders.filter(
            o => o.leadId === lead.id || o.customerName === lead.name
          );
          const nativeBalance = customerOrders
            .filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled')
            .reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
          const totalBalance = nativeBalance + mikroBakiye;

          let daysAllowed = 30;
          if (lead.paymentTerms) {
            const match = lead.paymentTerms.match(/\d+/);
            if (match) daysAllowed = parseInt(match[0], 10);
          }
          const overdueCount = customerOrders.filter(o => {
            if (o.status === 'Delivered' || o.status === 'Cancelled') return false;
            const oAny = o as unknown as Record<string, unknown>;
            const createdAt = oAny.createdAt;
            const orderDate = createdAt && typeof createdAt === 'object' && 'toDate' in createdAt
              ? (createdAt as { toDate: () => Date }).toDate()
              : new Date((oAny.syncedAt as string) || now);
            const due = new Date(orderDate);
            due.setDate(due.getDate() + daysAllowed);
            return now > due;
          }).length;

          const creditLimit = Number(lead.creditLimit) || 0;
          const utilisation = creditLimit > 0 ? Math.min(totalBalance / creditLimit, 1) : 0;

          const riskScore = Math.min(
            Math.round(utilisation * 50 + overdueCount * 20 + (customerOrders.length > 10 ? 10 : 0)),
            100
          );

          if (customerOrders.length === 0 && totalBalance === 0 && creditLimit === 0) continue;

          await setDoc(doc(db, 'customerRisks', lead.id), {
            customerId: lead.id,
            customerName: lead.name,
            company: lead.company || '',
            currentBalance: totalBalance,
            creditLimit,
            riskScore,
            overdueOrders: overdueCount,
            totalOrders: customerOrders.length,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        } catch {
          // Non-critical
        }
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [leads, orders, user]);


  // --- Phase 2: Rest of onSnapshots ---
  useEffect(() => {
    if (!user) return;
    const unsubCommission = onSnapshot(collection(db, 'commissionRules'), snap => {
      setCommissionRules(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), snap => {
      setSuppliers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });
    const unsubSub = onSnapshot(doc(db, 'subscriptions', user.uid), (snap) => {
      if (snap.exists()) setUserSubscription({ id: snap.id, ...snap.data() } as any);
      else setUserSubscription(null);
    });
    const unsubPayments = onSnapshot(
      query(collection(db, `subscriptions/${user.uid}/payments`), orderBy('date', 'desc'), limit(12)),
      snap => {
        setPaymentHistory(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
      }
    );
    const unsubNotifications = onSnapshot(query(collection(db, 'notifications'), where('userId', '==', user.uid), limit(10)), (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubFx = onSnapshot(doc(db, 'settings', 'fxRevaluation'), s => {
      if (s.exists()) setFxPos(prev => ({ ...prev, ...(s.data() as any) }));
    });
    const unsubSettings = onSnapshot(doc(db, 'settings', 'app'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setLogoUrl(data.logoUrl || null);
        setCompanySettings(data.companySettings || {});
      }
    });
    const unsubAi = onSnapshot(doc(db, 'settings', 'aiConfig'), snap => {
      if (snap.exists()) setGeminiApiKeySetting((snap.data()?.geminiApiKey as string) ?? '');
    });
    const unsubMikro = onSnapshot(doc(db, 'settings', 'mikro'), (docSnap) => {
      if (docSnap.exists()) setMikroSettings(docSnap.data() as any);
    });
    const unsubLuca = onSnapshot(doc(db, 'settings', 'luca'), (docSnap) => {
      if (docSnap.exists()) setLucaSettings(docSnap.data() as any);
    });
    const unsubGib = onSnapshot(doc(db, 'settings', 'gib'), snap => {
      setGibConnected(snap.exists() ? (snap.data().connected ?? false) : false);
    });
    const unsubBranches = onSnapshot(collection(db, 'subeler'), snap => {
      setBranchNames(
        snap.docs.map(d => (d.data() as any).subeAdi ?? '').filter(Boolean)
      );
    });

    return () => {
      unsubCommission(); unsubSuppliers(); unsubSub(); unsubPayments();
      unsubNotifications(); unsubFx(); unsubSettings(); unsubAi();
      unsubMikro(); unsubLuca(); unsubGib(); unsubBranches();
    };
  }, [user]);

}
