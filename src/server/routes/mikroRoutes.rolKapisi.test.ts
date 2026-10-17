// @vitest-environment node
/**
 * mikroRoutes.rolKapisi.test.ts — `/api/mikro/*` uçlarının ROL KAPISI çiti + davranışı (2026-10-10).
 *
 * Ölçülen açık: 31 uç yalnız kimlik (± MFA) taşıyordu — `requireAuth` «oturum açmış» der (B2B / Bayi dâhil),
 * `requireMfaVerified` MFA kurmamış hesabı geçirir; ikisi de rol kapısı değildir. Dış rollü kullanıcı Mikro'ya cari hareket /
 * tahsilat / yevmiye / stok / cari yazabiliyor, e-Arşiv iptal edebiliyor, Mikro verisini okuyabiliyordu.
 *
 * ÜÇ KATMAN, TEK TABLO (`BEKLENEN`):
 *   Ç — kaynak çiti: her kayıt rol kapısı taşır ya da ADIYLA istisnadır; kapısız yeni uç eklenince KIRILIR.
 *   D — davranış: gerçek express + ÜRETİM zinciri (halkalar ve sıraları mikroRoutes'tan gelir); işleyicinin yerine nöbetçi
 *       konur, Mikro'ya ve veritabanına hiç gidilmez. Kapılar server.ts gövdelerinin İKİZİDİR (Ç11 gövdeleri kilitler).
 *   K — kilit değişmezi (Ç13 / Ç14 / D10). İlk tur (2026-10-10) kimseyi kilitlemedi. KARAR TURU (2026-10-11, şartname § 10)
 *       BİLEREK kilitler; değişmez artık «ÖLÜ DÜĞME YOK»: düğmeyi / çağrıyı gören her rol kapıdan geçer (`EKRANI_GOREN`),
 *       kilitlenen roller ADIYLA tablodadır (`KARAR_KILIDI`) ve o rollerde düğme çizilmez, çağrı yapılmaz (İ3).
 *   O — ortak tablo (Ç16, evrak tablosu): istemci «bu rol geçer mi» sorusunu sunucunun kapısıyla AYNI tablodan sorar
 *       (`src/lib/mikroUcKapilari.ts`, `src/lib/mikroEvrakKapilari.ts`); tablo ↔ BEKLENEN ↔ rota satırı zinciri burada kilitlenir.
 *
 * TABLOLAR ELLE YAZILIR (rbac.ts'ten TÜRETİLMEZ): kural ya da ekran değişince bu test BİLİNÇLİ güncellenir.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express, { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import http from 'node:http';
import { join } from 'path';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroRoutes } from './mikroRoutes.js';
import { mikroPost, mikroSql } from '../mikroClient.js';
import {
  ADMIN_ONLY_COLLECTIONS, APP_ROLES, EXTERNAL_ROLES, STAFF_ROLES, hasExplicitRule, isAllowed, type AppRole, type DbOp,
} from '../../lib/rbac.js';
import { MIKRO_EVRAK_KAPILARI, evrakKapiKosullari, evrakKapisindanGecer, evrakYontemi, type EvrakKapisi } from '../../lib/mikroEvrakKapilari.js';
import * as ucKapilariModulu from '../../lib/mikroUcKapilari.js';
import { MIKRO_UC_KAPILARI, ucKapisindanGecer, type MikroKapiliUc } from '../../lib/mikroUcKapilari.js';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari, oku } from '../../test/kaynakTarama';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(async () => ({ ok: true, status: 200, data: { result: [{ IsError: false, Data: {} }] } })),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
    v17MetoduKullanilabilir: vi.fn(async () => true),
    mikroSql: vi.fn(async () => ({ rows: [] as Record<string, unknown>[], hata: null })),
    mikroKolonlar: vi.fn(async () => [] as string[]),
  };
});

// ════════════════════════════════════════════════════════════════════════════
// TABLOLAR
// ════════════════════════════════════════════════════════════════════════════

type Kapi = 'ops' | 'staff' | 'staff+orders:write' | 'govde:cari' | 'govde:evrak' | `${string}:${DbOp}`;

const P = '/api/mikro';
/** mikroRoutes.ts'teki HER kayıt (13 fabrika ucu dâhil). Yeni uç buraya BİLİNÇLİ girer — kapısıyla birlikte.
 *  `// K#` = karar turunda (2026-10-11, şartname § 10.1 + § 10.4 hükümleri) kapısı değişen uç. */
const BEKLENEN: Record<string, Kapi> = {
  // ── İstisna: ops jetonu kapılı tanı uçları (zincir boş; ilk satır opsJetonuGecerli) ──
  [`GET ${P}/sema-kesif`]: 'ops',
  [`GET ${P}/iskonto-tutarsizlik`]: 'ops',
  [`GET ${P}/birim-sapmasi`]: 'ops',
  [`GET ${P}/ebelge-durum-tani`]: 'ops',
  [`GET ${P}/seri-ozet`]: 'ops',
  [`GET ${P}/matrah-tani`]: 'ops',
  [`GET ${P}/fatura-tani`]: 'ops',
  [`GET ${P}/ebelge-tani`]: 'ops',
  // ── Yalnız iç personel ──
  [`GET ${P}/status`]: 'staff',
  [`POST ${P}/fatura/kalemler`]: 'staff',
  [`POST ${P}/fatura/kaydet`]: 'staff',
  [`GET ${P}/ebelge/mukellef/:vkn`]: 'staff',
  // ── İç personel + ince kapı (kural dış rol içerdiği için ikisi birlikte) ──
  [`POST ${P}/siparis/kaydet`]: 'staff+orders:write',
  [`POST ${P}/import/faturadan-siparis`]: 'staff+orders:write',
  // ── Gövdeye bağlı ──
  [`POST ${P}/cari/kaydet`]: 'govde:cari',
  [`POST ${P}/evrak/kaydet`]: 'govde:evrak',
  // ── Sabit ince kapı ──
  [`POST ${P}/cari/listesi`]: 'leads:write',                       // K1 — arama dâhil iki dal da (gövdeye bağlı kapı kalktı)
  [`POST ${P}/cari/ara`]: 'leads:read',                            // A1 (2026-10-17) — salt okuyan cari araması (İ2)
  [`POST ${P}/pull/uretim-receteleri`]: 'bom:write',               // K5
  [`POST ${P}/ebelge/gelen`]: 'eBelgeler:write',                   // K6
  [`POST ${P}/ebelge/giden`]: 'eBelgeler:write',                   // K6
  [`POST ${P}/ebelge/eirsaliye`]: 'eBelgeler:write',               // K6
  [`POST ${P}/ebelge/pdf`]: 'mikroFaturalar:read',                 // K7 / H1 — iki yönde de tek sabit kapı
  [`POST ${P}/ebelge/xml`]: 'mikroFaturalar:read',                 // K7 / H1
  [`GET ${P}/tablolar`]: 'settings:read',
  [`POST ${P}/stok/kaydet`]: 'inventory:write',
  [`POST ${P}/stok/listesi`]: 'inventory:write',
  [`POST ${P}/import/stok`]: 'inventory:write',
  [`POST ${P}/import/stok-miktar`]: 'inventory:write',
  [`POST ${P}/import/cari`]: 'leads:write',
  [`POST ${P}/pull/cari-adres`]: 'leads:write',
  [`POST ${P}/import/siparis`]: 'mikroSiparisler:write',
  [`POST ${P}/import/fatura-listesi`]: 'mikroFaturalar:write',
  [`POST ${P}/import/iptal-faturalar`]: 'mikroIptalFaturalar:write',
  [`POST ${P}/import/cari-hareket`]: 'mikroCariHareketler:write',
  [`POST ${P}/import/stok-hareket`]: 'inventoryMovements:write',
  [`POST ${P}/import/banka`]: 'mikroBankalar:write',
  [`POST ${P}/import/kasa`]: 'mikroKasalar:write',
  [`POST ${P}/import/odeme-plan`]: 'odemePlanlari:write',
  [`POST ${P}/import/depo`]: 'mikroDepolar:write',
  [`POST ${P}/import/barkod`]: 'barkodlar:write',
  [`POST ${P}/import/fiyat`]: 'mikroFiyatListeleri:write',
  [`POST ${P}/import/demirbas`]: 'mikroDemirbaslar:write',
  [`POST ${P}/import/maliyet-merkezi`]: 'mikroMaliyetMerkezleri:write',
  [`POST ${P}/import/gib-durum`]: 'mikroFaturalar:write',
  [`POST ${P}/import/faturalar`]: 'mikroFaturalar:write',
  [`POST ${P}/gelen-fatura/kabul`]: 'mikroFaturalar:write',
  [`POST ${P}/gelen-fatura/ret`]: 'mikroFaturalar:write',
  [`POST ${P}/tamir/ham-satir-temizle`]: 'bankAccounts:delete',    // K8 — DEĞİŞMEDİ
  [`GET ${P}/cari-hareket/turler`]: 'mikroCariHareketler:read',    // K2
  [`GET ${P}/cari-hareket/:cariKod`]: 'mikroCariHareketler:read',
  [`POST ${P}/cari-hareket/kaydet`]: 'mikroCariHareketler:write',
  [`POST ${P}/yevmiye/kaydet`]: 'journalEntries:write',
  [`POST ${P}/tahsilat/kaydet`]: 'kasaHareketleri:write',          // K9 — DEĞİŞMEDİ (Satış'a tahsilat gönderimi açılmaz)
  [`POST ${P}/pull/kdv`]: 'taxSummary:write',
  [`POST ${P}/pull/personel`]: 'employees:write',                  // K4
  [`POST ${P}/pull/bakiye`]: 'cariBalances:write',
  [`POST ${P}/pull/mizan`]: 'accountingPeriods:write',
  [`POST ${P}/siparis/sil`]: 'orders:delete',
  [`POST ${P}/ebelge/durum`]: 'eBelgeler:write',
  [`POST ${P}/ebelge/earsiv-iptal`]: 'eBelgeler:write',
  [`POST ${P}/irsaliye/kaydet`]: 'shipments:write',
};

const IC: AppRole[] = ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR', 'Purchasing', 'Legal', 'Corporate', 'Quality'];
/** Kapıdan geçen roller. ELLE yazılır; gerçek kuralla eşitliğini Ç10 sınar (kural değişince bu tablo bilinçli güncellenir). */
const GECEN: Record<string, AppRole[]> = {
  staff: IC,
  'staff+orders:write': ['Admin', 'Manager', 'Sales', 'Logistics'],
  'settings:read': ['Admin', 'Manager'],
  'inventory:write': ['Admin', 'Manager', 'Logistics', 'Purchasing'],
  'leads:write': ['Admin', 'Manager', 'Sales'],
  'leads:read': ['Admin', 'Manager', 'Sales', 'Accounting', 'Purchasing'],
  'suppliers:write': ['Admin', 'Manager', 'Purchasing'],
  'mikroSiparisler:write': ['Admin', 'Manager'],
  'mikroFaturalar:write': ['Admin', 'Manager', 'Accounting'],
  'mikroFaturalar:read': ['Admin', 'Manager', 'Accounting'],
  'mikroIptalFaturalar:write': ['Admin', 'Manager', 'Accounting'],
  'mikroCariHareketler:write': ['Admin', 'Manager', 'Accounting'],
  'mikroCariHareketler:read': ['Admin', 'Manager', 'Accounting'],
  'inventoryMovements:write': ['Admin', 'Manager', 'Logistics', 'Purchasing'],
  'mikroBankalar:write': ['Admin', 'Manager'],
  'mikroKasalar:write': ['Admin', 'Manager'],
  'odemePlanlari:write': ['Admin', 'Manager', 'Accounting'],
  'mikroDepolar:write': ['Admin', 'Manager'],
  'barkodlar:write': ['Admin', 'Manager', 'Logistics'],
  'mikroFiyatListeleri:write': ['Admin', 'Manager', 'Accounting'],
  'mikroDemirbaslar:write': ['Admin', 'Manager', 'Accounting'],
  'mikroMaliyetMerkezleri:write': ['Admin', 'Manager', 'Accounting'],
  'bankAccounts:delete': ['Admin', 'Manager'],
  'journalEntries:write': ['Admin', 'Accounting'],
  'kasaHareketleri:write': ['Admin', 'Manager', 'Accounting'],
  'taxSummary:write': ['Admin', 'Manager', 'Accounting'],
  'employees:write': ['Admin', 'HR'],
  'bom:write': ['Admin', 'Manager', 'Logistics', 'Purchasing'],
  'cariBalances:write': ['Admin', 'Manager', 'Accounting'],
  'accountingPeriods:write': ['Admin', 'Manager', 'Accounting'],
  'orders:delete': ['Admin', 'Manager'],
  'eBelgeler:write': ['Admin', 'Manager', 'Accounting'],
  'shipments:write': ['Admin', 'Manager', 'Logistics'],
  // ── yalnız evrak/kaydet yöntem tablosunda geçenler ──
  'servisTalepleri:write': ['Admin', 'Manager', 'Logistics', 'Sales'],
  'purchaseOrders:write': ['Admin', 'Manager', 'Purchasing'],
  'stockCountSessions:write': ['Admin', 'Manager', 'Logistics'],
  'leaveRequests:write': ['Admin', 'Manager', 'HR'],
  'isEmirleri:write': ['Admin', 'Manager', 'Logistics'],
  'routingTemplates:write': ['Admin', 'Manager', 'Logistics', 'Quality'],
  'wmsCycleCounts:write': ['Admin', 'Manager', 'Logistics'],
  'productionOrders:write': ['Admin', 'Manager', 'Logistics', 'Quality'],
  'transfers:write': ['Admin', 'Manager', 'Logistics'],
  // İç personel + `quotations` yazma (H4): kural B2B / Bayi'yi de geçirir → dış roller iç personel şartında kalır.
  'staff+quotations:write': ['Admin', 'Manager', 'Sales'],
};

/** `evrak/kaydet` yöntemi → kapı etiketi. ELLE yazılır; kaynak tabloyla (src/lib/mikroEvrakKapilari.ts) eşitliği sınanır.
 *  `// K3-x` = karar turunda (şartname § 10.1) `'staff'`tan ince kapıya inen 11 yöntem + dekont. */
