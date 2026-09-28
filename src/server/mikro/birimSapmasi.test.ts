/** birimSapmasiRaporu — koli/paket ↔ adet şüphesi, TÜM geçmiş (kullanıcı 2026-09-28: "DAYSON-DYS.029 … bu tip hata var mı?"). */
import { describe, it, expect } from 'vitest';
import { birimSapmasiRaporu } from './birimSapmasi';
import { birimSapmalari, faturaToplamlari } from '../../lib/stokFiyat';

// KDV %20, iskontosuz: net = tutar, birim = tutar / miktar.
const satir = (sku: string, sira: number, miktar: number, birim: number, tarih = '2026-08-10T00:00:00', tip = 0) => ({
  sth_evraktip: tip === 0 ? '3' : '4', sth_evrakno_seri: '', sth_evrakno_sira: String(sira), sth_tarih: tarih, sth_stok_kod: sku,
  sth_tip: String(tip), sth_miktar: String(miktar), sth_tutar: String(miktar * birim), sth_vergi: String(miktar * birim * 0.2),
  sth_vergi_pntr: '4', sth_iptal: '0',
});
const baslik = (sira: number, meblag: number, cari: string, tip = 1) =>
  ({ cha_evrakno_seri: '', cha_evrakno_sira: sira, cha_tip: tip, cha_meblag: meblag, cha_iptal: 0, cha_tarihi: '2026-08-10T00:00:00', cha_kod: cari });

// DAYSON vakası: adet fiyatı ~₺129; evrak 410 ve 394 koli fiyatıyla (₺3.125 / ₺3.229) girilmiş.
const ADET = [301, 302, 303, 304, 305, 306].map((sira, i) => satir('DYS.029', sira, 100, 128 + i, `2026-0${3 + (i % 5)}-15T00:00:00`));
const E410 = satir('DYS.029', 410, 10, 3125, '2026-09-01T00:00:00');
const E394 = satir('DYS.029', 394, 5, 3229, '2026-08-20T00:00:00');

