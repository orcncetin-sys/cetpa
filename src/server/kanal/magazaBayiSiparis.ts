/**
 * magazaBayiSiparis.ts — müşteri / bayi ekranının («Siparişlerim», www.cetpa.com.tr/bayi.html) sipariş LİSTESİ: iki aşamalı
 * okumanın SQL sabitleri, sıralama ve TEK yanıt süzgeci (2026-10-21, şartname `.wf/SARTNAME-musteri-siparislerim.md` K1, K6,
 * H5, H12, H13).
 *
 * HANGİ SİPARİŞLER (K1, H5): bağlı carinin bütün Cetpa siparişleri (`leadId` bağdaki `leadId` ile) ve Mikro faturası siparişleri
 * (`mikroCariKod` bağdaki SABİTLENMİŞ `cariKod` ile — düz eşitlik; `upper` / `lower` / `btrim` YOK: `upper` tr-TR değildir ve dizini
 * kullanamaz). Mağaza (`shopify_webhook`) ve pazar yeri (`Trendyol`, `Hepsiburada`) siparişleri ve `companyId`'siz satırlar HARİÇ.
 * Cari kodu `null` olan bağda MF kolu sorguya hiç girmez (`$3::text IS NOT NULL`): boş metin `$3`'e ASLA geçmez — geçseydi
 * kiracının bütün carisiz MF siparişleri görünürdü (`bayiSiparisParametreleri` ikinci kat).
 *
 * İKİ AŞAMA (H12): (1) aday kimlikler + üç tarih alanı (LIMIT / ORDER BY YOK; SQL'de tarih ifadesi ve `::timestamptz` YOK — tek
 * bozuk metin bütün sorguyu düşürürdü); sıralama JS'te TEK tarih yardımcısıyla (`siparisTarihMs`): yeni önce, eşitlikte doküman
 * kimliği azalan, tarihsiz en sonda; ilk 200. (2) seçilen kimliklerin gövdesi AYNI yüklemle (`id = ANY($5)` + yüklem): iki sorgu
 * arasında carisi / kaynağı değişen satır sızmaz, silinen satır düşer. İmleç YOK (site tek istek atar, imleç okumaz).
 *
 * YANIT (H13): yalnız izin listesindeki alanlar — `{ id, no, tarih, durum, kalemler: [{ sku, ad, adet }] }`. Fiyat / tutar / KDV,
 * not, sürücü, atanan kişi, fatura gönderim izi, LUCA alanları, ham gövde, iç kimlik HİÇ yazılmaz. `id` doküman kimliği DEĞİLDİR:
 * kiracı + oturum anahtarıyla HMAC'li opak kimlik (MF kimliği kiracıyı ve fatura sırasını sızdırırdı). `no` yalnız müşteriye
 * gösterilen numaradır (`gorunenTakipNo`); doküman kimliğinden numara TÜRETİLMEZ (`gorunenSiparisNo` bu yüzden içe aktarılmaz).
 *
 * SAF: Express / veritabanı / pgShim içe aktarılmaz. Zaman damgası zarfı (`{ _seconds, _nanoseconds }`) ham hâliyle de tek
 * yardımcıdan çözülür (`utils/zaman` `zamanMs`), gövde ayrıca canlandırılmaz.
 */
import { createHmac } from 'node:crypto';
import { gorunenTakipNo } from '../../lib/takipKodu.js';
import { siparisTarih, siparisTarihMs } from '../../utils/siparis.js';
import type { Order } from '../../types.js';

/** Yanıttaki en çok sipariş (mağaza sözleşmesi «en çok 200»; kullanıcı sorusu 3 — varsayılan). */
export const BAYI_SIPARIS_SINIRI = 200;
/** Aday satır sayısı bunu aşarsa YALNIZ uyarı (kesilmez: sırasız kesme keyfi satır atardı). */
export const BAYI_SIPARIS_ADAY_UYARI_SINIRI = 5000;

/**
 * Liste yüklemi — iki SQL sabiti AYNI metni kullanır; dizinler (docsSema `docs_orders_sirket_lead` / `_cari`) bu metnin `data ?`
 * kollarıyla birebir. $1 kiracı, $2 bağdaki `leadId`, $3 bağdaki cari kodu ya da `null`, $4 mağaza kaynağı (`MAGAZA_KAYNAGI`).
 */
export const BAYI_SIPARIS_YUKLEMI = "data->>'companyId' = $1 AND ((data ? 'leadId' AND data->>'leadId' = $2) OR ($3::text IS NOT NULL AND data ? 'mikroCariKod' AND data->>'mikroCariKod' = $3)) AND coalesce(data->>'source', '') NOT IN ($4, 'Trendyol', 'Hepsiburada')";

