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
  it('zincire giden bağlam: genel sınırlayıcının KENDİSİ, iki AYRI mağaza sınırlayıcısı, ham havuz, kiracı çözümleyici, yayın, bildirim', () => {
    expect(kod).toMatch(/magazaZinciri\(\{\s*apiLimiter, talepSinirlayici: magazaTalepLimiter, durumSinirlayici: magazaDurumLimiter,\s*getPgPool: \(\) => pgPool, serverTenantId, broadcastDocChange, bildirimIste: magazaBildirimIste,\s*\}\)\);/);
  });
  it('mağaza genel sınırlayıcıdan MUAF değil (KOD taranır, yorumdaki anma sayılmaz); rota modülü bekçiyle AYNI yoldan içe aktarılır (sayaçlar tek modül örneğinde)', () => {
    // `istemciIp.ts` yolların muafiyet durumunu yorumda tek tek anlatır; oraya mağaza için bir cümle eklemek çiti kırmamalı.
    expect(kodSatirlari(join(SRC_KOK, 'server', 'istemciIp.ts')).map(s => s.kod).join('\n')).not.toMatch(/\/api\/magaza/);
    tek(/from "\.\/src\/server\/routes\/magazaRoutes\.js";/);
    expect(oku(join(SRC_KOK, 'server', 'opsWatchdog.ts'))).toMatch(/from '\.\/routes\/magazaRoutes\.js';/);
  });
});

describe('sınırlayıcılar: sel koruması (iş sınırı DEĞİL), ayrı kovalar, sabit 429', () => {
  const govde = (ad: string): string => kod.match(new RegExp(`const ${ad} = rateLimit\\(\\{([\\s\\S]*?)\\n\\s*\\}\\)`))?.[1] ?? '';
  it('talep 30 / 15 dk, durum 60 / 15 dk; ikisi de yalnız IP ve 429\'u `magaza429` yazar; `skip` / `message` yok', () => {
    expect(govde('magazaTalepLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 30,/);
    expect(govde('magazaDurumLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 60,/);
    for (const ad of ['magazaTalepLimiter', 'magazaDurumLimiter']) {
      expect(govde(ad), ad).toMatch(/keyGenerator: yalnizIpAnahtari,\s+handler: magaza429,/);
      expect(govde(ad), ad).not.toMatch(/skip|message/);
    }
  });
  it('her sınırlayıcı YALNIZ zincire verilir (başka yere bağlanırsa istek iki kez sayılır)', () => {
    expect(satirNo(/magazaTalepLimiter/)).toHaveLength(2);   // tanım + zincir bağlamı
    expect(satirNo(/magazaDurumLimiter/)).toHaveLength(2);
  });
});

describe('bildirim: kuyruk + işçi', () => {
  it('kuyruk listede; işçi YALNIZ kuyruğu oluşturulabildiyse, meta seçenekleriyle ve `batchSize`sız bağlanır; bayrak en SONDA kalkar', () => {
    expect(kod).toMatch(/const kuyruklar = \[[^\]]*MAGAZA_BILDIRIM_KUYRUGU\] as const;/);
    expect(kod).toMatch(/if \(olusanKuyruklar\.has\(MAGAZA_BILDIRIM_KUYRUGU\)\) \{\s+try \{\s+await boss\.work\(MAGAZA_BILDIRIM_KUYRUGU, MAGAZA_BILDIRIM_ISCI_SECENEKLERI, magazaBildirimIscisi\(magazaBildirimDeps\)\);\s+magazaBildirimKuyruguHazir = true;\s+\} catch/);
    expect(satirNo(/magazaBildirimKuyruguHazir = true/)).toHaveLength(1);
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
