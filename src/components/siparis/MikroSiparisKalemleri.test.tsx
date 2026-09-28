/**
 * MikroSiparisKalemleri + useMikroSiparisKalemleri — MF-383 (2026-09-25 "sipariş kalemleri gelmemiş"): kalemleri
 * Cetpa'ya aktarılmamış Mikro faturası siparişinde kalemler Mikro'dan canlı okunur, NET ve KDV HARİÇ gösterilir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, waitFor } from '@testing-library/react';
import MikroSiparisKalemleri from './MikroSiparisKalemleri';
import { useMikroSiparisKalemleri } from '../../hooks/useMikroSiparisKalemleri';
import { kalemleriMikrodanOkunacak, mikroKalemNotlari, mikroKalemTablosu, kayitliKalemTablosu, kayitliMikroKalemleri } from '../../services/mikroFaturaKalemleri';

const authFetch = vi.fn();
vi.mock('../../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

const kalem = (p: Record<string, unknown>) => ({ sth_stok_kod: 'CIM-50', urunAdi: 'ÇİMENTO 50KG', birim: 'ADET', sth_miktar: 100, sth_tutar: 12500, sth_vergi: 2500, sth_vergi_pntr: 4, ...p });

beforeEach(() => authFetch.mockReset());

describe('kalemleriMikrodanOkunacak — yalnız kalemsiz Mikro faturası siparişi', () => {
  it('MF + boş kalem + geçerli sıra → giden evrak; kalemi olan, native ya da sırasız → null', () => {
    const mf = { source: 'mikro-fatura', lineItems: [], mikroEvrak: { seri: '', sira: '383' } };
    expect(kalemleriMikrodanOkunacak(mf)).toEqual({ seri: '', sira: '383', yon: 'giden' });
    expect(kalemleriMikrodanOkunacak({ ...mf, lineItems: [{}] })).toBeNull();
    expect(kalemleriMikrodanOkunacak({ ...mf, source: undefined })).toBeNull();
    expect(kalemleriMikrodanOkunacak({ ...mf, mikroEvrak: { seri: '', sira: '' } })).toBeNull();
    expect(kalemleriMikrodanOkunacak({ ...mf, mikroEvrak: { seri: '', sira: "1; DROP" } })).toBeNull();
    expect(kalemleriMikrodanOkunacak(null)).toBeNull();
  });
});

describe('useMikroSiparisKalemleri', () => {
  it('Mikro\'dan seri+sıra+yön ile çeker; gerekmeyen siparişte istek ATMAZ', async () => {
    authFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, kalemler: [kalem({})] }) });
    const { result } = renderHook(() => useMikroSiparisKalemleri({ source: 'mikro-fatura', lineItems: [], mikroEvrak: { seri: '', sira: '383' } }, true));
    expect(result.current.durum).toBe('yukleniyor');
    await waitFor(() => expect(result.current.durum).toBe('hazir'));
    expect(result.current.kalemler).toHaveLength(1);
    expect(JSON.parse(String(authFetch.mock.calls[0][1].body))).toEqual({ seri: '', sira: '383', yon: 'giden' });
    authFetch.mockClear();
    const { result: yok } = renderHook(() => useMikroSiparisKalemleri({ source: 'shopify', lineItems: [] }, true));
    expect(yok.current.durum).toBe('gerekmez');
    expect(authFetch).not.toHaveBeenCalled();
  });
  it('sunucu hatası → durum hata + metin (sessiz boş liste DEĞİL)', async () => {
    authFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({ success: false, error: 'Fatura kalemleri alınamadı.' }) });
    const { result } = renderHook(() => useMikroSiparisKalemleri({ source: 'mikro-fatura', lineItems: [], mikroEvrak: { seri: '', sira: '383' } }, true));
    await waitFor(() => expect(result.current.durum).toBe('hata'));
    expect(result.current.hata).toBe('Fatura kalemleri alınamadı.');
  });
});

describe('MikroSiparisKalemleri — tablo', () => {
  it('NET ve KDV HARİÇ satırlar + ara toplam, KDV, fatura genel toplamı; evrak no notta', () => {
    render(<MikroSiparisKalemleri durum="hazir" kalemler={[kalem({})]} hata={null} genelToplam={15000} evrakNo="383" dil="tr" />);
    expect(screen.getByText('ÇİMENTO 50KG')).toBeTruthy();
    expect(screen.getByText(/evrak 383/)).toBeTruthy();
    expect(screen.getAllByText(/^₺12\.500,00$/).length).toBe(2);                 // satır neti + ara toplam
    expect(screen.getByText(/^₺125,00$/)).toBeTruthy();                           // birim = 12.500 / 100
    expect(screen.getByText(/^₺2\.500,00$/)).toBeTruthy();                        // KDV
    expect(screen.getByText(/^₺15\.000,00$/)).toBeTruthy();                       // fatura genel toplamı
  });
  it('yükleniyor / hata durumları metinle', () => {
    const { rerender } = render(<MikroSiparisKalemleri durum="yukleniyor" kalemler={[]} hata={null} genelToplam={1} evrakNo="1" dil="tr" />);
    expect(screen.getByText(/yükleniyor/)).toBeTruthy();
    rerender(<MikroSiparisKalemleri durum="hata" kalemler={[]} hata="Sunucuya ulaşılamadı." genelToplam={1} evrakNo="1" dil="tr" />);
    expect(screen.getByText('Sunucuya ulaşılamadı.')).toBeTruthy();
  });
});

describe('notlar — ekran ve fiş aynı metni basar (inceleme 2026-09-25)', () => {
  it('tutan faturada not YOK; KDV okunamayan kalem ve tutmayan sağlama yazılır', () => {
    expect(mikroKalemNotlari(0, 0, { net: 12500, kdv: 2500, masraf: 0, iskonto: 0, kalemToplami: 15000, fark: 0, tutuyor: true, eksik: 0 }, 'tr')).toEqual([]);
    const n = mikroKalemNotlari(1, 2, { net: 12500, kdv: 2500, masraf: 0, iskonto: 0, kalemToplami: 15000, fark: -1500, tutuyor: false, eksik: 0 }, 'tr');
    expect(n[0]).toMatch(/1 kalemin tutarı çözülemedi — brüt, iskonto ve ara toplama girmedi/);
    expect(n[1]).toMatch(/2 kalemin KDV'si okunamadı/);
    expect(n[2]).toMatch(/Sağlama tutmuyor/);
  });
  it('tabloda: tevkifatlı fatura (ara + KDV ≠ genel toplam) açıklamalı; KDV okunamayan kalem sayılır', () => {
    render(<MikroSiparisKalemleri durum="hazir" kalemler={[kalem({}), kalem({ sth_stok_kod: 'KUM', urunAdi: 'KUM', sth_tutar: 1000, sth_vergi: null })]} hata={null} genelToplam={13500} evrakNo="384" dil="tr" />);
    expect(screen.getByText(/1 kalemin KDV'si okunamadı/)).toBeTruthy();
  });
  it('tutmayan sağlama (tüm alanlar okunuyor) ekranda açıklanır', () => {
    render(<MikroSiparisKalemleri durum="hazir" kalemler={[kalem({})]} hata={null} genelToplam={14000} evrakNo="385" dil="tr" />);
    expect(screen.getByText(/Sağlama tutmuyor/)).toBeTruthy();
  });
});

// K-İSKONTO (2026-09-25, kullanıcı: "iskontoları atlama"): ekran ve fiş yalnız neti basıyordu, iskonto görünmüyordu.
describe('mikroKalemTablosu — liste birim fiyatı → iskonto → net (ekran + fiş ORTAK model)', () => {
  const tarih = { sth_tarih: '2025-03-10' };
  it('satır iskontosu: birim fiyat BRÜT ÷ miktar, iskonto ve net ayrı; alt toplamlar brüt / iskonto / net', () => {
    const t = mikroKalemTablosu([kalem({ ...tarih, sth_miktar: 10, sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180 })], 1080, 'tr');
    expect(t.satirlar[0]).toMatchObject({ ad: 'ÇİMENTO 50KG', sku: 'CIM-50', miktarMetni: '10 ADET', birimFiyat: 100, iskonto: 100, net: 900, faturaAltiKaynagi: null });
    expect(t.brut.toplam).toBe(1000);
    expect(t.iskonto.toplam).toBe(100);
    expect(t.ara.toplam).toBe(900);
    expect(t.kdv.toplam).toBe(180);
    expect(t.notlar).toEqual([]);
  });
  // İnceleme 2026-09-25: iki fatura altı kaynağı aynı cümleyle basılıyordu; KDV'den tahmin doğrulanmış gibi görünüyordu.
  it("FATURA ALTI iskonto: başlıkla doğrulanan 'baslik' ve KDV'den TAHMİN edilen 'kdv' AYRI notla", () => {
    // 100 × 22,40 = 2.240 brüt; fatura altı %10 → net 2.016; KDV %20 = 403,20 (stokFiyat evrak 48 vakası)
    const satir = kalem({ ...tarih, sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2 });
    const baslikli = mikroKalemTablosu([satir], 2419.2, 'tr');
    expect(baslikli.satirlar[0].faturaAltiKaynagi).toBe('baslik');
    expect(baslikli.satirlar[0].birimFiyat).toBeCloseTo(22.4, 4);
    expect(baslikli.satirlar[0].iskonto).toBeCloseTo(224, 2);
    expect(baslikli.satirlar[0].net).toBeCloseTo(2016, 2);
    expect(baslikli.notlar).toEqual([expect.stringMatching(/fatura toplamından satırlara dağıtıldı/)]);
    const basliksiz = mikroKalemTablosu([satir], undefined, 'tr');
    expect(basliksiz.satirlar[0].faturaAltiKaynagi).toBe('kdv');
    expect(basliksiz.notlar).toEqual([expect.stringMatching(/KDV'sinden TAHMİN edildi/)]);
    // Aynı satır, başlık iskonto olmadığını gösterirse: kaynak yok, not yok.
    const iskontosuz = mikroKalemTablosu([kalem({ ...tarih, sth_miktar: 10, sth_tutar: 1000, sth_vergi: 180 })], 1180, 'tr');
    expect(iskontosuz.satirlar[0]).toMatchObject({ faturaAltiKaynagi: null, iskonto: 0 });
    // Tur 2 (2026-09-28): pntr 4 (%20) ama KDV 180 = %18 → fatura detayı "KDV oranıyla tutmuyor" der; tablo + fiş de AYNI uyarıyı basar.
    expect(iskontosuz.notlar).toEqual(["1 kalemde KDV satırın KDV oranıyla tutmuyor — net doğrulanamadı; Mikro kaydını kontrol edin."]);
  });
  it('miktarı 0 olan satırda (fiyat farkı) birim fiyat YOK ("—"), tutar yine sayılır; genel toplam bilinmiyorsa masraf null (0 uydurulmaz)', () => {
    const t = mikroKalemTablosu([kalem({ ...tarih, sth_miktar: 0, sth_tutar: 50, sth_vergi: 10 })], null, 'tr');
    expect(t.satirlar[0].birimFiyat).toBeNull();
    expect(t.masraf).toBeNull();
  });
});

describe('MikroSiparisKalemleri — iskonto sütunu ve alt satırları', () => {
  it('iskontolu faturada "İskonto" sütunu −₺100,00, brüt toplam ₺1.000,00 ve ara toplam (net) ₺900,00 basılır', () => {
    render(<MikroSiparisKalemleri durum="hazir" kalemler={[kalem({ sth_tarih: '2025-03-10', sth_miktar: 10, sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180 })]} hata={null} genelToplam={1080} evrakNo="390" dil="tr" />);
    expect(screen.getByText('İskonto', { selector: 'th' })).toBeTruthy();
    expect(screen.getAllByText(/^−₺100,00$/).length).toBe(2);        // satır + alt toplam
    expect(screen.getByText('Brüt toplam (KDV hariç)')).toBeTruthy();
    expect(screen.getByText(/^₺1\.000,00$/)).toBeTruthy();
    expect(screen.getAllByText(/^₺900,00$/).length).toBe(2);          // satır neti + ara toplam
  });
  // İnceleme 2026-09-25: tutarı çözülemeyen kalem varken iskonto satırı "−₺0,00" (ya da "−—") basıyordu — sahte kesinlik.
  it('çözülemeyen kalem varken brüt/iskonto satırı AÇILMAZ ("−₺0,00" yok); not "brüt, iskonto ve ara toplama girmedi"', () => {
    render(<MikroSiparisKalemleri durum="hazir" kalemler={[kalem({ sth_tarih: '2025-03-10', sth_tutar: null, sth_vergi: 40 }), kalem({ sth_tarih: '2025-03-10', sth_miktar: 10, sth_tutar: 1000, sth_vergi: 200 })]} hata={null} genelToplam={1440} evrakNo="391" dil="tr" />);
    expect(screen.queryByText('Brüt toplam (KDV hariç)')).toBeNull();
    expect(screen.queryByText(/^−₺0,00$/)).toBeNull();
    expect(screen.getByText(/1 kalemin tutarı çözülemedi — brüt, iskonto ve ara toplama girmedi/)).toBeTruthy();
  });
  it('iskontosuz faturada brüt/iskonto alt satırları YOK; satırın iskonto hücresi ₺0,00', () => {
    render(<MikroSiparisKalemleri durum="hazir" kalemler={[kalem({ sth_tarih: '2025-03-10' })]} hata={null} genelToplam={15000} evrakNo="383" dil="tr" />);
    expect(screen.queryByText('Brüt toplam (KDV hariç)')).toBeNull();
    expect(screen.getByText(/^₺0,00$/)).toBeTruthy();
  });
});

// 2026-09-25: faturadan-sipariş importu artık sürüm-2 kalem YAZIYOR (inventoryMovements + lib/stokFiyat). Detay ve fiş
// o kalemi canlı okumayla AYNI tabloyla basar; seçim TEK kural (kayitliMikroKalemleri).
describe('kalıcı (sürüm-2) MF kalemi — canlı okumayla aynı tablo', () => {
  const k2 = (p: Record<string, unknown>) => ({ sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 10, brutTutar: 1000, iskonto: 100,
    netTutar: 900, kdv: 180, masraf: 0, netKaynagi: 'satirIskontosu', total: 1080, kalemSurumu: 2, ...p });
  it('kayitliMikroKalemleri: yalnız MF + TÜM kalemler sürüm 2; eski/karışık/native/kalemsiz → null', () => {
    expect(kayitliMikroKalemleri({ source: 'mikro-fatura', lineItems: [k2({})] })).toHaveLength(1);
    expect(kayitliMikroKalemleri({ source: 'mikro-fatura', lineItems: [k2({}), { sku: 'eski', total: 5 }] })).toBeNull();
    expect(kayitliMikroKalemleri({ source: 'mikro-fatura', lineItems: [] })).toBeNull();
    expect(kayitliMikroKalemleri({ source: undefined, lineItems: [k2({})] })).toBeNull();
  });
  it('kayitliKalemTablosu: ham tabloyla AYNI alanlar; sağlama tutuyorsa not yok; tutmuyorsa "Sağlama tutmuyor"', () => {
    const t = kayitliKalemTablosu([k2({})], 1080, 'tr');
    expect(t.satirlar[0]).toMatchObject({ ad: 'ÇİMENTO 50KG', miktarMetni: '10', birimFiyat: 100, iskonto: 100, net: 900, faturaAltiKaynagi: null });
    expect([t.brut.toplam, t.iskonto.toplam, t.ara.toplam, t.kdv.toplam, t.masraf]).toEqual([1000, 100, 900, 180, 0]);
    expect(t.notlar).toEqual([]);
    expect(kayitliKalemTablosu([k2({})], 1500, 'tr').notlar.some(n => /Sağlama tutmuyor/.test(n))).toBe(true);
    expect(kayitliKalemTablosu([k2({ netKaynagi: 'faturaAltiKdvden' })], 1080, 'tr').notlar.some(n => /TAHMİN edildi/.test(n))).toBe(true);
  });
  // Delta hakem 2026-09-25: kayıtlı sağlama ham yolla (kalemSaglamasi) AYNI olmalı — KDV mutlak değer, masraf her satırdan.
  it('kayıtlı ve ham tablo aynı veride AYNI sağlamayı verir: negatif KDV (iade satırı) ve masraflı satır', () => {
    const ham = [
      { sth_tarih: '2025-03-10', sth_stok_kod: 'A', sth_miktar: 1, sth_tutar: 100, sth_vergi: -20 },
      { sth_tarih: '2025-03-10', sth_stok_kod: 'B', sth_miktar: 1, sth_tutar: 1000, sth_masraf1: 50, sth_vergi: 210 },
    ];
    // Kalıcı kalem, importun yazacağı biçimde (mfKalemleri ile aynı alanlar).
    const kayitli = [
      k2({ sku: 'A', quantity: 1, brutTutar: 100, iskonto: 0, netTutar: 100, kdv: -20, masraf: 0 }),
      k2({ sku: 'B', quantity: 1, brutTutar: 1000, iskonto: 0, netTutar: 1000, kdv: 210, masraf: 50 }),
    ];
    for (const meblag of [1380, 1500]) {
      const a = mikroKalemTablosu(ham, meblag, 'tr'), b = kayitliKalemTablosu(kayitli, meblag, 'tr');
      expect(b.notlar).toEqual(a.notlar);
      expect(b.masraf).toBe(a.masraf);
    }
    expect(kayitliKalemTablosu(kayitli, 1380, 'tr').notlar).toEqual([]);   // 100 + 1000 + 50 + |−20| + 210 = 1.380
  });

  it('bileşen kayitli ile canlı okuma YAPMAZ, "aktarıldı" der ve iskonto sütununu basar', () => {
    render(<MikroSiparisKalemleri durum="yukleniyor" kalemler={[]} kayitli={[k2({})]} hata={null} genelToplam={1080} evrakNo="383" dil="tr" />);
    expect(screen.getByText(/Mikro faturasından \(evrak 383\) aktarıldı/)).toBeTruthy();
    expect(screen.queryByText(/yükleniyor/)).toBeNull();
    expect(screen.getAllByText(/^−₺100,00$/).length).toBe(2);
    expect(authFetch).not.toHaveBeenCalled();
  });
});

// D6 (2026-09-26, kullanıcı: "net tutar iskontolu halde göstermeli"): Mikro kaydı KENDİ İÇİNDE tutarsız (evrak 420 —
// iskonto brüte bir kez daha eklenmiş). Net satırın KDV'sinden (iskontolu); satır ⚠ ile işaretlenir; "Sağlama tutmuyor"
// yerine Mikro'da düzeltme notu basılır (tutarsızlık kalem netinde değil Mikro kaydında).
describe('Mikro kaydı tutarsız kalem (evrak 420 / 435) — ekran + fiş ORTAK model', () => {
  const k420 = { sth_stok_kod: 'RULO1081', urunAdi: 'RULO 1081', birim: 'ADET', sth_tarih: '2026-08-31', sth_evraktip: 3,
    sth_evrakno_sira: 420, sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5, sth_vergi: 33736.5, sth_vergi_pntr: 4 };
  const k435 = { ...k420, sth_evrakno_sira: 435, sth_miktar: 2, sth_tutar: 758.7, sth_iskonto1: 162, sth_iskonto2: 56.7, sth_vergi: 64.26 };
  const NOT_420 = /^1 kalemde Mikro kaydı tutarsız — net satırın KDV'sinden \(iskontolu\); faturayı Mikro'da düzeltin/;
  // Kalıcı kalem, importun (eslemeFatura.mfKalemleri) yazacağı biçimde.
  // Importun yazdığı biçim — tur 2 satır bayrakları dâhil (bayraksız kalemde "kalem netleri doğru" hükmü verilmez).
  const kay = (p: Record<string, unknown>) => ({ kdvUyumsuz: false, ciftIskontoBelirsiz: false, sku: 'RULO1081', name: 'RULO 1081', quantity: 1050, brutTutar: 283500, iskonto: 114817.5,
    netTutar: 168682.5, kdv: 33736.5, masraf: 0, netKaynagi: 'mikroKaydiTutarsiz', total: 202419, kalemSurumu: 2, ...p });

  it('ham 420: satır mikroTutarsiz, net 168.682,50 (iskontolu), brüt birim 270; not Mikro düzeltmesi, "Sağlama tutmuyor" YOK', () => {
    const t = mikroKalemTablosu([k420], 317236.5, 'tr');
    expect(t.satirlar[0].mikroTutarsiz).toBe(true);
    expect(t.satirlar[0].faturaAltiKaynagi).toBeNull();                  // anlamı DEĞİŞMEZ ('baslik'/'kdv' değil)
    expect(t.satirlar[0].net).toBeCloseTo(168682.5, 2);
    expect(t.satirlar[0].iskonto).toBeCloseTo(114817.5, 2);
    expect(t.satirlar[0].birimFiyat).toBeCloseTo(270, 4);
    expect(t.ara.toplam).toBeCloseTo(168682.5, 2);
    expect(t.notlar.some(n => NOT_420.test(n))).toBe(true);
    expect(t.notlar.some(n => /Sağlama tutmuyor/.test(n))).toBe(false);
    expect(t.notlar.some(n => /KDV ile tutarlı toplam ₺202\.419,00.*₺317\.236,50.*fark ₺114\.817,50/.test(n))).toBe(true);
  });
  it('ham 435 aynı desen; tutarlı satır iskontosu ve iskontosuz satır mikroTutarsiz DEĞİL, not yok', () => {
    const t = mikroKalemTablosu([k435], 604.26, 'tr');
    expect(t.satirlar[0].mikroTutarsiz).toBe(true);
    expect(t.satirlar[0].net).toBeCloseTo(321.3, 2);
    expect(t.notlar.some(n => NOT_420.test(n))).toBe(true);
    const normal = mikroKalemTablosu([kalem({ sth_tarih: '2025-03-10', sth_miktar: 10, sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180 })], 1080, 'tr');
    expect(normal.satirlar[0].mikroTutarsiz).toBe(false);
    expect(normal.notlar).toEqual([]);
    expect(mikroKalemTablosu([kalem({})], 15000, 'tr').satirlar[0].mikroTutarsiz).toBe(false);
  });
  it('kayıtlı (sürüm-2) 420/435: ham tabloyla AYNI satır bayrağı ve AYNI notlar (mikroFazlasi saglamaKur\'a geçer)', () => {
    for (const [ham, kayitli, meblag] of [
      [k420, kay({}), 317236.5],
      [k435, kay({ quantity: 2, brutTutar: 540, iskonto: 218.7, netTutar: 321.3, kdv: 64.26, total: 385.56 }), 604.26],
    ] as const) {
      const a = mikroKalemTablosu([ham], meblag, 'tr'), b = kayitliKalemTablosu([kayitli], meblag, 'tr');
      expect(b.satirlar[0].mikroTutarsiz).toBe(true);
      expect(b.notlar).toEqual(a.notlar);
      expect(b.notlar.some(n => /Sağlama tutmuyor/.test(n))).toBe(false);
    }
  });
  it('fark Mikro fazlasıyla AÇIKLANMIYORSA "Sağlama tutmuyor" KALIR (+ satır notu); eski kaynaklı kayıtlı kalem bayraksız', () => {
    const t = kayitliKalemTablosu([kay({})], 250000, 'tr');
    expect(t.notlar.some(n => /Sağlama tutmuyor/.test(n))).toBe(true);
    expect(t.notlar.some(n => NOT_420.test(n))).toBe(true);
    expect(t.notlar.some(n => /KDV ile tutarlı toplam/.test(n))).toBe(false);
    const eski = kayitliKalemTablosu([kay({ netKaynagi: 'satirIskontosu' })], 202419, 'tr');
    expect(eski.satirlar[0].mikroTutarsiz).toBe(false);
    expect(eski.notlar).toEqual([]);
  });
  it('tutarsız kalemin brütü BİLİNMİYORSA Mikro fazlası kısmi toplamla UYDURULMAZ — hüküm yok, "Sağlama tutmuyor" kalır', () => {
    // 420 + 435 (brüt yok): bilinen fazla 114.817,50; meblağ farkı TAM bu kadar seçildi — kısmi fazla sahte "tutarsız" hükmü verirdi.
    const t = kayitliKalemTablosu([kay({}), kay({ sku: 'B', quantity: 2, brutTutar: null, iskonto: 218.7, netTutar: 321.3, kdv: 64.26, total: 385.56 })], 317622.06, 'tr');
    expect(t.notlar.some(n => /KDV ile tutarlı toplam/.test(n))).toBe(false);
    expect(t.notlar.some(n => /Sağlama tutmuyor/.test(n))).toBe(true);
    expect(t.notlar.some(n => /^2 kalemde Mikro kaydı tutarsız/.test(n))).toBe(true);
  });
  it('İngilizce not', () => {
    const t = mikroKalemTablosu([k420], 317236.5, 'en');
    expect(t.notlar.some(n => /^Mikro record inconsistent on 1 line\(s\)/.test(n))).toBe(true);
  });
  it('bileşen: tutarsız satırda ⚠ + tooltip, net iskontolu; tutarlı satırda ⚠ YOK', () => {
    const { unmount } = render(<MikroSiparisKalemleri durum="hazir" kalemler={[k420]} hata={null} genelToplam={317236.5} evrakNo="420" dil="tr" />);
    const isaret = screen.getByTitle(/Mikro kaydı tutarsız/);
    expect(isaret.textContent).toBe('⚠');
    expect(screen.getAllByText(/^₺168\.682,50$/).length).toBe(2);          // satır neti + ara toplam
    expect(screen.getByText(NOT_420)).toBeTruthy();
    expect(screen.queryByText(/Sağlama tutmuyor/)).toBeNull();
    unmount();
    render(<MikroSiparisKalemleri durum="hazir" kalemler={[kalem({ sth_tarih: '2025-03-10', sth_miktar: 10, sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180 })]} hata={null} genelToplam={1080} evrakNo="390" dil="tr" />);
    expect(screen.queryByTitle(/Mikro kaydı tutarsız/)).toBeNull();
  });
});

describe('tur 2 (2026-09-28): kalıcı yol ham yolla AYNI hükmü verir; kdvUyumsuz / ciftBelirsiz notu ekran + fişte', () => {
  const kk = (p: Record<string, unknown>) => ({ sku: 'X', name: 'X', quantity: 1, masraf: 0, total: null, kalemSurumu: 2, ...p });
  // Evrak 420 satırı + KDV'si pntr oranına uymayan, çift okuması da oturan ikinci satır (1.100 / 100 / KDV 180, %20'de 900).
  const ham = [
    { sth_tarih: '2026-08-31', sth_stok_kod: 'RULO1081', sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5, sth_vergi: 33736.5, sth_vergi_pntr: 4 },
    { sth_tarih: '2026-08-31', sth_stok_kod: 'B', sth_miktar: 1, sth_tutar: 1100, sth_iskonto1: 100, sth_vergi: 180, sth_vergi_pntr: 4 },
  ];
  const meblag = 318416.5;
  // Importun yazdığı kalıcı kalem (eslemeFatura.mfKalemleri ile aynı alanlar, bayraklar dâhil).
  const kayitli = [
    kk({ sku: 'RULO1081', quantity: 1050, brutTutar: 283500, iskonto: 114817.5, netTutar: 168682.5, kdv: 33736.5, netKaynagi: 'mikroKaydiTutarsiz', kdvUyumsuz: false, ciftIskontoBelirsiz: false }),
    kk({ sku: 'B', brutTutar: 1100, iskonto: 100, netTutar: 1000, kdv: 180, netKaynagi: 'satirIskontosu', kdvUyumsuz: true, ciftIskontoBelirsiz: true }),
  ];
  it('karma faturada "KDV ile tutarlı toplam" kesin hükmü İKİ yolda da YOK; notlar birebir aynı', () => {
    const a = mikroKalemTablosu(ham, meblag, 'tr');
    expect(a.notlar.some(n => /KDV ile tutarlı toplam/.test(n))).toBe(false);
    expect(a.notlar.some(n => /Sağlama tutmuyor/.test(n))).toBe(true);
    expect(a.notlar.some(n => /1 kalemde KDV satırın KDV oranıyla tutmuyor/.test(n))).toBe(true);
    expect(a.notlar.some(n => /1 kalemde iskontonun .* ayırt edilemiyor/.test(n))).toBe(true);
    expect(kayitliKalemTablosu(kayitli, meblag, 'tr').notlar).toEqual(a.notlar);
  });
  it('bayraksız (tur 2 öncesi yazılmış) kalıcı kalem: bilinmeyen 0 sayılmaz → kesin hüküm yok', () => {
    const tek = kayitli.slice(0, 1).map(k => { const c: Record<string, unknown> = { ...k }; delete c.kdvUyumsuz; delete c.ciftIskontoBelirsiz; return c; });
    const n = kayitliKalemTablosu(tek, 317236.5, 'tr').notlar;
    expect(n.some(x => /KDV ile tutarlı toplam/.test(x))).toBe(false);
    // Bayraklı tek 420 kalemi: hüküm verilir (ham yolla aynı).
    expect(kayitliKalemTablosu(kayitli.slice(0, 1), 317236.5, 'tr').notlar.some(x => /KDV ile tutarlı toplam ₺202\.419,00/.test(x))).toBe(true);
  });
  it('toplam tutuyor ama KDV oranına uymayan kalem: ekran + fiş uyarı basar (fatura detayının karşılığı)', () => {
    const n = mikroKalemTablosu([{ sth_tarih: '2026-08-31', sth_stok_kod: 'A', sth_miktar: 1, sth_tutar: 1000, sth_vergi: 100, sth_vergi_pntr: 4 }], 1100, 'tr').notlar;
    expect(n).toEqual(["1 kalemde KDV satırın KDV oranıyla tutmuyor — net doğrulanamadı; Mikro kaydını kontrol edin."]);
    expect(mikroKalemTablosu([{ sth_tarih: '2026-08-31', sth_stok_kod: 'A', sth_miktar: 1, sth_tutar: 1000, sth_vergi: 100, sth_vergi_pntr: 4 }], 1100, 'en').notlar)
      .toEqual(["VAT on 1 line(s) does not match the line's VAT rate — net not verified; check the Mikro record."]);
  });
});
