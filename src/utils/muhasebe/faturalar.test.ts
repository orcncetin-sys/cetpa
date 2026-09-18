/**
 * faturalar.test.ts — Muhasebe › Faturalar sekmesinin HESAP sözleşmesi. ÖNCE YAZILDI (Faz 3 2/n, 2026-09-14).
 *
 * Kaynak (AccountingModule.tsx 1729-1776 mikroFaturaSatirlari · 397-420 handleCreateInvoice ·
 * FaturalarTab.tsx 140-165 KPI). Sahte-kesinlik siteleri:
 *   AccountingModule 400  totalPrice = src.totalPrice || 0         → tutarı bilinmeyen sipariş ₺0 FATURA olarak kaydediliyordu
 *   AccountingModule 1764 a.tutar - b.tutar                         → null tutar 0 gibi ortaya diziliyordu
 *   AccountingModule 1766 (a.kdv ?? 0) - (b.kdv ?? 0)               → KDV'si bilinmeyen satır 0 gibi sıralanıyordu
 *   FaturalarTab 155      invoices.reduce(totalPrice || 0)          → tutarı bilinmeyen Cetpa faturası 0 sayılıyordu
 *   FaturalarTab 156-157  reduce(f.tutar)                           → hook 0'a zorluyor; burada bilinmeyen SAYILIR
 * Kural (CLAUDE.md): bilinmeyen tutar toplama GİRMEZ, SAYILIR; ekran `ekranTutari` ile '—' + not.
 * Filtre/dışlama kuralları (yön, yıl, e-belge türü, Cetpa evrak no ile çift sayım) AYNEN korunur — sayfa paritesi
 * testleri eski zinciri satır satır kopyalayıp aynı girdiyle aynı sırayı/sayıyı ister.
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari } from '../para';
import { paraYaz } from '../currency';
import {
  mikroFaturaSatirlari, faturaKpi, faturaTutarlari, faturaSatirKarsilastir,
  cetpaEvrakNolari, cariAdHaritasi,
  type MikroFaturaSecim,
} from './faturalar';

// ── Fikstür: Mikro faturaları (hook şekli; hepsi BİLİNEN) ──────────────────────────────────────
const m = (x: {
  id: string; cariKod: string; tarih: string; tutar: number; faturaNo: string; kdv: number;
  yon: 'gelen' | 'giden'; ebelgeTuru: number;
}) => ({ matrah: x.tutar - x.kdv, oran: 20 as number | null, oranKarma: false, subeNo: 0, ...x });

const MIKRO = [
  m({ id: 'm1', cariKod: '120.01', tarih: '2026-03-10', tutar: 12000, faturaNo: 'CET-1001', kdv: 2000, yon: 'giden', ebelgeTuru: 0 }),
  m({ id: 'm2', cariKod: '320.05', tarih: '2026-05-02', tutar: 5000, faturaNo: 'ALS-77', kdv: 833.33, yon: 'gelen', ebelgeTuru: 1 }),
  m({ id: 'm3', cariKod: '120.02', tarih: '2025-12-30', tutar: 8000, faturaNo: 'CET-0900', kdv: 1333.33, yon: 'giden', ebelgeTuru: -1 }),
  // Cetpa siparişinden Mikro'ya gönderilmiş fatura — evrak no orders.mikroEvrakNo'da; çift sayılmaz.
  m({ id: 'm4', cariKod: '120.01', tarih: '2026-06-15', tutar: 3000, faturaNo: 'CET-1002', kdv: 500, yon: 'giden', ebelgeTuru: 0 }),
  // e-İrsaliye (tür 2): e-Fatura/e-Arşiv filtresinde KESİN karşıt tür → gizlenir.
  m({ id: 'm5', cariKod: '320.09', tarih: '2026-08-08', tutar: 7000, faturaNo: 'IRS-5', kdv: 1166.67, yon: 'gelen', ebelgeTuru: 2 }),
  // Cari kodsuz + evrak nosuz satır: müşteri '—', evrak eşleşmesi asla yapılmaz.
  m({ id: 'm6', cariKod: '', tarih: '2026-07-01', tutar: 1500, faturaNo: '', kdv: 250, yon: 'giden', ebelgeTuru: 0 }),
];
const EVRAK = new Set(['CET-1002']);
const CARI = new Map([['120.01', 'Şirin İnşaat'], ['320.05', 'Çelik Yapı'], ['120.02', 'Işık Beton']]);
const secim = (p: Partial<MikroFaturaSecim> = {}): MikroFaturaSecim =>
  ({ yon: 'hepsi', yil: 'hepsi', ebelgeTuru: 'all', cetpaEvrakNolari: EVRAK, cariAdMap: CARI, ...p });
const idler = (rows: ReadonlyArray<{ id: string }>) => rows.map(r => r.id);

/**
 * ESKİ ZİNCİR — AccountingModule.tsx 1729-1776'nın birebir kopyası (sayfa paritesi). Yalnız BİLİNEN
 * girdiyle çağrılır; yeni modül aynı girdiye aynı sırayı vermek zorunda.
 */
