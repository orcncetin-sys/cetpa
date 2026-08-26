/**
 * mikroClient.ts - Mikro (Jump) API istemcisi: kimlik, token, istek, sema kesfi.
 *
 * server.ts'ten AYRILDI (2026-08-24) - D4 teknik borcunun 2. parcasi.
 * Ilk parca opsWatchdog.ts idi; ayni desen: bagimliliklar acik parametreyle
 * gecer, yan etkiler init'te toplanir.
 *
 * NEDEN BU BLOK: 500 satirlik bu bolge tek bir sorumluluk tasiyor (Mikro ile
 * konusmak) ve DIS bagimliligi yalnizca `adminDb` (2 kullanim: settings/mikro
 * dokumanini okumak). Blok icinde `fetch` ve `createHash` disinda hicbir sey
 * disariya uzanmiyor - olculdu, tahmin degil.
 *
 * TASINMAYAN: `saklamaSuresiUygula` (KVKK saklama) bu bolgenin TAM ORTASINDA
 * duruyordu ama ayri bir sorumluluk; server.ts'te birakildi ve blok iki
 * aralik halinde (1827-1933 + 1965-2357) alindi.
 */
import type { AdminDbLike } from './adminDbTypes.js';
import { createHash } from 'crypto';

export interface MikroDeps {
  /** `settings/mikro` dokumanini okumak icin. server.ts'te SONRADAN atanan bir
   *  `let` oldugundan deger degil GETTER geciyor (bkz. opsWatchdog.ts). */
  /** `any` DEGIL: yapisal tip, tip denetimini korur (bkz. adminDbTypes.ts). */
  getAdminDb: () => AdminDbLike | null;
}

let D: MikroDeps;

/** Bagimliliklara guvenli erisim - init edilmeden cagrilirsa NE YAPILMASI
 *  gerektigini soyleyen bir hata verir, anlamsiz bir TypeError degil. */
function deps(): MikroDeps {
  if (!D) throw new Error('mikroClient: initMikroClient() cagrilmadan kullanilamaz.');
  return D;
}

export function initMikroClient(d: MikroDeps): void { D = d; }

// Mikro surum bayragi ve V17'de KALDIRILMIS uclar. server.ts'ten TASINDI:
// ikisi de Mikro yapilandirmasi, dogal yerleri burasi. Disariya aciliyorlar
// cunku server.ts'te 11 yerde daha okunuyorlar.
/** Mikro Jump kurulum surumu - V16'da SqlVeriOkuV2 ve cha_ebelge_turu YOK.
 *  (V16/V17 Postman koleksiyonlari diff'i, 2026-06-12). Musteri V17'ye
 *  gectiginde .env.production'a MIKRO_JUMP_SURUM=17 eklemek yeterli.
 *  server.ts'ten sabitle BIRLIKTE tasindi (2026-08-24): yorum orada kalinca
 *  V17 gecis talimati, yonettigi koddan kopuk kaliyordu. */
export const MIKRO_JUMP_SURUM = Number(process.env.MIKRO_JUMP_SURUM || 16);
export const MIKRO_V17_YOK = new Set([
  'BankaListesiV2', 'BarkodListesiV2', 'CariHareketKaydetV2', 'FaturaListesiV2',
  'KasaListesiV2', 'KdvOzetV2', 'MizanV2', 'OdemePlanListesiV2',
  'SiparisListesiV2', 'StokHareketListesiV2',
]);

const MIKRO_AUTH_URL = 'https://onlinekullanici.mikro.com.tr/auth/realms/Mikro/protocol/openid-connect/token';
export const MIKRO_API_BASE = process.env.MIKRO_API_URL || 'http://localhost:8094/Api/APIMethods';
export const MIKRO_LOCAL_MODE = process.env.MIKRO_LOCAL != null
  ? process.env.MIKRO_LOCAL === '1'
  : /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(MIKRO_API_BASE);
console.log(`Mikro API: ${MIKRO_API_BASE} (${MIKRO_LOCAL_MODE ? 'LOKAL mod — token yok' : 'BULUT mod — OIDC token'})`);
if (!MIKRO_LOCAL_MODE && !/:\d+/.test(MIKRO_API_BASE)) {
  console.warn('⚠️  MIKRO_API_URL portsuz ve bulut host — Cloudflare önyüzü 403 döndürebilir.');
}

