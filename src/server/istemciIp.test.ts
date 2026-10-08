/** istemciIp.test.ts — hız sınırı anahtarının saf çekirdeği (2026-10-08): kapı ayıklama, iki anahtar, kimlik çözümü, tek sayım. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  istemciIpCoz, temizIstemciIp, ipAnahtari, yetkiBelirteci, sinirKimligi, ipSinirAnahtari, kullaniciSinirAnahtari, kimligeGoreTavan,
  apiSinirindanMuaf, istekBasinaBirKez, akisIstegiIsaretle, akisSorguBelirteci, type SinirBagimliliklari, type SinirIstegi,
} from './istemciIp';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('istemciIpCoz — vekilin yazdığı adresten KAPI ayıklanır', () => {
  it.each([
    ['85.105.1.2:51234', '85.105.1.2'], ['85.105.1.2', '85.105.1.2'], [' 85.105.1.2:1 ', '85.105.1.2'], ['\t85.105.1.2:1', '85.105.1.2'],
    ['[2a02:ff0:1::5]:4444', '2a02:ff0:1::5'], ['[2a02:ff0:1::5]', '2a02:ff0:1::5'], ['2a02:ff0:1::5', '2a02:ff0:1::5'],
    ['2a02:ff0:1::5:51234', '2a02:ff0:1::5'],                                     // köşeli parantezsiz + 5 haneli kapı
    ['::ffff:85.105.1.2', '::ffff:85.105.1.2'], ['::ffff:85.105.1.2:5555', '::ffff:85.105.1.2'], ['[::ffff:1.2.3.4]:80', '::ffff:1.2.3.4'],
    ['127.0.0.1', '127.0.0.1'], ['::1', '::1'],
  ])('%s → %s', (ham, ip) => {
    expect(istemciIpCoz(ham)).toEqual({ tur: 'ip', ip });
    expect(temizIstemciIp(ham)).toBe(ip);
  });
  it.each(['sahte', 'unknown', '999.1.1.1:80', '203.0.113.7:', '1.2.3.4:abc', '[cop]:80', '1.2.3:80', '85.105.1.2:51234:1', '1.2.3.4:123456'])('çözülemez: %s → ham (IP uydurulmaz)', ham => {
    expect(istemciIpCoz(ham)).toEqual({ tur: 'ham', ham });
    expect(temizIstemciIp(ham)).toBeNull();
  });
  it.each([undefined, null, '', '   ', 5, {}])('değer yok: %s', ham => {
    expect(istemciIpCoz(ham)).toEqual({ tur: 'yok' });
    expect(temizIstemciIp(ham)).toBeNull();
  });
});

describe('ipAnahtari — kova anahtarı', () => {
  it('ASIL HATA: aynı IPv4, farklı kapılar → AYNI anahtar (eskiden her kapı ayrı kovaydı)', () => {
    expect(ipAnahtari('85.105.1.2:51234')).toBe('ip:85.105.1.2');
    expect(ipAnahtari('85.105.1.2:60001')).toBe('ip:85.105.1.2');
    expect(ipAnahtari('85.105.1.2')).toBe('ip:85.105.1.2');
    expect(ipAnahtari('85.105.1.3:51234')).toBe('ip:85.105.1.3');
  });
  it('IPv6 /56 ağ önekiyle; v4-eşlemli IPv6 → IPv4 (köşeli parantezli ve kapılı biçimlerde de)', () => {
    expect(ipAnahtari('[2a02:ff0:1:aa00::5]:4444')).toBe(ipAnahtari('2a02:ff0:1:aaff::9'));
    expect(ipAnahtari('[2a02:ff0:1:aa00::5]:4444')).not.toBe(ipAnahtari('2a02:ff0:1:ab00::5'));
    expect(ipAnahtari('::ffff:85.105.1.2:5555')).toBe('ip:85.105.1.2');
    expect(ipAnahtari('[::ffff:85.105.1.2]:80')).toBe('ip:85.105.1.2');
  });
  it('çözülemeyen değer: değere ÖZGÜ, SABİT boyda özet — tek ortak kova değil, değerin kendisi de değil', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = ipAnahtari('sahte'), b = ipAnahtari('sahte2'), dev = ipAnahtari('x'.repeat(8000));
    expect(a).toMatch(/^ham:[0-9a-f]{16}$/);
    expect(b).toMatch(/^ham:[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(ipAnahtari('sahte')).toBe(a);
    expect(dev).toHaveLength(20);                                              // 8 KB değer 8 KB anahtar olmaz
    expect(dev).not.toContain('xxxx');
    expect(ipAnahtari(undefined)).toBe('ham:yok');
    expect(ipAnahtari('')).toBe('ham:yok');
  });
  it('çözülemeyen adres uyarısı süreç başına BİR kez basılır (her istekte basarsa günlük seli — 2026-07-31 disk dolması sınıfı)', async () => {
    vi.resetModules();
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const taze = await import('./istemciIp');
    taze.ipAnahtari('sahte'); taze.ipAnahtari('sahte'); taze.ipAnahtari('baska-sahte');
    expect(uyari).toHaveBeenCalledTimes(1);
    expect(String(uyari.mock.calls[0][0])).not.toContain('sahte');                 // değerin kendisi günlüğe yazılmaz
  });
  it('BİLİNEN SINIR (sabitlenir, onaylanmaz): köşesiz v6 + 4 haneli kapı ve noktalı sonlu v6 — AAAA açılmadan önce ARR ölçülmeli', () => {
    // Kapı 5 haneliyken doğru /56; 4 haneliyken dizge kendisi geçerli IPv6 → önek kayar. Bugün erişilemez (IPv6 yolu yok).
    expect(ipAnahtari('2a02:ff0::1234:5678:9abc:def0:54321')).toBe('ip:2a02:ff0::/56');
    expect(ipAnahtari('2a02:ff0::1234:5678:9abc:def0:8080')).toBe('ip:2a02:ff0:0:1200::/56');
    // Son 32 biti noktalı yazılmış IPv6'yı kitaplık IPv4 kovasına indirger.
    expect(ipAnahtari('[2a02:ff0:1:2:0:5efe:85.105.1.2]:50000')).toBe('ip:85.105.1.2');
  });
});

describe('yetkiBelirteci — requireAuth ile AYNI ayıklama', () => {
  it('"Bearer " öneki atılır; ÖNEKSİZ belirteç de belirteçtir (kimlik kapısı öyle kabul ediyor); metin değilse boş', () => {
    expect(yetkiBelirteci('Bearer a.b.c')).toBe('a.b.c');
    expect(yetkiBelirteci('Bearer   a.b.c')).toBe('a.b.c');
    expect(yetkiBelirteci('a.b.c')).toBe('a.b.c');
    expect(yetkiBelirteci(undefined)).toBe('');
    expect(yetkiBelirteci(['Bearer a.b.c'])).toBe('');
  });
});

const dep = (ek: Partial<SinirBagimliliklari> = {}): SinirBagimliliklari => ({
  belirtecDogrula: vi.fn(async (t: string) => (t === 'a.b.gecerliA' ? 'kullaniciA' : t === 'a.b.gecerliB' ? 'kullaniciB' : null)),
  cerezdenUid: vi.fn((c: string) => (c.includes('oturum=imzaliA') ? 'kullaniciA' : null)),
  ...ek,
});
const istek = (ek: Partial<SinirIstegi> = {}): SinirIstegi => ({ ip: '85.105.1.2:5000', method: 'POST', originalUrl: '/api/x', headers: {}, ...ek });
/** Akış rotasının zincirinden geçmiş istek (Express eşleştirdi → `akisIstegiIsaretle` çalıştı). */
const akisIstegi = (ek: Partial<SinirIstegi> = {}): SinirIstegi => {
  const q = istek({ method: 'GET', originalUrl: '/api/db/stream?colls=orders', ...ek });
  akisIstegiIsaretle(q, undefined, () => {});
  return q;
};

