/**
 * mikroRoutes.govdeMuhasebe.test.ts — üç muhasebe rotasının gövde modülüne
 * BAĞLANMASI (Faz 3 3/n, grup "govdeMuhasebe", 2026-09-19).
 *
 * Modül testi (`src/server/mikro/govdeMuhasebe.test.ts`, 30 test) gövdenin İÇERİĞİNİ
 * kilitler. Burada kilitlenen şey ROTA SÖZLEŞMESİ:
 *   1) Tek-belge rotalarında (`/tahsilat/kaydet`, `/cari-hareket/kaydet`) gövde
 *      kurulamazsa yanıt **400** ve `mikroPost` **HİÇ** çağrılmaz — yarım kayıt yerine
 *      hiç kayıt. 500 değil: eksik olan sunucu değil, GÖNDERİLEN VERİ.
 *   2) Başarısız denemenin izi `writeSyncLog`'a düşer. (TahsilatModule bu çağrıyı
 *      `.catch(() => {})` ile yutuyor — syncLog dışında iz kalmıyor.)
 *   3) Batch rotası (`/yevmiye/kaydet`) KENDİ sözleşmesini korur: 200 + syncedIds/errors.
 *      Bozuk fiş `errors[]`'a düşer, sağlam fişler aktarılmaya DEVAM eder; bozuk fiş için
 *      `mikroPost` yine hiç çağrılmaz. Tek bozuk fiş 50 fişlik aktarımı bloklamaz.
 *   4) Bilinen girdide `mikroPost` ESKİ gövdeyle çağrılır (parite) ve ayna tablosuna
 *      AYNI satırlar yazılır — ikinci kez elle kurulan kopya kalktı.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost } from '../mikroClient.js';
import { mirrorMikroInsert } from '../mikroMirror.js';

// ── mikroMockTarifi (mikroRoutes.testDuzenegi.ts) — vitest hoisting yüzünden BURADA olmalı
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
    // Map — düz nesne DEĞİL: gerçek fonksiyon ağ hatasında da BOŞ MAP döner
    // (mikroClient.ts). `{}` fatura/sipariş gövdelerinde TypeError → 500 üretiyordu.
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});

let d: Duzenek;
beforeEach(() => {
  d = duzenekKur();
  vi.mocked(mikroPost).mockReset();
  vi.mocked(mirrorMikroInsert).mockClear();
});

/** Mikro'nun BAŞARILI zarfı: `result[0]` var ve `IsError` yok (rota bunu şart koşuyor). */
const basariliYanit = () =>
  vi.mocked(mikroPost).mockImplementation((async () => ({
    ok: true, status: 200, data: { result: [{ IsError: false }] },
  })) as unknown as typeof mikroPost);

const hata = (res: { govde: unknown }) => String((res.govde as { error?: string }).error);

// ═══ 1. POST /api/mikro/tahsilat/kaydet ══════════════════════════════════════

const TAHSILAT = {
  cariKod: '120-SIRIN',
  tutar: 45000,
  tarih: '2026-09-19',
  aciklama: 'Şirin İnşaat — ÇİMENTO 50KG bakiye tahsilatı',
  tip: 'tahsilat',
};
const tahsilatGonder = (t: Record<string, unknown>) =>
  d.cagir('POST', '/api/mikro/tahsilat/kaydet', { tahsilat: t });
const tahsilatAt = (atilan: string) => {
  const { [atilan]: _yok, ...kalan } = TAHSILAT as Record<string, unknown>;
  return kalan;
};

