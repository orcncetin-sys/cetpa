/**
 * mikroRoutes.geceFaturadanSiparis.test.ts — 03:20 gece Mikro işinin YENİ son adımı: faturadan sipariş türetme
 * (şartname `.wf/SARTNAME-fatura-govde-ve-gece-mf.md` G3 / G3a, § 3 ve § 6; 2026-10-18).
 *
 * NEDEN VAR: kullanıcı «son evrak 16.10 görünüyor, otomatik olarak çalışmıyor demekki cron». Canlı gece işi 14 iş koşturuyordu
 * (13 SQL tanımı + GİB durum taraması); MF siparişleri yalnız panelin «Faturadan Sipariş Türet» / «Tümünü Çek»iyle oluşuyordu.
 * Adım panelin çağırdığı AYNI işlevi (`faturadanSiparisCalistir`) koşar — kopya gövde yok (çit aşağıda).
 *
 * SAHTE SAAT: `vi.useFakeTimers` (yalnız `Date`) + `node-cron` sahtesine verilen `'20 3 * * *'` işi GERÇEK zamanlayıcı kaydından
 * (`zamanla` → `cron.schedule`) yakalanıp elle koşturulur (kalıp: mikroRoutes.kiraciTaramasi.test.ts). Mikro'ya, veritabanına,
 * ağa istek YOK; sahte adminDb yazımları belleğe düşer (mikroRoutes.testDuzenegi). Denetim satırının GERÇEK kiracısı
 * (`server.ts` writeAuditLog) gerçek zincirle ayrıca sınanır: src/server/geceFaturadanSiparis.zincir.test.ts.
 *
 * vi.mock blokları BURADA kalmak zorunda (vitest hoisting) — tarif: mikroRoutes.testDuzenegi `mikroMockTarifi`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import cron from 'node-cron';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { getMikroCreds, mikroKolonlar, mikroPost, mikroSql } from '../mikroClient.js';
import { SRC_KOK, kodSatirlari } from '../../test/kaynakTarama';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS', resolveSentinels: (v: unknown) => v }));
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
    mikroSql: vi.fn(),
    mikroKolonlar: vi.fn(async () => [] as string[]),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});

const GECE = '20 3 * * *';
const SISTEM = { uid: 'system', email: '' };
/** Satış faturası başlığı (fatura-listesi importunun `mikroFaturalar`'a yazdığı ham cha_* biçimi). */
const BASLIK = { cha_evrakno_seri: '', cha_evrakno_sira: 412, cha_tarihi: '2026-10-17T00:00:00', cha_tip: 0, cha_kod: '120.01.0042', cha_meblag: 15000 };

interface KosuSecenegi {
  /** `loadCompanyDocs` sahtesi: koleksiyon → dokümanlar (yoksa []). Fırlatan işlev istisna dalını açar. */
  belgeler?: Record<string, Array<Record<string, unknown>> | (() => never)>;
  /** Hedef kiracı ortam değeri (`MIKRO_CRON_COMPANY_ID`); `undefined` → tanımsız, `users` taranır. */
  ortamKiracisi?: string | undefined;
  kullanicilar?: Record<string, Record<string, unknown>>;
  kilit?: { aciklama: string; baslangic: string };
  /** Mikro kimliği yok (`getMikroCreds` → null): iş adıma VARMADAN biter (§ 3 uzlaştırma). */
  kimlikYok?: boolean;
}

