// @vitest-environment node
/**
 * kiraciOrtami.test.ts — sunucu kiracısının ortam okuyucusu (2026-10-08, mağaza dilim 1 inceleme turu).
 *
 * NEDEN VAR: `ortamdanKiraci` mağaza talep ucunun yazacağı kiracıyı (server.ts `serverTenantId`), açılış uyarısını ve bekçinin
 * «kiracı taramayla çözülüyor» kırmızısını besler; ama onu içe aktaran tek test (`opsWatchdog.magazaTalep.test.ts`) işlevi TAKLİT
 * ediyor, bağlama çiti de yalnız çağrı metnini arıyordu. Gövde `return '';` ya da yalnız `MIKRO_CRON_COMPANY_ID` okuyacak biçimde
 * bozulduğunda bütün paket yeşil kalıyordu (ölçüldü). Burada işlev GERÇEK gövdesiyle koşar; ortam nesnesi parametreyle verilir —
 * gerçek ortam yalnız son testte, `vi.stubEnv` ile okunur.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ortamdanKiraci, rolluKiracilar, taramadanKiraci, type KullaniciBelgesi } from './kiraciOrtami.js';
import { APP_ROLES } from '../lib/rbac.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('ortamdanKiraci — sunucu kiracısının ortam okuyucusu', () => {
  it('öncelik: SERVER_TENANT_COMPANY_ID, MIKRO_CRON_COMPANY_ID değerinin önündedir', () => {
    expect(ortamdanKiraci({ SERVER_TENANT_COMPANY_ID: 'kiraci-a', MIKRO_CRON_COMPANY_ID: 'kiraci-b' })).toBe('kiraci-a');
  });

  it('SERVER_TENANT_COMPANY_ID yoksa / boşsa MIKRO_CRON_COMPANY_ID değerine düşer', () => {
    expect(ortamdanKiraci({ MIKRO_CRON_COMPANY_ID: 'kiraci-b' })).toBe('kiraci-b');
    expect(ortamdanKiraci({ SERVER_TENANT_COMPANY_ID: '', MIKRO_CRON_COMPANY_ID: 'kiraci-b' })).toBe('kiraci-b');
  });

  it('ikisi de yoksa boş dizge döner (tanımsız değil)', () => {
    expect(ortamdanKiraci({})).toBe('');
  });

  it('parametresiz çağrı process.env okur', () => {
    vi.stubEnv('SERVER_TENANT_COMPANY_ID', 'kiraci-ortam');
    vi.stubEnv('MIKRO_CRON_COMPANY_ID', '');
    expect(ortamdanKiraci()).toBe('kiraci-ortam');
  });
});

// ── Kiracı taraması (2026-10-11, şartname «dış rol kapanışı» D12 / T11) ────────────────────────────────────────────────────
// Ortam değeri YOKKEN sunucu kiracıyı `users` taramasından çözer. Giriş ekranından hesap açan yabancının rolsüz belgesi ikinci
// kiracı sayılıyor, tarama boş dönüyordu: mağaza sipariş talebi 503, Mikro zamanlanmış işleri «belirsiz» diye atlanıyordu.
const b = (id: string, veri: Record<string, unknown> | undefined): KullaniciBelgesi => ({ id, veri });
const SAHIP = b('sahip-uid', { email: 'sahip@example.test', role: 'Admin' });                         // kurucu: `companyId` alanı yok → kiracı = kendi kimliği
const PERSONEL = b('personel-uid', { email: 'satis@example.test', role: 'Sales', companyId: 'sahip-uid' });

describe('taramadanKiraci — `users` taramasında yalnız ROLÜ olan belgeler sayılır', () => {
  it('sahip + rolsüz yabancı belge → hâlâ sahibin kiracısı', () => {
    const yabanci = b('yabanci-uid', { email: 'yabanci@example.test', name: 'Yabancı' });             // istemcinin açılış yazımı: rol / kiracı alanı yok
    expect(taramadanKiraci([SAHIP, yabanci])).toBe('sahip-uid');
    expect(taramadanKiraci([yabanci, SAHIP, PERSONEL, b('yabanci-2', {})])).toBe('sahip-uid');        // sıra ve sayı fark etmez
  });

  it('rol alanı geçersiz olan belge de sayılmaz: sayı (eski `/increment` yolu), uydurma dizge, boş, yanlış harf, dizi', () => {
    for (const rol of [1, 0, 'user', 'Viewer', '', 'admin', ' Admin', null, undefined, ['Admin'], { ad: 'Admin' }, true]) {
      expect(taramadanKiraci([SAHIP, b('cop-uid', { role: rol })]), JSON.stringify(rol)).toBe('sahip-uid');
      // `companyId` taşısa da (ör. kendine uydurma kiracı yazmış belge) rolü yoksa kiracı sayılmaz.
      expect(taramadanKiraci([SAHIP, b('cop-uid', { role: rol, companyId: 'baska-kiraci' })]), JSON.stringify(rol)).toBe('sahip-uid');
    }
  });

  it('iki gerçek kiracı → boş (belirsiz: sunucu yanlış kiracıya YAZMAZ)', () => {
    const ikinci = b('ikinci-sahip', { email: 'ikinci@example.test', role: 'Admin' });
    expect(taramadanKiraci([SAHIP, ikinci])).toBe('');
    expect(taramadanKiraci([SAHIP, PERSONEL, b('ikinci-personel', { role: 'Accounting', companyId: 'ikinci-sahip' })])).toBe('');
    expect(rolluKiracilar([SAHIP, PERSONEL, ikinci]).sort()).toEqual(['ikinci-sahip', 'sahip-uid']);
  });

  it('dış rol (B2B, Bayi) rolü olan hesaptır: kendi kiracısıyla sayılır (davetle gelen bayi sahibin kiracısındadır)', () => {
    expect(taramadanKiraci([SAHIP, b('bayi-uid', { role: 'Dealer', companyId: 'sahip-uid' })])).toBe('sahip-uid');
    expect(taramadanKiraci([SAHIP, b('bayi-uid', { role: 'B2B', companyId: 'baska-kiraci' })])).toBe('');
  });

  it('HER bilinen rol sayılır (liste `APP_ROLES`\'tan; rol eklenince kapsam kendiliğinden büyür)', () => {
    for (const rol of APP_ROLES) expect(rolluKiracilar([b(`u-${rol}`, { role: rol })]), rol).toEqual([`u-${rol}`]);
  });

  it('kiracı kimliği: `companyId` alanı, yoksa / boşsa / dize değilse belge kimliği (`getUserCompanyId` ile aynı kural)', () => {
    expect(rolluKiracilar([b('u1', { role: 'Sales', companyId: 'K' })])).toEqual(['K']);
    expect(rolluKiracilar([b('u1', { role: 'Sales' })])).toEqual(['u1']);
    expect(rolluKiracilar([b('u1', { role: 'Sales', companyId: '' })])).toEqual(['u1']);
    expect(rolluKiracilar([b('u1', { role: 'Sales', companyId: 7 })])).toEqual(['u1']);
    expect(rolluKiracilar([b('u1', { role: 'Sales', companyId: 'K' }), b('u2', { role: 'HR', companyId: 'K' })])).toEqual(['K']);   // tekil
  });

  it('rolü olan belge YOKSA boş: yalnız rolsüz hesaplardan kiracı çıkmaz (yabancının kimliği sunucu kiracısı OLAMAZ)', () => {
    expect(taramadanKiraci([])).toBe('');
    expect(taramadanKiraci([b('yabanci-uid', { name: 'Yabancı' })])).toBe('');
    expect(taramadanKiraci([b('verisiz', undefined)])).toBe('');
  });
});

describe('bağlantı çiti: ÜÇ tarama da AYNI yardımcıdan (server.ts `serverTenantId`, crons.ts `cronCompanyId`, mikroRoutes.ts `sqlSenkronHedefTenant`)', () => {
  const kok = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const sunucu = readFileSync(join(kok, 'server.ts'), 'utf8');
  const cronlar = readFileSync(join(kok, 'src', 'server', 'crons.ts'), 'utf8');
  const mikro = readFileSync(join(kok, 'src', 'server', 'routes', 'mikroRoutes.ts'), 'utf8');
  const govde = (metin: string, bas: RegExp, uzunluk: number): string => {
    const i = metin.search(bas);
    expect(i, `bulunamadı: ${bas}`).toBeGreaterThan(-1);
    return metin.slice(i, i + uzunluk);
  };

  it('dosyalar okunuyor (çit boş metne bakmasın)', () => {
    expect(sunucu.length).toBeGreaterThan(100_000);
    expect(cronlar.length).toBeGreaterThan(10_000);
    expect(mikro.length).toBeGreaterThan(100_000);
  });

  it('`sqlSenkronHedefTenant` (gece + aylık SQL senkronu): ortam → `users` taraması → `rolluKiracilar(...)`; elle kurulmuş kiracı kümesi yok', () => {
    // ÜÇÜNCÜ kopya: ilk düzeltme `serverTenantId` ve `cronCompanyId`'ye uygulanmış, bu eski kuralla (her belge sayılır) kalmıştı.
    // Davranışı gerçek gövdeyle: routes/mikroRoutes.kiraciTaramasi.test.ts.
    const g = govde(mikro, /const sqlSenkronHedefTenant = async \(\): Promise<string> => \{/, 1500);
    expect(g).toMatch(/if \(process\.env\.MIKRO_CRON_COMPANY_ID\) return process\.env\.MIKRO_CRON_COMPANY_ID;/);
    expect(g).toMatch(/const snap = await C\.getAdminDb\(\)\.collection\('users'\)\.get\(\);/);
    expect(g).toMatch(/const kiracilar = rolluKiracilar\(snap\.docs\.map\(/);
    expect(g).toMatch(/if \(kiracilar\.length === 1\) return kiracilar\[0\];/);
    expect(g).not.toMatch(/new Set/);
  });

  it('sunucu kaynağında `users` taramasından ELLE kiracı kümesi kuran yer YOK (dördüncü kopya doğarsa kırılır)', () => {
    // Eski kopyaların ortak biçimi: `new Set(…snap.docs.map(d => (d.data().companyId as string) || d.id))` + `cids.size === 1`.
    // Süper yönetici panelinin kiracı LİSTESİ (superadminRoutes.ts) küme kurmaz, belge belge gezer — bu desene girmez.
    const dizin = (d: string): string[] => readdirSync(d).flatMap(ad => {
      const yol = join(d, ad);
      if (statSync(yol).isDirectory()) return dizin(yol);
      return /\.ts$/.test(ad) && !/\.(test|spec|testDuzenegi)\.ts$/.test(ad) ? [yol] : [];
    });
    const dosyalar = [join(kok, 'server.ts'), ...dizin(join(kok, 'src', 'server'))];
    expect(dosyalar.length).toBeGreaterThan(40);
    const ELLE_KUME = /new Set(?:<string>)?\(\s*\w+\.docs\.map\((?:(?!\n\s*\n)[\s\S]){0,240}?companyId(?:(?!\n\s*\n)[\s\S]){0,80}?\|\|\s*d\.id/;
    const suclu = dosyalar.filter(yol => ELLE_KUME.test(readFileSync(yol, 'utf8'))).map(yol => yol.slice(kok.length + 1));
    expect(suclu).toEqual([]);
    // Desen eski kopyayı GERÇEKTEN tanıyor (çit boş yere geçmesin): tabandaki üç gövdenin biçimi.
    expect(ELLE_KUME.test("const cids = new Set(snap.docs.map(d => (d.data().companyId as string) || d.id));")).toBe(true);
    expect(ELLE_KUME.test("const cids = new Set<string>(snap.docs.map((d: { data: () => Record<string, unknown>; id: string }) =>\n        (d.data().companyId as string) || d.id));")).toBe(true);
    // Taramayı yapan yerler tam olarak bu üçü (yardımcıyı çağıran dosyalar).
    const cagiran = dosyalar.filter(yol => /\b(rolluKiracilar|taramadanKiraci)\(/.test(readFileSync(yol, 'utf8'))).map(yol => yol.slice(kok.length + 1)).sort();
    expect(cagiran).toEqual(['server.ts', 'src/server/crons.ts', 'src/server/kiraciOrtami.ts', 'src/server/routes/mikroRoutes.ts']);
  });

  it('`serverTenantId`: ortam → `users` taraması → `taramadanKiraci(...)`; elle kurulmuş kiracı kümesi yok', () => {
    const g = govde(sunucu, /^async function serverTenantId\(\): Promise<string> \{$/m, 900);
    expect(g).toMatch(/const env = ortamdanKiraci\(\);[^\n]*\n\s+if \(env\) return env;/);
    expect(g).toMatch(/const snap = await adminDb\.collection\('users'\)\.get\(\);/);
    expect(g).toMatch(/return taramadanKiraci\(snap\.docs\.map\(d => \(\{ id: d\.id, veri: d\.data\(\) \}\)\)\);/);
    expect(g).not.toMatch(/new Set/);
  });

  it('`cronCompanyId`: ortam → `users` taraması → `rolluKiracilar(...)`; elle kurulmuş kiracı kümesi yok', () => {
    const g = govde(cronlar, /const cronCompanyId = async \(\): Promise<string> => \{/, 1300);
    expect(g).toMatch(/if \(process\.env\.MIKRO_CRON_COMPANY_ID\) return process\.env\.MIKRO_CRON_COMPANY_ID;/);
    expect(g).toMatch(/const kiracilar = rolluKiracilar\(snap\.docs\.map\(/);
    expect(g).toMatch(/if \(kiracilar\.length === 1\) return kiracilar\[0\];/);
    expect(g).not.toMatch(/new Set/);
  });
});