function eskiMikroFaturaSatirlari(
  faturalar: typeof MIKRO, faturaYon: 'hepsi' | 'giden' | 'gelen', faturaYil: string,
  invoiceTypeFilter: 'all' | 'e-fatura' | 'e-arsiv' | 'ihracat', cetpayaAitEvrakNo: Set<string>,
  cariAdMap: Map<string, string>, satisSortKey: string, satisSortDir: 'asc' | 'desc',
) {
  return faturalar
    .filter(f => faturaYon === 'hepsi' || f.yon === faturaYon)
    .filter(f => faturaYil === 'hepsi' || (typeof f.tarih === 'string' && f.tarih.startsWith(faturaYil)))
    .filter(f => !f.faturaNo || !cetpayaAitEvrakNo.has(f.faturaNo))
    .filter(f => {
      if (invoiceTypeFilter === 'all') return true;
      if (invoiceTypeFilter === 'e-fatura') return f.ebelgeTuru === 0 || f.ebelgeTuru === -1;
      if (invoiceTypeFilter === 'e-arsiv') return f.ebelgeTuru === 1 || f.ebelgeTuru === -1;
      return false;
    })
    .map(f => ({ ...f, musteri: cariAdMap.get(f.cariKod) || f.cariKod || '—' }))
    .sort((a, b) => (satisSortDir === 'asc' ? 1 : -1) * (
      satisSortKey === 'customerName' ? a.musteri.localeCompare(b.musteri, 'tr')
      : satisSortKey === 'totalPrice' ? a.tutar - b.tutar
      : satisSortKey === 'kdvOran' ? (a.kdv ?? 0) - (b.kdv ?? 0)
      : a.tarih.localeCompare(b.tarih)
    ));
}

