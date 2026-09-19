/**
 * govdeHatasi.test.ts — "Mikro gövdesinde varsayılan YOK" sözleşmesinin hata nesnesi
 * (Faz 3 3/n, 2026-09-19). ÖNCE YAZILDI.
 *
 * Kilitlenen üç şey: (1) mesaj TÜRKÇE ve hangi kalemin hangi alanı olduğunu söyler —
 * kullanıcı bu cümleyi MikroPushButton'da olduğu gibi görür; (2) `instanceof` çalışır
 * (rota catch'i 500 yerine 400 dönebilsin diye — Error alt sınıfında prototip zinciri
 * downlevel derlemede sessizce kopar); (3) satirNo'suz kullanım (belge başlığı alanı,
 * kalem değil) satır numarası UYDURMAZ.
 */
import { describe, it, expect } from 'vitest';
import { MikroGovdeHatasi, govdeHatasiMesaji, mikroGovdeHatasiMi } from './govdeHatasi';

describe('MikroGovdeHatasi', () => {
  it('kalem alanı: mesaj satır numarasını ve alan adını söyler', () => {
    const e = new MikroGovdeHatasi('birim fiyatı', 3);
    expect(e.message).toBe("Mikro'ya gönderilemedi: 3. kalemin birim fiyatı bilinmiyor");
    expect(e.alan).toBe('birim fiyatı');
    expect(e.satirNo).toBe(3);
  });

  it('satirNo yoksa satır UYDURULMAZ (belge başlığı alanı)', () => {
    const e = new MikroGovdeHatasi('depo numarası');
    expect(e.message).toBe("Mikro'ya gönderilemedi: depo numarası bilinmiyor");
    expect(e.message).not.toMatch(/kalem/);
    expect(e.satirNo).toBeUndefined();
  });

  it('açıklama verilirse mesajın sonuna parantezle eklenir', () => {
    const e = new MikroGovdeHatasi('vergi işaretçisi', 2, 'KDV oranı 18 Mikro tablosunda yok');
    expect(e.message).toBe("Mikro'ya gönderilemedi: 2. kalemin vergi işaretçisi bilinmiyor (KDV oranı 18 Mikro tablosunda yok)");
    expect(e.aciklama).toBe('KDV oranı 18 Mikro tablosunda yok');
  });

  it('satirNo sayı değilse (null/NaN) "1. kalem" gibi görünmez — Number.isFinite, global isFinite DEĞİL', () => {
    const bilinmeyen = null as unknown as number | undefined;
    const e = new MikroGovdeHatasi('miktar', bilinmeyen);
    expect(e.message).toBe("Mikro'ya gönderilemedi: miktar bilinmiyor");
    expect(e.satirNo).toBeUndefined();
    expect(new MikroGovdeHatasi('miktar', Number.NaN).message).toBe("Mikro'ya gönderilemedi: miktar bilinmiyor");
  });

  it('gerçek bir Error: instanceof + name + stack (rota catch\'i 400 dönebilsin)', () => {
    const e = new MikroGovdeHatasi('birim fiyatı', 1);
    expect(e).toBeInstanceOf(MikroGovdeHatasi);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('MikroGovdeHatasi');
    expect(typeof e.stack).toBe('string');
    // try/catch içinden geçtikten sonra da tanınmalı (prototip zinciri kopmasın)
    let yakalanan: unknown;
    try { throw new MikroGovdeHatasi('kur', 7); } catch (err) { yakalanan = err; }
    expect(yakalanan instanceof MikroGovdeHatasi).toBe(true);
  });

  it('mikroGovdeHatasiMi yalnız bu hatayı tanır', () => {
    expect(mikroGovdeHatasiMi(new MikroGovdeHatasi('depo', 1))).toBe(true);
    expect(mikroGovdeHatasiMi(new Error('ağ hatası'))).toBe(false);
    expect(mikroGovdeHatasiMi('Mikro bağlantısı yok')).toBe(false);
    expect(mikroGovdeHatasiMi(null)).toBe(false);
  });

  it('govdeHatasiMesaji sınıfla AYNI cümleyi üretir (tek kaynak)', () => {
    expect(govdeHatasiMesaji('birim fiyatı', 3)).toBe(new MikroGovdeHatasi('birim fiyatı', 3).message);
    expect(govdeHatasiMesaji('depo numarası')).toBe(new MikroGovdeHatasi('depo numarası').message);
  });
});
