// @vitest-environment node
/**
 * scripts/verify-deploy.sh — CI denetimi doğrulanan commit'in KENDİ yayın işine bakar (2026-10-08 / 09).
 *
 * Arıza: betik `gh run list --limit 1` ile depodaki EN SON işi alıyordu. 2026-10-08'de `7597e7a` gönderiminden hemen sonra
 * koşan «Dependabot Updates» işi (success) «PASS CI run …» diye yazıldı; yayın işi kırık olsa da o satır yeşil kalırdı.
 * İnceleme turu (2026-10-08) beş şey daha buldu: `post` aralık varsayılanının bash'te yanlış ayrışması, gönderim ulaşmadığında
 * önceki commit'in eski yeşil işinin PASS sayılması, uzak uç okunamayınca bilgi satırıyla yeşil çıkış, yayın adımı atlanmış
 * yeşil koşu, `ci` kipinde gereksiz bayat-ref FAIL'i. Hepsi burada sabitlenir.
 *
 * Bu dosya betiğin `ci` kipini GERÇEKTEN koşturur (`bash scripts/verify-deploy.sh ci`); `gh` ve `git` PATH'e konan sahteleriyle
 * değiştirilir. Sahte `gh`, GitHub'ın süzgeçlerini taklit eder: VERİLMEYEN süzgeç uygulanmaz — yani betik bir süzgeci
 * unutursa (ya da eski koda dönerse) «en yeni iş» döner ve aşağıdaki senaryolardan biri kırılır. Canlıya / GitHub'a istek yok.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, delimiter } from 'path';

const KOK = join(__dirname, '..', '..');
const BETIK = join(KOK, 'scripts', 'verify-deploy.sh');

const HEDEF = 'aaaaaaa1111111111111111111111111111111aa';   // uzak main'in ucu
const ESKI = 'bbbbbbb2222222222222222222222222222222bb';    // bir önceki gönderim

interface SahteIs {
  id: number;
  /** İş akışı DOSYASI (`--workflow ci.yml` buna bakar). */
  dosya: string;
  dal: string;
  olay: string;
  sha: string;
  sonuc: 'success' | 'failure';
  /** Bu iş `run list` çağrılarının kaçıncısından itibaren görünür (0 = hep). Gönderimden sonra iş kaydının gecikmesi. */
  gorunmeTuru?: number;
}
interface Senaryo {
  /** En YENİ iş başta (gh'nin sırası). */
  isler: SahteIs[];
  /** Depoda var olan iş akışı dosyaları; başka ad verilirse gh 404 ile düşer. */
  akislar?: string[];
  /** `git ls-remote origin refs/heads/main` yanıtı; null = komut başarısız (ağ yok). */
  uzak?: string | null;
  /** `git rev-parse --verify -q origin/main` yanıtı; null = ref yok. */
  yerel?: string | null;
  /** `gh run list` çıkış kodu 1 (oturum yok / ağ). */
  ghHata?: boolean;
  /** `git rev-parse --verify -q HEAD`; null = ref yok. Varsayılan = uzak main'in ucu (gönderim ulaşmış). */
  head?: string | null;
  /** `git merge-base --is-ancestor HEAD <hedef>`; false = HEAD uzak main'de yok. */
  headAtasi?: boolean;
  /** `gh run view <id> --json jobs -q …` ile okunan yayın ADIMI sonucu; null = okunamadı (boş çıktı). */
  yayinAdimi?: string | null;
}

