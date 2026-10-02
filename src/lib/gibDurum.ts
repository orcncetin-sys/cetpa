/**
 * gibDurum.ts — satış e-belgesinin GİB / alıcı durumu: TEK KAYNAK (sunucu taraması + istemci süzgeçleri), 2026-10-02.
 *
 * NEDEN: kullanıcı (fatura 389) «bu fatura Mikro'da iptal oldu, Cetpa'da hâlâ duruyor». Ölçüm (`GET /api/mikro/fatura-tani?sira=389`):
 * kayıt Mikro'da DURUYOR, `cha_iptal = 0`; EBelgeDurumSorgulamaV2 yanıtı **BelgeDurumKodu 2002 «Fatura red edildi»** — alıcı e-Faturayı
 * reddetmiş. Mikro'nun muhasebe tablolarında bu bilginin KOLONU YOK (sema-kesif 2026-09-28); yalnız durum sorgusundan okunur.
 * Kullanıcı kararı (2026-09-25): reddedilen / iptal fatura hesaplara GİRMEZ, yalnız İptal & İade'de görünür.
 *
 * Ölçülen yanıt biçimi: `result[0] = { StatusCode, Data, ErrorMessage, IsError }`,
 * `Data = { BelgeDurumKodu, BelgeDurumAciklamasi, ZarfDurumKodu, ZarfDurumAciklamasi, GIBDurumKodu, GIBDurumAciklamasi }`.
 * Görülen belge kodları: 1002 «Fatura zarflandı», 2001 «Fatura kabul edildi», 2002 «Fatura red edildi», 1006 «e-Arşiv faturası imzalandı».
 * RED KURALI YALNIZ ÖLÇÜLEN KOD (2002). Başka "red benzeri" kod uydurulmaz — tarama özeti kod dağılımını yazar, yeni kod orada görünür.
 */
import { ebelgeTuruCoz, EBELGE_TURU } from '../utils/muhasebe/ebelgeTuru.js';

export const GIB_RED_KODU = '2002';
export const GIB_KABUL_KODU = '2001';

export interface GibDurum {
  belgeKodu: string; belgeAciklama: string;
  zarfKodu: string; zarfAciklama: string;
  gibKodu: string; gibAciklama: string;
  /** Sorgunun yapıldığı tip: 0 e-Fatura, 1 e-Arşiv. */
  eBelgeTipi: 0 | 1;
  /** Durumun SORULDUĞU ETTN (küçük harf) — tarama yazar. Durum bu belge için geçerlidir; kayıt yeni ETTN ile yeniden gönderilirse eskir. */
  ettn?: string;
}

const metin = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Durum yanıtının `Data`'sından alanlar — AYNEN. Belge kodu yoksa null (durum BİLİNMİYOR; boş kayıt yazılmaz). */
export function gibDurumCoz(data: unknown, eBelgeTipi: 0 | 1): GibDurum | null {
  if (!nesneMi(data)) return null;
  const belgeKodu = metin(data.BelgeDurumKodu);
  if (!belgeKodu) return null;
  return {
    belgeKodu, belgeAciklama: metin(data.BelgeDurumAciklamasi),
    zarfKodu: metin(data.ZarfDurumKodu), zarfAciklama: metin(data.ZarfDurumAciklamasi),
    gibKodu: metin(data.GIBDurumKodu), gibAciklama: metin(data.GIBDurumAciklamasi),
    eBelgeTipi,
  };
}

export const gibRedMi = (d: Pick<GibDurum, 'belgeKodu'>): boolean => d.belgeKodu === GIB_RED_KODU;
/** Bir daha değişmeyecek durum: alıcı kabul etti ya da reddetti. */
export const gibDurumKesin = (d: Pick<GibDurum, 'belgeKodu'>): boolean => d.belgeKodu === GIB_RED_KODU || d.belgeKodu === GIB_KABUL_KODU;

/** `mikroFaturalar` dokümanı alıcı tarafından reddedilmiş mi — taramanın yazdığı bayrak. Bayrak yoksa reddedilmiş SAYILMAZ. */
export const gibReddedildi = (doc: Readonly<Record<string, unknown>>): boolean => doc.gibRed === true;