export interface MikroCreds {
  idmEmail: string;
  idmPassword: string;
  alias: string;
  firmaKodu: string;
  calismaYili: string;
  apiKey: string;
  kullaniciKodu: string;
  sifre: string;
  firmaNo: number;
  subeNo: number;
}

/**
/** If value is already a 32-char hex MD5, return as-is; otherwise hash it. */
function toMd5IfPlain(value: string): string {
  if (!value) return '';
  if (/^[0-9a-f]{32}$/i.test(value)) return value.toLowerCase();
  return createHash('md5').update(value).digest('hex');
}

/**
 * Get Mikro credentials — env vars take priority, Firestore settings/mikro as fallback.
 * This allows the admin to configure Mikro from the Settings UI without needing env vars.
 */
export async function getMikroCreds(): Promise<MikroCreds | null> {
  // 1. Try env vars first (server deployment)
  //    LOKAL modda IDM e-posta/şifre, ApiKey ve Alias GEREKMEZ (API bunları
  //    kullanmıyor) — yalnız KullaniciKodu + Sifre yeterli. Bulut modunda
  //    eski (tam) koşul aynen geçerli.
  //    LOKAL modda ZORUNLU ALAN YOK: KullaniciKodu 'SRV', FirmaKodu '01',
  //    CalismaYili içinde bulunulan yıl varsayılır ve **Mikro API kullanıcısının
  //    şifresi BOŞ olabilir** (SRV'de şifre tanımsız — sadece giriş). Boş şifre
  //    geçerli bir günlük hash üretir: MD5("YYYY-AA-GG " + ""). Bu yüzden lokal
  //    modda MIKRO_API_URL'in lokali göstermesi "yapılandırılmış" saymak için yeterli.
  const envReady = MIKRO_LOCAL_MODE
    ? true
    : !!(process.env.MIKRO_IDM_EMAIL && process.env.MIKRO_IDM_PASSWORD &&
         process.env.MIKRO_API_KEY && process.env.MIKRO_ALIAS);
  if (envReady) {
    return {
      idmEmail:      process.env.MIKRO_IDM_EMAIL      || '',
      idmPassword:   process.env.MIKRO_IDM_PASSWORD   || '',
      alias:         process.env.MIKRO_ALIAS          || '',
      firmaKodu:     process.env.MIKRO_FIRMA_KODU     || '01',
      calismaYili:   process.env.MIKRO_CALISMA_YILI   || String(new Date().getFullYear()),
      apiKey:        process.env.MIKRO_API_KEY       || '',
      kullaniciKodu: process.env.MIKRO_KULLANICI_KODU || 'SRV',
      sifre:         process.env.MIKRO_SIFRE          || '',
      firmaNo:       parseInt(process.env.MIKRO_FIRMA_NO || '0', 10),
      subeNo:        parseInt(process.env.MIKRO_SUBE_NO  || '0', 10),
    };
  }

  // 2. Fallback: read from Firestore settings/mikro (entered from Settings UI)
  const adminDb = deps().getAdminDb();
  if (!adminDb) return null;
  try {
    const snap = await adminDb.collection('settings').doc('mikro').get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, unknown>;
    // Support both new field names and legacy "accessToken" → idmPassword mapping
    const idmEmail    = (d.idmEmail    || d.email)         as string | undefined;
    const idmPassword = (d.idmPassword || d.accessToken || d.access_token) as string | undefined;
    const alias       = d.alias        as string | undefined;
    const apiKey      = d.apiKey       as string | undefined;

    // Minimum zorunlu alanlar moda göre: lokalde Sifre yeterli (Alias/IDM
    // kullanılmıyor), bulutta idmPassword + alias şart.
    if (MIKRO_LOCAL_MODE ? !d.sifre : (!idmPassword || !alias)) return null;

    return {
      idmEmail:      idmEmail      || '',
      // Lokal modda IDM/Alias kullanılmaz (yukarıdaki guard yalnız Sifre arar),
      // bu yüzden bu ikisi lokalde tanımsız kalabilir; bulut modunda guard dolu
      // olduklarını garanti eder. Metin alanı — sayısal "sessiz sıfır" riski yok.
      idmPassword:   idmPassword   || '',
      alias:         alias         || '',
      firmaKodu:     (d.firmaKodu     as string) || '01',
      calismaYili:   (d.calismaYili   as string) || String(new Date().getFullYear()),
      apiKey:        apiKey  || '',
      kullaniciKodu: (d.kullaniciKodu as string) || 'SRV',
      sifre:         (d.sifre as string) || '',
      firmaNo:       Number(d.firmaNo  ?? 0),
      subeNo:        Number(d.subeNo   ?? 0),
    };
  } catch (e) {
    console.warn('getMikroCreds: Firestore read failed:', e);
    return null;
  }
}

