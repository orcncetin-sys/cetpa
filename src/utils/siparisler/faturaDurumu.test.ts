import { describe, it, expect } from 'vitest';
import { siparisFaturaVar, faturaKesilebilir, mikroyaFaturaGonderilebilir, bayatKalemVar, kalemSatirKdv } from './faturaDurumu';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi';

describe('siparisFaturaVar — "faturası VAR mı" (faturalı satış bayrağı DEĞİL)', () => {
  it('Mikro faturası satırı (MF-383 vakası): source mikro-fatura + faturali true + mikroFaturaNo → VAR', () => {
    expect(siparisFaturaVar({ source: 'mikro-fatura', faturali: true, mikroFaturaNo: '383' })).toBe(true);
  });
  it('backfill öncesi Mikro faturası: mikroFaturaNo YOK ama source mikro-fatura → yine VAR', () => {
    expect(siparisFaturaVar({ source: 'mikro-fatura', faturali: true })).toBe(true);
  });
  it('native sipariş, Cetpa faturası kesilmiş (hasInvoice) → VAR; Mikro numarası alınmış → VAR', () => {
    expect(siparisFaturaVar({ hasInvoice: true })).toBe(true);
    expect(siparisFaturaVar({ mikroFaturaNo: 'CTP2026000000174' })).toBe(true);
  });
  it('faturali:true tek başına fatura KANITI DEĞİLDİR (faturalı satış tipi) — mutasyon-ayırt-edici', () => {
    expect(siparisFaturaVar({ faturali: true })).toBe(false);
    expect(siparisFaturaVar({ faturali: true, hasInvoice: false })).toBe(false);
  });
  it('yalnız gerçek tipler: "true"/1/boş string fatura sayılmaz; null/undefined → yok', () => {
    expect(siparisFaturaVar({ hasInvoice: 'true' as never })).toBe(false);
    expect(siparisFaturaVar({ mikroFaturaNo: '   ' })).toBe(false);
    expect(siparisFaturaVar({ mikroFaturaNo: 1 as never })).toBe(false);
    expect(siparisFaturaVar(null)).toBe(false);
    expect(siparisFaturaVar(undefined)).toBe(false);
  });
});

describe('faturaKesilebilir — Fatura Kes düğmesi', () => {
  it('MF-383: Mikro faturası olan satırda düğme KAPALI (kullanıcı kuralı)', () => {
    expect(faturaKesilebilir({ source: 'mikro-fatura', faturali: true, mikroFaturaNo: '383' })).toBe(false);
  });
  it('parite: native, faturası yok, faturali undefined/true → AÇIK (eski `!hasInvoice && faturali !== false`)', () => {
    expect(faturaKesilebilir({})).toBe(true);
    expect(faturaKesilebilir({ faturali: true })).toBe(true);
  });
  it('faturasız satış (faturali:false) → KAPALI; Cetpa faturası varsa → KAPALI', () => {
    expect(faturaKesilebilir({ faturali: false })).toBe(false);
    expect(faturaKesilebilir({ hasInvoice: true })).toBe(false);
  });
});

describe('mikroyaFaturaGonderilebilir — Mikro e-Fatura push düğmesi', () => {
  it('Mikro numarası alınmışsa ya da satır Mikro faturasıysa KAPALI (çift e-Fatura yolu)', () => {
    expect(mikroyaFaturaGonderilebilir({ mikroFaturaNo: '383' })).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ source: 'mikro-fatura' })).toBe(false);
  });
  it('Cetpa-iç fatura (hasInvoice) Mikro\'ya göndermeyi ENGELLEMEZ; faturali:false engeller', () => {
    expect(mikroyaFaturaGonderilebilir({ hasInvoice: true })).toBe(true);
    expect(mikroyaFaturaGonderilebilir({ faturali: false })).toBe(false);
    expect(mikroyaFaturaGonderilebilir({})).toBe(true);
  });
  it('çevrim içi mağaza siparişinde KAPALI: kalemde `price` yok, cari bağlı değil — gönderim hiçbir yoldan başarılı olamaz', () => {
    expect(MAGAZA_KAYNAGI).toBe('shopify_webhook');
    expect(mikroyaFaturaGonderilebilir({ source: MAGAZA_KAYNAGI })).toBe(false);
    // Eşleyici `faturali` YAZMAZ; biri sonradan true yazsa bile kapı kaynağa bakar (kalemde hâlâ `price` yok).
    expect(mikroyaFaturaGonderilebilir({ source: MAGAZA_KAYNAGI, faturali: true })).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ source: MAGAZA_KAYNAGI, hasInvoice: true })).toBe(false);
  });
  it('mağaza kapısı yalnız O kaynağı kapatır: kaynaksız (elle girilen "SHP-…" dâhil), pazaryeri ve Mikro siparişi eskisi gibi AÇIK', () => {
    expect(mikroyaFaturaGonderilebilir({ source: undefined })).toBe(true);
    expect(mikroyaFaturaGonderilebilir({ source: 'Trendyol' })).toBe(true);
    expect(mikroyaFaturaGonderilebilir({ source: 'mikro-siparis' })).toBe(true);
  });
  it('`faturaKesilebilir` mağaza siparişinde DEĞİŞMEDİ (düğme yalnız Muhasebe sekmesine götürür; kapatmak "faturasız satış" anlamına çekerdi)', () => {
    expect(faturaKesilebilir({ source: MAGAZA_KAYNAGI })).toBe(true);
    expect(siparisFaturaVar({ source: MAGAZA_KAYNAGI })).toBe(false);
  });
});

