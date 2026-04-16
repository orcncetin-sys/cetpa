export const formatCurrency = (amount: number, _exchangeRates?: unknown) => amount.toString();
export const formatInCurrency = (amount: number, currency: string, _exchangeRates?: unknown) => amount.toString() + ' ' + currency;
