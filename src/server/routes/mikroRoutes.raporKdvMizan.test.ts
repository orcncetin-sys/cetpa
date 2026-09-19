/**
 * mikroRoutes.raporKdvMizan.test.ts — KDV özeti / mizan rotalarının BAĞLAMA testleri
 * (Faz 3 3/n, grup "raporKdvMizan", 2026-09-19).
 *
 * Saf modülün kendi testleri `src/server/mikro/raporKdvMizan.test.ts`'te (32 test).
 * BURADA kilitlenen şey farklı: rotanın gerçekten o modülü çağırdığı ve sonucun
 * `taxSummary` / `accountingPeriods` dokümanına + HTTP yanıtına DOĞRU indiği. İki rota:
 *
 *   • POST /api/mikro/pull/kdv    — kırılım + toplamlar + note + "hiç satır okunamadı" kapısı
 *   • POST /api/mikro/pull/mizan  — satırlar + çift taraflı kayıt denetimi + note
 *
 * Mutasyon-ayırt-edici ana iddialar (eski kod bunların HEPSİNİ sessizce geçiyordu):
 *   1. Yönü okunamayan KDV kovası ALIŞ sayılmaz → indirilecek KDV şişmez.
 *   2. Matrahı okunamayan kova dokümana `matrah: null` ile girer, ₺0 ile DEĞİL.
 *      (Dizi ELEMANI olduğu için "alanı hiç yazma" burada uygulanamaz — `merge:true`
 *      diziyi bütün olarak değiştirir; 0 yalan, null bilinmiyor. Bkz. modül başlığı.)
 *   3. Tutarı okunamayan mizan satırı VARSA hiçbir şey yazılmaz — 0 sayılan satırlarla
 *      "dengeli" çıkan eksik mizan artık yazılmıyor.
 *   4. `rowCount` yanıtta DOLU (istemci `d.rows` okuyordu → hep "0 satır").
 *
 * vi.mock blokları burada KALMAK ZORUNDA (vitest hoisting) — tarif tek kaynakta:
 * `mikroRoutes.testDuzenegi.ts` → `mikroMockTarifi`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroSql, mikroKolonlar, mikroVergiOranlari } from '../mikroClient.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
// `mikroMockTarifi` + İKİ EK (`mikroSql`, `mikroKolonlar`): bu ikisi kendi modülünün
// İÇİNDEKİ `mikroPost` bildirimine bağlıdır, namespace'te `mikroPost`u değiştirmek
// onları ETKİLEMEZ — gerçek fetch'e (localhost:8094) giderlerdi.
// `mikroVergiOranlari` tarifte `{}` döner; bu rota sonucu Map olarak KULLANIR
// (`.get()`), o yüzden burada gerçek bir Map ile değiştiriliyor.
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    mikroSql: vi.fn(async () => ({ rows: [] as Record<string, unknown>[], hata: null })),
    mikroKolonlar: vi.fn(async () => [] as string[]),
  };
});

// ── Fikstürler (Türkçe; gerçek Mikro kolon adları) ───────────────────────────
const STH_KOLONLARI = ['sth_tarih', 'sth_tip', 'sth_vergi', 'sth_vergi_pntr', 'sth_tutar', 'sth_iptal'];
const FIS_KOLONLARI = ['fis_tarih', 'fis_hesap_kodu', 'fis_meblag0', 'fis_iptal'];
/** Mikro VergiListesiV2 karşılığı: işaretçi → GERÇEK yüzde (pntr yüzde DEĞİLDİR). */
const VERGI = new Map<number, number>([[0, 0], [3, 10], [4, 20]]);

/** ÇİMENTO 50KG satışı — %20, matrah 10.000 ₺, KDV 2.000 ₺ */
const SATIS_20 = { oranPntr: 4, tip: 1, kdv: 2000, matrah: 10000 };
/** İnşaat demiri satışı — %10 */
const SATIS_10 = { oranPntr: 3, tip: 1, kdv: 450, matrah: 4500 };
/** Şirin İnşaat'tan alış — %20 */
const ALIS_20 = { oranPntr: 4, tip: 0, kdv: 800, matrah: 4000 };

let d: Duzenek;
let uyari: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  d = duzenekKur();
  vi.mocked(mikroVergiOranlari).mockResolvedValue(VERGI);
  uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { uyari.mockRestore(); });

