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
 * Yorum satırları sayılmaz: süzgeç `src/test/degismezTarayici.ts`'ten (K-L; kopya YASAK — "assertion kendi
 * yorumuna takıldı ×5" dersi). Süzgecin iki girişi var: `yorumsuz(ad, içerik)` TAM DOSYA içindir
 * (ayrıştırılamayan girdide fırlatır), `yorumsuzParca(ad, içerik)` FİKSTÜR içindir (kod parçası; ayrıştırma
 * tanısına bakmaz). Bu dosyanın satır tarayan yardımcıları SÜZÜLMÜŞ SATIR DİZİSİ alır, süzmeyi çağıran yapar:
 * dosya katı girişle (`kodSatirlari(yol)` / `yorumsuz(yol, oku(yol))`), fikstür hoşgörülü girişle. Dosya
 * içeriği hoşgörülü girişe VERİLMEZ. Test/spec/düzenek dosyaları taranmaz. Dosya-okuyan yardımcılar
 * `src/test/kaynakTarama.ts`'te (degismez.md "YAZDIĞIN DOSYALAR"). Süzgeç 2026-10-08'de TypeScript
 * ayrıştırıcısına dayanacak biçimde yeniden yazıldı (tarihçe: §0d).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { yorumsuz, yorumsuzParca, sertIhlalleri, ihlalYaz } from '../../test/degismezTarayici';
import { kahinSatirlari } from '../../test/yorumKahini';
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

// Tarama KÜMELERİ — aynı kümeyi birden çok § tarar (sunucu: §3, §5 · tüm src: §7); liste TEK yerde durur.
const SUNUCU_KUMESI = () => [...kaynakDosyalari(SUNUCU_DIZIN), SERVER_TS];
const SRC_KUMESI    = () => [...kaynakDosyalari(SRC), SERVER_TS];

// Dosya yardımcıları (`kaynakDosyalari`, `kodSatirlari`, `suclular` → `bul`) `src/test/kaynakTarama.ts`'te.
const yaz = (b: Bulgu) => `${b.site} ${b.kod.trim().slice(0, 140)}`;
/** Desene uyan KOD satırı sayısı (`grep -c` eşleniği, yorumlar dışarıda). */
const say = (yol: string, desen: RegExp) => kodSatirlari(yol).filter(x => desen.test(x.kod)).length;

// ---------------------------------------------------------------------------
// §0 · Saf tarayıcılar — girdi SÜZÜLMÜŞ SATIR DİZİSİDİR, fikstürle sınanır (aşağıda)
// ---------------------------------------------------------------------------
//
// Süzmeyi ÇAĞIRAN yapar; yardımcı süzgeç çağırmaz, dosya adı da taşımaz. Aynı yardımcı hem gerçek dosyayla
// (katı giriş — ayrıştırılamayan dosyada fırlatır) hem fikstürle (hoşgörülü giriş: `yorumsuzParca('fikstur.ts', …)`;
// JSX içeren fikstür `.tsx` adıyla) çağrılır. İçeriği yardımcı süzseydi ikisinden birini seçmek zorunda kalırdı:
// katı giriş kod PARÇASI olan fikstürde fırlatır, hoşgörülü giriş dosyadaki sözdizimi hatasını / yanlış uzantıyı
// sessiz kör bölgeye çevirir.

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
 * `satirlar` süzülmüş kod satırlarıdır (yorum atılmış, satır numarası korunmuş).
 */
