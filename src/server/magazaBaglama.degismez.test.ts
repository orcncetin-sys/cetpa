/**
 * magazaBaglama.degismez.test.ts — mağaza (www.cetpa.com.tr) uçlarının server.ts BAĞLAMASININ çiti (2026-10-08, dilim 1).
 *
 * Zincirin davranışı `routes/magazaRoutes.test.ts`'te gerçek express ile sınanır; ama o test server.ts'in KENDİSİNİ koşturamaz
 * (giriş dosyası, yan etkili). Zincir yanlış yere bağlanırsa her şey derlenir ve testler yeşil kalır, canlıda ise:
 *  • genel gövde ayrıştırıcıdan SONRA → 64 KB sınırı uygulanmaz, bozuk JSON genel yakalayıcıdan 500 + günlükte gövde parçası;
 *  • zincirin ÜSTÜNE uygulama düzeyinde başka bir gövde ayrıştırıcı (`express.raw` / yol verilmiş `express.json` …) → aynı sonuç;
 *  • genel sınırlayıcıdan SONRA → izinsiz köken ve OPTIONS da genel kovayı tüketir;
 *  • koşul altında (`if (…) app.use(…)` ya da `if (…) {` bloğunda) → koşul tutmayan ortamda uç hiç yok, mağaza bunu görmez;
 *  • kuyruk listesinde yok / işçi koşulsuz bağlı → 2026-07 disk dolmasının hata döngüsü.
 * Sınırlayıcıların anahtar üreticisi `hizSiniri.degismez.test.ts` tablosunda kilitlidir; burada tavanlar ve 429 yazıcısı.
 *
 * DİLİM 2a (2026-10-10): site paneli alt zinciri (`magazaPanelZinciri`) mağaza zincirine BAĞLAMLA girer; ERP kökenindeki mağaza
 * uçları (`magazaErpRoutes`) öbür rota modülleriyle, genel ayrıştırıcıdan SONRA kaydolur; kod deposu / iptal çifti / kullanıcı
 * okuyucu TEK örnektir; `dbLimiter` tanımı `if (pgPool) {` bloğunun DIŞINDADIR. Davranış `routes/magazaPanelUclar.test.ts`'te.
 *
 * YASAK denetimleri (`not.toMatch`) YORUMSUZ kodda ve dar hedefte yapılır: yorumdaki bir anma ya da ilgisiz bir satırdaki aynı
 * sözcük çiti kırmasın (inceleme turu 2026-10-08 — «assertion kendi yorumuna takıldı» sınıfı).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { kodSatirlari, oku, SRC_KOK } from '../test/kaynakTarama';

const SERVER = join(SRC_KOK, '..', 'server.ts');
const satirlar = kodSatirlari(SERVER);
const kod = satirlar.map(s => s.kod).join('\n');
const satirNo = (desen: RegExp): number[] => satirlar.filter(s => desen.test(s.kod)).map(s => s.n);
const tek = (desen: RegExp): number => { const n = satirNo(desen); expect(n, String(desen)).toHaveLength(1); return n[0]; };
/** Satırın girintisi (ilk boşluk olmayan karakterin sütunu) — blok düzeyinin kaynak metindeki izi. */
const girinti = (n: number): number => satirlar[n - 1].kod.search(/\S/);

