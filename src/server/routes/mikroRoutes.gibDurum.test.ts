/**
 * POST /api/mikro/import/gib-durum — satış e-belgelerinin GİB / alıcı durumu (fatura 389: 2002 «Fatura red edildi», 2026-10-02).
 * Tarama `mikroFaturalar`'a yalnız gibDurum + gibRed yazar; red değiştiyse MF siparişini aynı koşuda 'İptal' yapar. Mikro'ya YAZMAZ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroSql, v17MetoduKullanilabilir } from '../mikroClient.js';
import { arkaPlanIsiKosan } from '../mikro/arkaPlanIsi.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
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
vi.mock('../mikro/arkaPlanIsi.js', async (orig) => ({ ...(await orig<typeof import('../mikro/arkaPlanIsi.js')>()), arkaPlanIsiKosan: vi.fn(() => null) }));

const E = (n: number) => `BBBBBBBB-1111-2222-3333-${String(n).padStart(12, '0')}`;
// Mikro uniqueidentifier'ı süslü parantezle döner — doküman kimliği ve cha_uuid gerçek biçimde.
const fatura = (sira: number, o: Record<string, unknown> = {}) => ({
  id: `{G${sira}}`, companyId: 'A', cha_tip: '0', cha_ebelge_Islemturu: '1', cha_uuid: `{${E(sira)}}`, cha_evrakno_seri: '', cha_evrakno_sira: sira,
  cha_tarihi: '2026-09-29 00:00:00', cha_meblag: 8500, ...o,
});
const MF = (sira: number, p: Record<string, unknown> = {}) => ({ id: `mikrofat__A__-${sira}`, source: 'mikro-fatura', orderNumber: `MF-${sira}`,
  status: 'Delivered', mikroEvrak: { seri: '', sira: String(sira) }, ...p });
const yanit = (kod: string, aciklama: string) => ({ ok: true, status: 200, data: { result: [{ StatusCode: 200, IsError: false, ErrorMessage: null,
  Data: { BelgeDurumKodu: kod, BelgeDurumAciklamasi: aciklama, ZarfDurumKodu: '1001', ZarfDurumAciklamasi: 'Zarf gönderildi', GIBDurumKodu: '1300', GIBDurumAciklamasi: 'BAŞARIYLA TAMAMLANDI' } }] } });

let d: Duzenek;
/** Tarama bayrağı yazınca sipariş eşlemesi koleksiyonu YENİDEN okur — sahte, yazılan bayrağı ikinci okumada yansıtır. */
const kaynakKur = (faturalar: Record<string, unknown>[], siparisler: Record<string, unknown>[], iptaller: Record<string, unknown>[] = []) => {
  vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) => {
    if (coll === 'mikroFaturalar') {
      return faturalar.map(f => {
        const yazim = [...d.koleksiyon('mikroFaturalar')].reverse().find(y => y.ref.id === f.id && y.op === 'update');
        return yazim ? { ...f, ...yazim.data } : f;
      });
    }
    return coll === 'orders' ? siparisler : coll === 'mikroIptalFaturalar' ? iptaller : [];
  }) as typeof d.C.loadCompanyDocs);
};
beforeEach(() => {
  d = duzenekKur({ kullanici: { uid: 'u1', email: 'a@cetpa.com.tr', companyId: 'A' } });
  vi.mocked(v17MetoduKullanilabilir).mockResolvedValue(true);
  vi.mocked(mikroPost).mockReset();
  vi.mocked(mikroSql).mockClear();
  vi.mocked(arkaPlanIsiKosan).mockReturnValue(null);
});
const YOL = '/api/mikro/import/gib-durum';

