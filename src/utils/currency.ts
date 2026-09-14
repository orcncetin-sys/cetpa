export type ExchangeRates = Record<string, number>; // e.g. { USD: 32.5, EUR: 35.1 }

const CURRENCY_LOCALES: Record<string, string> = {
  TRY: 'tr-TR',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  CHF: 'de-CH',
  JPY: 'ja-JP',
  AED: 'ar-AE',
};

/**
 * Format amount in TRY using Intl.NumberFormat.
 * If exchangeRates supplied, amount is treated as TRY and converted to the
 * app's display currency via the rates map — currently we display in TRY.
 */
/**
 * BİLİNMEYEN TUTAR '—' DÖNER, '₺0,00' DEĞİL (Faz 1, 2026-09-04).
 * Eskiden NaN/undefined → '₺0,00' basılıyordu. Bu fonksiyon 20 çağrı yerinin
 * tek kaynağı: Mikro'dan henüz gelmemiş bakiye, yüklenmemiş toplam, alanı
 * olmayan sipariş — hepsi ekranda "sıfır borç / sıfır ciro" görünüyordu.
 * CLAUDE.md "sahte kesinlik gösterme": güvenilir hesaplanamayan rakam '—'.
 *
 * `Number.isFinite`, GLOBAL sürüm DEĞİL (inceleme yakaladı, 2026-09-04): global sürüm
 * null'u 0'a zorlar ve true döner, yani `formatCurrency(null)` yine '₺0,00' basardı —
 * ve gerçek veri şekli tam olarak null'dur (Mikro'dan gelmemiş alan). `Number.`
 * öneki zorlamaz: null/undefined/'' → false → '—'.
 * Aynı dosyadaki `kurCevir` bu ilkeyi zaten uyguluyordu; burası uygulamıyordu
 * (yarım düzeltme). Mevcut test bu yanlış davranışı SABİTLİYORDU — güncellendi.
 */
export const formatCurrency = (
  amount: number,
  _exchangeRates?: ExchangeRates,
): string => {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

/**
 * Format amount in a given currency code.
 * If exchangeRates supplied and currency !== 'TRY', converts from TRY first.
 */
/** Intl ile para biçimlendirme — formatAmount ve formatInCurrency'nin ORTAK gövdesi. */
const bicimle = (deger: number, currency: string): string => {
  const locale = CURRENCY_LOCALES[currency] ?? 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(deger);
  } catch {
    // Bilinmeyen para birimi kodu için yedek
    return `${deger.toFixed(2)} ${currency}`;
  }
};

/**
 * Tutarı KENDİ para biriminde biçimlendirir — ÇEVİRİ YAPMAZ.
 *
 * Bunu, elindeki sayı zaten hedef para biriminde cinsindense kullan (ör. bir
 * teklifin satır fiyatları: kullanıcı USD teklifte doğrudan USD yazıyor,
 * hiçbir yerde TL'den çevrilmiyor). Kur gerekmez, dolayısıyla '—' de dönmez.
 *
 * NEDEN AYRI (2026-08-22): `formatInCurrency` iki farklı işi birden yapıyordu
 * — "TL'den çevir" ve "biçimlendir". C4 düzeltmesi kur yokken '—' döndürünce
 * çeviri BEKLEMEYEN çağıranlar da (QuotationDetail'in 10, QuotationForm'un 5
 * çağrısı) '—' almaya başladı: müşteriye giden USD/EUR teklif PDF'inde birim
 * fiyat, KDV ve genel toplam '—' basılacaktı. İki iş ayrıldı; "veri yok"
 * sinyali artık yalnız gerçekten çeviri isteyen yoldan çıkıyor.
 */
export const formatAmount = (amount: number, currency: string): string => {
  if (!Number.isFinite(amount)) return '—';   // bilinmeyen tutar — '0 USD' sahte kesinlikti
  return bicimle(amount, currency);
};