describe('POST /api/mikro/tahsilat/kaydet — gövde kurulamazsa Mikro’ya GİDİLMEZ', () => {
  it('yön bilinmiyorsa 400 ve mikroPost HİÇ çağrılmaz (eskiden sessizce TAHSİLAT sayılıyordu)', async () => {
    basariliYanit();   // mikroPost başarılı olsa BİLE çağrılmamalı
    const res = await tahsilatGonder(tahsilatAt('tip'));

    expect(res.kod).toBe(400);
    expect(res.govde).toMatchObject({ success: false });
    expect(hata(res)).toContain('tahsilat/tediye yönü bilinmiyor');
    expect(mikroPost, 'para çıkışı giriş olarak defterlenmemeli').not.toHaveBeenCalled();
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });

  it("yazım hatalı yön ('TEDIYE') de reddedilir — eski `tip === 'tediye' ? … : 'tahsilat'` kapandı", async () => {
    basariliYanit();
    const res = await tahsilatGonder({ ...TAHSILAT, tip: 'TEDIYE' });

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('tanınmayan yön: TEDIYE');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('tarih yoksa 400 — BUGÜN varsayılmaz (geçmiş tahsilat yanlış KDV dönemine düşerdi)', async () => {
    basariliYanit();
    const res = await tahsilatGonder(tahsilatAt('tarih'));

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('tahsilat tarihi bilinmiyor');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it("tutar sayı değilse 400 — eski `Number('abc')` Mikro JSON'una null yazıyordu", async () => {
    basariliYanit();
    const res = await tahsilatGonder({ ...TAHSILAT, tutar: 'kırk beş bin' });

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('tahsilat tutarı bilinmiyor');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('TRY dışı para birimi 400 — sabit `cha_d_kur: 1` ile EUR tahsilat TRY gibi defterlenmez', async () => {
    basariliYanit();
    const res = await tahsilatGonder({ ...TAHSILAT, paraBirimi: 'EUR' });

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('döviz cinsi');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('başarısız denemenin writeSyncLog kaydı 400’den ÖNCE düşer (istemci hatayı yutuyor)', async () => {
    basariliYanit();
    await tahsilatGonder(tahsilatAt('tip'));

    expect(d.syncLog).toHaveBeenCalledWith(
      'TahsilatTediyeKaydetV2', 'payment', '120-SIRIN', false, null,
      expect.stringContaining('yönü bilinmiyor'), expect.any(Number), expect.anything(),
    );
  });

  it('gövde HİÇ yoksa rotanın kendi ön kontrolü: 400, syncLog yazılmaz', async () => {
    basariliYanit();
    const res = await d.cagir('POST', '/api/mikro/tahsilat/kaydet', {});

    expect(res.kod).toBe(400);
    expect(hata(res)).toBe('tahsilat alanı zorunlu.');
    expect(mikroPost).not.toHaveBeenCalled();
    expect(d.syncLog).not.toHaveBeenCalled();
  });
});

describe('POST /api/mikro/tahsilat/kaydet — bilinen tahsilat: eski gövdeyle BİREBİR', () => {
  const SATIR = {
    cha_tarihi: '19.09.2026',
    cha_tip: 1,
    cha_cinsi: 19,
    cha_normal_Iade: 0,
    cha_evrak_tip: 34,
    cha_evrakno_seri: 'KSTAH',
    cha_cari_cins: 0,
    cha_kod: '120-SIRIN',
    cha_d_cins: 0, cha_d_kur: 1, cha_d_kurtar: null,
    cha_srmrkkodu: '', cha_projekodu: '',
    cha_kasa_hizmet: 4,
    cha_meblag: 45000,
    cha_aciklama: TAHSILAT.aciklama,
  };

  it('mikroPost(TahsilatTediyeKaydetV2, { evraklar: [{ … }] }, true) — alan adları/sıra/sabitler aynı', async () => {
    basariliYanit();
    const res = await tahsilatGonder(TAHSILAT);

    expect(res.kod).toBe(200);
    expect(res.govde).toMatchObject({ success: true, error: null });
    expect(mikroPost).toHaveBeenCalledTimes(1);
    expect(mikroPost).toHaveBeenCalledWith('TahsilatTediyeKaydetV2', {
      evraklar: [{ evrak_aciklamalari: [{ aciklama: TAHSILAT.aciklama }], satirlar: [SATIR] }],
    }, true);
  });

  it('ayna satırı `__kaynak: tahsilat_push` ile yazılır; syncLog doğrulanmış cari kodunu taşır', async () => {
    basariliYanit();
    await tahsilatGonder(TAHSILAT);

    expect(mirrorMikroInsert).toHaveBeenCalledWith(
      'mikro_cari_hesap_hareketleri', [{ ...SATIR, __kaynak: 'tahsilat_push' }], expect.anything(),
    );
    expect(d.syncLog).toHaveBeenCalledWith(
      'TahsilatTediyeKaydetV2', 'payment', '120-SIRIN', true, null, null, expect.any(Number), expect.anything(),
    );
  });

  it('Mikro reddederse (IsError) 200/success:false — bu 400 DEĞİLDİR, gövde kurulmuştu', async () => {
    vi.mocked(mikroPost).mockImplementation((async () => ({
      ok: true, status: 200, data: { result: [{ IsError: true, ErrorMessage: 'Kasa kapalı' }] },
    })) as unknown as typeof mikroPost);
    const res = await tahsilatGonder(TAHSILAT);

    expect(res.kod).toBe(200);
    expect(res.govde).toMatchObject({ success: false, error: 'Kasa kapalı' });
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });
});

// ═══ 2. POST /api/mikro/yevmiye/kaydet (BATCH) ═══════════════════════════════

const FIS = {
  id: 'iyi',
  date: '2026-09-19',
  'fiş': 'SIP-10421',
  aciklama: 'Şirin İnşaat - Faturalı Satış (ÇİMENTO 50KG)',
  debitHesap: '120 - Alıcılar',
  alacakHesap: '600 - Yurt İçi Satışlar',
  borc: 45000,
  alacak: 45000,
};
const yevmiyeGonder = (entries: Record<string, unknown>[]) =>
  d.cagir('POST', '/api/mikro/yevmiye/kaydet', { entries });

describe('POST /api/mikro/yevmiye/kaydet — batch sözleşmesi korunur (200 + syncedIds/errors)', () => {
  it('bozuk fiş errors[]’a düşer, sağlam fiş aktarılır — tek bozuk fiş aktarımı bloklamaz', async () => {
    basariliYanit();
    const res = await yevmiyeGonder([
      FIS,
      { ...FIS, id: 'kotu', debitHesap: '' },
    ]);

    expect(res.kod).toBe(200);
    expect(res.govde).toMatchObject({ success: false, syncedIds: ['iyi'] });
    expect((res.govde as { errors: { id: string; error: string }[] }).errors).toEqual([
      { id: 'kotu', error: "Mikro'ya gönderilemedi: 2. kalemin borç hesap kodu bilinmiyor" },
    ]);
    expect(mikroPost, 'bozuk fiş için mikroPost çağrılmamalı').toHaveBeenCalledTimes(1);
  });

  it('boş bırakılan tutar 400 değil errors[] — eski `?? 0` Mikro’ya ₺0 fiş yazıyordu', async () => {
    basariliYanit();
    const res = await yevmiyeGonder([{ ...FIS, id: 'bos', borc: '', alacak: '' }]);

    expect(res.kod).toBe(200);
    expect(res.govde).toMatchObject({ syncedIds: [] });
    expect((res.govde as { errors: { error: string }[] }).errors[0].error).toContain('fiş tutarı bilinmiyor');
    expect(mikroPost).not.toHaveBeenCalled();
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });

  it("hesap kodu boşsa 100 KASA'ya DÜŞMEZ (eski `|| '100'` hayalet kasa hareketi yazıyordu)", async () => {
    basariliYanit();
    await yevmiyeGonder([{ ...FIS, alacakHesap: '   ' }]);

    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('tarihsiz fiş "undefined.undefined." ile gitmez', async () => {
    basariliYanit();
    const res = await yevmiyeGonder([{ ...FIS, date: undefined }]);

    expect((res.govde as { errors: { error: string }[] }).errors[0].error).toContain('fiş tarihi bilinmiyor');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('dengesiz fiş (borç ≠ alacak) sessizce borç seçilerek gönderilmez', async () => {
    basariliYanit();
    const res = await yevmiyeGonder([{ ...FIS, borc: 45000, alacak: 30000 }]);

    expect((res.govde as { errors: { error: string }[] }).errors[0].error).toContain('dengesiz fiş');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('bilinen fiş: mikroPost eski gövdeyle çağrılır ve ayna AYNI diziyi yazar (kopya değil)', async () => {
    basariliYanit();
    const res = await yevmiyeGonder([FIS]);

    const TABAN = {
      fis_firmano: 0, fis_subeno: 0,
      fis_tarih: '19.09.2026',
      fis_tur: 0,
      fis_sorumluluk_kodu: '', fis_ticari_tip: 0, fis_kurfarkifl: 0,
      fis_ticari_evraktip: 0, fis_tic_belgeno: 'SIP-10421',
      fis_tic_belgetarihi: '19.09.2026',
      fis_katagori: 0, fis_fmahsup_tipi: 0, user_tablo: [],
    };
    expect(res.govde).toMatchObject({ success: true, syncedIds: ['iyi'], errors: [] });
    expect(mikroPost).toHaveBeenCalledWith('MuhasebeFisKaydetV2', {
      evraklar: [{
        evrak_aciklamalari: [{ aciklama: FIS.aciklama }],
        satirlar: [
          { ...TABAN, fis_hesap_kod: '120', fis_aciklama1: FIS.aciklama, fis_meblag0:  45000 },
          { ...TABAN, fis_hesap_kod: '600', fis_aciklama1: FIS.aciklama, fis_meblag0: -45000 },
        ],
      }],
    }, true);

    const govde = vi.mocked(mikroPost).mock.calls[0][1] as { evraklar: [{ satirlar: unknown[] }] };
    const aynaCagrisi = vi.mocked(mirrorMikroInsert).mock.calls[0];
    expect(aynaCagrisi[0]).toBe('mikro_muhasebe_fisleri');
    expect(aynaCagrisi[1], 'ayna ikinci kez elle kurulmamalı — gövdenin TA KENDİSİ').toBe(govde.evraklar[0].satirlar);
  });

  it('hata mesajı SATIR NUMARASI taşır — kullanıcı hangi fişi düzelteceğini bilir', async () => {
    basariliYanit();
    const res = await yevmiyeGonder([FIS, FIS, { ...FIS, id: 'ucuncu', date: '2026-02-30' }]);

    expect((res.govde as { errors: { error: string }[] }).errors[0].error).toMatch(/3\. kalemin/);
  });
});

// ═══ 3. POST /api/mikro/cari-hareket/kaydet ══════════════════════════════════

/** İstemcideki `dekontPayload` (src/services/mikroEvrak.ts) ne üretiyorsa o — TR tarih dahil. */
const DEKONT = {
  cha_tarihi: '19.09.2026',
  cha_tip: 0,
  cha_normal_Iade: 0,
  cha_evrak_tip: 29,
  cha_evrakno_seri: 'CTP',
  cha_cari_cins: 0,
  cha_kod: '120-SIRIN',
  cha_d_kurtar: null, cha_d_cins: 0, cha_d_kur: 1,
  cha_srmrkkodu: '', cha_projekodu: '',
  cha_kasa_hizmet: 0, cha_kasa_hizkod: '',
  cha_meblag: 12500,
};
const dekontGonder = (hareket: Record<string, unknown>, aciklama?: string) =>
  d.cagir('POST', '/api/mikro/cari-hareket/kaydet', { hareket, aciklama });

describe('POST /api/mikro/cari-hareket/kaydet — zorunlu beşli denetimi', () => {
  it('cari kodsuz dekont 400 — eskiden ham `hareket` doğrulanmadan Mikro’ya iletiliyordu', async () => {
    basariliYanit();
    const res = await dekontGonder({ ...DEKONT, cha_kod: '' });

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('cari kodu bilinmiyor');
    expect(mikroPost).not.toHaveBeenCalled();
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });

  it('yön (cha_tip) yoksa 400; 0 falsy diye REDDEDİLMEZ (bayrak testi)', async () => {
    basariliYanit();
    const yonsuz = await dekontGonder({ ...DEKONT, cha_tip: undefined });
    expect(yonsuz.kod).toBe(400);
    expect(hata(yonsuz)).toContain('borç/alacak yönü bilinmiyor');

    vi.mocked(mikroPost).mockClear();
    const borc = await dekontGonder({ ...DEKONT, cha_tip: 0 });
    expect(borc.kod).toBe(200);
    expect(mikroPost).toHaveBeenCalledTimes(1);
  });

  it('gövde hatasının syncLog izi düşer ve 400 döner (500 DEĞİL)', async () => {
    basariliYanit();
    const res = await dekontGonder({ ...DEKONT, cha_meblag: 0 });

    expect(res.kod).toBe(400);
    expect(d.syncLog).toHaveBeenCalledWith(
      'DekontKaydetV2', 'payment', '120-SIRIN', false, null,
      expect.stringContaining('hareket tutarı'), expect.any(Number), expect.anything(),
    );
  });

  it('hareket HİÇ yoksa rotanın kendi ön kontrolü korunur', async () => {
    basariliYanit();
    const res = await d.cagir('POST', '/api/mikro/cari-hareket/kaydet', {});

    expect(res.kod).toBe(400);
    expect(hata(res)).toBe('hareket alanı zorunlu.');
    expect(d.syncLog).not.toHaveBeenCalled();
  });

  it('bilinen dekont: ek alanlar AYNEN geçer, zarf ve açıklama eskisiyle birebir', async () => {
    basariliYanit();
    const res = await dekontGonder({ ...DEKONT, cha_ozel_kod: 'PROJE-A' }, 'Eylül ayı fiyat farkı dekontu');

    expect(res.kod).toBe(200);
    expect(mikroPost).toHaveBeenCalledWith('DekontKaydetV2', {
      evraklar: [{
        satirlar: [{ ...DEKONT, cha_ozel_kod: 'PROJE-A' }],
        evrak_aciklamalari: [{ aciklama: 'Eylül ayı fiyat farkı dekontu' }],
      }],
    }, true);
    expect(mirrorMikroInsert).toHaveBeenCalledWith(
      'mikro_cari_hesap_hareketleri',
      [{ ...DEKONT, cha_ozel_kod: 'PROJE-A', __kaynak: 'hareket_push' }],
      expect.anything(),
    );
  });

  it('açıklama verilmezse `evrak_aciklamalari` anahtarı HİÇ eklenmez (eski koşullu spread)', async () => {
    basariliYanit();
    await dekontGonder(DEKONT);

    expect(mikroPost).toHaveBeenCalledWith('DekontKaydetV2', { evraklar: [{ satirlar: [DEKONT] }] }, true);
  });
});