describe('sinirKimligi — yalnız DOĞRULANMIŞ kimlik', () => {
  it('geçerli belirteç → uid; öneksiz yazım da; sahte / biçimsiz / boş → null (doğrulayıcıya biçimsiz dizge gitmez)', async () => {
    const d = dep();
    expect(await sinirKimligi(istek({ headers: { authorization: 'Bearer a.b.gecerliA' } }), d)).toBe('kullaniciA');
    expect(await sinirKimligi(istek({ headers: { authorization: 'a.b.gecerliB' } }), d)).toBe('kullaniciB');
    expect(await sinirKimligi(istek({ headers: { authorization: 'Bearer x.y.sahte' } }), d)).toBeNull();
    expect(d.belirtecDogrula).toHaveBeenCalledTimes(3);
    expect(await sinirKimligi(istek({ headers: { authorization: 'Bearer biçimsiz' } }), d)).toBeNull();
    expect(await sinirKimligi(istek({ headers: { authorization: `Bearer ${'a'.repeat(9000)}.b.c` } }), d)).toBeNull();
    expect(await sinirKimligi(istek(), d)).toBeNull();
    expect(d.belirtecDogrula).toHaveBeenCalledTimes(3);
  });
  it('`requireAuth` uid yazdıysa o kullanılır, doğrulayıcı hiç çağrılmaz', async () => {
    const d = dep();
    expect(await sinirKimligi(istek({ uid: 'kapidanGelen', headers: { authorization: 'Bearer a.b.gecerliA' } }), d)).toBe('kapidanGelen');
    expect(d.belirtecDogrula).not.toHaveBeenCalled();
  });
  it('istek başına BİR KEZ doğrulanır (aynı isteğe iki sınırlayıcı) — söz paylaşılır', async () => {
    const d = dep();
    const q = istek({ headers: { authorization: 'Bearer a.b.gecerliA' } });
    const [x, y] = await Promise.all([sinirKimligi(q, d), sinirKimligi(q, d)]);
    expect([x, y, await sinirKimligi(q, d)]).toEqual(['kullaniciA', 'kullaniciA', 'kullaniciA']);
    expect(d.belirtecDogrula).toHaveBeenCalledTimes(1);
  });
  it('oturum çerezi YALNIZ akış rotasının İŞARETLEDİĞİ istekte kimliktir — yol / yöntem metnine bakılmaz', async () => {
    const d = dep();
    const cerez = { cookie: 'a=1; oturum=imzaliA' };
    expect(await sinirKimligi(akisIstegi({ headers: cerez }), d)).toBe('kullaniciA');
    // İşaretsiz istek: yolu akış ucuna BENZESE de çerez kimlik değildir (401 alacak istek kurbanın kovasını tüketemesin).
    expect(await sinirKimligi(istek({ method: 'GET', originalUrl: '/api/db/stream?colls=orders', headers: cerez }), d)).toBeNull();
    expect(await sinirKimligi(istek({ method: 'POST', originalUrl: '/api/db/orders', headers: cerez }), d)).toBeNull();
    expect(d.cerezdenUid).toHaveBeenCalledTimes(1);
    // İşaretli istek: Express hangi yazımı işleyiciye götürdüyse (HEAD, büyük harf, eğik çizgi, mutlak biçim …) çerez tanınır.
    for (const [method, originalUrl] of [['HEAD', '/api/db/stream'], ['GET', '/API/DB/STREAM/'], ['GET', '/api\\db\\stream#x'], ['GET', 'http://x/api/db/stream']])
      expect(await sinirKimligi(akisIstegi({ method, originalUrl, headers: cerez }), dep()), `${method} ${originalUrl}`).toBe('kullaniciA');
  });
  it('akış ucunun geriye uyum kimliği `?token=`: işleyiciyle AYNI ayıklayıcı (`akisSorguBelirteci`), Authorization başlığı o uçta OKUNMAZ', async () => {
    const d = dep();
    expect(await sinirKimligi(akisIstegi({ query: { colls: 'orders', token: 'a.b.gecerliA' } }), d)).toBe('kullaniciA');
    // Geçerli çerez varken sorgu belirteci okunmaz (işleyicideki öncelik).
    expect(await sinirKimligi(akisIstegi({ query: { token: 'a.b.gecerliB' }, headers: { cookie: 'oturum=imzaliA' } }), d)).toBe('kullaniciA');
    expect(d.belirtecDogrula).toHaveBeenCalledTimes(1);
    // Başlıkta geçerli A, sorguda geçerli B → işleyici B'yi kimlik sayar; sınırlayıcı da.
    expect(await sinirKimligi(akisIstegi({ query: { token: 'a.b.gecerliB' }, headers: { authorization: 'Bearer a.b.gecerliA' } }), d)).toBe('kullaniciB');
    // Çerez de sorgu belirteci de yok → işleyici 401 verir; başlıktaki geçerli belirtecin sahibi bu isteğin kovası OLMAZ.
    expect(await sinirKimligi(akisIstegi({ headers: { authorization: 'Bearer a.b.gecerliA' } }), d)).toBeNull();
    expect(await sinirKimligi(akisIstegi({ query: { token: 'x.y.sahte' } }), d)).toBeNull();
    // İşleyicinin 401 verdiği yazımlar (Express tekrarlı anahtarı diziye çevirir) kimlik sayılmaz.
    expect(await sinirKimligi(akisIstegi({ query: { token: ['a.b.gecerliA', 'a.b.gecerliB'] } }), d)).toBeNull();
    expect(await sinirKimligi(akisIstegi({ query: { token: { a: 'a.b.gecerliA' } } }), d)).toBeNull();
    // İşaretsiz istekte sorgu belirteci kimlik DEĞİL.
    expect(await sinirKimligi(istek({ method: 'GET', originalUrl: '/api/db/orders?token=a.b.gecerliA', query: { token: 'a.b.gecerliA' } }), d)).toBeNull();
    // Çerez başlığı VAR ama oturum geçersiz (süresi dolmuş / alan adının başka çerezi) → işleyici `?token=`'a düşer; sınırlayıcı da.
    expect(await sinirKimligi(akisIstegi({ query: { token: 'a.b.gecerliB' }, headers: { cookie: 'baska=1; oturum=suresi-dolmus' } }), d)).toBe('kullaniciB');
    const firlatan = dep({ cerezdenUid: () => { throw new URIError('URI malformed'); } });
    expect(await sinirKimligi(akisIstegi({ query: { token: 'a.b.gecerliA' }, headers: { cookie: 'oturum=%' } }), firlatan)).toBe('kullaniciA');
  });
  it('akisSorguBelirteci: işleyicinin eski okuyuşuyla (`String(req.query.token || \'\')`) birebir', () => {
    for (const sorgu of [{ token: 'a.b.c' }, { token: '' }, {}, { token: ['a', 'b'] }, { token: { x: 1 } }, { token: 0 }, { token: null }])
      expect(akisSorguBelirteci(sorgu), JSON.stringify(sorgu)).toBe(String((sorgu as { token?: unknown }).token || ''));
    for (const kotu of [undefined, null, 'token=a.b.c', 5]) expect(akisSorguBelirteci(kotu)).toBe('');
  });
  it('HİÇBİR hata dışarı çıkmaz: fırlatan doğrulayıcı (eşzamanlı / söz reddi), fırlatan çerez okuyucu → null', async () => {
    const esz = dep({ belirtecDogrula: () => { throw new Error('app/no-app'); } });
    expect(await sinirKimligi(istek({ headers: { authorization: 'Bearer a.b.c' } }), esz)).toBeNull();
    const red = dep({ belirtecDogrula: async () => { throw new Error('auth/id-token-expired'); } });
    expect(await sinirKimligi(istek({ headers: { authorization: 'Bearer a.b.c' } }), red)).toBeNull();
    const cerez = dep({ cerezdenUid: () => { throw new URIError('URI malformed'); } });
    expect(await sinirKimligi(akisIstegi({ headers: { cookie: 'oturum=%' } }), cerez)).toBeNull();
  });
  it('doğrulayıcının döndürdüğü değer uid biçiminde değilse kimlik sayılmaz', async () => {
    for (const kotu of ['', 'x'.repeat(129), 5, {}, undefined]) {
      const d = dep({ belirtecDogrula: async () => kotu as never });
      expect(await sinirKimligi(istek({ headers: { authorization: 'Bearer a.b.c' } }), d)).toBeNull();
    }
  });
  it('doğrulama ASILI kalırsa (soğuk sertifika önbelleği) süre sınırında "kimlik yok" — sınırlayıcı beklemez', async () => {
    vi.useFakeTimers();
    const d = dep({ belirtecDogrula: () => new Promise<string | null>(() => {}), zamanAsimiMs: 250 });
    let sonuc: string | null | 'bekliyor' = 'bekliyor';
    void sinirKimligi(istek({ headers: { authorization: 'Bearer a.b.c' } }), d).then(v => { sonuc = v; });
    await vi.advanceTimersByTimeAsync(249);
    expect(sonuc).toBe('bekliyor');
    await vi.advanceTimersByTimeAsync(2);
    expect(sonuc).toBeNull();
  });
  it('zamanAsimiMs VERİLMEZSE (canlıdaki tek yol) süre sınırı 1 sn: 999 ms bekler, 1001 ms "kimlik yok"', async () => {
    // Sınırlar bilerek sabit sayı: sabitten türetilseydi sabiti 60 sn yapan değişiklik yeşil kalırdı (açılışta istekler asılı kalır).
    vi.useFakeTimers();
    const d = dep({ belirtecDogrula: () => new Promise<string | null>(() => {}) });
    let sonuc: string | null | 'bekliyor' = 'bekliyor';
    void sinirKimligi(istek({ headers: { authorization: 'Bearer a.b.c' } }), d).then(v => { sonuc = v; });
    await vi.advanceTimersByTimeAsync(999);
    expect(sonuc).toBe('bekliyor');
    await vi.advanceTimersByTimeAsync(2);
    expect(sonuc).toBeNull();
  });
});