describe('zincirin YERİ', () => {
  /** Zincirin bağlandığı satır. Satır başına ve sonuna çapalı: `if (…) app.use('/api/magaza', …` (tek satırlık koşul) bu desene UYMAZ. */
  const ZINCIR_SATIRI = /^\s*app\.use\('\/api\/magaza', magazaZinciri\(\{\s*$/;

  it('tam BİR kez ve KOŞULSUZ bağlı; genel sınırlayıcıdan ve genel gövde ayrıştırıcıdan ÖNCE; sınırlayıcı tanımlarından SONRA', () => {
    const zincir = tek(ZINCIR_SATIRI);
    expect(satirNo(/magazaZinciri\(/)).toEqual([zincir]);
    expect(tek(/const apiLimiter = rateLimit\(\{/)).toBeLessThan(zincir);
    expect(tek(/const magazaTalepLimiter = rateLimit\(\{/)).toBeLessThan(zincir);
    expect(tek(/const magazaDurumLimiter = rateLimit\(\{/)).toBeLessThan(zincir);
    const genelSinirlayici = tek(/app\.use\('\/api', apiLimiter\);/);
    expect(zincir).toBeLessThan(genelSinirlayici);
    expect(zincir).toBeLessThan(tek(/app\.use\(express\.json\(/));
    // Blok biçimli koşul (`if (…) {` altında bağlama) satır çapasından geçer. Girinti yalnız YENİDEN GİRİNTİLENMİŞ bloğu yakalar:
    // zincir, koşulsuz bağlanan genel sınırlayıcıyla AYNI blok düzeyindedir.
    expect(girinti(zincir)).toBe(girinti(genelSinirlayici));
    // Girintisi DEĞİŞMEYEN koşulu iki denetim yakalar: zincirden önceki kod satırı bir ifadeyi kapatır (`if (…)` ya da `{` ile
    // bitmez) ve zincir ile genel sınırlayıcı arasında tek başına duran bir blok kapanışı yoktur.
    const oncekiKod = satirlar.filter(s => s.n < zincir && s.kod.trim() !== '').pop()!.kod.trim();
    expect(oncekiKod, 'zincirden önceki kod satırı bir ifadeyi kapatmalı').toMatch(/[;}]$/);
    expect(satirlar.filter(s => s.n > zincir && s.n < genelSinirlayici && /^\s*\}\s*$/.test(s.kod)).map(s => s.n)).toEqual([]);
  });
  it('zincirden ÖNCE uygulama düzeyinde gövde ayrıştırıcı YOK: izinli tek ayrıştırıcı rota düzeyindeki `dbJson`', () => {
    // Yukarıdaki sıra denetimi yalnız yol verilmemiş `app.use(express.json(` satırını görür; `express.raw(…)` ya da
    // `app.use('/api', express.json(…))` zincirin üstüne eklenirse gövdeyi zincirden önce o okur (64 KB sınırı ve zincirin kendi
    // hata yakalayıcısı devreden çıkar). `dbJson` yalnız rota işleyicilerine (`app.post(…, dbJson, …)`) verilir, `app.use`'a değil.
    const zincir = tek(ZINCIR_SATIRI);
    const onceki = satirlar.filter(s => s.n < zincir && /\bexpress\.(json|urlencoded|text|raw)\(/.test(s.kod)).map(s => s.kod.trim());
    expect(onceki).toHaveLength(1);
    expect(onceki[0]).toMatch(/^const dbJson = express\.json\(/);
    expect(satirNo(/app\.use\([^;]*\bdbJson\b/)).toEqual([]);
  });
  it('ham metinde de tek bağlama (yorum süzgecinin göremediği bölgede ikinci bir bağlama yok)', () => {
    expect((oku(SERVER).match(/magazaZinciri\(\{/g) ?? []).length).toBe(1);
  });
  it('zincire giden bağlam: genel sınırlayıcının KENDİSİ, iki AYRI mağaza sınırlayıcısı, panel alt zinciri, ham havuz, kiracı çözümleyici, yayın, bildirim', () => {
    // Dilim 2a: + `panelZinciri` (BİREBİR yeniden yazıldı; takip sayaçları için geri çağrı YOK — işlev rota modülünde).
    // 2026-10-21 (müşteri siparişlerim H11): + `bayiZinciri: magazaBayi,` (bilerek değişen çit).
    expect(kod).toMatch(/magazaZinciri\(\{\s*apiLimiter, talepSinirlayici: magazaTalepLimiter, durumSinirlayici: magazaDurumLimiter, panelZinciri: magazaPanel,\s*bayiZinciri: magazaBayi,\s*getPgPool: \(\) => pgPool, serverTenantId, broadcastDocChange, bildirimIste: magazaBildirimIste,\s*\}\)\);/);
  });
  it('`/panel` dışındaki mağaza uçları genel sınırlayıcıdan MUAF değil (KOD taranır, yorumdaki anma sayılmaz); rota modülleri bekçiyle AYNI yoldan içe aktarılır (sayaçlar tek modül örneğinde)', () => {
    // `istemciIp.ts` yolların muafiyet durumunu yorumda tek tek anlatır; oraya mağaza için bir cümle eklemek çiti kırmamalı.
    // Panel muafiyeti yol listesiyle DEĞİL, alt zincirin mağaza zincirinde genel sınırlayıcıdan ÖNCE bağlanmasıyla sağlanır.
    expect(kodSatirlari(join(SRC_KOK, 'server', 'istemciIp.ts')).map(s => s.kod).join('\n')).not.toMatch(/\/api\/magaza/);
    tek(/from "\.\/src\/server\/routes\/magazaRoutes\.js";/);
    expect(oku(join(SRC_KOK, 'server', 'opsWatchdog.ts'))).toMatch(/from '\.\/routes\/magazaRoutes\.js';/);
    tek(/from "\.\/src\/server\/routes\/magazaPanelZinciri\.js";/);
    expect(oku(join(SRC_KOK, 'server', 'opsWatchdog.ts'))).toMatch(/from '\.\/routes\/magazaPanelZinciri\.js';/);
    // 2026-10-21: bayi alt zinciri de bekçiyle AYNI yoldan (sayaçları `magazaBayiSayaclari()` modül düzeyindedir).
    tek(/from "\.\/src\/server\/routes\/magazaBayiZinciri\.js";/);
    expect(oku(join(SRC_KOK, 'server', 'opsWatchdog.ts'))).toMatch(/from '\.\/routes\/magazaBayiZinciri\.js';/);
  });
});

describe('sınırlayıcılar: sel koruması (iş sınırı DEĞİL), ayrı kovalar, sabit 429', () => {
  const govde = (ad: string): string => kod.match(new RegExp(`const ${ad} = rateLimit\\(\\{([\\s\\S]*?)\\n\\s*\\}\\)`))?.[1] ?? '';
  it('talep 30 / 15 dk, takip 20 / 15 dk (dilim 1\'in 60\'ı bilerek daraltıldı — V11); ikisi de yalnız IP ve 429\'u `magaza429` yazar; `skip` / `message` yok', () => {
    expect(govde('magazaTalepLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 30,/);
    expect(govde('magazaDurumLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 20,/);
    for (const ad of ['magazaTalepLimiter', 'magazaDurumLimiter']) {
      expect(govde(ad), ad).toMatch(/keyGenerator: yalnizIpAnahtari,\s+handler: magaza429,/);
      expect(govde(ad), ad).not.toMatch(/skip|message/);
    }
  });
  it('site paneli: `oturum` 20 / 15 dk, öbür panel uçları 600 / 15 dk — yalnız IP, 429\'u `magazaPanel429` yazar (panel sayacı); kalem teslim ve etiket için AYRI kova yok', () => {
    expect(govde('magazaPanelOturumLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 20,/);
    expect(govde('magazaPanelLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 600,/);
    for (const ad of ['magazaPanelOturumLimiter', 'magazaPanelLimiter']) {
      expect(govde(ad), ad).toMatch(/keyGenerator: yalnizIpAnahtari,\s+handler: magazaPanel429,/);
      expect(govde(ad), ad).not.toMatch(/skip|message/);
    }
    // Mağaza için sınırlayıcı sayısı SABİT: talep, takip, panel oturumu, panel, yetki kodu + (dilim 2b) içerik — üç 2a ERP talep ucu
    // `dbLimiter` kovasında kalır; panelin silme ucu panel kovasındadır (ayrı kova yok). 5 → 6 bilerek değişen çittir.
    // 2026-10-21 (müşteri siparişlerim H11): + dört bayi kovası (site: oturum, genel; ERP: yetki kodu, firma okuma) — 6 → 10.
    expect(satirNo(/const magaza\w+Limiter = rateLimit\(\{/)).toHaveLength(10);
  });
  it('yetki kodu (ERP kökeni): 10 / 15 dk, KULLANICI anahtarlı, 429\'u `magazaYetkiKodu429` yazar (`kod: \'sinir\'`)', () => {
    expect(govde('magazaYetkiKoduLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 10,/);
    expect(govde('magazaYetkiKoduLimiter')).toMatch(/keyGenerator: userOrIpKey,\s+handler: magazaYetkiKodu429,/);
    expect(govde('magazaYetkiKoduLimiter')).not.toMatch(/skip|message/);
  });
  it('içerik uçları (dilim 2b, ERP kökeni — elle talep / içerik / silme): 60 / 15 dk, KULLANICI anahtarlı, 429\'u `magazaIcerik429` yazar', () => {
    expect(govde('magazaIcerikLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 60,/);
    expect(govde('magazaIcerikLimiter')).toMatch(/keyGenerator: userOrIpKey,\s+handler: magazaIcerik429,/);
    expect(govde('magazaIcerikLimiter')).not.toMatch(/skip|message/);
    // 429 yazıcısı rota modülünden içe aktarılır (sayaç tek modül örneğinde); tanım `magazaErpRoutes` bağlamından ÖNCE.
    // 2026-10-21: + iki bayi köprüsü 429 yazıcısı (aynı içe aktarım satırı; bilerek değişen çit).
    tek(/^import \{ magazaBayiHesap429, magazaBayiYetkiKodu429, magazaErpRoutes, magazaIcerik429, magazaYetkiKodu429 \} from "\.\/src\/server\/routes\/magazaErpRoutes\.js";$/);
    expect(tek(/const magazaIcerikLimiter = rateLimit\(\{/)).toBeLessThan(tek(/^\s*magazaErpRoutes\(app, \{\s*$/));
  });
  it('her sınırlayıcı YALNIZ kendi bağlamına verilir (başka yere bağlanırsa istek iki kez sayılır)', () => {
    expect(satirNo(/magazaTalepLimiter/)).toHaveLength(2);   // tanım + zincir bağlamı
    expect(satirNo(/magazaDurumLimiter/)).toHaveLength(2);
    expect(satirNo(/magazaPanelOturumLimiter/)).toHaveLength(2);   // tanım + panel alt zinciri bağlamı
    expect(satirNo(/magazaPanelLimiter/)).toHaveLength(2);
    expect(satirNo(/magazaYetkiKoduLimiter/)).toHaveLength(2);     // tanım + `magazaErpRoutes` bağlamı
    expect(satirNo(/magazaIcerikLimiter/)).toHaveLength(2);        // tanım + `magazaErpRoutes` bağlamı
    // 2026-10-21: bayi kovaları — site kovaları bayi alt zinciri bağlamına, ERP kovaları `magazaErpRoutes` bağlamına; panelinkiler paylaşılmaz.
    expect(satirNo(/magazaBayiOturumLimiter/)).toHaveLength(2);
    expect(satirNo(/magazaBayiLimiter\b/)).toHaveLength(2);
    expect(satirNo(/magazaBayiYetkiKoduLimiter/)).toHaveLength(2);
    expect(satirNo(/magazaBayiHesapLimiter/)).toHaveLength(2);
    expect(kod).toMatch(/const magazaBayiOturumLimiter = rateLimit\(\{\s*windowMs: 15 \* 60 \* 1000,\s*max: 20,\s*standardHeaders: true,\s*legacyHeaders: false,\s*keyGenerator: yalnizIpAnahtari,\s*handler: magazaBayi429,\s*\}\);/);
    expect(kod).toMatch(/const magazaBayiLimiter = rateLimit\(\{\s*windowMs: 15 \* 60 \* 1000,\s*max: 600,\s*standardHeaders: true,\s*legacyHeaders: false,\s*keyGenerator: yalnizIpAnahtari,\s*handler: magazaBayi429,\s*\}\);/);
    expect(kod).toMatch(/const magazaBayiYetkiKoduLimiter = rateLimit\(\{\s*windowMs: 15 \* 60 \* 1000,\s*max: 10,\s*standardHeaders: true,\s*legacyHeaders: false,\s*keyGenerator: userOrIpKey,\s*handler: magazaBayiYetkiKodu429,\s*\}\);/);
    expect(kod).toMatch(/const magazaBayiHesapLimiter = rateLimit\(\{\s*windowMs: 15 \* 60 \* 1000,\s*max: 60,\s*standardHeaders: true,\s*legacyHeaders: false,\s*keyGenerator: userOrIpKey,\s*handler: magazaBayiHesap429,\s*\}\);/);
    // Sınırlayıcılar `app.use` ile öneke DEĞİL, yalnız bağlamla verilir.
    expect(satirNo(/app\.use\([^;]*\bmagaza\w*Limiter\b/)).toEqual([]);
  });
});

describe('site paneli ve ERP mağaza uçları — bağlama (dilim 2a)', () => {
  const ZINCIR = /^\s*app\.use\('\/api\/magaza', magazaZinciri\(\{\s*$/;
  const ERP = /^\s*magazaErpRoutes\(app, \{\s*$/;

  it('panel alt zinciri TEK kez kurulur, mağaza zincirinden hemen ÖNCE; bağlamı BİREBİR', () => {
    const panel = tek(/^\s*const magazaPanel = magazaPanelZinciri\(\{\s*$/);
    expect(satirNo(/magazaPanelZinciri\(/)).toEqual([panel]);
    expect(panel).toBeLessThan(tek(ZINCIR));
    expect(tek(/const magazaPanelOturumLimiter = rateLimit\(\{/)).toBeLessThan(panel);
    expect(tek(/const magazaPanelLimiter = rateLimit\(\{/)).toBeLessThan(panel);
    expect(kod).toMatch(/magazaPanelZinciri\(\{\s*panelOturumSinirlayici: magazaPanelOturumLimiter, panelSinirlayici: magazaPanelLimiter, panelAnahtari: magazaPanelAnahtari,\s*panelKullanicisi: magazaPanelKullanici\.panelKullanicisi, kodDeposu: magazaPanelKodDeposu, iptal: magazaPanelIptal,\s*getPgPool: \(\) => pgPool, serverTenantId, broadcastDocChange, writeAuditLog, bildirimIste: magazaBildirimIste,\s*degisiklikDinle: \(dinleyici\) => \{ dbEvents\.on\('change', dinleyici\); \},\s*\}\);/);
    // Panel alt zinciri uygulamaya DOĞRUDAN bağlanmaz: yalnız mağaza zincirinin bağlamında (`/panel` öneki orada).
    expect(satirNo(/\bmagazaPanel\b/)).toEqual([panel, tek(ZINCIR) + 1]);   // tanım + mağaza zincirinin bağlam satırı
    expect(satirNo(/app\.use\([^;]*\bmagazaPanel\b/)).toEqual([]);
  });
  it('(2026-10-21, H11) bayi alt zinciri TEK kez kurulur — panelden SONRA, mağaza zincirinden hemen ÖNCE; bağlamı BİREBİR; uygulamaya doğrudan bağlanmaz', () => {
    const bayi = tek(/^\s*const magazaBayi = magazaBayiZinciri\(\{\s*$/);
    expect(satirNo(/magazaBayiZinciri\(/)).toEqual([bayi]);
    expect(bayi).toBeGreaterThan(tek(/^\s*const magazaPanel = magazaPanelZinciri\(\{\s*$/));
    expect(bayi).toBeLessThan(tek(ZINCIR));
    expect(tek(/const magazaBayiOturumLimiter = rateLimit\(\{/)).toBeLessThan(bayi);
    expect(tek(/const magazaBayiLimiter = rateLimit\(\{/)).toBeLessThan(bayi);
    expect(kod).toMatch(/magazaBayiZinciri\(\{\s*bayiOturumSinirlayici: magazaBayiOturumLimiter, bayiSinirlayici: magazaBayiLimiter,\s*bayiAnahtari: magazaBayiAnahtari, bayiKimlikAnahtari: magazaBayiKimlikAnahtari,\s*panelKullanicisi: magazaPanelKullanici\.panelKullanicisi, musteriHesabi: musteriHesapOkuyucu\.musteriHesabi,\s*kodDeposu: magazaBayiKodDeposu, iptal: magazaPanelIptal, firebaseYenilemeIptal,\s*getPgPool: \(\) => pgPool, serverTenantId, writeAuditLog,\s*\}\);/);
    expect(satirNo(/\bmagazaBayi\b/)).toEqual([bayi, tek(ZINCIR) + 2]);   // tanım + mağaza zincirinin bağlam satırı
    expect(satirNo(/app\.use\([^;]*\bmagazaBayi\b/)).toEqual([]);
  });
  it('`magazaErpRoutes` TEK kez, KOŞULSUZ, genel gövde ayrıştırıcıdan ve genel sınırlayıcıdan SONRA; bağlamı BİREBİR', () => {
    const erp = tek(ERP);
    expect(satirNo(/magazaErpRoutes\(/)).toEqual([erp]);
    expect((oku(SERVER).match(/magazaErpRoutes\(app, \{/g) ?? []).length).toBe(1);
    expect(erp).toBeGreaterThan(tek(/app\.use\(express\.json\(/));
    expect(erp).toBeGreaterThan(tek(/app\.use\('\/api', apiLimiter\);/));
    // Öbür rota modülleriyle AYNI blok düzeyi (koşul altında değil).
    expect(girinti(erp)).toBe(girinti(tek(/^\s*trackingRoutes\(app, \{/)));
    // Dilim 2b: + `magazaIcerikLimiter` (elle talep / içerik / silme kovası) ve `revizeBildirimiIste` (revize kuyruğunun isteyicisi) —
    // bağlam BİREBİR yeniden yazıldı. İki bildirim isteyicisi AYRI örneklerdir (ayrı kuyruk, ayrı «hazır» bayrağı).
    // 2026-10-21 (müşteri siparişlerim H1 / H4): + ORTAK iptal örneği AÇIKÇA, iki bayi kovası, bayi kod deposu (AYRI), bağ
    // okuyucu ve bayi dönüş adresi (iki anahtardan biri yoksa `null`) — bilerek değişen çit.
    expect(kod).toMatch(/magazaErpRoutes\(app, \{\s*requireAuth, requireMfaVerified, dbLimiter, magazaYetkiKoduLimiter, magazaIcerikLimiter,\s*belirtecIptalDenetle: \(belirtec\) => getAuth\(\)\.verifyIdToken\(belirtec, true\),\s*panelKullanicisi: magazaPanelKullanici\.panelKullanicisi, kodDeposu: magazaPanelKodDeposu,\s*getPgPool: \(\) => pgPool, broadcastDocChange, writeAuditLog, bildirimIste: magazaBildirimIste, revizeBildirimiIste: magazaRevizeBildirimIste,\s*smtpYapilandirmasi: \(\) => smtpYapilandirmasi\(\), serverTenantId,\s*panelDonus: magazaPanelAnahtari === null \? null : magazaPanelDonusTabani,\s*iptal: magazaPanelIptal, magazaBayiYetkiKoduLimiter, magazaBayiHesapLimiter,\s*bayiKodDeposu: magazaBayiKodDeposu, musteriHesabi: musteriHesapOkuyucu\.musteriHesabi,\s*bayiDonus: magazaBayiAnahtari === null \|\| magazaBayiKimlikAnahtari === null \? null : magazaBayiDonusTabani,\s*\}\);/);
    // Revize isteyicisi YALNIZ ERP bağlamına gider: panel alt zinciri ve kimliksiz mağaza zinciri içerik yazmaz, revize bildirimi istemez.
    expect(satirNo(/revizeBildirimiIste: /)).toEqual([erp + 4]);
  });
  it('`dbLimiter` TANIMI `if (pgPool) {` bloğunun DIŞINDA ve ÖNÜNDE (ERP mağaza uçları aynı kovayı kullanır; modül bloğun dışında kaydolur)', () => {
    const tanim = tek(/^\s*const dbLimiter = rateLimit\(\{\s*$/);
    // `/api/db` bloğu: açılış satırının hemen ardından `const docsDb = pgPool;` gelir (dosyada başka `if (pgPool) {` da var).
    const blok = tek(/^\s*const docsDb = pgPool;$/) - 1;
    expect(satirlar[blok - 1].kod).toMatch(/^\s*if \(pgPool\) \{\s*$/);
    expect(tanim).toBeLessThan(blok);
    expect(tanim).toBeLessThan(tek(ERP));
    // Blok düzeyi: `startServer` gövdesi (bloğun içindeki satırlardan bir kademe dışarıda), `userOrIpKey` tanımından SONRA.
    expect(girinti(tanim)).toBe(girinti(blok));
    expect(tek(/const userOrIpKey = /)).toBeLessThan(tanim);
    // Blok içinde ikinci bir tanım kalmadı.
    expect(satirNo(/\bdbLimiter = /)).toEqual([tanim]);
  });
  it('kod deposu, iptal çifti ve kullanıcı okuyucu MODÜL DÜZEYİNDE BİR kez kurulur; AYNI tanımlayıcı bütün çağıranlara gider', () => {
    const okuyucu = tek(/^const magazaPanelKullanici = panelKullanicisiKur\(\{ adminDb: \(\) => adminDb, pgPool: \(\) => pgPool \}\);$/);
    const depo = tek(/^const magazaPanelKodDeposu = kodDeposuKur\(\);$/);
    const iptal = tek(/^const magazaPanelIptal = iptalKur\(\{ adminDb: \(\) => adminDb \}\);$/);
    // 2026-10-21: + bayi kod deposu (AYRI örnek; panel kodu bayi oturumunda geçersiz) — bilerek değişen çit.
    const bayiDepo = tek(/^const magazaBayiKodDeposu = kodDeposuKur\(\);$/);
    expect(satirNo(/panelKullanicisiKur\(|kodDeposuKur\(|iptalKur\(/)).toEqual([okuyucu, depo, iptal, bayiDepo]);
    // Kod deposu: yazan (`magazaErpRoutes`) + okuyup silen (`magazaPanelZinciri`). Ayrı `Map` olsaydı her değişim 401 dönerdi.
    expect(satirNo(/kodDeposu: magazaPanelKodDeposu/)).toHaveLength(2);
    // Bayi deposu: yazan (`magazaErpRoutes` — `bayiKodDeposu:`) + okuyup silen (bayi alt zinciri — `kodDeposu:`).
    expect(satirNo(/bayiKodDeposu: magazaBayiKodDeposu/)).toHaveLength(1);
    expect(satirNo(/(?<!bayiK)kodDeposu: magazaBayiKodDeposu/)).toHaveLength(1);
    // İptal çifti TEK örnek: panel alt zinciri (kapı + `cikis`) + ERP çıkış işleyicisi + (2026-10-21) bayi alt zinciri, ERP bayi
    // köprüsü, hesap silme (epostaRoutes) ve bağ uçları (musteriHesapRoutes) — yeni örnek KURULMAZ.
    expect(satirNo(/\bmagazaPanelIptal\b(?!\.js)/)).toHaveLength(7);   // tanım + altı çağıran (içe aktarım satırındaki dosya adı sayılmaz)
    expect(satirNo(/\biptal: magazaPanelIptal\b/)).toHaveLength(5);
    // Kullanıcı okuyucu: üç rota bağlamı (panel, ERP, bayi).
    expect(satirNo(/panelKullanicisi: magazaPanelKullanici\.panelKullanicisi/)).toHaveLength(3);
    // Bağ okuyucu TEK örnek: bayi alt zinciri + ERP köprüsü.
    tek(/^const musteriHesapOkuyucu = musteriHesapOkuyucuKur\(\{ adminDb: \(\) => adminDb \}\);$/);
    expect(satirNo(/musteriHesabi: musteriHesapOkuyucu\.musteriHesabi/)).toHaveLength(2);
    // Dinleyici modül yüklenirken kaydedilir: okuyucu ondan ÖNCE tanımlı.
    expect(okuyucu).toBeLessThan(tek(/^dbEvents\.on\('change', \(ev: \{ coll\?: string; id\?: string \}\) => \{$/));
  });
  it('panel kullanıcı önbelleği ÜÇ yerde düşer: `users` olayı, `companyStatus` olayı, MFA yazan HER satır', () => {
    // Rol / kiracı önbelleğini düşüren satırın (çiti: ayarKapilari.degismez.test.ts) HEMEN ardında, AYNI süreç düzeyi dinleyicide.
    const dinleyici = tek(/^dbEvents\.on\('change', \(ev: \{ coll\?: string; id\?: string \}\) => \{$/);
    expect(tek(/^ {2}if \(ev\.coll === 'users' && ev\.id\) magazaPanelKullanici\.dusur\(ev\.id\);$/)).toBe(dinleyici + 2);
    expect(tek(/^ {2}if \(ev\.coll === 'companyStatus'\) magazaPanelKullanici\.temizle\(\);$/)).toBe(dinleyici + 3);
    expect(satirNo(/magazaPanelKullanici\.temizle\(/)).toHaveLength(1);
    // 2026-10-21: bağ okuyucu da AYNI dinleyicide düşer — `users` ve `musteriHesaplari` olaylarında (rol düşürme / erişim kapatma
    // bayi belirtecini 60 sn beklemeden öldürür).
    expect(tek(/^ {2}if \(\(ev\.coll === 'users' \|\| ev\.coll === MUSTERI_HESAP_KOLEKSIYONU\) && ev\.id\) musteriHesapOkuyucu\.dusur\(ev\.id\);$/)).toBe(dinleyici + 6);
    expect(satirNo(/musteriHesapOkuyucu\.dusur\(/)).toHaveLength(1);
    // `mfa_secrets` yazımı `docs` olayı ÜRETMEZ: `mfaStatusCache.delete(` geçen her satır panel önbelleğini de düşürür.
    // Dört yazan: kayıt başlat, kayıt doğrula, kapat + Yönetici sıfırlaması (`mfaKaydiniSil`, 2026-10-11 — şartname «dış rol kapanışı» D10).
    const mfa = satirlar.filter(s => /mfaStatusCache\.delete\(/.test(s.kod));
    expect(mfa).toHaveLength(4);
    for (const s of mfa) expect(s.kod, `server.ts:${s.n}`).toMatch(/mfaStatusCache\.delete\((r\.uid|uid)\); magazaPanelKullanici\.dusur\(\1\);/);
    expect(satirNo(/magazaPanelKullanici\.dusur\(/)).toHaveLength(5);
  });
  it('ERP çıkış işleyicisi panel iptalini ÖNCE Bearer, yoksa ÇEREZDEN çözülen kimlikle çağırır — refresh token iptalinden BAĞIMSIZ ve ondan ÖNCE', () => {
    const rota = tek(/app\.post\('\/api\/db\/session\/logout', dbLimiter, async \(req: Request, res: Response\) => \{/);
    // 2026-10-21 (müşteri siparişlerim H2): kimlik önce `Authorization: Bearer`'dan (yerel doğrulama, iptal denetimi yok), yoksa
    // çerezden — dış rolün çerezi yoktur; bayat çerez Bearer'ı ezmesin diye Bearer ÖNCE (bilerek değişen çit). Ad `cikisUid` kalır.
    const bearer = tek(/^\s*const cikisBearerUid = async \(req: Request\): Promise<string \| null> => \{$/);
    expect(kod).toMatch(/const cikisBearerUid = async \(req: Request\): Promise<string \| null> => \{\s*const b = yetkiBelirteci\(req\.headers\.authorization\);\s*if \(!b\) return null;\s*try \{ return \(await getAuth\(\)\.verifyIdToken\(b\)\)\.uid \|\| null; \} catch \{ return null; \}\s*\};/);
    expect(bearer).toBeLessThan(rota);
    const kimlik = tek(/^\s*const cikisUid = \(await cikisBearerUid\(req\)\) \?\? verifySessionTokenUid\(parseCookie\(req\.headers\.cookie, SESSION_COOKIE\)\);$/);
    const iptal = tek(/^\s*await erpCikisindaPanelIptalEt\(magazaPanelIptal, cikisUid\);$/);
    // Firebase yenileme iptali TEK yardımcıdan (ERP çıkışı, bayi çıkışı, erişim kapatma); `revokeRefreshTokens(` dosyada TAM bir kez.
    const refresh = tek(/if \(cikisUid\) await firebaseYenilemeIptal\(cikisUid\);/);
    tek(/^const firebaseYenilemeIptal = \(uid: string\): Promise<void> => getAuth\(\)\.revokeRefreshTokens\(uid\);$/);
    expect(satirNo(/revokeRefreshTokens\(/)).toHaveLength(1);
    expect((oku(SERVER).match(/revokeRefreshTokens\(/g) ?? []).length).toBe(1);
    expect(rota).toBeLessThan(kimlik);
    expect(kimlik).toBeLessThan(iptal);
    expect(iptal).toBeLessThan(refresh);
    expect(refresh).toBeLessThan(rota + 20);
    // Panel iptali `try` içinde DEĞİL (yardımcı fırlatmaz) ve refresh iptalinin `try`ından önce: Firebase arızası onu atlatamaz.
    expect(satirlar.filter(s => s.n > rota && s.n < iptal && /\btry \{/.test(s.kod))).toEqual([]);
    expect(satirlar[rota - 1].kod).not.toMatch(/requireAuth/);
    expect(satirNo(/erpCikisindaPanelIptalEt\(/)).toEqual([iptal]);
  });
  it('anahtar ve dönüş adresi açılışta BİR kez, modül düzeyinde çözülür; sır yalnız türetme işlevine gider; bekçi yalnız VARLIĞI okur', () => {
    const donus = tek(/^const magazaPanelDonusTabani = donusTabaniCoz\(process\.env\.MAGAZA_PANEL_DONUS, \{$/);
    const anahtar = tek(/^const magazaPanelAnahtari = panelAnahtariTuret\(\{$/);
    expect(tek(/^const SESSION_TOKEN_SECRET = /)).toBeLessThan(anahtar);
    expect(donus).toBeLessThan(anahtar);
    expect(kod).toMatch(/donusTabaniCoz\(process\.env\.MAGAZA_PANEL_DONUS, \{\s*uretim: process\.env\.NODE_ENV === 'production',\s*izinliKokenler: magazaIzinliKokenleriCoz\(process\.env\.MAGAZA_IZINLI_KOKENLER\),\s*\}\);/);
    expect(kod).toMatch(/panelAnahtariTuret\(\{\s*sirVar: panelSirriVar\(process\.env\), oturumSirri: SESSION_TOKEN_SECRET, donusTabani: magazaPanelDonusTabani, appUrl: process\.env\.APP_URL,\s*\}\);/);
    expect(satirNo(/process\.env\.MAGAZA_PANEL_DONUS/)).toEqual([donus]);
    tek(/magazaPanelYapilandirmasi: \(\) => \(\{ anahtarVar: magazaPanelAnahtari !== null, donusVar: magazaPanelDonusTabani !== null \}\),/);
    // Rota bağlamlarına ham ortam metni / sır GİTMEZ: panel yalnız türetilmiş anahtarı, ERP yalnız kurallı dönüş adresini alır.
    expect(satirNo(/\bmagazaPanelAnahtari\b/)).toHaveLength(4);       // tanım, bekçi, panel bağlamı, ERP `panelDonus` koşulu
    expect(satirNo(/\bmagazaPanelDonusTabani\b/)).toHaveLength(4);    // tanım, anahtar türetme, bekçi, ERP `panelDonus`
  });
  it('(2026-10-21, H3) bayi dönüş adresi, imza anahtarı ve sipariş kimliği anahtarı modül düzeyinde BİR kez, TÜR parametreli işlevlerle; `MAGAZA_BAYI_DONUS` tek satırda ve panel çözücüsüne GİTMEZ', () => {
    const donus = tek(/^const magazaBayiDonusTabani = donusTabaniCozTur\(BAYI_BELIRTECI, process\.env\.MAGAZA_BAYI_DONUS, \{$/);
    const anahtar = tek(/^const magazaBayiAnahtari = anahtarTuret\(BAYI_BELIRTECI, \{$/);
    const kimlik = tek(/^const magazaBayiKimlikAnahtari = bayiKimlikAnahtariTuret\(\{ sirVar: panelSirriVar\(process\.env\), oturumSirri: SESSION_TOKEN_SECRET, appUrl: process\.env\.APP_URL \}\);$/);
    expect(tek(/^const SESSION_TOKEN_SECRET = /)).toBeLessThan(donus);
    expect(donus).toBeLessThan(anahtar);
    expect(anahtar).toBeLessThan(kimlik);
    expect(kod).toMatch(/anahtarTuret\(BAYI_BELIRTECI, \{\s*sirVar: panelSirriVar\(process\.env\), oturumSirri: SESSION_TOKEN_SECRET, donusTabani: magazaBayiDonusTabani, appUrl: process\.env\.APP_URL,\s*\}\);/);
    expect(satirNo(/MAGAZA_BAYI_DONUS/)).toEqual([donus]);
    expect(satirNo(/donusTabaniCoz\([^)]*MAGAZA_BAYI_DONUS/)).toEqual([]);
    // Bayi tanımlayıcıları yalnız beklenen yerlerde (ham sır rota bağlamına gitmez).
    expect(satirNo(/\bmagazaBayiAnahtari\b/)).toHaveLength(4);        // tanım, bekçi, bayi zinciri bağlamı, ERP `bayiDonus` koşulu
    expect(satirNo(/\bmagazaBayiKimlikAnahtari\b/)).toHaveLength(4);  // tanım, bekçi, bayi zinciri bağlamı, ERP `bayiDonus` koşulu
    expect(satirNo(/\bmagazaBayiDonusTabani\b/)).toHaveLength(4);     // tanım, anahtar türetme, bekçi, ERP `bayiDonus`
  });
  it('`env.example` (ASCII): `MAGAZA_PANEL_DONUS` belgeli; izinli köken açıklaması «GET / POST»', () => {
    const ornek = oku(join(SRC_KOK, '..', 'deploy', 'windows', 'env.example'));
    expect(ornek).toMatch(/^MAGAZA_PANEL_DONUS=$/m);
    expect(ornek).toContain('# Magaza uclarina (GET / POST /api/magaza/*) istek atabilecek kokenler, virgulle.');
    expect(ornek).not.toContain('(POST /api/magaza/*)');
    const blok = ornek.slice(ornek.indexOf('# Site paneli ("ERP ile baglan")'), ornek.indexOf('MAGAZA_PANEL_DONUS='));
    for (const beklenen of ['https://www.cetpa.com.tr/panel.html', 'https zorunlu', 'MAGAZA_IZINLI_KOKENLER', 'panel-yapilandirilmamis']) expect(blok, beklenen).toContain(beklenen);
    // 2026-10-21 (H3): müşteri / bayi ekranının dönüş adresi — boş satır, varsayılan bayi.html, 503 kodu.
    expect(ornek).toMatch(/^MAGAZA_BAYI_DONUS=$/m);
    const bayiBlok = ornek.slice(ornek.indexOf('# Musteri / bayi ekrani'), ornek.indexOf('MAGAZA_BAYI_DONUS='));
    for (const beklenen of ['https://www.cetpa.com.tr/bayi.html', 'MAGAZA_PANEL_DONUS ile ayni', 'bayi-yapilandirilmamis']) expect(bayiBlok, beklenen).toContain(beklenen);
    // PowerShell 5.1 + Windows-1252: dosya salt ASCII kalır.
    // eslint-disable-next-line no-control-regex -- ASCII dışı karakter taraması
    expect(ornek.match(/[^\x00-\x7F]/g)).toBeNull();
  });
});

describe('bildirim: kuyruk + işçi', () => {
  it('kuyruk listede; işçi YALNIZ kuyruğu oluşturulabildiyse, meta seçenekleriyle ve `batchSize`sız bağlanır; bayrak en SONDA kalkar', () => {
    // Dilim 2b: revize bildirimi AYRI kuyruktur; ikisi de listede (liste sırası: ilk bildirim, revize).
    expect(kod).toMatch(/const kuyruklar = \[[^\]]*MAGAZA_BILDIRIM_KUYRUGU, MAGAZA_REVIZE_KUYRUGU\] as const;/);
    expect(kod).toMatch(/if \(olusanKuyruklar\.has\(MAGAZA_BILDIRIM_KUYRUGU\)\) \{\s+try \{\s+await boss\.work\(MAGAZA_BILDIRIM_KUYRUGU, MAGAZA_BILDIRIM_ISCI_SECENEKLERI, magazaBildirimIscisi\(magazaBildirimDeps\)\);\s+magazaBildirimKuyruguHazir = true;\s+\} catch/);
    expect(satirNo(/magazaBildirimKuyruguHazir = true/)).toHaveLength(1);
    // K6 (2026-10-09): kaçan bildirimler YALNIZ işçi bağlandıysa, if-bloğundan SONRA, açılışı beklemeden ve fırlatmadan kuyruğa alınır.
    const kacan = tek(/^\s*if \(magazaBildirimKuyruguHazir\) void magazaBildirimKacanlariKuyrukla\(magazaBildirimDeps, \(\) => boss\)\.catch\(\(\) => undefined\);$/);
    expect(kacan).toBeGreaterThan(tek(/magazaBildirimKuyruguHazir = true;/));
    expect(kacan).toBeLessThan(tek(/console\.log\('pg-boss ready/));
    expect(satirNo(/magazaBildirimKacanlariKuyrukla\(/)).toEqual([kacan]);
    // `batchSize` yasağı YALNIZ mağaza işçisinin satırına bakar (gerekçe ona özgü: toplu işte bir yeniden deneme hepsini başarısız
    // sayar). Başka bir işçinin seçeneği ya da ilgisiz bir `batchSize` değişkeni bu çitin konusu değil.
    expect(satirlar[tek(/boss\.work\(MAGAZA_BILDIRIM_KUYRUGU/) - 1].kod).not.toMatch(/batchSize/);
  });
  it('`createQueue` başarısı kuyruk başına izlenir (oluşmayan kuyruk kümeye girmez); «ready» günlüğü İSTENEN listeyi değil OLUŞAN kümeyi yazar', () => {
    expect(kod).toMatch(/try \{ await boss\.createQueue\(q\); olusanKuyruklar\.add\(q\); \}/);
    // «Oluşturulamadı» uyarısı stderr'e, «ready» satırı stdout'a düşer (canlıda AYRI dosyalar: deploy/windows/setup.ps1): yalnız
    // ikincisine bakan, oluşmamış kuyruğu hazır sanmasın.
    const hazir = satirlar[tek(/pg-boss ready/) - 1].kod;
    expect(hazir).toMatch(/\[\.\.\.olusanKuyruklar\]\.join\(/);
    expect(hazir).not.toMatch(/\bkuyruklar\.join\(/);
  });
  it('istek işlevi kuyruğu YALNIZ bayrak kalkmışsa görür; bağımlılıklar modül düzeyinde ve getter', () => {
    tek(/^const magazaBildirimIste = magazaBildirimIsteyici\(\(\) => \(magazaBildirimKuyruguHazir \? boss : null\), magazaBildirimDeps\);$/);
    expect(kod).toMatch(/^const magazaBildirimDeps: MagazaBildirimDeps = \{\s+getPgPool: \(\) => pgPool,\s+broadcastDocChange,\s+appUrl: \(\) => process\.env\.APP_URL,\s+\};/m);
  });
  it('bağımlılıklar `initDocsTable` çağrısından ÖNCE tanımlı (işçi modül yüklenirken kaydedilir)', () => {
    expect(tek(/^const magazaBildirimDeps: MagazaBildirimDeps = \{/)).toBeLessThan(tek(/^async function initDocsTable\(/));
  });
});

describe('revize bildirimi (dilim 2b, § 10.2 (e)): AYRI kuyruk + AYRI işçi + AYRI bayrak', () => {
  it('işçi YALNIZ revize kuyruğu oluşturulabildiyse, ilk kuyrukla AYNI meta seçenekleriyle ve `batchSize`sız bağlanır; bayrak en SONDA kalkar', () => {
    expect(kod).toMatch(/if \(olusanKuyruklar\.has\(MAGAZA_REVIZE_KUYRUGU\)\) \{\s+try \{\s+await boss\.work\(MAGAZA_REVIZE_KUYRUGU, MAGAZA_BILDIRIM_ISCI_SECENEKLERI, magazaRevizeBildirimIscisi\(magazaBildirimDeps\)\);\s+magazaRevizeKuyruguHazir = true;\s+\} catch/);
    expect(satirNo(/magazaRevizeKuyruguHazir = true/)).toHaveLength(1);
    expect(satirlar[tek(/boss\.work\(MAGAZA_REVIZE_KUYRUGU/) - 1].kod).not.toMatch(/batchSize/);
    // İki işçi iki AYRI kuyruğa: revize işçisi ilk kuyruğa, ilk işçi revize kuyruğuna bağlanmaz (çapraz bağlama = yanlış gövdeli posta).
    expect(satirNo(/boss\.work\(MAGAZA_BILDIRIM_KUYRUGU, [^)]*magazaRevizeBildirimIscisi/)).toEqual([]);
    expect(satirNo(/boss\.work\(MAGAZA_REVIZE_KUYRUGU, [^)]*magazaBildirimIscisi\(/)).toEqual([]);
  });
  it('istek işlevi revize kuyruğunu YALNIZ revize bayrağı kalkmışsa görür (ilk kuyruğun bayrağıyla DEĞİL); modül düzeyinde, `initDocsTable`dan ÖNCE', () => {
    const iste = tek(/^const magazaRevizeBildirimIste = magazaRevizeBildirimIsteyici\(\(\) => \(magazaRevizeKuyruguHazir \? boss : null\), magazaBildirimDeps\);$/);
    expect(iste).toBeLessThan(tek(/^async function initDocsTable\(/));
    tek(/^let magazaRevizeKuyruguHazir = false;$/);
    // İki bayrak birbirinin yerine kullanılmaz.
    expect(satirNo(/magazaRevizeBildirimIsteyici\([^)]*magazaBildirimKuyruguHazir/)).toEqual([]);
    expect(satirNo(/magazaBildirimIsteyici\([^)]*magazaRevizeKuyruguHazir/)).toEqual([]);
  });
  it('kaçan revize bildirimleri YALNIZ revize işçisi bağlandıysa, işçi bloğundan SONRA, açılışı beklemeden ve fırlatmadan kuyruğa alınır', () => {
    const kacan = tek(/^\s*if \(magazaRevizeKuyruguHazir\) void magazaRevizeKacanlariKuyrukla\(magazaBildirimDeps, \(\) => boss\)\.catch\(\(\) => undefined\);$/);
    expect(kacan).toBeGreaterThan(tek(/magazaRevizeKuyruguHazir = true;/));
    expect(kacan).toBeLessThan(tek(/console\.log\('pg-boss ready/));
    expect(satirNo(/magazaRevizeKacanlariKuyrukla\(/)).toEqual([kacan]);
  });
  it('«yazıldı ama bağlanmadı»: isteyici ERP rota bağlamına `revizeBildirimiIste` olarak geçer (panel ve dış zincir revize istemez)', () => {
    // İçerik yazımı (`/icerik`) ve `bildirim-gonder?tur=revize` yalnız ERP uçlarındadır; bağlam alanı bağlanmazsa derlenmez
    // (`MagazaErpRouteCtx.revizeBildirimiIste` zorunlu) — burada AYNI tanımlayıcının geçtiği kilitlenir (ilk kuyruğun isteyicisi değil).
    expect(satirNo(/\brevizeBildirimiIste: magazaRevizeBildirimIste\b/)).toHaveLength(1);
    expect(satirNo(/\brevizeBildirimiIste: magazaBildirimIste\b/)).toEqual([]);
  });
});

describe('kiracı ve ortam', () => {
  it('kiracının ortam adı listesi TEK okuyucuda (server.ts ve bekçi aynı işlevi çağırır)', () => {
    tek(/const env = ortamdanKiraci\(\);/);
    expect(satirNo(/process\.env\.(SERVER_TENANT_COMPANY_ID|MIKRO_CRON_COMPANY_ID)/)).toEqual([]);
    expect(oku(join(SRC_KOK, 'server', 'opsWatchdog.ts'))).toMatch(/ortamdanKiraci\(\) === ''/);
  });
  it('açılış uyarıları: SMTP eksikleri bekçiyle aynı okuyucudan (yalnız ad); kiracı kaynağı', () => {
    expect(kod).toMatch(/const smtp = smtpYapilandirmasi\(\);\s+if \(!smtp\.tamam\) missing\.push\(/);
    expect(kod).toMatch(/if \(!ortamdanKiraci\(\)\) missing\.push\(/);
  });
});
