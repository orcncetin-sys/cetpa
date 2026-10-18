/**
 * yazimSecenegi.test.ts — stub tanımı ve yazan çağrının hata iletisi (şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md`
 * K0a, § 8.2 commit 0-A «yazimSecenegi.test.ts»; H1 kısa metin).
 */
import { describe, it, expect } from 'vitest';
import { MIKRO_STUB_METNI, MIKRO_YAZIM_SECENEGI, mikroStubMu, yazimHataMetni } from './yazimSecenegi';

describe('mikroStubMu — `result` anahtarsız nesne gövde', () => {
  it("{ Method: 'X' } → stub; `result` taşıyan zarf, null ve HTML dizesi stub DEĞİL", () => {
    expect(mikroStubMu({ Method: 'X' })).toBe(true);
    expect(mikroStubMu({})).toBe(true);
    expect(mikroStubMu({ result: [] })).toBe(false);
    expect(mikroStubMu({ result: [{ IsError: false }] })).toBe(false);
    expect(mikroStubMu(null)).toBe(false);
    expect(mikroStubMu(undefined)).toBe(false);
    expect(mikroStubMu('<html><body>Bad Gateway</body></html>')).toBe(false);
  });
});

describe('yazimHataMetni — stub iletisi; değilse bugünkü `ErrorMessage || HTTP <durum>` ifadesi', () => {
  it('stub (HTTP başarılı) → MIKRO_STUB_METNI birebir; metin 90 karakteri aşmaz (MikroPushButton kesimi)', () => {
    expect(yazimHataMetni(true, 200, { Method: 'StokKaydetV2' })).toBe(MIKRO_STUB_METNI);
    expect(MIKRO_STUB_METNI).toBe("Mikro yanıtı eksik; kayıt Mikro'da OLABİLİR. Göndermeden önce Mikro'yu kontrol edin.");
    expect([...MIKRO_STUB_METNI].length).toBeLessThanOrEqual(90);
    // Ekranda kesilmeden görünen kısım «kontrol edin» ile biter (bugünkü düğme kesimi `slice(0, 90)`).
    expect(MIKRO_STUB_METNI.slice(0, 90).endsWith('kontrol edin.')).toBe(true);
  });

  it('`result[0].ErrorMessage` → aynen; IsError taşıyan başarılı HTTP yanıtı da', () => {
    expect(yazimHataMetni(true, 200, { result: [{ IsError: true, ErrorMessage: 'Cari bulunamadı' }] })).toBe('Cari bulunamadı');
    expect(yazimHataMetni(false, 500, { result: [{ IsError: true, ErrorMessage: 'Sunucu hatası' }] })).toBe('Sunucu hatası');
  });

  it('`result`suz DİZE gövde + 502 → `HTTP 502`; boş `result` → `HTTP <durum>`; HTTP başarısız + `result`suz nesne stub SAYILMAZ', () => {
    expect(yazimHataMetni(false, 502, '<html>Bad Gateway</html>')).toBe('HTTP 502');
    expect(yazimHataMetni(true, 200, { result: [] })).toBe('HTTP 200');
    expect(yazimHataMetni(true, 200, { result: [{ IsError: true }] })).toBe('HTTP 200');
    expect(yazimHataMetni(false, 500, { Message: 'An error has occurred.' })).toBe('HTTP 500');
  });

  it('ortak seçenek stub tekrarını kapatır (derin eşitlik bugünkü satır içi seçenekle aynı)', () => {
    expect(MIKRO_YAZIM_SECENEGI).toEqual({ stubYenidenDeneme: false });
  });
});