describe('birimSapmasiRaporu', () => {
  it('DAYSON: evrak 410 ve 394 listelenir (≈24–25 kat, alış), 6 adet satırı listelenmez; cari başlıktan', () => {
    const r = birimSapmasiRaporu([...ADET, E410, E394], [baslik(410, 37500, '320.01.0042'), baslik(394, 19374, '320.01.0042')]);
    expect(r.satirlar.map(s => s.evrakNo).sort()).toEqual(['394', '410']);
    for (const s of r.satirlar) {
      expect(s).toMatchObject({ sku: 'DYS.029', yon: 'alis', belirsiz: false, cariKod: '320.01.0042', ad: null });
      expect(s.kat).toBeGreaterThan(20);
      expect(s.kat).toBeLessThan(30);
    }
    const e410 = r.satirlar.find(s => s.evrakNo === '410');
    expect(e410).toMatchObject({ tarih: '2026-09-01', miktar: 10, birimFiyat: 3125 });
    expect(r.ozet).toMatchObject({ incelenenSatir: 8, urun: 1, degerlendirilenUrun: 1, degerlendirilemeyenUrun: 0,
      sapanSatir: 2, sapanUrun: 1, sapanFatura: 2, belirsizSatir: 0 });
  });

  it('kural TEK KAYNAK: satırlar lib/stokFiyat.birimSapmalari ile birebir (sıra, kat, medyan)', () => {
    const hareket = [...ADET, E410, E394];
    const basliklar = [baslik(410, 37500, 'C')];
    const r = birimSapmasiRaporu(hareket, basliklar);
    const dogrudan = birimSapmalari(hareket, { faturaToplamlari: faturaToplamlari(basliklar) });
    expect(r.satirlar.map(s => [s.sku, s.evrakNo, s.kat, s.medyan, s.belirsiz]))
      .toEqual(dogrudan.satirlar.map(s => [s.sku, s.evrakNo, s.kat, s.medyan, s.belirsiz]));
  });

  it('değerlendirilemeyen ürün "temiz" sayılmaz: 2 satırlı ürün ayrı sayılır; temiz ürün değerlendirilir ama listelenmez', () => {
    const iki = [satir('AZ-1', 501, 1, 10), satir('AZ-1', 502, 1, 400)];         // 40 kat ama yalnız 2 satır → hüküm yok
    const temiz = [satir('TMZ', 601, 2, 50), satir('TMZ', 602, 3, 52), satir('TMZ', 603, 1, 49)];
    const r = birimSapmasiRaporu([...iki, ...temiz], []);
    expect(r.satirlar).toEqual([]);
    expect(r.ozet).toMatchObject({ urun: 2, degerlendirilenUrun: 1, degerlendirilemeyenUrun: 1, sapanSatir: 0, sapanFatura: 0 });
  });

  it('cari: başlık yoksa null; aynı evrak anahtarında FARKLI cari taşıyan başlıklar varsa null (uydurma yok)', () => {
    const hareket = [...ADET, E410, E394];
    const r = birimSapmasiRaporu(hareket, [baslik(410, 37500, 'A'), baslik(410, 37500, 'B')]);
    expect(r.satirlar.find(s => s.evrakNo === '410')?.cariKod).toBeNull();
    expect(r.satirlar.find(s => s.evrakNo === '394')?.cariKod).toBeNull();     // 394'ün başlığı yok
    // Yön ayrımı: aynı sıra no'lu SATIŞ başlığının carisi alış satırına yazılmaz.
    const s = birimSapmasiRaporu(hareket, [baslik(410, 37500, 'SATIS-CARI', 0)]);
    expect(s.satirlar.find(x => x.evrakNo === '410')?.cariKod).toBeNull();
  });

  it('İPTAL başlık cari çakışmasına girmez: iptal edilip aynı numarayla yeniden girilen faturanın doğru carisi kalır', () => {
    const r = birimSapmasiRaporu([...ADET, E410, E394], [{ ...baslik(410, 37500, 'YANLIS'), cha_iptal: 1 }, baslik(410, 37500, 'DOGRU')]);
    expect(r.satirlar.find(s => s.evrakNo === '410')?.cariKod).toBe('DOGRU');
  });

  it('enflasyon bilgisi: 2022 ₺25 / 2025-26 ₺110 → eski satırlar listelenir ama tarihFarkiYil ≈ -3,5 (fiyat artışı olabilir); DAYSON ≈ 0', () => {
    const eski = [1, 2, 3].map(i => ({ ...satir('ENF', 900 + i, 10, 25, '2022-03-01T00:00:00'), sth_vergi: '45' }));   // 2022: %18
    const yeni = Array.from({ length: 15 }, (_, i) => satir('ENF', 950 + i, 10, 110, `2025-${String(1 + (i % 12)).padStart(2, '0')}-10T00:00:00`));
    const r = birimSapmasiRaporu([...eski, ...yeni, ...ADET, E410, E394], []);
    const enf = r.satirlar.filter(s => s.sku === 'ENF');
    expect(enf).toHaveLength(3);                                          // kural AYIKLAMAZ — yalnız bilgi
    for (const s of enf) {
      expect(s.kat).toBeLessThan(0.25);
      expect(s.anaGrupTarihi?.startsWith('2025-')).toBe(true);
      expect(s.tarihFarkiYil as number).toBeLessThan(-3);
    }
    for (const s of r.satirlar.filter(x => x.sku === 'DYS.029')) expect(Math.abs(s.tarihFarkiYil as number)).toBeLessThan(1);
    const tarihsiz = birimSapmasiRaporu([...ADET, { ...E410, sth_tarih: null }], []);
    expect(tarihsiz.satirlar.find(s => s.evrakNo === '410')?.tarihFarkiYil).toBeNull();
  });

  it('fiyatı çözülemeyen satır SAYILIR: değerlendirilen üründeki fiyatsız satır "temiz" hükmünün dışında olduğu görünür', () => {
    const tutarsiz = { ...satir('DYS.029', 777, 4, 100), sth_tutar: null };
    const r = birimSapmasiRaporu([...ADET, E410, tutarsiz, satir('TEK', 1, 1, 5), { ...satir('TEK', 2, 1, 5), sth_miktar: '0' }], []);
    expect(r.ozet).toMatchObject({ fiyatsizSatir: 2, fiyatsizSatirliUrun: 1, degerlendirilenUrun: 1, degerlendirilemeyenUrun: 1 });
    const dogrudan = birimSapmalari([...ADET, tutarsiz], {});
    expect(dogrudan.fiyatsiz.get('DYS.029')).toBe(1);
  });

  it('okuma sınıra dayandıysa (kesildi) ürün sayaçları null — "temiz"/"değerlendirilemeyen" söylenmez; liste ve satır sayıları durur', () => {
    const r = birimSapmasiRaporu([...ADET, E410, E394], [], { kesildi: true });
    expect(r.ozet).toMatchObject({ urun: null, degerlendirilenUrun: null, fiyatsizSatirliUrun: null, degerlendirilemeyenUrun: null,
      incelenenSatir: 8, sapanSatir: 2 });
  });

  it('tarih aralığı taranan satırlardan; satış yönündeki sapma da listelenir', () => {
    const satis = [701, 702, 703, 704].map(sira => satir('SAT-1', sira, 10, 200, '2024-02-01T00:00:00', 1));
    const koliSatis = satir('SAT-1', 705, 1, 4800, '2025-01-05T00:00:00', 1);
    const r = birimSapmasiRaporu([...satis, koliSatis], []);
    expect(r.satirlar).toHaveLength(1);
    expect(r.satirlar[0]).toMatchObject({ yon: 'satis', evrakNo: '705', tarih: '2025-01-05' });
    expect(r.ozet).toMatchObject({ ilkTarih: '2024-02-01', sonTarih: '2025-01-05' });
  });
});
