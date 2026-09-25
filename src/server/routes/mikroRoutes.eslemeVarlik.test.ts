/**
 * mikroRoutes.eslemeVarlik.test.ts — dört VARLIK import ucunun rota seviyesi sözleşmesi
 * (Faz 3 3/n, grup "eslemeVarlik", 2026-09-19).
 *
 * `eslemeVarlik.test.ts` saf fonksiyonu kilitliyor; BURASI gövdenin rotaya GERÇEKTEN
 * bağlandığını kanıtlar: bilinmeyen alan yazılan dokümanda YOK, var olan kullanıcı
 * değeri EZİLMİYOR, sayaç/okuma-arızası uyarısı `note`'a giriyor. İkisi ayrı arıza
 * sınıfı — modül doğru olup rota eski gövdeyi yazmaya devam edebilir ("yazıldı ama
 * bağlanmadı", bu projede 3 kez tekrarlandı).
 *
 * `/api/mikro/pull/personel` ve `/api/mikro/pull/uretim-receteleri` için bu ilk rota
 * testi (mikroRoutes.import.test.ts yalnız stok/cari uçlarını kapsıyordu).
 *
 * vi.mock blokları `mikroMockTarifi`nin kopyası + İKİ EK: `mikroSql` ve `mikroKolonlar`.
 * Gerekçe: `mikroSql` gerçek modülün İÇİNDEKİ `mikroPost`u çağırır, dışarıdan mock'lanan
 * export'u DEĞİL — yalnız `mikroPost`u mock'lamak bu dört ucu ağa çıkarırdı.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroSql, mikroKolonlar } from '../mikroClient.js';

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
    mikroSql: vi.fn(async () => ({ rows: [] as Record<string, unknown>[], hata: null as string | null })),
    mikroKolonlar: vi.fn(async () => [] as string[]),
  };
});

let d: Duzenek;
beforeEach(() => {
  d = duzenekKur();
  vi.mocked(mikroKolonlar).mockResolvedValue([]);
  vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
});

/** SQL sonucu: tek sayfa (500'den az satır → ikinci sayfa istenmez). */
const sqlDonsun = (rows: Record<string, unknown>[]) =>
  vi.mocked(mikroSql).mockResolvedValue({ rows, hata: null });
const kolonlarDonsun = (cols: string[]) => vi.mocked(mikroKolonlar).mockResolvedValue(cols);
/** Yazılan dokümanın alanları (docId ile). */
const yazilanDoc = (coll: string, id: string) =>
  d.koleksiyon(coll).find(y => y.ref.id === id)?.data ?? {};
/** 2026-09-24 (mikro-import-arkaplan): SQL fabrika uçları ARKA PLAN işi — `note` `jobs/<job>` dokümanında; iş beklenir. */
const sqlImportu = async (yol: string, job: string) => { await d.cagir('POST', yol); return (await d.isBitisi(job)) ?? {}; };
const isNotu = (is: Record<string, unknown>) => String(is.note ?? '');
/** Senkron uçlar (pull/personel, pull/uretim-receteleri) `note`u hâlâ yanıtta döner. */
const notu = (res: { govde: unknown }) => String((res.govde as { note?: string })?.note ?? '');

// ── /api/mikro/import/demirbas → sabitKiymetler ──────────────────────────────

