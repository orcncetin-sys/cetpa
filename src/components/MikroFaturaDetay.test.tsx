/**
 * MikroFaturaDetay.test.tsx — fatura detay penceresinin KALEM TABLOSU (2026-09-19: "Net Birim" sütunu).
 *
 * Pencere giriş + canlı Mikro verisi gerektirdiği için lokal tarayıcıda açılamıyor; bu test bileşeni GERÇEKTEN çizer
 * (yalnız `/api/mikro/fatura/kalemler` yanıtı sahte). Veri, kullanıcının ekran görüntüsündeki 359 no'lu faturadır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MikroFaturaDetay, { type MikroFaturaDetayVerisi } from './MikroFaturaDetay';
import { kalemleriCoz } from '../lib/stokFiyat';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../services/ebelgeIndir', () => ({ eBelgeIndir: vi.fn() }));
// Gerçek çözücü, yalnız ÇAĞRI argümanı izlenir (K3: ortak anahtarda başlık toplamı hakem olarak VERİLMEZ).
vi.mock('../lib/stokFiyat', async (orig) => {
  const gercek = await orig<typeof import('../lib/stokFiyat')>();
  return { ...gercek, kalemleriCoz: vi.fn(gercek.kalemleriCoz) };
});

const fatura: MikroFaturaDetayVerisi = {
  id: 'f1', faturaNo: '359', musteri: 'ACCADO KİLİT SİSTEMLERİ', cariKod: '0040488682', tarih: '2026-09-03',
  tutar: 4270.01, kdv: 711.67, matrah: 3558.34, oran: 20, yon: 'giden',
};

const yanit = (kalemler: Record<string, unknown>[]) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, kalemler }) });

/** Ürün adının durduğu tablo satırı — bulunamazsa test AÇIK bir hatayla düşer (`!` yok). */
async function satirOf(urunAdi: string): Promise<HTMLElement> {
  const tr = (await screen.findByText(urunAdi)).closest('tr');
  if (!tr) throw new Error(`"${urunAdi}" bir <tr> içinde değil`);
  return tr;
}
const hucreler = (satir: HTMLElement) => within(satir).getAllByRole('cell').map(c => c.textContent);

beforeEach(() => authFetch.mockReset());

describe('MikroFaturaDetay — Net Birim sütunu', () => {
  it('net ÷ miktar basılır; 2 ondalık neti tutmuyorsa tutan en az ondalık', async () => {
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'AKCALI-AKÇ.00326', urunAdi: 'AKÇALI SPREY SİYAH 400 ML', birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 18, sth_tutar: 3375, sth_vergi: 675, sth_vergi_pntr: 4 },
      { sth_stok_kod: 'M311.VT874000', urunAdi: 'VIP-TEC MAKET BIÇAĞI', birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 20, sth_tutar: 183.34, sth_vergi: 36.67, sth_vergi_pntr: 4 },
    ]));
    render(<MikroFaturaDetay fatura={fatura} currentLanguage="tr" onClose={() => {}} />);

    const satir1 = await satirOf('AKÇALI SPREY SİYAH 400 ML');
    const satir2 = await satirOf('VIP-TEC MAKET BIÇAĞI');
    expect(hucreler(satir1)[6]).toBe('₺187,50');      // 3.375,00 / 18 — 2 ondalık neti geri üretir
    expect(hucreler(satir2)[6]).toBe('₺9,167');       // 183,34 / 20 — "₺9,17" × 20 = 183,40 ≠ 183,34
    // Sütun sırası: … Net, Net Birim, KDV
    const basliklar = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(basliklar.slice(-3)).toEqual(['Net', 'Net Birim', 'KDV']);
    expect(screen.queryByText(/ile girilmiş/)).toBeNull();        // ana birimle girilen satırda giriş notu YOK
  });

  it("miktarı 0 olan satırda (fiyat farkı) birim fiyat '—' — sıfıra bölünmez, ₺0 basılmaz", async () => {
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'FF-1', urunAdi: 'FİYAT FARKI', birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 0, sth_tutar: 100, sth_vergi: 20, sth_vergi_pntr: 4 },
    ]));
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 120 }} currentLanguage="tr" onClose={() => {}} />);
    const h = hucreler(await satirOf('FİYAT FARKI'));
    expect(h[5]).toBe('₺100,00');   // Net
    expect(h[6]).toBe('—');         // Net Birim
  });

  it('[CANLI ÖLÇÜM] başka birimle girilen satır: Birim = ANA birim, giriş birimi bilgi notu; belirsizlik işareti YOK', async () => {
    // Alış faturası 234 (Kalekim 3131, 20 kg kova): sunucu birim='ADET', girisBirimi='KILOGRAM' yollar.
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'KALEKIM.3131', urunAdi: 'Kalekim 3131 Elastikor 20 kg', birim: 'ADET', girisBirimi: 'KILOGRAM', sth_birim_pntr: 2, sth_miktar: 50, sth_tutar: 57916.66, sth_vergi: 11583.33, sth_vergi_pntr: 4 },
    ]));
    render(<MikroFaturaDetay fatura={{ ...fatura, yon: 'gelen', tutar: 69499.99 }} currentLanguage="tr" onClose={() => {}} />);
    const h = hucreler(await satirOf('Kalekim 3131 Elastikor 20 kg'));
    expect(h[2]).toBe('ADETKILOGRAM ile girilmiş');     // Birim hücresi: ana birim + alt satırda giriş notu
    expect(h[6]).toBe('₺1.158,3332');                   // KOVA başına net — işaretsiz
    expect(screen.queryByText(/ana birim dışında/)).toBeNull();
  });
});

