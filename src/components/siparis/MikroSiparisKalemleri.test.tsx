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
    expect(iskontosuz.notlar).toEqual([]);
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
