/**
 * mikroImportArkaplan.degismez.test.ts — Mikro import ARKA PLAN İŞİ kapanış ölçüsü (2026-09-24).
 *
 * Neden var: "Stok/Cari İçeri Al" ve 12 SQL import ucu işi HTTP isteğinin İÇİNDE bitiriyordu; IIS/ARR
 * ~120 sn'de kesip 502 döndürüyordu (teşhis 2026-09-24, CONFIRMED: kök neden iş istek içinde). Düzeltme
 * üç grupta yazıldı — sunucu (`src/server/mikro/arkaPlanIsi.ts` TEK yardımcı + 4 rota bağlantısı),
 * istemci (`useArkaPlanIsi` kancası + `ArkaPlanIsiKarti` + panel) ve değişmez (bu dosya +
 * `src/test/kaynakTarama.ts`). Bu dosya o düzeltmenin GERİ ALINAMAZ ve KOPYALANAMAZ olduğunu kaynak
 * tarayarak ölçer:
 *   §1  `mikroSqlImportCalistir` yalnız cron döngüsünde ya da `arkaPlanIsiBaslat` kapanışında `await` edilir;
 *       ateşle-unut (await'siz) çağrı yok, çağrı sayısı TAM 3
 *   §2  rota dosyalarında satır başı IIFE yok (desen tek yerde: yardımcı)
 *   §3  çıplak `x_iptal = 0` yok — sabit adla da, dinamik `${iptalCol} = 0` ile de (safe trio:
 *       `ISNULL(x_iptal, 0) = 0`; KDV/Mizan pull kolon adını şemadan bulur)
 *   §4  `body: undefined` yok (tek sözleşme; 411 curl ölçümü, tarayıcı 502'sini açıklamaz — mikroService.ts:94)
 *   §5  `collection('jobs')` yalnız yardımcıda ve `companyId` damgalı (jobs TENANT koleksiyonu)
 *   §6  `yaziciyiIstegeBagla` yalnız 5 senkron uçta; yardımcı yazıcı kaydını iş ömrünce tutar
 *   §7  bağlantı: yardımcı/sözlük/kart/kanca GERÇEKTEN import edilip çağrılıyor; `'jobs'` okuması src
 *       genelinde TEK kancada ("yazıldı ama bağlanmadı" bu projede 4 kez tekrarladı — kapı)
 *   §8  Cari Ekstre tip 29 etiketi (K-D: TR-only, EN uydurulmaz)
 *   H2  sahte kesinlik (degismez.md "Hakem maddeleri" 2 — şartnamenin § listesinde yok, o yüzden §9
 *       DEĞİL): yardımcıda SERT1 (`?? 0`/`|| 0`) = 0; mikroRoutes'ta `guidsizSatir … ?? 0` yok
 *       (sayılmadıysa bilinmiyor, 0 DEĞİL)
 *
 * Test bir ÖLÇÜDÜR, onarım aracı DEĞİL: kırmızıysa kaçırılmış site demektir — izin listesine girdi
 * ekleyerek ya da deseni gevşeterek yeşile çevirme, kaçıran grubun dosyasını düzelt.
 *
 * Yorum satırları sayılmaz: `yorumsuz` `src/test/degismezTarayici.ts`'ten (K-L; üçüncü kopya YASAK —
 * "assertion kendi yorumuna takıldı ×5" dersi). Test/spec/düzenek dosyaları taranmaz. Dosya-okuyan
 * yardımcılar `src/test/kaynakTarama.ts`'te (degismez.md "YAZDIĞIN DOSYALAR"; bugün tek tüketicisi bu
 * dosya — K-H: diğer değişmez testlerin oraya taşınması AYRI commit).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ts from 'typescript';
import { yorumsuz, sertIhlalleri, ihlalYaz } from '../../test/degismezTarayici';
import { SRC_KOK as SRC, gorece, oku, kaynakDosyalari, kodSatirlari, suclular as bul, type Suclu as Bulgu } from '../../test/kaynakTarama';

const ROTA   = join(SRC, 'server', 'routes', 'mikroRoutes.ts');
const HELPER = join(SRC, 'server', 'mikro', 'arkaPlanIsi.ts');
const PANEL  = join(SRC, 'components', 'MikroSyncPanel.tsx');
const KANCA  = join(SRC, 'hooks', 'useArkaPlanIsi.ts');
const KART   = join(SRC, 'components', 'mikro', 'ArkaPlanIsiKarti.tsx');
const EKSTRE = join(SRC, 'components', 'CariEkstrePanel.tsx');
const SERVIS = join(SRC, 'services', 'mikroService.ts');
const SUNUCU_DIZIN = join(SRC, 'server');
const ROTA_DIZIN   = join(SRC, 'server', 'routes');
const SERVIS_DIZIN = join(SRC, 'services');
/** Kök `server.ts` (src DIŞINDA). İnceleme bulgusu 2026-09-25: §3/§5/§7 onu taramıyordu — oraya eklenen
 *  `collection('jobs')` ya da çıplak iptal eşitliği yeşil kalırdı. Bugün üç desende de 0 geçiş. */
const SERVER_TS    = join(SRC, '..', 'server.ts');

// Tarama KÜMELERİ — § testleri ve §0d çiti AYNI kümeleri kullanır (çit ayrı liste tutarsa kayar).
const SUNUCU_KUMESI = () => [...kaynakDosyalari(SUNUCU_DIZIN), SERVER_TS];
const SRC_KUMESI    = () => [...kaynakDosyalari(SRC), SERVER_TS];

// Dosya yardımcıları (`kaynakDosyalari`, `kodSatirlari`, `suclular` → `bul`) `src/test/kaynakTarama.ts`'te.
const yaz = (b: Bulgu) => `${b.site} ${b.kod.trim().slice(0, 140)}`;
/** Desene uyan KOD satırı sayısı (`grep -c` eşleniği, yorumlar dışarıda). */
const say = (yol: string, desen: RegExp) => kodSatirlari(yol).filter(x => desen.test(x.kod)).length;

// ---------------------------------------------------------------------------
// §0 · Saf tarayıcılar — girdi metindir, fikstürle sınanır (aşağıda)
// ---------------------------------------------------------------------------

