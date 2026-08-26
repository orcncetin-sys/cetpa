/**
 * `roboto-base64` paketi kendi tip tanimini TASIMIYOR.
 *
 * NEDEN BURADA: `noImplicitAny` acilinca (2026-08-26 tam `strict` gecisi) bu
 * import ortuk `any` oldugu icin hata verdi. `@ts-ignore` ile susturmak, PDF
 * font yukleyicisinin yanlis alan adi kullanmasini (ornegin `roboto.regular`)
 * derleme aninda yakalanamaz hale getirirdi — Turkce karakterli PDF sessizce
 * bozuk font ile basilirdi.
 *
 * Alan adlari CALISMA ANINDA dogrulandi (tahmin degil):
 *   node -e "import('roboto-base64').then(m=>console.log(Object.keys(m.default)))"
 *   -> [ 'normal', 'italics', 'bold', 'bolditalics' ]
 */
declare module 'roboto-base64' {
  /** Her alan base64 kodlanmis TTF govdesi (jsPDF `addFileToVFS` bunu bekler). */
  const roboto: {
    normal: string;
    italics: string;
    bold: string;
    bolditalics: string;
  };
  export default roboto;
}
