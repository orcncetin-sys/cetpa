// @vitest-environment node
/**
 * magazaBayiZinciri.test.ts — müşteri / bayi alt zincirinin dalları sahte bağımlılıklarla (2026-10-21, şartname
 * `.wf/SARTNAME-musteri-siparislerim.md` H8, H10, H11) + kaynak çitleri. Uçtan uca davranış (gerçek server.ts, PGlite, gerçek
 * iptal / kullanıcı / bağ okuyucuları) magazaBayi.zincir.test.ts'te; burada gerçek düzenekte canlandırılamayan dallar (60 sn'lik
 * iptal önbelleği yüzünden iptal OKUMA hatası, boş kiracı, MFA, askıdaki firma, yapılandırma yokluğu) ölçülür.
 *
 * DENGESİZLİK SAĞLAMLAŞTIRMASI (2026-10-21, Tur 2 A — «kapı» testi gerçek zincir testiyle birlikte bir kez düştü; 32 + 116 tekrarda,
 * paralel yük altında da yeniden üretilemedi; kök neden KESİN değil). Dosyanın deterministik OLMAYAN iki girdisi vardı; ikisi de kaldırıldı:
 *   (1) DUVAR SAATİ: belirteç / kod / sahte iptal anı sınamada `Date.now()` ile, zincirde `new Date()` ile ayrı ayrı okunuyordu;
 *       kapı `bas ≤ şimdi < bitis` ve `bas > gecersizOnce`, oturum `veriliş > gecersizOnce` karşılaştırır — saat geri adım atarsa
 *       (NTP) 1 sn'lik pay 200'ü / 503'ü 401'e çevirir; aynı anda koşan gerçek zincir testi de aynı saate bakar. Artık TEK sahte saat
 *       (`saat`) zincire (`simdi`), kod deposuna ve sınamanın kendisine verilir; sınırlar milisaniyesi milisaniyesine ölçülür.
 *   (2) PAYLAŞILAN DURUM: kod deposu dosya boyunca tekti, son sunucu hiç kapanmıyordu, sunucu değişiminde açık bağlantılar boşta
 *       sayılmayı bekliyordu. Artık her testte yeni depo + yeni saat; sunucu `closeAllConnections()` ile kapanır (gerçek zincir
 *       testinin `afterAll`'ı gibi); dosya sonunda da kapanır.
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { kodSatirlari, oku, SRC_KOK } from '../../test/kaynakTarama';
import { BAYI_BELIRTECI, PANEL_BELIRTECI, anahtarTuret, belirtecUret, type PanelBelirtecYuku } from '../kanal/magazaPanelBelirtec';
import { kodDeposuKur, kodOzetiHesapla, meydanHesapla, panelKoduUret, MAGAZA_BAYI_KOD_OMRU_MS } from '../kanal/magazaPanelKod';
import type { PanelIptalCifti } from '../kanal/magazaPanelIptal';
import type { PanelKullanicisi } from '../kanal/magazaPanelKullanici';
import type { MusteriHesabi } from '../musteriHesap';
import { magazaBayi429, magazaBayiSayaclari, magazaBayiSayaclariniSifirla, magazaBayiZinciri } from './magazaBayiZinciri';
import { magazaPanelSayaclari } from './magazaPanelZinciri';

const KOKEN = 'https://www.cetpa.com.tr';
const ANAHTAR = anahtarTuret(BAYI_BELIRTECI, { sirVar: true, oturumSirri: 's', donusTabani: 'https://www.cetpa.com.tr/bayi.html', appUrl: undefined });
const PANEL_ANAHTARI = anahtarTuret(PANEL_BELIRTECI, { sirVar: true, oturumSirri: 's', donusTabani: 'https://www.cetpa.com.tr/panel.html', appUrl: undefined });
const KIMLIK = Buffer.from('kimlik-anahtari-0123456789abcdef');
const gecis = (_q: express.Request, _s: express.Response, n: express.NextFunction): void => n();

interface Durum {
  kullanici: PanelKullanicisi | null | Error;
  bag: MusteriHesabi | null | Error;
  gecersizOnce: number | Error;
  kiraci: string;
  iptalEt: Error | null;
  revoke: string[];
}
let d: Durum;
let taban = '';
let sunucu: http.Server | undefined;
/** Sahte saat (ms) — zincir, kod deposu ve sınama AYNI saati okur; her testte başa döner. */
const SAAT_BASI = Date.parse('2026-10-21T10:00:00.000Z');
let saat = SAAT_BASI;
const simdi = (): Date => new Date(saat);
let depo = kodDeposuKur({ simdi });

