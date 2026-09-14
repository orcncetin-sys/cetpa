/**
 * finansalOranlar.ts — Muhasebe → Finansal Oranlar (Phase 132) hesapları. SAF, TEK KAYNAK.
 * Faz 3 1/n (2026-09-13). Test: finansalOranlar.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR: MuhasebePage'in Phase 132 paneli beş yerde bilinmeyen tutarı 0 sayıyordu —
 *   `o.totalPrice || 0` (ciro, alacak), `li.costPrice ?? 0` (COGS), `po.totalAmount || 0` (borç),
 *   `(i.stockLevel ?? 0) * (prices.Retail ?? price ?? 0)` (stok değeri).
 * Sonuç: Mikro'dan gelmemiş tutar / fiyatı girilmemiş ürün / maliyeti olmayan kalem sessizce
 * cari oranı, DSO'yu ve marjı "kesin" bir sayıya çeviriyordu. Kural (CLAUDE.md, Faz 1):
 * bilinmeyen sayı 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR (`bilinmeyen`), oran
 * bilinen kısımdan hesaplanır ve ekran `bilinmeyen > 0` iken '—' + "N kayıt tutarsız" der.
 *
 * Formüller sayfadakiyle BİREBİR (dışlama kuralları dahil); yalnız `|| 0`/`?? 0` kalktı.
 * Yardımcılar kopyalanmadı: para.ts (toplaBilinen/satirTutari/bilinenSayi/siparisMaliyeti), siparis.ts (odemeTakipli).
 * Bu panelde kur çevirimi ve tarih hesabı YOK (hepsi TRY; yıl süzgeci sayfada, hook düzeyinde).
 */
import { bilinenSayi, toplaBilinen, satirTutari, siparisMaliyeti } from '../para';
import { odemeTakipli } from '../siparis';

// ── Minimal yerel girdi arayüzleri (Order/InventoryItem tiplerine bağımlı DEĞİL) ──
export interface MikroFaturaBenzeri { yon?: string; tutar?: unknown }
export interface SiparisKalemiBenzeri { costPrice?: unknown; quantity?: unknown }
export interface SiparisBenzeri {
  totalPrice?: unknown; paid?: boolean; status?: string; source?: string;
  lineItems?: readonly SiparisKalemiBenzeri[];
}
export interface SatinAlmaBenzeri { supplier?: string; totalAmount?: unknown; status?: string }
export interface EnvanterBenzeri { name?: string; stockLevel?: unknown; price?: unknown; prices?: Record<string, unknown> }

export interface Toplam { toplam: number; bilinen: number; bilinmeyen: number }
/** Oran: bilinen kısımdan hesaplanan değer (payda 0 / girdi yok → null) + o orana giren tutarsız kayıt sayısı. */
export interface Oran { deger: number | null; bilinmeyen: number }

const IPTAL = 'Cancelled';
/** Sayfadaki gibi: kapanmış (teslim alınmış / iptal) satın alma siparişi borç değildir. */
const KAPALI_SATINALMA = new Set(['Teslim Alındı', 'İptal Edildi']);

/** Mikro GİDEN (satış) faturaları cirosu — sayfa bu yılın faturalarını verir. */
export function mikroCiro(faturalar: readonly MikroFaturaBenzeri[]): Toplam {
  return toplaBilinen(faturalar.filter(f => f.yon === 'giden'), f => f.tutar);
}

/**
 * Cetpa sipariş cirosu. İptal ve `source:'mikro-fatura'` dışlanır (2026-09-01 çift sayım
 * koruması: o siparişler mikroCiro'daki faturalardan türetilmiş). Dışlama sayfadakiyle aynı —
 * 'mikro-siparis' burada DAHİL (sayfa öyle sayıyor; değiştirmek ürün kararı).
 */
export function cetpaCiro(siparisler: readonly SiparisBenzeri[]): Toplam {
  return toplaBilinen(siparisler.filter(o => o.status !== IPTAL && o.source !== 'mikro-fatura'), o => o.totalPrice);
}

