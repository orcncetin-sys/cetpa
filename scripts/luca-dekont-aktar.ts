/**
 * luca-dekont-aktar.ts — LUCA muavinindeki tahsilat/ödemeleri Mikro'ya DEKONT olarak yazar.
 *
 * NEDEN VAR (2026-09-22): Faturalar Mikro'dan kesiliyor, ödemeler ise muhasebecinin ana
 * programı LUCA'da tutuluyor. Mikro'nun cari bakiyeleri bu yüzden ödemeleri görmüyor.
 * Mikro'nun "Banka Hesap Özeti Aktarımı" sihirbazı (Text/Ascii) denendi ve SESSİZCE hiçbir
 * kayıt üretmedi. Bu betik sihirbazı kullanmaz; Cetpa'nın üretimdeki Mikro API yolunu
 * (`DekontKaydetV2`) kullanır — 2026-07-30'da canlıda bir kayıtla doğrulandı.
 *
 * NEDEN DEKONT, BANKA HAREKETİ DEĞİL (ölçüldü, tahmin edilmedi):
 * Mikro'da 2026 boyunca HİÇ banka hareketi, yalnız 1 kasa hareketi var — banka/kasa
 * hesapları Mikro'da işletilmiyor, o defter LUCA'da. Bu yüzden yalnız CARİ tarafı yazılır.
 * `cha_kasa_hizmet`in BANKA değeri kod tabanında hiç geçmiyor (TEYİTSİZ) ve tahmin edilmez.
 *
 * YÖN (Mikro'nun KENDİ kayıtlarından ölçüldü): satış faturası evrak_tip 63 → cha_tip 0,
 * alış faturası evrak_tip 0 → cha_tip 1. bakiye = SUM(cha_tip=0 ? +meblag : −meblag).
 * ⇒ tahsilat cha_tip 1, ödeme cha_tip 0. LUCA borç/alacak kolonuyla çapraz doğrulandı.
 *
 * ÇALIŞTIRMA (SUNUCUDA, uygulama dizininden):
 *   npx tsx scripts/luca-dekont-aktar.ts <manifest.json>                    # KURU — hiçbir şey yazmaz
 *   npx tsx scripts/luca-dekont-aktar.ts <manifest.json> --bakiye <b.json>  # + bakiye mutabakatı
 *   npx tsx scripts/luca-dekont-aktar.ts <manifest.json> --bakiye <b.json> --yaz --adet 1
 *
 * Bayraklar: --yaz  --adet N  --bakiye <yol>  --yalniz-tutan  --cakisanlari-atla  --devam
 * Varsayılan KURU'dur. Bilinmeyen bayrak REDDEDİLİR (sessizce yok sayılmaz).
 *
 * ÇIKIŞ KODLARI: 1 argüman · 2 kimlik · 3 manifest/gövde · 4 cari sorgusu · 5 eksik cari
 *                6 belge no sorgusu · 7 yazma hatası · 8 sayaç sorgusu · 9 bakiye sorgusu
 *                10 çakışma (onaysız) · 11 bakiye dosyası
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
/** İki bakiyenin "aynı" sayılacağı eşik — kuruş yuvarlamaları için. */
const KURUS = 0.01;
/** SQL metnine gömülecek kod: yalnız güvenli karakterler. Tırnak/boşluk = RED. */
const KOD_RE = /^[A-Za-z0-9._-]{1,32}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

type Yon = 'tahsilat' | 'odeme';
/** Yön → cha_tip. Ternary DEĞİL: tanınmayan yön sessizce "ödeme"ye çökmesin. */
const YON_CHATIP: Readonly<Record<Yon, 0 | 1>> = { tahsilat: 1, odeme: 0 };

interface ManifestSatiri {
  belgeNo: string; cariKod: string; cariAd: string; tarih: string;
  yon: Yon; tutar: number; chaTip: 0 | 1;
  aciklama: string; lucaKod: string; lucaFis: string; defter: string;
}
interface BakiyeBeklenen {
  cariKod: string; lucaBakiye: number; dekontEtkisi: number; mikroBeklenen: number;
  /** LUCA'nin acilis fisi = aktarilan donemden ONCEKI kapanis. Bilinmiyorsa NaN. */
  lucaOncekiDonem: number;
  /** LUCA'nin aktarilan donemdeki FATURA tarafi (odemeler haric). Bilinmiyorsa NaN. */
  lucaBuDonemFatura: number;
}
interface Hazir { s: ManifestSatiri; payload: Record<string, unknown>; anahtar: string }

const guvenliKod = (v: unknown): v is string => typeof v === 'string' && KOD_RE.test(v);
const metin = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Bir dekontun Mikro bakiyesine etkisi: cha_tip 0 borçlandırır (+), 1 alacaklandırır (−). */
const bakiyeEtkisi = (s: ManifestSatiri): number => (s.chaTip === 0 ? s.tutar : -s.tutar);

// ── Argümanlar ───────────────────────────────────────────────────────────────
const BAYRAKLAR = new Set(['--yaz', '--devam', '--yalniz-tutan', '--cakisanlari-atla']);
const DEGERLI = new Set(['--adet', '--bakiye']);

