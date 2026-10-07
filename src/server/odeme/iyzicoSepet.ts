/**
 * iyzicoSepet.ts — iyzico ödeme başlatma gövdesindeki `basketItems`. Saf (2026-10-07).
 *
 * iyzico `price` = Σ `basketItems[].price` ister (kuruşu kuruşuna); tutmazsa ödeme sayfası hiç oluşmaz.
 * Sipariş kaleminin `price`'ı KDV HARİÇ net birimdir (pencereden açılan ve Mikro faturasından türeyen siparişte), ödenecek
 * tutar (`totalPrice`) ise KDV DÂHİLDİR — faturalı siparişte kalem kırılımı tutarı TUTMAZ (250 × 12 = 3.000'e karşı 3.600).
 * Kural: kalem kırılımı YALNIZ tutarı kuruşu kuruşuna tutuyorsa gönderilir; tutmuyorsa tek kalem = ödenecek tutar.
 * Kırılımı "tutturmak" için kaleme KDV ya da fark yedirilmez (müşterinin ödeme sayfasında uydurma satır tutarı olurdu).
 */
import { kurusaYuvarla } from '../../utils/para.js';

export interface IyzicoSepetKalemi { id: string; name: string; category1: 'B2B'; itemType: 'PHYSICAL'; price: string }
export interface SepetGirdisi { name?: unknown; price?: unknown; qty?: unknown }

/** Tutarın kuruş değeri — pencereyle AYNI yuvarlama (utils/para.kurusaYuvarla; düz `Math.round(n × 100)` 1,115 gibi yarım
 *  kuruşlu tutarda `toFixed(2)`'den farklı yöne yuvarlar ve sepet ile gövdenin `price` alanı 1 kuruş ayrışırdı). */
const kurus = (n: number): number => Math.round(kurusaYuvarla(n) * 100);
/** Gövdenin `price` / `paidPrice` metni — sepetle AYNI kuruş değerinden. */
export const iyzicoTutarMetni = (n: number): string => (kurus(n) / 100).toFixed(2);

export function iyzicoSepeti(orderId: string, amount: number, kalemler: readonly SepetGirdisi[] | null | undefined): IyzicoSepetKalemi[] {
  const tekKalem: IyzicoSepetKalemi[] = [{ id: orderId, name: 'Sipariş', category1: 'B2B', itemType: 'PHYSICAL', price: iyzicoTutarMetni(amount) }];
  if (!Array.isArray(kalemler) || kalemler.length === 0) return tekKalem;
  const kirilim: IyzicoSepetKalemi[] = [];
  let toplamKurus = 0;
  for (const [i, k] of kalemler.entries()) {
    // Miktar verilmemişse 1 (uç sözleşmesi: `qty?`); fiyatı / adı bilinmeyen ya da pozitif olmayan satır kırılımı geçersiz kılar.
    const miktar = k.qty === undefined ? 1 : k.qty;
    if (typeof k.price !== 'number' || !Number.isFinite(k.price) || typeof miktar !== 'number' || !Number.isFinite(miktar)) return tekKalem;
    const satirKurus = kurus(k.price * miktar);
    if (satirKurus <= 0 || typeof k.name !== 'string' || k.name.trim() === '') return tekKalem;
    toplamKurus += satirKurus;
    kirilim.push({ id: `item-${i}`, name: k.name, category1: 'B2B', itemType: 'PHYSICAL', price: (satirKurus / 100).toFixed(2) });
  }
  return toplamKurus === kurus(amount) ? kirilim : tekKalem;
}
