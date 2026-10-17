// @vitest-environment node
/**
 * scripts/verify-deploy.sh `post` — mağaza dilim 2a sondaları UÇTAN UCA (şartname § 7 «Yayın sonrası sondalar» 1-9) +
 * dilim 2b sondaları (§ 10.8 «Sondalar»: üç yeni ERP ucu iki listede, `bildirim-gonder?tur=revize`, panel silme ucu) +
 * «yeni sürüm» sondası (9; `.wf/SARTNAME-yeni-surum-bildirimi.md` S2) — aynı düzeneği kullandığı için bu dosyada.
 *
 * Betiğin `post` kipi GERÇEKTEN koşturulur (`bash scripts/verify-deploy.sh post`); `BASE_URL` bu dosyanın açtığı YEREL bir
 * sunucuyu gösterir (`listen(0)`), `gh` ve `git` PATH'e konan sahteleriyle değiştirilir. Canlıya / GitHub'a istek YOK.
 * Sahte sunucu senaryoya göre yanıt verir: sağlıklı dilim 2b, dilim 2a (2b yayınlanmamış), dilim 1 (2a hiç yayınlanmamış),
 * site paneli yapılandırılmamış, tekil arızalar. Sınanan şey sondanın AYIRT EDİCİLİĞİDİR: doğru sunucuda PASS, her arıza biçiminde
 * FAIL ve doğru teşhis (yanlış PASS = canlıda görülmeyen arıza; bu betik «yayın sağlıklı» hükmünün tek kanıtıdır).
 *
 * İkinci yarı kaynak çitleridir: sondaların hiçbiri kimlik / çerez taşımaz (oturum açmaz, kayıt yazmaz), ERP uçları iki
 * listede de (bozuk JSON + geçerli JSON) aynıdır, oturum sondasının gövdesi rota şemasına uyar (ret şemadan gelmez).
 * Takip ve talep sondalarının gövdeleri rota testinde kilitlidir (src/server/routes/magazaRoutes.test.ts).
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, dirname, resolve } from 'node:path';
import { kaynakDosyalari, kodSatirlari, gorece, SRC_KOK } from './kaynakTarama';
import { MAGAZA_PANEL_43_DESENI, MAGAZA_TALEP_KIMLIK_DESENI } from '../lib/magazaTalep';
import { PanelOturumGovdesi } from '../server/schemas';

const KOK = join(__dirname, '..', '..');
const BETIK = join(KOK, 'scripts', 'verify-deploy.sh');
const KOKEN = 'https://www.cetpa.com.tr';
const KIMLIK = 'mt-00000000000000000000000000000000';
const ERP_UCLARI = [
  '/api/magaza-panel/yetki-kodu',
  `/api/magaza-talepleri/${KIMLIK}/durum`,
  `/api/magaza-talepleri/${KIMLIK}/kalem-teslim`,
  `/api/magaza-talepleri/${KIMLIK}/bildirim-gonder`,
  // Dilim 2b (§ 10.3): elle talep, içerik düzenleme, yumuşak silme / geri alma.
  '/api/magaza-talepleri',
  `/api/magaza-talepleri/${KIMLIK}/icerik`,
  `/api/magaza-talepleri/${KIMLIK}/sil`,
];
/** Dilim 2b'nin üç yeni ERP ucu (2a sunucusunda YOK). */
const ERP_UCLARI_2B = ERP_UCLARI.slice(4);
/** `bildirim-gonder` ucunun sorgu dizeli varyantı (2b): kimliksiz `{}` → 401 (400 = `tur` kapıdan önce ayrıştırılıyor). */
const REVIZE_UCU = `/api/magaza-talepleri/${KIMLIK}/bildirim-gonder?tur=revize`;
/** Belirteçsiz 401 beklenen panel sondaları (son ad dilim 2b). */
const PANEL_SONDALARI = ['liste', 'oturum', 'kalem teslim', 'etiket basıldı', 'silme'];
const TAKIP_GOVDESI = '{"no":"T000000-AAAA","telefon":"0000000000"}';
const ANA_BETIK = '/assets/index-AbC_12-x9.js';
/** «Yeni sürüm» sondası (9): yayındaki paketin kimliği — index.html meta'sı ve `GET /api/surum` aynı değeri taşır. */
const SURUM = '0123456789abcdef';
const ANA_SAYFA = `<!doctype html><html><head><script type="module" crossorigin src="${ANA_BETIK}"></script><meta name="cetpa-surum" content="${SURUM}"></head><body></body></html>`;

// ── Sahte gh / git: `post` kipinin CI ve aralık adımları yeşil geçsin (o adımların kendi testi verifyDeployCi.test.ts) ──
const HEDEF = 'aaaaaaa1111111111111111111111111111111aa';
const SAHTE_GIT = `#!/bin/sh
case "$1" in
  ls-remote) printf '%s\\trefs/heads/main\\n' "${HEDEF}" ;;
  rev-parse) echo "${HEDEF}" ;;
esac
exit 0
`;
const SAHTE_GH = `#!/bin/sh
if [ "$1" = run ] && [ "$2" = list ]; then echo 700; exit 0; fi
if [ "$1" = run ] && [ "$2" = watch ]; then exit 0; fi
if [ "$1" = run ] && [ "$2" = view ]; then
  case "$*" in *startedAt*) date -u +%Y-%m-%dT%H:%M:%SZ ;; *) echo success ;; esac
  exit 0
fi
exit 2
`;

// ── Sahte sunucu ──────────────────────────────────────────────────────────────────────────────────────────────────────
interface Istek { yontem: string; yol: string; basliklar: IncomingMessage['headers']; govde: string }
interface Yanit { kod: number; govde?: string; basliklar?: Record<string, string> }
/** Senaryo: `null` dönerse sağlıklı dilim 2a yanıtı verilir. */
type Senaryo = (i: Istek) => Yanit | null;

const json = (kod: number, nesne: unknown, basliklar: Record<string, string> = {}): Yanit =>
  ({ kod, govde: JSON.stringify(nesne), basliklar: { 'content-type': 'application/json; charset=utf-8', ...basliklar } });
const jsonMu = (metin: string): boolean => { try { JSON.parse(metin); return true; } catch { return false; } };

