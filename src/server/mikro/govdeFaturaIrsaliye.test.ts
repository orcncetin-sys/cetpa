/**
 * govdeFaturaIrsaliye.test.ts — e-Fatura / e-İrsaliye gövdeleri (Faz 3 3/n, 2026-09-19).
 * ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı).
 *
 * İKİ İŞ YAPAR:
 *  1. PARİTE: bilinen girdide gövde, rotadaki ESKİ kodun ürettiğinin BİREBİR aynısı
 *     (`toEqual` ile alan alan kilitli — sabit Mikro kodları: evraktip 4/1, seri F/I,
 *     cha_evrak_tip 63, cha_cinsi 7, cha_ebelge_turu eşlemesi). Gövde tek kaynağa
 *     taşınırken sessizce bir alanın düşmesi/değişmesi burada patlar.
 *  2. VARSAYILAN YOK: eski kodun `price ?? 0`, `quantity ?? 1`, `kdvOran ?? 20`,
 *     `sth_vergi_pntr: 4` (tahmin) ve kalemsiz irsaliyede "tek satır, 0 tutar"
 *     ürettiği HER site için ayrı bir "bilinmiyorsa throw" vakası. Bunlar mutasyon
 *     ayırt edici: kapıyı `?? 0`/`|| 1`'e çevirirsen ilgili test kırılır.
 *
 * Fikstür Türkçe ve gerçekçi (Şirin İnşaat, ÇİMENTO 50KG, ₺) — hata mesajları
 * kullanıcıya bu dilde görünüyor.
 */
import { describe, it, expect } from 'vitest';
import {
  faturaGovdesi, irsaliyeGovdesi,
  type FaturaGirdisi, type IrsaliyeGirdisi,
} from './govdeFaturaIrsaliye';
import { MikroGovdeHatasi, mikroGovdeHatasiMi } from './govdeHatasi';

// ── Fikstürler ───────────────────────────────────────────────────────────────
/** Mikro VergiListesiV2'nin döndürdüğü tablo: vergiSiraNo → oran (%). */
const VERGI = new Map<number, number>([[1, 1], [2, 8], [3, 10], [4, 20]]);

/** 40 × 312,50 ₺ = 12.500 ₺ — float artığı olmayan bilerek seçilmiş sayılar. */
const CIMENTO = { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 40, price: 312.5 };
/** 2 × 1.249,50 ₺ = 2.499 ₺ */
const DEMIR   = { sku: 'DMR-12', name: 'NERVÜRLÜ DEMİR Ø12', quantity: 2, price: 1249.5 };

const SIPARIS: FaturaGirdisi = {
  mikroCariKod: 'C-0042',
  lineItems: [CIMENTO, DEMIR],
  faturaTipi: 'e-arsiv',
  kdvOran: 20,
  createdAt: '2026-09-19T12:00:00.000Z',  // TR ve UTC'de aynı gün → 19.09.2026
};

const SEVKIYAT: IrsaliyeGirdisi = {
  mikroCariKod: 'C-0042',
  customerName: 'Şirin İnşaat Ltd. Şti.',
  destination: 'Organize Sanayi 5. Cadde No:12, Kocaeli',
  trackingNo: '41 ABC 123',
  cargoFirm: 'ARAS',
  kdvOran: 20,
  items: [CIMENTO, DEMIR],
  date: '2026-09-19T12:00:00.000Z',
};

const SECENEK = { vergiTablosu: VERGI, jumpSurum: 16 };

/** Kalem/nesneden bir alanı DÜŞÜR (eksik alanı taklit et) — `undefined` atamakla aynı değil. */
const at = <T extends Record<string, unknown>>(kaynak: T, atilan: string) => {
  const { [atilan]: _yok, ...kalan } = kaynak;
  return kalan;
};

/** Hatayı yakala ve MikroGovdeHatasi olarak döndür; fırlatılmazsa testi yüksek sesle düşür. */
function yakala(fn: () => unknown): MikroGovdeHatasi {
  try { fn(); } catch (e) {
    if (mikroGovdeHatasiMi(e)) return e;
    throw e;
  }
  throw new Error('MikroGovdeHatasi bekleniyordu ama hiç fırlatılmadı (varsayılan sızdı!)');
}