describe('mikroFaturaSatirlari — filtre kuralları (AccountingModule 1729-1776)', () => {
  it('yön: hepsi → tümü (çift sayım hariç); giden → yalnız satış; gelen → yalnız alış', () => {
    expect(idler(mikroFaturaSatirlari(MIKRO, secim()))).toEqual(['m1', 'm2', 'm3', 'm5', 'm6']);
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ yon: 'giden' })))).toEqual(['m1', 'm3', 'm6']);
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ yon: 'gelen' })))).toEqual(['m2', 'm5']);
  });
  it("yıl: tarih 'YYYY-' ile başlıyorsa o yıl; 'hepsi' tüm yıllar; string olmayan tarih yıl seçiliyken düşer", () => {
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ yil: '2026' })))).toEqual(['m1', 'm2', 'm5', 'm6']);
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ yil: '2025' })))).toEqual(['m3']);
    const tarihsiz = [...MIKRO, { ...MIKRO[0], id: 'mT', tarih: undefined as unknown as string, faturaNo: 'CET-T' }];
    expect(idler(mikroFaturaSatirlari(tarihsiz, secim({ yil: '2026' })))).not.toContain('mT');
    expect(idler(mikroFaturaSatirlari(tarihsiz, secim({ yil: 'hepsi' })))).toContain('mT');
  });
  it('çift sayım: Cetpa siparişinin mikroEvrakNo’su olan Mikro faturası listelenmez; evrak nosu boş satır asla elenmez', () => {
    expect(idler(mikroFaturaSatirlari(MIKRO, secim()))).not.toContain('m4');
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ cetpaEvrakNolari: new Set(['']) })))).toContain('m6');
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ cetpaEvrakNolari: new Set() })))).toContain('m4');
  });
  it('e-belge türü: bilinmeyen tür (-1) GİZLENMEZ; e-Fatura→0|-1, e-Arşiv→1|-1, İhracat→hiçbiri (cha_ebelge_turu’da yok)', () => {
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ ebelgeTuru: 'e-fatura' })))).toEqual(['m1', 'm3', 'm6']);
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ ebelgeTuru: 'e-arsiv' })))).toEqual(['m2', 'm3']);
    expect(mikroFaturaSatirlari(MIKRO, secim({ ebelgeTuru: 'ihracat' }))).toEqual([]);
  });
  it('müşteri adı: cari haritasında varsa ad, yoksa cari kod, o da yoksa "—"', () => {
    const rows = mikroFaturaSatirlari(MIKRO, secim());
    const ad = (id: string) => rows.find(r => r.id === id)?.musteri;
    expect(ad('m1')).toBe('Şirin İnşaat');
    expect(ad('m2')).toBe('Çelik Yapı');
    expect(ad('m5')).toBe('320.09');
    expect(ad('m6')).toBe('—');
  });
  it('sıralama verilmezse giriş sırası korunur; Mikro alanları (matrah/oran/uuid) satırda kalır', () => {
    const rows = mikroFaturaSatirlari(MIKRO, secim());
    expect(idler(rows)).toEqual(['m1', 'm2', 'm3', 'm5', 'm6']);
    expect(rows[0].matrah).toBe(10000);
    expect(rows[0].oran).toBe(20);
  });
});

describe('mikroFaturaSatirlari — sıralama (bilinmeyen 0 sayılmaz, sona gider)', () => {
  it('müşteri adı Türkçe harf sırasıyla (Çelik < Işık < Şirin), azalan tersi', () => {
    const asc = mikroFaturaSatirlari(MIKRO, secim({ sirala: { anahtar: 'customerName', yon: 'asc' } })).map(r => r.musteri);
    expect(asc.indexOf('Çelik Yapı')).toBeLessThan(asc.indexOf('Işık Beton'));
    expect(asc.indexOf('Işık Beton')).toBeLessThan(asc.indexOf('Şirin İnşaat'));
    const desc = mikroFaturaSatirlari(MIKRO, secim({ sirala: { anahtar: 'customerName', yon: 'desc' } })).map(r => r.musteri);
    expect(desc.indexOf('Şirin İnşaat')).toBeLessThan(desc.indexOf('Işık Beton'));
    expect(desc.indexOf('Işık Beton')).toBeLessThan(desc.indexOf('Çelik Yapı'));
  });
  it('tarih (varsayılan anahtar, "faturali" dahil): artan eskiden yeniye, azalan yeniden eskiye', () => {
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ yon: 'giden', sirala: { anahtar: 'date', yon: 'asc' } })))).toEqual(['m3', 'm1', 'm6']);
    expect(idler(mikroFaturaSatirlari(MIKRO, secim({ yon: 'giden', sirala: { anahtar: 'faturali', yon: 'desc' } })))).toEqual(['m6', 'm1', 'm3']);
  });
  it('tutar: bilinmeyen (null) tutar 0 DEĞİL — artan da azalan da SONDA (eskiden `a.tutar - b.tutar` null’u 0 sayıp başa koyuyordu)', () => {
    const liste = [MIKRO[0], MIKRO[5], { ...MIKRO[2], id: 'mU', tutar: null as unknown as number, faturaNo: 'CET-U' }];
    expect(idler(mikroFaturaSatirlari(liste, secim({ sirala: { anahtar: 'totalPrice', yon: 'asc' } })))).toEqual(['m6', 'm1', 'mU']);
    expect(idler(mikroFaturaSatirlari(liste, secim({ sirala: { anahtar: 'totalPrice', yon: 'desc' } })))).toEqual(['m1', 'm6', 'mU']);
  });
  it('KDV kolonu (kdvOran anahtarı) KDV TUTARINA göre sıralar; bilinmeyen KDV sonda (eskiden `kdv ?? 0` başa diziyordu)', () => {
    const liste = [MIKRO[0], MIKRO[5], { ...MIKRO[2], id: 'mU', kdv: null as unknown as number, faturaNo: 'CET-U' }];
    expect(idler(mikroFaturaSatirlari(liste, secim({ sirala: { anahtar: 'kdvOran', yon: 'asc' } })))).toEqual(['m6', 'm1', 'mU']);
    expect(idler(mikroFaturaSatirlari(liste, secim({ sirala: { anahtar: 'kdvOran', yon: 'desc' } })))).toEqual(['m1', 'm6', 'mU']);
  });
});

