// degismezTarayici.ts — SERT 1–3 kapanış ölçüsünün PAYLAŞILAN tarayıcısı (2026-09-24, Faz 3 6b).
//
// Neden var: `rapor6a.degismez.test.ts` (:33-62) bu tarayıcıyı SATIR İÇİ taşıyordu. 6b'nin kapanış
// ölçüsü (`rapor6b.degismez.test.ts`) aynı tarayıcıya ihtiyaç duyar; kopyalamak yerine buraya ÇIKARILDI
// (kök neden 2026-09-04: kopya kod). Gövdeler 6a'dakiyle BİREBİR — "iyileştirme" YOK; desen değişecekse
// önce PLAN-v2 §5 değişir (`degismezTarayici.test.ts` §0b desen metnini o listeye kilitler).
//
// Yer: `src/test/` — `src/utils/rapor/` ALTINA KONMAZ: `rapor6a.degismez.test.ts` §2 o dizindeki her
// export için ÜRETİM tüketicisi arar; yalnız testlerin tükettiği bir modül oraya düşerse suite kırmızı
// olur. vitest yalnız `.test`/`.spec` dosyalarını topladığı için bu dosya test olarak toplanmaz.
//
// Saf: `fs` / `path` / vitest içe aktarımı YOK — girdi metindir. Dosya okuma çağıran testtedir.
//
// Parite: `rapor6a.degismez.test.ts` DÜZENLENMEDİ (6a'nın dosyası); satır içi kopyası geçici olarak
// yaşamaya devam eder ve `rapor6b.degismez.test.ts` §0c iki kopyanın ayrışmadığını çitler. 6a'yı da bu
// modüle bağlamak ORKESTRATÖRÜN kararıdır (en geç 6m).
//
// (Bilerek JSDoc değil: aşağıdaki `yorumsuz` blok-yorum deseni açıklamada yazılamaz — kapatıcıyı içerir.)

// yorumsuz(): yorumları atar, SATIR NUMARASINI korur — blok yorumu ve JSX süslü-yorumu
// boş satırlara iner, satır sonu `// …` kesilir, `https://` KESİLMEZ (öncesinde `:` var).
// (Bilerek JSDoc değil: içine yorum kapatıcı yazılamayacağı için açıklama sakatlanırdı.)
export function yorumsuz(icerik: string): string[] {
  return icerik
    .replace(/\/\*[\s\S]*?\*\//g, blok => blok.replace(/[^\n]/g, ''))
    .split('\n')
    .map(satir => satir.replace(/(^|[^:])\/\/.*$/, '$1'));
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
export function sertIhlalleri(dosya: string, icerik: string): Ihlal[] {
  const bulgular: Ihlal[] = [];
  yorumsuz(icerik).forEach((kod, i) => {
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
