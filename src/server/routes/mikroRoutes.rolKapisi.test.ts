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
 *   K — kilit değişmezi (Ç13 / Ç14): hiçbir ince kapı, ucu çağıran ekranı BUGÜN gören bir iç rolü kilitlemez.
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
import { MIKRO_EVRAK_KAPILARI, evrakKapisindanGecer, evrakYontemi } from '../../lib/mikroEvrakKapilari.js';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari } from '../../test/kaynakTarama';

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

type Kapi = 'ops' | 'staff' | 'staff+orders:write' | 'govde:cari' | 'govde:cariListesi' | 'govde:evrak' | `${string}:${DbOp}`;

const P = '/api/mikro';
/** mikroRoutes.ts'teki HER kayıt (13 fabrika ucu dâhil). Yeni uç buraya BİLİNÇLİ girer — kapısıyla birlikte. */
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
  [`POST ${P}/pull/uretim-receteleri`]: 'staff',
  [`POST ${P}/ebelge/gelen`]: 'staff',
  [`POST ${P}/ebelge/giden`]: 'staff',
  [`POST ${P}/ebelge/eirsaliye`]: 'staff',
  [`GET ${P}/ebelge/mukellef/:vkn`]: 'staff',
  [`POST ${P}/ebelge/pdf`]: 'staff',
  [`POST ${P}/ebelge/xml`]: 'staff',
  // ── İç personel + ince kapı (kural dış rol içerdiği için ikisi birlikte) ──
  [`POST ${P}/siparis/kaydet`]: 'staff+orders:write',
  [`POST ${P}/import/faturadan-siparis`]: 'staff+orders:write',
  // ── Gövdeye bağlı ──
  [`POST ${P}/cari/kaydet`]: 'govde:cari',
  [`POST ${P}/cari/listesi`]: 'govde:cariListesi',
  [`POST ${P}/evrak/kaydet`]: 'govde:evrak',
  // ── Sabit ince kapı ──
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
  [`POST ${P}/tamir/ham-satir-temizle`]: 'bankAccounts:delete',
  [`GET ${P}/cari-hareket/turler`]: 'leads:read',
  [`GET ${P}/cari-hareket/:cariKod`]: 'mikroCariHareketler:read',
  [`POST ${P}/cari-hareket/kaydet`]: 'mikroCariHareketler:write',
  [`POST ${P}/yevmiye/kaydet`]: 'journalEntries:write',
  [`POST ${P}/tahsilat/kaydet`]: 'kasaHareketleri:write',
  [`POST ${P}/pull/kdv`]: 'taxSummary:write',
  [`POST ${P}/pull/personel`]: 'employees:read',
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
  'employees:read': ['Admin', 'Manager', 'HR', 'Accounting'],
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
  'employees:write': ['Admin', 'HR'],
  'isEmirleri:write': ['Admin', 'Manager', 'Logistics'],
  'routingTemplates:write': ['Admin', 'Manager', 'Logistics', 'Quality'],
};

/** `evrak/kaydet` yöntemi → kapı etiketi. ELLE yazılır; kaynak tabloyla (src/lib/mikroEvrakKapilari.ts) eşitliği sınanır. */
const EVRAK_BEKLENEN: Record<string, string> = {
  DekontKaydetV2: 'leads:read',
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
  VerilenTeklifKaydetV2: 'staff',
  DahiliStokHareketKaydetV2: 'staff',
  SayimSonuclariKaydetV2: 'staff',
  EtiketBasimKaydetV2: 'staff',
  PersonelIzinTalepKaydetV2: 'staff',
  UrunReceteKaydetV2: 'staff',
  UretimTalepKaydetV2: 'staff',
  UretimIsEmriOlusturV2: 'staff',
  SatinAlmaTalepKaydetV2: 'staff',
  BakimTalepKaydetV2: 'staff',
  DepolarArasiSiparisKaydetV2: 'staff',
};

const gecenRoller = (etiket: string): AppRole[] => {
  const r = GECEN[etiket];
  if (!r) throw new Error(`GECEN tablosunda '${etiket}' yok — kapıyı tabloya ekle.`);
  return r;
};
const sirali = (a: readonly string[]): string[] => [...a].sort();
const opsMu = (anahtar: string): boolean => BEKLENEN[anahtar] === 'ops';
const KAPILI = Object.keys(BEKLENEN).filter(a => !opsMu(a));

