/**
 * belgeTipi.ts — satış belgesinin tipi: e-Fatura mı, e-Arşiv mi (2026-09-19, kullanıcı kararı: "e-Fatura mükellefiyiz").
 * Test: belgeTipi.test.ts (önce yazıldı).
 *
 * KURAL (VUK 509): e-Fatura mükellefi SATICI (CETPA), alıcı da e-Fatura'ya KAYITLI ise e-Fatura, değilse e-Arşiv
 * keser. Yani tip satıcının değil ALICININ kaydına bağlıdır. O kayıt Mikro'da `cari_efatura_fl`, Cetpa'da
 * `Lead.eFaturaKayitli` (cari importu yazar — src/server/mikro/eslemeCari.ts; okunamazsa alan HİÇ yazılmaz).
 *
 * NEDEN VAR — üç ayrı UYDURMA vardı ve üçü birbirini tutmuyordu:
 *   • AddOrderModal (75, 202): `customerType === 'B2B' || taxId.length >= 10` → e-fatura. VKN'si olan her firma
 *     e-Fatura'ya kayıtlı DEĞİLDİR; kayıtlı olmayana e-Fatura kesilemez (entegratör reddeder), kayıtlı olana
 *     e-Arşiv kesmek ise usulsüz belgedir.
 *   • App.tsx handleMikroFatura: `order.faturaTipi || 'e-arsiv'` → tip yoksa e-ARŞİV.
 *   • Sunucu faturaGovdesi: tip 'e-arsiv'/'ihracat' değilse 1 → tip yoksa e-FATURA.
 *   Aynı sipariş istemcide e-Arşiv, sunucuda e-Fatura sayılıyordu.
 *
 * Bilinmiyorsa tip UYDURULMAZ (null): çağıran kullanıcıya sorar / Mikro'ya göndermez (CLAUDE.md: dış sisteme
 * yazan gövdede varsayılan yok). Sipariş üzerindeki AÇIK seçim her zaman önce gelir (ihracat yalnız böyle seçilir).
 */
export type BelgeTipi = 'e-fatura' | 'e-arsiv' | 'ihracat';

const GECERLI: readonly string[] = ['e-fatura', 'e-arsiv', 'ihracat'];

export interface BelgeTipiMusterisi {
  eFaturaKayitli?: boolean | null;
  /**
   * Cari Cetpa'da açılıp Mikro'ya e-Fatura kaydı BİLİNMEDEN gönderildi (rota `/api/mikro/cari/kaydet` işaretler).
   * O gönderimde Mikro'ya `cari_efatura_fl: 0` gider ve saatlik cron onu `eFaturaKayitli: false` diye geri yazar —
   * bu "kayıtlı değil" bilgisi TEYİTSİZDİR (2026-09-19 uçtan uca inceleme). `true` ise yalnız Mikro'nun gerçek
   * kaydından gelebilir; ona güvenilir.
   */
  eFaturaKaydiTeyitsiz?: boolean | null;
  /** Doküman kimliği + Mikro cari kodu — ESKİ (işaretsiz) Cetpa kaynaklı carileri kodlarından tanımak için. */
  id?: string | null;
  mikroCariKod?: string | null;
}

/**
 * Cari kodunu CETPA mı üretti? Rota, Mikro cari kodu olmayan lead'e `CAR` + doküman id'sinin ilk 6 karakteri (BÜYÜK)
 * kodunu verir (server/mikro/govdeStokCari.cariGovdesi). Bu kalıp, `eFaturaKaydiTeyitsiz` işaretinden ÖNCE gönderilmiş
 * carileri de tanır — geri doldurma betiği gerekmez. Kod ASCII'dir; `toUpperCase()` burada doğru olandır (CLAUDE.md).
 */
function cetpaUretimiCariKodu(m: BelgeTipiMusterisi): boolean {
  if (typeof m.id !== 'string' || typeof m.mikroCariKod !== 'string' || m.id.length < 6) return false;
  return m.mikroCariKod === 'CAR' + m.id.slice(0, 6).toUpperCase();
}
export interface BelgeTipiSiparisi { faturaTipi?: string | null }

/** Müşterinin e-Fatura kaydından türeyen tip; kayıt durumu bilinmiyorsa null. Yalnız gerçek boolean kabul edilir. */
export function musteriBelgeTipi(musteri: BelgeTipiMusterisi | null | undefined): 'e-fatura' | 'e-arsiv' | null {
  if (musteri?.eFaturaKayitli === true) return 'e-fatura';
  if (musteri?.eFaturaKayitli === false) return musteri.eFaturaKaydiTeyitsiz === true || cetpaUretimiCariKodu(musteri) ? null : 'e-arsiv';
  return null;
}

/** Siparişin belge tipi: sipariş üzerindeki geçerli açık seçim → yoksa müşteriden → o da yoksa null (SOR). */
export function siparisBelgeTipi(siparis: BelgeTipiSiparisi, musteri: BelgeTipiMusterisi | null | undefined): BelgeTipi | null {
  const secim = siparis.faturaTipi;
  if (typeof secim === 'string' && GECERLI.includes(secim)) return secim as BelgeTipi;
  return musteriBelgeTipi(musteri);
}

/**
 * Siparişteki belge tipi müşterinin BİLİNEN e-Fatura kaydıyla çelişiyor mu? Mevcut siparişlerdeki `faturaTipi`
 * kullanıcı seçimi değil, kaldırılan sezgilerle yazıldı; çelişkide belge sessizce kesilmez — çağıran kullanıcıya sorar.
 * İhracat muaftır (yalnız elle seçilir); müşteri kaydı bilinmiyorsa / siparişte tip yoksa çelişki yoktur.
 */
export function belgeTipiCelisiyor(siparis: BelgeTipiSiparisi, musteri: BelgeTipiMusterisi | null | undefined): boolean {
  const secim = siparis.faturaTipi;
  if (secim !== 'e-fatura' && secim !== 'e-arsiv') return false;
  const kayit = musteriBelgeTipi(musteri);
  return kayit !== null && kayit !== secim;
}
