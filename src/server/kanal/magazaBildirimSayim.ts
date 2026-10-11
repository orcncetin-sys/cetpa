/**
 * magazaBildirimSayim.ts — mağaza talebi bildirimlerinin son N gündeki sayımı (ops özeti; K7, 2026-10-09).
 *
 * YAPRAK modül: server.ts'i içe aktarmaz. Sütunlar KAPALI kümelerden `count(*) FILTER` ile üretilir — `GROUP BY`
 * YOK, böylece dokümandaki hiçbir metin (ad, telefon, hata metni) yanıta geçemez. Kiracı süzgeci yok (bekçiyle aynı
 * evren; koleksiyon yalnız sunucu kiracısına yazılır). Okunan satırdan yalnız bilinen sütunlar, yalnız tam sayı olarak alınır.
 *
 * İKİ BİLDİRİM, İKİ PENCERE (dilim 2b, şartname § 10.7 (b)): aynı sorgu iki alanı sayar ve her alan KENDİ zamanıyla süzülür.
 *  • İlk bildirim (`bildirim`): talebin `olusturma`sı pencerede. `toplam` / `durum_<d>` / `sinif_<s>` sütunlarının anlamı
 *    dilim 1'dekiyle AYNIDIR (sayılar değişmez).
 *  • Revize bildirimi (`bildirimRevize`): talebin `icerikZamani` pencerede — `revize_durum_<d>` / `revize_sinif_<s>`.
 *    Yaş `olusturma`dan ölçülseydi iki hafta önce gelip dün revize edilen talebin gitmeyen revize bildirimi özette HİÇ
 *    görünmezdi; `bildirimRevize.zaman`dan ölçülseydi işçinin her yeniden denemesi satırı pencerede tutardı (bekçinin
 *    revize yaşıyla aynı dayanak: `opsWatchdog.ts` `magazaTalepSayimSql`).
 *    REVİZE SINIF SÜTUNLARI yalnız durumu GİTMEMİŞ ve hata sınıfı TAŞIYABİLEN belgeleri sayar (`bekliyor` / `gonderilemedi`
 *    — `HATA_SINIFI_TASIYAN_DURUMLAR`; inceleme 2b, bulgu 7): işçinin revize yazımı nesneyi bütünüyle DEĞİŞTİRMEZ
 *    (`REVIZE_YAZ_SQL`: `(data->'bildirimRevize') || …`), yeniden denemeyle GİTMİŞ bildirimde önceki denemenin `hataSinifi`
 *    kalıntısı durur. Durum koşulu olmasaydı gitmiş posta özette hata sayılırdı. İlk bildirimin sınıf sütunları bu koşulu
 *    taşımaz: `YAZ_SQL` nesneyi bütünüyle değiştirir, kalıntı oluşmaz (dilim 1 anlamı aynen).
 * Satır kümesi iki pencerenin BİRLEŞİMİDİR (`WHERE … OR …`); her sütun kendi penceresini `FILTER` içinde yeniden söyler.
 */
import { MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_TALEP_KOLEKSIYONU } from '../../lib/magazaTalep.js';
import type { MagazaBildirimDurumu, MagazaBildirimHataSinifi } from '../../lib/magazaTalep.js';

export const MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN = 7;
/** Bildirim durumlarının kapalı kümesi (tip sözleşmeyle kilitli). TEK tanım: bekçi de buradan içe aktarır (kopyalanmaz). */
export const MAGAZA_BILDIRIM_DURUMLARI = ['bekliyor', 'gitti', 'gonderilemedi', 'yapilandirilmamis'] as const satisfies readonly MagazaBildirimDurumu[];

/**
 * İşçinin `hataSinifi` YAZDIĞI durumlar (geçici hata → `bekliyor` + `deneme`; kalıcı hata → `gonderilemedi`). Revize sınıf
 * sütunları yalnız bunlarda sayar: `gitti` ve `yapilandirilmamis` belgedeki `hataSinifi` önceki denemenin KALINTISIDIR
 * (birleştiren yazım onu silmez). `<> 'gitti'` DEĞİL adlı küme: yeniden deneme sırasında ayar eksilirse
 * `yapilandirilmamis` yazımı da kalıntıyı bırakır. Tip kapalı kümeye kilitlidir (yanlış yazılan durum derlenmez).
 */
const HATA_SINIFI_TASIYAN_DURUMLAR = ['bekliyor', 'gonderilemedi'] as const satisfies readonly MagazaBildirimDurumu[];
const HATA_SINIFI_TASIYAN_SQL = `data->'bildirimRevize'->>'durum' IN (${HATA_SINIFI_TASIYAN_DURUMLAR.map(d => `'${d}'`).join(', ')})`;

const sutunAdi = (s: string): string => s.replace(/-/g, '_');