describe('MikroFaturaDetay — başlıksız açılan fatura (hareketFaturasi, 2026-09-25)', () => {
  it('PDF düğmesi KAPALI (uydurma id sunucuya gitmez), "UUID yok" notu yerine başlık notu; kalemler yine çekilir', async () => {
    authFetch.mockReturnValue(yanit([]));
    render(<MikroFaturaDetay fatura={{ ...fatura, id: 'hareket|gelen||410', faturaNo: '410', yon: 'gelen', tutar: NaN, kdv: NaN, matrah: NaN, baslikYok: true }} currentLanguage="tr" onClose={() => {}} />);
    expect((screen.getByRole('button', { name: /PDF/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Fatura başlığı Cetpa'da yok/)).toBeTruthy();
    expect(screen.queryByText(/PDF Mikro belge numarasıyla denenir/)).toBeNull();
    expect(authFetch).toHaveBeenCalledWith('/api/mikro/fatura/kalemler', expect.objectContaining({ body: JSON.stringify({ seri: '', sira: '410', yon: 'gelen' }) }));
  });
});

// ── Mikro kaydı KENDİ İÇİNDE TUTARSIZ (evrak 420, 2026-09-26) ─────────────────────────────────────────────────────
// Kullanıcı: "net tutar iskontolu halde göstermeli". Tedarikçi e-faturası (SİZGEN SZN2026000001284): 1.050 × 270 = 283.500
// brüt, iskonto 114.817,50, NET 168.682,50, KDV 33.736,50, TOPLAM 202.419. Mikro'da: sth_tutar 398.317,50 (iskonto brüte
// bir kez daha eklenmiş), başlık meblağı 317.236,50, başlık matrahı (import SUM(sth_tutar)) 398.317,50.
const K420 = {
  sth_stok_kod: 'RULO1081', urunAdi: 'RULO 1081', birim: 'ADET', sth_birim_pntr: 1, sth_evrakno_seri: '', sth_evrakno_sira: 420,
  sth_tarih: '2026-08-31', sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5,
  sth_vergi: 33736.5, sth_vergi_pntr: 4,
};
const F420: MikroFaturaDetayVerisi = {
  id: 'f420', faturaNo: '420', musteri: 'SİZGEN YAPI', cariKod: '320.01', tarih: '2026-08-31',
  tutar: 317236.5, kdv: 33736.5, matrah: 398317.5, oran: 20, yon: 'gelen',
};
/** Başlık bölümündeki "etiket — değer" satırı (satir() yardımcısı: iki span'lı div). */
function baslikSatiri(etiket: string): HTMLElement {
  const e = screen.getAllByText(etiket).find(x => x.tagName === 'SPAN' && x.parentElement?.tagName === 'DIV');
  if (!e?.parentElement) throw new Error(`"${etiket}" başlık satırı yok`);
  return e.parentElement;
}

describe('MikroFaturaDetay — Mikro kaydı KDV ile tutarsız (evrak 420)', () => {
  it('sağlama YEŞİL DEĞİL; tutarsızlık metni kalem neti + KDV = 202.419 ve Mikro toplamı 317.236,50 ile', async () => {
    authFetch.mockReturnValue(yanit([K420]));
    render(<MikroFaturaDetay fatura={F420} currentLanguage="tr" onClose={() => {}} />);
    const h = hucreler(await satirOf('RULO 1081'));
    expect(h[3]).toBe('⚠₺283.500,00');                  // brüt = e-faturanın Mal Hizmet Tutarı (Mikro tutarı − iskonto)
    expect(h[4]).toBe('−₺114.817,50');
    expect(h[5]).toBe('₺168.682,50');                   // net İSKONTOLU (KDV ile sağlanan)
    expect(h[6]).toBe('₺160,65');
    const brutHucre = within(await satirOf('RULO 1081')).getAllByRole('cell')[3];
    expect(brutHucre.getAttribute('title')).toMatch(/^Mikro tutarı ₺398\.317,50/);

    expect(screen.queryByText(/✓ Sağlama/)).toBeNull();
    const uyari = screen.getByText(/Mikro kaydı KDV ile TUTARSIZ/);
    expect(uyari.textContent).toBe("Mikro kaydı KDV ile TUTARSIZ: kalem neti ₺168.682,50 + KDV ₺33.736,50 = ₺202.419,00; Mikro'daki fatura toplamı ₺317.236,50 — fark ₺114.817,50: satır iskontosu Mikro'da brüte bir kez daha eklenmiş. Net tutarlar iskontolu (KDV ile sağlanan) gösteriliyor; faturayı Mikro'da düzeltin.");
    expect(screen.queryByText(/Sağlama TUTMUYOR/)).toBeNull();
    expect(screen.queryByText(/KDV oranıyla tutmuyor/)).toBeNull();   // kdvUyumsuz = 0

    // Başlık: Matrah = Σ kalem neti (+ Mikro başlığı notu); Toplam Mikro'nunki + KDV ile tutarlı toplam.
    // F420 ESKİ doküman (matrahKaynagi yok, brüt başlık): not şişkinliğin İKİ yarısını da söyler —
    // 398.317,50 − 114.817,50 = 283.500 ≠ 168.682,50 (iskonto iki kez girmiş). Yeni doküman: aşağıdaki "matrah aşama 2" bloğu.
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺168.682,50Mikro başlığı ₺398.317,50 — iskonto ₺114.817,50 düşülmemiş (eski kayıt — Faturaları yeniden çekin), ₺114.817,50 brüte bir kez daha eklenmiş');
    expect(baslikSatiri('Toplam').textContent).toBe('Toplam₺317.236,50KDV ile tutarlı toplam ₺202.419,00');
  });

  it('tutarlı fatura (359): yeşil "✓ Sağlama" KALIR; Matrah başlıkla aynı → not yok; Toplam notu yok', async () => {
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'AKCALI-AKÇ.00326', urunAdi: 'AKÇALI SPREY SİYAH 400 ML', birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 18, sth_tutar: 3375, sth_vergi: 675, sth_vergi_pntr: 4 },
      { sth_stok_kod: 'M311.VT874000', urunAdi: 'VIP-TEC MAKET BIÇAĞI', birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 20, sth_tutar: 183.34, sth_vergi: 36.67, sth_vergi_pntr: 4 },
    ]));
    render(<MikroFaturaDetay fatura={fatura} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('AKÇALI SPREY SİYAH 400 ML');
    expect(screen.getByText(/✓ Sağlama/)).toBeTruthy();
    expect(screen.queryByText(/TUTARSIZ/)).toBeNull();
    expect(screen.queryByText(/⚠/)).toBeNull();
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺3.558,34');
    expect(baslikSatiri('Toplam').textContent).toBe('Toplam₺4.270,01');
  });

  it('toplam tutuyor ama satırın KDV\'si pntr oranına uymuyor (kdvUyumsuz): yeşil YOK, ayrı KDV uyarısı', async () => {
    // KDV 100 = 1.000'in %10'u (2026'da geçerli oran → satır doğrulanır), ama pntr 4 = %20 → kdvUyumsuz 1.
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'X1', urunAdi: 'ÇİMENTO', birim: 'ADET', sth_tarih: '2026-08-31', sth_miktar: 10, sth_tutar: 1000, sth_vergi: 100, sth_vergi_pntr: 4 },
    ]));
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 1100, kdv: 100, matrah: 1000 }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('ÇİMENTO');
    expect(screen.queryByText(/✓ Sağlama/)).toBeNull();
    // TEK kutu, KESİN hüküm: oranı bilinen satır ölçüldü ve uymadı — "doğrulanamadı" (bilinmiyor) DEĞİL; aynı olgu iki kez basılmaz.
    const kutu = screen.getByText(/^Toplam tutuyor/);
    expect(kutu.textContent).toBe("Toplam tutuyor (kalem neti ₺1.000,00 + KDV ₺100,00 = fatura toplamı ₺1.100,00), ancak 1 kalemde KDV satırın KDV oranıyla tutmuyor — Mikro kaydını kontrol edin.");
    expect(screen.getAllByText(/KDV oranıyla tutmuyor/)).toHaveLength(1);
    expect(screen.queryByText(/doğrulanamadı/)).toBeNull();
    expect(screen.queryByText(/Sağlama TUTMUYOR/)).toBeNull();        // toplam tutuyor — "tutmuyor" demek yalan olur
    expect(screen.queryByText(/TUTARSIZ/)).toBeNull();
  });

  it('büyük faturada Mikro fazlası sağlama payı (on binde 5) İÇİNDE kalsa da yeşil ✓ VERİLMEZ — Mikro kaydı tutarsız kutusu', async () => {
    // Toplam ~1,2 M → pay ~600; tek kalem 2.400/400/KDV 320 çift iskontolu (gerçek net 1.600), Mikro fazlası 400 < pay.
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'B1', urunAdi: 'BÜYÜK KALEM', birim: 'ADET', sth_tarih: '2026-08-31', sth_miktar: 1000, sth_tutar: 997600, sth_vergi: 199520, sth_vergi_pntr: 4 },
      { sth_stok_kod: 'C1', urunAdi: 'ÇİFT KALEM', birim: 'ADET', sth_tarih: '2026-08-31', sth_miktar: 10, sth_tutar: 2400, sth_iskonto1: 400, sth_vergi: 320, sth_vergi_pntr: 4 },
    ]));
    render(<MikroFaturaDetay fatura={{ ...F420, tutar: 1199440, kdv: 199840, matrah: 1000000 }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('ÇİFT KALEM');
    expect(screen.queryByText(/✓ Sağlama/)).toBeNull();
    expect(screen.getByText(/Mikro kaydı KDV ile TUTARSIZ/)).toBeTruthy();
  });

  it('çift iskonto okuması da mümkün (aralık koruması, pntr yok): yeşil ✓ YOK, tek kutuda "ayırt edilemiyor"', async () => {
    authFetch.mockReturnValue(yanit([
      { sth_stok_kod: 'Y1', urunAdi: 'YALITIM', birim: 'ADET', sth_tarih: '2026-08-31', sth_miktar: 10, sth_tutar: 1100, sth_iskonto1: 100, sth_vergi: 180 },
    ]));
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 1180, kdv: 180, matrah: 1100 }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('YALITIM');
    expect(screen.queryByText(/✓ Sağlama/)).toBeNull();
    expect(screen.getByText(/^Toplam tutuyor/).textContent).toMatch(/ancak 1 kalemde iskontonun Mikro'da brüte bir kez daha eklenip eklenmediği satırdan ayırt edilemiyor — e-faturayla karşılaştırın\.$/);
    expect(screen.queryByText(/KDV oranıyla tutmuyor/)).toBeNull();
  });

  it('İngilizce: tutarsızlık metni ve Toplam notu çevrilir', async () => {
    authFetch.mockReturnValue(yanit([K420]));
    render(<MikroFaturaDetay fatura={F420} currentLanguage="en" onClose={() => {}} />);
    await screen.findByText(/Mikro record INCONSISTENT with VAT/);
    expect(screen.queryByText(/✓ Check/)).toBeNull();
    expect(screen.getByText(/VAT-consistent total ₺202\.419,00/)).toBeTruthy();
  });
});