describe('iki anahtar üretici', () => {
  it('ipSinirAnahtari kullanıcıya ASLA yükselmez (geçerli belirteç / kapıdan gelen uid olsa da)', () => {
    expect(ipSinirAnahtari(istek({ uid: 'kapidanGelen', headers: { authorization: 'Bearer a.b.gecerliA' } }))).toBe('ip:85.105.1.2');
  });
  it('kullaniciSinirAnahtari: doğrulanmış → u:<uid>; değilse IP (sahte belirteç taze kova ALAMAZ)', async () => {
    const d = dep();
    expect(await kullaniciSinirAnahtari(istek({ headers: { authorization: 'Bearer a.b.gecerliA' } }), d)).toBe('u:kullaniciA');
    expect(await kullaniciSinirAnahtari(istek({ ip: '31.1.1.1:9', headers: { authorization: 'Bearer a.b.gecerliA' } }), d)).toBe('u:kullaniciA');
    expect(await kullaniciSinirAnahtari(istek({ headers: { authorization: 'Bearer x.y.sahte1' } }), d)).toBe('ip:85.105.1.2');
    expect(await kullaniciSinirAnahtari(istek({ headers: { authorization: 'Bearer x.y.sahte2' } }), d)).toBe('ip:85.105.1.2');
    expect(await kullaniciSinirAnahtari(istek(), d)).toBe('ip:85.105.1.2');
  });
  it('doğrulayıcı patlasa da anahtar ÜRETİLİR (istek 500 olmaz): IP anahtarı', async () => {
    const d = dep({ belirtecDogrula: () => { throw new Error('patladı'); } });
    expect(await kullaniciSinirAnahtari(istek({ headers: { authorization: 'Bearer a.b.c' } }), d)).toBe('ip:85.105.1.2');
  });
});