describe('POST /api/mikro/import/demirbas', () => {
  const DEM_KOLON = ['dem_Guid', 'dem_kod', 'dem_isim', 'dem_alis_tarihi', 'dem_alis_bedeli', 'dem_faydali_omur', 'dem_grup_kodu'];
  /** Boş bir DEMIRBASLAR satırı: kolon adları `kolonSec`e rows[0]'dan geldiği için
   *  HER satırda tüm kolonlar bulunmalı (eksik anahtar = "kolon yok" sanılır). */
  const satir = (): Record<string, unknown> => Object.fromEntries(DEM_KOLON.map(k => [k, '']));

  it('alış bedeli/faydalı ömür bilinmiyorsa alan YAZILMAZ (0 değil) ve sayaç note\'a girer; bilinen 0 yazılır', async () => {
    sqlDonsun([
      { ...satir(), dem_Guid: 'g1', dem_kod: 'DM-1', dem_isim: 'Beton Mikseri', dem_alis_tarihi: '2024-03-15', dem_alis_bedeli: '', dem_faydali_omur: '', dem_grup_kodu: 'Makine' },
      { ...satir(), dem_Guid: 'g2', dem_kod: 'DM-2', dem_isim: 'Vinç', dem_alis_tarihi: '2023-01-02', dem_alis_bedeli: 250000, dem_faydali_omur: 10, dem_grup_kodu: 'Makine' },
      { ...satir(), dem_Guid: 'g3', dem_kod: 'DM-3', dem_isim: 'Hurda Kalıp', dem_alis_tarihi: '2022-05-05', dem_alis_bedeli: 0, dem_faydali_omur: 5, dem_grup_kodu: 'Makine' },
    ]);
    const is = await sqlImportu('/api/mikro/import/demirbas', 'mikroImport-demirbas');

    const dm1 = yazilanDoc('sabitKiymetler', 'DM-1');
    expect('alisBedeli' in dm1, 'bilinmeyen bedel 0 olarak YAZILMAMALI').toBe(false);
    expect('faydaliOmur' in dm1).toBe(false);
    expect(dm1).toMatchObject({ demirbasNo: 'DM-1', ad: 'Beton Mikseri', kategori: 'Makine', alisTarihi: '2024-03-15' });

    expect(yazilanDoc('sabitKiymetler', 'DM-2')).toMatchObject({ alisBedeli: 250000, faydaliOmur: 10 });
    expect(yazilanDoc('sabitKiymetler', 'DM-3').alisBedeli, 'Mikro gerçekten 0 yazdıysa 0 yazılır').toBe(0);

    expect(isNotu(is)).toContain('1 satırın alisBedeli alanı bilinmiyor');
    expect(isNotu(is)).toContain('1 satırın faydaliOmur alanı bilinmiyor');
    expect(isNotu(is)).not.toMatch(/^UYARI/);
  });

  it('var olan kayıtta kullanıcının kategori/durum/birikmişAmortisman değeri EZİLMEZ; yeni kayıtta UI sözlük varsayılanları yazılır', async () => {
    d.snapAyarla('sabitKiymetler', {
      'DM-1': { kategori: 'Taşıt', durum: 'Pasif', amortYontemi: 'Azalan Bakiyeler', departman: 'Şantiye', birikmisSalinma: 12500.5 },
    });
    sqlDonsun([
      { ...satir(), dem_Guid: 'g1', dem_kod: 'DM-1', dem_isim: 'Kamyon', dem_grup_kodu: 'MK-01', dem_alis_bedeli: 100, dem_faydali_omur: 5, dem_alis_tarihi: '2024-01-01' },
      { ...satir(), dem_Guid: 'g2', dem_kod: 'DM-9', dem_isim: 'Yeni Kepçe', dem_grup_kodu: 'MK-01', dem_alis_bedeli: 200, dem_faydali_omur: 8, dem_alis_tarihi: '2024-02-02' },
    ]);
    await sqlImportu('/api/mikro/import/demirbas', 'mikroImport-demirbas');

    const eski = yazilanDoc('sabitKiymetler', 'DM-1');
    expect(eski).toMatchObject({ kategori: 'Taşıt', durum: 'Pasif', amortYontemi: 'Azalan Bakiyeler', departman: 'Şantiye', mikroGrupKodu: 'MK-01' });
    expect('birikmisSalinma' in eski, 'elle girilen birikmiş amortisman senkronda sıfırlanmamalı').toBe(false);

    const yeni = yazilanDoc('sabitKiymetler', 'DM-9');
    expect(yeni).toMatchObject({ kategori: 'Diğer', durum: 'Aktif', amortYontemi: 'Doğrusal', paraBirimi: 'TRY', departman: '', birikmisSalinma: 0 });
  });

  it('bir alan TÜM satırlarda (≥5) bilinmiyorsa okuma arızası ilan edilir: note UYARI ile BAŞLAR', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sqlDonsun(Array.from({ length: 5 }, (_, i) => ({
      ...satir(), dem_Guid: `g${i}`, dem_kod: `DM-${i}`, dem_isim: `Demirbaş ${i}`,
      dem_alis_tarihi: '2024-03-15', dem_alis_bedeli: '', dem_faydali_omur: 4, dem_grup_kodu: 'Makine',
    })));
    const is = await sqlImportu('/api/mikro/import/demirbas', 'mikroImport-demirbas');
    expect(isNotu(is)).toMatch(/^UYARI: alisBedeli alanı hiçbir satırda okunamadı/);
    expect(uyari).toHaveBeenCalledWith(expect.stringContaining('[import/demirbas] UYARI: alisBedeli'));
    uyari.mockRestore();
  });
});

