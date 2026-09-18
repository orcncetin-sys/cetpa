/**
 * satislar.test.ts — AccountingModule Satışlar sekmesi (Mikro satır birleştirme + KPI + drill-down
 * kırılımları) hesaplarının sözleşmesi (Faz 3 2/n, grup "satislar", 2026-09-14). ÖNCE YAZILDI.
 *
 * Sayfadaki sahte kesinlik (AccountingModule 1766/1794 `(a.kdv ?? 0) - (b.kdv ?? 0)`, 1798
 * `f.kdv || 0`, 1829 `String(o.totalPrice || 0)`, 1834/1836 `(a.totalPrice || 0)`; SatislarTab
 * 60-140 `o.totalPrice || 0` ×5, `o.kdvTutari || 0`, ortalama `: 0`, 242 `formatTRY(totalPrice || 0)`,
 * 249 `%{kdvOran ?? 0}`). Kural (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama
 * girmez, SAYILIR, sıralamada sona gider, ortalama/oran hesaplanmaz (null).
 */
import { describe, it, expect } from 'vitest';
import {
  cetpaEvrakNolari, cariAdHaritasi, mikroSatisSatirlari, cetpaSatisSatirlari, mikroSatisToplamlari,
  satisKayitlari, kdvOranAnahtari, satisKpi, kirilimSirala,
  type SatisSiparisi, type SatisFaturasi,
} from './satislar';
import { ekranTutari, tamTutar } from '../para';

// ── Fikstür ──────────────────────────────────────────────────────────────────────────────────────
const sirin: SatisSiparisi   = { customerName: 'Şirin İnşaat', totalPrice: 1200, faturali: true,  kdvOran: 20, kdvTutari: 200, syncedAt: '2026-03-01T09:00:00Z', mikroEvrakNo: ' A-100 ' };
const celik: SatisSiparisi   = { customerName: 'Çelik Yapı',   totalPrice: '800', faturali: false, kdvOran: '10', kdvTutari: 80, createdAt: '2026-02-10T09:00:00Z' };
const demir: SatisSiparisi   = { customerName: 'Demir Ticaret', totalPrice: null, faturali: false }; // tutarı, KDV'si, tarihi BİLİNMİYOR
const yilmaz: SatisSiparisi  = { customerName: 'Yılmaz Nakliyat', totalPrice: 500, faturali: true, kdvTutari: 50, syncedAt: '2026-01-05T09:00:00Z' }; // oranı yok
const orders = [sirin, celik, demir, yilmaz];

const cariler = [
  { name: 'Şirin İnşaat', mikroCariKod: ' C001 ' },
  { name: 'Kodsuz Müşteri' },
  { name: 'Boş Kodlu', mikroCariKod: '' },
];

const f1: SatisFaturasi = { id: 'F1', yon: 'giden', tarih: '2026-04-02', cariKod: 'C001', tutar: 3000, kdv: 500, oran: 20, oranKarma: false, faturaNo: 'B-200' };
const f2: SatisFaturasi = { id: 'F2', yon: 'giden', tarih: '2026-04-05', cariKod: 'C999', tutar: NaN, kdv: NaN, oran: null, oranKarma: false, faturaNo: 'B-201' }; // hook grubu: tutar/kdv bilinmiyor
const f3: SatisFaturasi = { id: 'F3', yon: 'giden', tarih: '2026-04-06', cariKod: 'C001', tutar: 9999, kdv: 1, oran: 20, oranKarma: false, faturaNo: 'A-100' }; // Cetpa'dan gönderilmiş → çift sayım
const f4: SatisFaturasi = { id: 'F4', yon: 'gelen', tarih: '2026-04-07', cariKod: 'C001', tutar: 7000, kdv: 1, oran: 20, oranKarma: false, faturaNo: 'B-300' }; // alış
const f5: SatisFaturasi = { id: 'F5', yon: 'giden', tarih: '2025-12-30', cariKod: 'C001', tutar: 100, kdv: 1, oran: 20, oranKarma: false, faturaNo: 'B-050' }; // geçen yıl
const f6: SatisFaturasi = { id: 'F6', yon: 'giden', tarih: '2026-04-01', cariKod: '', tutar: 1000, kdv: 150, oran: null, oranKarma: true, faturaNo: '' }; // karma oran, carisiz, evraksız
const faturalar = [f1, f2, f3, f4, f5, f6];

