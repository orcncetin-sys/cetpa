/**
 * faturaGonderimi.ettn.test.ts — `ettnTutarlilikKarari` (şartname «fatura gövde + gece MF» § 9.B B3, 2026-10-19): «Mikro'da var»
 * + ETTN ve «ETTN ekle»nin ORTAK saf kararı. Ret YALNIZ kesin çelişkide; aynada yok / yönü okunamıyor / cari bilinmiyor → KABUL +
 * uyarı. Uç bağlaması ve sıralı araya girme (NOT EXISTS): server/faturaCiftKesim.zincir.test.ts («B6»).
 *
 * DANIŞMA KİLİDİ (delta 2026-10-19): ETTN yazan iki yol AYNI bağlantıda `BEGIN` → kilit (AYRI deyim) → UPDATE → `COMMIT`; hata →
 * `ROLLBACK`; yayın COMMIT'ten SONRA. Burada sahte havuzla sorgu SIRASI sınanır. Gerçek eşzamanlılık (iki bağlantı, READ
 * COMMITTED'da iki UPDATE) PGlite'ta da burada da SINANAMAZ — PGlite tek bağlantılıdır; kilidin gerekçesi kod yorumunda.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ETTN_AYNA_UYARISI, ettnTutarlilikKarari, sonucVarYamasi, faturaEttnEkle, faturaSonucunuYaz,
  FATURA_OKU_SQL, FATURA_ETTN_BASKA_SIPARIS_SQL, FATURA_ETTN_KILIT_SQL, FATURA_ETTN_EKLE_SQL, FATURA_SONUC_VAR_ETTN_SQL,
  FATURA_SONUC_VAR_SQL, ettnEkleRetKarari, type FaturaBaglami, type FaturaHavuzu,
} from './faturaGonderimi';
import { FATURA_GONDERIM_ALANI } from '../../lib/faturaGonderimi';
import { talepSiniri } from './faturaBekletme';
import { ETTN_VAKALARI } from '../../test/ettnVakalari';

const E = 'abcdef12-3456-7890-abcd-ef1234567890';
const satis = (ek: Record<string, unknown> = {}) => ({ cha_uuid: `{${E.toLocaleUpperCase('tr-TR')}}`, cha_tip: 0, cha_kod: '120.01.0042', ...ek });
/** `cariKod: null` = işarette cari YOK. */
const karar = (aynaSatirlari: Array<Record<string, unknown>>, cariKod: string | null = '120.01.0042', baskaSiparis: string | null = null) =>
  ettnTutarlilikKarari({ ettn: E, ...(cariKod !== null ? { cariKod } : {}), aynaSatirlari, baskaSiparis });