/** Rotaları GERÇEK modülle kurar, zamanlayıcıya verilen 03:20 işini yakalar ve sahte saatle koşturur. */
async function kostur(s: KosuSecenegi = {}): Promise<{ d: Duzenek; hata: ReturnType<typeof vi.spyOn>; uyari: ReturnType<typeof vi.spyOn> }> {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-19T00:20:00.000Z') });   // 03:20 İstanbul
  vi.stubEnv('MIKRO_CRON_SYNC', 'true');
  vi.stubEnv('MIKRO_CRON_COMPANY_ID', 'ortamKiracisi' in s ? s.ortamKiracisi : 'A');
  vi.mocked(cron.schedule).mockClear();
  const d = duzenekKur();
  if (s.kullanicilar) d.snapAyarla('users', s.kullanicilar);
  if (s.kilit) d.kilitAyarla(s.kilit);
  vi.mocked(mikroSql).mockImplementation((async () => ({ rows: [], hata: null })) as unknown as typeof mikroSql);
  vi.mocked(mikroKolonlar).mockResolvedValue([]);
  vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
  vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) => {
    const k = s.belgeler?.[coll];
    if (typeof k === 'function') return k();
    return k ?? [];
  }) as typeof d.C.loadCompanyDocs);
  const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const kayit = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === GECE);
  expect(kayit, `${GECE} işi kayıtlı`).toBeDefined();
  if (!kayit) throw new Error('iş kayıtlı değil');
  // Yalnız BU koşunun tek kimlik okuması: işin içinde kiracı çözüldükten hemen sonra (3704).
  if (s.kimlikYok) vi.mocked(getMikroCreds).mockResolvedValueOnce(null);
  await (kayit[1] as () => Promise<void>)();
  return { d, hata, uyari };
}

const islemler = (d: Duzenek): string[] => d.syncLog.mock.calls.map(c => String(c[0]));
const geceSatirlari = (d: Duzenek) => d.syncLog.mock.calls.filter(c => c[0] === 'faturadan-siparis');

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('03:20 gece işi — faturadan sipariş adımı (G3)', () => {
  it('satış faturası varken adım BİR kez koşar: MF siparişi hedef kiracıya TEK yazım, syncLog TEK sistem satırı (true), ucun ayrı denetimi YOK', async () => {
    const { d } = await kostur({ belgeler: { mikroFaturalar: [BASLIK] } });
    const siparisler = d.koleksiyon('orders');
    expect(siparisler.map(y => [y.op, y.ref.id, y.data?.companyId, y.data?.source])).toEqual([['set', 'mikrofat__A__-412', 'A', 'mikro-fatura']]);
    const satirlar = geceSatirlari(d);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0]).toEqual(['faturadan-siparis', 'orders', expect.stringContaining('1 sipariş türetildi'), true, null, null, expect.any(Number),
      SISTEM, undefined, { denetimKiracisi: 'A' }]);
    // Gece yolunda denetim satırı TEK: writeSyncLog'un içindeki (hedef kiracıya). Ucun `writeAuditLog('Faturadan Sipariş')`u yazılmaz.
    // (13 SQL tanımının her biri kendi `writeAuditLog`unu yazar — mevcut davranış, bu işte DEĞİŞMEZ: § 7 ayrı iş.)
    const denetimler = vi.mocked(d.C.writeAuditLog).mock.calls.map(c => String(c[1]));
    expect(denetimler.filter(a => /Faturadan Sipariş|faturadan-siparis/.test(a))).toEqual([]);
    expect(denetimler).toHaveLength(13);
    // Adım işin SONUNDADIR.
    expect(islemler(d).at(-1)).toBe('faturadan-siparis');
  });

  it('SIRA: fatura aynası < stok hareketleri < GİB taraması < faturadan-siparis (syncLog çağrı sırası; adım en sonda, 15 satır)', async () => {
    const { d } = await kostur({ belgeler: { mikroFaturalar: [BASLIK] } });
    const ad = islemler(d);
    const ilk = (islem: string) => ad.indexOf(islem);
    const sira = [ilk('SQL:CARI_HESAP_HAREKETLERI cha'), ilk('SQL:STOK_HAREKETLERI'), ilk('EBelgeDurumSorgulamaV2'), ilk('faturadan-siparis')];
    expect(sira.every(i => i >= 0), ad.join(' → ')).toBe(true);
    expect([...sira].sort((a, b) => a - b)).toEqual(sira);
    expect(new Set(sira).size).toBe(4);
    expect(ad).toHaveLength(15);                                   // 13 SQL tanımı + GİB + faturadan-siparis (G4: 14 → 15)
    expect(ad.filter(x => x === 'faturadan-siparis')).toHaveLength(1);
  });

  it('kalem yenileme gece KOŞMAZ: eski biçimli kalemi olan MF siparişinin kalemi YAZILMAZ (yalnız elle önizle → uygula)', async () => {
    const MF = { id: 'mikrofat__A__-412', source: 'mikro-fatura', companyId: 'A', orderNumber: 'MF-412', faturali: true, mikroFaturaNo: '412',
      mikroEvrak: { seri: '', sira: '412' }, lineItems: [{ sku: 'CMT-50', name: 'ÇİMENTO', quantity: 1, price: 100 }] };
    const HAREKET = { source: 'mikro_sql', sth_evraktip: 4, sth_evrakno_seri: '', sth_evrakno_sira: 412, sth_tarih: '2026-10-17',
      sth_stok_kod: 'CMT-50', sth_miktar: 100, sth_tutar: 20000, sth_vergi: 4000 };
    const { d } = await kostur({ belgeler: { mikroFaturalar: [BASLIK], orders: [MF], inventoryMovements: [HAREKET] } });
    expect(d.koleksiyon('orders')).toEqual([]);
    expect(String(geceSatirlari(d)[0]?.[2])).toContain('MF Sipariş Kalemlerini Yenile');
  });

  it("G3a gece yolunda da: Cetpa'dan kesilmiş (ETTN'i tutan) fatura MF siparişine türetilmez, not satırda", async () => {
    const ETTN = 'ABCDEF12-3456-7890-ABCD-EF1234567890';
    const { d } = await kostur({ belgeler: {
      mikroFaturalar: [{ ...BASLIK, cha_uuid: `{${ETTN}}` }],
      orders: [{ id: 'cetpa-1', companyId: 'A', status: 'Delivered', hasInvoice: true, ettn: ETTN.toLowerCase() }],
    } });
    expect(d.koleksiyon('orders')).toEqual([]);
    expect(String(geceSatirlari(d)[0]?.[2])).toContain('1 fatura Cetpa siparişine bağlı (ETTN) — türetilmedi');
  });
});