// ═══ Operasyon Bekçisi: günlük cron — gece yedeği ve cron çıktılarını denetler ═══
// Amaç: sessiz arızayı (yedek görevinin hiç koşmaması, Mikro sync'in stockLevel
// yazmadan dönmesi gibi) restore/rapor gününde değil ertesi sabah yakalamak.
// Sonuç opsChecks/<YYYY-MM-DD> dokümanına yazılır (global, tenant-dışı) ve
// süper-admin panelindeki karttan + GET /api/ops/watchdog'dan okunur.
// SAKLAMA_KURALLARI opsWatchdog.ts'e tasindi: bekci de ayni listeyi okuyor
// (saklama suresi asilmis kayit var mi kontrolu). Tek kaynak olsun diye
// orada duruyor ve buraya import ediliyor.


// Disa acik: server.ts'teki 'Mikro baglantisini test et' ucu, ayarlar
// degisince bayat token'i temizlemek icin bu onbellegi bosaltiyor.
export const mikroTokenCacheMap = new Map<string, { access_token: string; expiresAt: number }>();
// Single-flight: Mikro IDM tek oturumludur — yeni token verilince eskisi sessizce
// geçersizleşir. Eşzamanlı istekler ayrı token çekerse birbirini devirir; bu yüzden
// aynı anda yalnızca BİR token isteği yapılır, diğerleri aynı promise'i bekler.
const mikroTokenInflight = new Map<string, Promise<string>>();

export async function getMikroToken(creds: MikroCreds): Promise<string> {
  const cacheKey = `${creds.idmEmail}|${creds.alias}`;
  const now      = Date.now();
  const cached   = mikroTokenCacheMap.get(cacheKey);

  if (cached && now < cached.expiresAt - 5 * 60 * 1000) {
    return cached.access_token;
  }

  const inflight = mikroTokenInflight.get(cacheKey);
  if (inflight) return inflight;

  const fetchPromise = (async () => {
    const res = await fetch(MIKRO_AUTH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:  'mikro-rjf',
        username:   creds.idmEmail,
        password:   creds.idmPassword,
        grant_type: 'password',
      }).toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Mikro token alınamadı (${res.status}): ${errText.substring(0, 300)}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    mikroTokenCacheMap.set(cacheKey, {
      access_token: data.access_token,
      expiresAt:    Date.now() + (data.expires_in || 21600) * 1000,
    });
    // Token acquired — do not log alias or token details in production
    return data.access_token;
  })();

  mikroTokenInflight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    mikroTokenInflight.delete(cacheKey);
  }
}

/** Mikro Jump API requires a daily-rotating hash: MD5("YYYY-MM-DD " + plainPassword).
 *  Tarih TÜRKİYE saatine göre hesaplanır — UTC kullanılırsa her gece 00:00–03:00 TR
 *  arasında bir önceki günün hash'i üretilir ve tüm çağrılar reddedilir.
 */