/**
 * TL tutarını hedef para birimine çevirir. KUR YOKSA `null` — asla uydurma
 * bir kur kullanmaz.
 *
 * NEDEN VAR (2026-08-26): `formatInCurrency` bu kararı zaten DOĞRU veriyordu
 * ('—' döner, bkz. C4 notu aşağıda) ama bir STRING döndürdüğü için, sayıya
 * ihtiyaç duyan çağıranlar onu kullanamıyor ve dönüşümü satır içinde YENİDEN
 * yazıyordu. O kopyalar iki biçimde yanlıştı:
 *
 *   `exchangeRates?.USD || 1`      → kur yoksa TL tutarı OLDUĞU GİBİ kalır ve
 *                                    başına '$' konur: ₺40.000 → "$40.000"
 *                                    (~38× şişkin). 8 dosyada vardı.
 *   `exchangeRates?.USD ?? 38`     → 2024'ten kalma SABİT kur. 5 dosyada vardı
 *                                    (32 / 35 / 38 / 41 gibi değerlerle).
 *
 * İkisi de CLAUDE.md'nin "sahte kesinlik gösterme" kuralının ihlali: rakam
 * güvenilir hesaplanamıyorsa yanıltıcı bir sayı değil '—' gösterilmeli.
 *
 * Çağıran `null` aldığında sayıyı BASMAMALI — '—' göstermeli.
 */
export const kurCevir = (
  amountInTRY: number,
  currency: string,
  exchangeRates?: ExchangeRates | null,
): number | null => {
  if (!Number.isFinite(amountInTRY)) return null;   // global sürüm null'u 0 sayar — o yüzden Number.
  if (currency === 'TRY') return amountInTRY;
  const kur = exchangeRates?.[currency];
  if (!kur || !Number.isFinite(kur) || kur <= 0) return null;
  return amountInTRY / kur;
};

/**
 * Döviz tutarını TL'ye çevirir — `kurCevir`in TERSİ, aynı sözleşme: kur yoksa / 0 / negatif / NaN
 * → null (2024 sabiti YOK); tutar bilinmiyorsa null. Boş birim TRY sayılır.
 *
 * NEDEN BURADA (Faz 3 1/n hakem turu, 2026-09-13): döviz→TL çevirimi ÜÇ kopyaydı — MuhasebePage
 * yerel `tlYap`/`tlTopla` (global `isFinite` kullanıyordu: null → 0 → true), nakitBilanco
 * `dovizTopla` içi, mutabakatMasraf `tlyeCevir`. Sayfadaki kopya ölüydü (tanım dışında çağrı yok),
 * diğer ikisi şimdi burayı çağırır. `kurCevir` ile simetri testi currency.test.ts'te.
 */
export const tlyeCevir = (
  tutar: number,
  birim: string | undefined,
  kurlar?: Readonly<ExchangeRates> | null,
): number | null => {
  if (!Number.isFinite(tutar)) return null;   // global sürüm null'u 0 sayar — o yüzden Number.
  if (!birim || birim === 'TRY') return tutar;
  const kur = kurlar?.[birim];
  if (kur === undefined || !Number.isFinite(kur) || kur <= 0) return null;
  return tutar * kur;
};

export const formatInCurrency = (
  amountInTRY: number,
  currency: string,
  exchangeRates?: ExchangeRates,
): string => {
  if (!Number.isFinite(amountInTRY)) return '—';   // bilinmeyen tutar — '0 USD' sahte kesinlikti

  // Cevirinin kendisi `kurCevir`de — iki kopya kacinilmaz olarak sapardi.
  let converted = amountInTRY;
  if (currency !== 'TRY') {
    const kur = exchangeRates?.[currency];
    // KUR YOKSA '—' (2026-08-22 denetim bulgusu C4). Eskiden çeviri sessizce
    // atlanıp TL tutarı yabancı sembolle basılıyordu: ₺40.000 → "$40,000.00"
    // (~40× şişkin). CLAUDE.md kuralı: güvenilir hesaplanamayan rakam yerine
    // yanıltıcı sayı değil '—' göster.
    //
    // DİKKAT: bu '—' bir GÖSTERİM sinyali. Sayı bekleyen bir yere (PDF/CSV
    // hücresi, hesap) akmamalı — çeviri istemeyen çağıran `formatAmount`
    // kullanmalı.
    if (!kur || !Number.isFinite(kur) || kur <= 0) return '—';
    converted = amountInTRY / kur;
  }

  return bicimle(converted, currency);
};