let kalanHak = 290;
/** Sağlıklı dilim 2b sunucusunun dışarıdan görünen davranışı (şartname § 4 kayıt sırası ve yanıt tablosu; § 10.3 yeni uçlar). */
function saglikli(i: Istek): Yanit {
  const koken = i.basliklar.origin;
  const izinli = koken === KOKEN;
  if (i.yol === '/api/health') return json(200, { status: 'ok', postgres: true, uptime: 5 }, { 'ratelimit-remaining': String(kalanHak--) });
  if (i.yol === '/api/ops/runtime') return json(401, { error: 'Invalid or expired token.' });
  if (i.yol === '/') return { kod: 200, govde: ANA_SAYFA, basliklar: { 'content-type': 'text/html; charset=utf-8' } };
  if (i.yol === ANA_BETIK) return { kod: 200, govde: 'const yollar=["/siparisler","/magaza-panel-baglan"],s="/api/surum";export{yollar,s};', basliklar: { 'content-type': 'text/javascript' } };
  if (i.yol === '/api/surum' && i.yontem === 'GET') return json(200, { surum: SURUM }, { 'cache-control': 'no-store' });
  // Site paneli alt zinciri: köken kapısı (kendi başlıkları) → [oturum] → belirteç kapısı (her şeye 401).
  if (i.yol.startsWith('/api/magaza/panel/')) {
    if (!izinli) return json(403, { ok: false });
    const cors = { 'access-control-allow-origin': KOKEN, 'cache-control': 'no-store' };
    if (i.yontem === 'OPTIONS') return { kod: 204, basliklar: { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-max-age': '600' } };
    return json(401, { ok: false }, cors);
  }
  // Dış zincir (kimliksiz): köken kapısı → gövde → rota.
  if (i.yol.startsWith('/api/magaza/')) {
    if (!izinli) return json(403, { ok: false });
    const cors = { 'access-control-allow-origin': KOKEN };
    if (i.yontem === 'OPTIONS') return { kod: 204, basliklar: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'Content-Type' } };
    if (!jsonMu(i.govde)) return json(400, { ok: false }, cors);
    if (i.yol === '/api/magaza/siparis-durumu') return json(404, { ok: false, kod: 'bulunamadi' }, { ...cors, 'cache-control': 'no-store' });
    if (i.yol === '/api/magaza/siparis-talebi') return json(400, { ok: false }, cors);   // sonda gövdesi: telefonda 10 rakam yok
    return json(404, { ok: false }, cors);
  }
  // ERP kökeni: genel gövde ayrıştırıcı rotadan ÖNCE; kayıtlı rota kimliksiz isteğe 401 verir.
  if (i.yontem === 'POST' && i.yol.startsWith('/api/')) {
    if (!jsonMu(i.govde)) return json(400, { error: 'bozuk JSON' });
    // Kimlik kapısı sorgu dizesinden ÖNCE: `?tur=revize` varyantı da 401.
    if (ERP_UCLARI.includes(i.yol) || i.yol === REVIZE_UCU) return json(401, { error: 'Missing Authorization header.' });
    return json(404, { error: 'yok' });
  }
  return { kod: 404, govde: 'yok' };
}

let sunucu: Server;
let taban = '';
let senaryo: Senaryo = () => null;
const istekler: Istek[] = [];

beforeAll(async () => {
  sunucu = createServer((req: IncomingMessage, res: ServerResponse) => {
    const parcalar: Buffer[] = [];
    req.on('data', (p: Buffer) => parcalar.push(p));
    req.on('end', () => {
      const i: Istek = { yontem: req.method ?? '', yol: req.url ?? '', basliklar: req.headers, govde: Buffer.concat(parcalar).toString('utf8') };
      istekler.push(i);
      const y = senaryo(i) ?? saglikli(i);
      res.writeHead(y.kod, y.basliklar ?? {});
      res.end(y.govde ?? '');
    });
  });
  await new Promise<void>(coz => sunucu.listen(0, '127.0.0.1', coz));
  taban = `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(coz => sunucu.close(() => coz())); });

const gecici: string[] = [];
afterEach(() => { for (const d of gecici.splice(0)) rmSync(d, { recursive: true, force: true }); });

interface Kosu { kod: number | null; cikti: string; pass: string[]; fail: string[] }

/** `post` kipini yerel sunucuya karşı koşturur (eşzamansız: sunucu AYNI süreçte yanıt verir). */
async function post(s: Senaryo = () => null): Promise<Kosu> {
  senaryo = s;
  istekler.length = 0;
  kalanHak = 290;
  const dizin = mkdtempSync(join(tmpdir(), 'vd-mg-'));
  gecici.push(dizin);
  for (const [ad, govde] of [['gh', SAHTE_GH], ['git', SAHTE_GIT]] as const) {
    writeFileSync(join(dizin, ad), govde);
    chmodSync(join(dizin, ad), 0o755);
  }
  const cikti = await new Promise<{ kod: number | null; metin: string }>((coz, ret) => {
    const surec = spawn('bash', [BETIK, 'post'], {
      env: {
        ...process.env, PATH: `${dizin}${delimiter}${process.env.PATH ?? ''}`, BASE_URL: taban, TMPDIR: dizin,
        MAGAZA_KOKEN: KOKEN, CI_ARAMA_DENEME: '2', CI_ARAMA_ARALIK: '0', VERIFY_BODY_PROBE: '',
      },
    });
    let metin = '';
    surec.stdout.on('data', (p: Buffer) => { metin += p.toString('utf8'); });
    surec.stderr.on('data', (p: Buffer) => { metin += p.toString('utf8'); });
    surec.on('error', ret);
    surec.on('close', kod => coz({ kod, metin }));
  });
  const satirlar = cikti.metin.split('\n');
  return { kod: cikti.kod, cikti: cikti.metin, pass: satirlar.filter(l => l.startsWith('PASS  ')), fail: satirlar.filter(l => l.startsWith('FAIL  ')) };
}

const iceren = (satirlar: string[], ...parcalar: string[]): string[] => satirlar.filter(l => parcalar.every(p => l.includes(p)));
const magazaIstekleri = (): Istek[] => istekler.filter(i => /^\/api\/magaza(-panel|-talepleri)?(\/|$)/.test(i.yol));
const sirali = (liste: string[]): string[] => [...liste].sort();

// Betik bash ister; Windows'ta (yayın sunucusu) koşulmaz — CI derleme işi ubuntu'da koşturur.
describe.skipIf(process.platform === 'win32')('verify-deploy.sh post — mağaza dilim 2a + 2b sondaları (yerel sunucuya karşı, uçtan uca)', { timeout: 60_000 }, () => {
  it('sağlıklı dilim 2b sunucusu: bütün sondalar PASS, çıkış kodu 0; her sonda kendi satırını yazar (2a\'nın dokuzu + 2b: üç ERP ucu, `?tur=revize`, panel silme)', async () => {
    const k = await post();
    expect(k.fail, k.cikti).toEqual([]);
    expect(k.kod).toBe(0);
    expect(k.cikti).toContain('== verify-deploy post: TUM KONTROLLER GECTI ==');
    // 1 takip · 2 / 5 / 8 / 9 panel (belirteçsiz 401) · 3 panel ön uçuşu · 4 dış zincir ön uçuşu · 6 ERP uçları (iki yol) · 7 istemci derlemesi
    expect(iceren(k.pass, 'takip ucu', '404 bulunamadi')).toHaveLength(1);
    expect(iceren(k.pass, 'site paneli liste', '401')).toHaveLength(1);
    expect(iceren(k.pass, 'site paneli oturum', '401')).toHaveLength(1);
    expect(iceren(k.pass, 'site paneli kalem teslim', '401')).toHaveLength(1);
    expect(iceren(k.pass, 'site paneli etiket basıldı', '401')).toHaveLength(1);
    expect(iceren(k.pass, 'site paneli silme', '401')).toHaveLength(1);                       // dilim 2b
    expect(iceren(k.pass, 'site paneli ön uçuşu', 'Allow-Methods GET', 'Allow-Headers Authorization')).toHaveLength(1);
    expect(iceren(k.pass, 'dış zinciri ön uçuşu', 'Authorization TAŞIMIYOR')).toHaveLength(1);
    for (const uc of ERP_UCLARI) {
      expect(iceren(k.pass, 'gövde ayrıştırma zincirde', `${uc} (bozuk JSON -> 400)`), uc).toHaveLength(1);
      expect(iceren(k.pass, 'mağaza ERP ucu kayıtlı', `${uc} (kimliksiz {} -> 401)`), uc).toHaveLength(1);
    }
    expect(ERP_UCLARI).toHaveLength(7);
    // Dilim 2b: sorgu dizeli varyant AYRI sondadır (kendi satırı, kendi teşhisi).
    expect(iceren(k.pass, 'revize bildirimi kimlik kapısı arkasında', `${REVIZE_UCU} (kimliksiz {} -> 401)`)).toHaveLength(1);
    expect(iceren(k.pass, 'istemci derlemesi', ANA_BETIK, '/magaza-panel-baglan')).toHaveLength(1);
  });

  it('sondalar canlıya YAZMAZ: hiçbir mağaza / panel / ERP isteği kimlik, belirteç ya da çerez taşımaz; gövdeler sabittir; istek kümesi kapalıdır', async () => {
    await post();
    const m = magazaIstekleri();
    for (const i of m) {
      expect(i.basliklar.authorization, `${i.yontem} ${i.yol}`).toBeUndefined();
      expect(i.basliklar.cookie, `${i.yontem} ${i.yol}`).toBeUndefined();
      expect(i.basliklar['x-ops-token'], `${i.yontem} ${i.yol}`).toBeUndefined();
    }
    // Kimlik taşıyan TEK istek auth zinciri sondasıdır ve taşıdığı belirteç bilerek GEÇERSİZDİR.
    expect([...new Set(istekler.filter(i => i.basliklar.authorization !== undefined).map(i => `${i.yol} ${String(i.basliklar.authorization)}`))])
      .toEqual(['/api/ops/runtime Bearer gecersiz.token.degeri']);
    // İstek kümesi (yöntem + yol + gövde), sıradan bağımsız: yeni bir sonda eklenirse burada görünür.
    expect(sirali(m.map(i => `${i.yontem} ${i.yol} ${i.govde}`))).toEqual(sirali([
      // dilim 1 (dört sonda)
      'OPTIONS /api/magaza/siparis-talebi ',
      'POST /api/magaza/siparis-talebi {}',
      'POST /api/magaza/siparis-talebi {',
      'POST /api/magaza/siparis-talebi {"no":"T000000-AAAA","musteri":{"ad":"sonda","telefon":"0"},"kalemler":[{"ad":"sonda","adet":1}]}',
      // dilim 2a
      `POST /api/magaza/siparis-durumu ${TAKIP_GOVDESI}`,
      'GET /api/magaza/panel/siparisler ',
      `POST /api/magaza/panel/oturum {"kod":"${'A'.repeat(43)}","dogrulayici":"${'A'.repeat(43)}"}`,
      `POST /api/magaza/panel/siparisler/${KIMLIK}/kalem-teslim {}`,
      `POST /api/magaza/panel/siparisler/${KIMLIK}/etiket-basildi {}`,
      // dilim 2b: panel silme ucu (belirteçsiz) + `bildirim-gonder?tur=revize` (kimliksiz); üç yeni ERP ucu aşağıdaki iki listede
      `POST /api/magaza/panel/siparisler/${KIMLIK}/sil {}`,
      `POST ${REVIZE_UCU} {}`,
      'OPTIONS /api/magaza/panel/siparisler ',
      'OPTIONS /api/magaza/siparis-talebi ',
      ...ERP_UCLARI.map(uc => `POST ${uc} {bozuk`),
      ...ERP_UCLARI.map(uc => `POST ${uc} {}`),
    ]));
    // Ön uçuşlar şartnamedeki istek başlıklarıyla: panel ve dış zincir AYNI başlıkla sorulur (fark yanıttadır).
    const onUcus = m.filter(i => i.yontem === 'OPTIONS' && i.basliklar['access-control-request-method'] === 'GET');
    expect(sirali(onUcus.map(i => i.yol))).toEqual(['/api/magaza/panel/siparisler', '/api/magaza/siparis-talebi']);
    for (const i of onUcus) expect(i.basliklar['access-control-request-headers']).toBe('authorization,content-type');
    // Kökensiz tek istek dilim 1'in köken kapısı sondasıdır; panel sondalarının hepsi izinli kökenle gider.
    expect(m.filter(i => i.yol.startsWith('/api/magaza/') && i.basliklar.origin !== KOKEN).map(i => `${i.yontem} ${i.yol} ${i.govde}`)).toEqual(['POST /api/magaza/siparis-talebi {}']);
    // Sabit sonda kimliği gerçek bir talep kimliği BİÇİMİNDE (rota kimlik denetimine takılmaz), ama hiçbir talebe karşılık gelmez.
    expect(MAGAZA_TALEP_KIMLIK_DESENI.test(KIMLIK)).toBe(true);
  });

  it('canlıda hâlâ DİLİM 1 (2a yayınlanmamış): takip «hazir-degil», panel 404, panel ön uçuşu GET / Authorization taşımıyor, ERP uçları 404, istemcide yol yok → her biri FAIL ve doğru teşhis', async () => {
    const k = await post((i): Yanit | null => {
      const cors = { 'access-control-allow-origin': KOKEN };
      if (i.yol === '/api/magaza/siparis-durumu' && i.basliklar.origin === KOKEN && jsonMu(i.govde)) return json(503, { ok: false, kod: 'hazir-degil' }, cors);
      // Dilim 1'de `/panel` alt zinciri yok: istek dış zincirin köken kapısına düşer (ön uçuş POST + Content-Type), rota-yok 404.
      if (i.yol.startsWith('/api/magaza/panel/') && i.basliklar.origin === KOKEN) {
        if (i.yontem === 'OPTIONS') return { kod: 204, basliklar: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'Content-Type' } };
        return json(404, { ok: false }, cors);
      }
      if ((ERP_UCLARI.includes(i.yol) || i.yol === REVIZE_UCU) && jsonMu(i.govde)) return json(404, { error: 'yok' });
      if (i.yol === ANA_BETIK) return { kod: 200, govde: 'const yollar=["/siparisler"];export{yollar};', basliklar: { 'content-type': 'text/javascript' } };
      return null;
    });
    expect(k.kod).toBe(1);
    expect(k.cikti).toContain('== verify-deploy post: BASARISIZ KONTROL VAR ==');
    expect(iceren(k.fail, 'takip ucu', 'hazir-degil', 'dilim 1 hâlâ canlıda')).toHaveLength(1);
    for (const ad of PANEL_SONDALARI) expect(iceren(k.fail, `site paneli ${ad}`, '404', 'alt zincir bağlı değil'), ad).toHaveLength(1);
    expect(iceren(k.fail, 'MAĞAZA ERP UCU KAYITLI DEĞİL', `${REVIZE_UCU} -> 404`)).toHaveLength(1);
    expect(iceren(k.fail, 'site paneli ön uçuşu', 'beklenen 204 + Allow-Methods GET + Allow-Headers Authorization')).toHaveLength(1);
    for (const uc of ERP_UCLARI) {
      expect(iceren(k.fail, 'MAĞAZA ERP UCU KAYITLI DEĞİL', `${uc} -> 404`), uc).toHaveLength(1);
      // Bozuk JSON sondası bunu GÖREMEZ: aynı yol için PASS yazar (gövde hatası rota eşleşmesinden önce fırlar).
      expect(iceren(k.pass, 'gövde ayrıştırma zincirde', `${uc} (bozuk JSON -> 400)`), uc).toHaveLength(1);
    }
    expect(iceren(k.fail, 'İSTEMCİ DERLEMESİNDE /magaza-panel-baglan YOK', ANA_BETIK)).toHaveLength(1);
    // Dış zincir ön uçuşu dilim 1'de de doğrudur (Authorization yok): yanlış FAIL yazılmaz.
    expect(iceren(k.pass, 'dış zinciri ön uçuşu')).toHaveLength(1);
    expect(k.pass.filter(l => /takip ucu|site paneli|istemci derlemesi|ERP ucu kayıtlı|revize bildirimi/.test(l))).toEqual([]);
  });

  it('canlıda hâlâ DİLİM 2a (2b yayınlanmamış): üç yeni ERP ucu 404 → her biri FAIL «KAYITLI DEĞİL»; 2a sondaları yeşil kalır — belirteçsiz panel silme ve kimliksiz `?tur=revize` 2a\'da da 401\'dir (kapı rota eşleşmesinden önce)', async () => {
    const k = await post((i): Yanit | null => (ERP_UCLARI_2B.includes(i.yol) && jsonMu(i.govde) ? json(404, { error: 'Not found' }) : null));
    expect(k.kod).toBe(1);
    expect(ERP_UCLARI_2B).toEqual(['/api/magaza-talepleri', `/api/magaza-talepleri/${KIMLIK}/icerik`, `/api/magaza-talepleri/${KIMLIK}/sil`]);
    for (const uc of ERP_UCLARI_2B) {
      expect(iceren(k.fail, 'MAĞAZA ERP UCU KAYITLI DEĞİL', `${uc} -> 404`), uc).toHaveLength(1);
      // Bozuk JSON sondası rotanın yokluğunu GÖREMEZ (gövde hatası rota eşleşmesinden önce fırlar): bu yüzden iki liste de gerekir.
      expect(iceren(k.pass, 'gövde ayrıştırma zincirde', `${uc} (bozuk JSON -> 400)`), uc).toHaveLength(1);
    }
    expect(k.fail).toHaveLength(3);                                   // 2a'nın hiçbir sondası düşmedi
    for (const uc of ERP_UCLARI.slice(0, 4)) expect(iceren(k.pass, 'mağaza ERP ucu kayıtlı', `${uc} (kimliksiz {} -> 401)`), uc).toHaveLength(1);
    for (const ad of PANEL_SONDALARI) expect(iceren(k.pass, `site paneli ${ad}`), ad).toHaveLength(1);
    expect(iceren(k.pass, 'revize bildirimi kimlik kapısı arkasında')).toHaveLength(1);
    expect(iceren(k.pass, 'takip ucu', '404 bulunamadi')).toHaveLength(1);
  });

  it('(2b) `bildirim-gonder?tur=revize` kimliksiz isteğe 400 dönerse (sorgu dizesi kimlik kapısından ÖNCE ayrıştırılıyor) FAIL «SIRA BOZUK»; `tur`suz uç 401 ile yeşil kalır', async () => {
    const k = await post((i): Yanit | null => (i.yol === REVIZE_UCU && jsonMu(i.govde) ? json(400, { ok: false }) : null));
    expect(k.kod).toBe(1);
    expect(iceren(k.fail, 'REVİZE BİLDİRİMİ UCUNDA SIRA BOZUK', `${REVIZE_UCU} -> 400`, 'kimlik kapısından ÖNCE')).toHaveLength(1);
    expect(k.fail).toHaveLength(1);
    expect(iceren(k.pass, 'mağaza ERP ucu kayıtlı', `${ERP_UCLARI[3]} (kimliksiz {} -> 401)`)).toHaveLength(1);
  });

  it('site paneli YAPILANDIRILMAMIŞ (dönüş adresi / sır yok): beş panel sondası (2b: + silme) 503 panel-yapilandirilmamis → FAIL ve ortam ayarını söyler; ön uçuş ve öbür sondalar etkilenmez', async () => {
    const k = await post((i): Yanit | null => {
      if (i.yol.startsWith('/api/magaza/panel/') && i.basliklar.origin === KOKEN && i.yontem !== 'OPTIONS') {
        return json(503, { ok: false, kod: 'panel-yapilandirilmamis' }, { 'access-control-allow-origin': KOKEN, 'cache-control': 'no-store' });
      }
      return null;
    });
    expect(k.kod).toBe(1);
    const panel = iceren(k.fail, 'SİTE PANELİ YAPILANDIRILMAMIŞ', '503 panel-yapilandirilmamis', 'MAGAZA_PANEL_DONUS');
    expect(panel).toHaveLength(PANEL_SONDALARI.length);
    for (const ad of PANEL_SONDALARI) expect(panel.filter(l => l.includes(ad)), ad).toHaveLength(1);
    expect(k.fail).toHaveLength(5);                                   // başka hiçbir sonda düşmedi
    expect(iceren(k.pass, 'site paneli ön uçuşu')).toHaveLength(1);    // ön uçuş yapılandırma kapısından ÖNCE biter (204)
    expect(iceren(k.pass, 'takip ucu')).toHaveLength(1);
    expect(k.cikti).not.toMatch(/SESSION_TOKEN_SECRET=|https:\/\/www\.cetpa\.com\.tr\/panel/);   // değer yazılmaz, yalnız ad
  });

  it('tekil arızalar (1): takip 503 (havuz / kiracı yok) · kalem teslim 400 (kapı gövdeden sonra) · panel ön uçuşunda Authorization yok · dış zincir Authorization\'a izin veriyor · bir ERP ucu kayıtlı değil · ana betik indirilemiyor', async () => {
    const eksikUc = ERP_UCLARI[3];
    const k = await post((i): Yanit | null => {
      const cors = { 'access-control-allow-origin': KOKEN };
      if (i.yol === '/api/magaza/siparis-durumu' && i.basliklar.origin === KOKEN && jsonMu(i.govde)) return json(503, { ok: false }, cors);
      if (i.yol.endsWith('/kalem-teslim') && i.yol.startsWith('/api/magaza/panel/')) return json(400, { ok: false }, cors);
      if (i.yontem === 'OPTIONS' && i.yol === '/api/magaza/panel/siparisler') return { kod: 204, basliklar: { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'Content-Type' } };
      if (i.yontem === 'OPTIONS' && i.yol === '/api/magaza/siparis-talebi' && i.basliklar['access-control-request-method'] === 'GET') {
        return { kod: 204, basliklar: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'Authorization, Content-Type' } };
      }
      if (i.yol === eksikUc && jsonMu(i.govde)) return json(404, { error: 'yok' });
      if (i.yol === ANA_BETIK) return { kod: 502, govde: 'Bad Gateway' };
      return null;
    });
    expect(k.kod).toBe(1);
    expect(iceren(k.fail, 'TAKİP UCU ÇALIŞMIYOR: 503', 'pg havuzu yok', 'SERVER_TENANT_COMPANY_ID')).toHaveLength(1);
    expect(iceren(k.fail, 'site paneli kalem teslim', '400', 'belirteç kapısı gövdeden SONRA')).toHaveLength(1);
    expect(iceren(k.fail, 'site paneli ön uçuşu', 'beklenen 204')).toHaveLength(1);
    expect(iceren(k.fail, 'dış zinciri ön uçuşu', 'Authorization YOK')).toHaveLength(1);
    expect(iceren(k.fail, 'MAĞAZA ERP UCU KAYITLI DEĞİL', `${eksikUc} -> 404`)).toHaveLength(1);
    expect(iceren(k.fail, 'istemci derlemesi sondası ÖLÇÜLEMEDİ', 'ana betik indirilemedi', '502')).toHaveLength(1);
    expect(iceren(k.fail, 'sürüm ucu: kimlik aynı', 'ana betik indirilemedi', '502', 'ÖLÇÜLEMEDİ')).toHaveLength(1);   // 9: aynı arızanın kendi satırı
    expect(k.fail).toHaveLength(7);
    // Arızasız kalan komşu sondalar yeşil kaldı (bir arıza öbürünü boyamaz).
    for (const ad of ['liste', 'oturum', 'etiket basıldı', 'silme']) expect(iceren(k.pass, `site paneli ${ad}`), ad).toHaveLength(1);
    for (const uc of ERP_UCLARI.slice(0, 3)) expect(iceren(k.pass, 'mağaza ERP ucu kayıtlı', uc), uc).toHaveLength(1);
  });

  it('tekil arızalar (2): takip ucu kodsuz 404 (rota yok) · oturum ucu 500 · ERP ucu kimliksiz {}\'ye 400 (kimlik kapısı zincirde değil) · ana sayfada betik adresi yok', async () => {
    const acikUc = ERP_UCLARI[1];
    const k = await post((i): Yanit | null => {
      const cors = { 'access-control-allow-origin': KOKEN };
      if (i.yol === '/api/magaza/siparis-durumu' && i.basliklar.origin === KOKEN && jsonMu(i.govde)) return json(404, { ok: false }, cors);
      if (i.yol === '/api/magaza/panel/oturum' && i.yontem === 'POST') return json(500, { ok: false }, cors);
      if (i.yol === acikUc && jsonMu(i.govde)) return json(400, { ok: false });
      if (i.yol === '/') return { kod: 200, govde: '<!doctype html><html><body>bakım</body></html>', basliklar: { 'content-type': 'text/html' } };
      return null;
    });
    expect(k.kod).toBe(1);
    expect(iceren(k.fail, 'takip ucu', "kod'suz 404", 'rota kayıtlı değil')).toHaveLength(1);
    expect(iceren(k.fail, 'site paneli oturum', 'beklenen 401, gelen 500')).toHaveLength(1);
    expect(iceren(k.fail, 'mağaza ERP ucu sondası beklenmedik yanıt: 400', acikUc)).toHaveLength(1);
    expect(iceren(k.fail, 'istemci derlemesi sondası ÖLÇÜLEMEDİ', 'ana betik adresi')).toHaveLength(1);
    expect(iceren(k.fail, 'sürüm ucu', 'cetpa-surum', 'yok')).toHaveLength(1);                                         // 9: bakım sayfası paket kimliği taşımaz
    expect(k.fail).toHaveLength(5);
  });

  it('yanlış ALARM üretmeyen biçimler: başlık değeri sırası «POST, GET» (yalnız ilk sözcüğe bakılsaydı düşerdi), küçük harf başlık adı, betik yolun yanında başka metin taşıyor → PASS', async () => {
    const k = await post((i): Yanit | null => {
      if (i.yontem === 'OPTIONS' && i.yol === '/api/magaza/panel/siparisler' && i.basliklar.origin === KOKEN) {
        return { kod: 204, basliklar: { 'access-control-allow-origin': KOKEN, 'access-control-allow-methods': 'POST, GET', 'access-control-allow-headers': 'content-type, authorization' } };
      }
      if (i.yol === ANA_BETIK) return { kod: 200, govde: `${'x'.repeat(300_000)};const p="/magaza-panel-baglan#meydan",s="/api/surum";${'y'.repeat(1000)}`, basliklar: { 'content-type': 'text/javascript' } };
      return null;
    });
    expect(k.fail, k.cikti).toEqual([]);
    expect(k.kod).toBe(0);
    expect(iceren(k.pass, 'site paneli ön uçuşu')).toHaveLength(1);
    expect(iceren(k.pass, 'istemci derlemesi')).toHaveLength(1);
  });

  it('SPA yedeği tuzağı: ana betik adresi 200 + index.html dönse de (dosya yok, yedek devrede) yol metni olmadığı için FAIL; `GET /magaza-panel-baglan` HİÇ istenmez (200 kanıt değildir)', async () => {
    const sayfa = `<!doctype html><html><head><script type="module" crossorigin src="${ANA_BETIK}"></script></head><body></body></html>`;
    const k = await post((i): Yanit | null => (i.yol === ANA_BETIK ? { kod: 200, govde: sayfa, basliklar: { 'content-type': 'text/html' } } : null));
    expect(k.kod).toBe(1);
    expect(iceren(k.fail, 'İSTEMCİ DERLEMESİNDE /magaza-panel-baglan YOK')).toHaveLength(1);
    expect(iceren(k.fail, 'sürüm ucu', 'ana betikte /api/surum YOK')).toHaveLength(1);                                   // 9: yedek HTML şeridin bağını da taşımaz
    expect(k.fail).toHaveLength(2);
    expect(istekler.filter(i => i.yol.startsWith('/magaza-panel-baglan'))).toEqual([]);
  });

  it('429 (bu IP kovayı doldurdu) PASS sayılmaz ama «bozuk» da denmez: ÖLÇÜLEMEDİ', async () => {
    const k = await post((i): Yanit | null => {
      if (i.yol === '/api/magaza/siparis-durumu' || (i.yol.startsWith('/api/magaza/panel/') && i.yontem !== 'OPTIONS')) return json(429, { ok: false }, { 'access-control-allow-origin': KOKEN });
      return null;
    });
    expect(k.kod).toBe(1);
    expect(iceren(k.fail, 'takip ucu ÖLÇÜLEMEDİ: 429')).toHaveLength(1);
    expect(iceren(k.fail, 'site paneli', 'ÖLÇÜLEMEDİ: 429')).toHaveLength(PANEL_SONDALARI.length);
    expect(k.fail).toHaveLength(6);
  });
});

// ── 9) «Yeni sürüm var» sondası (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S2): aynı düzenek, aynı sahte sunucu ──────────
describe.skipIf(process.platform === 'win32')('verify-deploy.sh post — «yeni sürüm» sondası (9): sunucu kimliği = istemci paketi', { timeout: 60_000 }, () => {
  const surumYaniti = (y: Yanit) => (i: Istek): Yanit | null => (i.yol === '/api/surum' ? y : null);
  const tekFail = (k: Kosu, ...parcalar: string[]) => {
    expect(k.kod).toBe(1);
    expect(k.fail, k.cikti).toHaveLength(1);
    expect(iceren(k.fail, 'sürüm ucu', ...parcalar), k.cikti).toHaveLength(1);
  };

  it('sağlıklı: PASS (200 + no-store + kimlik meta ile aynı + ana betik /api/surum\'u soruyor); sonda kimlik / çerez taşımaz, yalnız GET', async () => {
    const k = await post();
    expect(k.fail, k.cikti).toEqual([]);
    expect(iceren(k.pass, 'sürüm ucu', '200 + no-store', SURUM, 'şerit bağlı')).toHaveLength(1);
    const sonda = istekler.filter(i => i.yol === '/api/surum');
    expect(sonda.map(i => i.yontem)).toEqual(['GET']);
    for (const i of sonda) { expect(i.basliklar.authorization).toBeUndefined(); expect(i.basliklar.cookie).toBeUndefined(); }
  });

  it('sunucu BAŞKA derlemenin kimliğini veriyor (dist / dist.new karışıklığı) → FAIL «AYRIŞIYOR»', async () => {
    tekFail(await post(surumYaniti(json(200, { surum: 'fedcba9876543210' }, { 'cache-control': 'no-store' }))), 'AYRIŞIYOR', 'fedcba9876543210', SURUM);
  });

  it('`{ surum: null }` (derlemede surum.json yok) → FAIL ve nedenini söyler', async () => {
    tekFail(await post(surumYaniti(json(200, { surum: null }, { 'cache-control': 'no-store' }))), 'biçiminde değil', 'null = derlemede surum.json yok');
  });

  it('`Cache-Control: no-store` yok → FAIL', async () => {
    tekFail(await post(surumYaniti(json(200, { surum: SURUM }, { 'cache-control': 'public, max-age=0' }))), "Cache-Control 'no-store' değil", 'public, max-age=0');
  });

  it('gövdede fazladan alan (ortam / commit bilgisi sızıyor) → FAIL', async () => {
    tekFail(await post(surumYaniti(json(200, { surum: SURUM, ortam: 'production' }, { 'cache-control': 'no-store' }))), 'biçiminde değil', 'ortam');
  });

  it('uç kimlik kapısının arkasında (401) ya da kayıtlı değil (404) → FAIL «beklenen 200»', async () => {
    tekFail(await post(surumYaniti(json(401, { error: 'Missing Authorization header.' }))), 'beklenen 200', "'401'");
    tekFail(await post(surumYaniti(json(404, { error: 'Not found' }))), 'beklenen 200', "'404'");
  });

  it('429 → ÖLÇÜLEMEDİ (bozuk denmez)', async () => {
    tekFail(await post(surumYaniti(json(429, { error: 'Too many requests' }))), 'ÖLÇÜLEMEDİ: 429');
  });

  it('index.html paket kimliği taşımıyor (derleme eklentisi yok) → FAIL', async () => {
    const sayfa = ANA_SAYFA.replace(/<meta name="cetpa-surum"[^>]*>/, '');
    tekFail(await post((i): Yanit | null => (i.yol === '/' ? { kod: 200, govde: sayfa, basliklar: { 'content-type': 'text/html' } } : null)), 'cetpa-surum', 'yok');
  });

  it('ana betik /api/surum\'u sormuyor (şerit istemciye bağlanmamış) → FAIL', async () => {
    tekFail(await post((i): Yanit | null => (i.yol === ANA_BETIK ? { kod: 200, govde: 'const yollar=["/siparisler","/magaza-panel-baglan"];export{yollar};', basliklar: { 'content-type': 'text/javascript' } } : null)),
      'ana betikte /api/surum YOK', 'bağlanmamış');
  });
});

describe('verify-deploy.sh — mağaza dilim 2a + 2b sondaları (kaynak çitleri)', () => {
  const satirlar = readFileSync(BETIK, 'utf8').split('\n');
  const kod = satirlar.map(s => s.replace(/^\s*#.*$/, ''));
  const metin = kod.join('\n');

  it('ERP kökenindeki yedi mağaza ucu (2a dört + 2b üç) İKİ listede de aynı: bozuk JSON (BODY_PROBES) ve geçerli JSON (kimliksiz 401) — biri eksikse «rota var mı» ya da «zincir doğru mu» ölçülmez', () => {
    const govde = (kod.find(s => /^\s*BODY_PROBES="\$\{VERIFY_BODY_PROBE:-/.test(s)) ?? '').replace(/^\s*BODY_PROBES="\$\{VERIFY_BODY_PROBE:-/, '').replace(/\}"\s*$/, '').split(/\s+/);
    const gecerli = (kod.find(s => /^\s*MAGAZA_ERP_PROBES="/.test(s)) ?? '').replace(/^\s*MAGAZA_ERP_PROBES="/, '').replace(/"\s*$/, '').split(/\s+/);
    expect(gecerli).toEqual(ERP_UCLARI);
    for (const uc of ERP_UCLARI) expect(govde, uc).toContain(uc);
    expect(govde.length).toBeGreaterThan(ERP_UCLARI.length);   // öbür rota gruplarının sondaları yerinde
    // Geçerli JSON sondası gövdeyi `{}` ile ve Content-Type ile yollar (içerik türü yoksa ayrıştırıcı atlar, ölçüm bozulur).
    const dongu = metin.slice(metin.indexOf('for ERP_PROBE in $MAGAZA_ERP_PROBES; do'));
    expect(dongu.slice(0, dongu.indexOf('done'))).toMatch(/-X POST -H 'Content-Type: application\/json' --data-binary '\{\}'/);
    // (2b) Sorgu dizeli varyant listelerde DEĞİL (kabukta `?` dosya adı kalıbıdır): tırnak içinde, ayrı sondada, TEK kez istenir.
    expect([...govde, ...gecerli].filter(uc => uc.includes('?'))).toEqual([]);
    expect(metin).toContain(`REVIZE_PROBE="${REVIZE_UCU}"`);
    expect(metin.split('"$BASE_URL$REVIZE_PROBE"').length - 1).toBe(1);
    const revize = metin.slice(metin.indexOf('REVIZE_PROBE="'), metin.indexOf('case "$RCODE" in'));
    expect(revize).toMatch(/-X POST -H 'Content-Type: application\/json' --data-binary '\{\}'/);
    // 401 PASS; 400 ayrı teşhis (sıra bozuk) — genel «beklenmedik yanıt» dalına düşmez.
    expect(metin).toMatch(/case "\$RCODE" in\n\s+401\) pass [^\n]+\n\s+400\) fail "REVİZE BİLDİRİMİ UCUNDA SIRA BOZUK/);
  });

  it('mağaza / panel / ERP / istemci sondalarının hiçbiri kimlik, çerez ya da ops jetonu taşımaz (oturum açmaz); kimlik taşıyan tek curl auth zinciri sondası', () => {
    // Devam satırlı (`\`) curl çağrıları da kapsansın diye satır değil bütün kod metni taranır.
    const kimlikBasligi = metin.match(/-H ["']Authorization: [^"']*["'] "?\$?[A-Za-z_{}]*"?/g) ?? [];
    expect(kimlikBasligi).toEqual(Array(2).fill('-H "Authorization: Bearer gecersiz.token.degeri" "$AUTH_URL"'));
    expect(metin).not.toMatch(/--cookie|--cookie-jar|X-Ops-Token|--user\b|\scurl[^\n]*\s-[bu]\s/);
  });

  it('oturum sondasının gövdesi rota şemasına UYAR (401 kod aramasından gelir, şema 400\'ünden değil) ve gerçek bir kod OLAMAZ', () => {
    const eslesme = /-d '(\{"kod":"[^']+\})' "\$PU\/oturum"/.exec(metin);
    expect(eslesme).not.toBeNull();
    const govde: unknown = JSON.parse(eslesme?.[1] ?? '{}');
    expect(PanelOturumGovdesi.safeParse(govde).success).toBe(true);
    expect(govde).toEqual({ kod: 'A'.repeat(43), dogrulayici: 'A'.repeat(43) });
    expect(MAGAZA_PANEL_43_DESENI.test('A'.repeat(43))).toBe(true);
  });

  it('panel sondaları sabit sahte talep kimliğiyle ve izinli kökenle gider; takip sondasının gövdesi tek yerde', () => {
    expect(metin).toContain(`PANEL_SIFIR="${KIMLIK}"`);
    expect(metin).toContain('"$PU/siparisler/$PANEL_SIFIR/kalem-teslim"');
    expect(metin).toContain('"$PU/siparisler/$PANEL_SIFIR/etiket-basildi"');
    expect(metin).toContain(`panel_sonda "silme (belirteçsiz)" 401 -X POST -H "Content-Type: application/json" -d '{}' "$PU/siparisler/$PANEL_SIFIR/sil"`);   // dilim 2b
    expect(metin).toMatch(/PY=\$\(curl -s --max-time 20 -w '\\n%\{http_code\}' -H "Origin: \$MK" "\$@" 2>\/dev\/null\)/);
    expect(metin.split(`-d '${TAKIP_GOVDESI}' "$MU/siparis-durumu"`).length - 1).toBe(1);
    expect(metin).not.toContain('hazir-degil (dilim 2\'ye kadar beklenen)');   // dilim 1'in «503 beklenir» sondası kalktı
  });

  it('istemci sondası SPA yedeğine güvenmez: betik `/magaza-panel-baglan` adresini İSTEMEZ, ana betiğin İÇİNDE arar; geçici dosyayı siler', () => {
    expect(metin).not.toMatch(/curl[^\n]*"\$BASE_URL\/magaza-panel-baglan/);
    expect(metin).toContain(`grep -oE '/assets/index-[A-Za-z0-9_-]+\\.js'`);
    expect(metin).toContain(`grep -q '/magaza-panel-baglan' "$IDOSYA"`);
    expect(metin).toContain('rm -f "$IDOSYA"');
  });

  it('istemci sondasının VARSAYIMI: yol metni giriş betiğinin STATİK içe aktarım kapanışındadır (yalnız tembel yüklenen bir sayfada dursaydı sonda canlıda yanlış FAIL verirdi)', () => {
    const YOL = '/magaza-panel-baglan';
    const yoluTasiyan = (dosya: string): boolean => kodSatirlari(dosya).some(k => k.kod.includes(YOL));
    // İstemci kaynakları: `src/` altında sunucu ve test yardımcıları dışındaki her şey.
    const istemci = kaynakDosyalari(SRC_KOK).filter(d => !/\/src\/(server|test)\//.test(d));
    const tasiyanlar = istemci.filter(yoluTasiyan);
    // Onay sayfası (§ 5.3) yoksa çit KIRMIZIDIR (atlanmaz): sonda 7 bunu canlıda ancak kesintili yayından SONRA görürdü.
    expect(tasiyanlar.map(gorece), 'istemci kaynağında /magaza-panel-baglan yok: onay sayfası (§ 5.3) yazılmadı ya da yol sabiti istemci kaynağından çıktı — sonda 7 canlıda FAIL verir').not.toEqual([]);
    // Giriş betiğinden (`index.html` → `src/main.tsx`) STATİK içe aktarımlarla erişilen dosyalar: Vite bunları ana betiğe
    // (`/assets/index-….js`) ya da onun ön yüklediği parçalara koyar; `import(…)` / `lazy(…)` hedefleri ayrı parçadır.
    const coz = (kimden: string, hedef: string): string | null => {
      const taban = hedef.startsWith('@/') ? resolve(KOK, hedef.slice(2)) : hedef.startsWith('.') ? resolve(dirname(kimden), hedef) : null;
      if (taban === null) return null;
      const govde = taban.replace(/\.(js|jsx)$/, '');
      for (const aday of [taban, `${govde}.ts`, `${govde}.tsx`, join(govde, 'index.ts'), join(govde, 'index.tsx')]) {
        if (/\.tsx?$/.test(aday) && existsSync(aday)) return aday;
      }
      return null;
    };
    const statikKomsular = (dosya: string): string[] => {
      const kaynak = kodSatirlari(dosya).map(k => k.kod).join('\n');
      const hedefler = [
        ...[...kaynak.matchAll(/^\s*(?:import|export)\s+(?!type\s)[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(e => e[1]),
        ...[...kaynak.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map(e => e[1]),
      ];
      return hedefler.map(h => coz(dosya, h)).filter((y): y is string => y !== null);
    };
    const giris = join(SRC_KOK, 'main.tsx');
    expect(existsSync(giris)).toBe(true);
    expect(readFileSync(join(KOK, 'index.html'), 'utf8')).toContain('src="/src/main.tsx"');
    const gorulen = new Set<string>();
    const yigin = [giris];
    for (let d = yigin.pop(); d !== undefined; d = yigin.pop()) {
      if (gorulen.has(d)) continue;
      gorulen.add(d);
      yigin.push(...statikKomsular(d));
    }
    expect(gorulen.has(join(SRC_KOK, 'App.tsx'))).toBe(true);   // yürüyücünün kendisi: App.tsx giriş betiğinden statik erişilir
    const statikte = tasiyanlar.filter(d => gorulen.has(d));
    expect(statikte.map(gorece), `yol metnini taşıyan dosyalar: ${tasiyanlar.map(gorece).join(', ')}`).not.toEqual([]);
  }, 60_000);   // `src/`in tamamı tek testte taranır: yük altında 5 sn'lik varsayılan süre yetmez (depo kalıbı)

  it('`post` dalının yapısı bozulmadı: satır başındaki iki `else` (kip dalı + özet) ve tek `magaza` köken değişkeni', () => {
    expect(kod.filter(s => s === 'else')).toHaveLength(2);
    expect(kod.filter(s => /^\s*MK="\$\{MAGAZA_KOKEN:-https:\/\/www\.cetpa\.com\.tr\}"$/.test(s))).toHaveLength(1);
    expect(kod.filter(s => /^\s*MU="\$BASE_URL\/api\/magaza"$/.test(s))).toHaveLength(1);
  });
});
