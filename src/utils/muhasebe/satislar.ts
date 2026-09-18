/**
 * satislar.ts — AccountingModule "Satışlar" sekmesinin HESAP katmanı: Mikro satış faturalarının
 * Cetpa siparişlerinin yanına dizilmesi, KPI kartları ve drill-down kırılımları. TEK KAYNAK.
 * Test: satislar.test.ts (ÖNCE yazıldı). Faz 3 2/n (AccountingModule kapatma, grup "satislar"), 2026-09-14.
 *
 * NEDEN VAR — sayfadaki sahte kesinlik siteleri (satırlar 2026-09-14 ölçümü):
 *   AccountingModule.tsx
 *     1766/1794  `(a.kdv ?? 0) - (b.kdv ?? 0)`      → KDV'si bilinmeyen Mikro satırı ₺0 sayılıp listenin BAŞINA diziliyordu
 *     1789       `a.tutar - b.tutar`                 → tutar NaN olunca karşılaştırıcı NaN, sıra rastgele
 *     1797-1798  `reduce(t + f.tutar)` / `f.kdv || 0` → bilinmeyen tutar/KDV 0 sayılıp Mikro toplamı sessizce EKSİK
 *     1829       `String(o.totalPrice || 0)`         → tutarı bilinmeyen sipariş "0" aramasına çıkıyordu
 *     1834/1836  `(a.totalPrice || 0)` / `(a.kdvOran || 0)` → bilinmeyen tutar/oran ₺0 / %0 gibi ortaya diziliyordu
 *   accounting/SatislarTab.tsx
 *     60-140     `o.totalPrice || 0` ×5, `o.kdvTutari || 0` → KPI kartları + drill-down toplamları bilinmeyeni 0 sayıyordu;
 *                ortalama sipariş `: 0`             → adet 0 iken "₺0 ortalama" (rakam yok, bilgi yok)
 *                byRate `kdvOran !== undefined`     → oranı bilinmeyen kaydın KDV'si kovaya HİÇ girmiyordu (kırılım ≠ toplam)
 *     242        `formatTRY(o.totalPrice || 0)`     → satırda bilinmeyen tutar ₺0,00
 *     249        `%{o.kdvOran ?? 0}`                → oranı bilinmeyen sipariş "%0"
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez,
 * SAYILIR (`bilinmeyen`), sıralamada sona gider, ortalama gibi türetilen sayıya girmez (null → '—').
 * Toplamlar para.ts `Tutar` taşır; ekran `ekranTutari` ile basar (hiç bilinen yokken '—', kısmi toplam +
 * "N kayıt tutarsız" notu); ortalama `tamTutar` kapısından geçer (bir kayıt bile bilinmiyorsa null).
 *
 * SAYFA PARİTESİ (aynı girdi → aynı sayı; yalnız bilinmeyen 0 sayılmaz):
 *   • Dışlamalar AYNEN: yalnız `yon === 'giden'`; seçili yıl (`'hepsi'` = tümü); Cetpa'dan Mikro'ya gönderilmiş
 *     fatura (`mikroEvrakNo` eşleşmesi) çift sayılmaz; iptal edilenler hook'ta zaten elenmiş.
 *   • Toplamlar ADDİTİF: Cetpa sipariş cirosu + (Mikro dahilse) Mikro satış faturaları — kullanıcının
 *     "bu modülü bozma" uyarısı gereği orders mantığı (q-serisi faturasız dahil) korunur, Mikro EK kaynaktır.
 *   • Mikro satırları tanım gereği FATURALI; "Toplam Sipariş" ve "Ortalama Sipariş" kartı yalnız Cetpa
 *     siparişlerini sayar (Mikro faturası sipariş değildir); drill-down toplamı ise Mikro dahil kayıtların
 *     ortalamasıydı → iki değer ayrı alan (`ortalama` / `kayitOrtalamasi`).
 *   • Mikro KPI toplamları ARANMIŞ/SÜZÜLMÜŞ listeden hesaplanır (sayfa `mikroSatisSatirlari`'nı öyle veriyordu);
 *     Cetpa KPI'ları aramadan bağımsız `orders` üzerinden. Çağıran aynı listeleri verir.
 * BİLİNÇLİ FARKLAR:
 *   • Oran kırılımında oranı bilinmeyen kayıt 'bilinmiyor' kovasına girer (eskiden atlanıyordu) → kova toplamı = KPI.
 *   • Arama Türkçe küçük harfle (`toLocaleLowerCase('tr-TR')`: 'İ'→'i'); tutarı bilinmeyen kayıt "0"/"nan" ile eşleşmez.
 *   • Tarih sıralaması `sayiSirala` ile: tarihi çözülemeyen sipariş (siparisTarihMs → -Infinity) her iki yönde
 *     de SONDA (eski `cmp`/`-cmp` artan sırada başa alıyordu; siparis.ts notu "en sona düşsün" diyordu).
 */
