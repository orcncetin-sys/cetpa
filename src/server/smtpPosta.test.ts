// @vitest-environment node
/**
 * smtpPosta — SMTP gönderimi (mağaza talebi bildirimi, kullanıcı kararı K2).
 *
 * DÖRT kanıt katmanı:
 *  1) sahte taşıyıcı: `createTransport`'a GEÇEN seçenekler (secure / requireTLS /
 *     TLS / süre sınırları), yapılandırma eksikken bağlantının DENENMEMESİ, asla
 *     fırlatmama, hata sınıfının kapalı küme oluşu.
 *  2) kaynak çiti: sertifika doğrulamasını kapatan seçenekler modülde YOK
 *     (yorumlar süzülür — modülün kendi açıklaması yasak adları anıyor).
 *  3) GERÇEK soket: yerel sahte SMTP sunucusuna GERÇEK nodemailer ile bağlanılır —
 *     STARTTLS sunulmayınca ve sertifika kendinden imzalıyken kimlik bilgisi
 *     sunucuya HİÇ ulaşmıyor mu. (465 örtük TLS yolu gerçek soketle sınanamaz:
 *     ayrıcalıklı kapı. O yolun ölçümü elle yapıldı; seçenekleri katman 1 kilitler.)
 *  4) dağıtım şablonu çiti: SMTP anahtar ADLARI `deploy/windows/env.example`'da,
 *     değersiz ve salt-ASCII.
 *
 * Hata nesnesi örnekleri UYDURMA DEĞİL: nodemailer 10.0.16 + Node 24 ile yerel
 * sahte sunucuya karşı ölçülen biçimler (2026-10-08). İki istisna, adında yazar:
 * «sınır:» satırları (yanıt kodu aralığının uçları — sentetik) ve «kaynaktan» satırı
 * (sunucuya gitmeden oluşan hata; biçimi nodemailer kaynağından okundu).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SMTPTransportOptions, SendMailOptions } from 'nodemailer';
import { sertIhlalleri, yorumsuz } from '../test/degismezTarayici';

// `createTransport` gözlenir ama varsayılan olarak GERÇEĞİNE geçer (katman 3);
// katman 1 testleri `mockImplementationOnce` ile sahte taşıyıcı verir.
vi.mock('nodemailer', async (asliniGetir) => {
  const asil = await asliniGetir<typeof import('nodemailer')>();
  return { ...asil, createTransport: vi.fn(asil.createTransport) };
});

import { createTransport } from 'nodemailer';
import { smtpYapilandirmasi, smtpHataSinifi, smtpGonder, smtpDogrula, SMTP_DOGRULAMA_SINIRI_MS } from './smtpPosta';
import { MAGAZA_BILDIRIM_HATA_SINIFLARI } from '../lib/magazaTalep';

const uretici = vi.mocked(createTransport);

const ANAHTARLAR = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'MAGAZA_BILDIRIM_ALICI'] as const;
const TAM = {
  SMTP_HOST: 'posta.ornek.test',
  SMTP_USER: 'bildirim@ornek.test',
  SMTP_PASS: 'cok-gizli-parola-9f3',
  MAGAZA_BILDIRIM_ALICI: 'iletisim@ornek.test',
} as const;
const ILETI = { konu: 'Yeni mağaza talebi: T261008-5Y9P', html: '<p>gövde</p>', metin: 'gövde' };

/** Süreç ortamını kur: listelenmeyen SMTP anahtarı TANIMSIZ olur (geliştirici makinesindeki değer sızmasın). */
function ortamKur(degerler: Partial<Record<typeof ANAHTARLAR[number], string>>): void {
  for (const ad of ANAHTARLAR) vi.stubEnv(ad, degerler[ad]);
}

interface SahteTasiyici {
  sendMail: ReturnType<typeof vi.fn<(ileti: SendMailOptions) => unknown>>;
  verify: ReturnType<typeof vi.fn<() => unknown>>;
  close: ReturnType<typeof vi.fn<() => void>>;
}

/** Bir SONRAKİ `createTransport` çağrısına sahte taşıyıcı verir. */
function sahteTasiyici(o: { sendMail?: (ileti: SendMailOptions) => unknown; verify?: () => unknown; close?: () => void } = {}): SahteTasiyici {
  const t: SahteTasiyici = {
    sendMail: vi.fn(o.sendMail ?? (async () => ({ accepted: [TAM.MAGAZA_BILDIRIM_ALICI], rejected: [] }))),
    verify: vi.fn(o.verify ?? (async () => true)),
    close: vi.fn(o.close ?? (() => {})),
  };
  uretici.mockImplementationOnce(() => t as unknown as ReturnType<typeof createTransport>);
  return t;
}

const secenekler = (cagri = 0): SMTPTransportOptions => uretici.mock.calls[cagri][0] as SMTPTransportOptions;
const hata = (ileti: string, ek: Record<string, unknown>): Error => Object.assign(new Error(ileti), ek);

