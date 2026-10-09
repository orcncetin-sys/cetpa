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
import { smtpYapilandirmasi, smtpHataSinifi, smtpGonder, smtpDogrula, SMTP_DOGRULAMA_SINIRI_MS, MAGAZA_BILDIRIM_VARSAYILAN_ALICI, yerelAdresMi, kendiIpv4Adresleri, hamSmtpOturumu, teslimSondasi, adaySec, yerelAdaylar } from './smtpPosta';
import { MAGAZA_BILDIRIM_HATA_SINIFLARI } from '../lib/magazaTalep';

const uretici = vi.mocked(createTransport);

const ANAHTARLAR = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'MAGAZA_BILDIRIM_ALICI', 'MAGAZA_BILDIRIM'] as const;
/** Yerel kipin ön koşulu: üretim adresi. Testler yerel kipi varsayılan olarak bu adresle kurar. */
const URETIM_ADRESI = 'https://app.cetpa.com.tr';
const TAM = {
  SMTP_HOST: 'posta.ornek.test',
  SMTP_USER: 'bildirim@ornek.test',
  SMTP_PASS: 'cok-gizli-parola-9f3',
  MAGAZA_BILDIRIM_ALICI: 'iletisim@ornek.test',
} as const;
const ILETI = { konu: 'Yeni mağaza talebi: T261008-5Y9P', html: '<p>gövde</p>', metin: 'gövde' };