describe('gece adımının syncLog sözleşmesi — dört sonucun her biri TAM BİR sistem satırı (§ 3, gece-isi-5)', () => {
  it('tamam → true', async () => {
    const { d } = await kostur({ belgeler: { mikroFaturalar: [BASLIK] } });
    expect(geceSatirlari(d).map(c => [c[3], c[5], c[7]])).toEqual([[true, null, SISTEM]]);
  });

  it('satış faturası yok → true, nedeni metinde', async () => {
    const { d } = await kostur({ belgeler: { mikroFaturalar: [] } });
    const satirlar = geceSatirlari(d);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].slice(2, 6)).toEqual([expect.stringContaining('Satış faturası bulunamadı'), true, null, null]);
    expect(d.koleksiyon('orders')).toEqual([]);
  });

  it('satış faturası yok AMA yönü okunamayan fatura var (yönsüz > 0) → false, nedeni metinde ve hata alanında', async () => {
    const { d } = await kostur({ belgeler: { mikroFaturalar: [{ ...BASLIK, cha_tip: null }] } });
    const satirlar = geceSatirlari(d);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0][3]).toBe(false);
    expect(String(satirlar[0][2])).toContain('1 faturanın yönü okunamadı');
    expect(String(satirlar[0][5])).toContain('1 faturanın yönü okunamadı');
  });

  it('bakım kilidi → false «bakım kilidi: <açıklama>»; işlev KOŞMAZ (sipariş yazılmaz)', async () => {
    const { d } = await kostur({ belgeler: { mikroFaturalar: [BASLIK] }, kilit: { aciklama: 'lead birleştirme', baslangic: '2026-10-19T00:00:00.000Z' } });
    const satirlar = geceSatirlari(d);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].slice(3, 8)).toEqual([false, null, 'bakım kilidi: lead birleştirme', expect.any(Number), SISTEM]);
    expect(satirlar[0][9]).toEqual({ denetimKiracisi: 'A' });
    expect(d.koleksiyon('orders')).toEqual([]);
  });

  it('istisna → false, hata metni; öteki 14 iş etkilenmez (hepsi günlükte, adım yine EN SONDA tek satır)', async () => {
    const { d } = await kostur({ belgeler: { mikroFaturalar: [BASLIK], orders: () => { throw new Error('orders okunamadı'); } } });
    const satirlar = geceSatirlari(d);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].slice(3, 6)).toEqual([false, null, 'orders okunamadı']);
    const ad = islemler(d);
    expect(ad).toHaveLength(15);
    expect(ad.at(-1)).toBe('faturadan-siparis');
    expect(ad.filter(x => x.startsWith('SQL:'))).toHaveLength(13);
    expect(ad).toContain('EBelgeDurumSorgulamaV2');
  });
});

