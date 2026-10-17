/**
 * faturaGonder.test.ts — e-Fatura yanıt iletisi tablo testi (2026-10-17, şartname «e-Fatura çift kesim» § 7.4 B3; D9).
 * Kural: ileti `kod`'dan seçilir, HTTP durumundan DEĞİL — aynı `kod` HTTP 200 ve 502 ile AYNI metni verir; «gönderilmedi»
 * («OLABİLİR» denmez) ile «kesilmiş OLABİLİR» ayrıdır.
 */
import { describe, it, expect } from 'vitest';
import { faturaOlabilirMetni, faturaSonucMesaji, faturaYanitMesaji, type FaturaYaniti } from './faturaGonder';

const OLABILIR = 'Fatura Mikro\'da kesilmiş OLABİLİR. Tekrar göndermeden önce Mikro\'dan kontrol edin.';

describe('B3 — faturaYanitMesaji', () => {
  it('«kesilmiş OLABİLİR» metni şartnamedeki cümlenin AYNISI', () => {
    expect(faturaOlabilirMetni('tr')).toBe(OLABILIR);
  });

  it('FATURA_GONDERILMEDI (400 gövde hatası, 503 notConfigured, 404) → «Fatura gönderilmedi: …»; metinde «OLABİLİR» YOK', () => {
    const satirlar: Array<[number, FaturaYaniti, string]> = [
      [400, { success: false, kod: 'FATURA_GONDERILMEDI', error: "Mikro'ya gönderilemedi: KDV oranı bilinmiyor" }, "Fatura gönderilmedi: Mikro'ya gönderilemedi: KDV oranı bilinmiyor"],
      [503, { success: false, kod: 'FATURA_GONDERILMEDI', notConfigured: true, error: 'Mikro bağlantısı yapılandırılmamış.' }, 'Fatura gönderilmedi: Mikro bağlantısı yapılandırılmamış.'],
      [502, { success: false, kod: 'FATURA_GONDERILMEDI', error: 'Mikro token alınamadı (500)' }, 'Fatura gönderilmedi: Mikro token alınamadı (500)'],
      [404, { success: false, kod: 'FATURA_GONDERILMEDI', error: 'Kayıt bulunamadı.' }, 'Fatura gönderilmedi: Kayıt bulunamadı.'],
    ];
    for (const [durum, yanit, metin] of satirlar) {
      const m = faturaYanitMesaji(durum, yanit, 'tr');
      expect(m, String(durum)).toEqual({ tur: 'error', metin });
      expect(m.metin).not.toMatch(/OLABİLİR/);
    }
  });

  it('FATURA_SONUCU_BILINMIYOR (502 / 504 / 500), ağ hatası (yanıt yok), JSON olmayan gövde → «OLABİLİR» iletisi', () => {
    for (const durum of [502, 504, 500, 200]) {
      expect(faturaYanitMesaji(durum, { success: false, kod: 'FATURA_SONUCU_BILINMIYOR', error: 'HTTP 502' }, 'tr').metin, String(durum)).toBe(OLABILIR);
    }
    expect(faturaYanitMesaji(null, null, 'tr')).toEqual({ tur: 'error', metin: OLABILIR });   // ağ hatası
    expect(faturaYanitMesaji(502, null, 'tr')).toEqual({ tur: 'error', metin: OLABILIR });    // vekilin HTML'i (gövde okunamadı)
    expect(faturaYanitMesaji(502, { success: false }, 'tr').metin).toBe(OLABILIR);            // `kod`suz 5xx
    // `kod`suz 4xx (kimlik / yetki katmanı — istek rotaya ulaşmadı) → gönderilmedi.
    expect(faturaYanitMesaji(403, { success: false, error: 'Bu işlem için personel yetkisi gerekir.' }, 'tr').metin).toBe('Fatura gönderilmedi: Bu işlem için personel yetkisi gerekir.');
  });

  it('FATURA_REDDEDILDI → Mikro iletisiyle; her 409 kodu kendi iletisi; FATURA_GONDERILDI numarayla; FATURA_KESILEMEZ nedene göre', () => {
    expect(faturaYanitMesaji(200, { success: false, kod: 'FATURA_REDDEDILDI', error: 'Cari bulunamadı' }, 'tr'))
      .toEqual({ tur: 'error', metin: 'Mikro faturayı reddetti: Cari bulunamadı. Düzeltip yeniden gönderebilirsiniz.' });
    expect(faturaYanitMesaji(409, { success: false, kod: 'FATURA_GONDERILIYOR' }, 'tr').metin).toBe('Bu siparişin faturası şu an gönderiliyor.');
    expect(faturaYanitMesaji(409, { success: false, kod: 'FATURA_GONDERILDI', numara: 'CTP2026000000001' }, 'tr').metin).toBe('Bu siparişin faturası zaten kesildi (No: CTP2026000000001).');
    expect(faturaYanitMesaji(409, { success: false, kod: 'FATURA_GONDERILDI' }, 'tr').metin).toBe('Bu siparişin faturası zaten kesildi.');
    expect(faturaYanitMesaji(409, { success: false, kod: 'FATURA_SONUCU_BILINMIYOR' }, 'tr').metin).toBe('Bu siparişin fatura sonucu bilinmiyor; önce Mikro\'dan kontrol edip kaydı çözün.');
    expect(faturaYanitMesaji(400, { success: false, kod: 'FATURA_KESILEMEZ', neden: 'mikro-fatura' }, 'tr').metin).toBe('Bu kayıt Mikro faturasından türetildi — ikinci fatura kesilemez.');
    expect(faturaYanitMesaji(400, { success: false, kod: 'FATURA_KESILEMEZ', neden: 'magaza' }, 'tr').metin).toBe('Çevrim içi mağaza siparişine buradan fatura kesilemez.');
    expect(faturaYanitMesaji(400, { success: false, kod: 'FATURA_KESILEMEZ', neden: 'faturasiz' }, 'tr').metin).toBe('Faturasız satışa fatura kesilemez.');
  });

  it('aynı `kod` HTTP 200 ve 502 ile AYNI metni verir (ileti HTTP durumuna bağlı değil)', () => {
    const kodlar: FaturaYaniti[] = [
      { success: false, kod: 'FATURA_GONDERILMEDI', error: 'x' },
      { success: false, kod: 'FATURA_REDDEDILDI', error: 'x' },
      { success: false, kod: 'FATURA_SONUCU_BILINMIYOR', error: 'x' },
      { success: false, kod: 'FATURA_KESILEMEZ', neden: 'magaza' },
      { success: true, mikroFaturaNo: 'CTP1' },
    ];
    for (const y of kodlar) expect(faturaYanitMesaji(200, y, 'tr'), String(y.kod)).toEqual(faturaYanitMesaji(502, y, 'tr'));
  });

  it('başarı → «Fatura kaydedildi: <no>»', () => {
    expect(faturaYanitMesaji(200, { success: true, mikroFaturaNo: 'CTP2026000000123' }, 'tr')).toEqual({ tur: 'success', metin: 'Fatura kaydedildi: CTP2026000000123' });
    expect(faturaYanitMesaji(200, { success: true, mikroFaturaNo: 'CTP2026000000123', localUpdateFailed: false }, 'tr').tur).toBe('success');
  });

  it('İA-2 — başarı + `localUpdateFailed` → «kesildi ama işaretlenemedi — YENİDEN GÖNDERMEYİN» (e-İrsaliye karşılığı); «kaydedildi» DENMEZ', () => {
    const m = faturaYanitMesaji(200, { success: true, mikroFaturaNo: 'CTP2026000000124', localUpdateFailed: true }, 'tr');
    expect(m).toEqual({ tur: 'error', metin: 'Fatura Mikro\'da kesildi ama sipariş işaretlenemedi — YENİDEN GÖNDERMEYİN, sayfayı yenileyin.' });
    expect(m.metin).not.toMatch(/kaydedildi|OLABİLİR/);
    // Numarasız da aynı ileti; İngilizce karşılığı da «yeniden gönderme» der.
    expect(faturaYanitMesaji(200, { success: true, localUpdateFailed: true }, 'tr').metin).toBe(m.metin);
    expect(faturaYanitMesaji(200, { success: true, localUpdateFailed: true }, 'en').metin).toMatch(/DO NOT resend/);
  });
});

describe('faturaSonucMesaji (D6)', () => {
  it('iki karar, 409 kodları, hata', () => {
    expect(faturaSonucMesaji(200, { success: true, karar: 'mikrodaYok' }, 'tr').metin).toBe('Kayıt çözüldü: fatura Mikro\'da yok, yeniden gönderilebilir.');
    expect(faturaSonucMesaji(200, { success: true, karar: 'mikrodaVar' }, 'tr').metin).toBe('Kayıt çözüldü: fatura Mikro\'da kesilmiş olarak işaretlendi.');
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_SONUC_YOK' }, 'tr').metin).toBe('Bu siparişte çözülecek bir fatura sonucu yok.');
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_GONDERILIYOR' }, 'tr').metin).toBe('Bu siparişin faturası şu an gönderiliyor.');
    expect(faturaSonucMesaji(404, { success: false, error: 'Kayıt bulunamadı.' }, 'tr').metin).toBe('Kayıt çözülemedi: Kayıt bulunamadı.');
    expect(faturaSonucMesaji(null, null, 'tr').tur).toBe('error');
  });
});