function argAyristir(argv: string[]): { konum: string[]; bayrak: Set<string>; deger: Map<string, string> } {
  const konum: string[] = [], bayrak = new Set<string>(), deger = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) { konum.push(a); continue; }
    const esit = a.indexOf('=');
    const ad = esit >= 0 ? a.slice(0, esit) : a;
    if (BAYRAKLAR.has(ad)) {
      if (esit >= 0) { console.error(`${ad} değer almaz: ${a}`); process.exit(1); }
      bayrak.add(ad); continue;
    }
    if (DEGERLI.has(ad)) {
      const v = esit >= 0 ? a.slice(esit + 1) : argv[++i];
      if (v === undefined || v === '' || v.startsWith('--')) { console.error(`${ad} bir değer bekliyor.`); process.exit(1); }
      deger.set(ad, v); continue;
    }
    // Bilinmeyen bayrak SESSİZCE yok sayılmaz: yazım hatası "koruma açık sandım" hatasıdır.
    console.error(`Bilinmeyen bayrak: ${a}\nGeçerli olanlar: ${[...BAYRAKLAR, ...DEGERLI].join(' ')}`);
    process.exit(1);
  }
  return { konum, bayrak, deger };
}

const { konum, bayrak, deger } = argAyristir(process.argv.slice(2));
const manifestYolu = konum[0];
const YAZ = bayrak.has('--yaz');
const DEVAM = bayrak.has('--devam');
const YALNIZ_TUTAN = bayrak.has('--yalniz-tutan');
const CAKISANLARI_ATLA = bayrak.has('--cakisanlari-atla');
const BAKIYE_YOLU = deger.get('--bakiye') ?? null;
const ADET = deger.has('--adet') ? Number(deger.get('--adet')) : Infinity;

if (!manifestYolu) {
  console.error('Kullanım: npx tsx scripts/luca-dekont-aktar.ts <manifest.json> [--bakiye <b.json>] [--yaz] [--adet N] [--yalniz-tutan] [--cakisanlari-atla] [--devam]');
  process.exit(1);
}
if (konum.length > 1) { console.error(`Fazladan argüman: ${konum.slice(1).join(' ')}`); process.exit(1); }
if (deger.has('--adet') && (!Number.isInteger(ADET) || ADET < 1)) {
  console.error(`--adet pozitif tam sayı olmalı, gelen: ${deger.get('--adet')}`); process.exit(1);
}
// `--yalniz-tutan` tek başına SESSİZ no-op olurdu: mutabakat yapılmadan "tutmayan" kümesi
// boş kalır ve süzgeç hiçbir satırı elemez — kullanıcı korunduğunu sanır. Sert kapı:
if (YALNIZ_TUTAN && !BAKIYE_YOLU) {
  console.error('--yalniz-tutan yalnız --bakiye <bakiye-beklenen.json> ile kullanılabilir.');
  console.error('Bakiye mutabakatı yapılmadan "tutan cari" kümesi üretilemez, süzgeç hiçbir şey elemez.');
  process.exit(1);
}

// ── Dosya okuma + ÇALIŞMA ANI doğrulama ──────────────────────────────────────
function manifestOku(yol: string): ManifestSatiri[] {
  const ham = JSON.parse(fs.readFileSync(yol, 'utf8')) as Record<string, unknown>;
  const satirlar = ham.satirlar;
  if (!Array.isArray(satirlar)) throw new Error('Manifestte `satirlar` dizisi yok.');

  const hatalar: string[] = [];
  const cikti: ManifestSatiri[] = [];
  const belgeSayimi = new Map<string, number>();

  satirlar.forEach((x, i) => {
    const r = x as Record<string, unknown>;
    const nerede = `satır ${i + 1} (belgeNo: ${JSON.stringify(r.belgeNo)})`;
    // `as` cast'i çalışma anında HİÇBİR ŞEY doğrulamaz — dış dosya, alan alan denetlenir.
    if (!guvenliKod(r.belgeNo)) { hatalar.push(`${nerede}: belgeNo geçersiz`); return; }
    if (!guvenliKod(r.cariKod)) { hatalar.push(`${nerede}: cariKod metin ve güvenli karakterlerde olmalı`); return; }
    if (typeof r.tarih !== 'string' || !ISO_RE.test(r.tarih)) {
      // ISO ZORUNLU: gövde kurucusu DD.MM.YYYY'yi de kabul ediyor, ama doğal anahtar
      // sayacı Mikro'nun YYYYMMDD çıktısıyla karşılaştırıyor. TR biçimli bir manifest
      // gövdeden GEÇER ama mükerrer koruması sessizce ölür. Sessiz kayıp yerine dur.
      hatalar.push(`${nerede}: tarih YYYY-MM-DD olmalı, gelen ${JSON.stringify(r.tarih)}`); return;
    }
    if (typeof r.tutar !== 'number' || !Number.isFinite(r.tutar) || r.tutar <= 0) {
      hatalar.push(`${nerede}: tutar pozitif sonlu sayı olmalı, gelen ${JSON.stringify(r.tutar)}`); return;
    }
    if (r.yon !== 'tahsilat' && r.yon !== 'odeme') {
      hatalar.push(`${nerede}: yon 'tahsilat' ya da 'odeme' olmalı, gelen ${JSON.stringify(r.yon)}`); return;
    }
    const beklenen = YON_CHATIP[r.yon];
    if (r.chaTip !== beklenen) {
      hatalar.push(`${nerede}: yon '${r.yon}' için chaTip ${beklenen} olmalı, gelen ${JSON.stringify(r.chaTip)}`); return;
    }
    belgeSayimi.set(r.belgeNo, (belgeSayimi.get(r.belgeNo) ?? 0) + 1);
    cikti.push({
      belgeNo: r.belgeNo, cariKod: r.cariKod, cariAd: metin(r.cariAd), tarih: r.tarih,
      yon: r.yon, tutar: r.tutar, chaTip: beklenen,
      aciklama: metin(r.aciklama), lucaKod: metin(r.lucaKod), lucaFis: metin(r.lucaFis), defter: metin(r.defter),
    });
  });

  // Belge no mükerrer korumasının ANAHTARI — manifest içinde tekil olduğu VARSAYILMAZ, ölçülür.
  const yinelenen = [...belgeSayimi].filter(([, n]) => n > 1);
  if (yinelenen.length) {
    hatalar.push(`Manifest içinde yinelenen belgeNo (${yinelenen.length}): ` +
      yinelenen.slice(0, 10).map(([b, n]) => `${b}×${n}`).join(', '));
  }
  // Üretici tarafın bildirdiği toplamlar varsa doğrula — sessiz kırpılma/bozulma yakalanır.
  const bekAdet = ham.beklenenAdet, bekKurus = ham.beklenenToplamKurus;
  if (typeof bekAdet === 'number' && bekAdet !== cikti.length) {
    hatalar.push(`Manifest beklenenAdet ${bekAdet} ama ${cikti.length} satır okundu`);
  }
  if (typeof bekKurus === 'number') {
    const kurus = cikti.reduce((a, s) => a + Math.round(s.tutar * 100), 0);
    if (kurus !== bekKurus) hatalar.push(`Manifest beklenenToplamKurus ${bekKurus} ama ${kurus} hesaplandı`);
  }
  if (hatalar.length) {
    console.error(`\nManifest doğrulaması DÜŞTÜ (${hatalar.length}):`);
    for (const h of hatalar.slice(0, 30)) console.error(`   ${h}`);
    if (hatalar.length > 30) console.error(`   ... ve ${hatalar.length - 30} tane daha`);
    process.exit(3);
  }
  return cikti;
}

