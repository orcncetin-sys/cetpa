/**
 * belgeSablonu.test.ts — PDF alt bilgi YERLEŞİMİ (Faz 1 2/n, 2026-09-05).
 *
 * `belgeAltBilgisiCiz` üç PDF yüzeyinin (sipariş/teklif PDF, teklif detayı,
 * sipariş fişi) ortak alt bilgi çizicisi. Ortaya çıkma sebebi: aynı blok üç
 * yüzeye elle üç farklı şekilde yazılmıştı ve üçü de bozuktu — birinde 20
 * kalemli siparişte IBAN A4'ün altına taşıp SESSİZCE kayboluyordu (inceleme
 * ölçtü: son satır y≈305, sayfa 297 mm), ikisinde sayfa altına sabitlenip
 * GENEL TOPLAM kutusunun üstüne biniyordu. Bu dosya o iki arızayı kilitler:
 *   A) birim: sahte doc ile yerleşim aritmetiği (sığar / sığmaz / boş)
 *   B) entegrasyon: GERÇEK jsPDF + autoTable ile 20 kalemli tablo → yeni sayfa
 */
import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { belgeAltBilgisiCiz, bankaBilgisiBasilir, hexToRgb } from './belgeSablonu';
import { registerTurkishFont } from './pdfFont';

const IBAN_3_SATIR = 'Ziraat Bankası Kadıköy Şubesi — CETPA A.Ş. — TR33 0006 1005 1978 6457 8413 26 — SWIFT TCZBTR2A';

/** Çağrıları kaydeden sahte jsPDF — A4 (210×297), splitTextToSize satır sayısını `satirSayisi` ile taklit eder. */
function sahteDoc(satirSayisi = 1) {
  const cagrilar: string[] = [];
  const metinler: Array<{ y: number; metin: string | string[] }> = [];
  return {
    cagrilar, metinler,
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    splitTextToSize: (t: string) => Array.from({ length: satirSayisi }, (_, i) => `${t}#${i}`),
    setFontSize: () => { cagrilar.push('setFontSize'); },
    setFont: () => { cagrilar.push('setFont'); },
    setTextColor: () => { cagrilar.push('setTextColor'); },
    text: (metin: string | string[], _x: number, y: number) => { cagrilar.push('text'); metinler.push({ y, metin }); },
    addPage: () => { cagrilar.push('addPage'); },
  };
}

describe('A) belgeAltBilgisiCiz — yerleşim aritmetiği (sahte doc)', () => {
  it('banka da footer da yoksa HİÇBİR ŞEY çizmez, başlangıç Y aynen döner', () => {
    const d = sahteDoc();
    expect(belgeAltBilgisiCiz(d, { baslangicY: 100, banka: null })).toBe(100);
    expect(belgeAltBilgisiCiz(d, { baslangicY: 100, banka: '', footer: '   ' })).toBe(100);
    expect(d.cagrilar).toEqual([]);
  });

  it('sığıyorsa aynı sayfada: etiket başlangıç+6, satırlar +4, dönen Y = etiket + 4 + n×3.6 + 3', () => {
    const d = sahteDoc(1);
    const son = belgeAltBilgisiCiz(d, { baslangicY: 100, banka: 'TR33 0006' });
    expect(d.cagrilar).not.toContain('addPage');
    expect(d.metinler[0]).toMatchObject({ y: 106, metin: 'BANKA BİLGİLERİ' });
    expect(d.metinler[1].y).toBe(110);
    expect(son).toBeCloseTo(106 + 4 + 3.6 + 3, 5);
  });

  it('SIĞMIYORSA yeni sayfa açar ve Y=24\'ten yazar — eskiden sayfa dışına taşıp kayboluyordu', () => {
    const d = sahteDoc(3);                                   // gerekli = 4 + 10.8 + 3 = 17.8
    const son = belgeAltBilgisiCiz(d, { baslangicY: 270, banka: IBAN_3_SATIR });   // 276 + 17.8 > 277
    expect(d.cagrilar).toContain('addPage');
    expect(d.metinler[0].y).toBe(24);
    expect(son).toBeLessThan(297 - 20);
  });

  it('tam sınırda (y + gerekli === H − 20) yeni sayfa AÇMAZ (> değil ≥)', () => {
    const d = sahteDoc(1);                                   // gerekli = 10.6 → y=266.4 → 277 tam sınır
    belgeAltBilgisiCiz(d, { baslangicY: 260.4, banka: 'X' });
    expect(d.cagrilar).not.toContain('addPage');
  });

  it('yalnız footer: banka bloğu yok, footer başlangıç+6, dönen Y +6', () => {
    const d = sahteDoc();
    const son = belgeAltBilgisiCiz(d, { baslangicY: 100, banka: null, footer: 'Bizi tercih ettiğiniz için teşekkürler.' });
    expect(d.metinler).toHaveLength(1);
    expect(d.metinler[0]).toMatchObject({ y: 106 });
    expect(son).toBe(112);
  });

  it('etiket özelleştirilebilir (sipariş fişi EN modda "BANK DETAILS" geçiyor)', () => {
    const d = sahteDoc(1);
    belgeAltBilgisiCiz(d, { baslangicY: 50, banka: 'X', etiket: 'BANK DETAILS' });
    expect(d.metinler[0].metin).toBe('BANK DETAILS');
  });

  it('sahte IBAN (tüm rakamlar 0) bankaBilgisiBasilir\'dan null gelir → blok çizilmez (müşteriye uydurma hesap gitmez)', () => {
    const d = sahteDoc(1);
    const banka = bankaBilgisiBasilir({ id: 'x', docType: 'x', title: '', color: '', footer: '', bankDetails: 'TR00 0000 0000 0000 0000 0000 00', showBankDetails: true, vatRate: 20 });
    expect(banka).toBeNull();
    expect(belgeAltBilgisiCiz(d, { baslangicY: 100, banka })).toBe(100);
  });
});