/** Aşama 1 — aday kimlikler + üç tarih alanı (ham JSON). */
export const BAYI_SIPARIS_ADAY_SQL = `SELECT id, data->'syncedAt' AS s, data->'createdAt' AS c, data->'orderDate' AS d FROM docs WHERE coll = 'orders' AND ${BAYI_SIPARIS_YUKLEMI}`;

/** Aşama 2 — seçilen kimliklerin gövdesi; $5 kimlik dizisi. Yüklem AYNEN tekrar edilir. */
export const BAYI_SIPARIS_GOVDE_SQL = `SELECT id, data FROM docs WHERE coll = 'orders' AND id = ANY($5::text[]) AND ${BAYI_SIPARIS_YUKLEMI}`;

/**
 * Yönetici ekranının uyarısı için MF sipariş sayısı (H9 `mfSayisi`): yüklemin YALNIZ cari kolu. $1 kiracı, $2 cari kodu (dolu
 * metin — `null` ise çağıran sorgu atmaz, 0 der), $3 mağaza kaynağı.
 */
export const BAYI_MF_SAYISI_SQL = "SELECT count(*)::int AS n FROM docs WHERE coll = 'orders' AND data->>'companyId' = $1 AND data ? 'mikroCariKod' AND data->>'mikroCariKod' = $2 AND coalesce(data->>'source', '') NOT IN ($3, 'Trendyol', 'Hepsiburada')";

/** Sorgu için bağdan gelen alanlar. */
export interface BayiSiparisBagi { leadId: string; cariKod: string | null }

/**
 * Yüklemin dört parametresi. `$3`: yalnız dolu (boşluk dışı karakter taşıyan) metin geçer, AYNEN (büyütülmez, yeniden kırpılmaz);
 * aksi `null` — eski ya da elle bozulmuş bağ kaydına (`cariKod: ''` / `'  '`) karşı ikinci kat.
 */
export function bayiSiparisParametreleri(kiraci: string, bag: BayiSiparisBagi, magazaKaynagi: string): [string, string, string | null, string] {
  const cari = typeof bag.cariKod === 'string' && bag.cariKod.trim() !== '' ? bag.cariKod : null;
  return [kiraci, bag.leadId, cari, magazaKaynagi];
}

/**
 * Aşama 1 satırlarından yanıta girecek kimlikler, SIRALI (SAF): `siparisTarihMs` azalan; eşitlikte doküman kimliği azalan (yanıta
 * çıkmaz); tarihsiz (`-Infinity`) en sonda; en çok `sinir` kayıt. Kimliği metin olmayan satır atlanır; yinelenen kimlik bir kez.
 */
export function bayiSiparisSirasi(adaylar: ReadonlyArray<Record<string, unknown>>, sinir: number = BAYI_SIPARIS_SINIRI): string[] {
  const gorulen = new Set<string>();
  const satirlar: Array<{ id: string; ms: number }> = [];
  for (const r of adaylar) {
    if (typeof r.id !== 'string' || gorulen.has(r.id)) continue;
    gorulen.add(r.id);
    satirlar.push({ id: r.id, ms: siparisTarihMs({ syncedAt: r.s, createdAt: r.c, orderDate: r.d }) });
  }
  satirlar.sort((a, b) => {
    if (a.ms !== b.ms) {
      if (a.ms === -Infinity) return 1;
      if (b.ms === -Infinity) return -1;
      return b.ms - a.ms;
    }
    return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
  });
  return satirlar.slice(0, sinir).map(s => s.id);
}

// ── Durum sözlüğü ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Site sözlüğü (bayi.js). `teyit` bu dilimde ÜRETİLMEZ (adım çubuğu «geçti» gösterir). */
export type BayiDurum = 'alindi' | 'teyit' | 'hazirlaniyor' | 'sevk' | 'teslim' | 'iptal';

/** `Order['status']` → site sözlüğü. Anahtar kümesi tipe kilitli: yeni sipariş durumu eklenirse burası derlenmez. */
export const BAYI_DURUM_SOZLUGU: Readonly<Record<Order['status'], BayiDurum>> = Object.freeze({
  Pending: 'alindi',
  Processing: 'hazirlaniyor',
  Shipped: 'sevk',
  Delivered: 'teslim',
  Cancelled: 'iptal',
});

const siparisDurumuMu = (v: string): v is Order['status'] => Object.hasOwn(BAYI_DURUM_SOZLUGU, v);

/** Saklı `status` → site sözlüğü; sözlük dışı (küçük harf, sayı, `constructor`, `__proto__` …) → `null`, ham değer ÇIKMAZ. */
export function bayiDurumu(status: unknown): BayiDurum | null {
  return typeof status === 'string' && siparisDurumuMu(status) ? BAYI_DURUM_SOZLUGU[status] : null;
}