const SAHTE_GH = `#!/usr/bin/env node
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(process.env.SAHTE_SENARYO, 'utf8'));
const a = process.argv.slice(2);
fs.appendFileSync(process.env.SAHTE_GUNLUK, JSON.stringify(['gh', ...a]) + '\\n');
const al = (...adlar) => { for (const ad of adlar) { const i = a.indexOf(ad); if (i !== -1) return a[i + 1]; } return undefined; };
if (a[0] === 'run' && a[1] === 'list') {
  if (S.ghHata) { process.stderr.write('gh: oturum yok\\n'); process.exit(1); }
  const sayacDosyasi = process.env.SAHTE_GUNLUK + '.sayac';
  const tur = fs.existsSync(sayacDosyasi) ? Number(fs.readFileSync(sayacDosyasi, 'utf8')) : 0;
  fs.writeFileSync(sayacDosyasi, String(tur + 1));
  const wf = al('--workflow', '-w'), dal = al('--branch', '-b'), olay = al('--event', '-e'), sha = al('--commit', '-c');
  if (wf !== undefined && !(S.akislar || ['ci.yml', 'codeql.yml', 'dependabot.yml']).includes(wf)) {
    process.stderr.write('HTTP 404: workflow ' + wf + ' not found on the default branch\\n'); process.exit(1);
  }
  // GitHub'ın davranışı: VERİLMEYEN süzgeç uygulanmaz.
  let isler = S.isler.filter(i => (i.gorunmeTuru || 0) <= tur);
  if (wf !== undefined) isler = isler.filter(i => i.dosya === wf);
  if (dal !== undefined) isler = isler.filter(i => i.dal === dal);
  if (olay !== undefined) isler = isler.filter(i => i.olay === olay);
  if (sha !== undefined) isler = isler.filter(i => i.sha === sha);
  isler = isler.slice(0, Number(al('--limit', '-L') || 20));
  const q = al('-q', '--jq');
  if (q === '.[0].databaseId // empty') { if (isler[0]) console.log(isler[0].id); process.exit(0); }
  if (q === '.[0].databaseId') { console.log(isler[0] ? isler[0].id : ''); process.exit(0); }
  console.log(JSON.stringify(isler.map(i => ({ databaseId: i.id })))); process.exit(0);
}
if (a[0] === 'run' && a[1] === 'view') {
  const is = S.isler.find(i => String(i.id) === a[2]);
  if (!is) process.exit(1);
  const q = al('-q', '--jq') || '';
  // Gerçek gh: jq süzgeci iş ADI ve adım ADI ile seçer; sahte, süzgeçte iki adın geçtiğini ister (ad değişirse boş döner).
  const adlarUyuyor = q.includes('Deploy to Windows VDS') && q.includes('Deploy (SSH → PowerShell)');
  const sonuc = S.yayinAdimi === undefined ? 'success' : S.yayinAdimi;
  if (adlarUyuyor && sonuc !== null) console.log(sonuc);
  process.exit(0);
}
if (a[0] === 'run' && a[1] === 'watch') {
  const is = S.isler.find(i => String(i.id) === a[2]);
  if (!is) process.exit(1);
  // Gerçek gh: \`--exit-status\` verilmezse iş başarısız olsa da 0 ile çıkar.
  process.exit(a.includes('--exit-status') && is.sonuc !== 'success' ? 1 : 0);
}
process.exit(2);
`;

const SAHTE_GIT = `#!/usr/bin/env node
const fs = require('fs');
const S = JSON.parse(fs.readFileSync(process.env.SAHTE_SENARYO, 'utf8'));
const a = process.argv.slice(2);
fs.appendFileSync(process.env.SAHTE_GUNLUK, JSON.stringify(['git', ...a]) + '\\n');
if (a[0] === 'fetch') process.exit(0);
if (a[0] === 'ls-remote') { if (S.uzak === null) process.exit(128); console.log(S.uzak + '\\trefs/heads/main'); process.exit(0); }
if (a[0] === 'rev-parse' && a.includes('HEAD')) { const h = S.head === undefined ? S.uzak : S.head; if (h === null || h === undefined) process.exit(1); console.log(h); process.exit(0); }
if (a[0] === 'rev-parse') { if (S.yerel === null) process.exit(1); console.log(S.yerel); process.exit(0); }
if (a[0] === 'merge-base') {
  // Gerçek git: '--is-ancestor <ata?> <torun>' — sıra anlamlıdır; sahte de sırayı denetler (ters yazım 128 ile düşer).
  const head = S.head === undefined ? S.uzak : S.head;
  const hedef = S.uzak === null || S.uzak === undefined ? S.yerel : S.uzak;
  if (a[1] !== '--is-ancestor' || a[2] !== head || a[3] !== hedef) process.exit(128);
  process.exit(S.headAtasi === false ? 1 : 0);
}
process.exit(0);
`;