// ── 1. PARİTE: fatura gövdesi ────────────────────────────────────────────────
describe('faturaGovdesi — parite', () => {
  it('bilinen girdide rotadaki eski gövdenin BİREBİR aynısını üretir (V16: cha_ebelge_turu YOK)', () => {
    const { evrak, satirlar, toplamTutar, faturaDate } = faturaGovdesi(SIPARIS, SECENEK);

    expect(faturaDate).toBe('19.09.2026');
    expect(toplamTutar).toBe(14999);
    expect(satirlar).toEqual([
      {
        sth_tarih: '19.09.2026', sth_tip: 1, sth_cins: 0, sth_normal_iade: 0,
        sth_evraktip: 4, sth_evrakno_seri: 'F',
        sth_stok_kod: 'CIM-50', sth_cari_cinsi: 0, sth_cari_kodu: 'C-0042',
        sth_miktar: 40, sth_birim_pntr: 1, sth_tutar: 12500,
        sth_vergi: 2500, sth_vergi_pntr: 4, sth_vergisiz_fl: false,
        sth_aciklama: 'ÇİMENTO 50KG',
        sth_cari_srm_merkezi: '', sth_stok_srm_merkezi: '',
        sth_subeno: 0, sth_giris_depo_no: 1, sth_cikis_depo_no: 1,
      },
      {
        sth_tarih: '19.09.2026', sth_tip: 1, sth_cins: 0, sth_normal_iade: 0,
        sth_evraktip: 4, sth_evrakno_seri: 'F',
        sth_stok_kod: 'DMR-12', sth_cari_cinsi: 0, sth_cari_kodu: 'C-0042',
        sth_miktar: 2, sth_birim_pntr: 1, sth_tutar: 2499,
        sth_vergi: 499.8, sth_vergi_pntr: 4, sth_vergisiz_fl: false,
        sth_aciklama: 'NERVÜRLÜ DEMİR Ø12',
        sth_cari_srm_merkezi: '', sth_stok_srm_merkezi: '',
        sth_subeno: 0, sth_giris_depo_no: 1, sth_cikis_depo_no: 1,
      },
    ]);
    expect(evrak).toEqual({
      cha_tip: 0, cha_cinsi: 7, cha_normal_Iade: 0, cha_evrak_tip: 63, cha_cari_cins: 0,
      cha_d_cins: 0, cha_d_kur: 1, cha_tarihi: '19.09.2026', cha_evrakno_seri: 'F',
      cha_kod: 'C-0042', cha_projekodu: '', cha_srmrkkodu: '', cha_vade: 0, cha_subeno: 0,
      cha_aciklama: '', kdv_istisna_kodu: '', detay: satirlar,
    });
    expect(evrak.detay).toBe(satirlar);  // rota satırları ayrıca aynalıyor: tek dizi
  });

  it('V17: cha_ebelge_turu e-arşivde 1, e-faturada 0, ihracatta 0 (2026-08-25 düzeltmesi korunur)', () => {
    const v17 = { ...SECENEK, jumpSurum: 17 };
    expect(faturaGovdesi({ ...SIPARIS, faturaTipi: 'e-arsiv' },  v17).evrak.cha_ebelge_turu).toBe(1);
    expect(faturaGovdesi({ ...SIPARIS, faturaTipi: 'e-fatura' }, v17).evrak.cha_ebelge_turu).toBe(0);
    expect(faturaGovdesi({ ...SIPARIS, faturaTipi: 'ihracat' },  v17).evrak.cha_ebelge_turu).toBe(0);
    // faturaTipi hiç yoksa / tanınmıyorsa belge KESİLMEZ (2026-09-19 kullanıcı kararı): eskiden sunucu e-FATURA,
    // istemci `|| 'e-arsiv'` ile e-ARŞİV varsayıyordu — aynı sipariş iki tarafta iki ayrı belge tipiydi (mutasyon-ayırt-edici).
    expect(() => faturaGovdesi({ ...SIPARIS, faturaTipi: undefined }, v17)).toThrow(/belge tipi/);
    expect(() => faturaGovdesi({ ...SIPARIS, faturaTipi: 'E-FATURA' as never }, v17)).toThrow(/belge tipi/);
  });

  it('KESİRLİ miktar: satır tutarı KURUŞA yuvarlanır ve KDV yuvarlanmış matrahtan hesaplanır (2,5 × 175,07 → 437,68 / KDV 87,54) — mutasyon-ayırt-edici', () => {
    const { satirlar, toplamTutar } = faturaGovdesi({ ...SIPARIS, lineItems: [{ sku: 'BRD-8', name: 'BORDÜR 8cm', quantity: 2.5, price: 175.07 }] }, SECENEK);
    expect(satirlar[0].sth_miktar).toBe(2.5);
    expect(satirlar[0].sth_tutar).toBe(437.68);       // ham 437.67499999999995 DEĞİL
    expect(satirlar[0].sth_vergi).toBe(87.54);        // 437,68 × %20 = 87,536 → 87,54
    expect(toplamTutar).toBe(437.68);
  });

  it('V16de cha_ebelge_turu alanı gövdede HİÇ yok (undefined değil — anahtar yok)', () => {
    const { evrak } = faturaGovdesi(SIPARIS, SECENEK);
    expect('cha_ebelge_turu' in evrak).toBe(false);
  });

  it('sth_vergi yuvarlaması eski formülle aynı: Math.round(tutar * oran) / 100', () => {
    const { satirlar } = faturaGovdesi(
      { ...SIPARIS, lineItems: [{ sku: 'X', name: 'Kırık kuruş', quantity: 3, price: 33.33 }], kdvOran: 10 },
      SECENEK,
    );
    // 3 × 33,33 = 99,99 → 99,99 × 10 = 999,9 → round = 1000 → /100 = 10
    expect(satirlar[0].sth_tutar).toBeCloseTo(99.99, 10);
    expect(satirlar[0].sth_vergi).toBe(10);
    expect(satirlar[0].sth_vergi_pntr).toBe(3);  // %10 → tablodaki sıra 3
  });

  it('createdAt yoksa belge BUGÜN kesilir (eski davranış; `simdi` yalnız test saati enjeksiyonu)', () => {
    const { faturaDate } = faturaGovdesi(
      { ...SIPARIS, createdAt: undefined },
      { ...SECENEK, simdi: new Date('2026-12-31T09:00:00.000Z') },
    );
    expect(faturaDate).toBe('31.12.2026');
  });

  it('girdiyi DEĞİŞTİRMEZ (kalem nesneleri kopyalanır)', () => {
    const kalem = { ...CIMENTO };
    faturaGovdesi({ ...SIPARIS, lineItems: [kalem] }, SECENEK);
    expect(kalem).toEqual(CIMENTO);
  });
});

