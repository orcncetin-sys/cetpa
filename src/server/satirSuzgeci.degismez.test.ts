/**
 * DEĞİŞMEZ — dış rol SATIR SÜZGECİ server.ts'e bağlı ve `orders`'a ulaşan uçlar kapılı (2026-10-02).
 *
 * Kural ve davranış testleri saf modülde (lib/tenantErisim + test). Bağlantının kendisi server.ts kapanışında — içe
 * aktarılamıyor. Bu dosya şunları çitler:
 *   • süzgecin ÜÇ yolda da bağlı olması (REST kimliği, akış init'i, akış olayı) — yalnız biri bağlanırsa başkasının siparişi
 *     ilk değişiklikte canlı olarak düşer;
 *   • /api/db dışındaki, siparişe dokunan uçların personel kapısı (dış rol süzgeci o uçlardan aşmasın);
 *   • sunucuda `orders`'ı okuyan / yazan YENİ bir yer eklenince testin kırılması (ya `requireStaff` ya `siparisGorebilir`);
 *   • K10 (2026-10-11) — SAHİP satır süzgeci (`syncJobs`: yeniden deneme kuyruğunda iş sahibinindir) AYNI sarmalayıcılardan
 *     akar: `/api/db`'nin altı yazma yolu (oluşturma, PUT, PATCH, silme, atomik artırma, koşullu yazma), iki okuma yolu
 *     (liste, tek okuma) ve akış olayının etiketi (pgShim). Gerçek `/api/db` zinciri testi yazılamadığı için (rotalar
 *     `startServer` kapanışında) bağlantının TEK kanıtı bu çittir.
 *
 * 2026-10-11 (dış rol kapanışı, D3): kural tablosundan dış rol çıktı ve `requireAuth` iç rolü olmayan hesabı izin listesi dışında
 * geri çeviriyor — dış rol `orders`'a artık HİÇ ulaşmıyor («Bayi kendi siparişini görür» beklentisi gerçek zincirde 403 olarak
 * yeniden sabitlendi: kimlikYuzeyi.zincir.test.ts, T2). Süzgeç SÖKÜLMEDİ: buradaki çitlerin hepsi aynen duruyor. Tabloya
 * yanlışlıkla dış rol geri eklenirse ya da boğaz gevşerse dış rol yine yalnız kendi satırını görür (derinlemesine savunma).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { SRC_KOK as SRC, kaynakDosyalari, kodSatirlari, gorece } from '../test/kaynakTarama';
import { DIS_ROL_SATIR_ALANI, DIS_ROL_YAZAMAZ } from '../lib/collections';
import { EXTERNAL_ROLES, STAFF_ROLES, isAllowed } from '../lib/rbac';
import { satirAlani, satirGorunur } from '../lib/tenantErisim';

const SERVER = join(SRC, '..', 'server.ts');
const satirlar = (yol: string, desen: RegExp) => kodSatirlari(yol).filter(({ kod }) => desen.test(kod.trimEnd()));
const say = (yol: string, desen: RegExp) => satirlar(yol, desen).length;
const tek = (yol: string, desen: RegExp): number => { const s = satirlar(yol, desen); expect(s, String(desen)).toHaveLength(1); return s[0].n; };
/** `n` numaralı satırın HEMEN altındaki satırlar sırayla bu desenlere uyar — araya satır giremez, satır düşemez, sıra değişemez. */
const ardindan = (yol: string, n: number, desenler: RegExp[]) => {
  const kod = kodSatirlari(yol);
  desenler.forEach((desen, i) => expect(kod[n + i].kod.trimEnd(), `${gorece(yol)}:${n + i + 1}`).toMatch(desen));
};
const UID_SATIRI = /^\s*const uid = \(req as Request & \{ uid\?: string \}\)\.uid \|\| '';$/;

