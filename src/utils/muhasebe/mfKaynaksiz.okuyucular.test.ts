/**
 * mfKaynaksiz.okuyucular.test.ts: kaynaksız MF (Mikro'da aynı numarada satış faturası olmayan MF siparişi; sunucu işareti
 * `mfKaynaksiz`) ciro ve KDV okuyucularında SİPARİŞ TARAFINDAN sayılmaz (şartname «Mikro bağlantı B» B2 § 4.3, BH8 / BH13 / BH15 /
 * BH16; T-B2-5a … T-B2-5l, T-B2-6; MB1 hakem bulguları 0–2 ve okuyucu sayımı (4): T-B2-5m Bütçe, T-B2-5n P557, T-B2-5o pano; MB2 hakem
 * bulguları 0 ve 2: T-B2-5p Pano P130 / P42, T-B2-5o pencere sayaçları). Her okuyucu kendi testini alır; girdide bir İŞARETLİ MF (325) ve bir İŞARETSİZ ikizsiz MF (400)
 * vardır: işaretli toplamda yok, not / sayaç adedi 1; işaretsiz bugünkü gibi sayılır (QH2-1 korunur).
 *
 * Mutasyonlar (yapılıp geri alındı, raporda): kapı YALNIZ o dosyadan kaldırılır → YALNIZ o dosyanın `describe`'ı kırmızı (öteki
 * okuyucular kendi kapısını taşıdığı için yeşil kalır). Bileşen okuyucuları (rozet #9, Genel P189 #7) kendi render testlerinde;
 * Raporlar #3 kapısı sayfa bileşeninde (kaynak çiti `src/test/mfKaynaksizKapisi.cit.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { MF_KAYNAGI } from '../../lib/mfKaynagi';
import { satisYerelListesi, satisCiftSayimOzeti, type SatisSiparisi } from './satislar';
import { finansSiparisSayaclari } from './mikroCiro';
import { ayKdvOnerisi } from './vergiTakvimiKdv';
import { kdvBorcu } from './nakitBilanco';
import { kdvAylikOzet } from './kdvAylik';
import { satisTahmini, karMerkezleri, karMerkeziKaynaksizDisi } from './faturaTakipTahmin';
import { mfKaynaksizNotu, mfKaynaksizSay, mfKaynaksizBirlestir } from './faturasizDisi';
import { mikroFaturaDurumMetni, faturaKesilebilir, mikroyaFaturaGonderilebilir, siparisFaturaVar, faturaTakipFaturaVar } from '../siparisler/faturaDurumu';
import { faturaTakipSiparisleri } from './faturalar';
import { faturaTipiHucresi } from '../export';
import { panoCirosu, mfIkiziListede, mfYerelDisi } from '../pano/mikroBirlesim';
import { cetpaCiro } from './finansalOranlar';
import { ayKarZarar } from './karZarar';
import { butceGercekOzeti } from './butceGercek';
import { ciroTemeli } from './babsKdvAnaliz';
import { donemCirosu, ayCirosu, haftalikCiro } from '../pano/hedefButce';
import { enIyiMusteriler, segmentCirosu, segmentKarliligi, odemeDavranisi, b2bSegmenti } from '../pano/musteriAnaliz';
import { aylikCiroDegisimi, nakitPozisyonu, ortalamaSiparisTutari, finansKpilari } from '../pano/finansKpi';
import { panoEnCokSatanlar } from '../pano/stokSevkiyat';
import { satirCirosu } from '../siparisler/siparisKarlilik';
import { gunAnahtari } from '../zaman';
import type { SiparisKarlilik } from '../siparisler/siparisKarlilik';

const BU_AY = new Date();
const TARIH = new Date(BU_AY.getFullYear(), BU_AY.getMonth(), 10, 12).toISOString();
const AY = TARIH.slice(0, 7);
/** MF siparişi: Mikro fatura 325 / 400 numarasından türedi; tutar 1.200 (KDV dâhil), KDV 200, net 1.000. */
const mf = (sira: number, ek: Record<string, unknown> = {}) => ({
  id: `mikrofat__A__-${sira}`, source: MF_KAYNAGI, mikroEvrak: { seri: '', sira: String(sira) }, mikroFaturaNo: String(sira),
  status: 'Delivered', faturali: true, hasInvoice: false, totalPrice: 1200, kdvTutari: 200, kdvHaricTutar: 1000, kdvOran: 20,
  createdAt: TARIH, customerType: 'B2B', lineItems: [{ costPrice: 500, quantity: 1 }], ...ek,
});
const ISARETLI = mf(325, { mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-06T00:20:00.000Z' });
const ISARETSIZ = mf(400);
const YEREL = { id: 'ord-1', status: 'Delivered', faturali: true, hasInvoice: true, totalPrice: 600, kdvTutari: 100, kdvHaricTutar: 500, kdvOran: 20, createdAt: TARIH, customerType: 'B2B', lineItems: [{ costPrice: 300, quantity: 1 }] };
const GIRDI = [ISARETLI, ISARETSIZ, YEREL];

describe('yüklem + not (lib/mfKaynagi, faturasizDisi)', () => {
  it('mfYerelDisi: ikizli ∨ işaretli; işaretsiz ikizsiz MF DÜŞMEZ (QH2-1); mfIkiziListede değişmez', () => {
    expect([mfYerelDisi(ISARETLI, new Set()), mfYerelDisi(ISARETSIZ, new Set()), mfYerelDisi(ISARETSIZ, new Set(['400']))]).toEqual([true, false, true]);
    expect(mfIkiziListede(ISARETLI, new Set())).toBe(false);
    // Alan yoksa / `true` değilse / MF değilse kaynaksız SAYILMAZ (eski fikstür bugünkü sonucu verir).
    expect([mfYerelDisi(mf(1, { mfKaynaksiz: 'true' }), new Set()), mfYerelDisi({ ...YEREL, mfKaynaksiz: true }, new Set())]).toEqual([false, false]);
  });
  it('mfKaynaksizSay / mfKaynaksizNotu: tutarı okunamayan kayıt 0 sayılmaz; adet 0 → null', () => {
    const d = mfKaynaksizSay([ISARETLI, ISARETSIZ, YEREL, mf(326, { mfKaynaksiz: true, totalPrice: null })]);
    expect(d).toEqual({ adet: 2, tutar: { toplam: 1200, bilinen: 1, bilinmeyen: 1 } });
    expect(mfKaynaksizNotu(d, 'tr')).toBe("₺1.200,00 Mikro'da satış faturası olmayan MF siparişi dâhil değil · 2 kayıt · 1 kayıt tutarsız");
    expect(mfKaynaksizNotu({ adet: 1, tutar: { toplam: 1200, bilinen: 1, bilinmeyen: 0 } }, 'en')).toBe('₺1.200,00 MF orders without a Mikro sales invoice not included · 1 record');
    expect(mfKaynaksizNotu(mfKaynaksizSay([ISARETSIZ, YEREL]), 'tr')).toBeNull();
  });
  it('mfKaynaksizBirlestir: ayrık pencerelerin adedi ve tutarı (bilinmeyen dâhil) toplanır; boş → adet 0', () => {
    const a = mfKaynaksizSay([ISARETLI]), b = mfKaynaksizSay([mf(326, { mfKaynaksiz: true, totalPrice: null })]);
    expect(mfKaynaksizBirlestir(a, b)).toEqual({ adet: 2, tutar: { toplam: 1200, bilinen: 1, bilinmeyen: 1 } });
    expect(mfKaynaksizBirlestir()).toEqual({ adet: 0, tutar: { toplam: 0, bilinen: 0, bilinmeyen: 0 } });
  });
});

describe('T-B2-5a · Satışlar (satislar.satisYerelListesi + satisCiftSayimOzeti, #1 / BH8)', () => {
  const liste = GIRDI as unknown as SatisSiparisi[];
  it('«Tümü»: işaretli MF yerel listeden düşer, işaretsiz ikizsiz MF KALIR; «Cetpa»da da işaretli düşer', () => {
    expect(satisYerelListesi(liste, { mikroDahil: true, ikizAnahtarlari: new Set() }).map(o => o.totalPrice)).toEqual([1200, 600]);
    expect(satisYerelListesi(liste, { mikroDahil: false, ikizAnahtarlari: new Set() })).toHaveLength(2);
  });
  it('ayrık sayaçlar: kaynaksız 1 / ₺1.200; ikizsiz 1 (işaretsiz); QH4-1: eskiCiro − yeniCiro = eslesen + kaynaksiz', () => {
    const o = satisCiftSayimOzeti(liste, new Set());
    expect([o.eslesenAdet, o.ikizsizMfAdet, o.kaynaksizAdet]).toEqual([0, 1, 1]);
    expect(o.kaynaksizTutar).toEqual({ toplam: 1200, bilinen: 1, bilinmeyen: 0 });
  });
  it('BH8: işaretli VE ikizli sipariş TEK dışlama, yalnız «eşleşen» sayacında (kaynaksız 0)', () => {
    const o = satisCiftSayimOzeti(liste, new Set(['325']));
    expect([o.eslesenAdet, o.kaynaksizAdet, o.ikizsizMfAdet]).toEqual([1, 0, 1]);
    expect(satisYerelListesi(liste, { mikroDahil: true, ikizAnahtarlari: new Set(['325']) })).toHaveLength(2);
  });
});

describe('T-B2-5b · Finans sayaçları (mikroCiro.finansSiparisSayaclari, #2)', () => {
  it('işaretli MF sayaçlara girmez; `kaynaksizDisi` 1; işaretsiz ikizsiz MF sayılır', () => {
    const s = finansSiparisSayaclari(GIRDI, []);
    expect([s.toplam, s.faturali, s.faturasiz]).toEqual([2, 1, 1]);   // yerel (hasInvoice) + işaretsiz MF (hasInvoice yok)
    expect(s.kaynaksizDisi.adet).toBe(1);
  });
});

describe('T-B2-5d · Vergi Takvimi KDV önerisi (vergiTakvimiKdv.ayKdvOnerisi, #4)', () => {
  it('işaretli MF öneriye girmez; işaretsiz ve yerel girer (%20 × tutar)', () => {
    expect(ayKdvOnerisi(GIRDI, AY.replace('-', '/'))).toBeCloseTo((1200 + 600) * 0.2, 6);
    expect(ayKdvOnerisi([ISARETLI], AY)).toBe(0);
  });
  it('taşıma öncesiyle aynı: iptal / faturasız / tutarı bilinmeyen sipariş 0 katkı; dönem çözülemezse 0', () => {
    expect(ayKdvOnerisi([{ ...YEREL, status: 'Cancelled' }, { ...YEREL, faturali: false }, { ...YEREL, totalPrice: undefined }], AY)).toBe(0);
    expect(ayKdvOnerisi(GIRDI, '2026 Q')).toBe(0);
  });
});

describe('T-B2-5e · KDV borcu sipariş tarafı (nakitBilanco.kdvBorcu, #5)', () => {
  it('işaretli MF\'nin KDV\'si borca girmez; `kaynaksizDisi` 1; işaretsiz ve yerel girer', () => {
    const k = kdvBorcu(GIRDI, [], AY);
    expect(k.toplam).toBe(200 + 100);
    expect(k.kaynaksizDisi).toEqual({ adet: 1, tutar: { toplam: 1200, bilinen: 1, bilinmeyen: 0 } });
  });
});

describe('T-B2-5f · KDV aylık özeti (kdvAylik.kdvAylikOzet, #6)', () => {
  it('işaretli MF ayın KDV / net toplamına girmez; `kaynaksizDisi` (pencere içi) 1', () => {
    const o = kdvAylikOzet(GIRDI, BU_AY);
    expect(o.toplamKdv.toplam).toBe(300);
    expect(o.toplamNet.toplam).toBe(1500);
    expect(o.kaynaksizDisi.adet).toBe(1);
  });
});

describe('T-B2-5h · Sipariş CSV «Fatura tipi» hücresi (export.faturaTipiHucresi, #8 / T-B2-7)', () => {
  it("işaretli MF satırı KALIR, hücre «Mikro'da satış faturası yok»; öteki satırda bugünkü değer", () => {
    expect(faturaTipiHucresi(ISARETLI, true)).toBe("Mikro'da satış faturası yok");
    expect(faturaTipiHucresi(ISARETLI, false)).toBe('No Mikro sales invoice');
    expect(faturaTipiHucresi(ISARETSIZ, true)).toBe('e-fatura');
    expect(faturaTipiHucresi({ ...YEREL, faturaTipi: 'e-arsiv' }, true)).toBe('e-arsiv');
  });
});

describe('T-B2-5j · Fatura durum metni (faturaDurumu.mikroFaturaDurumMetni, #10 / BH13)', () => {
  it("işaretli MF → «Mikro'da satış faturası yok»; işaretsiz MF → null; `siparisFaturaVar` true kalır, kesme / gönderme kapalı", () => {
    expect(mikroFaturaDurumMetni(ISARETLI, 'tr')).toBe("Mikro'da satış faturası yok");
    expect(mikroFaturaDurumMetni(ISARETSIZ, 'tr')).toBeNull();
    expect(siparisFaturaVar(ISARETLI)).toBe(true);
    expect(faturaKesilebilir(ISARETLI)).toBe(false);
    expect(mikroyaFaturaGonderilebilir(ISARETLI)).toBe(false);
  });
  // BH15 e-Fatura Takip (MuhasebePage P564): işaretli MF tablodan DIŞLANMAZ (ciro toplamıyor), hücre BH13 metnini basar; «Fatura
  // Eksik» sayacına (`!faturaTakipFaturaVar`) GİRMEZ: Cetpa'dan kesilemeyecek fatura için iş üretilmez.
  it('BH15 e-Fatura Takip: işaretli MF kümede kalır, «Fatura Eksik» sayılmaz, satır hücresi BH13 metni', () => {
    const { liste } = faturaTakipSiparisleri([ISARETLI, ISARETSIZ]);
    expect(liste.map(o => o.id)).toEqual([ISARETLI.id, ISARETSIZ.id]);
    expect(liste.filter(o => !faturaTakipFaturaVar(o)).map(o => o.id)).toEqual([]);
    expect(liste.map(o => mikroFaturaDurumMetni(o, 'tr'))).toEqual(["Mikro'da satış faturası yok", null]);
  });
});

describe('T-B2-5k · Satış tahmini (faturaTakipTahmin.satisTahmini, #11 / BH15)', () => {
  it('ham liste (çağıranda süzgeç yok): işaretli MF bu ayın toplamına girmez; `kaynaksizDisi.adet` 1', () => {
    const t = satisTahmini(GIRDI, BU_AY);
    expect(t.gecmis[t.gecmis.length - 1].toplam).toBe(1800);
    expect(t.kaynaksizDisi.adet).toBe(1);
  });
});

describe('T-B2-5l · Kâr merkezi (faturaTakipTahmin.karMerkezleri, #12 / BH15)', () => {
  it('işaretli MF gelire girmez; sayaç `karMerkeziKaynaksizDisi` 1', () => {
    const k = karMerkezleri(GIRDI);
    expect(k.map(x => [x.ad, x.adet, x.gelir.toplam])).toEqual([['B2B', 2, 1800]]);
    expect(karMerkeziKaynaksizDisi(GIRDI).adet).toBe(1);
    expect(karMerkeziKaynaksizDisi([{ ...ISARETLI, status: 'Cancelled' }]).adet).toBe(0);
  });
});

describe('T-B2-5m · Bütçe / Gerçekleşen (butceGercek.butceGercekOzeti, #13 / MB1 bulgu 0)', () => {
  it('ham liste: işaretli MF ayın cirosuna girmez; `kaynaksizDisi.adet` 1; işaretsiz ve yerel girer (QH2-1)', () => {
    const o = butceGercekOzeti(GIRDI, [], AY);
    expect(o.ciro).toEqual({ toplam: 1800, bilinen: 2, bilinmeyen: 0 });
    expect(o.kaynaksizDisi).toEqual({ adet: 1, tutar: { toplam: 1200, bilinen: 1, bilinmeyen: 0 } });
    expect(o.gerceklesen.toplam).toBeCloseTo(1800 * 0.44, 6);
  });
  it('ay süzgeci: başka aydaki işaretli MF bu ayın sayacına girmez', () => {
    const baskaAy = { ...ISARETLI, createdAt: new Date(BU_AY.getFullYear() - 1, BU_AY.getMonth(), 10, 12).toISOString() };
    expect(butceGercekOzeti([baskaAy, YEREL], [], AY).kaynaksizDisi.adet).toBe(0);
  });
});

describe('T-B2-5n · P557 Senaryo bütçesi tabanı (babsKdvAnaliz.ciroTemeli, #14 / MB1 bulgu 1)', () => {
  it('ham liste: işaretli MF 6 aylık tabanda ve ortalamada yok; `kaynaksizDisi` (pencere içi) 1; işaretsiz girer', () => {
    const t = ciroTemeli(GIRDI, BU_AY);
    expect(t.aylar[t.aylar.length - 1].ciro.toplam).toBe(1800);
    expect(t.ortalama).toBe(1800);
    expect(t.kaynaksizDisi).toEqual({ adet: 1, tutar: { toplam: 1200, bilinen: 1, bilinmeyen: 0 } });
  });
  it('pencere dışı ve iptal edilmiş işaretli MF sayılmaz', () => {
    const eski = { ...ISARETLI, createdAt: new Date(BU_AY.getFullYear() - 2, 0, 10, 12).toISOString() };
    expect(ciroTemeli([eski, { ...ISARETLI, id: 'x', status: 'Cancelled' }, YEREL], BU_AY).kaynaksizDisi.adet).toBe(0);
  });
});

describe('T-B2-5o · Pano ciro işlevleri (hedefButce #24, musteriAnaliz #25, finansKpi #26 / (4) sayımı)', () => {
  const ayBasi = new Date(BU_AY.getFullYear(), BU_AY.getMonth(), 1);
  const BIR = { adet: 1, tutar: { toplam: 1200, bilinen: 1, bilinmeyen: 0 } };
  /** Pencere dışı işaretli MF: iki yıl önce (hiçbir pano penceresine düşmez). */
  const ESKI = { ...ISARETLI, id: 'eski', createdAt: new Date(BU_AY.getFullYear() - 2, 0, 10, 12).toISOString() };
  const IPTAL = { ...ISARETLI, id: 'iptal', status: 'Cancelled' };
  it('hedefButce: dönem / ay / hafta cirosuna işaretli MF girmez; işaretsiz girer', () => {
    expect(donemCirosu(GIRDI, ayBasi).ciro.toplam).toBe(1800);
    expect(ayCirosu(GIRDI, AY).ciro.toplam).toBe(1800);
    const yakin = GIRDI.map(o => ({ ...o, createdAt: new Date(Date.now() - 86400000).toISOString() }));
    const h = haftalikCiro(yakin, new Date());
    expect(h[h.length - 1].ciro.toplam).toBe(1800);
  });
  it('hedefButce `kaynaksizDisi` (MB2 bulgu 2): her işlev KENDİ penceresinden sayar — içerde 1; pencere dışı ve iptal 0', () => {
    expect(donemCirosu(GIRDI, ayBasi).kaynaksizDisi).toEqual(BIR);
    expect(ayCirosu(GIRDI, AY).kaynaksizDisi).toEqual(BIR);
    const yakin = GIRDI.map(o => ({ ...o, createdAt: new Date(Date.now() - 86400000).toISOString() }));
    const h = haftalikCiro(yakin, new Date());
    expect(h[h.length - 1].kaynaksizDisi).toEqual(BIR);
    expect(h.slice(0, -1).map(x => x.kaynaksizDisi.adet)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // Pencere dışı / iptal edilmiş işaretli MF hiçbir pencerenin sayacına girmez.
    const disarida = [ESKI, IPTAL, YEREL];
    expect(donemCirosu(disarida, ayBasi).kaynaksizDisi.adet).toBe(0);
    expect(ayCirosu(disarida, AY).kaynaksizDisi.adet).toBe(0);
    expect(haftalikCiro(disarida, new Date()).map(x => x.kaynaksizDisi.adet)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    // Yarı açık [baslangic, bitis): ayın işaretlisi bitişi ay başı olan önceki pencereye girmez.
    expect(donemCirosu(GIRDI, new Date(BU_AY.getFullYear(), BU_AY.getMonth() - 1, 1), ayBasi).kaynaksizDisi.adet).toBe(0);
  });
  it('musteriAnaliz: ciro toplamları işaretli MF\'siz; `siparisSayisi` HAM (sipariş sayısı değişmez)', () => {
    const m = enIyiMusteriler(GIRDI, 5).musteriler;
    expect(m.map(x => [x.ciro, x.siparisSayisi])).toEqual([[1800, 3]]);
    const s = segmentCirosu(GIRDI, b2bSegmenti, ['B2B', 'Diger']);
    expect([s.toplam, s.segmentler[0].ciro, s.segmentler[0].siparisSayisi]).toEqual([1800, 1800, 3]);
    // P79 / P106 notu: işaretli MF girdinin kendisinden sayılır; işaretli MF'siz girdide 0 (MB3 delta, 06.11.2026).
    expect(s.kaynaksizDisi.adet).toBeGreaterThan(0);
    expect(segmentCirosu(GIRDI.filter(o => !(o as { mfKaynaksiz?: unknown }).mfKaynaksiz), b2bSegmenti, ['B2B', 'Diger']).kaynaksizDisi.adet).toBe(0);
    const kar = (): SiparisKarlilik => ({ ciro: 1000, maliyet: 500, kar: 500, marjYuzde: 50, maliyetsizKalem: 0, satirlar: [] });
    const k = segmentKarliligi(GIRDI, () => 'B2B', kar);
    expect([k.segmentler[0].ciro, k.segmentler[0].siparisSayisi, k.segmentler[0].kar]).toEqual([1800, 3, 1000]);
    const odenmis = GIRDI.map(o => ({ ...o, paid: true }));
    expect(odemeDavranisi(odenmis, 5).odeyenler.map(x => x.tutar)).toEqual([1800]);
  });
  it('musteriAnaliz `kaynaksizDisi` (MB2 bulgu 2): P77 liste geneli 1, P124 iptal hariç 1; iptal edilmiş işaretli P124\'te 0', () => {
    const kar = (): SiparisKarlilik => ({ ciro: 1000, maliyet: 500, kar: 500, marjYuzde: 50, maliyetsizKalem: 0, satirlar: [] });
    expect(enIyiMusteriler(GIRDI, 5).kaynaksizDisi).toEqual(BIR);
    expect(enIyiMusteriler([ISARETSIZ, YEREL], 5).kaynaksizDisi.adet).toBe(0);
    expect(segmentKarliligi(GIRDI, () => 'B2B', kar).kaynaksizDisi).toEqual(BIR);
    expect(segmentKarliligi([IPTAL, YEREL], () => 'B2B', kar).kaynaksizDisi.adet).toBe(0);
  });
  it('finansKpi.aylikCiroDegisimi: bu ayın cirosuna işaretli MF girmez', () => {
    expect(aylikCiroDegisimi(GIRDI, BU_AY.getTime()).buAy.toplam).toBe(1800);
  });
  it('finansKpi.aylikCiroDegisimi `kaynaksizDisi` (MB2 bulgu 2): bu ay + geçen ay penceresi; iki ay önce ve daha eski 0', () => {
    expect(aylikCiroDegisimi(GIRDI, BU_AY.getTime()).kaynaksizDisi).toEqual(BIR);
    const gecenAy = { ...ISARETLI, id: 'gecen', createdAt: new Date(BU_AY.getFullYear(), BU_AY.getMonth() - 1, 10, 12).toISOString() };
    const ikiAyOnce = { ...ISARETLI, id: 'iki', createdAt: new Date(BU_AY.getFullYear(), BU_AY.getMonth() - 2, 10, 12).toISOString() };
    const d = aylikCiroDegisimi([gecenAy, ikiAyOnce, ESKI, YEREL], BU_AY.getTime());
    expect(d.kaynaksizDisi.adet).toBe(1);
    expect(d.gecenAy.toplam).toBe(0);
  });
});

// MB2 hakem bulgusu 0 (06.11.2026): P130 «Bugün ciro» ve P42 AOV işaretli kaynaksız MF'yi sayıyordu (kapı yalnız aylık değişimdeydi).
// Bulgunun girdisi: işaretli MF ₺1.000 + işaretsiz ikizsiz MF ₺300. Mutasyon: iki kapıdan biri silinir → o `it` kırmızı;
// işaretsiz ikizsiz de düşürülürse (QH2-1 ihlali) ikisi de kırmızı.
describe('T-B2-5p · Pano P130 «Bugün ciro» ve P42 AOV (finansKpi.nakitPozisyonu / ortalamaSiparisTutari, MB2 bulgu 0)', () => {
  const ISARETLI_1000 = mf(501, { mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-06T00:20:00.000Z', totalPrice: 1000 });
  const ISARETSIZ_300 = mf(502, { totalPrice: 300 });
  const P0 = [ISARETLI_1000, ISARETSIZ_300];
  const BIN = { adet: 1, tutar: { toplam: 1000, bilinen: 1, bilinmeyen: 0 } };
  const GUN = gunAnahtari(TARIH) ?? 'çözülemedi';
  it('P130 nakitPozisyonu: günün cirosu ve tahsili işaretli MF\'siz (işaretsiz SAYILIR); `kaynaksizDisi` günün penceresinden', () => {
    expect(GUN).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const n = nakitPozisyonu(P0.map(o => ({ ...o, paid: true })), { gun: GUN });
    expect(n.bugunCiro).toEqual({ toplam: 300, bilinen: 1, bilinmeyen: 0 });
    expect(n.bugunTahsil.toplam).toBe(300);
    expect(n.ekran.bugunCiro).toBe(300);
    expect(n.kaynaksizDisi).toEqual(BIN);
    expect(mfKaynaksizNotu(n.kaynaksizDisi, 'tr')).toBe("₺1.000,00 Mikro'da satış faturası olmayan MF siparişi dâhil değil · 1 kayıt");
    // Pencere dışı: başka günün ve iptal edilmiş işaretli MF'si bugünün sayacına girmez.
    expect(nakitPozisyonu(P0, { gun: '2000-01-01' }).kaynaksizDisi.adet).toBe(0);
    expect(nakitPozisyonu([{ ...ISARETLI_1000, status: 'Cancelled' }, ISARETSIZ_300], { gun: GUN }).kaynaksizDisi.adet).toBe(0);
  });
  it('P42 ortalamaSiparisTutari: işaretli MF ne paya ne paydaya girer; `finansKpilari().aov` aynı; `kaynaksizDisi` 1', () => {
    const a = ortalamaSiparisTutari(P0);
    expect([a.deger, a.sayilan, a.bilinmeyen]).toEqual([300, 1, 0]);
    expect(a.kaynaksizDisi).toEqual(BIN);
    const k = finansKpilari({ filtreliSiparisler: P0, siparisler: P0, adaylar: [] });
    expect(k.aov.deger).toBe(300);
    expect(k.aov.kaynaksizDisi).toEqual(BIN);
    // İşaretsiz liste bugünkü sonucu verir (eski fikstür): (300 + 600) / 2.
    const b = ortalamaSiparisTutari([ISARETSIZ_300, YEREL]);
    expect([b.deger, b.kaynaksizDisi.adet]).toEqual([450, 0]);
  });
});

// T-B2-5q (Y29 son inceleme bulgu 1, 06.11.2026): Pano «En Çok Satan Ürünler» kalem cirosu. Mutasyon: `panoEnCokSatanlar` içindeki
// `.filter(o => !mfKaynaksizMi(o))` kaldırılır → ÇİMENTO 5.100 ile tepeye çıkar, test kırmızı.
describe('T-B2-5q · Pano En Çok Satan Ürünler (stokSevkiyat.panoEnCokSatanlar, Y29 bulgu 1)', () => {
  // Hakem yeniden üretimi: manuel ÇİMENTO ₺100, işaretli MF ÇİMENTO netTutar ₺5.000, manuel KUM ₺300.
  const yerel = (id: string, sku: string, price: number) => ({ id, status: 'Delivered', totalPrice: price, lineItems: [{ sku, name: sku, price, quantity: 1 }] });
  const ISARETLI_KALEM = mf(422, { mfKaynaksiz: true, totalPrice: 6000, lineItems: [{ sku: 'ÇİMENTO', name: 'ÇİMENTO', netTutar: 5000, total: 6000, quantity: 10 }] });
  const ISARETSIZ_KALEM = mf(430, { totalPrice: 240, lineItems: [{ sku: 'KUM', name: 'KUM', netTutar: 200, total: 240, quantity: 2 }] });
  const G = [yerel('o-c', 'ÇİMENTO', 100), ISARETLI_KALEM, yerel('o-k', 'KUM', 300)];
  it('işaretli MF kalemi ürün cirosuna girmez; sıra ve çubuk kapılı listeden; sayaç adedi 1, tutar sipariş tutarı', () => {
    const r = panoEnCokSatanlar(G, 5, satirCirosu);
    expect(r.urunler.map(u => [u.anahtar, u.ciro.toplam, u.barOrani === null ? null : Math.round(u.barOrani * 10) / 10]))
      .toEqual([['KUM', 300, 100], ['ÇİMENTO', 100, 33.3]]);
    expect(r.urunler.find(u => u.anahtar === 'ÇİMENTO')?.adet.toplam).toBe(1);   // MF'nin 10 adedi de girmez
    expect(r.kaynaksizDisi).toEqual({ adet: 1, tutar: { toplam: 6000, bilinen: 1, bilinmeyen: 0 } });
  });
  it('işaretsiz MF bugünkü gibi sayılır (QH2-1); işaretli yoksa sayaç 0', () => {
    const r = panoEnCokSatanlar([...G.filter(o => o !== ISARETLI_KALEM), ISARETSIZ_KALEM], 5, satirCirosu);
    expect(r.urunler.map(u => [u.anahtar, u.ciro.toplam])).toEqual([['KUM', 500], ['ÇİMENTO', 100]]);
    expect(r.kaynaksizDisi.adet).toBe(0);
  });
});

// T-B2-6 (gözlem, mutasyonlu): bu okuyucular MF'yi zaten dışlar; işaretli MF de 0 katkı yapar. Mutasyon: `mikroTurevi` /
// `source !== 'mikro-fatura'` / `geliriMikroda` dışlaması kaldırılırsa ilgili iddia kırmızı.
describe('T-B2-6 · değişmeyen okuyucular: işaretli MF 0 katkı (MF zaten dışlanıyor)', () => {
  it('pano cirosu (panoCirosu → mikroTurevi), cetpaCiro, ayKarZarar (geliriMikroda) native geliri yalnız yerel siparişi sayar', () => {
    expect(panoCirosu(GIRDI, []).native.toplam).toBe(600);
    expect(cetpaCiro(GIRDI).toplam).toBe(600);
    // Kâr-Zarar native geliri yalnız FATURASIZ Cetpa siparişidir (faturalı satış Mikro faturasından sayılır).
    expect(ayKarZarar([...GIRDI, { ...YEREL, id: 'ord-2', faturali: false, totalPrice: 250 }], [], BU_AY).gelir).toBe(250);
  });
});