describe('tavan ve muafiyet politikası', () => {
  it('anahtar ile tavan AYNI hükmü paylaşır: zaman aşımına düşen doğrulama GEÇ çözülse de tavan kimliksiz kalır; doğrulayıcı bir kez', async () => {
    // Tavan kendi doğrulamasını yapsaydı: anahtar 'ip:<ofis>' iken tavan kimlikli (600) çıkar, ofisin ortak kovası iki katına açılırdı.
    vi.useFakeTimers();
    let n = 0;
    const belirtecDogrula = vi.fn((): Promise<string | null> => (n++ === 0 ? new Promise(r => setTimeout(() => r('kullaniciA'), 80)) : Promise.resolve('kullaniciA')));
    const d = dep({ belirtecDogrula, zamanAsimiMs: 20 });
    const q = istek({ headers: { authorization: 'Bearer a.b.c' } });
    const anahtar = kullaniciSinirAnahtari(q, d);
    await vi.advanceTimersByTimeAsync(100);                                        // 20 ms: süre doldu → IP; 80 ms: doğrulama geç çözüldü
    expect([await anahtar, await kimligeGoreTavan(d, 300, 600)(q)]).toEqual(['ip:85.105.1.2', 300]);
    expect(belirtecDogrula).toHaveBeenCalledTimes(1);
  });
  it('kimligeGoreTavan: doğrulanmış → kimlikli tavan; sahte / belirteçsiz → kimliksiz', async () => {
    const tavan = kimligeGoreTavan(dep(), 300, 600);
    expect(await tavan(istek({ headers: { authorization: 'Bearer a.b.gecerliA' } }))).toBe(600);
    expect(await tavan(istek({ headers: { authorization: 'Bearer x.y.sahte' } }))).toBe(300);
    expect(await tavan(istek())).toBe(300);
  });
  it('muafiyet YALNIZ POST ve yalnız birebir yol: başka yöntem / alt yol / benzer ad genel kovada sayılır', () => {
    for (const originalUrl of ['/api/hit', '/api/hit?x=1', '/api/hit#x', '/api/shopify/webhook', '/api/stripe/webhook'])
      expect(apiSinirindanMuaf({ method: 'POST', originalUrl }), originalUrl).toBe(true);
    for (const method of ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', undefined])
      expect(apiSinirindanMuaf({ method, originalUrl: '/api/hit' }), String(method)).toBe(false);
    for (const originalUrl of ['/api/hitx', '/api/hit/x', '/api/hit/', '/API/HIT', '/api/x', undefined])
      expect(apiSinirindanMuaf({ method: 'POST', originalUrl }), String(originalUrl)).toBe(false);
  });
});

describe('istekBasinaBirKez — aynı sınırlayıcı bir isteği iki kez saymaz', () => {
  it('aynı istek ikinci geçişte doğrudan next(); başka istek yine sayılır', () => {
    const say = vi.fn((_q: object, _s: unknown, next: () => void) => next());
    const sarili = istekBasinaBirKez(say);
    const q1 = {}, q2 = {};
    const next = vi.fn();
    sarili(q1, null, next); sarili(q1, null, next); sarili(q2, null, next);
    expect(say).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledTimes(3);
  });
});