const gecici: string[] = [];
afterEach(() => { for (const d of gecici.splice(0)) rmSync(d, { recursive: true, force: true }); });

interface Kosu { kod: number | null; cikti: string; satirlar: string[]; cagrilar: string[][]; listeSayisi: number }

function kos(s: Senaryo): Kosu {
  const dizin = mkdtempSync(join(tmpdir(), 'vd-ci-'));
  gecici.push(dizin);
  for (const [ad, govde] of [['gh', SAHTE_GH], ['git', SAHTE_GIT]] as const) {
    writeFileSync(join(dizin, ad), govde);
    chmodSync(join(dizin, ad), 0o755);
  }
  const senaryo = join(dizin, 'senaryo.json');
  const gunluk = join(dizin, 'gunluk.jsonl');
  writeFileSync(senaryo, JSON.stringify({ uzak: HEDEF, yerel: HEDEF, ...s }));
  const r = spawnSync('bash', [BETIK, 'ci'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      PATH: `${dizin}${delimiter}${process.env.PATH ?? ''}`,
      SAHTE_SENARYO: senaryo,
      SAHTE_GUNLUK: gunluk,
      CI_ARAMA_DENEME: '3',
      CI_ARAMA_ARALIK: '0',
    },
  });
  const cagrilar = existsSync(gunluk)
    ? readFileSync(gunluk, 'utf8').split('\n').filter(Boolean).map((l): string[] => JSON.parse(l) as string[])
    : [];
  const cikti = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return {
    kod: r.status,
    cikti,
    satirlar: cikti.split('\n').filter(l => /^(PASS|FAIL| {2}--) /.test(l)),
    cagrilar,
    listeSayisi: cagrilar.filter(c => c[0] === 'gh' && c[1] === 'run' && c[2] === 'list').length,
  };
}

const is = (id: number, ek: Partial<SahteIs> = {}): SahteIs => ({ id, dosya: 'ci.yml', dal: 'main', olay: 'push', sha: HEDEF, sonuc: 'success', ...ek });
const DEPENDABOT = is(900, { dosya: 'dependabot.yml', olay: 'dynamic' });
const CODEQL = is(800, { dosya: 'codeql.yml', olay: 'dynamic' });
const PASS_700 = 'PASS  CI & Deploy işi 700 (aaaaaaa): yayın adımı koştu';
const FAIL_700 = 'FAIL  CI & Deploy işi 700 (aaaaaaa) başarısız ya da izlenemedi — gh run view 700 ile incele';