/** KDV rotasının şema keşfi + SQL sonucunu kurar. */
function kdvKur(rows: Array<Record<string, unknown>>) {
  vi.mocked(mikroKolonlar).mockResolvedValue(STH_KOLONLARI);
  vi.mocked(mikroSql).mockResolvedValue({ rows, hata: null });
}
/** Mizan rotasının şema keşfi + SQL sonucunu kurar. */
function mizanKur(rows: Array<Record<string, unknown>>) {
  vi.mocked(mikroKolonlar).mockResolvedValue(FIS_KOLONLARI);
  vi.mocked(mikroSql).mockResolvedValue({ rows, hata: null });
}

const cagirKdv = (kullanici?: { companyId?: string }) =>
  d.cagir('POST', '/api/mikro/pull/kdv', { period: '2026-08' }, kullanici);
const cagirMizan = (kullanici?: { companyId?: string }) =>
  d.cagir('POST', '/api/mikro/pull/mizan', { period: '2026-08' }, kullanici);

// ── POST /api/mikro/pull/kdv ─────────────────────────────────────────────────
describe('pull/kdv — parite (bilinen girdide bugünküyle BİREBİR aynı)', () => {
  it('kırılım, toplamlar ve kaynak damgası taxSummary dokümanına aynen iner', async () => {
    kdvKur([SATIS_20, SATIS_10, ALIS_20]);
    const res = await cagirKdv();

    expect(res.kod).toBe(200);
    const yazimlar = d.koleksiyon('taxSummary');
    expect(yazimlar).toHaveLength(1);
    const doc = yazimlar[0].data as Record<string, unknown>;
    expect(doc.oranKirilimi).toEqual([
      { yon: 'satis', oran: 20, kdv: 2000, matrah: 10000 },
      { yon: 'satis', oran: 10, kdv: 450, matrah: 4500 },
      { yon: 'alis', oran: 20, kdv: 800, matrah: 4000 },
    ]);
    expect(doc.kdvHesaplanan).toBe(2450);
    expect(doc.kdvIndirilecek).toBe(800);
    expect(doc.kdvOdenmesi).toBe(1650);     // Math.max(2450-800, 0) paritesi
    expect(doc.devredenKdv).toBe(0);
    expect(doc.companyId).toBe('A');        // kiracı damgası değişmedi
    expect(doc.period).toBe('2026-08');
    expect(String(doc.kaynak)).toContain('SQL:STOK_HAREKETLERI');
  });

  it('yanıt gövdesi: matrah yalnız SATIŞ satırlarından, note temiz dönemde null', async () => {
    kdvKur([SATIS_20, SATIS_10, ALIS_20]);
    const res = await cagirKdv();
    const g = res.govde as Record<string, unknown>;
    expect(g.kdvMatrahi).toBe(14500);       // 10000 + 4500 (alışın 4000'i GİRMEZ)
    expect(g.hesaplananKdv).toBe(2450);
    expect(g.kdvOdenmesi).toBe(1650);
    expect(g.note).toBeNull();
  });
});