// ── Yanıt süzgeci ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface BayiSiparisKalemi {
  /** Kalemin stok kodu metni; yoksa `''` (site `x.sku + ' ' + x.ad` ile arar — `null` metne karışırdı). */
  sku: string;
  /** `name` → `title` → `sku` → '—'. */
  ad: string;
  /** Sonlu sayı değilse `null` (BİLİNMİYOR — 1 ya da 0 değil). */
  adet: number | null;
}

export interface BayiSiparis {
  /** Opak kimlik (`bayiSiparisKimligi`) — doküman kimliği DEĞİL. */
  id: string;
  /** `gorunenTakipNo`; yoksa '—'. */
  no: string;
  /** ISO metin; üç tarih alanı da çözülmezse `null`. */
  tarih: string | null;
  durum: BayiDurum | null;
  kalemler: BayiSiparisKalemi[];
}

const nesneMi = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const doluMetin = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Tek kalem (SAF). Fiyat, tutar, KDV, birim, iskonto alanları OKUNMAZ. */
export function bayiSiparisKalemi(ham: unknown): BayiSiparisKalemi {
  const k = nesneMi(ham) ? ham : {};
  const sku = typeof k.sku === 'string' ? k.sku : '';
  const ad = doluMetin(k.name) ? k.name : doluMetin(k.title) ? k.title : doluMetin(sku) ? sku : '—';
  return { sku, ad, adet: typeof k.quantity === 'number' && Number.isFinite(k.quantity) ? k.quantity : null };
}

/**
 * Saklı sipariş belgesinden yanıt kaydı (SAF) — TEK süzgeç. `id` çağıranın ürettiği opak kimliktir. Yanıta YALNIZ beş anahtar
 * girer; belgede ne olursa olsun (not, tutar, sürücü, gönderim izi, LUCA, kargo / fatura no) başka anahtar YAZILMAZ.
 */
export function bayiSiparisi(id: string, o: Record<string, unknown>): BayiSiparis {
  return {
    id,
    no: gorunenTakipNo(o) ?? '—',
    tarih: siparisTarih(o)?.toISOString() ?? null,
    durum: bayiDurumu(o.status),
    kalemler: (Array.isArray(o.lineItems) ? o.lineItems : []).map(bayiSiparisKalemi),
  };
}

/**
 * Opak sipariş kimliği: `base64url(HMAC-SHA256(kimlikAnahtari, 'sip\n' + cid + '\n' + uid + '\n' + bas + '\n' + docId)[0..16])`.
 * Aynı oturumda (aynı `bas`) aynı sipariş → aynı kimlik; farklı oturumda farklı; anahtar olmadan kiracıdan / doküman kimliğinden
 * geri TÜRETİLEMEZ. `uid` ve `bas` belirteç yükünden (yüke `jti` eklenmez). Üreten TEK yardımcı budur.
 */
export function bayiSiparisKimligi(kimlikAnahtari: Buffer, g: { cid: string; uid: string; bas: number; docId: string }): string {
  return createHmac('sha256', kimlikAnahtari)
    .update(`sip\n${g.cid}\n${g.uid}\n${g.bas}\n${g.docId}`, 'utf8')
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

/**
 * Aşama 2 satırlarından yanıt listesi (SAF): Aşama 1 SIRASINDA; Aşama 2'de dönmeyen kimlik (iki sorgu arasında silinen ya da
 * yüklemden çıkan satır) düşer. `kimlik` doküman kimliğinden opak kimliği üretir.
 */
export function bayiSiparisListesi(
  sira: readonly string[], govdeler: ReadonlyArray<Record<string, unknown>>, kimlik: (docId: string) => string,
): BayiSiparis[] {
  const govde = new Map<string, Record<string, unknown>>();
  for (const r of govdeler) if (typeof r.id === 'string' && nesneMi(r.data)) govde.set(r.id, r.data);
  const sonuc: BayiSiparis[] = [];
  for (const docId of sira) {
    const data = govde.get(docId);
    if (data !== undefined) sonuc.push(bayiSiparisi(kimlik(docId), data));
  }
  return sonuc;
}

/**
 * `ben.ozet` — SABİT üç `null`, başka anahtar YOK (H13). `bakiye: 0` ekstre sekmesini açıp «0,00 ₺ borç» basardı (bayi.js
 * `ozet.bakiye != null`); `acikSiparis` sunucuda sayılmaz (site listeden sayar). Bakiye / ekstre ayrı dilim (banka mutabakatından sonra).
 */
export const BAYI_BEN_OZETI: Readonly<{ bakiye: null; vadesiGecen: null; acikSiparis: null }> = Object.freeze({
  bakiye: null, vadesiGecen: null, acikSiparis: null,
});
