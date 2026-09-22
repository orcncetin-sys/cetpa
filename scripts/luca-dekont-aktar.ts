/**
 * luca-dekont-aktar.ts — LUCA muavinindeki tahsilat/ödemeleri Mikro'ya DEKONT olarak yazar.
 *
 * NEDEN VAR (2026-09-22): Faturalar Mikro'dan kesiliyor, ödemeler ise muhasebecinin ana
 * programı LUCA'da tutuluyor. Mikro'nun cari bakiyeleri bu yüzden ödemeleri görmüyor.
 * Mikro'nun "Banka Hesap Özeti Aktarımı" sihirbazı (Text/Ascii) denendi ve SESSİZCE hiçbir
 * kayıt üretmedi. Bu betik sihirbazı hiç kullanmaz; Cetpa'nın zaten üretimde olan Mikro API
 * yolunu kullanır (`DekontKaydetV2`, 2026-07-30'da canlıda bir kayıtla doğrulandı).
 *
 * NEDEN DEKONT, BANKA HAREKETİ DEĞİL (ölçüldü 2026-09-22, CARI_HESAP_HAREKETLERI):
 * Mikro'da 2026 boyunca HİÇ banka hareketi, yalnız 1 kasa hareketi var. Mikro'da banka/kasa
 * hesapları işletilmiyor; o defter LUCA'da. Bu yüzden yalnız CARİ tarafı yazılır — olmayan bir
 * banka hareketi uydurulmaz. Evrak tipi 29, seri LUCA (`dekontPayload` varsayılanı CTP'dir;
 * LUCA serisi bu aktarımın kayıtlarını ayrı sayılabilir/bulunabilir kılar).
 *
 * YÖN SÖZLEŞMESİ (Mikro'nun KENDİ kayıtlarından ölçüldü, tahmin DEĞİL):
 *   satış faturası evrak_tip 63 → cha_tip 0 (borç)   · alış faturası evrak_tip 0 → cha_tip 1 (alacak)
 *   bakiye = SUM(cha_tip=0 ? +meblag : -meblag); eksi = CETPA borçlu (hafıza notu 2026-07-30)
 *   ⇒ tahsilat cha_tip 1 (cariyi alacaklandırır), ödeme cha_tip 0 (cariyi borçlandırır).
 *
 * MÜKERRER KAYIT: Mikro'da idempotency YOK — aynı satır iki kez gönderilirse iki kayıt oluşur.
 * Koruma burada: her satır benzersiz bir `cha_belge_no` (LUCA26-<fiş>-<sıra>) taşır ve yazmadan
 * ÖNCE Mikro'ya "seri LUCA ile hangi belge no'lar zaten var" diye sorulur. Zaten varsa atlanır.
 * Bu sayede betik kesilirse aynı komutla güvenle tekrar çalıştırılabilir.
 *
 * ÇALIŞTIRMA (SUNUCUDA, uygulama dizininden):
 *   npx tsx scripts/luca-dekont-aktar.ts <manifest.json>                # KURU ÇALIŞMA — hiçbir şey yazmaz
 *   npx tsx scripts/luca-dekont-aktar.ts <manifest.json> --yaz --adet 1 # YALNIZ 1 satır yaz
 *   npx tsx scripts/luca-dekont-aktar.ts <manifest.json> --yaz          # tamamını yaz
 *   ... --bakiye <bakiye-beklenen.json>  : yazmadan ÖNCE cari bakiye mutabakatı (LUCA ↔ Mikro)
 *   ... --yalniz-tutan : yalnız bakiyesi tutan carilerin satırlarını yaz
 *   ... --devam        : hata alınca durma, kalanları dene (varsayılan: İLK hatada dur)
 *   ... --cakisanlari-atla : Mikro'da BAŞKA seriyle aynı gün+tutar+yön kaydı olan satırları yazma
 *
 * Varsayılan KURU'dur: `--yaz` verilmeden Mikro'ya tek bir istek bile gitmez (okuma hariç).
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { initMikroClient, getMikroCreds, mikroPost, mikroSql, MIKRO_API_BASE } from '../src/server/mikroClient.js';
import { cariHareketGovdesi } from '../src/server/mikro/govdeMuhasebe.js';
import { mikroGovdeHatasiMi } from '../src/server/mikro/govdeHatasi.js';

dotenv.config();
// mikroClient yalnız env kimlik bilgileri EKSİKSE adminDb'ye düşer. Betikte adminDb yok:
// init'i yine de geçiyoruz ki o durumda anlamsız bir TypeError yerine açık bir hata çıksın.
initMikroClient({ getAdminDb: () => null });

const EVRAK_TIP = 29;
const SERI = 'LUCA';

interface BakiyeBeklenen { cariKod: string; lucaBakiye: number; dekontEtkisi: number; mikroBeklenen: number }

interface ManifestSatiri {
  belgeNo: string; cariKod: string; cariAd: string; tarih: string;
  yon: 'tahsilat' | 'odeme'; tutar: number; chaTip: 0 | 1;
  aciklama: string; lucaKod: string; lucaFis: string; defter: string;
}

// ── Argümanlar ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const manifestYolu = argv.find(a => !a.startsWith('--'));
const YAZ = argv.includes('--yaz');
const DEVAM = argv.includes('--devam');
const adetArg = argv.indexOf('--adet');
const ADET = adetArg >= 0 ? Number(argv[adetArg + 1]) : Infinity;
const bakiyeArg = argv.indexOf('--bakiye');
const BAKIYE_YOLU = bakiyeArg >= 0 ? argv[bakiyeArg + 1] : null;
const YALNIZ_TUTAN = argv.includes('--yalniz-tutan');
const CAKISANLARI_ATLA = argv.includes('--cakisanlari-atla');
/** İki bakiyenin "aynı" sayılacağı eşik — kuruş yuvarlamaları için. */
const KURUS = 0.01;