const EVRAK_BEKLENEN: Record<string, string> = {
  DekontKaydetV2: 'mikroCariHareketler:write',                   // K3-a
  ZiyaretKaydetV2: 'leads:write',
  ServisIsEmriKaydetV2: 'servisTalepleri:write',
  ServisFormuKaydetV2: 'servisTalepleri:write',
  ServisMalzemePlanKaydetV2: 'servisTalepleri:write',
  ServisRotaPlanKaydetV2: 'servisTalepleri:write',
  AlinanTeklifKaydetV2: 'purchaseOrders:write',
  SayimKesinlestirmeV2: 'stockCountSessions:write',
  PersonelizinKaydetV2: 'leaveRequests:write',
  PersonelKaydetV2: 'employees:write',
  BakimHareketleriKaydetV2: 'isEmirleri:write',
  BakimSarfiyatlariKaydetV2: 'isEmirleri:write',
  BakimSozlesmeKaydetV2: 'isEmirleri:write',
  UrunRotaKaydetV2: 'routingTemplates:write',
  UretimRotaPlanKaydetV2: 'routingTemplates:write',
  VerilenTeklifKaydetV2: 'staff+quotations:write',               // K3-b / H4 — iç rol VE kural (düz `quotations:write` YAZILMAZ)
  DahiliStokHareketKaydetV2: 'inventoryMovements:write',         // K3-c
  SayimSonuclariKaydetV2: 'wmsCycleCounts:write',                // K3-d
  EtiketBasimKaydetV2: 'staff',                                  // K3-e — KALIR (eşdeğer koleksiyon yok)
  PersonelIzinTalepKaydetV2: 'leaveRequests:write',              // K3-f
  UrunReceteKaydetV2: 'bom:write',                               // K3-g
  UretimTalepKaydetV2: 'productionOrders:write',                 // K3-h
  UretimIsEmriOlusturV2: 'productionOrders:write',               // K3-h
  SatinAlmaTalepKaydetV2: 'purchaseOrders:write',                // K3-i
  BakimTalepKaydetV2: 'isEmirleri:write',                        // K3-j
  DepolarArasiSiparisKaydetV2: 'transfers:write',                // K3-k
};

/** Ortak uç tablosu (src/lib/mikroUcKapilari.ts) → kapı etiketi. ELLE yazılır; Ç16 hem tabloyla hem BEKLENEN'le eşitliğini sınar. */
const UC_TABLOSU_BEKLENEN: Record<string, string> = {
  [`POST ${P}/cari/listesi`]: 'leads:write',                       // K1
  [`POST ${P}/cari/ara`]: 'leads:read',                            // A1 — iki «Mikro'da ara» kutusu sorar
  [`GET ${P}/cari-hareket/turler`]: 'mikroCariHareketler:read',    // K2
  [`POST ${P}/pull/personel`]: 'employees:write',                  // K4
  [`POST ${P}/pull/uretim-receteleri`]: 'bom:write',               // K5
  [`POST ${P}/ebelge/gelen`]: 'eBelgeler:write',                   // K6
  [`POST ${P}/ebelge/giden`]: 'eBelgeler:write',
  [`POST ${P}/ebelge/eirsaliye`]: 'eBelgeler:write',
  [`POST ${P}/ebelge/pdf`]: 'mikroFaturalar:read',                 // K7 / H1
  [`POST ${P}/ebelge/xml`]: 'mikroFaturalar:read',
  [`POST ${P}/tahsilat/kaydet`]: 'kasaHareketleri:write',          // K9
};

const gecenRoller = (etiket: string): AppRole[] => {
  const r = GECEN[etiket];
  if (!r) throw new Error(`GECEN tablosunda '${etiket}' yok — kapıyı tabloya ekle.`);
  return r;
};
const sirali = (a: readonly string[]): string[] => [...a].sort();
const opsMu = (anahtar: string): boolean => BEKLENEN[anahtar] === 'ops';
const KAPILI = Object.keys(BEKLENEN).filter(a => !opsMu(a));
// MFA halkası isteğe bağlı DEĞİL: MFA'sız uçlar ADIYLA sayılır (Ç3 iki yönlü kilitler — listeye uç eklemek de çıkarmak da bu satırı değiştirir).
const MFASIZ = new Set<string>([
  'GET /api/mikro/tablolar',
  'GET /api/mikro/status',
  'POST /api/mikro/fatura/kalemler',
  'GET /api/mikro/cari-hareket/turler',
  'GET /api/mikro/cari-hareket/:cariKod',
  'GET /api/mikro/ebelge/mukellef/:vkn',
]);

// ── İ3: düğmeyi / çağrıyı gören roller (ölü düğme değişmezi) ─────────────────
// Sekmeyi gören İÇ roller (App.tsx TAB_PERMISSIONS, tam + salt okunur). Elle yazılır.
const AYARLAR: AppRole[] = ['Admin', 'Manager'];                                                   // settings — Mikro paneli (Ç14)
const MUHASEBE: AppRole[] = ['Admin', 'Accounting', 'Manager'];
const CRM: AppRole[] = ['Admin', 'Manager', 'Sales', 'Accounting', 'Purchasing'];                  // crm, orders
const STOK: AppRole[] = ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Accounting', 'Sales'];    // inventory, lojistik
const SATIN_ALMA: AppRole[] = ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Accounting'];
const EBELGE: AppRole[] = ['Admin', 'Accounting', 'Manager'];                                      // H2: Satış ve Lojistik sekmeyi kaybetti (Ç17)
const birlesim = (...kumeler: AppRole[][]): AppRole[] => [...new Set(kumeler.flat())];

/** Ayarlar → Mikro panelinden çağrılan uçlar (MikroSyncPanel kartları ve düğmeleri). */
const AYARLAR_PANELI = [
  'import/stok', 'import/cari', 'import/stok-miktar', 'import/gib-durum', 'import/faturadan-siparis', 'tamir/ham-satir-temizle',
  'pull/kdv', 'pull/bakiye', 'pull/cari-adres', 'pull/mizan', 'gelen-fatura/kabul', 'gelen-fatura/ret',
  'import/siparis', 'import/fatura-listesi', 'import/iptal-faturalar', 'import/cari-hareket', 'import/stok-hareket', 'import/banka',
  'import/kasa', 'import/odeme-plan', 'import/depo', 'import/barkod', 'import/fiyat', 'import/demirbas', 'import/maliyet-merkezi',
];
/**
 * İ3 (karar turu 2026-10-11): ucu çağıran DÜĞMEYİ gören / sessiz çağrıyı YAPAN iç roller — karar turundan SONRA.
 * Ekranı görüp kapıdan geçemeyen rol burada YOKTUR: o rolde düğme çizilmez, çağrı yapılmaz (kilitlenenler `KARAR_KILIDI`'nda).
 * Elle yazılır; ekran başka role açılınca BİLİNÇLİ güncellenir. Gövdeye bağlı uçlar DAL başına ayrı anahtar taşır (`#…`).
 * «Önce Cetpa'ya yazan» çağıranlarda küme, o yazımı başarabilen rollerdir (yazım 403'te fırlatır, Mikro çağrısına ulaşılmaz).
 */
const EKRANI_GOREN: Record<string, AppRole[]> = {
  ...Object.fromEntries(AYARLAR_PANELI.map(u => [`POST ${P}/${u}`, AYARLAR])),
  [`GET ${P}/status`]: birlesim(AYARLAR, EBELGE),
  [`POST ${P}/cari/kaydet#leads`]: ['Admin', 'Manager', 'Sales'],            // sipariş penceresi: `orders` yazıp `leads` okuyabilen
  [`POST ${P}/cari/kaydet#suppliers`]: ['Admin', 'Manager', 'Purchasing'],   // Satın Alma: `suppliers` yazımından sonra
  [`POST ${P}/siparis/kaydet`]: ['Admin', 'Manager', 'Sales'],               // sipariş yazımından sonra, müşteri seçiliyken
  [`POST ${P}/fatura/kalemler`]: birlesim(MUHASEBE, CRM, SATIN_ALMA, STOK),  // Fatura Detayı penceresi
  [`POST ${P}/fatura/kaydet`]: birlesim(CRM, STOK),                          // Siparişler ekranı (orders + lojistik sekmeleri)
  [`GET ${P}/cari-hareket/turler`]: ['Admin', 'Manager', 'Accounting'],      // K2 — dekont penceresi açılışı (pencereyi açan düğme: K3-a)
  [`GET ${P}/cari-hareket/:cariKod`]: birlesim(MUHASEBE, CRM, SATIN_ALMA),   // cari ekstre paneli
  [`POST ${P}/tahsilat/kaydet`]: ['Admin', 'Accounting'],                    // K9 — Muhasebe → Tahsilat, yalnız tam yetkili
  [`POST ${P}/pull/personel`]: ['Admin', 'HR'],                              // K4 / H5 — Ayarlar kartı + «Tümünü Çek» adımı + İK düğmesi + İK ekranı açılışı
  [`POST ${P}/pull/uretim-receteleri`]: ['Admin', 'Manager', 'Logistics', 'Purchasing'],   // K5 — Ayarlar kartı + Üretim ekranı açılışı
  [`POST ${P}/siparis/sil`]: ['Admin', 'Manager'],                           // sil düğmesi `orders` silme kuralına bağlı
  [`POST ${P}/ebelge/gelen`]: EBELGE,                                        // K6 — e-Belge Merkezi «çek» düğmeleri
  [`POST ${P}/ebelge/giden`]: EBELGE,
  [`POST ${P}/ebelge/eirsaliye`]: EBELGE,
  [`POST ${P}/ebelge/pdf`]: ['Admin', 'Manager', 'Accounting'],              // K7 / H1 — Fatura Detayı + e-Belge Merkezi indirme düğmeleri
  [`POST ${P}/ebelge/xml`]: ['Admin', 'Manager', 'Accounting'],
  [`POST ${P}/irsaliye/kaydet`]: ['Admin', 'Manager', 'Logistics'],          // düğme `shipments` yazma kuralına bağlı
  // A1 — iki «Mikro'da ara» kutusu: Satın Alma tedarikçi seçimi (`suppliers` yazan: Yönetici, Müdür, Satın Alma) ∪ CRM aday
  // ayrıntısı (`leads` yazan: Yönetici, Müdür, Satış). Uca geçip yazamayan rolde (Muhasebe; CRM'de Satın Alma) kutu çizilmez.
  [`POST ${P}/cari/ara`]: ['Admin', 'Manager', 'Purchasing', 'Sales'],
  // ── evrak/kaydet: çağıranı olan 14 yöntem (düğmelerin tek bileşeni MikroPushButton kendini yöntem kapısına göre çizer — H7) ──
  [`POST ${P}/evrak/kaydet#VerilenTeklifKaydetV2`]: ['Admin', 'Manager', 'Sales'],                       // K3-b — B2B Portalı; dış rolde düğme GİZLİ (Ç15)
  [`POST ${P}/evrak/kaydet#DekontKaydetV2`]: ['Admin', 'Manager', 'Accounting'],                         // K3-a — Müşteriler sekmesi «Mikro» düğmesi
  [`POST ${P}/evrak/kaydet#DahiliStokHareketKaydetV2`]: ['Admin', 'Manager', 'Logistics', 'Purchasing'], // K3-c
  [`POST ${P}/evrak/kaydet#SayimSonuclariKaydetV2`]: ['Admin', 'Manager', 'Logistics'],                  // K3-d — `wmsCycleCounts` yazımından sonra (sessiz çağrı)
  [`POST ${P}/evrak/kaydet#EtiketBasimKaydetV2`]: STOK,                                                  // K3-e — etiket penceresi Stok ekranından açılır
  [`POST ${P}/evrak/kaydet#PersonelIzinTalepKaydetV2`]: ['Admin', 'Manager', 'HR'],                      // K3-f
  [`POST ${P}/evrak/kaydet#UrunReceteKaydetV2`]: ['Admin', 'Manager', 'Logistics', 'Purchasing'],        // K3-g
  [`POST ${P}/evrak/kaydet#UretimTalepKaydetV2`]: ['Admin', 'Manager', 'Logistics', 'Quality'],          // K3-h — Üretim + MRP
  [`POST ${P}/evrak/kaydet#UretimIsEmriOlusturV2`]: ['Admin', 'Manager', 'Logistics', 'Quality'],        // K3-h
  [`POST ${P}/evrak/kaydet#SatinAlmaTalepKaydetV2`]: ['Admin', 'Manager', 'Purchasing'],                 // K3-i — Satın Alma + MRP
  [`POST ${P}/evrak/kaydet#ServisIsEmriKaydetV2`]: ['Admin', 'Manager', 'Sales', 'Logistics'],           // servis sekmesi
  [`POST ${P}/evrak/kaydet#BakimTalepKaydetV2`]: ['Admin', 'Manager', 'Logistics'],                      // K3-j — bakim sekmesi
  [`POST ${P}/evrak/kaydet#DepolarArasiSiparisKaydetV2`]: ['Admin', 'Manager', 'Logistics'],             // K3-k
  [`POST ${P}/evrak/kaydet#ZiyaretKaydetV2`]: ['Admin', 'Manager', 'Sales'],                             // `leads` yazımından sonra
};
/** İstemcide çağıranı OLMAYAN uçlar / gövde dalları — kilitlenecek kimse yok. Çağıran eklenince `EKRANI_GOREN`'e taşınır.
 *  `cari/listesi` (K1 / H3): arama artık `cari/ara`'da (A1, 2026-10-17) — iki «Mikro'da ara» kutusu onu çağırır; bu ucun
 *  istemcide çağıranı kalmadı. */
