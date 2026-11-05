/**
 * cariKodTani.ts: `GET /api/ops/cari-kod-tani`'nin SAF çekirdeği (şartname «Mikro bağlantı B» B3-a § 5.4 + BH9 / BH11 / BH19.4;
 * 05.11.2026). Aynı VKN'li iki Mikro carisi için kullanıcı kararı «İki ayrı cari»; kural (B3-b) yayına çıkmadan önce bu ölçü alınır
 * ve S-B3 sorulur. SALT OKUMA: hiçbir yere yazmaz.
 *
 * YANITTA YALNIZ KOD, KİMLİK VE SAYI: unvan ve VKN DÖNMEZ (VKN yalnız gruplama anahtarı olarak bellekte kullanılır). Mikro cari
 * kodları ve lead / sipariş kimlikleri müşteri adı taşımaz.
 *
 * GİRDİ (rota okur): kiracının lead'leri (kiracı + etiketsiz; burada da süzülür), ayna `mikro_cari_hesaplar` (kod + VKN), Mikro'nun
 * CANLI kod kümesi (`SELECT cari_kod FROM CARI_HESAPLAR`; okunamazsa / boşsa `null`: BH9 dalı kapalı), cron ile AYNI `CariListesiV2`
 * satırları (okunamazsa `null`: kuru koşu atlanır), müşteri hesabı bağları ve siparişlerin bağ alanları.
 */
import { cariEsle, cariKuruKosu, vknAnahtari, type CariKuruKosu } from './eslemeCari.js';
import { MF_KAYNAGI } from '../../lib/mfKaynagi.js';
import { firmaAnahtari, isimAnahtari } from '../../lib/isimAnahtari.js';

export interface CariKodTaniGirdisi {
  companyId: string;
  leads: ReadonlyArray<{ id: string; data: Record<string, unknown> }>;
  /** Ayna satırları: cari kodu ve VKN (VKN yanıta girmez). */
  ayna: ReadonlyArray<{ kod: unknown; vkn: unknown }>;
  canliKodlar: readonly string[] | null;
  /** Cron ile aynı `CariListesiV2` satırları; okunamadıysa / eksikse `null`. */
  cariler: ReadonlyArray<Record<string, unknown>> | null;
  musteriHesaplari: ReadonlyArray<{ leadId: unknown; cariKod: unknown; companyId: unknown }>;
  siparisler: ReadonlyArray<{ id: string; source: unknown; mikroCariKod: unknown; leadId: unknown; companyId: unknown }>;
}

const kodMetni = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
/** Tahsilat kaydı (`tahsilatKayitlari`) lead'e ya da cari koduna bağlı DEĞİL (yalnız müşteri adı): sayılmaz, uydurulmaz. */
export const TAHSILAT_NOTU = "tahsilat kaydı lead'e ya da cari koduna bağlı değil (yalnız müşteri adı); sayılmadı";
/** `CariListesiV2` okunamadığında `bagliCetpaVerisi`nin sınırı. */
export const BAGLI_VERI_NOTU = "CariListesiV2 okunamadı: isimle düşen lead ölçülmedi; bağlı veri yalnız VKN yolundan sayıldı, 0 kanıt değildir";

export interface GrupLeadi {
  leadId: string;
  bugunkuKod: string | null;
  /** Bu lead'e bağlı müşteri hesaplarının sabitlenmiş cari kodları (`null` = kodsuz bağ). */
  musteriHesabiKodlari: Array<string | null>;
  /** `musteriHesap.cariKod ≠ lead.mikroCariKod` olan bağ sayısı. */
  bagUyusmaz: number;
  /** Lead'e `leadId` ile bağlı MF DIŞI (yerel) sipariş sayısı. */
  yerelSiparis: number;
  tahsilat: null;
  /** Kanıtlar çelişmiyorsa kalacak kod (sıra: müşteri hesabı bağı → grubun MF çoğunluğu → bugünkü kod); çelişirse `null`. */
  varsayilanKod: string | null;
  celiski: boolean;
}
export interface AyniVknGrubu {
  kodlar: string[];
  /** Grubun kodlarını taşıyan MF siparişlerinin kod kırılımı (MF'nin kodu `cha_kod`'dan gelir, lead'den değil). */
  mfKodKirilimi: Record<string, number>;
  leadler: GrupLeadi[];
}