describe('mikroFaturaSatirlari — SAYFA PARİTESİ (bilinen girdiyle eski zincirle aynı sıra)', () => {
  const kombinasyonlar: Array<['hepsi' | 'giden' | 'gelen', string, 'all' | 'e-fatura' | 'e-arsiv' | 'ihracat', string, 'asc' | 'desc']> = [
    ['hepsi', 'hepsi', 'all', 'date', 'desc'],
    ['hepsi', '2026', 'all', 'date', 'asc'],
    ['giden', 'hepsi', 'e-fatura', 'totalPrice', 'asc'],
    ['giden', 'hepsi', 'e-fatura', 'totalPrice', 'desc'],
    ['hepsi', 'hepsi', 'e-arsiv', 'kdvOran', 'desc'],
    ['gelen', '2026', 'all', 'customerName', 'asc'],
    ['hepsi', 'hepsi', 'all', 'customerName', 'desc'],
    ['hepsi', 'hepsi', 'ihracat', 'date', 'asc'],
    ['hepsi', '2025', 'all', 'faturali', 'asc'],
  ];
  for (const [yon, yil, tur, anahtar, sYon] of kombinasyonlar) {
    it(`yön=${yon} yıl=${yil} tür=${tur} sıra=${anahtar}/${sYon}`, () => {
      const eski = eskiMikroFaturaSatirlari(MIKRO, yon, yil, tur, EVRAK, CARI, anahtar, sYon);
      const yeni = mikroFaturaSatirlari(MIKRO, secim({ yon, yil, ebelgeTuru: tur, sirala: { anahtar: anahtar as 'date', yon: sYon } }));
      expect(idler(yeni)).toEqual(idler(eski));
      expect(yeni.map(r => r.musteri)).toEqual(eski.map(r => r.musteri));
    });
  }
});

// ── Tablo sıralaması (FaturalarTab'ın KENDİ sort'u) ────────────────────────────────────────────
/**
 * Bu, modülün `mikroFaturaSatirlari` sıralamasından AYRI bir yüzeydir ve EKRANDAKİ SON SIRAYI O BELİRLER:
 * FaturalarTab tabloyu `invoiceSort` ile yeniden sıralar (modül Satışlar sekmesinin sort state'ini kullanıyor).
 * Kendi karşılaştırıcısı `av < bv / av > bv / return 0` idi; NaN iki karşılaştırmada da false verir, yani
 * NaN "her şeye eşit" sayılır ve karşılaştırıcı TUTARSIZ olur — hook bilinmeyeni NaN verdiğinden (2026-09-18)
 * tek bir bilinmeyen satır BİLİNEN satırların sırasını da bozuyordu. Ölçüm: matrah [5000,NaN,3000,9000,NaN,1000]
 * artan sıra `5000, NaN, 3000, 9000, NaN, 1000` — yani hiç sıralanmıyordu.
 * Kural buraya alındı ki bir sonraki "yarım düzeltme" olmasın: modülü düzeltip ekrandaki kopyayı bırakmak
 * tam da bu arızayı üretti.
 */