describe('ettnTutarlilikKarari', () => {
  it('başka Cetpa siparişi aynı ETTN\'yi taşıyor → FATURA_ETTN_BASKA_SIPARISTE (sipariş numarasıyla), ayna bakılmadan', () => {
    expect(karar([satis()], '120.01.0042', 'SIP-0007')).toEqual({ ret: { kod: 'FATURA_ETTN_BASKA_SIPARISTE', error: 'Bu ETTN başka bir siparişte kayıtlı: SIP-0007' } });
  });
  it('aynada satış satırı, cari tutuyor (parantez / harf / boşluk farkı bozmaz) → kabul, uyarı yok', () => {
    expect(karar([satis({ cha_kod: ' 120.01.0042 ' })])).toEqual({});
  });
  it('aynada bu ETTN yok → KABUL + uyarı (ayna 90 günlük pencere, gece güncellenir)', () => {
    expect(karar([satis({ cha_uuid: '11111111-2222-3333-4444-555555555555' })])).toEqual({ uyari: ETTN_AYNA_UYARISI });
    expect(karar([])).toEqual({ uyari: ETTN_AYNA_UYARISI });
  });
  it('satırların HEPSİ alış → FATURA_ETTN_BASKA_CARI «alış faturası»', () => {
    expect(karar([satis({ cha_tip: 1 })])).toEqual({ ret: { kod: 'FATURA_ETTN_BASKA_CARI', error: 'Bu ETTN bir alış faturasına ait' } });
  });
  it('yönü okunamayan satır (cha_tip yok, `yon` yok) ALIŞ SAYILMAZ → KABUL + uyarı', () => {
    expect(karar([satis({ cha_tip: null })])).toEqual({ uyari: ETTN_AYNA_UYARISI });
    expect(karar([satis({ cha_tip: 1 }), satis({ cha_tip: undefined })])).toEqual({ uyari: ETTN_AYNA_UYARISI });
  });
  it('kayıtlı `yon` alanı da okunur (faturaYonu ile aynı kaynak)', () => {
    expect(karar([satis({ cha_tip: undefined, yon: 'alis' })]).ret?.kod).toBe('FATURA_ETTN_BASKA_CARI');
    expect(karar([satis({ cha_tip: undefined, yon: 'satis' })])).toEqual({});
  });
  it('satış satırı var, işarette cari var ve hiçbir satış satırı tutmuyor → FATURA_ETTN_BASKA_CARI (iki cari metinde)', () => {
    expect(karar([satis({ cha_kod: '120.01.0099' })])).toEqual({ ret: { kod: 'FATURA_ETTN_BASKA_CARI', error: 'Bu ETTN 120.01.0099 carisinin faturası; sipariş carisi 120.01.0042' } });
  });
  it('cari karşılaştırması Türkçe büyük harfle: `i` ↔ `İ` tutar', () => {
    expect(karar([satis({ cha_kod: 'CARİ-İ' })], 'cari-i')).toEqual({});
  });
  it('işarette cari YOK (eski kayıt) → doğrulanamaz → KABUL + uyarı', () => {
    expect(karar([satis({ cha_kod: '120.01.0099' })], null)).toEqual({ uyari: ETTN_AYNA_UYARISI });
  });
  it('satış satırı tutmuyor ama yönü okunamayan satır da var → kesin değil → KABUL + uyarı', () => {
    expect(karar([satis({ cha_kod: '120.01.0099' }), satis({ cha_tip: null, cha_kod: '120.01.0042' })])).toEqual({ uyari: ETTN_AYNA_UYARISI });
  });
  it('alış + tutan satış satırı birlikte → kabul (satış satırı karar verir)', () => {
    expect(karar([satis({ cha_tip: 1, cha_kod: '320.01' }), satis()])).toEqual({});
  });
});