// ── 2. VARSAYILAN YOK: fatura ────────────────────────────────────────────────
describe('faturaGovdesi — Mikro defterine sahte değer yazmaz', () => {
  it('birim fiyat bilinmiyorsa 0 YAZMAZ, fırlatır (eski: price ?? 0)', () => {
    const e = yakala(() => faturaGovdesi(
      { ...SIPARIS, lineItems: [CIMENTO, { ...DEMIR, price: undefined }] }, SECENEK));
    expect(e.alan).toBe('birim fiyatı');
    expect(e.satirNo).toBe(2);
    expect(e.message).toBe("Mikro'ya gönderilemedi: 2. kalemin birim fiyatı bilinmiyor");
  });

  it('fiyat sayı değilse (boş string / null / NaN) de fırlatır', () => {
    for (const bozuk of ['', null, Number.NaN, 'abc', undefined]) {
      const e = yakala(() => faturaGovdesi(
        { ...SIPARIS, lineItems: [{ ...CIMENTO, price: bozuk }] }, SECENEK));
      expect(e.alan).toBe('birim fiyatı');
    }
  });

  it('miktar bilinmiyorsa 1 YAZMAZ, fırlatır (eski: quantity ?? 1)', () => {
    const e = yakala(() => faturaGovdesi(
      { ...SIPARIS, lineItems: [{ ...CIMENTO, quantity: null }] }, SECENEK));
    expect(e.alan).toBe('miktarı');
    expect(e.satirNo).toBe(1);
  });

  it('KDV oranı bilinmiyorsa %20 VARSAYMAZ, fırlatır (eski: kdvOran ?? 20 → sth_vergi uydurma)', () => {
    const e = yakala(() => faturaGovdesi({ ...SIPARIS, kdvOran: undefined }, SECENEK));
    expect(e.alan).toBe('KDV oranı');
    expect(e.satirNo).toBeUndefined();  // belge başlığı alanı — satır uydurulmaz
  });

  it('vergi işaretçisi TAHMİN EDİLMEZ: oran Mikro tablosunda yoksa fırlatır (eski: >=20?4:>=10?3:1)', () => {
    const e = yakala(() => faturaGovdesi({ ...SIPARIS, kdvOran: 18 }, SECENEK));
    expect(e.alan).toBe('KDV vergi işaretçisi');
    expect(e.message).toMatch(/%18/);
  });

  it('vergi tablosu BOŞsa (VergiListesiV2 okunamadı) sabit 4 yazmaz, okuma arızasını söyler', () => {
    const e = yakala(() => faturaGovdesi(SIPARIS, { ...SECENEK, vergiTablosu: new Map() }));
    expect(e.alan).toBe('KDV vergi işaretçisi');
    expect(e.message).toMatch(/VergiListesiV2/);
  });

  it('cari kod boşsa boş string YAZMAZ, fırlatır (cha_kod: "" → sahipsiz evrak)', () => {
    const e = yakala(() => faturaGovdesi({ ...SIPARIS, mikroCariKod: '   ' }, SECENEK));
    expect(e.alan).toBe('cari kodu');
  });

  it('kalem yoksa boş fatura üretmez, fırlatır', () => {
    expect(yakala(() => faturaGovdesi({ ...SIPARIS, lineItems: [] }, SECENEK)).alan).toBe('fatura kalemleri');
    expect(yakala(() => faturaGovdesi({ ...SIPARIS, lineItems: undefined }, SECENEK)).alan).toBe('fatura kalemleri');
  });

  it('createdAt VAR ama çözülemiyorsa "NaN.NaN.NaN" yazmaz, fırlatır', () => {
    const e = yakala(() => faturaGovdesi({ ...SIPARIS, createdAt: 'dün' }, SECENEK));
    expect(e.alan).toBe('fatura tarihi');
  });
});

