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
import { mfKalemleri } from '../mikro/eslemeFatura';
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

  /** Kalem kaynağı (2026-09-25): kiracının inventoryMovements'ı + stok adları; PG yalnız cari ünvanı. */
  const kaynakKur = (faturalar: Record<string, unknown>[], hareketler: Record<string, unknown>[], mevcut: Record<string, unknown>[] = []) => {
    vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) =>
      coll === 'mikroFaturalar' ? faturalar
        : coll === 'inventoryMovements' ? hareketler
          : coll === 'inventory' ? [{ sku: 'CMT-50', name: 'ÇİMENTO 50KG' }]
            : coll === 'orders' ? mevcut : []) as typeof d.C.loadCompanyDocs);
  };
  const HAREKET = (p: Record<string, unknown>) => ({ source: 'mikro_sql', sth_evraktip: 4, sth_evrakno_seri: '', sth_evrakno_sira: 321,
    sth_tarih: '2026-08-01', ...p });

  it('KALEMLER inventoryMovements\'tan (PG aynası DEĞİL): KDV hariç net + iskonto ayrı, total = net + KDV; okunamayan kalem null + sayılır', async () => {
    kaynakKur([BASLIK], [
      HAREKET({ sth_stok_kod: 'CMT-50', sth_miktar: 100, sth_tutar: 20000, sth_iskonto1: 2000, sth_vergi: 3600 }),
      HAREKET({ sth_stok_kod: 'KUM-01', sth_miktar: null, sth_tutar: null, sth_vergi: null }),
      HAREKET({ sth_stok_kod: 'ALIS', sth_evraktip: 3, sth_miktar: 1, sth_tutar: 1, sth_vergi: 0.2 }),   // alış satırı karışmaz
    ]);
    d.pgAyarla(async (sql: string) => (/mikro_cari_hesaplar/.test(sql) ? { rows: [{ cari_kod: '120 01', unvan: 'ŞİRİN İNŞAAT' }] } : { rows: [] }));
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    const doc = d.koleksiyon('orders')[0]?.data ?? {};
    expect(doc.customerName, 'PG varken cari ünvanı kullanılır').toBe('ŞİRİN İNŞAAT');
    const kalemler = doc.lineItems as Record<string, unknown>[];
    expect(kalemler.map(k => k.sku)).toEqual(['CMT-50', 'KUM-01']);
    expect(kalemler[0]).toMatchObject({ name: 'ÇİMENTO 50KG', quantity: 100, brutTutar: 20000, iskonto: 2000, netTutar: 18000, kdv: 3600, total: 21600, kalemSurumu: 2 });
    expect(kalemler[1]).toMatchObject({ name: 'KUM-01', quantity: null, netTutar: null, total: null });
    const not = String((res.govde as { note?: string }).note);
    expect(not).toMatch(/1 kalemin miktarı bilinmiyor/);
    expect(not).toMatch(/1 kalemin tutarı bilinmiyor/);
    expect(not).not.toMatch(/stok hareketi yok/);
  });

  it('stok hareketi olmayan fatura kalemsiz yazılır ve note bunu SÖYLER (sessiz boş kalem yok)', async () => {
    kaynakKur([BASLIK], []);
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect(d.koleksiyon('orders')[0]?.data?.lineItems).toEqual([]);
    expect(String((res.govde as { note?: string }).note)).toMatch(/1 faturanın stok hareketi yok — kalemsiz yazıldı/);
  });

  // 2026-09-25 (kullanıcı: "iptal faturaları da iptal olarak görünsün ama başka bir hesaplamaya dahil olmasın"; şartname v2 D2).
  describe("Mikro'da iptal edilen SATIŞ faturasının MF siparişi", () => {
    const iptalKur = (faturalar: Record<string, unknown>[], iptaller: Record<string, unknown>[], mevcut: Record<string, unknown>[]) => {
      vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) =>
        coll === 'mikroFaturalar' ? faturalar : coll === 'mikroIptalFaturalar' ? iptaller : coll === 'orders' ? mevcut : []) as typeof d.C.loadCompanyDocs);
    };
    const MF = (sira: number, p: Record<string, unknown> = {}) => ({ id: `mikrofat__A__-${sira}`, source: 'mikro-fatura', orderNumber: `MF-${sira}`,
      status: 'Shipped', faturali: true, mikroFaturaNo: String(sira), mikroEvrak: { seri: '', sira: String(sira) }, lineItems: [{ kalemSurumu: 2 }], ...p });

    it("iptal listesinde (satış) + geçerli listede YOK → 'Cancelled', önceki durum saklanır; tekrar koşuda yeniden yazılmaz", async () => {
      iptalKur([BASLIK], [{ cha_evrakno_seri: '', cha_evrakno_sira: 400, cha_tip: 0 }], [MF(321), MF(400)]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      const yazim = d.koleksiyon('orders').filter(y => y.ref.id === 'mikrofat__A__-400');
      expect(yazim).toHaveLength(1);
      expect(yazim[0]).toMatchObject({ op: 'update', data: { status: 'Cancelled', iptalKaynagi: 'mikro', iptalOncekiDurum: 'Shipped' } });
      expect(res.govde).toMatchObject({ iptalEdilen: 1, iptalGeriAlinan: 0 });
      expect(String((res.govde as { note?: string }).note)).toMatch(/1 MF siparişi Mikro'da faturası iptal edildiği için 'İptal' yapıldı/);
      d.sifirla();
      iptalKur([BASLIK], [{ cha_evrakno_seri: '', cha_evrakno_sira: 400, cha_tip: 0 }], [MF(321), MF(400, { status: 'Cancelled', iptalKaynagi: 'mikro', iptalOncekiDurum: 'Shipped' })]);
      await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      expect(d.koleksiyon('orders').filter(y => y.ref.id === 'mikrofat__A__-400')).toEqual([]);
    });

    it('iptal GERİ alındı (geçerli listede, iptal listesinde yok) → önceki durum; işaretler AÇIKÇA null (PATCH-merge)', async () => {
      iptalKur([BASLIK], [], [MF(321, { status: 'Cancelled', iptalKaynagi: 'mikro', iptalOncekiDurum: 'Shipped' })]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      const yazim = d.koleksiyon('orders').filter(y => y.ref.id === 'mikrofat__A__-321');
      expect(yazim[0]).toMatchObject({ op: 'update', data: { status: 'Shipped', iptalKaynagi: null, iptalOncekiDurum: null, mikroIptalGoruldu: null } });
      expect(res.govde).toMatchObject({ iptalGeriAlinan: 1 });
    });

    it('ALIŞ iptali eşlenmez; anahtar hem geçerli hem iptal listesindeyse DOKUNULMAZ ve sayılır; kullanıcının iptal ettiği (işaretsiz) sipariş geri alınmaz', async () => {
      iptalKur([BASLIK], [{ cha_evrakno_seri: '', cha_evrakno_sira: 321, cha_tip: 0 }, { cha_evrakno_seri: '', cha_evrakno_sira: 500, cha_tip: 1 }],
        [MF(321), MF(500), MF(321, { id: 'x', mikroEvrak: { seri: 'Z', sira: '9' }, status: 'Cancelled' })]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      expect(d.koleksiyon('orders').filter(y => ['mikrofat__A__-321', 'mikrofat__A__-500', 'x'].includes(y.ref.id))).toEqual([]);
      expect(res.govde).toMatchObject({ iptalEdilen: 0, iptalBelirsiz: 1 });
    });

    // İnceleme 2026-09-25: geri alma YALNIZ fatura yeniden GEÇERLİ listedeyse — Mikro'da silinmiş (iki listede de yok)
    // iptalli sipariş geri alınmaz.
    it('iptal listesinden de geçerli listeden de DÜŞMÜŞ (silinmiş) iptalli sipariş GERİ ALINMAZ', async () => {
      iptalKur([BASLIK], [], [MF(400, { status: 'Cancelled', iptalKaynagi: 'mikro', iptalOncekiDurum: 'Shipped' })]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      expect(d.koleksiyon('orders').filter(y => y.ref.id === 'mikrofat__A__-400')).toEqual([]);
      expect(res.govde).toMatchObject({ iptalGeriAlinan: 0 });
    });

    it('HİÇ geçerli satış faturası kalmasa da (erken dönüş) iptal işaretlemesi koşar ve note bildirir', async () => {
      iptalKur([], [{ cha_evrakno_seri: '', cha_evrakno_sira: 400, cha_tip: 0 }], [MF(400)]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      expect(d.koleksiyon('orders').filter(y => y.ref.id === 'mikrofat__A__-400')[0]).toMatchObject({ op: 'update', data: { status: 'Cancelled', iptalKaynagi: 'mikro' } });
      expect(String((res.govde as { note?: string }).note)).toMatch(/1 MF siparişi Mikro'da faturası iptal edildiği için 'İptal' yapıldı/);
    });

    it('erken dönüş yolunda da: kalem modunda KOŞMAZ; yön okunamadığı için düşüldüyse (yönsüz fatura) KOŞMAZ', async () => {
      iptalKur([], [{ cha_evrakno_seri: '', cha_evrakno_sira: 400, cha_tip: 0 }], [MF(400)]);
      await d.cagir('POST', '/api/mikro/import/faturadan-siparis', { kalemYenile: 'uygula' });
      expect(d.koleksiyon('orders').filter(y => y.ref.id === 'mikrofat__A__-400')).toEqual([]);
      d.sifirla();
      iptalKur([{ ...BASLIK, cha_evrakno_sira: 400, cha_tip: null }], [{ cha_evrakno_seri: '', cha_evrakno_sira: 400, cha_tip: 0 }], [MF(400)]);
      await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      expect(d.koleksiyon('orders').filter(y => y.ref.id === 'mikrofat__A__-400')).toEqual([]);
    });

    it('ana yolda yönü okunamayan fatura varsa iptal eşlemesi KOŞMAZ ve not bildirir', async () => {
      iptalKur([BASLIK, { ...BASLIK, cha_evrakno_sira: 400, cha_tip: null }], [{ cha_evrakno_seri: '', cha_evrakno_sira: 400, cha_tip: 0 }], [MF(321), MF(400)]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      expect(d.koleksiyon('orders').filter(y => y.ref.id === 'mikrofat__A__-400')).toEqual([]);
      expect(String((res.govde as { note?: string }).note)).toMatch(/1 faturanın yönü okunamadığı için iptal eşlemesi ATLANDI/);
    });

    it("kalem modunda (önizle/uygula) iptal işaretlemesi KOŞMAZ", async () => {
      iptalKur([BASLIK], [{ cha_evrakno_seri: '', cha_evrakno_sira: 400, cha_tip: 0 }], [MF(400)]);
      await d.cagir('POST', '/api/mikro/import/faturadan-siparis', { kalemYenile: 'uygula' });
      expect(d.koleksiyon('orders').filter(y => y.ref.id === 'mikrofat__A__-400')).toEqual([]);
    });
  });

  describe('mevcut MF siparişinin kalemini yenileme (kalemYenile)', () => {
    const MEVCUT = { id: 'mikrofat__A__-321', source: 'mikro-fatura', orderNumber: 'MF-321', status: 'Shipped', notes: 'kullanıcı notu',
      faturali: true, mikroFaturaNo: '321', lineItems: [] as unknown[] };
    const KAYNAK = [HAREKET({ sth_stok_kod: 'CMT-50', sth_miktar: 100, sth_tutar: 18000, sth_vergi: 3600 })];

    // İnceleme 2026-09-25 (CONFIRMED): sipariş stok hareketinden ÖNCE türediyse Tümünü Çek onu bir daha hiç doldurmuyordu.
    it('istek yoksa (Tümünü Çek): BOŞ kalemli mevcut sipariş otomatik DOLDURULUR (yalnız lineItems); eski biçimli kalem YAZILMAZ, not yönlendirir', async () => {
      kaynakKur([BASLIK, { ...BASLIK, cha_evrakno_sira: 325 }],
        [...KAYNAK, HAREKET({ sth_evrakno_sira: 325, sth_stok_kod: 'CMT-50', sth_miktar: 1, sth_tutar: 1, sth_vergi: 0.2 })],
        [MEVCUT, { ...MEVCUT, id: 'mikrofat__A__-325', orderNumber: 'MF-325', lineItems: [{ sku: 'eski', total: 5 }] }]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      const yazim = d.koleksiyon('orders');
      expect(yazim.map(y => [y.op, y.ref.id])).toEqual([['update', 'mikrofat__A__-321']]);
      expect(Object.keys(yazim[0].data ?? {})).toEqual(['lineItems']);
      expect(res.govde).toMatchObject({ bosDoldurulan: 1, kalemYenilenecek: 1, kalemYenilenen: 0, created: 0 });
      const not = String((res.govde as { note?: string }).note);
      expect(not).toMatch(/1 kalemsiz MF siparişinin kalemi dolduruldu/);
      expect(not).toMatch(/1 MF siparişinin kalemi eski biçimde ya da Mikro'daki satırlarla TUTMUYOR \(eksik\/değişmiş\) — Entegrasyon → "MF Sipariş Kalemlerini Yenile"/);
    });

    it('kaynağı olmayan kalemsiz sipariş SESSİZ kalmaz: "önce Stok Hareketleri" notu + sayaç', async () => {
      kaynakKur([BASLIK], [], [MEVCUT]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
      expect(d.koleksiyon('orders')).toEqual([]);
      expect(res.govde).toMatchObject({ kaynaksizBekleyen: 1, bosDoldurulan: 0 });
      expect(String((res.govde as { note?: string }).note)).toMatch(/1 MF siparişinin kalemi boş\/eski ama stok hareketi yok/);
    });

    it("'onizle' HİÇBİR ŞEY yazmaz (yeni sipariş, onarım, doldurma, denetim/syncLog yok) — yalnız kalem sayaçları + örnek + not", async () => {
      kaynakKur([BASLIK, { ...BASLIK, cha_evrakno_sira: 322 }], KAYNAK, [{ ...MEVCUT, faturali: false }]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis', { kalemYenile: 'onizle' });
      expect(d.koleksiyon('orders')).toEqual([]);
      expect(res.govde).toMatchObject({ success: true, onizleme: true, kalemYenilenecek: 1, kalemAzalan: 0, kaynaksizBekleyen: 0 });
      expect('olusturulacak' in (res.govde as object)).toBe(false);
      expect(d.C.writeAuditLog).not.toHaveBeenCalled();
      expect(d.C.writeSyncLog).not.toHaveBeenCalled();
    });

    it("'uygula' YALNIZ kalem yeniler: yeni sipariş OLUŞTURMAZ, eski alan onarımı YAPMAZ; kalem sayısı azalan sayılır", async () => {
      kaynakKur([BASLIK, { ...BASLIK, cha_evrakno_sira: 322 }], KAYNAK,
        [{ ...MEVCUT, faturali: false, lineItems: [{ sku: 'a', total: 1 }, { sku: 'b', total: 2 }] }]);
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis', { kalemYenile: 'uygula' });
      const yazim = d.koleksiyon('orders');
      expect(yazim.map(y => [y.op, y.ref.id])).toEqual([['update', 'mikrofat__A__-321']]);
      expect(Object.keys(yazim[0].data ?? {})).toEqual(['lineItems']);
      expect(res.govde).toMatchObject({ created: 0, onarilan: 0, kalemYenilenen: 1, kalemAzalan: 1 });
      expect(String((res.govde as { note?: string }).note)).toMatch(/1 siparişte kalem sayısı AZALIYOR/);
    });

    it("'uygula' YALNIZ lineItems'ı günceller (durum, not dokunulmaz); kaynak boşsa ya da kalem zaten sürüm 2 ise dokunmaz", async () => {
      kaynakKur(
        [BASLIK, { ...BASLIK, cha_evrakno_sira: 323 }, { ...BASLIK, cha_evrakno_sira: 324 }],
        [...KAYNAK, HAREKET({ sth_evrakno_sira: 324, sth_stok_kod: 'CMT-50', sth_miktar: 1, sth_tutar: 1, sth_vergi: 0.2 })],
        [MEVCUT,
          { ...MEVCUT, id: 'mikrofat__A__-323', orderNumber: 'MF-323' },                                  // kaynak YOK
          // Zaten güncel: kayıtlı kalem kaynaktan kurulanla AYNI (sayı + Σ net/KDV).
          { ...MEVCUT, id: 'mikrofat__A__-324', orderNumber: 'MF-324',
            lineItems: mfKalemleri([HAREKET({ sth_evrakno_sira: 324, sth_stok_kod: 'CMT-50', sth_miktar: 1, sth_tutar: 1, sth_vergi: 0.2 })], BASLIK.cha_meblag, () => 'ÇİMENTO 50KG').kalemler }],
      );
      const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis', { kalemYenile: 'uygula' });
      const yazim = d.koleksiyon('orders');
      expect(yazim.map(y => [y.op, y.ref.id])).toEqual([['update', 'mikrofat__A__-321']]);
      expect(Object.keys(yazim[0].data ?? {})).toEqual(['lineItems']);
      expect((yazim[0].data?.lineItems as Record<string, unknown>[])[0]).toMatchObject({ sku: 'CMT-50', netTutar: 18000, kalemSurumu: 2 });
      expect(res.govde).toMatchObject({ kalemYenilenecek: 1, kalemYenilenen: 1 });
      expect(String((res.govde as { note?: string }).note ?? '')).not.toMatch(/Kalemleri yenile/);
    });
  });

  it("'kalemsiz' alanı yerine `note` döner — PG yoksa uyarı artık ekranda görünen alanda", async () => {
    faturalariKur([BASLIK]);
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect('kalemsiz' in (res.govde as object), 'ölü yüzey kaldırıldı').toBe(false);
    expect(String((res.govde as { note?: string }).note)).toMatch(/PG yok — cari adları eklenemedi/);
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

// ─────────────────────────────────────────────────────────────────────────────
// K-MF-SİL (kullanıcı 2026-09-25: "sildiğim tekrar gelsin ama yanına not düşsün silinmişti diye")
describe('POST /api/mikro/siparis/sil + faturadan-siparis geri geliş notu', () => {
  const BASLIK = { cha_evrakno_seri: '', cha_evrakno_sira: 321, cha_tarihi: '2026-08-01T00:00:00', cha_tip: 0, cha_kod: '120 01', cha_meblag: 21600 };
  const MF = { source: 'mikro-fatura', companyId: 'A', orderNumber: 'MF-321', mikroEvrak: { seri: '', sira: '321' }, notes: 'teslimatta sorun vardı', status: 'Delivered' };

  it("sıra: MEZAR yazılır (silen AD, gün, iç not) → sipariş silinir → denetim kaydı; e-posta mezara/nota GİRMEZ", async () => {
    d.snapAyarla('orders', { 'mikrofat__A__-321': MF });
    d.snapAyarla('users', { u1: { displayName: 'Ayşe Yılmaz', email: 'a@cetpa.com.tr' } });
    const res = await d.cagir('POST', '/api/mikro/siparis/sil', { id: 'mikrofat__A__-321' });
    expect(res.govde).toEqual({ success: true });
    const yazim = d.yazilan.filter(y => ['orders', 'siparisMezarlari'].includes(y.ref.coll));
    expect(yazim.map(y => [y.op, y.ref.coll, y.ref.id])).toEqual([
      ['set', 'siparisMezarlari', 'mikrofat__A__-321'],
      ['delete', 'orders', 'mikrofat__A__-321'],
    ]);
    expect(yazim[0].data).toMatchObject({ orderId: 'mikrofat__A__-321', companyId: 'A', orderNumber: 'MF-321', silenUid: 'u1', silenAd: 'Ayşe Yılmaz',
      silinenNot: 'teslimatta sorun vardı', geriGeldi: false, silinmeGunu: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(JSON.stringify(yazim[0].data)).not.toContain('a@cetpa.com.tr');
    expect(d.C.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ uid: 'u1' }), 'Mikro siparişi silindi', expect.stringContaining('MF-321'));
  });

  it('dış rol (B2B/Dealer) 403; başka kiracının siparişi 404 (varlığı sızmaz); MF olmayan / yanlış kimlik 400 — hiçbir yazım yok', async () => {
    d.snapAyarla('orders', { 'mikrofat__A__-321': MF, 'mikrofat__A__-9': { ...MF, source: 'shopify' }, 'mikrofat__A__-8': { ...MF, companyId: 'B' } });
    vi.mocked(d.C.getUserRole).mockResolvedValueOnce('B2B');
    expect((await d.cagir('POST', '/api/mikro/siparis/sil', { id: 'mikrofat__A__-321' })).kod).toBe(403);
    expect((await d.cagir('POST', '/api/mikro/siparis/sil', { id: 'mikrofat__A__-8' })).kod).toBe(404);
    expect((await d.cagir('POST', '/api/mikro/siparis/sil', { id: 'mikrofat__A__-9' })).kod).toBe(400);
    expect((await d.cagir('POST', '/api/mikro/siparis/sil', { id: 'mikrofat__B__-321' })).kod).toBe(400);
    expect((await d.cagir('POST', '/api/mikro/siparis/sil', { id: 'native-1' })).kod).toBe(400);
    expect(d.yazilan.filter(y => ['orders', 'siparisMezarlari'].includes(y.ref.coll))).toEqual([]);
  });

  it('import mezarlı faturayı yeniden yaratır: sistemNotu (gün + ad), eski iç not geri, mezar geriGeldi; ikinci koşuda tekrar not YOK', async () => {
    vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) =>
      coll === 'mikroFaturalar' ? [BASLIK]
        : coll === 'siparisMezarlari' ? [{ id: 'mikrofat__A__-321', geriGeldi: false, silinmeGunu: '2026-09-25', silenAd: 'Ayşe Yılmaz', silinenNot: 'teslimatta sorun vardı' }]
          : []) as typeof d.C.loadCompanyDocs);
    const res = await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    const siparis = d.koleksiyon('orders').find(y => y.ref.id === 'mikrofat__A__-321');
    expect(siparis?.data).toMatchObject({ sistemNotu: "Cetpa'da 2026-09-25 Ayşe Yılmaz tarafından silinmişti — Mikro'dan yeniden geldi.", notes: 'teslimatta sorun vardı' });
    expect(d.koleksiyon('siparisMezarlari')).toEqual([expect.objectContaining({ op: 'update', data: expect.objectContaining({ geriGeldi: true }) })]);
    expect(String((res.govde as { note?: string }).note)).toMatch(/1 silinmiş MF siparişi Mikro'dan notla yeniden geldi/);
    // Mezar zaten geriGeldi → yeniden silinmeden tekrar gelmişse not DÜŞÜLMEZ.
    d.sifirla();
    vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) =>
      coll === 'mikroFaturalar' ? [BASLIK] : coll === 'siparisMezarlari' ? [{ id: 'mikrofat__A__-321', geriGeldi: true, silenAd: 'X' }] : []) as typeof d.C.loadCompanyDocs);
    await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect('sistemNotu' in (d.koleksiyon('orders')[0]?.data ?? {})).toBe(false);
    expect(d.koleksiyon('siparisMezarlari')).toEqual([]);
  });

  // İnceleme 2026-09-25 (CONFIRMED): kapı 'write' Satış/Lojistik'e /api/db'nin vermediği silme yetkisini veriyordu.
  it("kapı 'orders:delete' (Admin/Manager — /api/db sipariş silme kuralıyla aynı), 'write' DEĞİL", () => {
    const zincir = d.app.zincirler['POST /api/mikro/siparis/sil'] as Array<{ erisimKapisi?: string }>;
    expect(zincir.some(m => m?.erisimKapisi === 'orders:delete')).toBe(true);
    expect(zincir.some(m => m?.erisimKapisi === 'orders:write')).toBe(false);
  });

  it('silinme günü İSTANBUL günüdür: TR 26.09 01:30 (UTC 25.09 22:30) → 2026-09-26', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-25T22:30:00Z'));
      d.snapAyarla('orders', { 'mikrofat__A__-321': MF });
      await d.cagir('POST', '/api/mikro/siparis/sil', { id: 'mikrofat__A__-321' });
      expect(d.yazilan.find(y => y.ref.coll === 'siparisMezarlari')?.data?.silinmeGunu).toBe('2026-09-26');
    } finally { vi.useRealTimers(); }
  });

  it('sipariş silinemezse mezar GERİ ALINIR (hayalet mezar kalmaz), yanıt 500 ve iç hata metni sızmaz', async () => {
    d.snapAyarla('orders', { 'mikrofat__A__-321': MF });
    const adb = d.C.getAdminDb() as unknown as { collection: (c: string) => { doc: (id?: string) => { delete: () => Promise<void> } } };
    const asil = adb.collection.bind(adb);
    vi.spyOn(adb, 'collection').mockImplementation((c: string) => {
      const kol = asil(c);
      if (c !== 'orders') return kol;
      return { ...kol, doc: (id?: string) => Object.assign(kol.doc(id), { delete: async () => { throw new Error('PG bağlantısı koptu'); } }) };
    });
    const res = await d.cagir('POST', '/api/mikro/siparis/sil', { id: 'mikrofat__A__-321' });
    expect(res.kod).toBe(500);
    expect(JSON.stringify(res.govde)).not.toContain('PG bağlantısı');
    expect(d.yazilan.filter(y => y.ref.coll === 'siparisMezarlari').map(y => y.op)).toEqual(['set', 'delete']);
    expect(d.C.writeAuditLog).not.toHaveBeenCalled();
  });

  it('mezar yalnız YENİ yaratılan siparişte tüketilir: sipariş hâlâ duruyorsa mezar açık kalır, siparişe not düşmez', async () => {
    vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) =>
      coll === 'mikroFaturalar' ? [BASLIK]
        : coll === 'orders' ? [{ id: 'mikrofat__A__-321', ...MF }]
          : coll === 'siparisMezarlari' ? [{ id: 'mikrofat__A__-321', geriGeldi: false, silinmeGunu: '2026-09-25', silenAd: 'Ayşe Yılmaz' }]
            : []) as typeof d.C.loadCompanyDocs);
    await d.cagir('POST', '/api/mikro/import/faturadan-siparis');
    expect(d.koleksiyon('siparisMezarlari')).toEqual([]);
    expect(d.koleksiyon('orders').some(y => 'sistemNotu' in (y.data ?? {}))).toBe(false);
  });

  it("kalem modunda ('onizle' / 'uygula') mezar OKUNMAZ ve İŞARETLENMEZ", async () => {
    for (const kalemYenile of ['onizle', 'uygula'] as const) {
      d.sifirla();
      vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) =>
        coll === 'mikroFaturalar' ? [BASLIK]
          : coll === 'siparisMezarlari' ? [{ id: 'mikrofat__A__-321', geriGeldi: false, silenAd: 'X' }]
            : []) as typeof d.C.loadCompanyDocs);
      await d.cagir('POST', '/api/mikro/import/faturadan-siparis', { kalemYenile });
      expect(vi.mocked(d.C.loadCompanyDocs).mock.calls.some(c => c[0] === 'siparisMezarlari'), kalemYenile).toBe(false);
      expect(d.koleksiyon('siparisMezarlari'), kalemYenile).toEqual([]);
      expect(d.koleksiyon('orders').some(y => 'sistemNotu' in (y.data ?? {})), kalemYenile).toBe(false);
    }
  });

  it('ad bulunamazsa "bir kullanıcı" (e-posta yazılmaz)', async () => {
    d.snapAyarla('orders', { 'mikrofat__A__-321': MF });
    await d.cagir('POST', '/api/mikro/siparis/sil', { id: 'mikrofat__A__-321' });
    const mezar = d.yazilan.find(y => y.ref.coll === 'siparisMezarlari');
    expect(mezar?.data?.silenAd).toBeNull();
  });
});
