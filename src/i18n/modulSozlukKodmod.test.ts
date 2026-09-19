/**
 * modulSozlukKodmod.test.ts — scripts/modul-sozluk-kodmod.py'yi GEÇİCİ bir kökte (`KODMOD_KOK`) gerçekten koşturur.
 *
 * NEDEN (2026-09-19, Faz 3 4/n): betiğin iki yolu var — sözlük dosyası YOKKEN sıfırdan üretim, VARKEN ekleme. 2/n'de
 * sözlük önceden `at-tasi.py` ile yaratıldığı için hep EKLEME yolu koştu; SIFIRDAN ÜRETİM yolu ilk kez 4/n'de çalıştı
 * ve bozuk TypeScript yazdı (`}},` / `{{` — f-string olmayan dizgede çift süslü). tsc yakaladı ama betiğin kendisini
 * koşturan bir test olsaydı hata o gün değil yazıldığı gün görünürdü. Python yoksa test ATLANIR (CI Windows koşucusu).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BETIK = resolve(__dirname, '../../scripts/modul-sozluk-kodmod.py');
const pythonVar = spawnSync('python3', ['--version']).status === 0;

function kokKur(): string {
  const kok = mkdtempSync(join(tmpdir(), 'kodmod-'));
  mkdirSync(join(kok, 'src/pages'), { recursive: true });
  writeFileSync(join(kok, 'src/pages/Ornek.tsx'), [
    "import React from 'react';",
    "export default function Ornek({ currentLanguage }: { currentLanguage: string }) {",
    "  // yorumdaki çift taşınmaz: currentLanguage === 'tr' ? 'Yorum' : 'Comment'",
    "  return <p title={currentLanguage === 'tr' ? 'Sipariş güncellendi.' : 'Order updated.'}>{currentLanguage === 'tr' ? \"Depo seçin\" : \"Select a warehouse\"}</p>;",
    "}",
    "",
  ].join('\n'));
  return kok;
}
const kos = (kok: string) => execFileSync('python3', [BETIK, 'src/pages/Ornek.tsx', 'ornek', 'ok'], { env: { ...process.env, KODMOD_KOK: kok }, encoding: 'utf8' });

describe.skipIf(!pythonVar)('modul-sozluk-kodmod.py — gerçek koşu (geçici kök)', () => {
  it('SIFIRDAN ÜRETİM: geçerli TS yazar — tek süslü, tr/en anahtar kümeleri eşit (mutasyon-ayırt-edici: `}},` regresyonu)', () => {
    const kok = kokKur();
    try {
      kos(kok);
      const sozluk = readFileSync(join(kok, 'src/i18n/ornek.ts'), 'utf8');
      expect(sozluk).not.toMatch(/\{\{|\}\}/);
      expect(sozluk).toContain("export const ORNEK = {\n  tr: {\n");
      expect(sozluk).toContain("\n  },\n  en: {\n");
      expect(sozluk).toContain("\n  },\n} as const;");
      expect(sozluk).toContain("siparis_guncellendi: 'Sipariş güncellendi.',");
      expect(sozluk).toContain("siparis_guncellendi: 'Order updated.',");
      expect(sozluk).toContain(' * Kapsam: src/pages/Ornek.tsx');
      const sayfa = readFileSync(join(kok, 'src/pages/Ornek.tsx'), 'utf8');
      expect(sayfa).toContain('ok(currentLanguage).siparis_guncellendi');
      expect(sayfa).toContain('ok(currentLanguage).depo_secin');
      expect(sayfa).toContain("import { ok } from '../i18n/ornek';");
      expect(sayfa).toContain("// yorumdaki çift taşınmaz: currentLanguage === 'tr' ? 'Yorum' : 'Comment'");
    } finally { rmSync(kok, { recursive: true, force: true }); }
  });

  it('EKLEME: ikinci koşu mevcut anahtarları SİLMEZ, yalnız yenisini ekler; idempotent', () => {
    const kok = kokKur();
    try {
      kos(kok);
      const sayfaYolu = join(kok, 'src/pages/Ornek.tsx');
      writeFileSync(sayfaYolu, readFileSync(sayfaYolu, 'utf8').replace('</p>;', "{currentLanguage === 'tr' ? 'Yeni metin' : 'New text'}</p>;"));
      kos(kok);
      const sozluk = readFileSync(join(kok, 'src/i18n/ornek.ts'), 'utf8');
      expect(sozluk).toContain("siparis_guncellendi: 'Sipariş güncellendi.',");
      expect(sozluk).toContain("yeni_metin: 'Yeni metin',");
      expect(sozluk).toContain("yeni_metin: 'New text',");
      expect(sozluk).not.toMatch(/\{\{|\}\}/);
      const once = sozluk;
      kos(kok);
      expect(readFileSync(join(kok, 'src/i18n/ornek.ts'), 'utf8')).toBe(once);
    } finally { rmSync(kok, { recursive: true, force: true }); }
  });
});