// ── 3. PARİTE: irsaliye gövdesi ──────────────────────────────────────────────
describe('irsaliyeGovdesi — parite', () => {
  it('bilinen girdide rotadaki eski gövdenin BİREBİR aynısını üretir (depo 1 verildiğinde)', () => {
    const { evrak, satirlar, irsDate } = irsaliyeGovdesi(SEVKIYAT, { vergiTablosu: VERGI, depoNo: 1 });

    expect(irsDate).toBe('19.09.2026');
    expect(satirlar).toEqual([
      {
        sth_tarih: '19.09.2026', sth_tip: 1, sth_cins: 0, sth_normal_iade: 0,
        sth_evraktip: 1, sth_evrakno_seri: 'I',
        sth_stok_kod: 'CIM-50', sth_cari_cinsi: 0, sth_cari_kodu: 'C-0042',
        sth_miktar: 40, sth_birim_pntr: 1, sth_tutar: 12500,
        sth_vergi_pntr: 4, sth_vergi: 0, sth_vergisiz_fl: false,
        sth_iskonto1: 0, sth_iskonto2: 0,
        sth_aciklama: 'ÇİMENTO 50KG',
        sth_giris_depo_no: 1, sth_cikis_depo_no: 1, sth_subeno: 0,
        sth_malkbl_sevk_tarihi: '19.09.2026',
      },
      {
        sth_tarih: '19.09.2026', sth_tip: 1, sth_cins: 0, sth_normal_iade: 0,
        sth_evraktip: 1, sth_evrakno_seri: 'I',
        sth_stok_kod: 'DMR-12', sth_cari_cinsi: 0, sth_cari_kodu: 'C-0042',
        sth_miktar: 2, sth_birim_pntr: 1, sth_tutar: 2499,
        sth_vergi_pntr: 4, sth_vergi: 0, sth_vergisiz_fl: false,
        sth_iskonto1: 0, sth_iskonto2: 0,
        sth_aciklama: 'NERVÜRLÜ DEMİR Ø12',
        sth_giris_depo_no: 1, sth_cikis_depo_no: 1, sth_subeno: 0,
        sth_malkbl_sevk_tarihi: '19.09.2026',
      },
    ]);
    expect(evrak).toEqual({
      evrak_aciklamalari: [{ aciklama: 'Organize Sanayi 5. Cadde No:12, Kocaeli' }],
      e_irsaliye_detaylari: {
        eir_tasiyici_firma_kodu: 'ARAS',
        eir_tasiyici_arac_plaka: '41 ABC 123',
        eir_eirs_olrk_gonderilsin: 0,
      },
      satirlar,
    });
  });

  it('adres/kargo/plaka yoksa boş string (eski davranış — bunlar metin alanı, para değil)', () => {
    const { evrak } = irsaliyeGovdesi(
      { ...SEVKIYAT, destination: undefined, cargoFirm: undefined, trackingNo: undefined },
      { vergiTablosu: VERGI, depoNo: 2 },
    );
    expect(evrak.evrak_aciklamalari).toEqual([{ aciklama: '' }]);
    expect(evrak.e_irsaliye_detaylari.eir_tasiyici_firma_kodu).toBe('');
    expect(evrak.e_irsaliye_detaylari.eir_tasiyici_arac_plaka).toBe('');
  });

  it('depo numarası satırlara AYNEN yazılır (sabit 1 değil)', () => {
    const { satirlar } = irsaliyeGovdesi(SEVKIYAT, { vergiTablosu: VERGI, depoNo: 2 });
    expect(satirlar.every(s => s.sth_giris_depo_no === 2 && s.sth_cikis_depo_no === 2)).toBe(true);
  });

  it('depo seçenekte yoksa sevkiyat kaydından okunur', () => {
    const { satirlar } = irsaliyeGovdesi({ ...SEVKIYAT, depoNo: 3 }, { vergiTablosu: VERGI });
    expect(satirlar[0].sth_cikis_depo_no).toBe(3);
  });
});

