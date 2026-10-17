// @vitest-environment node
/**
 * sw.davranis.test.ts — hizmet çalışanının (public/sw.js) yayın sonrası davranışı ÖLÇÜMÜ (şartname
 * `.wf/SARTNAME-yeni-surum-bildirimi.md` S5). Dosya OLDUĞU GİBİ, küçük bir sahte hizmet çalışanı ortamında koşturulur
 * (`self`, `caches`, `fetch`); tarayıcının kendi hizmet çalışanı güncelleme döngüsü burada ÖLÇÜLMEZ.
 *
 * SORU: eski paket önbellekten verilmeye devam ediyor mu (yeni `index.html` gelmiyor mu)? ÖLÇÜLEN CEVAP: HAYIR —
 *  • sayfa açılışı / yenileme (navigate) AĞDAN gelir; önbellekteki eski `index.html` yalnız ağ yokken verilir;
 *  • parçalar içerik karmalı adlıdır: yeni `index.html` yeni adları ister, eski önbellek onlara cevap veremez;
 *  • sunucuda olmayan parça (404) ve HTML dönen `.js` önbelleğe YAZILMAZ — yeni sürüm şeridinin 404 yolu bozulmaz;
 *  • `/api/` (sürüm ucu dâhil) ve GET dışı istek (eksik parça HEAD sondası) hizmet çalışanından HİÇ geçmez.
 * Bu yüzden public/sw.js bu işte DEĞİŞTİRİLMEDİ; bu dosya o davranışın çitidir (bozulursa kırmızı).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SRC_KOK } from './test/kaynakTarama';
import { SURUM_UCU } from './lib/surumKimligi';

const KOKEN = 'https://app.cetpa.com.tr';
const KOD = readFileSync(join(SRC_KOK, '..', 'public', 'sw.js'), 'utf8');

interface SahteIstek { url: string; method: string; mode: string; headers: Headers }
const istek = (yol: string, secenek: { method?: string; mode?: string } = {}): SahteIstek =>
  ({ url: `${KOKEN}${yol}`, method: secenek.method ?? 'GET', mode: secenek.mode ?? 'cors', headers: new Headers() });
const adres = (g: SahteIstek | string): string => (typeof g === 'string' ? new URL(g, KOKEN).href : g.url);

type Ag = (g: SahteIstek) => Promise<Response>;
interface Olay { request?: SahteIstek; respondWith?: (p: Promise<Response>) => void; waitUntil?: (p: Promise<unknown>) => void }

function swKur(ag: Ag) {
  const dinleyiciler = new Map<string, (o: Olay) => void>();
  const onbellekler = new Map<string, Map<string, Response>>();
  const ac = (ad: string) => {
    let m = onbellekler.get(ad);
    if (!m) { m = new Map(); onbellekler.set(ad, m); }
    const harita = m;
    return {
      put: async (g: SahteIstek | string, y: Response) => { harita.set(adres(g), y); },
      match: async (g: SahteIstek | string) => harita.get(adres(g))?.clone(),
      add: async (g: string) => { harita.set(adres(g), await ag(istek(new URL(g, KOKEN).pathname))); },
      addAll: async (liste: string[]) => { for (const g of liste) harita.set(adres(g), await ag(istek(g))); },
    };
  };
  const caches = {
    open: async (ad: string) => ac(ad),
    match: async (g: SahteIstek | string) => {
      for (const m of onbellekler.values()) { const y = m.get(adres(g)); if (y) return y.clone(); }
      return undefined;
    },
    keys: async () => [...onbellekler.keys()],
    delete: async (ad: string) => onbellekler.delete(ad),
  };
  const self = {
    location: { origin: KOKEN },
    addEventListener: (tur: string, f: (o: Olay) => void) => { dinleyiciler.set(tur, f); },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [] },
    registration: { showNotification: async () => undefined },
  };
  new Function('self', 'caches', 'fetch', KOD)(self, caches, ag);
  const olay = async (tur: string) => {
    const bekleyen: Promise<unknown>[] = [];
    dinleyiciler.get(tur)?.({ waitUntil: p => { bekleyen.push(p); } });
    await Promise.all(bekleyen);
  };
  /** Bir isteği hizmet çalışanına verir; `null` = hizmet çalışanı karışmadı (istek doğrudan ağa gider). */
  const getir = async (g: SahteIstek): Promise<Response | null> => {
    let yanit: Promise<Response> | undefined;
    dinleyiciler.get('fetch')?.({ request: g, respondWith: p => { yanit = p; } });
    if (!yanit) return null;
    const y = await yanit;
    await new Promise(r => setTimeout(r, 0));                       // önbelleğe yazma `.then` içinde, beklenmeden
    return y;
  };
  return { olay, getir, onbellekler };
}