// ── EKRAN para biçimi — TEK KAYNAK (Faz 2 1/n, 2026-09-05) ─────────────────────────
// Faz 0 ölçümü: 325 satır içi `₺${n.toLocaleString('tr-TR', …)}` + 20 yerel kopya (fmtKpi ×5,
// formatTRY ×3, fmtTRY ×3…). Kopyaların ortak arızası: bilinmeyen tutar '₺NaN'/'₺0'; kur yokken
// 1 ya da 38 sabitiyle çeviri. Görünüm mevcut satır içi desenle AYNI tutuldu (sembol önde, yerel
// gruplama) ki 325 yerin taşınması ekranı değiştirmesin; tek fark: bilinmeyen → '—', negatifte
// işaret sembolün önünde. Sözleşme: currency.ekran.test.ts.
import { bilinenSayi } from './para';

/**
 * Kur farkı (TL) = döviz bakiyesi × (güncel kur − defterdeki kur). Bakiye ya da defter kuru bilinmiyorsa
 * (boş/bozuk giriş → NaN) ya da güncel kur yoksa null → ekran '—'. Phase 635 sayfada `?? 0` ile
 * "−bakiye × defterKuru" diye tümüyle uydurma bir zarar basıyordu; 2026-09-14'te tek yere alındı.
 */
export const kurFarki = (bakiye: unknown, defterKuru: unknown, guncelKur: number | null): number | null =>
  guncelKur === null || !Number.isFinite(guncelKur) || !bilinenSayi(bakiye) || !bilinenSayi(defterKuru)
    ? null
    : Number(bakiye) * (guncelKur - Number(defterKuru));

const PARA_SEMBOLU: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£', CHF: 'CHF ', JPY: '¥' };

export interface ParaSecenek {
  /** Para birimi kodu (varsayılan TRY). */
  birim?: string;
  /** Ondalık basamak (varsayılan 2). */
  ondalik?: number;
}

const sayiYaz = (n: number, birim: string, ondalik: number): string =>
  n.toLocaleString(CURRENCY_LOCALES[birim] ?? 'tr-TR', { minimumFractionDigits: ondalik, maximumFractionDigits: ondalik });

/** Tutar ZATEN `birim` cinsinden — çeviri yapmaz. Bilinmeyen tutar '—'. Örn. '₺1.234,56', '$1,234.56', '1.234,50 XAU'. */
export function paraYaz(v: unknown, s: ParaSecenek = {}): string {
  if (!bilinenSayi(v)) return '—';
  const n = Number(v);
  const birim = String(s.birim ?? 'TRY').toUpperCase();
  const ondalik = s.ondalik ?? 2;
  const sembol = PARA_SEMBOLU[birim];
  const govde = sayiYaz(Math.abs(n), birim, ondalik);
  const isaret = n < 0 ? '-' : '';
  return sembol ? `${isaret}${sembol}${govde}` : `${isaret}${govde} ${birim}`;
}

/** TL tutarını `birim`e kurla çevirip yazar (kurCevir); kur yoksa '—' — TL tutarı yabancı sembolle ASLA basılmaz. */
export function tlYaz(vTRY: unknown, s: ParaSecenek & { rates?: ExchangeRates | null } = {}): string {
  if (!bilinenSayi(vTRY)) return '—';
  const birim = String(s.birim ?? 'TRY').toUpperCase();
  const cv = kurCevir(Number(vTRY), birim, s.rates);
  return cv === null ? '—' : paraYaz(cv, { birim, ondalik: s.ondalik });
}

/** KPI kartı kısa biçimi: 'K' → '₺12,5K', 'M' → '₺1,3M', 'full' → paraYaz (ondalik varsayılan 0). TL girdisi, kurla çevrilir. */
export function kisaTutar(vTRY: unknown, s: ParaSecenek & { fmt?: 'full' | 'K' | 'M'; rates?: ExchangeRates | null } = {}): string {
  if (!bilinenSayi(vTRY)) return '—';
  const birim = String(s.birim ?? 'TRY').toUpperCase();
  const ondalik = s.ondalik ?? 0;
  const cv = kurCevir(Number(vTRY), birim, s.rates);
  if (cv === null) return '—';
  if (s.fmt === 'K' || s.fmt === 'M') {
    const bolen = s.fmt === 'K' ? 1000 : 1_000_000;
    const sembol = PARA_SEMBOLU[birim] ?? `${birim} `;
    const isaret = cv < 0 ? '-' : '';
    return `${isaret}${sembol}${sayiYaz(Math.abs(cv) / bolen, birim, ondalik)}${s.fmt}`;
  }
  return paraYaz(cv, { birim, ondalik });
}
