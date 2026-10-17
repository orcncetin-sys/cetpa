/**
 * surumEklentisi.ts — derleme anında SÜRÜM KİMLİĞİ üreten Vite eklentisi (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S1).
 *
 * KİMLİK = PAKET KARMASI. Derleme zamanı + kısa commit de seçenekti; ölçüm (2026-10-17):
 *  • `deploy/windows/deploy.ps1` istemciyi `npm run build` (yavaş yol) ya da `npm run build -- --outDir dist.new --emptyOutDir`
 *    (hızlı yol) ile derler; ikisi de `vite build`'dir, araya başka adım girmez. Commit için `git`'e dışarıdan sormak gerekirdi,
 *    derleme zamanı ise aynı içeriği her derlemede «yeni sürüm» yapardı.
 *  • `vite.config.ts` `define` yalnız derleme ÖNCESİ bilinen değeri gömer; paket karması o anda henüz yoktur (karmayı JS'e
 *    gömmek JS'in kendi karmasını değiştirirdi — döngü).
 * Bu yüzden kimlik, üretilen paketin dosya adlarından (Vite her parçaya içerik karması koyar: `assets/index-<karma>.js`) ve son
 * `index.html`'den hesaplanır; hiçbir dış araca dayanmaz, aynı içerik aynı kimliği verir. İstemciye `index.html`'deki
 * `<meta name="cetpa-surum">` ile gömülür (HTML'in kendisi karma taşımaz, döngü yok); sunucuya çıktı dizinindeki `surum.json` ile.
 *
 * İKİ YOL AYNI DOSYAYI ÜRETİR: `surum.json` `writeBundle`'da Rollup'ın GERÇEK çıktı dizinine (`options.dir`) yazılır —
 * `--outDir dist.new` verilince `dist.new/`, verilmezse `dist/`. Hızlı yolda `deploy.ps1` `dist.new`'i `dist`'e çevirir;
 * sunucu `dist/surum.json`'u okur.
 *
 * KİMLİK ELDE EDİLEMEZSE (geliştirme sunucusu, `index.html`'siz derleme): meta yazılmaz, `surum.json` yazılmaz → istemci gömülü
 * kimliği bulamaz, sunucu `{ surum: null }` verir → bildirim çıkmaz, hata da çıkmaz. Kimlik UYDURULMAZ.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { SURUM_DOSYASI, SURUM_META_ADI } from '../lib/surumKimligi';

/**
 * Paket dosya adları (içerik karmalı) + son `index.html` → 16 haneli onaltılık kimlik. Sıra bağımsız (adlar sıralanır).
 * `html` meta eklenmeden ÖNCEKİ metindir (eklenen meta kimliğin kendisini taşır).
 */
export function surumKimligiUret(dosyaAdlari: readonly string[], html: string): string {
  const karma = createHash('sha256');
  for (const ad of [...dosyaAdlari].sort()) karma.update(`${ad}\n`);
  karma.update('\u0000');
  karma.update(html);
  return karma.digest('hex').slice(0, 16);
}

export function surumEklentisi(): Plugin {
  let kimlik: string | null = null;
  return {
    name: 'cetpa-surum',
    apply: 'build',
    buildStart() { kimlik = null; },
    transformIndexHtml: {
      // `post`: Vite betik / stil etiketlerini (karmalı adlarıyla) yerleştirdikten SONRA — karma son HTML'den hesaplansın.
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;                       // geliştirme sunucusu: paket yok, kimlik yok
        kimlik = surumKimligiUret(Object.keys(ctx.bundle), html);
        return { html, tags: [{ tag: 'meta', attrs: { name: SURUM_META_ADI, content: kimlik }, injectTo: 'head' }] };
      },
    },
    writeBundle(options) {
      if (kimlik === null || !options.dir) return;
      writeFileSync(join(options.dir, SURUM_DOSYASI), `${JSON.stringify({ surum: kimlik })}\n`, 'utf8');
    },
  };
}
