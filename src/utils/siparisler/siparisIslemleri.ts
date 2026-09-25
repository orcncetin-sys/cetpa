/**
 * siparisIslemleri — sipariş detayındaki işlem düğmelerinin (Düzenle, Sil, Sevkiyat) AÇIK olup olmadığı. TEK kaynak:
 * detay başlığı, liste satırı ve hızlı sevkiyat penceresi aynı kurala bağlanır (bir yüzeyi düzeltip ötekini açık
 * bırakmak bu projenin "yarım düzeltme" sınıfıdır).
 *
 * Neden var (2026-09-25 kullanıcı bildirimleri, MF-383 ekranı):
 *  - "teslim edilen bir şeye tekrar sevkiyat oluşturulamaz" → teslim edilmiş / iptal edilmiş siparişe, ya da zaten
 *    açık sevkiyatı olan siparişe Hızlı Sevkiyat açılmaz.
 *  - Mikro'dan türeyen sipariş (`source` 'mikro…', ör. faturadan türeyen MF-383) Cetpa'da DÜZENLENMEZ: gerçeği
 *    Mikro'dadır, yerel düzenleme Mikro'yla çelişir; düzeltme Mikro'da yapılır. SİLME ayrı kural (`silmeYolu`,
 *    K-MF-SİL): MF sunucu ucundan silinir ve bir sonraki "faturadan sipariş" importunda "silinmişti" notuyla döner.
 *  - "Mikro Siparişleri" sekmesinin satırları (`source:'mikro-siparis'`) sevkiyat AÇMAZ (K-MİKRO-SİPARİŞ, kullanıcı:
 *    "mikroda sipariş oluşturmadan devam ediyoruz, ondan CETPA da oluşuyor"): iş akışında Mikro siparişi yok, fatura
 *    kesilir ve Cetpa siparişi faturadan türer (MF-…). O satırlar `orders`ta DOKÜMAN DEĞİL (Mikro aynasından ekranda
 *    üretilir, durumları yer tutucu 'Pending'); açılan sevkiyat var olmayan bir siparişe bağlanan öksüz kayıt olurdu.
 */
import { mikroTurevi } from '../pano/mikroBirlesim';
import { isAllowed, type AppRole } from '../../lib/rbac';

export interface IslemSiparisi {
  id: string;
  source?: string;
  status?: string;
}
export interface IslemSevkiyati {
  orderId?: string;
  status?: string;
}

/** Sipariş Cetpa'da DÜZENLENEBİLİR mi? Mikro kaynaklı kayıtta HAYIR. Silme için `silmeYolu`. */
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
    ? "Mikro'dan gelen kayıt Cetpa'da düzenlenmez — düzeltme Mikro'da yapılır."
    : 'Record comes from Mikro and cannot be edited here — correct it in Mikro.';
}

export type SilmeYolu = 'yerel' | 'mikroSunucu' | 'yok';

/**
 * Siparişin SİLME yolu — düzenleme kilidinden AYRI (K-MF-SİL, kullanıcı 2026-09-25: "sildiğim tekrar gelsin ama yanına
 * not düşsün silinmişti diye"; şartname kapısı C3). native → yerel silme; faturadan türeyen MF (`source:'mikro-fatura'`)
 * → sunucu ucu (mezar kaydı; bir sonraki "Faturadan Sipariş Türet"te notla geri gelir); "Mikro Siparişleri" sözde
 * satırı (`'mikro-siparis'`, orders'ta doküman DEĞİL) ve diğer Mikro kaynakları → silinemez.
 */
export function silmeYolu(o: IslemSiparisi): SilmeYolu {
  if (o.source === 'mikro-fatura') return 'mikroSunucu';
  return yerelDegistirilebilir(o) ? 'yerel' : 'yok';
}

export function mikroSilOnayMetni(dil: string): string {
  return dil === 'tr'
    ? "Bu sipariş Mikro faturasından geliyor. Silerseniz bir sonraki \"Faturadan Sipariş Türet\" çalışmasında \"silinmişti\" notuyla GERİ GELİR (Mikro'daki fatura değişmez). Silinsin mi?"
    : 'This order comes from a Mikro invoice. If deleted, it RETURNS with a "was deleted" note on the next "Derive Orders from Invoices" run (the Mikro invoice is unchanged). Delete?';
}