import { bilinenSayi, toplaBilinen, tutarBirlestir, tamTutar, ekranTutari, sayiSirala, type Tutar } from '../para';
import { siparisTarihMs, type SiparisTarihAlanlari } from '../siparis';

// ── Girdi tipleri: MİNİMAL ve yapısal — kanonik Order / Customer / MikroFatura uyar, bağımlı değil ──
/** Cetpa siparişi (Order'ın Satışlar sekmesinde okunan alanları; DB'den null gelebilir → `unknown`). */
export interface SatisSiparisi extends SiparisTarihAlanlari {
  customerName?: string;
  totalPrice?: unknown;
  faturali?: boolean;
  kdvOran?: unknown;
  kdvTutari?: unknown;
  oranKarma?: boolean;
  /** Cetpa siparişi Mikro'ya gönderilince geri yazılan evrak no — çift sayım elemesi bununla. */
  mikroEvrakNo?: unknown;
}
/** Mikro faturası (useMikroFaturalar.MikroFatura'nın burada okunan alanları; tutar/kdv NaN = BİLİNMİYOR — hook grubu, 2026-09-18). */
export interface SatisFaturasi {
  id?: string;
  cariKod?: string;
  /** 'YYYY-MM-DD' beklenir; yıl süzgeci `startsWith` ile. */
  tarih?: unknown;
  tutar?: unknown;
  faturaNo?: string;
  kdv?: unknown;
  oran?: number | null;
  oranKarma?: boolean;
  yon?: string;
}
/** Cari kaydı (Customer): Mikro cari kodu → görünen ad. */
export interface CariKaydi { name?: string; mikroCariKod?: unknown }
/** Drill-down satırı: sipariş ya da sipariş şekline çevrilmiş Mikro faturası (SatislarTab `SatisKayit`). */
export interface SatisKaydi {
  customerName?: string;
  totalPrice?: unknown;
  faturali?: boolean;
  kdvOran?: unknown;
  oranKarma?: boolean;
  kdvTutari?: unknown;
  syncedAt?: unknown;
}

export type SatisSiralamaAnahtari = 'customerName' | 'totalPrice' | 'date' | 'faturali' | 'kdvOran';
export interface SatisSiralama { anahtar: SatisSiralamaAnahtari; azalan: boolean }