function bakiyeOku(yol: string): BakiyeBeklenen[] {
  const ham = JSON.parse(fs.readFileSync(yol, 'utf8')) as unknown;
  if (!Array.isArray(ham)) { console.error('Bakiye dosyası bir dizi olmalı.'); process.exit(11); }
  const cikti: BakiyeBeklenen[] = [], hatalar: string[] = [];
  ham.forEach((x, i) => {
    const r = x as Record<string, unknown>;
    if (!guvenliKod(r.cariKod)) { hatalar.push(`bakiye satır ${i + 1}: cariKod geçersiz`); return; }
    if (typeof r.mikroBeklenen !== 'number' || !Number.isFinite(r.mikroBeklenen)) {
      hatalar.push(`bakiye satır ${i + 1} (${r.cariKod}): mikroBeklenen sonlu sayı olmalı`); return;
    }
    const say = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    cikti.push({
      cariKod: r.cariKod, mikroBeklenen: r.mikroBeklenen,
      lucaBakiye: say(r.lucaBakiye), dekontEtkisi: say(r.dekontEtkisi),
      lucaOncekiDonem: say(r.lucaOncekiDonem), lucaBuDonemFatura: say(r.lucaBuDonemFatura),
    });
  });
  if (hatalar.length) {
    console.error(`\nBakiye dosyası doğrulaması DÜŞTÜ (${hatalar.length}):`);
    for (const h of hatalar.slice(0, 20)) console.error(`   ${h}`);
    process.exit(11);
  }
  return cikti;
}

const para = (n: number): string => n.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

/** Aktarilan donemin yili = manifestteki EN ERKEN tarihin yili. Sabit yil gomulmez. */
function hedefDonemYili(satirlar: readonly ManifestSatiri[]): string {
  let enErken = satirlar[0]?.tarih ?? '';
  for (const s of satirlar) if (s.tarih < enErken) enErken = s.tarih;
  return enErken.slice(0, 4);
}

