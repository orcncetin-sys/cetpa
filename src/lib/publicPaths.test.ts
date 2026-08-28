import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PUBLIC_PATHS, publicPageKey, type PublicPageKey } from './publicPaths';
import { TOP_LEVEL_TABS } from '../hooks/useRouteSync';

const ANAHTARLAR = Object.keys(PUBLIC_PATHS) as PublicPageKey[];
const oku = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('publicPaths — çözümleme', () => {
  it('her yol kendi anahtarına çözülür', () => {
    for (const a of ANAHTARLAR) expect(publicPageKey(PUBLIC_PATHS[a])).toBe(a);
  });

  it('sondaki eğik çizgi yok sayılır', () => {
    expect(publicPageKey('/terms/')).toBe('terms');
    expect(publicPageKey('/privacy//')).toBe('privacy');
  });

  it('uygulama yolları genel sayfa DEĞİLDİR', () => {
    for (const y of ['/', '/crm', '/muhasebe', '/raporlar', '/privacy-x', '/api'])
      expect(publicPageKey(y)).toBeNull();
  });
});

describe('publicPaths — değişmezler', () => {
  // Bir genel yol aynı zamanda üst düzey sekmeyse, o MODÜL TAMAMEN ERİŞİLEMEZ
  // olur: App.tsx genel sayfayı kimlik kontrolünden ÖNCE döndürür, yani sekme
  // hiç render edilmez. Sessiz ve büyük bir kayıp — burada kilitliyoruz.
  it('hiçbir genel yol üst düzey sekmeyle çakışmaz', () => {
    for (const a of ANAHTARLAR) {
      const seg = PUBLIC_PATHS[a].replace(/^\//, '');
      expect(TOP_LEVEL_TABS.has(seg), `'${seg}' hem genel sayfa hem sekme`).toBe(false);
    }
  });

  // Sunucudaki SPA geri-düşüşü `/api/` öneklilerini JSON 404'e ayırıyor
  // (server.ts). O önekte bir genel sayfa, doğrudan açılınca 404 olur.
  it('hiçbir genel yol /api önekinde değil', () => {
    for (const a of ANAHTARLAR) expect(PUBLIC_PATHS[a].startsWith('/api')).toBe(false);
  });

  // ASIL HATA BUYDU: sayfalar yazılmıştı, bağlantılar vardı, ama hiçbiri
  // birbirine bağlı değildi. Yol tanımlıysa ona GİDEN bir bağlantı da olmalı;
  // yoksa sayfa yine erişilemezdir — sadece bu kez sessizce.
  it('her genel yola landing altbilgisinden bağlantı var', () => {
    const landing = oku('../components/LandingPage.tsx');
    for (const a of ANAHTARLAR)
      expect(landing, `${a}: bağlantı yok`).toContain(`<Link to={PUBLIC_PATHS.${a}}`);
  });

  // Harita zaten Record<PublicPageKey,...> — eksik anahtar DERLEME hatası.
  // Bu test o haritanın `as`/`any` ile gevşetilmediğini de doğrular.
  it('App.tsx haritası her anahtarı bağlar', () => {
    const app = oku('../App.tsx');
    const harita = app.slice(app.indexOf('const PUBLIC_PAGES'), app.indexOf('const PUBLIC_PAGES') + 400);
    for (const a of ANAHTARLAR) expect(harita, `${a}: haritada yok`).toContain(`${a}:`);
  });
});
