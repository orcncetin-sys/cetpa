/**
 * siparis.ts — Sipariş alanlarının KAYNAK-BAĞIMSIZ okunması. TEK KAYNAK.
 *
 * NEDEN VAR (2026-09-03, kullanıcı SS'li bildirimi + 8-açılı code review):
 * `orders` koleksiyonu artık ÜÇ farklı üreticiden besleniyor ve her biri
 * farklı alan adları yazıyor:
 *
 *   1. Shopify aynası      → `shopifyOrderId`, `syncedAt`
 *   2. Cetpa-native/AddOrder → `orderNumber`, `createdAt`
 *   3. Mikro satış faturasından türetme (POST /api/mikro/import/faturadan-siparis)
 *                          → `orderNumber: MF-<seri><sıra>`, `createdAt`, `orderDate`,
 *                            `source: 'mikro-fatura'` — ve `paid` alanı HİÇ YOK
 *
 * UI'ın 15+ yüzeyi yalnız (1)'in alanlarını okuyordu: 355 türetilmiş siparişte
 * başlık "Order undefined", tarih "Bilinmeyen Tarih" görünüyordu; daha kötüsü
 * `!o.paid` toplamları ₺17,6M'lik SAHTE bir "Alacak Toplam" ve 355 kayıtlık
 * yaşlandırma alarmı üretiyordu.
 *
 * TAHSİLAT SEMANTİĞİ — `odemeTakipli` neden var:
 * Bir Mikro satış faturasından türetilen sipariş, tahsilatın yapılıp yapılmadığı
 * hakkında HİÇBİR ŞEY bilmez; o gerçek Mikro cari hareketlerinde yaşar. Bu yüzden
 * bu kayıtlarda `paid` alanının yokluğu "ödenmedi" DEĞİL, "bilinmiyor"dur —
 * CLAUDE.md'nin "sahte kesinlik gösterme" kuralı. Alacak/yaşlandırma/hatırlatma
 * gibi tahsilat yüzeyleri bu süzgeçten geçmeli.
 */
import { zamanDate } from './zaman';
import { bilinenSayi } from './para';

/**
 * TİPLER YAPISAL, `Order`'a BAĞLI DEĞİL (2026-09-04): bazı bileşenler
 * (ör. FinancePanel, AnalyticsPanel) kendi daraltılmış yerel `Order` arayüzünü
 * tanımlıyor. Bu yardımcılar kanonik tipi şart koşarsa o çağrı yerlerinde
 * derlenmiyorlar ve düzeltme "yalnız bazı ekranlarda" uygulanabiliyor — yarım
 * düzeltme sınıfının ta kendisi. Bu yüzden her fonksiyon GERÇEKTEN OKUDUĞU
 * alanları ister; hem kanonik `Order` hem yerel türevler yapısal olarak uyar.
 */
export interface SiparisNoAlanlari {
  id?: string;
  orderNumber?: string;
  shopifyOrderId?: string | number;
}
export interface SiparisTarihAlanlari {
  syncedAt?: unknown;
  createdAt?: unknown;
  orderDate?: unknown;
}
export interface SiparisKaynakAlani {
  source?: string;
}
export interface SiparisTutarAlanlari {
  totalPrice?: unknown;
  totalAmount?: unknown;
}

/** Listede/başlıkta gösterilecek sipariş numarası — üreticiden bağımsız. */
export function gorunenSiparisNo(o: SiparisNoAlanlari): string {
  const no = o.orderNumber || (o.shopifyOrderId != null ? String(o.shopifyOrderId) : '');
  if (no) return no;
  return o.id ? `#${o.id.slice(-6)}` : '—';
}

/**
 * Siparişin tarihi; çözülemezse null (asla "bugün"e düşmez — bkz. zaman.ts).
 * Sıra: Shopify `syncedAt` → native `createdAt` → türetme `orderDate`.
 */
export function siparisTarih(o: SiparisTarihAlanlari): Date | null {
  return zamanDate(o.syncedAt) ?? zamanDate(o.createdAt) ?? zamanDate(o.orderDate);
}

/** Sıralama için epoch ms; tarihi bilinmeyen kayıt EN SONA düşsün diye -Infinity. */
export function siparisTarihMs(o: SiparisTarihAlanlari): number {
  const d = siparisTarih(o);
  return d ? d.getTime() : -Infinity;
}

/**
 * Bu siparişin ödeme durumu Cetpa'da mı izleniyor?
 * false → tahsilat gerçeği Mikro cari hesapta; `paid` alanına bakma.
 */
export function odemeTakipli(o: SiparisKaynakAlani): boolean {
  // 'mikro' ÖNEKİ, yalnız 'mikro-fatura' DEĞİL (Faz 1 3/n incelemesi): Siparişler → Mikro
  // sekmesi `mappedMikroSiparisler`'i (source:'mikro-siparis') aynı yüzeylere veriyor; eski
  // eşitlik kontrolü onları "takipli" sayıp CSV'de 'Bekliyor' yazıyordu. Mikro kaynaklı
  // HİÇBİR kaydın tahsilatı Cetpa'da izlenmez — gerçeği Mikro cari hesapta yaşar.
  return !(o.source ?? '').startsWith('mikro');
}

/**
 * Sipariş İPTAL mi — TEK tanım (K2 "iptal hariç"; inceleme 2026-09-25). Mikro'da faturası iptal edilen MF siparişi de
 * 'Cancelled' olur (faturadan-sipariş importu); iptal edilen sipariş satış DEĞİLDİR, ciro/adet toplamlarına girmez.
 */
export function siparisIptalMi(o: { status?: unknown }): boolean {
  return o.status === 'Cancelled';
}

/**
 * Siparişin tutarı: `totalPrice ?? totalAmount`; ikisi de bilinmiyorsa NaN (ASLA 0).
 * TEK KAYNAK (Faz 3 1/n hakem turu, 2026-09-13): nakitBilanco (`||` önceliği) ve mutabakatMasraf
 * (`??` önceliği) aynı PR'da iki farklı kopya taşıyordu — {totalPrice: 0, totalAmount: 500} siparişi
 * Bilanço'ya +500, e-Mutabakat'a +0 giriyordu. Sunucuyla aynı `??` semantiği (server.ts 2883/3157
 * `Number(o.totalPrice ?? o.totalAmount ?? 0)` — oradaki son `?? 0` sahte sıfırdır, burada YOK):
 * meşru 0 tutar 0 KALIR, totalAmount'a düşmez. Sayısal string kabul (bilinenSayi).
 */
export function siparisTutari(o: SiparisTutarAlanlari): number {
  if (bilinenSayi(o.totalPrice)) return Number(o.totalPrice);
  if (bilinenSayi(o.totalAmount)) return Number(o.totalAmount);
  return NaN;
}