// ── /api/mikro/import/maliyet-merkezi → maliyetMerkezleri ────────────────────

describe('POST /api/mikro/import/maliyet-merkezi', () => {
  it("kullanıcının pasife aldığı merkez DİRİLMEZ (`aktif` yazılmaz); yeni kayıtta aktif:true", async () => {
    d.snapAyarla('maliyetMerkezleri', { 'MM-1': { aktif: false, ad: 'Eski Şantiye' } });
    sqlDonsun([
      { som_Guid: 'g1', som_kodu: 'MM-1', som_adi: 'Şirin İnşaat Şantiyesi' },
      { som_Guid: 'g2', som_kodu: 'MM-2', som_adi: 'Merkez Depo' },
    ]);
    await sqlImportu('/api/mikro/import/maliyet-merkezi', 'mikroImport-maliyet-merkezi');

    const eski = yazilanDoc('maliyetMerkezleri', 'MM-1');
    expect('aktif' in eski, 'var olan merkezin aktif alanı her senkronda true yapılmamalı').toBe(false);
    expect(eski).toMatchObject({ kod: 'MM-1', ad: 'Şirin İnşaat Şantiyesi' });
    expect(yazilanDoc('maliyetMerkezleri', 'MM-2')).toMatchObject({ kod: 'MM-2', ad: 'Merkez Depo', aktif: true });
  });

  it('ad boşsa Mikro koduna düşer ve sayaç note\'a girer', async () => {
    sqlDonsun([{ som_Guid: 'g1', som_kodu: 'MM-7', som_adi: '' }]);
    const is = await sqlImportu('/api/mikro/import/maliyet-merkezi', 'mikroImport-maliyet-merkezi');
    expect(yazilanDoc('maliyetMerkezleri', 'MM-7')).toMatchObject({ kod: 'MM-7', ad: 'MM-7' });
    expect(isNotu(is)).toContain('1 satırın ad alanı bilinmiyor');
  });
});

// ── /api/mikro/pull/personel → employees ─────────────────────────────────────