const html = (surum: string) => new Response(`<html><meta name="cetpa-surum" content="${surum}"></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
const metin = async (y: Response | null) => (y ? y.text() : null);

describe('S5 ölçümü: yayından sonra yeni index.html AĞDAN gelir', () => {
  it('kurulumda önbelleğe alınan ESKİ index.html, çevrimiçi açılışta / yenilemede verilmez; yeni olan gelir ve önbelleğe yazılır', async () => {
    let yayin = 'eski';
    // Sunucu düzeni: uzantısız her yol SPA yedeği index.html'dir; ikon / manifest gibi dosyalar kendisi.
    const sw = swKur(async (g) => (/\.[a-z0-9]+$/i.test(new URL(g.url).pathname) && !g.url.endsWith('/index.html') ? new Response('x') : html(yayin)));
    await sw.olay('install');
    expect(await metin(await sw.getir(istek('/', { mode: 'navigate' })))).toContain('eski');
    yayin = 'yeni';
    expect(await metin(await sw.getir(istek('/', { mode: 'navigate' })))).toContain('yeni');
    expect(await metin(await sw.getir(istek('/muhasebe', { mode: 'navigate' })))).toContain('yeni');   // derin yol (SPA yedeği)
    expect(await metin(await sw.getir(istek('/index.html')))).toContain('yeni');
  });

  it('ağ yokken önbellekteki son index.html verilir (çevrimdışı açılış korunur)', async () => {
    let cevrimici = true;
    const sw = swKur(async (g) => { if (!cevrimici) throw new TypeError('Failed to fetch'); return new URL(g.url).pathname === '/' ? html('son') : new Response('x'); });
    await sw.olay('install');
    await sw.getir(istek('/', { mode: 'navigate' }));
    cevrimici = false;
    expect(await metin(await sw.getir(istek('/', { mode: 'navigate' })))).toContain('son');
  });

  it('sürüm ucu ve öbür /api istekleri, GET dışı istekler (eksik parça HEAD sondası) hizmet çalışanından GEÇMEZ', async () => {
    const sw = swKur(async () => new Response('{}'));
    expect(await sw.getir(istek(SURUM_UCU))).toBeNull();
    expect(await sw.getir(istek('/api/db/orders'))).toBeNull();
    expect(await sw.getir(istek('/assets/MuhasebePage-Ab12.js', { method: 'HEAD' }))).toBeNull();
  });

  it('sunucuda OLMAYAN parça (404) önbelleğe yazılmaz ve 404 olarak döner; HTML dönen .js de yazılmaz', async () => {
    let kod = 404;
    const sw = swKur(async (g) => (g.url.endsWith('.js') && kod === 404 ? new Response('Not found', { status: 404 }) : new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })));
    const y = await sw.getir(istek('/assets/Eski-Ab12.js'));
    expect(y?.status).toBe(404);
    kod = 200;
    await sw.getir(istek('/assets/Yanlis-Cd34.js'));
    const yazilan = [...sw.onbellekler.values()].flatMap(m => [...m.keys()]);
    expect(yazilan.filter(a => a.includes('/assets/'))).toEqual([]);
  });

  it('karmalı parça önbellekten verilir (aynı ad = aynı içerik); yeni ad ağdan gelir', async () => {
    const istenen: string[] = [];
    const sw = swKur(async (g) => { istenen.push(new URL(g.url).pathname); return new Response(`kod:${new URL(g.url).pathname}`, { status: 200, headers: { 'Content-Type': 'text/javascript' } }); });
    await sw.getir(istek('/assets/index-Eski1.js'));
    istenen.length = 0;
    expect(await metin(await sw.getir(istek('/assets/index-Yeni2.js')))).toBe('kod:/assets/index-Yeni2.js');
    expect(istenen).toEqual(['/assets/index-Yeni2.js']);
  });

  it('etkinleşmede başka sürüm adlı önbellekler silinir', async () => {
    const sw = swKur(async () => new Response('x'));
    sw.onbellekler.set('cetpa-v5-static', new Map());
    sw.onbellekler.set('cetpa-v5-dynamic', new Map());
    await sw.olay('install');
    await sw.olay('activate');
    const kalan = [...sw.onbellekler.keys()];
    expect(kalan).not.toContain('cetpa-v5-static');
    expect(kalan).not.toContain('cetpa-v5-dynamic');
    expect(kalan.length).toBeGreaterThan(0);                         // kurulumun kendi önbelleği kaldı
  });
});
