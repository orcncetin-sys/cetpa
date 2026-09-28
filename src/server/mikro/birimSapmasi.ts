/**
 * birimSapmasi.ts — koli/paket ↔ adet karışıklığı şüphesi taşıyan fatura satırlarının TÜM GEÇMİŞ raporu (2026-09-28).
 *
 * NEDEN VAR — kullanıcı: "DAYSON-DYS.029 alış faturaları 410 ve 394 adet olması gerekirken paket girilmiş. bu tip hata
 * var mı?". Fiyat Karşılaştırma'daki koli/adet listesi (lib/stokFiyat.birimSapmalari) Cetpa'nın stok hareketi aynasını
 * okur; ayna yalnız son ~90 günü tutar (gecePenceresi), eski faturaları GÖREMEZ. Bu rapor Mikro'nun kendi tablolarından
 * (SqlVeriOkuV2) okunan satır + başlıklarla AYNI kuralı uygular — kopya kural YAZILMAZ (iskontoTutarsizlik.ts kalıbı).
 *
 * Liste bir KONTROL listesidir, hüküm değil: satırın net birim fiyatı ürünün olağan fiyat düzeyinden ≥ BIRIM_SAPMA_KATI
 * kat sapıyor. Tüm geçmiş tarandığı için yıllar içindeki fiyat artışı da düzeyi kaydırır: 2022'nin meşru ₺25'i 2026'nın
 * ₺110'una göre "kat 0,23" çıkar (inceleme 2026-09-28). Kural bunu ayıklamaz; her satır `tarihFarkiYil` taşır — ucuz VE
 * referans düzeyden yıllarca ESKİ satır (kat < 1, fark eksi) ya da pahalı VE yıllarca YENİ satır (kat > 1, fark artı; ana grup
 * eskiyse) büyük olasılıkla fiyat artışıdır; aylar içindeki 24 kat ise koli/adettir. Karar kullanıcının Mikro'da e-faturayla
 * karşılaştırmasıdır. Cetpa Mikro'ya YAZMAZ.
 *
 * KAPSAM: yalnız fatura satırları (sth_evraktip 3 alış / 4 satış). İrsaliye ve diğer evrak tipleri taranmaz (canlı ölçüm
 * 2026-09-28: STOK_HAREKETLERI 1.377 satırın 47'si — evraktip 1: 2, 2: 45).
 */
import { faturaToplamlari, birimSapmalari, baslikIptalMi, type StokHareketi } from '../../lib/stokFiyat.js';

export interface BirimSapmaSatiri {
  sku: string;
  /** Mikro stok kartı adı (STOKLAR) — uç, liste belli olunca yalnız listedeki ürünler için doldurur; okunamadıysa null. */
  ad: string | null;
  /** YYYY-AA-GG; tarihsiz satırda null. */
  tarih: string | null;
  yon: 'alis' | 'satis';
  /** `seri-sıra` (seri boşsa yalnız sıra). */
  evrakNo: string | null;
  /** Fatura başlığının cari kodu (cha_kod); başlık yoksa ya da aynı evrak anahtarlı iptalsiz başlıklar farklı cari
   *  taşıyorsa null. */
  cariKod: string | null;
  miktar: number;
  /** Satırın NET birim fiyatı (KDV hariç, iskontolar düşülmüş) — Fiyat Karşılaştırma'daki "Net birim fiyat" ile aynı. */
  birimFiyat: number;
  /** Ürünün ana fiyat grubunun medyan net birim fiyatı. */
  medyan: number;
  /** birimFiyat / medyan — 24 = ana düzeyin 24 katı (koli/paket fiyatı adet miktarıyla girilmiş olabilir). */
  kat: number;
  /** true: ürünün fiyatları dengeli gruplara bölünüyor, HANGİ grubun yanlış olduğu fiyattan anlaşılamaz. */
  belirsiz: boolean;
  /** Referans fiyat düzeyinin (ana grup) medyan tarihi. */
  anaGrupTarihi: string | null;
  /** (satır tarihi − anaGrupTarihi) yıl, 1 ondalık; eksi = satır referanstan ESKİ. Tarihlerden biri yoksa null. */
  tarihFarkiYil: number | null;
}
export interface BirimSapmaRaporu {
  satirlar: BirimSapmaSatiri[];
  ozet: {
    /** Okunan (iptal olmayan) fatura satırı. */
    incelenenSatir: number;
    /** Net birim fiyatı ÇÖZÜLEMEYEN satır — ne gruba girer ne şüpheli sayılır; koli hatası bunlarda da olabilir. */
    fiyatsizSatir: number;
    /** Satırlardaki farklı ürün. Okuma sınıra dayandıysa (kesildi) null: yalnız eski satırlarda geçen ürün hiç görünmez. */
    urun: number | null;
    /** Hüküm verilebilen ürün (≥ 3 fiyatı bilinen satır ve birbirine yakın en az iki fiyat). Listede yoksa fiyatı BİLİNEN
     *  satırları temizdir. Kesildiyse null (medyan eski satırlar olmadan hesaplandı). */
    degerlendirilenUrun: number | null;
    /** Değerlendirilen ama fiyatı çözülemeyen satırı da olan ürün — "temiz" hükmü o satırları KAPSAMAZ. Kesildiyse null. */
    fiyatsizSatirliUrun: number | null;
    /** Hüküm verilemeyen ürün (az satır / fiyat düzeyi belirlenemedi) — "temiz" DEĞİL, bilinmiyor. Kesildiyse null. */
    degerlendirilemeyenUrun: number | null;
    sapanSatir: number; sapanUrun: number; sapanFatura: number;
    /** Sapan satırlardan `belirsiz: true` olanlar. */
    belirsizSatir: number;
    /** Taranan satırların tarih aralığı (YYYY-AA-GG). */
    ilkTarih: string | null; sonTarih: string | null;
  };
}