describe('MikroFaturaDetay — tur 2: Matrah notu rakamla kapanır (ESKİ doküman — matrahKaynagi yok, brüt başlık)', () => {
  it('420 + KDV oranına uymayan ikinci kalem (durum "tutmuyor"): not yine İKİ yarıyı rakamla söyler; kesin toplam notu yok', async () => {
    const K2 = { ...K420, sth_stok_kod: 'EK', urunAdi: 'EK KALEM', sth_miktar: 1, sth_tutar: 1000, sth_iskonto1: 0, sth_iskonto2: 0, sth_vergi: 100 };
    authFetch.mockReturnValue(yanit([K420, K2]));
    render(<MikroFaturaDetay fatura={{ ...F420, tutar: 318336.5, kdv: 33836.5, matrah: 399317.5 }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('EK KALEM');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺169.682,50Mikro başlığı ₺399.317,50 — iskonto ₺114.817,50 düşülmemiş (eski kayıt — Faturaları yeniden çekin), ₺114.817,50 brüte bir kez daha eklenmiş');
    expect(baslikSatiri('Toplam').textContent).toBe('Toplam₺318.336,50');
  });
  it('masraflı iskontolu satır: Matrah = net + masraf (KDV\'nin tabanı), not masrafı söyler', async () => {
    const KM = { ...K420, sth_stok_kod: 'M', urunAdi: 'MASRAFLI', sth_miktar: 10, sth_tutar: 10000, sth_iskonto1: 1000, sth_iskonto2: 0, sth_masraf1: 500, sth_vergi: 1900 };
    authFetch.mockReturnValue(yanit([KM]));
    render(<MikroFaturaDetay fatura={{ ...F420, tutar: 11400, kdv: 1900, matrah: 10000 }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('MASRAFLI');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺9.500,00Mikro başlığı ₺10.000,00 — iskonto ₺1.000,00 düşülmemiş (eski kayıt — Faturaları yeniden çekin), masraf ₺500,00 matraha dahil');
    expect(await screen.findByText(/✓ Sağlama/)).toBeTruthy();
  });
  it('İngilizce: eski kayıt eki çevrilir', async () => {
    authFetch.mockReturnValue(yanit([K420]));
    render(<MikroFaturaDetay fatura={F420} currentLanguage="en" onClose={() => {}} />);
    await satirOf('RULO 1081');
    expect(baslikSatiri('Base').textContent).toBe('Base₺168.682,50Mikro header ₺398.317,50 — discount ₺114.817,50 not deducted (old record — re-pull invoices), ₺114.817,50 added to the gross once more');
  });
});

// ── Matrah aşama 2 (2026-09-29): YENİ doküman — başlık Mikro'nun NET okuması ─────────────────────────────────────────
// fatura-listesi importu matrahı `cha_aratoplam − Σcha_ft_iskonto` (lib/faturaMatrahi; başlık okunamazsa satır neti) ile
// yazar ve `matrahKaynagi` koyar. Başlıkta iskonto ZATEN düşülü → not "iskonto düşülmemiş" DEMEZ; kalan fark Mikro'nun
// brüte fazladan eklediği iskonto (+ başlık formülünün içermediği masraf). Kapanmıyorsa yalnız başlık değeri (uydurma yok).
describe('MikroFaturaDetay — matrah aşama 2: YENİ doküman (matrahKaynagi dolu)', () => {
  /** SİZGEN evrak 420 yeni dokümanı: aratoplam 398.317,50 − ft iskonto 114.817,50 = 283.500 (Mikro kaydının matrahı). */
  const F420_YENI: MikroFaturaDetayVerisi = { ...F420, matrah: 283500, matrahKaynagi: 'baslik' };
  /** Tutarlı iskontolu satır: brüt 10.000, iskonto 1.000, net 9.000, KDV %20 = 1.800. */
  const TUTARLI = { sth_stok_kod: 'T1', urunAdi: 'TUTARLI İSKONTOLU', birim: 'ADET', sth_birim_pntr: 1, sth_tarih: '2026-08-31', sth_miktar: 10, sth_tutar: 10000, sth_iskonto1: 1000, sth_vergi: 1800, sth_vergi_pntr: 4 };

  it("SİZGEN 420: başlık 283.500 − fazla 114.817,50 = kalem neti 168.682,50 → not KAPANIR, 'iskonto düşülmemiş' YOK", async () => {
    authFetch.mockReturnValue(yanit([K420]));
    render(<MikroFaturaDetay fatura={F420_YENI} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('RULO 1081');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺168.682,50Mikro başlığı ₺283.500,00 — ₺114.817,50 brüte bir kez daha eklenmiş');
    expect(screen.queryByText(/düşülmemiş/)).toBeNull();
    expect(screen.queryByText(/eski kayıt/)).toBeNull();
  });

  it('aynı numaralı birden çok başlık (ortakAnahtar): Matrah BAŞLIKTAN, not bunu söyler; sağlama/tutarsızlık kutusu GÖSTERİLMEZ', async () => {
    authFetch.mockReturnValue(yanit([K420]));
    render(<MikroFaturaDetay fatura={{ ...F420_YENI, ortakAnahtar: true }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('RULO 1081');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺283.500,00başlıktan — aynı evrak numaralı başka bir Mikro faturasıyla kalemler paylaşılıyor');
    expect(screen.getByText(/BİRDEN ÇOK fatura başlığı var/)).toBeTruthy();
    expect(screen.queryByText(/TUTARSIZ|TUTMUYOR|Sağlama:/)).toBeNull();
  });

  // Hakem 2026-09-29 (K2/K3): ortak anahtarda kalemler öbür başlıkla PAYLAŞILIR — bu başlığın toplamı kalemlere hakem olamaz,
  // kalemlerden hesaplanan KDV kırılımı da bu faturanın başlıktan gelen KDV'siyle tutmaz.
  it('ortakAnahtar: kalem çözücüye başlık toplamı VERİLMEZ (K3); karma oranlı faturada KDV Kırılımı kutusu GÖSTERİLMEZ (K2)', async () => {
    const KARMA = [
      { sth_stok_kod: 'A', urunAdi: 'YÜZDE ON', birim: 'ADET', sth_tarih: '2026-08-31', sth_miktar: 1, sth_tutar: 10000, sth_vergi: 1000, sth_vergi_pntr: 3 },
      { sth_stok_kod: 'B', urunAdi: 'YÜZDE YİRMİ', birim: 'ADET', sth_tarih: '2026-08-31', sth_miktar: 1, sth_tutar: 2500, sth_vergi: 500, sth_vergi_pntr: 4 },
    ];
    const F246: MikroFaturaDetayVerisi = { ...fatura, id: 'f246', faturaNo: '246', tutar: 12000, kdv: 2000, matrah: 10000, oran: null, oranKarma: true, matrahKaynagi: 'baslik' };
    authFetch.mockReturnValue(yanit(KARMA));
    vi.mocked(kalemleriCoz).mockClear();
    const { unmount } = render(<MikroFaturaDetay fatura={{ ...F246, ortakAnahtar: true }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('YÜZDE ON');
    expect(screen.queryByText('KDV Kırılımı')).toBeNull();
    expect(vi.mocked(kalemleriCoz).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(kalemleriCoz).mock.calls.every(c => c[1] === undefined)).toBe(true);
    unmount();
    // Karşı örnek: ortak anahtar DEĞİLSE kırılım görünür ve çözücü başlık toplamını alır.
    vi.mocked(kalemleriCoz).mockClear();
    render(<MikroFaturaDetay fatura={{ ...F246, tutar: 14000, kdv: 1500, matrah: 12500 }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('YÜZDE ON');
    expect(screen.getByText('KDV Kırılımı')).toBeTruthy();
    expect(vi.mocked(kalemleriCoz).mock.calls.some(c => c[1] === 14000)).toBe(true);
  });

  it("kaynak 'satir' de yeni dal (başlık yine net)", async () => {
    authFetch.mockReturnValue(yanit([K420]));
    render(<MikroFaturaDetay fatura={{ ...F420_YENI, matrahKaynagi: 'satir' }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('RULO 1081');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺168.682,50Mikro başlığı ₺283.500,00 — ₺114.817,50 brüte bir kez daha eklenmiş');
  });

  it('tutarlı iskontolu fatura: başlık (net 9.000) = kalem neti → NOT YOK; aynı fatura eski dokümanda iskontoyu söyler', async () => {
    authFetch.mockReturnValue(yanit([TUTARLI]));
    const { unmount } = render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 10800, kdv: 1800, matrah: 9000, matrahKaynagi: 'baslik' }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('TUTARLI İSKONTOLU');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺9.000,00');
    unmount();
    // Karşı örnek: gece yenilemesinden ÖNCEKİ doküman brüt 10.000 taşır → eski dal iskontoyu açıklar.
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 10800, kdv: 1800, matrah: 10000 }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('TUTARLI İSKONTOLU');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺9.000,00Mikro başlığı ₺10.000,00 — iskonto ₺1.000,00 düşülmemiş (eski kayıt — Faturaları yeniden çekin)');
  });

  it('masraflı (başlık formülü masrafı içermez): başlık 9.000 + masraf 500 = 9.500 → not masrafı söyler', async () => {
    const KM = { ...TUTARLI, urunAdi: 'MASRAFLI', sth_masraf1: 500, sth_vergi: 1900 };
    authFetch.mockReturnValue(yanit([KM]));
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 11400, kdv: 1900, matrah: 9000, matrahKaynagi: 'baslik' }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('MASRAFLI');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺9.500,00Mikro başlığı ₺9.000,00 — masraf ₺500,00 matraha dahil');
  });

  it("masraflı 'satir' kaynağı: başlık (satır neti) masrafı ZATEN içerir → 9.500 = kalem → NOT YOK (masraf ikinci kez eklenmez)", async () => {
    const KM = { ...TUTARLI, urunAdi: 'MASRAFLI', sth_masraf1: 500, sth_vergi: 1900 };
    authFetch.mockReturnValue(yanit([KM]));
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 11400, kdv: 1900, matrah: 9500, matrahKaynagi: 'satir' }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('MASRAFLI');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺9.500,00');
  });

  it("masraflı + fazlalı 'satir' kaynağı: başlık − fazla = kalem → not KAPANIR, masraf parçası YOK", async () => {
    // KDV gerçek taban (net 168.682,50 + masraf 500) × %20 = 33.836,50; satır başlığı = tutar − Σisk + masraf = 284.000.
    const KM = { ...K420, sth_stok_kod: 'M', urunAdi: 'MASRAFLI', sth_masraf1: 500, sth_vergi: 33836.5 };
    authFetch.mockReturnValue(yanit([KM]));
    render(<MikroFaturaDetay fatura={{ ...F420_YENI, tutar: 317836.5, matrah: 284000, kdv: 33836.5, matrahKaynagi: 'satir' }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('MASRAFLI');
    const metin = baslikSatiri('Matrah').textContent ?? '';
    expect(metin).toContain('brüte bir kez daha eklenmiş');
    expect(metin).not.toContain('masraf');
  });

  it('kapanmayan fark: yeni dokümanda BRÜT görünen başlık (10.000) iskontoyla AÇIKLANMAZ → yalnız başlık değeri', async () => {
    authFetch.mockReturnValue(yanit([TUTARLI]));
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 10800, kdv: 1800, matrah: 10000, matrahKaynagi: 'baslik' }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('TUTARLI İSKONTOLU');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺9.000,00Mikro başlığı ₺10.000,00');
  });

  it("matrahKaynagi null (kaynak bilinmiyor) YENİ dal SAYILMAZ — eski dal", async () => {
    authFetch.mockReturnValue(yanit([TUTARLI]));
    render(<MikroFaturaDetay fatura={{ ...fatura, tutar: 10800, kdv: 1800, matrah: 10000, matrahKaynagi: null }} currentLanguage="tr" onClose={() => {}} />);
    await satirOf('TUTARLI İSKONTOLU');
    expect(baslikSatiri('Matrah').textContent).toBe('Matrah₺9.000,00Mikro başlığı ₺10.000,00 — iskonto ₺1.000,00 düşülmemiş (eski kayıt — Faturaları yeniden çekin)');
  });

  it('İngilizce: yeni dal çevrilir', async () => {
    authFetch.mockReturnValue(yanit([K420]));
    render(<MikroFaturaDetay fatura={F420_YENI} currentLanguage="en" onClose={() => {}} />);
    await satirOf('RULO 1081');
    expect(baslikSatiri('Base').textContent).toBe('Base₺168.682,50Mikro header ₺283.500,00 — ₺114.817,50 added to the gross once more');
  });
});