const evrak = cetpaEvrakNolari(orders);
const adlar = cariAdHaritasi(cariler);
const secenek = { yil: '2026', cetpaEvrakNolari: evrak, cariAdMap: adlar };
const ids = (l: readonly { id?: string }[]) => l.map(x => x.id);

// ── Yardımcı kümeler ─────────────────────────────────────────────────────────────────────────────
describe('cetpaEvrakNolari / cariAdHaritasi', () => {
  it('evrak numaraları kırpılır, boş/eksik olanlar kümeye girmez', () => {
    expect([...evrak]).toEqual(['A-100']);
    expect([...cetpaEvrakNolari([{ mikroEvrakNo: 123 }, { mikroEvrakNo: '   ' }, {}])]).toEqual(['123']);
  });
  it('cari kodu kırpılır, kodsuz/boş kodlu cari haritaya girmez', () => {
    expect([...adlar.entries()]).toEqual([['C001', 'Şirin İnşaat']]);
  });
});

// ── Mikro satış satırları ────────────────────────────────────────────────────────────────────────
describe('mikroSatisSatirlari — süzme (sayfa paritesi: yön/yıl/evrak dışlamaları AYNEN)', () => {
  it("yalnız 'giden', seçili yıl ve Cetpa evrak numarası taşımayanlar; boş evrak no elenmez", () => {
    expect(ids(mikroSatisSatirlari(faturalar, secenek))).toEqual(['F1', 'F2', 'F6']);
  });
  it("yıl 'hepsi' tüm yılları alır", () => {
    expect(ids(mikroSatisSatirlari(faturalar, { ...secenek, yil: 'hepsi' }))).toEqual(['F1', 'F2', 'F5', 'F6']);
  });
  it("müşteri adı: harita → cari kodu → '—'", () => {
    expect(mikroSatisSatirlari(faturalar, secenek).map(f => f.musteri)).toEqual(['Şirin İnşaat', 'C999', '—']);
  });
  it('arama: ad Türkçe küçük harfle (İ→i), tutar metni, fatura no; tutarı bilinmeyen satır "nan" ile eşleşmez', () => {
    expect(ids(mikroSatisSatirlari(faturalar, { ...secenek, arama: 'şİRİN' }))).toEqual(['F1']);
    expect(ids(mikroSatisSatirlari(faturalar, { ...secenek, arama: '3000' }))).toEqual(['F1']);
    expect(ids(mikroSatisSatirlari(faturalar, { ...secenek, arama: 'b-201' }))).toEqual(['F2']);
    expect(ids(mikroSatisSatirlari(faturalar, { ...secenek, arama: 'nan' }))).toEqual([]);
    expect(ids(mikroSatisSatirlari(faturalar, { ...secenek, arama: '' }))).toEqual(['F1', 'F2', 'F6']);
  });
});