// ── Ana akış ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const satirlar = manifestOku(manifestYolu!);
  console.log(`Manifest       : ${manifestYolu}`);
  console.log(`Satır          : ${satirlar.length}`);
  console.log(`Mikro API      : ${MIKRO_API_BASE}`);
  console.log(`Mod            : ${YAZ ? '*** YAZMA ***' : 'KURU ÇALIŞMA (hiçbir şey yazılmaz)'}`);
  if (Number.isFinite(ADET)) console.log(`Sınır          : ilk ${ADET} satır`);
  console.log('');

  if (!(await getMikroCreds())) { console.error('Mikro kimlik bilgileri bulunamadı.'); process.exit(2); }

  // 1) Gövde denetimi — rotanın kullandığı AYNI tek kaynak (kopya gövde yazılmadı).
  const gecerli: Hazir[] = [];
  const govdeHatalari: string[] = [];
  for (const s of satirlar) {
    try {
      const govde = cariHareketGovdesi({
        cha_tarihi: s.tarih, cha_tip: s.chaTip, cha_normal_Iade: 0,
        cha_evrak_tip: EVRAK_TIP, cha_evrakno_seri: SERI, cha_cari_cins: 0,
        cha_kod: s.cariKod, cha_belge_no: s.belgeNo,
        cha_d_kurtar: null, cha_d_cins: 0, cha_d_kur: 1,
        cha_srmrkkodu: '', cha_projekodu: '', cha_kasa_hizmet: 0, cha_kasa_hizkod: '',
        cha_meblag: s.tutar,
      }, s.aciklama);
      // Anahtar, gövdenin NORMALİZE ettiği tarihten türer (manifestOku ISO'yu zaten zorunlu
      // kıldı; bu ikinci kayış, gövde sözleşmesi değişirse de anahtarın kaymamasını sağlar).
      const trTarih = String((govde.satir as Record<string, unknown>).cha_tarihi ?? '');
      const p = trTarih.split('.');
      if (p.length !== 3) throw new Error(`gövde tarihi çözülemedi: ${trTarih}`);
      const gun = `${p[2]}${p[1]}${p[0]}`;
      gecerli.push({
        s, payload: govde.payload as unknown as Record<string, unknown>,
        anahtar: `${s.cariKod}|${gun}|${s.tutar.toFixed(2)}|${s.chaTip}`,
      });
    } catch (e) {
      govdeHatalari.push(`${s.belgeNo}: ${mikroGovdeHatasiMi(e) ? e.message : String(e)}`);
    }
  }
  console.log(`Gövde denetimi : ${gecerli.length} geçti, ${govdeHatalari.length} düştü`);
  for (const h of govdeHatalari.slice(0, 20)) console.log(`   DÜŞTÜ ${h}`);
  if (govdeHatalari.length) { console.error('\nGövde hatası var — düzeltilmeden yazma yapılmaz.'); process.exit(3); }

  const kodlar = [...new Set(gecerli.map(g => g.s.cariKod))];

  /** Cari kodu listesini SQL IN parçasına çevirir. Her kod KOD_RE'den geçmiş olmalı. */
  const inListesi = (ks: readonly string[]): string => ks.map(k => `'${k}'`).join(',');

  // 2) Cari kodları Mikro'da GERÇEKTEN var mı? SQL Server karşılaştırması harf duyarsızdır,
  //    JS Set'i duyarlı — iki tarafı da katlamazsak var olan cari "yok" görünür.
  const { rows: cariRows, hata: cariHata } = await mikroSql(
    `SELECT cari_kod FROM CARI_HESAPLAR WHERE cari_kod IN (${inListesi(kodlar)})`);
  if (cariHata) { console.error(`Cari doğrulaması başarısız: ${cariHata}`); process.exit(4); }
  const mikroYazimi = new Map(cariRows.map(r => { const v = String(r.cari_kod ?? '').trim(); return [v.toUpperCase(), v]; }));
  const eksikCari = kodlar.filter(k => !mikroYazimi.has(k.toUpperCase()));
  console.log(`Cari doğrulama : ${kodlar.length} koddan ${mikroYazimi.size} tanesi Mikro'da var`);
  if (eksikCari.length) {
    console.error(`\nMikro'da BULUNMAYAN cari kodu (${eksikCari.length}):`);
    for (const k of eksikCari) console.error(`   ${k}  ${gecerli.find(g => g.s.cariKod === k)?.s.cariAd ?? ''}`);
    console.error('Bu kodlar düzeltilmeden yazma yapılmaz.');
    process.exit(5);
  }

  // ── Mükerrer koruması: İKİ bağımsız ağ ─────────────────────────────────────
  //
  // DOĞAL ANAHTAR TEK BAŞINA YETMEZ — veride MEŞRU tekrarlar var: Doğan Limoncu
  // 2026-04-01'de ÜÇ ayrı ₺25.000 göndermiş (ölçüldü: 7 grup, ₺474.900). Bu grupları
  // "zaten var" diye elemek iki gerçek ödemeyi kaybettirir. Anahtar bu yüzden bir küme
  // değil SAYAÇ'tır: Mikro'da o anahtardan M kayıt varsa gruptan M satır atlanır.
  const sayimOku = async (nerede: string): Promise<{ sayim: Map<string, number>; okunamayan: number; hata: string | null }> => {
    const { rows, hata } = await mikroSql(
      `SELECT cha_kod, CONVERT(varchar(8), cha_tarihi, 112) AS gun, cha_meblag, cha_tip, COUNT(*) AS adet ` +
      `FROM CARI_HESAP_HAREKETLERI WHERE cha_kod IN (${inListesi(kodlar)}) AND ${nerede} ` +
      `GROUP BY cha_kod, CONVERT(varchar(8), cha_tarihi, 112), cha_meblag, cha_tip`);
    const sayim = new Map<string, number>();
    let okunamayan = 0;
    for (const r of rows) {
      const adet = Number(r.adet), meblag = Number(r.cha_meblag), tip = Number(r.cha_tip);
      const kod = String(r.cha_kod ?? '').trim(), gun = String(r.gun ?? '');
      // Çözülemeyen satırı "0 kayıt" saymak fail-OPEN olur (mükerrer yazarız). Say ve bildir.
      if (!Number.isFinite(adet) || !Number.isFinite(meblag) || !Number.isFinite(tip) || !kod || gun.length !== 8) {
        okunamayan++; continue;
      }
      sayim.set(`${kod}|${gun}|${meblag.toFixed(2)}|${tip}`, adet);
    }
    return { sayim, okunamayan, hata };
  };

  // 3a) Belge no ağı (EN KESİN — ama cha_belge_no'nun Mikro'da saklandığı TEYİTSİZ).
  const { rows: varOlan, hata: belgeHata } = await mikroSql(
    `SELECT cha_belge_no FROM CARI_HESAP_HAREKETLERI WHERE cha_evrakno_seri = '${SERI}'`);
  if (belgeHata) { console.error(`Mükerrer kontrolü başarısız: ${belgeHata}`); process.exit(6); }
  const yazilmisBelge = new Set(varOlan.map(r => String(r.cha_belge_no ?? '').trim()).filter(Boolean));
  console.log(`'${SERI}' serisi : Mikro'da ${varOlan.length} kayıt, ${yazilmisBelge.size} tanesinin belge no'su dolu`);
  if (varOlan.length && !yazilmisBelge.size) {
    console.log(`   NOT: Mikro cha_belge_no'yu SAKLAMIYOR — koruma doğal anahtar sayacına düşüyor.`);
  }

  // 3b) Doğal anahtar SAYACI, yalnız BİZİM serimiz üstünde — kaldığı yerden devam için.
  const { sayim: kendiSayim, okunamayan: kendiOkunamayan, hata: kendiHata } = await sayimOku(`cha_evrakno_seri = '${SERI}'`);
  if (kendiHata) { console.error(`Doğal anahtar sayımı başarısız: ${kendiHata}`); process.exit(8); }
  if (kendiOkunamayan) {
    console.error(`\nSayaç sorgusunda ÇÖZÜLEMEYEN ${kendiOkunamayan} grup var — mükerrer koruması eksik kalır.`);
    if (YAZ) { console.error('Yazma iptal edildi.'); process.exit(8); }
  }

  const belgeAtilan = new Set(gecerli.filter(g => yazilmisBelge.has(g.s.belgeNo)).map(g => g.s.belgeNo));
  const grup = new Map<string, Hazir[]>();
  for (const g of gecerli) {
    const liste = grup.get(g.anahtar);
    if (liste) liste.push(g); else grup.set(g.anahtar, [g]);
  }
  const sayacAtilan = new Set<string>();
  for (const [a, liste] of grup) {
    const mikroda = kendiSayim.get(a);
    if (mikroda === undefined) continue;                     // bu anahtardan hiç yazılmamış
    const zaten = liste.filter(g => belgeAtilan.has(g.s.belgeNo)).length;
    for (const g of liste.filter(x => !belgeAtilan.has(x.s.belgeNo)).slice(0, Math.max(0, mikroda - zaten))) {
      sayacAtilan.add(g.s.belgeNo);
    }
  }
  const yazilmisSatirlar = gecerli.filter(g => belgeAtilan.has(g.s.belgeNo) || sayacAtilan.has(g.s.belgeNo));
  const kalan = gecerli.filter(g => !belgeAtilan.has(g.s.belgeNo) && !sayacAtilan.has(g.s.belgeNo));
  console.log(`Zaten yazılmış : ${belgeAtilan.size} (belge no) + ${sayacAtilan.size} (doğal anahtar sayacı)`);
  console.log(`Yazılacak      : ${kalan.length} satır`);

  // 3c) UYARI AĞI — ödemenin Mikro'ya BAŞKA yoldan (elle, başka seri) girmiş olması.
  //     Fatura da aynı kalıba uyabildiği için otomatik ELEMEZ; yalnız uyarır.
  const { sayim: digerSayim, okunamayan: digerOkunamayan, hata: digerHata } =
    await sayimOku(`ISNULL(cha_evrakno_seri, '') <> '${SERI}'`);
  if (digerHata || digerOkunamayan) {
    const not = digerHata ?? `${digerOkunamayan} grup çözülemedi`;
    // Bu ağ YALNIZ bilgi amaçlıdır — bayrakla eleme yapılmadıkça aktarımı durdurmamalı.
    if (CAKISANLARI_ATLA) { console.error(`Ön uyarı sorgusu güvenilmez, --cakisanlari-atla uygulanamaz: ${not}`); process.exit(9); }
    console.warn(`Ön uyarı sorgusu güvenilmez (yalnız bilgi amaçlı, aktarım sürüyor): ${not}`);
  }
  const cakisan = kalan.filter(g => digerSayim.has(g.anahtar));
  if (cakisan.length) {
    console.log(`\nUYARI — Mikro'da BAŞKA bir seriyle aynı gün+tutar+yön kaydı olan ${cakisan.length} satır:`);
    for (const g of cakisan.slice(0, 15)) {
      console.log(`   ${g.s.belgeNo} ${g.s.tarih} ${para(g.s.tutar)} TL ${g.s.cariKod} ${g.s.cariAd.slice(0, 28)}`);
    }
    console.log(`   Aynı tarihli bir FATURA da bu kalıba uyabilir — otomatik elenmez.`);
    console.log(`   Dışarıda bırakmak için: --cakisanlari-atla`);
  }

  // 3d) BAKİYE MUTABAKATI — "bu aktarım LUCA ile Mikro'yu buluşturacak mı?"
  const tutmayanCari = new Set<string>();
  if (BAKIYE_YOLU) {
    const beklenenler = bakiyeOku(BAKIYE_YOLU);
    // Sorgulanan küme ile karşılaştırılan küme AYNI olmalı: bakiye dosyasında olup
    // manifestte olmayan cari için "0" uydurmak olmayan bir fark raporlar.
    const bakKodlari = [...new Set([...kodlar, ...beklenenler.map(b => b.cariKod)])];
    const { rows: bakRows, hata: bakHata } = await mikroSql(
      `SELECT cha_kod, SUM(CASE WHEN cha_tip = 0 THEN cha_meblag ELSE -cha_meblag END) AS bakiye ` +
      `FROM CARI_HESAP_HAREKETLERI WHERE cha_kod IN (${inListesi(bakKodlari)}) GROUP BY cha_kod`);
    if (bakHata) { console.error(`Bakiye mutabakatı başarısız: ${bakHata}`); process.exit(9); }
    const sorulan = new Set(bakKodlari.map(k => k.toUpperCase()));
    const mikroBakiye = new Map(bakRows.map(r => [String(r.cha_kod ?? '').trim().toUpperCase(), Number(r.bakiye)]));

    // Beklentiye "Mikro'da ZATEN VAR" sayılan her şeyin etkisi eklenmeli:
    //  (a) önceki koşularda YAZILMIŞ satırlar — yoksa yarım kalmış cariler "tutmuyor"
    //      görünür ve --yalniz-tutan tam da onları kalıcı olarak dışarıda bırakır;
    //  (b) --cakisanlari-atla ile ATLANAN satırlar — bunları atlamamızın SEBEBİ zaten
    //      Mikro'nun eşdeğer kaydı taşıması. 2026-09-23 ölçümü: 10 çakışan satırın 10'u
    //      da Mikro'daki bir FATURAYLA birebir aynı belge no'yu taşıyordu (karşılıklı
    //      fatura mahsubu; ₺582.867,60). Etkilerini saymazsak o cariler hiç tutmaz.
    const sayilanlar = CAKISANLARI_ATLA ? [...yazilmisSatirlar, ...cakisan] : yazilmisSatirlar;
    const yazilmisEtki = new Map<string, number>();
    for (const g of sayilanlar) {
      const k = g.s.cariKod.toUpperCase();
      yazilmisEtki.set(k, (yazilmisEtki.get(k) ?? 0) + bakiyeEtkisi(g.s));
    }

    const tutan: string[] = [], tutmayan: { kod: string; simdi: number; bek: number; fark: number }[] = [], olculemeyen: string[] = [];
    for (const b of beklenenler) {
      const k = b.cariKod.toUpperCase();
      if (!sorulan.has(k)) { olculemeyen.push(b.cariKod); tutmayanCari.add(b.cariKod); continue; }
      const ham = mikroBakiye.get(k);
      // Sorguya DAHİL edilmiş ama satır dönmemişse cari'nin hiç hareketi yok → bakiye
      // GERÇEKTEN 0. Bu bir varsayılan değil ölçüm; sayı olarak gelmeyen değer ayrı durumdur.
      const simdi = ham === undefined ? 0 : ham;
      if (!Number.isFinite(simdi)) { olculemeyen.push(b.cariKod); tutmayanCari.add(b.cariKod); continue; }
      const bek = b.mikroBeklenen + (yazilmisEtki.get(k) ?? 0);
      const fark = simdi - bek;
      if (Math.abs(fark) <= KURUS) tutan.push(b.cariKod);
      else { tutmayan.push({ kod: b.cariKod, simdi, bek, fark }); tutmayanCari.add(b.cariKod); }
    }
    // Bakiye dosyasında HİÇ geçmeyen manifest carisi "tutuyor" sayılmamalı.
    const bakiyeKodlari = new Set(beklenenler.map(b => b.cariKod.toUpperCase()));
    const kapsamDisi = kodlar.filter(k => !bakiyeKodlari.has(k.toUpperCase()));
    for (const k of kapsamDisi) tutmayanCari.add(k);

    console.log(`\nBAKİYE MUTABAKATI (${beklenenler.length} cari)`);
    console.log(`   TUTAN      : ${tutan.length} cari — dekontlar yazılınca Mikro = LUCA olacak`);
    console.log(`   TUTMAYAN   : ${tutmayan.length} cari`);
    if (olculemeyen.length) console.log(`   ÖLÇÜLEMEYEN: ${olculemeyen.length} cari — ${olculemeyen.slice(0, 8).join(', ')}`);
    if (kapsamDisi.length) console.log(`   BAKİYE DOSYASINDA YOK: ${kapsamDisi.length} manifest carisi — ${kapsamDisi.slice(0, 8).join(', ')}`);
    if (tutmayan.length) {
      console.log('\n   cari kod   |    Mikro şimdi |  olması gereken |            fark | ad');
      for (const t of tutmayan.sort((a, b) => Math.abs(b.fark) - Math.abs(a.fark)).slice(0, 25)) {
        const ad = gecerli.find(g => g.s.cariKod.toUpperCase() === t.kod.toUpperCase())?.s.cariAd ?? '';
        console.log(`   ${t.kod.padEnd(10)} | ${para(t.simdi).padStart(14)} | ${para(t.bek).padStart(15)} | ${para(t.fark).padStart(15)} | ${ad.slice(0, 28)}`);
      }
      // DÖNEM AYRIMI — farkın ÖNCEKİ dönemden mi bu dönemden mi geldiğini gösterir.
      // Aktarım yalnız bu dönemi düzeltir; önceki dönemden gelen fark o dönemin
      // muavini gelmeden kapanmaz. İkisini ayırmadan "aktarım işe yaramadı" sanılır.
      const yil = hedefDonemYili(satirlar);
      const sinir = `${yil}0101`;
      const { rows: donemRows, hata: donemHata } = await mikroSql(
        `SELECT cha_kod, ` +
        `SUM(CASE WHEN cha_tarihi <  '${sinir}' THEN (CASE WHEN cha_tip = 0 THEN cha_meblag ELSE -cha_meblag END) ELSE 0 END) AS onceki, ` +
        `SUM(CASE WHEN cha_tarihi >= '${sinir}' THEN (CASE WHEN cha_tip = 0 THEN cha_meblag ELSE -cha_meblag END) ELSE 0 END) AS budonem ` +
        `FROM CARI_HESAP_HAREKETLERI WHERE cha_kod IN (${inListesi(bakKodlari)}) GROUP BY cha_kod`);
      if (donemHata) {
        console.log(`\n   Dönem ayrımı okunamadı (yalnız bilgi amaçlı): ${donemHata}`);
      } else {
        const onceki = new Map<string, number>(), budonem = new Map<string, number>();
        for (const r of donemRows) {
          const k = String(r.cha_kod ?? '').trim().toUpperCase();
          const o = Number(r.onceki), b = Number(r.budonem);
          if (Number.isFinite(o)) onceki.set(k, o);
          if (Number.isFinite(b)) budonem.set(k, b);
        }
        const bakiyeIndeks = new Map(beklenenler.map(b => [b.cariKod.toUpperCase(), b]));
        let farkOnceki = 0, farkBuDonem = 0, olculen = 0;
        console.log(`\n   FARK NEREDEN GELİYOR? (${yil} öncesi / ${yil})`);
        console.log(`   cari kod   |  ${yil} önc. fark |     ${yil} fark | ad`);
        for (const t of tutmayan.sort((a, b) => Math.abs(b.fark) - Math.abs(a.fark)).slice(0, 25)) {
          const k = t.kod.toUpperCase();
          const b = bakiyeIndeks.get(k);
          const mo = onceki.get(k), mb = budonem.get(k);
          if (!b || mo === undefined || mb === undefined || !Number.isFinite(b.lucaOncekiDonem) || !Number.isFinite(b.lucaBuDonemFatura)) {
            console.log(`   ${t.kod.padEnd(10)} |              — |              — | (dönem verisi yok)`);
            continue;
          }
          const fo = mo - b.lucaOncekiDonem, fb = mb - b.lucaBuDonemFatura;
          farkOnceki += fo; farkBuDonem += fb; olculen++;
          const ad = gecerli.find(g => g.s.cariKod.toUpperCase() === k)?.s.cariAd ?? '';
          console.log(`   ${t.kod.padEnd(10)} | ${para(fo).padStart(14)} | ${para(fb).padStart(14)} | ${ad.slice(0, 30)}`);
        }
        if (olculen) {
          console.log(`   ${'TOPLAM'.padEnd(10)} | ${para(farkOnceki).padStart(14)} | ${para(farkBuDonem).padStart(14)} | (${olculen} cari)`);
          console.log(`\n   ${yil} ÖNCESİ farkı bu aktarım KAPATMAZ — o dönemin muavini gerekir.`);
          console.log(`   ${yil} farkı ise Mikro ile LUCA'nın ${yil} FATURALARININ ayrıldığını gösterir.`);
        }
      }
      console.log('\n   Yalnız tutan carileri yazmak için: --yalniz-tutan');
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
  console.log(`Bu koşuda      : ${hedef.length} satır, ${para(toplam)} TL\n`);

  if (!YAZ) {
    console.log('KURU ÇALIŞMA bitti. Mikro\'ya hiçbir kayıt yazılmadı.');
    if (!BAKIYE_YOLU) console.log('Bakiye mutabakatı için:  --bakiye <bakiye-beklenen.json>');
    console.log('Yazmak için:  ... --yaz --adet 1   (önce TEK satır)');
    for (const g of hedef.slice(0, 5)) {
      console.log(`   ÖRNEK ${g.s.belgeNo} | ${g.s.tarih} | ${g.s.yon} | cha_tip ${g.s.chaTip} | ${para(g.s.tutar)} TL | ${g.s.cariKod} ${g.s.cariAd.slice(0, 30)}`);
    }
    return;
  }

  // Çakışma varken bayraksız yazmak, uyarıyı basıp hemen ardından o satırları göndermek olur.
  if (cakisan.length && !CAKISANLARI_ATLA && hedef.some(g => cakisanSet.has(g.s.belgeNo))) {
    console.error(`\nDURDURULDU: ${cakisan.length} satır Mikro'daki mevcut kayıtlarla çakışıyor.`);
    console.error('Yukarıdaki listeyi inceleyin, sonra --cakisanlari-atla ile bu satırları dışarıda bırakın');
    console.error('ya da manifesti düzeltin. Çakışan satırlar gözden geçirilmeden yazılmaz.');
    process.exit(10);
  }
  if (!hedef.length) { console.log('Yazılacak satır yok.'); return; }

  // ── Yazma — satır satır, her sonuç diske ───────────────────────────────────
  const damga = new Date().toISOString().replace(/[:.]/g, '-');
  const logYolu = path.join(path.dirname(manifestYolu!), `luca-aktarim-log-${damga}.jsonl`);
  try {
    // Başlık satırı ilk Mikro çağrısından ÖNCE: disk/izin sorunu varsa hiç yazmadan öğrenelim.
    fs.appendFileSync(logYolu, JSON.stringify({ basladi: new Date().toISOString(), adet: hedef.length, toplam }) + '\n');
  } catch (e) {
    console.error(`Günlük dosyası yazılamıyor (${logYolu}): ${e instanceof Error ? e.message : String(e)}`);
    console.error('Kayıt tutulamayan bir aktarım yapılmaz.'); process.exit(7);
  }
  console.log(`Sonuç günlüğü  : ${logYolu}\n`);

  let basarili = 0, basarisiz = 0;
  let ilkYazilan: ManifestSatiri | null = null;

  for (const [i, g] of hedef.entries()) {
    const t0 = Date.now();
    let ok = false, hataMsg: string | null = null, ham: unknown = null;
    try {
      const { ok: httpOk, data, status } = await mikroPost('DekontKaydetV2', g.payload, true);
      ham = data;
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      // r0 YOKSA başarı DEĞİL: anahtarsız 200 (stub / "Api Server Error") başarı sayılmaz.
      ok = httpOk && !!r0 && !r0.IsError;
      hataMsg = ok ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
    } catch (e) {
      // Ağ hatası BELİRSİZDİR: kayıt Mikro'da oluşmuş olabilir. Otomatik tekrar YOK.
      hataMsg = `[BELİRSİZ-AĞ] ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      fs.appendFileSync(logYolu, JSON.stringify({
        belgeNo: g.s.belgeNo, cariKod: g.s.cariKod, tarih: g.s.tarih, yon: g.s.yon,
        tutar: g.s.tutar, ok, hata: hataMsg, ms: Date.now() - t0, ...(ok ? {} : { yanit: ham }),
      }) + '\n');
    } catch (e) {
      console.error(`Günlük yazılamadı, DURULDU: ${e instanceof Error ? e.message : String(e)}`);
      console.error(`Son işlem: ${g.s.belgeNo} — sonuç ${ok ? 'BAŞARILI' : 'başarısız'}`);
      process.exit(7);
    }

    if (ok) { basarili++; if (!ilkYazilan) ilkYazilan = g.s; console.log(`  ✓ ${i + 1}/${hedef.length} ${g.s.belgeNo} ${para(g.s.tutar)} TL ${g.s.cariKod}`); }
    else {
      basarisiz++;
      console.error(`  ✗ ${i + 1}/${hedef.length} ${g.s.belgeNo} ${g.s.cariKod}: ${hataMsg}`);
      if (!DEVAM) { console.error('\nİLK HATADA DURULDU. Günlüğü inceleyin, düzeltin, aynı komutu tekrar çalıştırın.'); break; }
    }
  }

  // İlk başarılı yazımdan sonra GERİ OKU: Mikro 4 karakterlik 'LUCA' serisini ve belge no'yu
  // gerçekten sakladı mı? Mükerrer korumasının ikisine de dayandığı için ÖLÇÜLÜR, varsayılmaz.
  if (ilkYazilan) {
    const { rows, hata } = await mikroSql(
      `SELECT TOP 5 cha_evrakno_seri, cha_belge_no, cha_tip, cha_meblag ` +
      `FROM CARI_HESAP_HAREKETLERI WHERE cha_kod = '${ilkYazilan.cariKod}' ` +
      `AND CONVERT(varchar(8), cha_tarihi, 112) = '${ilkYazilan.tarih.replace(/-/g, '')}' ` +
      `ORDER BY cha_create_date DESC`);
    console.log('\nGERİ OKUMA (ilk yazılan kaydın Mikro\'daki hâli):');
    if (hata) console.log(`   sorgu başarısız: ${hata}`);
    else if (!rows.length) console.log('   KAYIT BULUNAMADI — yazma başarılı göründü ama kayıt okunamıyor, İNCELEYİN.');
    else {
      for (const r of rows) console.log(`   seri="${String(r.cha_evrakno_seri ?? '')}" belge_no="${String(r.cha_belge_no ?? '')}" tip=${r.cha_tip} meblag=${r.cha_meblag}`);
      const seriVar = rows.some(r => String(r.cha_evrakno_seri ?? '').trim() === SERI);
      const belgeVar = rows.some(r => String(r.cha_belge_no ?? '').trim() === ilkYazilan.belgeNo);
      console.log(`   seri '${SERI}' saklandı: ${seriVar ? 'EVET' : 'HAYIR — mükerrer koruması çalışmaz, DEVAM ETMEYİN'}`);
      console.log(`   belge no saklandı     : ${belgeVar ? 'EVET' : 'HAYIR — koruma yalnız doğal anahtar sayacına dayanır'}`);
    }
  }

  console.log(`\nBitti: ${basarili} yazıldı, ${basarisiz} başarısız.`);
  console.log(`Doğrulama (sunucuda sqlcmd ile):`);
  console.log(`  SELECT COUNT(*) adet, SUM(cha_meblag) toplam FROM CARI_HESAP_HAREKETLERI WHERE cha_evrakno_seri = '${SERI}'`);
  if (basarisiz) process.exitCode = 7;
}

main().catch((e: unknown) => {
  // Ağ arızası en sık görülen hata ve yığın izi hiçbir şey anlatmıyor — ne yapılacağını söyle.
  const neden = (e as { cause?: { code?: unknown } })?.cause?.code;
  const metin = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH/.test(String(neden)) || /fetch failed/i.test(metin)) {
    console.error(`\nMikro API'ye ULAŞILAMIYOR: ${MIKRO_API_BASE}`);
    console.error('Bu betik, Mikro servisinin çalıştığı SUNUCUDA koşturulur (uygulama dizininden).');
    console.error('Mikro servisi ayakta mı ve MIKRO_API_URL doğru mu, kontrol edin.');
    process.exit(2);
  }
  console.error('Beklenmeyen hata:', e);
  process.exit(1);
});
