/**
 * govdeMuhasebe.test.ts — Mikro'ya YAZAN muhasebe gövdeleri (Faz 3 3/n, grup govdeMuhasebe).
 * ÖNCE YAZILDI (2026-09-19).
 *
 * Kilitlenen iki şey:
 *  (1) PARİTE — bilinen girdide gövde, rotadaki eski satır/alan eşlemesiyle BİREBİR aynı
 *      (alan adları, sabit Mikro kodları: cha_cinsi 19, cha_evrak_tip 34, seri KSTAH/KSTED,
 *      fis_* taban alanları). Bunlar V17 örneğinden geliyor, "sadeleştirme" adına değiştirilemez.
 *  (2) VARSAYILAN YOK — bilinmeyen bir alan Mikro defterine sahte kayıt düşüremez. Her eski
 *      varsayılan sitesi için ayrı bir "throw MikroGovdeHatasi" vakası var; mutasyon testi
 *      (kapıyı `?? 0` / `|| 1`'e çevir) bu vakalarda kırmızı olmalı.
 *
 * Eski sahte-varsayılan siteleri (mikroRoutes.ts, 2026-09-19 ölçümü):
 *   yevmiye  ~2899  `const meblag = Number(e.borc ?? e.alacak ?? 0) || 0`   → ₺0 fiş
 *   yevmiye  ~2900  `hesapKodu = ... || '100'`                             → boş hesap 100 KASA'ya
 *   yevmiye  ~2898  `toTrDate(String(e.date ?? ''))`                       → "undefined.undefined."
 *   tahsilat ~2954  `toTrDate(String(t.tarih ?? bugün))`                   → yanlış döneme tahsilat
 *   tahsilat ~2955  `t.tip === 'tediye' ? 'tediye' : 'tahsilat'`           → yön sessizce ters
 *   tahsilat ~2971  `cha_meblag: Number(t.tutar)`                          → 'abc' → NaN → JSON null
 *   cari-hrk ~2822  `satirlar: [hareket]` (hiç doğrulama yok)              → kodsuz/tutarsız dekont
 */
import { describe, it, expect } from 'vitest';
import { MikroGovdeHatasi } from './govdeHatasi';
import { yevmiyeGovdesi, tahsilatGovdesi, cariHareketGovdesi } from './govdeMuhasebe';

// ── Türkçe fikstürler ────────────────────────────────────────────────────────
/** Balanced fiş — App.tsx'in faturalı satışta otomatik açtığı kayıtla aynı şekil. */
const FIS = {
  id: 'j-1',
  date: '2026-09-19',
  'fiş': 'SIP-10421',
  aciklama: 'Şirin İnşaat - Faturalı Satış (ÇİMENTO 50KG)',
  debitHesap: '120 - Alıcılar',
  alacakHesap: '600 - Yurt İçi Satışlar',
  borc: 45000,
  alacak: 45000,
  kategori: 'Satış',
};

/** Rotadaki `satirBase` — sabitler V17 örneğinden, DEĞİŞTİRİLEMEZ. */
const TABAN = {
  fis_firmano: 0, fis_subeno: 0,
  fis_tarih: '19.09.2026',
  fis_tur: 0,
  fis_sorumluluk_kodu: '', fis_ticari_tip: 0, fis_kurfarkifl: 0,
  fis_ticari_evraktip: 0, fis_tic_belgeno: 'SIP-10421',
  fis_tic_belgetarihi: '19.09.2026',
  fis_katagori: 0, fis_fmahsup_tipi: 0, user_tablo: [],
};

const TAHSILAT = {
  cariKod: '120-SIRIN',
  tutar: 45000,
  tarih: '2026-09-19',
  aciklama: 'Şirin İnşaat — ÇİMENTO 50KG bakiye tahsilatı',
  tip: 'tahsilat',
};

/** DekontKaydetV2 satırı — istemcideki `dekontPayload` (src/services/mikroEvrak.ts) ne üretiyorsa o. */
const DEKONT_SATIRI = {
  cha_tarihi: '19.09.2026',
  cha_tip: 0,
  cha_normal_Iade: 0,
  cha_evrak_tip: 29,
  cha_evrakno_seri: 'CTP',
  cha_cari_cins: 0,
  cha_kod: '120-SIRIN',
  cha_d_kurtar: null, cha_d_cins: 0, cha_d_kur: 1,
  cha_srmrkkodu: '', cha_projekodu: '',
  cha_kasa_hizmet: 0, cha_kasa_hizkod: '',
  cha_meblag: 12500,
};