describe('mikroSatisSatirlari — sıralama (bilinmeyen sona, `?? 0` ile ortaya dizilmez)', () => {
  const nullKdv: SatisFaturasi = { ...f2, id: 'F2n', kdv: null, tutar: null };
  const liste = [f1, nullKdv, f6];
  it('sıralama verilmezse girdi sırası korunur', () => {
    expect(ids(mikroSatisSatirlari(liste, secenek))).toEqual(['F1', 'F2n', 'F6']);
  });
  it("'kdvOran' anahtarı KDV TUTARINA göre sıralar (sayfa notu: oran hep %20, görünen değer tutar); null artan da azalan da SONDA", () => {
    expect(ids(mikroSatisSatirlari(liste, { ...secenek, siralama: { anahtar: 'kdvOran', azalan: false } }))).toEqual(['F6', 'F1', 'F2n']);
    expect(ids(mikroSatisSatirlari(liste, { ...secenek, siralama: { anahtar: 'kdvOran', azalan: true } }))).toEqual(['F1', 'F6', 'F2n']);
  });
  it("'totalPrice' tutar; bilinmeyen tutar sonda", () => {
    expect(ids(mikroSatisSatirlari(liste, { ...secenek, siralama: { anahtar: 'totalPrice', azalan: false } }))).toEqual(['F6', 'F1', 'F2n']);
    expect(ids(mikroSatisSatirlari(liste, { ...secenek, siralama: { anahtar: 'totalPrice', azalan: true } }))).toEqual(['F1', 'F6', 'F2n']);
  });
  it("'customerName' Türkçe harf sırası; 'date' ve 'faturali' tarih sırası", () => {
    expect(ids(mikroSatisSatirlari(liste, { ...secenek, siralama: { anahtar: 'customerName', azalan: false } }))).toEqual(['F6', 'F2n', 'F1']); // '—' < 'C999' < 'Şirin'
    expect(ids(mikroSatisSatirlari(liste, { ...secenek, siralama: { anahtar: 'date', azalan: false } }))).toEqual(['F6', 'F1', 'F2n']);
    expect(ids(mikroSatisSatirlari(liste, { ...secenek, siralama: { anahtar: 'faturali', azalan: true } }))).toEqual(['F2n', 'F1', 'F6']);
  });
});

// ── Cetpa satış satırları (displayedSatis) ───────────────────────────────────────────────────────
describe('cetpaSatisSatirlari — arama + sıralama', () => {
  const ad = (l: readonly SatisSiparisi[]) => l.map(o => o.customerName);
  it('arama: ad Türkçe küçük harf, tutar metni; tutarı bilinmeyen sipariş "0" aramasına ÇIKMAZ (eski `String(totalPrice || 0)`)', () => {
    expect(ad(cetpaSatisSatirlari(orders, { arama: 'ÇELİK' }))).toEqual(['Çelik Yapı']);
    expect(ad(cetpaSatisSatirlari(orders, { arama: '800' }))).toEqual(['Çelik Yapı']);
    expect(ad(cetpaSatisSatirlari(orders, { arama: '0' }))).toEqual(['Şirin İnşaat', 'Çelik Yapı', 'Yılmaz Nakliyat']);
    expect(ad(cetpaSatisSatirlari(orders, {}))).toEqual(ad(orders));
  });
  it("'totalPrice': sayısal string kabul, bilinmeyen tutar iki yönde de SONDA", () => {
    expect(ad(cetpaSatisSatirlari(orders, { siralama: { anahtar: 'totalPrice', azalan: false } }))).toEqual(['Yılmaz Nakliyat', 'Çelik Yapı', 'Şirin İnşaat', 'Demir Ticaret']);
    expect(ad(cetpaSatisSatirlari(orders, { siralama: { anahtar: 'totalPrice', azalan: true } }))).toEqual(['Şirin İnşaat', 'Çelik Yapı', 'Yılmaz Nakliyat', 'Demir Ticaret']);
  });
  it("'kdvOran': oranı bilinmeyenler sonda (eski `(a.kdvOran || 0)` onları %0 sayıp başa alıyordu)", () => {
    expect(ad(cetpaSatisSatirlari(orders, { siralama: { anahtar: 'kdvOran', azalan: false } }))).toEqual(['Çelik Yapı', 'Şirin İnşaat', 'Demir Ticaret', 'Yılmaz Nakliyat']);
  });
  it("'faturali' ve 'customerName' sayfadaki gibi; 'date' tarihi bilinmeyeni sona atar", () => {
    expect(ad(cetpaSatisSatirlari(orders, { siralama: { anahtar: 'faturali', azalan: true } }))).toEqual(['Şirin İnşaat', 'Yılmaz Nakliyat', 'Çelik Yapı', 'Demir Ticaret']);
    expect(ad(cetpaSatisSatirlari(orders, { siralama: { anahtar: 'customerName', azalan: false } }))).toEqual(['Çelik Yapı', 'Demir Ticaret', 'Şirin İnşaat', 'Yılmaz Nakliyat']);
    expect(ad(cetpaSatisSatirlari(orders, { siralama: { anahtar: 'date', azalan: false } }))).toEqual(['Yılmaz Nakliyat', 'Çelik Yapı', 'Şirin İnşaat', 'Demir Ticaret']);
    expect(ad(cetpaSatisSatirlari(orders, { siralama: { anahtar: 'date', azalan: true } }))).toEqual(['Şirin İnşaat', 'Çelik Yapı', 'Yılmaz Nakliyat', 'Demir Ticaret']);
  });
  it('girdi dizisini değiştirmez', () => {
    const kopya = [...orders];
    cetpaSatisSatirlari(orders, { siralama: { anahtar: 'totalPrice', azalan: true } });
    expect(orders).toEqual(kopya);
  });
});

