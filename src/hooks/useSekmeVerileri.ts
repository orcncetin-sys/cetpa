import { useState, useEffect } from 'react';
// dbClient SHIM'inden — `firebase/firestore` DEGIL. `src/firebase.ts`teki `db`
// yalnizca bir yer tutucu (`{} as Record<string, never>`); gercek cagrilar
// PostgreSQL'e giden shim uzerinden yapiliyor. Ilk denememde gercek Firestore
// paketinden import ettim ve tsc bunu hemen soyledi.
import { collection, query, orderBy, limit, onSnapshot } from '../lib/dbClient';
import { db } from '../firebase';
import { sortByCreatedAt } from '../utils/fsSort';
import type { WebhookConfig, VehiclePosition } from '../types';

/**
 * useSekmeVerileri — SEKME-KAPILI canli veri dinleyicileri (16 efekt,
 * 18 koleksiyon).
 *
 * ## Ne yapar
 *
 * Yalnizca ilgili sekme ACIKKEN abone olur (`if (activeTab !== 'muhasebe')
 * return;` gibi kapilar). Bu, `src/lib/lazyCollections.ts`teki kararin
 * devami: her oturumda 18 koleksiyonu birden dinlemek gereksiz trafik ve
 * bellek demek.
 *
 * ## Neden state'i KANCA SAHIPLENIYOR
 *
 * Bu kod eskiden `AppContent` icinde, 6.900 satirlik govdeye dagilmisti.
 * Daha onceki bir cikarma denemesi (`src/hooks/useDataSync.ts`) YARIM
 * kalmisti: dosya yazilmis ama HICBIR YERDEN IMPORT EDILMEMISTI. Sonuc
 * sessizdi — `vehicles` ve `locationStocks` dinleyicileri AYLARCA olu kaldi
 * ve QR Depo/Arac Transfer sistemi calismiyordu.
 *
 * Bu kanca state'i KENDI tutar ve DONDURUR: cagrilmazsa degiskenler App.tsx'te
 * hic tanimli olmaz ve DERLEME KIRILIR.
 *
 * ## ⚠ AMA BU GARANTI YETMEDI — ikinci bir bosluk vardi
 *
 * Bu basligin eski hali "yazdim ama baglamadim IMKANSIZ" diyordu. YANLISTI.
 * Kanca degiskenin App.tsx'te VAR OLMASINI garanti eder; ALT BILESENE
 * GECIRILMESINI etmez. Iki deger tam bu boslugtan dustu (2026-08-28):
 * `p554Bins` ve `p549Iadeler` App.tsx'te destructure ediliyordu ama
 * <OrdersPage> / <CRMPage> cagrilarina HIC gecirilmiyordu; o ekranlar da
 * kendi icinde setter'siz bos bir yerel state tutuyordu. Sonuc: Bin/Lokasyon
 * ve Iade/RMA ekranlari sayaclari 0 gosteriyor, eklenen kayit listede
 * gorunmuyordu. Derleyici sustu cunku `noUnusedLocals` kapali ve
 * `no-unused-vars` eslint'te 'off'.
 *
 * Bosluk artik TESTLE kapatildi: `useSekmeVerileri.test.ts` bu dosyanin
 * donus listesindeki HER degerin App.tsx'te en az iki kez (destructure +
 * en az bir kullanim) gectigini dogrular.
 *
 * ## p584 (stok sayim oturumu) BURADA DEGIL
 *
 * `stockCountSessions` dinleyicisi App.tsx'te BIRAKILDI: yazdigi state
 * (`p584Active`/`p584CountItems`/`p584SessionId`) kullanici etkilesimiyle de
 * degistiriliyor, yani sahipligi kancaya vermek yanlis olurdu.
 */
/**
 * Bu iki tip DIŞA AKTARILIYOR çünkü verileri gösteren ekranlar (OrdersPage'in
 * Bin/Lokasyon sekmesi, CRMPage'in İade/RMA sekmesi) bunları PROP olarak alır.
 *
 * Eskiden her iki ekran da kendi içinde `const [p554Bins] = useState([])` gibi
 * SETTER'SIZ, kalıcı olarak BOŞ bir yerel state tanımlıyordu — yani kancanın
 * canlı verisi hiç ekrana ulaşmıyordu (2026-08-28 bulgusu). Tipi tek yerde
 * tutmak, o kopya-state'lerin geri gelmesini zorlaştırır.
 */
