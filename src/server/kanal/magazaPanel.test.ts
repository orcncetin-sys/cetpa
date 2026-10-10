// @vitest-environment node
/**
 * magazaPanel.test.ts — panel oturumu modülleri (dilim 2a, § 3): kullanıcı okuyucu (3.5), iptal çifti (3.6), kod deposu (3.8)
 * ve belirteç (3.4, 3.7). Rota ve kapı testleri `routes/` altındadır; burada modüllerin KENDİ kuralları kilitlenir.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';
import { APP_ROLES } from '../../lib/rbac';
import type { AdminDbLike, AdminDocRef } from '../adminDbTypes';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes';
import { MAGAZA_PANEL_KULLANICI_ONBELLEK_MS, panelAdiTuret, panelKullanicisiKur } from './magazaPanelKullanici';
import { MAGAZA_PANEL_IPTAL_KOLEKSIYONU, MAGAZA_PANEL_IPTAL_ONBELLEK_MS, iptalKur } from './magazaPanelIptal';
import { MAGAZA_PANEL_KOD_OMRU_MS, kodDeposuKur, kodOzetiHesapla, meydanEslesiyor, meydanHesapla, panelKoduUret } from './magazaPanelKod';
import {
  MAGAZA_PANEL_BELIRTEC_EN_UZUN, MAGAZA_PANEL_BELIRTEC_OMRU_MS, MAGAZA_PANEL_DONUS_VARSAYILAN,
  belirtecSuresiIcinde, donusTabaniCoz, panelAnahtariTuret, panelBelirteciCoz, panelBelirteciUret, panelSirriVar,
  type PanelBelirtecYuku,
} from './magazaPanelBelirtec';

const SAAT = new Date('2026-10-09T12:00:00.000Z');

// ── Sahte adminDb: koleksiyon → id → veri; `get` / `set` sayılır, isteğe bağlı fırlatır ────────────────────────────
function sahteDb(ilk: Record<string, Record<string, Record<string, unknown>>> = {}) {
  const veri = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [coll, docs] of Object.entries(ilk)) veri.set(coll, new Map(Object.entries(docs)));
  const okumalar: string[] = [];
  const yazimlar: Array<{ yol: string; veri: Record<string, unknown> }> = [];
  let firlat: Error | null = null;
  const doc = (coll: string, id: string): AdminDocRef => ({
    id,
    async get() {
      okumalar.push(`${coll}/${id}`);
      if (firlat) throw firlat;
      const d = veri.get(coll)?.get(id);
      return { exists: d !== undefined, id, data: () => d };
    },
    async set(v) {
      if (firlat) throw firlat;
      yazimlar.push({ yol: `${coll}/${id}`, veri: v });
      let docs = veri.get(coll);
      if (!docs) { docs = new Map(); veri.set(coll, docs); }
      docs.set(id, v);
      return undefined;
    },
    async update() { throw new Error('kullanılmaz'); },
    async delete() { throw new Error('kullanılmaz'); },
  });
  const db: AdminDbLike = {
    collection: (ad) => ({
      doc: (id) => doc(ad, id ?? 'yeni'),
      add: async () => { throw new Error('kullanılmaz'); },
      where() { return this; }, orderBy() { return this; }, limit() { return this; },
      async get() { return { docs: [], empty: true, size: 0 }; },
    }),
    batch: () => { throw new Error('kullanılmaz'); },
  };
  return { db, okumalar, yazimlar, veri, firlatsin: (e: Error | null) => { firlat = e; } };
}

function sahteHavuz(mfa: Record<string, boolean> = {}, firlat: Error | null = null) {
  const sorgular: Array<{ sql: string; params: unknown[] }> = [];
  const havuz: MagazaPgHavuzu = {
    async query(sql, params = []) {
      sorgular.push({ sql, params });
      if (firlat) throw firlat;
      const uid = String(params[0]);
      return { rows: uid in mfa ? [{ enabled: mfa[uid] }] : [] };
    },
  };
  return { havuz, sorgular };
}

describe('panelKullanicisiKur (§ 3.5)', () => {
  const KULLANICILAR = {
    users: {
      'u-sat': { role: 'Sales', companyId: 'cid-1', name: '  Ayşe\nYılmaz  ', email: 'ayse@example.com' },
      'u-sahip': { role: 'Admin', name: '', email: 'sahip@example.com' },
      'u-rolsuz': { companyId: 'cid-1' },
      'u-kotu': { role: 'Root', companyId: 'cid-1' },
      'u-adsiz': { role: 'Manager', companyId: 'cid-1' },
    },
    companyStatus: { 'cid-1': { status: 'suspended' } },
  };
  it('üç okumayı kendisi yapar: rol, cid (`companyId || uid`), firma durumu (yoksa active), MFA; ad temizlenir', async () => {
    const { db, okumalar } = sahteDb(KULLANICILAR);
    const { havuz, sorgular } = sahteHavuz({ 'u-sat': true });
    const { panelKullanicisi } = panelKullanicisiKur({ adminDb: () => db, pgPool: () => havuz, simdi: () => SAAT });
    expect(await panelKullanicisi('u-sat')).toEqual({ rol: 'Sales', cid: 'cid-1', firmaDurumu: 'suspended', mfaAcik: true, ad: 'Ayşe Yılmaz', eposta: 'ayse@example.com' });
    expect(okumalar).toEqual(['users/u-sat', 'companyStatus/cid-1']);
    expect(sorgular).toEqual([{ sql: 'SELECT enabled FROM mfa_secrets WHERE uid = $1', params: ['u-sat'] }]);
    expect(await panelKullanicisi('u-sahip')).toEqual({ rol: 'Admin', cid: 'u-sahip', firmaDurumu: 'active', mfaAcik: false, ad: 'sahip', eposta: 'sahip@example.com' });
  });
  it('kullanıcı yok / rolsüz / kapalı küme dışı rol → null (önbelleğe YAZILMAZ)', async () => {
    const { db, okumalar } = sahteDb(KULLANICILAR);
    const { panelKullanicisi } = panelKullanicisiKur({ adminDb: () => db, pgPool: () => sahteHavuz().havuz, simdi: () => SAAT });
    for (const uid of ['u-yok', 'u-rolsuz', 'u-kotu']) expect(await panelKullanicisi(uid), uid).toBeNull();
    await panelKullanicisi('u-yok');
    expect(okumalar.filter(o => o === 'users/u-yok')).toHaveLength(2);
  });
  it('önbellek 60 sn (yalnız başarılı dolu okuma); `dusur(uid)` ve `temizle()` düşürür; saat ilerleyince yeniden okunur', async () => {
    let suan = SAAT.getTime();
    const { db, okumalar } = sahteDb(KULLANICILAR);
    const { panelKullanicisi, dusur, temizle } = panelKullanicisiKur({ adminDb: () => db, pgPool: () => sahteHavuz().havuz, simdi: () => new Date(suan) });
    await panelKullanicisi('u-sat'); await panelKullanicisi('u-sat');
    expect(okumalar.filter(o => o === 'users/u-sat')).toHaveLength(1);
    dusur('u-sat'); await panelKullanicisi('u-sat');
    expect(okumalar.filter(o => o === 'users/u-sat')).toHaveLength(2);
    temizle(); await panelKullanicisi('u-sat');
    expect(okumalar.filter(o => o === 'users/u-sat')).toHaveLength(3);
    suan += MAGAZA_PANEL_KULLANICI_ONBELLEK_MS; await panelKullanicisi('u-sat');
    expect(okumalar.filter(o => o === 'users/u-sat')).toHaveLength(4);
    suan += MAGAZA_PANEL_KULLANICI_ONBELLEK_MS - 1; await panelKullanicisi('u-sat');
    expect(okumalar.filter(o => o === 'users/u-sat')).toHaveLength(4);
  });
  it('hatayı YUTMAZ: users / companyStatus / mfa_secrets okuması ya da adminDb / havuz yokluğu FIRLATIR (kapı 503)', async () => {
    const { db, firlatsin } = sahteDb(KULLANICILAR);
    const pg = sahteHavuz({}, Object.assign(new Error('bağlantı koptu'), { code: '57P01' }));
    const okuyucu = panelKullanicisiKur({ adminDb: () => db, pgPool: () => pg.havuz, simdi: () => SAAT });
    await expect(okuyucu.panelKullanicisi('u-sat')).rejects.toThrow('bağlantı koptu');
    firlatsin(new Error('users okunamadı'));
    await expect(panelKullanicisiKur({ adminDb: () => db, pgPool: () => sahteHavuz().havuz }).panelKullanicisi('u-sat')).rejects.toThrow('users okunamadı');
    await expect(panelKullanicisiKur({ adminDb: () => null, pgPool: () => sahteHavuz().havuz }).panelKullanicisi('u-sat')).rejects.toThrow();
    await expect(panelKullanicisiKur({ adminDb: () => sahteDb(KULLANICILAR).db, pgPool: () => null }).panelKullanicisi('u-sat')).rejects.toThrow();
  });
  it('`panelAdiTuret`: 1.000 birimlik ad 80\'e kırpılır; boş ad → e-posta öneki; o da yoksa uid', () => {
    expect(panelAdiTuret('ğ'.repeat(1000), 'a@b', 'u').length).toBe(80);
    expect(panelAdiTuret('', 'ayse@example.com', 'u')).toBe('ayse');
    expect(panelAdiTuret(7, undefined, 'u-123')).toBe('u-123');
    expect(panelAdiTuret('A\u0000B\r\nC', '', 'u')).toBe('AB C');
  });
  it('kaynak çiti: gövdede `getUserRole` / `getUserCompanyId` / `getCompanyStatus` / `userHasMfa` / `roleCache` adı geçmez; `catch` ile yutma yok', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaPanelKullanici.ts')).map(s => s.kod).join('\n');
    expect(kod).not.toMatch(/getUserRole|getUserCompanyId|getCompanyStatus|userHasMfa|roleCache|companyIdCache|companyStatusCache|mfaStatusCache|catch\b/);
    expect(kod).toContain("SELECT enabled FROM mfa_secrets WHERE uid = $1");
  });
});

describe('iptalKur (§ 3.6, V8)', () => {
  it('hiç iptal yok → 0; `iptalEt` tek upsert `{ gecersizOnce: ISO, companyId }`; sonra `gecersizOnce` = şimdi; değer yalnız İLERİ gider', async () => {
    let suan = SAAT.getTime();
    const { db, yazimlar } = sahteDb();
    const iptal = iptalKur({ adminDb: () => db, simdi: () => new Date(suan) });
    expect(await iptal.gecersizOnce('u')).toBe(0);
    await iptal.iptalEt('u', 'cid-1');
    expect(yazimlar).toEqual([{ yol: `${MAGAZA_PANEL_IPTAL_KOLEKSIYONU}/u`, veri: { gecersizOnce: SAAT.toISOString(), companyId: 'cid-1' } }]);
    expect(await iptal.gecersizOnce('u')).toBe(SAAT.getTime());
    suan += 1000;
    await iptal.iptalEt('u');
    expect(yazimlar[1].veri).toEqual({ gecersizOnce: new Date(suan).toISOString() });
    expect(await iptal.gecersizOnce('u')).toBe(suan);
    expect(MAGAZA_PANEL_IPTAL_KOLEKSIYONU).toBe('magazaPanelIptal');
  });
  it('veritabanındaki değer okunur ve süreç içi değerle BÜYÜĞÜ geçerlidir; 60 sn önbellek; okuma hatası FIRLATIR (kapı 503)', async () => {
    let suan = SAAT.getTime();
    const dbMs = SAAT.getTime() - 5 * 60_000;
    const { db, okumalar, firlatsin } = sahteDb({ [MAGAZA_PANEL_IPTAL_KOLEKSIYONU]: { u: { gecersizOnce: new Date(dbMs).toISOString() } } });
    const iptal = iptalKur({ adminDb: () => db, simdi: () => new Date(suan) });
    expect(await iptal.gecersizOnce('u')).toBe(dbMs);
    await iptal.gecersizOnce('u');
    expect(okumalar).toHaveLength(1);
    suan += MAGAZA_PANEL_IPTAL_ONBELLEK_MS;
    await iptal.gecersizOnce('u');
    expect(okumalar).toHaveLength(2);
    firlatsin(new Error('okuma hatası'));
    suan += MAGAZA_PANEL_IPTAL_ONBELLEK_MS;
    await expect(iptal.gecersizOnce('u')).rejects.toThrow('okuma hatası');
    // çöp değer → 0
    firlatsin(null);
    const { db: db2 } = sahteDb({ [MAGAZA_PANEL_IPTAL_KOLEKSIYONU]: { u: { gecersizOnce: 'bozuk' } } });
    expect(await iptalKur({ adminDb: () => db2 }).gecersizOnce('u')).toBe(0);
  });
  it('yazım başarısızsa FIRLATIR ama süreç içi değer «şimdi» KALIR (aynı süreçte belirteç hemen ve 61. sn de düşer); yeniden kurulum (yeniden başlatma provası) veritabanından okur', async () => {
    let suan = SAAT.getTime();
    const { db, firlatsin, veri } = sahteDb();
    const iptal = iptalKur({ adminDb: () => db, simdi: () => new Date(suan) });
    firlatsin(new Error('yazılamadı'));
    await expect(iptal.iptalEt('u', 'cid-1')).rejects.toThrow('yazılamadı');
    firlatsin(null);
    expect(await iptal.gecersizOnce('u')).toBe(SAAT.getTime());
    suan += 61_000;
    expect(await iptal.gecersizOnce('u')).toBe(SAAT.getTime());
    // başarılı yazım sonrası yeni örnek (süreç yeniden başladı) DB'den okur
    await iptal.iptalEt('u', 'cid-1');
    expect(veri.get(MAGAZA_PANEL_IPTAL_KOLEKSIYONU)?.get('u')?.gecersizOnce).toBe(new Date(suan).toISOString());
    expect(await iptalKur({ adminDb: () => db, simdi: () => new Date(suan + 1) }).gecersizOnce('u')).toBe(suan);
    await expect(iptalKur({ adminDb: () => null }).gecersizOnce('u')).rejects.toThrow();
  });
});

describe('kodDeposuKur + meydan (§ 3.1, 3.3, 3.8)', () => {
  const kayit = (uid: string, kod: string, bitis = SAAT.getTime() + MAGAZA_PANEL_KOD_OMRU_MS) =>
    ({ kodOzeti: kodOzetiHesapla(kod), meydan: 'm', uid, cid: 'c', ad: 'A', eposta: 'a@b', mfa: false, bitis });
  it('`al` eşzamanlı siler ve döndürür: ikinci `al` undefined; kullanıcı başına tek canlı kod (yeni kod öncekini siler)', () => {
    const depo = kodDeposuKur({ simdi: () => SAAT });
    depo.ver(kayit('u1', 'k1'));
    depo.ver(kayit('u1', 'k2'));
    expect(depo.boyut()).toBe(1);
    expect(depo.al(kodOzetiHesapla('k1'))).toBeUndefined();
    expect(depo.al(kodOzetiHesapla('k2'))?.uid).toBe('u1');
    expect(depo.al(kodOzetiHesapla('k2'))).toBeUndefined();
    expect(depo.boyut()).toBe(0);
  });
  it('A\'nın 50 isteği B\'nin canlı kodunu DÜŞÜRMEZ; süresi dolanlar yazımda süpürülür; «en eski düşer» YOK', () => {
    let suan = SAAT.getTime();
    const depo = kodDeposuKur({ simdi: () => new Date(suan) });
    depo.ver(kayit('B', 'kb'));
    for (let i = 0; i < 50; i++) depo.ver(kayit('A', `ka${i}`));
    expect(depo.boyut()).toBe(2);
    expect(depo.al(kodOzetiHesapla('kb'))?.uid).toBe('B');
    depo.ver(kayit('C', 'kc', suan + 1000));
    suan += 1000;
    depo.ver(kayit('D', 'kd', suan + 60_000));
    expect(depo.al(kodOzetiHesapla('kc'))).toBeUndefined();   // süresi doldu, süpürüldü
    expect(depo.al(kodOzetiHesapla('kd'))?.uid).toBe('D');
    expect(MAGAZA_PANEL_KOD_OMRU_MS).toBe(60_000);
  });
  it('kod 43 karakter base64url ve her çağrıda farklı; özet sha256 onaltılık; meydan = base64url(sha256(METİN)) — ham bayt DEĞİL', () => {
    const k1 = panelKoduUret(), k2 = panelKoduUret();
    expect(k1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(k1).not.toBe(k2);
    expect(kodOzetiHesapla('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
    const dogrulayici = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(meydanHesapla(dogrulayici)).toBe(createHash('sha256').update(dogrulayici, 'utf8').digest('base64url'));
    expect(meydanHesapla(dogrulayici)).toHaveLength(43);
    expect(meydanHesapla(dogrulayici)).not.toBe(createHash('sha256').update(Buffer.from(dogrulayici, 'base64url')).digest('base64url'));
    expect(meydanEslesiyor(dogrulayici, meydanHesapla(dogrulayici))).toBe(true);
    expect(meydanEslesiyor(dogrulayici, meydanHesapla(dogrulayici) + 'x')).toBe(false);   // uzunluk farkı fırlatmaz
    expect(meydanEslesiyor('A'.repeat(43), meydanHesapla(dogrulayici))).toBe(false);
  });
});

describe('belirteç (§ 3.4) ve anahtar / dönüş adresi (§ 3.7)', () => {
  const ANAHTAR = createHash('sha256').update('test-anahtari').digest();
  const yuk = (ek: Partial<PanelBelirtecYuku> = {}): PanelBelirtecYuku =>
    ({ uid: 'u', cid: 'c', rol: 'Sales', ad: 'Ayşe', eposta: 'a@b', mfa: true, bas: SAAT.getTime(), bitis: SAAT.getTime() + MAGAZA_PANEL_BELIRTEC_OMRU_MS, ...ek });

  it('`mp1-<yük>.<imza>` İKİ parça — JWT biçimine (üç parça) UYMAZ; çözüm yükü aynen verir', () => {
    const b = panelBelirteciUret(ANAHTAR, yuk());
    expect(b).toMatch(/^mp1-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(b)).toBe(false);
    expect(panelBelirteciCoz(ANAHTAR, b)).toEqual(yuk());
    expect(MAGAZA_PANEL_BELIRTEC_OMRU_MS).toBe(8 * 60 * 60 * 1000);
  });
  it('bozuk imza / çok baytlı imza / 2.048\'den uzun / yanlış önek / parça sayısı / bozuk JSON / alan türü → null (500 DEĞİL)', () => {
    const b = panelBelirteciUret(ANAHTAR, yuk());
    const [govde, imza] = b.split('.');
    expect(panelBelirteciCoz(ANAHTAR, `${govde}.${imza.slice(0, -2)}xx`)).toBeNull();
    expect(panelBelirteciCoz(ANAHTAR, `${govde}.${imza}é`)).toBeNull();
    expect(panelBelirteciCoz(ANAHTAR, `${govde}.${imza.slice(0, 10)}`)).toBeNull();
    expect(panelBelirteciCoz(ANAHTAR, 'mp1-' + 'A'.repeat(MAGAZA_PANEL_BELIRTEC_EN_UZUN) + '.B')).toBeNull();
    expect(panelBelirteciCoz(ANAHTAR, b.replace('mp1-', 'mp2-'))).toBeNull();
    expect(panelBelirteciCoz(ANAHTAR, `${b}.ekstra`)).toBeNull();
    expect(panelBelirteciCoz(ANAHTAR, govde)).toBeNull();
    for (const v of ['', 7, null, undefined, {}, 'mp1-', 'mp1-.', 'mp1-a.']) expect(panelBelirteciCoz(ANAHTAR, v), String(v)).toBeNull();
    // imzası doğru ama yükü bozuk JSON / alan türü yanlış / fazla alan
    const imzali = (yukMetni: string) => `mp1-${yukMetni}.${createHash('sha256').digest().toString('base64url')}`;
    expect(panelBelirteciCoz(ANAHTAR, imzali(Buffer.from('{bozuk').toString('base64url')))).toBeNull();
    const kotu = [{ ...yuk(), rol: 'Root' }, { ...yuk(), bas: '1' }, { ...yuk(), mfa: 'evet' }, { ...yuk(), ek: 1 }, { ...yuk(), ad: 'x'.repeat(81) }, { ...yuk(), uid: '' }];
    for (const k of kotu) {
      const uretilen = panelBelirteciUret(ANAHTAR, k as PanelBelirtecYuku);
      expect(panelBelirteciCoz(ANAHTAR, uretilen), JSON.stringify(k)).toBeNull();
    }
    expect(APP_ROLES).toContain('Sales');
  });
  it('başka anahtarla imzalanmış belirteç null; oturum çerezi belirteç yerine geçmez', () => {
    const b = panelBelirteciUret(ANAHTAR, yuk());
    expect(panelBelirteciCoz(createHash('sha256').update('baska').digest(), b)).toBeNull();
    const cerez = `${Buffer.from('u|1').toString('base64url')}.${'A'.repeat(43)}`;
    expect(panelBelirteciCoz(ANAHTAR, cerez)).toBeNull();
  });
  it('süre: `bas ≤ şimdi < bitis`; 8 sa + 1 ms sonra ve gelecekte başlayan geçersiz', () => {
    const y = yuk();
    expect(belirtecSuresiIcinde(y, SAAT.getTime())).toBe(true);
    expect(belirtecSuresiIcinde(y, SAAT.getTime() + MAGAZA_PANEL_BELIRTEC_OMRU_MS - 1)).toBe(true);
    expect(belirtecSuresiIcinde(y, SAAT.getTime() + MAGAZA_PANEL_BELIRTEC_OMRU_MS)).toBe(false);
    expect(belirtecSuresiIcinde(y, SAAT.getTime() + MAGAZA_PANEL_BELIRTEC_OMRU_MS + 1)).toBe(false);
    expect(belirtecSuresiIcinde(y, SAAT.getTime() - 1)).toBe(false);
  });
  it('anahtar: iki sır da boş / tanımsız → null (`!x` ölçütü); dönüş adresi null → null; farklı APP_URL ya da dönüş adresi FARKLI anahtar', () => {
    expect(panelSirriVar({})).toBe(false);
    expect(panelSirriVar({ SESSION_TOKEN_SECRET: '', FIREBASE_PRIVATE_KEY: '' })).toBe(false);
    expect(panelSirriVar({ SESSION_TOKEN_SECRET: 's' })).toBe(true);
    expect(panelSirriVar({ FIREBASE_PRIVATE_KEY: 'k' })).toBe(true);
    const taban = { sirVar: true, oturumSirri: 'gizli', donusTabani: 'https://www.cetpa.com.tr/panel.html', appUrl: 'https://app.cetpa.com.tr' };
    expect(panelAnahtariTuret({ ...taban, sirVar: false })).toBeNull();
    expect(panelAnahtariTuret({ ...taban, donusTabani: null })).toBeNull();
    /** Dolu girdi sınıfında anahtar hep Buffer'dır; null gelirse test burada düşer (gizli `!` yok). */
    const anahtar = (ek: Partial<Parameters<typeof panelAnahtariTuret>[0]> = {}): Buffer => {
      const a = panelAnahtariTuret({ ...taban, ...ek });
      if (a === null) throw new Error('anahtar beklenirken null');
      return a;
    };
    const a = anahtar();
    expect(a.length).toBe(32);
    expect(a.equals(anahtar({ appUrl: 'https://staging.cetpa.com.tr' }))).toBe(false);
    expect(a.equals(anahtar({ donusTabani: 'https://www.cetpa.com.tr/p.html' }))).toBe(false);
    expect(a.equals(anahtar({ appUrl: undefined }))).toBe(false);
    expect(a.equals(anahtar())).toBe(true);
    // oturum çerezinin anahtarı (sırrın kendisi) panel anahtarı DEĞİLDİR
    expect(a.equals(Buffer.from('gizli'))).toBe(false);
    const b = panelBelirteciUret(a, yuk());
    expect(panelBelirteciCoz(anahtar({ appUrl: 'https://x' }), b)).toBeNull();
  });
  it('dönüş adresi: varsayılan; https zorunlu (üretim dışında http://localhost / 127.0.0.1); kullanıcı adı / sorgu / parça yok; köken listede; kurallı `origin + pathname`', () => {
    const izinli = ['https://www.cetpa.com.tr', 'http://localhost:5601'];
    expect(donusTabaniCoz(undefined, { uretim: true, izinliKokenler: izinli })).toBe(MAGAZA_PANEL_DONUS_VARSAYILAN);
    expect(donusTabaniCoz('', { uretim: true, izinliKokenler: izinli })).toBe(MAGAZA_PANEL_DONUS_VARSAYILAN);
    expect(donusTabaniCoz('https://www.cetpa.com.tr/panel.html#', { uretim: true, izinliKokenler: izinli })).toBe('https://www.cetpa.com.tr/panel.html');
    expect(donusTabaniCoz('https://www.cetpa.com.tr/panel.html?', { uretim: true, izinliKokenler: izinli })).toBe('https://www.cetpa.com.tr/panel.html');
    expect(donusTabaniCoz('https://www.cetpa.com.tr/panel.html#x', { uretim: true, izinliKokenler: izinli })).toBeNull();
    expect(donusTabaniCoz('https://www.cetpa.com.tr/panel.html?a=1', { uretim: true, izinliKokenler: izinli })).toBeNull();
    expect(donusTabaniCoz('https://u:p@www.cetpa.com.tr/panel.html', { uretim: true, izinliKokenler: izinli })).toBeNull();
    expect(donusTabaniCoz('https://baska.example/panel.html', { uretim: true, izinliKokenler: izinli })).toBeNull();
    expect(donusTabaniCoz('http://www.cetpa.com.tr/panel.html', { uretim: true, izinliKokenler: ['http://www.cetpa.com.tr'] })).toBeNull();
    expect(donusTabaniCoz('http://localhost:5601/panel.html', { uretim: true, izinliKokenler: izinli })).toBeNull();
    expect(donusTabaniCoz('http://localhost:5601/panel.html', { uretim: false, izinliKokenler: izinli })).toBe('http://localhost:5601/panel.html');
    expect(donusTabaniCoz('http://127.0.0.1:5601/panel.html', { uretim: false, izinliKokenler: ['http://127.0.0.1:5601'] })).toBe('http://127.0.0.1:5601/panel.html');
    expect(donusTabaniCoz('http://evil.local/panel.html', { uretim: false, izinliKokenler: ['http://evil.local'] })).toBeNull();
    expect(donusTabaniCoz('bozuk url', { uretim: true, izinliKokenler: izinli })).toBeNull();
    // listenin sırası değişince sonuç değişmez
    expect(donusTabaniCoz(undefined, { uretim: true, izinliKokenler: [...izinli].reverse() })).toBe(MAGAZA_PANEL_DONUS_VARSAYILAN);
  });
  it('kaynak çiti: belirteç modülü pgShim / server.ts / Firebase içe aktarmaz; `as any` / `@ts-ignore` yok', () => {
    for (const d of ['magazaPanelBelirtec', 'magazaPanelKod', 'magazaPanelIptal', 'magazaPanelKullanici']) {
      const kod = kodSatirlari(join(SRC_KOK, 'server', 'kanal', `${d}.ts`)).map(s => s.kod).join('\n');
      expect(kod, d).not.toMatch(/pgShim|from '\.\.\/\.\.\/\.\.\/server|firebase|as any|@ts-ignore|@ts-expect-error/);
    }
    vi.restoreAllMocks();
  });
});
