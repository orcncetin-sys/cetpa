// degismezTarayici.ts — SERT 1–3 kapanış ölçüsünün PAYLAŞILAN tarayıcısı (2026-09-24, Faz 3 6b) ve
// kaynak çitlerinin ORTAK yorum süzgeci.
//
// Neden var: `rapor6a.degismez.test.ts` bu tarayıcıyı SATIR İÇİ taşıyordu; 6b aynı tarayıcıya ihtiyaç
// duyunca kopyalamak yerine buraya ÇIKARILDI (kök neden 2026-09-04: kopya kod). 6a 2026-10-08'de bu
// modüle bağlandı; satır içi kopya ve onu çitleyen parite testi (rapor6b §0c) kalktı.
//
// YORUM SÜZGECİ 2026-10-08'DE YENİDEN YAZILDI. Eski gövde iki düzenli ifadeydi ve dize, şablon dizesi,
// düzenli ifade değişmezi ile JSX metnini TANIMIYORDU: içlerinde blok açıcı geçince ilk kapatıcıya
// kadar bütün satırları, çift eğik çizgi geçince satırın kalanını SİLİYORDU. Ölçüm (o gün, 426 üretim
// dosyası): 9 dosyada 98 kod satırı çitlere görünmüyordu (JSX `accept` özniteliğindeki tür jokeri,
// CSP'deki joker alt alan, yolu kırpan düzenli ifade). Arıza 2026-09-25'ten beri biliniyor, süzgeç
// «6a gövdesiyle birebir kilitli» sayıldığı için düzeltilmiyor, yalnız tek bir test dosyasında
// kâhinle çitleniyordu. Artık yorum aralıkları TypeScript ayrıştırıcısından alınır. Elle yazılmış
// durum makinesi SEÇİLMEDİ: `.tsx`'te JSX metni kesme işareti taşır («Mikro'ya»); onu dize sınırı
// saymak YENİ kör bölgeler açardı, JSX'i tanımak ise ayrıştırıcı yazmaktır.
//
// SERT desenleri PLAN-v2 §5 ile BİREBİRDİR — "iyileştirme" YOK; desen değişecekse önce PLAN-v2 §5
// değişir (`degismezTarayici.test.ts` §0b desen metnini o listeye kilitler).
//
// Yer: `src/test/` — `src/utils/rapor/` ALTINA KONMAZ: `rapor6a.degismez.test.ts` §2 o dizindeki her
// export için ÜRETİM tüketicisi arar; yalnız testlerin tükettiği bir modül oraya düşerse suite kırmızı
// olur. vitest yalnız `.test`/`.spec` dosyalarını topladığı için bu dosya test olarak toplanmaz.
//
// Saf: `fs` / `path` / vitest içe aktarımı YOK — girdi metindir. Dosya okuma çağıran testtedir.
// Tek dış bağımlılık `typescript` (derleyicinin kendisi; zaten devDependency).
//
// (Bilerek JSDoc değil: yorum açıcı / kapatıcı örnekleri blok yorumun içine yazılamaz.)
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Yorum süzgeci
// ---------------------------------------------------------------------------