describe('pull/kdv — bilinmeyen 0 sayılmaz', () => {
  it('YÖNÜ okunamayan kova ALIŞ sayılmaz: indirilecek KDV şişmez, sayaç note\'a düşer', async () => {
    // Eski kod: Number(null) === 1 → false → ALIŞ → kdvIndirilecek 500 olurdu.
    kdvKur([SATIS_20, { oranPntr: 4, tip: null, kdv: 500, matrah: 2500 }]);
    const res = await cagirKdv();

    const doc = d.koleksiyon('taxSummary')[0].data as Record<string, unknown>;
    expect(doc.kdvIndirilecek).toBe(0);
    expect(doc.kdvHesaplanan).toBe(2000);
    expect(doc.kdvOdenmesi).toBe(2000);
    expect(doc.oranKirilimi).toHaveLength(1);       // atlanan kova kırılıma GİRMEZ
    const g = res.govde as Record<string, unknown>;
    expect(String(g.note)).toContain('1 satırın yon alanı bilinmiyor');
  });

  it('MATRAHI okunamayan kova dokümana null ile girer (₺0 ile değil) ve satış matrahını düşürmez', async () => {
    kdvKur([SATIS_20, { oranPntr: 3, tip: 1, kdv: 450, matrah: null }]);
    const res = await cagirKdv();

    const doc = d.koleksiyon('taxSummary')[0].data as Record<string, unknown>;
    const kirilim = doc.oranKirilimi as Array<Record<string, unknown>>;
    expect(kirilim).toHaveLength(2);
    expect(kirilim[1].kdv).toBe(450);              // KDV GERÇEK — kova atılmaz
    expect(kirilim[1].matrah).toBeNull();          // eski kod burada 0 yazıyordu
    // Kısmi toplam: bilinen tek satış matrahı. Eski `|| 0` de 10000 verirdi ama
    // "hiç bilinen yok" hâlinde ₺0 basardı — bir alttaki test onu ayırt ediyor.
    expect((res.govde as Record<string, unknown>).kdvMatrahi).toBe(10000);
  });

  it('HİÇBİR kovanın matrahı okunamazsa kdvMatrahi null (istemci \'—\' basar), ₺0 DEĞİL', async () => {
    kdvKur([{ oranPntr: 4, tip: 1, kdv: 2000, matrah: null }]);
    const res = await cagirKdv();
    expect(res.kod).toBe(200);
    const g = res.govde as Record<string, unknown>;
    expect(g.kdvMatrahi).toBeNull();
    expect(g.hesaplananKdv).toBe(2000);            // KDV hâlâ gerçek
  });

  it('sayaç senkron geçmişine de düşer (writeSyncLog özeti)', async () => {
    kdvKur([SATIS_20, { oranPntr: 4, tip: null, kdv: 500, matrah: 2500 }]);
    await cagirKdv();
    const ozet = String(d.syncLog.mock.calls[0][2]);
    expect(ozet).toContain('2026-08');
    expect(ozet).toContain('1 satırın yon alanı bilinmiyor');
  });
});

describe('pull/kdv — okuma arızası kapıları', () => {
  it('satır VAR ama hiçbiri okunamadıysa 502 ve taxSummary DEĞİŞMEZ', async () => {
    // Eski kod bu dönemi `kdvHesaplanan: 0, kdvIndirilecek: 0` diye YAZIYORDU →
    // beyan öncesi karşılaştırmada "hareket yok" gibi okunuyordu.
    kdvKur([{ oranPntr: 4, tip: null, kdv: null, matrah: null }]);
    const res = await cagirKdv();

    expect(res.kod).toBe(502);
    expect(d.koleksiyon('taxSummary')).toEqual([]);
    expect(String((res.govde as Record<string, unknown>).error)).toContain('okunabilen KDV satırı yok');
    expect(d.syncLog).not.toHaveBeenCalled();
  });

  it('bir alan TÜM satırlarda okunamazsa UYARI note\'un BAŞINA yazılır + console.warn', async () => {
    // 5 satır = ARIZA_ESIGI; KDV okunuyor, matrah hiçbirinde okunmuyor.
    kdvKur(Array.from({ length: 5 }, (_, i) => ({ oranPntr: 4, tip: 1, kdv: 100 + i, matrah: null })));
    const res = await cagirKdv();

    expect(res.kod).toBe(200);
    const not = String((res.govde as Record<string, unknown>).note);
    expect(not.startsWith('UYARI: matrah alanı hiçbir satırda okunamadı')).toBe(true);
    expect(uyari).toHaveBeenCalled();
    expect(String(uyari.mock.calls[0][0])).toContain('[pull/kdv] okuma arızası');
  });

  it('hiç satır dönmezse (mevcut kapı) 502 — davranış değişmedi', async () => {
    kdvKur([]);
    const res = await cagirKdv();
    expect(res.kod).toBe(502);
    expect(d.koleksiyon('taxSummary')).toEqual([]);
  });
});

