/**
 * DEĞİŞMEZ — çevrim içi mağaza (Shopify) uçlarının server.ts'e BAĞLANTISI (2026-10-02).
 *
 * Davranış testleri saf modüllerde ve rota testinde (kanal/shopifyEsleme, shopifyBaglanti, shopifyWebhook, routes/shopifyRoutes).
 * Bağlantının kendisi server.ts'te — içe aktarılamıyor. Bu dosya bu projenin iki tekrar eden arıza sınıfını çitler:
 *   • "yazıldı ama bağlanmadı" (rota modülü var, çağrılmıyor / kuyruk işçisi eski işleyicide);
 *   • ara katman SIRASI (`app.use` yalnız kendinden sonra kaydedilen rotalara uygulanır — 2026-08-24'te canlıyı kırdı).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SRC_KOK as SRC, kaynakDosyalari, kodSatirlari, gorece } from '../test/kaynakTarama';
import { SERVER_ONLY_COLLECTIONS } from '../lib/collections';
import { BAGLANTI_KOLEKSIYONU } from './kanal/shopifyBaglanti';
import { KIRACI_SORGUSU } from '../lib/tenantBackup';
import { API_SINIRINDAN_MUAF_YOLLAR, apiSinirindanMuaf } from './istemciIp';

const SERVER = join(SRC, '..', 'server.ts');
const satirNo = (desen: RegExp): number[] => kodSatirlari(SERVER).filter(({ kod }) => desen.test(kod.trimEnd())).map(({ n }) => n);
const tek = (desen: RegExp): number => { const n = satirNo(desen); expect(n, String(desen)).toHaveLength(1); return n[0]; };

describe('Shopify uçları server.ts\'e bağlı ve ara katman sırası doğru', () => {
  it('webhook gövde ayrıştırıcısı (5 MB + ham gövde) GENEL ayrıştırıcıdan ÖNCE; rota kaydı ikisinden SONRA', () => {
    const webhookGovde = tek(/^\s*app\.use\('\/api\/shopify\/webhook', express\.json\(\{ limit: '5mb', verify: hamGovdeYakala \}\)\);$/);
    const genelGovde = tek(/^\s*app\.use\(express\.json\(\{ verify: hamGovdeYakala \}\)\);$/);
    const rotaKaydi = tek(/^\s*shopifyRoutes\(app, \{$/);
    expect(webhookGovde).toBeLessThan(genelGovde);
    expect(genelGovde).toBeLessThan(rotaKaydi);
  });
  it('webhook hız sınırı: genel sınırlayıcı bu yolu ATLAR; kendi sınırlayıcısı gövde ayrıştırıcıdan ÖNCE (sıra: sınır → 5 MB ayrıştırıcı → genel ayrıştırıcı)', () => {
    // Genel sınır (300 / 15 dk, IP başına) toplu sipariş işleminde dolar → Shopify 429 alır. İstisna `apiLimiter` TANIMININ içinde olmalı:
    // muaf yollar tek listededir (`istemciIp.API_SINIRINDAN_MUAF_YOLLAR`; yalnız POST) ve webhook yolu o listededir.
    const genelTanim = tek(/^\s*const apiLimiter = rateLimit\(\{$/);
    const istisna = tek(/^\s*skip: apiSinirindanMuaf,$/);
    const sonrakiTanim = tek(/^\s*const authLimiter = rateLimit\(\{$/);
    expect(istisna).toBeGreaterThan(genelTanim);
    expect(istisna).toBeLessThan(sonrakiTanim);
    expect(API_SINIRINDAN_MUAF_YOLLAR).toContain('/api/shopify/webhook');
    expect(apiSinirindanMuaf({ method: 'POST', originalUrl: '/api/shopify/webhook?x=1' })).toBe(true);
    // Kendi sınırı ORTAK webhook sınırlayıcısıdır (Shopify + Stripe): dakikada 1200, anahtar yalnız IP (kimliksiz uç). Ayrı bir
    // Shopify sınırlayıcısı YOKTUR (ikisi birden bağlanırsa her teslim iki kovada sayılır).
    const webhookTanim = tek(/^\s*const webhookLimiter = rateLimit\(\{$/);
    const blok = kodSatirlari(SERVER).filter(({ n }) => n > webhookTanim).map(({ kod }) => kod.trim());
    const kapanis = blok.indexOf('});');
    expect(kapanis).toBeGreaterThan(0);
    const govde = blok.slice(0, kapanis);
    expect(govde).toContain('windowMs: 60 * 1000,');
    expect(govde).toContain('max: 1200,');
    expect(govde).toContain('keyGenerator: yalnizIpAnahtari,');
    expect(kodSatirlari(SERVER).filter(({ kod }) => /shopifyWebhookLimiter/.test(kod)).map(({ n }) => n)).toEqual([]);
    // Sıra: webhook sınırlayıcısı → webhook gövde ayrıştırıcısı → genel ayrıştırıcı → rota (sınırı aşan istek 5 MB'lık gövdeyi okutmaz).
    const webhookSinir = tek(/^\s*app\.use\(\['\/api\/shopify\/webhook', '\/api\/stripe\/webhook'\], webhookLimiter\);$/);
    const webhookGovde = tek(/^\s*app\.use\('\/api\/shopify\/webhook', express\.json\(\{ limit: '5mb', verify: hamGovdeYakala \}\)\);$/);
    const genelGovde = tek(/^\s*app\.use\(express\.json\(\{ verify: hamGovdeYakala \}\)\);$/);
    expect(webhookSinir).toBeLessThan(webhookGovde);
    expect(webhookGovde).toBeLessThan(genelGovde);
    expect(genelGovde).toBeLessThan(tek(/^\s*shopifyRoutes\(app, \{$/));
  });
  it('kuyruk işçisi yeni işleyiciyi çağırır; eski `processShopifyWebhook` hiçbir sunucu dosyasında kalmadı', () => {
    tek(/for \(const job of jobs\) await shopifyIsiIsle\(\{ getAdminDb: adminDbZorunlu, pgServerTimestamp \}, job\.data\);/);
    const kalan: string[] = [];
    for (const yol of [SERVER, ...kaynakDosyalari(join(SRC, 'server'))]) {
      if (/\.test\.ts$/.test(yol)) continue;
      for (const { n, kod } of kodSatirlari(yol)) if (/processShopifyWebhook|SHOPIFY_WEBHOOK_SECRET/.test(kod)) kalan.push(`${gorece(yol)}:${n}`);
    }
    // Ortam sırrı yedeği de kalmadı: sır yalnız kiracının bağlantı kaydından (tek global sır = kiracılar arası arka kapı).
    expect(kalan).toEqual([]);
  });
  it('kimliksiz takip ucu mağaza siparişini göstermez — yanıt gövdesinden ÖNCE reddedilir', () => {
    // 2026-10-19 (şartname «takip kodu + LUCA reddi» TC): uç iki yoldan (takip kodu / eski kimlik) TEK siparişe varır, ret ikisinden
    // sonra ve yanıt kurucusundan (`takipYaniti`) önce — iki yolda da geçerli. Uç gövdesi bu yüzden birkaç satır uzadı.
    const uc = tek(/^\s*app\.get\('\/api\/track\/:orderId', trackLimiter, async/);
    const kapi = tek(/if \(o\.source === MAGAZA_KAYNAGI\) return res\.status\(404\)\.json\(\{ success: false, error: 'Sipariş bulunamadı\.' \}\);/);
    const yanit = tek(/^\s*res\.json\(\{ success: true, order: takipYaniti\(o, eskiYolKimligi\) \}\);$/);
    expect(kapi).toBeGreaterThan(uc);
    expect(kapi).toBeLessThan(yanit);
    expect(kapi - uc).toBeLessThan(20);
  });
  it('LUCA fatura aktarımı KAPALI (2026-10-19, LA): mağaza siparişi dâhil hiçbir sipariş LUCA\'ya gitmez — uç gövdesiz 400', () => {
    // Eskiden yalnız mağaza siparişi reddediliyordu (₺0 birim fiyatlı resmî kayıt); şimdi uç hiçbir siparişi okumaz ve dışarı
    // çıkmaz (davranış: takipKoduVeLuca.zincir.test «LA»).
    const uc = tek(/^\s*app\.post\('\/api\/luca\/sync\/fatura', requireAuth, requireMfaVerified, requireCollectionAccess\('invoices', 'write'\), async/);
    // 2026-10-21: kapanış yanıtı ortak yardımcıda (`lucaYazimiKapali` — fatura ve yevmiye uçları aynı kalıp; takipKoduVeLuca «LY»).
    const kapanis = satirNo(/^\s*lucaYazimiKapali\(res, 'fatura'\);$/).filter(n => n > uc)[0];
    expect(kapanis - uc).toBeLessThan(6);
    expect(satirNo(/fetch\(`\$\{creds\.baseUrl\}\/v1\/faturalar`/)).toEqual([]);
    expect(satirNo(/LUCA'ya fatura olarak aktarılamaz/)).toEqual([]);
    // Tek kaynak: sabit `src/lib/magazaKaynagi`'ndan gelir (eşleyici onu yeniden dışa aktarır) — server.ts kendi dizgisini yazmaz.
    expect(satirNo(/'shopify_webhook'/)).toEqual([]);
  });
  it('elle Shopify senkronunun «belirteç yok» iletisi var olmayan ayar alanına yönlendirmez, ortam değişkeni adını da sızdırmaz', () => {
    const KANAL = join(SRC, 'server', 'routes', 'kanalRoutes.ts');
    // Erişim belirteci alanı Ayarlar'dan kalktı (2026-10-02); belirteç yalnız sunucu ortamından okunur.
    const iletiler = kodSatirlari(KANAL).filter(({ kod }) => /return res\.status\(400\)\.json\(\{ error: 'Shopify /.test(kod));
    expect(iletiler.filter(({ kod }) => kod.includes("'Shopify ürün/sipariş senkronu bu sunucuda yapılandırılmamış (erişim belirteci sunucu ortamında tanımlı değil).'"))).toHaveLength(1);
    expect(iletiler.filter(({ kod }) => /Ayarlar|SHOPIFY_/.test(kod))).toEqual([]);
  });
  it('bağlantı koleksiyonu SUNUCUYA ÖZEL (/api/db ve akış kapalı)', () => {
    expect(SERVER_ONLY_COLLECTIONS).toContain(BAGLANTI_KOLEKSIYONU);
  });
  it('geri yükleme tatbikatı canlı sayımı yedeğin KENDİ sorgusundan türetir (bağlantı kaydı yedeğe girmez → süzgeçsiz sayım hep «EKSIK» derdi)', () => {
    // Bağlantı kaydı `companyId` etiketli ama yedek sorgusu onu dışlar; tatbikat aynı süzgeci kullanmazsa mağaza bağlanınca fark hep ≥ 1.
    expect(KIRACI_SORGUSU).toContain(`'${BAGLANTI_KOLEKSIYONU}'`);
    const TATBIKAT = join(SRC, '..', 'scripts', 'restore-drill.mjs');
    const kod = kodSatirlari(TATBIKAT).map(s => s.kod);
    expect(kod.filter(k => /^import \{ KIRACI_SORGUSU \} from '\.\.\/src\/lib\/tenantBackup\.js';$/.test(k))).toHaveLength(1);
    expect(kod.filter(k => k.includes('`SELECT count(*)::int AS n FROM (${KIRACI_SORGUSU}) AS yedege_giren`, [companyId]);'))).toHaveLength(1);
    // Süzgeçsiz canlı sayım kalmadı: `docs` üstünde companyId ile sayan başka sorgu yok.
    expect(kod.filter(k => /count\(\*\).*FROM docs/.test(k))).toEqual([]);
    // Alt sorgu olarak sarılabilir: tek ifade, tek parametre, noktalı virgül yok.
    expect(KIRACI_SORGUSU).not.toMatch(/;|\$2/);
  });
});

describe('ortam şablonları — artık okunmayan SHOPIFY_WEBHOOK_SECRET anahtarı hiçbir şablonda DEĞER satırı olarak kalmadı (yarım düzeltme çiti)', () => {
  it('.env.example, .env.production.example, deploy/windows/env.example', () => {
    const kok = join(SRC, '..');
    for (const ad of ['.env.example', '.env.production.example', join('deploy', 'windows', 'env.example')]) {
      const satirlar = readFileSync(join(kok, ad), 'utf8').split('\n');
      const kalan = satirlar.flatMap((l, i) => (/^\s*SHOPIFY_WEBHOOK_SECRET\s*=/.test(l) ? [`${ad}:${i + 1}`] : []));
      expect(kalan, ad).toEqual([]);
    }
  });
});
