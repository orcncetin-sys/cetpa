/**
 * abonelik.ts — abonelik (tekrarlayan sipariş) gelirinin TEK kaynağı: MRR / ARR. Faz 3 6/n, 2026-09-19.
 * Test: abonelik.test.ts (ÖNCE yazıldı).
 *
 * ## Neden var
 * Aynı şablonlar ÜÇ sitede ÜÇ ayrı katsayıyla yıllıklaştırılıyordu (HEAD 46c53a8'de ölçüldü):
 *   - `GenelOzet.tsx:130,154`       haftalık ×4/ay  (= ×48/yıl)
 *   - `LojistikRapor.tsx:1082,1089` haftalık ×52/yıl (aylık ×12, üç aylık ×4)
 *   - `LojistikRapor.tsx:1277-1283` `freqMult = {weekly: 4.33, monthly: 1, quarterly: 0.333}` (= ×51,96/yıl)
 *     ve tanınmayan frekansa `|| 1` uydurması.
 * Aynı müşteri üç ekranda üç farklı ARR görüyordu. Ayrıca `GenelOzet:129`daki korumasız `reduce`,
 * tutarı bilinmeyen TEK şablon yüzünden MRR'yi ve ARR'yi birlikte NaN ('—') yapıyor, nedenini yazmıyordu.
 *
 * ## KULLANICI KARARI K19 (KARARLAR.md, BAĞLAYICI) — kullanıcının cümlesi:
 *   "Daha satışa başlamadık ama önerin ok."
 * → Haftalık şablonun aylık karşılığı 52 ÷ 12 (4 DEĞİL); sıklığı bilinmeyen şablon toplanmaz, SAYILIR.
 * Abonelik satışı henüz YOK → panel düşük öncelikli; boş veriyle doğru davranması yeter.
 *
 * ## Parite
 * Aylık ve üç aylık şablonlarda rakam eski `GenelOzet` koduyla BİREBİR.
 * BİLİNÇLİ FARK: haftalık şablonun aylık tutarı ×4 → ×4,3333 (+%8,33 = 52/48) — K19 kararı.
 * `ARR = MRR × 12` olduğundan yıllık çarpanlar 52 / 12 / 4, yani `LojistikRapor.tsx:1082`nin
 * tamsayılarıyla AYNI sonuç: iki ekran 6k'da tek ARR'de buluşur.
 *
 * ## Sözleşme
 * `mrr` EKRAN toplamıdır (kısmi olabilir; yanına "N şablon tutarsız" notu konur), `arr` ise TÜRETMEdir:
 * tek şablon bile bilinmiyorsa hesaplanmaz (NaN → '—'). Yuvarlama burada YOK (bağlama `fmtAna` yapar).
 */
import { toplaBilinen, tamTutar, bilinenSayi, type Tutar } from '../para';

/**
 * Tek katsayı tablosu — frekansın aylık karşılığı.
 * KARAR K19 — kullanıcı: "Daha satışa başlamadık ama önerin ok." → haftalık = 52 ÷ 12 (4 değil).
 * (Yıllık karşılıkları ×12 ile: haftalık 52, aylık 12, üç aylık 4.)
 * Modül içi: dışa açılması için gerçek bir tüketici beklenir (JIT); 6a'da GenelOzet yalnız
 * `tekrarlayanGelir` + `sablonAylikTutari` içe aktarıyor.
 */
const AYLIK_KARSILIK: Readonly<Record<'weekly' | 'monthly' | 'quarterly', number>> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
};

/**
 * Frekansın aylık çarpanı; tanınmayan / boş frekans → null (×1 UYDURULMAZ — `LojistikRapor:1280`
 * `|| 1` ve `GenelOzet:130` üçlüsünün `else` dalı bunu "aylık" sayıyordu).
 * Arama ÜÇ AÇIK KARŞILAŞTIRMA ile: `TABLO[frekans]` kalıbı `'constructor'` / `'toString'` gibi
 * prototip anahtarlarında zincirden değer (fonksiyon) çeker. Eşleşme BİREBİR — yazıcı yüzey
 * (`OrdersPage.tsx:266` form) sabit küçük harf yazar, `'Weekly'` katlanmaz.
 */
function aylikKarsilik(frekans: unknown): number | null {
  if (frekans === 'weekly') return AYLIK_KARSILIK.weekly;
  if (frekans === 'monthly') return AYLIK_KARSILIK.monthly;
  if (frekans === 'quarterly') return AYLIK_KARSILIK.quarterly;
  return null;
}

/** Bir şablonun aylık tutarı; tutar YA DA frekans bilinmiyorsa NaN (0 değil — "bilinmiyor"). */
export function sablonAylikTutari(r: { totalPrice?: unknown; frequency?: unknown }): number {
  const katsayi = aylikKarsilik(r.frequency);
  if (katsayi === null) return NaN;
  if (!bilinenSayi(r.totalPrice)) return NaN;
  return Number(r.totalPrice) * katsayi;
}

export interface TekrarlayanGelir {
  /** Σ aylık tutar — EKRAN toplamı (kısmi olabilir). */
  mrr: Tutar;
  /** `tamTutar(mrr) × 12` — TÜRETME: tek şablon bile bilinmiyorsa NaN ('—'). */
  arr: number;
  /** `mrr.bilinmeyen`in kırılımı (ikisinin toplamı = `mrr.bilinmeyen`, çift sayım YOK). */
  tutarsiz: number;
  bilinmeyenFrekans: number;
  aktif: number;
}

/**
 * Aktif şablonlardan MRR/ARR. Yalnız `active` TRUTHY şablonlar — bugünkü `filter(r => r.active)`
 * ile birebir parite (kesin `=== true` DEĞİL: `active: 1` gibi eski kayıt sessizce düşmesin).
 * Tutarı DA frekansı DA bilinmeyen şablon TEK sayaçta (`bilinmeyenFrekans`) sayılır.
 */
export function tekrarlayanGelir(
  sablonlar: readonly { totalPrice?: unknown; frequency?: unknown; active?: unknown }[],
): TekrarlayanGelir {
  const aktifler = sablonlar.filter(r => Boolean(r.active));
  let tutarsiz = 0;
  let bilinmeyenFrekans = 0;
  for (const r of aktifler) {
    if (aylikKarsilik(r.frequency) === null) bilinmeyenFrekans++;
    else if (!bilinenSayi(r.totalPrice)) tutarsiz++;
  }
  const mrr = toplaBilinen(aktifler, sablonAylikTutari);
  return { mrr, arr: tamTutar(mrr) * 12, tutarsiz, bilinmeyenFrekans, aktif: aktifler.length };
}
