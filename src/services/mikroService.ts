/**
 * mikroService.ts — Cetpa ↔ Mikro Jump API integration (client-side)
 *
 * All real Mikro API calls are made SERVER-SIDE (server.ts /api/mikro/*)
 * because Mikro requires a whitelisted IP and OAuth credentials that must
 * never be exposed to the browser.
 *
 * This service is a thin client that calls our own Express endpoints.
 * Every result is also written back to Firebase by the server — so
 * Firebase is always the source of truth regardless of which ERP is used.
 *
 * Swapping ERPs later = only server.ts routes change. This file stays.
 */

import { auth } from '../firebase';
import { mikroIsAdi } from '../lib/mikroIsAdi';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MikroSyncResult {
  success: boolean;
  notConfigured?: boolean;
  error?: string;
  duration?: number;
  /** Sunucunun eşleme notu: "3 satırın phone alanı bilinmiyor" ya da başında
   *  "UYARI: … hiçbir satırda okunamadı" (okuma arızası — kolon adı/şema kontrol
   *  edilmeli). Üreten modüller: server/mikro/eslemeStok.ts, eslemeCari.ts.
   *  Ekranda GÖSTERİLMELİ — bu notu yutmak, sessiz-sıfır sınıfının import
   *  karşılığını geri getirir ("2367 güncellendi" deyip alanların hiç gelmediğini
   *  gizlemek, fiyat kapsamı vakasının tekrarıdır). */
  note?: string;
}

export interface MikroStokSyncResult extends MikroSyncResult {
  mikroStoKod?: string;
}

export interface MikroCariSyncResult extends MikroSyncResult {
  cariKod?: string;
}

export interface MikroSiparisSyncResult extends MikroSyncResult {
  mikroEvrakNo?: string | null;
}

export interface MikroListResult<T> extends MikroSyncResult {
  count: number;
  data: T[];
  duration?: number;
}

export interface MikroStatus {
  configured: boolean;
  connected: boolean;
  message?: string;
  error?: string;
  /** 'local' = sunucuda kurulu Jump (localhost:8094), 'cloud' = JumpBulut gateway */
  mode?: 'local' | 'cloud';
  apiBase?: string;
}

export interface MikroStokItem {
  sto_kod: string;
  sto_isim: string;
  sto_birim1_ad?: string;
  sto_perakende_vergi?: number;
  [key: string]: unknown;
}

export interface MikroCariItem {
  cari_kod: string;
  cari_unvan1: string;
  cari_unvan2?: string;
  cari_vdaire_no?: string;
  cari_EMail?: string;
  cari_CepTel?: string;
  cari_efatura_fl?: number;
  [key: string]: unknown;
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      // Govdesiz POST yazilmaz — authFetch.ts ile AYNI sozlesme. DURUST NOT (hakem 2026-09-24):
      // tarayici govdesiz fetch'e KENDISI Content-Length: 0 ekler; 2026-08-18'deki IIS 411 olcumu
      // curl ileydi (Content-Length hic yok). Yani bu satir tarayicidan 502'yi ACIKLAMAZ; yine de
      // tek sozlesme + istemci disi cagiranlar (test/betik) icin tutuluyor.
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    return data as T;
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) } as T;
  }
}