describe('satır süzgeci üç yolda da bağlı', () => {
  it('REST: istek kimliği ROL taşır (kiraciWhere / kiraciDamgala / dokumanSahibiMi bundan okur)', () => {
    tek(SERVER, /return \{ uid, cid: \(\) => getUserCompanyId\(uid\), superAdmin: isSuperAdmin\(req\), rol: \(\) => getUserRole\(uid\) \};/);
    // Üç ince sarmalayıcı saf işleve O kimlikle devreder: biri yerinde zayıflatılırsa (ör. yalnız kiracı karşılaştıran bir denetim)
    // çağrı yerlerindeki çitler bunu görmez.
    tek(SERVER, /^\s*const tenantWhere = \(req: Request, coll: string\) => kiraciWhere\(coll, reqKimlik\(req\)\);$/);
    tek(SERVER, /^\s*const injectTenant = \(req: Request, coll: string, data: Record<string, unknown>, onceki\?: Record<string, unknown>\) => kiraciDamgala\(coll, data, reqKimlik\(req\), onceki\);$/);
    // PUT / PATCH / cas mevcut belgeyi damgaya verir: dış rolün yazamadığı alanlar (DIS_ROL_YAZAMAZ) silinmez, öncekinden korunur.
    expect(satirlar(SERVER, /^\s*data = await injectTenant\(req, coll, data, before\);/)).toHaveLength(2);
    const sahip = tek(SERVER, /^\s*const ownsDoc = \(req: Request, coll: string, docData: Record<string, unknown> \| undefined, docId\?: string\) =>$/);
    ardindan(SERVER, sahip, [/^\s*dokumanSahibiMi\(coll, docData, reqKimlik\(req\), docId\);$/]);
  });
  it('akış init\'i: kovalar role göre; satır kovası SQL\'e ve parametrelere girer; süzgeçli koleksiyon her bağlantıda yeniden gönderilir', () => {
    tek(SERVER, /const akisKimlik = \{ uid: streamUid, cid: streamCid, rol: streamRole \};/);
    tek(SERVER, /const kova = akisKovalari\(izinliColls, streamRole\);/);
    tek(SERVER, /kova\.satir\.map\(\(_, i\) => `\\n\s+OR \(coll = \$\$\{9 \+ 2 \* i\} AND data->>'companyId' = \$4 AND data->>\$\$\{10 \+ 2 \* i\} = \$5\)`\)\.join\(''\)/);
    tek(SERVER, /\.\.\.kova\.satir\.flatMap\(x => \[x\.coll, x\.alan\]\)\],/);
    tek(SERVER, /const initColls = \[\.\.\.new Set\(\[\.\.\.istenenInit, \.\.\.satirliColls\]\)\];/);
  });
  it('akış olayı: satır süzgeci yayından ÖNCE; görünmeyen satır gönderilmez', () => {
    // Karar saf işlevde (tenantErisim.akisOlayKarari — davranışı tenantErisim.test'te). Burada BAĞLANTI çitlenir: karar bu
    // bağlantının kimliği ve kümesiyle alınır, 'gonder' dışındaki her sonuçta yayından ÖNCE dönülür, 'sil'de yalnız KİMLİK gider.
    const karar = tek(SERVER, /^\s*const satirKarari = akisOlayKarari\(ev, akisKimlik, gonderilenSatirlar\);$/);
    const sil = tek(SERVER, /^\s*if \(satirKarari === 'sil' && !res\.writableEnded\) res\.write\(`event: change\\ndata: \$\{JSON\.stringify\(\{ coll: ev\.coll, type: 'delete', id: ev\.id \}\)\}\\n\\n`\);$/);
    const don = tek(SERVER, /^\s*if \(satirKarari !== 'gonder'\) return;$/);
    const yayin = tek(SERVER, /^\s*yayinla\(ev\);$/);
    expect(karar).toBeLessThan(sil); expect(sil).toBeLessThan(don); expect(don).toBeLessThan(yayin);
    expect(don - karar).toBe(2);                                    // araya koşulsuz bir yayın / erken dönüş giremez
    // Küme init'te doldurulur (init'te gönderilen satır sonradan görünmez olursa 'sil' üretilebilsin) ve süzgeçli koleksiyon
    // her bağlantıda yeniden gönderilir.
    tek(SERVER, /if \(satirAlani\(r\.coll, streamRole\) !== null\) gonderilenSatirlar\.add\(`\$\{r\.coll\}\/\$\{r\.id\}`\);/);
    tek(SERVER, /const satirliColls = colls\.filter\(c => satirAlani\(c, streamRole\) !== null\);/);
  });
});