// Betik bash ister; Windows'ta (yayın sunucusu) test koşulmaz — CI derleme işi ubuntu'da koşturur.
describe.skipIf(process.platform === 'win32')('verify-deploy.sh ci — doğrulanan commit\'in KENDİ yayın işi', () => {
  it('2026-10-08 arızası: en yeni iş Dependabot (success), yayın işi BAŞARISIZ → FAIL (eskiden PASS yazıyordu)', () => {
    const k = kos({ isler: [DEPENDABOT, CODEQL, is(700, { sonuc: 'failure' })] });
    expect(k.satirlar).toEqual([FAIL_700]);
    expect(k.kod).toBe(1);
    expect(k.cikti).toContain('== verify-deploy ci: BASARISIZ KONTROL VAR ==');
  });

  it('aynı tablo, yayın işi başarılı → PASS ve yazılan kimlik YAYIN işinin kimliği (Dependabot\'unki değil)', () => {
    const k = kos({ isler: [DEPENDABOT, CODEQL, is(700)] });
    expect(k.satirlar).toEqual([PASS_700]);
    expect(k.kod).toBe(0);
    expect(k.cikti).toContain('== verify-deploy ci: TUM KONTROLLER GECTI ==');
    expect(k.listeSayisi).toBe(1);
  });

  it.each<[string, SahteIs]>([
    ['başka İŞ AKIŞI (aynı commit, aynı dal, push)', is(900, { dosya: 'codeql.yml' })],
    ['başka COMMIT (bir önceki gönderimin yayın işi)', is(900, { sha: ESKI })],
    ['başka OLAY (aynı commit için pull_request koşusu)', is(900, { olay: 'pull_request' })],
    ['başka DAL (aynı commit staging dalına da gönderilmiş)', is(900, { dal: 'staging/deneme' })],
  ])('süzgeç — %s başarılı ve daha yeni, hedefin yayın işi başarısız → FAIL', (_ad, yaniltici) => {
    const k = kos({ isler: [yaniltici, is(700, { sonuc: 'failure' })] });
    expect(k.satirlar).toEqual([FAIL_700]);
    expect(k.kod).toBe(1);
  });

  it('süzgeçlerin dördü de GERÇEKTEN veriliyor (iş akışı dosyası, dal, olay, uzak main\'in ucu); iş `--exit-status` ile izleniyor; önce taze fetch', () => {
    const k = kos({ isler: [is(700)] });
    const liste = k.cagrilar.find(c => c[1] === 'run' && c[2] === 'list') ?? [];
    const deger = (ad: string): string | undefined => { const i = liste.indexOf(ad); return i === -1 ? undefined : liste[i + 1]; };
    expect(deger('--workflow')).toBe('ci.yml');
    expect(deger('--branch')).toBe('main');
    expect(deger('--event')).toBe('push');
    expect(deger('--commit')).toBe(HEDEF);
    expect(k.cagrilar.filter(c => c[1] === 'run' && c[2] === 'watch')).toEqual([['gh', 'run', 'watch', '700', '--exit-status']]);
    expect(k.cagrilar[0]).toEqual(['git', 'fetch', '-q', 'origin', 'main']);
  });

  it('hedefin yayın işi HİÇ yok (yalnız eski commit\'in yeşil işi var) → yoklama sınırı kadar denenir, sonra FAIL «bulunamadı»', () => {
    const k = kos({ isler: [DEPENDABOT, is(600, { sha: ESKI })] });
    expect(k.listeSayisi).toBe(3);   // CI_ARAMA_DENEME
    expect(k.satirlar).toHaveLength(1);
    expect(k.satirlar[0]).toMatch(/^FAIL {2}CI: aaaaaaa için ci\.yml işi bulunamadı — gönderim main'e ulaştı mı\?/);
    expect(k.cagrilar.some(c => c[1] === 'run' && c[2] === 'watch')).toBe(false);
    expect(k.kod).toBe(1);
  });

  it('iş kaydı gönderimden SONRA oluşur: ilk iki yoklamada yok, üçüncüde var → PASS (eski işe düşülmez)', () => {
    const k = kos({ isler: [is(700, { gorunmeTuru: 2 }), is(600, { sha: ESKI })] });
    expect(k.listeSayisi).toBe(3);
    expect(k.satirlar).toEqual([PASS_700]);
    expect(k.kod).toBe(0);
  });

  it('hedef UZAK main\'in ucudur: yerel origin/main bayatsa eski commit\'in yeşil işi PASS sayılmaz; `ci` kipinde bayatlık yalnız bilgi', () => {
    // Yerel ref bir önceki gönderimde kalmış; o commit'in işi yeşil, yeni commit'in işi kırık.
    const k = kos({ yerel: ESKI, isler: [is(700, { sonuc: 'failure' }), is(600, { sha: ESKI })] });
    expect(k.satirlar).toEqual([
      '  --  CI: yerel origin/main (bbbbbbb) uzak main (aaaaaaa) gerisinde; bu kip yalnız uzak ucu kullanır',
      FAIL_700,
    ]);
    expect(k.kod).toBe(1);
  });

  it('yerel ref bayat ama uzak ucun işi yeşil: `ci` kipinde PASS ve rc 0 (aralığa dayalı kontrol bu kipte koşmaz)', () => {
    const k = kos({ yerel: ESKI, isler: [is(700), is(600, { sha: ESKI })] });
    expect(k.satirlar).toEqual([
      '  --  CI: yerel origin/main (bbbbbbb) uzak main (aaaaaaa) gerisinde; bu kip yalnız uzak ucu kullanır',
      PASS_700,
    ]);
    expect(k.kod).toBe(0);
  });

  it('uzak okunamıyor (ağ / kimlik): hedef DOĞRULANAMADI → FAIL ve rc 1; iş yine de yerel ref ile aranıp yazılır', () => {
    const k = kos({ uzak: null, yerel: ESKI, head: ESKI, isler: [is(700), is(600, { sha: ESKI })] });
    expect(k.satirlar).toEqual([
      'FAIL  CI: uzak main okunamadı (git ls-remote origin); hedef doğrulanamadı, yerel origin/main (bbbbbbb) kullanıldı',
      'PASS  CI & Deploy işi 600 (bbbbbbb): yayın adımı koştu',
    ]);
    expect(k.kod).toBe(1);
  });

  it('gönderim ULAŞMAMIŞ (HEAD uzak main\'de yok): önceki commit\'in yeşil işi bulunsa da FAIL ve rc 1', () => {
    // Uzak = yerel = ESKİ (gönderim reddedildi); HEAD yeni commit; ESKİ'nin işi çoktan yeşil.
    const k = kos({ uzak: ESKI, yerel: ESKI, head: HEDEF, headAtasi: false, isler: [is(600, { sha: ESKI })] });
    expect(k.satirlar).toEqual([
      'FAIL  HEAD (aaaaaaa) uzak main\'de (bbbbbbb) YOK — gönderim ulaştı mı? (reddedildiyse uzak main önceki gönderimdir)',
      'PASS  CI & Deploy işi 600 (bbbbbbb): yayın adımı koştu',
    ]);
    expect(k.kod).toBe(1);
    expect(k.cagrilar.find(c => c[1] === 'merge-base')).toEqual(['git', 'merge-base', '--is-ancestor', HEDEF, ESKI]);
  });

  it('HEAD uzak main\'in ATASI ise (ana kopyadan koşuldu) FAIL yok', () => {
    const k = kos({ head: ESKI, headAtasi: true, isler: [is(700)] });
    expect(k.satirlar).toEqual([PASS_700]);
    expect(k.kod).toBe(0);
  });

  it.each<[string, string | null]>([['skipped', 'skipped'], ['okunamadı (boş çıktı)', null], ['failure', 'failure']])(
    'koşu yeşil ama yayın ADIMI koşmamış (%s): FAIL «sunucuya kod gitmedi»', (_ad, sonuc) => {
      const k = kos({ yayinAdimi: sonuc, isler: [is(700)] });
      expect(k.satirlar).toEqual([`FAIL  CI & Deploy işi 700 (aaaaaaa) yeşil ama yayın adımı KOŞMADI (adım sonucu: ${sonuc ?? 'okunamadı'}) — sunucuya kod gitmedi`]);
      expect(k.kod).toBe(1);
      const goruntule = k.cagrilar.filter(c => c[1] === 'run' && c[2] === 'view');
      expect(goruntule).toHaveLength(1);
      expect(goruntule[0].slice(0, 6)).toEqual(['gh', 'run', 'view', '700', '--json', 'jobs']);
      expect(goruntule[0][7]).toContain('Deploy to Windows VDS');
      expect(goruntule[0][7]).toContain('Deploy (SSH → PowerShell)');
    });

  it('ne uzak ne yerel: hedef çözülemez → FAIL, gh hiç çağrılmaz', () => {
    const k = kos({ uzak: null, yerel: null, isler: [is(700)] });
    expect(k.satirlar).toEqual(['FAIL  CI: hedef commit çözülemedi (git ls-remote origin ve yerel origin/main ikisi de boş)']);
    expect(k.cagrilar.some(c => c[0] === 'gh')).toBe(false);
    expect(k.kod).toBe(1);
  });

  it('gh ÇALIŞMIYOR (oturum yok / ağ): boş liste sayılmaz — tek çağrıda FAIL, 90 sn beklenmez', () => {
    const k = kos({ ghHata: true, isler: [is(700)] });
    expect(k.listeSayisi).toBe(1);
    expect(k.satirlar).toEqual(['FAIL  CI: gh çalışmadı (ci.yml, aaaaaaa) — gh auth status ile incele']);
    expect(k.kod).toBe(1);
  });

  it('iş akışı dosyası depoda yoksa (yeniden adlandırılmış) gh 404 verir → FAIL; başka iş akışına düşülmez', () => {
    const k = kos({ akislar: ['yayin.yml', 'codeql.yml'], isler: [is(900, { dosya: 'codeql.yml' }), is(700, { dosya: 'yayin.yml' })] });
    expect(k.satirlar).toEqual(['FAIL  CI: gh çalışmadı (ci.yml, aaaaaaa) — gh auth status ile incele']);
    expect(k.kod).toBe(1);
  });

  it('`post` aralığı: açık argüman aynen; varsayılanın sol ucu fetch\'ten ÖNCE SHA\'ya çözülür; çözülemezse boş (rota denetimi FAIL)', () => {
    const satirlar = readFileSync(BETIK, 'utf8').split('\n');
    const bas = satirlar.findIndex(s => /^\s*if \[ -n "\$\{2:-\}" \]; then$/.test(s));
    expect(bas).toBeGreaterThan(0);
    const blok = satirlar.slice(bas, bas + 6);
    expect(blok.map(s => s.trim())).toEqual([
      'if [ -n "${2:-}" ]; then',
      'RANGE="$2"',
      'else',
      "ONCEKI=$(git rev-parse -q --verify 'origin/main@{1}' 2>/dev/null) || ONCEKI=\"\"",
      'RANGE="${ONCEKI:+$ONCEKI...origin/main}"',
      'fi',
    ]);
    // Aralık `ci_denetimi post` (içinde fetch) çağrısından ÖNCE çözülür.
    const cagri = satirlar.findIndex(s => /^\s+ci_denetimi post$/.test(s));
    expect(cagri).toBeGreaterThan(bas + 5);
    // Blok, sahte git ile: önceki uç varsa `<sha>...origin/main`; yoksa boş; açık argüman aynen.
    const kos2 = (gitCiktisi: string | null, ...args: string[]) => {
      const dizin = mkdtempSync(join(tmpdir(), 'vd-aralik-'));
      gecici.push(dizin);
      writeFileSync(join(dizin, 'git'), `#!/usr/bin/env node\nif (${gitCiktisi === null ? 'true' : 'false'}) process.exit(1); console.log(${JSON.stringify(gitCiktisi ?? '')});\n`);
      chmodSync(join(dizin, 'git'), 0o755);
      return spawnSync('bash', ['-c', `set -- ${args.map(a => `'${a}'`).join(' ')}; ${blok.join('\n')}; printf '%s' "$RANGE"`], { encoding: 'utf8', env: { ...process.env, PATH: `${dizin}${delimiter}${process.env.PATH ?? ''}` } }).stdout;
    };
    expect(kos2(ESKI, 'post')).toBe(`${ESKI}...origin/main`);
    expect(kos2(null, 'post')).toBe('');
    expect(kos2(ESKI, 'post', 'abc123..def456')).toBe('abc123..def456');
    // Boş aralık rota denetiminde FAIL'dir, PASS değil.
    expect(satirlar.some(s => /if \[ -z "\$RANGE" \]; then/.test(s))).toBe(true);
    expect(satirlar.some(s => /fail "yeni korumalı route denetimi KOŞMADI: reflog'da origin\/main@\{1\} yok/.test(s))).toBe(true);
  });
});

describe('verify-deploy.sh — `post` kipi aynı denetimi kullanır (kaynak çiti)', () => {
  // `post` kipinin tamamı canlıya sondalar atar; testte koşturulmaz. Bağ kaynak metninden doğrulanır.
  const satirlar = readFileSync(BETIK, 'utf8').split('\n');
  const kod = satirlar.map(s => s.replace(/^\s*#.*$/, ''));
  const no = (desen: RegExp): number[] => kod.flatMap((s, i) => (desen.test(s) ? [i + 1] : []));

  it('`ci_denetimi` bir kez tanımlı, iki kez çağrılıyor: `ci` dalında kipi `ci`, `post` (else) dalında kipi `post`', () => {
    expect(no(/^ci_denetimi\(\) \{$/)).toHaveLength(1);
    const cagri = no(/^\s+ci_denetimi (ci|post)$/);
    expect(cagri).toHaveLength(2);
    expect(no(/^\s+ci_denetimi ci$/)).toHaveLength(1);
    expect(no(/^\s+ci_denetimi post$/)).toHaveLength(1);
    const ciDali = no(/^if \[ "\$PHASE" = ci \]; then$/);
    const preDali = no(/^elif \[ "\$PHASE" = pre \]; then$/);
    // Satır başındaki iki `else`: kip dallanmasının `post` dalı ve en sondaki özet (`TUM KONTROLLER GECTI` / `BASARISIZ`).
    const ustElse = no(/^else$/);
    expect(ciDali).toHaveLength(1);
    expect(preDali).toHaveLength(1);
    expect(ustElse).toHaveLength(2);
    const postDali = ustElse[0];
    expect(postDali).toBeGreaterThan(preDali[0]);
    expect(cagri[0]).toBeGreaterThan(ciDali[0]);
    expect(cagri[0]).toBeLessThan(preDali[0]);
    expect(cagri[1]).toBeGreaterThan(postDali);
    expect(cagri[1]).toBeLessThan(ustElse[1]);
    // `post` dalında CI denetimi ilk iştir: canlı sağlık yoklamasından ÖNCE (yayın bitmeden sağlık eski sürecin sağlığıdır).
    expect(cagri[1]).toBeLessThan(no(/curl -sf --max-time 20 "\$BASE_URL\/api\/health"/)[0]);
  });

  it('süzgeçsiz «en son iş» sorgusu betikte KALMADI; `gh run list` tek yerde ve dört süzgeçle', () => {
    // Komut olarak tek yerde (hata iletisinin metninde de geçer; o komut değildir).
    const liste = no(/\$\(gh run list /);
    expect(liste).toHaveLength(1);
    expect(no(/gh run list --limit 1 /)).toEqual([]);
    const satir = kod[liste[0] - 1];
    for (const parca of ['--workflow "$CI_DOSYASI"', '--branch main', '--event push', '--commit "$hedef"']) expect(satir, parca).toContain(parca);
    expect(no(/^CI_DOSYASI="ci\.yml"$/)).toHaveLength(1);
    expect(existsSync(join(KOK, '.github', 'workflows', 'ci.yml'))).toBe(true);
  });

  it('rota denetimi git HATASINI boş farktan ayırır: diff başarısızsa FAIL, PASS yazılmaz; taze fetch `ci_denetimi`nin başında', () => {
    expect(no(/^\s+elif ! ROUTE_FARKI=\$\(git diff "\$RANGE" -- server\.ts 2>\/dev\/null\); then$/)).toHaveLength(1);
    expect(no(/fail "yeni korumalı route denetimi KOŞMADI/)).toHaveLength(2);   // reflog yok + git diff hatası
    expect(no(/^\s+git fetch -q origin main 2>\/dev\/null \|\| true$/)).toHaveLength(1);
    expect(no(/^\s+git fetch -q origin main 2>\/dev\/null$/)).toEqual([]);   // eski, denetimden sonraki fetch kalktı
  });

  it('yayın işi ve adım adları ci.yml ile BİREBİR (ad değişirse adım denetimi boş okur ve FAIL verir; bu çit önce kırılır)', () => {
    const ci = readFileSync(join(KOK, '.github', 'workflows', 'ci.yml'), 'utf8');
    const deger = (ad: string): string => (kod.find(s => s.startsWith(ad + '=')) ?? '').slice(ad.length + 2, -1);
    expect(deger('CI_YAYIN_ISI')).toBe('Deploy to Windows VDS');
    expect(deger('CI_YAYIN_ADIMI')).toBe('Deploy (SSH → PowerShell)');
    expect(ci).toContain('name: Deploy to Windows VDS');
    expect(ci).toContain('name: Deploy (SSH → PowerShell)');
    expect(ci).toMatch(/- name: Deploy \(SSH → PowerShell\)\n\s+if: steps\.check\.outputs\.enabled == 'true'/);   // adım atlanabilir: denetimin gerekçesi
  });

  it('yayın iş akışı hâlâ main\'e push ile tetikleniyor (süzgeçlerin dayandığı varsayım)', () => {
    const ci = readFileSync(join(KOK, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/^on:\n {2}push:\n(?: {4}#.*\n)* {4}branches: \[main, /m);
  });
});