// Kabul edilen dosya adı: TypeScript / JavaScript kaynak uzantısı. Uzantı `x` ile bitiyorsa (.tsx, .jsx)
// girdi TSX olarak, değilse TS olarak ayrıştırılır. Tür YANLIŞ seçilirse çıktı sessizce bozulur
// (TS olarak ayrışan JSX metnindeki çift eğik çizgi yorum sayılır; TSX olarak ayrışan `<T>x`
// dönüşümü öğe sayılır) — bu yüzden ad ZORUNLUDUR, varsayılanı yoktur.
const AD_DESENI = /\.(?:[cm]?[jt]s|[jt]sx)$/;
// Dosya ADINDA beklenmeyen, kodda / yorumda sık geçen imler. Tek satırlık bir İÇERİK uzantıyla bitiyorsa («// bkz. a.ts»)
// ad sanılmasın diye: ad ile içerik yer değiştirdiğinde bu imler ayırt eder. (Yol boşluk taşıyabilir — o yasak değil.)
const KOD_IMI = /[;(){}=<>"'`]|\/\/|\/\*/;
// MUTLAK yolda dizin kısmı depo dışından, kullanıcının klasör adından gelir («proje (1)», «Orçun'un Diski», «a=b»): o imler
// meşrudur, denetim yalnız SON yol parçasına uygulanır. Göreli adda eskisi gibi adın tamamına bakılır. `(?![/*])`: «// bkz. a.ts»
// ve «/* a.ts» mutlak yol sayılmaz.
const MUTLAK_YOL = /^(?:\/(?![/*])|[A-Za-z]:[\\/])/;
// Dizin kısmında serbest kalanlar yalnız klasör adında gerçekten görülenlerdir: ( ) ' =. Aşağıdaki imler mutlak yolun HER yerinde
// rettir: düzenli ifadeyle başlayıp «// bkz. src/a.ts» ile biten İÇERİK mutlak yol sanılmasın.
const DIZIN_IMI = /[;{}<>"`]|\/\/|\/\*/;
const sonParca = (ad: string): string => ad.slice(Math.max(ad.lastIndexOf('/'), ad.lastIndexOf('\\')) + 1);

function turSec(dosyaAdi: unknown): ts.ScriptKind {
  if (typeof dosyaAdi !== 'string' || /[\r\n]/.test(dosyaAdi) || !AD_DESENI.test(dosyaAdi)
    || (MUTLAK_YOL.test(dosyaAdi) ? DIZIN_IMI.test(dosyaAdi) || KOD_IMI.test(sonParca(dosyaAdi)) : KOD_IMI.test(dosyaAdi))) {
    const gelen = typeof dosyaAdi === 'string' ? JSON.stringify(dosyaAdi.slice(0, 80)) : typeof dosyaAdi;
    throw new Error(`yorumsuz: ilk bağımsız değişken DOSYA ADI olmalı (uzantı .ts / .tsx / .js / .jsx / .mjs …), gelen ${gelen} — `
      + 'ad ile içerik yer değiştirmiş olabilir (sıra: ad, içerik) ya da ad kod imi taşıyor; fikstür için de ad verilir (ör. "fikstur.tsx")');
  }
  return /x$/.test(dosyaAdi) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

// İçinde yorum açıcıya BENZEYEN metin taşıyabilen belirteçler: bunların aralığında tarama yapılmaz.
// (Ölçüm 2026-10-08, depo + node_modules'taki 19.759 kaynak: metninde açıcı geçen başka belirteç türü yok.)
const KORUNAN: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.JsxText,
]);

const EGIK = 47, YILDIZ = 42;
// TypeScript'in satır sonu kümesi: LF, CR, U+2028, U+2029. Son ikisi KODLA yazılır: kaynağa kaçış
// dizisi ya da ham karakter yazılınca araç katmanı ham karaktere çeviriyor, derleme kırılıyor (ölçüldü).
const satirSonuMu = (c: number): boolean => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;

interface AyristirmaTanisi { kod: number; bas: number; ileti: string }

// Ayrıştırma tanıları `SourceFile.parseDiagnostics` İÇ alanından okunur (genel API değil; `createProgram`
// + `getSyntacticDiagnostics` aynı listeyi 2–3 kat pahalıya verir — ölçüldü; ikisinin paritesi testte).
// Alan yoksa ya da biçimi tanınmıyorsa HER çağrıda fırlatılır: sessizce «tanı yok» saymak katı girişi
// hoşgörülüye çevirirdi. TypeScript sürümü yükseltilirken burası kırılırsa okuyucu güncellenir.
function ayristirmaTanilari(sf: ts.SourceFile): AyristirmaTanisi[] {
  if (!('parseDiagnostics' in sf)) throw new Error('yorumsuz: TypeScript SourceFile.parseDiagnostics alanı yok (sürüm değişti mi?)');
  const ham: unknown = sf.parseDiagnostics;
  if (!Array.isArray(ham)) throw new Error('yorumsuz: SourceFile.parseDiagnostics dizi değil (sürüm değişti mi?)');
  const liste: unknown[] = ham;
  return liste.map((d): AyristirmaTanisi => {
    if (typeof d !== 'object' || d === null || !('code' in d) || typeof d.code !== 'number' || !('start' in d) || typeof d.start !== 'number') {
      throw new Error('yorumsuz: ayrıştırma tanısının biçimi tanınmadı (sürüm değişti mi?)');
    }
    const metin = 'messageText' in d && typeof d.messageText === 'string' ? d.messageText : 'sözdizimi hatası';
    return { kod: d.code, bas: d.start, ileti: metin };
  });
}

type Kip = 'kati' | 'parca';
const onbellek = new Map<string, readonly string[]>();

function suz(kip: Kip, dosyaAdi: string, icerik: string): string[] {
  const tur = turSec(dosyaAdi);
  if (typeof icerik !== 'string') throw new Error(`yorumsuz: içerik dize olmalı (${dosyaAdi})`);
  // Önbellek ZORUNLU (ölçüm: bir çit dosyası aynı kaynağı onlarca testte süzüyor; yoksa 3 sn → 11 sn).
  // Kapsamı test dosyası başınadır (vitest modül yalıtımı). Çağırana KOPYA döner.
  const anahtar = `${kip}\u0000${tur}\u0000${icerik}`;
  const onceki = onbellek.get(anahtar);
  if (onceki) return [...onceki];

  const sf = ts.createSourceFile(dosyaAdi, icerik, ts.ScriptTarget.Latest, false, tur);
  if (kip === 'kati') {
    const tanilar = ayristirmaTanilari(sf);
    if (tanilar.length > 0) {
      const ilk = tanilar[0];
      const satir = sf.getLineAndCharacterOfPosition(ilk.bas).line + 1;
      throw new Error(`yorumsuz: ${dosyaAdi} ayrıştırılamadı — satır ${satir}: TS${ilk.kod} ${ilk.ileti} (toplam ${tanilar.length} tanı). `
        + 'Hata toleranslı ayrıştırma yanlış yorum aralığı üretebilir, o yüzden tam dosya girişi fırlatır. '
        + 'Girdi kod PARÇASI / fikstür ise `yorumsuzParca` kullan; tam dosyaysa uzantı doğru mu (.ts ↔ .tsx)?');
    }
  }

  const korunan: Array<[number, number]> = [];
  const gez = (n: ts.Node): void => {
    if (KORUNAN.has(n.kind)) {
      // JsxText baştaki boşluğu da kapsar (pos = başlangıç); diğerlerinde pos önceki boşluk / yorumu içerir.
      korunan.push([n.kind === ts.SyntaxKind.JsxText ? n.pos : n.getStart(sf), n.end]);
      return;
    }
    // Parça kipinde hata kurtarma bir belirteci ağaçtan ATABİLİR (ör. parametre konumuna düşen dize: bağlamsız okunan
    // `href={f('https://x')}` nesne değişmezi yöntemi sayılır). `forEachChild` atılan belirteci görmez, içindeki açıcı yorum
    // sanılır ve satırın kalanı silinirdi. `getChildren` düğümler arasını yeniden tarar, atılanı da verir. Katı kipte tanı
    // yokken atılan belirteç olmaz; orada `forEachChild` kalır (kâhinden bağımsız ikinci türetim).
    // SINIR: atılan belirteç İKAMELİ şablonun başıysa kuyruğu hiç belirteç olmaz, kurtarılamaz (test §8); fikstürde ikameli
    // şablon geçerli bir ifadenin içine yazılır.
    if (kip === 'parca') {
      for (const c of n.getChildren(sf)) if (c.kind !== ts.SyntaxKind.JSDoc) gez(c);
    } else ts.forEachChild(n, gez);
  };
  gez(sf);
  korunan.sort((a, b) => a[0] - b[0]);

  const N = icerik.length;
  let cikti = '';
  let i = (ts.getShebang(icerik) ?? '').length;   // `#!…` satırı kod sayılır; içindeki çift eğik çizgi yorum değildir
  let son = 0;
  let k = 0;
  while (i < N) {
    while (k < korunan.length && korunan[k][1] <= i) k++;
    if (k < korunan.length && korunan[k][0] <= i) { i = korunan[k][1]; continue; }
    if (icerik.charCodeAt(i) === EGIK) {
      const c = icerik.charCodeAt(i + 1);
      if (c === EGIK) {
        let j = i + 2;
        while (j < N && !satirSonuMu(icerik.charCodeAt(j))) j++;
        cikti += icerik.slice(son, i);            // satır sonu karakteri çıktıda KALIR
        son = i = j;
        continue;
      }
      if (c === YILDIZ) {
        const kapanis = icerik.indexOf('*/', i + 2);   // açılıştan 2 karakter SONRA: `/*/ x */` tek yorumdur
        const j = kapanis < 0 ? N : kapanis + 2;
        cikti += icerik.slice(son, i) + icerik.slice(i, j).replace(/[^\n]/g, '');   // satır numarası korunur
        son = i = j;
        continue;
      }
    }
    i++;
  }
  const satirlar = (cikti + icerik.slice(son)).split('\n');
  onbellek.set(anahtar, satirlar);
  return [...satirlar];
}

// yorumsuz(): TAM DOSYA girişi. Yorumları atar, SATIR NUMARASINI korur — blok yorum (JSX süslü-yorumu
// dâhil) yalnız satır sonlarını bırakır, satır yorumu satır sonuna kadar silinir, kalan metin bayt
// bayt aynıdır. Girdi ayrıştırılamıyorsa FIRLATIR.
export function yorumsuz(dosyaAdi: string, icerik: string): string[] {
  return suz('kati', dosyaAdi, icerik);
}

// yorumsuzParca(): FİKSTÜR / kod parçası girişi (SQL parçası, açık blok, tek özellik satırı gibi kendi
// başına geçerli olmayan girdi). Ayrıştırma tanısına bakmaz. DOSYA içeriği buna VERİLMEZ — tam dosyada
// sözdizimi hatası ya da yanlış uzantı sessiz kör bölge demektir (çit: degismezTarayici.test.ts).
export function yorumsuzParca(dosyaAdi: string, icerik: string): string[] {
  return suz('parca', dosyaAdi, icerik);
}

export type Sinif = 'S1' | 'S2' | 'S3';
export const SINIFLAR: readonly Sinif[] = ['S1', 'S2', 'S3'];

// Desenler PLAN-v2 §5 SERT 1–3 ile BİREBİR (kopya; "iyileştirme" yok).
// SERT 4 (`.total === 'number'`, `.stock`, `itemCostTRY(`) bu tarayıcıya GİRMEZ — 6d/6h'nin işi.
export const SERT_DESENLERI: Readonly<Record<Sinif, readonly RegExp[]>> = {
  S1: [/(\|\||\?\?)\s*0\b/],
  S2: [/Math\.max\([^;]*,\s*1\)/, /Math\.max\(\s*[234]\s*,/, /Math\.max\([^;]*,\s*[234]\)/],
  S3: [/(\?\?|\|\|)\s*(1|5|999)\b/, /\*\s*0\.6\b/, /Number\(e\.target\.value\)/],
};

export interface Ihlal { dosya: string; satir: number; sinif: Sinif; kod: string }

// Satır × sınıf başına EN ÇOK bir kayıt; aynı satır birden çok sınıfa takılırsa her sınıf için ayrı kayıt
// (döngü `break`'lemez — `degismezTarayici.test.ts` §0 vaka 9 bunu sınar).
// `dosya` yalnız ileti etiketi DEĞİLDİR: ayrıştırma türünü de seçer (JSX içeren girdi `.tsx` adıyla verilir).
export function sertIhlalleri(dosya: string, icerik: string): Ihlal[] {
  const bulgular: Ihlal[] = [];
  yorumsuz(dosya, icerik).forEach((kod, i) => {
    for (const sinif of SINIFLAR) {
      if (SERT_DESENLERI[sinif].some(desen => desen.test(kod))) bulgular.push({ dosya, satir: i + 1, sinif, kod });
    }
  });
  return bulgular;
}

// Hata mesajı biçimi 6a ile aynı: `dosya:satır kod` — sayıya indirgenmez, hakem kaçırılan siteyi görür.
export function ihlalYaz(i: Ihlal): string {
  return `${i.dosya}:${i.satir} ${i.kod.trim().slice(0, 140)}`;
}
