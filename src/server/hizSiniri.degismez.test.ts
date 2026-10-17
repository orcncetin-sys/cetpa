/**
 * hizSiniri.degismez.test.ts — server.ts hız sınırı BAĞLAMASININ çiti (2026-10-08).
 *
 * Davranış `hizSiniri.uctanUca.test.ts`'te gerçek express ile sınanır; ama o test server.ts'in KENDİSİNİ koşturamaz (giriş
 * dosyası, yan etkili). Bu çit aradaki boşluğu kapatır: server.ts o yardımcıları, o sırada ve doğru sınırlayıcıda kullanıyor mu.
 * Kırılırsa önce NEDEN kırıldığını oku — çoğu satır canlıda ölçülmüş bir arızanın tekrarını önler (bkz. istemciIp.ts başlığı).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { kaynakDosyalari, kodSatirlari, oku, SRC_KOK, suclular } from '../test/kaynakTarama';
import { API_SINIRINDAN_MUAF_YOLLAR } from './istemciIp';

const SERVER = join(SRC_KOK, '..', 'server.ts');
const satirlar = kodSatirlari(SERVER);
const kod = satirlar.map(s => s.kod).join('\n');
const satirNo = (desen: RegExp): number[] => satirlar.filter(s => desen.test(s.kod)).map(s => s.n);
const tek = (desen: RegExp): number => { const n = satirNo(desen); expect(n, String(desen)).toHaveLength(1); return n[0]; };

/** Her `rateLimit({ … })` çağrısının gövdesi, hangi ada atandığıyla (atanmıyorsa bağlandığı yerle). */
function sinirlayicilar(): Array<{ ad: string; govde: string }> {
  const out: Array<{ ad: string; govde: string }> = [];
  const desen = /(?:const (\w+) = (?:istekBasinaBirKez\()?|(\w+): |app\.use\('(\/api)', )rateLimit\(\{([\s\S]*?)\n\s*\}\)/g;
  for (const m of kod.matchAll(desen)) out.push({ ad: m[1] ?? m[2] ?? `app.use(${m[3]})`, govde: m[4] });
  return out;
}

describe('her sınırlayıcı anahtar üreticisini AÇIKÇA seçer — doğru olanı', () => {
  // Kullanıcı anahtarı kimliksiz yüzeyi koruyan sınırlayıcıda her yeni hesaba taze kova verirdi (hesap açmak serbest);
  // yalnız-IP anahtarı personel trafiğinde aynı ofisi tek kovaya sokardı. Tablo bilinçlidir.
  const BEKLENEN: Record<string, 'userOrIpKey' | 'yalnizIpAnahtari'> = {
    'app.use(/api)': 'yalnizIpAnahtari',        // sel koruması
    dbLimiter: 'userOrIpKey',
    publicWriteLimiter: 'yalnizIpAnahtari',
    apiLimiter: 'userOrIpKey',
    authLimiter: 'yalnizIpAnahtari',
    paymentLimiter: 'yalnizIpAnahtari',       // rol kapısız uç + serbest hesap: kullanıcı anahtarı her hesaba taze kova verirdi
    mikroLimiter: 'userOrIpKey',
    trackLimiter: 'yalnizIpAnahtari',
    webhookLimiter: 'yalnizIpAnahtari',
    hitLimiter: 'yalnizIpAnahtari',
    magazaTalepLimiter: 'yalnizIpAnahtari',   // kimliksiz mağaza uçları (www.cetpa.com.tr): sipariş talebi
    magazaDurumLimiter: 'yalnizIpAnahtari',   //   … ve durum sorgusu; AYRI kova
    // Mağaza dilim 2a (2026-10-10): site paneli belirteci `mp1-…` Firebase kimliği DEĞİLDİR — panel kovaları yalnız IP;
    // «ERP ile bağlan» yetki kodu ucu ERP kökenindedir ve kimliklidir — kullanıcı anahtarı (aynı ofis tek kovaya girmesin).
    magazaPanelOturumLimiter: 'yalnizIpAnahtari',
    magazaPanelLimiter: 'yalnizIpAnahtari',
    magazaYetkiKoduLimiter: 'userOrIpKey',
    // Mağaza dilim 2b (2026-10-10): ERP kökenindeki elle talep / içerik / silme uçları kimliklidir — kullanıcı anahtarı
    // (bu uçlar e-posta bildirimi üretir; aynı ofis tek kovaya girmesin, tek kullanıcı da kutuyu dolduramasın).
    magazaIcerikLimiter: 'userOrIpKey',
    // «Yeni sürüm var» denetimi (2026-10-17): kimliksiz uç, istemci çerezsiz sorar — yalnız IP (bir ofisin sekmeleri tek kova).
    surumLimiter: 'yalnizIpAnahtari',
  };
  it('server.ts\'teki rateLimit çağrıları tabloyla BİREBİR (yeni sınırlayıcı eklenince bu tablo bilinçli güncellenir)', () => {
    const olculen = Object.fromEntries(sinirlayicilar().map(s => [s.ad, s.govde.match(/keyGenerator: (\w+)/)?.[1] ?? '(YOK — varsayılan üretici)']));
    expect(olculen).toEqual(BEKLENEN);
    expect((kod.match(/rateLimit\(\{/g) ?? []).length).toBe(Object.keys(BEKLENEN).length);
  });
  it('tarayıcının GÖREMEDİĞİ sınırlayıcı yok: ham metindeki `rateLimit({` sayısı çitin gördüğüyle aynı', () => {
    // Yorum süzgeci eskiden dize içindeki `/*`'ı (ör. CSP'deki 'https://*.googleapis.com') blok yorum açılışı sayıp ilk `*/`'a
    // kadar satırları boşaltıyordu; süzgeç 2026-10-08'de düzeltildi (o gün kör bölge 15 satırdı). Bu sayım süzgeçten bağımsız
    // ikinci ölçüdür: süzgeç bir gün yine kör kalırsa o bölgeye yazılan sınırlayıcı tabloya girmeden geçemesin.
    expect((oku(SERVER).match(/rateLimit\(\{/g) ?? []).length).toBe(Object.keys(BEKLENEN).length);
  });
  it('rota modüllerinde sınırlayıcı KURULMAZ (hepsi server.ts\'te, bu çitin gördüğü yerde)', () => {
    const baska = suclular(kaynakDosyalari(join(SRC_KOK, 'server')), /\brateLimit\s*\(/);
    expect(baska).toEqual([]);
  });
  it('ham `req.ip` hiçbir anahtar üreticide okunmaz; kitaplığın `ipKeyGenerator`\'ı doğrudan çağrılmaz (IPv4:kapı dizgesini aynen döndürür)', () => {
    expect(satirNo(/ipKeyGenerator\(/)).toEqual([]);
    expect(satirNo(/keyGenerator:.*\.ip\b/)).toEqual([]);
  });
  it('iki üretici yardımcıya bağlı; kimlik doğrulayıcıları enjekte', () => {
    tek(/const userOrIpKey = \(istek: Request\): Promise<string> => kullaniciSinirAnahtari\(istek, sinirBagimliliklari\);/);
    tek(/const yalnizIpAnahtari = \(istek: Request\): string => ipSinirAnahtari\(istek\);/);
    tek(/belirtecDogrula: \(belirtec\) => getAuth\(\)\.verifyIdToken\(belirtec\)\.then\(d => d\.uid\),/);
    tek(/cerezdenUid: \(cerezBasligi\) => verifySessionTokenUid\(parseCookie\(cerezBasligi, SESSION_COOKIE\)\),/);
  });
});

describe('sıra: vekil güveni → IP düzeltme → sel koruması → ilk /api rotası … genel sınırlayıcı', () => {
  it('`req.ip` HER şeyden önce düzeltilir; sel koruması bütün /api rotalarından önce bağlanır', () => {
    const guven = tek(/app\.set\('trust proxy', 1\);/);
    const duzeltme = tek(/const temiz = temizIstemciIp\(req\.ip\);/);
    const sel = tek(/app\.use\('\/api', rateLimit\(\{/);
    const ilkRota = Math.min(...satirNo(/app\.(get|post|put|patch|delete)\(\s*['"`]\/api\//));
    const genel = tek(/app\.use\('\/api', apiLimiter\);/);
    expect(guven).toBeLessThan(duzeltme);
    expect(duzeltme).toBeLessThan(sel);
    expect(sel).toBeLessThan(ilkRota);
    expect(sel).toBeLessThan(genel);
    // Düzeltme koşulsuz bir `app.use` içinde (yol / koşul süzgeci yok).
    expect(kod).toMatch(/app\.use\(\(req, _res, next\) => \{\n\s+const temiz = temizIstemciIp\(req\.ip\);\n\s+if \(temiz !== null && temiz !== req\.ip\) Object\.defineProperty\(req, 'ip', \{ value: temiz, configurable: true, enumerable: true \}\);\n\s+next\(\);\n\s+\}\);/);
  });
  it('muaf yolların KENDİ sınırlayıcısı genel sınırlayıcıdan önce bağlı; genel sınırlayıcı muafiyeti yardımcıdan alır', () => {
    const genel = tek(/app\.use\('\/api', apiLimiter\);/);
    expect(tek(/app\.use\(\['\/api\/shopify\/webhook', '\/api\/stripe\/webhook'\], webhookLimiter\);/)).toBeLessThan(genel);
    const api = sinirlayicilar().find(s => s.ad === 'apiLimiter');
    expect(api?.govde).toMatch(/skip: apiSinirindanMuaf,/);
    // Muaf listesindeki HER yolun bir sınırlayıcısı var (muafiyet sınırsızlık olmasın).
    expect([...API_SINIRINDAN_MUAF_YOLLAR].sort()).toEqual(['/api/hit', '/api/shopify/webhook', '/api/stripe/webhook']);
    const trafik = kodSatirlari(join(SRC_KOK, 'server', 'routes', 'trafikRoutes.ts')).map(s => s.kod).join('\n');
    expect(trafik).toMatch(/app\.post\('\/api\/hit', C\.hitLimiter as never,/);
  });
});

describe('tavanlar ve tek sayım', () => {
  const govde = (ad: string) => sinirlayicilar().find(s => s.ad === ad)?.govde ?? '';
  it('kimlikli / kimliksiz iki tavan yalnız kullanıcı anahtarlı genel ve Mikro sınırlayıcısında; değerler', () => {
    expect(govde('apiLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: kimligeGoreTavan\(sinirBagimliliklari, 300, 600\),/);
    expect(govde('mikroLimiter')).toMatch(/windowMs: 5 \* 60 \* 1000,\s+max: kimligeGoreTavan\(sinirBagimliliklari, 30, 60\),/);
    expect((kod.match(/kimligeGoreTavan\(/g) ?? []).length).toBe(2);
  });
  it('kimliksiz yüzeyin tavanları (IP başına) yerinde', () => {
    expect(govde('publicWriteLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,[^\n]*\n\s+max: 10,/);
    expect(govde('trackLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 40,/);
    expect(govde('authLimiter')).toMatch(/windowMs: 15 \* 60 \* 1000,\s+max: 20,/);
    expect(govde('webhookLimiter')).toMatch(/windowMs: 60 \* 1000,\s+max: 1200,/);
    expect(govde('hitLimiter')).toMatch(/windowMs: 60 \* 1000, max: 120,/);
    expect(govde('surumLimiter')).toMatch(/windowMs: 60 \* 1000,\s+max: 120,/);
    expect(govde('app.use(/api)')).toMatch(/windowMs: 60 \* 1000,\s+max: 6000,/);
  });
  it('Mikro sınırlayıcısı istek başına BİR KEZ sayar', () => {
    tek(/const mikroLimiter = istekBasinaBirKez\(rateLimit\(\{/);
  });
});

describe('bağlama YERİ ve `skip`', () => {
  // 2026-10-08 incelemesi: dört mutant (Mikro öneki rota kaydının arkasına, sel korumasına / webhook sınırlayıcısına `skip`,
  // takip zincirinden sınırlayıcının silinmesi) önceki çitten sessizce geçiyordu.
  it('`skip` ailesi (skip, skipFailedRequests, skipSuccessfulRequests) yalnız genel sınırlayıcıda — başkasına eklenen muafiyet o tavanı kapatır', () => {
    expect(sinirlayicilar().filter(s => /\bskip\w*\s*[:,(]/.test(s.govde)).map(s => s.ad)).toEqual(['apiLimiter']);
    // Olumsuz iddia BÜTÜN yorumsuz metinde de sayılır: `sinirlayicilar()` gövdeyi ilk iç içe `})`'de keser, tırnaklı / hesaplanmış
    // anahtar da yukarıdaki desenden kaçar. İleride sınırlayıcıyla ilgisiz bir `skip` yazılırsa gürültüyle kırılır — sessiz geçişten iyidir.
    expect(satirNo(/skip/i)).toEqual([tek(/^\s*skip: apiSinirindanMuaf,$/)]);
  });
  it('Mikro önek bağlaması `mikroRoutes(app, {` çağrısından ÖNCE (2026-08-24 arızasının sırası) ve önek listesinin TAMAMI sabit', () => {
    const onekler = kod.match(/app\.use\(\[([^\]]*)\], mikroLimiter\);/)?.[1].match(/'[^']+'/g)?.map(s => s.slice(1, -1));
    expect(onekler).toEqual(['/api/mikro/import', '/api/mikro/stok', '/api/mikro/cari', '/api/mikro/fatura', '/api/mikro/irsaliye',
      '/api/mikro/siparis', '/api/mikro/yevmiye', '/api/mikro/tahsilat', '/api/mikro/pull', '/api/mikro/cari-hareket', '/api/mikro/evrak']);
    expect(tek(/\], mikroLimiter\);/)).toBeLessThan(tek(/^\s*mikroRoutes\(app, \{/));
  });
  it('ödeme oturumu ucu KENDİ sınırlayıcısıyla, kimlik kapısından ÖNCE bağlı (silinirse uç yalnız kullanıcı anahtarlı genel kovada kalır)', () => {
    const odeme = kodSatirlari(join(SRC_KOK, 'server', 'routes', 'paymentRoutes.ts'));
    expect(odeme.filter(s => /app\.post\('\/api\/stripe\/create-checkout', C\.paymentLimiter, C\.requireAuth, /.test(s.kod))).toHaveLength(1);
    expect(kod).toMatch(/paymentRoutes\(app, \{[^}]*\bpaymentLimiter,/);                      // rota modülüne giden, server.ts'teki sınırlayıcının kendisi
  });
  it('sipariş takibi kendi sınırlayıcısıyla bağlı', () => {
    tek(/app\.get\('\/api\/track\/:orderId', trackLimiter, /);
  });
  it('sürüm ucu KENDİ sınırlayıcısıyla, genel sınırlayıcıdan ÖNCE bağlı (arkasına kayarsa sekmeler genel kimliksiz kovayı doldurur)', () => {
    const baglama = tek(/surumRoutes\(app, \{ surumLimiter, surumDosyasi: /);
    expect(baglama).toBeGreaterThan(tek(/const surumLimiter = rateLimit\(\{/));
    expect(baglama).toBeLessThan(tek(/app\.use\('\/api', apiLimiter\);/));
    const modul = kodSatirlari(join(SRC_KOK, 'server', 'routes', 'surumRoutes.ts'));
    expect(modul.filter(s => /app\.get\(SURUM_UCU, C\.surumLimiter, /.test(s.kod))).toHaveLength(1);
  });
  it('akış rotası işaretini KENDİ zincirinde, sınırlayıcıdan ÖNCE koyar (çerez / `?token=` yalnız işaretli istekte kimliktir)', () => {
    tek(/app\.get\('\/api\/db\/stream', akisIstegiIsaretle, dbLimiter, /);
    expect(satirNo(/akisIstegiIsaretle/).length).toBe(2);                                      // içe aktarma + akış rotası; başka rotaya konmaz
  });
  it('akış işleyicisi `?token=` belirtecini sınırlayıcıyla AYNI işlevden okur (ayrışırlarsa 401 alan istek belirteç sahibinin kovasında sayılır)', () => {
    tek(/getAuth\(\)\.verifyIdToken\(akisSorguBelirteci\(req\.query\)\)/);
    expect(satirNo(/req\.query\.token/)).toEqual([]);
  });
});

describe('işaret ŞARTININ öbür yarısı ve genel sınırlayıcının yeri', () => {
  // Kimlik istek başına BİR kez çözülür (istemciIp.kimlikOnbellegi). Akış rotasından ÖNCE kullanıcı anahtarlı bir sınırlayıcı
  // çalışırsa kimlik işaretsiz çözülür (çerez / `?token=` kimlik sayılmaz), `null` önbelleğe girer, rotadaki işaret geç kalır.
  it('akış rotası genel sınırlayıcıdan ÖNCE; ondan önce önekle bağlanan TEK sınırlayıcı sel koruması (yalnız IP)', () => {
    const akis = tek(/app\.get\('\/api\/db\/stream', akisIstegiIsaretle, dbLimiter, /);
    expect(akis).toBeLessThan(tek(/app\.use\('\/api', apiLimiter\);/));
    // Birleştirilmiş kod üzerinde ÇOK SATIRLI desen: `app.use(\n  '/api/db',\n  dbLimiter)` yazımı satır deseninden kaçardı.
    const onceKod = satirlar.filter(s => s.n < akis).map(s => s.kod).join('\n');
    const onceBaglanan = [...onceKod.matchAll(/app\.(?:use|all)\([^;]*?(?:Limiter\b|rateLimit\()/g)].map(m => m[0]);
    expect(onceBaglanan).toEqual(["app.use('/api', rateLimit("]);
  });
  it('genel sınırlayıcı Mikro rotalarından ÖNCE bağlanır (arkasına kayarsa aradaki rotalar genel tavansız kalır)', () => {
    expect(tek(/app\.use\('\/api', apiLimiter\);/)).toBeLessThan(tek(/^\s*mikroRoutes\(app, \{/));
  });
  it('server.ts doğrulama süre sınırını EZMEZ (varsayılan 1 sn canlıdaki tek yol — istemciIp.test.ts)', () => {
    expect(satirNo(/zamanAsimiMs/)).toEqual([]);
  });
  it('bozuk çerez değeri kimlik YOK sayılır — iki yol da (akış işleyicisi çerezi try dışında okur; fırlasaydı uçtan 500 çıkardı)', () => {
    tek(/if \(k === name\) \{ try \{ return decodeURIComponent\(v\.join\('='\)\); \} catch \{ return null; \} \}/);   // bozuk yüzde kaçışı
    tek(/if \(a\.length !== b\.length \|\| !timingSafeEqual\(a, b\)\) return null;/);                                   // ASCII dışı imza: bayt uzunluğu
    expect(satirNo(/timingSafeEqual\(Buffer\.from\(/)).toEqual([]);                                                    // karakter uzunluğuyla korunan çağrı yok
  });
  it('akış işleyicisi Authorization başlığını OKUMAZ; kimliği çerez → `?token=` sırasıyla okur (sınırlayıcı da öyle)', () => {
    const bas = satirlar.findIndex(s => /app\.get\('\/api\/db\/stream', akisIstegiIsaretle, dbLimiter, /.test(s.kod));
    const govde = satirlar.slice(bas, bas + 12).map(s => s.kod).join('\n');
    expect(govde).not.toMatch(/authorization|yetkiBelirteci\(/i);                              // `req.get('Authorization')` yazımı da
    expect(govde).toMatch(/let streamUid = verifySessionTokenUid\(parseCookie\(req\.headers\.cookie, SESSION_COOKIE\)\);\s+if \(!streamUid\) \{\s+try \{ const d = await getAuth\(\)\.verifyIdToken\(akisSorguBelirteci\(req\.query\)\); streamUid = d\.uid; \}/);
  });
});

describe('kimlik kapısı ile sınırlayıcı AYNI belirteç ayıklamasını kullanır', () => {
  it('requireAuth belirteci `yetkiBelirteci` ile okur (ayrışırlarsa kimlikli kullanıcı IP kovasını da kullanır)', () => {
    tek(/const token = yetkiBelirteci\(req\.headers\.authorization\);/);
    expect(satirNo(/authorization\?\.replace\(/)).toEqual([]);
  });
});
