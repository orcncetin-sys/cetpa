// yorumKahini.ts — yorum süzgecinin BAĞIMSIZ kâhini (2026-10-08; `mikroImportArkaplan.degismez.test.ts`
// §0d'den taşındı, 2026-09-25'te yazılmıştı).
//
// KÂHİN: TypeScript ayrıştırıcısı, BELİRTEÇ KAPLAMA maskesiyle. Belirteç (token) aralıklarının dışında
// kalan boşluk-dışı her karakter yorumdur; metin / şablon / JSX metni belirteç olduğu için içlerindeki
// açıcılar yorum SAYILMAZ. JSDoc YORUM düğümü atlanır (belirteç değil, yorumdur; etiketleri ve `{tür}` ifadeleri onun çocuğudur).
// Tür konumundaki JSDoc tür düğümleri (`string?`, `?number`, `*`) yorum DEĞİLDİR: içlerine inilir, belirteçleri koddur.
//
// Neden ayrı dosya: `degismezTarayici.ts` `yorumsuz` da ayrıştırıcıya dayanır ama BAŞKA yöntemle (korunan
// değişmez aralıkları + doğrusal açıcı taraması). İki türetim birbirini sınar: depo çiti
// (`degismezTarayici.test.ts`) bütün kaynaklarda ikisinin satır satır aynı kodu verdiğini ölçer. Kâhin
// TEK yerde yaşar — ikinci bir TypeScript kâhini başka bir test dosyasına yazılmaz.
//
// Çıktı `yorumsuz`'la bayt bayt aynı DEĞİLDİR: yorum karakterleri silinmez, BOŞLUĞA çevrilir (satır
// sayısı korunur). Karşılaştırma boşluk hariç yapılır.
//
// Yalnız testler içe aktarır; vitest `.test` / `.spec` topladığı için bu dosya test sayılmaz.
import ts from 'typescript';

const onbellek = new Map<string, readonly string[]>();

/** Yorumları boşluğa çevrilmiş satırlar. `dosyaAdi` ayrıştırma türünü seçer (`.tsx` / `.jsx` → TSX). */
export function kahinSatirlari(dosyaAdi: string, icerik: string): string[] {
  const tsx = /x$/.test(dosyaAdi);
  const anahtar = `${tsx ? 'x' : 't'}\u0000${icerik}`;
  const onceki = onbellek.get(anahtar);
  if (onceki) return [...onceki];
  const sf = ts.createSourceFile(dosyaAdi, icerik, ts.ScriptTarget.Latest, false, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const kod = new Uint8Array(icerik.length);
  // Shebang satırı (`#!…`) belirteç değildir ama yorum da değildir: KOD sayılır (modülün hükmüyle aynı). İçindeki çift
  // eğik çizgi yorum açmaz. Sayılmasaydı shebang'li betikler (scripts/*.mjs) taranınca iki türetim ayrışırdı.
  kod.fill(1, 0, (ts.getShebang(icerik) ?? '').length);
  const gez = (n: ts.Node): void => {
    if (n.kind === ts.SyntaxKind.JSDoc) return;
    if ((n.kind >= ts.SyntaxKind.FirstToken && n.kind <= ts.SyntaxKind.LastToken) || n.kind === ts.SyntaxKind.JsxText) {
      // JSX metni `pos`'tan sayılır: metnin tamamı (baştaki boşluk dâhil) belirteçtir. `getStart` burada
      // KULLANILMAZ — satır başındaki `=======` / `|||||||` satırını birleştirme çakışması imi sayıp metnin
      // kalanını atlar (başlangıç bitişi aşar), bütün JSX metni yorum görünürdü. Ayrıştırıcı o metinde tanı
      // vermez (2026-10-08; `degismezTarayici.test.ts` §1 JsxText fikstürü buldu, depoda örneği yok).
      kod.fill(1, n.kind === ts.SyntaxKind.JsxText ? n.pos : n.getStart(sf), n.getEnd());
      return;
    }
    n.getChildren(sf).forEach(gez);
  };
  gez(sf);
  const karakterler = icerik.split('');
  for (let i = 0; i < karakterler.length; i++) {
    if (!kod[i] && !/\s/.test(karakterler[i])) karakterler[i] = ' ';
  }
  const satirlar = karakterler.join('').split('\n');
  onbellek.set(anahtar, satirlar);
  return [...satirlar];
}