const DESEN = {
  sqlCagri:        /\bawait\s+mikroSqlImportCalistir\(/,
  // HER geçiş (await'li/await'siz) ve tanım satırı — §1b ateşle-unut sayımı ikisinin farkından çıkar.
  sqlAd:           /\bmikroSqlImportCalistir\(/,
  sqlTanim:        /\bfunction\s+mikroSqlImportCalistir\(/,
  isaretCron:      /\bfor\s*\(\s*const\s+\w+\s+of\s+SQL_IMPORT_TANIMLARI\s*\)/,
  isaretHelper:    /\barkaPlanIsiBaslat\(/,
  isaretRota:      /\bapp\.(?:post|get|put|patch|delete)\(/,
  // Satır BAŞI: `C.setAiHealthProbe(async () => {` (aiRoutes) ve `vi.fn(async () => {})` yakalanmaz.
  iife:            /^\s*(?:void\s+)?\(\s*async\s*(?:\(\s*\)\s*=>|function\b)/,
  // Çıplak `x_iptal = 0`; `ISNULL(x_iptal, 0) = 0` ve `<> 0` eşleşmez.
  iptalCiplak:     /\b[A-Za-z]\w*_iptal\s*=\s*0\b/,
  // GEVŞEK boşluk: `ISNULL(sth_iptal,0)=0` (boşluksuz) de sayılır — katı biçim doğru ağaçta 10 verir, kırmızı kalırdı.
  iptalIsnull:     /ISNULL\(\w*_iptal,\s*0\)\s*=\s*0/,
  // DİNAMİK kolon adı (KDV/Mizan pull: `iptalCol = kolonBul(cols, /_iptal$/i)`): şablondaki `${iptalCol} = 0`
  // sabit-ad desenine UYMAZ (`_iptal` metinde yok) — hakem 1'in mutantı ikisinin arasında yaşıyordu.
  // `[\w.]*` (inceleme bulgusu 2026-09-25): `${opts.iptalCol} = 0` / `${this.iptalKol}` de sayılır — eski `\w*`
  // noktalı erişimi görmüyordu (kolon adı bir seçenek nesnesinden gelirse mutant yeşil kalırdı).
  iptalDinamikCiplak: /\$\{\s*[\w.]*[iI]ptal\w*\s*\}\s*=\s*0\b/,
  iptalDinamikIsnull: /ISNULL\(\$\{\s*[\w.]*[iI]ptal\w*\s*\},\s*0\)\s*=\s*0/,
  bodyUndefined:   /\bbody:\s*undefined\b|\bbody\s*!==\s*undefined\s*\?/,
  jobsKoleksiyonu: /collection\(\s*['"]jobs['"]\s*\)/,
  // `.set({ … companyId … })` — ilk `}`e kadar; merge'li bitiş yazımları (companyId'siz) eşleşmez.
  setCompanyId:    /\.set\(\s*\{[^}]*\bcompanyId\b/,
  yaziciBagla:     /\byaziciyiIstegeBagla\(/,
  // H2: sayılmamış `guidsizSatir` 0 olarak YAZILMAZ — `?? 0` / `|| 0` ya da düz `guidsizSatir: 0`.
  // (`let guidsizSatir = 0;` sayaç başlangıcıdır — `=` ile, `:` değil — eşleşmez.)
  guidsizSifir:    /\bguidsizSatir\s*:\s*0\b|\bguidsizSatir\b[^,;]*(?:\?\?|\|\|)\s*0\b/,
} as const;

/** Bir satırdaki geçiş sayısı (DESEN'ler `g`'siz — `.test` durumsuz kalsın diye burada kopyalanır). */
const adet = (kod: string, desen: RegExp) => [...kod.matchAll(new RegExp(desen.source, 'g'))].length;

type Isaret = 'cron' | 'arkaPlanIsiBaslat' | 'app.route' | '(yok)';
interface SqlCagri { satir: number; isaret: Isaret; izinli: boolean }

/** İşaret adayları, satır içi kontrol SIRASIYLA; `ac`/`kapa` = işaretin açtığı kapsamın sınırlayıcısı. */
const ISARETLER: ReadonlyArray<{ tur: Exclude<Isaret, '(yok)'>; desen: RegExp; ac: string; kapa: string }> = [
  { tur: 'cron',              desen: DESEN.isaretCron,   ac: '{', kapa: '}' },   // döngü GÖVDESİ
  { tur: 'arkaPlanIsiBaslat', desen: DESEN.isaretHelper, ac: '(', kapa: ')' },   // çağrı ARGÜMANLARI (calistir kapanışı)
  { tur: 'app.route',         desen: DESEN.isaretRota,   ac: '(', kapa: ')' },   // rota kaydı argümanları (handler)
];

/**
 * `metin` (işaretten çağrıya kadar) içinde işaretin açtığı kapsam hâlâ AÇIK mı: ilk `ac` açar, derinlik
 * 0'a inerse kapanmıştır. Hiç açılmadıysa AÇIK DEĞİL — gövdesiz `for (…) await …;` işaret sayılmaz, yani
 * yanlış KIRMIZI verir; sessiz yeşil vermez. Sınır: string/regex literali içindeki DENGESİZ parantez sayımı
 * saptırır (bugün işaret-çağrı aralarında yok — gerçek ağaç + §0 fikstürleri).
 */
function kapsamAcik(metin: string, ac: string, kapa: string): boolean {
  let derinlik = 0;
  for (const ch of metin) {
    if (ch === ac) derinlik++;
    else if (ch === kapa && derinlik > 0 && --derinlik === 0) return false;
  }
  return derinlik > 0;
}

/**
 * §1 işaret yürüyüşü: her `await mikroSqlImportCalistir(` için GERİYE yürü (aynı satırın çağrı ÖNCESİ dahil),
 * kapsamı çağrıda hâlâ AÇIK olan İLK işaret sınıfı belirler: `for (const … of SQL_IMPORT_TANIMLARI) {` → cron
 * (izinli) · `arkaPlanIsiBaslat(` → kapanış (izinli) · `app.<verb>(` → rota gövdesi (İHLAL: iş istek içinde
 * biter). İşaret YOKSA da İHLAL (degismez.md hakem 1): kapanış ayrı bir yardımcıya çıkarılırsa ne `app.post`
 * ne `arkaPlanIsiBaslat` görünür — "bilinmeyen → izinli" sayılmaz. Kapsamı KAPANMIŞ işaret atlanır (hakem 3,
 * 2026-09-25): `await arkaPlanIsiBaslat(…);` satırının ALTINA, rota gövdesine yazılan doğrudan await eskiden
 * 'arkaPlanIsiBaslat' işaretini alıp izinli sayılıyordu.
 */
function sqlImportCagrilari(icerik: string): SqlCagri[] {
  const satirlar = yorumsuz(icerik);
  const out: SqlCagri[] = [];
  satirlar.forEach((kod, i) => {
    const cagri = DESEN.sqlCagri.exec(kod);
    if (!cagri) return;
    const isaret = isaretBul(satirlar, i, kod.slice(0, cagri.index));
    out.push({ satir: i + 1, isaret, izinli: isaret === 'cron' || isaret === 'arkaPlanIsiBaslat' });
  });
  return out;
}

/** `i`. satırdaki çağrıdan (öncesi `onEk`) geriye: kapsamı çağrıda hâlâ açık olan ilk işaret. */
function isaretBul(satirlar: string[], i: number, onEk: string): Isaret {
  for (let j = i; j >= 0; j--) {
    const satir = j === i ? onEk : satirlar[j];
    for (const { tur, desen, ac, kapa } of ISARETLER) {
      const e = desen.exec(satir);
      if (!e) continue;
      const kapsam = j === i ? satir.slice(e.index) : [satir.slice(e.index), ...satirlar.slice(j + 1, i), onEk].join('\n');
      if (kapsamAcik(kapsam, ac, kapa)) return tur;
    }
  }
  return '(yok)';
}

interface SqlGecis { satir: number; cagri: number; awaitsiz: number }
/**
 * §1b: tanım HARİÇ her `mikroSqlImportCalistir(` geçişi. `await`'siz olan (ateşle-unut: `….catch(() => {})`,
 * `void …`, `const p = …`) §1'in işaret yürüyüşüne HİÇ girmez ve IIFE de değildir (§2 görmez) — oysa kilitsiz,
 * jobs dokümanı ve companyId'si olmayan elle yazılmış bir arka plan işi kurar (hakem 3, 2026-09-25).
 */
function sqlCagriGecisleri(icerik: string): SqlGecis[] {
  return yorumsuz(icerik).flatMap((kod, i) => {
    const cagri = adet(kod, DESEN.sqlAd) - adet(kod, DESEN.sqlTanim);
    return cagri > 0 ? [{ satir: i + 1, cagri, awaitsiz: cagri - adet(kod, DESEN.sqlCagri) }] : [];
  });
}

const kacis = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Adlı import KOD satırı (tek/çok satırlı): `import { …ad… } from '<yol>'`. Yorumda geçmesi yetmez. */
function adliImportVar(icerik: string, ad: string, yol: string): boolean {
  const desen = new RegExp(`\\bimport\\s*\\{[^}]*\\b${kacis(ad)}\\b[^}]*\\}\\s*from\\s*['"]${kacis(yol)}['"]`);
  return desen.test(yorumsuz(icerik).join('\n'));
}

describe('§0 · tarayıcı kendini sınar (mutasyon-ayırt-edici fikstürler)', () => {
  const sayFikstur = (metin: string, desen: RegExp) => yorumsuz(metin).filter(k => desen.test(k)).length;

  it('IIFE: satır başı `(async () => {` / `void (…)` / `(async function` ✓; çağrı argümanı olan async ok ✗', () => {
    expect(sayFikstur('    (async () => {', DESEN.iife)).toBe(1);
    expect(sayFikstur('    void (async () => {', DESEN.iife)).toBe(1);
    expect(sayFikstur('  (async function () {', DESEN.iife)).toBe(1);
    expect(sayFikstur('  C.setAiHealthProbe(async () => {', DESEN.iife)).toBe(0);
    expect(sayFikstur('  const f = vi.fn(async () => {});', DESEN.iife)).toBe(0);
  });

  it('iptal çıplak: `cha_iptal = 0` / `sth_iptal=0` ✓; ISNULL biçimleri ve `<> 0` ✗', () => {
    expect(sayFikstur("ekKosul: 'cha_iptal = 0',", DESEN.iptalCiplak)).toBe(1);
    expect(sayFikstur('WHERE sth_iptal=0 AND', DESEN.iptalCiplak)).toBe(1);
    expect(sayFikstur("ekKosul: 'ISNULL(cha_iptal, 0) = 0',", DESEN.iptalCiplak)).toBe(0);
    expect(sayFikstur('ISNULL(sth_iptal,0)=0', DESEN.iptalCiplak)).toBe(0);
    expect(sayFikstur('WHERE ISNULL(cha_iptal, 0) <> 0', DESEN.iptalCiplak)).toBe(0);
  });

  it('§3 bayatlama (gevşek ISNULL): boşluklu/boşluksuz ✓; `<> 0` ✗; yorumdaki anma sayılmaz', () => {
    expect(sayFikstur('ISNULL(sth_iptal,0)=0', DESEN.iptalIsnull)).toBe(1);
    expect(sayFikstur('ISNULL(cha_iptal, 0) = 0', DESEN.iptalIsnull)).toBe(1);
    expect(sayFikstur('ISNULL(cha_iptal, 0) <> 0', DESEN.iptalIsnull)).toBe(0);
    expect(sayFikstur('// ISNULL(cha_iptal,0)=0 ZORUNLU', DESEN.iptalIsnull)).toBe(0);
  });

  it('iptal DİNAMİK (hakem 1): `${iptalCol} = 0` / `${iptalCol}=0` ✓; ISNULL sarmalı ve `<> 0` ✗; bayatlama deseni tersini sayar', () => {
    expect(sayFikstur('kosul.push(`${iptalCol} = 0`);', DESEN.iptalDinamikCiplak)).toBe(1);
    expect(sayFikstur('kosul.push(`${iptalCol}=0`);', DESEN.iptalDinamikCiplak)).toBe(1);
    expect(sayFikstur('kosul.push(`ISNULL(${iptalCol}, 0) = 0`);', DESEN.iptalDinamikCiplak)).toBe(0);
    expect(sayFikstur('WHERE ISNULL(${iptalKol}, 0) <> 0', DESEN.iptalDinamikCiplak)).toBe(0);
    expect(sayFikstur('kosul.push(`ISNULL(${iptalCol}, 0) = 0`);', DESEN.iptalDinamikIsnull)).toBe(1);
    expect(sayFikstur('WHERE ISNULL(${iptalKol}, 0) <> 0', DESEN.iptalDinamikIsnull)).toBe(0);
    expect(sayFikstur('kosul.push(`${iptalCol} = 0`);', DESEN.iptalDinamikIsnull)).toBe(0);
    expect(sayFikstur('// kosul.push(`ISNULL(${iptalCol}, 0) = 0`);', DESEN.iptalDinamikIsnull)).toBe(0);
    // Sabit-ad deseni dinamik biçimi GÖRMEZ, sabit-ad bayatlama sayımı da saymaz — iki desen ayrı durmak ZORUNDA.
    expect(sayFikstur('kosul.push(`${iptalCol} = 0`);', DESEN.iptalCiplak)).toBe(0);
    expect(sayFikstur('kosul.push(`ISNULL(${iptalCol}, 0) = 0`);', DESEN.iptalIsnull)).toBe(0);
    // Noktalı erişim (inceleme bulgusu 2026-09-25): seçenek nesnesinden gelen kolon adı.
    expect(sayFikstur('kosul.push(`${opts.iptalCol} = 0`);', DESEN.iptalDinamikCiplak)).toBe(1);
    expect(sayFikstur('kosul.push(`${this.iptalKol}=0`);', DESEN.iptalDinamikCiplak)).toBe(1);
    expect(sayFikstur('kosul.push(`ISNULL(${opts.iptalCol}, 0) = 0`);', DESEN.iptalDinamikCiplak)).toBe(0);
    expect(sayFikstur('kosul.push(`ISNULL(${opts.iptalCol}, 0) = 0`);', DESEN.iptalDinamikIsnull)).toBe(1);
  });

  it('H2 guidsizSatir: `?? 0` / `|| 0` / düz `: 0` ✓; `?? null`, çıplak alan ve `let … = 0` sayacı ✗', () => {
    expect(sayFikstur('guidsizSatir: s.guidsizSatir ?? 0,', DESEN.guidsizSifir)).toBe(1);
    expect(sayFikstur('res.json({ guidsizSatir: sonuc.guidsizSatir || 0 });', DESEN.guidsizSifir)).toBe(1);
    expect(sayFikstur('return { jobAlanlari: { tablo: opts.tablo, guidsizSatir: 0 } };', DESEN.guidsizSifir)).toBe(1);
    expect(sayFikstur('guidsizSatir: s.guidsizSatir ?? null,', DESEN.guidsizSifir)).toBe(0);
    expect(sayFikstur('guidsizSatir: s.guidsizSatir,   // başarıda HER ZAMAN sayılır', DESEN.guidsizSifir)).toBe(0);
    expect(sayFikstur('    let guidsizSatir = 0;', DESEN.guidsizSifir)).toBe(0);
  });

  it('body: `body: undefined` / `body !== undefined ?` ✓; `JSON.stringify(body ?? {})` ✗', () => {
    expect(sayFikstur('      body: undefined,', DESEN.bodyUndefined)).toBe(1);
    expect(sayFikstur('body: body !== undefined ? JSON.stringify(body) : undefined,', DESEN.bodyUndefined)).toBe(1);
    expect(sayFikstur('body: JSON.stringify(body ?? {}),', DESEN.bodyUndefined)).toBe(0);
  });

  it('§1 işaret yürüyüşü: rota gövdesi İHLAL; kapanış/cron izinli; yorum sayılmaz; işaret YOKSA İHLAL (hakem 1)', () => {
    const sinifla = (satirlar: string[]) => sqlImportCagrilari(satirlar.join('\n'));
    expect(sinifla(['app.post(x, async (req,res) => {', '  const s = await mikroSqlImportCalistir(a);']))
      .toEqual([{ satir: 2, isaret: 'app.route', izinli: false }]);
    expect(sinifla(['app.post(x, async (req,res) => {', '  await arkaPlanIsiBaslat(dep, { calistir: async () => {', '    const s = await mikroSqlImportCalistir(a);']))
      .toEqual([{ satir: 3, isaret: 'arkaPlanIsiBaslat', izinli: true }]);
    expect(sinifla(['for (const opts of SQL_IMPORT_TANIMLARI) {', '  const r = await mikroSqlImportCalistir(opts);']))
      .toEqual([{ satir: 2, isaret: 'cron', izinli: true }]);
    expect(sinifla(['// const s = await mikroSqlImportCalistir(a);'])).toEqual([]);
    // Kapanış ayrı bir yardımcıya çıkarılmış: ne `app.post` ne `arkaPlanIsiBaslat` — "(yok)" → İHLAL.
    // ("bilinmeyen → izinli" mutasyonu burada kırılır.)
    expect(sinifla(['async function sqlImportKapanisi(opts) {', '  const s = await mikroSqlImportCalistir(opts);']))
      .toEqual([{ satir: 2, isaret: '(yok)', izinli: false }]);
    // İKİ çağrı, farklı sınıflar: her biri KENDİ en yakın işaretini alır (rota, sonra cron).
    expect(sinifla([
      'app.post(x, async (req,res) => {', '  const s = await mikroSqlImportCalistir(a);', '});',
      'for (const opts of SQL_IMPORT_TANIMLARI) {', '  const r = await mikroSqlImportCalistir(opts);',
    ]).map(c => `${c.satir}:${c.isaret}`)).toEqual(['2:app.route', '5:cron']);
  });

  it('§1 kapsam (hakem 3): KAPANMIŞ işaret atlanır — kapanış dışına taşınan çağrı ve biten döngü sonrası çağrı İHLAL; tek satırlık kapanış izinli', () => {
    const sinifla = (satirlar: string[]) => sqlImportCagrilari(satirlar.join('\n'));
    // `arkaPlanIsiBaslat(…)` aynı satırda kapandı; altındaki doğrudan await rota gövdesindedir.
    expect(sinifla([
      'app.post(x, async (req,res) => {',
      '  const r = await arkaPlanIsiBaslat(dep, { calistir: async () => ({ ozet: "" }) });',
      '  const s = await mikroSqlImportCalistir(a);',
    ])).toEqual([{ satir: 3, isaret: 'app.route', izinli: false }]);
    // Çok satırlı kapanış `});` ile bitti; çağrı ondan SONRA.
    expect(sinifla([
      'app.post(x, async (req,res) => {',
      '  const r = await arkaPlanIsiBaslat(dep, {', '    calistir: async () => ({ ozet: "" }),', '  });',
      '  const s = await mikroSqlImportCalistir(a);',
    ])).toEqual([{ satir: 5, isaret: 'app.route', izinli: false }]);
    // Cron döngüsü kapandı; çağrı döngünün DIŞINDA.
    expect(sinifla([
      'app.post(x, async (req,res) => {',
      '  for (const o of SQL_IMPORT_TANIMLARI) { await y(o); }',
      '  const s = await mikroSqlImportCalistir(a);',
    ])).toEqual([{ satir: 3, isaret: 'app.route', izinli: false }]);
    // Hiçbir kapsamı açık işaret yok → (yok).
    expect(sinifla(['for (const o of SQL_IMPORT_TANIMLARI) {', '}', 'const s = await mikroSqlImportCalistir(a);']))
      .toEqual([{ satir: 3, isaret: '(yok)', izinli: false }]);
    // Aynı satırda açık kapanış: çağrı ÖNCESİ metin de yürünür.
    expect(sinifla(['  await arkaPlanIsiBaslat(dep, { calistir: async () => ({ s: await mikroSqlImportCalistir(a) }) });']))
      .toEqual([{ satir: 1, isaret: 'arkaPlanIsiBaslat', izinli: true }]);
    // Kapanış içindeki iç içe parantez/süslü (SQL şablonu, nesne) kapsamı KAPATMAZ.
    expect(sinifla([
      '  await arkaPlanIsiBaslat(dep, {', '    senkronKaydi: { operation: `SQL:${t}`, entityType: c },',
      '    calistir: async (ilerle) => {', '      const s = await mikroSqlImportCalistir(o, a => ilerle({ ...a }));',
    ])).toEqual([{ satir: 4, isaret: 'arkaPlanIsiBaslat', izinli: true }]);
  });

  it('§1b ateşle-unut (hakem 3): tanım hariç her geçiş sayılır; `await`\'siz (`.catch`, `void`, `const p =`) ayrı; yorum sayılmaz', () => {
    const g = (satirlar: string[]) => sqlCagriGecisleri(satirlar.join('\n'));
    expect(g(['  async function mikroSqlImportCalistir(', '    opts: SqlImportOpts,'])).toEqual([]);
    expect(g(['  const r = await mikroSqlImportCalistir(opts);'])).toEqual([{ satir: 1, cagri: 1, awaitsiz: 0 }]);
    expect(g(['  mikroSqlImportCalistir(opts, companyId, ilk, son, actor).catch(() => {});']))
      .toEqual([{ satir: 1, cagri: 1, awaitsiz: 1 }]);
    expect(g(['  void mikroSqlImportCalistir(opts);'])).toEqual([{ satir: 1, cagri: 1, awaitsiz: 1 }]);
    expect(g(['  const p = mikroSqlImportCalistir(a); await mikroSqlImportCalistir(b);'])).toEqual([{ satir: 1, cagri: 2, awaitsiz: 1 }]);
    expect(g(['  // mikroSqlImportCalistir(opts).catch(() => {});'])).toEqual([]);
  });

  it('yorum süzgeci (rapor6a §0 vaka 2-4, `degismezTarayici.yorumsuz`): satır başı/sonu/blok/JSX sayılmaz; blok sonrası satır kaymaz; URL `//` yutmaz', () => {
    const d = DESEN.iptalCiplak;
    expect(sayFikstur("// eski: ekKosul: 'cha_iptal = 0',", d)).toBe(0);
    expect(sayFikstur('const a = b; // eski cha_iptal = 0', d)).toBe(0);
    expect(sayFikstur(['/**', " * eski koşul: 'cha_iptal = 0'", ' */'].join('\n'), d)).toBe(0);
    expect(sayFikstur('        {/* cha_iptal = 0 */}', d)).toBe(0);
    const fikstur = ['/* satır 1', '   satır 2', '   satır 3 */', "const k = 'sth_iptal = 0';"].join('\n');
    expect(yorumsuz(fikstur).flatMap((k, i) => (d.test(k) ? [i + 1] : []))).toEqual([4]);
    expect(sayFikstur("const u = 'https://x.test'; const k = 'sth_iptal = 0';", d)).toBe(1);
  });

  it("jobs: `collection('jobs')` tek/çift tırnak ✓, başka koleksiyon ✗; `.set({ … companyId })` tek/çok satırlı ✓, merge'li bitiş ✗", () => {
    expect(DESEN.jobsKoleksiyonu.test("dep.db.collection('jobs').doc(isAdi)")).toBe(true);
    expect(DESEN.jobsKoleksiyonu.test('db.collection( "jobs" )')).toBe(true);
    expect(DESEN.jobsKoleksiyonu.test("db.collection('syncLog')")).toBe(false);
    expect(DESEN.setCompanyId.test('await jobRef.set({ running: true, startedAt: ts(), finishedAt: null, companyId, isAdi });')).toBe(true);
    expect(DESEN.setCompanyId.test('await jobRef.set({\n  running: true,\n  companyId,\n});')).toBe(true);
    expect(DESEN.setCompanyId.test('await jobRef.set({ running: false, error: msg }, { merge: true });')).toBe(false);
  });

  it('adlı import: tek/çok satırlı ✓; yalnız yorumda ✗; başka yoldan ✗; komşu ad ✗', () => {
    const YOL = '../mikro/arkaPlanIsi.js';
    expect(adliImportVar("import { arkaPlanIsiBaslat, bakimKilidiMesaji } from '../mikro/arkaPlanIsi.js';", 'arkaPlanIsiBaslat', YOL)).toBe(true);
    expect(adliImportVar("import {\n  arkaPlanIsiBaslat,\n  type BaslatSonucu,\n} from '../mikro/arkaPlanIsi.js';", 'arkaPlanIsiBaslat', YOL)).toBe(true);
    expect(adliImportVar("// import { arkaPlanIsiBaslat } from '../mikro/arkaPlanIsi.js';", 'arkaPlanIsiBaslat', YOL)).toBe(false);
    expect(adliImportVar("import { arkaPlanIsiBaslat } from './arkaPlanIsi.js';", 'arkaPlanIsiBaslat', YOL)).toBe(false);
    expect(adliImportVar("import { arkaPlanIsiBekle } from '../mikro/arkaPlanIsi.js';", 'arkaPlanIsiBaslat', YOL)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// İzin listesi — MEKANİZMA var, hedef her madde için BOŞ (degismez.md §"Değişmez maddeleri")
// ---------------------------------------------------------------------------

/**
 * Girdi eklemenin TEK meşru yolu: bir kardeş şartname (sunucu.md / istemci.md / degismez.md) o satırı
 * açıkça DEVRETMİŞSE. Dolduran ajan gerekçeyi şartnameye de yazar. Ölçüm (2026-09-24): sunucu ve istemci
 * grupları bittikten sonra §1–§8'in hepsi yeşil — devredilen satır YOK.
 */
interface Izin { dosya: string; parca: string; gerekce: string; sartname: string }
const IZIN_LISTESI: Izin[] = [];
const izinli = (b: Bulgu) => IZIN_LISTESI.some(z => b.site.startsWith(`${z.dosya}:`) && b.kod.includes(z.parca));
const ihlaller = (dosyalar: string[], desen: RegExp) => bul(dosyalar, desen).filter(b => !izinli(b)).map(yaz);

describe('§0b · izin listesi disiplini (liste boşken de kural yaşar)', () => {
  it('her girdi gerekçeli, şartnameye bağlı ve YETERİNCE DAR', () => {
    for (const z of IZIN_LISTESI) {
      expect(z.gerekce.length, `${z.dosya} · ${z.parca} · gerekçe`).toBeGreaterThanOrEqual(30);
      expect(z.sartname, `${z.dosya} · ${z.parca} · şartname`).toMatch(/\b(?:sunucu|istemci|degismez)\.md\b/);
      expect(z.parca.length, `${z.dosya} · ${z.parca} · parça çok genel`).toBeGreaterThanOrEqual(16);
      expect(existsSync(join(SRC, '..', z.dosya)), `${z.dosya} · dosya yok`).toBe(true);
    }
  });

  it('bayat izin YOK: her girdi hâlâ TEK bir kod satırıyla eşleşir', () => {
    for (const z of IZIN_LISTESI) {
      const eslesen = kodSatirlari(join(SRC, '..', z.dosya)).filter(x => x.kod.includes(z.parca));
      expect(eslesen.map(x => `${z.dosya}:${x.n}`), `${z.dosya} · ${z.parca}`).toHaveLength(1);
    }
  });

  it('liste küçük kalır', () => {
    expect(IZIN_LISTESI.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Bayatlama koruması — taranan her dosya var ve yorum süzgeci dosyayı yutmadı
// ---------------------------------------------------------------------------

describe('bayatlama koruması: taranan dosyalar var ve yorumsuz DOLU', () => {
  // Eşik: > 100 dolu satır; yardımcı saf ve küçük → > 30 (degismez.md "bayatlama").
  const ESIK: Array<[string, number]> = [[ROTA, 100], [HELPER, 30], [PANEL, 100], [KANCA, 100], [KART, 100], [EKSTRE, 100], [SERVIS, 100]];
  for (const [yol, esik] of ESIK) {
    it(`${gorece(yol)} · dolu satır > ${esik}`, () => {
      expect(existsSync(yol), gorece(yol)).toBe(true);
      const dolu = yorumsuz(oku(yol)).filter(s => s.trim() !== '').length;
      expect(dolu).toBeGreaterThan(esik);
    });
  }

  it('dizinler var ve üretim dosyası içeriyor', () => {
    expect(kaynakDosyalari(ROTA_DIZIN).length).toBeGreaterThan(5);
    expect(kaynakDosyalari(SERVIS_DIZIN).length).toBeGreaterThan(5);
    expect(kaynakDosyalari(SUNUCU_DIZIN).length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// §0d · yorum süzgecinin kör noktası çitlenir (inceleme bulgusu 2026-09-25, CONFIRMED)
// ---------------------------------------------------------------------------
//
// `yorumsuz` (6a gövdesiyle BİREBİR kilitli — değiştirilmez) metni belirteçlere ayırmaz: `//` yorumu İÇİNDEKİ
// bir blok açıcıyı ya da metin içindeki (URL joker alt alanı, dosya türü joker) açıcıyı gerçek blok yorum
// sanar ve sonraki kapatıcıya kadar KODU siler. Ölçüm: eslemeFatura.ts'te 18 kod satırı (sipariş dokümanının
// alanları) böyle görünmüyordu; kök server.ts'te CSP listesi (14 satır) bugün de görünmüyor. Yorumlar yeniden
// yazıldı; CSP metni üretim kodu olduğu için DEĞİŞTİRİLMEDİ — onun yerine (b) çiti her taramayı korur.
//
// KÂHİN: TypeScript ayrıştırıcısı. Belirteç (token) aralıklarının dışında kalan boşluk-dışı her karakter
// yorumdur; metin/şablon/JSX metni belirteç olduğu için içlerindeki açıcılar yorum SAYILMAZ. JSDoc düğümleri
// atlanır (belirteç değil, yorumdur). Yalnız bu çitte kullanılır — tarama yine `yorumsuz` ile yapılır.
const kahinOnbellek = new Map<string, string[]>();
function kahinSatirlari(yol: string): string[] {
  const onceki = kahinOnbellek.get(yol);
  if (onceki) return onceki;
  const metin = oku(yol);
  const sf = ts.createSourceFile(yol, metin, ts.ScriptTarget.Latest, false, yol.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const kod = new Uint8Array(metin.length);
  const gez = (n: ts.Node): void => {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if ((n.kind >= ts.SyntaxKind.FirstToken && n.kind <= ts.SyntaxKind.LastToken) || n.kind === ts.SyntaxKind.JsxText) {
      kod.fill(1, n.getStart(sf), n.getEnd());
      return;
    }
    n.getChildren(sf).forEach(gez);
  };
  gez(sf);
  const karakterler = metin.split('');
  for (let i = 0; i < karakterler.length; i++) {
    if (!kod[i] && !/\s/.test(karakterler[i])) karakterler[i] = ' ';
  }
  const satirlar = karakterler.join('').split('\n');
  kahinOnbellek.set(yol, satirlar);
  return satirlar;
}
/** Satır başına geçiş SAYISI karşılaştırması (delta hakem 2026-09-25): site kümesi yetmez — §1b/§6 geçişleri tek
 *  tek sayar, görünür bir çağrıyla aynı satırda yutulan ikinci çağrı küme karşılaştırmasından kaçıyordu. */
const kahinKacan = (dosyalar: string[], desen: RegExp): string[] =>
  dosyalar.flatMap(yol => {
    const yz = yorumsuz(oku(yol));
    return kahinSatirlari(yol).flatMap((kod, i) => {
      const k = adet(kod, desen), y = adet(yz[i] ?? '', desen);
      return k > y ? [`${gorece(yol)}:${i + 1} (kâhin ${k}, yorumsuz ${y})`] : [];
    });
  });

// Delta hakem 2026-09-25: açılış taraması süreç başlangıcını AÇIKÇA almalı (varsayılana bırakılan hesap
// canlıda koşan tek yoldu ve korunmuyordu). server.ts'teki çağrı bu alanı geçmeyi bırakırsa kırmızı.
describe('§0e · server.ts açılış taraması süreç başlangıcını açıkça geçirir', () => {
  it('yetimIsleriKapat({ … surecBaslangici … }) kod satırı = 1', () => {
    expect(say(SERVER_TS, /\byetimIsleriKapat\(\{[^}]*\bsurecBaslangici\s*:/)).toBe(1);
  });
});

describe('§0d · ÇİT: yorum süzgeci kod satırı YUTMAZ (kâhin: TypeScript ayrıştırıcısı)', () => {
  it('kâhin kendini sınar: `//` yorumundaki ve metindeki blok açıcı yorum DEĞİL; gerçek yorumlar silinir', () => {
    const fikstur = [
      "// AÇIK: components/reports/" + "* (rapor sayfaları)",
      "const a = collection('jobs');",
      "const csp = ['https:/" + "/*.googleapis.com'];",
      "const b = collection('jobs'); /" + "* satır içi *" + "/",
      "/" + "** JSDoc: collection('jobs') *" + "/",
      "const c = 1; // collection('jobs')",
      "const d = /https?:\\/\\//; collection('jobs');",
      "collection('jobs'); const r = /x\\/\\//; collection('jobs');",
    ].join('\n');
    // src DIŞINA yazılır: src'yi tarayan eşzamanlı testler geçici dosyayı üretim kaynağı sanmasın.
    const gecici = join(mkdtempSync(join(tmpdir(), 'kahin-')), 'fikstur.ts');
    writeFileSync(gecici, fikstur);
    try {
      const k = kahinSatirlari(gecici);
      expect(k.map((x, i) => (/collection\('jobs'\)/.test(x) ? i + 1 : 0)).filter(Boolean)).toEqual([2, 4, 7, 8]);
      expect(k[2]).toContain('googleapis');                        // metin KORUNUR
      // Aynı fikstürde `yorumsuz` 2. ve 4. satırı YUTAR — çitin yakalayacağı kör nokta budur.
      const y = yorumsuz(fikstur);
      expect(y.map((x, i) => (/collection\('jobs'\)/.test(x) ? i + 1 : 0)).filter(Boolean)).toEqual([8]);   // 8: görünür ilk çağrı
      // Satır başına SAYIM (b): aynı satırda görünür çağrı + yutulan ikinci çağrı küme karşılaştırmasından kaçardı
      // (delta hakem 2026-09-25: fikstür karşılaştırıcıyı hiç çağırmıyordu). 8. satırda yorumsuz 1, kâhin 2 sayar:
      // site kümesi iki tarafta da aynı (satır 8 var) — yalnız SAYI karşılaştırması yakalar.
      expect(adet(k[6], /collection\('jobs'\)/)).toBe(1);
      expect(adet(y[6], /collection\('jobs'\)/)).toBe(0);
      expect(adet(k[7], /collection\('jobs'\)/)).toBe(2);
      expect(adet(y[7], /collection\('jobs'\)/)).toBe(1);
      expect(kahinKacan([gecici], /collection\('jobs'\)/).map(x => x.replace(/^.*:(\d+) /, '$1 '))).toEqual(['2 (kâhin 1, yorumsuz 0)', '4 (kâhin 1, yorumsuz 0)', '7 (kâhin 1, yorumsuz 0)', '8 (kâhin 2, yorumsuz 1)']);
    } finally {
      unlinkSync(gecici);
    }
  });

  // (a) Bu işin SAHİBİ olduğu dosyalar: `yorumsuz` her satırda kâhinle AYNI kodu verir (boşluk hariç) — satırın
  // tamamı da, bir kısmı da yutulmaz (`\/\/` içeren regex literali satır sonunu yutuyordu: kanalRoutes). Bu dosyalar
  // üzerindeki HER tarama (H2, §6 TAM 5, §7 kopya literal ve `say(...)` sayımları dahil) böylece korunur.
  // Kırmızıysa yorumda/metinde/regex'te açıcı ya da çift eğik çizgi var — yeniden yaz (izin listesi YOK).
  it('(a) src/server/** + src/services/** + panel/kanca/kart/ekstre: `yorumsuz` ≡ kâhin (satır satır)', () => {
    const dosyalar = [...kaynakDosyalari(SUNUCU_DIZIN), ...kaynakDosyalari(SERVIS_DIZIN), PANEL, KANCA, KART, EKSTRE];
    const bosluksuz = (x: string) => x.replace(/\s+/g, '');
    const yutulan = dosyalar.flatMap(yol => {
      const yz = yorumsuz(oku(yol));
      return kahinSatirlari(yol).flatMap((kod, i) =>
        bosluksuz(kod) !== bosluksuz(yz[i] ?? '') ? [`${gorece(yol)}:${i + 1} kâhin=${kod.trim().slice(0, 70)} | yorumsuz=${(yz[i] ?? '').trim().slice(0, 70)}`] : []);
    });
    expect(yutulan).toEqual([]);
  });

  // (b) (a)'nın DIŞINDA kalan dosyaları (kök server.ts, src'nin geri kalanı) içeren taramalar: her satırda kâhinin
  // saydığı geçişi `yorumsuz` da sayıyor. server.ts'in CSP bölgesi gibi bilinen kör bölgeler kalsa da hiçbir desen
  // oradan kaçamaz. Tablo § testleriyle AYNI kümeleri kullanır; yalnız sahip olunan dosyaları tarayan maddeler (a)'da.
  it('(b) server.ts / tüm src içeren taramalarda kâhinin sayıp `yorumsuz`un kaçırdığı geçiş = 0', () => {
    const TARAMALAR: Array<[string, () => string[], RegExp]> = [
      ['§1 sqlAd',             SUNUCU_KUMESI,                        DESEN.sqlAd],
      ['§2 iife',              () => kaynakDosyalari(ROTA_DIZIN),    DESEN.iife],
      ['§3 iptalCiplak',       SUNUCU_KUMESI,                        DESEN.iptalCiplak],
      ['§3 iptalIsnull',       SUNUCU_KUMESI,                        DESEN.iptalIsnull],
      ['§3 iptalDinamikCiplak', SUNUCU_KUMESI,                       DESEN.iptalDinamikCiplak],
      ['§3 iptalDinamikIsnull', SUNUCU_KUMESI,                       DESEN.iptalDinamikIsnull],
      ['§4 bodyUndefined',     () => kaynakDosyalari(SERVIS_DIZIN),  DESEN.bodyUndefined],
      ['§5 jobsKoleksiyonu',   SUNUCU_KUMESI,                        DESEN.jobsKoleksiyonu],
      ['§7 jobs metni',        SRC_KUMESI,                           /['"]jobs['"]/],
      ['§7 eski import API',   SRC_KUMESI,                           /\b(?:importStokFromMikro|importCariFromMikro|MikroImportResult)\b/],
    ];
    const kacan = TARAMALAR.flatMap(([ad, kume, desen]) => kahinKacan(kume(), desen).map(site => `${ad}: ${site}`));
    expect(kacan).toEqual([]);
  }, 60_000);   // tüm src'yi TypeScript ile bir kez ayrıştırır (önbellekli)
});

// ---------------------------------------------------------------------------
// §1 · mikroSqlImportCalistir yalnız cron döngüsünde ya da arkaPlanIsiBaslat kapanışında
// ---------------------------------------------------------------------------

describe('§1 · DEĞİŞMEZ: `await mikroSqlImportCalistir(` yalnız cron döngüsü / `arkaPlanIsiBaslat` kapanışı', () => {
  const cagrilar = sqlImportCagrilari(oku(ROTA));
  const satirlar = kodSatirlari(ROTA);

  it('rota gövdesinde doğrudan await YOK (502 sınıfı: iş HTTP isteği içinde biter)', () => {
    const ihlal = cagrilar
      .filter(c => !c.izinli && !izinli({ site: `${gorece(ROTA)}:${c.satir}`, kod: satirlar[c.satir - 1].kod }))
      .map(c => `${gorece(ROTA)}:${c.satir} işaret=${c.isaret}`);
    expect(ihlal).toEqual([]);
  });

  it('izinli çağrı TAM 3: 2 cron (gece + aylık tam) + fabrika kapanışı — sayı değişirse şartname güncellenir', () => {
    expect(cagrilar.filter(c => c.izinli).map(c => c.isaret).sort()).toEqual(['arkaPlanIsiBaslat', 'cron', 'cron']);
  });

  const gecisler = sqlCagriGecisleri(oku(ROTA));

  it('ateşle-unut YOK (hakem 3): tanım hariç her `mikroSqlImportCalistir(` geçişi `await`li — `.catch(() => {})` kilitsiz, jobs\'suz arka plan işi kurardı', () => {
    expect(gecisler.filter(g => g.awaitsiz > 0).map(g => `${gorece(ROTA)}:${g.satir} ${satirlar[g.satir - 1].kod.trim().slice(0, 140)}`))
      .toEqual([]);
  });

  it('tanım hariç çağrı TAM 3 (hakem 3; ölçüm 2026-09-25: fabrika kapanışı + 2 cron) — ek çağrı ya da ikinci yol sayıyı değiştirir', () => {
    expect(gecisler.reduce((toplam, g) => toplam + g.cagri, 0)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §2 · rota dosyalarında satır başı IIFE yok — desen TEK yerde (yardımcı)
// ---------------------------------------------------------------------------

describe('§2 · DEĞİŞMEZ: `src/server/routes/*.ts` içinde satır başı IIFE = 0', () => {
  it('rota dosyaları (test hariç) 0', () => {
    expect(ihlaller(kaynakDosyalari(ROTA_DIZIN), DESEN.iife)).toEqual([]);
  });

  it('yardımcıda ≤ 1 (IIFE zorunlu değil; `.then/.catch` de olur)', () => {
    expect(say(HELPER, DESEN.iife)).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §3 · çıplak `x_iptal = 0` yok — sabit adla da dinamik `${iptalCol}` ile de; safe trio `ISNULL(x_iptal, 0) = 0`
// ---------------------------------------------------------------------------

describe('§3 · DEĞİŞMEZ: `src/server/**` + kök `server.ts` içinde çıplak `x_iptal = 0` = 0', () => {
  const sunucu = SUNUCU_KUMESI();

  it('çıplak eşitlik yok (NULL iptal alanı satırı SESSİZCE elerdi)', () => {
    expect(ihlaller(sunucu, DESEN.iptalCiplak)).toEqual([]);
  });

  it('bayatlama: gevşek `ISNULL(x_iptal, 0) = 0` kod satırı ≥ 12 (ölçüm 2026-09-24: 12)', () => {
    const n = sunucu.reduce((toplam, yol) => toplam + say(yol, DESEN.iptalIsnull), 0);
    expect(n).toBeGreaterThanOrEqual(12);
  });

  // Hakem 1 (2026-09-25): b95fc18'in düzelttiği 4 siteden 2'si (KDV pull, Mizan pull) kolon adını şemadan
  // bulur ve `${iptalCol}` yazar — sabit-ad deseni onları görmüyordu; `${iptalCol} = 0`'a geri dönüş yeşil
  // kalıyordu. Canlıdaki anlamı: `cha_iptal`'i NULL olan LUCA dekontları KDV özetinden ve mizandan SESSİZCE düşer.
  it('dinamik kolon adıyla çıplak eşitlik yok: `${iptalCol} = 0` (KDV/Mizan pull)', () => {
    expect(ihlaller(sunucu, DESEN.iptalDinamikCiplak)).toEqual([]);
  });

  it('bayatlama: dinamik `ISNULL(${iptalCol}, 0) = 0` kod satırı ≥ 2 (KDV pull + Mizan pull; ölçüm 2026-09-25: 2)', () => {
    const n = sunucu.reduce((toplam, yol) => toplam + say(yol, DESEN.iptalDinamikIsnull), 0);
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// §4 · gövdesiz POST yok — `body: undefined` (tek sözleşme; 411 curl ölçümü, tarayıcı 502'sini açıklamaz —
//      mikroService.ts:94 DÜRÜST NOT: tarayıcı gövdesiz fetch'e Content-Length: 0 kendisi ekler)
// ---------------------------------------------------------------------------

describe('§4 · DEĞİŞMEZ: `src/services/**` içinde `body: undefined` = 0', () => {
  it('gövdesiz POST üreten dal yok', () => {
    expect(ihlaller(kaynakDosyalari(SERVIS_DIZIN), DESEN.bodyUndefined)).toEqual([]);
  });

  it('bayatlama: mikroService.ts `JSON.stringify(body ?? {})` = 1 (safe trio)', () => {
    expect(say(SERVIS, /JSON\.stringify\(body \?\? \{\}\)/)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §5 · jobs/ yazımı TEK yerde ve companyId damgalı (jobs TENANT koleksiyonu)
// ---------------------------------------------------------------------------

describe("§5 · DEĞİŞMEZ: `collection('jobs')` yalnız `mikro/arkaPlanIsi.ts`'te ve companyId damgalı", () => {
  const hitler = bul(SUNUCU_KUMESI(), DESEN.jobsKoleksiyonu);

  it('rota/cron/başka modül jobs dokümanına DOĞRUDAN yazmaz', () => {
    expect(hitler.filter(h => !h.site.startsWith('src/server/mikro/arkaPlanIsi.ts:') && !izinli(h)).map(yaz)).toEqual([]);
  });

  it('yardımcı jobs koleksiyonunu açıyor (≥ 1)', () => {
    expect(hitler.filter(h => h.site.startsWith('src/server/mikro/arkaPlanIsi.ts:')).length).toBeGreaterThanOrEqual(1);
  });

  it('yardımcıda `.set({ … companyId … })` var — 2. kiracıya sızmasın (SSE süzgeci etiketsizi herkese akıtır)', () => {
    expect(DESEN.setCompanyId.test(yorumsuz(oku(HELPER)).join('\n'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 · yazıcı kaydı: senkron uçlar `yaziciyiIstegeBagla`, arka plan işi iş ömrünce kayıt
// ---------------------------------------------------------------------------

describe('§6 · DEĞİŞMEZ: `yaziciyiIstegeBagla(` mikroRoutes.ts TAM 5 (senkron uçlar); yardımcıda 0 + `yaziciSil(`', () => {
  it('mikroRoutes.ts tam 5 — arka plana alınan 3 uç (stok, cari, stok-miktar) `res.finish`e bağlı kaydı KULLANMAZ', () => {
    // Neden 5: bakimKilidi `res.once('finish', sil)` — kayıt YANIT bitince silinir; arka plan işi dakikalarca
    // yazmaya devam ederken bakım scripti "yazıcı yok" görürdü. Kalan 5 senkron uç Faz 4 listesi.
    expect(bul([ROTA], DESEN.yaziciBagla).map(b => b.site)).toHaveLength(5);
  });

  it('yardımcı `yaziciyiIstegeBagla` çağırmaz; `yaziciSil(` (veya `yaziciOlarakCalistir(`) ≥ 1', () => {
    expect(say(HELPER, DESEN.yaziciBagla)).toBe(0);
    expect(say(HELPER, /\byaziciSil\(|\byaziciOlarakCalistir\(/)).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §7 · bağlantı — "yazıldı ama bağlanmadı" kapısı
// ---------------------------------------------------------------------------

describe('§7 · DEĞİŞMEZ: yardımcı, sözlük, kart ve kanca GERÇEKTEN bağlı', () => {
  const rota = oku(ROTA);

  it("mikroRoutes.ts: `arkaPlanIsiBaslat` '../mikro/arkaPlanIsi.js'ten adlı import + ≥ 4 çağrı (stok, cari, stok-miktar, fabrika)", () => {
    expect(adliImportVar(rota, 'arkaPlanIsiBaslat', '../mikro/arkaPlanIsi.js')).toBe(true);
    expect(say(ROTA, DESEN.isaretHelper)).toBeGreaterThanOrEqual(4);
  });

  it("mikroRoutes.ts: `mikroIsAdi` '../../lib/mikroIsAdi.js'ten adlı import + ≥ 4 çağrı; ikinci ad listesi YOK", () => {
    expect(adliImportVar(rota, 'mikroIsAdi', '../../lib/mikroIsAdi.js')).toBe(true);
    expect(say(ROTA, /\bmikroIsAdi\(/)).toBeGreaterThanOrEqual(4);
    // Sözlük dışı literal (`'stokImport'`, `'cariImport'`, `sqlImport-`) = ikinci liste = kopya.
    expect(bul([ROTA], /'(?:stokImport|cariImport)'|sqlImport-/).map(yaz)).toEqual([]);
  });

  it('MikroSyncPanel.tsx: `<ArkaPlanIsiKarti` ≥ 4 (stok, cari, miktar, extraPullDefs döngüsü) + `mikroImportBaslat(` ≥ 1 + `arkaPlan: true` ≥ 1', () => {
    expect(say(PANEL, /<ArkaPlanIsiKarti\b/)).toBeGreaterThanOrEqual(4);
    expect(say(PANEL, /\bmikroImportBaslat\(/)).toBeGreaterThanOrEqual(1);
    // 12 SQL kartı döngüde `def.arkaPlan` ile kart bileşenine yönlenir — bayrak hiç yazılmadıysa döngü ölü dal.
    expect(say(PANEL, /\barkaPlan:\s*true\b/)).toBeGreaterThanOrEqual(1);
  });

  it("MikroSyncPanel.tsx: eski API (`importStokFromMikro`/`importCariFromMikro`/`MikroImportResult`) 0 ve `'jobs'` literal 0", () => {
    expect(bul([PANEL], /\b(?:importStokFromMikro|importCariFromMikro|MikroImportResult)\b/).map(yaz)).toEqual([]);
    expect(bul([PANEL], /['"]jobs['"]/).map(yaz)).toEqual([]);
  });

  it("useArkaPlanIsi.ts: `'jobs'` ≥ 1 — jobs/ okuması TEK kanca (orkestratör kararı)", () => {
    expect(say(KANCA, /['"]jobs['"]/)).toBeGreaterThanOrEqual(1);
  });

  // Hakem 4 (2026-09-25): kural eskiden yalnız MikroSyncPanel için sınanıyordu — başka bir istemci dosyası
  // kendi `doc(db,'jobs',…)` okuyucusunu eklese yeşil kalırdı. İzinli üç dosya: kanca (okur), sunucu
  // yardımcısı (yazar), koleksiyon sınıflandırması (`TENANT_COLLECTIONS` listesi). İkinci `expect` listeyi
  // bayatlamaya karşı kilitler (üçü de hâlâ eşleşiyor — dosya taşınırsa liste güncellenir, sessiz geçmez).
  it("src genelinde (test hariç) `'jobs'` kod satırı YALNIZ kanca + sunucu yardımcısı + koleksiyon listesi — ikinci okuyucu YOK", () => {
    const IZINLI_JOBS = ['src/hooks/useArkaPlanIsi.ts', 'src/lib/collections.ts', 'src/server/mikro/arkaPlanIsi.ts'];
    const hitler = bul(SRC_KUMESI(), /['"]jobs['"]/);
    const dosya = (b: Bulgu) => b.site.replace(/:\d+$/, '');
    expect(hitler.filter(b => !IZINLI_JOBS.includes(dosya(b))).map(yaz)).toEqual([]);
    expect([...new Set(hitler.map(dosya))].sort()).toEqual(IZINLI_JOBS);
  });

  it('ArkaPlanIsiKarti.tsx: `useArkaPlanIsi(` ≥ 1 — kart→kanca zinciri (kanca sabit `{ is: null }` ile değiştirilirse kart ölü)', () => {
    expect(say(KART, /\buseArkaPlanIsi\(/)).toBeGreaterThanOrEqual(1);
  });

  it('src genelinde (test hariç) eski import API 0 — istemci §A sildi, tüketicisi kalmadı', () => {
    expect(bul(SRC_KUMESI(), /\b(?:importStokFromMikro|importCariFromMikro|MikroImportResult)\b/).map(yaz)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §8 · Cari Ekstre tip 29 etiketi
// ---------------------------------------------------------------------------

describe('§8 · DEĞİŞMEZ: CariEkstrePanel.tsx `case 29:` ≥ 1 (Açılış fişi — LUCA dekontları bu tiptir)', () => {
  it('`case 29:` kod satırı ≥ 1', () => {
    expect(say(EKSTRE, /\bcase\s+29\s*:/)).toBeGreaterThanOrEqual(1);
  });

  it("K-D: EN etiketi UYDURULMADI — 'Opening entry' 0 (8 kardeş etiket TR-only; EN Mikro arayüzünden ölçülmedi)", () => {
    expect(say(EKSTRE, /Opening entry/)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H2 · sahte kesinlik — degismez.md "Hakem maddeleri" 2 (bilinmeyen sayı 0 YAZILMAZ)
// ---------------------------------------------------------------------------

describe('H2 · DEĞİŞMEZ: yardımcıda SERT1 = 0; `guidsizSatir` sayılmadıysa 0 YAZILMAZ', () => {
  // Hakem 5 (2026-09-25): şartname maddesi teste kodlanmamıştı; yardımcıya `durationMs: … ?? 0` gibi bir
  // varsayılan eklense yeşil kalırdı. Desen 6b'nin PAYLAŞILAN tarayıcısından (`sertIhlalleri`) — kopya yok.
  it('arkaPlanIsi.ts: SERT1 (`?? 0` / `|| 0`) = 0 — bilinmeyen sayaç `Number.isFinite` ile elenir, 0 uydurulmaz', () => {
    expect(sertIhlalleri(gorece(HELPER), oku(HELPER)).filter(i => i.sinif === 'S1').map(ihlalYaz)).toEqual([]);
  });

  // Hakem 2 (2026-09-25) mutantı `guidsizSatir: s.guidsizSatir ?? 0` beş testin hepsinde yeşil kalıyordu:
  // başarısız koşu jobs dokümanına '0 GUID'siz satır' diye KESİN bir sayı taşırdı. Davranış testi (hata
  // yolunda `guidsizSatir` null/yok) sunucu grubunun `mikroRoutes.arkaPlan.test.ts`'indedir; bu satır kaynak
  // tarafını kilitler (`let guidsizSatir = 0;` sayaç başlangıcı `=` ile yazıldığı için eşleşmez).
  it('mikroRoutes.ts: `guidsizSatir … ?? 0` / `|| 0` / `guidsizSatir: 0` = 0', () => {
    expect(bul([ROTA], DESEN.guidsizSifir).map(yaz)).toEqual([]);
  });
});
