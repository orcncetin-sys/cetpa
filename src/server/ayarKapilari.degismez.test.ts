/**
 * DEĞİŞMEZ — `settings` sır sızıntısı düzeltmesinin kapıları yerinde (2026-10-02).
 *
 * Davranış testleri saf modüllerde (lib/sirMaske, lib/tenantErisim, lib/guvenliTaban, sirTani). Kapıların ÇAĞRILDIĞI yer ise
 * server.ts `startServer` kapanışı — içe aktarılamıyor, rota düzeyinde sınanamıyor. Bu dosya o bağlantıları çitler:
 * kapı yazılıp bağlanmazsa (bu projenin tekrar eden arıza sınıfı) ya da yeni bir kimliksiz durum ucu eklenirse kırılır.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { SRC_KOK as SRC, kaynakDosyalari, kodSatirlari, gorece } from '../test/kaynakTarama';

const SERVER = join(SRC, '..', 'server.ts');
const sunucuDosyalari = () => [SERVER, ...kaynakDosyalari(join(SRC, 'server'))].filter(y => !/\.test\.ts$|testDuzenegi/.test(y));
// `trimEnd`: yorum ayıklayıcı satır sonu yorumunu keser ama öncesindeki boşluğu bırakır — `$` çapalı çit, satıra yorum eklendi
// diye (davranış değişmeden) kırılmasın.
const say = (yol: string, desen: RegExp) => kodSatirlari(yol).filter(({ kod }) => desen.test(kod.trimEnd())).length;
const satirNo = (yol: string, desen: RegExp): number[] => kodSatirlari(yol).filter(({ kod }) => desen.test(kod.trimEnd())).map(({ n }) => n);

describe('entegrasyon durum uçları kimlik ister', () => {
  it("her `app.get('/api/…/status'` satırında requireAuth + ROL kapısı var (tek istisna: kullanıcının kendi MFA durumu)", () => {
    const YALNIZ_KIMLIK = /'\/api\/mfa\/status'/;   // her rol kendi MFA durumunu okur
    const suclu: string[] = [];
    let uc = 0;
    for (const yol of sunucuDosyalari()) {
      for (const { n, kod } of kodSatirlari(yol)) {
        if (!/app\.get\('\/api\/[a-z0-9-]+\/status'/.test(kod)) continue;
        uc++;
        if (!/requireAuth/.test(kod)) suclu.push(`${gorece(yol)}:${n} (kimlik kapısı yok)`);
        // Yalnız requireAuth = B2B / Dealer (dış rol) de saklı kimlik bilgisiyle dış çağrı tetikler.
        // Araya başka ara katman (MFA) girebilir; rol kapısı Staff / Admin / SuperAdmin'den biri olmalı.
        else if (!YALNIZ_KIMLIK.test(kod) && !/requireAuth,.*\b(C\.)?require(Staff|Admin|SuperAdmin)\b/.test(kod)) suclu.push(`${gorece(yol)}:${n} (rol kapısı yok)`);
      }
    }
    expect(suclu).toEqual([]);
    expect(uc).toBe(14);   // kâhin: tarayıcı uçları gerçekten görüyor (yeni durum ucu eklenince bu sayı bilinçli güncellenir)
  });
  it('/api/mikro/token yalnız yönetici; token ön izlemesi dönmez', () => {
    const satir = kodSatirlari(SERVER).filter(({ kod }) => /app\.post\('\/api\/mikro\/token'/.test(kod));
    expect(satir).toHaveLength(1);
    expect(satir[0].kod).toMatch(/requireAuth, requireMfaVerified, requireAdmin/);
    expect(say(SERVER, /tokenPreview/)).toBe(0);
  });
});

describe('/api/db settings kapıları server.ts\'e bağlı', () => {
  it('atomik artırma ve koşullu yazma settings\'te kapalı (iki uç)', () => {
    expect(say(SERVER, /if \(ayarAtomikYasak\(coll, res\)\) return;/)).toBe(2);
  });
  it('PUT ve PATCH: maske geri yüklenir, bağlantı adresi kapısından geçer, yanıt maskelenir', () => {
    // TAM SATIR: kapının çağrıldığını değil, SONUCUNUN kullanıldığını çitler (`if (…) return;` düşerse ya da birleştirme ham
    // gövdeyle yapılırsa sayım çağrı sayısına bakarken yeşil kalırdı — inceleme 2026-10-02).
    expect(say(SERVER, /^\s*incoming = maskeyiGeriYukle\(coll, ham, before\);$/)).toBe(1);
    expect(say(SERVER, /^\s*const patch = maskeyiGeriYukle\(coll, resolveSentinels\(req\.body \?\? \{\}\) as Record<string, unknown>, before\);$/)).toBe(1);
    expect(say(SERVER, /^\s*if \(await ayarYazimiEngeli\(req, res, coll, (incoming|patch), before\)\) return;$/)).toBe(2);
    expect(say(SERVER, /^\s*data = req\.query\.merge === '1' \? mergeDocData\(before, incoming\) : incoming;$/)).toBe(1);
    expect(say(SERVER, /^\s*let data = mergeDocData\(before, patch\);$/)).toBe(1);
    expect(say(SERVER, /maskeyiGeriYukle\(coll,/)).toBe(2);
    // Yazma yanıtı birleştirilmiş dokümanı döndürür — maskesiz `res.json({ id, data })` Manager'a sırrı verirdi.
    // Kalan TEK maskesiz yanıt atomik artırma ucunda; orası settings'e kapalı (yukarıdaki test).
    expect(say(SERVER, /res\.json\(\{ id, data \}\)/)).toBe(1);
    expect(say(SERVER, /res\.json\(\{ id, data: await redactSettings\(req, coll, data\) \}\)/)).toBe(3);
  });
  it('liste ucu ve akış init\'i ayarları kimlikten süzer (ayarSatirlari)', () => {
    expect(say(SERVER, /ayarSatirlari\(/)).toBe(2);
  });
  it('akış olayı: kimlikten süzme, düz kimliğe çevirme, eski global kopyanın gölgelenmesi', () => {
    expect(say(SERVER, /\(sahip !== null && sahip !== streamCid\)\) return;/)).toBe(1);
    expect(say(SERVER, /if \(sahip !== null && ev\.id\) ev = \{ \.\.\.ev, id: ayarAnahtari\(ev\.id\) \};/)).toBe(1);
    expect(say(SERVER, /else if \(!ev\.cid && ev\.id && PER_COMPANY_SETTINGS\.has\(ev\.id\)\) \{/)).toBe(1);
    expect(say(SERVER, /if \(!rows\.length\) yayinla\(olay\);/)).toBe(1);
  });
  it('akış: rol / kiracı değişince kapanır; önbellek akıştan bağımsız düşer; init penceresi yeniden okunur', () => {
    expect(say(SERVER, /roleCache\.delete\(streamUid\); companyIdCache\.delete\(streamUid\); kapat\(\); return;/)).toBe(1);
    // Önbellek düşürme SÜREÇ düzeyinde (girintisiz, modül kapsamı): akış dinleyicisinin içine taşınırsa açık akışı olmayan
    // kullanıcının önbelleği düşmez.
    const surec = satirNo(SERVER, /^dbEvents\.on\('change', \(ev: \{ coll\?: string; id\?: string \}\) => \{$/);
    expect(surec).toHaveLength(1);
    expect(satirNo(SERVER, /^  if \(ev\.coll === 'users' && ev\.id\) \{ roleCache\.delete\(ev\.id\); companyIdCache\.delete\(ev\.id\); \}$/)).toEqual([surec[0] + 1]);
    // SIRA: yeniden okuma, akış dinleyicisi BAĞLANDIKTAN SONRA — öncesine taşınırsa init penceresi yeniden açılır.
    const baglandi = satirNo(SERVER, /^\s*dbEvents\.on\('change', onChange\);$/);
    const yenidenOkuma = satirNo(SERVER, /^\s*const \[guncelRol, guncelCid\] = await Promise\.all\(\[getUserRole\(streamUid\), getUserCompanyId\(streamUid\)\]\);$/);
    expect(baglandi).toHaveLength(1);
    expect(yenidenOkuma).toHaveLength(1);
    expect(yenidenOkuma[0]).toBeGreaterThan(baglandi[0]);
    expect(satirNo(SERVER, /^\s*if \(guncelRol !== streamRole \|\| guncelCid !== streamCid\) kapat\(\);$/)).toEqual([yenidenOkuma[0] + 1]);
  });
  it('denetim kaydı alan farkı maskeden geçer', () => {
    expect(say(SERVER, /farkDegeriMaskele\(/)).toBeGreaterThanOrEqual(1);
  });
});

describe('ayardan okunan taban adres doğrulanır', () => {
  it('SSRF kapısından geçen HER çağrı yönlendirmeyi izlemez (doğrulanan adres ile isteğin gittiği adres ayrışmasın)', () => {
    // server.ts: SAP /Login + giden webhook + webhook test ucu = 3. Kapıdan geçen yeni bir `fetch` eklenirse buraya da eklenir.
    expect(say(SERVER, /redirect: 'manual'/)).toBe(3);
    expect(say(SERVER, /const r = await fetch\(url, \{ method: 'POST', headers, body: bodyStr, redirect: 'manual' \}\);/)).toBe(1);
    expect(say(join(SRC, 'server', 'routes', 'erpRoutes.ts'), /redirect: 'manual',/)).toBe(1);
    expect(say(SERVER, /^const isSafePublicUrl = genelAdresMi;$/)).toBe(1);
  });
  it('webhook test ucu rol kapılı; SAP oturumu adres + kimlik özetine bağlı', () => {
    expect(say(SERVER, /app\.post\('\/api\/webhooks\/test', requireAuth, requireMfaVerified, requireCollectionAccess\('webhookConfigs', 'write'\),/)).toBe(1);
    expect(say(SERVER, /if \(SAP_SESSION\.sessionId && SAP_SESSION\.anahtar === anahtar && SAP_SESSION\.lastUsed/)).toBe(1);
    expect(say(SERVER, /^\s*SAP_SESSION\.anahtar\s+= anahtar;$/)).toBe(1);
  });
  it('Luca + iyzico izin listesinden, SAP https/genel adres kapısından geçer; çıplak `d.baseUrl ||` kalmadı', () => {
    expect(say(SERVER, /baseUrl: izinliTaban\(d\.baseUrl, (LUCA|IYZICO)_TABAN\)/)).toBe(2);
    expect(say(SERVER, /serviceLayerUrl: genelHttpsTaban\(/)).toBe(1);
    expect(say(SERVER, /\bd\.(baseUrl|sapServiceLayerUrl|serviceLayerUrl)\s*\|\|\s*['"`]/)).toBe(0);
  });
});
