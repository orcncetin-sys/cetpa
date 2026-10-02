import { describe, it, expect } from 'vitest';
import { izinliTaban, genelHttpsTaban, genelAdresMi, TabanAdresHatasi, LUCA_TABAN, IYZICO_TABAN } from './guvenliTaban';

// 2026-10-02 — `settings.luca.baseUrl` saldırganın sunucusuna çevrilince sunucu Bearer anahtarını oraya gönderiyordu.
describe('izinliTaban — sağlayıcı adresi sabit olan entegrasyonlar', () => {
  it('boş değer varsayılana gider (ayar hiç girilmemiş)', () => {
    for (const bos of [undefined, null, '', '   ']) expect(izinliTaban(bos, LUCA_TABAN)).toBe('https://api.luca.com.tr');
    expect(izinliTaban('', IYZICO_TABAN)).toBe('https://sandbox-api.iyzipay.com');
  });
  it('izinli host kabul edilir; sondaki eğik çizgi, sorgu ve parça atılır, yol korunur', () => {
    expect(izinliTaban('https://api.luca.com.tr/', LUCA_TABAN)).toBe('https://api.luca.com.tr');
    expect(izinliTaban('https://API.LUCA.com.tr/v2/?a=1#x', LUCA_TABAN)).toBe('https://api.luca.com.tr/v2');
    expect(izinliTaban('https://api.iyzipay.com', IYZICO_TABAN)).toBe('https://api.iyzipay.com');
    expect(izinliTaban('https://sandbox-api.iyzipay.com', IYZICO_TABAN)).toBe('https://sandbox-api.iyzipay.com');
  });
  it('yabancı host, benzer görünen host, http, kapı, kimlikli adres ve bozuk metin REDDEDİLİR — varsayılana sessizce dönülmez', () => {
    const kotu = [
      'https://saldirgan.example',
      'https://api.luca.com.tr.saldirgan.example',
      'https://saldirgan.example/api.luca.com.tr',
      'https://api.luca.com.tr@saldirgan.example',
      'https://saldirgan.example\\@api.luca.com.tr',
      'https://kullanici:parola@api.luca.com.tr',
      'http://api.luca.com.tr',
      'https://api.luca.com.tr:8443',
      'ftp://api.luca.com.tr',
      'api.luca.com.tr',
      'adres değil',
    ];
    for (const k of kotu) expect(() => izinliTaban(k, LUCA_TABAN), k).toThrow(TabanAdresHatasi);
    expect(() => izinliTaban('https://api.luca.com.tr', IYZICO_TABAN)).toThrow(TabanAdresHatasi);
  });
  it('hata metni sırrı ya da girilen adresi YANKILAMAZ — yalnız kuralı söyler', () => {
    try { izinliTaban('https://saldirgan.example/?anahtar=gizli', LUCA_TABAN); expect.unreachable(); }
    catch (e) { expect((e as Error).message).not.toMatch(/saldirgan|gizli/); expect((e as Error).message).toContain('api.luca.com.tr'); }
  });
});

describe('genelAdresMi — SSRF kapısı', () => {
  it('genel adres geçer — `fc` / `fd` / `fe80` ile BAŞLAYAN alan adı da (IPv6 ön eki alan adına uygulanmaz)', () => {
    for (const a of ['https://sap.musteri.example:50000/b1s/v1', 'http://ornek.com', 'https://fc-erp.musteri.com/b1s/v1', 'https://fdsap.firma.com.tr', 'https://fe80kargo.example', 'https://8.8.8.8', 'https://[2001:4860:4860::8888]/',
      // rakamla başlayan ALAN ADI iç ağ değildir (sayısal aralık kuralı yalnız IPv4 yazımına)
      'https://10.musteri.com/kanca', 'https://0.ornek.com/kanca', 'https://127.example.com', 'https://172.20.example.org', 'https://192.168.example.com']) {
      expect(genelAdresMi(a), a).toBe(true);
    }
  });
  it('döngü, iç ağ, bağlantı-yerel, metadata ve bunların IPv6 / sayısal yazımları reddedilir', () => {
    const kotu = [
      'https://localhost', 'https://localhost.', 'https://a.localhost', 'https://127.0.0.1', 'https://127.1', 'https://2130706433', 'https://0x7f000001',
      'https://0.0.0.0', 'https://10.0.0.5', 'https://192.168.1.1', 'https://172.16.0.1', 'https://172.31.255.255', 'https://169.254.169.254',
      'https://sunucu.internal', 'https://yazici.local',
      'https://[::1]', 'https://[::1]:8443/b1s/v1', 'https://[::]', 'https://[fd12::5]:50000', 'https://[fc00::1]', 'https://[fe80::1]',
      'https://[::ffff:127.0.0.1]/x', 'https://[::ffff:7f00:1]', 'https://[64:ff9b::7f00:1]',
      'ftp://ornek.com', 'file:///etc/passwd', 'adres değil', '',
    ];
    for (const a of kotu) expect(genelAdresMi(a), a).toBe(false);
  });
  it('172.x aralığının yalnız özel bölümü engellenir', () => {
    expect(genelAdresMi('https://172.15.0.1')).toBe(true);
    expect(genelAdresMi('https://172.32.0.1')).toBe(true);
  });
});

describe('genelHttpsTaban — müşterinin kendi sunucusu (SAP Service Layer)', () => {
  const genelMi = genelAdresMi;
  it('https + genel adres kabul; kapı ve yol korunur', () => {
    expect(genelHttpsTaban('https://sap.musteri.example:50000/b1s/v1/', 'SAP', genelMi)).toBe('https://sap.musteri.example:50000/b1s/v1');
  });
  it('http, iç ağ, kimlikli adres ve boş değer reddedilir', () => {
    for (const k of ['http://sap.musteri.example', 'https://127.0.0.1:50000/b1s/v1', 'https://10.0.0.5/b1s', 'https://[::1]:8443/b1s/v1', 'https://a:b@sap.musteri.example', '', undefined]) {
      expect(() => genelHttpsTaban(k, 'SAP', genelMi), String(k)).toThrow(TabanAdresHatasi);
    }
  });
});
