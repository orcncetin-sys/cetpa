// @vitest-environment node
/**
 * surumEklentisi.test.ts — T3: derlemede üretilen sürüm kimliği istemci paketinde (`index.html` meta) ve `surum.json`'da AYNI
 * (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S1). GERÇEK `vite build`, geçici dizindeki küçük bir uygulamayla (tembel
 * yüklenen parça + stil dâhil); proje yapılandırması ve ortam dosyaları YÜKLENMEZ (`configFile: false`, `envDir` geçici dizin).
 *
 * İki derleme yolu da sınanır (`deploy/windows/deploy.ps1`): yavaş yol `npm run build` → `dist/`, hızlı yol
 * `npm run build -- --outDir dist.new --emptyOutDir` → `dist.new/` (sonra `dist`'e çevrilir). Kimlik çıktı dizinine bağlı
 * DEĞİLDİR: aynı içerik iki yolda aynı kimliği verir; içerik değişince kimlik değişir.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { surumEklentisi, surumKimligiUret } from './surumEklentisi';
import { SURUM_DOSYASI, SURUM_META_ADI, surumGecerli } from '../lib/surumKimligi';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';

vi.setConfig({ testTimeout: 120_000 });

let kok = '';
beforeAll(() => {
  // Gerçek yol: macOS'ta geçici dizin bağlantıdır (/var → /private/var); Vite köke göre göreli ad üretirken ikisi ayrışmasın.
  kok = realpathSync(mkdtempSync(join(tmpdir(), 'surum-eklentisi-')));
  writeFileSync(join(kok, 'index.html'), '<!doctype html><html lang="tr"><head><title>x</title></head><body><div id="k"></div><script type="module" src="/ana.js"></script></body></html>');
  // Tembel parça yan etkili bir dinleyicide: dışa aktarılan ama çağrılmayan `import()` ağaç sarsmada silinir (ölçüldü).
  writeFileSync(join(kok, 'ana.js'), "import './stil.css';\nconst k = document.getElementById('k');\nk.textContent = 'ana';\nk.onclick = () => import('./tembel.js').then(m => { k.textContent = m.default; });\n");
  writeFileSync(join(kok, 'tembel.js'), "export default 'tembel-1';\n");
  writeFileSync(join(kok, 'stil.css'), 'body { color: #111; }\n');
});
afterAll(() => { if (kok) rmSync(kok, { recursive: true, force: true }); });

/** `deploy.ps1`'in iki yolundan biriyle derler; çıktı dizinindeki meta ve `surum.json`'u döner. */
async function derle(cikis: string, eklentiler = [surumEklentisi()]): Promise<{ meta: string | null; dosya: unknown; dizin: string }> {
  await build({
    root: kok, configFile: false, envDir: kok, logLevel: 'silent', plugins: eklentiler,
    build: { outDir: cikis, emptyOutDir: true },
  });
  const dizin = join(kok, cikis);
  const html = readFileSync(join(dizin, 'index.html'), 'utf8');
  const meta = html.match(new RegExp(`<meta name="${SURUM_META_ADI}" content="([^"]*)">`))?.[1] ?? null;
  const yol = join(dizin, SURUM_DOSYASI);
  return { meta, dosya: existsSync(yol) ? JSON.parse(readFileSync(yol, 'utf8')) : undefined, dizin };
}

