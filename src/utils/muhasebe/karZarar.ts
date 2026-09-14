/**
 * karZarar.ts — MuhasebePage "Phase 143: Profit & Loss Statement" + "Break-Even Calculator"
 * panellerinin HESAP katmanı (Faz 3 1/n, 2026-09-13). Test: karZarar.test.ts (önce yazıldı).
 *
 * NEDEN VAR — sayfadaki sahte kesinlik siteleri:
 *   • `f.tutar || 0`, `o.totalPrice || 0`  → tutarı bilinmeyen fatura/sipariş 0 sayılıp gelir
 *     eksik toplanıyor, marj/EBIT şişiyor ya da çöküyordu.
 *   • `(li.costPrice ?? 0) * li.quantity`   → maliyeti girilmemiş satır 0 maliyetli sayılıyor;
 *     satırı hiç olmayan Mikro türetmeleri %100 brüt marj basıyordu.
 *   • `ytdRevenue > 0 ? … : 0`, `grossMarginBE … : 0`, `breakEvenRev … : 0`, `safetyMargin … : 0`
 *     → ciro yokken "%0 marj / ₺0 başabaş" — rakam yok, bilgi yok; '—' olmalı.
 *   • `i.prices?.Retail ?? i.price ?? 0` / `Math.max(avg, 1)` → fiyatı bilinmeyen ürün ortalamayı
 *     sıfıra çekiyor, başabaş adedi = ciro çıkıyordu.
 *
 * KURAL (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR
 * (`bilinmeyen`), ekranda '—' + "N kayıt tutarsız". Toplamlar `{ toplam, bilinmeyen }` döner
 * (sayfa kısmi toplamı notla ya da '—' ile gösterir); ORANLAR ve türevler (brüt kâr, SG&A, EBIT,
 * marj, başabaş) herhangi bir taraf eksikse `null` — iki kısmi rakamın oranı anlamlı değildir.
 *
 * SEMANTİK sayfadaki gibi korundu: iptal (`status === 'Cancelled'`) dışarıda; native gelir yalnız
 * FATURASIZ siparişlerden (faturalı olanlar `mikroFaturalar` "giden"de zaten sayılır); Mikro
 * satış faturasından türetilen sipariş (`source: 'mikro-fatura'`) de aynı sebeple native gelire
 * girmez — `faturali` backfill'i henüz uygulanmamış kayıtta çift sayımı önler. Maliyet ise
 * faturalanma durumundan bağımsız TÜM ay siparişlerinden. Başabaş: tüm zamanların iptal-dışı
 * siparişleri (aylık pencere yok). `odemeTakipli` burada uygulanmaz: P&L tahsilata değil
 * faturalanmış/satılmış gelire bakar.
 */
import { bilinenSayi, toplaBilinen, siparisMaliyeti, type Tutar } from '../para';
import { gunAnahtari } from '../zaman';
import { kurCevir, type ExchangeRates } from '../currency';

// ── Girdi tipleri: MİNİMAL ve yapısal — kanonik Order/InventoryItem/MikroFatura uyar, bağımlı değil ──
export interface KzSatir { costPrice?: unknown; quantity?: unknown }
export interface KzSiparis {
  id?: string;
  totalPrice?: unknown;
  status?: string;
  source?: string;
  faturali?: boolean;
  createdAt?: unknown;
  lineItems?: readonly KzSatir[] | null;
}
export interface KzFatura { yon?: string; tarih?: unknown; tutar?: unknown }
export interface KzUrun { prices?: Record<string, unknown> | null; price?: unknown }

/** para.ts `Tutar` — `bilinen` sayacı para.ts `ekranTutari` (tek sözleşme) için gerekli. */
export type Toplam = Tutar;

/** İşletme gideri tahmini (SG&A) — sayfadaki %12 varsayımı; gerçek gider muhasebe entegrasyonu ister. */
export const SGA_ORANI = 0.12;

const iptalDegil = (o: KzSiparis): boolean => o.status !== 'Cancelled';
/** Geliri Mikro giden faturalarında sayılan sipariş — native gelire ikinci kez girmez. */
const geliriMikroda = (o: KzSiparis): boolean => o.faturali === true || o.source === 'mikro-fatura';

/**
 * 'YYYY-MM' YEREL ay anahtarı. `ayAnahtari` değil `gunAnahtari` üzerinden: fatura tarihi
 * tarih-only string ('2026-08-01') ve `Date.parse` onu UTC gece yarısına sabitler — UTC'nin
 * batısında bir tarayıcıda 31 Temmuz'a kayardı. `gunBasi` tarih-only'yi yerel gün kurar.
 */
export const ayAnahtariYerel = (v: unknown): string | null => gunAnahtari(v)?.slice(0, 7) ?? null; // butceVaryans da bunu kullanır (tek yer)