/**
 * COGS = iptal olmayan siparişlerin satır maliyeti (para.ts `siparisMaliyeti`: Σ costPrice × quantity).
 * SİPARİŞ sayılır: satırı olmayan ya da herhangi bir satırı bilinmeyen iptal-dışı sipariş BİLİNMİYOR'dur
 * (0 katkı değil) — karZarar Phase 143 P&L / Başabaş ile AYNI kural; aynı `orders` verisiyle 132 "%X marj"
 * basarken 143 "N siparişin maliyeti bilinmiyor" diyemez (2026-09-13 hakem: TEK KAYNAK + yarım düzeltme).
 * `biliniyor`: hiç maliyet girilmemişse (toplam 0) false — Mikro faturasında satır maliyeti yok,
 * Mikro-only kurulumda yanıltıcı %100 marj YAZILMAZ (sayfadaki `cetpaCOGS > 0` koruması korunur).
 */
export function cetpaMaliyet(siparisler: readonly SiparisBenzeri[]): Toplam & { biliniyor: boolean } {
  const t = toplaBilinen(siparisler.filter(o => o.status !== IPTAL), siparisMaliyeti);
  return { ...t, biliniyor: t.toplam > 0 };
}

/** Cetpa alacağı: ödenmemiş, iptal olmayan, ödemesi Cetpa'da izlenen (Mikro kaynaklı DEĞİL) siparişler. */
export function cetpaAlacak(siparisler: readonly SiparisBenzeri[]): Toplam {
  return toplaBilinen(siparisler.filter(o => !o.paid && o.status !== IPTAL && odemeTakipli(o)), o => o.totalPrice);
}

/** Cetpa borcu: açık satın alma siparişleri. */
export function cetpaBorc(satinAlma: readonly SatinAlmaBenzeri[]): Toplam {
  return toplaBilinen(satinAlma.filter(po => !KAPALI_SATINALMA.has(po.status ?? '')), po => po.totalAmount);
}

/**
 * Stok değeri = stockLevel × (prices.Retail ?? price). Stok ya da fiyat bilinmiyorsa ürün
 * tutarsız sayılır. İstisna: bilinen 0 stok → değer 0, fiyat gerekmez (0 × x = 0 tahmin değildir;
 * fiyatsız ama stoksuz eski kalemler "tutarsız" sayacını şişirmesin).
 */
export function stokDegeri(envanter: readonly EnvanterBenzeri[]): Toplam {
  return toplaBilinen(envanter, i => {
    if (bilinenSayi(i.stockLevel) && Number(i.stockLevel) === 0) return 0;
    const fiyat = bilinenSayi(i.prices?.['Retail']) ? i.prices?.['Retail'] : i.price;
    return satirTutari(fiyat, i.stockLevel);
  });
}

/** Mikro cari bakiyeleri: pozitif = müşteri borçlu (AR), eksi = Cetpa borçlu (AP). 0 ikisine de girmez. */
export function cariBakiyeToplamlari(bakiyeler: readonly unknown[]): { ar: number; ap: number; bilinen: number; bilinmeyen: number } {
  let ar = 0, ap = 0, bilinen = 0, bilinmeyen = 0;
  for (const b of bakiyeler) {
    if (!bilinenSayi(b)) { bilinmeyen++; continue; }
    const n = Number(b); bilinen++;
    if (n > 0) ar += n; else if (n < 0) ap += -n;
  }
  return { ar, ap, bilinen, bilinmeyen };
}

export interface FinansalOranGirdisi {
  /** Bu yılın Mikro faturaları (yön süzgeci burada yapılır). */
  mikroFaturalar: readonly MikroFaturaBenzeri[];
  siparisler: readonly SiparisBenzeri[];
  satinAlmaSiparisleri: readonly SatinAlmaBenzeri[];
  envanter: readonly EnvanterBenzeri[];
  /** Mikro cari bakiye toplamları (cariBakiyeToplamlari çıktısı; `bilinmeyen` isteğe bağlı). */
  cariBakiye: { ar: number; ap: number; bilinmeyen?: number };
}

