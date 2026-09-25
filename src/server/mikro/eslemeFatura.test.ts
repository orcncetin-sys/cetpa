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
  satisFaturasiHareketleri,
  mfKalemleri,
  kalemYenilenmeli,
  MF_KALEM_SURUMU,
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
describe('satisFaturasiHareketleri — kiracının stok hareketlerinden SATIŞ faturası kalemleri (MF-383 kök nedeni)', () => {
  const h = (p: Record<string, unknown>) => ({ source: 'mikro_sql', sth_evraktip: 4, sth_evrakno_seri: '', sth_evrakno_sira: 321, ...p });
  it("yalnız source 'mikro_sql' + satış (sth_evraktip 4); anahtar seri|sıra (başlıkla AYNI, kırpılmış)", () => {
    const m = satisFaturasiHareketleri([
      h({ sth_stok_kod: 'A' }),
      h({ sth_stok_kod: 'B', sth_evrakno_seri: ' X ', sth_evrakno_sira: ' 7 ' }),
      h({ sth_stok_kod: 'ALIS', sth_evraktip: 3 }),                 // alış faturası
      h({ sth_stok_kod: 'IRS', sth_evraktip: 1 }),                  // fatura değil
      { ...h({ sth_stok_kod: 'ELLE' }), source: 'elle' },           // başka kaynak
      h({ sth_stok_kod: 'SIRASIZ', sth_evrakno_sira: '' }),
    ]);
    expect([...m.keys()].sort()).toEqual(['X|7', '|321']);
    expect(m.get('|321')!.map(x => x.sth_stok_kod)).toEqual(['A']);
  });
});

describe('mfKalemleri — KDV hariç net + iskonto ayrı (K-KALEM / K-İSKONTO), lib/stokFiyat ile AYNI hesap', () => {
  const T = { sth_tarih: '2025-09-06' };
  const ad = (sku: string) => (sku === 'CIM50' ? 'ÇİMENTO 50KG' : undefined);
  it('satır iskontosu: brüt / iskonto / net / KDV / total = net + KDV; ad stok kaydından, yoksa SKU; birim UYDURULMAZ', () => {
    const { kalemler, miktarsiz, tutarsiz } = mfKalemleri([
      { ...T, sth_stok_kod: 'CIM50', sth_miktar: 10, sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180 },
      { ...T, sth_stok_kod: 'KUM', sth_miktar: 2, sth_tutar: 500, sth_vergi: 100 },
    ], 1780, ad);
    expect(kalemler[0]).toEqual({ sku: 'CIM50', name: 'ÇİMENTO 50KG', quantity: 10, price: 90, birim: null,
      brutTutar: 1000, iskonto: 100, netTutar: 900, kdv: 180, masraf: 0, netKaynagi: 'satirIskontosu',
      total: 1080, kalemSurumu: MF_KALEM_SURUMU });
    expect(kalemler[1]).toMatchObject({ name: 'KUM', netTutar: 500, iskonto: 0, total: 600 });
    expect([miktarsiz, tutarsiz]).toEqual([0, 0]);
  });
  it("FATURA ALTI iskonto başlıkla hakemlenir (satırda yok): net 2.016, iskonto 224 — kuruşa yuvarlı", () => {
    const { kalemler } = mfKalemleri([{ ...T, sth_stok_kod: 'CIM50', sth_miktar: 100, sth_tutar: 2240, sth_vergi: 403.2 }], 2419.2, ad);
    expect(kalemler[0]).toMatchObject({ brutTutar: 2240, iskonto: 224, netTutar: 2016, total: 2419.2, netKaynagi: 'faturaAltiBasliktan' });
  });
  it('tutarı okunamayan satır: net/brüt/iskonto/masraf/total NULL (0 değil) ve sayılır; KDV bilinmiyorsa total null', () => {
    const { kalemler, miktarsiz, tutarsiz } = mfKalemleri([
      { ...T, sth_stok_kod: 'X', sth_miktar: null, sth_tutar: null, sth_vergi: 10 },
      { ...T, sth_stok_kod: 'Y', sth_miktar: 1, sth_tutar: 100, sth_vergi: null },
    ], undefined, ad);
    // Masraf satırın kendi kolonlarından (kolon yok → 0) — netin çözülmesine bağlı değil; ham tabloyla AYNI kural.
    expect(kalemler[0]).toMatchObject({ quantity: null, brutTutar: null, iskonto: null, netTutar: null, masraf: 0, total: null, netKaynagi: null });
    expect(kalemler[1]).toMatchObject({ kdv: null, total: null });
    expect([miktarsiz, tutarsiz]).toEqual([1, 1]);
  });
  it('sıra: sth_satir_no biliniyorsa ona göre; bilinmiyorsa geliş sırası korunur', () => {
    const { kalemler } = mfKalemleri([
      { ...T, sth_stok_kod: 'B', sth_satir_no: 2, sth_miktar: 1, sth_tutar: 1, sth_vergi: 0.2 },
      { ...T, sth_stok_kod: 'A', sth_satir_no: 1, sth_miktar: 1, sth_tutar: 1, sth_vergi: 0.2 },
    ], undefined, ad);
    expect(kalemler.map(k => k.sku)).toEqual(['A', 'B']);
  });
});

