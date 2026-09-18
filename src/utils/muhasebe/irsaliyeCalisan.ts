/**
 * irsaliyeCalisan.ts — AccountingModule'ün 13 grupluk workflow'unun DIŞINDA kalan üç küçük yüzeyin hesap
 * katmanı (Faz 3 2/n kapanış ölçüsü, 2026-09-18). Test: irsaliyeCalisan.test.ts (önce yazıldı).
 *
 * NEDEN VAR — kapanış ölçüsünün (`grep -nE "(\|\||\?\?)\s*0\b"`) bulduğu son siteler:
 *   • İrsaliye formu  `total: w.total || 0` (Giden/GelenIrsaliyeTab 103-104) + `saveWaybill` `{ ...waybillForm }`:
 *     modal toplamı kalemlerden HESAPLAYIP salt-okunur gösteriyor ama forma hiç yazmıyordu — yeni irsaliye
 *     hep `total: 0` ile kaydediliyor, liste `w.total ? … : '—'` süzgeciyle '—' basıyordu (toplam hiç görünmedi).
 *   • İrsaliye kalemi `quantity: Number(e.target.value)` — boşaltılan alan 0/NaN; 'Tamamlandı' irsaliyede bu
 *     değer `warehouseItems.quantity`'ye YAZILIYOR (stok entegrasyonu) → NaN stok.
 *   • Çalışan formu   `salary: e.salary || 0` + `{ ...employeeForm }` — maaşı bilinmeyen çalışan, yalnız
 *     telefonu düzeltilip kaydedilince `salary: 0` oluyordu (MusterilerTab:177 ile aynı yarım-düzeltme sınıfı).
 *   • Depo kalemi     `Number(bd[depoNo] ?? 0)` — anahtar yoksa GERÇEK 0 (ürün o depoda yok; depoDeger.ts
 *     başlığı). Ama anahtar VAR ve sayı okunamıyorsa `NaN > 0` false → kalem depodan SESSİZCE düşüyordu.
 *
 * KURAL (CLAUDE.md): bilinmeyen sayı 0 değildir. Türetilen toplam eksik girdiyle hesaplanmaz (`null` —
 * para.ts `tamTutar` sözleşmesi); form alanında boş = bilinmiyor; bilinmeyen alan DB'ye yazılmaz (mevcut
 * değeri ezmez).
 */
import { bilinenSayi } from '../para';

export interface IrsaliyeKalemi { quantity?: unknown; unitPrice?: unknown; taxRate?: unknown }

/**
 * İrsaliyenin KDV dâhil toplamı. Sayfa paritesi: Σ miktar × birim fiyat × (1 + KDV/100).
 * Kalemsiz irsaliyenin ya da bir kalemi (miktar / fiyat / KDV oranı) bilinmeyen irsaliyenin toplamı
 * TÜRETİLEMEZ → null; çağıran `total` alanını hiç yazmaz, liste '—' gösterir.
 */
export function irsaliyeToplami(kalemler: readonly IrsaliyeKalemi[]): number | null {
  if (!kalemler.length) return null;
  let toplam = 0;
  for (const k of kalemler) {
    if (!bilinenSayi(k.quantity) || !bilinenSayi(k.unitPrice) || !bilinenSayi(k.taxRate)) return null;
    toplam += Number(k.quantity) * Number(k.unitPrice) * (1 + Number(k.taxRate) / 100);
  }
  return toplam;
}

/** Miktarı okunamayan kalem sayısı — > 0 ise irsaliye KAYDEDİLMEZ (stok entegrasyonu o miktarı depoya yazar). */
export function adediBilinmeyenKalem(kalemler: readonly IrsaliyeKalemi[]): number {
  return kalemler.filter(k => !bilinenSayi(k.quantity)).length;
}

/**
 * Mikro ürününün verilen depodaki miktarı (`depoBreakdown[depoNo]`).
 * Anahtar yok → ürün o depoda YOK: gerçek 0. Anahtar var ama sayı okunamıyor → NaN (bilinmiyor): çağıran
 * kalemi listede TUTAR, adet '—' görünür ve `depoToplamlari` onu "bilinmeyen" sayar.
 */