const KULLANICI: PanelKullanicisi = { rol: 'Dealer', cid: 'CETPA', firmaDurumu: 'active', mfaAcik: false, ad: 'Bayi', eposta: 'b@ornek.com' };
const BAG: MusteriHesabi = { companyId: 'CETPA', leadId: 'L1', cariKod: null, firma: 'Örnek', durum: 'acik', olusturan: '', olusturma: '', guncelleme: '' };
const iptal: PanelIptalCifti = {
  gecersizOnce: async () => { if (d.gecersizOnce instanceof Error) throw d.gecersizOnce; return d.gecersizOnce; },
  iptalEt: async () => { if (d.iptalEt) throw d.iptalEt; d.gecersizOnce = saat; },
};
const deger = <T>(v: T | Error): T => { if (v instanceof Error) throw v; return v; };

async function kapat(): Promise<void> {
  const s = sunucu;
  sunucu = undefined;
  if (!s) return;
  s.closeAllConnections();                                                       // boşta sayılmayı BEKLEMEZ (keep-alive dâhil)
  await new Promise<void>(r => s.close(() => r()));
}
async function kur(o: { anahtar?: Buffer | null; kimlik?: Buffer | null } = {}): Promise<void> {
  await kapat();
  const app = express();
  app.use('/bayi', magazaBayiZinciri({
    bayiOturumSinirlayici: gecis, bayiSinirlayici: gecis,
    bayiAnahtari: o.anahtar === undefined ? ANAHTAR : o.anahtar, bayiKimlikAnahtari: o.kimlik === undefined ? KIMLIK : o.kimlik,
    panelKullanicisi: async () => deger(d.kullanici), musteriHesabi: async () => deger(d.bag),
    kodDeposu: depo, iptal, firebaseYenilemeIptal: async (uid) => { d.revoke.push(uid); },
    getPgPool: () => ({ query: async () => ({ rows: [] }) }), serverTenantId: async () => d.kiraci,
    writeAuditLog: async () => undefined, izinliKokenler: () => [KOKEN], simdi,
  }));
  const s = app.listen(0);
  await new Promise<void>(r => s.once('listening', () => r()));
  sunucu = s;
  taban = `http://127.0.0.1:${(s.address() as AddressInfo).port}/bayi`;
}
const iste = async (yol: string, o: { method?: string; token?: string; govde?: unknown } = {}): Promise<{ s: number; j: unknown }> => {
  const r = await fetch(taban + yol, {
    method: o.method ?? (o.govde === undefined ? 'GET' : 'POST'),
    headers: { Origin: KOKEN, ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}), ...(o.govde !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(o.govde !== undefined ? { body: JSON.stringify(o.govde) } : {}),
  });
  const metin = await r.text();
  let j: unknown = null;
  try { j = JSON.parse(metin); } catch { j = metin; }
  return { s: r.status, j };
};
const belirtec = (ek: Partial<PanelBelirtecYuku> = {}, anahtar: Buffer | null = ANAHTAR, tur = BAYI_BELIRTECI): string => {
  if (!anahtar) throw new Error('anahtar yok');
  const bas = saat - 1000;
  return belirtecUret(tur, anahtar, { uid: 'b1', cid: 'CETPA', rol: 'Dealer', ad: 'Bayi', eposta: 'b@ornek.com', mfa: false, bas, bitis: bas + 3_600_000, ...ek });
};
const kodVer = (ek: { mfa?: boolean; verilis?: number } = {}): { kod: string; dogrulayici: string } => {
  const kod = panelKoduUret();
  const dogrulayici = panelKoduUret();
  depo.ver({ kodOzeti: kodOzetiHesapla(kod), meydan: meydanHesapla(dogrulayici), uid: 'b1', cid: 'CETPA', ad: 'Bayi', eposta: 'b@ornek.com', mfa: ek.mfa ?? false, bitis: (ek.verilis ?? saat) + MAGAZA_BAYI_KOD_OMRU_MS });
  return { kod, dogrulayici };
};

