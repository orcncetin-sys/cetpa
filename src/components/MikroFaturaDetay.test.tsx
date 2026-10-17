/**
 * MikroFaturaDetay.test.tsx — fatura detay penceresinin KALEM TABLOSU (2026-09-19: "Net Birim" sütunu).
 *
 * Pencere giriş + canlı Mikro verisi gerektirdiği için lokal tarayıcıda açılamıyor; bu test bileşeni GERÇEKTEN çizer
 * (yalnız `/api/mikro/fatura/kalemler` yanıtı sahte). Veri, kullanıcının ekran görüntüsündeki 359 no'lu faturadır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import MikroFaturaDetay, { type MikroFaturaDetayVerisi } from './MikroFaturaDetay';
import { kalemleriCoz } from '../lib/stokFiyat';
import { eBelgeIndir } from '../services/ebelgeIndir';
import { useAppStore } from '../store/appStore';
import { UserRole } from '../types';
import { APP_ROLES, isAllowed } from '../lib/rbac';
import { ucKapisindanGecer } from '../lib/mikroUcKapilari';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../services/ebelgeIndir', () => ({ eBelgeIndir: vi.fn() }));
// Gerçek çözücü, yalnız ÇAĞRI argümanı izlenir (K3: ortak anahtarda başlık toplamı hakem olarak VERİLMEZ).
vi.mock('../lib/stokFiyat', async (orig) => {
  const gercek = await orig<typeof import('../lib/stokFiyat')>();
  return { ...gercek, kalemleriCoz: vi.fn(gercek.kalemleriCoz) };
});

const fatura: MikroFaturaDetayVerisi = {
  id: 'f1', faturaNo: '359', belgeNo: undefined, musteri: 'ACCADO KİLİT SİSTEMLERİ', cariKod: '0040488682', tarih: '2026-09-03',
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

/** Depoya yazılabilen bütün roller (enum) — `rbac` rol listesiyle AYNI küme (aşağıda sınanır); döngüler bunu gezer. */
const TUM_ROLLER = Object.values(UserRole);

// Pencere rolü KÜRESEL DEPODAN okur (karar turu 2026-10-11). Deponun varsayılanı Satış'tır ve Satış indirme kapısından
// GEÇEMEZ (düğmeler çizilmez, başlıksız not yetkiyi söyler) → bu dosyanın rol dışı bütün iddiaları, başlığı okuyabilen ve
// indirebilen bir rolde (Muhasebe) koşar; rol davranışı en alttaki iki blokta rol rol sınanır.
beforeEach(() => {
  authFetch.mockReset();
  vi.mocked(eBelgeIndir).mockReset();
  vi.mocked(eBelgeIndir).mockResolvedValue(null);
  useAppStore.setState({ userRole: UserRole.Accounting });
});

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
  id: 'f420', faturaNo: '420', belgeNo: 'SZN2026000001284', musteri: 'SİZGEN YAPI', cariKod: '320.01', tarih: '2026-08-31',
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

