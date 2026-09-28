/**
 * FiyatKarsilastirmaPanel.test.tsx — 2026-09-25 kullanıcı bildirimleri, paneli GERÇEKTEN çizerek:
 *  1) "evraka basınca evrak detayları gelmiyor": İşlem Detayı'nda fatura başlığı Cetpa'da YOKKEN de evrak düğmedir ve
 *     faturayı (kalemler Mikro'dan) açar.
 *  2) "bu tip fark olanları listelemem gerekli": koli/adet karışıklığı rozeti + liste; liste evrakı da açar.
 * Yalnız ağ yanıtları sahte; veri kullanıcının ekran görüntüsündeki DAYSON-DYS.029 satırlarıdır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FiyatKarsilastirmaPanel from './FiyatKarsilastirmaPanel';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../services/ebelgeIndir', () => ({ eBelgeIndir: vi.fn() }));

const json = (govde: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(govde) });

const SKU = 'DAYSON-DYS.029';
const satir = {
  sku: SKU, ad: 'DAYSON OTO MASTİK GRİ 280ml(25)',
  alisOrtFiyat: 158.6, alisMiktar: 643, alisTutar: 137812.49, alisBrutTutar: 137812.49, alisIskonto: 0, alisAdet: 4,
  satisOrtFiyat: 154.2, satisMiktar: 340, satisTutar: 52429.17, satisBrutTutar: 52429.17, satisIskonto: 0, satisAdet: 6,
  marjTL: -4.4, marjYuzde: -27, bilinmeyenSatir: 0, alisBilinmeyen: 0, satisBilinmeyen: 0, miktarsizSatir: 0,
  kalanStok: 303, sapmaSayisi: 2,
};
const sapma = (sira: string, tarih: string, miktar: number, birimFiyat: number) => ({ belirsiz: false,
  sku: SKU, ad: satir.ad, tarih, yon: 'alis', miktar, birimFiyat, medyan: 145.83, kat: birimFiyat / 145.83,
  cariKod: '320.07', evrakNo: sira, fatura: { seri: '', sira, yon: 'gelen' },
});
const ozet = { success: true, rows: [satir], iskontoKolonlari: ['sth_iskonto1'], netKaynaklari: {}, sapmalar: [sapma('394', '2026-08-11', 8, 3229.17), sapma('410', '2026-08-19', 10, 3125)] };
const detay = {
  success: true, satirlar: [
    { tarih: '2026-08-19', yon: 'alis', miktar: 10, brutTutar: 31250, iskonto: 0, tutar: 31250, birimFiyat: 3125, kaynak: 'iskontosuz', cariKod: '320.07', evrakNo: '410', fatura: { seri: '', sira: '410', yon: 'gelen' } },
    { tarih: '2026-08-10', yon: 'alis', miktar: 5, brutTutar: 500, iskonto: 0, tutar: 500, birimFiyat: 100, kaynak: 'iskontosuz', cariKod: '320.07', evrakNo: 'I-77', fatura: null },
  ],
};

function yonlendir() {
  authFetch.mockImplementation((url: string) => {
    if (url === '/api/reports/stok-fiyat-karsilastirma') return json(ozet);
    if (url.endsWith('/detay')) return json(detay);
    if (url === '/api/mikro/fatura/kalemler') return json({ success: true, kalemler: [
      { sth_stok_kod: SKU, urunAdi: satir.ad, birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 10, sth_tutar: 31250, sth_vergi: 6250, sth_vergi_pntr: 4 },
    ] });
    return json({ success: false, error: `beklenmeyen istek ${url}` });
  });
}
const cizdir = () => render(
  <FiyatKarsilastirmaPanel currentLanguage="tr" userRole="Admin" fmtKpi={v => `₺${v.toFixed(2)}`} mikroFaturalar={[]} />,
);

beforeEach(() => { authFetch.mockReset(); yonlendir(); });

describe('Fiyat Karşılaştırma — evrak düğmesi fatura başlığı YOKKEN de açar', () => {
  it('İşlem Detayı: fatura anahtarlı satır düğme, faturayı açar (kalemler Mikro\'dan); irsaliye satırı düz metin', async () => {
    cizdir();
    fireEvent.click(await screen.findByText(satir.ad));
    const dugme = await screen.findByRole('button', { name: '410' });
    expect(screen.queryByRole('button', { name: 'I-77' })).toBeNull();        // fatura değil → düğme yok
    expect(screen.getByText('I-77')).toBeTruthy();
    fireEvent.click(dugme);
    expect(await screen.findByText(/Fatura başlığı Cetpa'da yok/)).toBeTruthy();
    const kalemIstegi = authFetch.mock.calls.find(c => c[0] === '/api/mikro/fatura/kalemler');
    expect(kalemIstegi).toBeTruthy();
    expect(JSON.parse(String((kalemIstegi?.[1] as { body?: string } | undefined)?.body))).toEqual({ seri: '', sira: '410', yon: 'gelen' });
  });
});

describe('Fiyat Karşılaştırma — birim şüpheli satırlar (koli/adet)', () => {
  it('ürün satırında ⚠ rozeti; liste düğmesi iki alış faturasını gösterir ve evrakı açar', async () => {
    cizdir();
    expect(await screen.findByText('⚠ 2')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Birim şüpheli satır: 2/ }));
    const liste = (await screen.findByText(/fiyat düzeyinden en az 4 kat/)).closest('.apple-card');
    if (!(liste instanceof HTMLElement)) throw new Error('liste kartı yok');
    expect(within(liste).getByRole('button', { name: '394' })).toBeTruthy();
    fireEvent.click(within(liste).getByRole('button', { name: '410' }));
    expect(await screen.findByText(/Fatura başlığı Cetpa'da yok/)).toBeTruthy();
  });

  it('marj yüzdesi TR biçiminde: "-%27" (kullanıcı kararı "%42 şeklinde")', async () => {
    cizdir();
    expect(await screen.findByText(/\(-%27\)/)).toBeTruthy();
  });

  it('arama iki yönde de Türkçe katlar: "sika" → "SIKAFLEX" (ASCII I) bulunur', async () => {
    authFetch.mockImplementation((url: string) => url === '/api/reports/stok-fiyat-karsilastirma'
      ? json({ ...ozet, rows: [{ ...satir, sku: 'SIKA-11FC', ad: 'SIKAFLEX 11FC GRİ' }], sapmalar: [] }) : json({ success: false }));
    cizdir();
    await screen.findByText('SIKAFLEX 11FC GRİ');
    fireEvent.change(screen.getByPlaceholderText(/SKU veya ürün adı ara/), { target: { value: 'sika' } });
    expect(screen.getByText('SIKAFLEX 11FC GRİ')).toBeTruthy();
  });

  it('arama TÜRKÇE küçük harfle eşler: "mastik" hem ürünü hem şüpheli satırı bulur (İ ↔ i)', async () => {
    cizdir();
    await screen.findByText('⚠ 2');
    fireEvent.change(screen.getByPlaceholderText(/SKU veya ürün adı ara/), { target: { value: 'mastik' } });
    expect(screen.getByText(satir.ad)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Birim şüpheli satır: 2/ })).toBeTruthy();
  });

  it('değerlendirilemeyen ürün (sapmaSayisi null) rozet GÖSTERMEZ — "0 şüpheli" diye de yazmaz', async () => {
    authFetch.mockImplementation((url: string) => url === '/api/reports/stok-fiyat-karsilastirma'
      ? json({ ...ozet, rows: [{ ...satir, sapmaSayisi: null }], sapmalar: [] }) : json({ success: false }));
    cizdir();
    await screen.findByText(satir.ad);
    expect(screen.queryByText(/⚠/)).toBeNull();
  });

  it('arama listeyi de daraltır: eşleşmeyen aramada şüpheli satır düğmesi görünmez', async () => {
    cizdir();
    await screen.findByText('⚠ 2');
    fireEvent.change(screen.getByPlaceholderText(/SKU veya ürün adı ara/), { target: { value: 'çimento' } });
    expect(screen.queryByRole('button', { name: /Birim şüpheli satır/ })).toBeNull();
  });
});

// ── Mikro kaydı kendi içinde tutarsız (evrak 420/435, 2026-09-26) ─────────────────────────────────────────────────
// Kullanıcı: "net tutar iskontolu halde göstermeli". SİZGEN YAPI e-faturası: 1.050 × 270 = 283.500 brüt, iskonto
// 114.817,50, net 168.682,50, KDV %20 = 33.736,50. Mikro evrak 420: sth_tutar 398.317,50 (iskonto brüte bir kez daha
// eklenmiş). Sunucu (lib/stokFiyat.mikroTutarsizliklari + ad) bu satırları `tutarsizliklar` dizisiyle gönderir.
describe('Fiyat Karşılaştırma — Mikro\'da düzeltilecek (iskonto brüte bir kez daha eklenmiş)', () => {
  const RULO = 'RULO1081';
  const ruloSatir = { ...satir, sku: RULO, ad: 'RULO ŞERİT 10x8', sapmaSayisi: 0, alisOrtFiyat: 160.65 };
  const tutarsiz = (sira: string, tarih: string, miktar: number, mikroTutar: number, iskonto: number, kdv: number, net: number, oran: number | null) => ({
    sku: RULO, ad: ruloSatir.ad, tarih, yon: 'alis', miktar, fatura: { seri: '', sira, yon: 'gelen' }, evrakNo: sira, cariKod: '320.11',
    oran, mikroTutar, iskonto, kdv, net, mikroNet: mikroTutar - iskonto, fazla: iskonto,
  });
  const t420 = tutarsiz('420', '2026-08-31', 1050, 398317.5, 114817.5, 33736.5, 168682.5, 20);
  const t435 = tutarsiz('435', '2026-09-02', 2, 758.7, 218.7, 64.26, 321.3, null);
  const ozetT = { ...ozet, rows: [ruloSatir, satir], tutarsizliklar: [t420, t435],
    netKaynaklari: { satirIskontosu: 4, mikroKaydiTutarsiz: 2, faturaAltiKdvden: 1 } };
  const detayT = { success: true, satirlar: [
    { tarih: '2026-08-31', yon: 'alis', miktar: 1050, brutTutar: 283500, iskonto: 114817.5, tutar: 168682.5, birimFiyat: 160.65,
      kaynak: 'mikroKaydiTutarsiz', mikroTutar: 398317.5, cariKod: '320.11', evrakNo: '420', fatura: { seri: '', sira: '420', yon: 'gelen' } },
    { tarih: '2026-08-20', yon: 'alis', miktar: 10, brutTutar: 2700, iskonto: 270, tutar: 2430, birimFiyat: 243,
      kaynak: 'faturaAltiKdvden', cariKod: '320.11', evrakNo: '401', fatura: { seri: '', sira: '401', yon: 'gelen' } },
    { tarih: '2026-08-10', yon: 'alis', miktar: 10, brutTutar: 2700, iskonto: 0, tutar: 2700, birimFiyat: 270,
      kaynak: 'iskontosuz', cariKod: '320.11', evrakNo: '390', fatura: { seri: '', sira: '390', yon: 'gelen' } },
  ] };
  const yonlendirT = (govde: unknown = ozetT) => authFetch.mockImplementation((url: string) => {
    if (url === '/api/reports/stok-fiyat-karsilastirma') return json(govde);
    if (url.endsWith('/detay')) return json(detayT);
    if (url === '/api/mikro/fatura/kalemler') return json({ success: true, kalemler: [
      { sth_stok_kod: RULO, urunAdi: ruloSatir.ad, birim: 'ADET', sth_birim_pntr: 1, sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5, sth_vergi: 33736.5, sth_vergi_pntr: 4 },
    ] });
    return json({ success: false, error: `beklenmeyen istek ${url}` });
  });
  const dugmeT = () => screen.findByRole('button', { name: /Mikro'da düzeltilecek: 2/ });
  const kartT = async () => {
    fireEvent.click(await dugmeT());
    const kart = (await screen.findByText(/satır tutarı e-faturadaki Mal Hizmet Tutarı olmalı/)).closest('.apple-card');
    if (!(kart instanceof HTMLElement)) throw new Error('tutarsızlık kartı yok');
    return kart;
  };

  beforeEach(() => { yonlendirT(); });

  it('liste: evrak 420 satırı Mikro tutarı / iskonto / KDV (%20) / DOĞRU net / Mikro\'nun fazlası; fazlası büyük olan önce', async () => {
    cizdir();
    const kart = await kartT();
    expect(kart.textContent).toContain("Düzeltince Stok Hareketleri + Faturalar yeniden çekilir.");
    const satirlar = within(kart).getAllByRole('row').slice(1);             // başlık hariç
    expect(satirlar).toHaveLength(2);
    const hucre = (tr: HTMLElement) => within(tr).getAllByRole('cell').map(c => c.textContent ?? '');
    const [urun, tarih, evrak, mikroTutar, iskonto, kdv, net, fazla] = hucre(satirlar[0]);
    expect(urun).toContain(RULO);
    expect(tarih).toBe('2026-08-31');
    expect(evrak).toBe('420');
    expect(mikroTutar).toBe('₺398317.50');
    expect(iskonto).toBe('₺114817.50');
    expect(kdv).toBe('₺33736.50 (%20)');
    expect(net).toBe('₺168682.50');
    expect(fazla).toBe('₺114817.50');
    // 435: oran bilinmiyor → yalnız tutar, sahte "%0" YOK
    expect(hucre(satirlar[1])[5]).toBe('₺64.26');
    expect(hucre(satirlar[1])[2]).toBe('435');
  });

  it('evrak düğmesi faturayı açar (kalemler Mikro\'dan, fatura anahtarıyla)', async () => {
    cizdir();
    const kart = await kartT();
    fireEvent.click(within(kart).getByRole('button', { name: '420' }));
    expect(await screen.findByText(/Fatura başlığı Cetpa'da yok/)).toBeTruthy();
    const kalemIstegi = authFetch.mock.calls.find(c => c[0] === '/api/mikro/fatura/kalemler');
    expect(JSON.parse(String((kalemIstegi?.[1] as { body?: string } | undefined)?.body))).toEqual({ seri: '', sira: '420', yon: 'gelen' });
  });

  it('iki amber düğme TEK ml-auto sarmalayıcıda; birim şüpheli kartı ayrı kalır', async () => {
    cizdir();
    const t = await dugmeT();
    const s = screen.getByRole('button', { name: /Birim şüpheli satır: 2/ });
    expect(t.parentElement).toBe(s.parentElement);
    expect(t.parentElement?.className).toMatch(/\bml-auto\b/);
    expect(t.className).not.toMatch(/\bml-auto\b/);
    expect(s.className).not.toMatch(/\bml-auto\b/);
    const kart = await kartT();
    expect(within(kart).queryByText(/fiyat düzeyinden en az 4 kat/)).toBeNull();
    fireEvent.click(s);
    const sapmaKarti = (await screen.findByText(/fiyat düzeyinden en az 4 kat/)).closest('.apple-card');
    expect(sapmaKarti).not.toBe(kart);
  });

  it('ürün rozeti: tutarsız satırı olan üründe "⚠ Mikro 2"; olmayan üründe yok', async () => {
    cizdir();
    const rozet = await screen.findByText('⚠ Mikro 2');
    expect(rozet.getAttribute('title')).toMatch(/2 satırın Mikro kaydı tutarsız/);
    expect(rozet.closest('tr')?.textContent).toContain(RULO);
    expect(screen.getAllByText(/^⚠ Mikro \d+$/)).toHaveLength(1);        // DAYSON satırında yok
  });

  it('tur 3: sunucu tutarsizlikEnAz → rozet ALT SINIR ("⚠ Mikro ≥2"), açıklama kesin sayı iddia etmez (sr-only kardeşte de)', async () => {
    yonlendirT({ ...ozetT, rows: [{ ...ruloSatir, tutarsizlikSayisi: 2, tutarsizlikEnAz: true }, satir] });
    cizdir();
    const rozet = await screen.findByText('⚠ Mikro ≥2');
    const baslik = rozet.getAttribute('title') ?? '';
    expect(baslik).toMatch(/^En az 2 satırın Mikro kaydı tutarsız/);
    expect(baslik).toMatch(/hükme bağlanamadı/);
    expect(baslik).not.toMatch(/ortalama ve marj iskontolu \(KDV'den\) netle hesaplandı/);
    expect(screen.getAllByText(/^En az 2 satırın Mikro kaydı tutarsız/).some(e => e.className.includes('sr-only'))).toBe(true);
  });

  it('tur 3: rozet sayısı sunucunun tutarsizlikSayisi değeri (istemci listesinden saymak yalnız eski sunucu yedeği)', async () => {
    yonlendirT({ ...ozetT, rows: [{ ...ruloSatir, tutarsizlikSayisi: 3, tutarsizlikEnAz: false }, satir] });
    cizdir();
    expect(await screen.findByText('⚠ Mikro 3')).toBeTruthy();
    expect(screen.queryByText('⚠ Mikro 2')).toBeNull();
  });

  it('delta 2: sunucu tutarsizlikSayisi = null (hüküm VERİLEMEDİ) → gri "? Mikro" rozeti, açıklama ortalama/marjın kesin olmadığını söyler; 0 → rozet yok', async () => {
    yonlendirT({ ...ozetT, rows: [{ ...ruloSatir, tutarsizlikSayisi: 0, tutarsizlikEnAz: false }, { ...satir, tutarsizlikSayisi: null, tutarsizlikEnAz: false }] });
    cizdir();
    const rozet = await screen.findByText('? Mikro');
    expect(rozet.closest('tr')?.textContent).toContain(satir.ad);
    const baslik = rozet.getAttribute('title') ?? '';
    expect(baslik).toMatch(/hükme bağlanamadı/);
    expect(baslik).toMatch(/ortalama ve marj kesin değil/);
    expect(screen.getAllByText(/hükme bağlanamadı/).some(e => e.className.includes('sr-only'))).toBe(true);
    expect(screen.queryByText(/^⚠ Mikro ≥?\d+$/)).toBeNull();            // RULO: sunucu 0 dedi — istemci listesine düşülmez
    expect(screen.getAllByText('? Mikro')).toHaveLength(1);
  });

  it('arama listeyi de daraltır: "rulo" listeyi tutar, "çimento" düğmeyi gizler', async () => {
    cizdir();
    await dugmeT();
    fireEvent.change(screen.getByPlaceholderText(/SKU veya ürün adı ara/), { target: { value: 'rulo' } });
    expect(screen.getByRole('button', { name: /Mikro'da düzeltilecek: 2/ })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/SKU veya ürün adı ara/), { target: { value: 'çimento' } });
    expect(screen.queryByRole('button', { name: /Mikro'da düzeltilecek/ })).toBeNull();
  });

  it('eski sunucu yanıtı (tutarsizliklar alanı yok): düğme ve rozet yok, çökme yok', async () => {
    yonlendirT({ ...ozet, rows: [ruloSatir] });
    cizdir();
    await screen.findByText(ruloSatir.ad);
    expect(screen.queryByRole('button', { name: /Mikro'da düzeltilecek/ })).toBeNull();
    expect(screen.queryByText(/^⚠ Mikro \d+$/)).toBeNull();
  });

  it('altbilgi: mikroKaydiTutarsiz sayılır; faturaAltiKdvden artık "fatura başlığı yok" DEMEZ', async () => {
    cizdir();
    const alt = await screen.findByText(/Net tutar nasıl belirlendi/);
    expect(alt.textContent).toContain("2 satır Mikro kaydı tutarsız — net KDV'den, iskontolu");
    expect(alt.textContent).toContain("1 satır fatura altı iskonto satırın KDV'sinden türetildi (fatura başlığıyla doğrulanamadı)");
    expect(alt.textContent).not.toMatch(/başlığı yok|bulunamadı/);
  });

  it('İşlem Detayı: mikroKaydiTutarsiz satırında ⚠ + "Mikro kaydında satır tutarı ₺398317.50" ipucu; net iskontolu', async () => {
    cizdir();
    fireEvent.click(await screen.findByText(ruloSatir.ad));
    const uyari = await screen.findByTitle(/^Mikro kaydında satır tutarı ₺398317\.50; iskonto brüte bir kez daha eklenmiş — net satırın KDV'sinden/);
    expect(uyari.textContent).toContain('⚠');
    // Ekran okuyucu: rolsüz span'daki aria-label yok sayılır → role="img" şart (kardeş bileşenlerle aynı).
    expect(uyari.getAttribute('role')).toBe('img');
    expect(uyari.getAttribute('aria-label')).toBe(uyari.getAttribute('title'));
    // Dokunmatik/mobil: title açılmaz, Brüt/Evrak kolonları gizli → ipucu sm altı ekranda satırda YAZILI.
    const mobil = uyari.parentElement?.querySelector('.sm\\:hidden');
    expect(mobil?.textContent).toBe(uyari.getAttribute('title'));
    const tr420 = uyari.closest('tr');
    if (!(tr420 instanceof HTMLElement)) throw new Error('satır yok');
    expect(tr420.textContent).toContain('₺168682.50');                     // net = iskontolu (KDV'den)
    expect(tr420.textContent).toContain('₺160.65');
    // yalnız bu kaynakta: diğer satırlarda Mikro-tutarsız ipucu yok
    expect(screen.getAllByTitle(/Mikro kaydında satır tutarı/)).toHaveLength(1);
    expect(screen.getAllByTitle(/iskonto brüte bir kez daha eklenmiş/)).toHaveLength(1);   // ⚠ yalnız 420 satırında
    // faturaAltiKdvden ipucu başlığın varlığı hakkında hüküm vermez
    const kdvden = screen.getAllByTitle(/satırın KDV'sinden türetildi/);
    expect(kdvden.length).toBeGreaterThan(0);
    for (const e of kdvden) expect(e.getAttribute('title')).not.toMatch(/başlığı bulunamadı|başlığı yok|no invoice header/);
  });

  it('İşlem Detayı: eski sunucu (mikroTutar yok) → ipucu tutar uydurmaz', async () => {
    authFetch.mockImplementation((url: string) => {
      if (url === '/api/reports/stok-fiyat-karsilastirma') return json(ozetT);
      if (url.endsWith('/detay')) return json({ success: true, satirlar: [{ ...detayT.satirlar[0], mikroTutar: undefined }] });
      return json({ success: false });
    });
    cizdir();
    fireEvent.click(await screen.findByText(ruloSatir.ad));
    const uyari = await screen.findByTitle(/iskonto brüte bir kez daha eklenmiş — net satırın KDV'sinden/);
    expect(uyari.getAttribute('title')).not.toMatch(/₺|NaN|undefined/);
  });
});
