/**
 * currency.degismez.test.ts — EKRAN para biçimi TEK KAYNAK değişmezi (Faz 2 1/n, 2026-09-05).
 *
 * Kaynak-tarayan test: göç bittikten sonra ekran kodunda (src/pages, src/components, src/App.tsx)
 * satır içi para biçimi ve yerel formatlayıcı KOPYASI kalmamalı. Yeni satır içi `₺${x.toLocaleString(…)}`
 * yazan bir PR bu testte kırılır — CLAUDE.md'nin "yarım düzeltme" sınıfına karşı kilit.
 * Yorum satırları sayılmaz (kod-hariç süzgeç). Para OLMAYAN `toLocaleString('tr-TR')` (adet/%/tarih)
 * serbesttir; yalnız ₺/TL/sembol bitişik olanlar ve `style: 'currency'` yakalanır.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const KOK = join(__dirname, '..');
const dosyalar: string[] = [];
const tara = (d: string) => { for (const ad of readdirSync(d)) { const p = join(d, ad); if (statSync(p).isDirectory()) tara(p); else if (/\.(ts|tsx)$/.test(ad) && !/\.test\.tsx?$/.test(ad)) dosyalar.push(p); } };
tara(join(KOK, 'pages')); tara(join(KOK, 'components')); dosyalar.push(join(KOK, 'App.tsx'));

const kodSatirlari = (p: string) => readFileSync(p, 'utf-8').split('\n').map((s, i) => ({ n: i + 1, kod: /^\s*(\*|\/\*|\/\/)/.test(s) ? '' : s.replace(/\/\/.*$/, '') }));
const yol = (p: string) => p.split('/src/')[1];

describe('DEĞİŞMEZ: ekran para biçimi yalnız utils/currency üzerinden', () => {
  it('tarama gerçekten oldu', () => { expect(dosyalar.length).toBeGreaterThan(60); });

  it("satır içi `₺${x.toLocaleString(…)}` / `₺{x.toLocaleString(…)}` / `… ₺` KALMADI", () => {
    const suclular: string[] = [];
    for (const p of dosyalar) for (const { n, kod } of kodSatirlari(p)) {
      if (/₺\s*[{$]\{?[^}]*\.toLocaleString\(/.test(kod) || /\.toLocaleString\([^)]*\)\}?\s*(₺|TL\b)/.test(kod)) suclular.push(`${yol(p)}:${n}`);
    }
    expect(suclular).toEqual([]);
  });

  it("`Intl.NumberFormat(…, { style: 'currency' … })` satır içi KALMADI (utils/currency hariç)", () => {
    const suclular: string[] = [];
    for (const p of dosyalar) for (const { n, kod } of kodSatirlari(p)) {
      if (/style:\s*'currency'/.test(kod)) suclular.push(`${yol(p)}:${n}`);
    }
    expect(suclular).toEqual([]);
  });

  it('yerel formatlayıcı kopyaları tek kaynağa DEVREDİLDİ (gövdesinde toLocaleString/Intl yok)', () => {
    const suclular: string[] = [];
    for (const p of dosyalar) for (const { n, kod } of kodSatirlari(p)) {
      if (/\b(fmtKpi|fmtAna|fmtTRY|formatTRY|formatCurrency|formatAmount)\s*=\s*\(/.test(kod) && /toLocaleString|Intl\.NumberFormat|toFixed/.test(kod)) suclular.push(`${yol(p)}:${n}`);
    }
    expect(suclular).toEqual([]);
  });

  it("sahte kur sabiti KALMADI (`exchangeRates?.USD || 1`, `?? 38` gibi)", () => {
    const suclular: string[] = [];
    for (const p of dosyalar) for (const { n, kod } of kodSatirlari(p)) {
      if (/exchangeRates\??\.\w+\s*(\|\||\?\?)\s*\d/.test(kod)) suclular.push(`${yol(p)}:${n}`);
    }
    expect(suclular).toEqual([]);
  });
});