beforeEach(async () => {
  saat = SAAT_BASI;
  depo = kodDeposuKur({ simdi });
  d = { kullanici: { ...KULLANICI }, bag: { ...BAG }, gecersizOnce: 0, kiraci: 'CETPA', iptalEt: null, revoke: [] };
  magazaBayiSayaclariniSifirla();
  await kur();
});
afterAll(kapat);

describe('dallar — sahte bağımlılıklarla', () => {
  it('yapılandırma yoksa (imza ya da kimlik anahtarı) her yol 503 `bayi-yapilandirilmamis`; ön uçuş yine 204', async () => {
    for (const o of [{ anahtar: null }, { kimlik: null }]) {
      await kur(o);
      for (const yol of ['/ben', '/siparisler', '/oturum', '/yok']) expect((await iste(yol)).j, yol).toEqual({ ok: false, kod: 'bayi-yapilandirilmamis' });
      expect((await iste('/ben', { method: 'OPTIONS' })).s).toBe(204);
    }
  });

  it('oturum: iptal OKUNAMAZSA 503; kullanıcı okunamazsa 503; boş kiracı 503; bağ okunamazsa 503 — kod her durumda yanar', async () => {
    for (const bozuk of [
      () => { d.gecersizOnce = new Error('iptal'); }, () => { d.kullanici = new Error('kullanici'); }, () => { d.kiraci = ''; }, () => { d.bag = new Error('bag'); },
    ]) {
      d = { kullanici: { ...KULLANICI }, bag: { ...BAG }, gecersizOnce: 0, kiraci: 'CETPA', iptalEt: null, revoke: [] };
      await kur();                                                               // kiracı önbelleği (dolu 60 sn) zincirle birlikte sıfırlanır
      const { kod, dogrulayici } = kodVer();
      bozuk();
      expect(await iste('/oturum', { govde: { kod, dogrulayici } })).toEqual({ s: 503, j: { ok: false } });
      d = { kullanici: { ...KULLANICI }, bag: { ...BAG }, gecersizOnce: 0, kiraci: 'CETPA', iptalEt: null, revoke: [] };
      expect((await iste('/oturum', { govde: { kod, dogrulayici } })).s).toBe(401);
    }
    expect(magazaBayiSayaclari().oturum503).toBe(4);
  });

  it('oturum: veriliş = iptal anı → 401 (eşit an ret); MFA açık ama kodda MFA yok → 401; rol iç rol → 401; firma askıda → 401; bağ kapalı → 401', async () => {
    { const { kod, dogrulayici } = kodVer({ verilis: saat }); d.gecersizOnce = saat; expect((await iste('/oturum', { govde: { kod, dogrulayici } })).s).toBe(401); }
    // Bir milisaniye sonra verilen kod geçer (eşit an ret, sonrası kabul — sınır tam ölçülür).
    saat += 1;
    { const { kod, dogrulayici } = kodVer(); expect((await iste('/oturum', { govde: { kod, dogrulayici } })).s).toBe(200); }
    d.gecersizOnce = 0;
    for (const bozuk of [
      () => { d.kullanici = { ...KULLANICI, mfaAcik: true }; }, () => { d.kullanici = { ...KULLANICI, rol: 'Sales' }; },
      () => { d.kullanici = { ...KULLANICI, firmaDurumu: 'suspended' }; }, () => { d.bag = { ...BAG, durum: 'kapali' }; }, () => { d.bag = null; },
      () => { d.bag = { ...BAG, companyId: 'BASKA' }; }, () => { d.kullanici = { ...KULLANICI, cid: 'BASKA' }; },
    ]) {
      d.kullanici = { ...KULLANICI }; d.bag = { ...BAG };
      const { kod, dogrulayici } = kodVer();
      bozuk();
      expect((await iste('/oturum', { govde: { kod, dogrulayici } })).s).toBe(401);
    }
    // MFA açık ve kod MFA ile verilmişse geçer.
    d.kullanici = { ...KULLANICI, mfaAcik: true }; d.bag = { ...BAG };
    const { kod, dogrulayici } = kodVer({ mfa: true });
    const r = await iste('/oturum', { govde: { kod, dogrulayici } });
    expect(r.s).toBe(200);
  });

  it('kapı: iptal / kullanıcı / bağ okuma hatası ve boş kiracı → 503 (401 DEĞİL: site oturumu silmesin); sınırlar 401', async () => {
    const t = belirtec();
    expect((await iste('/ben', { token: t })).s).toBe(200);
    for (const bozuk of [() => { d.gecersizOnce = new Error('x'); }, () => { d.kullanici = new Error('x'); }, () => { d.bag = new Error('x'); }, () => { d.kiraci = ''; }]) {
      d = { kullanici: { ...KULLANICI }, bag: { ...BAG }, gecersizOnce: 0, kiraci: 'CETPA', iptalEt: null, revoke: [] };
      await kur();
      bozuk();
      expect(await iste('/ben', { token: t })).toEqual({ s: 503, j: { ok: false } });
    }
    d = { kullanici: { ...KULLANICI }, bag: { ...BAG }, gecersizOnce: 0, kiraci: 'CETPA', iptalEt: null, revoke: [] };
    await kur();
    for (const bozukBelirtec of [
      belirtec({ bas: saat - 10_000, bitis: saat - 1 }),                        // süresi dolmuş
      belirtec({ bas: saat - 10_000, bitis: saat }),                            // bitiş anı = şimdi (`şimdi < bitis` değil)
      belirtec({ bas: saat + 1, bitis: saat + 3_600_000 }),                     // başlangıç gelecekte
      belirtec({ cid: 'BASKA' }),                                                // yük kiracısı farklı
      belirtec({}, PANEL_ANAHTARI),                                              // `mb1-` öneki ama panel anahtarı
      belirtec({}, PANEL_ANAHTARI, PANEL_BELIRTECI),                             // panel belirteci
      'mb1-bozuk.bozuk', '',
    ]) expect((await iste('/ben', { token: bozukBelirtec })).s).toBe(401);
    // Sınırların öbür yüzü: bitişten 1 ms önce ve başlangıç anında geçer.
    expect((await iste('/ben', { token: belirtec({ bas: saat - 10_000, bitis: saat + 1 }) })).s).toBe(200);
    expect((await iste('/ben', { token: belirtec({ bas: saat, bitis: saat + 3_600_000 }) })).s).toBe(200);
    d.gecersizOnce = saat - 1000;                                                // iptal = belirteç başlangıcı (eşit an ret)
    expect((await iste('/ben', { token: t })).s).toBe(401);
    d.gecersizOnce = saat - 1001;                                                // iptal başlangıçtan 1 ms önce → yaşar
    expect((await iste('/ben', { token: t })).s).toBe(200);
    d.gecersizOnce = saat;                                                       // iptal belirteç başlangıcından sonra
    expect((await iste('/ben', { token: t })).s).toBe(401);
  });

  it('kapı her istekte bağı ve kullanıcıyı YENİDEN ölçer — iptal YOKKEN de: bağ kapalı / yok / başka kiracı, rol iç rol, kullanıcı yok, firma askıda, kiracı farklı, MFA açık ama belirteçte yok → 401', async () => {
    // Gerçek düzenekte erişim kapatma ve silme iptal değerini de «şimdi» yaptığı için 401 iki kapıdan birden gelir; burada iptal 0
    // tutulur ki bağ / kullanıcı ölçümü TEK BAŞINA sınansın (2026-10-21 paket turu: yalnız kapıdaki bağ ölçümünü kaldıran
    // mutasyonu — M39b — başka test yakalamıyordu).
    const t = belirtec();
    expect((await iste('/siparisler', { token: t })).s).toBe(200);
    for (const [ad, bozuk] of [
      ['bağ kapalı', () => { d.bag = { ...BAG, durum: 'kapali' }; }], ['bağ yok', () => { d.bag = null; }],
      ['bağ başka kiracının', () => { d.bag = { ...BAG, companyId: 'BASKA' }; }], ['rol iç rol', () => { d.kullanici = { ...KULLANICI, rol: 'Sales' }; }],
      ['kullanıcı yok', () => { d.kullanici = null; }], ['firma askıda', () => { d.kullanici = { ...KULLANICI, firmaDurumu: 'suspended' }; }],
      ['kullanıcı başka kiracının', () => { d.kullanici = { ...KULLANICI, cid: 'BASKA' }; }], ['MFA açık, belirteçte yok', () => { d.kullanici = { ...KULLANICI, mfaAcik: true }; }],
    ] as const) {
      d = { kullanici: { ...KULLANICI }, bag: { ...BAG }, gecersizOnce: 0, kiraci: 'CETPA', iptalEt: null, revoke: [] };
      bozuk();
      for (const yol of ['/ben', '/siparisler']) expect([ad, yol, (await iste(yol, { token: t })).s]).toEqual([ad, yol, 401]);
    }
    // Kontrol: MFA açık ve belirteç MFA ile verilmişse geçer (yukarıdaki 401'ler boşuna gelmiyor).
    d = { kullanici: { ...KULLANICI, mfaAcik: true }, bag: { ...BAG }, gecersizOnce: 0, kiraci: 'CETPA', iptalEt: null, revoke: [] };
    expect((await iste('/ben', { token: belirtec({ mfa: true }) })).s).toBe(200);
  });

  it('çıkış: iptal yazılamazsa 503 ve Firebase iptali YOK; başarıda 204 ve uid ile bir kez', async () => {
    d.iptalEt = new Error('yazma');
    expect((await iste('/cikis', { token: belirtec(), govde: {} })).s).toBe(503);
    expect(d.revoke).toEqual([]);
    d.iptalEt = null;
    expect((await iste('/cikis', { token: belirtec(), govde: {} })).s).toBe(204);
    expect(d.revoke).toEqual(['b1']);
  });

  it('sayaçlar AYRI küme: bayi retleri panel kümesine yazılmaz; 429 yazıcısı bayi sayacına', async () => {
    const panelOnce = magazaPanelSayaclari();
    await iste('/ben');
    await iste('/yok', { token: belirtec() });
    const yanit = { statusCode: 0, status(k: number) { this.statusCode = k; return this; }, json() { return this; } };
    magazaBayi429({} as never, yanit as never);
    expect(magazaBayiSayaclari()).toMatchObject({ r401: 1, r404: 1, r429: 1 });
    expect(magazaPanelSayaclari()).toEqual(panelOnce);
  });
});

