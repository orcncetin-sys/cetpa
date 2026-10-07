/** acilisTani.test.ts — açılış yükü / gece senkronu ölçümünün saf çekirdeği (2026-10-08): DEĞER dönmez, yalnız sayı ve bayrak. */
import { describe, it, expect } from 'vitest';
import { hataSinifi, senkronSatiri, geceOzeti, koleksiyonOlculeri, TANIMSIZ_AD } from './acilisTani';

describe('hataSinifi — hata METNİ dışarı verilmez, yalnız kaba sınıfı', () => {
  it('hata yoksa null (boş metin, null, sayı)', () => {
    for (const v of [null, undefined, '', '   ', 0, {}]) expect(hataSinifi(v)).toBeNull();
  });
  it('zaman aşımı / bağlantı / kolon / kimlik ayrılır; tanınmayan "diger"', () => {
    expect(hataSinifi('The operation was aborted due to timeout')).toBe('zamanAsimi');
    expect(hataSinifi('Mikro yanıt vermedi: zaman aşımı (120 sn)')).toBe('zamanAsimi');
    expect(hataSinifi('connect ECONNREFUSED 127.0.0.1:8094')).toBe('baglanti');
    expect(hataSinifi('fetch failed')).toBe('baglanti');
    expect(hataSinifi("Invalid column name 'cha_vergi'.")).toBe('kolon');
    expect(hataSinifi('HTTP 401 Unauthorized')).toBe('kimlik');
    expect(hataSinifi('Kullanıcı şifresi hatalı')).toBe('kimlik');
    expect(hataSinifi('beklenmeyen yanıt biçimi')).toBe('diger');
  });
});

describe('senkronSatiri — syncLog dokümanından değer taşımayan tanı satırı', () => {
  const Z = '2026-10-08T00:21:07.000Z';
  it('başarılı SQL importu: kayıt sayısı özetin başından, süre, sistem bayrağı; hata sınıfı yok', () => {
    const s = senkronSatiri({ operation: 'SQL:CARI_HESAP_HAREKETLERI', entityType: 'mikroCariHareketler', entityId: '1594 kayıt — 2 iptal edilmiş kayıt silindi', success: true, duration: 8123, userId: 'system', error: null }, Z);
    expect(s).toEqual({ zaman: Z, islem: 'SQL:CARI_HESAP_HAREKETLERI', hedef: 'mikroCariHareketler', basarili: true, sureMs: 8123, sistem: true, kayit: 1594, tavan: false, uyari: false, hataSinifi: null });
  });
  it('tavan ve ⚠ bayrakları özetten; elle başlatılan iş sistem DEĞİL', () => {
    const s = senkronSatiri({ operation: 'SQL:STOK_HAREKETLERI', entityType: 'inventoryMovements', entityId: '20000 kayıt — SAYFA TAVANINA ÇARPTI, veri eksik — ⚠ 3 satırda GUID yok', success: true, duration: 90000, userId: 'u-123' }, Z);
    expect(s).toMatchObject({ kayit: 20000, tavan: true, uyari: true, sistem: false });
  });
  it('başarısız iş: hata METNİ ve özet metni çıktıda YOK, yalnız sınıf; süre ölçülemediyse null, kayıt sayısı null (0 değil)', () => {
    const s = senkronSatiri({ operation: 'SQL:STOKLAR', entityType: 'inventory', entityId: 'Stok kartları', success: false, duration: null, userId: 'system', error: "AHMET YILMAZ carisi okunurken zaman aşımı" }, Z);
    expect(s).toMatchObject({ basarili: false, sureMs: null, kayit: null, hataSinifi: 'zamanAsimi' });
    expect(JSON.stringify(s)).not.toContain('AHMET');
    expect(JSON.stringify(s)).not.toContain('Stok kartları');
  });
  it('başarı alanı tam olarak true değilse başarısız; eksik alanlar boş metin / null', () => {
    expect(senkronSatiri({ success: 'true' }, Z)).toMatchObject({ basarili: false, islem: '', hedef: '', sureMs: null, sistem: false, hataSinifi: null });
  });
});

