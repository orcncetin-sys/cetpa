/**
 * MikroSiparisKalemleri + useMikroSiparisKalemleri — MF-383 (2026-09-25 "sipariş kalemleri gelmemiş"): kalemleri
 * Cetpa'ya aktarılmamış Mikro faturası siparişinde kalemler Mikro'dan canlı okunur, NET ve KDV HARİÇ gösterilir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, waitFor } from '@testing-library/react';
import MikroSiparisKalemleri from './MikroSiparisKalemleri';
import { useMikroSiparisKalemleri } from '../../hooks/useMikroSiparisKalemleri';
import { kalemleriMikrodanOkunacak, mikroKalemNotlari } from '../../services/mikroFaturaKalemleri';

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
    expect(n[0]).toMatch(/1 kalemin neti/);
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

