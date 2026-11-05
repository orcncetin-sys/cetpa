import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cikisBelirteciAl, cikisIstegiGonder, CIKIS_BELIRTEC_SURE_SINIRI_MS, CIKIS_UCU, CIKIS_SURE_SINIRI_MS } from './oturumCikisi';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';

type Cagri = [string, RequestInit];

function sahte(yanit: { ok: boolean; status?: number } | Error): { fn: (g: string, i: RequestInit) => Promise<{ ok: boolean; status?: number }>; cagrilar: Cagri[] } {
  const cagrilar: Cagri[] = [];
  const fn = vi.fn(async (g: string, i: RequestInit) => {
    cagrilar.push([g, i]);
    if (yanit instanceof Error) throw yanit;
    return yanit;
  });
  return { fn, cagrilar };
}

describe('cikisIstegiGonder — çıkış isteği belirteçsiz, çerezli, gövdeli gider; asla fırlatmaz', () => {
  it('tam BİR POST: çıkış ucu, same-origin çerez, JSON gövde `{}`, keepalive', async () => {
    const { fn, cagrilar } = sahte({ ok: true });
    await expect(cikisIstegiGonder(fn)).resolves.toBe(true);
    expect(cagrilar).toHaveLength(1);
    const [yol, init] = cagrilar[0];
    expect(yol).toBe(CIKIS_UCU);
    expect(CIKIS_UCU).toBe('/api/db/session/logout');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe('{}');   // IIS: gövdesiz POST 411 ile Node'a ulaşmadan reddedilir
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.keepalive).toBe(true);
  });

  it('Authorization başlığı YOK ve kimlik sarmalayıcısına uğramaz (çıkış ucu kullanıcıyı çerezden tanır)', async () => {
    const { fn, cagrilar } = sahte({ ok: true });
    await cikisIstegiGonder(fn);
    expect(Object.keys(cagrilar[0][1].headers as Record<string, string>).map(k => k.toLowerCase())).not.toContain('authorization');
    const kaynak = kodSatirlari(join(SRC_KOK, 'lib', 'oturumCikisi.ts')).map(s => s.kod).join('\n');
    expect(kaynak).not.toMatch(/authedFetch|authFetch|getToken|getIdToken|currentUser/);
  });

  it('(2026-10-21, H2) kimlik belirteci VERİLİRSE `Authorization: Bearer …` taşır; `null` / boş / verilmezse taşımaz; modül yine `auth` içe aktarmaz', async () => {
    const { fn, cagrilar } = sahte({ ok: true });
    await cikisIstegiGonder(fn, 5000, 'tok');
    expect(cagrilar[0][1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok' });
    for (const bos of [null, '', undefined]) {
      await cikisIstegiGonder(fn, 5000, bos);
      expect(cagrilar[cagrilar.length - 1][1].headers, String(bos)).toEqual({ 'Content-Type': 'application/json' });
    }
    expect(cagrilar[0][1].credentials).toBe('same-origin');   // çerez yine gider (personel çerezle de tanınır)
  });

  it('sunucu 4xx / 5xx dönerse `false`, fırlatmaz; sessiz DEĞİL: tam bir uyarı (durum koduyla, gövdesiz)', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fn } = sahte({ ok: false, status: 503 });
      await expect(cikisIstegiGonder(fn)).resolves.toBe(false);
      expect(uyari).toHaveBeenCalledTimes(1);
      expect(uyari.mock.calls[0].join(' ')).toContain('503');
    } finally { uyari.mockRestore(); }
  });

  it('ağ hatası `false`, fırlatmaz (çıkış engellenmez); tam bir uyarı', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fn } = sahte(new TypeError('Failed to fetch'));
      await expect(cikisIstegiGonder(fn)).resolves.toBe(false);
      expect(uyari).toHaveBeenCalledTimes(1);
      expect(uyari.mock.calls[0].join(' ')).toContain('Failed to fetch');
    } finally { uyari.mockRestore(); }
  });

  it('başarıda uyarı yok', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await cikisIstegiGonder(sahte({ ok: true }).fn);
      expect(uyari).not.toHaveBeenCalled();
    } finally { uyari.mockRestore(); }
  });

  it('süre sınırı: verilen ms ile AbortSignal.timeout çağrılır, dönen sinyal fetch\'e geçer; varsayılan 5 sn', async () => {
    expect(CIKIS_SURE_SINIRI_MS).toBe(5_000);
    const A = AbortSignal as unknown as { timeout?: unknown };
    if (typeof A.timeout !== 'function') return;   // eski ortam: aşağıdaki «timeout yokken» testi kapsar
    const casus = vi.spyOn(AbortSignal, 'timeout');
    try {
      const { fn, cagrilar } = sahte({ ok: true });
      await cikisIstegiGonder(fn, 1234);
      expect(casus).toHaveBeenCalledTimes(1);
      expect(casus).toHaveBeenCalledWith(1234);
      expect(cagrilar[0][1].signal).toBe(casus.mock.results[0].value);
      await cikisIstegiGonder(fn);
      expect(casus).toHaveBeenLastCalledWith(CIKIS_SURE_SINIRI_MS);
      expect(cagrilar[1][1].signal).toBe(casus.mock.results[1].value);
    } finally { casus.mockRestore(); }
  });

  it('`AbortSignal.timeout` yokken sinyal verilmez, istek yine gider', async () => {
    const asil = (AbortSignal as unknown as { timeout?: unknown }).timeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AbortSignal as any).timeout = undefined;
    try {
      const { fn, cagrilar } = sahte({ ok: true });
      await expect(cikisIstegiGonder(fn)).resolves.toBe(true);
      expect(cagrilar[0][1].signal).toBeUndefined();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AbortSignal as any).timeout = asil;
    }
  });
});

