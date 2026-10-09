/**
 * DEĞİŞMEZ: `cron.schedule` ve `node-cron` importu yalnız `src/server/zamanla.ts`
 * içinde bulunur. Sebep: dilimsiz cron süreç saatine bağlıdır — canlı sunucu
 * Pasifik dilimindeyken 9 iş +10 saat kaymıştı (2026-09-24). Yeni bir cron
 * `zamanla(...)` ile yazılır. Kaynak taranır; yorumlar ortak süzgeçle atılır
 * (`src/test/kaynakTarama`).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { kodSatirlari } from '../test/kaynakTarama';

const KOK = join(__dirname, '..', '..');
const IZINLI = 'src/server/zamanla.ts';
const dosyalar: string[] = [join(KOK, 'server.ts')];
const tara = (d: string) => {
  for (const ad of readdirSync(d)) {
    const p = join(d, ad);
    if (statSync(p).isDirectory()) tara(p);
    else if (/\.ts$/.test(ad) && !/\.test\.ts$/.test(ad) && !/testDuzenegi/.test(ad)) dosyalar.push(p);
  }
};
tara(join(KOK, 'src', 'server'));

// Paket ADINA bağlı desen: statik import, `await import('node-cron')`, `require(...)`
// ve `createRequire(...)('node-cron')` hepsini tek başına yakalar (inceleme 2026-09-24).
const DESENLER: [string, RegExp][] = [
  ['cron.schedule(', /\bcron\.schedule\s*\(/],
  ["'node-cron' dizgesi (her import biçimi)", /['"]node-cron['"]/],
];

describe('DEĞİŞMEZ: zamanlanmış iş yalnız zamanla() ile', () => {
  it('tarama gerçekten oldu', () => { expect(dosyalar.length).toBeGreaterThan(20); });
  for (const [ad, re] of DESENLER) {
    it(`${ad} — zamanla.ts dışında YOK`, () => {
      const suclular: string[] = [];
      for (const p of dosyalar) {
        const rel = relative(KOK, p);
        if (rel === IZINLI) continue;
        for (const { n, kod } of kodSatirlari(p)) {
          if (re.test(kod)) suclular.push(`${rel}:${n}: ${kod.trim()}`);
        }
      }
      expect(suclular, suclular.join('\n')).toEqual([]);
    }, 60_000);   // server.ts + src/server tek testte ayrıştırılır
  }
  it('zamanla.ts kendisi node-cron kullanıyor (tarama kör değil)', () => {
    // Taramanın gördüğü aynı metin (yorumsuz kod): desen yalnız yorumda geçiyorsa bu denetim kırılır.
    const kaynak = kodSatirlari(join(KOK, IZINLI)).map(s => s.kod).join('\n');
    expect(kaynak).toMatch(DESENLER[0][1]);
    expect(kaynak).toMatch(DESENLER[1][1]);
  });
  it('desen dinamik import / require biçimlerini de yakalar (negatif kontrol)', () => {
    const re = DESENLER[1][1];
    expect(re.test("const { schedule } = await import('node-cron');")).toBe(true);
    expect(re.test('const nc = require("node-cron");')).toBe(true);
    expect(re.test("createRequire(import.meta.url)('node-cron')")).toBe(true);
    expect(re.test("import { zamanla } from './zamanla.js';")).toBe(false);
  });
});