describe('faturaSatirKarsilastir — tablo sıralaması (FaturalarTab 288-352)', () => {
  const MAP = { faturaNo: 'faturaNo', customerName: 'musteri', date: 'tarih',
    kdvOran: 'oran', kdvHaric: 'matrah', totalPrice: 'tutar', faturaTipi: 'yon' } as const;
  const sirala = <R,>(rows: readonly R[], kolon: string, yon: 'asc' | 'desc', map?: Record<string, string>) =>
    [...rows].sort(faturaSatirKarsilastir<R>(kolon, yon, map));

  it('SAYISAL kolon: bilinmeyen (NaN) satır BİLİNENLERİN sırasını bozmaz — hepsi sıralanır, bilinmeyen sonda', () => {
    // Hakem turunun ölçtüğü girdi: satır JOIN'i tutmayan iki fatura NaN matrah verir.
    const rows = [5000, NaN, 3000, 9000, NaN, 1000].map((matrah, i) => ({ id: `r${i}`, matrah }));
    expect(sirala(rows, 'kdvHaric', 'asc', MAP).map(r => r.matrah)).toEqual([1000, 3000, 5000, 9000, NaN, NaN]);
    expect(sirala(rows, 'kdvHaric', 'desc', MAP).map(r => r.matrah)).toEqual([9000, 5000, 3000, 1000, NaN, NaN]);
  });
  it('tutar (totalPrice): NaN/null/undefined 0 SAYILMAZ, artan da azalan da SONDA', () => {
    const rows = [
      { id: 'a', tutar: 12000 }, { id: 'b', tutar: NaN }, { id: 'c', tutar: 1500 },
      { id: 'd', tutar: null }, { id: 'e', tutar: undefined },
    ];
    expect(idler(sirala(rows, 'totalPrice', 'asc', MAP)).slice(0, 2)).toEqual(['c', 'a']);
    expect(idler(sirala(rows, 'totalPrice', 'desc', MAP)).slice(0, 2)).toEqual(['a', 'c']);
    for (const yon of ['asc', 'desc'] as const) {
      expect(idler(sirala(rows, 'totalPrice', yon, MAP)).slice(2).sort()).toEqual(['b', 'd', 'e']);
    }
  });
  it('KDV oranı (kdvOran → oran): çözülemeyen oran (null) 0 gibi BAŞA dizilmez, sonda', () => {
    const rows = [{ id: 'a', oran: 20 }, { id: 'b', oran: null }, { id: 'c', oran: 0 }, { id: 'd', oran: 10 }];
    expect(idler(sirala(rows, 'kdvOran', 'asc', MAP))).toEqual(['c', 'd', 'a', 'b']);
    expect(idler(sirala(rows, 'kdvOran', 'desc', MAP))).toEqual(['a', 'd', 'c', 'b']);
  });
  it('METİN kolonu: eski ham `<`/`>` sırası AYNEN korunur (sayfa paritesi), eksik alan "" sayılır', () => {
    const rows = [{ id: 'a', musteri: 'Çelik Yapı' }, { id: 'b', musteri: 'Şirin İnşaat' }, { id: 'c', musteri: '—' }];
    const beklenen = [...rows].sort((x, y) => (x.musteri < y.musteri ? -1 : x.musteri > y.musteri ? 1 : 0));
    expect(idler(sirala(rows, 'customerName', 'asc', MAP))).toEqual(idler(beklenen));
    expect(idler(sirala(rows, 'customerName', 'desc', MAP))).toEqual(idler([...beklenen].reverse()));
    const eksik = [{ id: 'x', musteri: 'Şirin İnşaat' }, { id: 'y' }];
    expect(idler(sirala(eksik, 'customerName', 'asc', MAP))).toEqual(['y', 'x']);
  });
  it('tablo eşlemesinde OLMAYAN kolon (Mikro satırında "status" yok) → sıra bozulmaz', () => {
    const rows = [{ id: 'a', tutar: 1 }, { id: 'b', tutar: 2 }];
    expect(idler(sirala(rows, 'status', 'asc', MAP))).toEqual(['a', 'b']);
    expect(idler(sirala(rows, 'status', 'desc', MAP))).toEqual(['a', 'b']);
  });
  it('Cetpa `invoices` bloğu (eşleme YOK, alan adı = kolon adı): tutarı/oranı olmayan ESKİ fatura sonda', () => {
    // Oranı/matrahı olmayan eski Cetpa faturaları gerçek bir veri şekli — FaturalarTab 313 bu yüzden
    // `%undefined` yerine '—' basıyor (2026-09-18). Sıralamada da 0 sayılmamalı.
    const rows = [
      { id: 'c1', totalPrice: 24000, kdvOran: 20 }, { id: 'c2', totalPrice: undefined, kdvOran: undefined },
      { id: 'c3', totalPrice: 1000, kdvOran: 10 },
    ];
    expect(idler(sirala(rows, 'totalPrice', 'asc'))).toEqual(['c3', 'c1', 'c2']);
    expect(idler(sirala(rows, 'totalPrice', 'desc'))).toEqual(['c1', 'c3', 'c2']);
    expect(idler(sirala(rows, 'kdvOran', 'asc'))).toEqual(['c3', 'c1', 'c2']);
    // Metin kolonu eşlemesiz de aynı: durum alanı ham karşılaştırmayla sıralanır.
    const durumlu = [{ id: 'd1', status: 'Kesildi' }, { id: 'd2', status: 'Beklemede' }];
    expect(idler(sirala(durumlu, 'status', 'asc'))).toEqual(['d2', 'd1']);
  });
});