const CAGIRANI_YOK: string[] = [
  `GET ${P}/tablolar`, `POST ${P}/stok/kaydet`, `POST ${P}/stok/listesi`, `POST ${P}/cari/listesi`,
  `POST ${P}/cari-hareket/kaydet`, `POST ${P}/yevmiye/kaydet`, `POST ${P}/import/faturalar`, `POST ${P}/ebelge/durum`,
  `GET ${P}/ebelge/mukellef/:vkn`, `POST ${P}/ebelge/earsiv-iptal`,
  ...['AlinanTeklifKaydetV2', 'SayimKesinlestirmeV2', 'PersonelizinKaydetV2', 'PersonelKaydetV2', 'BakimHareketleriKaydetV2',
    'BakimSarfiyatlariKaydetV2', 'BakimSozlesmeKaydetV2', 'ServisFormuKaydetV2', 'ServisMalzemePlanKaydetV2', 'ServisRotaPlanKaydetV2',
    'UrunRotaKaydetV2', 'UretimRotaPlanKaydetV2'].map(y => `POST ${P}/evrak/kaydet#${y}`),
];
/**
 * KİLİTLENENLER TABLOSU — karar turunun (2026-10-11) BİLEREK kilitlediği iç roller: şartname § 10.1 «Kilitlenen» sütunu,
 * § 10.4 hükümleriyle (H1: PDF / XML'de Satış iki yönde de kilitli). ELLE yazılır, K numarasıyla.
 * Bu roller ucun düğmesini ilk turda görüyordu; artık düğme çizilmez / çağrı yapılmaz (İ3) ve doğrudan istek 403 alır (D10).
 * Satır eklemek ya da çıkarmak KULLANICI KARARIDIR (kapı genişlerse Ç13 «kilitli rol geçiyor» diye kırılır).
 */
const KARAR_KILIDI: Record<string, AppRole[]> = {
  [`POST ${P}/cari/listesi`]: ['Purchasing', 'Logistics', 'Accounting'],                                   // K1
  [`GET ${P}/cari-hareket/turler`]: ['Sales', 'Purchasing'],                                               // K2
  [`POST ${P}/evrak/kaydet#DekontKaydetV2`]: ['Sales', 'Purchasing'],                                      // K3-a
  [`POST ${P}/evrak/kaydet#VerilenTeklifKaydetV2`]: ['Accounting'],                                        // K3-b (B2B / Bayi ilk turda kapandı)
  [`POST ${P}/evrak/kaydet#DahiliStokHareketKaydetV2`]: ['Accounting'],                                    // K3-c
  [`POST ${P}/evrak/kaydet#PersonelIzinTalepKaydetV2`]: ['Accounting'],                                    // K3-f
  [`POST ${P}/evrak/kaydet#UrunReceteKaydetV2`]: ['Quality'],                                              // K3-g
  [`POST ${P}/evrak/kaydet#UretimTalepKaydetV2`]: ['Purchasing', 'Accounting'],                            // K3-h
  [`POST ${P}/evrak/kaydet#UretimIsEmriOlusturV2`]: ['Purchasing', 'Accounting'],                          // K3-h
  [`POST ${P}/evrak/kaydet#SatinAlmaTalepKaydetV2`]: ['Logistics', 'Accounting', 'Quality'],               // K3-i
  [`POST ${P}/evrak/kaydet#BakimTalepKaydetV2`]: ['Purchasing'],                                           // K3-j
  [`POST ${P}/evrak/kaydet#DepolarArasiSiparisKaydetV2`]: ['Purchasing', 'Accounting', 'Sales'],           // K3-k
  [`POST ${P}/pull/personel`]: ['Manager', 'Accounting'],                                                  // K4
  [`POST ${P}/pull/uretim-receteleri`]: ['Quality'],                                                       // K5
  [`POST ${P}/ebelge/gelen`]: ['Sales', 'Logistics'],                                                      // K6
  [`POST ${P}/ebelge/giden`]: ['Sales', 'Logistics'],
  [`POST ${P}/ebelge/eirsaliye`]: ['Sales', 'Logistics'],
  [`POST ${P}/ebelge/pdf`]: ['Sales', 'Logistics', 'Purchasing'],                                          // K7 / H1
  [`POST ${P}/ebelge/xml`]: ['Sales', 'Logistics', 'Purchasing'],
};
/** Karar turundan ÖNCE de var olan kilitler — ADIYLA. Buraya satır eklemek kullanıcı kararıdır.
 *  Cari ekstre paneli Satış / Satın Alma / Lojistik'te boş kalıyor (uç 2026-08'den beri `mikroCariHareketler` okuma kapılı). */
const BILINEN_KILIT: Record<string, AppRole[]> = {
  [`GET ${P}/cari-hareket/:cariKod`]: ['Sales', 'Purchasing', 'Logistics'],
};
/** Gövdeye bağlı uçların dalları → o dalın etkin kapı etiketi. */
const DAL_KAPISI: Record<string, string> = {
  [`POST ${P}/cari/kaydet#leads`]: 'leads:write',
  [`POST ${P}/cari/kaydet#suppliers`]: 'suppliers:write',
  ...Object.fromEntries(Object.entries(EVRAK_BEKLENEN).map(([y, k]) => [`POST ${P}/evrak/kaydet#${y}`, k])),
};
/** Gövdesiz / boş gövdeli istekte gövdeye bağlı kapının düştüğü dal (D1–D3 matrisi boş gövdeyle koşar). */
const BOS_GOVDE_DALI: Record<string, string> = { 'govde:cari': 'leads:write', 'govde:evrak': 'staff' };
const etkinEtiket = (anahtar: string): string => {
  const k = BEKLENEN[anahtar];
  return BOS_GOVDE_DALI[k] ?? k;
};
/** Uç ya da gövde dalı (`…#dal`) anahtarının etkin kapı etiketi. */
const dalEtiketi = (anahtar: string): string => DAL_KAPISI[anahtar] ?? BEKLENEN[anahtar];
/** Kapı etiketinin iki koşulu: `staff` = iç personel; `k:e` = koleksiyon kuralı; `staff+k:e` = ikisi birlikte. */
const etiketKosullari = (etiket: string): { icRol: boolean; kural: [string, DbOp] | null } => {
  if (etiket === 'staff') return { icRol: true, kural: null };
  const m = /^(staff\+)?([A-Za-z]+):(read|write|delete)$/.exec(etiket);
  if (!m) throw new Error(`tanınmayan kapı etiketi: ${etiket}`);
  return { icRol: !!m[1], kural: [m[2], m[3] as DbOp] };
};

// ════════════════════════════════════════════════════════════════════════════
// KAYNAK ÇİTİ
// ════════════════════════════════════════════════════════════════════════════

const MIKRO = join(SRC_KOK, 'server', 'routes', 'mikroRoutes.ts');
const SERVER = join(SRC_KOK, '..', 'server.ts');
const kod = kodSatirlari(MIKRO).map(s => ({ n: s.n, kod: s.kod.trim() }));
const serverKod = kodSatirlari(SERVER).map(s => s.kod.trim());
const adet = (satirlar: string[], tam: string): number => satirlar.filter(k => k === tam).length;
const mikroSatir = kod.map(s => s.kod);

