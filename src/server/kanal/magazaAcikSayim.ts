/**
 * magazaAcikSayim.ts — AÇIK mağaza taleplerinin sayımı ve en eski açık talebin kayıt zamanı (dilim 2a, § 6).
 *
 * YAPRAK modül: server.ts'i ve bekçiyi içe aktarmaz. İki tüketicisi var ve ikisi AYNI sorguyu koşturur — sayı ekrandan
 * ekrana ayrışmasın: bekçi (`opsWatchdog` `magaza_talep` ayrıntısının «açık talep» parçası) ve ops özeti
 * (`/api/ops/summary` → `magaza.acik`).
 *
 * AÇIKLIK ÖLÇÜTÜ panel listesiyle (§ 4 `acik` CTE) AYNI sabittir: `MAGAZA_ACIK_SQL` (`magazaDurum.ts`). Aşaması olmayan /
 * bilinmeyen satır AÇIK sayılır, kaybolmaz; kalem teslim işaretleri ve «etiket basıldı» açıklığı DEĞİŞTİRMEZ (açıklık
 * yalnız aşamayla ölçülür — tümü işaretli talep aşaması `teslim` olana kadar açıktır, V6).
 *
 * YAŞ `olusturma` ile ölçülür (`durumZamani` / `bildirim.zaman` / `kalemTeslim[*].zaman` ile DEĞİL): «en eski açık» bir
 * talebin ne zamandır beklediğidir; her aşama ya da kalem yazımında tazelenen bir alan bu süreyi gizlerdi.
 * Karşılaştırma BİLEREK metin (`COLLATE "C"`): `olusturma` `toISOString()` biçiminde yazılır, aynı biçimdeki iki metnin
 * bayt sırası zaman sırasıdır; `::timestamptz` dönüşümü tek bozuk satırda bütün sorguyu düşürürdü (bekçinin sayım
 * sorgusuyla aynı kural). Biçime uymayan / eksik `olusturma` «en eski»ye GİRMEZ (boş dizge ya da '0' bayt sırasında her
 * gerçek zamandan küçük çıkardı) ve ayrı sayılır (`tarihsiz`) — yaşı okunamayan satır sessizce yok sayılmaz.
 *
 * Sütunlar KAPALI kümeden `count(*) FILTER` ile üretilir — `GROUP BY` YOK: dokümandaki hiçbir metin (bilinmeyen bir
 * `durum` değeri, ad, telefon) yanıta geçemez. Kiracı süzgeci yok (bekçinin sayımıyla aynı evren; koleksiyon yalnız
 * sunucu kiracısına yazılır).
 */
import { MAGAZA_ACIK_ASAMALAR, MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_UTC_ZAMAN_DESENI } from '../../lib/magazaTalep.js';
import type { MagazaAcikAsama } from '../../lib/magazaTalep.js';
import { MAGAZA_ACIK_SQL } from './magazaDurum.js';

/**
 * `olusturma` sunucunun yazdığı biçimde mi (`toISOString()`). Desen PostgreSQL'e AYNEN gider; ters bölü YOK (`[.]`,
 * `[0-9]`): şablon dizgesi ters bölüyü yutardı. Bekçinin «pencereden eski» kanıtındaki desenle AYNI metindir (çit:
 * opsWatchdog.magazaTalep.test.ts) ve `MAGAZA_UTC_ZAMAN_DESENI` ile aynı dili tanır.
 */
const OLUSTURMA_BICIMLI_SQL = `(data->>'olusturma') COLLATE "C" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'`;

const ACIK_ASAMA_LISTESI_SQL = MAGAZA_ACIK_ASAMALAR.map(a => `'${a}'`).join(', ');

/**
 * $1 koleksiyon. Tek satır döner (açık talep yoksa sayılar 0, `en_eski` NULL).
 * `asama_<a>` dört açık aşama; `asama_bilinmiyor` = açık olup aşaması bu dördünden biri OLMAYAN satır (alan yok, `null`,
 * kümede olmayan değer). Beşinin toplamı `acik`e eşittir (tek ifade, tek anlık görüntü).
 */