// ── R2: ekranı gören roller (kilit değişmezi) ─────────────────────────────────
// Sekmeyi gören İÇ roller (App.tsx TAB_PERMISSIONS, tam + salt okunur). Elle yazılır.
const AYARLAR: AppRole[] = ['Admin', 'Manager'];                                                   // settings — Mikro paneli (Ç14)
const MUHASEBE: AppRole[] = ['Admin', 'Accounting', 'Manager'];
const CRM: AppRole[] = ['Admin', 'Manager', 'Sales', 'Accounting', 'Purchasing'];                  // crm, orders
const STOK: AppRole[] = ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Accounting', 'Sales'];    // inventory, lojistik
const SATIN_ALMA: AppRole[] = ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Accounting'];
const IK: AppRole[] = ['Admin', 'Manager', 'HR', 'Accounting'];
const URETIM: AppRole[] = ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Quality'];
const EBELGE: AppRole[] = ['Admin', 'Accounting', 'Manager', 'Sales', 'Logistics'];
const birlesim = (...kumeler: AppRole[][]): AppRole[] => [...new Set(kumeler.flat())];

/** Ayarlar → Mikro panelinden çağrılan uçlar (MikroSyncPanel kartları ve düğmeleri). */
const AYARLAR_PANELI = [
  'import/stok', 'import/cari', 'import/stok-miktar', 'import/gib-durum', 'import/faturadan-siparis', 'tamir/ham-satir-temizle',
  'pull/kdv', 'pull/bakiye', 'pull/cari-adres', 'pull/mizan', 'gelen-fatura/kabul', 'gelen-fatura/ret',
  'import/siparis', 'import/fatura-listesi', 'import/iptal-faturalar', 'import/cari-hareket', 'import/stok-hareket', 'import/banka',
  'import/kasa', 'import/odeme-plan', 'import/depo', 'import/barkod', 'import/fiyat', 'import/demirbas', 'import/maliyet-merkezi',
];
/**
 * R2: ucu çağıran ekranı / düğmeyi BUGÜN gören İÇ roller. Elle yazılır; ekran başka role açılınca BİLİNÇLİ güncellenir.
 * Gövdeye bağlı uçlar DAL başına ayrı anahtar taşır (`#…`). «Önce Cetpa'ya yazan» çağıranlarda küme, o yazımı
 * başarabilen rollerdir (yazım 403'te fırlatır, Mikro çağrısına ulaşılmaz).
 */