const KAYIT = /\bapp\.(get|post|put|patch|delete|all|use|route)\(/;
const HALKA = String.raw`C\.requireAuth|C\.requireMfaVerified|C\.requireStaff|C\.mikroLimiter|cariHedefKapisi|evrakYontemKapisi|C\.requireCollectionAccess\((?:'[A-Za-z]+'|opts\.collection), '(?:read|write|delete)'\)`;
/** BAŞTAN SONA çapalı: tanınmayan halka, adlandırılmış işleyici, `async function`, değişkenli yol → eşleşmez. */
const BASLIK = new RegExp(String.raw`^app\.(get|post)\((?:'(\/api\/mikro\/[A-Za-z0-9/:-]+)'|(opts\.route))((?:, (?:${HALKA}))*), async \(_?req: Request, res: Response\) => \{$`);
const HALKA_AYIR = new RegExp(`, (${HALKA})`, 'g');
const ROL_HALKASI = /^(?:C\.requireStaff|cariHedefKapisi|evrakYontemKapisi|C\.requireCollectionAccess\(.+\))$/;

interface Kayit { n: number; baslik: string; yontem: string; yol: string | null; fabrika: boolean; halkalar: string[]; sonraki: string }
/** Her kayıt satırından `=> {` ile biten satıra kadar birleştirilmiş başlık. Başlık bir sonraki kayıt satırını AŞAMAZ. */
function kayitlar(): Kayit[] {
  const out: Kayit[] = [];
  for (let i = 0; i < kod.length; i++) {
    if (!KAYIT.test(kod[i].kod)) continue;
    let j = i;
    let baslik = kod[i].kod;
    while (!baslik.endsWith('=> {')) {
      j++;
      if (j >= kod.length || KAYIT.test(kod[j].kod)) throw new Error(`${gorece(MIKRO)}:${kod[i].n} kaydının başlığı '=> {' ile bitmeden başka kayda taştı: ${baslik}`);
      if (kod[j].kod) baslik += ` ${kod[j].kod}`;
    }
    const m = BASLIK.exec(baslik);
    if (!m) throw new Error(`${gorece(MIKRO)}:${kod[i].n} kayıt başlığı tanınmıyor (yol sabit dize olmalı, halkalar bilinen kümeden, işleyici satır içi ok işlevi): ${baslik}`);
    let s = j + 1;
    while (s < kod.length && !kod[s].kod) s++;
    out.push({
      n: kod[i].n, baslik, yontem: m[1].toUpperCase(), yol: m[2] ?? null, fabrika: !!m[3],
      halkalar: [...m[4].matchAll(HALKA_AYIR)].map(x => x[1]), sonraki: kod[s]?.kod ?? '',
    });
  }
  return out;
}
/** Başlıktaki halkalardan kapı etiketi (BEKLENEN ile karşılaştırılır). Kural dışı dizilim fırlatır. */
function etiketCikar(k: Kayit): string {
  const h = [...k.halkalar];
  if (h.shift() !== 'C.requireAuth') throw new Error(`${k.baslik}: ilk halka C.requireAuth değil`);
  if (h[0] === 'C.requireMfaVerified') h.shift();
  if (h[h.length - 1] === 'C.mikroLimiter') h.pop();
  if (h.length === 0) throw new Error(`KAPISIZ UÇ — ${gorece(MIKRO)}:${k.n} rol kapısı taşımıyor: ${k.baslik}`);
  const tanimsiz = h.filter(x => !ROL_HALKASI.test(x));
  if (tanimsiz.length) throw new Error(`${k.baslik}: zincir sırası bozuk (kimlik → MFA → rol kapısı → hız sınırı) — rol kapısı yerinde: ${tanimsiz.join(', ')}`);
  const ince = (x: string) => /^C\.requireCollectionAccess\((?:'([A-Za-z]+)'|opts\.collection), '(read|write|delete)'\)$/.exec(x);
  if (h.length === 2) {
    if (h[0] === 'C.requireStaff' && h[1] === "C.requireCollectionAccess('orders', 'write')") return 'staff+orders:write';
    throw new Error(`${k.baslik}: iki rol halkasına yalnız requireStaff + orders yazma çiftinde izin var`);
  }
  if (h.length !== 1) throw new Error(`${k.baslik}: ${h.length} rol halkası`);
  if (h[0] === 'C.requireStaff') return 'staff';
  if (h[0] === 'cariHedefKapisi') return 'govde:cari';
  if (h[0] === 'evrakYontemKapisi') return 'govde:evrak';
  const m = ince(h[0]);
  if (!m) throw new Error(`${k.baslik}: tanınmayan rol halkası ${h[0]}`);
  return m[1] ? `${m[1]}:${m[2]}` : `fabrika:${m[2]}`;
}

describe('kaynak çiti — mikroRoutes.ts\'teki her kayıt rol kapısı taşır ya da adıyla istisnadır', () => {
  // Tembel: başlık tanınmazsa `kayitlar()` fırlatır — toplama anında değil TESTİN içinde fırlasın (davranış testleri koşmaya devam eder).
  let onbellek: Kayit[] | undefined;
  const K = (): Kayit[] => (onbellek ??= kayitlar());
  const yazili = (): Kayit[] => K().filter(k => !k.fabrika);
  const fabrika = (): Kayit[] => K().filter(k => k.fabrika);

  it('Ç1 — 51 kayıt (49 yazılı yol + 2 fabrika); `app` yalnız kayıt satırlarında ve imzada geçer (takma ad / devretme / app.route yok)', () => {
    expect(K()).toHaveLength(51);
    expect(yazili()).toHaveLength(49);
    expect(fabrika()).toHaveLength(2);
    const appGecen = kod.filter(s => /\bapp\b/.test(s.kod));
    expect(appGecen.map(s => s.kod).filter(k => !KAYIT.test(k))).toEqual(['export function mikroRoutes(app: Express, C: MikroRouteCtx): void {']);
    expect(appGecen).toHaveLength(K().length + 1);
    expect(mikroSatir.filter(k => /\bapp\.(put|patch|delete|all|use|route)\(/.test(k))).toEqual([]);
  });

  it('Ç2 — yazılı 49 yol + 13 fabrika rotası = BEKLENEN anahtar kümesi (62); fabrika tanımları rota ↔ koleksiyon eşli, ölü fabrika çağrılmıyor', () => {
    const cagri = kod.filter(s => s.kod === 'makeMikroSqlImport({').map(s => s.n);
    const rota = kod.flatMap(s => { const m = /^route: '(\/api\/mikro\/[a-z/-]+)',/.exec(s.kod); return m ? [{ n: s.n, yol: m[1] }] : []; });
    const koleksiyon = kod.flatMap(s => { const m = /^collection: '([A-Za-z]+)',/.exec(s.kod); return m ? [{ n: s.n, ad: m[1] }] : []; });
    expect(cagri).toHaveLength(13);
    expect(rota).toHaveLength(13);
    expect(koleksiyon).toHaveLength(13);
    expect(mikroSatir.filter(k => /\bmakeMikroListImport\(/.test(k))).toEqual(['function makeMikroListImport(opts: {']);
    // Her çağrı bloğunda TAM bir rota ve bir koleksiyon: çağrı < rota ≤ koleksiyon < sonraki çağrı.
    cagri.forEach((c, i) => {
      const sonraki = cagri[i + 1] ?? Infinity;
      expect(rota[i].n, `fabrika çağrısı :${c}`).toBeGreaterThan(c);
      expect(koleksiyon[i].n).toBeGreaterThanOrEqual(rota[i].n);
      expect(koleksiyon[i].n).toBeLessThan(sonraki);
      expect(BEKLENEN[`POST ${rota[i].yol}`], `${rota[i].yol} fabrika kapısı = tanımın koleksiyonu`).toBe(`${koleksiyon[i].ad}:write`);
    });
    const kaynaktaki = [...yazili().map(k => `${k.yontem} ${k.yol}`), ...rota.map(r => `POST ${r.yol}`)];
    expect(new Set(kaynaktaki).size).toBe(kaynaktaki.length);
    expect(sirali(kaynaktaki)).toEqual(sirali(Object.keys(BEKLENEN)));
    expect(Object.keys(BEKLENEN)).toHaveLength(62);
  });

  it('Ç3 / Ç4 / Ç5 — ops dışındaki her kayıt: kimlik → [MFA] → ROL KAPISI → [hız sınırı]; kapı metni BEKLENEN etiketiyle aynı', () => {
    for (const k of yazili()) {
      const anahtar = `${k.yontem} ${k.yol}`;
      if (opsMu(anahtar)) continue;
      expect(etiketCikar(k), anahtar).toBe(BEKLENEN[anahtar]);
      // MFA halkası isteğe bağlı DEĞİL: MFASIZ dışındaki her kayıtta ikinci halka MFA'dır.
      expect(k.halkalar[1] === 'C.requireMfaVerified', `${anahtar} — MFA halkası`).toBe(!MFASIZ.has(anahtar));
    }
    // Liste bayatlamasın: MFASIZ'daki her anahtar BEKLENEN'de bulunur.
    expect([...MFASIZ].filter(a => !(a in BEKLENEN))).toEqual([]);
    // İki fabrika kaydı (canlı SQL fabrikası + çağıranı olmayan ölü fabrika) AYNI zinciri taşır.
    for (const k of fabrika()) {
      expect(k.halkalar, `fabrika :${k.n}`).toEqual(['C.requireAuth', 'C.requireMfaVerified', "C.requireCollectionAccess(opts.collection, 'write')"]);
      expect(etiketCikar(k)).toBe('fabrika:write');
    }
  });

  it('Ç3 — kapısız kayıt çiti KIRAR (çit kendi desenini sınar: zincirden rol halkası çıkınca fırlatır)', () => {
    const ornek = yazili().find(k => k.yol === '/api/mikro/yevmiye/kaydet');
    if (!ornek) throw new Error('örnek kayıt yok');
    expect(() => etiketCikar({ ...ornek, halkalar: ['C.requireAuth', 'C.requireMfaVerified'] })).toThrow(/KAPISIZ UÇ/);
    expect(() => etiketCikar({ ...ornek, halkalar: ['C.requireAuth', 'C.mikroLimiter', 'C.requireStaff'] })).toThrow(/zincir sırası bozuk/);
    expect(() => etiketCikar({ ...ornek, halkalar: ['C.requireStaff', 'C.requireAuth'] })).toThrow(/ilk halka/);
    expect(() => etiketCikar({ ...ornek, halkalar: ['C.requireAuth', 'C.requireStaff', "C.requireCollectionAccess('leads', 'write')"] })).toThrow(/iki rol halkası/);
    // Başlık deseni: adlandırılmış işleyici, takma adlı halka, değişkenli yol tanınmaz.
    expect(BASLIK.test("app.post('/api/mikro/yeni', C.requireAuth, yeniIsleyici);")).toBe(false);
    expect(BASLIK.test("app.post('/api/mikro/yeni', C.requireAuth, ozelKapi, async (req: Request, res: Response) => {")).toBe(false);
    expect(BASLIK.test('app.post(yol, C.requireAuth, C.requireStaff, async (req: Request, res: Response) => {')).toBe(false);
    expect(BASLIK.test("app.post('/api/mikro/yeni', C.requireAuth, C.requireStaff, async (req: Request, res: Response) => {")).toBe(true);
    // K1: gövdeye bağlı `cariListesiKapisi` KALKTI — geri gelirse başlık tanınmaz (arama dalı yeniden iç personele düşmesin).
    expect(BASLIK.test("app.post('/api/mikro/cari/listesi', C.requireAuth, C.requireMfaVerified, cariListesiKapisi, async (req: Request, res: Response) => {")).toBe(false);
    expect(mikroSatir.filter(k => /cariListesiKapisi/.test(k))).toEqual([]);
  });

  it('Ç6 — istisna listesi ADIYLA: 8 ops ucu ara katmansız ve ilk satırı ops jetonu kapısı; liste dışı ara katmansız kayıt yok', () => {
    const OPS = ['sema-kesif', 'iskonto-tutarsizlik', 'birim-sapmasi', 'ebelge-durum-tani', 'seri-ozet', 'matrah-tani', 'fatura-tani', 'ebelge-tani'];
    expect(sirali(Object.keys(BEKLENEN).filter(opsMu))).toEqual(sirali(OPS.map(a => `GET ${P}/${a}`)));
    const arakatmansiz = yazili().filter(k => k.halkalar.length === 0);
    expect(sirali(arakatmansiz.map(k => `${k.yontem} ${k.yol}`))).toEqual(sirali(OPS.map(a => `GET ${P}/${a}`)));
    for (const k of arakatmansiz) {
      expect(k.baslik).toBe(`app.get('${k.yol}', async (req: Request, res: Response) => {`);
      expect(k.sonraki, `${k.yol} ilk satırı`).toBe('if (!opsJetonuGecerli(req, res)) return;');
    }
  });

  it('Ç7 — gövdeye bağlı iki kapı tam metin; işleyiciler kapıyla AYNI ayıklayıcıyı kullanır; ayrı beyaz liste yok', () => {
    const TEK = [
      "(govde as { collection?: unknown } | undefined)?.collection === 'suppliers' ? 'suppliers' : 'leads';",
      "C.requireCollectionAccess(cariHedefKoleksiyonu(req.body), 'write')(req, res, next);",
      'const targetCollection = cariHedefKoleksiyonu(req.body);',
      "return typeof m === 'string' ? m.trim().slice(0, 100) : '';",
      'const nameSearch = cariAramaMetni(req.body);',
      // evrak/kaydet: koşullar ortak tablodan çözülür — iç personel şartı ÖNCE, koleksiyon kuralı SONRA (H4).
      'const { icRol, kural } = evrakKapiKosullari(MIKRO_EVRAK_KAPILARI.get(evrakYontemi(req.body)));',
      'const kuralKapisi = (hata?: unknown): void => {',
      'if (hata || !kural) { next(hata); return; }',
      'Promise.resolve(C.requireCollectionAccess(kural[0], kural[1])(req, res, next)).catch(next);',
      'return icRol ? C.requireStaff(req, res, kuralKapisi) : kuralKapisi();',
      'const method = evrakYontemi(req.body);',
      'if (!MIKRO_EVRAK_KAPILARI.has(method)) {',
      'const { ok, data, status } = await mikroPost(method, payload, true);',
    ];
    for (const satir of TEK) expect(adet(mikroSatir, satir), satir).toBe(1);
    // K1: arama metni kapıya GİRMEZ — ayıklayıcının tek çağıranı işleyicidir (kapı sabit `leads` yazma; Ç3 / Ç4 rota satırını kilitler).
    expect(mikroSatir.filter(k => /cariAramaMetni\(/.test(k))).toEqual(['const nameSearch = cariAramaMetni(req.body);']);
    // Evrak tablosunu kapı ve işleyici DIŞINDA okuyan yok (kapıyı atlayan ikinci yol doğmasın).
    expect(mikroSatir.filter(k => /MIKRO_EVRAK_KAPILARI|evrakKapiKosullari/.test(k) && !k.startsWith('import '))).toEqual([
      'const { icRol, kural } = evrakKapiKosullari(MIKRO_EVRAK_KAPILARI.get(evrakYontemi(req.body)));',
      'if (!MIKRO_EVRAK_KAPILARI.has(method)) {',
    ]);
    expect(mikroSatir.filter(k => /MIKRO_PUSH_WHITELIST|\.nameSearch\b.*\.trim\(|req\.body.*\.method\b/.test(k) && !k.startsWith('const { method: hamYontem'))).toEqual([]);
    // Yönetici ara katmanı bu dosyada KULLANILMAZ: süper yöneticiyi geçirmez (sahip hesabı Ayarlar'ı rolünden bağımsız görür).
    expect(mikroSatir.filter(k => /requireAdmin/.test(k))).toEqual([]);
  });

  it('Ç8 — /api/mikro yolu kaydeden başka üretim dosyası yok; server.ts\'te tam 2 kayıt (token + önek sınırlayıcı) ve tek mikroRoutes çağrısı', () => {
    const KAYIT_MIKRO = /\.(get|post|put|patch|delete|all|use|route)\(\s*\[?\s*['"`]\/api\/mikro/;
    const dosyalar = [...kaynakDosyalari(SRC_KOK), SERVER].filter(y => y !== MIKRO);
    const bulunan = dosyalar.flatMap(y => kodSatirlari(y).filter(s => KAYIT_MIKRO.test(s.kod)).map(s => `${gorece(y)} | ${s.kod.trim()}`));
    expect(bulunan).toEqual([
      "server.ts | app.use(['/api/mikro/import', '/api/mikro/stok', '/api/mikro/cari', '/api/mikro/fatura',",
      "server.ts | app.post('/api/mikro/token', requireAuth, requireMfaVerified, requireAdmin, async (req: Request, res: Response) => {",
    ]);
    expect(serverKod.filter(k => /\bmikroRoutes\(/.test(k))).toEqual(['mikroRoutes(app, {']);
    // Bağlam bağlaması: dört kapı KISA yazımla (ad = aynı adlı server.ts işlevi) geçer; `requireStaff: başkaİşlev` ya da yayma çiti kırar.
    const b0 = serverKod.indexOf('mikroRoutes(app, {');
    const baglam = serverKod.slice(b0 + 1, serverKod.indexOf('});', b0)).filter(k => k && !k.startsWith('//')).join(' ');
    const anahtarlar = baglam.split(',').map(p => p.trim());
    for (const kapi of ['requireAuth', 'requireMfaVerified', 'requireStaff', 'requireCollectionAccess']) {
      expect(anahtarlar.filter(a => a === kapi), `${kapi}: bağlamda kısa yazımla tam 1 kez`).toHaveLength(1);
      expect(new RegExp(String.raw`\b${kapi}\s*:`).test(baglam), `${kapi}: bağlamda başka değere bağlanmış`).toBe(false);
    }
    expect(baglam.includes('...'), 'bağlamda yayma (kapıyı sonradan ezebilir)').toBe(false);
    // Çok satırlı kayıt: desen satırda değil dosyanın yorumsuz METNİNDE aranır (`\s` satır sonunu da kapsar).
    const metinde = dosyalar.flatMap(y => (kodSatirlari(y).map(s => s.kod).join('\n').match(new RegExp(KAYIT_MIKRO.source, 'g')) ?? []).map(() => gorece(y)));
    expect(metinde).toEqual(['server.ts', 'server.ts']);
    // Değişken / şablon yol: sunucu tarafında `/api/mikro` ile BAŞLAYAN dize sabiti yalnız bilinen satırlarda.
    const sunucuDosyalari = [...kaynakDosyalari(join(SRC_KOK, 'server')), SERVER].filter(y => y !== MIKRO);
    const sabitler = sunucuDosyalari.flatMap(y => kodSatirlari(y).filter(s => /['"`]\/api\/mikro/.test(s.kod)).map(s => `${gorece(y)} | ${s.kod.trim()}`));
    expect(sabitler).toEqual([
      "src/server/mikro/arkaPlanIsi.ts | const ESKI_BICIM_ISLER: ReadonlySet<string> = new Set([mikroIsAdi('/api/mikro/import/stok-miktar')]);",
      "server.ts | app.use(['/api/mikro/import', '/api/mikro/stok', '/api/mikro/cari', '/api/mikro/fatura',",
      "server.ts | '/api/mikro/irsaliye', '/api/mikro/siparis', '/api/mikro/yevmiye', '/api/mikro/tahsilat',",
      "server.ts | '/api/mikro/pull', '/api/mikro/cari-hareket', '/api/mikro/evrak'], mikroLimiter);",
      "server.ts | app.post('/api/mikro/token', requireAuth, requireMfaVerified, requireAdmin, async (req: Request, res: Response) => {",
    ]);
  });

  it('Ç9 — politika değişmezi: her ince kapı kuralı AÇIK tanımlı, dış rol ve rolsüz hesap GEÇEMEZ (iç personel şartıyla çiftli kapılar — `orders` / `quotations` yazma — derinlemesine savunma olarak çiftli KALIR)', () => {
    const etiketler = new Set<string>([
      ...KAPILI.map(a => BEKLENEN[a]), 'leads:write', 'suppliers:write', ...Object.values(EVRAK_BEKLENEN), ...Object.values(UC_TABLOSU_BEKLENEN),
    ]);
    const ciftli: string[] = [];
    for (const etiket of etiketler) {
      if (etiket === 'staff' || etiket.startsWith('govde:')) continue;
      const { icRol, kural } = etiketKosullari(etiket);
      if (!kural) throw new Error(`${etiket}: kuralsız etiket`);
      const [k, e] = kural;
      expect(hasExplicitRule(k) || ADMIN_ONLY_COLLECTIONS.has(k), `${etiket}: kuralsız koleksiyon (yalnız Admin geçer = sessiz kilit)`).toBe(true);
      expect(isAllowed(null, k, e), `${etiket}: rolsüz hesap geçiyor`).toBe(false);
      if (icRol) {
        // 2026-10-11 (dış rol kapanışı, D1) — YENİDEN SABİTLENDİ: bu kurallar (`orders`, `quotations` yazma) eskiden dış rol
        // İÇERİYORDU ve tek başına kapı olamıyordu; çiftleme bu yüzden yazılmıştı. Tablodan dış rol çıktı: kural artık dış rolü
        // GEÇİRMEZ, çiftleme yine KALIR (tablo bir gün yeniden açılırsa Mikro'ya yazan uç kendiliğinden açılmasın).
        expect(EXTERNAL_ROLES.filter(r => isAllowed(r, k, e)), `${etiket}: dış rol kuraldan geçiyor (D1)`).toEqual([]);
        ciftli.push(etiket);
        continue;
      }
      expect(EXTERNAL_ROLES.filter(r => isAllowed(r, k, e)), `${etiket}: dış rol geçiyor`).toEqual([]);
    }
    expect(sirali(ciftli)).toEqual(['staff+orders:write', 'staff+quotations:write']);
    // H4: teklif yöntemi tabloda İKİ koşulu birlikte taşır; düz `quotations` yazma ikilisi tabloda HİÇBİR yöntemde yok.
    // Kural eskiden B2B / Bayi'yi geçiriyordu (düz yazılsa ilk turda kapanan açık yeniden açılırdı); D1'den beri geçirmiyor,
    // çift yine durur (derinlemesine savunma).
    expect(MIKRO_EVRAK_KAPILARI.get('VerilenTeklifKaydetV2')).toEqual({ icRolVe: ['quotations', 'write'] });
    expect(EXTERNAL_ROLES.filter(r => isAllowed(r, 'quotations', 'write'))).toEqual([]);   // D1
    for (const [yontem, kapi] of MIKRO_EVRAK_KAPILARI) {
      if (kapi !== 'staff' && !('icRolVe' in kapi)) expect(EXTERNAL_ROLES.filter(r => isAllowed(r, kapi[0], kapi[1])), `${yontem}: düz ikili dış rol içeriyor`).toEqual([]);
      // Ortak tablodan soran istemci de dış rolü HİÇBİR yöntemde geçirmez (tanınmayan yöntem dâhil).
      expect(EXTERNAL_ROLES.filter(r => evrakKapisindanGecer(r, yontem)), `${yontem}: dış rol istemci süzgecinden geçiyor`).toEqual([]);
    }
    expect(EXTERNAL_ROLES.filter(r => evrakKapisindanGecer(r, 'BilinmeyenV2'))).toEqual([]);
    for (const uc of Object.keys(MIKRO_UC_KAPILARI) as MikroKapiliUc[]) {
      expect(EXTERNAL_ROLES.filter(r => ucKapisindanGecer(r, uc)), `${uc}: dış rol ortak uç tablosundan geçiyor`).toEqual([]);
    }
  });

  it('Ç10 — elle yazılan GECEN tablosu gerçek kuralla aynı', () => {
    expect(sirali(GECEN.staff)).toEqual(sirali(STAFF_ROLES));
    for (const [etiket, roller] of Object.entries(GECEN)) {
      // Sunucu zincirinin anlamı: iç personel şartı (varsa) VE koleksiyon kuralı (varsa).
      const { icRol, kural } = etiketKosullari(etiket);
      const gercek = APP_ROLES.filter(r => (!icRol || STAFF_ROLES.includes(r)) && (!kural || isAllowed(r, kural[0], kural[1])));
      expect(sirali(roller), etiket).toEqual(sirali(gercek));
    }
    // Tabloda kullanılmayan satır yok (bayat kapı birikmesin).
    const kullanilan = new Set<string>([...KAPILI.map(etkinEtiket), ...Object.values(DAL_KAPISI)]);
    expect(sirali(Object.keys(GECEN))).toEqual(sirali([...kullanilan]));
  });

  it('Ç11 — ikiz çiti: server.ts kapı gövdeleri davranış testindeki ikizlerle aynı (gövde değişirse ikiz bilinçli güncellenir)', () => {
    const TEK = [
      'if (isSuperAdmin(req) || (role && STAFF_ROLES.includes(role))) { next(); return; }',
      "res.status(403).json({ error: 'Bu işlem için personel yetkisi gerekir.' });",
      'if (isSuperAdmin(req) || await canAccessCollection(uid, coll, op)) { next(); return; }',
      "res.status(403).json({ error: 'Bu veri için yetkiniz yok.' });",
      'return isAllowed(await getUserRole(uid), coll, op);',
      'if (r.emailVerified !== true) return false;',
      "return SUPER_ADMIN_EMAILS.has((r.userEmail || '').toLowerCase());",
      "res.status(401).json({ error: 'Missing Authorization header.' });",
      'if (!(await userHasMfa(uid))) { next(); return; }',
    ];
    for (const satir of TEK) expect(adet(serverKod, satir), satir).toBe(1);
    // Satır VARLIĞI yetmez: gövdeye EKLENEN satır (erken `next()`) da çiti kırmalı → imzadan kapanışa TAM gövde.
    const govde = (imza: string): string[] => {
      expect(adet(serverKod, imza), imza).toBe(1);
      const i = serverKod.indexOf(imza);
      return serverKod.slice(i + 1, serverKod.indexOf('}', i)).filter(k => k && !k.startsWith('//'));
    };
    expect(govde('async function requireStaff(req: Request, res: Response, next: NextFunction): Promise<void> {')).toEqual([
      'const uid = (req as Request & { uid?: string }).uid;',
      'const role = uid ? await getUserRole(uid) : null;',
      'if (isSuperAdmin(req) || (role && STAFF_ROLES.includes(role))) { next(); return; }',
      "res.status(403).json({ error: 'Bu işlem için personel yetkisi gerekir.' });",
    ]);
    expect(govde('function requireCollectionAccess(coll: string, op: DbOp) {')).toEqual([
      'return async (req: Request, res: Response, next: NextFunction): Promise<void> => {',
      "const uid = (req as Request & { uid?: string }).uid || '';",
      'if (isSuperAdmin(req) || await canAccessCollection(uid, coll, op)) { next(); return; }',
      "res.status(403).json({ error: 'Bu veri için yetkiniz yok.' });",
      '};',
    ]);
    expect(govde('async function canAccessCollection(uid: string, coll: string, op: DbOp): Promise<boolean> {')).toEqual([
      'return isAllowed(await getUserRole(uid), coll, op);',
    ]);
    expect(govde('function isSuperAdmin(req: Request): boolean {')).toEqual([
      'const r = req as Request & { userEmail?: string; emailVerified?: boolean };',
      'if (r.emailVerified !== true) return false;',
      "return SUPER_ADMIN_EMAILS.has((r.userEmail || '').toLowerCase());",
    ]);
  });

  it('evrak tablosu — kaynak tablo elle yazılan beklenenle aynı: 26 yöntem = 24 ince + 1 iç personel VE ince + 1 yalnız iç personel; miras anahtar beyaz listede değil', () => {
    // Etiket tablonun HAM biçiminden üretilir (üretim çözücüsü `evrakKapiKosullari` aşağıda ayrıca sınanır).
    const kaynakEtiketi = (k: EvrakKapisi): string => (k === 'staff' ? 'staff' : 'icRolVe' in k ? `staff+${k.icRolVe[0]}:${k.icRolVe[1]}` : `${k[0]}:${k[1]}`);
    const kaynak = Object.fromEntries([...MIKRO_EVRAK_KAPILARI].map(([y, k]) => [y, kaynakEtiketi(k)]));
    expect(kaynak).toEqual(EVRAK_BEKLENEN);
    expect(Object.keys(EVRAK_BEKLENEN)).toHaveLength(26);
    // K3-e: `'staff'` YALNIZ etiket basımında kalır (eşdeğer Cetpa koleksiyonu yok); diğer 25 yöntemin koleksiyon kuralı var.
    expect(Object.entries(EVRAK_BEKLENEN).filter(([, k]) => k === 'staff').map(([y]) => y)).toEqual(['EtiketBasimKaydetV2']);
    expect(Object.entries(EVRAK_BEKLENEN).filter(([, k]) => k.startsWith('staff+')).map(([y]) => y)).toEqual(['VerilenTeklifKaydetV2']);
    // İ1: 25 kuralın hepsi YAZMA kuralıdır (uç Mikro'ya yazar).
    expect(Object.values(EVRAK_BEKLENEN).filter(k => k !== 'staff' && !k.endsWith(':write'))).toEqual([]);
    for (const ad of ['constructor', 'toString', 'hasOwnProperty', '__proto__', '']) expect(MIKRO_EVRAK_KAPILARI.has(ad), ad).toBe(false);
    expect(evrakYontemi(undefined)).toBe('');
    expect(evrakYontemi(null)).toBe('');
    expect(evrakYontemi({ method: 5 })).toBe('');
    expect(evrakYontemi({ method: ['DekontKaydetV2'] })).toBe('');
    expect(evrakYontemi({ method: 'DekontKaydetV2' })).toBe('DekontKaydetV2');
    // Kapı çözücüsü — sunucu kapısı ile istemci süzgecinin ORTAK adımı: tanınmayan yöntem `'staff'` sayılır.
    expect(evrakKapiKosullari(undefined)).toEqual({ icRol: true, kural: null });
    expect(evrakKapiKosullari('staff')).toEqual({ icRol: true, kural: null });
    expect(evrakKapiKosullari(['leads', 'write'])).toEqual({ icRol: false, kural: ['leads', 'write'] });
    expect(evrakKapiKosullari({ icRolVe: ['quotations', 'write'] })).toEqual({ icRol: true, kural: ['quotations', 'write'] });
    // İstemci süzgeci (düğme, sessiz çağrı, yeniden deneme kuyruğu) sunucu kapısıyla aynı kararı verir.
    for (const [yontem, etiket] of Object.entries(EVRAK_BEKLENEN)) {
      for (const rol of APP_ROLES) expect(evrakKapisindanGecer(rol, yontem), `${yontem} × ${rol}`).toBe(gecenRoller(etiket).includes(rol));
      expect(evrakKapisindanGecer(null, yontem)).toBe(false);
      expect(evrakKapisindanGecer(undefined, yontem)).toBe(false);
    }
    expect(APP_ROLES.filter(r => evrakKapisindanGecer(r, 'BilinmeyenV2'))).toEqual(STAFF_ROLES);
  });

  it('Ç16 — ortak uç tablosu (src/lib/mikroUcKapilari.ts) = elle yazılan beklenen = rota satırındaki kapı; istemci süzgeci sunucu kapısıyla aynı kararı verir', () => {
    const kaynak = Object.fromEntries(Object.entries(MIKRO_UC_KAPILARI).map(([a, k]) => [a, `${k[0]}:${k[1]}`]));
    expect(kaynak).toEqual(UC_TABLOSU_BEKLENEN);
    expect(Object.keys(UC_TABLOSU_BEKLENEN)).toHaveLength(11);
    // Anahtarlar BEKLENEN anahtarlarıyla BİREBİR; kapı etiketi aynı. Ç3 / Ç4 rota metnini BEKLENEN'e, bu çit BEKLENEN'i tabloya bağlar.
    for (const [anahtar, etiket] of Object.entries(UC_TABLOSU_BEKLENEN)) {
      expect(BEKLENEN[anahtar], `${anahtar}: BEKLENEN'de yok ya da kapısı farklı`).toBe(etiket);
      // Tablo yalnız SABİT ince kapılı ucu taşır: gövdeye bağlı ya da iç personel çiftli kapı tek ikiliyle anlatılamaz.
      expect(etiketKosullari(etiket).icRol, `${anahtar}: iç personel çiftli kapı ortak uç tablosuna yazılamaz`).toBe(false);
    }
    // Karar turunda kapısı değişen HER uç tabloda (istemci koşulu sorabilsin); K9 kapısı değişmeden, A1 (`cari/ara`) yeni uç
    // olarak tabloda — ikisinin de kilitlediği rol yok (KARAR_KILIDI'nda değiller).
    const kararUclari = Object.keys(KARAR_KILIDI).filter(a => !a.includes('#'));
    expect(kararUclari.filter(a => !(a in UC_TABLOSU_BEKLENEN)), 'kilitleyen ama ortak tabloda olmayan uç = istemci koşulu soramaz').toEqual([]);
    expect(sirali(Object.keys(UC_TABLOSU_BEKLENEN).filter(a => !kararUclari.includes(a)))).toEqual(sirali([`POST ${P}/cari/ara`, `POST ${P}/tahsilat/kaydet`]));
    for (const [anahtar, etiket] of Object.entries(UC_TABLOSU_BEKLENEN)) {
      const uc = anahtar as MikroKapiliUc;
      for (const rol of APP_ROLES) expect(ucKapisindanGecer(rol, uc), `${anahtar} × ${rol}`).toBe(gecenRoller(etiket).includes(rol));
      expect(ucKapisindanGecer(null, uc)).toBe(false);
      expect(ucKapisindanGecer(undefined, uc)).toBe(false);
    }
    // Tip dışı çağrı (tabloda olmayan anahtar, miras anahtar) kapalı başarısızlıktır — fırlatmaz, geçirmez.
    for (const ad of [`POST ${P}/yevmiye/kaydet`, 'constructor', 'toString', '__proto__', '']) {
      expect(APP_ROLES.filter(r => ucKapisindanGecer(r, ad as MikroKapiliUc)), `'${ad}'`).toEqual([]);
    }
    // H1 / H6: PDF ve XML İKİ sabit satırdır — yöne bağlı ikinci tablo / yardımcı (`EBELGE_INDIRME_KAPISI`, `eBelgeIndirebilir`) YAZILMAZ.
    expect(sirali(Object.keys(ucKapilariModulu))).toEqual(['MIKRO_UC_KAPILARI', 'ucKapisindanGecer']);
    expect(MIKRO_UC_KAPILARI[`POST ${P}/ebelge/pdf`]).toEqual(['mikroFaturalar', 'read']);
    expect(MIKRO_UC_KAPILARI[`POST ${P}/ebelge/xml`]).toEqual(['mikroFaturalar', 'read']);
  });
});

describe('kilit değişmezi (İ3) — ÖLÜ DÜĞME YOK: düğmeyi / çağrıyı gören her rol kapıdan geçer; kilitlenenler adıyla tabloda', () => {
  /** Kapılı her uç; gövdeye bağlı iki uç dallarına açılır. */
  const TUM_DALLAR = [
    ...KAPILI.filter(a => !BEKLENEN[a].startsWith('govde:')),
    ...Object.keys(DAL_KAPISI),
  ];

  it('Ç13 — ölü düğme yok: her uç / dal ya EKRANI_GOREN\'de ya CAGIRANI_YOK\'ta; görenlerin HEPSİ kapıdan geçer (bilinen eski kilitler adıyla)', () => {
    const gorulen = Object.keys(EKRANI_GOREN);
    expect(gorulen.filter(a => CAGIRANI_YOK.includes(a)), 'iki tabloda birden').toEqual([]);
    expect(new Set(CAGIRANI_YOK).size).toBe(CAGIRANI_YOK.length);
    expect(sirali([...gorulen, ...CAGIRANI_YOK])).toEqual(sirali(TUM_DALLAR));
    const kilitler: string[] = [];
    for (const [anahtar, gorenler] of Object.entries(EKRANI_GOREN)) {
      expect(gorenler.filter(r => !STAFF_ROLES.includes(r)), `${anahtar}: tabloya yalnız iç rol yazılır`).toEqual([]);
      const gecen = gecenRoller(dalEtiketi(anahtar));
      const kilitlenen = gorenler.filter(r => !gecen.includes(r));
      if (sirali(kilitlenen).join() !== sirali(BILINEN_KILIT[anahtar] ?? []).join()) {
        kilitler.push(`${anahtar} [${dalEtiketi(anahtar)}] → ÖLÜ DÜĞME: ${kilitlenen.join(', ') || '—'} (bilinen: ${(BILINEN_KILIT[anahtar] ?? []).join(', ') || '—'})`);
      }
    }
    expect(kilitler).toEqual([]);
    expect(Object.keys(BILINEN_KILIT).filter(a => !(a in EKRANI_GOREN))).toEqual([]);
    // Bilinen eski kilit listesi karar turunda BÜYÜMEDİ (tek satır; yeni kilit buraya değil KARAR_KILIDI'na yazılır).
    expect(BILINEN_KILIT).toEqual({ [`GET ${P}/cari-hareket/:cariKod`]: ['Sales', 'Purchasing', 'Logistics'] });
  });

  it('Ç13 — kilitlenenler tablosu (§ 10.1): KARAR_KILIDI\'ndaki her rol GERÇEKTEN kilitli, düğmeyi görenler arasında DEĞİL ve ortak tablo ona «geçemez» der', () => {
    expect(Object.keys(KARAR_KILIDI).filter(a => !TUM_DALLAR.includes(a)), 'tabloda uç / dal olmayan anahtar').toEqual([]);
    for (const [anahtar, kilitli] of Object.entries(KARAR_KILIDI)) {
      expect(kilitli.length, `${anahtar}: boş satır`).toBeGreaterThan(0);
      expect(new Set(kilitli).size, `${anahtar}: yinelenen rol`).toBe(kilitli.length);
      expect(kilitli.filter(r => !STAFF_ROLES.includes(r)), `${anahtar}: tabloya yalnız iç rol yazılır (dış rol ilk turda kapandı)`).toEqual([]);
      const gecen = gecenRoller(dalEtiketi(anahtar));
      // GEVŞETME çiti: kapı genişler de kilitli rol geçmeye başlarsa burada kırılır — karar BİLİNÇLİ güncellenir.
      expect(kilitli.filter(r => gecen.includes(r)), `${anahtar}: kilitli rol kapıdan geçiyor`).toEqual([]);
      // İ3: kilitli rol düğmeyi GÖRMEZ (görseydi ölü düğme olurdu). Çağıranı kalmayan uçta (K1 / H3) gören zaten yok.
      const gorenler = EKRANI_GOREN[anahtar] ?? [];
      expect(kilitli.filter(r => gorenler.includes(r)), `${anahtar}: kilitli rol düğmeyi görüyor`).toEqual([]);
      if (!(anahtar in EKRANI_GOREN)) expect(CAGIRANI_YOK, anahtar).toContain(anahtar);
      // İ4: istemcinin soracağı ORTAK tablo bu anahtarı tanır ve kilitli role «geçemez», görene «geçer» der.
      const [uc, yontem] = anahtar.split('#');
      const sor = (r: AppRole): boolean => {
        if (yontem) { expect(uc).toBe(`POST ${P}/evrak/kaydet`); expect(MIKRO_EVRAK_KAPILARI.has(yontem), yontem).toBe(true); return evrakKapisindanGecer(r, yontem); }
        expect(uc in MIKRO_UC_KAPILARI, `${uc}: ortak uç tablosunda yok`).toBe(true);
        return ucKapisindanGecer(r, uc as MikroKapiliUc);
      };
      expect(kilitli.filter(sor), `${anahtar}: ortak tablo kilitli rolü geçiriyor`).toEqual([]);
      expect(gorenler.filter(r => !sor(r)), `${anahtar}: ortak tablo düğmeyi gören rolü geçirmiyor`).toEqual([]);
    }
    // Tablonun TAMAMI: 19 satır (K1, K2, K3 × 10 yöntem, K4, K5, K6 × 3, K7 × 2) — kilitleyen yeni kapı buraya adıyla girer.
    expect(Object.keys(KARAR_KILIDI)).toHaveLength(19);
    // K3-a ↔ K2: dekont penceresini açabilen (yazma) her rol pencerenin okuduğu tür listesini de okur — pencere yarım açılmaz.
    expect(gecenRoller('mikroCariHareketler:write').filter(r => !gecenRoller('mikroCariHareketler:read').includes(r))).toEqual([]);
  });

  it('Ç18 — A1 / H10: iki «Mikro\'da ara» kutusunun yazma kümesi arama ucunun okuma kümesinde (`suppliers.write ⊆ leads.read`, `leads.write ⊆ leads.read`)', () => {
    // Kutular `ucKapisindanGecer(cari/ara) && isAllowed(<koleksiyon>, 'write')` ile çizilir: rbac değişip yazabilen bir rol arama
    // ucunun kapısından düşerse kutu o rolden SESSİZCE kaybolurdu (ölü düğme değil, gizli kutu). Kümeler gerçek kuraldan okunur.
    const okuyan = APP_ROLES.filter(r => isAllowed(r, 'leads', 'read'));
    expect(APP_ROLES.filter(r => isAllowed(r, 'suppliers', 'write') && !okuyan.includes(r)), 'Satın Alma kutusu (C8)').toEqual([]);
    expect(APP_ROLES.filter(r => isAllowed(r, 'leads', 'write') && !okuyan.includes(r)), 'CRM kutusu (C9)').toEqual([]);
    // Ortak tablo aynı kapıyı söyler (istemci kutuyu bu satırla çizer).
    expect(MIKRO_UC_KAPILARI[`POST ${P}/cari/ara`]).toEqual(['leads', 'read']);
    // Kutuyu GÖREN küme (EKRANI_GOREN) = iki yazma kümesinin birleşimi, elle yazılan tabloyla aynı.
    const gorenler = sirali(APP_ROLES.filter(r => ucKapisindanGecer(r, `POST ${P}/cari/ara`) && (isAllowed(r, 'suppliers', 'write') || isAllowed(r, 'leads', 'write'))));
    expect(gorenler).toEqual(sirali(EKRANI_GOREN[`POST ${P}/cari/ara`]));
  });

  it('Ç13 — değişmez kilidi YAKALAR (Ayarlar paneline Muhasebe eklenirse stok importunda kilitlenir)', () => {
    const gecen = gecenRoller(BEKLENEN[`POST ${P}/import/stok`]);
    expect([...AYARLAR, 'Accounting' as AppRole].filter(r => !gecen.includes(r))).toEqual(['Accounting']);
  });

  it('Ç14 — ekran çiti: Mikro paneli YALNIZ Ayarlar sekmesinde, o sekme yalnız Yönetici + Müdür (+ sahip hesabı)', () => {
    const APP = join(SRC_KOK, 'App.tsx');
    const app = kodSatirlari(APP).map(s => s.kod.trim());
    expect(app.filter(k => k.startsWith("{activeTab === 'settings' &&"))).toEqual([
      "{activeTab === 'settings' && (userRole === 'Admin' || userRole === 'Manager' || isOwnerAdmin) && (",
    ]);
    expect(app.filter(k => /^settings:\s/.test(k))).toEqual(['settings:      { full: [UserRole.Admin, UserRole.Manager], readonly: [] },']);
    const iceAktaran = (bilesen: string): string[] => kaynakDosyalari(SRC_KOK)
      .filter(y => kodSatirlari(y).some(s => new RegExp(`import\\(['"][./a-zA-Z]*/${bilesen}['"]\\)|from ['"][./a-zA-Z]*/${bilesen}['"]`).test(s.kod)))
      .map(gorece);
    expect(iceAktaran('MikroSyncPanel')).toEqual(['src/components/ERPHubPanel.tsx']);
    expect(iceAktaran('ERPHubPanel')).toEqual(['src/pages/SettingsPage.tsx']);
    expect(iceAktaran('SettingsPage')).toEqual(['src/App.tsx']);
  });

  it('Ç15 — B2B Portalı\'ndaki «Mikro\'ya Gönder» düğmesi yalnız iç rolde (dış rolde her tıklama 403 olurdu)', () => {
    const detay = kodSatirlari(join(SRC_KOK, 'components', 'QuotationDetail.tsx')).map(s => s.kod.trim());
    const i = detay.indexOf('<MikroPushButton');
    expect(i).toBeGreaterThan(0);
    expect(adet(detay, '<MikroPushButton')).toBe(1);
    expect(detay[i - 1]).toBe('{mikroGonderebilir && (');
    expect(adet(detay, 'mikroGonderebilir: boolean;')).toBe(1);
    const portal = kodSatirlari(join(SRC_KOK, 'components', 'B2BPortal.tsx')).map(s => s.kod.trim());
    expect(adet(portal, 'const icRol = (STAFF_ROLES as readonly string[]).includes(userRole);')).toBe(1);
    // 2026-10-17 (iç rol daraltma S1): «Dönüştür» (Shopify taslak siparişi) kendi kapısını ortak entegrasyon tablosundan sorar;
    // «Mikro'ya Gönder» koşulu DEĞİŞMEDİ (iç rol).
    expect(portal.filter(k => k.includes('mikroGonderebilir='))).toEqual(['onConvertToOrder={shopifyTaslakAcabilir ? handleConvertToOrder : undefined} mikroGonderebilir={icRol} t={currentT} />']);
  });

  it('Ç17 — H2 / İ5 veri katmanı: `eBelgeler` okuma = `mikroFaturalar` okuma (Yönetici, Müdür, Muhasebe); e-Belge sekmesi aynı kümeyle açılır, salt okunur rolü YOK', () => {
    const okuyan = (koleksiyon: string): string[] => sirali(APP_ROLES.filter(r => isAllowed(r, koleksiyon, 'read')));
    // Koleksiyon GELEN e-faturaları taşır (tedarikçi fatura numarası, gönderen, VKN, tutar): Satış / Lojistik / Satın Alma OKUYAMAZ.
    expect(okuyan('eBelgeler')).toEqual(sirali(['Admin', 'Manager', 'Accounting']));
    expect(okuyan('eBelgeler')).toEqual(okuyan('mikroFaturalar'));
    // Yazabilen her rol okur (çekme düğmesine basan sonucu görebilsin) ve indirme kapısından da geçer (K6 ⊆ K7).
    expect(gecenRoller('eBelgeler:write').filter(r => !okuyan('eBelgeler').includes(r))).toEqual([]);
    expect(gecenRoller('eBelgeler:write').filter(r => !gecenRoller('mikroFaturalar:read').includes(r))).toEqual([]);
    // Sekme: tam yetkili = okuma kümesi, salt okunur küme BOŞ (Satış ve Lojistik sekmeyi kaybetti; ekrandaki liste salt
    // okunur rolde zaten yüklenmiyordu — açık, koleksiyonun `/api/db` üzerinden okunabilmesiydi).
    const app = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod.trim());
    expect(app.filter(k => /^ebelge:\s+\{/.test(k))).toEqual(['ebelge:        { full: [UserRole.Admin, UserRole.Accounting, UserRole.Manager], readonly: [] },']);
    expect(sirali(EBELGE)).toEqual(okuyan('eBelgeler'));
    // H2'nin ölçümü: `eBelgeler`'i sunucu dışında okuyan TEK bileşen e-Belge Merkezi. Yeni okuyan eklenirse İ5 o ekran için yeniden düşünülür.
    // Ham metin ön süzgeci: yorum ayıklama (pahalı) yalnız adı geçiren birkaç dosyada koşar.
    const gecenDosyalar = kaynakDosyalari(SRC_KOK)
      .filter(y => !gorece(y).startsWith('src/server/') && oku(y).includes('eBelgeler') && kodSatirlari(y).some(s => /\beBelgeler\b/.test(s.kod)))
      .map(gorece);
    // `entegrasyonUcKapilari.ts` (2026-10-17, iç rol daraltma L1) OKUYUCU değil kapı tablosudur: LUCA kontör ucunun kuralı
    // `eBelgeler` okuma; kontör kartı aynı e-Belge Merkezi ekranında, aynı rol kümesiyle çizilir.
    expect(sirali(gecenDosyalar)).toEqual([
      'src/components/EBelgeMerkezi.tsx', 'src/lib/collections.ts', 'src/lib/entegrasyonUcKapilari.ts', 'src/lib/mikroUcKapilari.ts', 'src/lib/rbac.ts',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DAVRANIŞ — gerçek express + üretim zinciri
// ════════════════════════════════════════════════════════════════════════════

const SUPER_EPOSTA = 'sahip@example.test';
interface Kimlik { rol: AppRole | null; eposta: string; dogrulanmis: boolean }
/** 14 kimlik: 10 iç rol + 2 dış rol + rolsüz hesap + rolü boş SÜPER YÖNETİCİ (sahip hesabı). */
const KIMLIKLER: Record<string, Kimlik> = {
  ...Object.fromEntries(APP_ROLES.map(r => [r, { rol: r, eposta: `${r.toLowerCase()}@example.test`, dogrulanmis: true }])),
  rolsuz: { rol: null, eposta: 'rolsuz@example.test', dogrulanmis: true },
  'super-rolsuz': { rol: null, eposta: SUPER_EPOSTA, dogrulanmis: true },
};
const DIS = ['B2B', 'Dealer', 'rolsuz'];
type Kimlikli = Request & { uid?: string; userEmail?: string; emailVerified?: boolean };

// ── İKİZ kapılar — server.ts gövdelerinin kopyası (Ç11 gövdeleri kilitler) ──
const ikizAuth: RequestHandler = (req, res, next) => {
  const ad = req.headers['x-test-kimlik'];
  const k = typeof ad === 'string' ? KIMLIKLER[ad] : undefined;
  if (!k || typeof ad !== 'string') { res.status(401).json({ error: 'Missing Authorization header.' }); return; }
  const r = req as Kimlikli;
  r.uid = ad; r.userEmail = k.eposta; r.emailVerified = k.dogrulanmis;
  next();
};
const ikizSuper = (req: Request): boolean => {
  const r = req as Kimlikli;
  if (r.emailVerified !== true) return false;
  return (r.userEmail || '').toLowerCase() === SUPER_EPOSTA;
};
const ikizRol = (req: Request): AppRole | null => KIMLIKLER[(req as Kimlikli).uid ?? '']?.rol ?? null;
const ikizStaff: RequestHandler = (req, res, next) => {
  const role = ikizRol(req);
  if (ikizSuper(req) || (role && STAFF_ROLES.includes(role))) { next(); return; }
  res.status(403).json({ error: 'Bu işlem için personel yetkisi gerekir.' });
};
const ikizKoleksiyon = (coll: string, op: DbOp): RequestHandler => (req, res, next) => {
  if (ikizSuper(req) || isAllowed(ikizRol(req), coll, op)) { next(); return; }
  res.status(403).json({ error: 'Bu veri için yetkiniz yok.' });
};
/** MFA kurmamış hesap (server.ts: `if (!(await userHasMfa(uid))) { next(); return; }`) — en gevşek durum sınanır. */
const ikizMfa: RequestHandler = (_req, _res, next) => next();
const NOBETCI: RequestHandler = (_req, res) => { res.status(200).json({ gecti: true }); };

const JETON = 'rol-kapisi-test-jetonu';
const jetonYedek = process.env.OPS_SUMMARY_TOKEN;
let d: Duzenek;
let srv: http.Server;
let taban = '';

beforeAll(async () => {
  process.env.OPS_SUMMARY_TOKEN = JETON;
  d = duzenekKur({
    kayit: (sahte, C) => mikroRoutes(sahte, {
      ...C, requireAuth: ikizAuth, requireMfaVerified: ikizMfa, requireStaff: ikizStaff, requireCollectionAccess: ikizKoleksiyon,
    }),
  });
  const app = express();
  app.use(express.json());
  // Zincirin halkaları ve SIRASI üretim kodundan gelir; ops dışındaki uçlarda işleyicinin yerine nöbetçi konur.
  // Kayıt sırası korunur (`cari-hareket/turler`, `:cariKod`'dan önce).
  for (const [anahtar, zincir] of Object.entries(d.app.zincirler)) {
    const [yontem, yol] = anahtar.split(' ');
    const halkalar = (opsMu(anahtar) ? zincir : [...zincir.slice(0, -1), NOBETCI]) as RequestHandler[];
    if (yontem === 'GET') app.get(yol, ...halkalar);
    else if (yontem === 'POST') app.post(yol, ...halkalar);
    else throw new Error(`beklenmeyen yöntem: ${anahtar}`);
  }
  app.use((hata: unknown, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: String(hata) }); });
  srv = http.createServer(app);
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  const adres = srv.address();
  if (!adres || typeof adres === 'string') throw new Error('test sunucusu dinlemiyor');
  taban = `http://127.0.0.1:${adres.port}`;
});
afterAll(async () => {
  if (jetonYedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = jetonYedek;
  await new Promise<void>(r => srv.close(() => r()));
});

interface Yanit { kod: number; govde: { error?: string; gecti?: boolean } }
/** `govde` verilmezse POST `{}` ile gider; `null` = GÖVDESİZ POST (içerik türü de yok → express'te `req.body` tanımsız). */
async function istek(anahtar: string, o: { kimlik?: string; govde?: unknown; basliklar?: Record<string, string> } = {}): Promise<Yanit> {
  const [yontem, ham] = anahtar.split(' ');
  const yol = ham.replace(':cariKod', 'C001').replace(':vkn', '1234567890');
  const basliklar: Record<string, string> = { ...(o.kimlik ? { 'x-test-kimlik': o.kimlik } : {}), ...o.basliklar };
  const init: RequestInit = { method: yontem, headers: basliklar };
  if (yontem === 'POST' && o.govde !== null) {
    basliklar['Content-Type'] = 'application/json';
    init.body = JSON.stringify(o.govde ?? {});
  }
  const r = await fetch(taban + yol, init);
  return { kod: r.status, govde: await r.json().catch(() => ({})) as Yanit['govde'] };
}
const kodlar = async (anahtarlar: string[], o: Parameters<typeof istek>[1]): Promise<Record<string, number>> =>
  Object.fromEntries(await Promise.all(anahtarlar.map(async a => [a, (await istek(a, o)).kod] as const)));
const hepsi = (anahtarlar: string[], kod: number): Record<string, number> => Object.fromEntries(anahtarlar.map(a => [a, kod]));

describe('davranış — gerçek express + üretim zinciri (Mikro\'ya hiç gidilmez)', () => {
  it('D0 — kayıtlı rota kümesi = BEKLENEN (62): takma adla, devrederek ya da yeni fabrikayla eklenen uç burada kırılır', () => {
    expect(sirali(Object.keys(d.app.zincirler))).toEqual(sirali(Object.keys(BEKLENEN)));
    expect(KAPILI).toHaveLength(54);
    const dagilim = (on: (k: Kapi) => boolean) => Object.values(BEKLENEN).filter(on).length;
    expect({
      ops: dagilim(k => k === 'ops'), staff: dagilim(k => k === 'staff'), staffArtiInce: dagilim(k => k === 'staff+orders:write'),
      govde: dagilim(k => k.startsWith('govde:')), ince: dagilim(k => /^[A-Za-z]+:(read|write|delete)$/.test(k)),
    }).toEqual({ ops: 8, staff: 4, staffArtiInce: 2, govde: 2, ince: 46 });   // karar turu: 6 uç `staff` → ince, `cari/listesi` gövdeye bağlı → ince; Q serisi: `seri-ozet` ops jetonu (7 → 8); A1: `cari/ara` ince (45 → 46)
  });

  it('D1 — kimliksiz istek: 54 kapılı ucun hepsi 401', async () => {
    expect(await kodlar(KAPILI, {})).toEqual(hepsi(KAPILI, 401));
  });

  it.each(DIS)('D2 — %s: 54 kapılı ucun HEPSİ 403 (asıl açık: dış rol ve rolü çözülemeyen hesap)', async (kimlik) => {
    expect(await kodlar(KAPILI, { kimlik })).toEqual(hepsi(KAPILI, 403));
  });

  it.each(IC)('D3 — %s: her uç tabloya göre 200 / 403', async (rol) => {
    const beklenen = Object.fromEntries(KAPILI.map(a => [a, gecenRoller(etkinEtiket(a)).includes(rol) ? 200 : 403]));
    expect(await kodlar(KAPILI, { kimlik: rol })).toEqual(beklenen);
  });

  it('D4 — cari/kaydet: kapı gövdedeki hedefe göre (müşteri → leads yazma, tedarikçi → suppliers yazma; tanınmayan hedef leads)', async () => {
    const uc = `POST ${P}/cari/kaydet`;
    const gecenler = async (govde: unknown) => {
      const out: string[] = [];
      for (const k of Object.keys(KIMLIKLER)) if ((await istek(uc, { kimlik: k, govde })).kod === 200) out.push(k);
      return sirali(out);
    };
    const musteri = sirali(['Admin', 'Manager', 'Sales', 'super-rolsuz']);
    expect(await gecenler({})).toEqual(musteri);
    expect(await gecenler({ collection: 'leads' })).toEqual(musteri);
    expect(await gecenler({ collection: 'settings' })).toEqual(musteri);
    expect(await gecenler({ collection: ['suppliers'] })).toEqual(musteri);
    expect(await gecenler({ collection: 'suppliers' })).toEqual(sirali(['Admin', 'Manager', 'Purchasing', 'super-rolsuz']));
    // İki dalda da geçemeyen iç roller (etkin Mikro kapısı = iki kuralın birleşimi; bunlar birleşimin DIŞINDA).
    for (const rol of ['Logistics', 'Accounting', 'HR']) {
      expect((await istek(uc, { kimlik: rol, govde: { collection: 'leads' } })).kod).toBe(403);
      expect((await istek(uc, { kimlik: rol, govde: { collection: 'suppliers' } })).kod).toBe(403);
    }
  });

  it('D4 — cari/listesi (K1): kapı gövdeye BAĞLI DEĞİL — tam import da arama da `leads` yazma kapısında (Yönetici, Müdür, Satış)', async () => {
    const uc = `POST ${P}/cari/listesi`;
    const beklenen = Object.fromEntries(Object.keys(KIMLIKLER).map(k => [k, ['Admin', 'Manager', 'Sales', 'super-rolsuz'].includes(k) ? 200 : 403]));
    // Tam import gövdeleri + ARAMA gövdeleri (joker ve tek harf dâhil) + gövdesiz POST: sonuç HEPSİNDE aynı.
    // İlk turda arama dalı iç personele açıktı; iki dal da `leads`'e yazdığı için (arama 200 cariye kadar) kapı tekleşti.
    const govdeler: unknown[] = [
      {}, { nameSearch: '' }, { nameSearch: '   ' }, { nameSearch: 5 }, { whereStr: "cari_unvan1 LIKE '%a%'" },
      { nameSearch: 'yapı' }, { nameSearch: '%' }, { nameSearch: '_' }, { nameSearch: 'a' }, null,
    ];
    for (const govde of govdeler) {
      const sonuc: Record<string, number> = {};
      for (const k of Object.keys(KIMLIKLER)) sonuc[k] = (await istek(uc, { kimlik: k, govde })).kod;
      expect(sonuc, JSON.stringify(govde)).toEqual(beklenen);
    }
    // Kilitlenenler (bilerek): arama kutusunu ilk turda gören Satın Alma, Lojistik, Muhasebe — arama gövdesiyle de 403.
    for (const rol of KARAR_KILIDI[uc]) expect((await istek(uc, { kimlik: rol, govde: { nameSearch: 'yapı' } })).kod, rol).toBe(403);
  });

  it('D4 — gövdesiz POST gövdeye bağlı kapıları çökertmez (express `req.body` tanımsız): iç rol geçer, dış rol 403', async () => {
    for (const uc of [`POST ${P}/cari/kaydet`, `POST ${P}/evrak/kaydet`]) {
      expect((await istek(uc, { kimlik: 'Admin', govde: null })).kod, uc).toBe(200);
      expect((await istek(uc, { kimlik: 'B2B', govde: null })).kod, uc).toBe(403);
      expect((await istek(uc, { kimlik: 'rolsuz', govde: null })).kod, uc).toBe(403);
    }
  });

  it('D5 — 403 metni kapıya göre (istemcinin ekranda gösterdiği metin)', async () => {
    expect((await istek(`GET ${P}/status`, { kimlik: 'B2B' })).govde).toEqual({ error: 'Bu işlem için personel yetkisi gerekir.' });
    // K6: e-belge çekme artık ince kapıda — dış rol de kilitlenen iç rol de AYNI metni görür.
    expect((await istek(`POST ${P}/ebelge/gelen`, { kimlik: 'B2B' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
    expect((await istek(`POST ${P}/ebelge/gelen`, { kimlik: 'Sales' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
    expect((await istek(`POST ${P}/yevmiye/kaydet`, { kimlik: 'Sales' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
    expect((await istek(`POST ${P}/tamir/ham-satir-temizle`, { kimlik: 'Accounting' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
    expect((await istek(`GET ${P}/tablolar`, { kimlik: 'Dealer' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
    // İç personel + ince kapı: dış rol İLK halkada (personel), `orders` yazamayan iç rol ikincide durur.
    expect((await istek(`POST ${P}/siparis/kaydet`, { kimlik: 'Dealer' })).govde).toEqual({ error: 'Bu işlem için personel yetkisi gerekir.' });
    expect((await istek(`POST ${P}/siparis/kaydet`, { kimlik: 'HR' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
    // H4 — teklif yöntemi aynı çift: dış rol personel halkasında, `quotations` yazamayan iç rol (Muhasebe) kural halkasında durur.
    const teklif = { method: 'VerilenTeklifKaydetV2', payload: {} };
    expect((await istek(`POST ${P}/evrak/kaydet`, { kimlik: 'B2B', govde: teklif })).govde).toEqual({ error: 'Bu işlem için personel yetkisi gerekir.' });
    expect((await istek(`POST ${P}/evrak/kaydet`, { kimlik: 'Dealer', govde: teklif })).govde).toEqual({ error: 'Bu işlem için personel yetkisi gerekir.' });
    expect((await istek(`POST ${P}/evrak/kaydet`, { kimlik: 'Accounting', govde: teklif })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
  });

  it('D6 — kullanıcı kararları KORUNUYOR: Satış e-İrsaliye kesemez; sipariş silme Yönetici + Müdür; fatura her iç role açık; Satış kasa tahsilatı / tediyesi yazamaz', async () => {
    const gecen = async (uc: string) => {
      const out: string[] = [];
      for (const rol of APP_ROLES) if ((await istek(uc, { kimlik: rol })).kod === 200) out.push(rol);
      return sirali(out);
    };
    expect(await gecen(`POST ${P}/irsaliye/kaydet`)).toEqual(sirali(['Admin', 'Manager', 'Logistics']));
    expect((await istek(`POST ${P}/irsaliye/kaydet`, { kimlik: 'Sales' })).kod).toBe(403);
    expect(await gecen(`POST ${P}/siparis/sil`)).toEqual(sirali(['Admin', 'Manager']));
    expect(await gecen(`POST ${P}/fatura/kaydet`)).toEqual(sirali(IC));
    expect((await istek(`POST ${P}/tahsilat/kaydet`, { kimlik: 'Sales' })).kod).toBe(403);
    expect(await gecen(`POST ${P}/tahsilat/kaydet`)).toEqual(sirali(['Admin', 'Manager', 'Accounting']));
    // Yıkıcı / bakım uçları: Yönetici + Müdür.
    expect(await gecen(`POST ${P}/tamir/ham-satir-temizle`)).toEqual(sirali(['Admin', 'Manager']));
    expect(await gecen(`GET ${P}/tablolar`)).toEqual(sirali(['Admin', 'Manager']));
  });

  it('D7 — 8 ops ucu: jetonsuz ve yanlış jetonlu istek 401, kimlik başlığından BAĞIMSIZ; Mikro\'ya gidilmez', async () => {
    const OPS = Object.keys(BEKLENEN).filter(opsMu);
    expect(OPS).toHaveLength(8);
    vi.mocked(mikroSql).mockClear();
    vi.mocked(mikroPost).mockClear();
    expect(await kodlar(OPS, {})).toEqual(hepsi(OPS, 401));
    expect(await kodlar(OPS, { kimlik: 'Admin' })).toEqual(hepsi(OPS, 401));
    expect(await kodlar(OPS, { kimlik: 'super-rolsuz', basliklar: { 'x-ops-token': 'yanlis' } })).toEqual(hepsi(OPS, 401));
    expect(mikroSql).not.toHaveBeenCalled();
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('D8 — süper yönetici (sahip hesabı, rolü boş): 54 kapılı ucun hepsi 200 — hiçbir kapı sahibini kilitlemez', async () => {
    expect(await kodlar(KAPILI, { kimlik: 'super-rolsuz' })).toEqual(hepsi(KAPILI, 200));
    expect((await istek(`POST ${P}/cari/kaydet`, { kimlik: 'super-rolsuz', govde: { collection: 'suppliers' } })).kod).toBe(200);
    expect((await istek(`POST ${P}/evrak/kaydet`, { kimlik: 'super-rolsuz', govde: { method: 'PersonelKaydetV2' } })).kod).toBe(200);
    // Karar turunun kilitleri sahibi de kilitlemez: çiftli teklif kapısı (iki halka) ve K1–K7 uçları.
    for (const anahtar of Object.keys(KARAR_KILIDI)) {
      const [uc, yontem] = anahtar.split('#');
      expect((await istek(uc, { kimlik: 'super-rolsuz', govde: yontem ? { method: yontem, payload: {} } : {} })).kod, anahtar).toBe(200);
    }
    // Aynı e-posta DOĞRULANMAMIŞSA baypas yok (ön kayıtla ele geçirme).
    KIMLIKLER['super-dogrulanmamis'] = { rol: null, eposta: SUPER_EPOSTA, dogrulanmis: false };
    try {
      expect((await istek(`POST ${P}/import/stok`, { kimlik: 'super-dogrulanmamis' })).kod).toBe(403);
    } finally { delete KIMLIKLER['super-dogrulanmamis']; }
  });

  it('D9 — evrak/kaydet: 26 yöntem × 14 kimlik tabloya göre; tanınmayan yöntemde dış rol 403, iç rol işleyiciye ulaşır', async () => {
    const uc = `POST ${P}/evrak/kaydet`;
    const kimlikler = Object.keys(KIMLIKLER);
    expect(kimlikler).toHaveLength(14);
    for (const [yontem, etiket] of Object.entries(EVRAK_BEKLENEN)) {
      const gecen = gecenRoller(etiket) as string[];
      const beklenen = Object.fromEntries(kimlikler.map(k => [k, k === 'super-rolsuz' || gecen.includes(k) ? 200 : 403]));
      const gelen = Object.fromEntries(await Promise.all(kimlikler.map(async k => [k, (await istek(uc, { kimlik: k, govde: { method: yontem, payload: {} } })).kod] as const)));
      expect(gelen, yontem).toEqual(beklenen);
    }
    // Asıl açık: serbest gövdeli dekont İK / Hukuk / Kurumsal / Kalite / Lojistik'e KAPALI; karar turundan (K3-a) beri
    // Satış ve Satın Alma'ya da — kapı `cari-hareket/kaydet` ile AYNI (`mikroCariHareketler` yazma).
    expect(EVRAK_BEKLENEN.DekontKaydetV2).toBe(BEKLENEN[`POST ${P}/cari-hareket/kaydet`]);
    for (const rol of ['HR', 'Legal', 'Corporate', 'Quality', 'Logistics', 'Sales', 'Purchasing']) {
      expect((await istek(uc, { kimlik: rol, govde: { method: 'DekontKaydetV2', payload: {} } })).kod, rol).toBe(403);
    }
    for (const yontem of ['BilinmeyenV2', 'constructor', 'toString', '']) {
      const gelen = Object.fromEntries(await Promise.all(kimlikler.map(async k => [k, (await istek(uc, { kimlik: k, govde: { method: yontem } })).kod] as const)));
      expect(gelen, `'${yontem}'`).toEqual(Object.fromEntries(kimlikler.map(k => [k, DIS.includes(k) ? 403 : 200])));
    }
  });

  it('D10 — karar kilitleri gerçek zincirde (§ 10.1, K1–K7): KARAR_KILIDI\'ndaki her rol 403; kapıdan geçen her rol 200; 12 rolün tamamı tabloya göre', async () => {
    for (const [anahtar, kilitli] of Object.entries(KARAR_KILIDI)) {
      const [uc, yontem] = anahtar.split('#');
      const govde = yontem ? { method: yontem, payload: {} } : {};
      const gecen = gecenRoller(dalEtiketi(anahtar));
      const sonuc: Record<string, { kod: number; hata?: string }> = Object.fromEntries(await Promise.all(APP_ROLES.map(async r => {
        const y = await istek(uc, { kimlik: r, govde });
        return [r, { kod: y.kod, hata: y.govde.error }] as const;
      })));
      for (const rol of kilitli) {
        expect(sonuc[rol].kod, `${anahtar} × ${rol}: kilitli rol`).toBe(403);
        // Kilitlenen İÇ rol her zaman KURAL halkasında durur (personel halkasını geçer) — ekranda görünecek metin budur.
        expect(sonuc[rol].hata, `${anahtar} × ${rol}`).toBe('Bu veri için yetkiniz yok.');
      }
      for (const rol of gecen) expect(sonuc[rol].kod, `${anahtar} × ${rol}: geçen rol`).toBe(200);
      expect(Object.fromEntries(APP_ROLES.map(r => [r, sonuc[r].kod])), anahtar).toEqual(Object.fromEntries(APP_ROLES.map(r => [r, gecen.includes(r) ? 200 : 403])));
      expect((await istek(uc, { kimlik: 'rolsuz', govde })).kod, `${anahtar} × rolsüz`).toBe(403);
    }
  });

  it('D11 — K7 / H1: e-belge PDF + XML İKİ YÖNDE de tek sabit kapı (Yönetici, Müdür, Muhasebe); gövdedeki yön beyanı ve kimlik biçimi kapıyı DEĞİŞTİRMEZ', async () => {
    const KIMLIK = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const govdeler: unknown[] = [
      {}, null,
      { uuid: KIMLIK }, { faturaGuid: KIMLIK }, { uuid: KIMLIK, faturaGuid: KIMLIK },
      // Yön BEYANI: «giden belge Satış'a açık» dalı YAZILMADI — beyan Satış'ı (ya da kimseyi) geçirmez.
      { uuid: KIMLIK, yon: 'giden' }, { faturaGuid: KIMLIK, yon: 'giden' }, { uuid: KIMLIK, yon: 'gelen', tur: 'e-fatura' }, { uuid: KIMLIK, yon: 'giden', tur: 'e-arsiv' },
      // Mikro'nun döndürdüğü süslü parantezli biçim (38 karakter): kapı aynı; işleyici bugün 400 verir (düzeltme ayrı iş).
      { uuid: `{${KIMLIK}}` }, { faturaGuid: `{${KIMLIK}}`, yon: 'giden' },
    ];
    const beklenen = Object.fromEntries(Object.keys(KIMLIKLER).map(k => [k, ['Admin', 'Manager', 'Accounting', 'super-rolsuz'].includes(k) ? 200 : 403]));
    for (const uc of [`POST ${P}/ebelge/pdf`, `POST ${P}/ebelge/xml`]) {
      for (const govde of govdeler) {
        const sonuc = Object.fromEntries(await Promise.all(Object.keys(KIMLIKLER).map(async k => [k, (await istek(uc, { kimlik: k, govde })).kod] as const)));
        expect(sonuc, `${uc} ${JSON.stringify(govde)}`).toEqual(beklenen);
      }
    }
  });

  it('D12 — evrak/kaydet: kural halkası FIRLATIRSA istek asılı kalmaz, hata express\'e taşınır (500) — çiftli dalda da (personel halkasının `next`\'i içinde)', async () => {
    const patlak = duzenekKur({
      kayit: (sahte, C) => mikroRoutes(sahte, {
        ...C, requireAuth: ikizAuth, requireMfaVerified: ikizMfa, requireStaff: ikizStaff,
        requireCollectionAccess: (): RequestHandler => async () => { throw new Error('rol okunamadı'); },
      }),
    });
    const app = express();
    app.use(express.json());
    const zincir = patlak.app.zincirler[`POST ${P}/evrak/kaydet`] as RequestHandler[];
    app.post(`${P}/evrak/kaydet`, ...zincir.slice(0, -1), NOBETCI);
    app.use((hata: unknown, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: String(hata) }); });
    const sunucu = http.createServer(app);
    await new Promise<void>(r => sunucu.listen(0, '127.0.0.1', () => r()));
    try {
      const adres = sunucu.address();
      if (!adres || typeof adres === 'string') throw new Error('test sunucusu dinlemiyor');
      const gonder = async (kimlik: string, method: string): Promise<Yanit> => {
        const r = await fetch(`http://127.0.0.1:${adres.port}${P}/evrak/kaydet`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-kimlik': kimlik },
          body: JSON.stringify({ method, payload: {} }), signal: AbortSignal.timeout(3000),   // asılı kalan istek testi düşürür
        });
        return { kod: r.status, govde: await r.json() as Yanit['govde'] };
      };
      // Çiftli dal (H4): personel halkası geçer, kural halkası onun `next`'i içinde fırlar — express bu sözü kendisi görmez.
      expect(await gonder('Sales', 'VerilenTeklifKaydetV2')).toEqual({ kod: 500, govde: { error: 'Error: rol okunamadı' } });
      // Düz dal.
      expect(await gonder('Accounting', 'DekontKaydetV2')).toEqual({ kod: 500, govde: { error: 'Error: rol okunamadı' } });
      // Personel halkasında duran istek kural halkasına HİÇ ulaşmaz (403, 500 değil).
      expect((await gonder('B2B', 'VerilenTeklifKaydetV2')).kod).toBe(403);
      // Kuralsız dal (yalnız iç personel): kural halkası çağrılmaz.
      expect((await gonder('HR', 'EtiketBasimKaydetV2')).kod).toBe(200);
    } finally { await new Promise<void>(r => sunucu.close(() => r())); }
  });
});

describe('ebelge/pdf + ebelge/xml işleyicisi — kimlik biçimi (karar turu işleyiciye DOKUNMADI; süslü parantez düzeltmesi ayrı iş)', () => {
  const KIMLIK = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('36 karakterlik kimlik Mikro\'ya iletilir: PDF\'te `uuid` → GelenFaturaPdfV2, yalnız `faturaGuid` → FaturaPdfV2; XML\'de yön beyanı `EFaturaTipi` olur', async () => {
    const duz = duzenekKur();
    vi.mocked(mikroPost).mockClear();
    await duz.cagir('POST', `${P}/ebelge/pdf`, { uuid: KIMLIK, faturaGuid: KIMLIK });
    expect(mikroPost).toHaveBeenLastCalledWith('GelenFaturaPdfV2', { UUID: KIMLIK }, true);
    await duz.cagir('POST', `${P}/ebelge/pdf`, { faturaGuid: KIMLIK });
    expect(mikroPost).toHaveBeenLastCalledWith('FaturaPdfV2', { Fatura_Guid: KIMLIK }, true);
    await duz.cagir('POST', `${P}/ebelge/xml`, { uuid: KIMLIK, yon: 'gelen' });
    expect(mikroPost).toHaveBeenLastCalledWith('EBelgeXMLV2', { EBelge: { EFaturaTipi: 1, EBelgeTipi: 0, UUID: KIMLIK } }, true);
    await duz.cagir('POST', `${P}/ebelge/xml`, { uuid: KIMLIK, yon: 'giden', tur: 'e-arsiv' });
    expect(mikroPost).toHaveBeenLastCalledWith('EBelgeXMLV2', { EBelge: { EFaturaTipi: 0, EBelgeTipi: 1, UUID: KIMLIK } }, true);
    expect(mikroPost).toHaveBeenCalledTimes(4);
  });

  it('süslü parantezli (38 karakter) ya da eksik kimlik 400 döner ve Mikro\'ya GİDİLMEZ', async () => {
    const duz = duzenekKur();
    vi.mocked(mikroPost).mockClear();
    for (const govde of [{ uuid: `{${KIMLIK}}` }, { faturaGuid: `{${KIMLIK}}` }, { uuid: 'kisa' }, {}]) {
      expect((await duz.cagir('POST', `${P}/ebelge/pdf`, govde)).kod, `pdf ${JSON.stringify(govde)}`).toBe(400);
    }
    for (const govde of [{ uuid: `{${KIMLIK}}` }, { faturaGuid: KIMLIK }, { uuid: 'kisa' }, {}]) {
      expect((await duz.cagir('POST', `${P}/ebelge/xml`, govde)).kod, `xml ${JSON.stringify(govde)}`).toBe(400);
    }
    expect(mikroPost).not.toHaveBeenCalled();
  });
});

describe('evrak/kaydet işleyicisi — beyaz liste tabloyla aynı (kapıdan geçen tanınmayan yöntem Mikro\'ya GİTMEZ)', () => {
  it('tanınmayan / miras anahtar yöntem 400; tablodaki yöntem Mikro\'ya iletilir', async () => {
    const duz = duzenekKur();
    vi.mocked(mikroPost).mockClear();
    for (const method of ['BilinmeyenV2', 'constructor', 'toString', '', 5, undefined]) {
      const r = await duz.cagir('POST', `${P}/evrak/kaydet`, { method, payload: {} });
      expect(r.kod, String(method)).toBe(400);
      expect((r.govde as { error?: string }).error).toBe(`Geçersiz veya izinsiz method: ${String(method)}`);
    }
    expect(mikroPost).not.toHaveBeenCalled();
    const r = await duz.cagir('POST', `${P}/evrak/kaydet`, { method: 'ZiyaretKaydetV2', payload: { a: 1 } });
    expect(r.kod).toBe(200);
    expect(mikroPost).toHaveBeenCalledWith('ZiyaretKaydetV2', { a: 1 }, true);
  });
});
