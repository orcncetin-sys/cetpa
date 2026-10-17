/**
 * kimlikYuzeyi.test.ts — TEK BOĞAZ kararı ve izin listesi (şartname «dış rol kapanışı» D4′ · T3 / T7 / T12'nin saf yarısı).
 *
 * Gerçek `server.ts` + gerçek express zinciri: src/server/kimlikYuzeyi.zincir.test.ts. Burada işlevin KENDİSİ ölçülür ve
 * bağlantı kaynak çitiyle tutulur (`requireAuth` kararı gerçekten çağırıyor mu — «yazıldı ama bağlanmadı» sınıfı).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { SRC_KOK, kaynakDosyalari, kodSatirlari } from '../test/kaynakTarama';
import { EXTERNAL_ROLES, STAFF_ROLES } from './rbac';
import {
  KENDI_UID, KIMLIK_YUZEYI_RETLERI, ROLSUZ_IZINLI_YOLLAR, ROL_OKUNAMADI_YANITI, disRolMu, icRolMu, istekYolu, kimlikYuzeyiKarari,
  rolsuzIzinliMi, type KimlikYuzeyiGirdisi,
} from './kimlikYuzeyi';

const UID = 'u1AbC-_9';
const BASKA = 'u2XyZ';

describe('izin listesi — TEK sabit, TAMAMI sabitlenmiş', () => {
  it('liste tam olarak bu dokuz satır (yeni satır = internetten hesap açan HERKESE açık uç; bilerek eklenir)', () => {
    expect(ROLSUZ_IZINLI_YOLLAR.map(i => `${i.yontemler.join('|')} ${i.yol}`)).toEqual([
      'GET|PUT|PATCH /api/db/users/:uid',
      'POST /api/db/session',
      'POST /api/db/session/logout',
      'GET /api/mfa/status',
      'POST /api/mfa/enroll/start',
      'POST /api/mfa/enroll/verify',
      'POST /api/mfa/verify',
      'POST /api/invites/redeem',
      'GET /api/superadmin/me',
    ]);
    expect(KENDI_UID).toBe(':uid');
    for (const i of ROLSUZ_IZINLI_YOLLAR) expect(i.neden.length, i.yol).toBeGreaterThan(10);
  });

  it('listede silme yöntemi, joker ve iş verisi yolu yok; yer tutucu yalnız `users` satırında', () => {
    for (const i of ROLSUZ_IZINLI_YOLLAR) {
      expect(i.yontemler.map(String), i.yol).not.toContain('DELETE');
      expect(i.yol, i.yol).toMatch(/^\/api\/[a-z/:-]+$/);
      expect(i.yol.endsWith('/'), i.yol).toBe(false);
      if (i.yol.includes(':')) expect(i.yol).toBe('/api/db/users/:uid');
    }
    for (const yasak of ['/api/db/inventory', '/api/db/quotations', '/api/db/orders', '/api/upload/tahsilat', '/api/ai/generate', '/api/mfa/disable', '/api/stripe/create-checkout']) {
      expect(ROLSUZ_IZINLI_YOLLAR.some(i => i.yol === yasak), yasak).toBe(false);
    }
  });

  it('liste DONDURULMUŞ: içe aktaran kod çalışma anında satır ekleyemez, yöntem genişletemez', () => {
    expect(Object.isFrozen(ROLSUZ_IZINLI_YOLLAR)).toBe(true);
    for (const i of ROLSUZ_IZINLI_YOLLAR) { expect(Object.isFrozen(i)).toBe(true); expect(Object.isFrozen(i.yontemler)).toBe(true); }
    expect(() => (ROLSUZ_IZINLI_YOLLAR as unknown as unknown[]).push({ yontemler: ['GET'], yol: '/api/db/inventory', neden: 'x' })).toThrow();
    expect(rolsuzIzinliMi('GET', '/api/db/inventory', UID)).toBe(false);
  });
});

describe('rolsuzIzinliMi — kurallı yazım geçer', () => {
  it('kendi users belgesi: GET / PUT / PATCH', () => {
    for (const y of ['GET', 'PUT', 'PATCH']) expect(rolsuzIzinliMi(y, `/api/db/users/${UID}`, UID), y).toBe(true);
  });
  it('sabit yollar yalnız KENDİ yöntemleriyle', () => {
    const SABIT: Array<[string, string]> = [
      ['POST', '/api/db/session'], ['POST', '/api/db/session/logout'], ['GET', '/api/mfa/status'], ['POST', '/api/mfa/enroll/start'],
      ['POST', '/api/mfa/enroll/verify'], ['POST', '/api/mfa/verify'], ['POST', '/api/invites/redeem'], ['GET', '/api/superadmin/me'],
    ];
    for (const [y, yol] of SABIT) {
      expect(rolsuzIzinliMi(y, yol, UID), `${y} ${yol}`).toBe(true);
      for (const diger of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].filter(d => d !== y)) {
        expect(rolsuzIzinliMi(diger, yol, UID), `${diger} ${yol}`).toBe(false);
      }
    }
  });
});

describe('rolsuzIzinliMi — liste dışı ve TAKLİT yazımlar reddedilir', () => {
  const ret = (yontem: string, yol: string, uid = UID) => expect(rolsuzIzinliMi(yontem, yol, uid), `${yontem} ${yol}`).toBe(false);

  it('kendi belgesinde yasak işlemler: silme, POST, /increment, /cas', () => {
    ret('DELETE', `/api/db/users/${UID}`);
    ret('POST', `/api/db/users/${UID}`);
    ret('POST', '/api/db/users');
    for (const y of ['GET', 'PUT', 'PATCH', 'POST']) { ret(y, `/api/db/users/${UID}/increment`); ret(y, `/api/db/users/${UID}/cas`); }
  });
  it('başkasının uid\'i, koleksiyon listesi, başka koleksiyonda kendi uid\'i', () => {
    for (const y of ['GET', 'PUT', 'PATCH']) { ret(y, `/api/db/users/${BASKA}`); ret(y, '/api/db/users'); ret(y, `/api/db/inventory/${UID}`); ret(y, `/api/db/subscriptions/${UID}`); }
  });
  it('iş verisi ve kapısız uçlar', () => {
    for (const [y, yol] of [['GET', '/api/db/inventory'], ['GET', '/api/db/quotations'], ['POST', '/api/db/orders'], ['GET', '/api/integrations/health'],
      ['GET', '/api/inventory/son-alis-tedarikci'], ['POST', '/api/upload/tahsilat'], ['POST', '/api/ai/generate'], ['POST', '/api/mfa/disable'],
      ['POST', '/api/stripe/create-checkout'], ['POST', '/api/db/demoRequests'], ['GET', '/api/db/stream']] as const) ret(y, yol);
  });
  it('sondaki eğik çizgi', () => {
    ret('GET', `/api/db/users/${UID}/`); ret('GET', '/api/mfa/status/'); ret('POST', '/api/invites/redeem/'); ret('POST', '/api/db/session/');
  });
  it('büyük / küçük harf (yol ve yöntem)', () => {
    ret('GET', `/API/DB/users/${UID}`); ret('GET', `/api/db/Users/${UID}`); ret('GET', `/api/db/USERS/${UID}`); ret('GET', '/api/MFA/status');
    ret('GET', `/api/db/users/${UID.toLowerCase()}`);                          // uid büyük / küçük harfe DUYARLI
    ret('get', '/api/mfa/status'); ret('Get', `/api/db/users/${UID}`); ret('post', '/api/invites/redeem');
  });
  it('yüzde kaçışı', () => {
    ret('GET', `/api/db/%75sers/${UID}`); ret('GET', `/api/db/users%2F${UID}`); ret('GET', `/api/db/users/${UID}%2Fincrement`);
    ret('GET', `/api/db/users/${UID}%00`); ret('GET', '/api/mfa/statu%73'); ret('GET', `/api%2Fdb%2Fusers%2F${UID}`);
    ret('GET', `/api/db/users/${encodeURIComponent('a b')}`, 'a b');
  });
  it('çift eğik çizgi, nokta parçası, ters eğik çizgi', () => {
    ret('GET', `//api/db/users/${UID}`); ret('GET', `/api//db/users/${UID}`); ret('GET', `/api/db/users//${UID}`); ret('GET', '/api/mfa//status');
    ret('GET', `/api/db/inventory/../users/${UID}`); ret('GET', `/api/db/users/${UID}/../../inventory`); ret('GET', `/api/db/./users/${UID}`);
    ret('GET', `\\api\\db\\users\\${UID}`); ret('GET', `/api/db/users\\${UID}`);
  });
  it('sorgu / parça / mutlak biçim yola KARIŞMIŞSA (çağıran `istekYolu` ile ayırır; ayırmadan verilirse ret)', () => {
    ret('GET', `/api/db/users/${UID}?merge=1`); ret('GET', '/api/mfa/status#x'); ret('GET', '/api/mfa/status;x=1');
    ret('GET', `http://app.cetpa.com.tr/api/db/users/${UID}`); ret('GET', `/api/db/inventory?/api/db/users/${UID}`);
    ret('GET', ` /api/mfa/status`); ret('GET', '/api/mfa/status '); ret('GET', '');
  });
  it('uid: boş, yol karakteri taşıyan ya da kaçış gerektiren kimlikte «kendi belgesi» satırı eşleşmez', () => {
    ret('GET', '/api/db/users/', '');
    ret('GET', '/api/db/users/a/b', 'a/b'); ret('GET', '/api/db/users/..', '..'); ret('GET', '/api/db/users/a?b', 'a?b');
    ret('GET', '/api/db/users/a%2Fb', 'a%2Fb'); ret('GET', '/api/db/users/x#y', 'x#y'); ret('GET', '/api/db/users/a.b', 'a.b');
    ret('GET', `/api/db/users/${'a'.repeat(129)}`, 'a'.repeat(129));
    expect(rolsuzIzinliMi('GET', `/api/db/users/${'a'.repeat(128)}`, 'a'.repeat(128))).toBe(true);
    // Yer tutucunun KENDİSİ yol olarak verilirse: uid ':uid' güvenli kümede değil.
    ret('GET', '/api/db/users/:uid', ':uid'); ret('GET', '/api/db/users/:uid');
    // `$` kalıpları (replace tuzağı) — uid kümede olmadığı için zaten ret.
    ret('GET', '/api/db/users/$&', '$&');
  });
  it('dize olmayan girdi fırlatmaz, reddeder', () => {
    const b = rolsuzIzinliMi as unknown as (a: unknown, b: unknown, c: unknown) => boolean;
    expect(b(undefined, '/api/mfa/status', UID)).toBe(false);
    expect(b('GET', undefined, UID)).toBe(false);
    expect(b('GET', `/api/db/users/${UID}`, undefined)).toBe(false);
    expect(b('GET', ['/api/mfa/status'], UID)).toBe(false);
  });
});

describe('istekYolu — ham hedefin sorgudan önceki kısmı; kod çözme / temizlik YOK', () => {
  it('sorguyu ayırır, gerisine dokunmaz', () => {
    expect(istekYolu(`/api/db/users/${UID}?merge=1`)).toBe(`/api/db/users/${UID}`);
    expect(istekYolu('/api/mfa/status')).toBe('/api/mfa/status');
    expect(istekYolu('/api/mfa/status?')).toBe('/api/mfa/status');
    expect(istekYolu('/api/db/inventory?x=/api/mfa/status')).toBe('/api/db/inventory');
    expect(istekYolu('/api/mfa/status?a=1?b=2#c')).toBe('/api/mfa/status');
    expect(istekYolu('/API/Mfa/Status/')).toBe('/API/Mfa/Status/');
    expect(istekYolu('/api/db/%75sers/x')).toBe('/api/db/%75sers/x');
    expect(istekYolu('/api/mfa/status#x')).toBe('/api/mfa/status#x');
  });
  it('dize değilse boş', () => {
    expect(istekYolu(undefined)).toBe(''); expect(istekYolu(null)).toBe(''); expect(istekYolu(42)).toBe(''); expect(istekYolu(['/api/mfa/status'])).toBe('');
  });
});

describe('kimlikYuzeyiKarari — süper yönetici → iç rol → izin listesi → ret', () => {
  const g = (ek: Partial<KimlikYuzeyiGirdisi>): KimlikYuzeyiGirdisi => ({ superAdmin: false, rol: null, yontem: 'GET', hedef: '/api/db/inventory', uid: UID, ...ek });
  const HEDEFLER: Array<[string, string]> = [
    ['GET', '/api/db/inventory'], ['POST', '/api/upload/tahsilat'], ['DELETE', `/api/db/users/${BASKA}`], ['PATCH', `/api/db/users/${UID}/increment`],
    ['POST', '/api/ai/generate'], ['GET', '/api/integrations/health'], ['GET', '/api/mfa/status'], ['HEAD', '/x'], ['POST', ''],
  ];

  it('süper yönetici HER uçtan geçer (rolü ne olursa olsun — rolsüz, dış rol, iç rol)', () => {
    for (const [yontem, hedef] of HEDEFLER) for (const rol of [null, 'Dealer', 'B2B', 'Sales', 7]) {
      expect(kimlikYuzeyiKarari(g({ superAdmin: true, rol, yontem, hedef }))).toEqual({ gecer: true, neden: 'super-yonetici' });
    }
  });
  it('HER iç rol HER uçtan geçer — iç rol için boğaz yok', () => {
    expect(STAFF_ROLES.length).toBe(10);
    for (const rol of STAFF_ROLES) for (const [yontem, hedef] of HEDEFLER) {
      expect(kimlikYuzeyiKarari(g({ rol, yontem, hedef })), `${rol} ${yontem} ${hedef}`).toEqual({ gecer: true, neden: 'ic-rol' });
    }
  });
  it('dış rol: liste dışı → DIS_ROL; listedeki yol → geçer', () => {
    expect(EXTERNAL_ROLES.length).toBeGreaterThan(0);
    for (const rol of EXTERNAL_ROLES) {
      for (const [yontem, hedef] of HEDEFLER.filter(([, h]) => h !== '/api/mfa/status')) {
        expect(kimlikYuzeyiKarari(g({ rol, yontem, hedef })), `${rol} ${yontem} ${hedef}`).toEqual({ gecer: false, kod: 'DIS_ROL' });
      }
      expect(kimlikYuzeyiKarari(g({ rol, yontem: 'GET', hedef: '/api/mfa/status' }))).toEqual({ gecer: true, neden: 'izin-listesi' });
      expect(kimlikYuzeyiKarari(g({ rol, yontem: 'PUT', hedef: `/api/db/users/${UID}?merge=1` }))).toEqual({ gecer: true, neden: 'izin-listesi' });
    }
  });
  it('rolsüz ve rol alanı GEÇERSİZ hesap: liste dışı → ROL_YOK; listedeki yol → geçer', () => {
    for (const rol of [null, undefined, '', 0, 1, true, 'Accountant', 'admin', 'SALES', ' Sales', {}, ['Admin']] as unknown[]) {
      for (const [yontem, hedef] of HEDEFLER.filter(([, h]) => h !== '/api/mfa/status')) {
        expect(kimlikYuzeyiKarari(g({ rol, yontem, hedef })), `${JSON.stringify(rol)} ${yontem} ${hedef}`).toEqual({ gecer: false, kod: 'ROL_YOK' });
      }
      expect(kimlikYuzeyiKarari(g({ rol, yontem: 'POST', hedef: '/api/invites/redeem' }))).toEqual({ gecer: true, neden: 'izin-listesi' });
      expect(kimlikYuzeyiKarari(g({ rol, yontem: 'GET', hedef: `/api/db/users/${UID}` }))).toEqual({ gecer: true, neden: 'izin-listesi' });
      expect(kimlikYuzeyiKarari(g({ rol, yontem: 'GET', hedef: `/api/db/users/${BASKA}` }))).toEqual({ gecer: false, kod: 'ROL_YOK' });
    }
  });
  it('yöntem tüneli: karar GERÇEK yöntemle verilir — tünelden çıkan DELETE / PATCH izin listesindeki yolu açmaz', () => {
    // İstemci `POST` + `X-Cetpa-Method: DELETE` yollar; Express rotayı `DELETE` ile seçer ve `req.method` de odur.
    expect(kimlikYuzeyiKarari(g({ yontem: 'DELETE', hedef: `/api/db/users/${UID}` }))).toEqual({ gecer: false, kod: 'ROL_YOK' });
    expect(kimlikYuzeyiKarari(g({ yontem: 'PATCH', hedef: '/api/db/session' }))).toEqual({ gecer: false, kod: 'ROL_YOK' });
    expect(kimlikYuzeyiKarari(g({ yontem: 'PUT', hedef: '/api/mfa/verify' }))).toEqual({ gecer: false, kod: 'ROL_YOK' });
  });
  it('icRolMu / disRolMu: yalnız bilinen rol DİZGESİ', () => {
    for (const r of STAFF_ROLES) { expect(icRolMu(r)).toBe(true); expect(disRolMu(r)).toBe(false); }
    for (const r of EXTERNAL_ROLES) { expect(icRolMu(r)).toBe(false); expect(disRolMu(r)).toBe(true); }
    for (const r of [null, undefined, 1, 'sales', 'Admin ', ['Admin'], { role: 'Admin' }]) { expect(icRolMu(r)).toBe(false); expect(disRolMu(r)).toBe(false); }
  });
  it('yanıt gövdeleri: 403 `code` kararla aynı; 503 ayrı kod', () => {
    expect(KIMLIK_YUZEYI_RETLERI.ROL_YOK.code).toBe('ROL_YOK');
    expect(KIMLIK_YUZEYI_RETLERI.DIS_ROL.code).toBe('DIS_ROL');
    expect(KIMLIK_YUZEYI_RETLERI.DIS_ROL.error).toBe('Bu hesap bayi hesabıdır. ERP ekranı bayi hesaplarına kapalıdır.');
    expect(KIMLIK_YUZEYI_RETLERI.ROL_YOK.error.length).toBeGreaterThan(10);
    expect(ROL_OKUNAMADI_YANITI.code).toBe('ROL_OKUNAMADI');
  });
});

describe('bağlantı çiti — karar `requireAuth`\'a GERÇEKTEN bağlı (yazıldı ama bağlanmadı olmasın)', () => {
  const SERVER = join(SRC_KOK, '..', 'server.ts');
  const kod = kodSatirlari(SERVER).map(s => s.kod);
  const govde = (imza: RegExp): string[] => {
    const b = kod.findIndex(s => imza.test(s));
    expect(b, String(imza)).toBeGreaterThan(-1);
    const s = kod.findIndex((x, i) => i > b && x === '}');
    return kod.slice(b, s + 1).map(x => x.trim()).filter(Boolean);
  };

  it('requireAuth: belirteç doğrulaması ve askı denetiminden SONRA, `next()`\'ten HEMEN ÖNCE boğaz; `next()` tek ve koşulsuz değil', () => {
    const g = govde(/^async function requireAuth\(req: Request, res: Response, next: NextFunction\): Promise<void> \{$/);
    const dogrula = g.findIndex(s => s.includes('await getAuth().verifyIdToken(token)'));
    const aski = g.findIndex(s => s.includes("code: 'COMPANY_SUSPENDED'"));
    const bogaz = g.findIndex(s => s === 'if (!(await kimlikYuzeyindenGecer(req, res, decoded.uid))) return;');
    expect(dogrula).toBeGreaterThan(-1); expect(aski).toBeGreaterThan(dogrula); expect(bogaz).toBeGreaterThan(aski);
    expect(g[bogaz + 1]).toBe('next();');
    // Kimlikli yolda `next()` yalnız boğazın altında; öbür tek `next()` kimliksiz herkese açık form dalı (`return next();`).
    expect(g.filter(s => s === 'next();')).toHaveLength(1);
    expect(g.filter(s => s.includes('next()'))).toEqual(['return next();', 'next();']);
    expect(g.indexOf('return next();')).toBeLessThan(dogrula);
  });

  it('kimlikYuzeyindenGecer: süper yöneticide rol okunmaz; rol HATAYI YUTMAYAN okuyucudan; okunamazsa 503; karar GERÇEK yöntem + ham hedefle', () => {
    const g = govde(/^async function kimlikYuzeyindenGecer\(req: Request, res: Response, uid: string\): Promise<boolean> \{$/);
    expect(g).toEqual([
      'async function kimlikYuzeyindenGecer(req: Request, res: Response, uid: string): Promise<boolean> {',
      'const superAdmin = isSuperAdmin(req);',
      'let rol: unknown = null;',
      'if (!superAdmin) {',
      'try {',
      'rol = await rolOkuKati(uid);',
      '} catch (e) {',
      "console.error('[kimlik yüzeyi] rol okunamadı:', (e as Error)?.message || e);",
      'res.status(503).json(ROL_OKUNAMADI_YANITI);',
      'return false;',
      '}',
      '}',
      'const karar = kimlikYuzeyiKarari({ superAdmin, rol, yontem: req.method, hedef: req.originalUrl, uid });',
      'if (karar.gecer) return true;',
      'res.status(403).json(KIMLIK_YUZEYI_RETLERI[karar.kod]);',
      'return false;',
      '}',
    ]);
  });

  it('rolOkuKati: hata yakalamaz (try yok), `getUserRole` ile AYNI önbellek ve AYNI kural', () => {
    const kati = govde(/^async function rolOkuKati\(uid: string\): Promise<AppRole \| null> \{$/);
    const yutan = govde(/^async function getUserRole\(uid: string\): Promise<AppRole \| null> \{$/);
    expect(kati.some(s => /\btry\b|\bcatch\b/.test(s))).toBe(false);
    expect(kati).toContain("if (!adminDb) throw new Error('veritabanı hazır değil');");
    // Ortak satırlar birebir: önbellek okuma, belge okuma, rol çözme, önbelleğe yazma.
    for (const ortak of [
      'const cached = roleCache.get(uid);',
      'if (cached && cached.exp > Date.now()) return cached.role;',
      "const snap = await adminDb.collection('users').doc(uid).get();",
      'const role = (snap.exists ? (snap.data()?.role as AppRole) : null) || null;',
      'if (role) roleCache.set(uid, { role, exp: Date.now() + 60_000 });',
      'return role;',
    ]) { expect(kati, ortak).toContain(ortak); expect(yutan, ortak).toContain(ortak); }
    // Sıkı okuyucunun TEK çağıranı boğazdır (başka yerde kullanılırsa oranın hata yolu da 503 olmalı — bilerek karar verilsin).
    expect(kod.filter(s => /\brolOkuKati\(/.test(s)).map(s => s.trim())).toEqual([
      'rol = await rolOkuKati(uid);',
      'async function rolOkuKati(uid: string): Promise<AppRole | null> {',
    ]);
  });

  it('yöntem tüneli yönlendirmeden ÖNCE ve yalnız PATCH / PUT / DELETE yazar (boğazın gördüğü yöntem Express\'in rotayı seçtiği yöntem)', () => {
    const tunel = kod.findIndex(s => s.includes("const override = req.headers['x-cetpa-method'];"));
    const ilkRota = kod.findIndex(s => /^\s*app\.(get|post|put|patch|delete)\(/.test(s));
    expect(tunel).toBeGreaterThan(-1); expect(ilkRota).toBeGreaterThan(tunel);
    expect(kod[tunel + 1].trim()).toBe("if (req.method === 'POST' && typeof override === 'string') {");
    expect(kod[tunel + 3].trim()).toBe("if (m === 'PATCH' || m === 'PUT' || m === 'DELETE') req.method = m;");
    // Yöntemi yeniden yazan başka yer yok.
    expect(kod.filter(s => /req\.method\s*=[^=]/.test(s))).toHaveLength(1);
  });

  it('izin listesindeki HER (yöntem, yol) gerçek bir rota kaydına karşılık gelir (bayat satır = ölü izin)', () => {
    const dosyalar = [SERVER, ...kaynakDosyalari(join(SRC_KOK, 'server', 'routes'))];
    const metin = dosyalar.map(y => kodSatirlari(y).map(s => s.kod).join('\n')).join('\n');
    const kayitli = (yontem: string, yol: string): boolean =>
      new RegExp(String.raw`app\.${yontem.toLowerCase()}\(\s*['"]${yol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\s*,`).test(metin);
    for (const izin of ROLSUZ_IZINLI_YOLLAR) {
      // Kendi kullanıcı belgesi genel veri yolunun tek belge rotalarından geçer.
      const rota = izin.yol === `/api/db/users/${KENDI_UID}` ? '/api/db/:coll/:id' : izin.yol;
      for (const y of izin.yontemler) expect(kayitli(y, rota), `${y} ${rota}`).toBe(true);
    }
  });
});
