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
import { cetpaEttnAnahtari, guidAnahtari } from '../../lib/ettn.js';
import { faturaEttn } from '../../lib/gibDurum.js';
import { faturaYonu } from './eslemeFatura.js';
import { GUN, cariAnahtari, talepSiniri } from './faturaBekletme.js';

/** Havuzdan alınan TEK bağlantı (`pg.PoolClient` alt kümesi): işlem (`BEGIN` … `COMMIT`) aynı bağlantıda koşmalı. `release(hata)`
 *  doğru bir değerle çağrılırsa havuz bağlantıyı atar (geri alma da düştüyse bağlantı işlem ortasında kalmış olabilir). */
export interface FaturaIstemcisi {
  query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  release: (hata?: Error | boolean) => void;
}
import { MF_KAYNAGI } from '../../lib/mfKaynagi.js';

export interface FaturaHavuzu {
  query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  /** ETTN yazımları (danışma kilidi + UPDATE tek işlemde) için bağlantı (§ 9.B B3, delta 2026-10-19). */
  connect: () => Promise<FaturaIstemcisi>;
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
if (!/^[A-Za-z0-9_-]+$/.test(MF_KAYNAGI)) throw new Error('MF_KAYNAGI SQL\'e gömülemez');
const A = FATURA_GONDERIM_ALANI;
const ISARET = `data->'${A}'`;
/** D15 + Y2: çağıranın kiracısı YA DA etiketsiz (alan yok / JSON `null` / boş dize — `companyId || ''` kalıbı). */
const KIRACI = `(data->>'companyId' = $2 OR coalesce(data->>'companyId', '') = '')`;

/** LB — sipariş LUCA'ya Cetpa'dan aktarılMAMIŞ: `lucaSynced` JSON `true` değil VE `lucaFaturaNo` boş (`btrim`, numarayla aynı). */
const LUCA_GONDERILMEDI = `((data->'lucaSynced') IS DISTINCT FROM 'true'::jsonb AND btrim(coalesce(data->>'lucaFaturaNo', '')) = '')`;

/** Bayat `gonderiliyor` (D5): `zaman` + eşik < sunucu saati (SQL `now()`). Zamanı okunamayan işaret bayattır (güvenli yön).
 *  `esik` = ms cinsinden eşiğin parametre yeri. CASE: biçim denetimi dönüşümden ÖNCE (bozuk metin sorguyu düşürmesin). */
const bayatSql = (esik: string): string =>
  `(${ISARET}->>'durum' = 'gonderiliyor' AND coalesce((CASE WHEN ${ISARET}->>'zaman' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' ` +
  `THEN (${ISARET}->>'zaman')::timestamptz END) + (${esik}::double precision * interval '1 millisecond') < now(), true))`;

/**
 * D1 — TALEP: siparişte Mikro faturası YOKSA `gonderiliyor` yazılır. «İşaret yok» = anahtar yok YA DA nesne değil (JSON `null`
 * dâhil); `reddedildi` yeniden gönderilebilir; bayat `gonderiliyor` GEÇMEZ. `hasInvoice` kapıya girmez (Cetpa-içi fatura).
 * `btrim` yalnız boşluğu kırpar: sekme / satır sonu içeren numara «dolu» sayılır (güvenli yön).
 * LUCA'YA AKTARILMIŞ SİPARİŞ (2026-10-19, şartname «takip kodu + LUCA reddi» LB): `lucaSynced` JSON `true` YA DA `lucaFaturaNo`
 * dolu → talep GEÇMEZ. Muhasebeci Mikro'daki faturaları LUCA'ya aktarır; Cetpa'dan LUCA'ya gitmiş siparişe Mikro'da da fatura
 * kesilirse LUCA'da aynı satış iki kez olurdu. İşaretlerin tek yazıcısı (`/api/luca/sync/fatura`) LA ile kapandı; `/api/db`
 * yazamaz (collections.SUNUCU_TURETILEN_ALANLAR). İstemci düğmesi aynı ölçütle gizlenir (faturaDurumu.mikroyaFaturaGonderilebilir).
 * $3 işaret (jsonb), $4 mağaza kaynağı (`MAGAZA_KAYNAGI` — metin kopyası yok). MF kaynağı `MF_KAYNAGI`'dan gömülür (lib/mfKaynagi).
 */
export const FATURA_TALEP_SQL = `UPDATE docs SET data = data || jsonb_build_object('${A}', $3::jsonb, 'companyId', $2::text), updated_at = now()
 WHERE coll = 'orders' AND id = $1 AND ${KIRACI}
   AND coalesce(data->>'source', '') NOT IN ('${MF_KAYNAGI}', $4::text)
   AND btrim(coalesce(data->>'mikroFaturaNo', '')) = '' AND btrim(coalesce(data->>'ettn', '')) = ''
   AND (data->'faturali') IS DISTINCT FROM 'false'::jsonb
   AND ${LUCA_GONDERILMEDI}
   AND (jsonb_typeof(${ISARET}) IS DISTINCT FROM 'object' OR ${ISARET}->>'durum' = 'reddedildi')
 RETURNING data`;

/** 0 satırdan sonra AYNI kiracı tanımıyla yeniden okuma. Talebin kollarını SQL'in kendisi hesaplar (JS ile ayrışmasın). $3 eşik. */
export const FATURA_OKU_SQL = `SELECT data,
   ${bayatSql('$3')} AS bayat,
   coalesce(data->>'source', '') AS kaynak,
   btrim(coalesce(data->>'mikroFaturaNo', '')) <> '' AS no_dolu,
   btrim(coalesce(data->>'ettn', '')) <> '' AS ettn_dolu,
   coalesce((data->'faturali') = 'false'::jsonb, false) AS faturasiz,
   NOT ${LUCA_GONDERILMEDI} AS luca_gonderildi,
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
/** `mikrodaVar` UPDATE'i; `ek` yalnız ETTN'li biçimde (aşağıda) WHERE'e eklenir — ETTN'siz metin birebir eskisi. */
const sonucVarSql = (ek = ''): string => `UPDATE docs SET data = (data || $4::jsonb) || jsonb_build_object('${A}', (${ISARET}) || $5::jsonb, 'companyId', $2::text), updated_at = now()
 WHERE coll = 'orders' AND id = $1 AND ${KIRACI} AND ${COZULEBILIR}${ek}
 RETURNING data`;
/** `mikrodaVar` → `gonderildi` (numara verilirse işarete ve `mikroFaturaNo`'ya); üst düzeyde kaydet başarısıyla AYNI fatura
 *  alanları (`sonucVarYamasi`). $3 eşik, $4 üst düzey yama, $5 işaret yaması. */
export const FATURA_SONUC_VAR_SQL = sonucVarSql();
/**
 * § 9.B B3 — «aynı ETTN başka bir Cetpa siparişinde» koşulu (`d2` takma adıyla; sipariş KENDİSİ hariç). ETTN anahtarı `guidAnahtari`
 * ile aynı biçim: baştaki / sondaki boşluk ve TEK süslü parantez soyulur, küçük harfe çevrilir — kaydet yolu Mikro'nun döndürdüğü
 * ham değeri (parantezli / büyük harfli olabilir) yazar, `sonuc` anahtarı yazar; ikisi de tutmalı. Geçerlilik ÖLÇÜTÜ buraya
 * kopyalanmaz (rota `cetpaEttnAnahtari` ile sınar). $1 sipariş, $2 kiracı (aynı kiracı ya da etiketsiz — `KIRACI` kalıbı),
 * `anahtar` = anahtarın parametre yeri.
 */
const baskaSiparisKosulu = (anahtar: string): string =>
  `d2.coll = 'orders' AND d2.id <> $1 AND (d2.data->>'companyId' = $2 OR coalesce(d2.data->>'companyId', '') = '')
   AND coalesce(d2.data->>'source', '') <> '${MF_KAYNAGI}'
   AND lower(regexp_replace(coalesce(d2.data->>'ettn', ''), '^\\s*\\{?|\\}?\\s*$', '', 'g')) = ${anahtar}`;
/**
 * Yazım anında aynı ETTN'yi taşıyan başka sipariş YOK (UPDATE'in WHERE'inde). TEK BAŞINA YARIŞI KAPATMAZ: READ COMMITTED'da iki
 * eşzamanlı UPDATE farklı satırlara yazar, her biri deyim başındaki görüntüde ötekinin İŞLENMEMİŞ yazımını görmez — ikisi de
 * `NOT EXISTS`'i geçer (inceleme delta, 2026-10-19). Yarışı `FATURA_ETTN_KILIT_SQL` kapatır: iki yazım aynı (kiracı, anahtar)
 * danışma kilidinde sıraya girer, ikincinin UPDATE'i birincinin İŞLENMİŞ yazımını görür. `NOT EXISTS` sıralı araya girmeyi
 * (ön denetimden sonra başka siparişe yazıldı) ve kilidin dışından gelen yazımı yakalar.
 */
const baskaSiparisYok = (anahtar: string): string => `NOT EXISTS (SELECT 1 FROM docs d2 WHERE ${baskaSiparisKosulu(anahtar)})`;
/** Ön denetim ve 0 satır sonrası ayrım: aynı ETTN'yi taşıyan başka siparişin numarası. $1 sipariş, $2 kiracı, $3 anahtar. */
export const FATURA_ETTN_BASKA_SIPARIS_SQL = `SELECT d2.id, d2.data->>'orderNumber' AS no FROM docs d2 WHERE ${baskaSiparisKosulu('$3')} ORDER BY d2.id LIMIT 1`;

/** `mikrodaVar` + ETTN (§ 9.B B2 / B3): `FATURA_SONUC_VAR_SQL` + yazım anında «başka sipariş yok». $6 ETTN anahtarı. Yalnız
 *  `FATURA_ETTN_KILIT_SQL` ile aynı işlemde koşar (`ettnKilidiyleYaz`). */
export const FATURA_SONUC_VAR_ETTN_SQL = sonucVarSql(`\n   AND ${baskaSiparisYok('$6')}`);

/**
 * § 9.B B3 (delta 2026-10-19) — ETTN yazan iki yolun (`mikrodaVar` + ETTN, «ETTN ekle») ORTAK danışma kilidi: işlem sonuna dek
 * tutulur (`_xact_`; COMMIT / ROLLBACK bırakır). Anahtar (kiracı, ETTN anahtarı): aynı ETTN'yi iki siparişe yazmaya çalışan iki
 * istek sıraya girer; farklı ETTN'ler birbirini beklemez. AYRI DEYİM olmalı: READ COMMITTED'da görüntü deyim BAŞINDA alınır —
 * kilit UPDATE'in CTE'sinde alınsaydı UPDATE'in `NOT EXISTS`'i kilitten ÖNCEKİ görüntüyü okur, beklediği yazımı yine görmezdi.
 * $1 kiracı, $2 ETTN anahtarı.
 */
export const FATURA_ETTN_KILIT_SQL = `SELECT pg_advisory_xact_lock(hashtext($1::text || ':ettn:' || $2::text))`;

/**
 * § 9.B B2 — «ETTN ekle» KARŞILAŞTIR-YAZ: yalnız işaret `gonderildi`, Mikro faturasından türemiş kayıt DEĞİL, ham `ettn` OKUNAN
 * değerle AYNI (araya giren yazım → 0 satır → `FATURA_ETTN_DEGISTI`) ve aynı ETTN başka siparişte yokken yazar. «Geçerli ETTN yok»
 * ölçütü SQL'e kopyalanmaz: JS `cetpaEttnAnahtari` okunan değerde sınar, karşılaştırma o değerin değişmediğini garanti eder.
 * Yalnız `FATURA_ETTN_KILIT_SQL` ile aynı işlemde koşar (`ettnKilidiyleYaz`; `NOT EXISTS` eşzamanlı yazımı tek başına durdurmaz).
 * $3 yazılacak anahtar (küçük harf, parantezsiz), $4 okunan ham değer (`data->>'ettn'`; yoksa `null`).
 */
export const FATURA_ETTN_EKLE_SQL = `UPDATE docs SET data = data || jsonb_build_object('ettn', $3::text, 'companyId', $2::text), updated_at = now()
 WHERE coll = 'orders' AND id = $1 AND ${KIRACI}
   AND coalesce(data->>'source', '') <> '${MF_KAYNAGI}'
   AND ${ISARET}->>'durum' = 'gonderildi'
   AND (data->>'ettn') IS NOT DISTINCT FROM $4::text
   AND ${baskaSiparisYok('$3')}
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
  /** LB: `lucaSynced` JSON `true` YA DA `lucaFaturaNo` dolu (talep koşuluyla AYNI ifade). */
  lucaGonderildi: boolean;
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
 *   2. Mikro faturasından türeyen / mağaza / faturasız satış / LUCA'ya Cetpa'dan aktarılmış (LB) → 400 `FATURA_KESILEMEZ` (MF
 *      siparişi HER ZAMAN numara taşır: numara önce gelseydi bu kol ölü olurdu; LUCA'ya giden siparişte de numara dalı «zaten
 *      kesildi» derdi — asıl neden LUCA'dır).
 *   3. `mikroFaturaNo` ya da `ettn` dolu → 409 `FATURA_GONDERILDI`.
 *   4. İşaret `gonderildi` → 409 `FATURA_GONDERILDI`; `belirsiz` ya da bayat `gonderiliyor` → 409 `FATURA_SONUCU_BILINMIYOR`;
 *      taze `gonderiliyor` → 409 `FATURA_GONDERILIYOR`.
 *   5. Hiçbiri (yarış: işaret talep ile okuma arasında temizlendi) → 409 `FATURA_GONDERILIYOR`; kullanıcı yeniden dener.
 * (1. — satır yok / yabancı kiracı → 404 — çağıranda: satır gelmediyse bu işlev çağrılmaz.)
 */
export function talepRetKarari(o: FaturaOkunan): FaturaRetKarari {
  const isaret = faturaIsareti(o.data);
  // Sol yan kaynak DEĞERİ (lib/mfKaynagi); sağdaki 'mikro-fatura' RET NEDENİ KODUDUR (`FaturaKesilemezNedeni`) — sabite bağlanmaz.
  const neden: FaturaKesilemezNedeni | null = o.kaynak === MF_KAYNAGI ? 'mikro-fatura'
    : o.kaynak === MAGAZA_KAYNAGI ? 'magaza'
    : o.faturasiz ? 'faturasiz'
    : o.lucaGonderildi ? 'luca-gonderildi' : null;
  if (neden) {
    const metin = neden === 'mikro-fatura' ? 'Bu kayıt Mikro faturasından türetildi — ikinci fatura kesilemez.'
      : neden === 'magaza' ? 'Çevrim içi mağaza siparişine buradan fatura kesilemez.'
      : neden === 'faturasiz' ? 'Faturasız satışa fatura kesilemez.'
      : 'Bu sipariş LUCA\'ya Cetpa\'dan aktarıldı; Mikro\'ya ikinci fatura kesilemez.';
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
    lucaGonderildi: r.luca_gonderildi === true,
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

/**
 * ETTN yazan UPDATE (`FATURA_SONUC_VAR_ETTN_SQL` / `FATURA_ETTN_EKLE_SQL`) TEK bağlantıda, tek işlemde: `BEGIN` → AYRI deyimle
 * danışma kilidi (`FATURA_ETTN_KILIT_SQL`) → UPDATE → `COMMIT`; hata olursa `ROLLBACK` (o da düşerse bağlantı havuzdan atılır).
 * Yayın COMMIT'ten SONRA: işlenmemiş satır yayınlanmaz. `ettn` = yazılacak anahtar (kilidin anahtarı).
 */
async function ettnKilidiyleYaz(b: FaturaBaglami, ettn: string, sql: string, p: unknown[]): Promise<Record<string, unknown> | null> {
  const istemci = await b.havuz.connect();
  let bozuk: Error | undefined;
  let data: unknown;
  try {
    await istemci.query('BEGIN');
    await istemci.query(FATURA_ETTN_KILIT_SQL, [b.companyId, ettn]);
    const { rows } = await istemci.query(sql, p);
    data = rows[0]?.data;
    await istemci.query('COMMIT');
  } catch (err) {
    try { await istemci.query('ROLLBACK'); } catch (geriAlmaHatasi) {
      bozuk = geriAlmaHatasi instanceof Error ? geriAlmaHatasi : new Error(String(geriAlmaHatasi));
    }
    throw err;
  } finally {
    istemci.release(bozuk);
  }
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
 *  `mikroFaturaNo`, ETTN verildiyse `ettn` (§ 9.B B2: rotanın `cetpaEttnAnahtari` ile sınadığı ANAHTAR — ham girdi değil). Kesim
 *  zamanı (`mikroFaturaDate`) BİLİNMEDİĞİ için yazılmaz (uydurma yok). */
export const sonucVarYamasi = (numara?: string, ettn?: string): Record<string, unknown> =>
  ({ hasInvoice: true, mikroSynced: true, ...(numara ? { mikroFaturaNo: numara } : {}), ...(ettn ? { ettn } : {}) });

// ── § 9.B B3 — ETTN tutarlılığı (yazma anı; saf) ───────────────────────────────────────────────────────────────────────────
/** Fatura aynasında ETTN henüz yok ya da carisi doğrulanamadı: yazım KABUL edilir, yanıta ve syncLog ayrıntısına düşer. */
export const ETTN_AYNA_UYARISI = 'ETTN Mikro fatura aynasında henüz yok ya da carisi doğrulanamadı (ayna gece güncellenir)';

export interface EttnTutarlilikGirdisi {
  /** `cetpaEttnAnahtari` anahtarı. */
  ettn: string;
  /** Siparişin işaretindeki cari (`faturaIsareti(o)?.cariKod`); yoksa doğrulanamaz. */
  cariKod?: string;
  /** Kiracının `mikroFaturalar` aynası (TÜMÜ — işlev ETTN'yi `faturaEttn` ile süzer; kolon adı tahmini yok). */
  aynaSatirlari: readonly Readonly<Record<string, unknown>>[];
  /** Aynı anahtarı taşıyan BAŞKA Cetpa siparişinin adı (`FATURA_ETTN_BASKA_SIPARIS_SQL`); yoksa `null` / verilmez. */
  baskaSiparis?: string | null;
  /** İşaretin talep sınırı (`YYYY-MM-DD`, `talepSiniri(isaret)` — § 9.A A2, bekletme kuralıyla AYNI işlev); yoksa / biçim dışıysa
   *  tarih denetimi yapılmaz. */
  sinir?: string | null;
}
export interface EttnTutarlilikKarari {
  ret?: { kod: 'FATURA_ETTN_BASKA_SIPARISTE' | 'FATURA_ETTN_BASKA_CARI' | 'FATURA_ETTN_ONCEKI_FATURA'; error: string };
  uyari?: string;
}

/**
 * «Mikro'da var» + ETTN ve «ETTN ekle»nin ORTAK kararı. Ret YALNIZ kesin çelişkide (§ 9.A A7 tutumu):
 *   • aynı ETTN başka bir Cetpa siparişinde → `FATURA_ETTN_BASKA_SIPARISTE` (kaydet yolu bir faturayı tek siparişe bağlar:
 *     her `FaturaKaydetV2` çağrısı tek `firebaseId` için yeni bir belge keser — ölçüm 2026-10-19). Bu karar yazımdan ÖNCEKİ
 *     okumadır; ön denetim ile yazım arasındaki pencereyi yazımın danışma kilidi (`FATURA_ETTN_KILIT_SQL`) + `NOT EXISTS`'i
 *     kapatır — `NOT EXISTS` TEK BAŞINA eşzamanlı iki UPDATE'i durdurmaz (READ COMMITTED);
 *   • aynadaki satırların HEPSİ alış (`faturaYonu`) → `FATURA_ETTN_BASKA_CARI` «alış faturası»;
 *   • satış satırı var, işarette `cariKod` var, hiçbir satış satırının `cha_kod`'u tutmuyor (iki taraf `cariAnahtari`) ve yönü
 *     okunamayan satır yok → `FATURA_ETTN_BASKA_CARI` «başka cari»;
 *   • cari TUTAN satış satırlarının HEPSİNİN günü (`cha_tarihi` ilk 10 karakteri, `YYYY-MM-DD`) talep sınırından KESİN önce →
 *     `FATURA_ETTN_ONCEKI_FATURA`. Gece bekletme kuralı (`bekletmeKarari`: `faturaGunu >= sinir`) sınırdan önceki faturayı «bu
 *     siparişin olamaz» sayar (o fatura zaten MF siparişine dönüşmüştür); bağ kurulurken aynı ölçüt sınanmazsa eski faturanın
 *     ETTN'si kabul edilir, bekletme kalkar ve siparişin gerçek faturası gece AYRICA MF olarak türer (aynı satış iki kez; inceleme
 *     2026-10-19). Sınır yok ya da biçim dışı, ya da bir satırın günü okunamıyorsa ret YOK (kesin değil).
 * Satır yok, yönü okunamayan satır var ya da `cariKod` yok → KABUL + `uyari` (ayna 90 günlük pencere, gece güncellenir).
 */
export function ettnTutarlilikKarari(g: EttnTutarlilikGirdisi): EttnTutarlilikKarari {
  if (g.baskaSiparis) {
    return { ret: { kod: 'FATURA_ETTN_BASKA_SIPARISTE', error: `Bu ETTN başka bir siparişte kayıtlı: ${g.baskaSiparis}` } };
  }
  const satirlar = g.aynaSatirlari.filter(f => guidAnahtari(faturaEttn(f)) === g.ettn);
  if (satirlar.length === 0) return { uyari: ETTN_AYNA_UYARISI };
  const yonler = satirlar.map(f => faturaYonu(f as Record<string, unknown>));
  if (yonler.every(y => y === 'alis')) return { ret: { kod: 'FATURA_ETTN_BASKA_CARI', error: 'Bu ETTN bir alış faturasına ait' } };
  const satislar = satirlar.filter((_, i) => yonler[i] === 'satis');
  const cari = cariAnahtari(g.cariKod);
  if (!cari || satislar.length === 0) return { uyari: ETTN_AYNA_UYARISI };
  const tutanlar = satislar.filter(f => cariAnahtari(f.cha_kod) === cari);
  if (tutanlar.length > 0) {
    const sinir = typeof g.sinir === 'string' && GUN.test(g.sinir) ? g.sinir : null;
    const gunler = tutanlar.map(f => String(f.cha_tarihi).slice(0, 10));
    if (sinir !== null && gunler.every(d => GUN.test(d) && d < sinir)) {
      const gun = gunler.reduce((a, d) => (d > a ? d : a));
      return { ret: { kod: 'FATURA_ETTN_ONCEKI_FATURA', error: `Bu ETTN ${gun} tarihli, talepten (${sinir}) önceki bir faturanın; bu siparişin faturası olamaz` } };
    }
    return {};
  }
  if (yonler.some(y => y === null)) return { uyari: ETTN_AYNA_UYARISI };
  const faturaCarisi = String(satislar[0].cha_kod ?? '').trim();
  return { ret: { kod: 'FATURA_ETTN_BASKA_CARI', error: `Bu ETTN ${faturaCarisi} carisinin faturası; sipariş carisi ${g.cariKod ?? ''}` } };
}

/** `sonuc` yazımının sonucu: başarıda yazılan satır (+ varsa ayna uyarısı ve eski ham ETTN), aksi ret kararı (404 dâhil). */
export type SonucYazimi =
  | { tamam: true; data: Record<string, unknown>; uyari?: string; ettnOnceki?: string }
  | { tamam: false; karar: FaturaRetKarari };

/** ETTN'li `sonuc`un girdisi: anahtar (rota `cetpaEttnAnahtari` ile sınadı) ve kiracının fatura aynasını okuyan işlev. */
export interface EttnGirdisi {
  ettn: string;
  aynaOku: () => Promise<readonly Readonly<Record<string, unknown>>[]>;
}

async function baskaSiparisAdi(b: FaturaBaglami, ettn: string): Promise<string | null> {
  const { rows } = await b.havuz.query(FATURA_ETTN_BASKA_SIPARIS_SQL, [b.id, b.companyId, ettn]);
  const r = rows[0];
  if (!r) return null;
  return typeof r.no === 'string' && r.no.trim() !== '' ? r.no : String(r.id);
}

/** Ayna + başka sipariş kararı; ret ise güncel işaretli 409 kararı. */
async function ettnDenetimi(
  b: FaturaBaglami, o: FaturaOkunan, g: EttnGirdisi,
): Promise<{ ret: FaturaRetKarari } | { uyari?: string }> {
  const isaret = faturaIsareti(o.data);
  const karar = ettnTutarlilikKarari({
    ettn: g.ettn, ...(isaret?.cariKod ? { cariKod: isaret.cariKod } : {}), ...(isaret ? { sinir: talepSiniri(isaret) } : {}),
    aynaSatirlari: await g.aynaOku(), baskaSiparis: await baskaSiparisAdi(b, g.ettn),
  });
  if (karar.ret) return { ret: ret(409, karar.ret.kod, karar.ret.error, isaret) };
  return karar.uyari ? { uyari: karar.uyari } : {};
}

/** D6 `sonuc`. `numara` yalnız `mikrodaVar`'da kullanılır; ETTN verilirse (§ 9.B B2) önce B3 denetimi, yazım danışma kilidi
 *  altında «başka sipariş yok» koşullu biçimle (`ettnKilidiyleYaz`). Tutmazsa ret kararı (404 dâhil). */
export async function faturaSonucunuYaz(
  b: FaturaBaglami, karar: 'mikrodaVar' | 'mikrodaYok', numara?: string, ettnGirdisi?: EttnGirdisi,
): Promise<SonucYazimi> {
  let uyari: string | undefined;
  if (karar === 'mikrodaVar' && ettnGirdisi) {
    const okunan = await yeniden(b);
    if (!okunan) return { tamam: false, karar: { durum: 404, govde: { ...FATURA_BULUNAMADI } } };
    const d = await ettnDenetimi(b, okunan, ettnGirdisi);
    if ('ret' in d) return { tamam: false, karar: d.ret };
    uyari = d.uyari;
  }
  const ettn = karar === 'mikrodaVar' ? ettnGirdisi?.ettn : undefined;
  const varParametreleri = [
    b.id, b.companyId, FATURA_GONDERIM_BAYATLIK_MS,
    JSON.stringify(sonucVarYamasi(numara, ettn)),
    JSON.stringify({ durum: 'gonderildi', ...(numara ? { numara } : {}) }),
  ];
  // ETTN'li biçim danışma kilidi altında (aynı ETTN'yi başka siparişe yazan eşzamanlı istekle sıraya girer); ETTN'siz biçim eskisi.
  const data = karar !== 'mikrodaVar'
    ? await yaz(b, FATURA_SONUC_YOK_SQL, [b.id, b.companyId, FATURA_GONDERIM_BAYATLIK_MS])
    : ettn
      ? await ettnKilidiyleYaz(b, ettn, FATURA_SONUC_VAR_ETTN_SQL, [...varParametreleri, ettn])
      : await yaz(b, FATURA_SONUC_VAR_SQL, varParametreleri);
  if (data) return { tamam: true, data, ...(uyari ? { uyari } : {}) };
  const okunan = await yeniden(b);
  if (!okunan) return { tamam: false, karar: { durum: 404, govde: { ...FATURA_BULUNAMADI } } };
  if (ettn) {
    // Ön denetimden sonra araya giren yazım aynı ETTN'yi başka siparişe yazdıysa (`NOT EXISTS` tuttu) bunu söyle.
    const baska = await baskaSiparisAdi(b, ettn);
    if (baska) return { tamam: false, karar: ret(409, 'FATURA_ETTN_BASKA_SIPARISTE', `Bu ETTN başka bir siparişte kayıtlı: ${baska}`, faturaIsareti(okunan.data)) };
  }
  return { tamam: false, karar: sonucRetKarari(okunan) };
}

// ── § 9.B B2 — «ETTN ekle» ─────────────────────────────────────────────────────────────────────────────────────────────────
/** «ETTN ekle» uygun değil: hangi durumda olduğuna göre ret. Geçerli ETTN → `FATURA_ETTN_VAR`; işaret `gonderildi` değilse mevcut
 *  ret kararları (`belirsiz` / bayat `gonderiliyor` → «sonuç bilinmiyor»; taze `gonderiliyor` → «gönderiliyor»; işaretsiz /
 *  `reddedildi` → «çözülecek sonuç yok»); Mikro faturasından türemiş kayıt → `FATURA_KESILEMEZ`. Uygunsa `null`. */
export function ettnEkleRetKarari(o: FaturaOkunan): FaturaRetKarari | null {
  const isaret = faturaIsareti(o.data);
  if (o.kaynak === MF_KAYNAGI) {
    return ret(400, 'FATURA_KESILEMEZ', 'Bu kayıt Mikro faturasından türetildi — ETTN eklenemez.', isaret, { neden: 'mikro-fatura' });
  }
  if (cetpaEttnAnahtari(o.data.ettn) !== '') return ret(409, 'FATURA_ETTN_VAR', 'Bu siparişin ETTN\'si zaten kayıtlı.', isaret);
  if (isaret?.durum === 'gonderildi') return null;
  if (isaret?.durum === 'belirsiz' || (isaret?.durum === 'gonderiliyor' && o.bayat)) {
    return ret(409, 'FATURA_SONUCU_BILINMIYOR', 'Bu siparişin fatura sonucu bilinmiyor; önce Mikro\'dan kontrol edip kaydı çözün.', isaret);
  }
  if (isaret?.durum === 'gonderiliyor') return ret(409, 'FATURA_GONDERILIYOR', 'Bu siparişin faturası şu an gönderiliyor.', isaret);
  return ret(409, 'FATURA_SONUC_YOK', 'Bu siparişte çözülecek bir fatura sonucu yok.', isaret);
}

/**
 * § 9.B B2 — `gonderildi` ama geçerli ETTN'si olmayan siparişe ETTN yazar (KARŞILAŞTIR-YAZ). Önce okunur ve JS'te sınanır
 * (`ettnEkleRetKarari`: `faturaIsareti(o)?.durum === 'gonderildi'` ve `cetpaEttnAnahtari(o.ettn) === ''`; `hasInvoice` OKUNMAZ),
 * B3 denetimi, sonra danışma kilidi altında `FATURA_ETTN_EKLE_SQL` ($4 = OKUNAN ham değer; `ettnKilidiyleYaz`). 0 satırda yeniden okunup ayrılır: satır yok → 404; geçerli
 * ETTN / durum değişti → `ettnEkleRetKarari`; aynı ETTN başka siparişte → `FATURA_ETTN_BASKA_SIPARISTE`; ham değer araya giren
 * yazımla değişti → `FATURA_ETTN_DEGISTI`.
 */
export async function faturaEttnEkle(b: FaturaBaglami, g: EttnGirdisi): Promise<SonucYazimi> {
  const okunan = await yeniden(b);
  if (!okunan) return { tamam: false, karar: { durum: 404, govde: { ...FATURA_BULUNAMADI } } };
  const uygunDegil = ettnEkleRetKarari(okunan);
  if (uygunDegil) return { tamam: false, karar: uygunDegil };
  const d = await ettnDenetimi(b, okunan, g);
  if ('ret' in d) return { tamam: false, karar: d.ret };
  const data = await ettnKilidiyleYaz(b, g.ettn, FATURA_ETTN_EKLE_SQL, [b.id, b.companyId, g.ettn, okunan.ettnMetin]);
  if (data) {
    const onceki = okunan.ettnMetin !== null && okunan.ettnMetin.trim() !== '' ? okunan.ettnMetin : undefined;
    return { tamam: true, data, ...(d.uyari ? { uyari: d.uyari } : {}), ...(onceki !== undefined ? { ettnOnceki: onceki } : {}) };
  }
  const simdi = await yeniden(b);
  if (!simdi) return { tamam: false, karar: { durum: 404, govde: { ...FATURA_BULUNAMADI } } };
  const durumRet = ettnEkleRetKarari(simdi);
  if (durumRet) return { tamam: false, karar: durumRet };
  const isaret = faturaIsareti(simdi.data);
  const baska = await baskaSiparisAdi(b, g.ettn);
  if (baska) return { tamam: false, karar: ret(409, 'FATURA_ETTN_BASKA_SIPARISTE', `Bu ETTN başka bir siparişte kayıtlı: ${baska}`, isaret) };
  return { tamam: false, karar: ret(409, 'FATURA_ETTN_DEGISTI', 'Kayıt bu arada değişti; yenileyip yeniden deneyin.', isaret) };
}
