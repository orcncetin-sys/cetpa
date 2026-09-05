/**
 * pdf.test.ts — exportOrderPDF UÇTAN UCA (Faz 1 2/n, 2026-09-05).
 *
 * Gerçek jsPDF + autoTable + Roboto ile belge üretilir; `doc.save` prototipte
 * susturulur (jsdom'da indirme yok), `doc.text` çağrıları dinlenerek belgeye
 * NE BASILDIĞI ölçülür. Kilitlenen arızalar (Belge Tasarımcısı incelemesi):
 *  - B2B portalı bu fonksiyona TEKLİF gönderiyordu ama başlık "SİPARİŞ / FATURA",
 *    "Takip No: -" ve teklifte olmayan "Durum" basılıyordu.
 *  - Tutarlar SABİT "TL" ile basılıyordu — EUR teklif "12.500,00 TL" çıkıyordu.
 *  - Teklif numarası sipariş yardımcısından türetilip QuotationDetail'inkinden
 *    FARKLI çıkıyordu (müşteri numarayla arayınca kayıt bulunamıyordu).
 * `sablonGetir` mock'lanır: gerçek sürüm ağa gider ve 4 sn zaman aşımı bekler.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { jsPDF } from 'jspdf';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * jsPDF'te `text`/`save` PROTOTİPTE DEĞİL, örnek üzerinde tanımlı; exportOrderPDF örneği
 * içeride ürettiği için prototip spy'ı tutmaz; jspdf modülünü mock'layıp constructor'ı
 * sarmak ise jspdf-autotable'ın plugin kaydını koparıyor. jsPDF'in RESMİ plugin
 * mekanizması kullanılır: `jsPDF.API.events` 'initialized' olayı her yeni örnekte, bütün
 * metodlar tanımlandıktan sonra tetiklenir — örneğin metodları orada sarılır.
 */
const kayit = { basilan: [] as string[], kaydedilenAd: '' };
type OlayKaydi = [string, (this: jsPDF) => void];
const apiOlaylar = (jsPDF.API as unknown as { events: OlayKaydi[] }).events;
let sonFontListesi: Record<string, string[]> = {};
const dinleyici: OlayKaydi = ['initialized', function (this: jsPDF) {
  const gercekText = this.text.bind(this);
  this.text = ((...a: Parameters<jsPDF['text']>) => {
    const t = a[0]; kayit.basilan.push(Array.isArray(t) ? t.join(' ') : String(t));
    return gercekText(...a);
  }) as jsPDF['text'];
  this.save = ((ad: string) => { kayit.kaydedilenAd = ad; sonFontListesi = this.getFontList(); return this; }) as jsPDF['save'];
}];
beforeAll(() => { apiOlaylar.push(dinleyici); });
afterAll(() => { const i = apiOlaylar.indexOf(dinleyici); if (i >= 0) apiOlaylar.splice(i, 1); });

vi.mock('./belgeSablonu', async (orijinal) => {
  const gercek = await orijinal<typeof import('./belgeSablonu')>();
  return { ...gercek, sablonGetir: vi.fn(async () => null) };
});
import { sablonGetir } from './belgeSablonu';
import { exportOrderPDF } from './pdf';

const basilan = () => kayit.basilan;
const kaydedilenAd = () => kayit.kaydedilenAd;
beforeEach(() => { kayit.basilan = []; kayit.kaydedilenAd = ''; vi.mocked(sablonGetir).mockReset().mockResolvedValue(null); });

const teklif = {
  id: 'abc12345xy9z8w', customerName: 'Akdeniz İnşaat A.Ş.', currency: 'EUR', validUntil: '2026-09-20',
  createdAt: '2026-09-05', status: 'approved',
  lineItems: [{ title: 'Çimento 50kg', sku: 'CMT-50', quantity: 10, price: 12.5 }, { title: 'Demir Ø12', sku: 'DMR-12', quantity: 4, price: 300 }],
  totalPrice: 1350, kdvOran: 20,
};