describe('senkronSatiri — işlem / hedef adı yalnız TANIMLAYICI biçimindeyse dışarı çıkar', () => {
  const Z = '2026-10-08T00:21:07.000Z';
  it('istemcinin günlüğe yazdırdığı serbest metin (unvan, telefon) yer tutucuya döner — hedefte de işlemde de', () => {
    // /api/mikro/evrak/kaydet `entityType`'ı gövdeden alıp syncLog'a yazar; uç onu aynen yayınlamamalı.
    const s = senkronSatiri({ operation: 'EvrakKaydetV2', entityType: 'ÖRNEK YAPI LTD 0532 000 00 00', success: true }, Z);
    expect(s.hedef).toBe(TANIMSIZ_AD);
    expect(s.islem).toBe('EvrakKaydetV2');
    expect(JSON.stringify(s)).not.toContain('0532');
    expect(senkronSatiri({ operation: 'Ahmet Yılmaz ödeme', entityType: 'payment' }, Z)).toMatchObject({ islem: TANIMSIZ_AD, hedef: 'payment' });
    expect(senkronSatiri({ operation: '05320000000', entityType: '1lead' }, Z)).toMatchObject({ islem: TANIMSIZ_AD, hedef: TANIMSIZ_AD });
  });
  it('gerçek adlar geçer: SQL:<tablo>, koleksiyon adı, uç adı; sınırı aşan ad kesilip YAYINLANMAZ; boş ad boş kalır', () => {
    for (const ad of ['SQL:CARI_HESAP_HAREKETLERI', 'EBelgeDurumSorgulamaV2', 'mikroCariHareketler', 'cycleCount', 'evrak', 'stok-miktar', 'a.b', 'faturadan-siparis']) {
      expect(senkronSatiri({ operation: ad, entityType: ad }, Z)).toMatchObject({ islem: ad, hedef: ad });
    }
    // Sunucunun kendi yazdığı SQL adları takma ad / parantezli ek taşır (mikroRoutes: fatura-listesi, iptal-faturalar, KDV çekimi) —
    // gece koşusunun satırları '(tanımsız)' görünmemeli.
    for (const ad of ['SQL:CARI_HESAP_HAREKETLERI cha', 'SQL:STOK_HAREKETLERI(KDV)', 'SQL:STOK_HAREKETLERI sth(KDV)']) {
      expect(senkronSatiri({ operation: ad }, Z).islem).toBe(ad);
    }
    // …ama SQL öneki serbest metne kapı AÇMAZ; hedef alanı da bu genişlemeden yararlanmaz.
    for (const ad of ['SQL:CARI_HESAP_HAREKETLERI cha WHERE 1=1', 'SQL:X Ahmet', 'SQL:CARI_HESAP_HAREKETLERI  cha', 'SQL:A (KDV)', 'SQL:A cha2', 'Ahmet cha', 'SQL:A(kdv)']) {
      expect(senkronSatiri({ operation: ad }, Z).islem, ad).toBe(TANIMSIZ_AD);
    }
    expect(senkronSatiri({ entityType: 'Ahmet Yilmaz' }, Z).hedef).toBe(TANIMSIZ_AD);
    expect(senkronSatiri({ operation: 'x'.repeat(81), entityType: 'y'.repeat(61) }, Z)).toMatchObject({ islem: TANIMSIZ_AD, hedef: TANIMSIZ_AD });
    expect(senkronSatiri({ operation: 'x'.repeat(80), entityType: 'y'.repeat(60) }, Z)).toMatchObject({ islem: 'x'.repeat(80), hedef: 'y'.repeat(60) });
    expect(senkronSatiri({}, Z)).toMatchObject({ islem: '', hedef: '' });
  });
});

describe('geceOzeti — zamanlanmış koşuların İSTANBUL gününe göre özeti', () => {
  const s = (zaman: string, basarili: boolean, sistem = true) => senkronSatiri({ operation: 'SQL:X', entityType: 'x', entityId: '1 kayıt', success: basarili, userId: sistem ? 'system' : 'u1', duration: 1 }, zaman);
  it('UTC 00:20 = İstanbul 03:20: gün İstanbul takvimine göre; elle başlatılan iş sayılmaz; yeniden eskiye', () => {
    const g = geceOzeti([
      s('2026-10-07T00:20:05.000Z', true), s('2026-10-07T00:31:40.000Z', false), s('2026-10-07T09:00:00.000Z', true, false),
      s('2026-10-05T21:30:00.000Z', true),                            // İstanbul 6 Ekim 00:30
    ]);
    expect(g).toEqual([
      { gun: '2026-10-07', basarili: 1, hatali: 1, ilk: '03:20', son: '03:31' },
      { gun: '2026-10-06', basarili: 1, hatali: 0, ilk: '00:30', son: '00:30' },
    ]);
  });
  it('zamanlanmış kayıt yoksa BOŞ liste (o günler "koşmadı" — sıfır başarılı diye satır uydurulmaz); bozuk zaman atlanır', () => {
    expect(geceOzeti([s('2026-10-07T09:00:00.000Z', true, false)])).toEqual([]);
    expect(geceOzeti([s('tarih-değil', true)])).toEqual([]);
  });
});

describe('koleksiyonOlculeri — pg satırlarından sayı (bigint METİN gelir)', () => {
  it('bayta göre büyükten küçüğe, toplamla; son yazım ISO; okunamayan satır toplamı bozmaz', () => {
    const r = koleksiyonOlculeri([
      { coll: 'leads', satir: 900, bayt: '500000', son: new Date('2026-10-07T21:00:00.000Z') },
      { coll: 'inventoryMovements', satir: 5000, bayt: '9000000', son: '2026-09-30T00:25:00.000Z' },
      { coll: 'bozuk', satir: 3, bayt: 'x', son: null },
      { coll: 'bos', satir: 0, bayt: '0', son: null },
    ]);
    expect(r.koleksiyonlar).toEqual([
      { ad: 'inventoryMovements', satir: 5000, bayt: 9000000, sonYazim: '2026-09-30T00:25:00.000Z' },
      { ad: 'leads', satir: 900, bayt: 500000, sonYazim: '2026-10-07T21:00:00.000Z' },
      { ad: 'bos', satir: 0, bayt: 0, sonYazim: null },
    ]);
    expect(r.toplam).toEqual({ satir: 5900, bayt: 9500000 });
  });
});