// ── Mikro toplamları ─────────────────────────────────────────────────────────────────────────────
describe('mikroSatisToplamlari', () => {
  const satirlar = mikroSatisSatirlari(faturalar, secenek); // F1, F2, F6
  it('tutar/KDV bilinen satırlar toplanır; bilinmeyen (NaN) toplama GİRMEZ, SAYILIR', () => {
    const t = mikroSatisToplamlari(satirlar);
    expect(t.adet).toBe(3);
    expect(t.ciro).toEqual({ toplam: 4000, bilinen: 2, bilinmeyen: 1 });
    expect(t.kdv).toEqual({ toplam: 650, bilinen: 2, bilinmeyen: 1 });
  });
  it('boş liste gerçek 0 (hareketsiz dönem)', () => {
    expect(mikroSatisToplamlari([])).toEqual({ adet: 0, ciro: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, kdv: { toplam: 0, bilinen: 0, bilinmeyen: 0 } });
  });
});

// ── Drill-down kayıtları ─────────────────────────────────────────────────────────────────────────
describe('satisKayitlari — orders + (dahilse) Mikro faturaları sipariş şeklinde', () => {
  const satirlar = mikroSatisSatirlari(faturalar, secenek);
  it('mikroDahil=false → yalnız siparişler', () => {
    expect(satisKayitlari(orders, satirlar, false)).toEqual(orders);
  });
  it('mikroDahil=true → Mikro satırları FATURALI sayılır; oran null → undefined; karma taşınır; syncedAt yok (sayfa paritesi)', () => {
    const k = satisKayitlari(orders, satirlar, true);
    expect(k).toHaveLength(7);
    expect(k[4]).toEqual({ customerName: 'Şirin İnşaat', totalPrice: 3000, faturali: true, kdvOran: 20, oranKarma: false, kdvTutari: 500, syncedAt: undefined });
    expect(k[5]).toMatchObject({ customerName: 'C999', kdvOran: undefined, faturali: true });
    expect(Number.isNaN(k[5].totalPrice)).toBe(true);
    expect(k[6]).toMatchObject({ customerName: '—', oranKarma: true, kdvTutari: 150 });
  });
});

describe('kdvOranAnahtari', () => {
  it("karma → 'karma'; bilinen oran → sayı metni (0 dahil); bilinmeyen → 'bilinmiyor' (eskiden sessizce ATLANIYORDU)", () => {
    expect(kdvOranAnahtari(20, true)).toBe('karma');
    expect(kdvOranAnahtari(20)).toBe('20');
    expect(kdvOranAnahtari('10')).toBe('10');
    expect(kdvOranAnahtari(0)).toBe('0');
    for (const o of [undefined, null, NaN, '', 'abc']) expect(kdvOranAnahtari(o)).toBe('bilinmiyor');
  });
});

