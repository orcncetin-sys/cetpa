/**
 * magazaBildirimSayim.ts — mağaza talebi bildirimlerinin son N gündeki sayımı (ops özeti; K7, 2026-10-09).
 *
 * YAPRAK modül: server.ts'i içe aktarmaz. Sütunlar KAPALI kümelerden `count(*) FILTER` ile üretilir — `GROUP BY`
 * YOK, böylece dokümandaki hiçbir metin (ad, telefon, hata metni) yanıta geçemez. Kiracı süzgeci yok (bekçiyle aynı
 * evren; koleksiyon yalnız sunucu kiracısına yazılır). Okunan satırdan yalnız bilinen sütunlar, yalnız tam sayı olarak alınır.
 */
import { MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_TALEP_KOLEKSIYONU } from '../../lib/magazaTalep.js';
import type { MagazaBildirimDurumu, MagazaBildirimHataSinifi } from '../../lib/magazaTalep.js';

export const MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN = 7;
/** Bildirim durumlarının kapalı kümesi (tip sözleşmeyle kilitli). */
export const MAGAZA_BILDIRIM_DURUMLARI = ['bekliyor', 'gitti', 'gonderilemedi', 'yapilandirilmamis'] as const satisfies readonly MagazaBildirimDurumu[];

const sutunAdi = (s: string): string => s.replace(/-/g, '_');

export const MAGAZA_BILDIRIM_SAYIM_SQL = `SELECT count(*)::int AS toplam,
  ${MAGAZA_BILDIRIM_DURUMLARI.map(d => `(count(*) FILTER (WHERE data->'bildirim'->>'durum' = '${d}'))::int AS durum_${d}`).join(',\n  ')},
  ${MAGAZA_BILDIRIM_HATA_SINIFLARI.map(s => `(count(*) FILTER (WHERE data->'bildirim'->>'hataSinifi' = '${s}'))::int AS sinif_${sutunAdi(s)}`).join(',\n  ')}
  FROM docs WHERE coll = $1 AND (data->>'olusturma') COLLATE "C" >= $2`;

export interface MagazaBildirimSayimi {
  toplam: number;
  durum: Record<MagazaBildirimDurumu, number>;
  hataSinifi: Record<MagazaBildirimHataSinifi, number>;
}

const tamSayi = (satir: unknown, ad: string): number | null => {
  if (typeof satir !== 'object' || satir === null) return null;
  const v = (satir as Record<string, unknown>)[ad];
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
};

/** Sayım; satır yoksa ya da bir sütun okunamazsa `null` (uydurma sıfır yok). Fırlatmaz — hata da `null`. */
export async function magazaBildirimSayimi(
  havuz: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  simdiMs: number,
): Promise<MagazaBildirimSayimi | null> {
  try {
    const { rows } = await havuz.query(MAGAZA_BILDIRIM_SAYIM_SQL, [MAGAZA_TALEP_KOLEKSIYONU, new Date(simdiMs - MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN * 24 * 60 * 60 * 1000).toISOString()]);
    const satir: unknown = Array.isArray(rows) ? rows[0] : undefined;
    const toplam = tamSayi(satir, 'toplam');
    if (toplam === null) return null;
    const durum = {} as Record<MagazaBildirimDurumu, number>;
    for (const d of MAGAZA_BILDIRIM_DURUMLARI) { const n = tamSayi(satir, `durum_${d}`); if (n === null) return null; durum[d] = n; }
    const hataSinifi = {} as Record<MagazaBildirimHataSinifi, number>;
    for (const s of MAGAZA_BILDIRIM_HATA_SINIFLARI) { const n = tamSayi(satir, `sinif_${sutunAdi(s)}`); if (n === null) return null; hataSinifi[s] = n; }
    return { toplam, durum, hataSinifi };
  } catch {
    return null;
  }
}