// ── 4. VARSAYILAN YOK: irsaliye ──────────────────────────────────────────────
describe('irsaliyeGovdesi — Mikro defterine sahte değer yazmaz', () => {
  it('DEPO BİLİNMİYORSA depo 1 (HAVALİMANI) VARSAYMAZ, fırlatır (2026-09-05 arıza sınıfı)', () => {
    const e = yakala(() => irsaliyeGovdesi(SEVKIYAT, { vergiTablosu: VERGI }));
    expect(e.alan).toBe('depo numarası');
    expect(e.satirNo).toBeUndefined();
  });

  it('depo 0 / negatif / sayı değilse de fırlatır (depoGerekli sözleşmesi)', () => {
    for (const bozuk of [0, -1, '', 'depo', null, Number.NaN]) {
      expect(yakala(() => irsaliyeGovdesi(SEVKIYAT, { vergiTablosu: VERGI, depoNo: bozuk })).alan)
        .toBe('depo numarası');
    }
  });

  it('KALEMSİZ sevkiyatta tek satırlık 0 tutarlı SAHTE belge üretmez, fırlatır', () => {
    expect(yakala(() => irsaliyeGovdesi({ ...SEVKIYAT, items: [] }, { vergiTablosu: VERGI, depoNo: 1 })).alan)
      .toBe('sevkiyat kalemleri');
    expect(yakala(() => irsaliyeGovdesi({ ...SEVKIYAT, items: undefined }, { vergiTablosu: VERGI, depoNo: 1 })).alan)
      .toBe('sevkiyat kalemleri');
  });

  it('kalem fiyatı bilinmiyorsa sth_tutar 0 YAZMAZ, fırlatır (şema price optional — burası son kapı)', () => {
    const e = yakala(() => irsaliyeGovdesi(
      { ...SEVKIYAT, items: [CIMENTO, { ...DEMIR, price: undefined }] },
      { vergiTablosu: VERGI, depoNo: 1 },
    ));
    expect(e.alan).toBe('birim fiyatı');
    expect(e.satirNo).toBe(2);
  });

  it('kalem miktarı bilinmiyorsa 1 YAZMAZ, fırlatır', () => {
    const e = yakala(() => irsaliyeGovdesi(
      { ...SEVKIYAT, items: [{ ...CIMENTO, quantity: undefined }] },
      { vergiTablosu: VERGI, depoNo: 1 },
    ));
    expect(e.alan).toBe('miktarı');
  });

  it('vergi işaretçisi sabit 4 DEĞİL: oran yoksa/çözülemezse fırlatır', () => {
    expect(yakala(() => irsaliyeGovdesi({ ...SEVKIYAT, kdvOran: undefined }, { vergiTablosu: VERGI, depoNo: 1 })).alan)
      .toBe('KDV oranı');
    expect(yakala(() => irsaliyeGovdesi({ ...SEVKIYAT, kdvOran: 18 }, { vergiTablosu: VERGI, depoNo: 1 })).alan)
      .toBe('KDV vergi işaretçisi');
  });

  it('cari kod boşsa fırlatır', () => {
    expect(yakala(() => irsaliyeGovdesi({ ...SEVKIYAT, mikroCariKod: '' }, { vergiTablosu: VERGI, depoNo: 1 })).alan)
      .toBe('cari kodu');
  });

  it('date VAR ama çözülemiyorsa fırlatır', () => {
    expect(yakala(() => irsaliyeGovdesi({ ...SEVKIYAT, date: 'geçen hafta' }, { vergiTablosu: VERGI, depoNo: 1 })).alan)
      .toBe('irsaliye tarihi');
  });

  it('TR biçimli tarih (19.09.2026) doğru okunur — eski `new Date(str)` bunu Invalid Date yapıyordu', () => {
    expect(irsaliyeGovdesi({ ...SEVKIYAT, date: '19.09.2026' }, { vergiTablosu: VERGI, depoNo: 1 }).irsDate)
      .toBe('19.09.2026');
  });
});

