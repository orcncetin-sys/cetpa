/**
 * qSerisi.kaynak.test.ts — Q serisi Dilim 1'in KAYNAK çitleri (şartname `.wf/SARTNAME-q-serisi-v3.md` T-OKUYUCU (v2, güncellendi),
 * T-OKUYUCU EK, T31; «Kapı sonrası hükümler» QH7-3).
 *
 *   • T-OKUYUCU: `faturali` / `hasInvoice` / `mikroFaturaGonderimi` okuyucuları, `useMikroFaturalar(` çağıranları ve `mikroFaturalar`
 *     okuyan üretim dosyaları kümesi SABİT (2026-11-05 ölçümü). Yeni okuyucu eklenince bu çit kırılır: yeni dosya Q kuralını (seri Q
 *     satır faturasızdır, resmî ekranlar dışlar, MF ikizi bir kez sayılır) bilerek mi okuyor — gözden geçirilip kümeye eklenir.
 *     Çit kendi yorumuna ve dize içi metne takılmaz (yorumlar `kodSatirlari` ile, dizeler aşağıdaki `dizesiz` ile ayıklanır).
 *   • T-OKUYUCU EK: Dilim 1'in YENİ / dokunulan kodunda `'mikro-fatura'` metni yok — `MF_KAYNAGI` içe aktarılır.
 *   • T31: birleşik nokta (U+0307), ASCII'leşmiş sözcük, «GİB'e gitmez» ekran metni ve yeni ekran metninde `toUpperCase(` yok.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'fs';
import { kaynakDosyalari, kodSatirlari, gorece, SRC_KOK } from './kaynakTarama';

/** Kod satırındaki dize içeriğini boşaltır (desen dize İÇİNDEKİ metne takılmasın). */
const dizesiz = (k: string) => k.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''");
const okuyucular = (desen: RegExp): string[] =>
  kaynakDosyalari(SRC_KOK).filter(y => kodSatirlari(y).some(s => desen.test(dizesiz(s.kod)))).map(gorece).sort();

