/** sirMaske — settings sırlarının maskelenmesi (tek kaynak). 2026-10-02: çekirdek server.ts kapanışındaydı ve HİÇ testi yoktu. */
import { describe, it, expect } from 'vitest';
import { sirMaskele, rolIcinMaskele, maskeyiGeriYukle, farkDegeriMaskele, sirAlaniMi, ayarAdresAlaniDegisti, adresAlaniMi, MASKE } from './sirMaske';

describe('sirAlaniMi — kod tabanında settings\'e yazılan GERÇEK alan adları', () => {
  it('sır alanları tanınır', () => {
    for (const a of ['idmPassword', 'password', 'sifre', 'apiKey', 'api_key', 'apiSecret', 'clientSecret', 'refreshToken', 'accessToken',
      'access_token', 'shopify_access_token', 'shopify_api_secret', 'webhookSecret', 'geminiApiKey', 'privateKey', 'iyzicoToken', 'smtpPass', 'parola']) {
      expect(sirAlaniMi(a), a).toBe(true);
    }
  });
  it('sır OLMAYAN alanlar maskelenmez (ekran bozulmasın)', () => {
    for (const a of ['supplierId', 'merchantId', 'username', 'email', 'idmEmail', 'alias', 'firmaKodu', 'calismaYili', 'kullaniciKodu', 'shopDomain',
      'marketplaceId', 'region', 'geminiModel', 'companyId', 'name', undefined]) {
      expect(sirAlaniMi(a), String(a)).toBe(false);
    }
  });
});

describe('sirMaskele', () => {
  it('üst düzey, iç içe ve dizi içindeki sırları maskeler; sır olmayan alan ve boş metin aynen kalır', () => {
    expect(sirMaskele({ apiKey: 'k1', supplierId: 's1', bos: { password: '' }, ic: { mikro: { idmPassword: 'p', alias: 'a' } }, apiKeys: ['a', 'b'], n: 5 }))
      .toEqual({ apiKey: MASKE, supplierId: 's1', bos: { password: '' }, ic: { mikro: { idmPassword: MASKE, alias: 'a' } }, apiKeys: [MASKE, MASKE], n: 5 });
  });
  it('sır adlı alanın değeri NESNE ise altındaki metinler de maskelenir (üst anahtar miras kalır)', () => {
    expect(sirMaskele({ token: { value: 'abc', expires: 5 }, credentials: { user: 'u', pass: 'p' } }))
      .toEqual({ token: { value: MASKE, expires: 5 }, credentials: { user: MASKE, pass: MASKE } });
  });
});

describe('rolIcinMaskele', () => {
  const d = { apiKey: 'gizli', x: 1 };
  it('settings: Admin düz, diğer her rol (Manager dâhil) ve rolsüz maskeli', () => {
    expect(rolIcinMaskele('Admin', 'settings', d)).toBe(d);
    for (const rol of ['Manager', 'Sales', 'Accounting', null] as const) expect(rolIcinMaskele(rol, 'settings', d)).toEqual({ apiKey: MASKE, x: 1 });
  });
  it('settings dışı koleksiyon ve boş veri: aynen', () => {
    expect(rolIcinMaskele('Manager', 'orders', d)).toBe(d);
    expect(rolIcinMaskele('Manager', 'settings', null)).toBeNull();
  });
});

describe('maskeyiGeriYukle — maskeli form kaydı gerçek sırrı EZMEZ ve SİLMEZ', () => {
  const ONCEKI = { apiKey: 'gercek', supplierId: 's1', companySettings: { shopify_access_token: 'shpat_x', store: 'cetpa' }, anahtarlar: ['k1', 'k2'] };
  it('üst düzey maske → önceki değer; değişen sır aynen yazılır', () => {
    expect(maskeyiGeriYukle('settings', { apiKey: MASKE, supplierId: 's2' }, ONCEKI)).toEqual({ apiKey: 'gercek', supplierId: 's2' });
    expect(maskeyiGeriYukle('settings', { apiKey: 'yeni' }, ONCEKI)).toEqual({ apiKey: 'yeni' });
  });
  it('İÇ İÇE maske → önceki iç değer geri konur (eski kod maskeyi sırrın üzerine yazıyordu)', () => {
    expect(maskeyiGeriYukle('settings', { companySettings: { shopify_access_token: MASKE, store: 'yeni-ad' } }, ONCEKI))
      .toEqual({ companySettings: { shopify_access_token: 'shpat_x', store: 'yeni-ad' } });
  });
  it('dizi: aynı sıradaki eski eleman; öncesi olmayan maske DÜŞER (uydurma değer yazılmaz)', () => {
    expect(maskeyiGeriYukle('settings', { anahtarlar: [MASKE, 'yeni', MASKE] }, ONCEKI)).toEqual({ anahtarlar: ['k1', 'yeni'] });
    expect(maskeyiGeriYukle('settings', { yeniSir: MASKE, ic: { token: MASKE } }, ONCEKI)).toEqual({ ic: {} });
    expect(maskeyiGeriYukle('settings', { apiKey: MASKE }, undefined)).toEqual({});
  });
  it('nokta-yollu yama anahtarı (updateDoc `a.b`) önceki değeri o yoldan okur', () => {
    expect(maskeyiGeriYukle('settings', { 'companySettings.shopify_access_token': MASKE }, ONCEKI)).toEqual({ 'companySettings.shopify_access_token': 'shpat_x' });
  });
  it('settings dışı koleksiyonda dokunulmaz (bir alanın değeri gerçekten bu metin olabilir)', () => {
    const g = { not: MASKE };
    expect(maskeyiGeriYukle('orders', g, {})).toBe(g);
  });
});

