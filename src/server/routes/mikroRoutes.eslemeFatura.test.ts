/**
 * mikroRoutes.eslemeFatura.test.ts — fatura eşleme rotalarının BAĞLAMA testleri
 * (Faz 3 3/n, grup "eslemeFatura", 2026-09-19).
 *
 * Saf modülün kendi testleri `src/server/mikro/eslemeFatura.test.ts`'te (42 test).
 * BURADA kilitlenen şey farklı: rotanın gerçekten o modülü çağırdığı ve sonucun
 * batch'e / HTTP yanıtına DOĞRU biçimde indiği. Üç rota:
 *
 *   • POST /api/mikro/import/faturalar        — yön + null kolon süzme + note
 *   • POST /api/mikro/import/faturadan-siparis — totalPrice/lineItems + sayaçlar + note
 *   • POST /api/mikro/fatura/kalemler          — birim işaretçisi çözümü (parite)
 *
 * Mutasyon-ayırt-edici ana iddia: BİLİNMEYEN alan yazılan dokümanda HİÇ YOK —
 * `?? 0` geri gelirse `'totalPrice' in doc` true olur ve test kırmızıya döner.
 *
 * vi.mock blokları burada KALMAK ZORUNDA (vitest hoisting) — tarif tek kaynakta:
 * `mikroRoutes.testDuzenegi.ts` → `mikroMockTarifi`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroSql, mikroKolonlar, v17MetoduKullanilabilir } from '../mikroClient.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
// `mikroMockTarifi` + ÜÇ EK. Neden gerekli: `mikroSql` / `mikroKolonlar` /
// `v17MetoduKullanilabilir` kendi modülünün İÇİNDEKİ `mikroPost` bildirimine bağlıdır —
// namespace'te `mikroPost`u değiştirmek onları ETKİLEMEZ, gerçek fetch'e (localhost:8094)
// giderler. `v17MetoduKullanilabilir` bunu try/catch ile yutup `false` döndüğü için rota
// 501 veriyor ve testler SESSİZCE boş yazım görüyordu. Bu üçü ayrıca mock'lanmalı.
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(),
    mikroVergiOranlari: vi.fn(async () => ({})),
    vergiOraniCoz: vi.fn(() => null),
    v17MetoduKullanilabilir: vi.fn(async () => true),
    mikroSql: vi.fn(async () => ({ rows: [] as Record<string, unknown>[], hata: null })),
    mikroKolonlar: vi.fn(async () => [] as string[]),
  };
});

let d: Duzenek;
// `vi.restoreAllMocks()` BİLEREK YOK: vi.mock fabrikasındaki `mikroPost` sahtesini de
// sıfırlar ve sonraki test GERÇEK fetch'i (localhost:8094) dener — testler ağa çıkar.
beforeEach(() => {
  d = duzenekKur();
  vi.mocked(v17MetoduKullanilabilir).mockResolvedValue(true);
});

/** SqlVeriOkuV2 zarfı — `mikroSatirlar` bu şekli bekler (canlı: dizi sarmalı). */
const sqlZarf = (rows: Record<string, unknown>[]) =>
  ({ ok: true, status: 200, data: { result: [{ IsError: false, Data: [{ SQLResult1: rows }] }] } });

