import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cikisIstegiGonder, CIKIS_UCU, CIKIS_SURE_SINIRI_MS } from './oturumCikisi';
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
    expect(satirlar.filter(s => /^import \{ cikisIstegiGonder \} from '\.\/lib\/oturumCikisi';$/.test(s.kod))).toHaveLength(1);
    expect(no(/\bcikisIstegiGonder\(\)/)).toHaveLength(1);
  });

  it('çıkış ucu handleLogout içinde sarmalayıcıyla çağrılmıyor; uç adresi App.tsx\'te hiç geçmiyor (tek kaynak: modül)', () => {
    expect(no(/authedFetch|authFetch\(/)).toEqual([]);
    expect(satirlar.filter(s => /session\/logout/.test(s.kod))).toEqual([]);
  });

  it('istek `signOut`tan ÖNCE BEKLENİR (küresel belirteç iptali yeni oturumu yakalamasın); başarısızlık uyarı üretir', () => {
    const bekle = no(/^\s*const sunucuCikisi = await cikisIstegiGonder\(\);$/);
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
    const baslat = no(/cikisIstegiGonder\(\)/);
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
