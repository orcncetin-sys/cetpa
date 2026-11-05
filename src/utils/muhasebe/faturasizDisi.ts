/**
 * faturasizDisi.ts — Resmî ekranların «faturasız (Q) dâhil değil» SAYACI ve NOT SATIRI. TEK KAYNAK (şartname q-serisi v3 Q9-1,
 * K3; 2026-11-05 Dilim 1).
 *
 * Kural (K3): `f.faturasiz === true` Mikro satırı (giden ∧ seri Q — lib/faturasizSeri) resmî toplama / listeye GİRMEZ: KDV
 * dönemi, Ba-Bs, mizan sentezi, KDV analizi, KDV borcunun Mikro tarafı, Gelir/Gider 600 (Mikro), e-belge süzgeçleri. Her işlev
 * dışladığını KENDİ dönem / yön süzgeciyle sayar ve `faturasizDisi` döndürür; ekran bu modülün notunu basar — sahte kesinlik yok:
 * okuyan, rakamın neden Mikro'dakinden düşük olduğunu görür.
 *
 * Tutarı / KDV'si okunamayan kayıt 0 SAYILMAZ: `Tutar` sayacına bilinmeyen olarak girer, not `ekranTutari` sözleşmesiyle basar.
 */
import { toplaBilinen, ekranTutari, type Tutar } from '../para';
import { paraYaz } from '../currency';

export interface FaturasizDisi {
  /** Dışlanan faturasız (Q) kayıt adedi. */
  adet: number;
  /** Dışlananların meblağı (`tutar`, KDV dâhil). */
  tutar: Tutar;
  /** Dışlananların KDV'si. */
  kdv: Tutar;
  /** Tutarı YA DA KDV'si okunamayan KAYIT adedi (kayıt başına bir kez; `toplaBilinen` ile aynı bilinmezlik tanımı). Notun
   *  «N kayıt tutarsız» sayısı budur — `tutar.bilinmeyen + kdv.bilinmeyen` iki alanı okunamayan tek kaydı iki kez sayardı,
   *  `Math.max` ayrık kümelerde (biri tutarsız, öteki KDV'siz) eksik sayardı. */
  tutarsiz: number;
}

/** Dışlanan kayıtların okuduğu alanlar (`MikroFatura` uyar). */
export interface FaturasizDisiKaydi { tutar?: unknown; kdv?: unknown }

const bos = (): Tutar => ({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
/** `toplaBilinen`in bilinmezlik tanımı (tek kaynak): tek değeri toplamaya sok, bilinmeyen sayıldı mı. */
const bilinmeyenMi = (v: unknown): boolean => toplaBilinen([v], x => x).bilinmeyen > 0;

/** Boş sayaç (dışlanan yok). */
export const faturasizDisiBos = (): FaturasizDisi => ({ adet: 0, tutar: bos(), kdv: bos(), tutarsiz: 0 });

/** Dışlanan kayıtları say. */
export function faturasizDisiSay(liste: readonly FaturasizDisiKaydi[]): FaturasizDisi {
  return {
    adet: liste.length, tutar: toplaBilinen(liste, f => f.tutar), kdv: toplaBilinen(liste, f => f.kdv),
    tutarsiz: liste.filter(f => bilinmeyenMi(f.tutar) || bilinmeyenMi(f.kdv)).length,
  };
}

/** Faturasız satır mı (alan yoksa DEĞİL — eski fikstür / doküman bugünkü sonucu verir). */
export const faturasizMi = (f: { faturasiz?: boolean }): boolean => f.faturasiz === true;

/**
 * Not satırı: «₺5.500,20 faturasız (Q) dâhil değil · 1 kayıt (KDV'si ₺916,70)». KDV bilinen 0 ise parantez YOK; adet 0 → null
 * (satır çizilmez). Tutarı okunamayan kayıt `ekranTutari` ile ('—' ya da kısmi toplam) + «N kayıt tutarsız».
 */
export function faturasizDisiNotu(d: FaturasizDisi | null | undefined, dil: string): string | null {
  if (!d || d.adet <= 0) return null;
  const tr = dil === 'tr';
  const tutar = paraYaz(ekranTutari(d.tutar));
  const kdvSifir = d.kdv.bilinmeyen === 0 && d.kdv.toplam === 0;
  const kdv = kdvSifir ? '' : tr ? ` (KDV'si ${paraYaz(ekranTutari(d.kdv))})` : ` (VAT ${paraYaz(ekranTutari(d.kdv))})`;
  const bilinmeyen = d.tutarsiz;
  const tutarsiz = bilinmeyen > 0 ? (tr ? ` · ${bilinmeyen} kayıt tutarsız` : ` · ${bilinmeyen} records unknown`) : '';
  return tr
    ? `${tutar} faturasız (Q) dâhil değil · ${d.adet} kayıt${kdv}${tutarsiz}`
    : `${tutar} uninvoiced (Q) not included · ${d.adet} record${d.adet === 1 ? '' : 's'}${kdv}${tutarsiz}`;
}
