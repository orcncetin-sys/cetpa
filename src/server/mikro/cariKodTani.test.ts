// @vitest-environment node
/**
 * cariKodTani.test.ts: `cariKodTanisi` saf çekirdeği — MB1 hakem bulguları 3 ve 4 (05.11.2026; şartname «Mikro bağlantı B» B3-a § 5.4,
 * BH9 / BH19.4). Ağ, PG, Mikro YOK.
 *
 *   Bulgu 3: kendi lead'i olmayan kodun «düştüğü» lead bugünkü yazıcı zinciriyle (crons.ts / cari/listesi → `cariHedefi`) bulunur:
 *            VKN, yoksa İSİM (gelen `isimAnahtari(unvan)`, lead `firmaAnahtari`). İsim yolu ölçülmezse S-B3 «bağlı veri 0 → soru
 *            düşer» kuralı ezilmiş kodu yanlışlıkla düşürür. İsim `CariListesiV2` satırından (`cariEsle`); ayna tablosunda unvan YOK.
 *            Satırlar okunamadıysa (`cariler: null`) isim yolu ölçülemez → `bagliVeriNotu` («0» kanıt değildir).
 *   Bulgu 4: ayna yalnız upsert edilir; Mikro'da silinmiş kod aynada kalır. Canlı kod kümesi okunduysa `kendiLeadiOlmayanKodlar`
 *            onunla kesişir, bayat kod `aynadaBayatKod`'da sayılır; küme okunamadıysa eski davranış (ayna olduğu gibi).
 * Mutasyon (yapılıp geri alındı, raporda): isim dalı silinir → bulgu 3 testi kırmızı; `&& (canli === null || canli.has(k))` silinir
 * → bulgu 4 testi kırmızı.
 */
import { describe, it, expect } from 'vitest';
import { cariKodTanisi, BAGLI_VERI_NOTU, type CariKodTaniGirdisi } from './cariKodTani';

const K = 'A-KIRACI';
const cari = (kod: string, unvan: string, vkn: string) => ({ cari_kod: kod, cari_unvan1: unvan, cari_vdaire_no: vkn, cari_efatura_fl: 0, cari_hareket_tipi: 0 });

describe('MB1 bulgu 3 · isimle ezilmiş kodun bağlı Cetpa verisi', () => {
  // L1 elle açılmış ('Şirin Yapı', VKN'siz) ve bugün B koduna bağlı. A carisinin unvanı BÜYÜK harfle aynı firma: saatlik cron A'yı
  // VKN'yle bulamaz, isimle L1'e düşürür. L1'e bağlı 4 yerel sipariş ve 1 müşteri hesabı A koduna «ait» olabilir → S-B3 sorulmalı.
  const girdi = (ek: Partial<CariKodTaniGirdisi> = {}): CariKodTaniGirdisi => ({
    companyId: K,
    leads: [{ id: 'L1', data: { company: 'Şirin Yapı', name: 'Ayşe Yılmaz', mikroCariKod: 'B', companyId: K } }],
    ayna: [{ kod: 'A', vkn: '111' }, { kod: 'B', vkn: '222' }],
    canliKodlar: ['A', 'B'],
    cariler: [cari('A', 'ŞİRİN YAPI', '111'), cari('B', 'Şirin Yapı', '222')],
    musteriHesaplari: [{ leadId: 'L1', cariKod: 'B', companyId: K }],
    siparisler: [1, 2, 3, 4].map(i => ({ id: `o${i}`, source: 'manual', mikroCariKod: null, leadId: 'L1', companyId: K })),
    ...ek,
  });

  it('VKN yolu boşsa isim yolu: A → L1, 4 sipariş, 1 müşteri hesabı; not yok', () => {
    const t = cariKodTanisi(girdi());
    expect(t.kendiLeadiOlmayanKodlar).toEqual(['A']);
    expect(t.bagliCetpaVerisi).toEqual([{ kod: 'A', dustuguLeadler: ['L1'], siparis: 4, tahsilat: null, musteriHesabi: 1 }]);
    expect(t.bagliVeriNotu).toBeNull();
    // Yanıtta unvan YOK (isim yalnız bellekte).
    expect(JSON.stringify(t)).not.toMatch(/ŞİRİN|Şirin/);
  });

  it('VKN eşleşmesi önce gelir (yazıcı zinciri): VKN 111 taşıyan L2 varsa A → L2, isim yoluna bakılmaz', () => {
    const t = cariKodTanisi(girdi({
      leads: [
        { id: 'L1', data: { company: 'Şirin Yapı', mikroCariKod: 'B', companyId: K } },
        { id: 'L2', data: { company: 'Başka Unvan', taxId: '111', companyId: K } },
      ],
    }));
    expect(t.bagliCetpaVerisi.map(b => [b.kod, b.dustuguLeadler])).toEqual([['A', ['L2']]]);
  });

  it('CariListesiV2 okunamadıysa isim yolu ölçülemez: düşen lead yok ve `bagliVeriNotu` «0 kanıt değil» der', () => {
    const t = cariKodTanisi(girdi({ cariler: null }));
    expect(t.bagliCetpaVerisi).toEqual([{ kod: 'A', dustuguLeadler: [], siparis: 0, tahsilat: null, musteriHesabi: 0 }]);
    expect(t.bagliVeriNotu).toBe(BAGLI_VERI_NOTU);
  });

  it('yabancı kiracının aynı isimli lead\'i düşen lead sayılmaz', () => {
    const t = cariKodTanisi(girdi({ leads: [{ id: 'LX', data: { company: 'Şirin Yapı', mikroCariKod: 'B', companyId: 'BASKA' } }] }));
    expect(t.bagliCetpaVerisi.every(b => b.dustuguLeadler.length === 0)).toBe(true);
  });
});

describe('MB1 bulgu 4 · aynada kalmış (Mikro\'da silinmiş) kod sayılmaz', () => {
  const girdi = (canliKodlar: string[] | null): CariKodTaniGirdisi => ({
    companyId: K,
    leads: [{ id: 'LA', data: { company: 'A Ltd', mikroCariKod: 'A', companyId: K } }],
    ayna: [{ kod: 'A', vkn: '' }, { kod: 'Z', vkn: '' }],
    canliKodlar,
    cariler: [cari('A', 'A LTD', '')],
    musteriHesaplari: [],
    siparisler: [],
  });

  it('canlı küme yalnız A: `kendiLeadiOlmayanKodlar` boş, `aynadaBayatKod` 1, kabul ölçüsü eşit', () => {
    const t = cariKodTanisi(girdi(['A']));
    expect(t.mikroKod).toBe(2);   // `mikroKod` şartnamedeki gibi aynadan
    expect(t.kendiLeadiOlmayanKodlar).toEqual([]);
    expect(t.aynadaBayatKod).toBe(1);
    expect('kabul' in t.kuruKosu ? t.kuruKosu.kabul : null).toEqual({ yeniSayisi: 0, kendiLeadiOlmayan: 0, esit: true });
  });

  it('canlı küme okunamadıysa (null / boş) eski davranış: Z sayılır, `aynadaBayatKod` null', () => {
    for (const k of [null, []]) {
      const t = cariKodTanisi(girdi(k));
      expect(t.kendiLeadiOlmayanKodlar).toEqual(['Z']);
      expect(t.aynadaBayatKod).toBeNull();
    }
  });
});