export interface CariKodTanisi {
  /** Aynadaki benzersiz cari kodu sayısı. */
  mikroKod: number;
  /** Kiracının lead'lerinde benzersiz ve dolu `mikroCariKod` sayısı. */
  leadKod: number;
  /** Aynada olup kendi lead'i olmayan kodlar; Mikro'nun CANLI kümesi okunduysa onunla KESİŞİR (ayna yalnız upsert edilir, Mikro'da
   *  silinmiş kod aynada kalır — BH9). Küme okunamadıysa ayna olduğu gibi. */
  kendiLeadiOlmayanKodlar: string[];
  /** Aynada olup Mikro'nun CANLI kümesinde olmayan kod sayısı (ayna yalnız upsert; BH9). Küme okunamadıysa `null`. */
  aynadaBayatKod: number | null;
  /** Lead'lerde olup Mikro'nun CANLI kümesinde olmayan kod sayısı (BH9; küme okunamadıysa `null`). */
  mikrodaOlmayanLeadKodu: number | null;
  ayniVknCokKodluGrup: number;
  /** Kendi lead'i olmayan her kodun bugünkü yazıcı zinciriyle (VKN, yoksa isim) düştüğü lead ve o lead'e bağlı Cetpa verisi. */
  bagliCetpaVerisi: Array<{ kod: string; dustuguLeadler: string[]; siparis: number; tahsilat: null; musteriHesabi: number }>;
  /** `CariListesiV2` okunamadıysa isim yolu ölçülemez: `bagliCetpaVerisi` yalnız VKN yolunu sayar, «0» kanıt değildir. Ölçüldüyse `null`. */
  bagliVeriNotu: string | null;
  gruplar: AyniVknGrubu[];
  tahsilatNotu: string;
  kuruKosu: (CariKuruKosu & { kabul: { yeniSayisi: number; kendiLeadiOlmayan: number; esit: boolean } }) | { atlandi: string };
}