const EKRANI_GOREN: Record<string, AppRole[]> = {
  ...Object.fromEntries(AYARLAR_PANELI.map(u => [`POST ${P}/${u}`, AYARLAR])),
  [`GET ${P}/status`]: birlesim(AYARLAR, EBELGE),
  [`POST ${P}/cari/kaydet#leads`]: ['Admin', 'Manager', 'Sales'],            // sipariş penceresi: `orders` yazıp `leads` okuyabilen
  [`POST ${P}/cari/kaydet#suppliers`]: ['Admin', 'Manager', 'Purchasing'],   // Satın Alma: `suppliers` yazımından sonra
  [`POST ${P}/cari/listesi#ara`]: birlesim(SATIN_ALMA, CRM),                 // iki «Mikro'da ara» kutusu
  [`POST ${P}/siparis/kaydet`]: ['Admin', 'Manager', 'Sales'],               // sipariş yazımından sonra, müşteri seçiliyken
  [`POST ${P}/fatura/kalemler`]: birlesim(MUHASEBE, CRM, SATIN_ALMA, STOK),  // Fatura Detayı penceresi
  [`POST ${P}/fatura/kaydet`]: birlesim(CRM, STOK),                          // Siparişler ekranı (orders + lojistik sekmeleri)
  [`GET ${P}/cari-hareket/turler`]: birlesim(MUHASEBE, CRM),                 // dekont penceresi (Muhasebe + CRM → Müşteriler)
  [`GET ${P}/cari-hareket/:cariKod`]: birlesim(MUHASEBE, CRM, SATIN_ALMA),   // cari ekstre paneli
  [`POST ${P}/tahsilat/kaydet`]: ['Admin', 'Accounting'],                    // Muhasebe → Tahsilat, yalnız tam yetkili
  [`POST ${P}/pull/personel`]: birlesim(AYARLAR, IK),                        // Ayarlar kartı + İK ekranı açılışı
  [`POST ${P}/pull/uretim-receteleri`]: birlesim(AYARLAR, URETIM),           // Ayarlar kartı + Üretim ekranı açılışı
  [`POST ${P}/siparis/sil`]: ['Admin', 'Manager'],                           // sil düğmesi `orders` silme kuralına bağlı
  [`POST ${P}/ebelge/gelen`]: EBELGE,
  [`POST ${P}/ebelge/giden`]: EBELGE,
  [`POST ${P}/ebelge/eirsaliye`]: EBELGE,
  [`POST ${P}/ebelge/pdf`]: birlesim(EBELGE, MUHASEBE, CRM, SATIN_ALMA, STOK),
  [`POST ${P}/ebelge/xml`]: birlesim(EBELGE, MUHASEBE, CRM, SATIN_ALMA, STOK),
  [`POST ${P}/irsaliye/kaydet`]: ['Admin', 'Manager', 'Logistics'],          // düğme `shipments` yazma kuralına bağlı
  // ── evrak/kaydet: çağıranı olan 14 yöntem ──
  [`POST ${P}/evrak/kaydet#VerilenTeklifKaydetV2`]: ['Admin', 'Manager', 'Sales', 'Accounting'],   // B2B Portalı; dış rolde düğme GİZLİ (Ç15)
  [`POST ${P}/evrak/kaydet#DekontKaydetV2`]: birlesim(MUHASEBE, CRM),
  [`POST ${P}/evrak/kaydet#DahiliStokHareketKaydetV2`]: ['Admin', 'Manager', 'Logistics', 'Purchasing', 'Accounting'],
  [`POST ${P}/evrak/kaydet#SayimSonuclariKaydetV2`]: ['Admin', 'Manager', 'Logistics'],            // `wmsCycleCounts` yazımından sonra
  [`POST ${P}/evrak/kaydet#EtiketBasimKaydetV2`]: STOK,                                            // etiket penceresi Stok ekranından açılır
  [`POST ${P}/evrak/kaydet#PersonelIzinTalepKaydetV2`]: IK,
  [`POST ${P}/evrak/kaydet#UrunReceteKaydetV2`]: URETIM,
  [`POST ${P}/evrak/kaydet#UretimTalepKaydetV2`]: birlesim(URETIM, ['Accounting']),               // + mrp (productionOrders okuyan)
  [`POST ${P}/evrak/kaydet#UretimIsEmriOlusturV2`]: URETIM,
  [`POST ${P}/evrak/kaydet#SatinAlmaTalepKaydetV2`]: birlesim(SATIN_ALMA, ['Quality']),            // + mrp
  [`POST ${P}/evrak/kaydet#ServisIsEmriKaydetV2`]: ['Admin', 'Manager', 'Sales', 'Logistics'],     // servis sekmesi
  [`POST ${P}/evrak/kaydet#BakimTalepKaydetV2`]: ['Admin', 'Manager', 'Logistics', 'Purchasing'],  // bakim sekmesi
  [`POST ${P}/evrak/kaydet#DepolarArasiSiparisKaydetV2`]: birlesim(STOK, MUHASEBE),
  [`POST ${P}/evrak/kaydet#ZiyaretKaydetV2`]: ['Admin', 'Manager', 'Sales'],                       // `leads` yazımından sonra
};
/** İstemcide çağıranı OLMAYAN uçlar / gövde dalları — kilitlenecek kimse yok. Çağıran eklenince `EKRANI_GOREN`'e taşınır. */
const CAGIRANI_YOK: string[] = [
  `GET ${P}/tablolar`, `POST ${P}/stok/kaydet`, `POST ${P}/stok/listesi`, `POST ${P}/cari/listesi#tam`,
  `POST ${P}/cari-hareket/kaydet`, `POST ${P}/yevmiye/kaydet`, `POST ${P}/import/faturalar`, `POST ${P}/ebelge/durum`,
  `GET ${P}/ebelge/mukellef/:vkn`, `POST ${P}/ebelge/earsiv-iptal`,
  ...['AlinanTeklifKaydetV2', 'SayimKesinlestirmeV2', 'PersonelizinKaydetV2', 'PersonelKaydetV2', 'BakimHareketleriKaydetV2',
    'BakimSarfiyatlariKaydetV2', 'BakimSozlesmeKaydetV2', 'ServisFormuKaydetV2', 'ServisMalzemePlanKaydetV2', 'ServisRotaPlanKaydetV2',
    'UrunRotaKaydetV2', 'UretimRotaPlanKaydetV2'].map(y => `POST ${P}/evrak/kaydet#${y}`),
];
/** Bu işten ÖNCE de var olan kilitler — ADIYLA. Bu iş yeni kilit EKLEMEZ; buraya satır eklemek kullanıcı kararıdır.
 *  Cari ekstre paneli Satış / Satın Alma / Lojistik'te boş kalıyor (uç 2026-08'den beri `mikroCariHareketler` okuma kapılı). */