// ── Üst bilgi: Fatura No · Belge No · Tarih (2026-10-10) ──────────────────────────────────────────────────────────────
// Kullanıcı isteği (420 no'lu SİZGEN alış faturasının ekran görüntüsüyle): «fatura detay ekranlarına tarih ve fatura no +
// belge no ekle.» Pencerede fatura no yalnız başlık altındaki küçük mono metindi, tarih HAM basılıyordu ('2026-08-31'),
// belge no (gelen faturada tedarikçinin fatura numarası — Mikro `cha_belge_no`) hiç yoktu. Üç satır gövdenin EN ÜSTÜNDE ve
// HER ZAMAN çizilir: bilinmeyen '—' (gizlenmez).
describe('MikroFaturaDetay — üst bilgi: Fatura No · Belge No · Tarih', () => {
  /** Gövdedeki "etiket — değer" satırlarının etiketleri, DOM sırasıyla (satir() yardımcısı: iki span'lı div). */
  function govdeEtiketleri(): (string | null)[] {
    const govde = baslikSatiri(screen.queryByText('Toplam') ? 'Toplam' : 'Total').parentElement;
    if (!govde) throw new Error('pencere gövdesi yok');
    return [...govde.children]
      .filter(c => c.tagName === 'DIV' && c.children.length === 2 && [...c.children].every(x => x.tagName === 'SPAN'))
      .map(c => c.firstElementChild?.textContent ?? null);
  }
  /** Kalem çekimi (boş yanıt) bitene kadar bekler — sonraki durum güncellemesi testin DIŞINA taşmasın. */
  const ciz = async (f: MikroFaturaDetayVerisi, dil: 'tr' | 'en' = 'tr') => {
    authFetch.mockReturnValue(yanit([]));
    render(<MikroFaturaDetay fatura={f} currentLanguage={dil} onClose={() => {}} />);
    await screen.findByText(dil === 'tr' ? /stok satırı yok/ : /No stock lines/);
  };

  it('gövdenin EN ÜSTÜNDE üç satır, sırayla; değerler fatura no / belge no / GG.AA.YYYY', async () => {
    await ciz(F420);
    expect(govdeEtiketleri()).toEqual(['Fatura No', 'Belge No', 'Tarih', 'Müşteri / Cari', 'Cari kodu', 'Matrah', 'KDV', 'Toplam']);
    expect(baslikSatiri('Fatura No').textContent).toBe('Fatura No420');
    expect(baslikSatiri('Belge No').textContent).toBe('Belge NoSZN2026000001284');
    expect(baslikSatiri('Tarih').textContent).toBe('Tarih31.08.2026');
  });

  it("«Tarih» satırı TEK (taşındı, yinelenmedi); başlık altındaki mono fatura no DURUR", async () => {
    await ciz(F420);
    expect(screen.getAllByText('Tarih')).toHaveLength(1);
    expect(screen.queryByText('2026-08-31')).toBeNull();                          // ham tarih artık basılmıyor
    // '420' iki yerde: başlık altındaki <p> (mono) + «Fatura No» satırının değeri.
    expect(screen.getAllByText('420').map(e => e.tagName).sort()).toEqual(['P', 'SPAN']);
    expect(screen.getAllByText('420').find(e => e.tagName === 'P')?.className).toContain('font-mono');
  });

  it.each([
    ['YYYY-AA-GG (mikroFaturalar)', '2026-08-31', '31.08.2026'],
    ['GG.AA.YYYY (Cari Ekstre satırı zaten biçimli)', '31.08.2026', '31.08.2026'],
    ['boş metin (başlıksız açılış, tarihsiz hareket)', '', '—'],
    ["'—' (Cari Ekstre: tarihi çözülemeyen satır)", '—', '—'],
    ['çözülemeyen metin HAM basılır — tarih uydurulmaz', 'tarih okunamadı', 'tarih okunamadı'],
  ])('tarih: %s', async (_ad, tarih, beklenen) => {
    await ciz({ ...F420, tarih });
    expect(baslikSatiri('Tarih').textContent).toBe(`Tarih${beklenen}`);
  });

  it.each([
    ['alan yok / bilinmiyor (undefined)', undefined, '—'],
    ['boş metin', '', '—'],
    ['yalnız boşluk', '   ', '—'],
    ['boşluklu değer kırpılır', '  ABC2026000000042 ', 'ABC2026000000042'],
  ])("belge no: %s → satır HER ZAMAN çizilir", async (_ad, belgeNo, beklenen) => {
    await ciz({ ...fatura, belgeNo });
    expect(baslikSatiri('Belge No').textContent).toBe(`Belge No${beklenen}`);
    expect(govdeEtiketleri().slice(0, 3)).toEqual(['Fatura No', 'Belge No', 'Tarih']);
  });

  it('boşluksuz uzun belge no: değer hücresi kırılma sınıflarını taşır (dar ekranda satır yatay taşmasın)', async () => {
    // jsdom yerleşim hesaplamaz → taşma burada ölçülemez; sınıf çifti sabitlenir. İKİSİ BİRLİKTE gerekir: `break-words` tek
    // başına esnek öğenin en küçük içerik genişliğini küçültmez (390 px'te 50 karakterlik değer: çiftle taşma 0, tek başına sürüyor).
    const uzun = 'SZN' + '2026000001284'.repeat(4);
    await ciz({ ...F420, belgeNo: uzun });
    const deger = baslikSatiri('Belge No').lastElementChild;
    expect(deger?.textContent).toBe(uzun);
    expect(deger?.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'break-words']));
    expect(deger?.className.split(/\s+/)).not.toContain('break-all');               // unvanı sözcük ortasından bölerdi
    // Sınıf `satir()` yardımcısında: gövdedeki her satır (unvan, cari kodu …) aynı hücreyi kullanır.
    expect(baslikSatiri('Müşteri / Cari').lastElementChild?.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'break-words']));
  });

  it("fatura no boşsa «Fatura No» satırı da '—' (gizlenmez)", async () => {
    authFetch.mockReturnValue(yanit([]));
    render(<MikroFaturaDetay fatura={{ ...fatura, faturaNo: '' }} currentLanguage="tr" onClose={() => {}} />);
    expect(baslikSatiri('Fatura No').textContent).toBe('Fatura No—');
  });

  it("başlıksız açılış (hareketFaturasi): üç satır yine çizilir — belge no '—', «yüklenmedi»yi amber not söyler", async () => {
    await ciz({ ...fatura, id: 'hareket|gelen||410', faturaNo: '410', yon: 'gelen', tarih: '', tutar: NaN, kdv: NaN, matrah: NaN, baslikYok: true });
    expect(govdeEtiketleri().slice(0, 3)).toEqual(['Fatura No', 'Belge No', 'Tarih']);
    expect(baslikSatiri('Fatura No').textContent).toBe('Fatura No410');
    expect(baslikSatiri('Belge No').textContent).toBe('Belge No—');
    expect(baslikSatiri('Tarih').textContent).toBe('Tarih—');
    expect(screen.getByText(/Fatura başlığı Cetpa'da yok/)).toBeTruthy();
  });

  it('İngilizce: Invoice No / Document No / Date — tarih biçimi iki dilde AYNI (GG.AA.YYYY)', async () => {
    await ciz(F420, 'en');
    expect(govdeEtiketleri().slice(0, 4)).toEqual(['Invoice No', 'Document No', 'Date', 'Customer']);
    expect(baslikSatiri('Invoice No').textContent).toBe('Invoice No420');
    expect(baslikSatiri('Document No').textContent).toBe('Document NoSZN2026000001284');
    expect(baslikSatiri('Date').textContent).toBe('Date31.08.2026');
  });
});

