/**
 * faturaTani.ts — "Bu fatura Mikro'da iptal oldu, Cetpa'da hâlâ duruyor" (fatura 389, kullanıcı 2026-10-02) sorusunun ÖLÇÜMÜ.
 *
 * Neden ölçüm: canlıda (sema-kesif, 2026-10-02) 708 fatura başlığının HİÇBİRİNDE cha_iptal ≠ 0 yok — yani "iptal" Mikro'da
 * iptal bayrağı olarak durmuyor. İki olasılık ayırt edilmeden kural yazılamaz:
 *   (a) fatura Mikro'dan SİLİNMİŞ → fatura-listesi importu yalnız `cha_iptal <> 0` GUID'lerini süpürür, silinen kaydı HİÇ
 *       görmez; Cetpa kopyası yetim kalır ve ciro/KDV'ye sonsuza dek katılır;
 *   (b) kayıt duruyor, iptal e-belge tarafında (GİB/e-Arşiv iptali) → durum sorgusundan okunur.
 * Bu modül SAF: Cetpa'daki fatura kopyalarını Mikro'nun güncel GUID kümesiyle karşılaştırır. Yazım yok.
 */

export interface CetpaFatura {
  id: string;
  companyId: string | null;
  seri: string | null;
  sira: string | null;
  tip: string | null;
  tarih: string | null;
  meblag: string | null;
  guncelleme: string | null;
}

/** GUID karşılaştırma anahtarı: süslü parantez ve harf büyüklüğü farkı eşleşmeyi bozmasın. */
export const guidAnahtari = (v: unknown): string => String(v ?? '').trim().replace(/^\{|\}$/g, '').toLowerCase();
export const guidBicimli = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(v);
/** Mikro bit kolonu boolean, sayı ya da metin dönebiliyor. */
export const iptalMi = (v: unknown): boolean => v === true || v === 'true' || (v !== false && v !== null && v !== '' && Number(v) > 0);

export interface YetimRaporu {
  cetpaAdet: number;
  mikroAdet: number;
  mikroIptalAdet: number;
  /** Cetpa'da duran ama Mikro'da fatura koşuluna uyan kaydı OLMAYAN kopyalar (silinmiş ya da evrak tipi değişmiş). */
  yetimAdet: number;
  yetim: CetpaFatura[];
  /** Mikro'da iptal bayraklı olduğu hâlde Cetpa'da duranlar (iptal süpürgesi kaçırmış). */
  iptalKalanAdet: number;
  iptalKalan: CetpaFatura[];
  /** Kimliği Mikro GUID'iyle yalnız harf büyüklüğü/parantez farkıyla eşleşenler — süpürge `id = GUID` ile aradığı için kaçırır. */
  yazimFarkiAdet: number;
  /** Mikro'da iptalsiz olup Cetpa'da kopyası olmayan fatura sayısı (import gecikmesi / pencere dışı). */
  cetpadaEksikAdet: number;
  kiracilar: Record<string, number>;
}

const tariheGoreYeni = (a: CetpaFatura, b: CetpaFatura) => String(b.tarih ?? '').localeCompare(String(a.tarih ?? ''));

export function yetimRaporu(
  cetpa: readonly CetpaFatura[], mikro: readonly Readonly<Record<string, unknown>>[], sinir = 50,
): YetimRaporu {
  const mikroDurum = new Map<string, { ham: string; iptal: boolean }>();
  for (const m of mikro) {
    const ham = String(m.guid ?? '');
    const k = guidAnahtari(ham);
    if (k) mikroDurum.set(k, { ham, iptal: iptalMi(m.iptal) });
  }
  const yetim: CetpaFatura[] = [], iptalKalan: CetpaFatura[] = [];
  const kiracilar: Record<string, number> = {};
  const cetpaAnahtarlari = new Set<string>();
  let yazimFarkiAdet = 0;
  for (const c of cetpa) {
    const kiraci = c.companyId || '(etiketsiz)';
    kiracilar[kiraci] = (kiracilar[kiraci] ?? 0) + 1;
    const k = guidAnahtari(c.id);
    cetpaAnahtarlari.add(k);
    const m = mikroDurum.get(k);
    if (!m) { yetim.push(c); continue; }
    if (m.ham !== c.id) yazimFarkiAdet++;
    if (m.iptal) iptalKalan.push(c);
  }
  let cetpadaEksikAdet = 0, mikroIptalAdet = 0;
  for (const [k, m] of mikroDurum) {
    if (m.iptal) mikroIptalAdet++;
    else if (!cetpaAnahtarlari.has(k)) cetpadaEksikAdet++;
  }
  return {
    cetpaAdet: cetpa.length, mikroAdet: mikroDurum.size, mikroIptalAdet,
    yetimAdet: yetim.length, yetim: [...yetim].sort(tariheGoreYeni).slice(0, sinir),
    iptalKalanAdet: iptalKalan.length, iptalKalan: [...iptalKalan].sort(tariheGoreYeni).slice(0, sinir),
    yazimFarkiAdet, cetpadaEksikAdet, kiracilar,
  };
}