describe('POST /api/mikro/pull/personel', () => {
  const PER_KOLON = ['per_kodu', 'per_adi', 'per_soyadi', 'per_eposta', 'per_ceptel', 'per_departman', 'per_gorevi', 'per_maas', 'per_isegiris', 'per_durumu', 'per_tc'];

  it('maaş/TC bilinmiyorsa alan YAZILMAZ (0 ve null yok); İK\'nın Pasif\'i dirilmez; yeni kayıtta metin alanları \'\'', async () => {
    kolonlarDonsun(PER_KOLON);
    d.snapAyarla('employees', { 'P-1': { status: 'Pasif', salary: 48000, tcId: '12345678901' } });
    sqlDonsun([
      { mikroPersKod: 'P-1', name: 'Mehmet', surname: 'Yılmaz', email: '', phone: '', department: '', position: '', salary: 0, startDate: '', status: '', tcId: '' },
      { mikroPersKod: 'P-2', name: 'Ayşe', surname: 'Demir', email: 'ayse@cetpa.com.tr', phone: '', department: 'Muhasebe', position: 'Uzman', salary: 65000, startDate: '2023-04-01', status: '0', tcId: '98765432109' },
    ]);
    const res = await d.cagir('POST', '/api/mikro/pull/personel');

    const p1 = yazilanDoc('employees', 'P-1');
    expect('salary' in p1, 'bilinmeyen maaş 0 olarak YAZILMAMALI').toBe(false);
    expect('tcId' in p1, 'elle girilen TC null ile silinmemeli').toBe(false);
    expect('status' in p1, "İK'nın 'Pasif'i her senkronda 'Aktif'e dönmemeli").toBe(false);
    expect('email' in p1, 'var olan kayıtta boş alan ezilmemeli').toBe(false);
    expect(p1).toMatchObject({ mikroPersKod: 'P-1', name: 'Mehmet Yılmaz' });

    const p2 = yazilanDoc('employees', 'P-2');
    expect(p2).toMatchObject({
      name: 'Ayşe Demir', email: 'ayse@cetpa.com.tr', phone: '', department: 'Muhasebe',
      position: 'Uzman', salary: 65000, startDate: '2023-04-01', status: 'Aktif', tcId: '98765432109',
    });

    expect(notu(res)).toContain('1 satırın salary alanı bilinmiyor');
    expect((res.govde as { okumaArizasi?: string[] }).okumaArizasi).toEqual([]);
  });

  // 2026-09-19 hakem bulgusu: maaş/e-posta/TC MEŞRU olarak boş kalabilir (Mikro maaş
  // alanını boş bırakınca 0 döner — modülün kendi yorumu). Bunları okuma arızası ilan
  // etmek her senkronda "kolon adı/şema kontrol edin" yanlış alarmı üretiyordu ve
  // GERÇEK arıza kapısını değersizleştiriyordu. Arıza yalnız KRİTİK alanda ilan edilir.
  it('maaş TÜM satırlarda bilinmese bile ARIZA DEĞİL — yalnız sayaç (kalıcı yanlış alarm yok)', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    kolonlarDonsun(PER_KOLON);
    sqlDonsun(Array.from({ length: 5 }, (_, i) => ({
      mikroPersKod: `P-${i}`, name: `Ad${i}`, surname: 'Soy', email: '', phone: '5550000',
      department: 'Saha', position: 'Usta', salary: null, startDate: '2024-01-01', status: 'Aktif', tcId: '',
    })));
    const res = await d.cagir('POST', '/api/mikro/pull/personel');
    expect(notu(res)).not.toMatch(/UYARI/);
    expect(notu(res)).toContain('5 satırın salary alanı bilinmiyor');
    expect((res.govde as { okumaArizasi?: string[] }).okumaArizasi).toEqual([]);
    expect(uyari).not.toHaveBeenCalledWith(expect.stringContaining('[pull/personel] UYARI'));
    uyari.mockRestore();
  });

  it('ad/soyad TÜM satırlarda (≥5) okunamıyorsa okuma arızası: note UYARI ile başlar + console.warn', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    kolonlarDonsun(PER_KOLON);
    sqlDonsun(Array.from({ length: 5 }, (_, i) => ({
      mikroPersKod: `P-${i}`, name: '', surname: '', email: `a${i}@x.tr`, phone: '5550000',
      department: 'Saha', position: 'Usta', salary: 50000, startDate: '2024-01-01', status: 'Aktif', tcId: `1111111111${i}`,
    })));
    const res = await d.cagir('POST', '/api/mikro/pull/personel');
    expect(notu(res)).toMatch(/^UYARI: name alanı hiçbir satırda okunamadı/);
    expect((res.govde as { okumaArizasi?: string[] }).okumaArizasi).toEqual(['name']);
    expect(uyari).toHaveBeenCalledWith(expect.stringContaining('[pull/personel] UYARI: name'));
    uyari.mockRestore();
  });

  it('arıza ilan edilen alan sayaç metninde TEKRAR geçmez (aynı alan üç kez yazılmasın)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    kolonlarDonsun(PER_KOLON);
    sqlDonsun(Array.from({ length: 5 }, (_, i) => ({
      mikroPersKod: `P-${i}`, name: '', surname: '', email: i < 2 ? '' : `a${i}@x.tr`, phone: '5550000',
      department: 'Saha', position: 'Usta', salary: 50000, startDate: '2024-01-01', status: 'Aktif', tcId: `1111111111${i}`,
    })));
    const res = await d.cagir('POST', '/api/mikro/pull/personel');
    expect(notu(res)).not.toMatch(/5 satırın name alanı bilinmiyor/);
    expect(notu(res)).toContain('2 satırın email alanı bilinmiyor');
  });
});