describe('D3 — süzgeç ikinci kat olarak duruyor; birinci kat (kural tablosu) dış role kapalı', () => {
  it('süzgeçli HER koleksiyon dış role tabloda kapalı (okuma / yazma / silme) — ama süzgeç kuralı role göre hâlâ ETKİN', () => {
    expect([...DIS_ROL_SATIR_ALANI.keys()]).toContain('orders');
    for (const [coll, alan] of DIS_ROL_SATIR_ALANI) {
      for (const rol of EXTERNAL_ROLES) {
        for (const op of ['read', 'write', 'delete'] as const) expect(isAllowed(rol, coll, op), `${rol} ${coll} ${op}`).toBe(false);   // birinci kat
        expect(satirAlani(coll, rol), `${rol} ${coll}`).toBe(alan);                                                                    // ikinci kat sökülmedi
        expect(satirGorunur(coll, rol, { uid: 'u1', cid: 'A' }, { companyId: 'A', [alan]: 'u2' })).toBe(false);
        expect(satirGorunur(coll, rol, { uid: 'u1', cid: 'A' }, { companyId: 'A', [alan]: 'u1' })).toBe(true);
      }
      expect(satirAlani(coll, null), `rolsüz ${coll}`).toBe(alan);
      for (const rol of STAFF_ROLES) expect(satirAlani(coll, rol), `${rol} ${coll}`).toBeNull();                                        // iç rol süzgeçsiz
      expect(DIS_ROL_YAZAMAZ.has(coll) ? (DIS_ROL_YAZAMAZ.get(coll) ?? []).length > 0 : true).toBe(true);
    }
  });
});