const tarihMetni = (t: unknown): string | null =>
  typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10)
    : t instanceof Date && Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : null;
const anahtar = (yon: string, seri: unknown, sira: unknown) => `${yon}|${String(seri ?? '').trim()}|${String(sira ?? '').trim()}`;
const GUN_MS = 86400000;
const yilFarki = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const f = (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / GUN_MS / 365.25;
  return Number.isFinite(f) ? Math.round(f * 10) / 10 : null;
};

export function birimSapmasiRaporu(
  satirlar: readonly StokHareketi[],
  basliklar: readonly Readonly<Record<string, unknown>>[],
  secenek: { kesildi?: boolean } = {},
): BirimSapmaRaporu {
  const sapma = birimSapmalari(satirlar, { faturaToplamlari: faturaToplamlari(basliklar) });

  // Cari: iptal başlık atlanır (faturaToplamlari ile aynı küme — iptal edilip aynı numarayla yeniden girilen faturanın
  // doğru carisi düşmesin); aynı anahtarda FARKLI cari taşıyan iptalsiz başlıklar varsa hangisi bilinmez → null.
  const cariler = new Map<string, string | null>();
  for (const b of basliklar) {
    if (baslikIptalMi(b)) continue;
    const k = anahtar(Number(b.cha_tip) === 1 ? 'gelen' : 'giden', b.cha_evrakno_seri, b.cha_evrakno_sira);
    const cari = String(b.cha_kod ?? '').trim() || null;
    cariler.set(k, cariler.has(k) && cariler.get(k) !== cari ? null : cari);
  }

  const liste: BirimSapmaSatiri[] = sapma.satirlar.map(s => {
    const tarih = tarihMetni(s.tarih);
    return {
      sku: s.sku, ad: null, tarih, yon: s.yon, evrakNo: s.evrakNo,
      cariKod: s.fatura ? cariler.get(anahtar(s.fatura.yon, s.fatura.seri, s.fatura.sira)) ?? null : null,
      miktar: s.miktar, birimFiyat: s.birimFiyat, medyan: s.medyan, kat: s.kat, belirsiz: s.belirsiz,
      anaGrupTarihi: s.anaGrupTarihi, tarihFarkiYil: yilFarki(tarih, s.anaGrupTarihi),
    };
  });

  const urunler = new Set<string>();
  let ilkTarih: string | null = null, sonTarih: string | null = null;
  for (const h of satirlar) {
    const sku = String(h.sth_stok_kod ?? '').trim();          // lib/stokFiyat skuOku ile aynı
    if (sku) urunler.add(sku);
    const t = tarihMetni(h.sth_tarih);
    if (t && (ilkTarih === null || t < ilkTarih)) ilkTarih = t;
    if (t && (sonTarih === null || t > sonTarih)) sonTarih = t;
  }
  let fiyatsizSatir = 0, fiyatsizSatirliUrun = 0;
  for (const [sku, n] of sapma.fiyatsiz) { fiyatsizSatir += n; if (sapma.degerlendirilen.has(sku)) fiyatsizSatirliUrun++; }
  // Sapan fatura: başlık anahtarı (yön|seri|sıra); satırın fatura anahtarı yoksa yön + evrak no.
  const faturalar = new Set(sapma.satirlar.map(s => s.fatura ? anahtar(s.fatura.yon, s.fatura.seri, s.fatura.sira) : `${s.yon}|${s.evrakNo ?? ''}`));
  const kesildi = secenek.kesildi === true;
  return {
    satirlar: liste,
    ozet: {
      incelenenSatir: satirlar.length, fiyatsizSatir,
      urun: kesildi ? null : urunler.size,
      degerlendirilenUrun: kesildi ? null : sapma.degerlendirilen.size,
      fiyatsizSatirliUrun: kesildi ? null : fiyatsizSatirliUrun,
      degerlendirilemeyenUrun: kesildi ? null : urunler.size - sapma.degerlendirilen.size,
      sapanSatir: liste.length, sapanUrun: new Set(liste.map(s => s.sku)).size, sapanFatura: faturalar.size,
      belirsizSatir: liste.filter(s => s.belirsiz).length, ilkTarih, sonTarih,
    },
  };
}