// ── /api/mikro/pull/uretim-receteleri → bom ──────────────────────────────────

describe('POST /api/mikro/pull/uretim-receteleri', () => {
  const REC_KOLON = ['rec_Guid', 'rec_ana_stok_kod', 'rec_alt_stok_kod', 'rec_miktar', 'rec_birim'];

  it('miktar bilinmiyorsa bileşende `quantity` ANAHTARI hiç yazılmaz ("0 çuval çimento" reçetesi üretilmez)', async () => {
    kolonlarDonsun(REC_KOLON);
    d.snapAyarla('inventory', { inv1: { sku: 'ÇİMENTO-50KG', name: 'ÇİMENTO 50KG', companyId: 'A' } });
    sqlDonsun([
      { rec_Guid: 'g1', rec_ana_stok_kod: 'BETON-C25', rec_alt_stok_kod: 'ÇİMENTO-50KG', rec_miktar: '', rec_birim: 'çuval' },
      { rec_Guid: 'g2', rec_ana_stok_kod: 'BETON-C25', rec_alt_stok_kod: 'KUM-01', rec_miktar: 3, rec_birim: 'm3' },
    ]);
    const res = await d.cagir('POST', '/api/mikro/pull/uretim-receteleri');

    const bilesenler = (yazilanDoc('bom', 'BETON-C25').components ?? []) as Record<string, unknown>[];
    const cimento = bilesenler.find(b => b.sku === 'ÇİMENTO-50KG') ?? {};
    expect('quantity' in cimento, 'bilinmeyen miktar 0 olarak yazılmamalı — anahtar hiç olmamalı').toBe(false);
    expect(cimento).toMatchObject({ inventoryId: 'inv1', name: 'ÇİMENTO 50KG', unit: 'çuval' });
    expect(bilesenler.find(b => b.sku === 'KUM-01')).toMatchObject({ inventoryId: '', name: 'KUM-01', quantity: 3, unit: 'm3' });
    expect(notu(res)).toContain('1 satırın quantity alanı bilinmiyor');
  });

  it('yabancı kiracının aynı SKU\'lu ürünü bileşen adına/ID\'sine SIZMAZ', async () => {
    kolonlarDonsun(REC_KOLON);
    d.snapAyarla('inventory', { yab: { sku: 'KUM-01', name: 'Yabancı Kum', companyId: 'B' } });
    sqlDonsun([{ rec_Guid: 'g1', rec_ana_stok_kod: 'BETON-C25', rec_alt_stok_kod: 'KUM-01', rec_miktar: 2, rec_birim: 'm3' }]);
    await d.cagir('POST', '/api/mikro/pull/uretim-receteleri');
    const bilesenler = (yazilanDoc('bom', 'BETON-C25').components ?? []) as Record<string, unknown>[];
    expect(bilesenler[0]).toMatchObject({ inventoryId: '', name: 'KUM-01', quantity: 2 });
  });

  it('miktar TÜM satırlarda (≥5) bilinmiyorsa okuma arızası ilan edilir', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    kolonlarDonsun(REC_KOLON);
    sqlDonsun(Array.from({ length: 5 }, (_, i) => ({
      rec_Guid: `g${i}`, rec_ana_stok_kod: 'BETON-C25', rec_alt_stok_kod: `BILESEN-${i}`, rec_miktar: null, rec_birim: 'kg',
    })));
    const res = await d.cagir('POST', '/api/mikro/pull/uretim-receteleri');
    expect(notu(res)).toMatch(/^UYARI: quantity alanı hiçbir satırda okunamadı/);
    expect((res.govde as { okumaArizasi?: string[] }).okumaArizasi).toEqual(['quantity']);
    expect(uyari).toHaveBeenCalledWith(expect.stringContaining('[pull/uretim-receteleri] UYARI: quantity'));
    uyari.mockRestore();
  });
});
