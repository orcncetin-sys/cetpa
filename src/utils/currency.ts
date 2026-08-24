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
export const formatCurrency = (
  amount: number,
  _exchangeRates?: ExchangeRates,
): string => {
  if (!isFinite(amount)) return '₺0,00';
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
  if (!isFinite(amount)) return `0 ${currency}`;
  return bicimle(amount, currency);
};

export const formatInCurrency = (
  amountInTRY: number,
  currency: string,
  exchangeRates?: ExchangeRates,
): string => {
  if (!isFinite(amountInTRY)) return `0 ${currency}`;

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
    if (!kur || !isFinite(kur) || kur <= 0) return '—';
    converted = amountInTRY / kur;
  }

  return bicimle(converted, currency);
};