/** Süreç ortamını kur: listelenmeyen SMTP anahtarı TANIMSIZ olur (geliştirici makinesindeki değer sızmasın). */
function ortamKur(degerler: Partial<Record<typeof ANAHTARLAR[number] | 'APP_URL', string>>): void {
  for (const ad of ANAHTARLAR) vi.stubEnv(ad, degerler[ad]);
  vi.stubEnv('APP_URL', 'APP_URL' in degerler ? degerler.APP_URL : URETIM_ADRESI);
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
  // Kendi adresleri testte SABİT verilir (gerçek arayüzler okunmasın): `KENDI` makinenin adresi sayılır.
  const KENDI = ['10.20.30.40'];
  const yap = (ortam: Record<string, string | undefined>) => smtpYapilandirmasi({ APP_URL: URETIM_ADRESI, ...ortam }, KENDI);

  it('hiçbir anahtar yokken YEREL kip: tamam, eksik yok (aynı makinedeki posta sunucusuna kimliksiz teslim)', () => {
    expect(yap({})).toEqual({ tamam: true, eksik: [], kip: 'yerel' });
  });

  it('kullanıcı + parola (+ sunucu) varken KİMLİKLİ kip: tamam (kapı, gönderici ve alıcı verilmeden)', () => {
    expect(yap({ ...TAM })).toEqual({ tamam: true, eksik: [], kip: 'kimlikli' });
    expect(yap({ ...TAM, MAGAZA_BILDIRIM_ALICI: undefined })).toEqual({ tamam: true, eksik: [], kip: 'kimlikli' });
  });

  it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const)('kimlikli kipte %s tek başına eksikse yalnız o ad döner', (ad) => {
    const ortam: Record<string, string | undefined> = { ...TAM };
    delete ortam[ad];
    expect(yap(ortam)).toEqual({ tamam: false, eksik: [ad], kip: 'kimlikli' });
    expect(yap({ ...TAM, [ad]: '' })).toEqual({ tamam: false, eksik: [ad], kip: 'kimlikli' });
  });

  it('kimliğin yalnız YARISI yazılmışsa yerel kipe düşülmez: YALNIZ boş kalan kimlik anahtarı bildirilir (sunucu değil)', () => {
    expect(yap({ SMTP_USER: 'bildirim@ornek.test' })).toEqual({ tamam: false, eksik: ['SMTP_PASS'], kip: 'kimlikli' });
    expect(yap({ SMTP_PASS: 'p' })).toEqual({ tamam: false, eksik: ['SMTP_USER'], kip: 'kimlikli' });
    expect(yap({ SMTP_HOST: '127.0.0.1', SMTP_PASS: 'p' })).toEqual({ tamam: false, eksik: ['SMTP_USER'], kip: 'kimlikli' });
  });

  it('yerel kip YALNIZ üretim adresiyle (APP_URL https): yoksa / http ise eksik APP_URL — hazırlık ve geliştirme gerçek kutuya posta atmasın; kimlikli ve kapalı kip etkilenmez', () => {
    for (const adres of [undefined, '', 'http://localhost:5601', 'app.cetpa.com.tr', 'ftp://x.test', 'https:/x.test']) {
      expect(yap({ APP_URL: adres }), String(adres)).toEqual({ tamam: false, eksik: ['APP_URL'], kip: 'yerel' });
      expect(yap({ APP_URL: adres, ...TAM }), String(adres)).toEqual({ tamam: true, eksik: [], kip: 'kimlikli' });
      expect(yap({ APP_URL: adres, MAGAZA_BILDIRIM: 'kapali' }), String(adres)).toEqual({ tamam: false, eksik: [], kip: 'kapali' });
    }
    expect(yap({ APP_URL: 'HTTPS://app.cetpa.com.tr/' })).toEqual({ tamam: true, eksik: [], kip: 'yerel' });
    expect(yap({ APP_URL: ' https://x.test ' })).toEqual({ tamam: true, eksik: [], kip: 'yerel' });   // kırpılır
    expect(yap({ APP_URL: 'http://x', SMTP_HOST: 'uzak.test', SMTP_PORT: '465' })).toEqual({ tamam: false, eksik: ['SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'APP_URL'], kip: 'yerel' });
  });

  it('yalnız boşluktan oluşan parola kip kararında «yazılmamış» sayılır (USER ile simetrik); kimlikli kipte parola DEĞERİ kırpılmaz', () => {
    expect(yap({ SMTP_PASS: '  ' })).toEqual({ tamam: true, eksik: [], kip: 'yerel' });
    expect(yap({ ...TAM, SMTP_PASS: '  ' })).toEqual({ tamam: true, eksik: [], kip: 'kimlikli' });
  });

  it('KAPALI kip: MAGAZA_BILDIRIM=kapali → tamam yanlış, eksik yok; büyük / küçük harf ve boşluk fark etmez; başka değer kipi değiştirmez', () => {
    for (const d of ['kapali', 'KAPALI', ' Kapali ']) expect(yap({ MAGAZA_BILDIRIM: d, ...TAM }), d).toEqual({ tamam: false, eksik: [], kip: 'kapali' });
    expect(yap({ MAGAZA_BILDIRIM: 'acik' })).toEqual({ tamam: true, eksik: [], kip: 'yerel' });
    expect(yap({ MAGAZA_BILDIRIM: '' })).toEqual({ tamam: true, eksik: [], kip: 'yerel' });
  });

  it('yerel kipte 465 ve 587 KABUL EDİLMEZ (örtük TLS / kimlik isteyen kapı): eksik SMTP_PORT; kimlikli kipte ikisi de geçerli', () => {
    for (const kapi of ['465', '587']) {
      expect(yap({ SMTP_PORT: kapi }), kapi).toEqual({ tamam: false, eksik: ['SMTP_PORT'], kip: 'yerel' });
      expect(yap({ ...TAM, SMTP_PORT: kapi }), kapi).toEqual({ tamam: true, eksik: [], kip: 'kimlikli' });
    }
  });

  it('yerel kipte SMTP_HOST yalnız YEREL adres olabilir: uzak sunucu kimlik ister (USER + PASS eksik)', () => {
    expect(yap({ SMTP_HOST: 'posta.ornek.test' })).toEqual({ tamam: false, eksik: ['SMTP_USER', 'SMTP_PASS'], kip: 'yerel' });
    expect(yap({ SMTP_HOST: 'mail.cetpa.com.tr' })).toEqual({ tamam: false, eksik: ['SMTP_USER', 'SMTP_PASS'], kip: 'yerel' });
    for (const yerel of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]', '10.20.30.40', ' 127.0.0.1 ']) {
      expect(yap({ SMTP_HOST: yerel }), yerel).toEqual({ tamam: true, eksik: [], kip: 'yerel' });
    }
  });

  it('yerelAdresMi: geri döngü adları / adresleri ve kendi adresleri; başka her şey uzak', () => {
    for (const a of ['127.0.0.1', '127.0.0.2', '127.255.0.9', 'localhost', 'LocalHost', '::1', '[::1]', '::ffff:127.0.0.1', '10.20.30.40']) expect(yerelAdresMi(a, KENDI), a).toBe(true);
    for (const a of ['10.20.30.41', 'mail.cetpa.com.tr', '', 'localhost.ornek.test', '0.0.0.0', '128.0.0.1', '1127.0.0.1']) expect(yerelAdresMi(a, KENDI), a).toBe(false);
  });

  it('kendiIpv4Adresleri: iç olmayan IPv4 adresleri (Node 18+ dizge aile, eski sayı aile); geri döngü ve IPv6 girmez', () => {
    const arayuzler = {
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }, { address: '::1', family: 'IPv6', internal: true }],
      en0: [{ address: '10.20.30.40', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
      eski: [{ address: '192.168.1.5', family: 4, internal: false }],
      bos: undefined,
    } as unknown as ReturnType<typeof import('node:os').networkInterfaces>;
    expect(kendiIpv4Adresleri(arayuzler)).toEqual(['10.20.30.40', '192.168.1.5']);
    expect(Array.isArray(kendiIpv4Adresleri())).toBe(true);   // gerçek arayüzler: en azından fırlatmaz
  });

  it('yalnız boşluktan oluşan değer boş sayılır: yarım kimlikte yalnız kullanıcı eksik; boş alıcı varsayılana düşer', () => {
    expect(yap({ ...TAM, SMTP_HOST: '   ', SMTP_USER: '\t', MAGAZA_BILDIRIM_ALICI: ' ' })).toEqual({ tamam: false, eksik: ['SMTP_USER'], kip: 'kimlikli' });
    expect(yap({ ...TAM, SMTP_HOST: '   ' })).toEqual({ tamam: false, eksik: ['SMTP_HOST'], kip: 'kimlikli' });
  });

  it.each(['iletisim', 'iletisim@cetpa', 'ilet isim@cetpa.com.tr', 'a@b.com,c@d.com', '@cetpa.com.tr'])(
    'alıcı geçerli e-posta değilse («%s») eksik sayılır (iki kipte de)', (alici) => {
      expect(yap({ ...TAM, MAGAZA_BILDIRIM_ALICI: alici })).toEqual({ tamam: false, eksik: ['MAGAZA_BILDIRIM_ALICI'], kip: 'kimlikli' });
      expect(yap({ MAGAZA_BILDIRIM_ALICI: alici })).toEqual({ tamam: false, eksik: ['MAGAZA_BILDIRIM_ALICI'], kip: 'yerel' });
    });

  it('varsayılan alıcı iletisim@cetpa.com.tr (kullanıcı kararı 2026-10-09)', () => {
    expect(MAGAZA_BILDIRIM_VARSAYILAN_ALICI).toBe('iletisim@cetpa.com.tr');
  });

  it.each([undefined, '', '   ', '465', '587', ' 587 ', '25', '1', '65535'])('kapı «%s» kabul edilir (yerel kipte 465 / 587 hariç)', (kapi) => {
    expect(yap({ ...TAM, SMTP_PORT: kapi })).toEqual({ tamam: true, eksik: [], kip: 'kimlikli' });
    const yerelYasak = ['465', '587'].includes((kapi ?? '').trim());
    expect(yap({ SMTP_PORT: kapi })).toEqual(yerelYasak ? { tamam: false, eksik: ['SMTP_PORT'], kip: 'yerel' } : { tamam: true, eksik: [], kip: 'yerel' });
  });

  it.each(['0', '65536', '999999', '465.0', '4e2', '-1', '+587', 'abc', '587abc', '0x1D1', '5 87'])(
    'kapı «%s» bozuk → «eksik» (sessizce varsayılana dönülmez; iki kipte de)', (kapi) => {
      expect(yap({ ...TAM, SMTP_PORT: kapi })).toEqual({ tamam: false, eksik: ['SMTP_PORT'], kip: 'kimlikli' });
      expect(yap({ SMTP_PORT: kapi })).toEqual({ tamam: false, eksik: ['SMTP_PORT'], kip: 'yerel' });
    });

  it('dönen değer yalnız AD taşır — parola, kullanıcı, sunucu, bozuk kapı / alıcı DEĞERİ sızmaz', () => {
    const sonuc = yap({ SMTP_HOST: 'gizli-sunucu.test', SMTP_USER: 'gizli-kullanici', SMTP_PASS: 'gizli-parola', SMTP_PORT: 'gizli-kapi', SMTP_FROM: 'gizli-gonderici', MAGAZA_BILDIRIM_ALICI: 'gizli-alici' });
    expect(sonuc).toEqual({ tamam: false, eksik: ['SMTP_PORT', 'MAGAZA_BILDIRIM_ALICI'], kip: 'kimlikli' });
    expect(JSON.stringify(sonuc)).not.toMatch(/gizli/);
    for (const ad of sonuc.eksik) expect(ANAHTARLAR).toContain(ad);
    const yerel = yap({ SMTP_HOST: 'gizli-uzak.test', SMTP_PORT: 'gizli-kapi' });
    expect(yerel).toEqual({ tamam: false, eksik: ['SMTP_USER', 'SMTP_PASS', 'SMTP_PORT'], kip: 'yerel' });
    expect(JSON.stringify(yerel)).not.toMatch(/gizli/);
  });

  it('parametresiz çağrı süreç ortamını ve gerçek arayüzleri okur', () => {
    expect(smtpYapilandirmasi()).toEqual({ tamam: true, eksik: [], kip: 'yerel' });
    ortamKur({ ...TAM });
    expect(smtpYapilandirmasi()).toEqual({ tamam: true, eksik: [], kip: 'kimlikli' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('yapılandırma eksikken bağlantı DENENMEZ', () => {
  const EKSIK_DURUMLAR: Array<[string, Partial<Record<typeof ANAHTARLAR[number], string>>]> = [
    ['sunucu yok (kimlikli)', { ...TAM, SMTP_HOST: '' }],
    ['kullanıcı yok (parola var)', { ...TAM, SMTP_USER: '' }],
    ['parola yok (kullanıcı var)', { ...TAM, SMTP_PASS: '' }],
    ['yalnız kullanıcı', { SMTP_USER: 'bildirim@ornek.test' }],
    ['yalnız parola', { SMTP_PASS: 'p' }],
    ['uzak sunucu, kimlik yok (yerel kip uzak adres almaz)', { SMTP_HOST: 'posta.ornek.test' }],
    ['alıcı e-posta değil (kimlikli)', { ...TAM, MAGAZA_BILDIRIM_ALICI: 'iletisim' }],
    ['alıcı e-posta değil (yerel)', { MAGAZA_BILDIRIM_ALICI: 'iletisim' }],
    ['kapı bozuk (kimlikli)', { ...TAM, SMTP_PORT: '587abc' }],
    ['kapı bozuk (yerel)', { SMTP_PORT: '587abc' }],
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
    // gönderen reddi — KALICI: MAIL FROM'a 5xx (MailEnable 551 «requires authentication before sending mail from a locally hosted domain»)
    ['gönderen reddi 550', hata('Mail command failed: 550 5.7.1', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 550 }), 'gonderen-reddi'],
    ['gönderen reddi 551 (MailEnable Address spoofing)', hata('Mail command failed: 551 This mail server requires authentication before sending mail from a locally hosted domain', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 551 }), 'gonderen-reddi'],
    ['MAIL FROM yanıt kodsuz (yapılandırma) → alıcı / zarf reddi kalır', hata('Mail command failed', { code: 'EENVELOPE', command: 'MAIL FROM' }), 'alici-reddi'],
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
    ['sınır: zarf reddi 500 (MAIL FROM) → gonderen-reddi', hata('Mail command failed: 500', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 500 }), 'gonderen-reddi'],
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

  it('her sonuç sözleşmedeki kapalı kümeden; altı sınıfın altısı da üretilebiliyor', () => {
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

  it('`ignoreTLS` YALNIZ yerel kipin seçenek işlevinde, tek kez; kimlikli kipin seçeneklerinde ve başka hiçbir yerde yok', () => {
    const satirlar = yorumsuz(HAM);
    const gecenler = satirlar.map((satir, i) => (/ignoreTLS/.test(satir) ? i : -1)).filter((i) => i >= 0);
    expect(gecenler).toHaveLength(1);
    const yerelBas = satirlar.findIndex((s) => /^function yerelSecenekleri\(/.test(s));
    const yerelSon = satirlar.findIndex((s, i) => i > yerelBas && /^\}/.test(s));
    expect(yerelBas).toBeGreaterThan(0);
    expect(gecenler[0]).toBeGreaterThan(yerelBas);
    expect(gecenler[0]).toBeLessThan(yerelSon);
    expect(satirlar[gecenler[0]].trim()).toBe('ignoreTLS: true,');
    // Yerel seçenek işlevinde kimlik bilgisi ve TLS ayarı YOK (kimlik bilgisi düz oturumda taşınamaz).
    const yerelGovde = satirlar.slice(yerelBas, yerelSon + 1).join('\n');
    expect(yerelGovde).not.toMatch(/auth|tls:|requireTLS|rejectUnauthorized/);
    expect(yerelGovde).toMatch(/secure: false/);
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
    const KENDI: string[] = [];
    const eksikOlabilen = new Set([
      ...smtpYapilandirmasi({ SMTP_USER: 'u' }, KENDI).eksik, ...smtpYapilandirmasi({ SMTP_PASS: 'p' }, KENDI).eksik,
      ...smtpYapilandirmasi({ SMTP_USER: 'u', SMTP_PASS: 'p' }, KENDI).eksik,
      ...smtpYapilandirmasi({ ...TAM, SMTP_PORT: 'bozuk', MAGAZA_BILDIRIM_ALICI: 'bozuk' }, KENDI).eksik,
    ]);
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

/** `mailYaniti(satir)`: MAIL FROM satırına verilecek yanıt (varsayılan `250 OK`); `rcptYaniti`: RCPT TO yanıtı. */
function sahteSmtpSunucusu(o: { starttls?: { key: string; cert: string }; mailYaniti?: (satir: string) => string; rcptYaniti?: string } = {}): Promise<SahteSunucu> {
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
        else if (komut === 'MAIL') yaz(o.mailYaniti ? o.mailYaniti(satir) : '250 OK');
        else if (komut === 'RCPT') yaz(o.rcptYaniti ?? '250 OK');
        else if (komut === 'RSET') yaz('250 OK');
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

// ─────────────────────────────────────────────────────────────────────────────
describe('YEREL kip — seçenekler (sahte taşıyıcı)', () => {
  const KENDI = ['10.20.30.40'];
  const yerelGonder = (ortam: Partial<Record<typeof ANAHTARLAR[number], string>> = {}) => { ortamKur(ortam); return smtpGonder(ILETI, { kendiAdresleri: KENDI }); };

  it('hiçbir anahtar yokken: tek aday OLSAYDI sonda yok; birden çok adayda sonda — burada SMTP_HOST verilince tek aday, 127.0.0.1:25, kimliksiz, TLS yok', async () => {
    const t = sahteTasiyici();
    expect(await yerelGonder({ SMTP_HOST: '127.0.0.1' })).toEqual({ ok: true });
    expect(uretici).toHaveBeenCalledTimes(1);
    const s = secenekler();
    expect(s).toEqual({
      host: '127.0.0.1', port: 25, secure: false, ignoreTLS: true,
      connectionTimeout: 3_000, greetingTimeout: 5_000, socketTimeout: 15_000, dnsTimeout: 10_000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    for (const yok of ['auth', 'tls', 'requireTLS', 'opportunisticTLS', 'logger', 'debug'] as const) expect(s[yok], yok).toBeUndefined();
    // Gönderen ve alıcı varsayılanı iletisim@cetpa.com.tr; alıcı nesne biçiminde.
    expect(t.sendMail.mock.calls[0][0]).toMatchObject({ from: MAGAZA_BILDIRIM_VARSAYILAN_ALICI, to: { name: '', address: MAGAZA_BILDIRIM_VARSAYILAN_ALICI } });
    expect(t.sendMail.mock.calls[0][0].envelope).toBeUndefined();
  });

  it.each(['localhost', 'LOCALHOST', '::1', '[::1]', '127.0.0.9', '::ffff:127.0.0.1'])('geri döngü yazımı «%s» 127.0.0.1 literaline iner (DNS sorgusu ve ::1 yok)', async (host) => {
    sahteTasiyici();
    expect(await yerelGonder({ SMTP_HOST: host })).toEqual({ ok: true });
    expect(secenekler().host).toBe('127.0.0.1');
  });

  it('kendi adresi SMTP_HOST olarak verilince aynen kullanılır; SMTP_FROM verilmişse gönderen odur; kapı verilmişse o', async () => {
    const t = sahteTasiyici();
    expect(await yerelGonder({ SMTP_HOST: '10.20.30.40', SMTP_PORT: '2525', SMTP_FROM: 'CETPA Mağaza <magaza@cetpa.com.tr>', MAGAZA_BILDIRIM_ALICI: 'satis@cetpa.com.tr' })).toEqual({ ok: true });
    expect(secenekler()).toMatchObject({ host: '10.20.30.40', port: 2525, secure: false, ignoreTLS: true });
    expect(t.sendMail.mock.calls[0][0]).toMatchObject({ from: 'CETPA Mağaza <magaza@cetpa.com.tr>', to: { name: '', address: 'satis@cetpa.com.tr' } });
  });

  it('uzak sunucu + kimliksiz ve kapalı kip: taşıyıcı ÜRETİLMEZ', async () => {
    expect(await yerelGonder({ SMTP_HOST: 'posta.ornek.test' })).toEqual({ ok: false, yapilandirilmamis: true });
    expect(await yerelGonder({ MAGAZA_BILDIRIM: 'kapali' })).toEqual({ ok: false, yapilandirilmamis: true });
    expect(await smtpDogrula({ kendiAdresleri: KENDI })).toEqual({ ok: false, yapilandirilmamis: true });
    expect(uretici).not.toHaveBeenCalled();
  });

  it('MAIL FROM reddi (gonderen-reddi) → aynı adaya BİR KEZ boş zarf göndereniyle yeniden; başlık From değişmez; ikinci de reddederse sınıf gonderen-reddi', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ret = () => { throw hata('Mail command failed: 551 requires authentication', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 551 }); };
      let sayac = 0;
      const t1 = sahteTasiyici({ sendMail: async () => { sayac += 1; if (sayac === 1) ret(); return {}; } });
      expect(await yerelGonder({ SMTP_HOST: '127.0.0.1' })).toEqual({ ok: true });
      expect(t1.sendMail).toHaveBeenCalledTimes(2);
      expect(t1.sendMail.mock.calls[0][0].envelope).toBeUndefined();
      expect(t1.sendMail.mock.calls[1][0]).toMatchObject({ from: MAGAZA_BILDIRIM_VARSAYILAN_ALICI, envelope: { from: '', to: [MAGAZA_BILDIRIM_VARSAYILAN_ALICI] } });
      expect(uretici).toHaveBeenCalledTimes(1);   // aynı aday, aynı taşıyıcı
      expect(uyari).toHaveBeenCalledTimes(1);
      expect(String(uyari.mock.calls[0][0])).not.toMatch(/551|cetpa/);
      // İkinci deneme de reddedilirse: sınıf gonderen-reddi, üçüncü deneme YOK.
      uretici.mockReset();
      const t2 = sahteTasiyici({ sendMail: async () => ret() });
      expect(await yerelGonder({ SMTP_HOST: '127.0.0.1' })).toEqual({ ok: false, sinif: 'gonderen-reddi' });
      expect(t2.sendMail).toHaveBeenCalledTimes(2);
    } finally {
      uyari.mockRestore();
    }
  });

  it('kimlikli kipte MAIL FROM reddi için boş zarf denemesi YOK (tek sendMail, gonderen-reddi)', async () => {
    ortamKur({ ...TAM });
    const t = sahteTasiyici({ sendMail: async () => { throw hata('551 Sender address is not valid for your login', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 551 }); } });
    expect(await smtpGonder(ILETI)).toEqual({ ok: false, sinif: 'gonderen-reddi' });
    expect(t.sendMail).toHaveBeenCalledTimes(1);
  });

  it('başka her gönderim hatasında (alıcı reddi, bağlantı) yeniden deneme ve ikinci aday YOK', async () => {
    const t = sahteTasiyici({ sendMail: async () => { throw hata('550 kutu yok', { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 }); } });
    expect(await yerelGonder({ SMTP_HOST: '127.0.0.1' })).toEqual({ ok: false, sinif: 'alici-reddi' });
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    expect(uretici).toHaveBeenCalledTimes(1);
  });
});

describe('aday seçimi — sonda posta göndermez, ulaşılabilen ilk aday; gönderim hatası aday değiştirmez', () => {
  it('adaySec: ilk 220 veren aday; hiçbiri vermezse null; en çok 3 aday denenir', async () => {
    const denenen: string[] = [];
    const sonda = async (host: string): Promise<{ ulasildi: boolean; yanitlar: number[] }> => { denenen.push(host); return { ulasildi: host === 'c', yanitlar: [] }; };
    expect(await adaySec(['a', 'b', 'c', 'd'], 25, sonda)).toBe('c');
    expect(denenen).toEqual(['a', 'b', 'c']);
    denenen.length = 0;
    expect(await adaySec(['a', 'b', 'x', 'c'], 25, sonda)).toBeNull();
    expect(denenen).toEqual(['a', 'b', 'x']);
  });

  it('yerelAdaylar: 127.0.0.1 önce, herkese açık adres özel ağdan ÖNCE (kararlı), geri döngü tekrar etmez, en çok 3', () => {
    expect(yerelAdaylar(['172.20.0.1', '172.21.0.1', '78.111.111.185', '10.0.0.5'])).toEqual(['127.0.0.1', '78.111.111.185', '172.20.0.1']);
    expect(yerelAdaylar(['10.0.0.5', '192.168.1.9', '172.16.0.1'])).toEqual(['127.0.0.1', '10.0.0.5', '192.168.1.9']);
    expect(yerelAdaylar(['127.0.0.1', '127.0.0.2', '203.0.113.7'])).toEqual(['127.0.0.1', '203.0.113.7']);
    expect(yerelAdaylar([])).toEqual(['127.0.0.1']);
  });

  it('aday sırası: 127.0.0.1, sonra herkese açık adres, sonra özel ağ (sanal bağdaştırıcılar 3 sınırı yüzünden dış adresi düşürmesin)', async () => {
    const denenen: string[] = [];
    const sonda = async (host: string): Promise<{ ulasildi: boolean; yanitlar: number[] }> => { denenen.push(host); return { ulasildi: false, yanitlar: [] }; };
    // Sıralama kararlıdır: özel adresler kendi aralarındaki arayüz sırasını korur.
    ortamKur({ SMTP_PORT: '2525' });
    expect(await smtpGonder(ILETI, { kendiAdresleri: ['172.20.0.1', '172.21.0.1', '78.111.111.185', '10.0.0.5'] })).toEqual({ ok: false, sinif: 'baglanti' });
    void sonda;
    expect(uretici).not.toHaveBeenCalled();
    expect(await adaySec(['172.20.0.1', '78.111.111.185'], 25, sonda)).toBeNull();
    expect(denenen).toEqual(['172.20.0.1', '78.111.111.185']);
  }, 20_000);

  it('SMTP_HOST boşken adaylar 127.0.0.1 + kendi adresleri (en çok 3; geri döngü tekrar etmez); sonda 127.0.0.1\'e gider', async () => {
    const kapali = await sahteSmtpSunucusu();
    const kapi = kapali.kapi;
    await kapali.kapat();
    // Hiçbir aday dinlemiyor: sonda üçünü dener, taşıyıcı hiç üretilmez, sınıf baglanti.
    ortamKur({ SMTP_PORT: String(kapi) });
    const bas = Date.now();
    expect(await smtpGonder(ILETI, { kendiAdresleri: ['127.0.0.1', '10.20.30.40', '10.20.30.41', '10.20.30.42'] })).toEqual({ ok: false, sinif: 'baglanti' });
    expect(uretici).not.toHaveBeenCalled();
    // 3 aday × en çok 3 sn bağlantı sınırı (dördüncü aday hiç denenmez): toplam 9 sn'nin altında.
    expect(Date.now() - bas).toBeLessThan(9_500);
  }, 20_000);
});

describe('ham sonda — gerçek soket, sahte sunucu', () => {
  let sunucu: SahteSunucu | null = null;
  afterEach(async () => { await sunucu?.kapat(); sunucu = null; });

  it('karşılama + komutlar + QUIT; DATA yok; çok satırlı EHLO yanıtının son satırı sayılır', async () => {
    sunucu = await sahteSmtpSunucusu();
    const sonuc = await hamSmtpOturumu('127.0.0.1', sunucu.kapi, ['EHLO deney', 'MAIL FROM:<a@b.test>', 'RCPT TO:<c@d.test>', 'RSET']);
    expect(sonuc).toEqual({ ulasildi: true, yanitlar: [250, 250, 250, 250] });
    expect(sunucu.gordu.filter((k) => k !== 'QUIT')).toEqual(['EHLO', 'MAIL', 'RCPT', 'RSET']);
    expect(sunucu.gordu).not.toContain('DATA');
  });

  it('dinleyen yoksa ulaşılamadı (yanıt yok); ilk olumsuz yanıtta durur', async () => {
    const gecici = await sahteSmtpSunucusu();
    const kapi = gecici.kapi;
    await gecici.kapat();
    expect(await hamSmtpOturumu('127.0.0.1', kapi, ['EHLO deney'])).toEqual({ ulasildi: false, yanitlar: [] });
    sunucu = await sahteSmtpSunucusu({ mailYaniti: () => '551 This mail server requires authentication before sending mail from a locally hosted domain' });
    expect(await hamSmtpOturumu('127.0.0.1', sunucu.kapi, ['EHLO deney', 'MAIL FROM:<a@b.test>', 'RCPT TO:<c@d.test>'])).toEqual({ ulasildi: true, yanitlar: [250, 551] });
    expect(sunucu.gordu).not.toContain('RCPT');
  });

  it('teslimSondasi: kabul → ok; MAIL FROM 5xx → gonderen-reddi; RCPT 5xx → alici-reddi; 4xx → diger; dinleyen yok → baglanti; gönderen «Ad <adres>» biçiminden ayıklanır', async () => {
    sunucu = await sahteSmtpSunucusu();
    expect(await teslimSondasi('127.0.0.1', sunucu.kapi, 'CETPA <iletisim@cetpa.com.tr>', 'iletisim@cetpa.com.tr')).toEqual({ ok: true });
    expect(sunucu.gordu.filter((k) => k !== 'QUIT')).toEqual(['EHLO', 'MAIL', 'RCPT', 'RSET']);
    await sunucu.kapat();
    // Adlı gönderene 551 ama `<>` kabul: gönderimle AYNI geri dönüş → ok (ikinci oturumda `MAIL FROM:<>`, DATA yok).
    sunucu = await sahteSmtpSunucusu({ mailYaniti: (satir) => (satir.includes('<iletisim@cetpa.com.tr>') ? '551 requires authentication' : '250 OK') });
    expect(await teslimSondasi('127.0.0.1', sunucu.kapi, 'iletisim@cetpa.com.tr', 'iletisim@cetpa.com.tr')).toEqual({ ok: true });
    expect(sunucu.gordu.filter((k) => k !== 'QUIT')).toEqual(['EHLO', 'MAIL', 'EHLO', 'MAIL', 'RCPT', 'RSET']);
    expect(sunucu.gordu).not.toContain('DATA');
    await sunucu.kapat();
    // Her iki zarf da reddedilirse gonderen-reddi (tam iki oturum, RCPT hiç gitmez).
    sunucu = await sahteSmtpSunucusu({ mailYaniti: () => '551 requires authentication' });
    expect(await teslimSondasi('127.0.0.1', sunucu.kapi, 'iletisim@cetpa.com.tr', 'iletisim@cetpa.com.tr')).toEqual({ ok: false, sinif: 'gonderen-reddi' });
    expect(sunucu.gordu.filter((k) => k !== 'QUIT')).toEqual(['EHLO', 'MAIL', 'EHLO', 'MAIL']);
    await sunucu.kapat();
    sunucu = await sahteSmtpSunucusu({ rcptYaniti: '550 mailbox unavailable or not local' });
    expect(await teslimSondasi('127.0.0.1', sunucu.kapi, 'a@cetpa.com.tr', 'yok@cetpa.com.tr')).toEqual({ ok: false, sinif: 'alici-reddi' });
    await sunucu.kapat();
    sunucu = await sahteSmtpSunucusu({ rcptYaniti: '450 mailbox busy' });
    expect(await teslimSondasi('127.0.0.1', sunucu.kapi, 'a@cetpa.com.tr', 'b@cetpa.com.tr')).toEqual({ ok: false, sinif: 'diger' });
    const kapi = sunucu.kapi;
    await sunucu.kapat();
    sunucu = null;
    expect(await teslimSondasi('127.0.0.1', kapi, 'a@cetpa.com.tr', 'b@cetpa.com.tr')).toEqual({ ok: false, sinif: 'baglanti' });
  });
});

describe('GERÇEK soket — YEREL kip, gerçek nodemailer', () => {
  let sunucu: SahteSunucu | null = null;
  afterEach(async () => { await sunucu?.kapat(); sunucu = null; });
  const komutlar = (s: SahteSunucu): string[] => s.gordu.filter((k) => k !== 'QUIT' && k !== 'RSET');

  it('kimliksiz, düz metin teslim: sunucu AUTH LOGIN duyursa da AUTH yok; EHLO MAIL RCPT DATA', async () => {
    sunucu = await sahteSmtpSunucusu();
    ortamKur({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sunucu.kapi) });
    expect(await smtpGonder(ILETI)).toEqual({ ok: true });
    expect(komutlar(sunucu)).toEqual(['EHLO', 'MAIL', 'RCPT', 'DATA']);
  });

  it.skipIf(!SERTIFIKA)('sunucu STARTTLS duyursa da yerel kip YÜKSELTMEZ (ignoreTLS): sertifika 127.0.0.1 adına değil, oturum düz kalır', async () => {
    if (!SERTIFIKA) return;
    sunucu = await sahteSmtpSunucusu({ starttls: SERTIFIKA });
    ortamKur({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sunucu.kapi) });
    expect(await smtpGonder(ILETI)).toEqual({ ok: true });
    expect(komutlar(sunucu)).toEqual(['EHLO', 'MAIL', 'RCPT', 'DATA']);
  });

  it('smtpDogrula yerel kipte teslim sondasıdır: posta göndermez, MAIL FROM / RCPT TO reddini görür', async () => {
    sunucu = await sahteSmtpSunucusu();
    ortamKur({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sunucu.kapi) });
    expect(await smtpDogrula()).toEqual({ ok: true });
    expect(komutlar(sunucu)).toEqual(['EHLO', 'MAIL', 'RCPT']);
    expect(uretici).not.toHaveBeenCalled();   // nodemailer `verify` değil, ham sonda
    await sunucu.kapat();
    sunucu = await sahteSmtpSunucusu({ mailYaniti: () => '551 requires authentication' });
    ortamKur({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sunucu.kapi) });
    expect(await smtpDogrula()).toEqual({ ok: false, sinif: 'gonderen-reddi' });
    await sunucu.kapat();
    // Gönderim ile sonda aynı hükmü verir: `<>` kabul ediliyorsa ikisi de başarılı.
    sunucu = await sahteSmtpSunucusu({ mailYaniti: (satir) => (/<>/.test(satir) ? '250 OK' : '551 requires authentication') });
    ortamKur({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sunucu.kapi) });
    expect(await smtpDogrula()).toEqual({ ok: true });
  });

  it('MAIL FROM 551 → boş zarf göndereniyle ikinci oturum; sunucu TEK gövde görür; başlık From aynı', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      sunucu = await sahteSmtpSunucusu({ mailYaniti: (satir) => (/<>/.test(satir) ? '250 OK' : '551 requires authentication') });
      ortamKur({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sunucu.kapi) });
      expect(await smtpGonder(ILETI)).toEqual({ ok: true });
      expect(komutlar(sunucu)).toEqual(['EHLO', 'MAIL', 'EHLO', 'MAIL', 'RCPT', 'DATA']);
      expect(komutlar(sunucu).filter((k) => k === 'DATA')).toHaveLength(1);
    } finally {
      uyari.mockRestore();
    }
  });

  it('dinleyen yoksa baglanti (tek adayda sonda yok, gönderim doğrudan dener)', async () => {
    const gecici = await sahteSmtpSunucusu();
    const kapi = gecici.kapi;
    await gecici.kapat();
    ortamKur({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(kapi) });
    expect(await smtpGonder(ILETI)).toEqual({ ok: false, sinif: 'baglanti' });
    expect(await smtpDogrula()).toEqual({ ok: false, sinif: 'baglanti' });
  });
});