/** `SELECT ... FROM <tablo>` metnine göre satır döndüren SqlVeriOkuV2 sahtesi. */
function sqlYaniti(coz: (sql: string) => Record<string, unknown>[]) {
  vi.mocked(mikroPost).mockImplementation((async (metot: string, govde: unknown) => {
    if (metot !== 'SqlVeriOkuV2') return { ok: false, status: 501, data: null };
    return sqlZarf(coz(String((govde as { SQLSorgu?: unknown })?.SQLSorgu ?? '')));
  }) as unknown as typeof mikroPost);
  vi.mocked(mikroSql).mockImplementation((async (sorgu: string) =>
    ({ rows: coz(sorgu), hata: null })) as unknown as typeof mikroSql);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/mikro/import/faturalar', () => {
  /** Üç fatura: satış · alış · cha_tip okunamayan (+ null kolonlu). */
  const FATURALAR = [
    { cha_Guid: 'g1', cha_evrakno_seri: '', cha_evrakno_sira: 321, cha_tarihi: '2026-08-01',
      cha_tip: 0, cha_kod: '120 01', cha_meblag: 21600, cha_aciklama: 'Şirin İnşaat — ÇİMENTO 50KG' },
    { cha_Guid: 'g2', cha_evrakno_seri: '', cha_evrakno_sira: 322, cha_tarihi: '2026-08-02',
      cha_tip: 1, cha_kod: '320 07', cha_meblag: 13062, cha_aciklama: 'Alış' },
    { cha_Guid: 'g3', cha_evrakno_seri: '', cha_evrakno_sira: 323, cha_tarihi: '2026-08-03',
      cha_tip: null, cha_kod: '120 02', cha_meblag: null, cha_aciklama: 'Yönü okunamadı' },
  ];

  beforeEach(() => {
    sqlYaniti(sql => (/CARI_HESAP_HAREKETLERI/.test(sql) ? FATURALAR : [{ deneme: 1 }]));
  });

  it("cha_tip okunamayan fatura SATIŞ SAYILMAZ: `yon` alanı HİÇ yazılmaz, sayaçlar 1/1 ve yanıtta not var", async () => {
    const res = await d.cagir('POST', '/api/mikro/import/faturalar');
    const yazilanlar = d.koleksiyon('mikroFaturalar');
    expect(yazilanlar.map(y => y.ref.id)).toEqual(['g1', 'g2', 'g3']);
    expect(yazilanlar[0].data?.yon).toBe('satis');
    expect(yazilanlar[1].data?.yon).toBe('alis');
    expect('yon' in (yazilanlar[2].data ?? {}), 'yönü okunamayan faturaya yon YAZILMAMALI (merge:true önceki yönü korur)').toBe(false);
    expect(res.govde).toMatchObject({ success: true, total: 3, satis: 1, alis: 1 });
    expect(String((res.govde as { note?: string }).note)).toMatch(/1 faturanın yönü \(cha_tip\) okunamadı/);
  });

  it('null kolon merge:true ile mevcut tutarı EZMEZ — alan yazılan dokümanda YOK, note sayar', async () => {
    const res = await d.cagir('POST', '/api/mikro/import/faturalar');
    const g3 = d.koleksiyon('mikroFaturalar').find(y => y.ref.id === 'g3')?.data ?? {};
    expect('cha_meblag' in g3, "okunamayan cha_meblag yazılmamalı (0 da yazılmamalı)").toBe(false);
    expect(g3).toMatchObject({ companyId: 'A', source: 'mikro_import', syncedAt: 'TS' });
    expect(String((res.govde as { note?: string }).note)).toMatch(/1 satırın cha_meblag alanı bilinmiyor/);
  });

  it('PARİTE: bilinen satırın dokümanı eskisiyle BİREBİR aynı (ham kolonlar + yon + kiracı damgası)', async () => {
    await d.cagir('POST', '/api/mikro/import/faturalar');
    expect(d.koleksiyon('mikroFaturalar').find(y => y.ref.id === 'g1')?.data).toEqual({
      ...FATURALAR[0], yon: 'satis', companyId: 'A', source: 'mikro_import', syncedAt: 'TS',
    });
  });

  it('OKUMA ARIZASI: cha_meblag ≥5 satırın TAMAMINDA okunamıyorsa not UYARI ile başlar + console.warn', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sqlYaniti(sql => (/CARI_HESAP_HAREKETLERI/.test(sql)
      ? Array.from({ length: 5 }, (_x, i) => ({
          cha_Guid: `k${i}`, cha_evrakno_sira: 400 + i, cha_tarihi: '2026-08-01',
          cha_tip: 0, cha_kod: '120 01', cha_meblag: null,
        }))
      : [{ deneme: 1 }]));
    const res = await d.cagir('POST', '/api/mikro/import/faturalar');
    expect(String((res.govde as { note?: string }).note)).toMatch(/^UYARI: cha_meblag alanı hiçbir satırda okunamadı/);
    expect(uyari).toHaveBeenCalledWith('[import/faturalar]', expect.stringContaining('kolon adı/şema kontrol edin'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/mikro/import/faturadan-siparis', () => {
  const BASLIK = {
    cha_evrakno_seri: '', cha_evrakno_sira: 321, cha_tarihi: '2026-08-01T00:00:00',
    cha_tip: 0, cha_kod: '120 01', cha_meblag: 21600,
  };
  /** Kalemsiz/PG'siz koşum: `getPgPool()` null → lokal (Firestore) hâli. */
  const faturalariKur = (kayitlar: Record<string, unknown>[]) => {
    vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) =>
      (coll === 'mikroFaturalar' ? kayitlar : [])) as typeof d.C.loadCompanyDocs);
  };

  it('PARİTE: bilinen faturada sipariş dokümanı ve id biçimi BİREBİR aynı (idempotentlik anahtarı)', async () => {
    faturalariKur([BASLIK]);
    await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    const s = d.koleksiyon('orders')[0];
    expect(s.ref.id).toBe('mikrofat__A__-321');
    expect(s.data).toEqual({
      orderNumber: 'MF-321',
      customerName: '120 01',
      mikroCariKod: '120 01',
      customerType: 'B2B',
      status: 'Delivered',
      totalPrice: 21600,
      lineItems: [],
      orderDate: '2026-08-01',
      createdAt: '2026-08-01T12:00:00.000Z',
      source: 'mikro-fatura',
      mikroEvrak: { seri: '', sira: '321' },
      faturali: true,
      mikroFaturaNo: '321',
      companyId: 'A',
    });
  });

  it('cha_meblag okunamazsa totalPrice alanı HİÇ YAZILMAZ (₺0 ciro yok) ve note sayar', async () => {
    faturalariKur([{ ...BASLIK, cha_meblag: null }]);
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    const doc = d.koleksiyon('orders')[0]?.data ?? {};
    expect('totalPrice' in doc, "tutarı okunamayan fatura ₺0 ciro OLMAMALI").toBe(false);
    expect(res.govde).toMatchObject({ success: true, created: 1 });
    expect(String((res.govde as { note?: string }).note)).toMatch(/1 siparişin tutarı bilinmiyor/);
  });

  it('cha_tip okunamayan fatura SATIŞ SAYILMAZ: sipariş türetilmez, note bildirir', async () => {
    faturalariKur([BASLIK, { ...BASLIK, cha_evrakno_sira: 322, cha_tip: null }]);
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect(d.koleksiyon('orders').map(y => y.ref.id)).toEqual(['mikrofat__A__-321']);
    expect(res.govde).toMatchObject({ created: 1, total: 1 });
    expect(String((res.govde as { note?: string }).note)).toMatch(/1 faturanın yönü \(cha_tip\) okunamadı — satış sayılmadı/);
  });

  it("KDV'si okunamayan kalemin total'i null iner (eski SQL COALESCE'i KDV'siz tutarı toplam sanıyordu); miktar/tutar sayaçları note'a girer", async () => {
    faturalariKur([BASLIK]);
    d.pgAyarla(async (sql: string) => {
      if (/mikro_cari_hesaplar/.test(sql)) return { rows: [{ cari_kod: '120 01', unvan: 'ŞİRİN İNŞAAT' }] };
      if (/mikro_stok_hareketleri/.test(sql)) {
        return { rows: [
          { seri: '', sira: '321', sku: 'CMT-50', ad: 'ÇİMENTO 50KG', miktar: 100, tutar: 18000, vergi: 3600 },
          { seri: '', sira: '321', sku: 'KUM-01', ad: 'Kum', miktar: null, tutar: 500, vergi: null },
        ] };
      }
      return { rows: [] };
    });
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    const doc = d.koleksiyon('orders')[0]?.data ?? {};
    expect(doc.customerName, 'PG varken cari ünvanı kullanılır').toBe('ŞİRİN İNŞAAT');
    expect(doc.lineItems).toEqual([
      { sku: 'CMT-50', name: 'ÇİMENTO 50KG', quantity: 100, total: 21600 },
      { sku: 'KUM-01', name: 'Kum', quantity: null, total: null },
    ]);
    const not = String((res.govde as { note?: string }).note);
    expect(not).toMatch(/1 kalemin miktarı bilinmiyor/);
    expect(not).toMatch(/1 kalemin tutarı bilinmiyor/);
    expect(not).not.toMatch(/PG yok/);
  });

  it("'kalemsiz' alanı yerine `note` döner — PG yoksa uyarı artık ekranda görünen alanda", async () => {
    faturalariKur([BASLIK]);
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect('kalemsiz' in (res.govde as object), 'ölü yüzey kaldırıldı').toBe(false);
    expect(String((res.govde as { note?: string }).note)).toMatch(/PG yok — kalemler ve cari adları eklenemedi/);
  });

  it('evrak sıra no yoksa sipariş UYDURULMAZ (skipped)', async () => {
    faturalariKur([{ ...BASLIK, cha_evrakno_sira: null }]);
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect(d.koleksiyon('orders')).toEqual([]);
    expect(res.govde).toMatchObject({ created: 0, skipped: 1 });
  });

  // 2026-09-19 hakem bulgusu: HİÇ satış faturası kalmayınca erken dönüş `yonsuz`
  // sayacını yutuyordu. Yönü okunamayan 10 fatura, yanıtta tek bir iz bırakmadan
  // "Satış faturası bulunamadı — önce Faturaları Çek çalıştırın" mesajına dönüşüyordu:
  // kullanıcı zaten çalıştırdığı adıma geri yollanıyor, gerçek neden (cha_tip
  // okunamıyor) hiçbir yerde görünmüyordu. Ayrıca MikroSyncPanel.handleExtraPull
  // YALNIZ `note`u basar — `message` ekranda HİÇ görünmez.
  it('hiç satış faturası kalmasa bile yönsüz sayacı note\'a girer (erken dönüş sayacı yutmaz)', async () => {
    faturalariKur([
      { ...BASLIK, cha_tip: null },
      { ...BASLIK, cha_evrakno_sira: 322, cha_tip: null },
    ]);
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect(d.koleksiyon('orders')).toEqual([]);
    expect(res.govde).toMatchObject({ success: true, created: 0, total: 0 });
    expect(String((res.govde as { note?: string }).note))
      .toMatch(/2 faturanın yönü \(cha_tip\) okunamadı/);
    expect(String((res.govde as { message?: string }).message), 'mesaj "fatura yok" demesin')
      .toMatch(/yönü okunamadı/);
  });

  it('TÜM faturaların yönü okunamıyorsa (≥5) okuma arızasıdır: note UYARI ile başlar + console.warn', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    faturalariKur(Array.from({ length: 5 }, (_x, i) => ({ ...BASLIK, cha_evrakno_sira: 400 + i, cha_tip: null })));
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect(String((res.govde as { note?: string }).note))
      .toMatch(/^UYARI: cha_tip alanı hiçbir satırda okunamadı/);
    expect(uyari).toHaveBeenCalledWith('[faturadan-siparis]', expect.stringContaining('kolon adı/şema kontrol edin'));
    uyari.mockRestore();
  });

  it('gerçekten hiç fatura yoksa yönlendirme mesajı korunur ve yön uyarısı UYDURULMAZ', async () => {
    faturalariKur([]);
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect(res.govde).toMatchObject({ success: true, created: 0, total: 0 });
    expect(String((res.govde as { message?: string }).message)).toMatch(/Faturaları Çek/);
    expect(String((res.govde as { note?: string }).note ?? '')).not.toMatch(/yönü/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/mikro/fatura/kalemler', () => {
  const STH = ['sth_stok_kod', 'sth_miktar', 'sth_birim_pntr', 'sth_tutar', 'sth_vergi',
               'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_satir_no', 'sth_iskonto1'];
  const STO = ['sto_kod', 'sto_isim', 'sto_birim1_ad', 'sto_birim2_ad', 'sto_birim3_ad'];

  it('birim işaretçisi 1-3 arasında çözülür; aralık dışı/okunamaz işaretçide birim UYDURULMAZ (parite)', async () => {
    vi.mocked(mikroKolonlar).mockImplementation(async (tablo: string) =>
      (tablo === 'STOK_HAREKETLERI' ? STH : STO));
    sqlYaniti(() => {
      return [
        { sth_stok_kod: 'CMT-50', sth_birim_pntr: 1, sto_birim1_ad: ' TON ', sto_birim2_ad: 'KG', urunAdi: 'ÇİMENTO 50KG' },
        { sth_stok_kod: 'KUM-01', sth_birim_pntr: 9, sto_birim1_ad: 'TON' },
        { sth_stok_kod: 'DMR-12', sth_birim_pntr: null, sto_birim1_ad: 'TON' },
      ];
    });
    const res = await d.cagir('POST', '/api/mikro/fatura/kalemler', { sira: '321', yon: 'giden' });
    const govde = res.govde as { success: boolean; total: number; kalemler: Record<string, unknown>[] };
    expect(res.kod).toBe(200);
    expect(govde).toMatchObject({ success: true, total: 3 });
    expect(govde.kalemler[0].birim, 'işaretçi 1 → sto_birim1_ad, kırpılır').toBe('TON');
    expect(govde.kalemler[0].urunAdi, 'diğer kolonlar aynen iner').toBe('ÇİMENTO 50KG');
    expect(govde.kalemler[1].birim, 'aralık dışı işaretçi → birim uydurulmaz').toBeUndefined();
    expect(govde.kalemler[2].birim, 'okunamayan işaretçi → birim uydurulmaz').toBeUndefined();
  });
});
