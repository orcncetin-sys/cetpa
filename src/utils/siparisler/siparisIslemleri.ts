/**
 * siparisIslemleri — sipariş detayındaki işlem düğmelerinin (Düzenle, Sil, Sevkiyat) AÇIK olup olmadığı. TEK kaynak:
 * detay başlığı, liste satırı ve hızlı sevkiyat penceresi aynı kurala bağlanır (bir yüzeyi düzeltip ötekini açık
 * bırakmak bu projenin "yarım düzeltme" sınıfıdır).
 *
 * Neden var (2026-09-25 kullanıcı bildirimleri, MF-383 ekranı):
 *  - "teslim edilen bir şeye tekrar sevkiyat oluşturulamaz" → teslim edilmiş / iptal edilmiş siparişe, ya da zaten
 *    açık sevkiyatı olan siparişe Hızlı Sevkiyat açılmaz.
 *  - Mikro'dan türeyen sipariş (`source` 'mikro…', ör. faturadan türeyen MF-383) Cetpa'da düzenlenmez/silinmez:
 *    gerçeği Mikro'dadır. Yerel düzenleme Mikro'yla çelişir; silinen kayıt bir sonraki "faturadan sipariş"
 *    importunda geri gelir (import mevcut olmayan kimliği yeniden yazar). Düzeltme Mikro'da yapılır.
 *  - "Mikro Siparişleri" sekmesinin satırları (`source:'mikro-siparis'`) sevkiyat AÇMAZ (K-MİKRO-SİPARİŞ, kullanıcı:
 *    "mikroda sipariş oluşturmadan devam ediyoruz, ondan CETPA da oluşuyor"): iş akışında Mikro siparişi yok, fatura
 *    kesilir ve Cetpa siparişi faturadan türer (MF-…). O satırlar `orders`ta DOKÜMAN DEĞİL (Mikro aynasından ekranda
 *    üretilir, durumları yer tutucu 'Pending'); açılan sevkiyat var olmayan bir siparişe bağlanan öksüz kayıt olurdu.
 */
import { mikroTurevi } from '../pano/mikroBirlesim';

export interface IslemSiparisi {
  id: string;
  source?: string;
  status?: string;
}
export interface IslemSevkiyati {
  orderId?: string;
  status?: string;
}

/** Sipariş Cetpa'da düzenlenebilir / silinebilir mi? Mikro kaynaklı kayıtta HAYIR. */
export function yerelDegistirilebilir(o: IslemSiparisi): boolean {
  return !mikroTurevi(o);
}

export type SevkiyatEngeli = 'mikroSiparisi' | 'teslimEdildi' | 'iptal' | 'sevkiyatAcik' | 'sevkiyatTeslim';

/**
 * Bu siparişten yeni sevkiyat açılamamasının NEDENİ; açılabiliyorsa `null`. Aynı siparişe bağlı sevkiyat: yolda /
 * bekleyen → 'sevkiyatAcik'; teslim edilmiş → 'sevkiyatTeslim' (sipariş durumu geride kalmış). İPTAL edilmiş sevkiyat
 * yenisini engellemez. Sipariş durumunu ÇAĞIRAN güncel kayıttan verir (açık pencerenin bayat kopyası değil).
 */
export function sevkiyatEngeli(o: IslemSiparisi, sevkiyatlar: readonly IslemSevkiyati[]): SevkiyatEngeli | null {
  // İLK kontrol: durumu yer tutucu olduğu için ('Pending') aşağıdaki durum kuralları onu hep "açılır" sayardı.
  if (o.source === 'mikro-siparis') return 'mikroSiparisi';
  if (o.status === 'Delivered') return 'teslimEdildi';
  if (o.status === 'Cancelled') return 'iptal';
  const bagli = sevkiyatlar.filter(s => s.orderId === o.id && s.status !== 'Cancelled');
  if (bagli.some(s => s.status !== 'Delivered')) return 'sevkiyatAcik';
  if (bagli.length > 0) return 'sevkiyatTeslim';
  return null;
}

export function sevkiyatEngeliMetni(e: SevkiyatEngeli, dil: string): string {
  const tr = dil === 'tr';
  if (e === 'mikroSiparisi') return tr
    ? "Mikro siparişi — Cetpa'da sevkiyat açılmaz. Sevkiyat, faturadan türeyen Cetpa siparişinden (MF-…) açılır."
    : 'Mikro order — no shipment in Cetpa. Open the shipment from the Cetpa order derived from the invoice (MF-…).';
  if (e === 'teslimEdildi') return tr ? 'Sipariş teslim edilmiş — yeni sevkiyat açılamaz.' : 'Order already delivered — no new shipment.';
  if (e === 'iptal') return tr ? 'İptal edilmiş siparişe sevkiyat açılamaz.' : 'Cancelled order — no shipment.';
  if (e === 'sevkiyatTeslim') return tr ? "Bu siparişin sevkiyatı teslim edilmiş — sipariş durumunu 'Teslim Edildi' yapın." : "This order's shipment was delivered — set the order to Delivered.";
  return tr ? 'Bu siparişin açık bir sevkiyatı zaten var.' : 'This order already has an open shipment.';
}

export function yerelDegistirilemezMetni(dil: string): string {
  return dil === 'tr'
    ? "Mikro'dan gelen kayıt — düzeltme ve silme Mikro'da yapılır (Cetpa'da silinen kayıt bir sonraki importta geri gelir)."
    : 'Record comes from Mikro — edit or delete it in Mikro (a record deleted here returns on the next import).';
}
