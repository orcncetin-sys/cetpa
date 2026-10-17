/**
 * faturaGonderimi.ts — e-Fatura ÇİFT KESİM koruması, SUNUCU tarafı: işaretin atomik yazımları ve ret kararları (şartname
 * `.wf/SARTNAME-efatura-cift-kesim.md` § 7 D1, D2, D4, D6, D14, D15; 2026-10-17). Ortak tanım: lib/faturaGonderimi.
 *
 * NEDEN DOĞRUDAN SQL: pgShim `set(merge)` / `update` OKU-DEĞİŞTİR-YAZ'dır (SELECT → tam yazım). İki eşzamanlı kesim isteği
 * aynı «işaret yok» satırını okuyup ikisi de Mikro'ya giderdi. Burada her geçiş TEK `UPDATE … WHERE <koşul> RETURNING data`
 * ifadesidir: koşul satır kilidi altında sınanır; iki istekten biri satırı alır, öteki 0 satır görür (mağaza talebi kalıbı:
 * kanal/magazaDurum.ts). Her yazımın ardından RETURNING verisiyle `broadcastDocChange` çağrılır (çağıran verir).
 *
 * KİRACI (D15): talep, geçişler, sonuç ve 0-satır yeniden okuması AYNI koşulu kullanır — `companyId` çağıranınki YA DA
 * etiketsiz (alan yok, JSON `null` ya da BOŞ DİZE — Y2 kararı: aynı uçtaki `belgeSahipligi` ve CLAUDE.md eşleştirme kalıbı
 * `companyId || ''` ile tutarlı); her yazım `companyId` damgalar (etiketsiz eski kaydı onarma). Yabancı kiracı ile olmayan
 * sipariş AYNI yanıtı alır (404, varlık sızmaz); hiçbir dalda satır YARATILMAZ (UPDATE, upsert değil).
 *
 * GEÇİŞLERİN DURUM KOŞULU (inceleme 1, İ1-2): `istekNo` tek başına yetmez — A uçuştayken işaret bayatlar ve «Mikro'da var» ile
 * `gonderildi` olursa işaret HÂLÂ A'nındır (çözüm `istekNo`'yu korur). A'nın geç reddi `reddedildi` yazsaydı sipariş yeniden
 * kesilebilir olurdu (ikinci resmî belge). Ret / belirsiz / geri alma yalnız `gonderiliyor` üstüne; başarı `gonderiliyor` ya da
 * `gonderildi` üstüne (numara eklenir — Mikro'nunki asıldır). Tutmayan geçiş 0 satırdır (çağıran `gec_yanit` günlüğü yazar).
 *
 * Parametreler: $1 sipariş kimliği, $2 kiracı; sorguya göre $3… (her sabitin üstünde yazılı). Alan adı koddaki sabitten gömülür.
 * Bağımlılık YOK (havuz ve yayın çağırandan): saf karar işlevleri ve SQL metinleri PGlite ile birebir sınanır.
 */
import {
  FATURA_GONDERIM_ALANI, FATURA_GONDERIM_BAYATLIK_MS, faturaIsareti,
  type FaturaGonderimDurumu, type FaturaKesilemezNedeni, type FaturaYanitKodu, type MikroFaturaGonderimi,
} from '../../lib/faturaGonderimi.js';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi.js';

