/**
 * pdfTheme.degismez.test.ts — PDF bandı/renk TEK KAYNAK değişmezi (Faz 2 3/n, 2026-09-12).
 *
 * Kaynak-tarayan test: pdfTheme.ts DIŞINDA (pages, components, utils) marka rengi sabiti, elle başlık/alt bandı,
 * "CETPA • cetpa.com.tr" alt bilgi metni ve palet kopyası (DARK/GREY/LIGHT) KALMAMALI. Yorumlar sayılmaz.
 * Faz 0 ölçümü: 6 dosyada renk sabiti kopyası, 21 elle rect, 3 farklı alt bant. Yeni PDF üreten bir PR burada kırılır.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const KOK = join(__dirname, '..');
const dosyalar: string[] = [];
const tara = (d: string) => { for (const ad of readdirSync(d)) { const p = join(d, ad); if (statSync(p).isDirectory()) tara(p); else if (/\.(ts|tsx)$/.test(ad) && !/\.test\.tsx?$/.test(ad) && !p.endsWith('/pdfTheme.ts')) dosyalar.push(p); } };
tara(join(KOK, 'pages')); tara(join(KOK, 'components')); tara(join(KOK, 'utils')); dosyalar.push(join(KOK, 'App.tsx'));
const kodSatirlari = (p: string) => readFileSync(p, 'utf-8').split('\n').map((s, i) => ({ n: i + 1, kod: /^\s*(\*|\/\*|\/\/)/.test(s) ? '' : s.replace(/\/\/.*$/, '') }));
const yol = (p: string) => p.split('/src/')[1];
const tarayici = (r: RegExp) => { const s: string[] = []; for (const p of dosyalar) for (const { n, kod } of kodSatirlari(p)) if (r.test(kod)) s.push(`${yol(p)}:${n}`); return s; };

describe('DEĞİŞMEZ: PDF bandı ve paleti yalnız utils/pdfTheme üzerinden', () => {
  it('tarama gerçekten oldu', () => { expect(dosyalar.length).toBeGreaterThan(60); });
  it('marka rengi sabiti (255, 64, 0) ve palet kopyaları (29,29,31 / 134,134,139 / 245,245,247) KALMADI', () => {
    // jsPDF bağlamı: `setXColor(255, 64, 0)` ya da `[255, 64, 0]` dizisi — CSS `rgba(255,64,0,…)` (UI) bu testin konusu değil.
    const RENK = '(255,\\s*64,\\s*0|29,\\s*29,\\s*31|134,\\s*134,\\s*139|245,\\s*245,\\s*247)';
    expect(tarayici(new RegExp(`(?<!rgba)\\(\\s*${RENK}\\s*\\)|\\[\\s*${RENK}\\s*\\]`))).toEqual([]);
  });
  it("elle başlık bandı (`rect(0, 0, W, 32|28|26, 'F')`) ve elle alt bant (`rect(0, H - 14…`) KALMADI", () => {
    expect(tarayici(/\.rect\(0,\s*0,\s*\w+,\s*(32|28|26)\b|\.rect\(0,\s*\w+\s*-\s*1[24],/)).toEqual([]);
  });
  it("'CETPA  •  cetpa.com.tr' alt bilgi metni ve `Sayfa ${…} / ${…}` döngüsü yalnız pdfTheme'de", () => {
    expect(tarayici(/cetpa\.com\.tr\s+•|Sayfa \$\{\w+\} \/ \$\{/)).toEqual([]);
  });
});