describe('B) GERÇEK jsPDF — 20 kalemli sipariş fişi taşma regresyonu', () => {
  /** OrdersPage sipariş fişine BENZER tablo parametreleri (startY 58, 9pt, cellPadding 3, margin yok). */
  async function fisUret(kalem: number) {
    const doc = new jsPDF({ format: 'a4', unit: 'mm' });
    await registerTurkishFont(doc);
    expect(doc.getFontList().Roboto, 'Roboto yüklenmedi — Türkçe glif ölçümü anlamsız').toEqual(expect.arrayContaining(['normal', 'bold']));
    autoTable(doc, {
      startY: 58,
      head: [['Ürün', 'SKU', 'Adet', 'Birim Fiyat', 'Toplam']],
      body: Array.from({ length: kalem }, (_, i) => [`Çimento ${i + 1}`, `CMT-${i}`, '10', '₺1.250,00', '₺12.500,00']),
      styles: { font: 'Roboto', fontSize: 9, cellPadding: 3 },
    });
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    const sayfaOnce = doc.getNumberOfPages();
    // Tablo çizildikten SONRA text'i dinle: bloğun GERÇEKTEN yazdığı her satırın Y'si ölçülür.
    // (Sayfa sayısına bakmak kırılgandı: font metriği değişip tablo 2. sayfaya taşarsa
    // blok orada sığar ve "yeni sayfa açıldı" beklentisi yanlış sebeple düşerdi.)
    const yazilanY: number[] = [];
    const gercekText = doc.text.bind(doc);
    doc.text = ((...a: Parameters<jsPDF['text']>) => { yazilanY.push(a[2]); return gercekText(...a); }) as jsPDF['text'];
    const son = belgeAltBilgisiCiz(doc, { baslangicY: finalY + 12, banka: IBAN_3_SATIR, footer: 'Bizi tercih ettiğiniz için teşekkürler.' });
    return { doc, finalY, sayfaOnce, sayfaSonra: doc.getNumberOfPages(), son, yazilanY };
  }

  it('5 kalem: tek sayfa, blok sayfa içinde biter', async () => {
    const r = await fisUret(5);
    expect(r.sayfaOnce).toBe(1);
    expect(r.sayfaSonra).toBe(1);
    expect(r.yazilanY.length).toBeGreaterThan(0);
    expect(Math.max(...r.yazilanY)).toBeLessThan(297 - 20);
    expect(r.son).toBeLessThan(297 - 20);
  });

  it('20 kalem: tablo sayfa sonuna dayanır → blok sayfa dışına YAZILMAZ (her satırın Y\'si < 277 mm)', async () => {
    const r = await fisUret(20);
    // İnceleme ölçümü: 20 kalemde finalY ≈ 270; eski kod bloğu y≈305'e (sayfa dışı) basıyordu.
    expect(r.finalY).toBeGreaterThan(240);
    expect(r.yazilanY.length).toBeGreaterThanOrEqual(3);            // etiket + IBAN satırları + footer
    expect(Math.max(...r.yazilanY)).toBeLessThan(297 - 20);          // asıl iddia — sayfa sayısından bağımsız
    expect(r.sayfaSonra).toBeGreaterThanOrEqual(r.sayfaOnce);        // yeni sayfa açılmış da olabilir, zaten 2'de de olabilir
    expect(r.son).toBeLessThan(297 - 20);
    expect(r.doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });
});

describe('hexToRgb — şablon rengi PDF\'e güvenle gider', () => {
  it("CSS değişkeni ('var(--color-brand)') null → çağıran marka rengine düşer, siyah basmaz", () => {
    expect(hexToRgb('var(--color-brand)')).toBeNull();
    expect(hexToRgb('#ff4000')).toEqual([255, 64, 0]);
    expect(hexToRgb('FF4000')).toEqual([255, 64, 0]);
    expect(hexToRgb('#fff')).toBeNull();
  });
});