describe('POST /api/mikro/import/gib-durum', () => {
  it('KAPI = fatura importunun kapısı: MFA + mikroFaturalar YAZMA rolü + hız sınırı (yalnız requireAuth değil)', () => {
    const zincir = d.app.zincirler[`POST ${YOL}`] as Array<{ erisimKapisi?: string }>;
    expect(zincir.some(m => m?.erisimKapisi === 'mikroFaturalar:write')).toBe(true);
    expect(zincir).toHaveLength(5);                                            // auth, mfa, rol, limiter, işleyici
  });

  it('reddedilen fatura (2002): dokümana YALNIZ gibDurum + gibRed yazılır; MF siparişi aynı koşuda İptal; Mikro\'ya yazım yok', async () => {
    kaynakKur([fatura(389), fatura(396)], [MF(389), MF(396)]);
    vi.mocked(mikroPost).mockImplementation((async (_m: string, govde: { EBelge: { UUID: string } }) =>
      (govde.EBelge.UUID === E(389) ? yanit('2002', 'Fatura red edildi') : yanit('1002', 'Fatura zarflandı'))) as unknown as typeof mikroPost);
    const res = await d.cagir('POST', YOL);
    expect(res.kod).toBe(200);
    expect(res.govde).toMatchObject({ success: true, total: 2, red: 1, yeniRed: 1, kalan: 0, hata: 0 });
    // ETTN süslü parantez SOYULARAK gönderildi; yalnız durum sorgusu çağrıldı.
    expect(vi.mocked(mikroPost).mock.calls.map(c => [c[0], (c[1] as { EBelge: Record<string, unknown> }).EBelge])).toEqual(expect.arrayContaining([
      ['EBelgeDurumSorgulamaV2', { EFaturaTipi: 0, EBelgeTipi: 0, UUID: E(389) }]]));
    expect(new Set(vi.mocked(mikroPost).mock.calls.map(c => c[0]))).toEqual(new Set(['EBelgeDurumSorgulamaV2']));
    const y389 = d.koleksiyon('mikroFaturalar').filter(y => y.ref.id === '{G389}');
    expect(y389).toHaveLength(1);
    expect(y389[0].op).toBe('update');                                         // set DEĞİL: silinmiş doküman diriltilmez
    expect(Object.keys(y389[0].data ?? {}).sort()).toEqual(['gibDurum', 'gibRed']);
    expect(y389[0].data).toMatchObject({ gibRed: true, gibDurum: { belgeKodu: '2002', belgeAciklama: 'Fatura red edildi', gibKodu: '1300' } });
    expect(d.koleksiyon('mikroFaturalar').find(y => y.ref.id === '{G396}')?.data).toMatchObject({ gibRed: false });
    // MF-389 iptal, MF-396 dokunulmadı.
    const siparisYazimi = d.koleksiyon('orders');
    expect(siparisYazimi.map(y => y.ref.id)).toEqual(['mikrofat__A__-389']);
    expect(siparisYazimi[0]).toMatchObject({ op: 'update', data: { status: 'Cancelled', iptalKaynagi: 'mikro', iptalOncekiDurum: 'Delivered' } });
    const not = String((res.govde as { note: string }).note);
    expect(not).toContain('1 reddedilmiş (1 yeni: 389)');
    expect(not).toContain("1 MF siparişi faturasını alıcı reddettiği (GİB 2002) için 'İptal' yapıldı");
    expect(not).toContain('kodlar: 1002×1, 2002×1');
    expect(d.syncLog).toHaveBeenCalledWith('EBelgeDurumSorgulamaV2', 'mikroFaturalar', expect.stringContaining('GİB durum taraması'), true, null, null, expect.any(Number), expect.anything());
  });

  it('red yokken sipariş koleksiyonu hiç OKUNMAZ / yazılmaz (gereksiz eşleme yok)', async () => {
    kaynakKur([fatura(396)], [MF(396)]);
    vi.mocked(mikroPost).mockResolvedValue(yanit('2001', 'Fatura kabul edildi'));
    await d.cagir('POST', YOL);
    expect(d.koleksiyon('orders')).toEqual([]);
    expect(vi.mocked(d.C.loadCompanyDocs).mock.calls.map(c => c[0])).toEqual(['mikroFaturalar']);
  });

  it('BAŞKA KİRACININ faturası sorulmaz ve yazılmaz: yalnız çağıranın kiracısı okunur', async () => {
    kaynakKur([fatura(389)], []);
    vi.mocked(mikroPost).mockResolvedValue(yanit('1002', 'Fatura zarflandı'));
    await d.cagir('POST', YOL);
    expect(vi.mocked(d.C.loadCompanyDocs).mock.calls.every(c => c[1] === 'A')).toBe(true);
  });

  it('tüm sorgular başarısızsa uç success:FALSE döner (kart yeşil görünmez), syncLog BAŞARISIZ; hiçbir doküman yazılmaz', async () => {
    kaynakKur([fatura(389)], [MF(389)]);
    vi.mocked(mikroPost).mockResolvedValue({ ok: false, status: 500, data: null });
    const res = await d.cagir('POST', YOL);
    expect(res.kod).toBe(200);                                                  // 5xx IIS hata sayfasına dönüşüp r.json()'u patlatırdı
    expect(res.govde).toMatchObject({ success: false, total: 0, hata: 1 });
    expect(String((res.govde as { error: string }).error)).toContain('GİB durumları sorgulanamadı');
    expect(d.koleksiyon('mikroFaturalar')).toEqual([]);
    expect(d.syncLog).toHaveBeenCalledWith('EBelgeDurumSorgulamaV2', 'mikroFaturalar', expect.any(String), false, null, expect.stringContaining('389'), expect.any(Number), expect.anything());
  });

  it('YARIM tarama (bazı sorgular düştü) success:true ama `eksik:true` — "Tümünü Çek" adımı tamam saymasın', async () => {
    kaynakKur([fatura(389), fatura(396)], []);
    vi.mocked(mikroPost).mockImplementation((async (_m: string, govde: { EBelge: { UUID: string } }) =>
      (govde.EBelge.UUID === E(389) ? { ok: false, status: 500, data: null } : yanit('1002', 'Fatura zarflandı'))) as unknown as typeof mikroPost);
    const res = await d.cagir('POST', YOL);
    expect(res.govde).toMatchObject({ success: true, eksik: true, total: 1, hata: 1 });
    kaynakKur([fatura(396)], []);
    vi.mocked(mikroPost).mockResolvedValue(yanit('2001', 'Fatura kabul edildi'));
    expect((await d.cagir('POST', YOL)).govde).toMatchObject({ success: true, eksik: false });
  });

  // İnceleme 2026-10-02 (CONFIRMED): eşleme reddin İLK görüldüğü koşuda atlanır / düşerse, fatura 'kesin' olduğu için bir daha aday
  // olmaz ve "yeni red" olayı bir daha doğmaz. Tetik DURUMA bağlı: koleksiyonda reddedilmiş fatura durdukça eşleme denenir.
  it('önceki koşuda reddedilmiş (kesin, artık sorulmayan) faturanın MF siparişi SONRAKİ koşuda da eşlenir; değişiklik yoksa not yığılmaz', async () => {
    const onceRed = fatura(389, { gibRed: true, gibDurum: { belgeKodu: '2002', ettn: E(389).toLowerCase() } });
    kaynakKur([onceRed], [MF(389)]);
    const res = await d.cagir('POST', YOL);
    expect(mikroPost).not.toHaveBeenCalled();                                  // 2002 kesin → sorulmadı
    expect(d.koleksiyon('orders').map(y => [y.ref.id, y.data?.status])).toEqual([['mikrofat__A__-389', 'Cancelled']]);
    expect(String((res.govde as { note: string }).note)).toContain("1 MF siparişi faturasını alıcı reddettiği (GİB 2002) için 'İptal' yapıldı");
    // Sipariş zaten iptalken: yazım yok, not da yok (her gece aynı uyarı yığılmasın).
    d.sifirla();
    kaynakKur([onceRed], [MF(389, { status: 'Cancelled', iptalKaynagi: 'mikro' })]);
    const res2 = await d.cagir('POST', YOL);
    expect(d.koleksiyon('orders')).toEqual([]);
    expect(String((res2.govde as { note: string }).note)).toBe('0 belge soruldu');
  });

  it('arka plan importu koşarken 409 (eşzamanlı yazım birbirinin alanını ezerdi); bakım kilidinde 423 — Mikro\'ya gidilmez', async () => {
    kaynakKur([fatura(389)], []);
    vi.mocked(arkaPlanIsiKosan).mockReturnValue('mikroImport-fatura-listesi');
    const r1 = await d.cagir('POST', YOL);
    expect(r1.kod).toBe(409);
    expect(String((r1.govde as { error: string }).error)).toContain('mikroImport-fatura-listesi');
    vi.mocked(arkaPlanIsiKosan).mockReturnValue(null);
    d.kilitAyarla({ aciklama: 'veri bakımı', baslangic: '2026-10-02T03:00:00Z' });
    expect((await d.cagir('POST', YOL)).kod).toBe(423);
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('yönü okunamayan fatura varken red bulunursa sipariş eşlemesi ATLANIR ve söylenir (belirsiz koruması)', async () => {
    kaynakKur([fatura(389), fatura(400, { cha_tip: null, cha_ebelge_Islemturu: '0' })], [MF(389)]);
    vi.mocked(mikroPost).mockResolvedValue(yanit('2002', 'Fatura red edildi'));
    const res = await d.cagir('POST', YOL);
    expect(d.koleksiyon('orders')).toEqual([]);
    expect(String((res.govde as { note: string }).note)).toContain('sipariş eşlemesi ATLANDI');
  });
});