export interface FaturaHavuzu {
  query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Yazımdan sonra RETURNING verisiyle yayın (rota `broadcastDocChange('orders', 'set', id, data)` verir). */
export type FaturaYayini = (id: string, data: Record<string, unknown>) => void;

export interface FaturaBaglami {
  havuz: FaturaHavuzu;
  yayinla: FaturaYayini;
  /** Sipariş kimliği (istemcinin `firebaseId`'si — E2 zorunlu). */
  id: string;
  /** Çağıranın kiracısı. */
  companyId: string;
}

// ── SQL ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (!/^[A-Za-z0-9_]+$/.test(FATURA_GONDERIM_ALANI)) throw new Error('FATURA_GONDERIM_ALANI SQL\'e gömülemez');
const A = FATURA_GONDERIM_ALANI;
const ISARET = `data->'${A}'`;
/** D15 + Y2: çağıranın kiracısı YA DA etiketsiz (alan yok / JSON `null` / boş dize — `companyId || ''` kalıbı). */
const KIRACI = `(data->>'companyId' = $2 OR coalesce(data->>'companyId', '') = '')`;

/** Bayat `gonderiliyor` (D5): `zaman` + eşik < sunucu saati (SQL `now()`). Zamanı okunamayan işaret bayattır (güvenli yön).
 *  `esik` = ms cinsinden eşiğin parametre yeri. CASE: biçim denetimi dönüşümden ÖNCE (bozuk metin sorguyu düşürmesin). */
const bayatSql = (esik: string): string =>
  `(${ISARET}->>'durum' = 'gonderiliyor' AND coalesce((CASE WHEN ${ISARET}->>'zaman' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' ` +
  `THEN (${ISARET}->>'zaman')::timestamptz END) + (${esik}::double precision * interval '1 millisecond') < now(), true))`;

/**
 * D1 — TALEP: siparişte Mikro faturası YOKSA `gonderiliyor` yazılır. «İşaret yok» = anahtar yok YA DA nesne değil (JSON `null`
 * dâhil); `reddedildi` yeniden gönderilebilir; bayat `gonderiliyor` GEÇMEZ. `hasInvoice` kapıya girmez (Cetpa-içi fatura).
 * `btrim` yalnız boşluğu kırpar: sekme / satır sonu içeren numara «dolu» sayılır (güvenli yön).
 * $3 işaret (jsonb), $4 mağaza kaynağı (`MAGAZA_KAYNAGI` — metin kopyası yok).
 */
export const FATURA_TALEP_SQL = `UPDATE docs SET data = data || jsonb_build_object('${A}', $3::jsonb, 'companyId', $2::text), updated_at = now()
 WHERE coll = 'orders' AND id = $1 AND ${KIRACI}
   AND coalesce(data->>'source', '') NOT IN ('mikro-fatura', $4::text)
   AND btrim(coalesce(data->>'mikroFaturaNo', '')) = '' AND btrim(coalesce(data->>'ettn', '')) = ''
   AND (data->'faturali') IS DISTINCT FROM 'false'::jsonb
   AND (jsonb_typeof(${ISARET}) IS DISTINCT FROM 'object' OR ${ISARET}->>'durum' = 'reddedildi')
 RETURNING data`;

/** 0 satırdan sonra AYNI kiracı tanımıyla yeniden okuma. Talebin kollarını SQL'in kendisi hesaplar (JS ile ayrışmasın). $3 eşik. */
export const FATURA_OKU_SQL = `SELECT data,
   ${bayatSql('$3')} AS bayat,
   coalesce(data->>'source', '') AS kaynak,
   btrim(coalesce(data->>'mikroFaturaNo', '')) <> '' AS no_dolu,
   btrim(coalesce(data->>'ettn', '')) <> '' AS ettn_dolu,
   coalesce((data->'faturali') = 'false'::jsonb, false) AS faturasiz,
   data->>'mikroFaturaNo' AS no_metin,
   data->>'ettn' AS ettn_metin
 FROM docs WHERE coll = 'orders' AND id = $1 AND ${KIRACI}`;

/** Talepten sonraki geçişin hedef durumu. */
export type FaturaGecisHedefi = 'gonderildi' | 'reddedildi' | 'belirsiz';

/**
 * Geçişin hangi durumların ÜSTÜNE yazılabildiği (İ1-2; başlıktaki «GEÇİŞLERİN DURUM KOŞULU»). Ret / belirsiz yalnız
 * `gonderiliyor` üstüne: `gonderildi` (geç kalan isteğin işaretini «Mikro'da var» çözdü) EZİLMEZ — `reddedildi` yazılsaydı
 * sipariş yeniden kesilebilir olurdu. Başarı `gonderildi` üstüne de yazılır (Mikro'nun numarası, elle girilenin yerine).
 */
export const FATURA_GECIS_KAYNAKLARI: Readonly<Record<FaturaGecisHedefi, readonly FaturaGonderimDurumu[]>> = {
  gonderildi: ['gonderiliyor', 'gonderildi'],
  reddedildi: ['gonderiliyor'],
  belirsiz: ['gonderiliyor'],
};
const durumListesi = (durumlar: readonly FaturaGonderimDurumu[]): string => {
  for (const d of durumlar) if (!/^[a-z]+$/.test(d)) throw new Error(`geçersiz durum adı '${d}'`);
  return durumlar.map(d => `'${d}'`).join(', ');
};

/**
 * D4 — talepten SONRAKİ geçiş (`gonderildi` / `reddedildi` / `belirsiz`): yalnız işaret HÂLÂ bu isteğinse (`istekNo`) VE
 * `FATURA_GECIS_KAYNAKLARI`'ndaki bir durumdaysa. Araya `sonuc mikrodaYok` + yeni talep girdiyse yeni isteğin işareti EZİLMEZ;
 * araya `sonuc mikrodaVar` girdiyse geç ret / belirsiz `gonderildi`yi EZMEZ (ikisi de 0 satır). $3 istekNo, $4 üst düzey yama
 * (başarıda `mikroFaturaNo` / `ettn` / `hasInvoice` …; aksi `{}`), $5 işaret yaması (`durum`, varsa `numara`).
 */
export const faturaGecisSql = (hedef: FaturaGecisHedefi): string =>
  `UPDATE docs SET data = (data || $4::jsonb) || jsonb_build_object('${A}', (${ISARET}) || $5::jsonb, 'companyId', $2::text), updated_at = now()
 WHERE coll = 'orders' AND id = $1 AND ${KIRACI} AND ${ISARET}->>'istekNo' = $3 AND ${ISARET}->>'durum' IN (${durumListesi(FATURA_GECIS_KAYNAKLARI[hedef])})
 RETURNING data`;

/** D2 — gönderim başlamadan düşen istekte talebi GERİ AL (anahtar silinir, `null` yazılmaz). Yalnız `gonderiliyor` üstüne
 *  (ret / belirsiz ile AYNI kural): bu arada «Mikro'da var» ile `gonderildi` olmuş işaret silinmez. $3 istekNo. */
export const FATURA_GERI_AL_SQL = `UPDATE docs SET data = (data - '${A}') || jsonb_build_object('companyId', $2::text), updated_at = now()
 WHERE coll = 'orders' AND id = $1 AND ${KIRACI} AND ${ISARET}->>'istekNo' = $3 AND ${ISARET}->>'durum' = 'gonderiliyor'
 RETURNING data`;

/** D6 — çözülebilir işaret: `belirsiz` ya da bayat `gonderiliyor`. Koşul WHERE'de: iki eşzamanlı `sonuc`'tan biri uygulanır. */
const COZULEBILIR = `jsonb_typeof(${ISARET}) = 'object' AND (${ISARET}->>'durum' = 'belirsiz' OR ${bayatSql('$3')})`;
/** `mikrodaVar` → `gonderildi` (numara verilirse işarete ve `mikroFaturaNo`'ya); üst düzeyde kaydet başarısıyla AYNI fatura
 *  alanları (`sonucVarYamasi`). $3 eşik, $4 üst düzey yama, $5 işaret yaması. */
export const FATURA_SONUC_VAR_SQL = `UPDATE docs SET data = (data || $4::jsonb) || jsonb_build_object('${A}', (${ISARET}) || $5::jsonb, 'companyId', $2::text), updated_at = now()
 WHERE coll = 'orders' AND id = $1 AND ${KIRACI} AND ${COZULEBILIR}
 RETURNING data`;
/** `mikrodaYok` → anahtar SİLİNİR (yeniden gönderilebilir). $3 eşik. */
export const FATURA_SONUC_YOK_SQL = `UPDATE docs SET data = (data - '${A}') || jsonb_build_object('companyId', $2::text), updated_at = now()
 WHERE coll = 'orders' AND id = $1 AND ${KIRACI} AND ${COZULEBILIR}
 RETURNING data`;

// ── Kararlar (saf) ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Ret yanıtı: HTTP durumu + gövde. Gövde HER ZAMAN güncel işareti taşır (D8) — 404 hariç (varlık sızmaz). */
export interface FaturaRetKarari { durum: number; govde: Record<string, unknown> }

/** Yeniden okunan satırın SQL'de hesaplanmış kolları. */
export interface FaturaOkunan {
  data: Record<string, unknown>;
  bayat: boolean;
  kaynak: string;
  noDolu: boolean;
  ettnDolu: boolean;
  faturasiz: boolean;
  noMetin: string | null;
  ettnMetin: string | null;
}

/** Varlığı sızdırmayan 404 gövdesi (mikroRoutes `YABANCI_BELGE` ile aynı metin). */
export const FATURA_BULUNAMADI = { success: false, error: 'Kayıt bulunamadı.' } as const;

const ret = (durum: number, kod: FaturaYanitKodu, error: string, isaret: MikroFaturaGonderimi | null, ek: Record<string, unknown> = {}): FaturaRetKarari =>
  ({ durum, govde: { success: false, kod, error, mikroFaturaGonderimi: isaret, ...ek } });

/** D14: 409 `FATURA_GONDERILDI` numarayı taşır — siparişin `mikroFaturaNo`'su, yoksa işaretteki numara; ETTN varsa. Yoksa alan YOK. */
function gonderildiRet(o: FaturaOkunan, isaret: MikroFaturaGonderimi | null): FaturaRetKarari {
  const numara = o.noDolu && o.noMetin !== null ? o.noMetin : isaret?.numara;
  return ret(409, 'FATURA_GONDERILDI', `Bu siparişin faturası zaten kesildi${numara ? ` (No: ${numara})` : ''}.`, isaret, {
    ...(numara ? { numara } : {}),
    ...(o.ettnDolu && o.ettnMetin !== null ? { ettn: o.ettnMetin } : {}),
  });
}

/**
 * D1 — talep tutmadı (0 satır): yanıt şu ÖNCELİKLE seçilir; hiçbir dalda Mikro'ya istek GİTMEZ.
 *   2. Mikro faturasından türeyen / mağaza / faturasız satış → 400 `FATURA_KESILEMEZ` (MF siparişi HER ZAMAN numara taşır:
 *      numara önce gelseydi bu kol ölü olurdu).
 *   3. `mikroFaturaNo` ya da `ettn` dolu → 409 `FATURA_GONDERILDI`.
 *   4. İşaret `gonderildi` → 409 `FATURA_GONDERILDI`; `belirsiz` ya da bayat `gonderiliyor` → 409 `FATURA_SONUCU_BILINMIYOR`;
 *      taze `gonderiliyor` → 409 `FATURA_GONDERILIYOR`.
 *   5. Hiçbiri (yarış: işaret talep ile okuma arasında temizlendi) → 409 `FATURA_GONDERILIYOR`; kullanıcı yeniden dener.
 * (1. — satır yok / yabancı kiracı → 404 — çağıranda: satır gelmediyse bu işlev çağrılmaz.)
 */
export function talepRetKarari(o: FaturaOkunan): FaturaRetKarari {
  const isaret = faturaIsareti(o.data);
  const neden: FaturaKesilemezNedeni | null = o.kaynak === 'mikro-fatura' ? 'mikro-fatura'
    : o.kaynak === MAGAZA_KAYNAGI ? 'magaza'
    : o.faturasiz ? 'faturasiz' : null;
  if (neden) {
    const metin = neden === 'mikro-fatura' ? 'Bu kayıt Mikro faturasından türetildi — ikinci fatura kesilemez.'
      : neden === 'magaza' ? 'Çevrim içi mağaza siparişine buradan fatura kesilemez.'
      : 'Faturasız satışa fatura kesilemez.';
    return ret(400, 'FATURA_KESILEMEZ', metin, isaret, { neden });
  }
  if (o.noDolu || o.ettnDolu) return gonderildiRet(o, isaret);
  if (isaret?.durum === 'gonderildi') return gonderildiRet(o, isaret);
  if (isaret?.durum === 'belirsiz' || (isaret?.durum === 'gonderiliyor' && o.bayat)) {
    return ret(409, 'FATURA_SONUCU_BILINMIYOR', 'Bu siparişin fatura sonucu bilinmiyor; önce Mikro\'dan kontrol edip kaydı çözün.', isaret);
  }
  return ret(409, 'FATURA_GONDERILIYOR', 'Bu siparişin faturası şu an gönderiliyor.', isaret);
}

/** D6 — `sonuc` tutmadı (0 satır): `gonderildi` → 409 `FATURA_GONDERILDI`; taze `gonderiliyor` → 409 `FATURA_GONDERILIYOR`;
 *  işaret yok ya da `reddedildi` → 409 `FATURA_SONUC_YOK`. */
export function sonucRetKarari(o: FaturaOkunan): FaturaRetKarari {
  const isaret = faturaIsareti(o.data);
  if (isaret?.durum === 'gonderildi') return gonderildiRet(o, isaret);
  if (isaret?.durum === 'gonderiliyor' && !o.bayat) return ret(409, 'FATURA_GONDERILIYOR', 'Bu siparişin faturası şu an gönderiliyor.', isaret);
  return ret(409, 'FATURA_SONUC_YOK', 'Bu siparişte çözülecek bir fatura sonucu yok.', isaret);
}

// ── Yazımlar ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

async function yeniden(b: FaturaBaglami): Promise<FaturaOkunan | null> {
  const { rows } = await b.havuz.query(FATURA_OKU_SQL, [b.id, b.companyId, FATURA_GONDERIM_BAYATLIK_MS]);
  const r = rows[0];
  if (!r || !nesneMi(r.data)) return null;
  const metinVeyaNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    data: r.data, bayat: r.bayat === true, kaynak: typeof r.kaynak === 'string' ? r.kaynak : '',
    noDolu: r.no_dolu === true, ettnDolu: r.ettn_dolu === true, faturasiz: r.faturasiz === true,
    noMetin: metinVeyaNull(r.no_metin), ettnMetin: metinVeyaNull(r.ettn_metin),
  };
}