export interface FinansalOranSonucu {
  ciro: { toplam: number; mikro: number; cetpa: number; bilinmeyen: number };
  cogs: Toplam & { biliniyor: boolean };
  /** Ciro − COGS; COGS bilinmiyorsa null. */
  brutKar: number | null;
  alacak: { toplam: number; mikro: number; cetpa: number; bilinmeyen: number };
  borc: { toplam: number; mikro: number; cetpa: number; bilinmeyen: number };
  stokDegeri: Toplam;
  oranlar: {
    /** % — COGS bilinmiyor ya da ciro 0 → null. */
    brutKarMarji: Oran;
    /** (Alacak + stok) / Borç — borç 0 → null. */
    cariOran: Oran;
    /** Ciro / Alacak — alacak 0 → null. */
    alacakDevirHizi: Oran;
    /** Gün — ciro 0 → null. */
    dso: Oran;
    /** COGS / stok değeri — COGS bilinmiyor ya da stok 0 → null. */
    stokDevirHizi: Oran;
  };
}

/** Phase 132 panelinin tüm hesabı — sayfadaki formüllerle birebir, `|| 0` yok. */
export function finansalOranlar(g: FinansalOranGirdisi): FinansalOranSonucu {
  const mikro = mikroCiro(g.mikroFaturalar);
  const cetpa = cetpaCiro(g.siparisler);
  const cogs = cetpaMaliyet(g.siparisler);
  const alacakCetpa = cetpaAlacak(g.siparisler);
  const borcCetpa = cetpaBorc(g.satinAlmaSiparisleri);
  const stok = stokDegeri(g.envanter);
  // Sayaç (tutarsız cari kaydı ADEDİ), tutar değil — eski `{ar, ap}` state'i vermezse "bildirilen tutarsız yok".
  const { bilinmeyen: cariBilinmeyen = 0 } = g.cariBakiye;

  const ciro = { toplam: mikro.toplam + cetpa.toplam, mikro: mikro.toplam, cetpa: cetpa.toplam, bilinmeyen: mikro.bilinmeyen + cetpa.bilinmeyen };
  const alacak = { toplam: g.cariBakiye.ar + alacakCetpa.toplam, mikro: g.cariBakiye.ar, cetpa: alacakCetpa.toplam, bilinmeyen: alacakCetpa.bilinmeyen };
  const borc = { toplam: g.cariBakiye.ap + borcCetpa.toplam, mikro: g.cariBakiye.ap, cetpa: borcCetpa.toplam, bilinmeyen: borcCetpa.bilinmeyen };
  const brutKar = cogs.biliniyor ? ciro.toplam - cogs.toplam : null;
  const donenVarliklar = alacak.toplam + stok.toplam;

  return {
    ciro, cogs, brutKar, alacak, borc, stokDegeri: stok,
    oranlar: {
      brutKarMarji: { deger: brutKar !== null && ciro.toplam > 0 ? (brutKar / ciro.toplam) * 100 : null, bilinmeyen: ciro.bilinmeyen + cogs.bilinmeyen },
      cariOran: { deger: borc.toplam > 0 ? donenVarliklar / borc.toplam : null, bilinmeyen: alacak.bilinmeyen + stok.bilinmeyen + borc.bilinmeyen + cariBilinmeyen },
      alacakDevirHizi: { deger: alacak.toplam > 0 ? ciro.toplam / alacak.toplam : null, bilinmeyen: ciro.bilinmeyen + alacak.bilinmeyen + cariBilinmeyen },
      dso: { deger: ciro.toplam > 0 ? (alacak.toplam / ciro.toplam) * 365 : null, bilinmeyen: ciro.bilinmeyen + alacak.bilinmeyen + cariBilinmeyen },
      stokDevirHizi: { deger: cogs.biliniyor && stok.toplam > 0 ? cogs.toplam / stok.toplam : null, bilinmeyen: cogs.bilinmeyen + stok.bilinmeyen },
    },
  };
}