describe('cikisBelirteciAl — çıkış isteğine eklenecek belirteç: en çok 2 sn, asla fırlatmaz (2026-10-21, H17)', () => {
  it('süre bütçesi: belirteç 2 sn + istek 3 sn = toplam 5 sn', () => {
    expect(CIKIS_BELIRTEC_SURE_SINIRI_MS).toBe(2_000);
    expect(CIKIS_SURE_SINIRI_MS - CIKIS_BELIRTEC_SURE_SINIRI_MS).toBe(3_000);
  });

  it('belirteç gelirse aynen döner; oturum yoksa (`getir` yok) `null` ve hiçbir şey çağrılmaz', async () => {
    await expect(cikisBelirteciAl(async () => 'tok')).resolves.toBe('tok');
    await expect(cikisBelirteciAl(undefined)).resolves.toBeNull();
  });

  it('reddedilen, eşzamanlı fırlatan ya da boş / metin olmayan sonuç → `null` (fırlatmaz)', async () => {
    await expect(cikisBelirteciAl(() => Promise.reject(new Error('ağ')))).resolves.toBeNull();
    await expect(cikisBelirteciAl(() => { throw new Error('eşzamanlı'); })).resolves.toBeNull();
    await expect(cikisBelirteciAl(async () => '')).resolves.toBeNull();
    await expect(cikisBelirteciAl((async () => 42) as unknown as () => Promise<string>)).resolves.toBeNull();
  });

  it('asılı kalan `getir`: TAM 2 sn sonra `null` (1 ms önce hâlâ bekliyor); hızlı sonuçta zamanlayıcı temizlenir', async () => {
    vi.useFakeTimers();
    try {
      let bitti = false;
      const p = cikisBelirteciAl(() => new Promise<string>(() => { /* hiç sonuçlanmaz */ })).then((v) => { bitti = true; return v; });
      await vi.advanceTimersByTimeAsync(CIKIS_BELIRTEC_SURE_SINIRI_MS - 1);
      expect(bitti).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(bitti).toBe(true);
      await expect(p).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      await expect(cikisBelirteciAl(async () => 'tok')).resolves.toBe('tok');
      expect(vi.getTimerCount()).toBe(0);                     // süre zamanlayıcısı askıda KALMAZ
      await expect(cikisBelirteciAl(() => Promise.reject(new Error('x')))).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('verilen süre kullanılır (varsayılan dışında)', async () => {
    vi.useFakeTimers();
    try {
      let bitti = false;
      void cikisBelirteciAl(() => new Promise<string>(() => {}), 50).then(() => { bitti = true; });
      await vi.advanceTimersByTimeAsync(49);
      expect(bitti).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(bitti).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

// ── «Yazıldı ama bağlanmadı» çiti: App.tsx'teki çıkış akışı bu modülü GERÇEKTEN kullanıyor ───────────
describe('App.tsx handleLogout — çıkış isteği belirteç isteyen sarmalayıcıyla DEĞİL, bu modülle gider', () => {
  const satirlar = kodSatirlari(join(SRC_KOK, 'App.tsx'));
  const bas = satirlar.findIndex(s => /^\s*const handleLogout = async \(\) => \{$/.test(s.kod));
  const govde = (() => {
    expect(bas, '`handleLogout` tanımı').toBeGreaterThanOrEqual(0);
    const girinti = satirlar[bas].kod.search(/\S/);
    const son = satirlar.findIndex((s, i) => i > bas && s.kod.search(/\S/) === girinti && /^\s*\};$/.test(s.kod));
    expect(son, '`handleLogout` kapanışı').toBeGreaterThan(bas);
    return satirlar.slice(bas, son + 1);
  })();
  const no = (desen: RegExp): number[] => govde.filter(s => desen.test(s.kod)).map(s => s.n);

  it('modül içe aktarılıyor ve handleLogout içinde tam 1 kez çağrılıyor', () => {
    expect(satirlar.filter(s => /^import \{ CIKIS_BELIRTEC_SURE_SINIRI_MS, CIKIS_SURE_SINIRI_MS, cikisBelirteciAl, cikisIstegiGonder \} from '\.\/lib\/oturumCikisi';$/.test(s.kod))).toHaveLength(1);
    expect(no(/\bcikisIstegiGonder\(/)).toHaveLength(1);
    expect(no(/\bcikisBelirteciAl\(/)).toHaveLength(1);
    // App.tsx'te başka yerde çağrılmıyor (çıkış TEK işleyicide).
    expect(satirlar.filter(s => /\bcikisIstegiGonder\(|\bcikisBelirteciAl\(/.test(s.kod))).toHaveLength(2);
  });

  it('çıkış ucu handleLogout içinde sarmalayıcıyla çağrılmıyor; uç adresi App.tsx\'te hiç geçmiyor (tek kaynak: modül)', () => {
    expect(no(/authedFetch|authFetch\(/)).toEqual([]);
    expect(satirlar.filter(s => /session\/logout/.test(s.kod))).toEqual([]);
  });

  it('(H17) kimlik belirteci süre sınırlı alınır ve İSTEĞE verilir; istek kalan süreyle sınırlı; ikisi de `signOut`tan ÖNCE', () => {
    const kullanici = no(/^\s*const cikanKullanici = auth\.currentUser;$/);
    const belirtec = no(/^\s*const belirtec = await cikisBelirteciAl\(cikanKullanici \? \(\) => cikanKullanici\.getIdToken\(\) : undefined\);$/);
    const istek = no(/^\s*const sunucuCikisi = await cikisIstegiGonder\(fetch, CIKIS_SURE_SINIRI_MS - CIKIS_BELIRTEC_SURE_SINIRI_MS, belirtec\);$/);
    const cikis = no(/^\s*await signOut\(auth\);/);
    expect([kullanici.length, belirtec.length, istek.length, cikis.length]).toEqual([1, 1, 1, 1]);
    expect(kullanici[0]).toBeLessThan(belirtec[0]);
    expect(belirtec[0]).toBeLessThan(istek[0]);
    expect(istek[0]).toBeLessThan(cikis[0]);
    expect(no(/\bgetIdToken\(/)).toEqual(belirtec);              // belirteç başka yoldan (süresiz) alınmıyor
  });

  it('istek `signOut`tan ÖNCE BEKLENİR (küresel belirteç iptali yeni oturumu yakalamasın); başarısızlık uyarı üretir', () => {
    const bekle = no(/^\s*const sunucuCikisi = await cikisIstegiGonder\(fetch, CIKIS_SURE_SINIRI_MS - CIKIS_BELIRTEC_SURE_SINIRI_MS, belirtec\);$/);
    const uyari = no(/^\s*if \(!sunucuCikisi\) console\.warn\(/);
    const cikis = no(/^\s*await signOut\(auth\);/);
    expect(bekle).toHaveLength(1);
    expect(uyari).toHaveLength(1);
    expect(cikis).toHaveLength(1);
    expect(bekle[0]).toBeLessThan(cikis[0]);
    expect(uyari[0]).toBeLessThan(cikis[0]);
    expect(no(/\bcikisIstegi\b/)).toEqual([]);   // beklenmeyen söz kalmadı
  });

  it('misafir kipinde istek atılmaz (sunucuda oturum yok)', () => {
    const misafir = no(/^\s*if \(isGuestMode\) \{$/);
    const baslat = no(/\bcikisBelirteciAl\(/);                   // çıkışın ilk ağ / kimlik adımı (belirteç, sonra istek)
    expect(baslat).toHaveLength(1);
    expect(misafir).toHaveLength(1);
    expect(baslat[0]).toBeGreaterThan(misafir[0]);
    // Misafir dalı `return` ile biter ve istek o dalın DIŞINDA başlar.
    const donus = govde.filter(s => s.n > misafir[0] && s.n < baslat[0] && /^\s*return;$/.test(s.kod));
    expect(donus).toHaveLength(1);
  });
});

describe('sunucu çıkış ucu belirteç istemez (kaynak çiti: `requireAuth` YOK, kullanıcı çerezden)', () => {
  it('rota tanımı `dbLimiter` + işleyici; kimlik çerezden okunur', () => {
    const sunucu = readFileSync(join(SRC_KOK, '..', 'server.ts'), 'utf-8').split('\n');
    const i = sunucu.findIndex(s => /app\.post\('\/api\/db\/session\/logout', dbLimiter, async \(req: Request, res: Response\) => \{/.test(s));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(sunucu[i]).not.toMatch(/requireAuth/);
    expect(sunucu.slice(i, i + 14).join('\n')).toMatch(/parseCookie\(req\.headers\.cookie, SESSION_COOKIE\)/);
  });
});