describe('T-OKUYUCU — okuyucu kümeleri SABİT (yeni okuyucu Q kuralına göre gözden geçirilir)', () => {
  it('`faturali` okuyucuları', () => {
    expect(okuyucular(/\bfaturali\b/)).toEqual([
    'src/App.tsx', 'src/components/AddOrderModal.tsx', 'src/components/FinancePanel.tsx', 'src/components/VergiTakvimi.tsx',
    'src/components/accounting/SatislarTab.tsx', 'src/components/reports/genel/GenelBloklar4.tsx', 'src/i18n/orders.ts',
    'src/pages/MuhasebePage.tsx', 'src/pages/OrdersPage.tsx', 'src/pages/RaporlarPage.tsx', 'src/server/mikro/eslemeFatura.ts',
    'src/server/mikro/seriOzet.ts', 'src/server/routes/mikroRoutes.ts', 'src/server/schemas.ts', 'src/types.ts',
    'src/utils/durumEtiketi.ts', 'src/utils/export.ts', 'src/utils/muhasebe/arYaslandirma.ts', 'src/utils/muhasebe/butceVaryans.ts',
    'src/utils/muhasebe/faturaTakipTahmin.ts', 'src/utils/muhasebe/faturalar.ts', 'src/utils/muhasebe/karZarar.ts',
    'src/utils/muhasebe/kdvAylik.ts', 'src/utils/muhasebe/mikroCiro.ts', 'src/utils/muhasebe/mutabakatMasraf.ts',
    'src/utils/muhasebe/nakitBilanco.ts', 'src/utils/muhasebe/satislar.ts', 'src/utils/siparisler/faturaDurumu.ts',
    'src/utils/siparisler/formKayit.ts', 'src/utils/siparisler/irsaliyeGonder.ts', 'src/utils/siparisler/tahsilatVade.ts',
    ]);
  });
  it('`hasInvoice` okuyucuları', () => {
    expect(okuyucular(/\bhasInvoice\b/)).toEqual([
    'src/App.tsx', 'src/components/AccountingModule.tsx', 'src/components/DunningModule.tsx', 'src/components/FinancePanel.tsx',
    'src/components/reports/genel/GenelBloklar4.tsx', 'src/pages/MuhasebePage.tsx', 'src/pages/OrdersPage.tsx',
    'src/pages/SatinAlmaPage.tsx', 'src/server/mikro/faturaBekletme.ts', 'src/server/mikro/faturaGonderimi.ts',
    'src/server/routes/mikroRoutes.ts', 'src/types.ts', 'src/utils/muhasebe/butceVaryans.ts', 'src/utils/muhasebe/mikroCiro.ts',
    'src/utils/siparisler/faturaDurumu.ts',
    ]);
  });
  it('`mikroFaturaGonderimi` okuyucuları', () => {
    expect(okuyucular(/\bmikroFaturaGonderimi\b/)).toEqual([
    'src/lib/faturaGonderimi.ts', 'src/server/mikro/faturaGonderimi.ts', 'src/server/routes/mikroRoutes.ts', 'src/types.ts',
    'src/utils/siparisler/faturaDurumu.ts', 'src/utils/siparisler/faturaGonder.ts',
    ]);
  });
  it('`useMikroFaturalar(` çağıranları (seri / faturasız alanını bu kancadan alan ekranlar)', () => {
    expect(okuyucular(/\buseMikroFaturalar\(/)).toEqual([
    'src/components/AccountingModule.tsx', 'src/components/FinancePanel.tsx', 'src/components/ProductDetail.tsx',
    'src/components/SubeModule.tsx', 'src/hooks/useMikroFaturalar.ts', 'src/pages/DashboardPage.tsx', 'src/pages/MuhasebePage.tsx',
    'src/pages/RaporlarPage.tsx', 'src/pages/SatinAlmaPage.tsx',
    ]);
  });
  it('`mikroFaturalar` okuyan üretim dosyaları', () => {
    expect(okuyucular(/\bmikroFaturalar\b/)).toEqual([
    'src/components/AccountingModule.tsx', 'src/components/DemandForecastPanel.tsx', 'src/components/FinancePanel.tsx',
    'src/components/FiyatKarsilastirmaPanel.tsx', 'src/components/ProductDetail.tsx', 'src/components/SubeModule.tsx',
    'src/components/accounting/FaturalarTab.tsx', 'src/hooks/useMikroTedarikciler.ts', 'src/lib/rbac.ts', 'src/pages/DashboardPage.tsx',
    'src/pages/MuhasebePage.tsx', 'src/pages/RaporlarPage.tsx', 'src/pages/SatinAlmaPage.tsx', 'src/server/routes/mikroRoutes.ts',
    'src/utils/muhasebe/faturaUstBilgisi.ts', 'src/utils/muhasebe/finansalOranlar.ts', 'src/utils/muhasebe/gelirGider.ts',
    'src/utils/muhasebe/kdvBeyan.ts', 'src/utils/pano/mikroBirlesim.ts',
    ]);
  });
  it('çit kendi yorumuna ve dize içi metne takılmaz', () => {
    expect(dizesiz("const a = 'faturali hasInvoice', b = `${x} faturali`;")).not.toMatch(/\bfaturali\b|\bhasInvoice\b/);
    // Yorum ayıklaması: bu dosyanın başlık yorumu (desen adlarını taşır) kod satırlarına girmez.
    const kod = kodSatirlari(join(SRC_KOK, 'test/qSerisi.kaynak.test.ts')).map(s => s.kod).join('\n');
    expect(kod.includes(['T-OKUYUCU EK: Dilim 1', 'in YENİ'].join("'"))).toBe(false);
  });
});

/** Dilim 1'in yeni / dokunulan üretim dosyaları (T-OKUYUCU EK ve T31 kapsamı). */
const DILIM1 = [
  'lib/faturasizSeri.ts', 'lib/faturaEvrakKosulu.ts', 'lib/mfKaynagi.ts', 'utils/muhasebe/faturasizDisi.ts', 'utils/muhasebe/satislar.ts',
  'utils/pano/mikroBirlesim.ts', 'utils/muhasebe/mikroCiro.ts', 'utils/durumEtiketi.ts', 'utils/muhasebe/babsKdvAnaliz.ts',
  'utils/muhasebe/kdvBeyan.ts', 'utils/muhasebe/mizan.ts', 'utils/muhasebe/nakitBilanco.ts', 'utils/muhasebe/gelirGider.ts',
  'utils/muhasebe/faturalar.ts', 'utils/muhasebe/butceVaryans.ts', 'hooks/useMikroFaturalar.ts', 'server/mikro/seriOzet.ts',
  'server/mikro/eslemeFatura.ts', 'server/mikro/govdeMuhasebe.ts', 'components/DekontModal.tsx', 'components/FinancePanel.tsx',
  'components/accounting/SatislarTab.tsx', 'components/accounting/FaturalarTab.tsx', 'components/accounting/KdvTab.tsx',
  'components/accounting/GelirGiderTab.tsx', 'i18n/accounting.ts', 'i18n/muhasebe.ts', 'i18n/orders.ts',
];

describe('T-OKUYUCU EK — yeni kodda `\'mikro-fatura\'` metni YOK (QH7-3)', () => {
  it('Dilim 1 dosyalarının kodunda (yorum hariç) kaynak değeri yalnız `lib/mfKaynagi`\'nda yazılır', () => {
    const suclu: string[] = [];
    for (const ad of DILIM1) {
      if (ad === 'lib/mfKaynagi.ts') continue;
      for (const { n, kod } of kodSatirlari(join(SRC_KOK, ad))) if (/'mikro-fatura'/.test(kod) && !/source: 'mikro-siparis' \| 'mikro-fatura'|^\s*source: 'mikro-fatura',$/.test(kod)) suclu.push(`${ad}:${n} ${kod.trim()}`);
    }
    expect(suclu).toEqual([]);
  });
  it('Raporlar tekilleştirmesi ve sentetik kayıt `MF_KAYNAGI`\'na bağlı (dokunulan işlevde metin yok)', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'pages/RaporlarPage.tsx')).map(s => s.kod).join('\n');
    const i = kod.indexOf('const orders = useMemo<Order[]>');
    const govde = kod.slice(i, kod.indexOf('}, [ordersProp, mikroFaturalar, cariAdMap]);', i));
    expect(govde).not.toContain("'mikro-fatura'");
    expect(govde).toContain('MF_KAYNAGI');
  });
});

