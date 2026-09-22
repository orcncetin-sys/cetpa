/**
 * rapor6a.degismez.test.ts — Faz 3 6a KAPANIŞ ÖLÇÜSÜ (2026-09-20).
 *
 * Neden var: PLAN-v2 §5 "6a yalnız kendi üç dosyası için SERT 1–3 = 0 değişmezini yazar" diyor
 * ama 17 şartnamenin hiçbiri testin sahibini vermiyordu (sahipsiz iş). §5'in İMPORT taraması da
 * (`git grep "<ad>"`) tanım satırını ve test dosyalarını saydığı için HER ZAMAN geçiyordu —
 * yani ölçü yoktu. Bu dosya ikisini kapatır:
 *   §1  üç 6a dosyasında SERT 1–3 kod satırı = 0 (izin listesi mekanizması var, hedef BOŞ)
 *   §2  `src/utils/rapor/*`'ın her export'unun ÜRETİM tüketicisi var (içe aktarım çözümlemesi)
 *   §4  K4 yarım düzeltme koruması: müşteri modülüne İKİ dosya da bağlanmış
 *
 * Test bir ÖLÇÜDÜR, onarım aracı DEĞİL: kırmızıysa kaçırılmış site demektir — izin listesine
 * girdi ekleyerek ya da deseni gevşeterek yeşile çevirme, kaçıran grubun dosyasını düzelt.
 *
 * Hafıza dersi ("assertion kendi yorumuna takıldı ×5"): üç dosyada desenleri ANAN yorumlar VAR
 * ve kalacak (ölçüm 2026-09-20: 11 anma — useReportsData 57/143/193/353/401, RaporlarPage
 * 353/772/904, GenelOzet 273/342/575). Süzgeç satır başına bakmakla yetinmez; §0 onu sınar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');                 // src/components/reports → src
const RAPOR_DIZIN = join(SRC, 'utils', 'rapor');

// ---------------------------------------------------------------------------
// §0 · Saf tarayıcılar
// ---------------------------------------------------------------------------

// yorumsuz(): yorumları atar, SATIR NUMARASINI korur — blok yorumu ve JSX süslü-yorumu
// boş satırlara iner, satır sonu `// …` kesilir, `https://` KESİLMEZ (öncesinde `:` var).
// (Bilerek JSDoc değil: içine yorum kapatıcı yazılamayacağı için açıklama sakatlanırdı.)
function yorumsuz(icerik: string): string[] {
  return icerik
    .replace(/\/\*[\s\S]*?\*\//g, blok => blok.replace(/[^\n]/g, ''))
    .split('\n')
    .map(satir => satir.replace(/(^|[^:])\/\/.*$/, '$1'));
}

// Desenler PLAN-v2 §5 SERT 1–3 ile BİREBİR (kopya; "iyileştirme" yok).
// SERT 4 (`.total === 'number'`, `.stock`, `itemCostTRY(`) bu teste GİRMEZ — 6d/6h'nin işi.
const SERT = {
  S1: [/(\|\||\?\?)\s*0\b/],
  S2: [/Math\.max\([^;]*,\s*1\)/, /Math\.max\(\s*[234]\s*,/, /Math\.max\([^;]*,\s*[234]\)/],
  S3: [/(\?\?|\|\|)\s*(1|5|999)\b/, /\*\s*0\.6\b/, /Number\(e\.target\.value\)/],
} as const;
type Sinif = keyof typeof SERT;
const SINIFLAR: Sinif[] = ['S1', 'S2', 'S3'];

interface Ihlal { dosya: string; satir: number; sinif: Sinif; kod: string }

function sertIhlalleri(dosya: string, icerik: string): Ihlal[] {
  const bulgular: Ihlal[] = [];
  yorumsuz(icerik).forEach((kod, i) => {
    for (const sinif of SINIFLAR) {
      if (SERT[sinif].some(desen => desen.test(kod))) bulgular.push({ dosya, satir: i + 1, sinif, kod });
    }
  });
  return bulgular;
}

const yaz = (i: Ihlal) => `${i.dosya}:${i.satir} ${i.kod.trim().slice(0, 140)}`;

describe('§0 · tarayıcı kendini sınar (mutasyon-ayırt-edici fikstürler)', () => {
  const sinif = (metin: string, s: Sinif) => sertIhlalleri('f.ts', metin).filter(i => i.sinif === s).length;

  it('1 · kodda `|| 0` / `?? 0` / şablon içi `?? 0` → S1', () => {
    expect(sinif('const v = o.totalPrice || 0;', 'S1')).toBe(1);
    expect(sinif('const v = x ?? 0;', 'S1')).toBe(1);
    expect(sinif('const s = `${pct ?? 0}%`;', 'S1')).toBe(1);
  });

  it('2 · yorumdaki anma SAYILMAZ (satır başı, satır sonu, blok, JSX)', () => {
    expect(sinif('// eski hesap: const v = o.totalPrice || 0;', 'S1')).toBe(0);
    expect(sinif('const a = b; // eski || 0', 'S1')).toBe(0);
    expect(sinif(['/**', ' * eski payda: toplam ?? 1 idi', ' */'].join('\n'), 'S3')).toBe(0);
    expect(sinif('        {/* || 0 */}', 'S1')).toBe(0);
  });

  it('3 · blok yorumdan SONRAKİ ihlalin satır numarası kaymaz', () => {
    const fikstur = ['/* satır 1', '   satır 2', '   satır 3 */', 'const x = y || 0;'].join('\n');
    const bulgular = sertIhlalleri('f.ts', fikstur);
    expect(bulgular.map(i => `${i.satir}:${i.sinif}`)).toEqual(['4:S1']);
  });

  it('4 · URL içindeki `//` kodu yutmaz', () => {
    expect(sinif("const u = 'https://x.test' || 0;", 'S1')).toBe(1);
  });

  it('5 · S3 kelime sınırı: `?? 5`/`|| 1`/`?? 999`/`* 0.6`/`Number(e.target.value)` yakalanır, komşuları değil', () => {
    expect(sinif('const t = i.lowStockThreshold ?? 5;', 'S3')).toBe(1);
    expect(sinif('const p = payda || 1;', 'S3')).toBe(1);
    expect(sinif('const k = gun ?? 999;', 'S3')).toBe(1);
    expect(sinif('const c = li.price * 0.6;', 'S3')).toBe(1);
    expect(sinif('onChange={e => setX(Number(e.target.value))}', 'S3')).toBe(1);
    expect(sinif('const a = x || 10;', 'S3')).toBe(0);
    expect(sinif('const b = x ?? 15;', 'S3')).toBe(0);
    expect(sinif('const c = li.price * 0.65;', 'S3')).toBe(0);
  });

  it('6 · S2 yalnız hayalet çubuk tabanını yakalar', () => {
    expect(sinif('const o = Math.max(...xs, 1);', 'S2')).toBe(1);
    expect(sinif('const o = Math.max(2, p);', 'S2')).toBe(1);
    expect(sinif('const o = Math.max(h, 2);', 'S2')).toBe(1);
    expect(sinif('const o = Math.max(a, b);', 'S2')).toBe(0);
    expect(sinif('const o = Math.min(h, 100);', 'S2')).toBe(0);
  });

  it('7 · meşru başlatıcılar/karşılaştırmalar TAKILMAZ', () => {
    for (const metin of [
      'const acc = { count: 0, rev: 0 };',
      'const t = xs.reduce((s, x) => s + x, 0);',
      'const [n, setN] = useState(0);',
      'if (i === 0) return null;',
      'const bicim = { ondalik: kesirli ? 1 : 0 };',
    ]) expect(sertIhlalleri('f.ts', metin), metin).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §1 · DEĞİŞMEZ: 6a'nın üç dosyasında SERT 1–3 kod satırı = 0
// ---------------------------------------------------------------------------

const UC_DOSYA = [
  'components/reports/useReportsData.ts',
  'pages/RaporlarPage.tsx',
  'components/reports/genel/GenelOzet.tsx',
] as const;

/**
 * İzin listesi — MEKANİZMA var, 6a kapanış hedefi BOŞ.
 * Girdi eklemenin TEK meşru yolu: bir 6a bağlama şartnamesi o satırı alt faz adıyla DEVRETMİŞSE.
 * Ölçüm (2026-09-20): 6b+'ya açıkça devredilen satırların hiçbiri sayısal desen taşımıyor —
 * `o.customerName || '—'` metin varsayılanıdır, 6k döngü süresi `|| 0` içermez, K15/K8 ise
 * 6a'da zaten `toplaBilinen`/`degerToplami`'ya bağlandığı için sayısal varsayılan bırakmadı.
 */
interface Izin { dosya: string; parca: string; altFaz: string; gerekce: string }
const IZIN_LISTESI: Izin[] = [];
const izinli = (i: Ihlal) => IZIN_LISTESI.some(z => z.dosya === i.dosya && i.kod.includes(z.parca));

const ihlaller: Ihlal[] = UC_DOSYA.flatMap(d => sertIhlalleri(d, readFileSync(join(SRC, d), 'utf-8')));

describe('§1 · DEĞİŞMEZ: 6a üçlüsünde SERT 1–3 = 0', () => {
  it('bayatlama koruması: üç dosya da var ve yorum süzgeci dosyayı yutmadı', () => {
    for (const d of UC_DOSYA) {
      const yol = join(SRC, d);
      expect(existsSync(yol), d).toBe(true);
      const dolu = yorumsuz(readFileSync(yol, 'utf-8')).filter(s => s.trim() !== '').length;
      expect(dolu, `${d} · yorumsuz sonrası dolu satır`).toBeGreaterThan(100);
    }
  });

  for (const sinif of SINIFLAR) {
    it(`${sinif} ihlali yok`, () => {
      expect(ihlaller.filter(i => i.sinif === sinif && !izinli(i)).map(yaz)).toEqual([]);
    });
  }
});

describe('§1b · izin listesi disiplini (liste boşken de kural yaşar)', () => {
  it('her girdi bir alt faza devredilmiş, gerekçeli ve YETERİNCE DAR', () => {
    for (const z of IZIN_LISTESI) {
      expect(z.altFaz, `${z.dosya} · ${z.parca}`).toMatch(/^6[b-m]$/);
      expect(z.gerekce.length, `${z.dosya} · ${z.parca} · gerekçe`).toBeGreaterThanOrEqual(30);
      expect(z.gerekce, `${z.dosya} · ${z.parca} · şartname alıntısı`).toMatch(/baglama-[\w-]+\.md/);
      expect(z.parca.length, `${z.dosya} · ${z.parca} · parça çok genel`).toBeGreaterThanOrEqual(16);
    }
  });

  it('bayat izin YOK: her girdi hâlâ TEK bir ihlalle eşleşir', () => {
    for (const z of IZIN_LISTESI) {
      const eslesen = ihlaller.filter(i => i.dosya === z.dosya && i.kod.includes(z.parca));
      expect(eslesen.map(yaz), `${z.dosya} · ${z.parca}`).toHaveLength(1);
    }
  });

  it('liste "küçük" kalır (6m\'de boşalır)', () => {
    expect(IZIN_LISTESI.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// §2 · DEĞİŞMEZ: `src/utils/rapor/*`'ın her export'unun ÜRETİM tüketicisi var
// ---------------------------------------------------------------------------

function kaynakDosyalari(dizin: string): string[] {
  return readdirSync(dizin).flatMap(ad => {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) return kaynakDosyalari(yol);
    return /\.tsx?$/.test(ad) ? [yol] : [];
  });
}

// `export type` / `export interface` MUAF: derlemede silinir (ölü ÇALIŞAN kod olamaz) ve
// dönüş tipi olarak adıyla içe aktarılmadan da tüketilir — zorunlu tutmak sahte kırmızı üretir.
function disaAcilanDegerler(icerik: string): string[] {
  const metin = yorumsuz(icerik).join('\n');
  const adlar: string[] = [];
  for (const e of metin.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
    adlar.push(e[1]);
  }
  for (const e of metin.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) {   // yerel liste; `a as b` → b
    for (const parca of e[1].split(',')) {
      const t = parca.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const as = t.match(/^\S+\s+as\s+([A-Za-z_$][\w$]*)$/);
      adlar.push(as ? as[1] : t);
    }
  }
  return adlar;
}

/** İçe aktarılan `rapor/<slug>` adları; `a as b` → a (tanımdaki ad). */
function raporIceAktarimlari(icerik: string, raporIcinde: boolean): { slug: string; ad: string }[] {
  const sonuc: { slug: string; ad: string }[] = [];
  for (const e of icerik.matchAll(/import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const kaynak = e[2];
    // Göreli (`../../utils/rapor/x`) VE takma adlı (`@/…/utils/rapor/x`) yol; `rapor/` içinden `./x`.
    const mutlak = kaynak.match(/(?:^|\/)utils\/rapor\/([\w-]+?)(?:\.ts)?$/);
    const yerel = raporIcinde ? kaynak.match(/^\.\/([\w-]+?)(?:\.ts)?$/) : null;
    const slug = mutlak?.[1] ?? yerel?.[1];
    if (!slug) continue;
    for (const parca of e[1].split(',')) {
      const t = parca.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const as = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+\S+$/);
      sonuc.push({ slug, ad: as ? as[1] : t });
    }
  }
  return sonuc;
}

const BEKLENEN_MODULLER = ['abonelik', 'bicim', 'dagilim', 'ikBordro', 'kapsamNotu', 'musteri',
  'nakitDongusu', 'sayac', 'stokDeger', 'stokTalep', 'zamanDagilimi'].map(a => `${a}.ts`);

const raporModulleri = existsSync(RAPOR_DIZIN)
  ? readdirSync(RAPOR_DIZIN).filter(ad => /\.ts$/.test(ad) && !/\.test\.ts$/.test(ad)).sort()
  : [];

// Tüketici = ÜRETİM dosyası: test/spec HARİÇ, tanımlayan dosyanın kendisi HARİÇ.
// Başka bir `rapor/` modülü meşru tüketicidir (zincir kendini denetler: onu da kimse
// tüketmiyorsa ONUN export'ları kırmızıya düşer).
const tuketilen = new Set<string>();
const yildizIceAktarim: string[] = [];
for (const yol of existsSync(SRC) ? kaynakDosyalari(SRC) : []) {
  if (/\.(test|spec)\.tsx?$/.test(yol)) continue;
  const icerik = readFileSync(yol, 'utf-8');
  const raporIcinde = yol.startsWith(`${RAPOR_DIZIN}/`);
  for (const { slug, ad } of raporIceAktarimlari(icerik, raporIcinde)) {
    if (yol === join(RAPOR_DIZIN, `${slug}.ts`)) continue;                // kendini tüketemez
    tuketilen.add(`${slug}.${ad}`);
  }
  // `import * as X` tüketim SAYILMAZ: hangi adın kullanıldığı görünmez.
  if (/import\s+\*\s+as\s+[\w$]+\s+from\s*['"][^'"]*utils\/rapor\/[^'"]*['"]/.test(icerik)) {
    yildizIceAktarim.push(yol.replace(SRC, 'src'));
  }
}

const raporExportlari = raporModulleri.map(ad => ({
  ad,
  slug: ad.replace(/\.ts$/, ''),
  icerik: readFileSync(join(RAPOR_DIZIN, ad), 'utf-8'),
})).map(m => ({ ...m, adlar: disaAcilanDegerler(m.icerik) }));

describe('§2 · `utils/rapor/*` export → ÜRETİM tüketicisi', () => {
  it('dalga 1 modülleri üretildi (K4 `musteri` dahil)', () => {
    expect(raporModulleri).toEqual(expect.arrayContaining(BEKLENEN_MODULLER));
  });

  it('yasak dışa aktarım biçimi YOK (varil / default / yapı bozumlu)', () => {
    const suclular: string[] = [];
    for (const m of raporExportlari) {
      const metin = yorumsuz(m.icerik).join('\n');
      if (/^export\s+default\b/m.test(metin)) suclular.push(`rapor/${m.ad}: export default`);
      if (/^export\s+\*\s+from\b/m.test(metin)) suclular.push(`rapor/${m.ad}: export * from`);
      if (/^export\s*\{[^}]*\}\s*from\b/m.test(metin)) suclular.push(`rapor/${m.ad}: export { … } from`);
      if (/^export\s+(?:const|let)\s*[{[]/m.test(metin)) suclular.push(`rapor/${m.ad}: export const {/[ (yapı bozumlu)`);
    }
    expect(suclular).toEqual([]);
  });

  it('`import * as` ile tüketim YOK (hangi ad kullanıldı görünmez)', () => {
    expect(yildizIceAktarim).toEqual([]);
  });

  it('her export en az bir üretim dosyasınca içe aktarılıyor', () => {
    const toplamExport = raporExportlari.reduce((s, m) => s + m.adlar.length, 0);
    expect(toplamExport, 'desen bayatladı mı?').toBeGreaterThan(20);
    const tuketicisiz = raporExportlari.flatMap(m =>
      m.adlar.filter(ad => !tuketilen.has(`${m.slug}.${ad}`)).map(ad => `rapor/${m.ad} → ${ad}`));
    expect(tuketicisiz).toEqual([]);
  });

  // 6a'nın `rapor/` DIŞINDAKİ ADDITIVE export'ları (kapanmış modüllerin ESKİ export'ları taranmaz).
  // `utils/export.ts → monthlySummaryRows` listeye GİRMEZ: tüketicisi aynı dosyadaki
  // `exportMonthlySummaryCSV`, dışa açılma nedeni test dikişi (utils-export.md:22).
  it('6a ADDITIVE export\'ları (pano/cubuk, pano/raporMarj) tüketiliyor', () => {
    const EK_EXPORTLAR: [string, string][] = [
      ['utils/pano/cubuk.ts', 'sayacOlcegi'],
      // 2026-09-22 düzeltme turu: `RaporlarPage` sayfa-içi `const`undan buraya TAŞINDI
      // (sayfa-içi olduğu için ne birim testi ne de §2 tarayıcısı görebiliyordu).
      ['utils/pano/cubuk.ts', 'seriCubukOrani'],
      ['utils/pano/raporMarj.ts', 'stokKartiCozucu'],
    ];
    const tuketicisiz: string[] = [];
    for (const [goreliYol, ad] of EK_EXPORTLAR) {
      const tanim = join(SRC, goreliYol);
      const slugDeseni = new RegExp(`(?:^|/)${goreliYol.replace(/^utils\//, '').replace(/\.ts$/, '')}(?:\\.ts)?$`);
      const bulundu = kaynakDosyalari(SRC).some(yol => {
        if (/\.(test|spec)\.tsx?$/.test(yol) || yol === tanim) return false;
        for (const e of readFileSync(yol, 'utf-8').matchAll(
          /import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
          if (!slugDeseni.test(e[2])) continue;
          if (e[1].split(',').some(p => p.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] === ad)) return true;
        }
        return false;
      });
      if (!bulundu) tuketicisiz.push(`${goreliYol} → ${ad}`);
    }
    expect(tuketicisiz).toEqual([]);
  });
});

describe('§2b · export/import çözümleyicileri kendini sınar', () => {
  it('dışa açılan DEĞERLER bulunur, `type`/`interface` MUAF', () => {
    const fikstur = [
      'export function a() {}',
      'export async function b() {}',
      'export const C = 1;',
      'const d = 2, e = 3;',
      'export { d, e as f };',
      'export type T = string;',
      'export interface I { x: number }',
    ].join('\n');
    expect(disaAcilanDegerler(fikstur)).toEqual(['a', 'b', 'C', 'd', 'f']);
  });

  it('çok satırlı içe aktarım çözülür, `type` atılır, `e as g` → e', () => {
    const fikstur = "import {\n  a,\n  type T,\n  e as g,\n} from '../../utils/rapor/sayac';";
    expect(raporIceAktarimlari(fikstur, false)).toEqual([
      { slug: 'sayac', ad: 'a' }, { slug: 'sayac', ad: 'T' }, { slug: 'sayac', ad: 'e' },
    ]);
  });

  it('`./sayac` YALNIZ rapor/ içinden çözülür; `../pano/sayac` hiç çözülmez', () => {
    const yerel = "import { adetSay } from './sayac';";
    expect(raporIceAktarimlari(yerel, true)).toEqual([{ slug: 'sayac', ad: 'adetSay' }]);
    expect(raporIceAktarimlari(yerel, false)).toEqual([]);
    expect(raporIceAktarimlari("import { adetSay } from '../pano/sayac';", true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 · K4 ("kimlikle") yarım düzeltme koruması
// ---------------------------------------------------------------------------

// Orkestratör K4'ü 6a'da İKİ dosyanın müşteri gruplama sitelerine verdi (useReportsData
// `topCustomers`; RaporlarPage müşteri listesi + sentetik Mikro siparişi). §2 "en az BİR
// tüketici" ister — tek dosya bağlanıp diğeri unutulursa §2 yeşil kalırdı ("yarım düzeltme
// sınıfı"). Ad SABİTLENMEZ: API'nin sahibi utils-musteri.md.
// K2 (iptaller ciroya girmez) için kaynak-tarayan iddia YOK — metin taraması çağrı doğruluğunu
// kanıtlayamaz. DÜZELTME (2026-09-20 hakem turu): bu satırdaki eski cümle «kural
// `raporVeriKatmani.raporCirosu` içinde davranışsaldır, birim testinde korunur» diyordu; bu yalnız
// KPI cirosu için doğruydu. `topCustomers` `raporCirosu`'ndan GEÇMEZ — süzgeci ÇAĞIRAN uygular
// (`musteriOzeti` sipariş durumu OKUMAZ) ve süzgeci silen mutasyon tüm paketi yeşil bırakıyordu.
// Artık her K2 çağıranının kendi birim testi var: `useReportsData.musteriListesi` →
// `components/reports/useReportsData.test.ts`. K2'yi yeni bir panele bağlayan alt faz, o çağrıyı
// da kendi birim testiyle sabitlemelidir (burada kaynak taraması DEĞİL).
describe('§4 · müşteri modülüne İKİ 6a dosyası da bağlı (K4)', () => {
  for (const dosya of ['components/reports/useReportsData.ts', 'pages/RaporlarPage.tsx'] as const) {
    it(`${dosya} → utils/rapor/musteri`, () => {
      const icerik = readFileSync(join(SRC, dosya), 'utf-8');
      const adlar = raporIceAktarimlari(icerik, false).filter(x => x.slug === 'musteri').map(x => x.ad);
      expect(adlar.length, `${dosya} müşteri modülünü hiç içe aktarmıyor`).toBeGreaterThan(0);
    });
  }
});