async function apiGet<T>(path: string, fallback: Partial<T> = {}): Promise<T> {
  try {
    const res = await fetch(path);
    const data = await res.json().catch(() => fallback);
    return data as T;
  } catch (e) {
    return { ...fallback, error: e instanceof Error ? e.message : String(e) } as T;
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

/** Check if Mikro is configured and the token endpoint is reachable */
export async function getMikroStatus(): Promise<MikroStatus> {
  return apiGet<MikroStatus>('/api/mikro/status', { configured: false, connected: false });
}

// ── Stok (Inventory) ──────────────────────────────────────────────────────────

/**
 * Push one inventory item to Mikro (StokKaydetV2).
 * Server writes mikroStoKod + mikroSynced back to Firebase inventory/{firebaseId}.
 */
export async function syncInventoryItemToMikro(
  item: Record<string, unknown>,
  firebaseId: string
): Promise<MikroStokSyncResult> {
  return apiPost<MikroStokSyncResult>('/api/mikro/stok/kaydet', { item, firebaseId });
}

/**
 * Pull stock list from Mikro (StokListesiV2) and mirror to Firebase.
 * @param options Optional filters: stokKod prefix, date range, pagination
 */
export async function pullStokFromMikro(options?: {
  stokKod?: string;
  ilkTarih?: string;
  size?: number;
  index?: number;
}): Promise<MikroListResult<MikroStokItem>> {
  return apiPost<MikroListResult<MikroStokItem>>('/api/mikro/stok/listesi', options ?? {});
}

// ── Cari (Customer / Supplier) ────────────────────────────────────────────────

/**
 * Push a lead/customer to Mikro (CariKaydetV2).
 * Server writes mikroCariKod + mikroSynced back to Firebase leads/{firebaseId}.
 */
export async function syncLeadToMikro(
  lead: Record<string, unknown>,
  firebaseId: string
): Promise<MikroCariSyncResult> {
  return apiPost<MikroCariSyncResult>('/api/mikro/cari/kaydet', { lead, firebaseId });
}

/**
 * Pull cari list from Mikro (CariListesiV2) and mirror to Firebase.
 * Pass `nameSearch` for a safe (server-escaped) unvan/name search — do not
 * try to build a custom `whereStr` from user input, the server rejects that
 * in favor of nameSearch to avoid injecting into Mikro's own query.
 */
export async function pullCariFromMikro(options?: {
  whereStr?: string;
  nameSearch?: string;
  size?: number;
  index?: number;
}): Promise<MikroListResult<MikroCariItem>> {
  return apiPost<MikroListResult<MikroCariItem>>('/api/mikro/cari/listesi', options ?? {});
}

/**
 * Push a supplier to Mikro (CariKaydetV2). Mirrors syncLeadToMikro but writes
 * mikroCariKod back to Firebase suppliers/{firebaseId} instead of leads/.
 */
export async function syncSupplierToMikro(
  supplier: Record<string, unknown>,
  firebaseId: string
): Promise<MikroCariSyncResult> {
  return apiPost<MikroCariSyncResult>('/api/mikro/cari/kaydet', { lead: supplier, firebaseId, collection: 'suppliers' });
}

// ── Sipariş (Order) ───────────────────────────────────────────────────────────

/**
 * Push an order to Mikro (SiparisKaydetV2).
 * Requires order.mikroCariKod to be set (sync lead first if missing).
 * Server writes mikroEvrakNo + mikroSynced back to Firebase orders/{firebaseId}.
 */
export async function syncOrderToMikro(
  order: Record<string, unknown>,
  firebaseId: string
): Promise<MikroSiparisSyncResult> {
  return apiPost<MikroSiparisSyncResult>('/api/mikro/siparis/kaydet', { order, firebaseId });
}

// ── Convenience: sync lead then order (handles missing cariKod) ───────────────

/**
 * Ensure a lead has a Mikro cari code, then push the order.
 * Use this when creating an order for a customer who may not be in Mikro yet.
 */
export async function syncOrderWithCari(
  lead: Record<string, unknown>,
  leadFirebaseId: string,
  order: Record<string, unknown>,
  orderFirebaseId: string
): Promise<{ cariResult: MikroCariSyncResult; orderResult: MikroSiparisSyncResult }> {
  // Step 1: ensure cari exists in Mikro
  let cariResult: MikroCariSyncResult;
  if (lead.mikroCariKod) {
    cariResult = { success: true, cariKod: lead.mikroCariKod as string };
  } else {
    cariResult = await syncLeadToMikro(lead, leadFirebaseId);
  }

  // Step 2: push order (inject cariKod if we just got one)
  const orderWithCari = cariResult.cariKod
    ? { ...order, mikroCariKod: cariResult.cariKod }
    : order;

  const orderResult = await syncOrderToMikro(orderWithCari, orderFirebaseId);

  return { cariResult, orderResult };
}

// ── Bulk / Manual sync triggers ───────────────────────────────────────────────

/**
 * Trigger a full pull of all Mikro stok into Firebase.
 * Intended for admin "Mikro'dan İçeri Al" button.
 */
export async function fullStokSync(): Promise<MikroListResult<MikroStokItem>> {
  return apiPost<MikroListResult<MikroStokItem>>('/api/mikro/stok/listesi', {
    size: 500,
    index: 0,
    ilkTarih: '2020-01-01',
  });
}

/**
 * Trigger a full pull of all Mikro cari into Firebase.
 * Intended for admin "Müşterileri Çek" button.
 */
export async function fullCariSync(): Promise<MikroListResult<MikroCariItem>> {
  return apiPost<MikroListResult<MikroCariItem>>('/api/mikro/cari/listesi', {
    whereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2020/01/01'",
    size: 500,
    index: 0,
  });
}

// ── Full import (Mikro → Firebase) — ARKA PLAN İŞİ başlatma ───────────────────
// 2026-09-24 (mikro-import-arkaplan): eski iki sarmalayıcı (stok/cari import) işin bitmesini HTTP
// yanıtında bekliyordu (`{created, updated, errors, …}` sonuç tipi); IIS/ARR ~120 sn'de bağlantıyı
// kesip 502 döndüğü için Stok/Cari İçeri Al ve 12 SQL kartı hiç sonuç göstermiyordu (teşhis, CONFIRMED).
// Artık 14 import ucu (stok, cari, 12 SQL) + stok-miktar = 15 uç anında `{ success, started, job }` döner;
// ilerleme/sonuç `jobs/<job>` dokümanında (`src/hooks/useArkaPlanIsi.ts` okur; eski `fiyatliUrun`/`note`/
// `duration` alanları orada — `ArkaPlanIsi`).
// 12 SQL sarmalayıcısı YAZILMAZ: panel rotayı `mikroImportBaslat(def.route)` ile geçer.

/** 14 import ucu (stok, cari, 12 SQL) + stok-miktar = 15 arka plan ucunun başlatma yanıtı.
 *  `MikroSyncResult`'tan TÜRETİLMEZ: `note`/`duration` başlatma yanıtında yok, sahte alan taşımasın.
 *  Yorumlama önceliği TEK yerde:
 *  `baslatmaYanitiniYorumla` (useArkaPlanIsi.ts) — kart ve "Tümünü Çek" aynı tabloyu okur. */
export interface MikroIsBaslatmaYaniti {
  success: boolean;
  /** true → iş başladı; bu durumda `job === mikroIsAdi(route)` ZORUNLU (aksi sözleşme ihlali → hata). */
  started?: boolean;
  /** true → KİLİT DOLU (started:false). Kilit GLOBAL tek iş (K-C): `job` = ÇALIŞAN işin adı — bu rota da
   *  olabilir, BAŞKA bir iş de. İkincisi NORMAL durumdur, hata değil. */
  alreadyRunning?: boolean;
  /** ÖNEKSİZ iş adı ('mikroImport-stok', 'stokMiktarImport'); 'jobs/…' DEĞİL. */
  job?: string;
  error?: string;
  /** 503 — Mikro kimlik bilgileri yok. */
  notConfigured?: boolean;
}

/**
 * Bir Mikro import işini arka planda başlatır (stok, cari, stok-miktar, 12 SQL ucu — hepsi
 * `/api/mikro/import/<slug>`). Rota sözlükte yoksa (`mikroIsAdi` throw) REJECT: yanlış rotayla arka
 * plan kartı kurulmasın. Ağ hatası / 502 ham gövde `apiPost` içinde `{ success:false, error }` olur.
 */
export function mikroImportBaslat(route: string): Promise<MikroIsBaslatmaYaniti> {
  try { mikroIsAdi(route); }
  catch (e) { return Promise.reject(e instanceof Error ? e : new Error(String(e))); }
  return apiPost<MikroIsBaslatmaYaniti>(route, {});
}

// ── Legacy / compatibility exports ────────────────────────────────────────────
// These match the old stub signatures so existing callers compile.
// Bank movements endpoint is not yet in the Mikro Jump Postman collection —
// it will be wired up when Mikro provides the endpoint name.

/** @deprecated Pass no config — credentials live in server env vars. */
export async function pullBankMovementsFromMikro(
  _params: Record<string, unknown>,
  _config?: unknown
): Promise<{ success: boolean; data: unknown[]; notImplemented?: boolean }> {
  // Mikro Jump API endpoint for bank movements not yet available.
  // Returns empty array so AccountingModule renders gracefully.
  return { success: false, data: [], notImplemented: true };
}