export const MAGAZA_ACIK_SAYIM_SQL = `SELECT count(*)::int AS acik,
  ${MAGAZA_ACIK_ASAMALAR.map(a => `(count(*) FILTER (WHERE data->>'durum' = '${a}'))::int AS asama_${a}`).join(',\n  ')},
  (count(*) FILTER (WHERE COALESCE(data->>'durum', '') NOT IN (${ACIK_ASAMA_LISTESI_SQL})))::int AS asama_bilinmiyor,
  (count(*) FILTER (WHERE NOT COALESCE(${OLUSTURMA_BICIMLI_SQL}, false)))::int AS tarihsiz,
  min((data->>'olusturma') COLLATE "C") FILTER (WHERE ${OLUSTURMA_BICIMLI_SQL}) AS en_eski
  FROM docs WHERE coll = $1 AND ${MAGAZA_ACIK_SQL}`;

export type MagazaAcikSayimAsamasi = MagazaAcikAsama | 'bilinmiyor';

export interface MagazaAcikSayimi {
  /** Açık talep sayısı: aşaması `teslim` / `iptal` OLMAYAN her satır. */
  toplam: number;
  /** Açık taleplerin aşamaya göre dağılımı; `bilinmiyor` = aşaması olmayan ya da kapalı kümede bulunmayan satır. */
  asama: Record<MagazaAcikSayimAsamasi, number>;
  /** `olusturma`sı sunucu biçiminde OLMAYAN açık talep sayısı (yaşı okunamaz; `enEski`ye girmez). */
  tarihsiz: number;
  /** En eski açık talebin `olusturma`sı (ISO-8601 UTC); açık talep yoksa ya da hiçbirinin tarihi okunamıyorsa `null`. */
  enEski: string | null;
}

/** Sayım hücresi: eksi olmayan tam sayı; başka her şey BİLİNMİYOR (`null`) — sıfır DEĞİL. */
const tamSayi = (satir: Record<string, unknown>, ad: string): number | null => {
  const v = satir[ad];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
};

/**
 * Sorgu satırını sayıma çevirir (saf). Satır yoksa, bir sayı okunamıyorsa ya da `en_eski` beklenen biçimde değilse
 * `null` — uydurma sıfır / uydurma tarih yok. Satırdan YALNIZ bilinen sütunlar alınır.
 */
export function magazaAcikSayiminiCoz(satir: unknown): MagazaAcikSayimi | null {
  if (typeof satir !== 'object' || satir === null || Array.isArray(satir)) return null;
  const s = satir as Record<string, unknown>;
  const toplam = tamSayi(s, 'acik');
  const tarihsiz = tamSayi(s, 'tarihsiz');
  const bilinmiyor = tamSayi(s, 'asama_bilinmiyor');
  if (toplam === null || tarihsiz === null || bilinmiyor === null) return null;
  const asama = { bilinmiyor } as Record<MagazaAcikSayimAsamasi, number>;
  for (const a of MAGAZA_ACIK_ASAMALAR) {
    const n = tamSayi(s, `asama_${a}`);
    if (n === null) return null;
    asama[a] = n;
  }
  const hamEnEski = s.en_eski;
  if (hamEnEski !== null && hamEnEski !== undefined && !(typeof hamEnEski === 'string' && MAGAZA_UTC_ZAMAN_DESENI.test(hamEnEski))) return null;
  return { toplam, asama, tarihsiz, enEski: typeof hamEnEski === 'string' ? hamEnEski : null };
}

/**
 * Sayımı okur. Sorgu hatası FIRLATILIR (çağıran hata KODUNU ayrıntıya yazar; ileti yazılmaz — pg hata iletisi JSON
 * verisinden parça taşıyabilir); okunamayan satır `null`.
 */
export async function magazaAcikSayimi(
  havuz: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
): Promise<MagazaAcikSayimi | null> {
  const { rows } = await havuz.query(MAGAZA_ACIK_SAYIM_SQL, [MAGAZA_TALEP_KOLEKSIYONU]);
  return magazaAcikSayiminiCoz(Array.isArray(rows) ? rows[0] : undefined);
}

const DAKIKA_MS = 60_000;
const SAAT_MS = 60 * DAKIKA_MS;
const GUN_MS = 24 * SAAT_MS;

/**
 * Yaş metni (saf): 1 saatten kısa → «N dk», 48 saatten kısa → «N sa», sonrası «N gün» (aşağı yuvarlanır — «3 gün»
 * en az üç tam gündür). Sonlu olmayan değer «—»; eksi değer (saat kayması) 0 sayılır.
 */
export function magazaYasMetni(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const sure = Math.max(0, ms);
  if (sure < SAAT_MS) return `${Math.floor(sure / DAKIKA_MS)} dk`;
  if (sure < 2 * GUN_MS) return `${Math.floor(sure / SAAT_MS)} sa`;
  return `${Math.floor(sure / GUN_MS)} gün`;
}