// Sipariş maliyeti (Σ costPrice × quantity; satırsız / bilinmeyen satırlı → NaN) para.ts `siparisMaliyeti`.
// Phase 132 (finansalOranlar.cetpaMaliyet) da aynı fonksiyonu kullanır — iki panel aynı siparişe aynı cevabı verir.

export interface AyKarZarar {
  /** Ayın ilk günü (etiket için; `tarihYaz(ay, { month: 'short', year: '2-digit' })`). */
  ay: Date;
  gelir: number;
  /** Tutarı bilinen kayıt (faturasız sipariş + Mikro fatura) sayısı. */
  gelirBilinen: number;
  gelirBilinmeyen: number;
  maliyet: number;
  maliyetBilinen: number;
  maliyetBilinmeyen: number;
  /** gelir − maliyet; iki taraftan biri eksikse null. */
  brutKar: number | null;
}

/** Tek ayın gelir/maliyeti — `ayBasi` hangi aydaysa o ay. */
export function ayKarZarar(siparisler: readonly KzSiparis[], faturalar: readonly KzFatura[], ayBasi: Date): AyKarZarar {
  const ay = new Date(ayBasi.getFullYear(), ayBasi.getMonth(), 1);
  const anahtar = ayAnahtariYerel(ay);
  const aySiparisleri = anahtar === null ? [] : siparisler.filter(o => iptalDegil(o) && ayAnahtariYerel(o.createdAt) === anahtar);
  const ayFaturalari = anahtar === null ? [] : faturalar.filter(f => f.yon === 'giden' && ayAnahtariYerel(f.tarih) === anahtar);

  const native = toplaBilinen(aySiparisleri.filter(o => !geliriMikroda(o)), o => o.totalPrice);
  const mikro = toplaBilinen(ayFaturalari, f => f.tutar);
  const maliyet = toplaBilinen(aySiparisleri, siparisMaliyeti);

  const gelir = native.toplam + mikro.toplam;
  const gelirBilinmeyen = native.bilinmeyen + mikro.bilinmeyen;
  const tam = gelirBilinmeyen === 0 && maliyet.bilinmeyen === 0;
  return {
    ay, gelir, gelirBilinen: native.bilinen + mikro.bilinen, gelirBilinmeyen,
    maliyet: maliyet.toplam, maliyetBilinen: maliyet.bilinen, maliyetBilinmeyen: maliyet.bilinmeyen,
    brutKar: tam ? gelir - maliyet.toplam : null,
  };
}

/** Son `aySayisi` ay (varsayılan 6), en eskiden `simdi`nin ayına. */
export function sonAylarKarZarar(
  siparisler: readonly KzSiparis[],
  faturalar: readonly KzFatura[],
  s: { simdi?: Date; aySayisi?: number } = {},
): AyKarZarar[] {
  const simdi = s.simdi ?? new Date();
  const n = s.aySayisi ?? 6;
  const aylar: AyKarZarar[] = [];
  for (let geri = n - 1; geri >= 0; geri--) {
    aylar.push(ayKarZarar(siparisler, faturalar, new Date(simdi.getFullYear(), simdi.getMonth() - geri, 1)));
  }
  return aylar;
}

export interface KarZararOzeti {
  gelir: Toplam;
  maliyet: Toplam;
  brutKar: number | null;
  /** gelir × SGA_ORANI; gelir eksikse null. */
  isletmeGideri: number | null;
  ebit: number | null;
  /** Yüzde (35 = %35); ciro 0 ya da eksik veri → null. */
  brutMarj: number | null;
  netMarj: number | null;
}

/** Dönem (aylar) toplamı: P&L tablosu + KPI kartları. */
export function karZararOzeti(aylar: readonly AyKarZarar[]): KarZararOzeti {
  const gelir: Toplam = { toplam: 0, bilinen: 0, bilinmeyen: 0 };
  const maliyet: Toplam = { toplam: 0, bilinen: 0, bilinmeyen: 0 };
  for (const a of aylar) {
    gelir.toplam += a.gelir; gelir.bilinen += a.gelirBilinen; gelir.bilinmeyen += a.gelirBilinmeyen;
    maliyet.toplam += a.maliyet; maliyet.bilinen += a.maliyetBilinen; maliyet.bilinmeyen += a.maliyetBilinmeyen;
  }
  const gelirTam = gelir.bilinmeyen === 0;
  const tam = gelirTam && maliyet.bilinmeyen === 0;
  const brutKar = tam ? gelir.toplam - maliyet.toplam : null;
  const isletmeGideri = gelirTam ? gelir.toplam * SGA_ORANI : null;
  const ebit = brutKar !== null && isletmeGideri !== null ? brutKar - isletmeGideri : null;
  const oran = (pay: number | null): number | null => (pay !== null && gelir.toplam > 0 ? (pay / gelir.toplam) * 100 : null);
  return { gelir, maliyet, brutKar, isletmeGideri, ebit, brutMarj: oran(brutKar), netMarj: oran(ebit) };
}

