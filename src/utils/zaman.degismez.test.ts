/**
 * zaman.degismez.test.ts — TARİH çözüm/gösterim TEK KAYNAK değişmezi (Faz 2 2/n, 2026-09-12).
 *
 * Kaynak-tarayan test: ekran kodunda (src/pages, src/components, src/App.tsx, utils/pdf.ts, utils/export.ts)
 * yerel Timestamp çözücü kopyası, satır içi `toLocaleDateString('tr-TR')`, UTC gün anahtarı
 * (`toISOString().slice(0,10)`) ve "bilinmeyen tarih = bugün" yedeği (`?? new Date()`) KALMAMALI.
 * Yorum satırları sayılmaz. Yeni satır içi tarih kodu yazan PR burada kırılır.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const KOK = join(__dirname, '..');
const dosyalar: string[] = [];
const tara = (d: string) => { for (const ad of readdirSync(d)) { const p = join(d, ad); if (statSync(p).isDirectory()) tara(p); else if (/\.(ts|tsx)$/.test(ad) && !/\.test\.tsx?$/.test(ad)) dosyalar.push(p); } };
tara(join(KOK, 'pages')); tara(join(KOK, 'components')); dosyalar.push(join(KOK, 'App.tsx'), join(KOK, 'utils', 'pdf.ts'), join(KOK, 'utils', 'export.ts'));

const kodSatirlari = (p: string) => readFileSync(p, 'utf-8').split('\n').map((s, i) => ({ n: i + 1, kod: /^\s*(\*|\/\*|\/\/)/.test(s) ? '' : s.replace(/\/\/.*$/, '') }));
const yol = (p: string) => p.split('/src/')[1];
const tarayici = (r: RegExp) => { const s: string[] = []; for (const p of dosyalar) for (const { n, kod } of kodSatirlari(p)) if (r.test(kod)) s.push(`${yol(p)}:${n}`); return s; };

describe('DEĞİŞMEZ: tarih çözümü ve gösterimi yalnız utils/zaman üzerinden', () => {
  it('tarama gerçekten oldu', () => { expect(dosyalar.length).toBeGreaterThan(60); });
  it('yerel Timestamp çözücü kopyası KALMADI (`x?.toDate ? … : new Date(x)`, `toDate?.() ?? new Date`, `seconds * 1000`)', () => {
    expect(tarayici(/\?\.toDate\s*\?|toDate\(\)\s*:\s*new Date\(|toDate\?\.\(\)\s*\?\?\s*new Date|[._]seconds\s*\*\s*1000|instanceof Timestamp\s*\?/)).toEqual([]);
  });
  it("satır içi `toLocaleDateString('tr-TR'` KALMADI (tarihYaz)", () => {
    expect(tarayici(/\.toLocaleDateString\(/)).toEqual([]);
  });
  it('UTC gün anahtarı `toISOString().slice(0, 10)` KALMADI (bugunAnahtari / gunAnahtari)', () => {
    expect(tarayici(/toISOString\(\)\.(slice|substring)\(0,\s*(10|7)\)|toISOString\(\)\.split\('T'\)\[0\]/)).toEqual([]);
  });
  it('bilinmeyen tarih BUGÜN olmaz: `?? new Date()` / `|| new Date()` yedeği KALMADI', () => {
    expect(tarayici(/(\?\?|\|\|)\s*new Date\(\)(?!\.get)/)).toEqual([]);   // `|| new Date().getFullYear()` (yıl girişi varsayılanı) tarih yedeği değildir
  });
});
