/**
 * faturaEsle / hareketFaturasi — evrak numarasına basınca açılan fatura.
 * 2026-09-25 kullanıcı bildirimi: Fiyat Karşılaştırma → İşlem Detayı'nda "evraka basınca evrak detayları gelmiyor".
 * Eskiden başlık listesinde tekil eşleşme yoksa düğme hiç çıkmıyordu; artık fatura anahtarından başlıksız açılır.
 */
import { describe, it, expect } from 'vitest';
import { faturaEsle, hareketFaturasi } from './faturaEsle';
import type { MikroFatura } from '../hooks/useMikroFaturalar';

const baslik = (p: Partial<MikroFatura>): MikroFatura => ({
  id: 'f1', faturaNo: '116', cariKod: '120.01', tarih: '2025-12-30', oranKarma: false, ebelgeTuru: -1, subeNo: NaN,
  tutar: 6048, kdv: 1008, matrah: 5040, oran: 20, yon: 'giden', ...p,
});

describe('hareketFaturasi', () => {
  it('başlık TEKİL eşleşirse başlıklı döner (tutar/KDV dolu, musteri = cari kodu — eski davranış)', () => {
    const f = hareketFaturasi([baslik({})], { evrakSira: '116', cariKod: '120.01', tarih: '2025-12-30' }, { seri: '', sira: '116', yon: 'giden' });
    expect(f?.tutar).toBe(6048);
    expect(f?.musteri).toBe('120.01');
    expect(f?.baslikYok).toBeUndefined();
  });

  it('başlık YOK (eski fatura, "Faturaları Çek" kapsamamış) → anahtardan başlıksız: kalemler Mikro\'dan, toplamlar bilinmiyor', () => {
    const f = hareketFaturasi([], { evrakSira: '128', cariKod: '320.05', tarih: '2025-11-26' }, { seri: '', sira: '128', yon: 'gelen' });
    expect(f).not.toBeNull();
    expect(f?.faturaNo).toBe('128');
    expect(f?.yon).toBe('gelen');
    expect(f?.baslikYok).toBe(true);
    expect(Number.isNaN(f?.tutar)).toBe(true);           // ₺0 DEĞİL — bilinmiyor
    expect(Number.isNaN(f?.kdv)).toBe(true);
    expect(f?.cariKod).toBe('320.05');
  });

  it('serili evrakta faturaNo "SERİ-SIRA" (MikroFaturaDetay seri/sırayı buradan böler)', () => {
    const f = hareketFaturasi([], { evrakSira: '12' }, { seri: 'F', sira: '12', yon: 'giden' });
    expect(f?.faturaNo).toBe('F-12');
  });

  it('başlık eşleşti ama YÖNÜ hareketin faturasıyla çelişiyor → başlık KULLANILMAZ, anahtardan açılır', () => {
    const f = hareketFaturasi([baslik({ yon: 'gelen' })], { evrakSira: '116', cariKod: '120.01', tarih: '2025-12-30' }, { seri: '', sira: '116', yon: 'giden' });
    expect(f?.baslikYok).toBe(true);
    expect(f?.yon).toBe('giden');
  });

  it('hareket fatura DEĞİL (irsaliye — anahtar null) ve başlık da yok → null (düğme yok)', () => {
    expect(hareketFaturasi([], { evrakSira: '5', cariKod: '120.01' }, null)).toBeNull();
  });

  it('birden çok başlık eşleşirse (belirsiz) başlık seçilmez — anahtar varsa başlıksız açılır', () => {
    const iki = [baslik({ id: 'a' }), baslik({ id: 'b' })];
    expect(faturaEsle(iki, { evrakSira: '116', cariKod: '120.01', tarih: '2025-12-30' })).toBeNull();
    expect(hareketFaturasi(iki, { evrakSira: '116', cariKod: '120.01', tarih: '2025-12-30' }, { seri: '', sira: '116', yon: 'giden' })?.baslikYok).toBe(true);
  });
});
