/**
 * belgeSablonu.ts — Belge Tasarımcısı şablonlarının TEK KAYNAĞI.
 *
 * NEDEN VAR (2026-09-04, çok-ajanlı keşif, 23 doğrulanmış bulgu):
 * `documentTemplates` koleksiyonu KAPALI DEVREYDİ — yalnız DocumentDesigner
 * kendi içinde yazıp okuyordu, PDF üreten hiçbir dosya tüketmiyordu. Kullanıcı
 * başlık/renk/alt bilgi ayarlıyor, kaydediyor, ürettiği PDF hiç değişmiyordu
 * ("yazıldı ama bağlanmadı" arıza sınıfı).
 *
 * Tip ve varsayılanlar buraya taşındı ki hem tasarımcı ekranı hem PDF
 * üreticileri AYNI kaynaktan beslensin — aksi hâlde bağlama "yarım düzeltme"
 * olurdu (bir yüzey şablonu okur, diğeri sabitini basmayı sürdürür).
 */
import { doc, getDoc } from '../lib/dbClient';
import { db } from '../firebase';

export interface DocTemplate {
  id: string;
  docType: string;
  title: string;
  /** HEX renk (#rrggbb). CSS değişkeni DEĞİL — aşağıdaki uyarıya bak. */
  color: string;
  footer: string;
  bankDetails: string;
  showBankDetails: boolean;
  vatRate: number;
  updatedAt?: unknown;
}

export type BelgeTipi = 'fatura' | 'teklif' | 'irsaliye' | 'siparis' | 'makbuz';

export const VARSAYILAN_BASLIK: Record<BelgeTipi, string> = {
  fatura:   'SATIŞ FATURASI',
  teklif:   'FİYAT TEKLİFİ',
  irsaliye: 'SEVK İRSALİYESİ',
  siparis:  'SİPARİŞ FORMU',
  makbuz:   'TAHSİLAT MAKBUZU',
};

/**
 * ŞABLONUN GERÇEKTEN UYGULANDIĞI YER — dürüstlük kaynağı.
 *
 * 2026-09-04 ölçümü: tasarımcı 5 belge tipi sunuyor ama üçünün karşılığı
 * kod tabanında YOK. Kullanıcının "Fatura" sekmesinde yaptığı ayar hiçbir
 * çıktıyı etkilemiyor; bunu ekranda söylemek yerine sessiz bırakmak, tam da
 * bu modülün düzeltmek için var olduğu arızayı sürdürmek olurdu.
 *
 *   fatura   → YOK. AccountingModule'ün ürettiği PDF "KDV BEYANNAMESİ ÖZETİ",
 *              fatura değil. Fatura PDF'i hiç üretilmiyor.
 *   irsaliye → YOK. İrsaliye %100 Mikro'ya devrediliyor (App.tsx), Cetpa
 *              tarafında PDF üretilmiyor.
 *   makbuz   → YOK. Var olan `exportGoodsReceiptPDF` "TESLİM MAKBUZU" basıyor;
 *              o bir SATINALMA teslim-alma belgesi, tahsilat makbuzu DEĞİL.
 *              Tahsilat tarafı (TahsilatModule) yalnız makbuz FOTOĞRAFI
 *              yüklüyor, PDF üretmiyor. Yanlış eşleme yapılsaydı tedarikçiye
 *              giden belgenin tepesine "TAHSİLAT MAKBUZU" ve kullanıcının
 *              banka bilgisi basılırdı — ticari olarak yanlış belge.
 */
export const SABLON_UYGULANIYOR: Record<BelgeTipi, string | null> = {
  fatura:   null,
  teklif:   'Teklif PDF (Teklif Detayı ve B2B Portalı → PDF İndir)',
  irsaliye: null,
  siparis:  'Sipariş fişi PDF (Siparişler → Fiş Yazdır)',
  makbuz:   null,
};