describe('kaynak çitleri — magazaBayiZinciri.ts', () => {
  const YOL = join(SRC_KOK, 'server', 'routes', 'magazaBayiZinciri.ts');
  const satirlar = kodSatirlari(YOL).map(s => s.kod);
  const kod = satirlar.join('\n');
  it('kayıt sırası SABİT: önbelleksiz → köken → yapılandırma → oturum kovası + oturum → genel kova → kapı → ben / siparişler / çıkış → 404 → hata', () => {
    expect(satirlar.map(s => s.trim()).filter(s => /^bayi\.\w+\(/.test(s))).toEqual([
      'bayi.use(onbelleksiz);',
      'bayi.use(kokenKapisi);',
      'bayi.use(yapilandirmaKapisi);',
      "bayi.use('/oturum', C.bayiOturumSinirlayici);",
      "bayi.post('/oturum', jsonDegilse415, govdeAyristir, oturum);",
      'bayi.use(C.bayiSinirlayici);',
      'bayi.use(belirtecKapisi);',
      "bayi.get('/ben', ben);",
      "bayi.get('/siparisler', siparisler);",
      "bayi.post('/cikis', jsonDegilse415, govdeAyristir, cikis);",
      'bayi.use(bulunamadi);',
      'bayi.use(hataYakalayici);',
    ]);
    expect(kod.match(/\bRouter\(/g)).toHaveLength(1);
    expect(kod).toContain('const hataYakalayici = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {');
    expect(kod).not.toMatch(/req\.(path|originalUrl|url|baseUrl)\b|startsWith\('\/|\.toLowerCase\(/);
  });
  it('`oturum` işleyicisinde `kodDeposu.al` İLK `await`\'ten ÖNCE; kod ömrü yetki kodu ucuyla TEK sabit', () => {
    const bas = satirlar.findIndex(s => /const oturum = async \(req: Request, res: Response\): Promise<void> => \{/.test(s));
    const al = satirlar.findIndex((s, i) => i > bas && /C\.kodDeposu\.al\(/.test(s));
    const ilkAwait = satirlar.findIndex((s, i) => i > bas && /\bawait\b/.test(s));
    expect(bas).toBeGreaterThan(-1);
    expect(al).toBeGreaterThan(bas);
    expect(ilkAwait).toBeGreaterThan(al);
    expect(kod).toContain('!(kayit.bitis - MAGAZA_BAYI_KOD_OMRU_MS > gecersizOnce)');
    const erp = kodSatirlari(join(SRC_KOK, 'server', 'routes', 'magazaErpRoutes.ts')).map(s => s.kod).join('\n');
    expect(erp).toContain('bitis: simdi().getTime() + MAGAZA_BAYI_KOD_OMRU_MS');
  });
  it('sınırlayıcı kurmaz; sır / server.ts / pgShim / bekçi içe aktarmaz; yutan okuyucuları çağırmaz; günlük yalnız sabit metin + hata kodu; çıkışta iptal Firebase\'den ÖNCE', () => {
    expect(oku(YOL)).not.toContain('express-rate-limit');
    expect(kod).not.toMatch(/\brateLimit\s*\(|pgShim|opsWatchdog|server\.js|process\.env\.(SESSION_TOKEN_SECRET|FIREBASE_PRIVATE_KEY|APP_URL|MAGAZA_BAYI_DONUS)/);
    expect(kod).not.toMatch(/getUserRole|getUserCompanyId|getCompanyStatus|userHasMfa|isSuperAdmin|adminDb/);
    for (const s of kod.split('\n').map(x => x.trim()).filter(x => /\bconsole\./.test(x))) {
      expect(s).toMatch(/^console\.(error|warn)\((`\[magaza-bayi\] \$\{is\} işlenemedi:`|'\[magaza-bayi\] [^'$`]+(:'|')), hataKodu\((e|err)\)\);$|^console\.warn\('\[magaza-bayi\] [^'$`]+'\);$/);
    }
    expect(kod).not.toMatch(/\.(message|stack|detail|where|cause)\b|JSON\.stringify\((e|err|hata|req)\b/);
    const iptalSatiri = satirlar.findIndex(s => s.includes('await C.iptal.iptalEt(b.yuk.uid, b.bag.companyId);'));
    const firebase = satirlar.findIndex(s => s.includes('await C.firebaseYenilemeIptal(b.yuk.uid);'));
    expect(iptalSatiri).toBeGreaterThan(-1);
    expect(firebase).toBeGreaterThan(iptalSatiri);
    // Rol adı yazılmaz (dış rol ölçütü tek işlevden).
    expect(kod).toContain('disRolMu(k.rol)');
    expect(kod).not.toMatch(/'(B2B|Dealer|Admin|Sales)'/);
  });
});