export function depodakiAdet(dagilim: Readonly<Record<string, unknown>> | null | undefined, depoNo: string | null): number {
  if (!dagilim || !depoNo || !(depoNo in dagilim)) return 0;
  const ham = dagilim[depoNo];
  return bilinenSayi(ham) ? Number(ham) : NaN;
}

/** Sayı girdisi → form değeri: boş / okunamayan = null (bilinmiyor). `Number('') === 0` tuzağının tek çıkışı. */
export function formSayisi(ham: unknown): number | null {
  return bilinenSayi(ham) ? Number(ham) : null;
}

/**
 * Kullanıcının GİRDİĞİ sayı alanının (maaş, kredi limiti, bakiye) kayıt yaması.
 *   • bilinen değer → `{ alan: değer }`
 *   • boş + önceki değer de bilinmiyor / yeni kayıt → `{}` (alan hiç yazılmaz: sahte ₺0 yok, mevcut değer ezilmez)
 *   • boş + önceki değer BİLİNİYOR → `{ alan: null }` — kullanıcı bilerek sildi. `updateDoc` sunucuda PATCH-merge
 *     (pgShim.mergeDocData) olduğundan alanı yamaya KOYMAMAK eski değeri korur: silme sessiz no-op olur ama
 *     "güncellendi" bildirimi çıkar (2026-09-19 kapanış incelemesi). dbClient `deleteField` desteklemez;
 *     DB'de `null` = bilinmiyor (CLAUDE.md: okuyan taraf null'u da bilinmeyen sayar).
 */
export function girilenAlanYamasi<K extends string>(alan: K, yeni: number | null, onceki: unknown): Partial<Record<K, number | null>> {
  const yama: Partial<Record<K, number | null>> = {};
  if (yeni !== null) yama[alan] = yeni;
  else if (bilinenSayi(onceki)) yama[alan] = null;
  return yama;
}

/**
 * İrsaliye `total` yaması. `total` GİRİLEN değil TÜRETİLEN alandır: girdileri (kalemler) değişip türetilemez
 * hâle gelince eski türev YANLIŞ olur — bu yüzden düzenlemede türetilemeyen toplam açıkça `null` yazılır
 * (girilen alanlardaki "mevcut değeri ezme" kuralı burada geçerli DEĞİL). Yeni kayıtta alan hiç yazılmaz.
 */
export function irsaliyeToplamYamasi(kalemler: readonly IrsaliyeKalemi[], duzenleme: boolean): { total?: number | null } {
  const toplam = irsaliyeToplami(kalemler);
  if (toplam !== null) return { total: toplam };
  return duzenleme ? { total: null } : {};
}

/**
 * Liste hücresi ile sıralayıcının ORTAK "gösterilebilir tutar" tanımı: bilinen ve sıfırdan farklı sayı; 0 ve
 * bilinmeyen → null ('—'). Eski kayıtlar sahte sıfır taşıyor (her irsaliye `total: 0`, maaşsız çalışan
 * `salary: 0` kaydediliyordu); hücre 0'ı zaten '—' basıyordu — sıralayıcı 0'ı bilinen sayıp '—' satırlarını
 * ikiye bölmesin diye ikisi de buradan geçer.
 */
export function gorunenTutar(x: unknown): number | null {
  return bilinenSayi(x) && Number(x) !== 0 ? Number(x) : null;
}

/**
 * Kayıt kapısı: sıfırdan büyük, bilinen sayı mı? Bütçe tutarı / çek tutarı / transfer miktarı formlarında
 * boşaltılan sayı alanı `Number('') === 0` üretiyor ve kayıt işlevleri doğrulamasız `{ ...form }` yazıyordu:
 * ₺0 bütçe hedefi, ₺0 çek, 0 adetlik depo transferi (Mikro'ya giden evrakın girdisi) sessizce kaydediliyordu.
 */
export function pozitifSayi(x: unknown): boolean {
  return bilinenSayi(x) && Number(x) > 0;
}