function sqlImportCagrilari(satirlar: string[]): SqlCagri[] {
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
function sqlCagriGecisleri(satirlar: string[]): SqlGecis[] {
  return satirlar.flatMap((kod, i) => {
    const cagri = adet(kod, DESEN.sqlAd) - adet(kod, DESEN.sqlTanim);
    return cagri > 0 ? [{ satir: i + 1, cagri, awaitsiz: cagri - adet(kod, DESEN.sqlCagri) }] : [];
  });
}

const kacis = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Adlı import KOD satırı (tek/çok satırlı): `import { …ad… } from '<yol>'`. Yorumda geçmesi yetmez
 *  (`satirlar` süzülmüş kod satırlarıdır). */
function adliImportVar(satirlar: string[], ad: string, yol: string): boolean {
  const desen = new RegExp(`\\bimport\\s*\\{[^}]*\\b${kacis(ad)}\\b[^}]*\\}\\s*from\\s*['"]${kacis(yol)}['"]`);
  return desen.test(satirlar.join('\n'));
}

describe('§0 · tarayıcı kendini sınar (mutasyon-ayırt-edici fikstürler)', () => {
  // Fikstürler kod PARÇASIDIR; birçoğu (SQL parçası, açık blok, tek özellik satırı) kendi başına geçerli
  // TypeScript değildir ve katı girişte (`yorumsuz`) fırlatır. Hepsi çağrıldığı yerde hoşgörülü girişle süzülür.
  const sayFikstur = (satirlar: string[], desen: RegExp) => satirlar.filter(k => desen.test(k)).length;

  it('IIFE: satır başı `(async () => {` / `void (…)` / `(async function` ✓; çağrı argümanı olan async ok ✗', () => {
    expect(sayFikstur(yorumsuzParca('fikstur.ts', '    (async () => {'), DESEN.iife)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', '    void (async () => {'), DESEN.iife)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', '  (async function () {'), DESEN.iife)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', '  C.setAiHealthProbe(async () => {'), DESEN.iife)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', '  const f = vi.fn(async () => {});'), DESEN.iife)).toBe(0);
  });

  it('iptal çıplak: `cha_iptal = 0` / `sth_iptal=0` ✓; ISNULL biçimleri ve `<> 0` ✗', () => {
    expect(sayFikstur(yorumsuzParca('fikstur.ts', "ekKosul: 'cha_iptal = 0',"), DESEN.iptalCiplak)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'WHERE sth_iptal=0 AND'), DESEN.iptalCiplak)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', "ekKosul: 'ISNULL(cha_iptal, 0) = 0',"), DESEN.iptalCiplak)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'ISNULL(sth_iptal,0)=0'), DESEN.iptalCiplak)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'WHERE ISNULL(cha_iptal, 0) <> 0'), DESEN.iptalCiplak)).toBe(0);
  });

  it('§3 bayatlama (gevşek ISNULL): boşluklu/boşluksuz ✓; `<> 0` ✗; yorumdaki anma sayılmaz', () => {
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'ISNULL(sth_iptal,0)=0'), DESEN.iptalIsnull)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'ISNULL(cha_iptal, 0) = 0'), DESEN.iptalIsnull)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'ISNULL(cha_iptal, 0) <> 0'), DESEN.iptalIsnull)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', '// ISNULL(cha_iptal,0)=0 ZORUNLU'), DESEN.iptalIsnull)).toBe(0);
  });

  it('iptal DİNAMİK (hakem 1): `${iptalCol} = 0` / `${iptalCol}=0` ✓; ISNULL sarmalı ve `<> 0` ✗; bayatlama deseni tersini sayar', () => {
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`${iptalCol} = 0`);'), DESEN.iptalDinamikCiplak)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`${iptalCol}=0`);'), DESEN.iptalDinamikCiplak)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`ISNULL(${iptalCol}, 0) = 0`);'), DESEN.iptalDinamikCiplak)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'WHERE ISNULL(${iptalKol}, 0) <> 0'), DESEN.iptalDinamikCiplak)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`ISNULL(${iptalCol}, 0) = 0`);'), DESEN.iptalDinamikIsnull)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'WHERE ISNULL(${iptalKol}, 0) <> 0'), DESEN.iptalDinamikIsnull)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`${iptalCol} = 0`);'), DESEN.iptalDinamikIsnull)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', '// kosul.push(`ISNULL(${iptalCol}, 0) = 0`);'), DESEN.iptalDinamikIsnull)).toBe(0);
    // Sabit-ad deseni dinamik biçimi GÖRMEZ, sabit-ad bayatlama sayımı da saymaz — iki desen ayrı durmak ZORUNDA.
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`${iptalCol} = 0`);'), DESEN.iptalCiplak)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`ISNULL(${iptalCol}, 0) = 0`);'), DESEN.iptalIsnull)).toBe(0);
    // Noktalı erişim (inceleme bulgusu 2026-09-25): seçenek nesnesinden gelen kolon adı.
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`${opts.iptalCol} = 0`);'), DESEN.iptalDinamikCiplak)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`${this.iptalKol}=0`);'), DESEN.iptalDinamikCiplak)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`ISNULL(${opts.iptalCol}, 0) = 0`);'), DESEN.iptalDinamikCiplak)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'kosul.push(`ISNULL(${opts.iptalCol}, 0) = 0`);'), DESEN.iptalDinamikIsnull)).toBe(1);
  });

  it('H2 guidsizSatir: `?? 0` / `|| 0` / düz `: 0` ✓; `?? null`, çıplak alan ve `let … = 0` sayacı ✗', () => {
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'guidsizSatir: s.guidsizSatir ?? 0,'), DESEN.guidsizSifir)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'res.json({ guidsizSatir: sonuc.guidsizSatir || 0 });'), DESEN.guidsizSifir)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'return { jobAlanlari: { tablo: opts.tablo, guidsizSatir: 0 } };'), DESEN.guidsizSifir)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'guidsizSatir: s.guidsizSatir ?? null,'), DESEN.guidsizSifir)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'guidsizSatir: s.guidsizSatir,   // başarıda HER ZAMAN sayılır'), DESEN.guidsizSifir)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', '    let guidsizSatir = 0;'), DESEN.guidsizSifir)).toBe(0);
  });

  it('body: `body: undefined` / `body !== undefined ?` ✓; `JSON.stringify(body ?? {})` ✗', () => {
    expect(sayFikstur(yorumsuzParca('fikstur.ts', '      body: undefined,'), DESEN.bodyUndefined)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'body: body !== undefined ? JSON.stringify(body) : undefined,'), DESEN.bodyUndefined)).toBe(1);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'body: JSON.stringify(body ?? {}),'), DESEN.bodyUndefined)).toBe(0);
  });

  it('§1 işaret yürüyüşü: rota gövdesi İHLAL; kapanış/cron izinli; yorum sayılmaz; işaret YOKSA İHLAL (hakem 1)', () => {
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', ['app.post(x, async (req,res) => {', '  const s = await mikroSqlImportCalistir(a);'].join('\n'))))
      .toEqual([{ satir: 2, isaret: 'app.route', izinli: false }]);
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', [
      'app.post(x, async (req,res) => {', '  await arkaPlanIsiBaslat(dep, { calistir: async () => {', '    const s = await mikroSqlImportCalistir(a);',
    ].join('\n')))).toEqual([{ satir: 3, isaret: 'arkaPlanIsiBaslat', izinli: true }]);
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', ['for (const opts of SQL_IMPORT_TANIMLARI) {', '  const r = await mikroSqlImportCalistir(opts);'].join('\n'))))
      .toEqual([{ satir: 2, isaret: 'cron', izinli: true }]);
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', '// const s = await mikroSqlImportCalistir(a);'))).toEqual([]);
    // Kapanış ayrı bir yardımcıya çıkarılmış: ne `app.post` ne `arkaPlanIsiBaslat` — "(yok)" → İHLAL.
    // ("bilinmeyen → izinli" mutasyonu burada kırılır.)
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', ['async function sqlImportKapanisi(opts) {', '  const s = await mikroSqlImportCalistir(opts);'].join('\n'))))
      .toEqual([{ satir: 2, isaret: '(yok)', izinli: false }]);
    // İKİ çağrı, farklı sınıflar: her biri KENDİ en yakın işaretini alır (rota, sonra cron).
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', [
      'app.post(x, async (req,res) => {', '  const s = await mikroSqlImportCalistir(a);', '});',
      'for (const opts of SQL_IMPORT_TANIMLARI) {', '  const r = await mikroSqlImportCalistir(opts);',
    ].join('\n'))).map(c => `${c.satir}:${c.isaret}`)).toEqual(['2:app.route', '5:cron']);
  });

  it('§1 kapsam (hakem 3): KAPANMIŞ işaret atlanır — kapanış dışına taşınan çağrı ve biten döngü sonrası çağrı İHLAL; tek satırlık kapanış izinli', () => {
    // `arkaPlanIsiBaslat(…)` aynı satırda kapandı; altındaki doğrudan await rota gövdesindedir.
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', [
      'app.post(x, async (req,res) => {',
      '  const r = await arkaPlanIsiBaslat(dep, { calistir: async () => ({ ozet: "" }) });',
      '  const s = await mikroSqlImportCalistir(a);',
    ].join('\n')))).toEqual([{ satir: 3, isaret: 'app.route', izinli: false }]);
    // Çok satırlı kapanış `});` ile bitti; çağrı ondan SONRA.
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', [
      'app.post(x, async (req,res) => {',
      '  const r = await arkaPlanIsiBaslat(dep, {', '    calistir: async () => ({ ozet: "" }),', '  });',
      '  const s = await mikroSqlImportCalistir(a);',
    ].join('\n')))).toEqual([{ satir: 5, isaret: 'app.route', izinli: false }]);
    // Cron döngüsü kapandı; çağrı döngünün DIŞINDA.
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', [
      'app.post(x, async (req,res) => {',
      '  for (const o of SQL_IMPORT_TANIMLARI) { await y(o); }',
      '  const s = await mikroSqlImportCalistir(a);',
    ].join('\n')))).toEqual([{ satir: 3, isaret: 'app.route', izinli: false }]);
    // Hiçbir kapsamı açık işaret yok → (yok).
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', ['for (const o of SQL_IMPORT_TANIMLARI) {', '}', 'const s = await mikroSqlImportCalistir(a);'].join('\n'))))
      .toEqual([{ satir: 3, isaret: '(yok)', izinli: false }]);
    // Aynı satırda açık kapanış: çağrı ÖNCESİ metin de yürünür.
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', '  await arkaPlanIsiBaslat(dep, { calistir: async () => ({ s: await mikroSqlImportCalistir(a) }) });')))
      .toEqual([{ satir: 1, isaret: 'arkaPlanIsiBaslat', izinli: true }]);
    // Kapanış içindeki iç içe parantez/süslü (SQL şablonu, nesne) kapsamı KAPATMAZ.
    expect(sqlImportCagrilari(yorumsuzParca('fikstur.ts', [
      '  await arkaPlanIsiBaslat(dep, {', '    senkronKaydi: { operation: `SQL:${t}`, entityType: c },',
      '    calistir: async (ilerle) => {', '      const s = await mikroSqlImportCalistir(o, a => ilerle({ ...a }));',
    ].join('\n')))).toEqual([{ satir: 4, isaret: 'arkaPlanIsiBaslat', izinli: true }]);
  });

  it('§1b ateşle-unut (hakem 3): tanım hariç her geçiş sayılır; `await`\'siz (`.catch`, `void`, `const p =`) ayrı; yorum sayılmaz', () => {
    expect(sqlCagriGecisleri(yorumsuzParca('fikstur.ts', ['  async function mikroSqlImportCalistir(', '    opts: SqlImportOpts,'].join('\n')))).toEqual([]);
    expect(sqlCagriGecisleri(yorumsuzParca('fikstur.ts', '  const r = await mikroSqlImportCalistir(opts);'))).toEqual([{ satir: 1, cagri: 1, awaitsiz: 0 }]);
    expect(sqlCagriGecisleri(yorumsuzParca('fikstur.ts', '  mikroSqlImportCalistir(opts, companyId, ilk, son, actor).catch(() => {});')))
      .toEqual([{ satir: 1, cagri: 1, awaitsiz: 1 }]);
    expect(sqlCagriGecisleri(yorumsuzParca('fikstur.ts', '  void mikroSqlImportCalistir(opts);'))).toEqual([{ satir: 1, cagri: 1, awaitsiz: 1 }]);
    expect(sqlCagriGecisleri(yorumsuzParca('fikstur.ts', '  const p = mikroSqlImportCalistir(a); await mikroSqlImportCalistir(b);')))
      .toEqual([{ satir: 1, cagri: 2, awaitsiz: 1 }]);
    expect(sqlCagriGecisleri(yorumsuzParca('fikstur.ts', '  // mikroSqlImportCalistir(opts).catch(() => {});'))).toEqual([]);
  });

  it('yorum süzgeci (`degismezTarayici.yorumsuzParca` — fikstür girişi): satır başı/sonu/blok/JSX sayılmaz; blok sonrası satır kaymaz; URL `//` yutmaz', () => {
    const d = DESEN.iptalCiplak;
    expect(sayFikstur(yorumsuzParca('fikstur.ts', "// eski: ekKosul: 'cha_iptal = 0',"), d)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', 'const a = b; // eski cha_iptal = 0'), d)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', ['/**', " * eski koşul: 'cha_iptal = 0'", ' */'].join('\n')), d)).toBe(0);
    expect(sayFikstur(yorumsuzParca('fikstur.tsx', '        {/* cha_iptal = 0 */}'), d)).toBe(0);
    const fikstur = ['/* satır 1', '   satır 2', '   satır 3 */', "const k = 'sth_iptal = 0';"].join('\n');
    expect(yorumsuzParca('fikstur.ts', fikstur).flatMap((k, i) => (d.test(k) ? [i + 1] : []))).toEqual([4]);
    expect(sayFikstur(yorumsuzParca('fikstur.ts', "const u = 'https://x.test'; const k = 'sth_iptal = 0';"), d)).toBe(1);
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
    expect(adliImportVar(yorumsuzParca('fikstur.ts', "import { arkaPlanIsiBaslat, bakimKilidiMesaji } from '../mikro/arkaPlanIsi.js';"), 'arkaPlanIsiBaslat', YOL)).toBe(true);
    expect(adliImportVar(yorumsuzParca('fikstur.ts', "import {\n  arkaPlanIsiBaslat,\n  type BaslatSonucu,\n} from '../mikro/arkaPlanIsi.js';"), 'arkaPlanIsiBaslat', YOL)).toBe(true);
    expect(adliImportVar(yorumsuzParca('fikstur.ts', "// import { arkaPlanIsiBaslat } from '../mikro/arkaPlanIsi.js';"), 'arkaPlanIsiBaslat', YOL)).toBe(false);
    expect(adliImportVar(yorumsuzParca('fikstur.ts', "import { arkaPlanIsiBaslat } from './arkaPlanIsi.js';"), 'arkaPlanIsiBaslat', YOL)).toBe(false);
    expect(adliImportVar(yorumsuzParca('fikstur.ts', "import { arkaPlanIsiBekle } from '../mikro/arkaPlanIsi.js';"), 'arkaPlanIsiBaslat', YOL)).toBe(false);
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
      const dolu = kodSatirlari(yol).filter(x => x.kod.trim() !== '').length;
      expect(dolu).toBeGreaterThan(esik);
    });
  }

  it('dizinler var ve üretim dosyası içeriyor', () => {
    expect(kaynakDosyalari(ROTA_DIZIN).length).toBeGreaterThan(5);
    expect(kaynakDosyalari(SERVIS_DIZIN).length).toBeGreaterThan(5);
    expect(kaynakDosyalari(SUNUCU_DIZIN).length).toBeGreaterThan(20);
  });
});