// ── Rol kapısı: PDF / XML düğmeleri (karar turu 2026-10-11 — K7 / H1, İ3) ─────────────────────────────────────────────
// Düğmeler eskiden HER rolde çiziliydi (yalnız veriyle `disabled`): rolün sunucudaki indirme kapısından geçemediği yerde
// ölü düğmeydi. Artık koşul ortak tablodan (`ucKapisindanGecer`) sorulur ve geçemeyen rolde düğme ÇİZİLMEZ. H1: kapı İKİ
// YÖNDE de aynı (`mikroFaturalar` okuma) — «giden belge Satış'a açık» dalı YOK; faturanın yönü koşula girmez.
describe('MikroFaturaDetay — rol kapısı: PDF / XML düğmeleri (K7 / H1, İ3)', () => {
  const F_UUID: MikroFaturaDetayVerisi = { ...F420, uuid: '11111111-2222-3333-4444-555555555555' };
  const YONLER = ['gelen', 'giden'] as const;
  /** § 10.4 H1'in «geçen» ve «kilitlenen» sütunları ELLE — ortak tablo değişirse bu liste bilerek güncellenir. */
  const GECEN = [UserRole.Admin, UserRole.Manager, UserRole.Accounting];
  const KILITLI = [UserRole.Sales, UserRole.Purchasing, UserRole.Logistics];
  const dugme = (ad: 'PDF' | 'XML' | 'Kapat') => screen.queryByRole('button', { name: ad });
  const ciz = async (rol: UserRole, f: MikroFaturaDetayVerisi) => {
    useAppStore.setState({ userRole: rol });
    authFetch.mockReturnValue(yanit([]));
    const r = render(<MikroFaturaDetay fatura={f} currentLanguage="tr" onClose={() => {}} />);
    await screen.findByText(/stok satırı yok/);
    return r;
  };

  it.each(GECEN.flatMap(rol => YONLER.map(yon => [rol, yon] as const)))('geçen rol %s × %s fatura: PDF ve XML ÇİZİLİR, etkin', async (rol, yon) => {
    await ciz(rol, { ...F_UUID, yon });
    expect((dugme('PDF') as HTMLButtonElement | null)?.disabled).toBe(false);
    expect((dugme('XML') as HTMLButtonElement | null)?.disabled).toBe(false);
    expect(dugme('Kapat')).not.toBeNull();
  });

  it.each(KILITLI.flatMap(rol => YONLER.map(yon => [rol, yon] as const)))('kilitli rol %s × %s fatura: PDF ve XML ÇİZİLMEZ («Kapat» kalır), indirme servisi çağrılmaz', async (rol, yon) => {
    await ciz(rol, { ...F_UUID, yon });
    expect(dugme('PDF')).toBeNull();
    expect(dugme('XML')).toBeNull();
    expect(dugme('Kapat')).not.toBeNull();
    expect(eBelgeIndir).not.toHaveBeenCalled();
    // Pencerenin attığı TEK istek kalem çekimidir; e-belge ucuna giden istek yok.
    expect(authFetch.mock.calls.map(c => c[0])).toEqual(['/api/mikro/fatura/kalemler']);
  });

  it('12 rolün HEPSİ: düğme çizilir ⇔ ortak tablo o ucu geçirir (bileşende kopya rol listesi yok)', async () => {
    expect([...TUM_ROLLER].sort()).toEqual([...APP_ROLES].sort());   // enum ↔ rbac rol listesi: 12 rol, eksik / fazla yok
    for (const rol of TUM_ROLLER) {
      const { unmount } = await ciz(rol, F_UUID);
      expect(dugme('PDF') !== null, `PDF × ${rol}`).toBe(ucKapisindanGecer(rol, 'POST /api/mikro/ebelge/pdf'));
      expect(dugme('XML') !== null, `XML × ${rol}`).toBe(ucKapisindanGecer(rol, 'POST /api/mikro/ebelge/xml'));
      unmount();
    }
    // Döngü boş geçmesin: geçenler tam § 10.4 H1 kümesi (dış roller B2B / Bayi dâhil kalan 9 rol görmez).
    expect(TUM_ROLLER.filter(r => ucKapisindanGecer(r, 'POST /api/mikro/ebelge/pdf')).sort()).toEqual([...GECEN].sort());
    expect(TUM_ROLLER.filter(r => ucKapisindanGecer(r, 'POST /api/mikro/ebelge/xml')).sort()).toEqual([...GECEN].sort());
  });

  it('H1 — Satış × GİDEN fatura: düğme YOK (yöne bağlı ikinci kapı yazılmadı); aynı fatura Muhasebe\'de düğmeli', async () => {
    const { unmount } = await ciz(UserRole.Sales, { ...F_UUID, yon: 'giden' });
    expect(dugme('PDF')).toBeNull();
    expect(dugme('XML')).toBeNull();
    unmount();
    await ciz(UserRole.Accounting, { ...F_UUID, yon: 'giden' });
    expect(dugme('PDF')).not.toBeNull();
    expect(dugme('XML')).not.toBeNull();
  });

  it('geçen rolde tıklama ortak servise gider (tür + kimlikler); servisin döndürdüğü hata pencerede basılır', async () => {
    await ciz(UserRole.Accounting, F_UUID);
    vi.mocked(eBelgeIndir).mockResolvedValueOnce('Belge alınamadı.');
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(await screen.findByText('Belge alınamadı.')).toBeTruthy();
    expect(eBelgeIndir).toHaveBeenLastCalledWith(expect.objectContaining({ tur: 'pdf', uuid: F_UUID.uuid, faturaGuid: 'f420', dosyaAdi: '420' }), true);
    fireEvent.click(screen.getByRole('button', { name: 'XML' }));
    await waitFor(() => expect(eBelgeIndir).toHaveBeenCalledTimes(2));
    expect(eBelgeIndir).toHaveBeenLastCalledWith(expect.objectContaining({ tur: 'xml', uuid: F_UUID.uuid, belgeTuru: 'e-fatura' }), true);
    await waitFor(() => expect(screen.queryByText('Belge alınamadı.')).toBeNull());   // yeni deneme eski hatayı siler
  });

  it('«UUID yok» notu indirme düğmelerini açıklar: geçen rolde VAR (XML kapalı, PDF açık), kilitli rolde düğme de not da YOK', async () => {
    const { unmount } = await ciz(UserRole.Accounting, F420);
    expect(screen.getByText(/PDF Mikro belge numarasıyla denenir/)).toBeTruthy();
    expect((dugme('PDF') as HTMLButtonElement | null)?.disabled).toBe(false);
    expect((dugme('XML') as HTMLButtonElement | null)?.disabled).toBe(true);
    unmount();
    await ciz(UserRole.Purchasing, F420);
    expect(screen.queryByText(/PDF Mikro belge numarasıyla denenir/)).toBeNull();
    expect(dugme('PDF')).toBeNull();
    expect(dugme('XML')).toBeNull();
  });

  it('oturum rolü değişince pencere izler (depo aboneliği): Muhasebe → Satış düğmeleri kaldırır', async () => {
    await ciz(UserRole.Accounting, F_UUID);
    expect(dugme('PDF')).not.toBeNull();
    useAppStore.setState({ userRole: UserRole.Sales });
    await waitFor(() => expect(dugme('PDF')).toBeNull());
    expect(dugme('XML')).toBeNull();
  });
});