if (!manifestYolu) {
  console.error('Kullanım: npx tsx scripts/luca-dekont-aktar.ts <manifest.json> [--bakiye <b.json>] [--yaz] [--adet N] [--devam] [--yalniz-tutan] [--cakisanlari-atla]');
  process.exit(1);
}
if (adetArg >= 0 && (!Number.isFinite(ADET) || ADET < 1)) {
  console.error('--adet bir pozitif tam sayı olmalı.');
  process.exit(1);
}

// ── Manifest okuma ve alan denetimi ──────────────────────────────────────────
function manifestOku(yol: string): ManifestSatiri[] {
  const ham = JSON.parse(fs.readFileSync(yol, 'utf8')) as { satirlar?: unknown };
  if (!Array.isArray(ham.satirlar)) throw new Error('Manifestte `satirlar` dizisi yok.');
  return ham.satirlar as ManifestSatiri[];
}

/** Mikro'ya SQL metnine gömülecek kod: yalnız güvenli karakterler. Tırnak/boşluk = RED. */
const KOD_RE = /^[A-Za-z0-9._-]{1,32}$/;
function guvenliKod(v: string): boolean { return KOD_RE.test(v); }

// ── Ana akış ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const satirlar = manifestOku(manifestYolu!);
  console.log(`Manifest       : ${manifestYolu}`);
  console.log(`Satır          : ${satirlar.length}`);
  console.log(`Mikro API      : ${MIKRO_API_BASE}`);
  console.log(`Mod            : ${YAZ ? '*** YAZMA ***' : 'KURU ÇALIŞMA (hiçbir şey yazılmaz)'}`);
  if (Number.isFinite(ADET)) console.log(`Sınır          : ilk ${ADET} satır`);
  console.log('');

  if (!(await getMikroCreds())) {
    console.error('Mikro kimlik bilgileri bulunamadı (env veya Ayarlar > Mikro ERP).');
    process.exit(2);
  }

  // 1) Gövde denetimi — her satır, rotanın kullandığı AYNI tek kaynaktan geçer.
  const gecerli: { s: ManifestSatiri; payload: Record<string, unknown> }[] = [];
  const govdeHatalari: { belgeNo: string; hata: string }[] = [];
  for (const s of satirlar) {
    try {
      if (!guvenliKod(s.cariKod)) throw new Error(`cari kodu güvenli karakter kümesinde değil: ${s.cariKod}`);
      if (!guvenliKod(s.belgeNo)) throw new Error(`belge no güvenli karakter kümesinde değil: ${s.belgeNo}`);
      if (s.chaTip !== 0 && s.chaTip !== 1) throw new Error('chaTip 0 ya da 1 olmalı');
      const beklenen = s.yon === 'tahsilat' ? 1 : 0;
      if (s.chaTip !== beklenen) throw new Error(`yön/chaTip tutarsız: ${s.yon} için ${beklenen} bekleniyordu`);
      const govde = cariHareketGovdesi({
        cha_tarihi: s.tarih,
        cha_tip: s.chaTip,
        cha_normal_Iade: 0,
        cha_evrak_tip: EVRAK_TIP,
        cha_evrakno_seri: SERI,
        cha_cari_cins: 0,
        cha_kod: s.cariKod,
        cha_belge_no: s.belgeNo,
        cha_d_kurtar: null, cha_d_cins: 0, cha_d_kur: 1,
        cha_srmrkkodu: '', cha_projekodu: '',
        cha_kasa_hizmet: 0, cha_kasa_hizkod: '',
        cha_meblag: s.tutar,
      }, s.aciklama);
      gecerli.push({ s, payload: govde.payload as unknown as Record<string, unknown> });
    } catch (e) {
      govdeHatalari.push({ belgeNo: s.belgeNo, hata: mikroGovdeHatasiMi(e) ? e.message : String(e) });
    }
  }
  console.log(`Gövde denetimi : ${gecerli.length} geçti, ${govdeHatalari.length} düştü`);
  for (const h of govdeHatalari.slice(0, 20)) console.log(`   DÜŞTÜ ${h.belgeNo}: ${h.hata}`);
  if (govdeHatalari.length) { console.error('\nGövde hatası var — düzeltilmeden yazma yapılmaz.'); process.exit(3); }

  // 2) Cari kodları Mikro'da GERÇEKTEN var mı? (olmayan koda yazmak sessiz çöp üretir)
  const kodlar = [...new Set(gecerli.map(g => g.s.cariKod))];
  const kodListesi = kodlar.map(k => `'${k}'`).join(',');
  const { rows: cariRows, hata: cariHata } = await mikroSql(
    `SELECT cari_kod FROM CARI_HESAPLAR WHERE cari_kod IN (${kodListesi})`);
  if (cariHata) { console.error(`Cari doğrulaması başarısız: ${cariHata}`); process.exit(4); }
  const mevcutCari = new Set(cariRows.map(r => String(r.cari_kod ?? '').trim()));
  const eksikCari = kodlar.filter(k => !mevcutCari.has(k));
  console.log(`Cari doğrulama : ${kodlar.length} koddan ${mevcutCari.size} tanesi Mikro'da var`);
  if (eksikCari.length) {
    console.error(`\nMikro'da BULUNMAYAN cari kodu (${eksikCari.length}):`);
    for (const k of eksikCari) {
      const ornek = gecerli.find(g => g.s.cariKod === k);
      console.error(`   ${k}  ${ornek?.s.cariAd ?? ''}`);
    }
    console.error('Bu kodlar düzeltilmeden yazma yapılmaz.');
    process.exit(5);
  }

  // ── Mükerrer koruması: İKİ bağımsız ağ ─────────────────────────────────────
  //
  // DOĞAL ANAHTAR TEK BAŞINA YETMEZ — veride MEŞRU tekrarlar var: Doğan Limoncu
  // 2026-04-01'de ÜÇ ayrı ₺25.000 göndermiş (ölçüldü: 7 grup, ₺474.900). Bu grupları
  // "zaten var" diye elemek iki gerçek ödemeyi kaybettirir. Bu yüzden anahtar bir küme
  // değil, SAYAÇ olarak kullanılır: Mikro'da o anahtardan M kayıt varsa gruptan M satır
  // atlanır, kalanı yazılır.
  const anahtarla = (kod: string, gun: string, tutar: number, tip: number) => `${kod}|${gun}|${tutar.toFixed(2)}|${tip}`;
  const satirAnahtari = (s: ManifestSatiri) => anahtarla(s.cariKod, s.tarih.replace(/-/g, ''), s.tutar, s.chaTip);

  /** Mikro'da BİZİM serimizle yazılmış kayıtların doğal anahtar sayımı. */
  const sayimOku = async (nerede: string): Promise<{ sayim: Map<string, number>; hata: string | null }> => {
    const { rows, hata } = await mikroSql(
      `SELECT cha_kod, CONVERT(varchar(8), cha_tarihi, 112) AS gun, cha_meblag, cha_tip, COUNT(*) AS adet ` +
      `FROM CARI_HESAP_HAREKETLERI WHERE cha_kod IN (${kodListesi}) AND ${nerede} ` +
      `GROUP BY cha_kod, CONVERT(varchar(8), cha_tarihi, 112), cha_meblag, cha_tip`);
    const sayim = new Map<string, number>();
    for (const r of rows) {
      const adet = Number(r.adet);
      if (!Number.isFinite(adet)) continue;   // sayı gelmediyse "0 kayıt" varsayma — atla, uyarı aşağıda
      sayim.set(anahtarla(String(r.cha_kod ?? '').trim(), String(r.gun ?? ''), Number(r.cha_meblag), Number(r.cha_tip)), adet);
    }
    return { sayim, hata };
  };

  // 3a) Belge no ağı (EN KESİN — ama cha_belge_no'nun Mikro'da saklandığı TEYİTSİZ).
  const { rows: varOlan, hata: belgeHata } = await mikroSql(
    `SELECT cha_belge_no FROM CARI_HESAP_HAREKETLERI WHERE cha_evrakno_seri = '${SERI}'`);
  if (belgeHata) { console.error(`Mükerrer kontrolü başarısız: ${belgeHata}`); process.exit(6); }
  const yazilmisBelge = new Set(varOlan.map(r => String(r.cha_belge_no ?? '').trim()).filter(Boolean));
  console.log(`Mikro'da '${SERI}' serisi: ${varOlan.length} kayıt, ${yazilmisBelge.size} tanesinin belge no'su dolu`);
  if (varOlan.length && !yazilmisBelge.size) {
    console.log(`   NOT: Mikro cha_belge_no'yu SAKLAMIYOR — koruma doğal anahtar sayacına düşüyor.`);
  }

  // 3b) Doğal anahtar SAYACI, yalnız BİZİM serimiz üstünde — kaldığı yerden devam için.
  const { sayim: kendiSayim, hata: kendiHata } = await sayimOku(`cha_evrakno_seri = '${SERI}'`);
  if (kendiHata) { console.error(`Doğal anahtar sayımı başarısız: ${kendiHata}`); process.exit(8); }

  const belgeAtilanSet = new Set(gecerli.filter(g => yazilmisBelge.has(g.s.belgeNo)).map(g => g.s.belgeNo));
  // Grup grup: Mikro'daki sayı, belge no ile zaten atılandan FAZLAYSA aradaki kadarını daha at.
  const grup = new Map<string, { s: ManifestSatiri; payload: Record<string, unknown> }[]>();
  for (const g of gecerli) {
    const a = satirAnahtari(g.s);
    const liste = grup.get(a);
    if (liste) liste.push(g); else grup.set(a, [g]);
  }
  const sayacIleAtilan = new Set<string>();
  for (const [a, liste] of grup) {
    const mikroda = kendiSayim.get(a);
    if (mikroda === undefined) continue;                       // bu anahtardan hiç yazılmamış
    const zaten = liste.filter(g => belgeAtilanSet.has(g.s.belgeNo)).length;
    const ekstra = Math.max(0, mikroda - zaten);
    for (const g of liste.filter(x => !belgeAtilanSet.has(x.s.belgeNo)).slice(0, ekstra)) {
      sayacIleAtilan.add(g.s.belgeNo);
    }
  }
  const kalan = gecerli.filter(g => !belgeAtilanSet.has(g.s.belgeNo) && !sayacIleAtilan.has(g.s.belgeNo));
  console.log(`Zaten yazılmış : ${belgeAtilanSet.size} (belge no) + ${sayacIleAtilan.size} (doğal anahtar sayacı)`);
  console.log(`Yazılacak      : ${kalan.length} satır`);

  // 3c) UYARI AĞI — ödemenin Mikro'ya BAŞKA yoldan (elle, başka seri) girmiş olması.
  //     Bu ağ ASLA eleme yapmaz; yalnız uyarır. Fatura ile çakışma ihtimali yüksek
  //     olduğu için otomatik elemeye güvenilmez, karar kullanıcınındır.
  const { sayim: digerSayim, hata: digerHata } = await sayimOku(`ISNULL(cha_evrakno_seri, '') <> '${SERI}'`);
  if (digerHata) { console.error(`Ön uyarı sorgusu başarısız: ${digerHata}`); process.exit(9); }
  const cakisan = kalan.filter(g => digerSayim.has(satirAnahtari(g.s)));
  if (cakisan.length) {
    console.log(`\nUYARI — Mikro'da BAŞKA bir seriyle aynı gün+tutar+yön kaydı olan ${cakisan.length} satır:`);
    for (const g of cakisan.slice(0, 15)) {
      console.log(`   ${g.s.belgeNo} ${g.s.tarih} ${g.s.tutar.toLocaleString('tr-TR')} TL ${g.s.cariKod} ${g.s.cariAd.slice(0, 28)}`);
    }
    console.log(`   Aynı tarihli bir FATURA da bu kalıba uyabilir — otomatik elenmez, gözle bakın.`);
    console.log(`   Bu satırları dışarıda bırakmak için: --cakisanlari-atla`);
  }

  // 3c) BAKİYE MUTABAKATI — yazmadan önce "bu aktarım LUCA ile Mikro'yu buluşturacak mı?"
  //     Beklenen = LUCA kapanış bakiyesi − dekontların etkisi. Mikro'nun ŞU ANKİ bakiyesi
  //     buna eşitse, dekontlar yazılınca Mikro = LUCA olur. Eşit değilse o caride
  //     başka bir fark var (Mikro'da olmayan fatura, çift kayıt, yanlış eşleşme).
  const tutmayanCari = new Set<string>();
  if (BAKIYE_YOLU) {
    const beklenenler = JSON.parse(fs.readFileSync(BAKIYE_YOLU, 'utf8')) as BakiyeBeklenen[];
    const { rows: bakRows, hata: bakHata } = await mikroSql(
      `SELECT cha_kod, SUM(CASE WHEN cha_tip = 0 THEN cha_meblag ELSE -cha_meblag END) AS bakiye ` +
      `FROM CARI_HESAP_HAREKETLERI WHERE cha_kod IN (${kodListesi}) GROUP BY cha_kod`);
    if (bakHata) { console.error(`Bakiye mutabakatı başarısız: ${bakHata}`); process.exit(9); }
    const mikroBakiye = new Map(bakRows.map(r => [String(r.cha_kod ?? '').trim(), Number(r.bakiye)]));
    const tutan: BakiyeBeklenen[] = [], tutmayan: (BakiyeBeklenen & { simdi: number; fark: number })[] = [];
    const okunamayan: string[] = [];
    for (const b of beklenenler) {
      const ham = mikroBakiye.get(b.cariKod);
      // `?? 0` DEĞİL: carinin VARLIĞI adım 2'de doğrulandı, bu yüzden hareket tablosunda
      // satırının olmaması "bilinmiyor" değil "hiç hareketi yok" demektir — bakiye GERÇEKTEN 0.
      // Satır döndü ama sayı değilse bu ayrı bir durumdur ve sessizce 0 sayılmaz.
      const simdi = ham === undefined ? 0 : ham;
      if (!Number.isFinite(simdi)) { okunamayan.push(b.cariKod); tutmayanCari.add(b.cariKod); continue; }
      const fark = simdi - b.mikroBeklenen;
      if (Math.abs(fark) <= KURUS) tutan.push(b);
      else { tutmayan.push({ ...b, simdi, fark }); tutmayanCari.add(b.cariKod); }
    }
    if (okunamayan.length) {
      console.log(`   OKUNAMAYAN: ${okunamayan.length} carinin bakiyesi sayı olarak gelmedi — tutmayan sayıldı`);
      console.log(`   ${okunamayan.slice(0, 10).join(', ')}`);
    }
    console.log(`\nBAKİYE MUTABAKATI (${beklenenler.length} cari)`);
    console.log(`   TUTAN    : ${tutan.length} cari — dekontlar yazılınca Mikro = LUCA olacak`);
    console.log(`   TUTMAYAN : ${tutmayan.length} cari — bu carilerde başka bir fark var`);
    if (tutmayan.length) {
      console.log('\n   cari kod   |    Mikro şimdi |  olması gereken |            fark | ad');
      for (const t of tutmayan.sort((a, b) => Math.abs(b.fark) - Math.abs(a.fark)).slice(0, 25)) {
        const ad = gecerli.find(g => g.s.cariKod === t.cariKod)?.s.cariAd ?? '';
        const f = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2 }).padStart(15);
        console.log(`   ${t.cariKod.padEnd(10)} | ${f(t.simdi)} | ${f(t.mikroBeklenen)} | ${f(t.fark)} | ${ad.slice(0, 28)}`);
      }
      console.log('\n   Bu farklar Mikro\'da EKSİK/FAZLA fatura ya da yanlış eşleşme anlamına gelir.');
      console.log('   Yalnız tutan carileri yazmak için: --yalniz-tutan');
    }
  }

  const cakisanSet = new Set(cakisan.map(g => g.s.belgeNo));
  let aday = kalan;
  if (CAKISANLARI_ATLA) aday = aday.filter(g => !cakisanSet.has(g.s.belgeNo));
  if (YALNIZ_TUTAN) aday = aday.filter(g => !tutmayanCari.has(g.s.cariKod));
  if (aday.length !== kalan.length) {
    console.log(`\nSüzme sonrası: ${kalan.length} → ${aday.length} satır` +
      (CAKISANLARI_ATLA ? ' (--cakisanlari-atla)' : '') + (YALNIZ_TUTAN ? ' (--yalniz-tutan)' : ''));
  }
  const hedef = aday.slice(0, Number.isFinite(ADET) ? ADET : aday.length);
  const toplam = hedef.reduce((a, g) => a + g.s.tutar, 0);
  console.log(`Bu koşuda      : ${hedef.length} satır, ${toplam.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL\n`);

  if (!YAZ) {
    console.log('KURU ÇALIŞMA bitti. Mikro\'ya hiçbir kayıt yazılmadı.');
    console.log('Yazmak için:  ... --yaz --adet 1   (önce TEK satır)');
    console.log('Bakiye mutabakatı için ayrıca:  --bakiye <bakiye-beklenen.json>');
    for (const g of hedef.slice(0, 5)) {
      console.log(`   ÖRNEK ${g.s.belgeNo} | ${g.s.tarih} | ${g.s.yon} | cha_tip ${g.s.chaTip} | ${g.s.tutar} TL | ${g.s.cariKod} ${g.s.cariAd.slice(0, 30)}`);
    }
    return;
  }

  // 4) Yazma — satır satır, her sonuç diske.
  const logYolu = path.join(path.dirname(manifestYolu!), `luca-aktarim-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.jsonl`);
  console.log(`Sonuç günlüğü  : ${logYolu}\n`);
  let basarili = 0, basarisiz = 0;

  for (const [i, g] of hedef.entries()) {
    const t0 = Date.now();
    let ok = false, hataMsg: string | null = null, ham: unknown = null;
    try {
      const { ok: httpOk, data, status } = await mikroPost('DekontKaydetV2', g.payload, true);
      ham = data;
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      // r0 YOKSA başarı DEĞİL: anahtarsız 200 (stub/"Api Server Error") başarı sayılmaz.
      ok = httpOk && !!r0 && !r0.IsError;
      hataMsg = ok ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
    } catch (e) {
      hataMsg = e instanceof Error ? e.message : String(e);
    }
    fs.appendFileSync(logYolu, JSON.stringify({
      belgeNo: g.s.belgeNo, cariKod: g.s.cariKod, tarih: g.s.tarih, yon: g.s.yon,
      tutar: g.s.tutar, ok, hata: hataMsg, ms: Date.now() - t0,
      ...(ok ? {} : { yanit: ham }),
    }) + '\n');

    if (ok) { basarili++; console.log(`  ✓ ${i + 1}/${hedef.length} ${g.s.belgeNo} ${g.s.tutar} TL ${g.s.cariKod}`); }
    else {
      basarisiz++;
      console.error(`  ✗ ${i + 1}/${hedef.length} ${g.s.belgeNo} ${g.s.cariKod}: ${hataMsg}`);
      if (!DEVAM) { console.error('\nİLK HATADA DURULDU. Günlüğü inceleyin, düzeltin, aynı komutu tekrar çalıştırın'); break; }
    }
  }

  console.log(`\nBitti: ${basarili} yazıldı, ${basarisiz} başarısız.`);
  console.log(`Doğrulama sorgusu (sunucuda sqlcmd ile):`);
  console.log(`  SELECT COUNT(*) adet, SUM(cha_meblag) toplam FROM CARI_HESAP_HAREKETLERI WHERE cha_evrakno_seri = '${SERI}'`);
  if (basarisiz) process.exitCode = 7;
}

main().catch(e => { console.error('Beklenmeyen hata:', e); process.exit(1); });