// ── POST /api/mikro/pull/mizan ───────────────────────────────────────────────
describe('pull/mizan — parite', () => {
  it('satırlar, bakiye işareti ve toplam accountingPeriods dokümanına aynen iner', async () => {
    mizanKur([
      { hesapKodu: '120.01', borc: 15000, alacak: 0 },
      { hesapKodu: '320.01', borc: 0, alacak: 15000 },
    ]);
    const res = await cagirMizan();

    expect(res.kod).toBe(200);
    const doc = d.koleksiyon('accountingPeriods')[0].data as Record<string, unknown>;
    expect(doc.rows).toEqual([
      { hesapKodu: '120.01', borc: 15000, alacak: 0, bakiye: 15000 },
      { hesapKodu: '320.01', borc: 0, alacak: 15000, bakiye: -15000 },  // İŞARET KORUNUR
    ]);
    expect(doc.toplam).toEqual({ borc: 15000, alacak: 15000 });
    expect(doc.companyId).toBe('A');
    expect(String(doc.kaynak)).toContain('SQL:MUHASEBE_FISLERI');
  });

  it('yanıt `rowCount` alanıyla döner (istemci `d.rows` okuyup hep 0 yazıyordu)', async () => {
    mizanKur([
      { hesapKodu: '120.01', borc: 15000, alacak: 0 },
      { hesapKodu: '320.01', borc: 0, alacak: 15000 },
    ]);
    const g = (await cagirMizan()).govde as Record<string, unknown>;
    expect(g.rowCount).toBe(2);
    expect(g.note).toBeNull();
    expect('rows' in g).toBe(false);   // alan adı sözleşmesi kilitli
  });

  it('dengesizlik mesajı ve eşiği birebir korundu', async () => {
    mizanKur([
      { hesapKodu: '120.01', borc: 15000, alacak: 0 },
      { hesapKodu: '320.01', borc: 0, alacak: 12000 },
    ]);
    const res = await cagirMizan();
    expect(res.kod).toBe(502);
    expect(d.koleksiyon('accountingPeriods')).toEqual([]);
    expect(String((res.govde as Record<string, unknown>).error))
      .toContain('Mizan dengesiz: borç 15000.00 ≠ alacak 12000.00 (fark 3000.00)');
  });
});

describe('pull/mizan — bilinmeyen 0 sayılmaz', () => {
  it('tutarı okunamayan satır VARSA hiçbir şey yazılmaz (0/0 ile sahte denge bitti)', async () => {
    // MUTASYON-AYIRT EDİCİ: eski kod 153.01'i 0/0 sayar, denge TUTAR ve EKSİK
    // mizanı "denge doğrulandı" damgasıyla yazardı.
    mizanKur([
      { hesapKodu: '100.01', borc: 15000, alacak: 0 },
      { hesapKodu: '320.01', borc: 0, alacak: 15000 },
      { hesapKodu: '153.01', borc: null, alacak: null },
    ]);
    const res = await cagirMizan();

    expect(res.kod).toBe(502);
    expect(d.koleksiyon('accountingPeriods')).toEqual([]);
    const g = res.govde as Record<string, unknown>;
    expect(String(g.error)).toContain('1 hesabın borç/alacak tutarı');
    expect(String(g.note)).toContain('borc alanı bilinmiyor');
    expect(uyari).toHaveBeenCalled();
    expect(d.syncLog).not.toHaveBeenCalled();
  });

  it('hesap kodu okunamayan satır DÜŞER ve sayacı yanıta + senkron özetine yansır', async () => {
    mizanKur([
      { hesapKodu: '120.01', borc: 15000, alacak: 0 },
      { hesapKodu: '320.01', borc: 0, alacak: 15000 },
      { hesapKodu: '   ', borc: 7, alacak: 7 },   // boş metin = BİLİNMİYOR
    ]);
    const res = await cagirMizan();

    expect(res.kod).toBe(200);
    const doc = d.koleksiyon('accountingPeriods')[0].data as Record<string, unknown>;
    expect(doc.rows).toHaveLength(2);
    const g = res.govde as Record<string, unknown>;
    expect(g.rowCount).toBe(2);
    expect(String(g.note)).toContain('1 satırın hesapKodu alanı bilinmiyor');
    expect(String(d.syncLog.mock.calls[0][2])).toContain('1 satırın hesapKodu alanı bilinmiyor');
  });

  it('hiç satır dönmezse (mevcut kapı) 502 — davranış değişmedi', async () => {
    mizanKur([]);
    const res = await cagirMizan();
    expect(res.kod).toBe(502);
    expect(d.koleksiyon('accountingPeriods')).toEqual([]);
  });
});

describe('kiracı izolasyonu — damga çağırandan gelir', () => {
  it('B kiracısı çağırırsa her iki doküman da companyId B ile yazılır', async () => {
    kdvKur([SATIS_20]);
    await cagirKdv({ companyId: 'B' });
    expect((d.koleksiyon('taxSummary')[0].data as Record<string, unknown>).companyId).toBe('B');

    d.sifirla();
    mizanKur([{ hesapKodu: '120.01', borc: 100, alacak: 100 }]);
    await cagirMizan({ companyId: 'B' });
    expect((d.koleksiyon('accountingPeriods')[0].data as Record<string, unknown>).companyId).toBe('B');
  });
});