describe('gece adımının kiracısı = işin zaten çözdüğü `companyId` (§ 3, gece-isi-4) — kiracı taraması: mikroRoutes.kiraciTaramasi.test.ts', () => {
  it('Mikro kimliği yok → iş adıma VARMADAN biter: işlev çağrılmaz, orders ve syncLog YAZILMAZ; günlük = mevcut konsol iletisi (TEK)', async () => {
    const { d, uyari } = await kostur({ belgeler: { mikroFaturalar: [BASLIK] }, kimlikYok: true });
    expect(d.koleksiyon('orders')).toEqual([]);
    expect(d.syncLog).not.toHaveBeenCalled();
    expect(vi.mocked(d.C.loadCompanyDocs)).not.toHaveBeenCalled();       // işlevin ilk okuması mikroFaturalar — hiç okunmadı
    expect(uyari.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes('kimlik yok'))).toEqual(['Mikro SQL senkron: kimlik yok, atlandı.']);
  });

  it('ortam değeri dolu → o kiracıya yazar (denetim kiracısı da o)', async () => {
    const { d } = await kostur({ belgeler: { mikroFaturalar: [BASLIK] }, ortamKiracisi: 'ORTAM-KIRACISI' });
    expect(d.koleksiyon('orders').map(y => y.data?.companyId)).toEqual(['ORTAM-KIRACISI']);
    expect(vi.mocked(d.C.loadCompanyDocs).mock.calls.filter(c => c[0] === 'orders').map(c => c[1])).toEqual(['ORTAM-KIRACISI']);
    expect(geceSatirlari(d)[0]?.[9]).toEqual({ denetimKiracisi: 'ORTAM-KIRACISI' });
  });
});