export function cariKodTanisi(g: CariKodTaniGirdisi): CariKodTanisi {
  const leads = g.leads.filter(l => { const dc = typeof l.data.companyId === 'string' ? l.data.companyId : ''; return !dc || dc === g.companyId; });
  const kiracininMi = (cid: unknown): boolean => { const dc = typeof cid === 'string' ? cid : ''; return !dc || dc === g.companyId; };
  const siparisler = g.siparisler.filter(o => kiracininMi(o.companyId));
  const hesaplar = g.musteriHesaplari.filter(h => typeof h.companyId === 'string' && h.companyId === g.companyId);

  const leadKodu = (data: Record<string, unknown>): string => kodMetni(data.mikroCariKod);
  const leadKodlari = new Set(leads.map(l => leadKodu(l.data)).filter(Boolean));
  const aynaKodlari = new Map<string, string>();   // kod → vkn
  for (const a of g.ayna) { const k = kodMetni(a.kod); if (k && !aynaKodlari.has(k)) aynaKodlari.set(k, vknAnahtari(a.vkn)); }
  const canli = g.canliKodlar && g.canliKodlar.length > 0 ? new Set(g.canliKodlar.map(kodMetni).filter(Boolean)) : null;
  // Ayna yalnız upsert edilir (BH9): Mikro'da silinmiş kod aynada kalır. Canlı küme okunduysa onunla kesişir; okunamadıysa ayna.
  const kendiLeadiOlmayan = [...aynaKodlari.keys()].filter(k => !leadKodlari.has(k) && (canli === null || canli.has(k))).sort();
  const aynadaBayatKod = canli ? [...aynaKodlari.keys()].filter(k => !canli.has(k)).length : null;

  const leadVkn = (data: Record<string, unknown>): string => vknAnahtari(data.taxId || data.taxNo);
  const vknLeadleri = (vkn: string): string[] => (vkn ? leads.filter(l => leadVkn(l.data) === vkn).map(l => l.id) : []);
  const yerelSiparis = (leadId: string): number => siparisler.filter(o => o.source !== MF_KAYNAGI && o.leadId === leadId).length;
  const hesapSayisi = (leadId: string): number => hesaplar.filter(h => h.leadId === leadId).length;

  // Aynı VKN'de birden çok kod (ayna).
  const vknKodlari = new Map<string, string[]>();
  for (const [kod, vkn] of aynaKodlari) { if (!vkn) continue; const l = vknKodlari.get(vkn); if (l) l.push(kod); else vknKodlari.set(vkn, [kod]); }
  const gruplar: AyniVknGrubu[] = [];
  for (const [vkn, kodlarHam] of vknKodlari) {
    if (kodlarHam.length < 2) continue;
    const kodlar = [...kodlarHam].sort();
    const kume = new Set(kodlar);
    const mfKodKirilimi: Record<string, number> = {};
    for (const o of siparisler) {
      const k = kodMetni(o.mikroCariKod);
      if (o.source === MF_KAYNAGI && kume.has(k)) mfKodKirilimi[k] = (Object.prototype.hasOwnProperty.call(mfKodKirilimi, k) ? mfKodKirilimi[k] : 0) + 1;
    }
    const enCok = Object.entries(mfKodKirilimi).sort((a, b) => b[1] - a[1]);
    const mfCogunluk = enCok.length > 0 && (enCok.length === 1 || enCok[0][1] > enCok[1][1]) ? enCok[0][0] : null;
    const grupLeadleri = leads.filter(l => leadVkn(l.data) === vkn || kume.has(leadKodu(l.data)));
    gruplar.push({
      kodlar, mfKodKirilimi,
      leadler: grupLeadleri.map(l => {
        const bugunku = leadKodu(l.data) || null;
        const bagKodlari = hesaplar.filter(h => h.leadId === l.id).map(h => kodMetni(h.cariKod) || null);
        const bagUyusmaz = bagKodlari.filter(k => k !== bugunku).length;
        const bagKodu = bagKodlari.length > 0 && bagKodlari.every(k => k !== null && k === bagKodlari[0]) ? bagKodlari[0] : null;
        const kanitlar = [bagKodu, mfCogunluk, bugunku].filter((k): k is string => k !== null);
        const celiski = new Set(kanitlar).size > 1;
        return {
          leadId: l.id, bugunkuKod: bugunku, musteriHesabiKodlari: bagKodlari, bagUyusmaz,
          yerelSiparis: yerelSiparis(l.id), tahsilat: null, varsayilanKod: celiski ? null : (kanitlar[0] ?? null), celiski,
        };
      }),
    });
  }
  gruplar.sort((a, b) => a.kodlar[0].localeCompare(b.kodlar[0]));

  // İsim anahtarı cron ile AYNI `CariListesiV2` satırlarından (`cariEsle` → `alanlar.name`); ayna tablosunda unvan kolonu YOK, eklenmez.
  // Yalnız bellekte kullanılır, yanıta girmez (unvan dönmez).
  const isimAnahtarlari = new Map<string, string>();   // kod → isimAnahtari(unvan)
  for (const c of g.cariler ?? []) {
    const e = cariEsle(c, { companyId: g.companyId, zamanDamgasi: null });
    if (e && !isimAnahtarlari.has(e.cariKod)) isimAnahtarlari.set(e.cariKod, isimAnahtari(e.alanlar.name));
  }
  const bagliCetpaVerisi = kendiLeadiOlmayan.map(kod => {
    // Bugünkü yazıcı zinciri (crons.ts / cari/listesi → cariHedefi): VKN, yoksa isim (gelen `isimAnahtari`, lead `firmaAnahtari`).
    const vknli = vknLeadleri(aynaKodlari.get(kod) ?? '');
    const isimKey = isimAnahtarlari.get(kod) ?? '';
    const dustugu = vknli.length > 0 ? vknli : (isimKey ? leads.filter(l => firmaAnahtari(l.data) === isimKey).map(l => l.id) : []);
    return {
      kod, dustuguLeadler: dustugu,
      siparis: dustugu.reduce((t, id) => t + yerelSiparis(id), 0), tahsilat: null,
      musteriHesabi: dustugu.reduce((t, id) => t + hesapSayisi(id), 0),
    };
  });

  let kuruKosu: CariKodTanisi['kuruKosu'];
  if (g.cariler === null) kuruKosu = { atlandi: 'CariListesiV2 okunamadı ya da eksik döndü: kuru koşu yapılmadı' };
  else {
    const k = cariKuruKosu(leads, g.companyId, g.cariler, canli);
    kuruKosu = { ...k, kabul: { yeniSayisi: k.yeniLead.kodlar.length, kendiLeadiOlmayan: kendiLeadiOlmayan.length, esit: k.yeniLead.kodlar.length === kendiLeadiOlmayan.length } };
  }

  return {
    mikroKod: aynaKodlari.size, leadKod: leadKodlari.size, kendiLeadiOlmayanKodlar: kendiLeadiOlmayan, aynadaBayatKod,
    mikrodaOlmayanLeadKodu: canli ? [...leadKodlari].filter(k => !canli.has(k)).length : null,
    ayniVknCokKodluGrup: gruplar.length, bagliCetpaVerisi,
    bagliVeriNotu: g.cariler === null ? BAGLI_VERI_NOTU : null,
    gruplar, tahsilatNotu: TAHSILAT_NOTU, kuruKosu,
  };
}
