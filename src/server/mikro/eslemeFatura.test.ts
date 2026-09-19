/**
 * eslemeFatura.test.ts — Mikro'dan OKUYAN fatura eşlemelerinin sözleşmesi
 * (Faz 3 3/n, grup "eslemeFatura", 2026-09-19). ÖNCE YAZILDI.
 *
 * Kilitlenen dört şey:
 *   1. PARİTE — bilinen girdide üretilen doküman ESKİSİYLE BİREBİR aynı. Özellikle
 *      `mikrofat__<cid>__<seri>-<sira>` doküman id'si: biçimi değişirse idempotentlik
 *      kırılır ve her koşu MÜKERRER sipariş üretir.
 *   2. BİLİNMEYEN SAYI 0 YAZILMAZ — `Number(x ?? 0) || 0` kalıbı fatura toplamını,
 *      kalem miktarını ve kalem tutarını sessizce ₺0/0 adet yapıyordu. Bilinmiyorsa
 *      alan hiç yazılmaz (sipariş başlığı) ya da `null` yazılır (kalem dizisi) + SAYILIR.
 *   3. NULL'LAMA YOK — Mikro okuması geçici bozulunca `{...row}` yayılımı merge:true ile
 *      mevcut değerlerin ÜSTÜNE null yazıyordu. Bayat değer, silinmiş değerden iyidir.
 *   4. OKUMA ARIZASI — bir alan ≥5 satırlık importun TAMAMINDA bilinmiyorsa bu veri
 *      değil, kolon adı/şema arızasıdır: not'un BAŞINA uyarı girer (sessiz sıfır sınıfının
 *      import karşılığı).
 */
import { describe, it, expect } from 'vitest';
import {
  OKUMA_ARIZASI_ESIK,
  faturaYonu,
  faturaEsle,
  faturalariEsle,
  kalemHaritasi,
  faturadanSiparis,
  siparisTuretmeNotu,
  kalemleriBirimle,
  okumaArizasiUyarisi,
} from './eslemeFatura';

