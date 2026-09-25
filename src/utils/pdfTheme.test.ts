/**
 * pdfTheme.test.ts — PDF bandı / alt bilgi / bilgi kutusu TEK KAYNAK sözleşmesi (Faz 2 3/n, 2026-09-12). ÖNCE YAZILDI.
 *
 * Faz 0: pdfTheme.ts "tek stil kaynağı" ilan etmişti ama pdf.ts'in 4 üreticisi, QuotationDetail, AccountingModule
 * ve OrdersPage fişi kendi bandını/rengini/alt bandını yazıyordu (6 dosyada BRAND/DARK/GREY/LIGHT kopyası, 21 rect).
 * Bu dosya: (1) `pdfBaslik` şablon rengi alır; (2) `pdfAltBilgi` iki modda — düz gri satır (raporlar) ya da renkli
 * 14 mm bant (müşteriye giden belgeler) — HER sayfaya yazar; (3) `pdfBilgiKutusu` müşteri/satıcı kutusu;
 * (4) marka rengi index.css `--color-brand` ile AYNI (iki kaynak sapmasın).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pdfBaslik, pdfAltBilgi, pdfBilgiKutusu, pdfTabloStili, ikincilTon, PDF_RENK, PDF_BANT_YUKSEKLIK } from './pdfTheme';

/** Çağrıları kaydeden sahte jsPDF — A4 (210×297), `sayfa` kadar sayfa. */
function sahteDoc(sayfa = 1) {
  const c: Array<[string, ...unknown[]]> = [];
  const kaydet = (ad: string) => (...a: unknown[]) => { c.push([ad, ...a]); };
  return {
    c, internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    getNumberOfPages: () => sayfa, setPage: kaydet('setPage'),
    setFillColor: kaydet('setFillColor'), rect: kaydet('rect'), roundedRect: kaydet('roundedRect'), addImage: kaydet('addImage'),
    setFont: kaydet('setFont'), setFontSize: kaydet('setFontSize'), setTextColor: kaydet('setTextColor'), text: kaydet('text'),
    splitTextToSize: (t: string) => [t],
  };
}
const metinler = (d: ReturnType<typeof sahteDoc>) => d.c.filter(x => x[0] === 'text').map(x => ({ metin: x[1], x: x[2], y: x[3], opts: x[4] as Record<string, unknown> | undefined }));

describe('pdfBaslik', () => {
  it("varsayılan: marka bandı 32 mm, 'CETPA' + alt başlık solda, belge adı sağda; gövde Y = 38", () => {
    const d = sahteDoc();
    const y = pdfBaslik(d as never, { belgeAdi: 'SİPARİŞ FORMU', meta: 'No: SIP-1 | Tarih: 05.09.2026' });
    expect(y).toBe(PDF_BANT_YUKSEKLIK + 6);
    expect(d.c[0]).toEqual(['setFillColor', ...PDF_RENK.brand]);
    expect(d.c[1]).toEqual(['rect', 0, 0, 210, 32, 'F']);
    const m = metinler(d);
    expect(m[0]).toMatchObject({ metin: 'CETPA', x: 14, y: 15 });
    expect(m[1]).toMatchObject({ metin: 'SATIŞ & LOJİSTİK', x: 14, y: 21 });
    expect(m[2]).toMatchObject({ metin: 'SİPARİŞ FORMU', x: 196, y: 15, opts: { align: 'right' } });
    expect(m[3]).toMatchObject({ metin: 'No: SIP-1 | Tarih: 05.09.2026', y: 26 });
  });
  it("logo verilince 'CETPA' YAZISI yerine gerçek logo, renkli bantta beyaz rozet üstünde (2026-09-25 \"fiş te logo hatalı\")", () => {
    const d = sahteDoc();
    pdfBaslik(d as never, { belgeAdi: 'SİPARİŞ FİŞİ', logo: { dataUrl: 'data:image/png;base64,AAAA', oran: 3 } });
    const resim = d.c.filter(x => x[0] === 'addImage');
    expect(resim).toHaveLength(1);
    expect(resim[0].slice(1, 3)).toEqual(['data:image/png;base64,AAAA', 'PNG']);
    expect(resim[0][5]).toBeCloseTo(27, 5);                              // genişlik = yükseklik (9 mm) × oran
    expect(d.c.some(x => x[0] === 'roundedRect')).toBe(true);           // beyaz zemin
    expect(metinler(d).some(m => m.metin === 'CETPA')).toBe(false);
    expect(metinler(d).find(m => m.metin === 'SATIŞ & LOJİSTİK')?.y).toBeGreaterThan(21);   // rozetin altında
  });
  it("logo: null → bilerek yazı ('CETPA')", () => {
    const d = sahteDoc();
    pdfBaslik(d as never, { belgeAdi: 'X', logo: null });
    expect(d.c.some(x => x[0] === 'addImage')).toBe(false);
    expect(metinler(d)[0]).toMatchObject({ metin: 'CETPA' });
  });
  it('şablon rengi (Belge Tasarımcısı) bandı boyar — marka DEĞİL; meta yoksa 3 metin', () => {
    const d = sahteDoc();
    pdfBaslik(d as never, { belgeAdi: 'FİYAT TEKLİFİ', renk: [0, 122, 255] });
    expect(d.c[0]).toEqual(['setFillColor', 0, 122, 255]);
    expect(metinler(d)).toHaveLength(3);
  });
});