/** Tek satırlık UPDATE … RETURNING: satır döndüyse yayınlanır ve döner; yoksa `null`. */
async function yaz(b: FaturaBaglami, sql: string, p: unknown[]): Promise<Record<string, unknown> | null> {
  const { rows } = await b.havuz.query(sql, p);
  const data = rows[0]?.data;
  if (!nesneMi(data)) return null;
  b.yayinla(b.id, data);
  return data;
}

export type TalepSonucu = { tamam: true; data: Record<string, unknown> } | { tamam: false; karar: FaturaRetKarari };

/** D1 talebi. Tutmazsa sipariş yeniden okunur ve D1 öncelik sırasıyla ret kararı döner (404 dâhil). */
export async function faturaTalepEt(b: FaturaBaglami, isaret: MikroFaturaGonderimi): Promise<TalepSonucu> {
  const data = await yaz(b, FATURA_TALEP_SQL, [b.id, b.companyId, JSON.stringify(isaret), MAGAZA_KAYNAGI]);
  if (data) return { tamam: true, data };
  const okunan = await yeniden(b);
  if (!okunan) return { tamam: false, karar: { durum: 404, govde: { ...FATURA_BULUNAMADI, kod: 'FATURA_GONDERILMEDI' } } };
  return { tamam: false, karar: talepRetKarari(okunan) };
}