// ── KPI ──────────────────────────────────────────────────────────────────────────────────────────
describe('satisKpi — Mikro dahil', () => {
  const satirlar = mikroSatisSatirlari(faturalar, secenek); // F1 (3000/500 %20), F2 (NaN/NaN), F6 (1000/150 karma)
  const kpi = satisKpi(orders, satirlar, true);
  it('toplam ciro additive (sayfa notu "bu modülü bozma"): Cetpa 2500 + Mikro 4000; bilinmeyen 2 (Demir + F2)', () => {
    expect(kpi.ciro).toEqual({ toplam: 6500, bilinen: 5, bilinmeyen: 2 });
    expect(ekranTutari(kpi.ciro)).toBe(6500); // kısmi toplam + sayfa notu "2 kayıt tutarsız"
  });
  it('faturalı ciro = faturalı siparişler + Mikro; faturasız ciro yalnız faturasız siparişler', () => {
    expect(kpi.faturaliCiro).toEqual({ toplam: 5700, bilinen: 4, bilinmeyen: 1 });
    expect(kpi.faturasizCiro).toEqual({ toplam: 800, bilinen: 1, bilinmeyen: 1 });
  });
  it('KDV = sipariş kdvTutari + Mikro kdv; KDV alanı olmayan sipariş bilinmeyen SAYILIR', () => {
    expect(kpi.kdv).toEqual({ toplam: 980, bilinen: 5, bilinmeyen: 2 });
  });
  it('adetler: sipariş adedi yalnız Cetpa; faturalı adet Mikro satırlarını da sayar', () => {
    expect(kpi.adet).toBe(4);
    expect(kpi.faturaliAdet).toBe(5);
    expect(kpi.faturasizAdet).toBe(2);
    expect(kpi.mikro.adet).toBe(3);
    expect(kpi.mikro.ciro).toEqual({ toplam: 4000, bilinen: 2, bilinmeyen: 1 });
    expect(kpi.mikro.kdv).toEqual({ toplam: 650, bilinen: 2, bilinmeyen: 1 });
  });
  it('ortalama sipariş: bir siparişin tutarı bile bilinmiyorsa null (eskiden `|| 0` ile 625 basılırdı)', () => {
    expect(kpi.ortalama).toBeNull();
    expect(kpi.kayitOrtalamasi).toBeNull();
  });
  it('müşteri kırılımı: aynı müşteri Cetpa + Mikro birleşir; tutarı bilinmeyen sayılır', () => {
    expect(kpi.musteriKirilimi).toEqual({
      'Şirin İnşaat':   { toplam: 4200, bilinen: 2, bilinmeyen: 0 },
      'Çelik Yapı':     { toplam: 800,  bilinen: 1, bilinmeyen: 0 },
      'Demir Ticaret':  { toplam: 0,    bilinen: 0, bilinmeyen: 1 },
      'Yılmaz Nakliyat':{ toplam: 500,  bilinen: 1, bilinmeyen: 0 },
      'C999':           { toplam: 0,    bilinen: 0, bilinmeyen: 1 },
      '—':              { toplam: 1000, bilinen: 1, bilinmeyen: 0 },
    });
  });
  it("oran kırılımı: karma ayrı kova; oranı bilinmeyen 'bilinmiyor' kovasında (KDV'si bilinse bile); KDV'si bilinmeyen sayılır", () => {
    expect(kpi.oranKirilimi).toEqual({
      '20':         { toplam: 700, bilinen: 2, bilinmeyen: 0 },
      '10':         { toplam: 80,  bilinen: 1, bilinmeyen: 0 },
      'bilinmiyor': { toplam: 50,  bilinen: 1, bilinmeyen: 2 }, // Yılmaz 50; Demir + F2 bilinmeyen
      'karma':      { toplam: 150, bilinen: 1, bilinmeyen: 0 },
    });
    // Kırılım toplamı KPI toplamına eşit — eskiden oransız kayıtlar kovaya girmediğinden tutmuyordu.
    const kovaToplam = Object.values(kpi.oranKirilimi).reduce((s, t) => s + t.toplam, 0);
    expect(kovaToplam).toBe(kpi.kdv.toplam);
  });
});