export function mikroSilindiMetni(dil: string): string {
  return dil === 'tr' ? "Sipariş silindi — Mikro'dan yeniden gelirse \"silinmişti\" notuyla gelir." : 'Order deleted — if it returns from Mikro it will carry a "was deleted" note.';
}

/**
 * Liste satırındaki NOT göstergesinin metni — sistem notu (K-MF-SİL: "silinmişti — geri geldi") + iç not; ikisi de
 * yoksa '' (gösterge çizilmez). TEK kaynak: Siparişler ve CRM listesi aynı kuralı okur (inceleme 2026-09-25: CRM
 * göstergesi yalnız `notes`a bakıyordu — geri gelen siparişin izi CRM'de görünmüyordu).
 */
export function siparisNotMetni(o: { notes?: unknown; sistemNotu?: unknown }): string {
  return [o.sistemNotu, o.notes].filter((x): x is string => typeof x === 'string' && x.trim() !== '').join('\n');
}

export function silinemezMetni(dil: string): string {
  return dil === 'tr' ? "Mikro sipariş satırı Cetpa'da silinmez — Mikro'dan okunur." : 'Mikro order row cannot be deleted here — it is read from Mikro.';
}

export function silmeYetkisiYokMetni(dil: string): string {
  return dil === 'tr' ? 'Sipariş silme yetkiniz yok — Yönetici/Müdür gerekir.' : 'You are not allowed to delete orders — Admin/Manager required.';
}

/**
 * Sil düğmesi/işleyicisi için TEK engel kuralı: silinemiyorsa GEREKÇE metni, silinebiliyorsa null. Kayıt kaynağı
 * (`silmeYolu` 'yok') + ROL: sunucu sipariş silmeyi yalnız Admin/Manager'a açar (rbac `op === 'delete'`; hem /api/db
 * hem /api/mikro/siparis/sil). Eskiden Satış/Lojistik düğmeyi basabiliyor, yerel silmenin 403'ü yalnız konsola
 * düşüyor ve detay paneli kapanıyordu — kullanıcı silindi sanıyordu (delta inceleme 2026-09-25).
 */
export function silmeEngelMetni(o: IslemSiparisi, rol: string | null | undefined, dil: string): string | null {
  if (silmeYolu(o) === 'yok') return silinemezMetni(dil);
  if (!isAllowed((rol ?? null) as AppRole | null, 'orders', 'delete')) return silmeYetkisiYokMetni(dil);
  return null;
}

/** MFA 403'ünün (`mfaRequired`) talimatlı metni — yerel silme (dbClient) ve MF silme (mikroSiparisSil) AYNI metni basar. */
export function mfaGerekliMetni(dil: string): string {
  return dil === 'tr' ? 'İki faktörlü doğrulama gerekli — sayfayı yenileyip kodu girin.' : 'Two-factor verification required — reload the page and enter your code.';
}

/**
 * Silme isteği başarısız olunca kullanıcıya gösterilen metin. dbClient hatası sunucu gövdesini taşır
 * (`… → 403 {"error":…,"mfaRequired":true}`). 403'ün NEDENİ ayrılır (delta inceleme 2026-09-25): rol ön denetimden
 * zaten geçtiği için buraya düşen 403 çoğu kez MFA'dır (5 günlük çerez düşmüş / MFA başka cihazda açılmış) — Admin'e
 * "Yönetici/Müdür gerekir" demek asıl yapılacak işi gizler. Kiracı uyuşmazlığı vb. rol belirtmeyen yetki metni alır.
 */
export function silmeHataMetni(hata: unknown, dil: string): string {
  const m = hata instanceof Error ? hata.message : String(hata ?? '');
  const tr = dil === 'tr';
  if (/\b403\b/.test(m)) {
    if (/mfaRequired/.test(m)) return mfaGerekliMetni(dil);
    return tr ? 'Bu işlem için yetkiniz yok.' : 'You are not allowed to do this.';
  }
  return tr ? 'Sipariş silinemedi — tekrar deneyin.' : 'Could not delete the order — try again.';
}