describe('ikincil ton — lacivert/yeşil bantta marka-şeftali yazı OLMAZ (3/n hakemi)', () => {
  it('marka bandında sabit şeftali tonları; başka renkte beyazla karıştırılmış aynı renk', () => {
    expect(ikincilTon(PDF_RENK.brand, 0.75)).toEqual(PDF_RENK.brandSoft);
    expect(ikincilTon(PDF_RENK.brand, 0.85)).toEqual(PDF_RENK.brandMeta);
    expect(ikincilTon([26, 58, 92], 0.75)).toEqual([198, 206, 214]);
    expect(ikincilTon([22, 163, 74], 0.85)).toEqual([220, 241, 228]);
  });
  it('pdfBaslik lacivert bantta alt başlık/meta rengi türetilmiş tondur, brandSoft değil', () => {
    const d = sahteDoc();
    pdfBaslik(d as never, { belgeAdi: 'CARİ EKSTRE', meta: 'x', renk: [26, 58, 92] });
    const renkler = d.c.filter(x => x[0] === 'setTextColor').map(x => x.slice(1));
    expect(renkler).not.toContainEqual([...PDF_RENK.brandSoft]);
    expect(renkler).toContainEqual([198, 206, 214]);
  });
});

describe('pdfAltBilgi — HER sayfaya', () => {
  it("düz mod (raporlar): bant YOK, gri 'CETPA • cetpa.com.tr • Sayfa i / n' sağda; ek not solda", () => {
    const d = sahteDoc(3);
    pdfAltBilgi(d as never, 'Kaynak: Mikro');
    expect(d.c.filter(x => x[0] === 'setPage').map(x => x[1])).toEqual([1, 2, 3]);
    expect(d.c.some(x => x[0] === 'rect')).toBe(false);
    const m = metinler(d);
    expect(m.filter(x => String(x.metin).includes('Sayfa')).map(x => x.metin)).toEqual(['CETPA  •  cetpa.com.tr  •  Sayfa 1 / 3', 'CETPA  •  cetpa.com.tr  •  Sayfa 2 / 3', 'CETPA  •  cetpa.com.tr  •  Sayfa 3 / 3']);
    expect(m.filter(x => x.metin === 'Kaynak: Mikro')).toHaveLength(3);
  });
  it('bant modu (müşteriye giden belge): her sayfada H-14..H renkli bant, sol metin (şablon footer) + sağda sayfa numarası', () => {
    const d = sahteDoc(2);
    pdfAltBilgi(d as never, { bant: [26, 58, 92], solMetin: 'Bu belge elektronik olarak oluşturulmuştur.' });
    const bantlar = d.c.filter(x => x[0] === 'rect');
    expect(bantlar).toHaveLength(2);
    expect(bantlar[0]).toEqual(['rect', 0, 283, 210, 14, 'F']);
    expect(d.c.filter(x => x[0] === 'setFillColor').every(x => x[1] === 26 && x[2] === 58 && x[3] === 92)).toBe(true);
    const m = metinler(d);
    expect(m.filter(x => x.metin === 'Bu belge elektronik olarak oluşturulmuştur.').map(x => x.y)).toEqual([291, 291]);
    expect(m.filter(x => String(x.metin).endsWith('Sayfa 2 / 2'))).toHaveLength(1);
  });
  it('bant modunda uzun sol metin TEK satıra kırpılır (sağdaki sayfa etiketiyle çakışmasın)', () => {
    const d = sahteDoc(1);
    d.splitTextToSize = (t: string) => [t.slice(0, 20), t.slice(20)];
    pdfAltBilgi(d as never, { bant: PDF_RENK.brand, solMetin: 'x'.repeat(40) });
    expect(metinler(d)[0].metin).toBe('x'.repeat(20));
  });
});

describe('pdfBilgiKutusu — müşteri / satıcı kutusu', () => {
  it('açık kutu + renkli başlık + verilen satırlar (y ofsetleri çağıranın); maxWidth geçer', () => {
    const d = sahteDoc();
    pdfBilgiKutusu(d as never, { x: 14, y: 38, w: 87, h: 32, baslik: 'MÜŞTERİ BİLGİLERİ', renk: [0, 122, 255], satirlar: [
      { metin: 'Akdeniz İnşaat', dy: 13, boyut: 9, renk: PDF_RENK.dark },
      { metin: 'Kadıköy, İstanbul', dy: 20, boyut: 8, renk: PDF_RENK.grey, maxWidth: 79 },
    ] });
    expect(d.c[0]).toEqual(['setFillColor', ...PDF_RENK.light]);
    expect(d.c[1]).toEqual(['roundedRect', 14, 38, 87, 32, 2, 2, 'F']);
    const m = metinler(d);
    expect(m[0]).toMatchObject({ metin: 'MÜŞTERİ BİLGİLERİ', x: 18, y: 44 });
    expect(d.c.find(x => x[0] === 'setTextColor')).toEqual(['setTextColor', 0, 122, 255]);
    expect(m[1]).toMatchObject({ metin: 'Akdeniz İnşaat', x: 18, y: 51 });
    expect(m[2]).toMatchObject({ metin: 'Kadıköy, İstanbul', y: 58, opts: { maxWidth: 79 } });
  });
});

describe('tek kaynak değişmezleri', () => {
  it('PDF_RENK.brand = index.css --color-brand (iki kaynak sapmasın)', () => {
    const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf-8');
    const hex = /--color-brand:\s*#([0-9a-fA-F]{6})/.exec(css)?.[1] ?? '';
    expect(hex).not.toBe('');
    expect(PDF_RENK.brand).toEqual([parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]);
  });
  it('pdfTabloStili: Roboto, marka başlık, açık zebra; vurgu rengi geçilebilir', () => {
    expect(pdfTabloStili().headStyles.fillColor).toEqual(PDF_RENK.brand);
    expect(pdfTabloStili([1, 2, 3]).headStyles.fillColor).toEqual([1, 2, 3]);
    expect(pdfTabloStili().styles.font).toBe('Roboto');
  });
});