// Ekran köprüsü para.ts `ekranTutari` (TEK sözleşme: hiç bilinen yokken '—', kısmi bilinmeyen kısmi toplam + not).
// Buradaki `bilinmeyen > 0 ? NaN` kopyası 2026-09-14 hakem turunda silindi — KDV paneliyle çelişiyordu.

export interface BasabasSonucu {
  gelir: Toplam;
  maliyet: Toplam;
  /** Yüzde; eksik veri ya da ciro 0 → null. */
  brutMarj: number | null;
  /** gelir × SGA_ORANI; gelir eksikse null. */
  sabitGider: number | null;
  /** sabitGider / marj; marj ≤ 0 ya da bilinmiyorsa null (zarar eden işte başabaş "0" değil, YOK). */
  basabasCiro: number | null;
  /** Yüzde, yuvarlanmış; başabaş yoksa null. */
  guvenlikMarji: number | null;
  /** Fiyatı bilinen ürünlerin ortalaması (Retail sayıysa o, değilse price — finansalOranlar.stokDegeri ile aynı kural); bilinmeyenler sayılır. */
  ortalamaFiyat: { ortalama: number | null; bilinmeyen: number };
  basabasAdet: number | null;
}

/** Başabaş analizi — tüm iptal-dışı siparişler (faturalı dahil; burada Mikro faturası eklenmediğinden çift sayım yok). */
export function basabas(siparisler: readonly KzSiparis[], urunler: readonly KzUrun[]): BasabasSonucu {
  const aktif = siparisler.filter(iptalDegil);
  const g = toplaBilinen(aktif, o => o.totalPrice);
  const m = toplaBilinen(aktif, siparisMaliyeti);
  const gelir: Toplam = g;
  const maliyet: Toplam = m;

  const tam = gelir.bilinmeyen === 0 && maliyet.bilinmeyen === 0;
  const marjOrani = tam && gelir.toplam > 0 ? (gelir.toplam - maliyet.toplam) / gelir.toplam : null;
  const sabitGider = gelir.bilinmeyen === 0 ? gelir.toplam * SGA_ORANI : null;
  const basabasCiro = marjOrani !== null && marjOrani > 0 && sabitGider !== null ? sabitGider / marjOrani : null;
  const guvenlikMarji = basabasCiro !== null && gelir.toplam > 0 ? Math.round(((gelir.toplam - basabasCiro) / gelir.toplam) * 100) : null;

  // Retail alanı VAR ama sayı değilse ('' / 'abc' / NaN) `??` price'a düşmezdi → ürün bilinmeyen sayılıyordu;
  // stokDegeri (Phase 132) aynı ürünü price'tan değerliyor. Aynı envantere aynı 'bilinmeyen' sayısı: aynı kural.
  const fiyat = toplaBilinen(urunler, u => (bilinenSayi(u.prices?.['Retail']) ? u.prices?.['Retail'] : u.price));
  const ortalama = fiyat.bilinen > 0 ? fiyat.toplam / fiyat.bilinen : null;
  const basabasAdet = basabasCiro !== null && ortalama !== null && ortalama > 0 ? Math.round(basabasCiro / ortalama) : null;

  return {
    gelir, maliyet,
    brutMarj: marjOrani === null ? null : marjOrani * 100,
    sabitGider, basabasCiro, guvenlikMarji,
    ortalamaFiyat: { ortalama, bilinmeyen: fiyat.bilinmeyen },
    basabasAdet,
  };
}

/**
 * Aylık çubuk genişlikleri (%): bilinen ayların en büyük gelirine göre. Geliri eksik ay → null
 * (çubuk çizilmez); brüt kâr negatifse 0'a kırpılır (sayfadaki `Math.max(gpW, 0)`).
 */
export function cubukYuzdeleri(aylar: readonly AyKarZarar[]): { gelirYuzde: number | null; brutKarYuzde: number | null }[] {
  const enBuyuk = Math.max(0, ...aylar.filter(a => a.gelirBilinmeyen === 0).map(a => a.gelir));
  const yuzde = (v: number): number => (enBuyuk > 0 ? Math.round((v / enBuyuk) * 100) : 0);
  return aylar.map(a => {
    if (a.gelirBilinmeyen > 0) return { gelirYuzde: null, brutKarYuzde: null };
    return { gelirYuzde: yuzde(a.gelir), brutKarYuzde: a.brutKar === null ? null : Math.max(0, yuzde(a.brutKar)) };
  });
}

/** "₺1 = $x" etiketi için oran: ₺1'in `birim` karşılığı. TRY → 1; kur yoksa null — rakam basılmaz. */
export const kurEtiketi = (birim: string, rates: ExchangeRates | null | undefined): number | null => kurCevir(1, birim, rates);