// Delta hakem 2026-09-25: açılış taraması süreç başlangıcını AÇIKÇA almalı (varsayılana bırakılan hesap
// canlıda koşan tek yoldu ve korunmuyordu). server.ts'teki çağrı bu alanı geçmeyi bırakırsa kırmızı.
describe('§0e · server.ts açılış taraması süreç başlangıcını açıkça geçirir', () => {
  it('yetimIsleriKapat({ … surecBaslangici … }) kod satırı = 1', () => {
    expect(say(SERVER_TS, /\byetimIsleriKapat\(\{[^}]*\bsurecBaslangici\s*:/)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §0d · yorum süzgeci ile kâhin aynı fikstürde AYNI sonucu verir (eski kör bölgenin fikstürü)
// ---------------------------------------------------------------------------
//
// Tarihçe. 2026-09-25 incelemesi (CONFIRMED): o günkü süzgeç iki düzenli ifadeydi; metni belirteçlere ayırmadığı
// için `//` yorumu ya da metin (URL joker alt alanı, dosya türü jokeri) içindeki blok açıcıyı gerçek yorum sanıp
// sonraki kapatıcıya kadar KODU, `\/\/` taşıyan düzenli ifade değişmezinden sonra da satırın kalanını siliyordu
// (o günkü ölçüm: eslemeFatura.ts'te 18, kök server.ts CSP listesinde 14 kod satırı görünmüyordu). Süzgeç
// düzeltilmedi; bu bölüm onu bir TypeScript kâhiniyle çitledi ((a) satır satır eşitlik, (b) geçiş sayımı).
//
// 2026-10-08: süzgeç TypeScript ayrıştırıcısına dayanacak biçimde yeniden yazıldı (`src/test/degismezTarayici.ts`),
// kâhin `src/test/yorumKahini.ts`'e taşındı, (a) ve (b) SİLİNDİ — süzgeç ≡ kâhin eşitliğini bütün kaynaklarda depo
// çiti ölçer (`src/test/degismezTarayici.test.ts`). Burada o arızanın FİKSTÜRÜ kaldı: eskiden arızayı beklenti
// olarak sabitliyordu (kâhin [2, 4, 7, 8], süzgeç [8]); şimdi süzgecin de kâhinle aynı ve DOĞRU sonucu verdiğini
// kilitler. Süzgeç eski gövdeye dönerse burada kırmızı.

/** Satır başına geçiş SAYISI karşılaştırması (delta hakem 2026-09-25): site kümesi yetmez — görünür bir çağrıyla aynı
 *  satırda yutulan ikinci çağrı küme karşılaştırmasından kaçar. Girdi iki satır dizisidir (kâhin, süzgeç); kâhinin
 *  süzgeçten FAZLA saydığı satırları döndürür. */
const kahinKacan = (kahin: string[], suzulmus: string[], desen: RegExp): string[] =>
  kahin.flatMap((kod, i) => {
    const k = adet(kod, desen), y = adet(suzulmus[i] ?? '', desen);
    return k > y ? [`${i + 1} (kâhin ${k}, yorumsuz ${y})`] : [];
  });

describe('§0d · yorum süzgeci ≡ kâhin: eski kör bölgenin fikstüründe ikisi AYNI ve DOĞRU', () => {
  it('`//` yorumundaki, metindeki ve düzenli ifadedeki açıcı yorum DEĞİL; gerçek yorumlar silinir — süzgeçte de kâhinde de', () => {
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
    const jobs = /collection\('jobs'\)/;
    const k = kahinSatirlari('fikstur.ts', fikstur);
    // Fikstür kendi başına geçerli bir dosyadır → KATI giriş (§ taramalarının `kodSatirlari` üzerinden kullandığı giriş).
    const y = yorumsuz('fikstur.ts', fikstur);
    expect(k.map((x, i) => (jobs.test(x) ? i + 1 : 0)).filter(Boolean)).toEqual([2, 4, 7, 8]);
    expect(y.map((x, i) => (jobs.test(x) ? i + 1 : 0)).filter(Boolean)).toEqual([2, 4, 7, 8]);   // eski süzgeç: [8]
    expect(k[2]).toContain('googleapis');                        // metin KORUNUR
    expect(y[2]).toContain('googleapis');                        // eski süzgeç 1–4. satırları tek blok yorum sanıyordu
    // Satır başına SAYIM: 7. satırda çağrı düzenli ifade değişmezinden SONRA; 8. satırda biri önce, biri sonra. Eski
    // süzgeç 7'de 0, 8'de 1 sayıyordu — 8'de site kümesi aynı kalır (satır görünür), farkı yalnız SAYI gösterir.
    expect(adet(k[6], jobs)).toBe(1);
    expect(adet(y[6], jobs)).toBe(1);
    expect(adet(k[7], jobs)).toBe(2);
    expect(adet(y[7], jobs)).toBe(2);
    expect(kahinKacan(k, y, jobs)).toEqual([]);
    // Karşılaştırıcının dişi (delta hakem 2026-09-25: fikstür karşılaştırıcıyı hiç çalıştırmıyordu): süzgeç çıktısından
    // 8. satırın İKİNCİ çağrısı eksilirse — eski arızanın biçimi — karşılaştırıcı onu yakalar.
    const eksik = y.map((x, i) => (i === 7 ? x.slice(0, x.lastIndexOf('collection')) : x));
    expect(kahinKacan(k, eksik, jobs)).toEqual(['8 (kâhin 2, yorumsuz 1)']);
    // Tam eşitlik (depo çitinin ölçüsü): kâhin yorumu boşluğa çevirir, süzgeç siler — boşluk hariç satır satır aynı.
    const bosluksuz = (x: string) => x.replace(/\s+/g, '');
    expect(y.map(bosluksuz)).toEqual(k.map(bosluksuz));
  });
});

// ---------------------------------------------------------------------------
// §1 · mikroSqlImportCalistir yalnız cron döngüsünde ya da arkaPlanIsiBaslat kapanışında
// ---------------------------------------------------------------------------

describe('§1 · DEĞİŞMEZ: `await mikroSqlImportCalistir(` yalnız cron döngüsü / `arkaPlanIsiBaslat` kapanışı', () => {
  const satirlar = kodSatirlari(ROTA);
  const cagrilar = sqlImportCagrilari(satirlar.map(x => x.kod));

  it('rota gövdesinde doğrudan await YOK (502 sınıfı: iş HTTP isteği içinde biter)', () => {
    const ihlal = cagrilar
      .filter(c => !c.izinli && !izinli({ site: `${gorece(ROTA)}:${c.satir}`, kod: satirlar[c.satir - 1].kod }))
      .map(c => `${gorece(ROTA)}:${c.satir} işaret=${c.isaret}`);
    expect(ihlal).toEqual([]);
  });

  it('izinli çağrı TAM 3: 2 cron (gece + aylık tam) + fabrika kapanışı — sayı değişirse şartname güncellenir', () => {
    expect(cagrilar.filter(c => c.izinli).map(c => c.isaret).sort()).toEqual(['arkaPlanIsiBaslat', 'cron', 'cron']);
  });

  const gecisler = sqlCagriGecisleri(satirlar.map(x => x.kod));

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
    expect(DESEN.setCompanyId.test(yorumsuz(HELPER, oku(HELPER)).join('\n'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 · yazıcı kaydı: senkron uçlar `yaziciyiIstegeBagla`, arka plan işi iş ömrünce kayıt
// ---------------------------------------------------------------------------

describe('§6 · DEĞİŞMEZ: `yaziciyiIstegeBagla(` mikroRoutes.ts TAM 6 (senkron uçlar); yardımcıda 0 + `yaziciSil(`', () => {
  it('mikroRoutes.ts tam 6 — arka plana alınan 3 uç (stok, cari, stok-miktar) `res.finish`e bağlı kaydı KULLANMAZ', () => {
    // Neden senkron uçlar: bakimKilidi `res.once('finish', sil)` — kayıt YANIT bitince silinir; arka plan işi dakikalarca
    // yazmaya devam ederken bakım scripti "yazıcı yok" görürdü. 5 senkron uç Faz 4 listesi + 2026-10-02 `import/gib-durum`
    // (senkron, 90 sn bütçeli; mikroFaturalar + orders'a yazar → bakım scripti bitmesini beklemeli).
    expect(bul([ROTA], DESEN.yaziciBagla).map(b => b.site)).toHaveLength(6);
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
  const rota = yorumsuz(ROTA, oku(ROTA));

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
  }, 60_000);   // tüm src'yi süzer (TypeScript ayrıştırıcısı; dosya başına bir kez, önbellekli)

  it('ArkaPlanIsiKarti.tsx: `useArkaPlanIsi(` ≥ 1 — kart→kanca zinciri (kanca sabit `{ is: null }` ile değiştirilirse kart ölü)', () => {
    expect(say(KART, /\buseArkaPlanIsi\(/)).toBeGreaterThanOrEqual(1);
  });

  it('src genelinde (test hariç) eski import API 0 — istemci §A sildi, tüketicisi kalmadı', () => {
    expect(bul(SRC_KUMESI(), /\b(?:importStokFromMikro|importCariFromMikro|MikroImportResult)\b/).map(yaz)).toEqual([]);
  }, 60_000);   // tüm src'yi süzer — tek başına koşarsa (`-t`) önbellek soğuktur
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