// ── KPI ────────────────────────────────────────────────────────────────────────────────────────
const CETPA = [
  { id: 'c1', faturaNo: 'FTR-2026-001', customerName: 'Şirin İnşaat', totalPrice: 24000, faturaTipi: 'e-fatura' },
  { id: 'c2', faturaNo: 'FTR-2026-002', customerName: 'Çelik Yapı', totalPrice: '6000', faturaTipi: 'e-arsiv' }, // sayısal string bilinen sayıdır
  { id: 'c3', faturaNo: 'FTR-2026-003', customerName: 'Işık Beton', totalPrice: 1000, faturaTipi: 'ihracat' },
];
const MIKRO_SATIR = [
  { yon: 'giden', tutar: 12000, musteri: 'Şirin İnşaat' },
  { yon: 'gelen', tutar: 5000, musteri: 'Çelik Yapı' },
  { yon: 'giden', tutar: 8000, musteri: 'Işık Beton' },
  { yon: 'gelen', tutar: 7000, musteri: '320.09' },
];

describe('faturaKpi — Faturalar sekmesi KPI kartları (FaturalarTab 140-165)', () => {
  it("kaynak 'hepsi': adet Cetpa+Mikro; satış = Cetpa + Mikro-giden; alış = Mikro-gelen (satış cirosu ile alış gideri TOPLANMAZ)", () => {
    const k = faturaKpi(CETPA, MIKRO_SATIR, { kaynak: 'hepsi' });
    expect(k.adet).toBe(7);
    expect(k.cetpaAdet).toBe(3);
    expect(k.mikroAdet).toBe(4);
    expect(k.mikroGidenAdet).toBe(2);
    expect(k.mikroGelenAdet).toBe(2);
    expect(k.satis).toEqual({ toplam: 51000, bilinen: 5, bilinmeyen: 0 });
    expect(k.alis).toEqual({ toplam: 12000, bilinen: 2, bilinmeyen: 0 });
    expect(k.eFaturaAdet).toBe(1);
    expect(k.eArsivAdet).toBe(1);
  });
  it("kaynak 'cetpa': Mikro sayıları 0, alış gerçek 0 (hareketsiz), satış yalnız Cetpa", () => {
    const k = faturaKpi(CETPA, MIKRO_SATIR, { kaynak: 'cetpa' });
    expect(k.adet).toBe(3);
    expect(k.mikroAdet).toBe(0);
    expect(k.mikroGidenAdet).toBe(0);
    expect(k.satis).toEqual({ toplam: 31000, bilinen: 3, bilinmeyen: 0 });
    expect(k.alis).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(ekranTutari(k.alis)).toBe(0);
  });
  it("kaynak 'mikro': Cetpa sayıları 0 (e-Fatura/e-Arşiv sayacı da), satış yalnız Mikro-giden", () => {
    const k = faturaKpi(CETPA, MIKRO_SATIR, { kaynak: 'mikro' });
    expect(k.adet).toBe(4);
    expect(k.cetpaAdet).toBe(0);
    expect(k.eFaturaAdet).toBe(0);
    expect(k.eArsivAdet).toBe(0);
    expect(k.satis).toEqual({ toplam: 20000, bilinen: 2, bilinmeyen: 0 });
    expect(k.alis).toEqual({ toplam: 12000, bilinen: 2, bilinmeyen: 0 });
  });
  it('tutarı bilinmeyen Cetpa faturası satış toplamına GİRMEZ, SAYILIR (eskiden `totalPrice || 0`)', () => {
    const liste = [...CETPA, { id: 'c4', faturaNo: 'FTR-2026-004', customerName: 'Tutarsız Kayıt', totalPrice: undefined, faturaTipi: 'e-fatura' }];
    const k = faturaKpi(liste, [], { kaynak: 'cetpa' });
    expect(k.satis).toEqual({ toplam: 31000, bilinen: 3, bilinmeyen: 1 });
    expect(ekranTutari(k.satis)).toBe(31000); // kısmi toplam + sayfa "1 kayıt tutarsız" notu
    expect(k.adet).toBe(4); // adet sayımı tutara bağlı değil
  });
  it("HİÇ bilinen yokken ekran '—' (eskiden ₺0,00 basılıyordu)", () => {
    const k = faturaKpi([{ totalPrice: 'abc', faturaTipi: 'e-fatura' }, { totalPrice: NaN, faturaTipi: 'e-arsiv' }], [], { kaynak: 'cetpa' });
    expect(k.satis).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
    expect(paraYaz(ekranTutari(k.satis))).toBe('—');
  });
  it('Mikro satırının tutarı bilinmiyorsa (hook düzeltilince null gelecek) alış/satış toplamına girmez, sayılır', () => {
    const mikro = [...MIKRO_SATIR, { yon: 'gelen', tutar: null, musteri: 'Bilinmeyen Alış' }, { yon: 'giden', tutar: undefined, musteri: 'Bilinmeyen Satış' }];
    const k = faturaKpi([], mikro, { kaynak: 'mikro' });
    expect(k.alis).toEqual({ toplam: 12000, bilinen: 2, bilinmeyen: 1 });
    expect(k.satis).toEqual({ toplam: 20000, bilinen: 2, bilinmeyen: 1 });
    expect(k.mikroGelenAdet).toBe(3);
  });
  it('boş liste: adet 0, toplamlar GERÇEK 0 (bilinmeyen değil)', () => {
    const k = faturaKpi([], [], { kaynak: 'hepsi' });
    expect(k.adet).toBe(0);
    expect(k.satis).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(ekranTutari(k.satis)).toBe(0);
  });
  it('SAYFA PARİTESİ: bilinen SAYI girdiyle eski formülle aynı sayı', () => {
    // Yalnız `number` tutarlar: eski `a + (totalPrice || 0)` reduce'u sayısal STRING tutarı ('6000') sessizce
    // birleştiriyordu ("24000600010000") — bu bir parite girdisi değil, düzeltilen bir hatadır (bkz. bir üst test).
    const CETPA_SAYISAL = CETPA.map(i => ({ ...i, totalPrice: Number(i.totalPrice) }));
    for (const kaynak of ['cetpa', 'mikro', 'hepsi'] as const) {
      const cetpaVar = kaynak !== 'mikro', mikroVar = kaynak !== 'cetpa';
      const mikroGiden = mikroVar ? MIKRO_SATIR.filter(f => f.yon === 'giden') : [];
      const mikroGelen = mikroVar ? MIKRO_SATIR.filter(f => f.yon === 'gelen') : [];
      const cetpaToplam = cetpaVar ? CETPA_SAYISAL.reduce((a, i) => a + (i.totalPrice || 0), 0) : 0;
      const satisToplam = cetpaToplam + mikroGiden.reduce((a, f) => a + f.tutar, 0);
      const alisToplam = mikroGelen.reduce((a, f) => a + f.tutar, 0);
      const k = faturaKpi(CETPA_SAYISAL, MIKRO_SATIR, { kaynak });
      expect(k.satis.toplam).toBe(satisToplam);
      expect(k.alis.toplam).toBe(alisToplam);
      expect(k.adet).toBe((cetpaVar ? CETPA_SAYISAL.length : 0) + (mikroVar ? MIKRO_SATIR.length : 0));
    }
  });
  it("sayısal string tutar ('6000') SAYI olarak toplanır — eski reduce metin birleştiriyordu", () => {
    const k = faturaKpi(CETPA, [], { kaynak: 'cetpa' });
    expect(k.satis.toplam).toBe(31000);
    expect(typeof k.satis.toplam).toBe('number');
  });
});

