/**
 * rolCozumu.test.ts — oturum açılışında rolün çözümünün SAF parçaları (şartname «kayıt kapanışı ve kuruş» R1′, R2, R2′, R4) ve
 * `dbClient`'in ret sınıfı (`DbIstekHatasi`) + `getDoc`'un «kayıt yok» kararı (durum koduyla). Uygulama düzeyi davranış (kabuk, veri,
 * yeniden deneme zamanlaması, tur numarası): `src/components/DisRolEkrani.uygulama.test.tsx` «R —» bölümleri.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({
  db: {}, storage: {},
  auth: { currentUser: { uid: 'uid-404-deneme', getIdToken: async () => 'belirtec' }, onAuthStateChanged: () => () => {} },
}));

import { DbIstekHatasi, doc, getDoc } from './dbClient';
import { ROL_YENIDEN_DENEME_MS, profilHatasiSinifi, veriOturumuSec, type RolDurumu } from './rolCozumu';
import { mfaGerekliMetni, silmeHataMetni } from '../utils/siparisler/siparisIslemleri';

const hata = (durum: number, govde: unknown) => new DbIstekHatasi(`dbClient GET /users/x → ${durum} ${JSON.stringify(govde)}`, durum, govde);

describe('profilHatasiSinifi — R2: doğrulama YALNIZ 403 + `mfaRequired: true`; diğer her ret yeniden denenir', () => {
  it('403 + `mfaRequired: true` → doğrulama', () => {
    expect(profilHatasiSinifi(hata(403, { error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true }))).toEqual({ tur: 'dogrulama', durum: 403 });
  });

  it.each([
    ['401', 401, { error: 'Invalid or expired session.' }],
    ['403 KAYIT_YOK', 403, { error: 'Kayıt yok', code: 'KAYIT_YOK' }],
    ['403 askıdaki firma', 403, { error: 'Askıda', code: 'COMPANY_SUSPENDED' }],
    ['403 `mfaRequired` dize (gerçek değil)', 403, { mfaRequired: 'true' }],
    ['403 gövde düz metin (iletide «mfaRequired» geçse de)', 403, 'mfaRequired'],
    ['429', 429, { error: 'Çok fazla istek.' }],
    ['500 `mfaRequired: true` (403 değil)', 500, { mfaRequired: true }],
    ['503 ROL_OKUNAMADI', 503, { code: 'ROL_OKUNAMADI' }],
  ])('%s → yeniden (durum kodu taşınır)', (_ad, durum, govde) => {
    expect(profilHatasiSinifi(hata(durum, govde))).toEqual({ tur: 'yeniden', durum });
  });

  it('sunucu reddi OLMAYAN her hata (ağ, belirteç alınamadı, beklenmeyen istisna) → yeniden, durum `ağ`', () => {
    for (const e of [new TypeError('Failed to fetch'), new Error('dbClient: not authenticated'), new Error('dbClient GET /users/x → 403 {"mfaRequired":true}'), null, undefined, 'metin']) {
      expect(profilHatasiSinifi(e)).toEqual({ tur: 'yeniden', durum: 'ağ' });
    }
  });
});

describe('veriOturumuSec — R1′: veri kapısı yalnız `cozuldu` ve rolü olan hesapta açık', () => {
  const kullanici = { uid: 'u1' };
  it.each<[RolDurumu, boolean, boolean]>([
    ['cozuldu', false, true],
    ['cozuldu', true, false],    // «rol atanmamış» hesap: ekran kabuğun üstünde, veri YOK
    ['bekliyor', false, false],
    ['dogrulama', false, false],
    ['okunamadi', false, false],
  ])('%s, rol yok=%s → açık=%s', (durum, rolYok, acik) => {
    expect(veriOturumuSec(kullanici, durum, rolYok)).toBe(acik ? kullanici : null);
  });
  it('oturum yoksa her durumda `null`', () => {
    expect(veriOturumuSec(null, 'cozuldu', false)).toBeNull();
  });
});

describe('ROL_YENIDEN_DENEME_MS — en çok ÜÇ kendiliğinden deneme, artan bekleme', () => {
  it('1 / 3 / 9 sn; dondurulmuş', () => {
    expect(ROL_YENIDEN_DENEME_MS).toEqual([1_000, 3_000, 9_000]);
    expect(Object.isFrozen(ROL_YENIDEN_DENEME_MS)).toBe(true);
  });
});

describe('DbIstekHatasi + getDoc — R2 / R2′', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const yanit = (durum: number, govde: unknown) => new Response(typeof govde === 'string' ? govde : JSON.stringify(govde), { status: durum });

  it('ileti metni ESKİSİYLE AYNI ve `String(e)` öneki değişmedi; durum + ayrıştırılmış gövde taşınır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => yanit(403, { error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true })));
    const e = await getDoc(doc({}, 'users', 'uid-1')).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DbIstekHatasi);
    if (!(e instanceof DbIstekHatasi)) return;
    expect(e.message).toBe('dbClient GET /users/uid-1 → 403 {"error":"İki faktörlü doğrulama gerekli.","mfaRequired":true}');
    expect(String(e).startsWith('Error: dbClient GET /users/uid-1 → 403 ')).toBe(true);
    expect([e.status, e.govde]).toEqual([403, { error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true }]);
    // İletiyi ayrıştıran mevcut okuyucu (sipariş silme: `\b403\b` + `mfaRequired`) bozulmadı.
    expect(silmeHataMetni(e, 'tr')).toBe(mfaGerekliMetni('tr'));
  });

  it('düz metin gövde metin olarak, boş gövde `null` olarak taşınır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => yanit(502, '<html>Bad Gateway</html>')));
    const e1 = await getDoc(doc({}, 'users', 'uid-1')).catch((x: unknown) => x);
    expect(e1 instanceof DbIstekHatasi && [e1.status, e1.govde]).toEqual([502, '<html>Bad Gateway</html>']);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    const e2 = await getDoc(doc({}, 'users', 'uid-1')).catch((x: unknown) => x);
    expect(e2 instanceof DbIstekHatasi && [e2.status, e2.govde]).toEqual([500, null]);
  });

  it('«kayıt yok» = durum kodu 404 → `exists()` false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => yanit(404, { error: 'Not found.' })));
    const snap = await getDoc(doc({}, 'users', 'uid-1'));
    expect(snap.exists()).toBe(false);
  });

  it('uid\'si ya da gövdesi «404» içeren 500 / 403 «kayıt yok» SAYILMAZ: fırlar (eskiden ileti alt dizisiyle `exists() === false`)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => yanit(500, { error: 'Sunucu hatası' })));
    const e1 = await getDoc(doc({}, 'users', 'uid-404-deneme')).catch((x: unknown) => x);
    expect(e1 instanceof DbIstekHatasi && e1.status).toBe(500);
    expect(String(e1)).toContain('404');   // ileti alt dizisi «404» içeriyor — karar ona BAKMIYOR
    vi.stubGlobal('fetch', vi.fn(async () => yanit(403, { error: 'Hata kodu 404 değil', mfaRequired: true })));
    const e2 = await getDoc(doc({}, 'users', 'uid-1')).catch((x: unknown) => x);
    expect(e2 instanceof DbIstekHatasi && e2.status).toBe(403);
  });
});