describe('/api/db kaçakları kapalı', () => {
  it('koşullu yazma (cas) gövdesi damgadan geçer; atomik artırma sahiplik alanına dokunamaz', () => {
    tek(SERVER, /^\s*: await injectTenant\(req, coll, set as Record<string, unknown>, rows\[0\]\.data as Record<string, unknown>\);$/);
    tek(SERVER, /if \(SAHIPLIK_ALANLARI\.has\(field\)\) return res\.status\(400\)/);
    // + SAHIP_SATIR_ALANI (K10): kuyruk işinin sahibi sayıya çevrilirse iş «damgasız eski iş» sınıfına düşer (Yönetici çalıştırır).
    tek(SERVER, /const SAHIPLIK_ALANLARI = new Set<string>\(\['companyId', 'userId', \.\.\.DIS_ROL_SATIR_ALANI\.values\(\), \.\.\.SAHIP_SATIR_ALANI\.values\(\), \.\.\.\[\.\.\.DIS_ROL_YAZAMAZ\.values\(\)\]\.flat\(\)\]\);/);
  });
  // K10 (2026-10-11) — SAHİP satır süzgeci (`syncJobs`: iş sahibinindir). Kural saf modülde (lib/tenantErisim; davranışı
  // tenantErisim.sahip.test + gerçek motorda tenantErisim.sahip.motor.test). server.ts'e eklenen TEK şey sahip alanının
  // SAHIPLIK_ALANLARI'na girmesidir; süzgecin kendisi mevcut sarmalayıcılardan akar. Bu yüzden «altı yazma yolu + iki okuma yolu
  // o sarmalayıcıları çağırıyor» iddiası burada kilitlenir — biri sökülürse başkasının kuyruk işi o yoldan okunur / yazılır.
  it('sahip süzgeci aynı sarmalayıcılardan akar: altı yazma yolunun ve iki okuma yolunun HEPSİ çitli', () => {
    // 1) oluşturma (POST): damga — `onceki` YOK (yeni kayıt: sahip = oturum).
    tek(SERVER, /^\s*let data = await injectTenant\(req, coll, resolveSentinels\(req\.body \?\? \{\}\) as Record<string, unknown>\);$/);
    // 2-3) PUT / PATCH: sahiplik 403'ü ve mevcut belgeyle damga — yukarıdaki / aşağıdaki testlerde (2'şer satır).
    expect(satirlar(SERVER, /^\s*if \(rows\.length && !gorunur\) \{ res\.status\(403\)\.json\(\{ error: 'Bu kayıt başka bir firmaya ait\.' \}\); return; \}$/)).toHaveLength(2);
    expect(satirlar(SERVER, /^\s*data = await injectTenant\(req, coll, data, before\);/)).toHaveLength(2);
    // 4) silme: sahiplik 403'ü, `sahiplikDenetimli` kapısının HEMEN altında, silme sorgusundan ÖNCE.
    const sil = tek(SERVER, /^\s*if \(existing\.length && !\(await ownsDoc\(req, coll, prevData, realId\)\)\) \{ res\.status\(403\)\.json\(\{ error: 'Bu kayıt başka bir firmaya ait\.' \}\); return; \}$/);
    expect(kodSatirlari(SERVER)[sil - 2].kod.trimEnd()).toMatch(/^\s*if \(sahiplikDenetimli\(coll\)\) \{$/);
    expect(sil).toBeLessThan(tek(SERVER, /^\s*await docsDb\.query\('DELETE FROM docs WHERE coll = \$1 AND id = \$2', \[coll, realId\]\);$/));
    // 5-6) atomik artırma / koşullu yazma: `sahipsizYanit` (2 dönüş) ve koşullu yazmanın damgası — bu `describe`ın diğer testleri.
    expect(satirlar(SERVER, /^\s*return sahipsizYanit\(req, res, coll\);$/)).toHaveLength(2);
    // Okuma = yazma kuralı — liste: SQL eki `tenantWhere`'den; sorgu metni tenantErisim.sahip.motor.test'in koştuğuyla AYNI.
    const where = tek(SERVER, /^\s*const t = await tenantWhere\(req, coll\);$/);
    ardindan(SERVER, where, [/^\s*const \{ rows \} = await docsDb\.query\(`SELECT id, data FROM docs WHERE coll = \$1\$\{t\.sql\}`, \[coll, \.\.\.t\.params\]\);$/]);
    // Okuma = yazma kuralı — tek okuma: görünmeyen iş «yok» ile AYNI yanıt (404).
    tek(SERVER, /^\s*if \(!rows\.length \|\| !\(await ownsDoc\(req, coll, rows\[0\]\.data as Record<string, unknown>, id\)\)\) \{ res\.status\(404\)\.json\(\{ error: 'Not found\.' \}\); return; \}$/);
    // Akış olayının etiketi: sahip haritası pgShim'e bağlı (bağlanmazsa olay etiketsiz kalır; sahibi kendi işinin olayını alamaz).
    const PGSHIM = join(SRC, 'server', 'pgShim.ts');
    const etiket = tek(PGSHIM, /^\s*const satirAlan = satirSahibiAlani\(coll\);$/);
    ardindan(PGSHIM, etiket, [/^\s*const satirSahibi = satirAlan && typeof d\[satirAlan\] === 'string' \? d\[satirAlan\] as string : undefined;$/]);
    expect(say(PGSHIM, /DIS_ROL_SATIR_ALANI/)).toBe(0);         // eski doğrudan okuma kalmadı (yalnız dış rol haritasına bakıyordu)
  });
  // İnceleme düzeltmesi (2026-10-17): sahip devredilmediğinden Yönetici'nin başkasının damgalı kuyruk işine PUT ile yazdığı
  // gövde önceki sahibin okumasına düşerdi. Kural saf yüklemde (tenantErisim.baskasininSahipKaydiMi — davranışı
  // tenantErisim.sahip.test); burada YALNIZ PUT işleyicisine, sahiplik 403'ünün hemen altına bağlı olduğu kilitlenir.
  it('PUT: başkasının SAHİP damgalı kaydına tam değiştirme reddedilir — sahiplik 403\'ünün hemen altında, birleştirme / damga / INSERT\'ten önce; PATCH sormaz', () => {
    const KAPI = /^\s*if \(baskasininSahipKaydiMi\(coll, before, \(req as Request & \{ uid\?: string \}\)\.uid \|\| ''\)\) \{ res\.status\(403\)\.json\(\{ error: 'Bu kayıt başka bir kullanıcıya ait\.' \}\); return; \}$/;
    const kapi = tek(SERVER, KAPI);
    const put = tek(SERVER, /^\s*app\.put\('\/api\/db\/:coll\/:id', /);
    const patch = tek(SERVER, /^\s*app\.patch\('\/api\/db\/:coll\/:id', /);
    expect(put).toBeLessThan(kapi);
    expect(kapi).toBeLessThan(patch);
    const sahiplik = satirlar(SERVER, /^\s*if \(rows\.length && !gorunur\) \{ res\.status\(403\)\.json\(\{ error: 'Bu kayıt başka bir firmaya ait\.' \}\); return; \}$/)
      .map(s => s.n).filter(n => n > put && n < kapi);
    expect(sahiplik).toHaveLength(1);
    // Arada yalnız yorum / boş satır: kapı sahiplik yanıtının HEMEN altında (`before` okunmuş, görünürlük sorulmuş).
    const kod = kodSatirlari(SERVER);
    expect(kod.slice(sahiplik[0], kapi - 1).map(s => s.kod.trim()).filter(k => k !== '')).toEqual([]);
    // Yazmadan önce: birleştirme, damga ve INSERT bu satırın altında.
    const sonraki = (desen: RegExp) => satirlar(SERVER, desen).map(s => s.n).find(n => n > kapi) ?? Infinity;
    expect(kapi).toBeLessThan(sonraki(/^\s*data = req\.query\.merge === '1' \? mergeDocData\(before, incoming\) : incoming;$/));
    expect(sonraki(/^\s*data = req\.query\.merge === '1' \? mergeDocData\(before, incoming\) : incoming;$/)).toBeLessThan(patch);
    expect(sonraki(/^\s*data = await injectTenant\(req, coll, data, before\);/)).toBeLessThan(patch);
    // PATCH / koşullu yazma / silme yüklemi SORMAZ (Yönetici'nin kapatma ve temizlik yolları).
    expect(say(SERVER, /baskasininSahipKaydiMi\(/)).toBe(1);
  });
  it('PUT ve PATCH: dış rol, sunucunun ürettiği biçimde (`__`) kimlikle yeni kayıt açamaz', () => {
    // Kapı "var VE görünür" ile sorulur ve sahiplik yanıtından ÖNCE gelir: "yok" ile "var ama görünmez" aynı yanıtı alır.
    const GORUNUR = /^\s*const gorunur = rows\.length > 0 && await ownsDoc\(req, coll, before, realId\);$/;
    const KAPI = /^\s*if \(await ayrilmisKimlikEngeli\(req, res, coll, realId, gorunur\)\) return;$/;
    // Satır SONUNA kadar çapalı: `return;` düşerse 403 gider ama yazma sürer (birleştirme + damga + INSERT … ON CONFLICT).
    const SAHIPLIK_403 = /^\s*if \(rows\.length && !gorunur\) \{ res\.status\(403\)\.json\(\{ error: 'Bu kayıt başka bir firmaya ait\.' \}\); return; \}$/;
    expect(say(SERVER, GORUNUR)).toBe(2);
    expect(say(SERVER, SAHIPLIK_403)).toBe(2);
    const kapilar = satirlar(SERVER, KAPI);
    expect(kapilar).toHaveLength(2);
    const kod = kodSatirlari(SERVER);
    for (const { n } of kapilar) {
      expect(kod[n - 2].kod.trimEnd()).toMatch(GORUNUR);              // hemen üstünde
      ardindan(SERVER, n, [SAHIPLIK_403]);                            // sahiplik yanıtı hemen altında, dönüşüyle birlikte
    }
    // Sarmalayıcının TAMAMI çitli: ön eleme ve karar saf işlevde (tenantErisim.ayrilmisKimlikAdayi / ayrilmisKimlikMi — davranışları
    // tenantErisim.test'te), rol yalnız aday ise sorulur, 403'ten sonra `true` döner (yoksa 403 gider ama yazma sürer).
    const imza = tek(SERVER, /^\s*const ayrilmisKimlikEngeli = async \(req: Request, res: Response, coll: string, id: string, gorunur: boolean\): Promise<boolean> => \{$/);
    ardindan(SERVER, imza, [
      /^\s*if \(!ayrilmisKimlikAdayi\(coll, id, gorunur\)\) return false;$/,
      UID_SATIRI,
      /^\s*if \(!ayrilmisKimlikMi\(coll, id, await getUserRole\(uid\), gorunur\)\) return false;$/,
      /^\s*res\.status\(403\)\.json\(\{ error: 'Bu kimlikle kayıt açılamaz\.' \}\);$/,
      /^\s*return true;$/,
      /^\s*\};$/,
    ]);
  });
  it('atomik artırma ve koşullu yazma: görünmeyen sipariş dış role "yok" ile AYNI yanıtı verir (varlık sızmaz)', () => {
    const donusler = satirlar(SERVER, /^\s*return sahipsizYanit\(req, res, coll\);$/);
    expect(donusler).toHaveLength(2);
    const kod = kodSatirlari(SERVER);
    for (const { n } of donusler) {
      // Yanıtın HANGİ koşulda verildiği: sahiplik denetimi BAŞARISIZSA (`!` düşerse sahip 404 alır, yabancı geçer); hemen üstünde
      // "yok" yanıtı — görünmeyen satırın 404'ü onunla AYNI gövdeyi taşır.
      expect(kod[n - 3].kod.trimEnd()).toMatch(/^\s*if \(!rows\.length\) return res\.status\(404\)\.json\(\{ error: 'Not found\.' \}\);$/);
      expect(kod[n - 2].kod.trimEnd()).toMatch(/^\s*if \(sahiplikDenetimli\(coll\) && !\(await ownsDoc\(req, coll, rows\[0\]\.data as Record<string, unknown>, id\)\)\) \{$/);
      ardindan(SERVER, n, [/^\s*\}$/]);
    }
    // Yanıtın kendisi: 404 mü 403 mü kararı saf işlevde (tenantErisim.sahipsizDurumKodu — davranışı tenantErisim.test'te).
    const imza = tek(SERVER, /^\s*const sahipsizYanit = async \(req: Request, res: Response, coll: string\): Promise<void> => \{$/);
    ardindan(SERVER, imza, [
      UID_SATIRI,
      /^\s*if \(sahipsizDurumKodu\(coll, await getUserRole\(uid\)\) === 404\) \{ res\.status\(404\)\.json\(\{ error: 'Not found\.' \}\); return; \}$/,
      /^\s*res\.status\(403\)\.json\(\{ error: 'Bu kayıt başka bir firmaya ait\.' \}\);$/,
      /^\s*\};$/,
    ]);
  });
});

describe('siparişe dokunan özel uçlar personel kapılı (ya da dış rolü İÇERMEYEN koleksiyon kuralıyla kapılı)', () => {
  const R = (ad: string) => join(SRC, 'server', 'routes', ad);
  // 2026-10-17 (iç rol daraltma, `.wf/SARTNAME-ic-rol-daraltma.md` L5 / P1 / S2): üç uçta `requireStaff`'ın YERİNE eşdeğer
  // koleksiyonun kuralı geldi (kapı ortak tablodan: src/lib/entegrasyonUcKapilari.ts). Bu çitin amacı (dış rol süzgeci bu
  // uçlardan aşmasın) korunur: kural dış rolü İÇERMEZ — aşağıdaki «kural kapısı» sınaması sabitler.
  const KURAL_KAPILI: Array<[string, RegExp, string, 'read' | 'write']> = [
    [SERVER, /app\.post\('\/api\/luca\/sync\/fatura', requireAuth, requireMfaVerified, requireCollectionAccess\('invoices', 'write'\),/, 'invoices', 'write'],
    [R('erpRoutes.ts'), /app\.post\('\/api\/parasut\/fatura', C\.requireAuth, C\.requireMfaVerified, C\.requireCollectionAccess\('invoices', 'write'\),/, 'invoices', 'write'],
    [R('kanalRoutes.ts'), /app\.post\("\/api\/shopify\/sync", C\.requireAuth, C\.requireMfaVerified, C\.requireCollectionAccess\('orders', 'read'\),/, 'orders', 'read'],
  ];
  it('kural kapılı üç uç: satır tam bir kez; kural dış rolü ve rolsüz hesabı GEÇİRMEZ', () => {
    const eksik = KURAL_KAPILI.filter(([yol, desen]) => say(yol, desen) !== 1).map(([yol, desen]) => `${gorece(yol)} ${desen}`);
    expect(eksik).toEqual([]);
    for (const [, desen, koleksiyon, eylem] of KURAL_KAPILI) {
      for (const dis of EXTERNAL_ROLES) expect(isAllowed(dis, koleksiyon, eylem), `${desen} × ${dis}`).toBe(false);
      expect(isAllowed(null, koleksiyon, eylem)).toBe(false);
    }
  });
  const UCLAR: Array<[string, RegExp]> = [
    [SERVER, /app\.get\('\/api\/aging', requireAuth, requireStaff,/],
    [SERVER, /app\.post\('\/api\/whatsapp\/order-notification', requireAuth, requireMfaVerified, requireStaff,/],
    [SERVER, /app\.post\('\/api\/whatsapp\/send', requireAuth, requireMfaVerified, requireStaff,/],
    [R('reportsRoutes.ts'), /app\.get\('\/api\/reports\/summary', C\.requireAuth, C\.requireStaff,/],
    // Alış maliyeti + tüm müşterilere satış hareketleri (Mikro) — dış role kapalı.
    [R('reportsRoutes.ts'), /app\.get\('\/api\/reports\/stok-fiyat-karsilastirma', C\.requireAuth, C\.requireStaff,/],
    [R('reportsRoutes.ts'), /app\.get\('\/api\/reports\/stok-fiyat-karsilastirma\/:sku\/detay', C\.requireAuth, C\.requireStaff,/],
    [R('mikroRoutes.ts'), /app\.post\('\/api\/mikro\/siparis\/kaydet', C\.requireAuth, C\.requireMfaVerified, C\.requireStaff,/],
    [R('mikroRoutes.ts'), /app\.post\('\/api\/mikro\/fatura\/kaydet', C\.requireAuth, C\.requireMfaVerified, C\.requireStaff,/],
    [R('mikroRoutes.ts'), /app\.post\('\/api\/mikro\/fatura\/kalemler', C\.requireAuth, C\.requireStaff,/],
    [R('mikroRoutes.ts'), /app\.post\('\/api\/mikro\/import\/faturadan-siparis', C\.requireAuth, C\.requireMfaVerified, C\.requireStaff,/],
    [R('kanalRoutes.ts'), /app\.post\('\/api\/trendyol\/sync', C\.requireAuth, C\.requireMfaVerified, C\.requireStaff,/],
    [R('kanalRoutes.ts'), /app\.post\('\/api\/hepsiburada\/sync', C\.requireAuth, C\.requireMfaVerified, C\.requireStaff,/],
    [R('epostaRoutes.ts'), /app\.post\('\/api\/email\/order-notification', C\.requireAuth, C\.requireMfaVerified, C\.requireStaff,/],
    [R('paymentRoutes.ts'), /app\.post\('\/api\/iyzico\/payment-link', C\.requireAuth, C\.requireMfaVerified, C\.requireStaff,/],
  ];
  it('her uç satırında requireStaff var', () => {
    const eksik = UCLAR.filter(([yol, desen]) => say(yol, desen) !== 1).map(([yol, desen]) => `${gorece(yol)} ${desen}`);
    expect(eksik).toEqual([]);
  });
  it('istemciden gelen sipariş kimliği sahiplikten geçer (Luca: siparisGorebilir; iyzico: kiracı denetimi dış çağrıdan ÖNCE)', () => {
    tek(SERVER, /if \(!siparisGorebilir\(await getUserRole\(uid\), \{ uid, cid: await reqCompanyId\(req\) \}, order\)\) \{/);
    const P = R('paymentRoutes.ts');
    const kapi = tek(P, /if \(dc === null \|\| \(dc !== '' && dc !== await C\.reqCompanyId\(req\)\)\) \{/);
    const disCagri = tek(P, /const r = await fetch\(`\$\{creds\.baseUrl\}\/payment\/initialize\/checkout`, \{/);
    expect(kapi).toBeLessThan(disCagri);
  });
});

describe('sunucuda `orders` okuyan / yazan yerlerin SAYISI sabit', () => {
  // Yeni bir okuyucu / yazıcı eklenince bu test kırılır: uç ya `requireStaff` ile kapılanır ya da satırı `siparisGorebilir`'den
  // geçirir, sonra sayı bilinçli güncellenir. (2026-10-02 ölçümü.)
  const BEKLENEN: Record<string, number> = {
    // 9 → 5 (2026-10-08): eski Shopify webhook yazıcıları server.ts'ten çıktı; yenisi kanal/shopifyWebhook.ts'te TEK yazıcı
    // (imzası doğrulanmış sunucu içi yol; doküman başka kiracıya aitse YAZMAZ — kullanıcıya satır okutmaz).
    'server.ts': 5,
    'src/server/kanal/shopifyWebhook.ts': 1,
    'src/server/routes/kanalRoutes.ts': 4,
    'src/server/routes/mikroRoutes.ts': 14,
    'src/server/routes/opsRoutes.ts': 1,
    'src/server/routes/paymentRoutes.ts': 2,
    'src/server/routes/reportsRoutes.ts': 1,
    'src/server/crons.ts': 1,
  };
  it('dosya başına sayım', () => {
    const desen = /collection\('orders'\)|loadCompanyDocs\('orders'|tenantSnap\('orders'|coll = 'orders'/g;
    const olculen: Record<string, number> = {};
    for (const yol of [SERVER, ...kaynakDosyalari(join(SRC, 'server'))]) {
      if (/\.test\.ts$|testDuzenegi/.test(yol)) continue;
      const n = kodSatirlari(yol).reduce((t, { kod }) => t + (kod.match(desen)?.length ?? 0), 0);
      if (n > 0) olculen[gorece(yol)] = n;
    }
    expect(olculen).toEqual(BEKLENEN);
  });
});