describe('T3 — paket ile surum.json AYNI kimliği taşır', () => {
  it('yavaş yol (`dist/`): meta = surum.json; dosyada yalnız `surum`; biçim geçerli; tembel parça ve stil pakette', async () => {
    const { meta, dosya, dizin } = await derle('dist');
    expect(surumGecerli(meta)).toBe(true);
    expect(dosya).toEqual({ surum: meta });
    const parcalar = readdirSync(join(dizin, 'assets'));
    expect(parcalar.some(a => /^tembel-.+\.js$/.test(a))).toBe(true);
    expect(parcalar.some(a => /\.css$/.test(a))).toBe(true);
  });

  it('hızlı yol (`--outDir dist.new`): dosya dist.new/\'e düşer, kimlik yavaş yolunkiyle AYNI (çıktı dizinine bağlı değil)', async () => {
    const yavas = await derle('dist');
    const hizli = await derle('dist.new');
    expect(hizli.dosya).toEqual({ surum: hizli.meta });
    expect(hizli.meta).toBe(yavas.meta);
  });

  it('içerik değişince kimlik değişir (tembel parça da sayılır); geri alınınca eski kimlik döner', async () => {
    const once = await derle('dist');
    writeFileSync(join(kok, 'tembel.js'), "export default 'tembel-2';\n");
    const sonra = await derle('dist');
    writeFileSync(join(kok, 'tembel.js'), "export default 'tembel-1';\n");
    const geri = await derle('dist');
    expect(sonra.meta).not.toBe(once.meta);
    expect(sonra.dosya).toEqual({ surum: sonra.meta });
    expect(geri.meta).toBe(once.meta);
  });

  it('eklenti YOKSA meta da surum.json da yok → sunucu `{ surum: null }`, istemci bildirim göstermez', async () => {
    const { meta, dosya } = await derle('dist', []);
    expect(meta).toBeNull();
    expect(dosya).toBeUndefined();
  });
});

describe('kimlik üretimi ve geliştirme sunucusu', () => {
  it('kimlik sıra bağımsız, HTML\'e duyarlı, 16 haneli onaltılık', () => {
    const k = surumKimligiUret(['assets/a-1.js', 'assets/b-2.css'], '<html></html>');
    expect(surumGecerli(k)).toBe(true);
    expect(surumKimligiUret(['assets/b-2.css', 'assets/a-1.js'], '<html></html>')).toBe(k);
    expect(surumKimligiUret(['assets/a-1.js', 'assets/b-2.css'], '<html> </html>')).not.toBe(k);
    expect(surumKimligiUret(['assets/a-2.js', 'assets/b-2.css'], '<html></html>')).not.toBe(k);
  });
  it('geliştirme sunucusunda (paket yok) HTML\'e dokunmaz — kimlik uydurulmaz; eklenti yalnız derlemede', () => {
    const e = surumEklentisi();
    expect(e.apply).toBe('build');
    const donus = e.transformIndexHtml;
    if (!donus || typeof donus === 'function') throw new Error('transformIndexHtml nesne biçiminde olmalı');
    expect(donus.order).toBe('post');
    const sonuc = (donus.handler as (html: string, ctx: { path: string; filename: string }) => unknown)('<html></html>', { path: '/', filename: 'index.html' });
    expect(sonuc).toBe('<html></html>');
  });
});

describe('«yazıldı ama bağlanmadı» çiti: eklenti GERÇEK yapılandırmada', () => {
  it('vite.config.ts eklentiyi içe aktarır ve `plugins` dizisine koyar', () => {
    const kod = kodSatirlari(join(SRC_KOK, '..', 'vite.config.ts')).map(s => s.kod).join('\n');
    expect(kod).toMatch(/^import \{surumEklentisi\} from '\.\/src\/derleme\/surumEklentisi';$/m);
    expect(kod).toMatch(/^\s+plugins: \[react\(\), tailwindcss\(\), surumEklentisi\(\)\],$/m);
  });
  it('sunucu dosyayı statik bölümle AYNI dizinden (`dist/`) okur', () => {
    const kod = kodSatirlari(join(SRC_KOK, '..', 'server.ts')).map(s => s.kod).join('\n');
    expect(kod).toMatch(/surumRoutes\(app, \{ surumLimiter, surumDosyasi: path\.join\(process\.cwd\(\), 'dist', SURUM_DOSYASI\) \}\);/);
    expect(kod).toMatch(/const distPath = path\.join\(process\.cwd\(\), 'dist'\);/);
  });
});