/** D4 geçişi; 0 satırda `null` (sipariş silindi, işaret artık bu isteğin değil ya da durumu geçişe kapalı — satır YARATILMAZ). */
export function faturaGecisiYaz(
  b: FaturaBaglami, istekNo: string, isaretYamasi: { durum: FaturaGecisHedefi; numara?: string }, ustYama: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  return yaz(b, faturaGecisSql(isaretYamasi.durum), [b.id, b.companyId, istekNo, JSON.stringify(ustYama), JSON.stringify(isaretYamasi)]);
}

/** D2 geri alması; 0 satırda `null`. */
export function faturaTalebiniGeriAl(b: FaturaBaglami, istekNo: string): Promise<Record<string, unknown> | null> {
  return yaz(b, FATURA_GERI_AL_SQL, [b.id, b.companyId, istekNo]);
}

/** Yazım 0 satır döndükten sonra yanıta konacak GÜNCEL işaret (D8; AYNI kiracı tanımıyla yeniden okunur). Satır yoksa `null`.
 *  Geç kalan yanıt istemciye talebin bayat `gonderiliyor`unu taşımasın — o arada çözülmüş işareti yerelde ezerdi. */
export async function faturaGuncelIsareti(b: FaturaBaglami): Promise<unknown> {
  const okunan = await yeniden(b);
  return okunan ? okunan.data[A] ?? null : null;
}