// ── Fatura kesme tutarları ─────────────────────────────────────────────────────────────────────
describe('faturaTutarlari — handleCreateInvoice (AccountingModule 397-420)', () => {
  it('bilinen brüt + oran → toplam / KDV hariç / KDV (2 haneye yuvarlı, eski round2 ile aynı)', () => {
    expect(faturaTutarlari(12000, 20)).toEqual({ toplam: 12000, kdvHaric: 10000, kdvTutari: 2000 });
    // 100 / 1.18 = 84.7457… → 84.75; KDV = 100 − 84.75 = 15.25 (eski kod: round2 sonra fark)
    expect(faturaTutarlari(100, 18)).toEqual({ toplam: 100, kdvHaric: 84.75, kdvTutari: 15.25 });
    expect(faturaTutarlari('1200', '20')).toEqual({ toplam: 1200, kdvHaric: 1000, kdvTutari: 200 });
  });
  it('oran %0 → KDV hariç = toplam, KDV 0; açık 0 tutar BİLİNEN sayıdır (₺0 fatura, bilinmeyen değil)', () => {
    expect(faturaTutarlari(5000, 0)).toEqual({ toplam: 5000, kdvHaric: 5000, kdvTutari: 0 });
    expect(faturaTutarlari(0, 20)).toEqual({ toplam: 0, kdvHaric: 0, kdvTutari: 0 });
  });
  it('tutar bilinmiyorsa null — kaydedilmez (eskiden `totalPrice || 0` ile ₺0 fatura yazılıyordu)', () => {
    expect(faturaTutarlari(undefined, 20)).toBeNull();
    expect(faturaTutarlari(null, 20)).toBeNull();
    expect(faturaTutarlari('abc', 20)).toBeNull();
    expect(faturaTutarlari(NaN, 20)).toBeNull();
    expect(faturaTutarlari(Infinity, 20)).toBeNull();
  });
  it('EKSİ brüt tutar null — modaldaki `min="0"` tarayıcıda hiç zorlanmıyor (modalda <form> yok, buton doğrudan handleCreateInvoice çağırıyor)', () => {
    expect(faturaTutarlari(-100, 20)).toBeNull();
    expect(faturaTutarlari('-100', 20)).toBeNull();
    expect(faturaTutarlari(-0.01, 0)).toBeNull();
    // Sınır: 0 EKSİ DEĞİL — `min="0"` 0'a izin verir, bedelsiz/numune faturası meşru; bilinmeyenle
    // karıştırılmaz (bkz. bir üstteki "açık 0 tutar BİLİNEN sayıdır" testi).
    expect(faturaTutarlari(0, 20)).not.toBeNull();
  });
  it('oran bilinmiyor ya da negatifse null — %20 varsayılmaz', () => {
    expect(faturaTutarlari(12000, undefined)).toBeNull();
    expect(faturaTutarlari(12000, 'yirmi')).toBeNull();
    expect(faturaTutarlari(12000, -5)).toBeNull();
  });
});

// ── Yardımcılar: evrak no kümesi + cari ad haritası (AccountingModule 1718-1727) ────────────────
describe('cetpaEvrakNolari / cariAdHaritasi', () => {
  it('mikroEvrakNo kırpılır, boş/eksik atlanır', () => {
    const s = cetpaEvrakNolari([{ mikroEvrakNo: ' CET-1002 ' }, { mikroEvrakNo: '' }, {}, { mikroEvrakNo: null }, { mikroEvrakNo: 'CET-1003' }]);
    expect([...s]).toEqual(['CET-1002', 'CET-1003']);
  });
  it('mikroCariKod → ad; kodsuz müşteri haritaya girmez; kod kırpılır', () => {
    const h = cariAdHaritasi([{ name: 'Şirin İnşaat', mikroCariKod: ' 120.01 ' }, { name: 'Kodsuz Müşteri' }, { name: 'Çelik Yapı', mikroCariKod: '320.05' }]);
    expect(h.get('120.01')).toBe('Şirin İnşaat');
    expect(h.get('320.05')).toBe('Çelik Yapı');
    expect(h.size).toBe(2);
  });
});