beforeEach(() => {
  uretici.mockReset();   // sıradaki sahteleri atar, GERÇEK `createTransport`'a geçişi geri kurar
  ortamKur({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('smtpYapilandirmasi — tek kaynak, yalnız anahtar ADI', () => {
  it('hiçbir anahtar yokken dört zorunlu ad eksik; SMTP_PORT ve SMTP_FROM zorunlu DEĞİL', () => {
    expect(smtpYapilandirmasi({})).toEqual({ tamam: false, eksik: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAGAZA_BILDIRIM_ALICI'] });
  });

  it('dört zorunlu anahtar varken tamam (kapı ve gönderici verilmeden)', () => {
    expect(smtpYapilandirmasi({ ...TAM })).toEqual({ tamam: true, eksik: [] });
  });

  it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAGAZA_BILDIRIM_ALICI'] as const)('%s tek başına eksikse yalnız o ad döner', (ad) => {
    const ortam: Record<string, string | undefined> = { ...TAM };
    delete ortam[ad];
    expect(smtpYapilandirmasi(ortam)).toEqual({ tamam: false, eksik: [ad] });
    expect(smtpYapilandirmasi({ ...TAM, [ad]: '' })).toEqual({ tamam: false, eksik: [ad] });
  });

  it('yalnız boşluktan oluşan sunucu / kullanıcı / alıcı eksik sayılır', () => {
    expect(smtpYapilandirmasi({ ...TAM, SMTP_HOST: '   ', SMTP_USER: '\t', MAGAZA_BILDIRIM_ALICI: ' ' }).eksik)
      .toEqual(['SMTP_HOST', 'SMTP_USER', 'MAGAZA_BILDIRIM_ALICI']);
  });

  it.each(['iletisim', 'iletisim@cetpa', 'ilet isim@cetpa.com.tr', 'a@b.com,c@d.com', '@cetpa.com.tr'])(
    'alıcı geçerli e-posta değilse («%s») eksik sayılır', (alici) => {
      expect(smtpYapilandirmasi({ ...TAM, MAGAZA_BILDIRIM_ALICI: alici })).toEqual({ tamam: false, eksik: ['MAGAZA_BILDIRIM_ALICI'] });
    });

  it.each([undefined, '', '   ', '465', '587', ' 587 ', '25', '1', '65535'])('kapı «%s» kabul edilir', (kapi) => {
    expect(smtpYapilandirmasi({ ...TAM, SMTP_PORT: kapi })).toEqual({ tamam: true, eksik: [] });
  });

  it.each(['0', '65536', '999999', '465.0', '4e2', '-1', '+587', 'abc', '587abc', '0x1D1', '5 87'])(
    'kapı «%s» bozuk → «eksik» (sessizce 465\'e dönülmez)', (kapi) => {
      expect(smtpYapilandirmasi({ ...TAM, SMTP_PORT: kapi })).toEqual({ tamam: false, eksik: ['SMTP_PORT'] });
    });

  it('dönen değer yalnız AD taşır — parola, kullanıcı, sunucu, bozuk kapı / alıcı DEĞERİ sızmaz', () => {
    const sonuc = smtpYapilandirmasi({ SMTP_HOST: 'gizli-sunucu.test', SMTP_USER: 'gizli-kullanici', SMTP_PASS: 'gizli-parola', SMTP_PORT: 'gizli-kapi', SMTP_FROM: 'gizli-gonderici', MAGAZA_BILDIRIM_ALICI: 'gizli-alici' });
    expect(sonuc).toEqual({ tamam: false, eksik: ['SMTP_PORT', 'MAGAZA_BILDIRIM_ALICI'] });
    expect(JSON.stringify(sonuc)).not.toMatch(/gizli/);
    for (const ad of sonuc.eksik) expect(ANAHTARLAR).toContain(ad);
  });

  it('parametresiz çağrı süreç ortamını okur', () => {
    expect(smtpYapilandirmasi().tamam).toBe(false);
    ortamKur({ ...TAM });
    expect(smtpYapilandirmasi()).toEqual({ tamam: true, eksik: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('yapılandırma eksikken bağlantı DENENMEZ', () => {
  const EKSIK_DURUMLAR: Array<[string, Partial<Record<typeof ANAHTARLAR[number], string>>]> = [
    ['hiçbir anahtar yok', {}],
    ['sunucu yok', { ...TAM, SMTP_HOST: '' }],
    ['kullanıcı yok', { ...TAM, SMTP_USER: '' }],
    ['parola yok', { ...TAM, SMTP_PASS: '' }],
    ['alıcı yok', { ...TAM, MAGAZA_BILDIRIM_ALICI: '' }],
    ['alıcı e-posta değil', { ...TAM, MAGAZA_BILDIRIM_ALICI: 'iletisim' }],
    ['kapı bozuk', { ...TAM, SMTP_PORT: '587abc' }],
    ['kapı aralık dışı', { ...TAM, SMTP_PORT: '70000' }],
  ];

  it.each(EKSIK_DURUMLAR)('smtpGonder — %s → yapilandirilmamis, taşıyıcı ÜRETİLMEZ', async (_ad, ortam) => {
    ortamKur(ortam);
    expect(await smtpGonder(ILETI)).toEqual({ ok: false, yapilandirilmamis: true });
    expect(uretici).not.toHaveBeenCalled();
  });

  it.each(EKSIK_DURUMLAR)('smtpDogrula — %s → yapilandirilmamis, taşıyıcı ÜRETİLMEZ', async (_ad, ortam) => {
    ortamKur(ortam);
    expect(await smtpDogrula()).toEqual({ ok: false, yapilandirilmamis: true });
    expect(uretici).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('bağlantı seçenekleri', () => {
  it('kapı verilmemişse 465 + örtük TLS; requireTLS gerekmez', async () => {
    ortamKur({ ...TAM });
    sahteTasiyici();
    expect(await smtpGonder(ILETI)).toEqual({ ok: true });
    expect(uretici).toHaveBeenCalledTimes(1);
    const s = secenekler();
    expect(s.host).toBe(TAM.SMTP_HOST);
    expect(s.port).toBe(465);
    expect(s.secure).toBe(true);
    expect(s.requireTLS).toBeUndefined();
    expect(s.auth).toEqual({ user: TAM.SMTP_USER, pass: TAM.SMTP_PASS });
  });

  it('sunucu ve kullanıcı adı çevresindeki boşluk atılır; PAROLA kırpılmaz (boşluk parolanın parçası olabilir)', async () => {
    ortamKur({ ...TAM, SMTP_HOST: '  posta.ornek.test ', SMTP_USER: ' bildirim@ornek.test  ', SMTP_PASS: '  iki yanı boşluklu  ', MAGAZA_BILDIRIM_ALICI: ' iletisim@ornek.test ' });
    const t = sahteTasiyici();
    expect(await smtpGonder(ILETI)).toEqual({ ok: true });
    expect(secenekler().host).toBe('posta.ornek.test');
    expect(secenekler().auth).toEqual({ user: 'bildirim@ornek.test', pass: '  iki yanı boşluklu  ' });
    expect(t.sendMail.mock.calls[0][0]).toMatchObject({ from: 'bildirim@ornek.test', to: { name: '', address: 'iletisim@ornek.test' } });
  });

  it.each(['587', '25', '2525', '466'])('kapı %s (465 değil) → secure kapalı + STARTTLS ZORUNLU', async (kapi) => {
    ortamKur({ ...TAM, SMTP_PORT: kapi });
    sahteTasiyici();
    await smtpGonder(ILETI);
    const s = secenekler();
    expect(s.port).toBe(Number(kapi));
    expect(s.secure).toBe(false);
    expect(s.requireTLS).toBe(true);
  });

  it('kapı açıkça 465 yazılmışsa da örtük TLS', async () => {
    ortamKur({ ...TAM, SMTP_PORT: '465' });
    sahteTasiyici();
    await smtpGonder(ILETI);
    expect(secenekler()).toMatchObject({ port: 465, secure: true });
    expect(secenekler().requireTLS).toBeUndefined();
  });

  it.each(['465', '587'])('TLS (kapı %s): en az TLSv1.2, doğrulama AÇIKÇA açık; düşüş / atlama seçeneği yok', async (kapi) => {
    ortamKur({ ...TAM, SMTP_PORT: kapi });
    sahteTasiyici();
    await smtpGonder(ILETI);
    const s = secenekler();
    expect(s.tls).toEqual({ minVersion: 'TLSv1.2', rejectUnauthorized: true });
    expect(s.ignoreTLS).toBeUndefined();
    expect(s.opportunisticTLS).toBeUndefined();
    // Günlükçü / hata ayıklama açık olsaydı SMTP trafiği (ileti gövdesi dâhil) konsola dökülürdü.
    expect(s.logger).toBeUndefined();
    expect(s.debug).toBeUndefined();
  });

  it('bağlantı / karşılama / soket süre sınırları 10–15 sn; DNS de sınırlı', async () => {
    ortamKur({ ...TAM });
    sahteTasiyici();
    await smtpGonder(ILETI);
    const s = secenekler();
    for (const ad of ['connectionTimeout', 'greetingTimeout', 'socketTimeout'] as const) {
      expect(s[ad], ad).toBeGreaterThanOrEqual(10_000);
      expect(s[ad], ad).toBeLessThanOrEqual(15_000);
    }
    expect(s.dnsTimeout).toBeGreaterThanOrEqual(1_000);
    expect(s.dnsTimeout).toBeLessThanOrEqual(15_000);
  });

  it('ileti: gönderici SMTP_FROM, alıcı TEK adres (nesne biçimi), konu / metin / HTML aynen; kopya alıcı ve ek yok', async () => {
    ortamKur({ ...TAM, SMTP_FROM: 'CETPA Mağaza <magaza@ornek.test>' });
    const t = sahteTasiyici();
    await smtpGonder(ILETI);
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    expect(t.sendMail.mock.calls[0][0]).toEqual({
      from: 'CETPA Mağaza <magaza@ornek.test>',
      to: { name: '', address: TAM.MAGAZA_BILDIRIM_ALICI },
      subject: ILETI.konu,
      text: ILETI.metin,
      html: ILETI.html,
    });
  });

  it('SMTP_FROM yoksa (ya da boşsa) gönderici SMTP_USER', async () => {
    ortamKur({ ...TAM });
    const t1 = sahteTasiyici();
    await smtpGonder(ILETI);
    expect(t1.sendMail.mock.calls[0][0].from).toBe(TAM.SMTP_USER);

    ortamKur({ ...TAM, SMTP_FROM: '  ' });
    const t2 = sahteTasiyici();
    await smtpGonder(ILETI);
    expect(t2.sendMail.mock.calls[0][0].from).toBe(TAM.SMTP_USER);
  });

  it('smtpDogrula AYNI seçeneklerle bağlanır, verify çağırır, posta GÖNDERMEZ', async () => {
    ortamKur({ ...TAM, SMTP_PORT: '587' });
    const g = sahteTasiyici();
    await smtpGonder(ILETI);
    const d = sahteTasiyici();
    expect(await smtpDogrula()).toEqual({ ok: true });
    expect(secenekler(1)).toEqual(secenekler(0));
    expect(d.verify).toHaveBeenCalledTimes(1);
    expect(d.sendMail).not.toHaveBeenCalled();
    expect(g.verify).not.toHaveBeenCalled();
  });

  it('taşıyıcı başarıda da başarısızlıkta da kapatılır', async () => {
    ortamKur({ ...TAM });
    const iyi = sahteTasiyici();
    await smtpGonder(ILETI);
    expect(iyi.close).toHaveBeenCalledTimes(1);

    const kotu = sahteTasiyici({ sendMail: async () => { throw hata('Connection closed unexpectedly', { code: 'ECONNECTION' }); } });
    await smtpGonder(ILETI);
    expect(kotu.close).toHaveBeenCalledTimes(1);

    const dogrula = sahteTasiyici({ verify: async () => { throw hata('Invalid login: 535', { code: 'EAUTH' }); } });
    await smtpDogrula();
    expect(dogrula.close).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('asla fırlatmaz — dışarıya yalnız SINIF çıkar', () => {
  const SIZMAMASI_GEREKEN = 'gizli-yanit-metni kutu-yok-7c1 iletisim@ornek.test';

  beforeEach(() => ortamKur({ ...TAM }));

  it('sendMail reddederse { ok: false, sinif } — hata metni sonuçta ve konsolda YOK', async () => {
    const konsol = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    for (const c of konsol) c.mockImplementation(() => {});
    sahteTasiyici({ sendMail: async () => { throw hata(`Can't send mail - all recipients were rejected: 550 ${SIZMAMASI_GEREKEN}`, { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, response: `550 ${SIZMAMASI_GEREKEN}`, rejected: [TAM.MAGAZA_BILDIRIM_ALICI] }); } });
    const sonuc = await smtpGonder(ILETI);
    expect(sonuc).toEqual({ ok: false, sinif: 'alici-reddi' });
    expect(JSON.stringify(sonuc)).not.toMatch(/gizli|kutu-yok|ornek\.test/);
    for (const c of konsol) { expect(c).not.toHaveBeenCalled(); c.mockRestore(); }
  });

  it('createTransport eşzamanlı fırlatırsa { ok: false, sinif: diger }', async () => {
    uretici.mockImplementationOnce(() => { throw new Error('bozuk seçenek'); });
    await expect(smtpGonder(ILETI)).resolves.toEqual({ ok: false, sinif: 'diger' });
    uretici.mockImplementationOnce(() => { throw new Error('bozuk seçenek'); });
    await expect(smtpDogrula()).resolves.toEqual({ ok: false, sinif: 'diger' });
  });

  it('sendMail / verify EŞZAMANLI fırlatırsa da söz reddetmez', async () => {
    sahteTasiyici({ sendMail: () => { throw hata('Timeout', { code: 'ETIMEDOUT' }); } });
    await expect(smtpGonder(ILETI)).resolves.toEqual({ ok: false, sinif: 'baglanti' });
    sahteTasiyici({ verify: () => { throw hata('Timeout', { code: 'ETIMEDOUT' }); } });
    await expect(smtpDogrula()).resolves.toEqual({ ok: false, sinif: 'baglanti' });
  });

  it.each([['dizge', 'patladı'], ['tanımsız', undefined], ['null', null], ['sayı', 42]])('hata olmayan ret (%s) → diger', async (_ad, deger) => {
    sahteTasiyici({ sendMail: () => Promise.reject(deger) });
    await expect(smtpGonder(ILETI)).resolves.toEqual({ ok: false, sinif: 'diger' });
    sahteTasiyici({ verify: () => Promise.reject(deger) });
    await expect(smtpDogrula()).resolves.toEqual({ ok: false, sinif: 'diger' });
  });

  it('kapatma fırlatsa da sonuç DEĞİŞMEZ', async () => {
    sahteTasiyici({ close: () => { throw new Error('kapatılamadı'); } });
    await expect(smtpGonder(ILETI)).resolves.toEqual({ ok: true });
    sahteTasiyici({ close: () => { throw new Error('kapatılamadı'); }, verify: async () => { throw hata('Invalid login: 535', { code: 'EAUTH' }); } });
    await expect(smtpDogrula()).resolves.toEqual({ ok: false, sinif: 'kimlik' });
  });

  it('alan okuması fırlatan hata nesnesi de sınıflanır (diger)', async () => {
    const tuzak = new Proxy({}, { has: () => { throw new Error('vekil'); }, get: () => { throw new Error('vekil'); } });
    expect(smtpHataSinifi(tuzak)).toBe('diger');
    sahteTasiyici({ sendMail: () => Promise.reject(tuzak) });
    await expect(smtpGonder(ILETI)).resolves.toEqual({ ok: false, sinif: 'diger' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('smtpHataSinifi — kapalı küme (ölçülen hata biçimleri)', () => {
  const SERTIFIKA_ILETISI = 'self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca';
  const DURUMLAR: Array<[string, unknown, string]> = [
    // kimlik
    ['535 kimlik reddi', hata('Invalid login: 535 5.7.8 Kimlik dogrulanamadi', { code: 'EAUTH', command: 'AUTH LOGIN', responseCode: 535 }), 'kimlik'],
    ['kimlik bilgisi boş', hata('Missing credentials for "LOGIN"', { code: 'EAUTH', command: 'API' }), 'kimlik'],
    ['kimlik bilgisi verilmedi (forceAuth)', hata('Authentication info was not provided', { code: 'ENOAUTH' }), 'kimlik'],
    // alıcı / zarf reddi — KALICI: 5xx ya da yanıt kodsuz
    ['alıcı reddi 550', hata("Can't send mail - all recipients were rejected: 550 5.1.1 kutu yok", { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, rejected: ['x@ornek.test'] }), 'alici-reddi'],
    ['gönderen reddi 550', hata('Mail command failed: 550 5.7.1', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 550 }), 'alici-reddi'],
    ['kaynaktan: alıcı tanımsız (yanıt kodu YOK — yapılandırma hatası, kalıcı)', hata("Can't send mail - no recipients defined", { code: 'EENVELOPE', command: 'API' }), 'alici-reddi'],
    ['kodsuz ama RCPT TO\'ya 5xx', hata('550 kutu yok', { command: 'RCPT TO', responseCode: 550 }), 'alici-reddi'],
    // GEÇİCİ (4xx) yanıt — kalıcı sınıfa GİRMEZ: `diger` olur, kuyruk yeniden dener
    ['alıcı geçici reddi 450 → diger', hata("Can't send mail - all recipients were rejected: 450 4.2.1", { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 450 }), 'diger'],
    ['alıcı geçici reddi 452 (yer yok) → diger', hata("Can't send mail - all recipients were rejected: 452 4.2.2 Mailbox full", { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 452, rejected: ['x@ornek.test'] }), 'diger'],
    ['gönderen geçici reddi 451 → diger', hata('Mail command failed: 451 4.3.0 Temporary failure', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 451 }), 'diger'],
    ['DATA komutu geçici reddi 451 → diger', hata('Data command failed: 451 4.3.0', { code: 'EENVELOPE', command: 'DATA', responseCode: 451 }), 'diger'],
    ['kimlik doğrulama geçici arızası 454 → diger (kimlik DEĞİL)', hata('Invalid login: 454 4.7.0 Temporary authentication failure', { code: 'EAUTH', command: 'AUTH LOGIN', responseCode: 454 }), 'diger'],
    ['kodsuz ama RCPT TO\'ya 4xx → diger', hata('450 4.2.1 Mailbox busy', { command: 'RCPT TO', responseCode: 450 }), 'diger'],
    // SINIR satırları (sentetik: aralığın uçlarını sınar, sunucudan ölçülmedi)
    ['sınır: zarf reddi 400 → diger', hata('Mail command failed: 400', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 400 }), 'diger'],
    ['sınır: zarf reddi 499 → diger', hata('Mail command failed: 499', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 499 }), 'diger'],
    ['sınır: zarf reddi 500 → alici-reddi', hata('Mail command failed: 500', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 500 }), 'alici-reddi'],
    ['sınır: zarf reddi 399 → alici-reddi (4xx değil)', hata('Mail command failed: 399', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 399 }), 'alici-reddi'],
    ['sınır: kimlik 499 → diger', hata('Invalid login: 499', { code: 'EAUTH', command: 'AUTH LOGIN', responseCode: 499 }), 'diger'],
    ['sınır: kimlik 500 → kimlik', hata('Invalid login: 500', { code: 'EAUTH', command: 'AUTH LOGIN', responseCode: 500 }), 'kimlik'],
    // TLS
    ['STARTTLS sunulmuyor (502)', hata('Error upgrading connection with STARTTLS: 502 5.5.1', { code: 'ETLS', command: 'STARTTLS', responseCode: 502 }), 'tls'],
    ['kendinden imzalı sertifika — kod ESOCKET, ayırt eden YALNIZ ileti', hata(SERTIFIKA_ILETISI, { code: 'ESOCKET', command: 'CONN' }), 'tls'],
    ['süresi dolmuş sertifika', hata('certificate has expired', { code: 'ESOCKET', command: 'CONN' }), 'tls'],
    ['zincir doğrulanamadı', hata('unable to verify the first certificate', { code: 'ESOCKET', command: 'CONN' }), 'tls'],
    ['ad uyuşmazlığı — Node hataya cert iliştirir', hata("Hostname/IP does not match certificate's altnames: IP: 127.0.0.1 is not in the cert's list: ", { code: 'ESOCKET', command: 'CONN', reason: "IP: 127.0.0.1 is not in the cert's list: ", host: '127.0.0.1', cert: {} }), 'tls'],
    ['cert alanı var, ileti boş', hata('', { code: 'ESOCKET', cert: {} }), 'tls'],
    ['TLS konuşmayan kapı (yanlış sürüm)', hata('C0613DF301000000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number:', { code: 'ESOCKET', command: 'CONN', library: 'SSL routines', reason: 'wrong version number' }), 'tls'],
    ['sunucu TLSv1.2 sunmuyor', hata('error:0A00042E:SSL routines:ssl3_read_bytes:tlsv1 alert protocol version', { code: 'ESOCKET', command: 'CONN', library: 'SSL routines', reason: 'tlsv1 alert protocol version' }), 'tls'],
    ['library alanı var, ileti boş', hata('', { code: 'ESOCKET', library: 'SSL routines' }), 'tls'],
    ['el sıkışma bitmeden kopma', hata('Client network socket disconnected before secure TLS connection was established', { code: 'ESOCKET', command: 'CONN' }), 'tls'],
    ['REQUIRETLS uzantısı desteklenmiyor', hata('Server does not support REQUIRETLS extension (RFC 8689)', { code: 'EREQUIRETLS', command: 'MAIL FROM' }), 'tls'],
    ['HELO STARTTLS desteklemiyor', hata('EHLO failed but HELO does not support required STARTTLS. response=502', { code: 'ECONNECTION', command: 'EHLO' }), 'tls'],
    // bağlantı
    ['bağlantı reddedildi', hata('connect ECONNREFUSED 127.0.0.1:1', { code: 'ESOCKET', command: 'CONN', errno: -61, syscall: 'connect', address: '127.0.0.1', port: 1 }), 'baglanti'],
    ['DNS bulunamadı', hata('getaddrinfo ENOTFOUND yok-boyle-bir-ad.invalid', { code: 'EDNS', command: 'CONN', syscall: 'getaddrinfo', hostname: 'yok-boyle-bir-ad.invalid' }), 'baglanti'],
    ['DNS — sunucu adında «tls» geçse de bağlantı', hata('getaddrinfo ENOTFOUND tls.ornek.test', { code: 'EDNS', command: 'CONN' }), 'baglanti'],
    ['karşılama gelmedi', hata('Greeting never received', { code: 'ETIMEDOUT', command: 'CONN' }), 'baglanti'],
    ['bağlantı zaman aşımı', hata('Connection timeout', { code: 'ETIMEDOUT', command: 'CONN' }), 'baglanti'],
    ['bağlantı koptu', hata('Connection closed unexpectedly', { code: 'ECONNECTION', command: 'CONN' }), 'baglanti'],
    // diğer
    ['ileti gövdesi reddi 554', hata('Message failed: 554 5.7.1 Icerik reddedildi', { code: 'EMESSAGE', command: 'DATA', responseCode: 554 }), 'diger'],
    ['geçersiz sunucu yanıtı', hata('Invalid greeting. response=xyz', { code: 'EPROTOCOL', command: 'CONN' }), 'diger'],
    ['kodsuz hata', new Error('bilinmeyen'), 'diger'],
    ['kodsuz hata — iletide «certificate» geçse de (kod yoksa iz aranmaz)', new Error('certificate'), 'diger'],
    ['kimlik reddi yanıtında «TLS» geçse de kimlik', hata('Invalid login: 530 5.7.0 Must issue a STARTTLS command first', { code: 'EAUTH', responseCode: 530 }), 'kimlik'],
    ['düz nesne', { code: 'EAUTH' }, 'kimlik'],
    ['dizge', 'EAUTH', 'diger'],
    ['null', null, 'diger'],
    ['tanımsız', undefined, 'diger'],
    ['sayı', 535, 'diger'],
  ];

  it.each(DURUMLAR)('%s', (_ad, girdi, beklenen) => {
    expect(smtpHataSinifi(girdi)).toBe(beklenen);
  });

  it('her sonuç sözleşmedeki kapalı kümeden; beş sınıfın beşi de üretilebiliyor', () => {
    const gorulen = new Set(DURUMLAR.map(([, girdi]) => smtpHataSinifi(girdi)));
    for (const sinif of gorulen) expect(MAGAZA_BILDIRIM_HATA_SINIFLARI).toContain(sinif);
    expect([...gorulen].sort()).toEqual([...MAGAZA_BILDIRIM_HATA_SINIFLARI].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('smtpDogrula — toplam süre sınırı', () => {
  beforeEach(() => ortamKur({ ...TAM }));

  it('doğrulama hiç dönmezse sınırda { ok: false, sinif: baglanti }; daha önce DEĞİL; taşıyıcı kapatılır', async () => {
    vi.useFakeTimers();
    const t = sahteTasiyici({ verify: () => new Promise<true>(() => {}) });
    let sonuc: unknown = 'bekliyor';
    void smtpDogrula().then((s) => { sonuc = s; });
    await vi.advanceTimersByTimeAsync(SMTP_DOGRULAMA_SINIRI_MS - 1);
    expect(sonuc).toBe('bekliyor');
    await vi.advanceTimersByTimeAsync(1);
    expect(sonuc).toEqual({ ok: false, sinif: 'baglanti' });
    expect(t.close).toHaveBeenCalledTimes(1);
  });

  it('sınır 10 sn (bekçi sözleşmesi)', () => {
    expect(SMTP_DOGRULAMA_SINIRI_MS).toBe(10_000);
  });

  it('hızlı sonuçta zamanlayıcı bırakılmaz (süreç kapanışını tutmaz)', async () => {
    vi.useFakeTimers();
    sahteTasiyici();
    await smtpDogrula();
    expect(vi.getTimerCount()).toBe(0);
    sahteTasiyici({ verify: async () => { throw hata('Invalid login: 535', { code: 'EAUTH' }); } });
    await smtpDogrula();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sınırdan SONRA reddeden doğrulama genel unhandledRejection işleyicisine düşmez', async () => {
    vi.useFakeTimers();
    let reddet: (h: Error) => void = () => {};
    // DÜZ taşıyıcı (vi.fn DEĞİL): vi.fn dönen söze sonuç kaydı için işleyici bağlar — ret zaten «sahipli» olur, test kör kalırdı.
    const duz = { sendMail: async (): Promise<unknown> => ({}), verify: (): Promise<true> => new Promise<true>((_, r) => { reddet = r; }), close: (): void => {} };
    uretici.mockImplementationOnce(() => duz as unknown as ReturnType<typeof createTransport>);
    let sahipsiz = 0;
    const say = (): void => { sahipsiz++; };
    process.on('unhandledRejection', say);
    try {
      const soz = smtpDogrula();
      await vi.advanceTimersByTimeAsync(SMTP_DOGRULAMA_SINIRI_MS);
      expect(await soz).toEqual({ ok: false, sinif: 'baglanti' });
      reddet(hata('Connection closed unexpectedly', { code: 'ECONNECTION' }));
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));   // unhandledRejection mikro görev kuyruğu boşalınca yayılır
      expect(sahipsiz).toBe(0);
    } finally {
      process.off('unhandledRejection', say);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ÇİT: sertifika doğrulaması kapatılmaz (kaynak taraması, yorumlar süzülür)', () => {
  const HAM = readFileSync(join(__dirname, 'smtpPosta.ts'), 'utf-8');
  const KOD = yorumsuz(HAM).join('\n');
  // `rejectUnauthorized` yalnız AÇIKÇA `true` ile yazılabilir; başka her biçim (false, değişken, kısa yazım) ihlaldir.
  const DOGRULAMA_KAPATAN = /rejectUnauthorized(?!\s*:\s*true\b)/;
  const YASAK: Array<[string, RegExp]> = [
    ['rejectUnauthorized (true dışında)', DOGRULAMA_KAPATAN],
    ['NODE_TLS_REJECT_UNAUTHORIZED', /NODE_TLS_REJECT_UNAUTHORIZED/],
    ['checkServerIdentity (ad doğrulamasını değiştirir)', /checkServerIdentity/],
    ['ignoreTLS', /ignoreTLS/],
    ['opportunisticTLS (düz metne düşüş)', /opportunisticTLS/],
  ];

  it('tarama gerçekten oldu: kod boş değil, yorumlar gerçekten süzüldü', () => {
    expect(KOD).toMatch(/export async function smtpGonder/);
    expect(KOD.length).toBeLessThan(HAM.length);
    expect(KOD).not.toMatch(/ÜÇ DEĞİŞMEZ/);
  });

  it.each(YASAK)('%s — kodda YOK', (_ad, desen) => {
    const suclular = yorumsuz(HAM).map((satir, i) => (desen.test(satir) ? `smtpPosta.ts:${i + 1}: ${satir.trim()}` : '')).filter(Boolean);
    expect(suclular, suclular.join('\n')).toEqual([]);
  });

  it('doğrulama AÇIKÇA açık yazılmış (süreç geneli kapatma ortam değişkenini ezer)', () => {
    expect(KOD.match(/rejectUnauthorized\s*:\s*true\b/g)).toHaveLength(1);
  });

  it('çit kendi yorumuna takılmıyor: yasak adlar modülün AÇIKLAMASINDA geçiyor, kodunda değil', () => {
    expect(HAM).toMatch(/rejectUnauthorized: false/);
    expect(HAM).toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    expect(KOD).not.toMatch(/rejectUnauthorized: false/);
  });

  it('desen kapatma biçimlerini yakalar, açık `true`yu geçirir (negatif kontrol)', () => {
    for (const ihlal of ['tls: { rejectUnauthorized: false }', 'rejectUnauthorized:false', 'rejectUnauthorized: !katiMod', 'rejectUnauthorized: dogrula', '{ rejectUnauthorized }', "tls['rejectUnauthorized'] = false", 'rejectUnauthorized: trueDegil']) {
      expect(DOGRULAMA_KAPATAN.test(ihlal), ihlal).toBe(true);
    }
    for (const gecerli of ['tls: { minVersion: \'TLSv1.2\', rejectUnauthorized: true }', 'rejectUnauthorized:true,', 'rejectUnauthorized : true }']) {
      expect(DOGRULAMA_KAPATAN.test(gecerli), gecerli).toBe(false);
    }
  });

  it('sessiz sıfır / uydurma varsayılan yok; hata bastırma yorumu yok', () => {
    expect(sertIhlalleri('smtpPosta.ts', HAM)).toEqual([]);
    expect(KOD).not.toMatch(/\bas any\b|@ts-ignore|@ts-expect-error/);
  });

  it('yaprak modül: server.ts içe aktarılmaz; Resend yoluna dokunulmaz', () => {
    expect(KOD).not.toMatch(/from\s+['"][^'"]*\bserver(?:\.js|\.ts)?['"]/);
    expect(KOD).not.toMatch(/resend/i);
    expect(KOD).toMatch(/import \{ createTransport \} from 'nodemailer';/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ÇİT: dağıtım ortam şablonu (deploy/windows/env.example)', () => {
  // Şablon DEĞER taşımaz (yalnız anahtar adı + açıklama); gerçek ortam dosyaları bu testte OKUNMAZ.
  const SABLON = readFileSync(join(__dirname, '..', '..', 'deploy', 'windows', 'env.example'));
  const SATIRLAR = SABLON.toString('latin1').split(/\r?\n/);

  it.each(ANAHTARLAR)('%s şablonda tam bir kez ve DEĞERSİZ', (ad) => {
    expect(SATIRLAR.filter((s) => s.startsWith(`${ad}=`))).toEqual([`${ad}=`]);
  });

  it('eksik sayılabilen her anahtar şablonda var (tek kaynak: smtpYapilandirmasi)', () => {
    const eksikOlabilen = new Set([...smtpYapilandirmasi({}).eksik, ...smtpYapilandirmasi({ ...TAM, SMTP_PORT: 'bozuk' }).eksik]);
    expect([...eksikOlabilen].sort()).toEqual(['MAGAZA_BILDIRIM_ALICI', 'SMTP_HOST', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_USER']);
    for (const ad of eksikOlabilen) expect(SATIRLAR, ad).toContain(`${ad}=`);
  });

  it('şablonun TAMAMI salt-ASCII (PowerShell 5.1 + Windows-1252; Türkçe harf / uzun tire yok)', () => {
    const asciiDisi = [...SABLON].map((bayt, i) => (bayt > 0x7e || (bayt < 0x20 && bayt !== 0x0a && bayt !== 0x0d && bayt !== 0x09) ? i : -1)).filter((i) => i >= 0);
    expect(asciiDisi).toEqual([]);
    expect(SABLON.length).toBeGreaterThan(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GERÇEK soket: yerel sahte SMTP sunucusu + GERÇEK nodemailer.

interface SahteSunucu {
  kapi: number;
  /** Sunucuya ULAŞAN komutlar (kimlik bilgisi satırları değer olarak değil, işaret olarak). */
  gordu: string[];
  kapat: () => Promise<void>;
}

function sahteSmtpSunucusu(o: { starttls?: { key: string; cert: string } } = {}): Promise<SahteSunucu> {
  const gordu: string[] = [];
  const soketler = new Set<net.Socket>();

  const oturum = (sok: net.Socket, karsila: boolean, starttlsSun: boolean): void => {
    let asama: 'komut' | 'kullanici' | 'parola' | 'veri' = 'komut';
    let tampon = '';
    const yaz = (satir: string): void => { sok.write(satir + '\r\n'); };
    sok.on('error', () => {});
    if (karsila) yaz('220 sahte ESMTP');
    sok.on('data', (parca: Buffer) => {
      tampon += parca.toString('utf8');
      for (let i = tampon.indexOf('\r\n'); i >= 0; i = tampon.indexOf('\r\n')) {
        const satir = tampon.slice(0, i);
        tampon = tampon.slice(i + 2);
        if (asama === 'veri') { if (satir === '.') { asama = 'komut'; yaz('250 kabul edildi'); } continue; }
        if (asama === 'kullanici') { gordu.push('AUTH-KULLANICI'); asama = 'parola'; yaz('334 UGFzc3dvcmQ6'); continue; }
        if (asama === 'parola') { gordu.push('AUTH-PAROLA'); asama = 'komut'; yaz('235 tamam'); continue; }
        const komut = satir.split(/[ :]/)[0];
        gordu.push(komut);
        if (komut === 'EHLO') yaz(['250-sahte', ...(starttlsSun ? ['250-STARTTLS'] : []), '250-AUTH LOGIN', '250 OK'].join('\r\n'));
        else if (komut === 'STARTTLS') {
          if (!starttlsSun || !o.starttls) { yaz('502 5.5.1 STARTTLS desteklenmiyor'); continue; }
          yaz('220 hazir');
          sok.removeAllListeners('data');
          const guvenli = new tls.TLSSocket(sok, { isServer: true, key: o.starttls.key, cert: o.starttls.cert });
          oturum(guvenli, false, false);
          return;
        }
        else if (komut === 'AUTH') { asama = 'kullanici'; yaz('334 VXNlcm5hbWU6'); }
        else if (komut === 'MAIL' || komut === 'RCPT' || komut === 'RSET') yaz('250 OK');
        else if (komut === 'DATA') { asama = 'veri'; yaz('354 devam'); }
        else if (komut === 'QUIT') { yaz('221 hosca kal'); sok.end(); }
        else yaz('500 bilinmeyen komut');
      }
    });
  };

  const sunucu = net.createServer((sok) => {
    soketler.add(sok);
    sok.on('close', () => soketler.delete(sok));
    oturum(sok, true, Boolean(o.starttls));
  });
  return new Promise((coz) => {
    sunucu.listen(0, '127.0.0.1', () => {
      const adres = sunucu.address();
      if (adres === null || typeof adres === 'string') throw new Error('sahte sunucu adresi okunamadı');
      coz({
        kapi: adres.port,
        gordu,
        kapat: () => new Promise<void>((bitti) => {
          for (const sok of soketler) sok.destroy();
          sunucu.close(() => bitti());
        }),
      });
    });
  });
}

/** Kendinden imzalı sertifika (openssl ile, geçici dizinde; anahtar depoya GİRMEZ). openssl yoksa `null`. */
function kendindenImzaliSertifika(): { key: string; cert: string } | null {
  let dizin: string | null = null;
  try {
    dizin = mkdtempSync(join(tmpdir(), 'cetpa-smtp-test-'));
    const anahtar = join(dizin, 'anahtar.pem');
    const sertifika = join(dizin, 'sertifika.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', anahtar, '-out', sertifika, '-subj', '/CN=localhost', '-days', '2'], { stdio: 'ignore', timeout: 30_000 });
    return { key: readFileSync(anahtar, 'utf8'), cert: readFileSync(sertifika, 'utf8') };
  } catch {
    return null;
  } finally {
    if (dizin) rmSync(dizin, { recursive: true, force: true });
  }
}
const SERTIFIKA = kendindenImzaliSertifika();

describe('GERÇEK soket — yerel sahte SMTP sunucusu, gerçek nodemailer', () => {
  let sunucu: SahteSunucu | null = null;
  afterEach(async () => { await sunucu?.kapat(); sunucu = null; });

  const yerelOrtam = (kapi: number): void => ortamKur({ ...TAM, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(kapi) });
  const kimlikGitti = (s: SahteSunucu): boolean => s.gordu.some((k) => k.startsWith('AUTH'));

  it('sunucu STARTTLS sunmuyorsa gönderim DURUR (tls); kimlik bilgisi ve ileti düz metinle GİTMEZ', async () => {
    sunucu = await sahteSmtpSunucusu();
    yerelOrtam(sunucu.kapi);
    expect(await smtpGonder(ILETI)).toEqual({ ok: false, sinif: 'tls' });
    expect(sunucu.gordu).toContain('EHLO');
    expect(kimlikGitti(sunucu)).toBe(false);
    expect(sunucu.gordu).not.toContain('MAIL');
    expect(sunucu.gordu).not.toContain('DATA');
  });

  it('smtpDogrula da aynı sunucuda durur (tls), kimlik bilgisi gitmez', async () => {
    sunucu = await sahteSmtpSunucusu();
    yerelOrtam(sunucu.kapi);
    expect(await smtpDogrula()).toEqual({ ok: false, sinif: 'tls' });
    expect(kimlikGitti(sunucu)).toBe(false);
  });

  it('dinleyen yoksa baglanti', async () => {
    const gecici = await sahteSmtpSunucusu();
    const kapaliKapi = gecici.kapi;
    await gecici.kapat();
    yerelOrtam(kapaliKapi);
    expect(await smtpGonder(ILETI)).toEqual({ ok: false, sinif: 'baglanti' });
    expect(await smtpDogrula()).toEqual({ ok: false, sinif: 'baglanti' });
  });

  it.skipIf(!SERTIFIKA)('KARŞI KONTROL: sahte sunucu uçtan uca çalışıyor — doğrulama KAPALI çıplak nodemailer ile ileti kabul edilir', async () => {
    // Aşağıdaki «reddedilir» testleri sunucu bozuk olduğu için geçiyor OLMASIN: aynı sunucu,
    // doğrulaması bilerek kapatılmış bir taşıyıcıyla (yalnız bu testte, modülün DIŞINDA) postayı alır.
    if (!SERTIFIKA) return;
    sunucu = await sahteSmtpSunucusu({ starttls: SERTIFIKA });
    const ciplak = createTransport({ host: '127.0.0.1', port: sunucu.kapi, secure: false, requireTLS: true, auth: { user: 'k', pass: 'p' }, tls: { rejectUnauthorized: false } });
    await ciplak.sendMail({ from: 'a@ornek.test', to: 'b@ornek.test', subject: 'karşı kontrol', text: 'metin' });
    expect(sunucu.gordu).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'AUTH-KULLANICI', 'AUTH-PAROLA', 'MAIL', 'RCPT', 'DATA']);
  });

  it.skipIf(!SERTIFIKA)('kendinden imzalı sertifika REDDEDİLİR (tls); kimlik bilgisi gitmez', async () => {
    if (!SERTIFIKA) return;
    sunucu = await sahteSmtpSunucusu({ starttls: SERTIFIKA });
    yerelOrtam(sunucu.kapi);
    expect(await smtpGonder(ILETI)).toEqual({ ok: false, sinif: 'tls' });
    expect(sunucu.gordu).toEqual(['EHLO', 'STARTTLS']);
    expect(await smtpDogrula()).toEqual({ ok: false, sinif: 'tls' });
    expect(kimlikGitti(sunucu)).toBe(false);
  });

  it.skipIf(!SERTIFIKA)('süreçte NODE_TLS_REJECT_UNAUTHORIZED=0 OLSA DA reddedilir (seçenek ortam değişkenini ezer)', async () => {
    if (!SERTIFIKA) return;
    const uyari = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});   // Node'un «güvensiz» uyarısı çıktıyı kirletmesin
    try {
      sunucu = await sahteSmtpSunucusu({ starttls: SERTIFIKA });
      yerelOrtam(sunucu.kapi);
      vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
      expect(await smtpGonder(ILETI)).toEqual({ ok: false, sinif: 'tls' });
      expect(sunucu.gordu).toEqual(['EHLO', 'STARTTLS']);
    } finally {
      uyari.mockRestore();
    }
  });
});