// ── 5. Vergi işaretçisi: ters aramanın kendi vakaları TEK KAYNAKTA ───────────
// (vergiIsaretci.test.ts — yuvarlama yok, boş tablo, en küçük sıra, tolerans sınırı).
// Burada yalnız bu iki gövdenin o kaynağa bağlı olduğu kilitli.
describe('fatura/irsaliye — vergi işaretçisi tek kaynaktan (vergiIsaretci.ts)', () => {
  it('kayan nokta gürültüsü (%20 = 19,9999999) faturada eşleşir — 1e-9 kopyası 400 veriyordu', () => {
    const { satirlar } = faturaGovdesi(SIPARIS, { ...SECENEK, vergiTablosu: new Map([[4, 19.9999999]]) });
    expect(satirlar[0].sth_vergi_pntr).toBe(4);
  });

  it('aynı gürültü irsaliyede de eşleşir (iki yüzey aynı toleransta)', () => {
    const { satirlar } = irsaliyeGovdesi(SEVKIYAT, { vergiTablosu: new Map([[4, 19.9999999]]), depoNo: 2 });
    expect(satirlar[0].sth_vergi_pntr).toBe(4);
  });

  it('gerçekten farklı oran (%19,99) hâlâ reddedilir — tolerans yuvarlama değildir', () => {
    expect(() => faturaGovdesi(SIPARIS, { ...SECENEK, vergiTablosu: new Map([[4, 19.99]]) }))
      .toThrow(/vergi işaretçisi bilinmiyor/);
  });
});

// ── 6. Stok kodu: kimlik alanı, boş geçilmez ─────────────────────────────────
describe('sth_stok_kod — boş stok kodu Mikro defterine SAHİPSİZ hareket yazardı', () => {
  it('fatura kaleminde sku yoksa 400 (eski: sth_stok_kod: "")', () => {
    const e = yakala(() => faturaGovdesi({ ...SIPARIS, lineItems: [CIMENTO, at(DEMIR, 'sku')] }, SECENEK));
    expect(e.alan).toBe('stok kodu');
    expect(e.satirNo, 'kullanıcı satırı 1\'den sayar').toBe(2);
  });

  it('fatura kaleminde sku boş/boşluk ise 400', () => {
    expect(() => faturaGovdesi({ ...SIPARIS, lineItems: [{ ...CIMENTO, sku: '   ' }] }, SECENEK))
      .toThrow(/1\. kalemin stok kodu bilinmiyor/);
  });

  it('irsaliye kaleminde sku yoksa 400 — kardeş gövde (siparis) da aynı kapıyı kuruyor', () => {
    const e = yakala(() => irsaliyeGovdesi(
      { ...SEVKIYAT, items: [at(CIMENTO, 'sku')] },
      { vergiTablosu: VERGI, depoNo: 2 },
    ));
    expect(e.alan).toBe('stok kodu');
    expect(e.satirNo).toBe(1);
  });

  it('stok kodu kırpılır ama bilinen kod AYNEN gider (parite)', () => {
    const { satirlar } = faturaGovdesi({ ...SIPARIS, lineItems: [{ ...CIMENTO, sku: ' CIM-50 ' }] }, SECENEK);
    expect(satirlar[0].sth_stok_kod).toBe('CIM-50');
  });
});