/** `mikrodaVar` üst düzey yaması (İ1-4): kaydet başarısının fatura alanları — `hasInvoice`, `mikroSynced`, numara verildiyse
 *  `mikroFaturaNo`. Kesim zamanı (`mikroFaturaDate`) ve ETTN BİLİNMEDİĞİ için yazılmaz (uydurma yok). */
export const sonucVarYamasi = (numara?: string): Record<string, unknown> =>
  ({ hasInvoice: true, mikroSynced: true, ...(numara ? { mikroFaturaNo: numara } : {}) });

/** D6 `sonuc`. `numara` yalnız `mikrodaVar`'da kullanılır. Tutmazsa ret kararı (404 dâhil). */
export async function faturaSonucunuYaz(b: FaturaBaglami, karar: 'mikrodaVar' | 'mikrodaYok', numara?: string): Promise<TalepSonucu> {
  const data = karar === 'mikrodaVar'
    ? await yaz(b, FATURA_SONUC_VAR_SQL, [
        b.id, b.companyId, FATURA_GONDERIM_BAYATLIK_MS,
        JSON.stringify(sonucVarYamasi(numara)),
        JSON.stringify({ durum: 'gonderildi', ...(numara ? { numara } : {}) }),
      ])
    : await yaz(b, FATURA_SONUC_YOK_SQL, [b.id, b.companyId, FATURA_GONDERIM_BAYATLIK_MS]);
  if (data) return { tamam: true, data };
  const okunan = await yeniden(b);
  if (!okunan) return { tamam: false, karar: { durum: 404, govde: { ...FATURA_BULUNAMADI } } };
  return { tamam: false, karar: sonucRetKarari(okunan) };
}