const BILINEN_KILIT: Record<string, AppRole[]> = {
  [`GET ${P}/cari-hareket/:cariKod`]: ['Sales', 'Purchasing', 'Logistics'],
};
/** Gövdeye bağlı uçların dalları → o dalın etkin kapı etiketi. */
const DAL_KAPISI: Record<string, string> = {
  [`POST ${P}/cari/kaydet#leads`]: 'leads:write',
  [`POST ${P}/cari/kaydet#suppliers`]: 'suppliers:write',
  [`POST ${P}/cari/listesi#ara`]: 'staff',
  [`POST ${P}/cari/listesi#tam`]: 'leads:write',
  ...Object.fromEntries(Object.entries(EVRAK_BEKLENEN).map(([y, k]) => [`POST ${P}/evrak/kaydet#${y}`, k])),
};
/** Gövdesiz / boş gövdeli istekte gövdeye bağlı kapının düştüğü dal (D1–D3 matrisi boş gövdeyle koşar). */
const BOS_GOVDE_DALI: Record<string, string> = { 'govde:cari': 'leads:write', 'govde:cariListesi': 'leads:write', 'govde:evrak': 'staff' };
const etkinEtiket = (anahtar: string): string => {
  const k = BEKLENEN[anahtar];
  return BOS_GOVDE_DALI[k] ?? k;
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
const HALKA = String.raw`C\.requireAuth|C\.requireMfaVerified|C\.requireStaff|C\.mikroLimiter|cariHedefKapisi|cariListesiKapisi|evrakYontemKapisi|C\.requireCollectionAccess\((?:'[A-Za-z]+'|opts\.collection), '(?:read|write|delete)'\)`;
/** BAŞTAN SONA çapalı: tanınmayan halka, adlandırılmış işleyici, `async function`, değişkenli yol → eşleşmez. */
const BASLIK = new RegExp(String.raw`^app\.(get|post)\((?:'(\/api\/mikro\/[A-Za-z0-9/:-]+)'|(opts\.route))((?:, (?:${HALKA}))*), async \(_?req: Request, res: Response\) => \{$`);
const HALKA_AYIR = new RegExp(`, (${HALKA})`, 'g');
const ROL_HALKASI = /^(?:C\.requireStaff|cariHedefKapisi|cariListesiKapisi|evrakYontemKapisi|C\.requireCollectionAccess\(.+\))$/;

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
  if (h[0] === 'cariListesiKapisi') return 'govde:cariListesi';
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

  it('Ç1 — 50 kayıt (48 yazılı yol + 2 fabrika); `app` yalnız kayıt satırlarında ve imzada geçer (takma ad / devretme / app.route yok)', () => {
    expect(K()).toHaveLength(50);
    expect(yazili()).toHaveLength(48);
    expect(fabrika()).toHaveLength(2);
    const appGecen = kod.filter(s => /\bapp\b/.test(s.kod));
    expect(appGecen.map(s => s.kod).filter(k => !KAYIT.test(k))).toEqual(['export function mikroRoutes(app: Express, C: MikroRouteCtx): void {']);
    expect(appGecen).toHaveLength(K().length + 1);
    expect(mikroSatir.filter(k => /\bapp\.(put|patch|delete|all|use|route)\(/.test(k))).toEqual([]);
  });

  it('Ç2 — yazılı 48 yol + 13 fabrika rotası = BEKLENEN anahtar kümesi (61); fabrika tanımları rota ↔ koleksiyon eşli, ölü fabrika çağrılmıyor', () => {
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
    expect(Object.keys(BEKLENEN)).toHaveLength(61);
  });

  it('Ç3 / Ç4 / Ç5 — ops dışındaki her kayıt: kimlik → [MFA] → ROL KAPISI → [hız sınırı]; kapı metni BEKLENEN etiketiyle aynı', () => {
    for (const k of yazili()) {
      const anahtar = `${k.yontem} ${k.yol}`;
      if (opsMu(anahtar)) continue;
      expect(etiketCikar(k), anahtar).toBe(BEKLENEN[anahtar]);
    }
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

  it('Ç7 — gövdeye bağlı üç kapı tam metin; işleyiciler kapıyla AYNI ayıklayıcıyı kullanır; ayrı beyaz liste yok', () => {
    const TEK = [
      "(govde as { collection?: unknown } | undefined)?.collection === 'suppliers' ? 'suppliers' : 'leads';",
      "C.requireCollectionAccess(cariHedefKoleksiyonu(req.body), 'write')(req, res, next);",
      'const targetCollection = cariHedefKoleksiyonu(req.body);',
      "return typeof m === 'string' ? m.trim().slice(0, 100) : '';",
      "cariAramaMetni(req.body) ? C.requireStaff(req, res, next) : C.requireCollectionAccess('leads', 'write')(req, res, next);",
      'const nameSearch = cariAramaMetni(req.body);',
      'const kapi = MIKRO_EVRAK_KAPILARI.get(evrakYontemi(req.body));',
      "return kapi === undefined || kapi === 'staff' ? C.requireStaff(req, res, next) : C.requireCollectionAccess(kapi[0], kapi[1])(req, res, next);",
      'const method = evrakYontemi(req.body);',
      'if (!MIKRO_EVRAK_KAPILARI.has(method)) {',
      'const { ok, data, status } = await mikroPost(method, payload, true);',
    ];
    for (const satir of TEK) expect(adet(mikroSatir, satir), satir).toBe(1);
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

  it('Ç9 — politika değişmezi: her ince kapı kuralı AÇIK tanımlı, dış rol ve rolsüz hesap GEÇEMEZ (tek istisna requireStaff ile çiftli orders yazma)', () => {
    const etiketler = new Set<string>([
      ...KAPILI.map(a => BEKLENEN[a]), 'leads:write', 'suppliers:write', ...Object.values(EVRAK_BEKLENEN),
    ]);
    for (const etiket of etiketler) {
      if (etiket === 'staff' || etiket.startsWith('govde:')) continue;
      if (etiket === 'staff+orders:write') {
        // Kural dış rol içerir → TEK BAŞINA kapı olamaz; Ç5 onu yalnız requireStaff ile çiftli kabul eder.
        expect(EXTERNAL_ROLES.some(r => isAllowed(r, 'orders', 'write'))).toBe(true);
        continue;
      }
      const [k, e] = etiket.split(':') as [string, DbOp];
      expect(hasExplicitRule(k) || ADMIN_ONLY_COLLECTIONS.has(k), `${etiket}: kuralsız koleksiyon (yalnız Admin geçer = sessiz kilit)`).toBe(true);
      expect(EXTERNAL_ROLES.filter(r => isAllowed(r, k, e)), `${etiket}: dış rol geçiyor`).toEqual([]);
      expect(isAllowed(null, k, e), `${etiket}: rolsüz hesap geçiyor`).toBe(false);
    }
  });

  it('Ç10 — elle yazılan GECEN tablosu gerçek kuralla aynı', () => {
    expect(sirali(GECEN.staff)).toEqual(sirali(STAFF_ROLES));
    expect(sirali(GECEN['staff+orders:write'])).toEqual(sirali(STAFF_ROLES.filter(r => isAllowed(r, 'orders', 'write'))));
    for (const [etiket, roller] of Object.entries(GECEN)) {
      if (etiket === 'staff' || etiket === 'staff+orders:write') continue;
      const [k, e] = etiket.split(':') as [string, DbOp];
      expect(sirali(roller), etiket).toEqual(sirali(APP_ROLES.filter(r => isAllowed(r, k, e))));
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

  it('evrak tablosu — kaynak tablo elle yazılan beklenenle aynı: 26 yöntem = 15 ince + 11 iç personel; miras anahtar beyaz listede değil', () => {
    const kaynak = Object.fromEntries([...MIKRO_EVRAK_KAPILARI].map(([y, k]) => [y, k === 'staff' ? 'staff' : `${k[0]}:${k[1]}`]));
    expect(kaynak).toEqual(EVRAK_BEKLENEN);
    expect(Object.values(EVRAK_BEKLENEN).filter(k => k === 'staff')).toHaveLength(11);
    expect(Object.values(EVRAK_BEKLENEN).filter(k => k !== 'staff')).toHaveLength(15);
    for (const ad of ['constructor', 'toString', 'hasOwnProperty', '__proto__', '']) expect(MIKRO_EVRAK_KAPILARI.has(ad), ad).toBe(false);
    expect(evrakYontemi(undefined)).toBe('');
    expect(evrakYontemi(null)).toBe('');
    expect(evrakYontemi({ method: 5 })).toBe('');
    expect(evrakYontemi({ method: ['DekontKaydetV2'] })).toBe('');
    expect(evrakYontemi({ method: 'DekontKaydetV2' })).toBe('DekontKaydetV2');
    // İstemci süzgeci (yeniden deneme kuyruğu) sunucu kapısıyla aynı kararı verir.
    for (const [yontem, etiket] of Object.entries(EVRAK_BEKLENEN)) {
      for (const rol of APP_ROLES) expect(evrakKapisindanGecer(rol, yontem), `${yontem} × ${rol}`).toBe(gecenRoller(etiket).includes(rol));
      expect(evrakKapisindanGecer(null, yontem)).toBe(false);
    }
    expect(APP_ROLES.filter(r => evrakKapisindanGecer(r, 'BilinmeyenV2'))).toEqual(STAFF_ROLES);
  });
});

describe('kilit değişmezi (R2) — hiçbir kapı, ucu çağıran ekranı bugün gören bir iç rolü kilitlemez', () => {
  /** Kapılı her uç; gövdeye bağlı üç uç dallarına açılır. */
  const TUM_DALLAR = [
    ...KAPILI.filter(a => !BEKLENEN[a].startsWith('govde:')),
    ...Object.keys(DAL_KAPISI),
  ];
  const dalEtiketi = (anahtar: string): string => DAL_KAPISI[anahtar] ?? BEKLENEN[anahtar];

  it('Ç13 — her uç / dal ya EKRANI_GOREN\'de ya CAGIRANI_YOK\'ta; görenlerin hepsi kapıdan geçer (bilinen eski kilitler adıyla)', () => {
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
        kilitler.push(`${anahtar} [${dalEtiketi(anahtar)}] → KİLİTLENEN: ${kilitlenen.join(', ') || '—'} (bilinen: ${(BILINEN_KILIT[anahtar] ?? []).join(', ') || '—'})`);
      }
    }
    expect(kilitler).toEqual([]);
    expect(Object.keys(BILINEN_KILIT).filter(a => !(a in EKRANI_GOREN))).toEqual([]);
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
    expect(portal.filter(k => k.includes('mikroGonderebilir='))).toEqual(['onConvertToOrder={handleConvertToOrder} mikroGonderebilir={icRol} t={currentT} />']);
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
  it('D0 — kayıtlı rota kümesi = BEKLENEN (61): takma adla, devrederek ya da yeni fabrikayla eklenen uç burada kırılır', () => {
    expect(sirali(Object.keys(d.app.zincirler))).toEqual(sirali(Object.keys(BEKLENEN)));
    expect(KAPILI).toHaveLength(53);
    const dagilim = (on: (k: Kapi) => boolean) => Object.values(BEKLENEN).filter(on).length;
    expect({
      ops: dagilim(k => k === 'ops'), staff: dagilim(k => k === 'staff'), staffArtiInce: dagilim(k => k === 'staff+orders:write'),
      govde: dagilim(k => k.startsWith('govde:')), ince: dagilim(k => /^[A-Za-z]+:(read|write|delete)$/.test(k)),
    }).toEqual({ ops: 8, staff: 10, staffArtiInce: 2, govde: 3, ince: 38 });
  });

  it('D1 — kimliksiz istek: 53 kapılı ucun hepsi 401', async () => {
    expect(await kodlar(KAPILI, {})).toEqual(hepsi(KAPILI, 401));
  });

  it.each(DIS)('D2 — %s: 53 kapılı ucun HEPSİ 403 (asıl açık: dış rol ve rolü çözülemeyen hesap)', async (kimlik) => {
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

  it('D4 — cari/listesi: arama metni yoksa TAM import = leads yazma kapısı; arama iç personele açık', async () => {
    const uc = `POST ${P}/cari/listesi`;
    const tamImport = { Admin: 200, Manager: 200, Sales: 200, Purchasing: 403, Logistics: 403, Accounting: 403, HR: 403, B2B: 403, Dealer: 403, rolsuz: 403 };
    for (const govde of [{}, { nameSearch: '' }, { nameSearch: '   ' }, { nameSearch: 5 }, { whereStr: "cari_unvan1 LIKE '%a%'" }]) {
      const sonuc: Record<string, number> = {};
      for (const k of Object.keys(tamImport)) sonuc[k] = (await istek(uc, { kimlik: k, govde })).kod;
      expect(sonuc, JSON.stringify(govde)).toEqual(tamImport);
    }
    // Joker (`%`, `_`) ve tek harf de ARAMA dalıdır: kapı sonucu aynı (iç rol 200, dış rol 403). Bu dalın tam importa
    // dönüşmesini işleyici engeller: tek sayfa + jokerler düz karakter (mikroRoutes.eslemeCari.test.ts).
    for (const nameSearch of ['yapı', '%', '_', 'a']) {
      const arama: Record<string, number> = {};
      for (const k of Object.keys(KIMLIKLER)) arama[k] = (await istek(uc, { kimlik: k, govde: { nameSearch } })).kod;
      expect(arama, nameSearch).toEqual({ ...Object.fromEntries(IC.map(r => [r, 200])), 'super-rolsuz': 200, B2B: 403, Dealer: 403, rolsuz: 403 });
    }
  });

  it('D4 — gövdesiz POST gövdeye bağlı kapıları çökertmez (express `req.body` tanımsız): iç rol geçer, dış rol 403', async () => {
    for (const uc of [`POST ${P}/cari/kaydet`, `POST ${P}/cari/listesi`, `POST ${P}/evrak/kaydet`]) {
      expect((await istek(uc, { kimlik: 'Admin', govde: null })).kod, uc).toBe(200);
      expect((await istek(uc, { kimlik: 'B2B', govde: null })).kod, uc).toBe(403);
      expect((await istek(uc, { kimlik: 'rolsuz', govde: null })).kod, uc).toBe(403);
    }
  });

  it('D5 — 403 metni kapıya göre (istemcinin ekranda gösterdiği metin)', async () => {
    expect((await istek(`POST ${P}/ebelge/gelen`, { kimlik: 'B2B' })).govde).toEqual({ error: 'Bu işlem için personel yetkisi gerekir.' });
    expect((await istek(`POST ${P}/yevmiye/kaydet`, { kimlik: 'Sales' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
    expect((await istek(`POST ${P}/tamir/ham-satir-temizle`, { kimlik: 'Accounting' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
    expect((await istek(`GET ${P}/tablolar`, { kimlik: 'Dealer' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
    // İç personel + ince kapı: dış rol İLK halkada (personel), `orders` yazamayan iç rol ikincide durur.
    expect((await istek(`POST ${P}/siparis/kaydet`, { kimlik: 'Dealer' })).govde).toEqual({ error: 'Bu işlem için personel yetkisi gerekir.' });
    expect((await istek(`POST ${P}/siparis/kaydet`, { kimlik: 'HR' })).govde).toEqual({ error: 'Bu veri için yetkiniz yok.' });
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

  it('D8 — süper yönetici (sahip hesabı, rolü boş): 53 kapılı ucun hepsi 200 — hiçbir kapı sahibini kilitlemez', async () => {
    expect(await kodlar(KAPILI, { kimlik: 'super-rolsuz' })).toEqual(hepsi(KAPILI, 200));
    expect((await istek(`POST ${P}/cari/kaydet`, { kimlik: 'super-rolsuz', govde: { collection: 'suppliers' } })).kod).toBe(200);
    expect((await istek(`POST ${P}/evrak/kaydet`, { kimlik: 'super-rolsuz', govde: { method: 'PersonelKaydetV2' } })).kod).toBe(200);
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
    // Asıl açık: serbest gövdeli dekont artık İK / Hukuk / Kurumsal / Kalite / Lojistik'e KAPALI.
    for (const rol of ['HR', 'Legal', 'Corporate', 'Quality', 'Logistics']) {
      expect((await istek(uc, { kimlik: rol, govde: { method: 'DekontKaydetV2', payload: {} } })).kod, rol).toBe(403);
    }
    for (const yontem of ['BilinmeyenV2', 'constructor', 'toString', '']) {
      const gelen = Object.fromEntries(await Promise.all(kimlikler.map(async k => [k, (await istek(uc, { kimlik: k, govde: { method: yontem } })).kod] as const)));
      expect(gelen, `'${yontem}'`).toEqual(Object.fromEntries(kimlikler.map(k => [k, DIS.includes(k) ? 403 : 200])));
    }
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
