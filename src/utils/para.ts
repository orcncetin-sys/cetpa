/**
 * para.ts — para matematiği TEK KAYNAK (Faz 1 4/n, 2026-09-05). Test: para.test.ts (önce yazıldı).
 *
 * NEDEN VAR: Faz 0 haritası para/KDV hesabını 7 dosyada elle, PDF'te 14 `|| 0`, `kdvOran || 20`
 * sahte oran, QuotationDetail'de `/1.2` sabit buldu. Kural (CLAUDE.md "sahte kesinlik gösterme"):
 * bilinmeyen sayı 0 DEĞİL bilinmiyordur — toplama girmez, sayılır, ekranda/PDF'te '—' olur;
 * KDV oranı bilinmiyorsa %20 varsayılmaz. Bu modül o kararı tek yerde uygular.
 */

/** Bilinen sonlu sayı mı? null/undefined/''/'abc'/NaN/Infinity → false. Sayısal string kabul. */
export function bilinenSayi(x: unknown): x is number | string {
  if (typeof x === 'number') return Number.isFinite(x);
  if (typeof x === 'string' && x.trim() !== '') return Number.isFinite(Number(x));
  return false;
}
const sayi = (x: unknown): number => (bilinenSayi(x) ? Number(x) : NaN);

/** PDF/CSV tutar metni: '1.234,56 TL' — bilinmiyorsa '—' (eskiden `|| 0` ile '0,00'). */
export function tutarYaz(x: unknown, birim: string): string {
  const n = sayi(x);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${birim}`;
}

/**
 * Brüt tutardan net + KDV. Oran ya da brüt bilinmiyorsa null — `kdvOran || 20` ve `/1.2`
 * gibi varsayımlar müşteriye giden belgede yanlış KDV kırılımı basıyordu.
 */
export function kdvAyristir(brut: unknown, oran: unknown): { net: number; kdv: number } | null {
  const b = sayi(brut), o = sayi(oran);
  if (!Number.isFinite(b) || !Number.isFinite(o) || o < 0) return null;
  const net = b / (1 + o / 100);
  return { net, kdv: b - net };
}

/** Fiyat × miktar; biri bilinmiyorsa NaN (`null * 4 === 0` tuzağı yok). */
export function satirTutari(fiyat: unknown, miktar: unknown): number {
  const f = sayi(fiyat), m = sayi(miktar);
  return Number.isFinite(f) && Number.isFinite(m) ? f * m : NaN;
}

/** `toplaBilinen`in dönüşü: bilinen toplam + bilinen/bilinmeyen sayaçları. */
export interface Tutar { toplam: number; bilinen: number; bilinmeyen: number }

/** Bilinen değerleri toplar; bilinmeyenleri SAYAR (UI "n kaydın tutarı bilinmiyor" der). */
export function toplaBilinen<T>(liste: readonly T[], sec: (o: T) => unknown): Tutar {
  let toplam = 0, bilinen = 0, bilinmeyen = 0;
  for (const o of liste) { const n = sayi(sec(o)); if (Number.isFinite(n)) { toplam += n; bilinen++; } else bilinmeyen++; }
  return { toplam, bilinen, bilinmeyen };
}

/**
 * Ekrana giden sayı — TEK SÖZLEŞME (Faz 3 hakem turu, 2026-09-14): HİÇ bilinen yokken ama bilinmeyen
 * varken NaN (paraYaz/tlYaz → '—'); aksi hâlde bilinen KISMİ toplam — `bilinmeyen > 0` ise sayfa yanına
 * "N kayıt tutarsız" notu koyar (CLAUDE.md: '—' VEYA açık not). Boş liste gerçek 0.
 * Eskiden kdvAylik (bu sözleşme), karZarar, faturaTakipTahmin ve butceVaryans'ta (`bilinmeyen > 0 ? NaN`)
 * dört kopyaydı — aynı ay geliri P&L'de kısmi toplam, bütçede '—' basıyordu. Türetme (fark/oran/sapma)
 * ayrı kural: bir girdi eksikse hesaplanmaz (null) — kısmi toplamdan sapma üretilmez.
 */
export function ekranTutari(t: Tutar): number {
  return t.bilinen === 0 && t.bilinmeyen > 0 ? NaN : t.toplam;
}

/**
 * TÜRETME kapısı — ekran sözleşmesi DEĞİL: fark/net/oran/marj/özkaynak gibi BAŞKA bir sayıya girecek toplam.
 * Bir kayıt bile bilinmiyorsa NaN: "kısmi giriş − tam çıkış" bir net değil, bilinmeyen kadar yanlış bir sayıdır;
 * ekran '—' basar, not "N kayıt tutarsız" der. Boş liste gerçek 0 (hareketsiz ay). 2026-09-14 hakem turu:
 * karMerkezleri/nakitBilanco/babsKdvAnaliz/bankaMutabakat kısmi toplamdan türetiyordu — dördü buna bağlandı.
 */
export function tamTutar(t: Tutar): number {
  return t.bilinmeyen === 0 ? t.toplam : NaN;
}

/** Birden çok `Tutar`ı birleştirir (toplam ve iki sayaç toplanır); boş → sıfır. Toplam satırları için. */
export function tutarBirlestir(...t: readonly Tutar[]): Tutar {
  return t.reduce<Tutar>((a, b) => ({ toplam: a.toplam + b.toplam, bilinen: a.bilinen + b.bilinen, bilinmeyen: a.bilinmeyen + b.bilinmeyen }), { toplam: 0, bilinen: 0, bilinmeyen: 0 });
}

/** Sipariş satırının maliyet alanları (Order.lineItems kalemi; yapısal, tipe bağımlı değil). */
export interface MaliyetliSatir { costPrice?: unknown; quantity?: unknown }
export interface MaliyetliSiparis { lineItems?: readonly MaliyetliSatir[] | null }

/**
 * Siparişin satır maliyeti (Σ costPrice × quantity) — COGS'un TEK KAYNAĞI (finansalOranlar Phase 132,
 * karZarar Phase 143 + Başabaş aynı siparişe aynı cevabı verir). Herhangi bir satır bilinmiyorsa ya da
 * satır hiç yoksa NaN: "satırsız sipariş 0 maliyetli" demek gelirin tamamını kâr saymaktır (Mikro
 * türetmesi %100 brüt marj basıyordu); kısmi toplam da sahte kesinliktir.
 * Kullanım: `toplaBilinen(siparisler, siparisMaliyeti)` → sipariş SAYILIR (kalem değil).
 */
export function siparisMaliyeti(o: MaliyetliSiparis): number {
  const satirlar = o.lineItems ?? [];
  if (satirlar.length === 0) return NaN;
  let toplam = 0;
  for (const s of satirlar) {
    const tutar = satirTutari(s.costPrice, s.quantity);
    if (!Number.isFinite(tutar)) return NaN;
    toplam += tutar;
  }
  return toplam;
}

export interface TahsilatSiparisi { totalPrice?: unknown; paid?: boolean; status?: string; source?: string }

/**
 * Tahsilat oranı — yalnız ödemesi Cetpa'da izlenen (Mikro kaynaklı DEĞİL), iptal olmayan ve
 * tutarı bilinen siparişler. İzlenen ciro 0 ise oran null ("%0 tahsilat" sahte kesinliktir).
 * Kaynak: FinancePanel 140-147 (eski `|| 0` reduce'ları bilinmeyeni sıfır sayıyordu).
 */
export function tahsilatOrani(siparisler: readonly TahsilatSiparisi[]): { oran: number | null; odenen: number; izlenen: number; bilinmeyen: number } {
  const izlenenler = siparisler.filter(o => !(o.source ?? '').startsWith('mikro') && o.status !== 'Cancelled');
  const { toplam: izlenen, bilinmeyen } = toplaBilinen(izlenenler, o => o.totalPrice);
  const { toplam: odenen } = toplaBilinen(izlenenler.filter(o => o.paid), o => o.totalPrice);
  return { oran: izlenen > 0 ? Math.round((odenen / izlenen) * 100) : null, odenen, izlenen, bilinmeyen };
}

export interface TeklifKalemi { price?: unknown; quantity?: unknown; vatRate?: unknown }

/**
 * Teklif toplamları KALEMLERDEN — Form, Detail ve PDF aynı hesabı kullanır.
 * Eskiden Form kalem bazlı (vatRate ?? 0), Detail ve PDF ise brütü `/1.2` ile sabit %20'ye
 * ayırıyordu: %10'luk kalemi olan teklifte üç yüzey üç farklı KDV basıyordu. Herhangi bir
 * kalemin fiyatı/miktarı/oranı bilinmiyorsa ilgili toplam NaN ('—'); kalem yoksa da NaN —
 * "kalemi olmayan kayıt" için oran uydurulmaz.
 */
export function teklifToplamlari(kalemler: readonly TeklifKalemi[]): { net: number; kdv: number; brut: number; bilinmeyenSatir: number } {
  if (!kalemler.length) return { net: NaN, kdv: NaN, brut: NaN, bilinmeyenSatir: 0 };
  let net = 0, kdv = 0, bilinmeyenSatir = 0, netBilinmiyor = false, kdvBilinmiyor = false;
  for (const k of kalemler) {
    const tutar = satirTutari(k.price, k.quantity);
    if (!Number.isFinite(tutar)) { bilinmeyenSatir++; netBilinmiyor = true; kdvBilinmiyor = true; continue; }
    net += tutar;
    const oran = sayi(k.vatRate);
    if (!Number.isFinite(oran) || oran < 0) { bilinmeyenSatir++; kdvBilinmiyor = true; continue; }
    kdv += tutar * (oran / 100);
  }
  const netS = netBilinmiyor ? NaN : net, kdvS = kdvBilinmiyor ? NaN : kdv;
  return { net: netS, kdv: kdvS, brut: netS + kdvS, bilinmeyenSatir };
}