describe('farkDegeriMaskele — denetim kaydına düz metin sır girmez', () => {
  it('sır adlı alan ve içinde sır taşıyan nesne maskelenir; diğerleri aynen', () => {
    expect(farkDegeriMaskele('apiKey', 'abc')).toBe(MASKE);
    expect(farkDegeriMaskele('companySettings', { shopify_api_secret: 's', store: 'x' })).toEqual({ shopify_api_secret: MASKE, store: 'x' });
    expect(farkDegeriMaskele('status', 'Shipped')).toBe('Shipped');
    expect(farkDegeriMaskele('apiKey', undefined)).toBeUndefined();
    expect(farkDegeriMaskele('apiKey', '')).toBe('');
  });
});

describe('ayarAdresAlaniDegisti — bağlantı adresini değiştiren yazma (sırrı görmeden çalma yolu)', () => {
  const ONCEKI = { apiKey: 'k', baseUrl: 'https://api.luca.com.tr', ic: { serviceLayerUrl: 'https://sap.ornek:50000' }, companySettings: { logoUrl: 'a.png', website: 'x' } };
  it('adres alanları tanınır; görsel / site adresi zararsızdır', () => {
    for (const a of ['baseUrl', 'serviceLayerUrl', 'sapServiceLayerUrl', 'shopify_store_url', 'smtpHost', 'apiEndpoint', 'shopDomain', 'smtpServer', 'webhookUrl', 'logoApiUrl', 'logoHost', 'siteServer', 'apiUrl', 'endpoint']) expect(adresAlaniMi(a), a).toBe(true);
    // Zararsız = TAM AD (görsel/site + url): `logoApiUrl` Logo ERP'nin bağlantı adresidir, ön eke bakılırken 'logo görseli' sayılıyordu.
    for (const a of ['logoUrl', 'logo_url', 'websiteUrl', 'photoURL', 'siteUrl', 'imageUrl', 'apiKey', 'adres', 'name']) expect(adresAlaniMi(a), a).toBe(false);
  });
  it('değişen adres alanının yolu döner (üst düzey, iç içe, nokta-yollu yama)', () => {
    expect(ayarAdresAlaniDegisti({ baseUrl: 'https://saldirgan.example' }, ONCEKI)).toBe('baseUrl');
    expect(ayarAdresAlaniDegisti({ ic: { serviceLayerUrl: 'http://10.0.0.5' } }, ONCEKI)).toBe('ic.serviceLayerUrl');
    expect(ayarAdresAlaniDegisti({ 'ic.serviceLayerUrl': 'http://10.0.0.5' }, ONCEKI)).toBe('ic.serviceLayerUrl');
    expect(ayarAdresAlaniDegisti({ baseUrl: 'https://yeni' }, undefined)).toBe('baseUrl');          // ilk kez yazmak da değişikliktir
  });
  it('AYNI değeri yeniden göndermek, sır / sır olmayan alanı ya da zararsız adresi değiştirmek engel DEĞİL', () => {
    expect(ayarAdresAlaniDegisti({ baseUrl: 'https://api.luca.com.tr', apiKey: 'yeni' }, ONCEKI)).toBeNull();
    expect(ayarAdresAlaniDegisti({ companySettings: { logoUrl: 'b.png', website: 'y' } }, ONCEKI)).toBeNull();
    expect(ayarAdresAlaniDegisti({ hedef: 5 }, ONCEKI)).toBeNull();
  });
  it('boş ile EKSİK aynıdır (dokunulmamış adres kutusu) — ama dolu adresi boşaltmak değişikliktir', () => {
    expect(ayarAdresAlaniDegisti({ sapServiceLayerUrl: '', enabled: true }, { apiKey: 'k' })).toBeNull();
    expect(ayarAdresAlaniDegisti({ baseUrl: null }, undefined)).toBeNull();
    expect(ayarAdresAlaniDegisti({ 'companySettings.shopify_store_url': '' }, ONCEKI)).toBeNull();
    expect(ayarAdresAlaniDegisti({ baseUrl: '' }, ONCEKI)).toBe('baseUrl');
  });
});