export const varsayilanSablon = (docType: string): DocTemplate => ({
  id: docType,
  docType,
  title: VARSAYILAN_BASLIK[docType as BelgeTipi] ?? docType.toUpperCase(),
  // ⚠️ HEX OLMAK ZORUNDA. Eskiden burada 'var(--color-brand)' yazıyordu ve
  // aynen veritabanına gidiyordu; jsPDF'in `setFillColor`'ı bir CSS değişkenini
  // çözemez. Şablon PDF'e bağlandığı ilk anda başlık bandı bozulacaktı —
  // bağlamanın sessizce çökeceği nokta tam burasıydı (2026-09-04 keşfi).
  color: '#ff4000',   // index.css --color-brand ile aynı; BRAND_COLORS[0]
  footer: 'Bizi tercih ettiğiniz için teşekkürler.',
  // ⚠️ BOŞ. Eskiden varsayılan 'TR00 0000 0000 0000 0000 0000 00' + showBankDetails:true idi.
  // Şablon PDF'e bağlandığı anda müşteriye giden belgeye UYDURMA bir IBAN
  // basılacaktı — projenin "sahte kesinlik gösterme" yasağının tam ihlali.
  // Gerçek IBAN'ı kullanıcı girer; girmediyse blok hiç basılmaz.
  bankDetails: '',
  showBankDetails: false,
  vatRate: 20,
});

/**
 * PDF üreticilerin şablonu okuduğu tek yol.
 *
 * ZAMAN AŞIMI ŞART: `dbClient`'ın fetch'inde AbortController yok. Sunucu TCP'yi
 * kabul edip yanıt üretmezse (bu projede yaşanmış kesinti sınıfı — 2026-08-24,
 * TLS el sıkışıyor ama TTFB gelmiyor) promise hiç settle olmaz, catch çalışmaz
 * ve PDF SÜRESİZ asılı kalır: kullanıcı butona basar, dosya inmez, hata da
 * çıkmaz. Şablon süslemedir; onun için belgeyi bekletmeyiz.
 */
const SABLON_ZAMAN_ASIMI_MS = 4000;

export async function sablonGetir(docType: BelgeTipi): Promise<DocTemplate | null> {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, 'documentTemplates', docType)),
      new Promise<never>((_, red) =>
        setTimeout(() => red(new Error(`şablon okuma ${SABLON_ZAMAN_ASIMI_MS}ms içinde yanıtlamadı`)),
          SABLON_ZAMAN_ASIMI_MS)),
    ]);
    if (!snap.exists()) return null;
    return { id: docType, ...(snap.data() as Omit<DocTemplate, 'id'>) };
  } catch (e) {
    // PDF üretimi şablon yüzünden ÇÖKMEMELİ: çevrimdışı, 403 ya da koleksiyon
    // hazır değilken çağıran taraf varsayılanına düşer (sessiz bozulma yok,
    // görünür uyarı var).
    console.warn(`[belgeSablonu] '${docType}' şablonu okunamadı, varsayılan kullanılıyor:`, e);
    return null;
  }
}

export type RGB = [number, number, number];

/**
 * '#rrggbb' → [r,g,b]. Ayrıştıramazsa `null` döner — çağıran taraf kendi
 * marka rengine düşer. UYDURMA RENK ÜRETMEZ: geçersiz değerde 0,0,0 dönmek
 * belgeyi sessizce siyah başlıkla bastırırdı.
 *
 * `null` dönmesinin en olası sebebi, bu modülden önce kaydedilmiş ve içinde
 * 'var(--color-brand)' tutan eski şablon kayıtlarıdır.
 */
export function hexToRgb(hex: string | undefined | null): RGB | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Şablonun rengi — geçersiz/eksikse marka kırmızısı. */
export function sablonRengi(sablon: DocTemplate | null): RGB {
  return hexToRgb(sablon?.color) ?? [255, 64, 0];
}

/**
 * Banka bilgisi basılmalı mı? `null` = basma.
 *
 * Üç eleme yapar:
 *  1. `showBankDetails` kapalıysa basma.
 *  2. Metin boşsa basma.
 *  3. YER TUTUCU IBAN'ı basma. Bu modülden önceki varsayılan
 *     'TR00 0000 0000 0000 0000 0000 00' + `showBankDetails: true` idi; o
 *     dönemde kaydedilmiş şablonlarda bu sahte değer hâlâ duruyor olabilir.
 *     Yalnız varsayılanı düzeltmek onları temizlemez — müşteriye giden belgeye
 *     uydurma hesap numarası basmak, projenin "sahte kesinlik gösterme"
 *     yasağının en pahalı ihlali olurdu.
 */