describe('T31 — Türkçe karakter ve büyük harf çitleri (Dilim 1 dosyaları)', () => {
  const metin = (ad: string) => readFileSync(join(SRC_KOK, ad), 'utf-8');
  it('birleşik nokta (U+0307) yok', () => {
    for (const ad of DILIM1) expect(metin(ad).includes('\u0307'), ad).toBe(false);
  });
  it('ASCII\'leşmiş Türkçe sözcük ve bozuk kodlama yok', () => {
    const desen = /\b(iletisim|gonderim|urun|sektor|aydinlatma|faturasiz satis|dahil degil|kayit tutarsiz)\b|Ã|Ä/;
    for (const ad of DILIM1) {
      const satirlar = metin(ad).split('\n').filter(s => desen.test(s.replace(/[A-Za-z0-9_]+(?=\s*[:(=,)\]}])|['"`][a-z0-9_-]+['"`]/g, '')));
      expect(satirlar, ad).toEqual([]);
    }
  });
  it('«GİB\'e gitmez» / «does not go to GİB» ekran metni src\'de (test dışı) yok', () => {
    const suclu = kaynakDosyalari(SRC_KOK).filter(y => kodSatirlari(y).some(s => /GİB'e gitmez|does not go to GİB/.test(s.kod))).map(gorece);
    expect(suclu).toEqual([]);
  });
  it('yeni ekran metinlerinde `toUpperCase(` yok', () => {
    for (const ad of ['utils/muhasebe/faturasizDisi.ts', 'utils/durumEtiketi.ts', 'components/accounting/SatislarTab.tsx',
      'components/accounting/FaturalarTab.tsx', 'components/accounting/KdvTab.tsx', 'components/accounting/GelirGiderTab.tsx']) {
      expect(kodSatirlari(join(SRC_KOK, ad)).filter(s => /toUpperCase\(/.test(s.kod)).map(s => `${ad}:${s.n}`)).toEqual([]);
    }
  });
});

/** Dosyanın yorumsuz kod metni (çok satırlı desen için satırlar birleşik). */
const kodu = (ad: string) => kodSatirlari(join(SRC_KOK, ad)).map(s => s.kod).join('\n');

describe('BAĞLANTI — sayfa düzeyi çağıranlar (yazıldı ama bağlanmadı çiti; sekme düzeyi `components/accounting/qSerisi.sekmeler.test.tsx`)', () => {
  it('AccountingModule: mizan notu, Gelir/Gider notu ve Satışlar ölçüsü GERÇEK hesaptan geçirilir', () => {
    const k = kodu('components/AccountingModule.tsx');
    expect(k).toMatch(/mizanNotu=\{\[[\s\S]*?faturasizDisiNotu\(mikroMizan\.faturasizDisi, currentLanguage\),[\s\S]*?\]\.filter\(Boolean\)/);
    expect(k).toMatch(/faturasizNotu=\{faturasizDisiNotu\(ggOzeti\.faturasizDisi, currentLanguage\)\}/);
    expect(k).toMatch(/const satisCiftSayim = mikroDahil \? satisCiftSayimOzeti\(orders, satisIkizleri\) : null;/);
    expect(k).toMatch(/kdvDonem=\{kdvDonem\}/);
  });
  it('MuhasebePage: KDV borcu / Ba-Bs / KDV analizi / e-Fatura Takip notları kendi işlevinin `faturasizDisi`\'nden çizilir', () => {
    const k = kodu('pages/MuhasebePage.tsx');
    for (const [kaynak, ad] of [['kdvT547', 'kdv-borcu'], ['f', 'babs'], ['kdv', 'kdv-analizi']] as const) {
      expect(k, ad).toMatch(new RegExp(`\\{faturasizDisiNotu\\(${kaynak}\\.faturasizDisi, currentLanguage\\) && \\(\\s*<p data-faturasiz-notu="${ad}"`));
    }
    expect(k).toMatch(/const qNotu564 = faturasizDisiNotu\(ozet564\.faturasizDisi, currentLanguage\);/);
    expect(k).toMatch(/\{qNotu564 && <p data-faturasiz-notu="fatura-takip"/);
    expect(k).toMatch(/\{takip564\.faturasizAdet > 0 && \(\s*<p data-faturasiz-siparis-notu/);
  });
  it('MuhasebePage: e-Fatura Takip tablosu ve Mikro sayaçları süzülmüş kümeden; KDV Mutabakat Q KDV notu bağlı', () => {
    const k = kodu('pages/MuhasebePage.tsx');
    expect(k).toMatch(/const takip564 = faturaTakipSiparisleri\(orders\);\s*const allBillable = takip564\.liste;/);
    expect(k).toMatch(/const ozet564 = faturaTakipMikroOzeti\(mikroFaturalar, /);
    for (const s of ['val: ozet564.toplam,', 'val: ozet564.giden.length,', 'val: gelen564.length,', 'val: ozet564.gelenBuAy,']) expect(k).toContain(s);
    expect(k).not.toMatch(/val: mikroFaturalar\.length/);
    expect(k).toMatch(/\(m617\.faturasizKdv\.toplam !== 0 \|\| m617\.faturasizKdv\.bilinmeyen > 0\) \? mc\(tr617\)\.faturasiz_q_kdv_notu/);
  });
  it('SatislarTab: rozet metni yalnız sözlükten — kodda sabit FATURALI / FATURASIZ yok; tablo + iki drill-down `faturasizEtiketi ?? faturali_rozet` (Q7); MF notu `bg-blue-50` (Q8)', () => {
    const satirlar = kodSatirlari(join(SRC_KOK, 'components/accounting/SatislarTab.tsx'));
    expect(satirlar.filter(s => /\bFATURALI\b|\bFATURASIZ\b/.test(s.kod)).map(s => `${s.n} ${s.kod.trim()}`)).toEqual([]);
    const k = satirlar.map(s => s.kod).join('\n');
    expect(k.match(/badge: faturasizEtiketi\(o, currentLanguage\) \?\? op\(currentLanguage\)\.faturali_rozet/g)?.length).toBe(2);
    expect(k).toMatch(/\{faturasizEtiketi\(o, currentLanguage\) === null\s*\? <span [^>]*>\{op\(currentLanguage\)\.faturali_rozet\}<\/span>/);
    expect(k).toMatch(/<div data-mf-ikizi-notu className="[^"]*\bbg-blue-50 /);
    expect(k).not.toMatch(/data-mf-ikizi-notu[^>]*bg-blue-50\//);
    // Sözlük: büyük harf YAZILI (toUpperCase yok), iki dilde.
    const sozluk = readFileSync(join(SRC_KOK, 'i18n/orders.ts'), 'utf-8');
    expect(sozluk).toContain("faturali_rozet: 'FATURALI',");
    expect(sozluk).toContain("faturali_rozet: 'INVOICED',");
  });
  it('MuhasebePage: KDV Mutabakat «Faturasız / muaf» satırı MATRAH basar (`faturasizMatrah`; satırlar = kart), meblağ basmaz', () => {
    const k = kodu('pages/MuhasebePage.tsx');
    expect(k).toMatch(/const faturasizMatrah = ekranTutari\(m617\.faturasizMatrah\);/);
    expect(k).toMatch(/const faturasizTutarsiz = Math\.max\(m617\.faturasizMatrah\.bilinmeyen, m617\.faturasizTutar\.bilinmeyen\);/);
    expect(k).toMatch(/<span className="font-bold text-gray-500">\{mc\(tr617\)\.faturasiz_muaf\}<\/span>\s*<span className="tabular-nums text-gray-600">\{paraYaz\(faturasizMatrah, \{ ondalik: 0 \}\)\}<\/span>/);
    expect(k).toMatch(/\{faturasizTutarsiz > 0 && <span className="text-amber-600"> · \{tutarsiz617\(faturasizTutarsiz\)\}<\/span>\}/);
    expect(k).not.toMatch(/ekranTutari\(m617\.faturasizTutar\)/);
  });
  it('OrdersPage: MF rozeti (liste + mobil) seriden — `faturasizEtiketi` MF dalında İKİ kez koşul, faturasız dalında metin', () => {
    const k = kodu('pages/OrdersPage.tsx');
    expect(k).toMatch(/faturasizEtiketi\(order, currentLanguage\) \? \(\s*<span data-faturasiz-rozet=\{order\.id\}/);
    expect(k).toMatch(/faturasizEtiketi\(order, currentLanguage\) \? \(\s*<span className="text-\[8px\]/);
    expect(k.match(/\{faturasizEtiketi\(order, currentLanguage\)\}/g)?.length).toBe(3);
  });
  it('FinancePanel: üç sayaç `finansSiparisSayaclari` çıktısını basar (eski formül yok)', () => {
    const k = kodu('components/FinancePanel.tsx');
    for (const s of ['value: siparisSayaclari.faturali,', 'value: siparisSayaclari.faturasiz,', 'value: siparisSayaclari.toplam,']) expect(k).toContain(s);
    expect(k).not.toMatch(/orders\.filter\(o => !?o\.hasInvoice\)\.length/);
  });
  it('RaporlarPage: seri Q sentetiği `faturali: false` taşır (Q10-2); diğer satırda alan yazılmaz', () => {
    expect(kodu('pages/RaporlarPage.tsx')).toMatch(/\.\.\.\(f\.faturasiz \? \{ faturali: false \} : \{\}\),/);
  });
});