// İnceleme 2026-10-19 (B3 × A2): bağ kurulurken gece bekletme ölçütü (`faturaGunu >= sinir`) sınanır. Aynı carinin talep
// sınırından ÖNCEKİ faturası bu siparişin olamaz (gece zaten MF siparişine dönüşmüştür); kabul edilirse bekletme kalkar ve
// siparişin gerçek faturası AYRICA MF olarak türer (aynı satış iki kez).
describe('ettnTutarlilikKarari — talep sınırı (§ 9.A A2 ölçütü, yazma anında)', () => {
  const SINIR = '2026-10-19';
  const sinirli = (aynaSatirlari: Array<Record<string, unknown>>, sinir: string | null = SINIR, cariKod: string | null = '120.01.0042') =>
    ettnTutarlilikKarari({ ettn: E, ...(cariKod !== null ? { cariKod } : {}), aynaSatirlari, baskaSiparis: null, sinir });
  const ONCEKI = { ret: { kod: 'FATURA_ETTN_ONCEKI_FATURA', error: 'Bu ETTN 2026-10-10 tarihli, talepten (2026-10-19) önceki bir faturanın; bu siparişin faturası olamaz' } };

  it('cari tutan satış satırının günü sınırdan KESİN önce → 409 FATURA_ETTN_ONCEKI_FATURA (iki gün iletide)', () => {
    expect(sinirli([satis({ cha_tarihi: '2026-10-10T00:00:00' })])).toEqual(ONCEKI);
    expect(sinirli([satis({ cha_tarihi: '2026-10-10' })])).toEqual(ONCEKI);
    // Bir gün önce de ret (sınır gün dâhil değil).
    expect(sinirli([satis({ cha_tarihi: '2026-10-18 23:59:59' })]).ret?.kod).toBe('FATURA_ETTN_ONCEKI_FATURA');
  });
  it('EŞİT gün → kabul (bekletme kuralı `>=`: talep günü kesilen fatura bu siparişin olabilir)', () => {
    expect(sinirli([satis({ cha_tarihi: '2026-10-19T00:00:00' })])).toEqual({});
  });
  it('sonraki gün → kabul', () => {
    expect(sinirli([satis({ cha_tarihi: '2026-10-20T00:00:00' })])).toEqual({});
  });
  it('biçim dışı / boş / eksik fatura günü → kabul (kesin değil; bugünkü davranış)', () => {
    for (const cha_tarihi of ['10.10.2026', '', null, undefined, 20261010, '2026-1-10']) {
      expect(sinirli([satis({ cha_tarihi })]), String(cha_tarihi)).toEqual({});
    }
  });
  it('sınır YOK (`null` / verilmez) ya da biçim dışı → kabul', () => {
    expect(sinirli([satis({ cha_tarihi: '2026-10-10' })], null)).toEqual({});
    // Alan hiç verilmez (işaret yok → `ettnDenetimi` `sinir` koymaz).
    expect(ettnTutarlilikKarari({ ettn: E, cariKod: '120.01.0042', aynaSatirlari: [satis({ cha_tarihi: '2026-10-10' })], baskaSiparis: null })).toEqual({});
    expect(sinirli([satis({ cha_tarihi: '2026-10-10' })], 'undefined-undefined-x')).toEqual({});
    expect(sinirli([satis({ cha_tarihi: '2026-10-10' })], '')).toEqual({});
  });
  it('tutan satırların HEPSİ önce olmalı: biri sınırda / sonra ya da günü okunamıyorsa → kabul', () => {
    expect(sinirli([satis({ cha_tarihi: '2026-10-10' }), satis({ cha_tarihi: '2026-10-19' })])).toEqual({});
    expect(sinirli([satis({ cha_tarihi: '2026-10-10' }), satis({ cha_tarihi: null })])).toEqual({});
  });
  it('hepsi önceyse iletide EN GEÇ gün; yalnız cari TUTAN satırlar sayılır (başka carinin / alış satırının günü karar vermez)', () => {
    expect(sinirli([satis({ cha_tarihi: '2026-10-02' }), satis({ cha_tarihi: '2026-10-10' }), satis({ cha_tarihi: '2026-10-05' })])).toEqual(ONCEKI);
    expect(sinirli([satis({ cha_tarihi: '2026-10-25', cha_kod: '120.01.0099' }), satis({ cha_tarihi: '2026-10-10' })])).toEqual(ONCEKI);
    expect(sinirli([satis({ cha_tarihi: '2026-10-25', cha_tip: 1 }), satis({ cha_tarihi: '2026-10-10' })])).toEqual(ONCEKI);
    expect(sinirli([satis({ cha_tarihi: '2026-10-01', cha_kod: '120.01.0099' }), satis({ cha_tarihi: '2026-10-20' })])).toEqual({});
  });
  it('öteki kurallar önce gelir: başka sipariş / alış / başka cari / cari bilinmiyor tarihten bağımsız aynı kalır', () => {
    expect(ettnTutarlilikKarari({ ettn: E, cariKod: '120.01.0042', aynaSatirlari: [satis({ cha_tarihi: '2026-10-10' })], baskaSiparis: 'SIP-1', sinir: SINIR }).ret?.kod)
      .toBe('FATURA_ETTN_BASKA_SIPARISTE');
    expect(sinirli([satis({ cha_tarihi: '2026-10-10', cha_tip: 1 })]).ret?.kod).toBe('FATURA_ETTN_BASKA_CARI');
    expect(sinirli([satis({ cha_tarihi: '2026-10-10', cha_kod: '120.01.0099' })]).ret?.kod).toBe('FATURA_ETTN_BASKA_CARI');
    expect(sinirli([satis({ cha_tarihi: '2026-10-10' })], SINIR, null)).toEqual({ uyari: ETTN_AYNA_UYARISI });
  });
  it('sınır `talepSiniri(isaret)` ile: `faturaTarihi` (GG.AA.YYYY) önce, yoksa `zaman`ın İstanbul günü', () => {
    expect(talepSiniri({ zaman: '2026-10-25T10:00:00.000Z', faturaTarihi: '19.10.2026' })).toBe(SINIR);
    expect(talepSiniri({ zaman: '2026-10-18T22:30:00.000Z' })).toBe(SINIR);
  });
});

describe('sonucVarYamasi — ETTN verilirse üst düzeyde `ettn`', () => {
  it('numara ve ETTN isteğe bağlı; verilmeyen alan YAZILMAZ', () => {
    expect(sonucVarYamasi()).toEqual({ hasInvoice: true, mikroSynced: true });
    expect(sonucVarYamasi('N-1', E)).toEqual({ hasInvoice: true, mikroSynced: true, mikroFaturaNo: 'N-1', ettn: E });
    expect(sonucVarYamasi(undefined, E)).toEqual({ hasInvoice: true, mikroSynced: true, ettn: E });
  });
});