// ─────────────────────────────────────────────────────────────────────────────
describe('yevmiyeGovdesi — PARİTE', () => {
  it('bilinen fiş: iki satır (borç +meblag / alacak −meblag) ve payload eskisiyle BİREBİR', () => {
    const { payload, satirlar } = yevmiyeGovdesi(FIS);

    expect(satirlar).toEqual([
      { ...TABAN, fis_hesap_kod: '120', fis_aciklama1: FIS.aciklama, fis_meblag0:  45000 },
      { ...TABAN, fis_hesap_kod: '600', fis_aciklama1: FIS.aciklama, fis_meblag0: -45000 },
    ]);
    expect(payload).toEqual({
      evraklar: [{
        evrak_aciklamalari: [{ aciklama: FIS.aciklama }],
        satirlar,
      }],
    });
  });

  it('hesap kodu ayrıştırması eskisiyle aynı: ilk boşluk/tireye kadar', () => {
    const { satirlar } = yevmiyeGovdesi({ ...FIS, debitHesap: '153 - Ticari Mallar', alacakHesap: '320-01 Satıcılar' });
    expect(satirlar[0].fis_hesap_kod).toBe('153');
    expect(satirlar[1].fis_hesap_kod).toBe('320');
  });

  it("belge no `fiş` anahtarından, yoksa `fisNo`'dan; ikisi de yoksa boş string (sayı değil, uydurma yok)", () => {
    const { satirlar: a } = yevmiyeGovdesi({ ...FIS, 'fiş': undefined, fisNo: 'MHS-7' });
    expect(a[0].fis_tic_belgeno).toBe('MHS-7');
    const { satirlar: b } = yevmiyeGovdesi({ ...FIS, 'fiş': undefined, fisNo: undefined });
    expect(b[0].fis_tic_belgeno).toBe('');
  });
});