const sifir = (): Tutar => ({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
const kucuk = (s: unknown): string => String(s ?? '').toLocaleLowerCase('tr-TR');
/** Tutar metni araması: yalnız BİLİNEN sayı metne çevrilir ('nan'/'0' uydurulmaz). */
const tutarMetni = (v: unknown): string => (bilinenSayi(v) ? String(Number(v)) : '');
const yon = (azalan: boolean): number => (azalan ? -1 : 1);

// ── Yardımcı kümeler ─────────────────────────────────────────────────────────────────────────────

/**
 * MÜKERRER SAYIM ELEMESİ: Cetpa siparişi Mikro'ya gönderildiğinde evrak no `mikroEvrakNo` alanına
 * geri yazılıyor. Aynı satış iki kez görünmesin diye o evrak numaralarına sahip Mikro faturaları
 * listelenmez. (AccountingModule 1721-1724'ten taşındı.)
 */
export function cetpaEvrakNolari(orders: readonly SatisSiparisi[]): Set<string> {
  return new Set(orders.map(o => String(o.mikroEvrakNo ?? '').trim()).filter(Boolean));
}

/** Mikro cari kodu → müşteri adı (Mikro faturasında yalnız cari KODU var). Kodsuz/boş kodlu cari girmez. */
export function cariAdHaritasi(cariler: readonly CariKaydi[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of cariler) {
    const kod = String(c.mikroCariKod ?? '').trim();
    if (kod && c.name) m.set(kod, c.name);
  }
  return m;
}

// ── Mikro satış satırları ────────────────────────────────────────────────────────────────────────

export interface MikroSatisSecenek {
  /** 'YYYY' ya da 'hepsi' (tüm yıllar). */
  yil: string;
  cetpaEvrakNolari: ReadonlySet<string>;
  cariAdMap: ReadonlyMap<string, string>;
  arama?: string;
  /** Verilmezse girdi sırası korunur. */
  siralama?: SatisSiralama;
}

/**
 * Satışlar sekmesi: yalnız giden (satış) faturaları.
 *
 * BAĞIMSIZ ZİNCİR (2026-08-11 düzeltmesi): eskiden bu liste `mikroFaturaSatirlari` üzerinden
 * türetiliyordu, yani FATURALAR sekmesinin filtrelerini (faturaYon, faturaYil, invoiceTypeFilter)
 * sessizce miras alıyordu. Faturalar'da "gelen" seçiliyse `.filter(yon==='giden')` boş küme veriyor,
 * yıl uyuşmazsa da öyle → Satışlar sekmesi "Mikro (0)" ve tüm KPI'lar ₺0,00 görünüyordu. Satışlar'ın
 * kendi yıl seçicisi (satisYil) var; başka sekmenin durumuna bağlı DEĞİL.
 * (AccountingModule 1770-1796'dan taşındı; sıralama artık `sayiSirala` — bilinmeyen sona.)
 */
export function mikroSatisSatirlari<T extends SatisFaturasi>(faturalar: readonly T[], s: MikroSatisSecenek): Array<T & { musteri: string }> {
  const q = kucuk(s.arama);
  const satirlar = faturalar
    .filter(f => f.yon === 'giden')
    .filter(f => s.yil === 'hepsi' || (typeof f.tarih === 'string' && f.tarih.startsWith(s.yil)))
    // Cetpa'dan Mikro'ya gönderilmiş faturayı iki kez sayma.
    .filter(f => !f.faturaNo || !s.cetpaEvrakNolari.has(f.faturaNo))
    .map(f => ({ ...f, musteri: (f.cariKod ? s.cariAdMap.get(f.cariKod) : undefined) || f.cariKod || '—' }))
    .filter(f => !q || kucuk(f.musteri).includes(q) || tutarMetni(f.tutar).includes(q) || kucuk(f.faturaNo).includes(q));
  const sir = s.siralama;
  if (!sir) return satirlar;
  return satirlar.sort((a, b) =>
    sir.anahtar === 'customerName' ? yon(sir.azalan) * a.musteri.localeCompare(b.musteri, 'tr')
    : sir.anahtar === 'totalPrice' ? sayiSirala(a.tutar, b.tutar, sir.azalan)
    // "KDV%" kolonu Mikro satırlarında tutar+oranı birlikte gösteriyor
    // (₺13.333,34 (%20)) ama neredeyse her satır aynı %20 oranı taşıyor —
    // orana göre sıralamak görsel olarak "rastgele" görünüyordu (2026-08-17
    // bildirimi). Görünen ve değişkenlik gösteren asıl değer tutar (kdv).
    : sir.anahtar === 'kdvOran' ? sayiSirala(a.kdv, b.kdv, sir.azalan)
    // 'date' ve 'faturali' (Mikro satırları hep faturalı): tarih metni sırası.
    : yon(sir.azalan) * String(a.tarih ?? '').localeCompare(String(b.tarih ?? '')));
}

// ── Cetpa satış satırları (displayedSatis) ───────────────────────────────────────────────────────

export interface CetpaSatisSecenek { arama?: string; siralama?: SatisSiralama }

/** Satışlar tablosunun Cetpa satırları: arama + sıralama (AccountingModule 1826-1843'ten taşındı). Girdiyi değiştirmez. */
export function cetpaSatisSatirlari<T extends SatisSiparisi>(orders: readonly T[], s: CetpaSatisSecenek): T[] {
  const q = kucuk(s.arama);
  const satirlar = orders.filter(o => !q || kucuk(o.customerName).includes(q) || tutarMetni(o.totalPrice).includes(q));
  const sir = s.siralama;
  if (!sir) return satirlar;
  return satirlar.sort((a, b) =>
    sir.anahtar === 'customerName' ? yon(sir.azalan) * (a.customerName || '').localeCompare(b.customerName || '', 'tr')
    : sir.anahtar === 'totalPrice' ? sayiSirala(a.totalPrice, b.totalPrice, sir.azalan)
    : sir.anahtar === 'faturali' ? yon(sir.azalan) * ((a.faturali ? 1 : 0) - (b.faturali ? 1 : 0))
    : sir.anahtar === 'kdvOran' ? sayiSirala(a.kdvOran, b.kdvOran, sir.azalan)
    // Paylasilan siparisTarihMs (2026-09-04): yalniz `syncedAt` okundugunda
    // Mikro faturasindan turetilen siparisler '' anahtariyla ayni kovaya
    // dusuyor ve tarih sutunu dolu gorunurken siralama rastgele kaliyordu.
    // Tarihi bilinmeyen (-Infinity) `sayiSirala`da sonlu değil → her iki yönde de SONDA.
    : sayiSirala(siparisTarihMs(a), siparisTarihMs(b), sir.azalan));
}

// ── Toplamlar / kayıtlar ─────────────────────────────────────────────────────────────────────────

export interface MikroSatisToplam { adet: number; ciro: Tutar; kdv: Tutar }

/** Süzülmüş Mikro satış satırlarının toplamı (eski `mikroSatisToplam` / `mikroSatisKdvToplam`); NaN tutar/KDV sayılır. */
export function mikroSatisToplamlari(satirlar: readonly SatisFaturasi[]): MikroSatisToplam {
  return { adet: satirlar.length, ciro: toplaBilinen(satirlar, f => f.tutar), kdv: toplaBilinen(satirlar, f => f.kdv) };
}

/**
 * Satışlar sekmesi drill-down'ları için Mikro satış faturalarını orders şekline
 * çevir; drill-down'lar `satisKayitlari`'ni okur (orders BOŞ olduğu için detaylar
 * "Kayıt bulunamadı" gösteriyordu — 2026-08-02). Mikro faturaları FATURALI sayılır;
 * q-serisi/faturasız orders'ta korunur. (AccountingModule 1807-1823'ten taşındı.)
 */
export function satisKayitlari<T extends SatisSiparisi>(
  orders: readonly T[],
  mikroSatirlari: readonly (SatisFaturasi & { musteri: string })[],
  mikroDahil: boolean,
): SatisKaydi[] {
  const mikro: SatisKaydi[] = mikroDahil
    ? mikroSatirlari.map(f => ({
        customerName: f.musteri,
        totalPrice: f.tutar,
        faturali: true,
        kdvOran: f.oran ?? undefined,
        oranKarma: f.oranKarma,
        kdvTutari: f.kdv,
        syncedAt: undefined,
      }))
    : [];
  return [...orders, ...mikro];
}

/**
 * Oran kırılımı kovası: 'karma' | 'bilinmiyor' | oran metni ('20', '10', '0').
 * Karma oranlı faturalar (task #27, #18'in devamı): oranKarma tek f.oran'a göre kovalanırsa
 * KDV'si yanlış orana yazılır — ayrı kova. Oranı bilinmeyen kayıt ATLANMAZ, 'bilinmiyor'a girer.
 * Ekran çevirisi sayfada: 'karma' → oc.karma, 'bilinmiyor' → oc.bilinmiyor / '—', diğer → `%${k} KDV`.
 */
export function kdvOranAnahtari(kdvOran: unknown, oranKarma?: boolean): string {
  if (oranKarma) return 'karma';
  return bilinenSayi(kdvOran) ? String(Number(kdvOran)) : 'bilinmiyor';
}

// ── KPI ──────────────────────────────────────────────────────────────────────────────────────────

export interface SatisKpi {
  /** Toplam ciro: Cetpa siparişleri + (dahilse) Mikro satış faturaları. */
  ciro: Tutar;
  /** Faturalı siparişler + (dahilse) Mikro (tanım gereği faturalı). */
  faturaliCiro: Tutar;
  /** Yalnız faturasız Cetpa siparişleri. */
  faturasizCiro: Tutar;
  /** Sipariş `kdvTutari` + (dahilse) Mikro `kdv`; KDV alanı olmayan sipariş bilinmeyen sayılır. */
  kdv: Tutar;
  /** Cetpa sipariş adedi (kart "Toplam Sipariş"). */
  adet: number;
  /** Faturalı sipariş + (dahilse) Mikro satır adedi. */
  faturaliAdet: number;
  faturasizAdet: number;
  /** Ortalama sipariş (kart): yalnız Cetpa; adet 0 ya da bir tutar bile bilinmiyorsa null. */
  ortalama: number | null;
  /** Drill-down toplamı: Mikro dahil kayıtların ortalaması; aynı null kuralı. */
  kayitOrtalamasi: number | null;
  /** Mikro payı (eski mikroSatisAdet/Ciro/Kdv; dahil değilse sıfır) — "(Mikro dahil)" etiketi bununla. */
  mikro: MikroSatisToplam;
  /** Müşteri adı (yoksa '—') → tutar. */
  musteriKirilimi: Record<string, Tutar>;
  /** `kdvOranAnahtari` → KDV tutarı. */
  oranKirilimi: Record<string, Tutar>;
}

/** Türetilen sayı: bir kayıt bile bilinmiyorsa ya da adet 0 ise null ("₺0 ortalama" sahte kesinliktir). */
const ortalamaHesapla = (t: Tutar, adet: number): number | null => {
  const tam = tamTutar(t);
  return adet > 0 && Number.isFinite(tam) ? tam / adet : null;
};

function kirilim<T>(liste: readonly T[], anahtar: (o: T) => string, sec: (o: T) => unknown): Record<string, Tutar> {
  const r: Record<string, Tutar> = {};
  for (const o of liste) {
    const k = anahtar(o);
    r[k] = tutarBirlestir(r[k] ?? sifir(), toplaBilinen([o], sec));
  }
  return r;
}

/**
 * Satışlar KPI kartları + drill-down kırılımları. `mikroSatirlari` = `mikroSatisSatirlari` çıktısı (süzülmüş);
 * `mikroDahil` = `satisKaynak !== 'cetpa'`. Mikro satış faturaları tanım gereği FATURALI; Satışlar KPI'larına
 * additive katılır; orders mantığı (q-serisi faturasız dahil) korunur — kullanıcının "bu modülü bozma" uyarısı
 * gereği toplamlar toplanır, drill-down/orders akışına dokunulmaz. (AccountingModule 1797-1806 + SatislarTab 60-140.)
 */
export function satisKpi<T extends SatisSiparisi>(
  orders: readonly T[],
  mikroSatirlari: readonly (SatisFaturasi & { musteri: string })[],
  mikroDahil: boolean,
): SatisKpi {
  const mikro: MikroSatisToplam = mikroDahil ? mikroSatisToplamlari(mikroSatirlari) : { adet: 0, ciro: sifir(), kdv: sifir() };
  const faturali = orders.filter(o => o.faturali);
  const faturasiz = orders.filter(o => !o.faturali);
  const cetpaCiro = toplaBilinen(orders, o => o.totalPrice);
  const kayitlar = satisKayitlari(orders, mikroSatirlari, mikroDahil);
  return {
    ciro: tutarBirlestir(cetpaCiro, mikro.ciro),
    faturaliCiro: tutarBirlestir(toplaBilinen(faturali, o => o.totalPrice), mikro.ciro),
    faturasizCiro: toplaBilinen(faturasiz, o => o.totalPrice),
    kdv: tutarBirlestir(toplaBilinen(orders, o => o.kdvTutari), mikro.kdv),
    adet: orders.length,
    faturaliAdet: faturali.length + mikro.adet,
    faturasizAdet: faturasiz.length,
    ortalama: ortalamaHesapla(cetpaCiro, orders.length),
    kayitOrtalamasi: ortalamaHesapla(toplaBilinen(kayitlar, k => k.totalPrice), kayitlar.length),
    mikro,
    musteriKirilimi: kirilim(kayitlar, k => k.customerName || '—', k => k.totalPrice),
    oranKirilimi: kirilim(kayitlar, k => kdvOranAnahtari(k.kdvOran, k.oranKarma), k => k.kdvTutari),
  };
}

/** Kırılımı ekran tutarına göre AZALAN sırada verir; yalnız bilinmeyenden oluşan kova (ekranda '—') SONDA. */
export function kirilimSirala(k: Record<string, Tutar>): Array<[string, Tutar]> {
  return Object.entries(k).sort(([, a], [, b]) => sayiSirala(ekranTutari(a), ekranTutari(b), true));
}