/** Şirin İnşaat'a kesilmiş çimento faturası — CARI_HESAP_HAREKETLERI başlığı. */
const satisBasligi = {
  cha_Guid: 'A1B2-0321',
  cha_evrakno_seri: '',
  cha_evrakno_sira: 321,
  cha_tarihi: '2026-08-01',
  cha_tip: 0,
  cha_cinsi: 6,
  cha_kod: '120 01 001',
  cha_aciklama: 'ŞİRİN İNŞAAT — ÇİMENTO 50KG',
  cha_meblag: 21600,
  cha_aratoplam: 18000,
  cha_ebelge_turu: 1,
  cha_belge_no: 'MF2026000321',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
describe('faturaYonu — sınıflandırma bayrağı, bilinmiyorsa SATIŞ VARSAYILMAZ', () => {
  it('cha_tip 0 = satış (Cetpa kesti), 1 = alış (gelen)', () => {
    expect(faturaYonu({ cha_tip: 0 })).toBe('satis');
    expect(faturaYonu({ cha_tip: 1 })).toBe('alis');
  });

  it('sayısal string kabul edilir (SQL sürücüsü metin döndürebilir)', () => {
    expect(faturaYonu({ cha_tip: '0' })).toBe('satis');
    expect(faturaYonu({ cha_tip: '1' })).toBe('alis');
  });

  it('cha_tip okunamazsa null — `?? 0` olsaydı alış faturası SATIŞ sayılırdı', () => {
    expect(faturaYonu({ cha_tip: null })).toBeNull();
    expect(faturaYonu({})).toBeNull();
    expect(faturaYonu({ cha_tip: '' })).toBeNull();
    expect(faturaYonu({ cha_tip: 'abc' })).toBeNull();
  });

  it('cha_tip yoksa daha önce yazılmış `yon` alanına düşer (mikroFaturalar dokümanı)', () => {
    expect(faturaYonu({ cha_tip: null, yon: 'alis' })).toBe('alis');
    expect(faturaYonu({ yon: 'satis' })).toBe('satis');
    expect(faturaYonu({ yon: 'gelen' })).toBeNull();   // tanınmayan etiket uydurulmaz
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('faturaEsle — mikroFaturalar dokümanı (PARİTE + null süzme)', () => {
  it('PARİTE: bilinen satırda doküman eskisiyle birebir (ham kolonlar + yon)', () => {
    const e = faturaEsle({ ...satisBasligi });
    expect(e.guid).toBe('A1B2-0321');
    expect(e.yon).toBe('satis');
    expect(e.bilinmeyen).toEqual([]);
    expect(e.doc).toEqual({ ...satisBasligi, yon: 'satis' });
  });

  it('alış faturası (cha_tip 1) yon=alis yazar', () => {
    expect(faturaEsle({ ...satisBasligi, cha_tip: 1 }).yon).toBe('alis');
  });

  it('cha_tip okunamazsa `yon` alanı HİÇ YAZILMAZ (merge:true mevcut yönü korur)', () => {
    const e = faturaEsle({ ...satisBasligi, cha_tip: null });
    expect(e.yon).toBeNull();
    expect('yon' in e.doc).toBe(false);
    expect(e.bilinmeyen).toContain('cha_tip');
  });

  it('null/undefined kolon dokümana YAZILMAZ — toplu null\'lama tüm tutarları silerdi', () => {
    const e = faturaEsle({ ...satisBasligi, cha_meblag: null, cha_aratoplam: undefined });
    expect('cha_meblag' in e.doc).toBe(false);
    expect('cha_aratoplam' in e.doc).toBe(false);
    expect(e.bilinmeyen).toEqual(['cha_aratoplam', 'cha_meblag']);
    expect(e.doc.cha_Guid).toBe('A1B2-0321');   // diğer alanlar aynen iner
  });

  it('boş string ve gerçek 0 BİLİNEN değerdir — süzülmez', () => {
    const e = faturaEsle({ ...satisBasligi, cha_evrakno_seri: '', cha_meblag: 0 });
    expect(e.doc.cha_evrakno_seri).toBe('');
    expect(e.doc.cha_meblag).toBe(0);
    expect(e.bilinmeyen).toEqual([]);
  });

  it('cha_Guid yoksa guid null döner (rota kendi id\'sini üretir)', () => {
    const e = faturaEsle({ ...satisBasligi, cha_Guid: null });
    expect(e.guid).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('faturalariEsle — sayaçlar + okuma arızası', () => {
  const satir = (i: number, ek: Record<string, unknown> = {}) => ({ ...satisBasligi, cha_Guid: `G${i}`, cha_evrakno_sira: 300 + i, ...ek });

  it('satış/alış/yönsüz sayılır', () => {
    const o = faturalariEsle([satir(1), satir(2, { cha_tip: 1 }), satir(3, { cha_tip: null })]);
    expect(o.satis).toBe(1);
    expect(o.alis).toBe(1);
    expect(o.yonsuz).toBe(1);
    expect(o.kayitlar).toHaveLength(3);
  });

  it(`bir alan ${OKUMA_ARIZASI_ESIK}+ satırın TAMAMINDA okunamıyorsa OKUMA ARIZASI — uyarı not'un BAŞINDA`, () => {
    const rows = Array.from({ length: OKUMA_ARIZASI_ESIK }, (_, i) => satir(i, { cha_meblag: null }));
    const o = faturalariEsle(rows);
    expect(o.okumaArizasi).toEqual(['cha_meblag']);
    expect(o.not?.startsWith('UYARI: cha_meblag alanı hiçbir satırda okunamadı')).toBe(true);
    expect(o.not).toMatch(/kolon adı\/şema/);
  });

  it('eşiğin altında okuma arızası İLAN EDİLMEZ, yalnız sayaç yazılır', () => {
    const rows = Array.from({ length: OKUMA_ARIZASI_ESIK - 1 }, (_, i) => satir(i, { cha_meblag: null }));
    const o = faturalariEsle(rows);
    expect(o.okumaArizasi).toEqual([]);
    expect(o.not).toBe(`${OKUMA_ARIZASI_ESIK - 1} satırın cha_meblag alanı bilinmiyor`);
  });

  it('boş seri okuma arızası DEĞİLDİR — bu kurulumda seri meşru olarak boş', () => {
    const rows = Array.from({ length: OKUMA_ARIZASI_ESIK + 3 }, (_, i) => satir(i, { cha_evrakno_seri: '' }));
    const o = faturalariEsle(rows);
    expect(o.okumaArizasi).toEqual([]);
    expect(o.not).toBeNull();
  });

  it('yönü okunamayan faturalar not\'a yazılır', () => {
    const o = faturalariEsle([satir(1), satir(2, { cha_tip: null })]);
    expect(o.not).toMatch(/1 faturanın yönü \(cha_tip\) okunamadı — yön yazılmadı/);
  });

  it('her şey okunduysa not YOK (gürültü üretme)', () => {
    expect(faturalariEsle([satir(1), satir(2)]).not).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('kalemHaritasi — PG aynasından sipariş kalemleri', () => {
  const pgSatirlari = [
    { seri: 'A', sira: '321', sku: 'CIM50',  ad: 'ÇİMENTO 50KG', miktar: 100, tutar: 18000, vergi: 3600 },
    { seri: 'A', sira: '321', sku: 'DEMIR12', ad: '',             miktar: null, tutar: 5000,  vergi: 1000 },
    { seri: '',  sira: '322', sku: 'KUM1',   ad: 'KUM 1 TON',    miktar: 2,    tutar: null,  vergi: 200 },
  ];

  it('PARİTE: bilinen satırda kalem {sku,name,quantity,total} ve total = tutar + KDV', () => {
    const { harita } = kalemHaritasi(pgSatirlari);
    expect(harita.get('A|321')?.[0]).toEqual({ sku: 'CIM50', name: 'ÇİMENTO 50KG', quantity: 100, total: 21600 });
  });

  it('ürün adı boşsa SKU\'ya düşer (eski davranış)', () => {
    const { harita } = kalemHaritasi(pgSatirlari);
    expect(harita.get('A|321')?.[1].name).toBe('DEMIR12');
  });

  it('miktar bilinmiyorsa quantity NULL — `Number(x) || 0` 0 ADET yazıyordu', () => {
    const { harita, miktarsiz } = kalemHaritasi(pgSatirlari);
    expect(harita.get('A|321')?.[1].quantity).toBeNull();
    expect(miktarsiz).toBe(1);
  });

  it('tutar ya da KDV bilinmiyorsa total NULL — COALESCE(...,0) toplamı EKSİK gösteriyordu', () => {
    const { harita, tutarsiz } = kalemHaritasi(pgSatirlari);
    expect(harita.get('|322')?.[0].total).toBeNull();
    expect(tutarsiz).toBe(1);
  });

  it('meşru 0 (bedelsiz/numune satır) 0 KALIR, bilinmeyen sayılmaz', () => {
    const { harita, miktarsiz, tutarsiz } = kalemHaritasi([
      { seri: 'A', sira: '400', sku: 'NUMUNE', ad: 'NUMUNE', miktar: 0, tutar: 0, vergi: 0 },
    ]);
    expect(harita.get('A|400')?.[0]).toEqual({ sku: 'NUMUNE', name: 'NUMUNE', quantity: 0, total: 0 });
    expect(miktarsiz).toBe(0);
    expect(tutarsiz).toBe(0);
  });

  it('anahtar seri|sıra — seri boşken de kırılmaz, boşluklar kırpılır', () => {
    const { harita } = kalemHaritasi([{ seri: ' A ', sira: ' 321 ', sku: 'X', ad: 'X', miktar: 1, tutar: 1, vergi: 0 }]);
    expect(harita.has('A|321')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('faturadanSiparis — satış faturasından Cetpa siparişi', () => {
  const kalemler = [{ sku: 'CIM50', name: 'ÇİMENTO 50KG', quantity: 100, total: 21600 }];

  it('PARİTE: bilinen faturada doküman + id eskisiyle BİREBİR', () => {
    const t = faturadanSiparis({ ...satisBasligi, cha_evrakno_seri: 'A' }, kalemler,
      { companyId: 'cetpa', cariUnvan: 'ŞİRİN İNŞAAT LTD. ŞTİ.' });
    expect(t).not.toBeNull();
    expect(t!.id).toBe('mikrofat__cetpa__A-321');
    expect(t!.olusturmaTarihi).toBe('2026-08-01T12:00:00.000Z');
    expect(t!.tutarBilinmiyor).toBe(false);
    expect(t!.doc).toEqual({
      orderNumber: 'MF-A321',
      customerName: 'ŞİRİN İNŞAAT LTD. ŞTİ.',
      mikroCariKod: '120 01 001',
      customerType: 'B2B',
      status: 'Delivered',
      totalPrice: 21600,
      lineItems: kalemler,
      orderDate: '2026-08-01',
      source: 'mikro-fatura',
      mikroEvrak: { seri: 'A', sira: '321' },
      faturali: true,
      mikroFaturaNo: 'A321',
      companyId: 'cetpa',
    });
  });

  it('doküman id\'si boşluk/eğik çizgi taşımaz (idempotentlik anahtarı)', () => {
    const t = faturadanSiparis({ ...satisBasligi, cha_evrakno_seri: 'A B/C' }, [], { companyId: 'cetpa' });
    expect(t!.id).toBe('mikrofat__cetpa__A_B_C-321');
  });

  it('fatura toplamı bilinmiyorsa totalPrice alanı HİÇ YAZILMAZ (istemci siparisTutari ile okur)', () => {
    const t = faturadanSiparis({ ...satisBasligi, cha_meblag: null }, kalemler, { companyId: 'cetpa' });
    expect('totalPrice' in t!.doc).toBe(false);
    expect(t!.tutarBilinmiyor).toBe(true);
  });

  it('okunamayan tutar metni de bilinmiyordur (`Number(x ?? 0) || 0` ₺0 yazıyordu)', () => {
    const t = faturadanSiparis({ ...satisBasligi, cha_meblag: 'abc' }, kalemler, { companyId: 'cetpa' });
    expect('totalPrice' in t!.doc).toBe(false);
  });

  it('meşru ₺0 fatura 0 olarak yazılır', () => {
    const t = faturadanSiparis({ ...satisBasligi, cha_meblag: 0 }, kalemler, { companyId: 'cetpa' });
    expect(t!.doc.totalPrice).toBe(0);
    expect(t!.tutarBilinmiyor).toBe(false);
  });

  it('cari ünvanı yoksa cari koduna, o da yoksa —\'ye düşer', () => {
    expect(faturadanSiparis(satisBasligi, [], { companyId: 'c' })!.doc.customerName).toBe('120 01 001');
    expect(faturadanSiparis({ ...satisBasligi, cha_kod: '' }, [], { companyId: 'c' })!.doc.customerName).toBe('—');
  });

  it('evrak sıra no yoksa sipariş TÜRETİLMEZ (null)', () => {
    expect(faturadanSiparis({ ...satisBasligi, cha_evrakno_sira: '' }, [], { companyId: 'c' })).toBeNull();
    expect(faturadanSiparis({ ...satisBasligi, cha_evrakno_sira: null }, [], { companyId: 'c' })).toBeNull();
  });

  it('tarih okunamazsa orderDate null ve oluşturma tarihi null (rota sunucu damgası koyar)', () => {
    const t = faturadanSiparis({ ...satisBasligi, cha_tarihi: null }, [], { companyId: 'c' });
    expect(t!.doc.orderDate).toBeNull();
    expect(t!.olusturmaTarihi).toBeNull();
  });

  it('kalemi olmayan fatura boş dizi yazar', () => {
    expect(faturadanSiparis(satisBasligi, [], { companyId: 'c' })!.doc.lineItems).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('siparisTuretmeNotu', () => {
  const bos = { turetilen: 0, tutarsiz: 0, yonsuz: 0, miktarsizKalem: 0, tutarsizKalem: 0, pgYok: false };

  it('söylenecek bir şey yoksa null', () => {
    expect(siparisTuretmeNotu({ ...bos, turetilen: 12 })).toBeNull();
  });

  it(`${OKUMA_ARIZASI_ESIK}+ siparişin TAMAMINDA tutar bilinmiyorsa okuma arızası uyarısı BAŞA gelir`, () => {
    const n = siparisTuretmeNotu({ ...bos, turetilen: 7, tutarsiz: 7 });
    expect(n?.startsWith('UYARI: cha_meblag alanı hiçbir satırda okunamadı')).toBe(true);
  });

  it('kısmi eksik yalnız sayaç üretir', () => {
    const n = siparisTuretmeNotu({ ...bos, turetilen: 7, tutarsiz: 3 });
    expect(n).toBe('3 siparişin tutarı bilinmiyor');
  });

  it('eşiğin altındaki tam eksiklik arıza sayılmaz', () => {
    const n = siparisTuretmeNotu({ ...bos, turetilen: 3, tutarsiz: 3 });
    expect(n).toBe('3 siparişin tutarı bilinmiyor');
  });

  it('yönsüz fatura, kalem eksikleri ve PG yokluğu ayrı ayrı bildirilir', () => {
    const n = siparisTuretmeNotu({ turetilen: 4, tutarsiz: 0, yonsuz: 2, miktarsizKalem: 5, tutarsizKalem: 1, pgYok: true });
    expect(n).toMatch(/2 faturanın yönü \(cha_tip\) okunamadı — satış sayılmadı/);
    expect(n).toMatch(/5 kalemin miktarı bilinmiyor/);
    expect(n).toMatch(/1 kalemin tutarı bilinmiyor/);
    expect(n).toMatch(/PG yok/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('kalemleriBirimle — sth_birim_pntr → sto_birimN_ad', () => {
  const kalem = { sth_stok_kod: 'CIM50', sth_miktar: 100, sto_birim1_ad: 'ADET', sto_birim2_ad: 'KOLİ', sto_birim3_ad: '' };

  it('işaretçi 1-3 arasındaysa o birimin adı çözülür, diğer alanlar korunur', () => {
    const [r] = kalemleriBirimle([{ ...kalem, sth_birim_pntr: 2 }]);
    expect(r.birim).toBe('KOLİ');
    expect(r.sth_stok_kod).toBe('CIM50');
  });

  it('sayısal metin işaretçi de çözülür', () => {
    expect(kalemleriBirimle([{ ...kalem, sth_birim_pntr: '1' }])[0].birim).toBe('ADET');
  });

  it('işaretçi aralık dışı / okunamaz ise birim UYDURULMAZ', () => {
    expect(kalemleriBirimle([{ ...kalem, sth_birim_pntr: 0 }])[0].birim).toBeUndefined();
    expect(kalemleriBirimle([{ ...kalem, sth_birim_pntr: 4 }])[0].birim).toBeUndefined();
    expect(kalemleriBirimle([{ ...kalem, sth_birim_pntr: null }])[0].birim).toBeUndefined();
    expect(kalemleriBirimle([{ ...kalem, sth_birim_pntr: 'abc' }])[0].birim).toBeUndefined();
  });

  it('birim adı boş/boşluksa alan yazılmaz; dolu ad kırpılır', () => {
    expect(kalemleriBirimle([{ ...kalem, sth_birim_pntr: 3 }])[0].birim).toBeUndefined();
    expect(kalemleriBirimle([{ ...kalem, sth_birim_pntr: 1, sto_birim1_ad: '  TON  ' }])[0].birim).toBe('TON');
  });
});

describe('okumaArizasiUyarisi', () => {
  it('alan yoksa uyarı da yok', () => {
    expect(okumaArizasiUyarisi([])).toBeNull();
  });

  it('birden çok alan tek cümlede toplanır', () => {
    expect(okumaArizasiUyarisi(['cha_meblag', 'cha_kod']))
      .toBe('UYARI: cha_meblag, cha_kod alanı hiçbir satırda okunamadı — kolon adı/şema kontrol edin');
  });
});