function buildMikroDailySifre(plainPassword: string): string {
  // LOKAL modda MikroAPI AYNI makinede çalışır ve hash'i MAKİNENİN yerel
  // tarihine göre doğrular — Istanbul'a sabitlemek, sunucu saat dilimi farklıysa
  // gece yarısı bandında "Şifre Hatalı" üretir (2026-07-28'de canlıda yaşandı:
  // PowerShell'in yerel-tarih hash'i geçti, bizim Istanbul hash'imiz reddedildi).
  // BULUT modunda eski davranış (TR saati) korunur.
  const today = new Intl.DateTimeFormat('en-CA', {
    ...(MIKRO_LOCAL_MODE ? {} : { timeZone: 'Europe/Istanbul' }),
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // "YYYY-MM-DD"
  return createHash('md5').update(`${today} ${plainPassword}`).digest('hex');
}

/** "Şu ana kadarki" stok/maliyet sorgularının bitiş tarihi = BUGÜN.
 *  GenelAmacliMaliyetListesiV2 GELECEK tarihli SonTarih aldığında hata vermeden
 *  EldekiMiktar=0, MaliyetBedeli=0 döner (2026-07-30'da canlıda kanıtlandı:
 *  SonTarih=2027-12-31 -> 0 ; SonTarih=bugün -> 1044 birim, aynı SKU).
 *  Tarih, günlük şifre hash'iyle aynı takvimden okunur (lokalde makine saati).
 */
/** StokListesiV2 satırından mevcut miktar — alan YOKSA `null` (0 DEĞİL).
 *
 *  Neden kritik: bu fonksiyondan önce kod `Number(s.sto_mevcut_mik ?? s.toplam_miktar ?? 0)`
 *  yazıyordu. Mikro'nun liste uçları ham tablo kolonlarını döndürüyor
 *  (CariListesiV2'nin `cari_*` dökümünde görüldüğü gibi) ve STOKLAR tablosunda
 *  anlık miktar kolonu yok — miktar hareketlerden türetilir. Yani alan hiç
 *  gelmiyorsa `?? 0` her senkronda TÜM ürünlerin stoğunu sıfırlar ve üstüne
 *  her ürün için sahte bir sayım farkı üretir. `null` dönüp çağıranın
 *  stockLevel'a hiç dokunmamasını sağlıyoruz.
 *
 *  Miktarın güvenilir kaynağı GenelAmacliMaliyetListesiV2'dir
 *  (/api/mikro/import/stok-miktar) — liste uçları yalnız kart verisi taşır.
 */
export function mikroStokMiktari(s: Record<string, unknown>): number | null {
  const raw = s.sto_mevcut_mik ?? s.toplam_miktar;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** StokListesiV2 satırından satış fiyatları → `inventory.prices` kademeleri.
 *
 *  İki olası kaynak (kurulumdan kurulmuşa değişiyor):
 *    1. `satis_fiyatlari[]` — STOK_SATIS_FIYAT_LISTELERI satırları
 *       (sfiyat_listesirano 1=Retail 2=B2B Standard 3=B2B Premium 4=Dealer)
 *    2. Kart üzerindeki düz alanlar `sto_satis_fiyat1..4`
 *
 *  0 ve boş "fiyat YOK" sayılır ve DÖNMEZ: Mikro tanımsız kademeyi 0 döndürüyor,
 *  0 yazmak ekranda yine "0 TL" gösterir ve elle girilmiş fiyatı ezerdi. Çağıran
 *  boş nesne görürse `prices`e HİÇ DOKUNMAMALIDIR (bkz. stockLevel/vatRate deseni).
 *
 *  2026-08-11: cron import'u fiyatı hiç yazmıyordu (yalnız manuel import yazıyordu);
 *  iki yol ayrışmasın diye mantık burada TEK yerde toplandı.
 */
export function mikroSatisFiyatlari(s: Record<string, unknown>): Record<string, number> {
  const TIERS = ['Retail', 'B2B Standard', 'B2B Premium', 'Dealer'] as const;
  const prices: Record<string, number> = {};
  const ekle = (tier: string, ham: unknown) => {
    if (prices[tier]) return;              // ilk geçerli kaynak kazanır
    const n = Number(ham);
    if (ham != null && ham !== '' && Number.isFinite(n) && n > 0) prices[tier] = n;
  };
  const liste = (s.satis_fiyatlari as Record<string, unknown>[]) || [];
  TIERS.forEach((tier, i) => ekle(tier, liste[i]?.sfiyat_fiyati));
  TIERS.forEach((tier, i) => ekle(tier, s[`sto_satis_fiyat${i + 1}`]));
  return prices;
}

export function mikroBugun(): string {
  return new Intl.DateTimeFormat('en-CA', {
    ...(MIKRO_LOCAL_MODE ? {} : { timeZone: 'Europe/Istanbul' }),
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function buildMikroContext(creds: MikroCreds): Record<string, unknown> {
  // Lokal Jump API'sinde bağlam yalnız FirmaKodu/CalismaYili/KullaniciKodu/Sifre
  // (+FirmaNo/SubeNo) içerir; Alias & ApiKey yalnız bulut/APILogin tarafında var.
  // Boş değer GÖNDERME — bazı sürümler boş alanı geçersiz sayabiliyor.
  return {
    ...(creds.alias  ? { Alias:  creds.alias }  : {}),
    FirmaKodu:     creds.firmaKodu,
    CalismaYili:   creds.calismaYili,
    ...(creds.apiKey ? { ApiKey: creds.apiKey } : {}),
    KullaniciKodu: creds.kullaniciKodu,
    Sifre:         buildMikroDailySifre(creds.sifre),
    FirmaNo:       creds.firmaNo,
    SubeNo:        creds.subeNo,
  };
}

/** Extract the Data payload from a Mikro API response.
 *  Response shape: { result: [{ StatusCode, Data: {...}, IsError, ErrorMessage }] }
 */
export function mikroData(raw: unknown): Record<string, unknown> {
  const r = ((raw as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  return (r?.Data ?? r?.data ?? {}) as Record<string, unknown>;
}

/** Mikro yanıt zarfından SATIR DİZİSİNİ çıkarır — zarf iki farklı şekilde gelir.
 *
 *  Gözlenen şekiller (2026-07-30, canlı):
 *    Data = { SQLResult1: [ {...}, ... ] }        // nesne sarmalı
 *    Data = [ { SQLResult1: [ {...}, ... ] } ]    // DİZİ sarmalı  ← SqlVeriOkuV2
 *    Data = { StokListesi: [...] }                // liste metotları
 *
 *  Eski kod yalnız `Object.values(Data).find(Array.isArray)` yapıyordu; dizi
 *  sarmalında dizinin İÇİNDEKİ nesneye inmediği için her zaman boş dönüyordu.
 *  Sonuç: SqlVeriOkuV2'ye dayanan HER ŞEY sessizce 0 kayıt veriyordu (mizan,
 *  KDV, yedi liste import'u, cari bakiye).
 *
 *  Neden fark etmedik: PowerShell tek elemanlı dizileri otomatik açtığı için
 *  doğrulama probe'larında zarf doğru görünüyordu. DERS: dış API zarfını
 *  kabuktan değil, uygulamanın kendi ayrıştırıcısından doğrula.
 */
export function mikroSatirlar(raw: unknown): Record<string, unknown>[] {
  const d = mikroData(raw) as unknown;
  const adaylar: unknown[] = Array.isArray(d) ? d : [d];
  for (const a of adaylar) {
    if (Array.isArray(a)) return a as Record<string, unknown>[];
    if (a && typeof a === 'object') {
      const dizi = Object.values(a as Record<string, unknown>).find(Array.isArray);
      if (dizi) return dizi as Record<string, unknown>[];
    }
  }
  return [];
}

/** Mikro yanıt zarfındaki hata metni. `Mikro API 501` gibi anlamsız durum
 *  kodları yerine gerçek sebebi (ör. "metot V17'de bulunmuyor") gösterir. */
export function mikroHata(raw: unknown, fallback = 'Mikro API yanıt vermedi.'): string {
  const r = ((raw as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  return (r?.ErrorMessage as string) || (typeof raw === 'string' ? raw.slice(0, 200) : '') || fallback;
}

// ── SqlVeriOkuV2: Mikro'nun SELECT-only SQL kapısı ───────────────────────────
// V17'nin liste yüzeyi çok dar (yalnız Stok/Cari listesi). Fatura, sipariş, stok
// hareketi, banka, kasa, mizan gibi her şey bu kapıdan SELECT ile çekilir.
// Yanıt zarfı: Data.SQLResult1 dizisi (canlıda doğrulandı 2026-07-30).

/** SQL literal'e gömülecek değerleri KATI doğrula. Bu kapı ham SQL çalıştırır;
 *  kullanıcı girdisini string olarak birleştirmek doğrudan SQLi'dir. */
export function sqlTarih(v: unknown, varsayilan: string): string {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : varsayilan;
}
export function sqlTamsayi(v: unknown, varsayilan: number, min = 0, max = 100000): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : varsayilan;
}
/** Tablo/kolon adı — yalnız harf, rakam, alt çizgi. Beyaz listeyle birlikte kullan. */
export function sqlTanimlayici(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : null;
}

/** SqlVeriOkuV2 çalıştır, satırları döndür. Hata varsa `hata` dolu gelir. */
export async function mikroSql(sorgu: string): Promise<{ rows: Record<string, unknown>[]; hata: string | null }> {
  const { ok, data } = await mikroPost('SqlVeriOkuV2', { SQLSorgu: sorgu });
  const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
  if (!ok || !r0 || r0.IsError) return { rows: [], hata: mikroHata(data, 'SqlVeriOkuV2 yanıt vermedi.') };
  return { rows: mikroSatirlar(data), hata: null };
}

/** Bir tablonun kolon adları — INFORMATION_SCHEMA'dan, 10 dk önbellekli.
 *  Kolon adlarını TAHMİN ETMEK yerine çalışma anında öğreniyoruz; Mikro'nun
 *  tablo şeması sürümden sürüme değişebiliyor ve yanlış kolon adı sessiz
 *  boş sonuç üretir (bkz. sessiz-sıfır arıza sınıfı). */
const mikroKolonCache = new Map<string, { cols: string[]; exp: number }>();
export async function mikroKolonlar(tablo: string): Promise<string[]> {
  const t = sqlTanimlayici(tablo);
  if (!t) return [];
  const c = mikroKolonCache.get(t);
  if (c && c.exp > Date.now()) return c.cols;
  // ORDER BY ORDINAL_POSITION şart: kolonBul ilk EŞLEŞENİ döndürür, dolayısıyla
  // sıra anlamlıdır. SQL Server genelde ordinal sırayla döner ama garanti etmez.
  const { rows } = await mikroSql(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION`,
  );
  const cols = rows.map(r => String(r.COLUMN_NAME ?? '')).filter(Boolean);
  if (cols.length) mikroKolonCache.set(t, { cols, exp: Date.now() + 10 * 60_000 });
  return cols;
}

/** ── Mikro vergi oranları: sto_perakende_vergi bir YÜZDE DEĞİL, İNDEKStir ──
 *
 *  2026-07-31'de bulundu: kod `vatRate: Number(s.sto_perakende_vergi) || 20`
 *  yazıyordu. Ama o alan VergiListesiV2'deki `vergiSiraNo`ya işaret eder:
 *    sıra 1 "YOK" %0 · sıra 2 "KDV %1" · sıra 3 "KDV %10" · sıra 4 "KDV %20"
 *  Müşterinin 2.351 ürünü sıra 4 (=%20), 12 ürünü sıra 3 (=%10) kullanıyor;
 *  envantere `vatRate: 4` ve `3` yazılmıştı. Teklif ekranı bunu yüzde sanıp
 *  `fiyat × (1 + vatRate/100)` hesapladığı için %20 yerine %4 KDV uyguluyordu.
 *
 *  Tablo saatlik önbelleklenir. Boş isimli/çöp satırlar (Mikro'nun
 *  ilklendirilmemiş dizi hücreleri: vergiOrani 4.6e-322 gibi) ELENİR.
 */
const vergiOranCache = { map: null as Map<number, number> | null, exp: 0 };

export async function mikroVergiOranlari(): Promise<Map<number, number>> {
  if (vergiOranCache.map && vergiOranCache.exp > Date.now()) return vergiOranCache.map;
  const map = new Map<number, number>();
  try {
    const { ok, data } = await mikroPost('VergiListesiV2', {});
    const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
    if (ok && r0 && !r0.IsError) {
      for (const v of mikroSatirlar(data)) {
        const sira = Number(v.vergiSiraNo);
        const oran = Number(v.vergiOrani);
        const ad   = String(v.vergiAdi ?? '').trim();
        // Adı boş olan satırlar Mikro'nun ayrılmış ama kullanılmayan hücreleri.
        // Oran 0..100 dışındaysa (çöp float) güvenme.
        if (!Number.isFinite(sira) || !ad) continue;
        if (!Number.isFinite(oran) || oran < 0 || oran > 100) continue;
        map.set(sira, oran);
      }
    }
  } catch { /* ağ hatası — boş map döner, çağıran vatRate'e dokunmaz */ }
  if (map.size) { vergiOranCache.map = map; vergiOranCache.exp = Date.now() + 3600_000; }
  return map;
}

/** Stok kartındaki vergi işaretçisini GERÇEK yüzdeye çevir.
 *  Çözülemezse `null` — çağıran vatRate'e DOKUNMAMALI (uydurma %20 yazmaktansa
 *  eski değeri koru; bkz. sessiz-sıfır arıza sınıfı). */
export function vergiOraniCoz(isaretci: unknown, tablo: Map<number, number>): number | null {
  const p = Number(isaretci);
  if (!Number.isFinite(p)) return null;
  const oran = tablo.get(p);
  return oran === undefined ? null : oran;
}

/** Kolon listesinde regex'e uyan İLK kolonu bul (şema keşfi için). */
export function kolonBul(cols: string[], re: RegExp): string | null {
  return cols.find(c => re.test(c)) ?? null;
}

/** Mikro API yanıtı JSON değil de HTML (Cloudflare/WAF/gateway hata sayfası) ise
 *  bunu tanı ve kullanıcıya anlaşılır, EYLEME DÖNÜK bir mesaj üret. v17 göçünden
 *  sonra sunucu IP'si Mikro gateway'inin Cloudflare'inde engellenirse StokListesiV2
 *  gibi çağrılar 403 + HTML döner ve API anahtarı HİÇ denetlenmez. */
export function detectMikroGatewayBlock(data: unknown, status?: number): string | null {
  if (typeof data !== 'string') return null;
  const s = data.slice(0, 2000);
  if (!/<html|<!doctype/i.test(s)) return null; // HTML değilse gateway-block değil
  const isCloudflare = /cloudflare|attention required|cf-ray|__cf/i.test(s);
  const ip = process.env.MIKRO_WHITELIST_IP || process.env.SERVER_PUBLIC_IP || 'sunucu IP\'niz';
  if (isCloudflare) {
    const portsuz = !/:\d+/.test(MIKRO_API_BASE);
    return `Mikro gateway (Cloudflare) sunucu isteğini ${status ?? 403} ile ENGELLEDİ — API anahtarı denetlenmedi. ` +
      (portsuz
        ? `KÖK NEDEN: MIKRO_API_URL PORTSUZ (443) → Cloudflare önyüzüne düşüyor. Gerçek Jump API portludur (V17=8094, V16=8084). ` +
          `MIKRO_API_URL'i "https://jumpbulutapigw.mikro.com.tr:8094/ApiJB/ApiMethods" yapıp uygulamayı yeniden başlatın.`
        : `Muhtemel neden: sunucu IP'si (${ip}) Mikro tarafında ${MIKRO_API_BASE.match(/:\d+/)?.[0]} portu için whitelist'te değil — Mikro destekten ekletin.`);
  }
  return `Mikro gateway JSON yerine HTML hata sayfası döndü (HTTP ${status ?? '?'}) — API'ye ulaşılamıyor. ` +
    `Endpoint/gateway adresi v17'de değişmiş veya sunucu IP'si engellenmiş olabilir. Mikro destekle doğrulayın.`;
}

/** Call a Mikro Jump API endpoint — resolves creds, injects token + context. */
export async function mikroPost(
  endpoint: string,
  extraBody: Record<string, unknown>,
  inMikro = false // true → ekstra alanlar Mikro objesi İÇİNE konur (V17 evrak kalıbı)
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // V17'de OLMAYAN metotları ağa hiç çıkarmadan, anlaşılır hatayla kes.
  // Çağıran kodun "yanıt geldi ama alan yok" durumuna düşüp `?? 0` ile sıfır
  // yazmasını engeller — cari bakiyeleri ve KDV özetini tam olarak bu kırıyordu.
  if (MIKRO_JUMP_SURUM >= 17 && MIKRO_V17_YOK.has(endpoint)) {
    const msg = `${endpoint} Mikro Jump V17'de bulunmuyor. Bu veri için farklı bir yol gerekir (çoğu liste için SqlVeriOkuV2).`;
    console.warn('[mikroPost] atlandı:', msg);
    return { ok: false, status: 501, data: { result: [{ IsError: true, ErrorMessage: msg }] } };
  }

  const creds = await getMikroCreds();
  if (!creds) throw new Error('Mikro kimlik bilgileri bulunamadı. Ayarlar > Mikro ERP bölümünden girin.');

  const url = `${MIKRO_API_BASE}/${endpoint}`;

  const doCall = async (): Promise<{ ok: boolean; status: number; data: unknown }> => {
    // LOKAL modda OIDC token YOK — kimlik yalnız gövdedeki Mikro bağlamıyla taşınır.
    // (Token adımı burada zorunlu tutulursa, IDM erişilemezse API'ye hiç gidilemez.)
    const token = MIKRO_LOCAL_MODE ? null : await getMikroToken(creds);
    const body = inMikro
      ? { Mikro: { ...buildMikroContext(creds), ...extraBody } }
      : { Mikro: buildMikroContext(creds), ...extraBody };
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        // Cloudflare bot-yönetimi bazı istekleri UA yokluğu/şüpheli UA ile
        // engelliyor. Sıradan bir tarayıcı UA'sı gönder (bulut gateway CF arkasında).
        'User-Agent':     'Cetpa-ERP/1.0 (+https://app.cetpa.com.tr)',
        'Accept':         'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) {
      console.warn(`Mikro ${endpoint} HTTP ${res.status}:`, text.substring(0, 300));
    }
    return { ok: res.ok, status: res.status, data };
  };

  let result = await doCall();

  // Mikro IDM tek oturumlu: başka bir yerden token alınınca cache'lenmiş token
  // sessizce geçersizleşir ve API 'result' anahtarı olmayan stub döner
  // ({"Method": "..."}). Bu durumda cache'i boşalt, taze token ile bir kez dene.
  // ANCAK: taze token da stub alırsa sorun Mikro tarafındadır (kilit/bakım) —
  // 5 dk boyunca tekrar token üretme ki kendi kendimize kilidi uzatmayalım.
  const isStub = (d: unknown) =>
    !!d && typeof d === 'object' && !('result' in (d as Record<string, unknown>));
  // Lokal modda token yok → yenilemenin anlamı yok (stub başka sebepten gelir).
  if (result.ok && isStub(result.data) && !MIKRO_LOCAL_MODE) {
    const cacheKey = `${creds.idmEmail}|${creds.alias}`;
    const lastRefresh = mikroStubRefreshAt.get(cacheKey) ?? 0;
    if (Date.now() - lastRefresh > 5 * 60 * 1000) {
      console.warn(`Mikro ${endpoint}: stub yanıt — token yenilenip tekrar deneniyor`);
      mikroStubRefreshAt.set(cacheKey, Date.now());
      mikroTokenCacheMap.delete(cacheKey);
      result = await doCall();
    } else {
      console.warn(`Mikro ${endpoint}: stub yanıt — backoff aktif (5 dk), token YENİLENMEDİ`);
    }
  }

  return result;
}
// Stub sonrası token tazeleme zaman damgası — refresh fırtınasını önler
const mikroStubRefreshAt = new Map<string, number>();

/** Write a sync event to the syncLog Firestore collection.
 *  When `actor` is provided, ALSO writes an auditLog entry so the operation
 *  shows up in the Admin > Denetim Kaydı screen (filtered by companyId).
 */