// ── Bayat kalem (2026-10-08) ─────────────────────────────────────────────────────────────────────────────────────
// Satır KDV'si kalemin `vatRate`'iyle yazılır. Sipariş oranı ondan farklıysa kalem eski orana aittir: belge kesilmez.
describe('bayatKalemVar — satır KDV\'si sipariş oranından FARKLI bir orana ait kalem varsa fatura isteği gönderilmez', () => {
  const taze = { sku: 'A', price: 250, quantity: 12, netTutar: 3000, kdv: 600, vatRate: 20 };
  const bayat = { ...taze, kdv: 300, vatRate: 10 };
  it('bayat kalem (kalem %10, sipariş %20) → true; tek bayat kalem yeter', () => {
    expect(bayatKalemVar({ kdvOran: 20, lineItems: [bayat] })).toBe(true);
    expect(bayatKalemVar({ kdvOran: 20, lineItems: [taze, bayat] })).toBe(true);
  });
  it('taze sipariş (her kalem sipariş oranında) → false; oran 0 da geçerli bir orandır', () => {
    expect(bayatKalemVar({ kdvOran: 20, lineItems: [taze, taze] })).toBe(false);
    expect(bayatKalemVar({ kdvOran: 0, lineItems: [{ ...taze, kdv: 0, vatRate: 0 }] })).toBe(false);
    expect(bayatKalemVar({ kdvOran: 0, lineItems: [taze] })).toBe(true);
  });
  it('sipariş oranı YOKSA karışmaz (sunucu 400 ile sebebini söyler): undefined / null / NaN / metin', () => {
    for (const kdvOran of [undefined, null, NaN, '20']) expect(bayatKalemVar({ kdvOran, lineItems: [bayat] })).toBe(false);
  });
  it('satır KDV\'si olmayan kalem (eski / faturasız) ve oranı olmayan kalem (pencere dışı) ENGELLEMEZ', () => {
    const kdvsiz = { sku: 'A', price: 250, quantity: 12, vatRate: 10 };
    const oransiz = { sku: 'A', price: 250, quantity: 12, kdv: 600 };
    expect(bayatKalemVar({ kdvOran: 20, lineItems: [kdvsiz] })).toBe(false);
    expect(bayatKalemVar({ kdvOran: 20, lineItems: [oransiz] })).toBe(false);
    expect(bayatKalemVar({ kdvOran: 20, lineItems: [{ kdv: NaN, vatRate: 10 }] })).toBe(false);
  });
  it('kalemsiz / boş sipariş → false', () => {
    expect(bayatKalemVar({ kdvOran: 20 })).toBe(false);
    expect(bayatKalemVar({ kdvOran: 20, lineItems: null })).toBe(false);
    expect(bayatKalemVar({ kdvOran: 20, lineItems: [] })).toBe(false);
    expect(bayatKalemVar(null)).toBe(false);
    expect(bayatKalemVar(undefined)).toBe(false);
  });
});

describe('kalemSatirKdv — fatura isteğine konacak satır KDV\'si yalnız kalem oranı = sipariş oranı iken', () => {
  it('oranlar aynı → kalemin KDV\'si (0 dâhil); farklı → undefined; kalemde oran yok → undefined (hangi orana ait bilinmez)', () => {
    expect(kalemSatirKdv({ kdv: 8.33, vatRate: 20 }, 20)).toBe(8.33);
    expect(kalemSatirKdv({ kdv: 0, vatRate: 0 }, 0)).toBe(0);
    expect(kalemSatirKdv({ kdv: 8.33, vatRate: 10 }, 20)).toBeUndefined();
    expect(kalemSatirKdv({ kdv: 8.33 }, 20)).toBeUndefined();
  });
  it('KDV ya da sipariş oranı sayı değilse undefined — undefined === undefined eşleşmesi KDV göndertmez', () => {
    expect(kalemSatirKdv({ kdv: 8.33 }, undefined)).toBeUndefined();
    expect(kalemSatirKdv({ kdv: 8.33, vatRate: null }, null)).toBeUndefined();
    expect(kalemSatirKdv({ vatRate: 20 }, 20)).toBeUndefined();
    expect(kalemSatirKdv({ kdv: NaN, vatRate: 20 }, 20)).toBeUndefined();
    expect(kalemSatirKdv({ kdv: '8.33', vatRate: 20 }, 20)).toBeUndefined();
  });
});