describe('yevmiyeGovdesi — VARSAYILAN YOK', () => {
  it('borç ve alacak bilinmiyorsa ₺0 fiş YAZILMAZ, throw eder', () => {
    expect(() => yevmiyeGovdesi({ ...FIS, borc: undefined, alacak: undefined })).toThrow(MikroGovdeHatasi);
    expect(() => yevmiyeGovdesi({ ...FIS, borc: null, alacak: '' })).toThrow(/tutarı bilinmiyor/);
    expect(() => yevmiyeGovdesi({ ...FIS, borc: 0, alacak: 0 })).toThrow(MikroGovdeHatasi);
  });

  it('borç 0 ve alacak dolu ise MEBLAĞ ALACAKTAN gelir (eski `Number(0 ?? x) || 0` ₺0 yazıyordu)', () => {
    // YevmiyeTab formunda borç kutusu boş bırakılınca `Number('') === 0` gelir; eski kod
    // `??` ile 0'ı "bilinen" sayıp fişi ₺0 olarak Mikro'ya yazıyordu.
    const { satirlar } = yevmiyeGovdesi({ ...FIS, borc: 0, alacak: 45000 });
    expect(satirlar[0].fis_meblag0).toBe(45000);
    expect(satirlar[1].fis_meblag0).toBe(-45000);
  });

  it('borç ≠ alacak (dengesiz fiş) MEBLAĞI BELİRSİZDİR — sessizce borç seçilmez', () => {
    expect(() => yevmiyeGovdesi({ ...FIS, borc: 45000, alacak: 30000 })).toThrow(MikroGovdeHatasi);
  });

  it('sayı olmayan / negatif tutar throw eder (NaN Mikro JSON\'unda null olur)', () => {
    expect(() => yevmiyeGovdesi({ ...FIS, borc: 'kırk beş bin', alacak: undefined })).toThrow(MikroGovdeHatasi);
    expect(() => yevmiyeGovdesi({ ...FIS, borc: -45000, alacak: -45000 })).toThrow(MikroGovdeHatasi);
  });

  it("boş borç hesabı 100 (KASA)'ya YAZILMAZ", () => {
    expect(() => yevmiyeGovdesi({ ...FIS, debitHesap: '' })).toThrow(/borç hesap kodu bilinmiyor/);
    expect(() => yevmiyeGovdesi({ ...FIS, debitHesap: undefined })).toThrow(MikroGovdeHatasi);
    expect(() => yevmiyeGovdesi({ ...FIS, debitHesap: '  -  ' })).toThrow(MikroGovdeHatasi);
  });

  it('boş alacak hesabı da throw eder', () => {
    expect(() => yevmiyeGovdesi({ ...FIS, alacakHesap: '' })).toThrow(/alacak hesap kodu bilinmiyor/);
  });

  it('tarih yoksa/bozuksa "undefined.undefined." YAZILMAZ', () => {
    expect(() => yevmiyeGovdesi({ ...FIS, date: undefined })).toThrow(/fiş tarihi bilinmiyor/);
    expect(() => yevmiyeGovdesi({ ...FIS, date: '19.09.2026' })).toThrow(MikroGovdeHatasi); // ISO değil
    expect(() => yevmiyeGovdesi({ ...FIS, date: '2026-02-30' })).toThrow(MikroGovdeHatasi); // takvimde yok
  });

  it('hata mesajı satır numarası taşıyabilir (toplu aktarımda kaçıncı fiş)', () => {
    try {
      yevmiyeGovdesi({ ...FIS, borc: undefined, alacak: undefined }, 3);
      throw new Error('throw beklenmişti');
    } catch (e) {
      expect(e).toBeInstanceOf(MikroGovdeHatasi);
      expect((e as MikroGovdeHatasi).message).toMatch(/3\. kalemin/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tahsilatGovdesi — PARİTE', () => {
  it('tahsilat satırı eski eşlemeyle BİREBİR (cha_cinsi 19, evrak_tip 34, seri KSTAH, kasa_hizmet 4)', () => {
    const { payload, satir } = tahsilatGovdesi(TAHSILAT);
    expect(satir).toEqual({
      cha_tarihi: '19.09.2026',
      cha_tip: 1,
      cha_cinsi: 19,
      cha_normal_Iade: 0,
      cha_evrak_tip: 34,
      cha_evrakno_seri: 'KSTAH',
      cha_cari_cins: 0,
      cha_kod: '120-SIRIN',
      cha_d_cins: 0, cha_d_kur: 1, cha_d_kurtar: null,
      cha_srmrkkodu: '', cha_projekodu: '',
      cha_kasa_hizmet: 4,
      cha_meblag: 45000,
      cha_aciklama: TAHSILAT.aciklama,
    });
    expect(payload).toEqual({
      evraklar: [{ evrak_aciklamalari: [{ aciklama: TAHSILAT.aciklama }], satirlar: [satir] }],
    });
  });

  it('tediye: cha_tip 0 ve seri KSTED (yön ve seri birlikte döner)', () => {
    const { satir } = tahsilatGovdesi({ ...TAHSILAT, tip: 'tediye' });
    expect(satir.cha_tip).toBe(0);
    expect(satir.cha_evrakno_seri).toBe('KSTED');
  });

  it('açıklama yoksa boş string (sayı uydurulmuyor, metin alanı paritede)', () => {
    const { satir } = tahsilatGovdesi({ ...TAHSILAT, aciklama: undefined });
    expect(satir.cha_aciklama).toBe('');
  });
});

describe('tahsilatGovdesi — VARSAYILAN YOK', () => {
  it('yön bilinmiyorsa/yazım hatalıysa SESSİZCE tahsilat sayılmaz', () => {
    // Eski: `tip === 'tediye' ? 'tediye' : 'tahsilat'` — 'TEDIYE', 'odeme' veya boş
    // gelen her şey kasaya GİRİŞ olarak yazılıyordu; para çıkışı giriş görünüyordu.
    expect(() => tahsilatGovdesi({ ...TAHSILAT, tip: undefined })).toThrow(/yönü bilinmiyor/);
    expect(() => tahsilatGovdesi({ ...TAHSILAT, tip: 'TEDIYE' })).toThrow(MikroGovdeHatasi);
    expect(() => tahsilatGovdesi({ ...TAHSILAT, tip: 'odeme' })).toThrow(MikroGovdeHatasi);
  });

  it('tutar sayı değilse NaN (JSON\'da null) gönderilmez', () => {
    expect(() => tahsilatGovdesi({ ...TAHSILAT, tutar: 'kırk beş bin' })).toThrow(/tutarı bilinmiyor/);
    expect(() => tahsilatGovdesi({ ...TAHSILAT, tutar: undefined })).toThrow(MikroGovdeHatasi);
  });

  it('tutar ≤ 0 throw eder (sıfır tahsilat kasayı kirletir, negatif yön demektir)', () => {
    expect(() => tahsilatGovdesi({ ...TAHSILAT, tutar: 0 })).toThrow(MikroGovdeHatasi);
    expect(() => tahsilatGovdesi({ ...TAHSILAT, tutar: -45000 })).toThrow(MikroGovdeHatasi);
  });

  it('tarih yoksa BUGÜN varsayılmaz (tahsilat yanlış döneme düşerdi)', () => {
    expect(() => tahsilatGovdesi({ ...TAHSILAT, tarih: undefined })).toThrow(/tarihi bilinmiyor/);
    expect(() => tahsilatGovdesi({ ...TAHSILAT, tarih: '19/09/2026' })).toThrow(MikroGovdeHatasi);
  });

  it('cari kodu boşsa throw eder', () => {
    expect(() => tahsilatGovdesi({ ...TAHSILAT, cariKod: '' })).toThrow(/cari kodu bilinmiyor/);
    expect(() => tahsilatGovdesi({ ...TAHSILAT, cariKod: '   ' })).toThrow(MikroGovdeHatasi);
  });

  it('TRY dışı para birimi throw eder — gövde cha_d_cins 0 / cha_d_kur 1 ile SABİT TRY', () => {
    expect(() => tahsilatGovdesi({ ...TAHSILAT, paraBirimi: 'EUR' })).toThrow(/döviz cinsi/);
    // TRY (ya da hiç verilmemiş) sorunsuz geçer
    expect(tahsilatGovdesi({ ...TAHSILAT, paraBirimi: 'TRY' }).satir.cha_d_kur).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cariHareketGovdesi — PARİTE', () => {
  it('bilinen dekont satırı AYNEN geçer; payload DekontKaydetV2 zarfına sarılır', () => {
    const { payload, satir } = cariHareketGovdesi(DEKONT_SATIRI, 'Eylül ayı fiyat farkı dekontu');
    expect(satir).toEqual(DEKONT_SATIRI);
    expect(payload).toEqual({
      evraklar: [{
        satirlar: [DEKONT_SATIRI],
        evrak_aciklamalari: [{ aciklama: 'Eylül ayı fiyat farkı dekontu' }],
      }],
    });
  });

  it('açıklama verilmezse `evrak_aciklamalari` anahtarı HİÇ eklenmez (eski koşullu spread)', () => {
    const { payload } = cariHareketGovdesi(DEKONT_SATIRI);
    expect(payload.evraklar[0]).toEqual({ satirlar: [DEKONT_SATIRI] });
    expect('evrak_aciklamalari' in payload.evraklar[0]).toBe(false);
  });

  it('tanımadığı ek alanlar KORUNUR (gövde beyaz liste değil, zorunlu-beşli denetimi)', () => {
    const { satir } = cariHareketGovdesi({ ...DEKONT_SATIRI, cha_ozel_kod: 'PROJE-A', cha_vade_tarihi: '30.09.2026' });
    expect(satir.cha_ozel_kod).toBe('PROJE-A');
    expect(satir.cha_vade_tarihi).toBe('30.09.2026');
  });

  it('ISO tarih DD.MM.YYYY\'ye çevrilir, zaten TR olan aynen kalır', () => {
    expect(cariHareketGovdesi({ ...DEKONT_SATIRI, cha_tarihi: '2026-09-19' }).satir.cha_tarihi).toBe('19.09.2026');
    expect(cariHareketGovdesi(DEKONT_SATIRI).satir.cha_tarihi).toBe('19.09.2026');
  });

  it('cha_tip 0 (borç) ve 1 (alacak) İKİSİ DE geçerli — 0 falsy diye reddedilmez', () => {
    expect(cariHareketGovdesi({ ...DEKONT_SATIRI, cha_tip: 0 }).satir.cha_tip).toBe(0);
    expect(cariHareketGovdesi({ ...DEKONT_SATIRI, cha_tip: 1 }).satir.cha_tip).toBe(1);
  });
});

describe('cariHareketGovdesi — VARSAYILAN YOK (zorunlu beşli)', () => {
  it('cari kodu yoksa throw eder (eski rota kodsuz dekontu Mikro\'ya iletiyordu)', () => {
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_kod: '' })).toThrow(/cari kodu bilinmiyor/);
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_kod: undefined })).toThrow(MikroGovdeHatasi);
  });

  it('tutar bilinmiyor / 0 / negatifse throw eder', () => {
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_meblag: undefined })).toThrow(/tutarı bilinmiyor/);
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_meblag: 'on iki bin' })).toThrow(MikroGovdeHatasi);
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_meblag: 0 })).toThrow(MikroGovdeHatasi);
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_meblag: -12500 })).toThrow(MikroGovdeHatasi);
  });

  it('yön (cha_tip) yoksa 0 VARSAYILMAZ — borç/alacak karışması bakiyeyi ters çevirir', () => {
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_tip: undefined })).toThrow(/yönü bilinmiyor/);
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_tip: 2 })).toThrow(MikroGovdeHatasi);
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_tip: '0' })).toThrow(MikroGovdeHatasi); // tip de doğru olmalı
  });

  it('tarih yoksa/bozuksa throw eder', () => {
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_tarihi: undefined })).toThrow(/tarihi bilinmiyor/);
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_tarihi: '19/09/2026' })).toThrow(MikroGovdeHatasi);
  });

  it('evrak tipi yoksa throw eder (hangi deftere yazılacağı tahmin edilmez)', () => {
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_evrak_tip: undefined })).toThrow(/evrak tipi bilinmiyor/);
    expect(() => cariHareketGovdesi({ ...DEKONT_SATIRI, cha_evrak_tip: 0 })).toThrow(MikroGovdeHatasi);
  });
});