describe('danışma kilidi — ETTN yazan iki yol: BEGIN → kilit → UPDATE → COMMIT (tek bağlantı), yayın COMMIT\'ten sonra', () => {
  const ADLAR: Array<[string, string]> = [
    [FATURA_OKU_SQL, 'OKU'], [FATURA_ETTN_BASKA_SIPARIS_SQL, 'BASKA'], [FATURA_ETTN_KILIT_SQL, 'KILIT'],
    [FATURA_ETTN_EKLE_SQL, 'EKLE'], [FATURA_SONUC_VAR_ETTN_SQL, 'VAR_ETTN'], [FATURA_SONUC_VAR_SQL, 'VAR'],
  ];
  const ad = (sql: string): string => ADLAR.find(([q]) => q === sql)?.[1] ?? sql;
  interface Duzenek { b: FaturaBaglami; gunluk: string[]; parametreler: Record<string, unknown[] | undefined>; release: ReturnType<typeof vi.fn> }
  /** `durum`: siparişin işaret durumu; `hata`: istemcide bu adlı deyim fırlatır; `satirYok`: UPDATE 0 satır döner. */
  function kur(durum: 'gonderildi' | 'belirsiz', se: { hata?: string[]; satirYok?: boolean } = {}): Duzenek {
    const gunluk: string[] = [];
    const parametreler: Record<string, unknown[] | undefined> = {};
    const data = { companyId: 'K1', orderNumber: 'S-1', [FATURA_GONDERIM_ALANI]: { durum, istekNo: 'i', zaman: '2026-10-19T09:00:00.000Z', kim: 'k', cariKod: '120.01' } };
    const okunan = { data, bayat: false, kaynak: '', no_dolu: false, ettn_dolu: false, faturasiz: false, no_metin: null, ettn_metin: null };
    const release = vi.fn();
    const havuz: FaturaHavuzu = {
      query: async (sql, p) => {
        gunluk.push(`havuz:${ad(sql)}`); parametreler[ad(sql)] = p;
        return { rows: sql === FATURA_OKU_SQL ? [okunan] : [] };
      },
      connect: async () => ({
        query: async (sql, p) => {
          gunluk.push(`istemci:${ad(sql)}`); parametreler[ad(sql)] = p;
          if (se.hata?.includes(ad(sql))) throw new Error(`${ad(sql)} düştü`);
          return { rows: (ad(sql) === 'EKLE' || ad(sql) === 'VAR_ETTN') && !se.satirYok ? [{ data: { ...data, ettn: E } }] : [] };
        },
        release,
      }),
    };
    return { b: { havuz, id: 'sip-1', companyId: 'K1', yayinla: () => { gunluk.push('YAYIN'); } }, gunluk, parametreler, release };
  }
  const g = { ettn: E, aynaOku: async () => [] };
  const istemciAdimlari = (gunluk: string[]) => gunluk.filter(x => x.startsWith('istemci:') || x === 'YAYIN');

  it('«ETTN ekle»: BEGIN → KİLİT ($1 kiracı, $2 anahtar) → EKLE → COMMIT, ardından YAYIN; bağlantı bir kez, hatasız bırakılır', async () => {
    const d = kur('gonderildi');
    const r = await faturaEttnEkle(d.b, g);
    expect(r.tamam).toBe(true);
    expect(istemciAdimlari(d.gunluk)).toEqual(['istemci:BEGIN', 'istemci:KILIT', 'istemci:EKLE', 'istemci:COMMIT', 'YAYIN']);
    expect(d.parametreler.KILIT).toEqual(['K1', E]);
    expect(d.gunluk).not.toContain('havuz:EKLE');   // UPDATE havuzdan (işlem dışından) koşmaz
    expect(d.release).toHaveBeenCalledTimes(1);
    expect(d.release).toHaveBeenCalledWith(undefined);
  });

  it('«Mikro\'da var» + ETTN: aynı sıra (VAR_ETTN); ETTN\'siz «Mikro\'da var» işlem AÇMAZ (eski tek deyim)', async () => {
    const d = kur('belirsiz');
    expect((await faturaSonucunuYaz(d.b, 'mikrodaVar', 'N-1', g)).tamam).toBe(true);
    expect(istemciAdimlari(d.gunluk)).toEqual(['istemci:BEGIN', 'istemci:KILIT', 'istemci:VAR_ETTN', 'istemci:COMMIT', 'YAYIN']);
    expect(d.parametreler.KILIT).toEqual(['K1', E]);
    const e = kur('belirsiz');
    await faturaSonucunuYaz(e.b, 'mikrodaVar', 'N-1');
    expect(e.gunluk.filter(x => x.startsWith('istemci:'))).toEqual([]);
    expect(e.gunluk).toContain('havuz:VAR');
  });

  it('UPDATE düşerse ROLLBACK (COMMIT yok, YAYIN yok), hata çağırana gider; geri alma da düşerse bağlantı havuzdan ATILIR', async () => {
    const d = kur('gonderildi', { hata: ['EKLE'] });
    await expect(faturaEttnEkle(d.b, g)).rejects.toThrow('EKLE düştü');
    expect(istemciAdimlari(d.gunluk)).toEqual(['istemci:BEGIN', 'istemci:KILIT', 'istemci:EKLE', 'istemci:ROLLBACK']);
    expect(d.release).toHaveBeenCalledWith(undefined);
    const k = kur('belirsiz', { hata: ['KILIT', 'ROLLBACK'] });
    await expect(faturaSonucunuYaz(k.b, 'mikrodaVar', undefined, g)).rejects.toThrow('KILIT düştü');
    expect(istemciAdimlari(k.gunluk)).toEqual(['istemci:BEGIN', 'istemci:KILIT', 'istemci:ROLLBACK']);
    expect(k.release).toHaveBeenCalledTimes(1);
    expect(k.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('UPDATE 0 satır → yine COMMIT (kilit bırakılır), YAYIN YOK', async () => {
    const d = kur('gonderildi', { satirYok: true });
    const r = await faturaEttnEkle(d.b, g);
    expect(r.tamam).toBe(false);
    expect(istemciAdimlari(d.gunluk)).toEqual(['istemci:BEGIN', 'istemci:KILIT', 'istemci:EKLE', 'istemci:COMMIT']);
  });

  it('kilit AYRI deyim: kilit metni UPDATE değil, iki UPDATE metni kilit almaz (görüntü deyim başında alınır)', () => {
    expect(FATURA_ETTN_KILIT_SQL).toMatch(/^SELECT pg_advisory_xact_lock\(hashtext\(\$1::text \|\| ':ettn:' \|\| \$2::text\)\)$/);
    for (const sql of [FATURA_ETTN_EKLE_SQL, FATURA_SONUC_VAR_ETTN_SQL]) {
      expect(sql).not.toMatch(/pg_advisory/);
      expect(sql).toMatch(/NOT EXISTS/);
    }
  });
});

describe('VAKA TABLOSU — «ETTN ekle» kapısının «geçerli ETTN var mı» kararı (siparişteki ham `ettn`): istemci bağlantı koşuluyla birebir', () => {
  // İstemci (OrdersPage «ETTN ekle» bileşeni) siparişteki `ettn` geçerli anahtar vermiyorsa bileşeni ÇİZER; uç aynı durumda yazar,
  // geçerli anahtar varsa 409 `FATURA_ETTN_VAR`. İkisi de tablonun `anahtar` sütununa karşı sınanır (pages/OrdersPage.faturaGonderimi.test).
  for (const v of ETTN_VAKALARI) {
    it(`${v.ad}: ${JSON.stringify(v.girdi)} → ${v.anahtar === '' ? 'ETTN eklenebilir' : '409 FATURA_ETTN_VAR'}`, () => {
      const isaret = { durum: 'gonderildi', istekNo: 'i', zaman: '2026-10-19T09:00:00.000Z', kim: 'k' };
      const r = ettnEkleRetKarari({
        data: { ettn: v.girdi, [FATURA_GONDERIM_ALANI]: isaret }, bayat: false, kaynak: '', noDolu: false,
        ettnDolu: v.girdi.trim() !== '', faturasiz: false, lucaGonderildi: false, noMetin: null, ettnMetin: v.girdi,
      });
      if (v.anahtar === '') expect(r).toBeNull();
      else expect([r?.durum, r?.govde.kod]).toEqual([409, 'FATURA_ETTN_VAR']);
    });
  }
});