// ── Çit: «yazıldı ama bağlanmadı» ve «kopya gövde» ───────────────────────────────────────────────────────────────────────────
describe('ÇİT — panel ucu ve gece işi AYNI ortak işlevi çağırır; kopya gövde / kopya ETTN yardımcısı yok', () => {
  const satirlar = kodSatirlari(join(SRC_KOK, 'server', 'routes', 'mikroRoutes.ts'));
  const kod = satirlar.map(s => s.kod).join('\n');
  const satirNo = (desen: RegExp): number[] => satirlar.filter(s => desen.test(s.kod)).map(s => s.n);

  it('`faturadanSiparisCalistir`: TEK tanım, TAM İKİ çağrı (uç + gece)', () => {
    expect(satirNo(/async function faturadanSiparisCalistir\(/)).toHaveLength(1);
    expect(satirNo(/(?<!function )\bfaturadanSiparisCalistir\(/)).toHaveLength(2);
  });

  it('uç gövdesi ortak işlevi çağırır; türetme gövdesi (`faturadanSiparis(x, k.kalemler`) dosyada TEK', () => {
    const uc = kod.slice(kod.indexOf("app.post('/api/mikro/import/faturadan-siparis'"));
    expect(uc.slice(0, uc.indexOf('\n  });')).match(/faturadanSiparisCalistir\(cid, /g)).toHaveLength(1);
    expect(kod.match(/\bfaturadanSiparis\(x, k\.kalemler/g)).toHaveLength(1);
  });

  it('gece işi (03:20) ortak işlevi GİB taramasından SONRA, bakım kilidi yazıcısı içinde çağırır', () => {
    const bas = kod.indexOf("zamanla('20 3 * * *'");
    expect(bas).toBeGreaterThan(-1);
    const gece = kod.slice(bas, kod.indexOf("zamanla('0 2 1 * *'"));
    const gib = gece.indexOf('gibDurumCalistir(companyId');
    const adim = gece.indexOf('faturadanSiparisCalistir(companyId, {})');
    expect([gib > -1, adim > gib]).toEqual([true, true]);
    expect(gece).toMatch(/yaziciOlarakCalistir\(C\.getPgPool\?\.\(\) \?\? null, 'mikro-cron:faturadan-siparis',\s*\(\) => faturadanSiparisCalistir\(companyId, \{\}\)\)/);
  });

  it('ETTN anahtarı TEK kaynaktan (`guidAnahtari`): mikroRoutes.ts\'te yerel süslü-parantez soyucu YOK', () => {
    expect(kod).not.toMatch(/replace\(\/\^\\\{\|\\\}\$\/g/);
    expect(kod).not.toMatch(/const ettnAnahtari\s*=/);
  });

  it('tek «geçerli ETTN» ölçütü (§ 9.B B4): ortak işlev, bekletme modülü ve `fatura/sonuc` rotası YALNIZ `cetpaEttnAnahtari` ile sınar', () => {
    const govde = kod.slice(kod.indexOf('async function faturadanSiparisCalistir('), kod.indexOf("app.post('/api/mikro/import/faturadan-siparis'"));
    expect(govde.length).toBeGreaterThan(1000);
    expect(govde).not.toMatch(/\bettnGecerli\(|\bguidBicimli\(/);
    const sonuc = kod.slice(kod.indexOf("app.post('/api/mikro/fatura/sonuc'"));
    const sonucGovde = sonuc.slice(0, sonuc.indexOf('\n  });'));
    expect(sonucGovde).toMatch(/cetpaEttnAnahtari\(ettnHam\)/);
    expect(sonucGovde).not.toMatch(/\bettnGecerli\(|\bguidBicimli\(|\bguidAnahtari\(/);
    const bekletme = kodSatirlari(join(SRC_KOK, 'server', 'mikro', 'faturaBekletme.ts')).map(x => x.kod).join('\n');
    expect(bekletme).toMatch(/const ettn = cetpaEttnAnahtari\(o\.ettn\);/);
    expect(bekletme).not.toMatch(/\bettnGecerli\(|\bguidBicimli\(|\bguidAnahtari\(/);
  });

  it('bekletmenin YERİ (§ 9.A A5): G3a satırının ardında, kalem sayaçlarından / `created`\'dan / mezar bloğundan ÖNCE; küme yalnız varsayılan modda', () => {
    const govde = kod.slice(kod.indexOf('async function faturadanSiparisCalistir('), kod.indexOf("app.post('/api/mikro/import/faturadan-siparis'"));
    const g3a = govde.indexOf('else { cetpaSiparisineBagli++; continue; }');
    const bekletme = govde.indexOf('const bekleten = bekletmeKarari(baglar, t.doc.mikroCariKod, t.doc.orderDate);');
    const kalem = govde.indexOf('if (hareket.length === 0) kalemKaynagiYok++;');
    const yeni = govde.indexOf('created++;');
    const mezar = govde.indexOf('const mezar = mezarlar.get(t.id);');
    expect([g3a, bekletme, kalem, yeni, mezar].every(i => i > -1)).toBe(true);
    expect(g3a < bekletme && bekletme < kalem && kalem < yeni && yeni < mezar).toBe(true);
    expect(govde).toMatch(/cetpaBaglariniKur\(mevcutSiparisler, siparisAdi, \{ bekletme: !yalnizKalem, simdi: new Date\(\) \}\)/);
  });

  it("crons.ts gece adımını İÇE AKTARMAZ (bağlam nesnesi kuralı; adım mikroRoutes kapanışında)", () => {
    const cronlar = kodSatirlari(join(SRC_KOK, 'server', 'crons.ts')).map(s => s.kod).join('\n');
    expect(cronlar).not.toMatch(/faturadanSiparis|faturadan-siparis/);
  });
});