/** Talep pencerede mi ($2 = pencerenin başı): ilk bildirim `olusturma`, revize `icerikZamani` ile. Metin karşılaştırması (`COLLATE "C"`). */
const ILK_PENCEREDE_SQL = `(data->>'olusturma') COLLATE "C" >= $2`;
const REVIZE_PENCEREDE_SQL = `(data->>'icerikZamani') COLLATE "C" >= $2`;

export const MAGAZA_BILDIRIM_SAYIM_SQL = `SELECT (count(*) FILTER (WHERE ${ILK_PENCEREDE_SQL}))::int AS toplam,
  ${MAGAZA_BILDIRIM_DURUMLARI.map(d => `(count(*) FILTER (WHERE ${ILK_PENCEREDE_SQL} AND data->'bildirim'->>'durum' = '${d}'))::int AS durum_${d}`).join(',\n  ')},
  ${MAGAZA_BILDIRIM_HATA_SINIFLARI.map(s => `(count(*) FILTER (WHERE ${ILK_PENCEREDE_SQL} AND data->'bildirim'->>'hataSinifi' = '${s}'))::int AS sinif_${sutunAdi(s)}`).join(',\n  ')},
  ${MAGAZA_BILDIRIM_DURUMLARI.map(d => `(count(*) FILTER (WHERE ${REVIZE_PENCEREDE_SQL} AND data->'bildirimRevize'->>'durum' = '${d}'))::int AS revize_durum_${d}`).join(',\n  ')},
  ${MAGAZA_BILDIRIM_HATA_SINIFLARI.map(s => `(count(*) FILTER (WHERE ${REVIZE_PENCEREDE_SQL} AND ${HATA_SINIFI_TASIYAN_SQL} AND data->'bildirimRevize'->>'hataSinifi' = '${s}'))::int AS revize_sinif_${sutunAdi(s)}`).join(',\n  ')}
  FROM docs WHERE coll = $1 AND (${ILK_PENCEREDE_SQL} OR ${REVIZE_PENCEREDE_SQL})`;

export interface MagazaBildirimSayimi {
  /** Pencerede OLUŞTURULAN talep sayısı (ilk bildirimin evreni). */
  toplam: number;
  durum: Record<MagazaBildirimDurumu, number>;
  hataSinifi: Record<MagazaBildirimHataSinifi, number>;
  /** (2b) Pencerede REVİZE EDİLEN taleplerin revize bildirimi (`bildirimRevize`); ilk bildirim sayılarına KARIŞMAZ. */
  revize: { durum: Record<MagazaBildirimDurumu, number>; hataSinifi: Record<MagazaBildirimHataSinifi, number> };
}

const tamSayi = (satir: unknown, ad: string): number | null => {
  if (typeof satir !== 'object' || satir === null) return null;
  const v = (satir as Record<string, unknown>)[ad];
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
};

/** Bir alanın iki sayım kümesi (`<onEk>durum_<d>` / `<onEk>sinif_<s>`); TEK sütun okunamazsa `null` (uydurma sıfır yok). */
function alanSayimi(satir: unknown, onEk: '' | 'revize_'): { durum: Record<MagazaBildirimDurumu, number>; hataSinifi: Record<MagazaBildirimHataSinifi, number> } | null {
  const durum = {} as Record<MagazaBildirimDurumu, number>;
  for (const d of MAGAZA_BILDIRIM_DURUMLARI) { const n = tamSayi(satir, `${onEk}durum_${d}`); if (n === null) return null; durum[d] = n; }
  const hataSinifi = {} as Record<MagazaBildirimHataSinifi, number>;
  for (const s of MAGAZA_BILDIRIM_HATA_SINIFLARI) { const n = tamSayi(satir, `${onEk}sinif_${sutunAdi(s)}`); if (n === null) return null; hataSinifi[s] = n; }
  return { durum, hataSinifi };
}

/** Sayım; satır yoksa ya da bir sütun (revize sütunları dâhil) okunamazsa `null` (uydurma sıfır yok). Fırlatmaz — hata da `null`. */
export async function magazaBildirimSayimi(
  havuz: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  simdiMs: number,
): Promise<MagazaBildirimSayimi | null> {
  try {
    const { rows } = await havuz.query(MAGAZA_BILDIRIM_SAYIM_SQL, [MAGAZA_TALEP_KOLEKSIYONU, new Date(simdiMs - MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN * 24 * 60 * 60 * 1000).toISOString()]);
    const satir: unknown = Array.isArray(rows) ? rows[0] : undefined;
    const toplam = tamSayi(satir, 'toplam');
    if (toplam === null) return null;
    const ilk = alanSayimi(satir, '');
    const revize = alanSayimi(satir, 'revize_');
    if (ilk === null || revize === null) return null;
    return { toplam, durum: ilk.durum, hataSinifi: ilk.hataSinifi, revize };
  } catch {
    return null;
  }
}
