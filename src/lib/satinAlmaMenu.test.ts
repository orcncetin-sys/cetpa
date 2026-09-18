/**
 * satinAlmaMenu.test.ts — Satın Alma alt sekmeleri TEK KAYNAK (ÖNCE yazıldı, 2026-09-18).
 *
 * KULLANICI BİLDİRİMİ: "Mobilde Satın Alma'da menü soldan sağa kaymıyor, Fiyat Karşılaştırma'ya girilemiyor."
 * İki arıza üst üsteydi: (1) mobil sekme barı `w-fit` idi ve kaydırma kabı yoktu → taşan sekmelere ulaşılamıyordu;
 * (2) bar 8 sekmenin yalnız 5'ini ELLE listeliyordu (Tedarikçi Portalı / Satın Alma Bütçesi / Tedarik Zinciri Riski
 * mobilde hiç yoktu), kenar menü ise ayrı bir elle listeydi ve aynı sekmeye farklı ad veriyordu
 * ("Tedarikçi Performansı" ↔ "Tedarikçi Skorkartı"). CLAUDE.md: grup üyeliğini tek kaynaktan türet, elle çoğaltma.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SATIN_ALMA_MENU } from './satinAlmaMenu';

const kaynak = (yol: string) => readFileSync(join(__dirname, '..', yol), 'utf-8');

describe('SATIN_ALMA_MENU — alt sekmelerin tek listesi', () => {
  it('8 sekmenin hepsi var; Fiyat Karşılaştırma dâhil; sıra kenar menüdeki sıra', () => {
    expect(SATIN_ALMA_MENU.map(m => m.key)).toEqual([
      'pos', 'suppliers', 'scorecard', 'odeme-takvimi', 'tedarikci-portal', 'satin-butce', 'tedarik-risk', 'fiyat-karsilastirma',
    ]);
  });
  it('etiketler iki dilde dolu ve birbirinden farklı anahtarlar tekrar etmiyor', () => {
    const tr = SATIN_ALMA_MENU.map(m => m.etiket(true)), en = SATIN_ALMA_MENU.map(m => m.etiket(false));
    expect(tr.every(Boolean) && en.every(Boolean)).toBe(true);
    expect(new Set(tr).size).toBe(tr.length);
    expect(tr).toContain('Fiyat Karşılaştırma');
  });
});

describe('DEĞİŞMEZ: kenar menü ve mobil sekme barı listeden TÜRER (elle alt küme yok)', () => {
  it('SatinAlmaPage mobil barı SATIN_ALMA_MENU.map ile çizilir ve yatay kaydırılabilir', () => {
    const s = kaynak('pages/SatinAlmaPage.tsx');
    expect(s).toMatch(/SATIN_ALMA_MENU\.map\(/);
    // KOD-HARİÇ süzgeç: bölüm başlığı yorumu eski sınıfı ANLATIYOR ("bar `w-fit` idi") — iddia yoruma takılmasın.
    // Dilim, başlık yorumunun KAPANIŞINDAN ("*/}") sonra başlar.
    const baslik = s.indexOf('Sub-tab switcher');
    const bar = s.slice(s.indexOf('*/}', baslik) + 3, s.indexOf('{/* Purchase Orders */}'));
    expect(bar).toMatch(/overflow-x-auto/);          // kaydırma kabı
    expect(bar).not.toMatch(/\bw-fit\b/);            // taşmayı kesen eski sınıf
    expect(bar).toMatch(/whitespace-nowrap/);        // sekme adı iki satıra bölünüp barı daraltmasın
  });
  it('App.tsx kenar menüsü de aynı listeden türer', () => {
    expect(kaynak('App.tsx')).toMatch(/SATIN_ALMA_MENU\.map\(/);
  });
});
