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
export const formatInCurrency = (
  amountInTRY: number,
  currency: string,
  exchangeRates?: ExchangeRates,
): string => {
  if (!isFinite(amountInTRY)) return `0 ${currency}`;

  let converted = amountInTRY;
  if (currency !== 'TRY' && exchangeRates && exchangeRates[currency]) {
    converted = amountInTRY / exchangeRates[currency];
  }

  const locale = CURRENCY_LOCALES[currency] ?? 'en-US';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(converted);
  } catch {
    // Fallback for unknown currency codes
    return `${converted.toFixed(2)} ${currency}`;
  }
};