/**
 * Dokümandaki ETTN (`cha_uuid`; kolon adı kurulumda farklı harf büyüklüğüyle gelebilir). Mikro uniqueidentifier değerini SÜSLÜ
 * PARANTEZLE döndürüyor (ölçüldü 2026-10-02: `mikroFaturalar` kimlikleri 38 karakter, `{…}`) — parantez soyulur; soyulmasa 36
 * karakterlik biçim denetimi HER faturayı "ETTN'siz" diye eler ve tarama sessizce hiçbir şey sormazdı.
 */
export function faturaEttn(doc: Readonly<Record<string, unknown>>): string {
  const k = Object.keys(doc).find(a => a.toLowerCase() === 'cha_uuid');
  return k ? metin(doc[k]).replace(/^\{|\}$/g, '') : '';
}
const ETTN_BICIMI = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
const ettnGecerli = (v: string): boolean => ETTN_BICIMI.test(v) && !/^[0-]+$/.test(v);

export type TaramaAtlamaNedeni = 'satis-degil' | 'ettn-yok' | 'tur-bilinmiyor' | 'kesin' | 'eski';
export type TaramaKarari = { aday: { ettn: string; eBelgeTipi: 0 | 1 } } | { atla: TaramaAtlamaNedeni };

/** Ticari faturada ret süresi 8 gün; durum bu pencereden sonra yeniden sorulmaz (kesin durumlar hiç sorulmaz). */
export const TARAMA_PENCERESI_GUN = 45;

/**
 * Bu fatura için GİB durumu SORULMALI mı? Yalnız SATIŞ faturası, geçerli ETTN ve türü BİLİNEN belge sorulur (tür = EBelgeTipi;
 * yanlış tiple sorgu «İlgili e-belge bulunamadı» döner). Durumu hiç yazılmamış fatura yaşına bakılmadan bir kez sorulur; yazılmış
 * ama kesin olmayan durum yalnız pencere içindeyken yenilenir.
 */
export function taramaKarari(doc: Readonly<Record<string, unknown>>, bugun: Date, pencereGun = TARAMA_PENCERESI_GUN): TaramaKarari {
  const tur = ebelgeTuruCoz(doc);
  if (tur === EBELGE_TURU.bilinmiyor) {
    const satis = doc.cha_tip !== null && doc.cha_tip !== undefined && doc.cha_tip !== '' && Number(doc.cha_tip) === 0;
    return { atla: satis ? 'tur-bilinmiyor' : 'satis-degil' };
  }
  const ettn = faturaEttn(doc);
  if (!ettnGecerli(ettn)) return { atla: 'ettn-yok' };
  const eBelgeTipi: 0 | 1 = tur === EBELGE_TURU.eArsiv ? 1 : 0;
  const onceki = nesneMi(doc.gibDurum) ? doc.gibDurum : null;
  const oncekiKod = onceki ? metin(onceki.belgeKodu) : '';
  // Durum, sorulduğu ETTN için geçerlidir (inceleme 2026-10-02): reddedilen evrak Mikro'da düzeltilip YENİ ETTN ile gönderilirse
  // (aynı cha_Guid, yeni cha_uuid) eski «2002 — kesin» kaydı yeni belgeyi kalıcı olarak hesap dışı bırakırdı → yeniden sorulur.
  // `ettn` alanı olmayan eski kayıt bugünkü davranışı korur (geriye dönük sorgu fırtınası yok).
  const oncekiEttn = onceki ? metin(onceki.ettn).toLowerCase() : '';
  if (oncekiEttn && oncekiEttn !== ettn.toLowerCase()) return { aday: { ettn, eBelgeTipi } };
  if (oncekiKod) {
    if (gibDurumKesin({ belgeKodu: oncekiKod })) return { atla: 'kesin' };
    const tarih = typeof doc.cha_tarihi === 'string' ? doc.cha_tarihi.slice(0, 10) : '';
    const esik = new Date(bugun.getTime() - pencereGun * 864e5).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih) || tarih < esik) return { atla: 'eski' };
  }
  return { aday: { ettn, eBelgeTipi } };
}
