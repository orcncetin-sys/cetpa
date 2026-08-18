/**
 * huni.ts — Satış hunisi aşama hesabı (tek kaynak).
 *
 * Mikro'dan içeri alınan adayların tamamı `status: 'New'` ile geliyor; huni
 * yalnız `status`'a bakınca 206 adayın hepsi tek kutuya yığılıyor, diğer üç
 * aşama hep 0 görünüyordu (2026-08-18 bildirimi). Kullanıcı aşamanın adayın
 * YAŞINDAN türetilmesini tanımladı:
 *
 *     0-30 gün → Yeni · 30-60 gün → Nitelikli · 60-90 gün → İrtibat
 *     90+ gün  → Kapandı
 *
 * ELLE ATANAN DURUM HER ZAMAN KAZANIR: bir aday açıkça işaretlendiyse yaş onu
 * EZMEZ — aksi halde 5 günlükken elle "Kapandı" yapılan aday ertesi gün
 * "Yeni"ye geri düşerdi. Yaş yalnız hiç dokunulmamış (status yok ya da 'New')
 * adaylar için devreye girer.
 *
 * Bu dosya CRMPage'den AYRI tutuldu ki eşikler testle kilitlenebilsin
 * (huni.test.ts) — CRMPage 4000+ satırlık bir bileşen, testten import edilemez.
 */

export type HuniAsamasi = 'New' | 'Contacted' | 'Qualified' | 'Closed';

/**
 * Lead.status 8 değer alabilir ama huni 4 kutu gösterir. Bu eşleme her durumu
 * TAM OLARAK bir kutuya düşürür — eskiden Proposal/Negotiation/Closed Won/
 * Closed Lost hiçbir kutuya düşmüyor, sessizce sayılmıyordu.
 */
export const HUNI_ASAMASI: Record<string, HuniAsamasi> = {
  New: 'New', Contacted: 'Contacted', Qualified: 'Qualified',
  Proposal: 'Qualified', Negotiation: 'Qualified',
  Closed: 'Closed', 'Closed Won': 'Closed', 'Closed Lost': 'Closed',
};

/** Gün cinsinden eşikler. Değiştirilirse huni.test.ts da güncellenmeli. */
export const HUNI_ESIK_GUN = { nitelikli: 30, irtibat: 60, kapandi: 90 } as const;

/** Firestore Timestamp | ISO string | number | Date → bugüne kadar geçen gün. */
export function adayYasiGun(v: unknown, simdi: number = Date.now()): number | null {
  if (!v) return null;
  try {
    const d = (v as { toDate?: () => Date }).toDate?.() ?? new Date(v as string | number | Date);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.floor((simdi - ms) / 86_400_000);
  } catch {
    return null;
  }
}

export function huniAsamasi(
  lead: { status?: string; createdAt?: unknown },
  simdi: number = Date.now(),
): HuniAsamasi {
  const s = lead.status;
  if (s && s !== 'New' && HUNI_ASAMASI[s]) return HUNI_ASAMASI[s];

  const gun = adayYasiGun(lead.createdAt, simdi);
  // Tarihi okunamayan aday 'Yeni' kalır — uydurma bir aşamaya atmaktansa
  // en zararsız kutuda dursun.
  if (gun === null) return 'New';
  if (gun < HUNI_ESIK_GUN.nitelikli) return 'New';
  if (gun < HUNI_ESIK_GUN.irtibat) return 'Qualified';
  if (gun < HUNI_ESIK_GUN.kapandi) return 'Contacted';
  return 'Closed';
}