// ── H11: başlıksız pencerenin amber notu role göre (karar 2026-10-11) ─────────────────────────────────────────────────
// Başlık `mikroFaturalar`'dan gelir. Okuyamayan rolde (Satış, Satın Alma, Lojistik …) başlık «çekilmemiş» değil, role
// KAPALIDIR: eski metin o role yapamayacağı işi («Faturaları Çek») öneriyordu. Okuyabilen rolde bugünkü metin KALIR.
// Belge No / Tarih satırları role göre DEĞİŞMEZ (`yayin-10` davranışı).
describe('MikroFaturaDetay — H11: başlıksız açılışın amber notu role göre', () => {
  const BASLIKSIZ: MikroFaturaDetayVerisi = { ...fatura, id: 'hareket|gelen||410', faturaNo: '410', yon: 'gelen', tarih: '', tutar: NaN, kdv: NaN, matrah: NaN, baslikYok: true };
  const YETKI = /Fatura başlık bilgisi rolünüze açık değil/;
  const CEKIM = /Fatura başlığı Cetpa'da yok/;
  const ciz = async (rol: UserRole, f: MikroFaturaDetayVerisi = BASLIKSIZ, dil: 'tr' | 'en' = 'tr') => {
    useAppStore.setState({ userRole: rol });
    authFetch.mockReturnValue(yanit([]));
    const r = render(<MikroFaturaDetay fatura={f} currentLanguage={dil} onClose={() => {}} />);
    await screen.findByText(dil === 'tr' ? /stok satırı yok/ : /No stock lines/);
    return r;
  };

  it.each([UserRole.Sales, UserRole.Purchasing, UserRole.Logistics])('başlığı OKUYAMAYAN rol %s: yetkiyi söyler, «Faturaları Çek» ÖNERMEZ', async (rol) => {
    await ciz(rol);
    expect(screen.getByText(YETKI).textContent).toBe("Fatura başlık bilgisi rolünüze açık değil — belge no, toplam ve KDV gösterilmez; kalemler doğrudan Mikro'dan.");
    expect(screen.queryByText(CEKIM)).toBeNull();
    expect(screen.queryByText(/Faturaları Çek/)).toBeNull();
  });

  it.each([UserRole.Admin, UserRole.Manager, UserRole.Accounting])('başlığı OKUYABİLEN rol %s: bugünkü metin KALIR', async (rol) => {
    await ciz(rol);
    expect(screen.getByText(CEKIM).textContent).toBe('Fatura başlığı Cetpa\'da yok ("Faturaları Çek" bu tarihi kapsamamış olabilir) — toplam/KDV bilinmiyor; kalemler doğrudan Mikro\'dan.');
    expect(screen.queryByText(YETKI)).toBeNull();
  });

  it('12 rolün HEPSİ: metin ⇔ `mikroFaturalar` okuma kuralı (ikisi birden ya da hiçbiri basılmaz)', async () => {
    const okuyan: UserRole[] = [];
    for (const rol of TUM_ROLLER) {
      const { unmount } = await ciz(rol);
      const okur = isAllowed(rol, 'mikroFaturalar', 'read');
      if (okur) okuyan.push(rol);
      expect(screen.queryByText(CEKIM) !== null, `çekim metni × ${rol}`).toBe(okur);
      expect(screen.queryByText(YETKI) !== null, `yetki metni × ${rol}`).toBe(!okur);
      unmount();
    }
    expect([...okuyan].sort()).toEqual(['Accounting', 'Admin', 'Manager']);
  });

  it('başlıklı faturada not HİÇBİR rolde yok (not başlıksız açılışa aittir)', async () => {
    for (const rol of [UserRole.Sales, UserRole.Accounting]) {
      const { unmount } = await ciz(rol, F420);
      expect(screen.queryByText(YETKI)).toBeNull();
      expect(screen.queryByText(CEKIM)).toBeNull();
      unmount();
    }
  });

  it('İngilizce: iki metin de çevrilir', async () => {
    const { unmount } = await ciz(UserRole.Sales, BASLIKSIZ, 'en');
    expect(screen.getByText(/not available to your role/).textContent).toBe('Invoice header details are not available to your role — document no, total and VAT are not shown; lines are read directly from Mikro.');
    expect(screen.queryByText(/Invoice header not in Cetpa/)).toBeNull();
    unmount();
    await ciz(UserRole.Accounting, BASLIKSIZ, 'en');
    expect(screen.getByText(/Invoice header not in Cetpa/)).toBeTruthy();
    expect(screen.queryByText(/not available to your role/)).toBeNull();
  });

  it("üst bilgi satırları role göre DEĞİŞMEZ: okuyamayan rolde de üç satır çizilir (başlıksız → Belge No '—', Tarih '—')", async () => {
    await ciz(UserRole.Sales);
    expect(baslikSatiri('Fatura No').textContent).toBe('Fatura No410');
    expect(baslikSatiri('Belge No').textContent).toBe('Belge No—');
    expect(baslikSatiri('Tarih').textContent).toBe('Tarih—');
    // Kalem çekimi role bakmadan yapılır (o ucun kapısı ayrı; pencere yalnız indirme düğmelerini ve notu role bağlar).
    expect(authFetch).toHaveBeenCalledWith('/api/mikro/fatura/kalemler', expect.objectContaining({ body: JSON.stringify({ seri: '', sira: '410', yon: 'gelen' }) }));
  });
});
