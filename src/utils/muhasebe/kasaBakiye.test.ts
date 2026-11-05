import { describe, it, expect } from 'vitest';
import { kasaKartBakiyesi, kasaKaydiOku } from './kasaBakiye';

// Şartname «Mikro bağlantı A» A5.4 (2026-11-05): Mikro kasa hareketleri aktarılmıyor; Mikro kasasının kartı ₺0 DEĞİL «bilinmiyor».
describe('kasaKartBakiyesi', () => {
  const H = [
    { kasaId: 'mikro-k1', tur: 'Giriş', tutar: 500 },
    { kasaId: 'mikro-k1', tur: 'Çıkış', tutar: 120 },
    { kasaId: 'cetpa-k2', tur: 'Giriş', tutar: 50 },
  ];
  it('Mikro kasası + ona ait hareket yok → null (bilinmiyor)', () => {
    expect(kasaKartBakiyesi({ id: 'mikro-k9', source: 'mikro' }, H)).toBeNull();
  });
  it('Mikro kasası + Cetpa\'da girilmiş hareket → hareketlerin toplamı (Giriş +, Çıkış −)', () => {
    expect(kasaKartBakiyesi({ id: 'mikro-k1', source: 'mikro' }, H)).toBe(380);
  });
  it('Cetpa kasası + hareket yok → GERÇEK 0; hareket varsa toplam', () => {
    expect(kasaKartBakiyesi({ id: 'cetpa-k3' }, H)).toBe(0);
    expect(kasaKartBakiyesi({ id: 'cetpa-k2' }, H)).toBe(50);
  });
});

describe('kasaKaydiOku · Mikro kasası adsız görünmez, durum / sorumlu uydurulmaz', () => {
  it('Mikro belgesi (`kasaAdi`, `currency`, source mikro) → ad ve döviz okunur; durum / sorumlu YOK', () => {
    const k = kasaKaydiOku('mikro-k1', { companyId: 'A', kasaAdi: 'MERKEZ KASA', currency: 'TRY', bakiye: null, source: 'mikro' });
    expect(k).toEqual({ id: 'mikro-k1', ad: 'MERKEZ KASA', doviz: 'TRY', source: 'mikro' });
    expect('durum' in k || 'sorumlu' in k).toBe(false);
  });
  it('Cetpa belgesi (`ad`, `doviz`, `durum`, `sorumlu`) → olduğu gibi; `ad` `kasaAdi`\'nın önünde', () => {
    expect(kasaKaydiOku('c1', { ad: 'Şube Kasası', kasaAdi: 'ESKİ', doviz: 'USD', durum: 'Pasif', sorumlu: 'Ayşe Çelik' }))
      .toEqual({ id: 'c1', ad: 'Şube Kasası', doviz: 'USD', durum: 'Pasif', sorumlu: 'Ayşe Çelik' });
  });
  it('döviz yoksa TRY (ekranın eski sınıflandırması); geçersiz durum değeri taşınmaz', () => {
    expect(kasaKaydiOku('c2', { ad: 'Kasa', durum: 'bilinmiyor' })).toEqual({ id: 'c2', ad: 'Kasa', doviz: 'TRY' });
  });
});