describe('kalemYenilenmeli — mevcut MF siparişinin kalemi yenilensin mi', () => {
  it('kalem yok ya da sürüm-2 olmayan (eski PG aynası) kalem varsa EVET; tümü sürüm 2 ise HAYIR', () => {
    expect(kalemYenilenmeli([])).toBe(true);
    expect(kalemYenilenmeli(undefined)).toBe(true);
    expect(kalemYenilenmeli([{ sku: 'A', total: 21600 }])).toBe(true);
    expect(kalemYenilenmeli([{ kalemSurumu: MF_KALEM_SURUMU }, { sku: 'eski' }])).toBe(true);
    expect(kalemYenilenmeli([{ kalemSurumu: MF_KALEM_SURUMU }])).toBe(false);
  });
  // Delta hakem 2026-09-25: stok hareketi importu yarıda kalınca KISMİ kalem sürüm 2 damgasıyla kalıcı oluyordu.
  it('kaynak verilirse sürüm 2 kalem de kaynaktan FARKLIYSA (sayı ya da Σ net/KDV) yenilenir; aynıysa yenilenmez', () => {
    const T = { sth_tarih: '2025-09-06' };
    const h = (sku: string, tutar: number) => ({ ...T, sth_stok_kod: sku, sth_miktar: 1, sth_tutar: tutar, sth_vergi: tutar * 0.2 });
    const tam = mfKalemleri([h('A', 100), h('B', 50), h('C', 25)], undefined, () => undefined).kalemler;
    const kismi = mfKalemleri([h('A', 100), h('B', 50)], undefined, () => undefined).kalemler;
    expect(kalemYenilenmeli(kismi, tam)).toBe(true);                      // 2 kayıtlı, kaynakta 3
    expect(kalemYenilenmeli(tam, tam)).toBe(false);
    const fiyatDegisti = mfKalemleri([h('A', 100), h('B', 50), h('C', 30)], undefined, () => undefined).kalemler;
    expect(kalemYenilenmeli(tam, fiyatDegisti)).toBe(true);               // aynı sayı, Σ net farklı
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('faturadanSiparis — satış faturasından Cetpa siparişi', () => {
  const kalemler = mfKalemleri([{ sth_tarih: '2025-09-06', sth_stok_kod: 'CIM50', sth_miktar: 100, sth_tutar: 18000, sth_vergi: 3600 }],
    21600, () => 'ÇİMENTO 50KG').kalemler;

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
  const bos = { turetilen: 0, tutarsiz: 0, yonsuz: 0, miktarsizKalem: 0, tutarsizKalem: 0, kalemKaynagiYok: 0, pgYok: false };

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
    const n = siparisTuretmeNotu({ turetilen: 4, tutarsiz: 0, yonsuz: 2, miktarsizKalem: 5, tutarsizKalem: 1, kalemKaynagiYok: 3, pgYok: true });
    expect(n).toMatch(/2 faturanın yönü \(cha_tip\) okunamadı — satış sayılmadı/);
    expect(n).toMatch(/3 faturanın stok hareketi yok — kalemsiz yazıldı/);
    expect(n).toMatch(/5 kalemin miktarı bilinmiyor/);
    expect(n).toMatch(/1 kalemin tutarı bilinmiyor/);
    expect(n).toMatch(/PG yok/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('kalemleriBirimle — `birim` MİKTARIN birimidir (ana birim); `girisBirimi` satırın girildiği birim', () => {
  const kalem = { sth_stok_kod: 'CIM50', sth_miktar: 100, sto_birim1_ad: 'ADET', sto_birim2_ad: 'KOLİ', sto_birim3_ad: '' };

  it('[CANLI ÖLÇÜM 2026-09-19] ikinci birimle girilen satırda sth_miktar ANA birimdedir → birim = ana birim', () => {
    // Alış faturası 234: Kalekim 3131 Elastikor 20 kg — ana birim ADET, 2. birim KILOGRAM, sth_birim_pntr = 2,
    // sth_miktar = 50, sth_tutar = 57.916,66 → ₺1.158,33 / birim. Bu bir KOVA fiyatıdır (kg fiyatı olamaz): Mikro
    // 1.000 kg'lık girişi 50 ADET olarak saklamış. Eski eşleme ekrana "50 · KILOGRAM · ₺1.158,33" yazdırıyordu.
    const [r] = kalemleriBirimle([{ sth_stok_kod: 'KALEKIM.3131', sth_miktar: 50, sth_tutar: 57916.66, sth_birim_pntr: 2,
                                    sto_birim1_ad: 'ADET', sto_birim2_ad: 'KILOGRAM', sto_birim3_ad: '' }]);
    expect(r.birim).toBe('ADET');
    expect(r.girisBirimi).toBe('KILOGRAM');
    expect(r.sth_stok_kod).toBe('KALEKIM.3131');       // diğer alanlar korunur
  });

  it('ana birimle girilen satırda girisBirimi YAZILMAZ (söylenecek fark yok)', () => {
    const [r] = kalemleriBirimle([{ ...kalem, sth_birim_pntr: 1 }]);
    expect(r.birim).toBe('ADET');
    expect('girisBirimi' in r).toBe(false);
  });

  it('giriş biriminin adı boşsa ya da ana birimle AYNIYSA girisBirimi yazılmaz; ana birim adı boşsa birim yazılmaz', () => {
    expect('girisBirimi' in kalemleriBirimle([{ ...kalem, sth_birim_pntr: 3 }])[0]).toBe(false);                       // 3. birim adı ''
    expect('girisBirimi' in kalemleriBirimle([{ ...kalem, sth_birim_pntr: 2, sto_birim2_ad: ' adet ' }])[0]).toBe(false);
    const [r] = kalemleriBirimle([{ ...kalem, sth_birim_pntr: 2, sto_birim1_ad: '' }]);
    expect(r.birim).toBeUndefined();
    expect(r.girisBirimi).toBe('KOLİ');
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

  it('ana birim adı boş/boşluksa alan yazılmaz; dolu ad kırpılır', () => {
    expect(kalemleriBirimle([{ ...kalem, sth_birim_pntr: 1, sto_birim1_ad: '   ' }])[0].birim).toBeUndefined();
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
