/**
 * faturaGonder.test.ts — e-Fatura yanıt iletisi tablo testi (2026-10-17, şartname «e-Fatura çift kesim» § 7.4 B3; D9).
 * Kural: ileti `kod`'dan seçilir, HTTP durumundan DEĞİL — aynı `kod` HTTP 200 ve 502 ile AYNI metni verir; «gönderilmedi»
 * («OLABİLİR» denmez) ile «kesilmiş OLABİLİR» ayrıdır.
 */
import { describe, it, expect } from 'vitest';
import { faturaOlabilirMetni, faturaSonucMesaji, faturaSonucUyarisi, faturaYanitMesaji, type FaturaYaniti } from './faturaGonder';

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

describe('faturaSonucMesaji — ETTN (şartname «fatura gövde + gece MF» § 9.B B5)', () => {
  it('«ETTN ekle» başarısı → «ETTN eklendi: fatura bu siparişe bağlandı.» (İngilizcesi de)', () => {
    expect(faturaSonucMesaji(200, { success: true, karar: 'ettnEkle', ettn: 'e' }, 'tr')).toEqual({ tur: 'success', metin: 'ETTN eklendi: fatura bu siparişe bağlandı.' });
    expect(faturaSonucMesaji(200, { success: true, karar: 'ettnEkle' }, 'en').metin).toBe('ETTN added: the invoice is linked to this order.');
    // «Mikro'da var» + ETTN: bugünkü çözüm iletisi.
    expect(faturaSonucMesaji(200, { success: true, karar: 'mikrodaVar', ettn: 'e' }, 'tr').metin).toBe('Kayıt çözüldü: fatura Mikro\'da kesilmiş olarak işaretlendi.');
  });

  it('yeni 409 kodları Türkçe iletiyle; sunucunun ayrıntısı (öteki sipariş, cari) iletide', () => {
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_VAR', error: 'Bu siparişin ETTN\'si zaten kayıtlı.' }, 'tr', 'ettnEkle'))
      .toEqual({ tur: 'info', metin: 'Bu siparişin ETTN\'si zaten kayıtlı.' });
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_BASKA_SIPARISTE', error: 'Bu ETTN başka bir siparişte kayıtlı: SIP-0007' }, 'tr', 'ettnEkle'))
      .toEqual({ tur: 'error', metin: 'ETTN yazılmadı. Bu ETTN başka bir siparişte kayıtlı: SIP-0007. Mikro\'daki ETTN\'yi denetleyin.' });
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_BASKA_CARI', error: 'Bu ETTN bir alış faturasına ait' }, 'tr', 'mikrodaVar').metin)
      .toBe('ETTN yazılmadı. Bu ETTN bir alış faturasına ait. Mikro\'daki ETTN\'yi denetleyin.');
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_BASKA_CARI', error: 'Bu ETTN 120.01.0099 carisinin faturası; sipariş carisi 120.01.0042' }, 'tr').metin)
      .toBe('ETTN yazılmadı. Bu ETTN 120.01.0099 carisinin faturası; sipariş carisi 120.01.0042. Mikro\'daki ETTN\'yi denetleyin.');
    // Sunucu iletisi yoksa genel cümle.
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_BASKA_SIPARISTE' }, 'tr').metin).toBe('ETTN yazılmadı. Bu ETTN başka bir siparişte kayıtlı. Mikro\'daki ETTN\'yi denetleyin.');
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_DEGISTI', error: 'Kayıt bu arada değişti; yenileyip yeniden deneyin.' }, 'tr', 'ettnEkle').metin)
      .toBe('Kayıt bu arada değişti; sayfayı yenileyip yeniden deneyin.');
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_BASKA_SIPARISTE', error: 'Bu ETTN başka bir siparişte kayıtlı: S-1' }, 'en').metin)
      .toBe('ETTN not saved: this ETTN is recorded on another order (Bu ETTN başka bir siparişte kayıtlı: S-1). Check the ETTN in Mikro.');
  });

  it('409 FATURA_ETTN_ONCEKI_FATURA — talepten önceki faturanın ETTN\'si: sunucu iletisi (iki gün) Türkçede, İngilizcede genel cümle + parantez; iki kararda da', () => {
    const hata = 'Bu ETTN 2026-10-10 tarihli, talepten (2026-10-19) önceki bir faturanın; bu siparişin faturası olamaz';
    for (const istenen of ['mikrodaVar', 'ettnEkle'] as const) {
      expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_ONCEKI_FATURA', error: hata }, 'tr', istenen))
        .toEqual({ tur: 'error', metin: `ETTN yazılmadı. ${hata}. Mikro'daki ETTN'yi denetleyin.` });
    }
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_ONCEKI_FATURA' }, 'tr').metin)
      .toBe('ETTN yazılmadı. Mikro fatura kayıtlarına göre bu ETTN talepten önceki bir faturanın; bu siparişin faturası olamaz. Mikro\'daki ETTN\'yi denetleyin.');
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_ONCEKI_FATURA', error: hata }, 'en').metin)
      .toBe(`ETTN not saved: according to Mikro's invoice records this ETTN belongs to an invoice dated before the request, so it cannot be this order's invoice (${hata}). Check the ETTN in Mikro.`);
    // «Kesilmiş OLABİLİR» / «Kayıt çözülemedi» genel yoluna DÜŞMEZ.
    expect(faturaSonucMesaji(409, { success: false, kod: 'FATURA_ETTN_ONCEKI_FATURA', error: hata }, 'tr').metin).not.toMatch(/OLABİLİR|Kayıt çözülemedi/);
  });

  it('KİLİT — 400\'de SUNUCU iletisi gösterilir (`FATURA_ETTN_GECERSIZ`, şema iletisi); «ETTN ekle»de önek «ETTN eklenemedi», ötekilerde bugünkü «Kayıt çözülemedi»', () => {
    const gecersiz = 'ETTN geçersiz: Mikro\'da e-Fatura ekranındaki 36 karakterlik ETTN\'yi girin (sıfır ETTN kabul edilmez).';
    expect(faturaSonucMesaji(400, { success: false, kod: 'FATURA_ETTN_GECERSIZ', error: gecersiz }, 'tr', 'ettnEkle')).toEqual({ tur: 'error', metin: `ETTN eklenemedi: ${gecersiz}` });
    expect(faturaSonucMesaji(400, { success: false, kod: 'FATURA_ETTN_GECERSIZ', error: gecersiz }, 'tr', 'mikrodaVar').metin).toBe(`Kayıt çözülemedi: ${gecersiz}`);
    expect(faturaSonucMesaji(400, { success: false, error: 'ETTN eklemek için geçerli bir ETTN girin.' }, 'tr', 'ettnEkle').metin).toBe('ETTN eklenemedi: ETTN eklemek için geçerli bir ETTN girin.');
    expect(faturaSonucMesaji(400, { success: false, kod: 'FATURA_ETTN_GECERSIZ', error: gecersiz }, 'tr').metin).toBe(`Kayıt çözülemedi: ${gecersiz}`);
    expect(faturaSonucMesaji(null, null, 'tr', 'ettnEkle').metin).toBe('ETTN eklenemedi: yanıt alınamadı. Sayfayı yenileyip yeniden deneyin.');
  });

  it('faturaSonucUyarisi — yalnız başarıda ve `uyari` doluysa bilgi iletisi (metin istemcide, İngilizcesi de)', () => {
    const u = 'ETTN Mikro fatura aynasında henüz yok ya da carisi doğrulanamadı (ayna gece güncellenir)';
    expect(faturaSonucUyarisi({ success: true, karar: 'ettnEkle', uyari: u }, 'tr')).toEqual({ tur: 'info', metin: 'ETTN kaydedildi ama Mikro fatura aynasında henüz yok ya da carisi doğrulanamadı (ayna gece güncellenir). ETTN\'yi Mikro\'daki faturayla bir kez daha karşılaştırın.' });
    expect(faturaSonucUyarisi({ success: true, karar: 'ettnEkle', uyari: u }, 'en')?.metin).toMatch(/^The ETTN was saved/);
    expect(faturaSonucUyarisi({ success: true, karar: 'ettnEkle' }, 'tr')).toBeNull();
    expect(faturaSonucUyarisi({ success: false, uyari: u }, 'tr')).toBeNull();
    expect(faturaSonucUyarisi(null, 'tr')).toBeNull();
  });
});