describe('satisKpi — Mikro hariç (satisKaynak = cetpa)', () => {
  const satirlar = mikroSatisSatirlari(faturalar, secenek);
  const kpi = satisKpi(orders, satirlar, false);
  it('Mikro hiçbir toplama/adede/kırılıma girmez', () => {
    expect(kpi.ciro).toEqual({ toplam: 2500, bilinen: 3, bilinmeyen: 1 });
    expect(kpi.faturaliCiro).toEqual({ toplam: 1700, bilinen: 2, bilinmeyen: 0 });
    expect(kpi.kdv).toEqual({ toplam: 330, bilinen: 3, bilinmeyen: 1 });
    expect(kpi.faturaliAdet).toBe(2);
    expect(kpi.mikro).toEqual({ adet: 0, ciro: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, kdv: { toplam: 0, bilinen: 0, bilinmeyen: 0 } });
    expect(Object.keys(kpi.musteriKirilimi)).toEqual(['Şirin İnşaat', 'Çelik Yapı', 'Demir Ticaret', 'Yılmaz Nakliyat']);
    expect(kpi.oranKirilimi.karma).toBeUndefined();
  });
});

describe('satisKpi — sayfa paritesi ve sınırlar', () => {
  const bilinenler = [sirin, celik, yilmaz];
  const satirlar = mikroSatisSatirlari([f1, f6], secenek);
  it('tüm girdiler bilinince eski reduce formülüyle AYNI sayı', () => {
    const kpi = satisKpi(bilinenler, satirlar, true);
    const eskiCiro = bilinenler.reduce((s, o) => s + Number(o.totalPrice), 0) + satirlar.reduce((s, f) => s + Number(f.tutar), 0);
    const eskiKdv = bilinenler.reduce((s, o) => s + Number(o.kdvTutari), 0) + satirlar.reduce((s, f) => s + Number(f.kdv), 0);
    expect(tamTutar(kpi.ciro)).toBe(eskiCiro);      // 2500 + 4000
    expect(tamTutar(kpi.kdv)).toBe(eskiKdv);        // 330 + 650
    expect(kpi.ortalama).toBeCloseTo(2500 / 3, 6);  // kart: yalnız Cetpa siparişleri (sayfa paritesi)
    expect(kpi.kayitOrtalamasi).toBeCloseTo(6500 / 5, 6); // drill-down toplamı: Mikro dahil kayıtlar
  });
  it('boş sipariş listesi: toplamlar GERÇEK 0 (ekranda ₺0,00), ortalama null (adet 0 → "%0"/₺0 basılmaz)', () => {
    const kpi = satisKpi([], [], true);
    expect(kpi.ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(ekranTutari(kpi.ciro)).toBe(0);
    expect(kpi.ortalama).toBeNull();
    expect(kpi.kayitOrtalamasi).toBeNull();
    expect(kpi.musteriKirilimi).toEqual({});
    expect(kpi.oranKirilimi).toEqual({});
  });
  it("hiç bilinen tutar yokken ekran '—' (ekranTutari NaN), 0 değil", () => {
    const kpi = satisKpi([demir], [], false);
    expect(kpi.ciro).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(Number.isNaN(ekranTutari(kpi.ciro))).toBe(true);
  });
});

describe('kirilimSirala — drill-down satır sırası', () => {
  it('ekran tutarına göre azalan; yalnız bilinmeyenden oluşan kova SONDA', () => {
    const k = satisKpi(orders, mikroSatisSatirlari(faturalar, secenek), true).musteriKirilimi;
    expect(kirilimSirala(k).map(([ad]) => ad)).toEqual(['Şirin İnşaat', '—', 'Çelik Yapı', 'Yılmaz Nakliyat', 'Demir Ticaret', 'C999']);
  });
});