export function bankaBilgisiBasilir(sablon: DocTemplate | null): string | null {
  if (!sablon?.showBankDetails) return null;
  const t = sablon.bankDetails?.trim();
  if (!t) return null;
  // Rakamlarının tamamı 0 olan bir IBAN gerçek olamaz.
  const rakamlar = t.replace(/\D/g, '');
  if (rakamlar.length > 0 && /^0+$/.test(rakamlar)) return null;
  return t;
}


/**
 * Banka bilgisi + şablon alt bilgisini çizer. ÜÇ PDF YÜZEYİ DE BUNU KULLANIR.
 *
 * NEDEN ORTAK (2026-09-04 push incelemesi, 3/3 hakem CONFIRMED):
 * Aynı blok üç yüzeye ELLE üç farklı şekilde yazılmıştı ve üçü de bozuktu:
 *   - Sipariş fişi: `altY505` birikimli akıyordu, sayfa sonu denetimi yoktu →
 *     20 kalemli siparişte IBAN A4'ün altına taşıp SESSİZCE kayboluyordu
 *     (ölçüldü: son satır y≈305, sayfa 297mm).
 *   - Sipariş/teklif PDF'i: sayfa altına SABİT konumlanıyordu (`H - 20 - ...`),
 *     tablonun nerede bittiğine bakmıyordu → uzun tabloda tablo satırlarının
 *     ve GENEL TOPLAM kutusunun ÜZERİNE biniyordu.
 * Yani "yarım düzeltme"nin ders kitabı örneğiydi. Tek yardımcı, tek davranış:
 * bloğu tablonun bittiği yerden aşağı yerleştirir, sığmıyorsa YENİ SAYFA açar.
 *
 * @param baslangicY  içeriğin (tablo/toplam kutusu) bittiği Y — bunun altına yazar
 * @returns bloğun bittiği Y (çağıran devam edebilir)
 */
export function belgeAltBilgisiCiz(
  doc: jsPDFBenzeri,
  opts: {
    baslangicY: number;
    banka: string | null;
    footer?: string | null;
    genislik?: number;
    etiket?: string;
    renk?: RGB;
  },
): number {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const ALT_BANT = 20;              // alt bant + güvenlik payı
  const sarmaGenisligi = opts.genislik ?? W - 28;

  const satirlar = opts.banka ? (doc.splitTextToSize(opts.banka, sarmaGenisligi) as string[]) : [];
  const footerVar = !!opts.footer?.trim();
  if (!satirlar.length && !footerVar) return opts.baslangicY;

  // Gerekli yükseklik: başlık(4) + satırlar + footer(6)
  const gerekli = (satirlar.length ? 4 + satirlar.length * 3.6 + 3 : 0) + (footerVar ? 6 : 0);
  let y = opts.baslangicY + 6;

  // SIĞMIYORSA YENİ SAYFA — eskiden bu kontrol hiçbir yüzeyde yoktu.
  if (y + gerekli > H - ALT_BANT) {
    doc.addPage();
    y = 24;
  }

  if (satirlar.length) {
    doc.setFontSize(7);
    doc.setFont('Roboto', 'bold');
    doc.setTextColor(...(opts.renk ?? [134, 134, 139]));
    doc.text(opts.etiket ?? 'BANKA BİLGİLERİ', 14, y);
    doc.setFont('Roboto', 'normal');
    doc.setTextColor(29, 29, 31);
    doc.text(satirlar, 14, y + 4);
    y += 4 + satirlar.length * 3.6 + 3;
  }

  if (footerVar) {
    doc.setFontSize(7.5);
    doc.setFont('Roboto', 'normal');
    doc.setTextColor(134, 134, 139);
    doc.text(opts.footer!.trim(), 14, y);
    y += 6;
  }

  return y;
}

/** `belgeAltBilgisiCiz`in ihtiyaç duyduğu jsPDF yüzeyi (jspdf'i bu modüle import etmemek için). */
interface jsPDFBenzeri {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  splitTextToSize(text: string, maxWidth: number): string | string[];
  setFontSize(n: number): void;
  setFont(font: string, style?: string): void;
  setTextColor(r: number, g: number, b: number): void;
  text(text: string | string[], x: number, y: number, opts?: unknown): void;
  addPage(): void;
}