describe('exportOrderPDF — teklif yolu', () => {
  it("başlık 'FİYAT TEKLİFİ', TEKLİF DETAYI + geçerlilik; Durum/Takip No BASILMAZ", async () => {
    await exportOrderPDF(teklif, null, 'teklif');
    const metin = basilan().join('\n');
    expect(metin).toContain('FİYAT TEKLİFİ');
    expect(metin).toContain('TEKLİF DETAYI');
    expect(metin).toMatch(/Geçerlilik: 20\.09\.2026/);
    expect(metin).not.toContain('SİPARİŞ / FATURA');
    expect(metin).not.toMatch(/Takip No/);
    expect(metin).not.toMatch(/Durum: approved/);
  });

  it("para birimi teklifin KENDİ birimi (EUR) — sabit 'TL' basılmaz", async () => {
    await exportOrderPDF(teklif, null, 'teklif');
    const tutarlar = basilan().filter(s => /\d,\d\d/.test(s));
    expect(tutarlar.length).toBeGreaterThan(3);
    expect(tutarlar.every(s => s.includes('EUR'))).toBe(true);
    expect(basilan().some(s => /\d TL\b/.test(s))).toBe(false);
  });

  it('teklif numarası QuotationDetail ile AYNI kural: id.substring(0,8).toUpperCase() — dosya adı CETPA_Teklif_', async () => {
    await exportOrderPDF(teklif, null, 'teklif');
    expect(basilan().some(s => s.includes('No: ABC12345'))).toBe(true);
    // Eski yol `gorunenSiparisNo` → '#' + id.slice(-6) = '#xy9z8w' basıyordu (sipariş biçimi,
    // QuotationDetail'inkinden farklı numara). İlk sürümde buradaki beklenti '#9z8w' idi —
    // id'nin son altısıyla eşleşmediği için hiçbir şeyi kilitlemiyordu; ön kontrol yakaladı.
    expect(basilan().some(s => s.includes('#xy9z8w'))).toBe(false);
    expect(kaydedilenAd()).toMatch(/^CETPA_Teklif_ABC12345_/);
  });

  it('şablon varsa başlık/alt bilgi şablondan, banka bloğu basılır; sahte IBAN basılmaz', async () => {
    vi.mocked(sablonGetir).mockResolvedValueOnce({ id: 'teklif', docType: 'teklif', title: 'CETPA FİYAT TEKLİFİ', color: '#007aff',
      footer: 'Ödeme 30 gün vadelidir.', bankDetails: 'TR33 0006 1005 1978 6457 8413 26', showBankDetails: true, vatRate: 20 });
    await exportOrderPDF(teklif, null, 'teklif');
    const metin = basilan().join('\n');
    expect(metin).toContain('CETPA FİYAT TEKLİFİ');
    expect(metin).toContain('Ödeme 30 gün vadelidir.');
    expect(metin).toContain('BANKA BİLGİLERİ');
    expect(metin).toContain('TR33 0006');
    vi.mocked(sablonGetir).mockResolvedValueOnce({ id: 'teklif', docType: 'teklif', title: '', color: '', footer: '', bankDetails: 'TR00 0000 0000 0000 0000 0000 00', showBankDetails: true, vatRate: 20 });
    kayit.basilan = [];
    await exportOrderPDF(teklif, null, 'teklif');
    expect(basilan().join('\n')).not.toContain('TR00 0000');
  });
});

describe('exportOrderPDF — sipariş yolu (varsayılan)', () => {
  it("başlık 'SİPARİŞ FORMU', Durum + Takip No basılır, dosya adı CETPA_Siparis_", async () => {
    await exportOrderPDF({ ...teklif, currency: undefined, orderNumber: 'SIP-1001', trackingNumber: 'TRK-77', status: 'Shipped' }, null);
    const metin = basilan().join('\n');
    expect(metin).toContain('SİPARİŞ FORMU');
    expect(metin).toContain('SİPARİŞ DETAYI');
    expect(metin).toMatch(/Takip No: TRK-77/);
    expect(metin).toMatch(/Durum: Shipped/);
    expect(basilan().filter(s => /\d,\d\d/.test(s)).every(s => s.includes('TL'))).toBe(true);
    expect(kaydedilenAd()).toMatch(/^CETPA_Siparis_SIP-1001_/);
  });

  it('tarih bilinmiyorsa BUGÜN basılmaz — "—" (müşteriye giden belgede yanlış tarih tuzağı)', async () => {
    await exportOrderPDF({ ...teklif, createdAt: undefined, syncedAt: undefined, orderDate: undefined }, null);
    expect(basilan().some(s => /Tarih: —/.test(s))).toBe(true);
  });
});

describe('sertleştirme — inceleme önerileri', () => {
  it('Roboto GERÇEKTEN yüklü (Türkçe glifler): save anında font listesinde Roboto normal+bold var', async () => {
    await exportOrderPDF(teklif, null, 'teklif');
    expect(sonFontListesi.Roboto).toEqual(expect.arrayContaining(['normal', 'bold']));
  });
  /**
   * DEĞİŞMEZ TESTİ (kaynak-tarayan): plugin-yöntemi `x.autoTable({…})` src'de KULLANILMAZ.
   * jspdf-autotable 5 plugin'i yalnız `window.jsPDF` globaline uygular; Vite'ın ESM jspdf'i
   * global yazmaz → plugin-yöntemi tarayıcıda tanımsız. pdf.ts:142 bu yüzden 2026-04-16'dan
   * beri canlıda çöküyordu; tip cast'i (`(doc as …).autoTable`) grep'ten de kaçırmıştı.
   */
  it("src'de plugin-yöntemi `.autoTable(` çağrısı yok — yalnız fonksiyonel `autoTable(doc, …)`", () => {
    const kok = resolve(__dirname, '..');
    const dosyalar: string[] = [];
    const gez = (d: string) => { for (const ad of readdirSync(d)) { const y = join(d, ad); if (statSync(y).isDirectory()) gez(y); else if (/\.tsx?$/.test(ad) && !/\.test\.tsx?$/.test(ad) && !ad.endsWith('.d.ts')) dosyalar.push(y); } };
    gez(kok);
    const ihlal: string[] = [];
    for (const f of dosyalar) {
      const kod = readFileSync(f, 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).filter(l => !/^\s*(\*|\/\*)/.test(l)).join('\n');
      const m = kod.match(/[A-Za-z0-9_)\]]\s*\.autoTable\s*\(/g);
      if (m) ihlal.push(`${f.replace(kok, 'src')} (${m.length})`);
    }
    expect(ihlal, 'plugin-yöntemi autoTable çağrısı — ESM\'de tanımsız, canlıda çöker').toEqual([]);
    expect(dosyalar.length).toBeGreaterThan(200);   // tarama gerçekten oldu
  });
});