export type IadeSatiri = {
  id: string; orderId: string; customerName: string; items: string; reason: string;
  condition: 'Hasarlı' | 'Sağlam' | 'Kısmen Hasarlı'; decision: 'İade' | 'Değişim' | 'Kredi Notu' | 'Bekliyor';
  status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi' | 'Tamamlandı'; createdAt?: unknown; notes?: string;
};

export type BinSatiri = {
  id: string; warehouseId: string; warehouseName: string; binCode: string;
  productSku: string; productName: string; quantity: number; minQty?: number;
  lastCounted?: string; notes?: string; createdAt?: unknown;
};

export interface SekmeVeriGirdi {
  user: { uid: string } | null | undefined;
  activeTab: string;
  muhasebeTab: string;
  lojistikTab: string;
  purchasingSubTab: string;
  p625BudgetYear: number;
}

export function useSekmeVerileri({
  user, activeTab, muhasebeTab, lojistikTab, purchasingSubTab, p625BudgetYear,
}: SekmeVeriGirdi) {
  const [dashVergiDeadlines, setDashVergiDeadlines] = useState<{ id: string; vergiTuru: string; sonTarih: string; durum: string }[]>([]); // Phase 543
  const [p547BankAccounts, setP547BankAccounts] = useState<Array<{ id: string; bankName: string; accountType: string; balance: number; currency: string }>>([]);
  const [p547FixedAssets, setP547FixedAssets]   = useState<Array<{ id: string; name: string; cost: number; depreciation: number }>>([]);
  const [p548Masraflar, setP548Masraflar] = useState<Array<{
    id: string; employeeName: string; category: string; amount: number; currency: string;
    date: string; description: string; receiptUrl?: string;
    status: 'Bekliyor' | 'Onaylandı' | 'Reddedildi'; createdAt?: unknown; rejectionNote?: string;
  }>>([]);
  const [p549Iadeler, setP549Iadeler] = useState<IadeSatiri[]>([]);
  const [p552Records, setP552Records] = useState<Array<{
    id: string; employeeName: string; employeeId?: string; date: string;
    checkIn: string; checkOut: string; totalHours: number;
    status: 'Normal' | 'Geç Giriş' | 'Erken Çıkış' | 'Devamsız' | 'İzinli';
  }>>([]);
  const [p554Bins, setP554Bins] = useState<BinSatiri[]>([]);
  /** Araçların SON bilinen konumu — Lojistik > Canlı Takip sekmesi açıkken. */
  const [aracKonumlari, setAracKonumlari] = useState<VehiclePosition[]>([]);
  const [p573Rules, setP573Rules] = useState<Array<{id:string;name:string;type:'bulk'|'customer-tier'|'promo';minQty?:number;tierName?:string;discountPct:number;active:boolean}>>([]);
  const [p579Batches, setP579Batches] = useState<Array<{id:string;sku:string;productName:string;batchNo:string;expiryDate?:string;qty:number;location?:string;status:'Aktif'|'Karantina'|'Kullanıldı'}>>([]);
  const [p587Checks, setP587Checks] = useState<Array<{id:string;item:string;checked:boolean;severity:'Kritik'|'Uyarı'|'Bilgi'}>>([]);
  const [p588Consign, setP588Consign] = useState<Array<{id:string;supplierName:string;productName:string;sku:string;qty:number;agreedPrice:number;locationCode?:string;startDate:string;status:'Depoda'|'Satıldı'|'İade Edildi'}>>([]);
  const [p591Schedules, setP591Schedules] = useState<Array<{id:string;customerName:string;amount:number;frequency:'monthly'|'quarterly'|'yearly';nextDate:string;description:string;active:boolean}>>([]);
  const [p608Quotes, setP608Quotes] = useState<Array<{id:string;supplier:string;price:number;leadDays:number;minQty:number;validUntil?:string}>>([]);
  const [p612Budgets, setP612Budgets] = useState<Array<{id:string;category:string;allocated:number;spent:number;period:string}>>([]);
  const [p625BudgetData, setP625BudgetData] = useState<Array<{id?:string;month:number;budgetRevenue:number;budgetExpense:number}>>([]);
  const [p627Risks, setP627Risks] = useState<Array<{id:string;supplier:string;riskType:'Tedarik Kesintisi'|'Kalite'|'Fiyat Artışı'|'Teslimat Gecikmesi'|'Diğer';severity:'Düşük'|'Orta'|'Yüksek'|'Kritik';probability:number;mitigationPlan?:string;status:'Aktif'|'Azaltıldı'|'Kabul Edildi'}>>([]);
  const [p636Calculated, setP636Calculated] = useState(false);
  const [p636Payrolls, setP636Payrolls] = useState<Array<{id:string;name:string;position:string;gross:number;sgkEmployee:number;sgkEmployer:number;incomeTax:number;stampTax:number;net:number}>>([]);
  const [p638MatchResults, setP638MatchResults] = useState<Array<{invoiceId:string;invoiceNo:string;customer:string;invoiceAmount:number;matchedAmount:number;confidence:number;status:'Tam'|'Kısmi'|'Eşleşmedi'}>>([]);
  const [webhookConfigs, setWebhookConfigs] = useState<WebhookConfig[]>([]);

  useEffect(() => {
    if (!user || activeTab !== 'settings') return; // yalnızca Ayarlar ekranında gösterilir
    return onSnapshot(collection(db, 'webhookConfigs'), s =>
      setWebhookConfigs(s.docs.map(d => ({ id: d.id, ...d.data() } as WebhookConfig))),
      () => setWebhookConfigs([])
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, activeTab]);

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

  useEffect(() => {
    if (activeTab !== 'muhasebe' || muhasebeTab !== 'masraf') return;
    const unsub = onSnapshot(query(collection(db, 'masraflar')), snap => {
      setP548Masraflar(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p548Masraflar[number]))));
    }, () => {});
    return () => unsub();
   
  }, [activeTab, muhasebeTab]);

  useEffect(() => {
    if (activeTab !== 'muhasebe' || muhasebeTab !== 'oto-fatura') return;
    const unsub = onSnapshot(query(collection(db, 'autoInvoiceSchedules')), snap => {
      setP591Schedules(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p591Schedules[number])));
    }, () => {});
    return () => unsub();
  }, [activeTab, muhasebeTab]);

  useEffect(() => {
    if (activeTab !== 'satin-alma' || purchasingSubTab !== 'satin-butce') return;
    const unsub = onSnapshot(query(collection(db, 'purchaseBudgets')), snap => {
      setP612Budgets(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p612Budgets[number])));
    }, () => {});
    return () => unsub();
  }, [activeTab, purchasingSubTab]);

  useEffect(() => {
    if (activeTab !== 'satin-alma' || purchasingSubTab !== 'suppliers') return;
    const unsub = onSnapshot(query(collection(db, 'rfqQuotes')), snap => {
      setP608Quotes(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p608Quotes[number])));
    }, () => {});
    return () => unsub();
  }, [activeTab, purchasingSubTab]);

  useEffect(() => {
    if (activeTab !== 'satin-alma' || purchasingSubTab !== 'tedarik-risk') return;
    const unsub = onSnapshot(query(collection(db, 'supplierRisks')), snap => {
      setP627Risks(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p627Risks[number])));
    }, () => {});
    return () => unsub();
  }, [activeTab, purchasingSubTab]);

  useEffect(() => {
    if (activeTab !== 'inventory') return;
    const unsub = onSnapshot(query(collection(db, 'supplierConsignments')), snap => {
      setP588Consign(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p588Consign[number])));
    }, () => {});
    const unsub2 = onSnapshot(query(collection(db, 'stockBatches')), snap => {
      setP579Batches(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p579Batches[number])));
    }, () => {});
    return () => { unsub(); unsub2(); };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'muhasebe' || muhasebeTab !== 'gelir-gider-butce') return;
    const unsub = onSnapshot(query(collection(db, 'revExpBudgets')), snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as {id:string;year:number;month:number;budgetRevenue:number;budgetExpense:number}));
      setP625BudgetData(rows.filter(r => r.year === p625BudgetYear));
    }, () => {});
    return () => unsub();
  }, [activeTab, muhasebeTab, p625BudgetYear]);

  useEffect(() => {
    if (activeTab !== 'ik') return;
    const unsub = onSnapshot(query(collection(db, 'payrollRuns'), orderBy('calculatedAt', 'desc'), limit(1)), snap => {
      const latest = snap.docs[0]?.data() as { rows?: typeof p636Payrolls } | undefined;
      if (latest?.rows?.length) { setP636Payrolls(latest.rows); setP636Calculated(true); }
    }, () => {});
    return () => unsub();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'muhasebe' || muhasebeTab !== 'banka') return;
    const unsub = onSnapshot(query(collection(db, 'bankMatchRuns'), orderBy('ranAt', 'desc'), limit(1)), snap => {
      const latest = snap.docs[0]?.data() as { results?: typeof p638MatchResults } | undefined;
      if (latest?.results?.length) setP638MatchResults(latest.results);
    }, () => {});
    return () => unsub();
  }, [activeTab, muhasebeTab]);

  // ── Canlı araç konumları ────────────────────────────────────────────────
  // Sekme-kapılı: yalnız Lojistik > Canlı Takip açıkken abone olunur. Konum
  // saniyeler mertebesinde güncellendiği için her oturumda dinlemek gereksiz
  // trafik olurdu.
  useEffect(() => {
    if (activeTab !== 'lojistik' || lojistikTab !== 'canli') return;
    const unsub = onSnapshot(query(collection(db, 'vehiclePositions')), snap => {
      setAracKonumlari(snap.docs.map(d => ({ id: d.id, ...d.data() } as VehiclePosition)));
    }, () => {
      // Hata durumunda listeyi BOŞALTMA: boş liste "araç konum paylaşmıyor"
      // gibi görünür ve gerçek nedeni (ör. 403) gizler. Eski değer kalsın,
      // arayüz zaten konumun YAŞINA bakıp bayatsa uyarıyor.
    });
    return () => unsub();
  }, [activeTab, lojistikTab]);

  useEffect(() => {
    if (activeTab !== 'kalite') return;
    const unsub = onSnapshot(query(collection(db, 'qualityChecklist')), snap => {
      setP587Checks(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p587Checks[number])));
    }, () => {});
    return () => unsub();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'muhasebe' || muhasebeTab !== 'fiyat-kural') return;
    const unsub = onSnapshot(query(collection(db, 'pricingRules')), snap => {
      setP573Rules(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p573Rules[number])));
    }, () => {});
    return () => unsub();
  }, [activeTab, muhasebeTab]);

  useEffect(() => {
    if (activeTab !== 'ik') return;
    const unsub = onSnapshot(query(collection(db, 'timeAttendance')), snap => {
      setP552Records(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p552Records[number]))));
    }, () => {});
    return () => unsub();
   
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'lojistik' || lojistikTab !== 'wms') return;
    const unsub = onSnapshot(collection(db, 'warehouseBins'), snap => {
      setP554Bins(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p554Bins[number]))));
    }, () => {});
    return () => unsub();
   
  }, [activeTab, lojistikTab]);

  useEffect(() => {
    if (activeTab !== 'iade') return;
    const unsub = onSnapshot(query(collection(db, 'rmaRequests')), snap => {
      setP549Iadeler(sortByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() } as typeof p549Iadeler[number]))));
    }, () => {});
    return () => unsub();
   
  }, [activeTab]);

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

  return {
    p547BankAccounts,
    p547FixedAssets,
    p548Masraflar,
    p549Iadeler,
    p552Records,
    p554Bins,
    aracKonumlari,
    p573Rules,
    p579Batches,
    p587Checks,
    p588Consign,
    p591Schedules,
    p608Quotes,
    p612Budgets,
    p625BudgetData,
    p627Risks,
    p636Calculated,
    p636Payrolls,
    p638MatchResults,
    webhookConfigs,
    dashVergiDeadlines,

    // Alt bilesenlere prop olarak gecen setter'lar
    setP547BankAccounts,
    setP547FixedAssets,
    setP548Masraflar,
    setP549Iadeler,
    setP552Records,
    setP554Bins,
    setP573Rules,
    setP579Batches,
    setP587Checks,
    setP588Consign,
    setP591Schedules,
    setP608Quotes,
    setP612Budgets,
    setP625BudgetData,
    setP627Risks,
    setP636Calculated,
    setP636Payrolls,
    setP638MatchResults,
    setWebhookConfigs,
  };
}
