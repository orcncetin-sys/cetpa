/**
 * MagazaTalepleri.tsx — Siparişler ekranının üçüncü kaynak sekmesi: mağazadan (www.cetpa.com.tr) gelen sipariş
 * TALEPLERİ (dilim 1, 2026-10-08). Kullanıcı kararı K1: talep `orders`'a yazılmaz; ayrı koleksiyon, ayrı sekme.
 *
 * DİLİM 2a (şartname v6 § 5.2, 2026-10-10) — liste + detay + İŞLEM: aşama rozeti ve ilerlet / geri al / iptal, müşteriye
 * görünen not, kalem kalem «teslim edildi» işareti, bildirimi «Yeniden gönder», arama kutusu (barkod + Enter), «Etiket
 * basıldı» satırı (salt okunur).
 *
 * DİLİM 2b (şartname v6 § 10.4 + V24, 2026-10-10) — İÇERİK: detayda «Düzenle» (müşteri bilgileri, not, teyit edilen kalemler —
 * form `MagazaTalepDuzenle.tsx`), liste başında «Yeni talep (elle)», yalnız Yönetici'ye «Sil» ve «Geri al» (silme YUMUŞAKTIR),
 * revize bildirimi rozeti + «Yeniden gönder», «ERP'de açıldı» imi. İKİ TABLO yan yana: «Talep edilen (sitede görülen)» —
 * müşterinin BEYANI, hiçbir yazma yolunda değişmez (V16) — ve «Teyit edilen» (yoksa «henüz teyit edilmedi»). Teslim kutuları
 * AKTİF kaynaktadır: teyit varsa teyit satırlarında (`t:` anahtarı), beyan tablosu salt okunur. Liste süzgeci DÖRT düğmedir
 * (V24): Açık · Kapalı · Silinen / İptal · Hepsi — kural ve sayılar `lib/magazaTalep.ts` `magazaSuzgecle` / `magazaSuzgecSayilari`;
 * «silinenleri gizle» kutusu YOKTUR (varsayılan görünüm silinenleri zaten gizler). Silinmiş talep DONUKTUR: aşama, not,
 * içerik, kalem teslim ve bildirim düğmeleri çizilmez; «Geri al» yalnız «Silinen / İptal» sekmesinde ve yalnız Yönetici'de.
 * «Sekmede» = sekme düğmesi SEÇİLİ ÇİZİLİYKEN: arama doluyken süzgeç yok sayılır ve hiçbir sekme seçili değildir, bu yüzden
 * aramayla açılan silinmiş talepte «Geri al» çizilmez — yerinde «aramayı temizleyip sekmeye geçin» ipucu durur (düğmenin
 * görünürlüğü ekranda GÖRÜNMEYEN süzgeç durumuna bağlı değildir; inceleme 2b, bulgu 4).
 *
 * BİLEŞEN İSTEK ATMAZ: yazma altı nitelikten gelir (`onDurumDegistir`, `onKalemTeslim`, `onBildirimGonder`, `onIcerikKaydet`,
 * `onSil`, `onElleTalep` — OrdersPage `services/magazaTalepIstemcisi.ts` işlevlerini verir); `urunKdvOrani` da OrdersPage'den
 * gelir (ürün listesinin TAMAMI bileşene geçmez). SİLME YETKİSİ nitelikle taşınır: `onSil` `null` ise bu rol silemez / geri
 * alamaz ve düğmeler çizilmez (rol karşılaştırması burada YOK — OrdersPage `magazaTalepSilmeYetkisi`'ni okur; hüküm sunucuda).
 * Koleksiyona istemciden yazmak zaten kapalıdır (`lib/rbac.ts` SUNUCU_YAZAR_COLLECTIONS). İYİMSER GÜNCELLEME YOK: aşama,
 * işaret, içerik, silme ve bildirim rozeti akıştan gelen belgeyle çizilir.
 * Her yazım satırın ekranda görülen `durumSurum`'unu geri gönderir (sunucuda CAS); 409'da «başka biri değiştirdi» uyarısı
 * basılır, rozet yanıttaki güncel aşamayı gösterir ve akış o sürümü geçene kadar o talebin işlem düğmeleri kilitlenir
 * (bayat sürümle ikinci istek yine 409 alırdı). Akış gelmezse kilit `MAGAZA_AKIS_BEKLEME_MS` sonra kendiliğinden açılır.
 *
 * KURALLAR TEK KAYNAKTAN: geçiş tablosu `magazaIzinliGecisler` / `magazaGecisi`, liste süzgeci `magazaSuzgecle` /
 * `magazaSuzgeceUyar` (aşaması okunamayan satır AÇIKTIR — listeden kaybolmaz), kalem teslim işlevleri (`magazaKalemAnahtarlari`,
 * `magazaKalemTeslimMi`, `magazaTeslimIsaretsiz`, `magazaGuncellemeZamani`), bildirim rozeti (`bildirimGorunumu`,
 * `magazaYenidenGonderilebilir`) — hepsi `lib/magazaTalep.ts`; site paneli ve takip ucu aynı işlevleri okur. Bu dosyada
 * kopya aşama / işaret karşılaştırması yazılmaz.
 *
 * TUTARLAR BEYANDIR: `talepFiyat` ve `talepEdilen.*` müşterinin SİTEDE GÖRDÜĞÜ rakamlardır — onaylanmış fiyat ya da ERP
 * tutarı değildir ve ekranda öyle yazılır. Ekran kalemlerden toplam TÜRETMEZ (adet × fiyat satır tutarı da basılmaz).
 * `null` = BİLİNMİYOR: toplamda '—', kalemde «fiyat sorulacak» (₺0,00 DEĞİL). Fiyatı sorulacak kalem varken toplam tek
 * başına basılmaz; yanına «eksik — N kalemin fiyatı sorulacak» yazılır.
 *
 * VERİ DIŞARIDAN GELİR: bileşen kendi aboneliğini AÇMAZ; `hooks/useMagazaTalepleri` OrdersPage gövdesinde çağrılır
 * (yetkisiz rolde abonelik hiç açılmaz, sekme düğmesi de çizilmez). Müşterinin yazdığı her metin (ad, adres, not…)
 * React metin düğümü olarak basılır; telefon / e-posta yalnız doğrulanmış değerle `tel:` / `mailto:` bağlantısı olur.
 *
 * BOYUT (bilinen risk): koleksiyon kimliksiz uçtan, kotasız büyür. Akış init'i en çok STREAM_INIT_MAX_ROWS (varsayılan
 * 20.000) satır yollar; üstünde sunucu SIRASIZ kırpar ve istemci `truncated` işaretini OKUMAZ — o noktadan sonra «en yeni
 * 200» ve «daha eski N» güvenilmez, en yeni talep listede olmayabilir (tek IP'den ~7 günde ulaşılır). Tavanın altında ekran
 * süzgeçten geçen en yeni `MAGAZA_TALEP_EKRAN_SINIRI` talebi çizer, gerisini SAYAR («daha eski N talep», «çizilmeyen N açık
 * talep»). Saklama / arşiv bu dilimde de YOK (2b'nin yumuşak silmesi listeyi küçültmez).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { paraYaz } from '../../utils/currency';
import { tarihSaatYaz, zamanDate } from '../../utils/zaman';
import { magazaTalepDurumEtiketi, magazaTalepDurumRengi, magazaKalemTeslimEtiketi, magazaKalemTeslimRengi } from '../../utils/durumEtiketi';
import { oc } from '../../i18n/ortak';
import { op } from '../../i18n/orders';
import {
  MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_DURUM_ACIKLAMA_SINIRI, MAGAZA_DURUM_SUZGECLERI,
  bildirimGorunumu, bildirimBeklemeBaslangiciMs, magazaYenidenGonderilebilir,
  magazaGecisi, magazaIzinliGecisler,
  magazaSuzgecle, magazaSuzgeceUyar, magazaSuzgecSayilari, magazaSilinmisMi,
  magazaTeslimKaynagi, magazaKalemAnahtarlari, magazaKalemTeslimMi, magazaTeslimIsaretsiz, magazaGuncellemeZamani,
  type BildirimGorunumu, type MagazaBildirim, type MagazaBildirimHataSinifi, type MagazaDurumSuzgeci, type MagazaRevizeAlani, type MagazaTalepAsamasi,
} from '../../lib/magazaTalep';
import { magazaTalepAramasi } from '../../lib/magazaTalepAramasi';
import { confirmAction } from '../../lib/confirm';
import { magazaTalepOlusturmaMs, type MagazaTalepSatiri, type MagazaSatirSilindi } from '../../hooks/useMagazaTalepleri';
import MagazaTalepDuzenle, { type MagazaFormSonucu } from './MagazaTalepDuzenle';
// Yalnız TİP: bu dosya istek atmaz; yazma işlevlerinin kendisi OrdersPage'den nitelik olarak gelir.
import type {
  MagazaDurumGirdisi, MagazaDurumSonucu, MagazaKalemTeslimGirdisi, MagazaKalemTeslimSonucu, MagazaBildirimGonderSonucu,
  MagazaIcerikGirdisi, MagazaIcerikSonucu, MagazaSilGirdisi, MagazaSilSonucu, MagazaElleTalepGirdisi, MagazaElleTalepSonucu,
} from '../../services/magazaTalepIstemcisi';

// Arama süzgecinin kuralı `lib/magazaTalepAramasi.ts`'te (saf, yaprak); ekranın dışa açtığı ad budur (§ 5.2).
export { magazaTalepAramasi };

type Dil = 'tr' | 'en';

/** Ekranda çizilen en yeni talep sayısı; fazlası sayılır, çizilmez. */
export const MAGAZA_TALEP_EKRAN_SINIRI = 200;

/**
 * Bir yazımdan (ya da 409'dan) sonra akışın yeni sürümü getirmesi en çok bu kadar beklenir; o süre boyunca talebin işlem
 * düğmeleri kilitlidir. Akış kopuksa kilit bu sürenin sonunda açılır — düğmeler sonsuza dek pasif kalmaz.
 */
export const MAGAZA_AKIS_BEKLEME_MS = 5_000;

// ── Saf görünüm kuralları (testleri: MagazaTalepleri.test.tsx) ──────────────────────────────────────────────────────

export interface MagazaTalepGorunumu {
  /** Çizilecek satırlar: en yeni önce; `olusturma`'sı çözülemeyenler SONDA. */
  gorunen: MagazaTalepSatiri[];
  /** Sınır yüzünden çizilmeyen (daha eski) talep sayısı. */
  dahaEski: number;
  /** Sınır yüzünden çizilmeyen, tarihi okunamayan talep sayısı («daha eski» DENEMEZ — ne zaman geldiği bilinmiyor). */
  gizliTarihsiz: number;
  /** Sınır yüzünden çizilmeyenlerden AÇIK olanların sayısı («Açık» süzgecinin ölçütü: silinmemiş VE aşaması açık / okunamayan). */
  cizilmeyenAcik: number;
}

/**
 * Sıralama + ekran sınırı. Tarihi çözülemeyen talep ATILMAZ ve en-yeni sınırına SAYILMAZ: tarihlilerin ardından
 * (kendi sınırıyla) çizilir — «en yeni 200» içine girip gerçek bir talebi ekrandan itmesin, kendisi de kaybolmasın.
 */
export function magazaTalepGorunumu(talepler: readonly MagazaTalepSatiri[], sinir: number = MAGAZA_TALEP_EKRAN_SINIRI): MagazaTalepGorunumu {
  const tarihli: Array<{ t: MagazaTalepSatiri; ms: number }> = [];
  const tarihsiz: MagazaTalepSatiri[] = [];
  for (const t of talepler) {
    const ms = magazaTalepOlusturmaMs(t);
    if (ms === null) tarihsiz.push(t); else tarihli.push({ t, ms });
  }
  // Eşit saatte kimlik: sıra her çizimde AYNI kalsın (akış önbelleğinin sırası değişebilir).
  tarihli.sort((a, b) => b.ms - a.ms || a.t.id.localeCompare(b.t.id));
  tarihsiz.sort((a, b) => a.id.localeCompare(b.id));
  const gorunenTarihli = tarihli.slice(0, sinir).map(x => x.t);
  const gorunenTarihsiz = tarihsiz.slice(0, sinir);
  const cizilmeyen = [...tarihli.slice(sinir).map(x => x.t), ...tarihsiz.slice(sinir)];
  return {
    gorunen: [...gorunenTarihli, ...gorunenTarihsiz],
    dahaEski: tarihli.length - gorunenTarihli.length,
    gizliTarihsiz: tarihsiz.length - gorunenTarihsiz.length,
    cizilmeyenAcik: cizilmeyen.filter(t => magazaSuzgeceUyar(t, 'acik')).length,
  };
}

export interface MagazaTalepListesi extends MagazaTalepGorunumu {
  /** Süzgeçlerden geçen talepler — sıralama ve ekran sınırından ÖNCE (Enter'daki «tam bir eşleşme» bunu sayar). */
  suzulen: MagazaTalepSatiri[];
}

/**
 * Listenin tamamı, sırayla: durum süzgeci → arama → sıralama + 200 sınırı. Süzgecin kuralı (V24: Açık · Kapalı · Silinen /
 * İptal · Hepsi) bu dosyada DEĞİL, `lib/magazaTalep.ts` `magazaSuzgecle`'dedir. Arama metni doluyken durum süzgeci YOK sayılır
 * ve arama kümesi silinmişler DÂHİL bütün taleplerdir: barkodu okunan kapalı, iptal ya da silinmiş talep de bulunur
 * (silinmiş satır «Silindi» rozetiyle). Sayımlar (`dahaEski`, `cizilmeyenAcik`) süzülmüş kümeden yapılır.
 */
export function magazaTalepListesi(
  talepler: readonly MagazaTalepSatiri[], suzgec: MagazaDurumSuzgeci, arama: string, sinir: number = MAGAZA_TALEP_EKRAN_SINIRI,
): MagazaTalepListesi {
  const suzulen = arama.trim() === '' ? magazaSuzgecle(talepler, suzgec) : magazaTalepAramasi([...talepler], arama);
  return { ...magazaTalepGorunumu(suzulen, sinir), suzulen };
}

/** Fiyatı sorulacak (müşteri sitede fiyat GÖRMEDİ) kalem sayısı. */
export function fiyatiSorulacakKalemSayisi(t: Pick<MagazaTalepSatiri, 'kalemler'>): number {
  return t.kalemler.filter(k => k.talepFiyat === null).length;
}

/** Talep edilen toplam EKSİK mi: sunucunun işareti YA DA fiyatsız kalem (işaret eski / bozuk dokümanda eksik olabilir). */
export function toplamEksikMi(t: Pick<MagazaTalepSatiri, 'kalemler' | 'fiyatiSorulacakVar'>): boolean {
  return t.fiyatiSorulacakVar || fiyatiSorulacakKalemSayisi(t) > 0;
}

/**
 * Şu an «gönderiliyor» görünen rozetlerin uyarıya döneceği EN YAKIN an (ms); yoksa `null`. Rozet kuralı ve bekleme
 * başlangıcı (`max(taban, b.zaman)` — kapı 4, Y2) `lib/magazaTalep.ts`'tedir; burada kopyası yoktur. İKİ rozet sayılır:
 * ilk bildirim (`bildirim`, taban `olusturma`) ve — varsa — revize bildirimi (`bildirimRevize`, taban `icerikZamani`).
 * Revize alanı `null` / yok ise o talep için ikinci çağrı YAPILMAZ (alan yoksa revizyon yoktur — kapı 4, Y14).
 */
export function sonrakiBeklemeEsigi(
  talepler: readonly (Pick<MagazaTalepSatiri, 'olusturma' | 'bildirim'> & Partial<Pick<MagazaTalepSatiri, 'icerikZamani' | 'bildirimRevize'>>)[], simdiMs: number,
): number | null {
  let enYakin: number | null = null;
  const bak = (b: MagazaBildirim | null, taban: string | undefined): void => {
    if (bildirimGorunumu(b, taban, simdiMs).tur !== 'gonderiliyor') return;
    const baslangic = bildirimBeklemeBaslangiciMs(b, taban);
    if (baslangic === null) return;   // «gönderiliyor» ise başlangıç çözülmüştür; derleyici için
    const esik = baslangic + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS;
    if (enYakin === null || esik < enYakin) enYakin = esik;
  };
  for (const t of talepler) {
    bak(t.bildirim, t.olusturma);
    if (t.bildirimRevize !== undefined && t.bildirimRevize !== null) bak(t.bildirimRevize, t.icerikZamani);
  }
  return enYakin;
}

/** `tel:` bağlantısı — yalnız 10–15 rakamlık (isteğe bağlı `+`) numara; değilse `null` (düz metin basılır). */
export function telBaglantisi(telefon: string): string | null {
  const sade = telefon.replace(/[\s().-]/g, '');
  return /^\+?\d{10,15}$/.test(sade) ? `tel:${sade}` : null;
}

/**
 * `mailto:` bağlantısı — yalnız dar bir adres deseni. `?`, `&`, `=`, `%`, boşluk ve satır sonu taşıyan değer bağlantı
 * OLMAZ: `mailto:` adresine konu / gövde / ek alıcı eklenebilir (`?bcc=…`); müşterinin yazdığı metin bunu yapamamalı.
 */
export function epostaBaglantisi(eposta: string): string | null {
  return eposta.length <= 254 && /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(eposta) ? `mailto:${eposta}` : null;
}

// ── İşlem durumu (talep başına) ─────────────────────────────────────────────────────────────────────────────────────

/** İstek sonucunun ekrandaki iletisi — kapalı küme; sunucunun `error` metni ekrana TAŞINMAZ. */
type IletiKodu =
  | 'degisti' | 'yetki' | 'ag' | 'bulunamadi' | 'silindi' | 'silinmemis'
  | 'bildirim-kuyrukta' | 'bildirim-ayar-eksik' | 'bildirim-kapali' | 'bildirim-zaten-gitti' | 'bildirim-revize-yok'
  | 'icerik-kaydedildi';

interface SatirIletisi {
  kod: IletiKodu;
  /** Yalnız `bildirim-ayar-eksik`: ortam değişkeni ADLARI (değer / sır değil). */
  eksik?: string[];
}

/**
 * Liste düzeyindeki bilgi iletisi — satırı listeden ÇIKARAN ya da henüz satırı olmayan işlemler için (satırın altına yazılan
 * ileti satırla birlikte kaybolurdu): elle talep açıldı, talep silindi, talep geri alındı. `talepNo` okunamadıysa `null`.
 */
interface ListeIletisi {
  kod: 'elle-acildi' | 'silme-tamam' | 'geri-alma-tamam';
  talepNo: string | null;
}

interface SatirIslemi {
  /** İstek uçuşta: o talebin bütün işlem düğmeleri pasif (ikinci tıklama kuyruğa alınmaz). */
  mesgul?: true;
  /**
   * Yazımın (ya da 409'un) gönderildiği sürüm. Akış bu sürümü GEÇENE kadar (ya da `bitisMs`'e kadar) aşama / not / kalem
   * düğmeleri kilitlidir; `asama` 409 gövdesindeki güncel aşamadır — rozet akış gelene kadar onu basar.
   */
  bekleyen?: { surum: number; bitisMs: number; asama?: MagazaTalepAsamasi };
  ileti?: SatirIletisi;
  /** `sevk` → `teslim` öncesi «N kalem teslim işaretsiz» onayı açık. */
  teslimOnayi?: true;
}

/**
 * Kalem teslim işareti bu aşamada yazılamaz mı: `iptal` ve aşaması okunamayan talep (sunucu da 409 `gecis-yok` döner).
 * Diğer beş aşamada — `yeni` ve `teslim` dâhil — serbesttir. Kutuların çizimi ve işleyici AYNI kuralı okur. Silinmiş talepte
 * kutu hiç ÇİZİLMEZ (talep donuktur — sunucu 409 `silindi` döner); o denetim `magazaSilinmisMi` ile ayrıca yapılır.
 */
const teslimYazilamaz = (durum: MagazaTalepAsamasi | null): boolean => durum === null || durum === 'iptal';

const kilitSuruyor = (i: SatirIslemi | undefined, t: Pick<MagazaTalepSatiri, 'durumSurum'>, simdiMs: number): boolean =>
  i?.bekleyen !== undefined && i.bekleyen.surum === t.durumSurum && simdiMs < i.bekleyen.bitisMs;

/**
 * İçerik yazımının akış beklemesi — `durumSurum` kilidinden AYRI (içerik yazımı `icerikSurum`'u ilerletir, `durumSurum`'a
 * dokunmaz). Kayıttan sonra akış yeni `icerikSurum`'u getirene kadar (en çok `MAGAZA_AKIS_BEKLEME_MS`) «Düzenle» kilitlidir:
 * o arada açılan form bayat içeriği ve bayat sürümü yakalar, kaydı kişinin KENDİ yazımıyla 409 `surum-eski` alırdı.
 */
interface IcerikBeklemesi { surum: number; bitisMs: number }
const icerikKilidiSuruyor = (b: IcerikBeklemesi | undefined, t: Pick<MagazaTalepSatiri, 'icerikSurum'>, simdiMs: number): boolean =>
  b !== undefined && b.surum === t.icerikSurum && simdiMs < b.bitisMs;

// ── Metinler ────────────────────────────────────────────────────────────────────────────────────────────────────────

const HATA_SINIFI_ETIKETI: Record<MagazaBildirimHataSinifi, Record<Dil, string>> = {
  kimlik: { tr: 'kimlik doğrulama', en: 'authentication' },
  tls: { tr: 'TLS / sertifika', en: 'TLS / certificate' },
  baglanti: { tr: 'bağlantı', en: 'connection' },
  'gonderen-reddi': { tr: 'gönderen reddi', en: 'sender rejected' },
  'alici-reddi': { tr: 'alıcı reddi', en: 'recipient rejected' },
  diger: { tr: 'diğer', en: 'other' },
};

const BEKLEME_DAKIKA = Math.round(MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS / 60_000);

/** Dört süzgeç düğmesinin etiketi (V24); sıra ve küme `MAGAZA_DURUM_SUZGECLERI` — burada yeniden yazılmaz. */
const SUZGEC_ETIKETI: Record<MagazaDurumSuzgeci, Record<Dil, string>> = {
  acik: { tr: 'Açık', en: 'Open' },
  kapali: { tr: 'Kapalı', en: 'Closed' },
  silinenIptal: { tr: 'Silinen / İptal', en: 'Deleted / Cancelled' },
  hepsi: { tr: 'Hepsi', en: 'All' },
};

/**
 * İki kalem tablosunun başlığı (V16: ikisi de ekranda, yan yana). `beyan` müşterinin sitede gördüğü ve gönderdiği içeriktir —
 * hiçbir yazma yolunda değişmez; `teyit` personelin teyit ettiği içeriktir (yoksa «henüz teyit edilmedi»).
 */
const KALEM_KAYNAGI_BASLIGI: Record<'beyan' | 'teyit', Record<Dil, string>> = {
  beyan: { tr: 'Talep edilen (sitede görülen)', en: 'Requested (as shown on the site)' },
  teyit: { tr: 'Teyit edilen', en: 'Confirmed' },
};

/** Revize bildiriminin «değişen alan» ADLARI (değer basılmaz; adlar sunucunun ölçtüğü `alanlar` listesinden). */
const REVIZE_ALANI_ETIKETI: Record<MagazaRevizeAlani, Record<Dil, string>> = {
  musteri: { tr: 'müşteri bilgileri', en: 'customer details' },
  not: { tr: 'müşteri notu', en: 'customer note' },
  teyit: { tr: 'teyit edilen kalemler', en: 'confirmed items' },
};

const ILETI_METNI: Record<Exclude<IletiKodu, 'bildirim-ayar-eksik'>, Record<Dil, string>> = {
  degisti: {
    tr: 'Başka biri değiştirdi — liste güncelleniyor; güncel durumu görüp yeniden deneyin.',
    en: 'Someone else changed this request — the list is refreshing; check the current state and try again.',
  },
  yetki: { tr: 'Bu işlem için yetkiniz yok.', en: 'You are not authorised for this action.' },
  ag: { tr: 'Bağlantı hatası, yeniden deneyin.', en: 'Connection error, please try again.' },
  bulunamadi: { tr: 'Talep bulunamadı.', en: 'Request not found.' },
  silindi: { tr: 'Talep silinmiş; işlem yapılamaz.', en: 'The request has been deleted; no action is possible.' },
  silinmemis: { tr: 'Talep silinmiş değil; geri alınacak bir şey yok.', en: 'The request is not deleted; there is nothing to restore.' },
  'bildirim-kuyrukta': { tr: 'Bildirim kuyruğa alındı.', en: 'Notification queued.' },
  // Ayar ADI çevrilmez: sunucudaki ortam değişkeninin kendisidir.
  'bildirim-kapali': { tr: 'Bildirim bu sunucuda kapalı (MAGAZA_BILDIRIM=kapali)', en: 'Notifications are turned off on this server (MAGAZA_BILDIRIM=kapali)' },
  'bildirim-zaten-gitti': { tr: 'Bildirim zaten gönderilmiş', en: 'The notification has already been sent' },
  'bildirim-revize-yok': { tr: 'Bu talepte gönderilecek revize bildirimi yok.', en: 'This request has no revision notice to send.' },
  'icerik-kaydedildi': { tr: 'İçerik kaydedildi.', en: 'Content saved.' },
};

function iletiMetni(i: SatirIletisi, dil: Dil): string {
  if (i.kod !== 'bildirim-ayar-eksik') return ILETI_METNI[i.kod][dil];
  const taban = dil === 'tr' ? 'Sunucu posta ayarı eksik' : 'Server mail setting missing';
  // Adlar yanıttan gelir (ör. `APP_URL`); ekran tahmin etmez, değer basmaz. Liste boşsa iki nokta da yok.
  return i.eksik !== undefined && i.eksik.length > 0 ? `${taban}: ${i.eksik.join(', ')}` : taban;
}

/** `bildirim-kuyrukta` ve `icerik-kaydedildi` bilgidir; diğer her ileti uyarı olarak okunur. */
const iletiBilgiMi = (i: SatirIletisi): boolean => i.kod === 'bildirim-kuyrukta' || i.kod === 'icerik-kaydedildi';

function listeIletiMetni(i: ListeIletisi, dil: Dil): string {
  const tr = dil === 'tr';
  const no = i.talepNo === null ? '' : ` ${i.talepNo}`;
  if (i.kod === 'elle-acildi') {
    return tr
      ? `Talep açıldı:${no === '' ? ' numarası listede' : no}. «Yeni» aşamasında; bildirim e-postası kuyruğa alındı.`
      : `Request opened:${no === '' ? ' see the list for its number' : no}. It is at the “New” stage; the notification e-mail has been queued.`;
  }
  if (i.kod === 'silme-tamam') {
    return tr
      ? `Talep${no} silindi. Kayıt durur: «Silinen / İptal» sekmesinde görünür ve oradan geri alınabilir.`
      : `Request${no} deleted. The record is kept: it is listed under “Deleted / Cancelled” and can be restored from there.`;
  }
  return tr ? `Talep${no} geri alındı; yeniden canlı listede.` : `Request${no} restored; it is back in the live list.`;
}

function eksikNotu(t: MagazaTalepSatiri, dil: Dil): string {
  const n = fiyatiSorulacakKalemSayisi(t);
  if (dil === 'tr') return n > 0 ? `eksik — ${n} kalemin fiyatı sorulacak` : 'eksik — fiyatı sorulacak kalem var';
  return n > 0 ? `incomplete — price to be quoted for ${n} item${n === 1 ? '' : 's'}` : 'incomplete — some items need a price quote';
}

/**
 * Bildirim e-postasının detaydaki açıklaması — İKİ bildirim AYNI işlevden: ilk bildirim (`revize` yanlış) ve içerik
 * revizyonunun bildirimi (`revize` doğru; yalnız adlandırma değişir). Durum kuralı burada DEĞİL, `g`'dedir (`bildirimGorunumu`).
 */
function bildirimAciklamasi(b: MagazaBildirim | null, g: BildirimGorunumu, dil: Dil, revize: boolean): string {
  const tr = dil === 'tr';
  const ad = revize ? (tr ? 'Revize bildirimi e-postası' : 'Revision notice e-mail') : (tr ? 'Bildirim e-postası' : 'Notification e-mail');
  const adIng = revize ? 'The revision notice e-mail' : 'The notification e-mail';
  const gitmedi = revize
    ? (tr ? 'Bu revizyon için e-posta gitmedi.' : 'No e-mail went out for this revision.')
    : (tr ? 'Bu talep için e-posta gitmedi.' : 'No e-mail went out for this request.');
  if (g.tur === 'isaretsiz') {
    const zaman = b === null ? '—' : tarihSaatYaz(b.zaman, undefined, dil);
    return tr ? `${ad} gönderildi (${zaman}).` : `${ad} sent (${zaman}).`;
  }
  if (g.tur === 'gonderiliyor') return tr ? `${ad} gönderiliyor.` : `${ad} is being sent.`;
  if (g.neden === 'gonderilemedi') {
    return tr ? `${ad} gönderilemedi — denemeler tükendi. ${gitmedi}` : `${adIng} could not be sent — retries exhausted. ${gitmedi}`;
  }
  if (g.neden === 'yapilandirilmamis') {
    // Hangi ayarın eksik olduğu burada SÖYLENMEZ (yerel kipte eksik olan adres ayarı olabilir): ad, düğmeye basılınca yanıttan gelir.
    return tr
      ? `Sunucu posta ayarı eksik; Yeniden gönder ile denenebilir. ${gitmedi}`
      : `A server mail setting is missing; it can be retried with Resend. ${gitmedi}`;
  }
  if (g.neden === 'bekleme-asildi') {
    return tr ? `${ad} ${BEKLEME_DAKIKA} dakikadan uzun süredir gönderilemedi.` : `${adIng} has not been sent for more than ${BEKLEME_DAKIKA} minutes.`;
  }
  return revize
    ? (tr ? 'Revize bildirimi durumu okunamadı.' : 'The revision notice status could not be read.')
    : (tr ? 'Bildirim durumu okunamadı.' : 'The notification status could not be read.');
}

/** Gönderilmemiş bildirimin ek bilgisi: başarısız deneme sayısı ve hata SINIFI (hata metni değil). Gönderilmiş bildirimde basılmaz. */
function bildirimEkleri(b: MagazaBildirim | null, g: BildirimGorunumu, dil: Dil): ReactNode {
  if (g.tur === 'isaretsiz' || b === null) return null;
  const tr = dil === 'tr';
  return (
    <>
      {b.deneme !== undefined && <> {tr ? `Başarısız deneme: ${b.deneme}.` : `Failed attempts: ${b.deneme}.`}</>}
      {b.hataSinifi !== undefined && <> {tr ? `Hata sınıfı: ${HATA_SINIFI_ETIKETI[b.hataSinifi].tr}.` : `Error class: ${HATA_SINIFI_ETIKETI[b.hataSinifi].en}.`}</>}
    </>
  );
}

/** Bildirim açıklamasının rengi: kesin sonuç kırmızı, süren bekleme / okunamayan sarı, diğerleri gri. */
const bildirimAciklamaRengi = (g: BildirimGorunumu): string =>
  (g.tur === 'uyari' ? (g.neden === 'gonderilemedi' || g.neden === 'yapilandirilmamis' ? 'text-red-700' : 'text-yellow-700') : 'text-gray-500');

/** Revizyonda değişen alanların adları, virgülle; liste boşsa (okunamadı) `null`. */
function revizeAlanMetni(alanlar: readonly MagazaRevizeAlani[], dil: Dil): string | null {
  return alanlar.length === 0 ? null : alanlar.map(a => REVIZE_ALANI_ETIKETI[a][dil]).join(', ');
}

/** Silinmiş talebin «kim, ne zaman, nereden» satırı; okunamayan ad '—' (silen bilinmiyor diye talep canlı sayılmaz). */
function silindiMetni(s: MagazaSatirSilindi, dil: Dil): string {
  const tr = dil === 'tr';
  const kanal = s.kanal === 'panel' ? (tr ? 'site paneli' : 'site panel') : s.kanal === 'erp' ? 'ERP' : '—';
  return `${tarihSaatYaz(s.zaman, undefined, dil)} · ${s.kim.ad.trim() === '' ? '—' : s.kim.ad} · ${kanal}`;
}

/** Geçiş düğmesinin adı — tür `magazaGecisi`'nden; hedef aşamanın etiketi `durumEtiketi.ts`'ten. */
function gecisEtiketi(onceki: MagazaTalepAsamasi, hedef: MagazaTalepAsamasi, iptalOncesi: MagazaTalepSatiri['iptalOncesi'], dil: Dil): string {
  const tr = dil === 'tr';
  const g = magazaGecisi(onceki, hedef, iptalOncesi);
  const ad = magazaTalepDurumEtiketi(hedef, dil);
  if (!g.izinli) return ad;   // çizilmez: düğmeler `magazaIzinliGecisler`'den gelir; derleyici için
  if (g.tur === 'ileri') return tr ? `İlerlet: ${ad}` : `Advance: ${ad}`;
  if (g.tur === 'geri') return tr ? `Geri al: ${ad}` : `Step back: ${ad}`;
  if (g.tur === 'iptal') return tr ? 'Talebi iptal et' : 'Cancel request';
  if (g.tur === 'iptalden-donus') return tr ? `İptali geri al: ${ad}` : `Undo cancellation: ${ad}`;
  return ad;
}

/** «Etiket basıldı SS:DD (n koli)» — saat `zaman`dan; `koli` yoksa parantez yok; `kim` basılmaz (panel işlemidir). */
function etiketBasildiMetni(e: NonNullable<MagazaTalepSatiri['etiketBasildi']>, dil: Dil): string {
  const tr = dil === 'tr';
  const d = zamanDate(e.zaman);
  const saat = d === null ? '—' : d.toLocaleTimeString(tr ? 'tr-TR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const koli = e.koli === undefined ? '' : tr ? ` (${e.koli} koli)` : ` (${e.koli} parcel${e.koli === 1 ? '' : 's'})`;
  return `${tr ? 'Etiket basıldı' : 'Label printed'} ${saat}${koli}`;
}

// ── Parçalar ────────────────────────────────────────────────────────────────────────────────────────────────────────

const ROZET = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold';
// Liste satırı ve başlığı AYNI sütunları kullanır (md ve üstü 7 sütun). Dar ekranda satır iki sütuna katlanır, başlık çizilmez.
const SUTUNLAR = 'gap-x-4 gap-y-1 md:grid-cols-[8.5rem_8.5rem_minmax(0,1.4fr)_minmax(0,0.7fr)_4.5rem_minmax(0,1.2fr)_minmax(0,1fr)] md:items-center';
const SATIR_IZGARASI = `grid grid-cols-2 ${SUTUNLAR}`;
const BASLIK_IZGARASI = `hidden md:grid ${SUTUNLAR}`;
// İşlem hücresi (ilerlet / yeniden gönder) satır düğmesinin KARDEŞİDİR: geniş ekranda sağda sabit genişlikte, dar ekranda altta.
const ISLEM_HUCRESI_GENISLIGI = 'lg:w-44 lg:shrink-0';
// Hücre etiketi: dar ekranda görünür (başlık satırı yok), geniş ekranda yalnız ekran okuyucuya.
const HUCRE_ETIKETI = 'block text-[10px] font-bold text-gray-400 uppercase md:sr-only';
const DUGME = 'inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const DUGME_ANA = `${DUGME} bg-brand hover:bg-brand-hover text-white`;
const DUGME_IKINCIL = `${DUGME} bg-white border border-gray-200 text-gray-700 hover:bg-gray-50`;

/**
 * Sekme düğmesinin İÇİNE konan rozet — İKİ sayı, AYRI etiketle (§ 5.2):
 *   «görülmemiş» = son bakıştan sonra gelen talepler (`useMagazaYeniSayaci`; dilim 1 sayacı);
 *   «yeni»       = aşaması `yeni` olan talepler (`yeniAsamaSayisi`; site panelinin «Yeni»siyle AYNI sayı).
 * Sıfır olan sayı çizilmez; ikisi de sıfırsa hiçbir şey çizilmez. `aria-label`'lar düğmenin erişilebilir adına katılır:
 * «Mağaza Talepleri 3 görülmemiş talep 5 yeni talep». Sayılar aramadan ve liste süzgecinden ETKİLENMEZ.
 */
export function MagazaYeniRozeti({ sayi, yeni, currentLanguage }: { sayi: number; yeni: number; currentLanguage: Dil }) {
  const tr = currentLanguage === 'tr';
  const gorulmemisVar = sayi > 0, yeniVar = yeni > 0;
  if (!gorulmemisVar && !yeniVar) return null;
  const cogul = (n: number): string => (n === 1 ? '' : 's');
  const SINIF = 'inline-flex items-center justify-center h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums';
  return (
    <>
      {gorulmemisVar && (
        <span
          aria-label={tr ? `${sayi} görülmemiş talep` : `${sayi} unseen request${cogul(sayi)}`}
          title={tr ? 'Son bakışınızdan sonra gelen talepler' : 'Requests received since you last looked'}
          className={`${SINIF} bg-red-50 text-red-700`}
        >
          {sayi} {tr ? 'görülmemiş' : 'unseen'}
        </span>
      )}
      {/* Açık boşluk: iki `aria-label` düğmenin erişilebilir adına birbirine YAPIŞMADAN katılsın. */}
      {gorulmemisVar && yeniVar && ' '}
      {yeniVar && (
        <span
          aria-label={tr ? `${yeni} yeni talep` : `${yeni} new request${cogul(yeni)}`}
          title={tr ? 'Aşaması «Yeni» olan talepler (site paneliyle aynı sayı)' : 'Requests at the “New” stage (same count as the site panel)'}
          className={`${SINIF} bg-gray-100 text-gray-700`}
        >
          {yeni} {oc(currentLanguage).yeni_2}
        </span>
      )}
    </>
  );
}

function BildirimRozeti({ g, dil }: { g: BildirimGorunumu; dil: Dil }) {
  const tr = dil === 'tr';
  if (g.tur === 'isaretsiz') return null;
  if (g.tur === 'gonderiliyor') return <span className="text-[11px] text-gray-500">{tr ? 'gönderiliyor' : 'sending'}</span>;
  if (g.neden === 'okunamadi') return <span className={`${ROZET} bg-yellow-50 text-yellow-700`}>{tr ? 'bildirim durumu okunamadı' : 'notification status unreadable'}</span>;
  // Kesin sonuç (denemeler bitti / hiç denenmeyecek) kırmızı; süren bekleme sarı — metin üçünde de aynı.
  const renk = g.neden === 'bekleme-asildi' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700';
  return <span className={`${ROZET} ${renk}`}>{tr ? 'bildirim gönderilmedi' : 'notification not sent'}</span>;
}

/**
 * Revize bildirimi rozeti (2b) — yalnız talepte `bildirimRevize` VARSA çizilir (çağıran denetler; alan yoksa revizyon yoktur).
 * İlk bildirimden farkı: «gönderildi» de YAZILIR (rozet aynı zamanda «bu talebin içeriği revize edildi» bilgisidir). Değişen
 * alan ADLARI ipucundadır. Durum kuralı `g`'dedir (`bildirimGorunumu(t.bildirimRevize, t.icerikZamani, şimdi)`).
 */
function RevizeRozeti({ g, alanlar, dil }: { g: BildirimGorunumu; alanlar: readonly MagazaRevizeAlani[]; dil: Dil }) {
  const tr = dil === 'tr';
  const alanMetni = revizeAlanMetni(alanlar, dil);
  const ipucu = alanMetni === null ? undefined : `${tr ? 'Değişen alanlar' : 'Changed fields'}: ${alanMetni}`;
  const on = tr ? 'Revize bildirimi' : 'Revision notice';
  if (g.tur === 'isaretsiz') return <span title={ipucu} className="block text-[11px] text-gray-500">{on}: {tr ? 'gönderildi' : 'sent'}</span>;
  if (g.tur === 'gonderiliyor') return <span title={ipucu} className="block text-[11px] text-gray-500">{on}: {tr ? 'gönderiliyor' : 'sending'}</span>;
  if (g.neden === 'okunamadi') return <span title={ipucu} className={`${ROZET} mt-0.5 bg-yellow-50 text-yellow-700`}>{on}: {tr ? 'durum okunamadı' : 'status unreadable'}</span>;
  const renk = g.neden === 'bekleme-asildi' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700';
  return <span title={ipucu} className={`${ROZET} mt-0.5 ${renk}`}>{on}: {tr ? 'gönderilmedi' : 'not sent'}</span>;
}

/** Aşama rozeti. `null` = aşama okunamadı: uydurma aşama basılmaz, işlem düğmesi de çizilmez. */
function AsamaRozeti({ asama, dil }: { asama: MagazaTalepAsamasi | null; dil: Dil }) {
  if (asama === null) return <span className={`${ROZET} bg-yellow-50 text-yellow-700`}>{dil === 'tr' ? 'durum okunamadı' : 'status unreadable'}</span>;
  return <span className={`${ROZET} ${magazaTalepDurumRengi(asama)}`}>{magazaTalepDurumEtiketi(asama, dil)}</span>;
}

function Alan({ etiket, children }: { etiket: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold text-gray-400 uppercase">{etiket}</dt>
      <dd className="text-sm text-gray-800 break-words">{children}</dd>
    </div>
  );
}

/** Müşterinin yazdığı tek satırlık metin; boşsa '—'. */
const yaDaCizgi = (s: string): string => (s.trim() === '' ? '—' : s);

interface DetayIslemleri {
  /** Rozetin bastığı aşama (409 sonrası akış gelene kadar yanıttaki güncel aşama). */
  asama: MagazaTalepAsamasi | null;
  /** İstek uçuşta ya da akış bekleniyor: aşama / not / kalem düğmeleri pasif. */
  kilitli: boolean;
  onGecis: (hedef: MagazaTalepAsamasi) => void;
  /** Aynı aşamada yalnız-açıklama yazımı; yazım başarılıysa `true`. */
  onAciklama: (metin: string) => Promise<boolean>;
  onTeslim: (teslim: boolean, kalemler: string[] | 'hepsi') => void;
  // ── dilim 2b ──
  /** İçerik az önce kaydedildi, akış yeni sürümü henüz getirmedi: «Düzenle» pasif (bayat içerikle form açılmasın). */
  icerikKilitli: boolean;
  /** Form niteliği: kalem stok kodunun ERP ürün kaydındaki KDV oranı (OrdersPage'den; ürün listesi bileşene geçmez). */
  urunKdvOrani: (sku: string) => number | undefined;
  /** İçerik formunun «Kaydet»i; sonuç forma döner (`tamam` → form kapanır). */
  onIcerik: (govde: MagazaIcerikGirdisi) => Promise<MagazaFormSonucu>;
  /** «Sil»; `null` = bu rol silemez (düğme çizilmez). */
  onSil: (() => void) | null;
  /** «Geri al»; `null` = çizilmez (rol geri alamaz YA DA «Silinen / İptal» sekmesi ekranda seçili değil — arama doluyken hiçbiri seçili değildir). */
  onGeriAl: (() => void) | null;
  /** Silinmiş talep, rol geri alabilir ama detay ARAMAYLA açıldı (sekme düğmeleri pasif): düğme yerine «aramayı temizleyip o sekmeye geçin» ipucu. */
  geriAlIpucu: boolean;
}

/** Teyit toplamı: dolu → para; `null` ve fiyatı boş kalem var → «fiyat sorulacak»; `null` ve neden okunamıyor → '—' (sıfır DEĞİL). */
function teyitTutari(deger: number | null, fiyatsizVar: boolean, dil: Dil): ReactNode {
  if (deger !== null) return <span className="tabular-nums">{paraYaz(deger)}</span>;
  if (fiyatsizVar) return <span className="font-semibold text-yellow-700">{dil === 'tr' ? 'fiyat sorulacak' : 'price to be quoted'}</span>;
  return '—';
}

function TalepDetayi({ t, g, gRevize, dil, islem }: { t: MagazaTalepSatiri; g: BildirimGorunumu; gRevize: BildirimGorunumu | null; dil: Dil; islem: DetayIslemleri }) {
  const tr = dil === 'tr';
  const kok = useId();
  const tel = telBaglantisi(t.musteri.telefon);
  const eposta = epostaBaglantisi(t.musteri.eposta);
  const eksik = toplamEksikMi(t);
  // Silinmiş talep DONUKTUR (V17): aşama, not, içerik, kalem teslim düğmesi çizilmez; yalnız (Yönetici'ye) «Geri al».
  const silindi = magazaSilinmisMi(t) ? t.silindi : null;
  const donuk = silindi !== null;
  // İçerik formu AÇIK mı. Detay kapanınca (bileşen kaldırılır) taslak bırakılır.
  const [duzenleniyor, setDuzenleniyor] = useState(false);

  // ── Müşteriye görünen not: taslak yalnız kullanıcı yazınca oluşur; başarılı «Kaydet»ten sonra akış yeni sürümü getirince
  // bırakılır (iyimser güncelleme yok — kutu saklanan metne akışla döner; arada eski metin yanıp sönmez).
  const [taslak, setTaslak] = useState<string | null>(null);
  const [kayitSurumu, setKayitSurumu] = useState<number | null>(null);
  useEffect(() => {
    if (kayitSurumu !== null && t.durumSurum !== kayitSurumu) { setTaslak(null); setKayitSurumu(null); }
  }, [t.durumSurum, kayitSurumu]);
  const notMetni = taslak === null ? t.durumAciklama : taslak;
  const notDegisti = taslak !== null && taslak !== t.durumAciklama;

  // ── Aşama düğmeleri: TEK kaynak `magazaIzinliGecisler`. «İlerlet» liste satırının yanındaki hücrededir; burada geri al / iptal.
  const durum = t.durum;
  const detayGecisleri = durum === null
    ? []
    : magazaIzinliGecisler(durum, t.iptalOncesi).filter(hedef => { const x = magazaGecisi(durum, hedef, t.iptalOncesi); return x.izinli && x.tur !== 'ileri'; });
  const sonGecis = t.durumGecmisi.length > 0 ? t.durumGecmisi[t.durumGecmisi.length - 1] : null;

  // ── Kalem teslim: anahtar ve işaret ortak saf işlevlerden (panel ve takip ucu aynı işlevleri okur).
  const kaynak = magazaTeslimKaynagi(t);
  const anahtarlar = magazaKalemAnahtarlari(t);
  const isaretsiz = magazaTeslimIsaretsiz(t);
  const teslimPasif = teslimYazilamaz(durum);
  const kutuKapali = teslimPasif || islem.kilitli;
  const teyit = t.teyit;
  // Teyit toplamı `null` iken nedeni: fiyatı boş («fiyat sorulacak») kalem var mı — yoksa toplam okunamamıştır ('—').
  const teyitFiyatsiz = teyit !== null && teyit.kalemler.some(k => k.birimFiyat === null);
  const sayi = (n: number): string => (Number.isFinite(n) ? n.toLocaleString(tr ? 'tr-TR' : 'en-US') : '—');

  /** «N / M kalem teslim» + «Tümünü işaretle / kaldır» — AKTİF kaynağın (teyit varsa teyit, yoksa beyan) başlığında çizilir. */
  const teslimOzeti = anahtarlar.length === 0 ? null : (
    <>
      <p className="text-xs font-semibold text-gray-600 tabular-nums">
        {tr ? `${anahtarlar.length - isaretsiz} / ${anahtarlar.length} kalem teslim` : `${anahtarlar.length - isaretsiz} / ${anahtarlar.length} items delivered`}
      </p>
      {/* «Tümünü işaretle / kaldır» TEK istektir (`'hepsi'`), kalem başına istek değil; «kaldır» yalnız hepsi işaretliyken çizilir. */}
      {!teslimPasif && !donuk && (
        <button type="button" className={DUGME_IKINCIL} disabled={islem.kilitli} onClick={() => islem.onTeslim(isaretsiz > 0, 'hepsi')}>
          {isaretsiz > 0 ? (tr ? 'Tümünü işaretle' : 'Mark all') : (tr ? 'Tümünü kaldır' : 'Unmark all')}
        </button>
      )}
    </>
  );

  /** Kalem satırının «Teslim» hücresi — iki tablo AYNI hücreyi çizer; `anahtar` aktif kaynağın anahtarıdır (`b:<dizin>` / `t:…`). */
  const teslimHucresi = (anahtar: string | null, kalemAdi: string): ReactNode => {
    const teslim = anahtar !== null && magazaKalemTeslimMi(t.kalemTeslim, anahtar);
    const giris = anahtar !== null && Object.prototype.hasOwnProperty.call(t.kalemTeslim, anahtar) ? t.kalemTeslim[anahtar] : null;
    return (
      <td className="px-4 py-2">
        {anahtar !== null && (donuk
          // Silinmiş talepte kutu YOK (işaret yazılamaz); yalnız kayıtlı işaret okunur.
          ? <span className={`${ROZET} ${magazaKalemTeslimRengi(teslim)}`}>{magazaKalemTeslimEtiketi(teslim, dil)}</span>
          : (
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-green-700 disabled:cursor-not-allowed"
                aria-label={tr ? `Teslim edildi: ${kalemAdi}` : `Delivered: ${kalemAdi}`}
                checked={teslim}
                disabled={kutuKapali}
                onChange={() => islem.onTeslim(!teslim, [anahtar])}
              />
              <span className={`${ROZET} ${magazaKalemTeslimRengi(teslim)}`}>{magazaKalemTeslimEtiketi(teslim, dil)}</span>
            </label>
          ))}
        {/* İşareti verenin adı ve zamanı personel bilgisidir (ERP'de görünür; panel kartına ve takip yanıtına dönmez). */}
        {teslim && giris !== null && (
          <span className="block text-[11px] text-gray-500 break-words">{yaDaCizgi(giris.kim.ad)} · {tarihSaatYaz(giris.zaman, undefined, dil)}</span>
        )}
      </td>
    );
  };
  const siraAdi = (ad: string, i: number): string => (ad.trim() === '' ? (tr ? `${i + 1}. kalem` : `item ${i + 1}`) : ad);

  return (
    <div className="px-4 pb-4 pt-1 space-y-4 bg-gray-50/60">
      {t.kirpildi === true && (
        <p role="note" className="text-[11px] text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
          {tr ? 'Bazı alanlar uzunluk sınırında kırpıldı — müşterinin yazdığı metnin tamamı kayıtta yok.' : 'Some fields were truncated at the length limit — the full text the customer wrote is not on record.'}
        </p>
      )}

      {silindi !== null && (
        <div role="note" className="text-xs text-gray-700 bg-gray-100 rounded-lg px-3 py-2 space-y-2">
          <p>
            <span className="font-bold">{tr ? 'Bu talep silindi' : 'This request was deleted'}</span>
            {' — '}{silindiMetni(silindi, dil)}.{' '}
            {tr
              ? 'Kayıt durur; aşama, not, içerik ve teslim işareti değiştirilemez. Müşteri takip sayfasında «talebiniz silinmiş» görür.'
              : 'The record is kept; its stage, note, content and delivery marks cannot be changed. On the tracking page the customer sees “your request has been deleted”.'}
          </p>
          {islem.onGeriAl !== null && (
            <button type="button" className={DUGME_IKINCIL} disabled={islem.kilitli} onClick={islem.onGeriAl}>{tr ? 'Geri al' : 'Restore'}</button>
          )}
          {/* İpucu yalnız arama doluyken çıkar; o sırada sekme düğmeleri PASİFTİR — «sekmeye geçin» tek başına ölü yönlendirme olurdu. */}
          {islem.geriAlIpucu && (
            <p>
              {tr
                ? 'Geri almak için aramayı temizleyip «Silinen / İptal» sekmesine geçin.'
                : 'To restore it, clear the search and switch to the “Deleted / Cancelled” tab.'}
            </p>
          )}
        </div>
      )}

      <div className="border border-gray-100 rounded-xl bg-white px-4 py-3 space-y-3">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
          <Alan etiket={oc(dil).durum}><AsamaRozeti asama={islem.asama} dil={dil} /></Alan>
          <Alan etiket={tr ? 'Son değiştiren' : 'Last changed by'}>
            {sonGecis === null ? '—' : `${yaDaCizgi(sonGecis.kim.ad)} · ${tarihSaatYaz(sonGecis.zaman, undefined, dil)} · ${sonGecis.kanal === 'panel' ? (tr ? 'site paneli' : 'site panel') : 'ERP'}`}
          </Alan>
          <Alan etiket={tr ? 'Son güncelleme' : 'Last update'}>{tarihSaatYaz(magazaGuncellemeZamani(t), undefined, dil)}</Alan>
          <Alan etiket={tr ? 'Takip telefonu (son 10 hane)' : 'Tracking phone (last 10 digits)'}>{yaDaCizgi(t.telefonSon10)}</Alan>
          <div className="sm:col-span-2 lg:col-span-4 min-w-0">
            <dt className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Müşteriye görünen not' : 'Note shown to the customer'}</dt>
            <dd className="text-sm text-gray-800 break-words">{yaDaCizgi(t.durumAciklama)}</dd>
          </div>
        </dl>
        {/* Ekranda yalnız saat (şartname biçimi); tam tarih-saat ipucunda — dün basılan etiket bugünküyle karışmasın. */}
        {t.etiketBasildi !== null && (
          <p className="text-xs font-semibold text-gray-700" title={tarihSaatYaz(t.etiketBasildi.zaman, undefined, dil)}>{etiketBasildiMetni(t.etiketBasildi, dil)}</p>
        )}

        {durum !== null && !donuk && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 basis-64">
                <label htmlFor={`${kok}-not`} className="block text-[10px] font-bold text-gray-400 uppercase">
                  {tr ? 'Notu değiştir (takip sayfasında müşteriye görünür; boş kaydedilirse silinir)' : 'Edit note (shown to the customer on the tracking page; saving it empty removes it)'}
                </label>
                <input
                  id={`${kok}-not`}
                  type="text"
                  className="apple-input w-full"
                  maxLength={MAGAZA_DURUM_ACIKLAMA_SINIRI}
                  value={notMetni}
                  disabled={islem.kilitli}
                  onChange={e => setTaslak(e.target.value)}
                />
              </div>
              <button
                type="button"
                className={DUGME_IKINCIL}
                disabled={islem.kilitli || !notDegisti}
                onClick={() => { const surum = t.durumSurum; void islem.onAciklama(notMetni).then(tamam => { if (tamam) setKayitSurumu(surum); }); }}
              >
                {tr ? 'Notu kaydet' : 'Save note'}
              </button>
            </div>
            {detayGecisleri.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detayGecisleri.map(hedef => (
                  <button key={hedef} type="button" className={DUGME_IKINCIL} disabled={islem.kilitli} onClick={() => islem.onGecis(hedef)}>
                    {gecisEtiketi(durum, hedef, t.iptalOncesi, dil)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── İçerik: «Düzenle» (aşaması okunamayan ve silinmiş satırda YOK) ve yalnız silebilen role «Sil». Form açıkken iki düğme
          de çizilmez: form kendi «Kaydet / Vazgeç»ini taşır, açık formun altındaki talep o sırada silinmesin. ── */}
      {!donuk && (duzenleniyor && durum !== null
        ? (
          <MagazaTalepDuzenle
            kip="duzenle"
            talep={t}
            dil={dil}
            urunKdvOrani={islem.urunKdvOrani}
            onVazgec={() => setDuzenleniyor(false)}
            onKaydet={async govde => {
              const s = await islem.onIcerik(govde);
              if (s.tamam) setDuzenleniyor(false);
              return s;
            }}
          />
        )
        : (durum !== null || islem.onSil !== null) && (
          <div className="flex flex-wrap items-center gap-2">
            {durum !== null && (
              <button type="button" className={DUGME_IKINCIL} disabled={islem.icerikKilitli} onClick={() => setDuzenleniyor(true)}>{oc(dil).duzenle}</button>
            )}
            {islem.onSil !== null && (
              <button type="button" className={`${DUGME} bg-white border border-red-200 text-red-700 hover:bg-red-50`} disabled={islem.kilitli} onClick={islem.onSil}>{oc(dil).sil}</button>
            )}
            {durum !== null && (
              <span className="text-[11px] text-gray-500">
                {tr ? 'Düzenle: müşteri bilgileri, müşteri notu ve teyit edilen kalemler (adet, KDV hariç fiyat, KDV oranı).' : 'Edit: customer details, customer note and confirmed items (quantity, price excl. VAT, VAT rate).'}
              </span>
            )}
          </div>
        ))}

      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
        <Alan etiket={oc(dil).musteri}>{yaDaCizgi(t.musteri.ad)}</Alan>
        <Alan etiket={oc(dil).firma}>{yaDaCizgi(t.musteri.firma)}</Alan>
        <Alan etiket={oc(dil).telefon}>
          {tel !== null ? <a href={tel} className="text-brand underline">{t.musteri.telefon}</a> : yaDaCizgi(t.musteri.telefon)}
        </Alan>
        <Alan etiket={oc(dil).e_posta}>
          {eposta !== null ? <a href={eposta} className="text-brand underline">{t.musteri.eposta}</a> : yaDaCizgi(t.musteri.eposta)}
        </Alan>
        <Alan etiket={tr ? 'İl' : 'Province'}>{yaDaCizgi(t.musteri.il)}</Alan>
        <Alan etiket={oc(dil).vergi_no}>{yaDaCizgi(t.musteri.vergi)}</Alan>
        <Alan etiket={tr ? 'Kayıt zamanı' : 'Received at'}>{tarihSaatYaz(t.olusturma, undefined, dil)}</Alan>
        <Alan etiket={tr ? 'Müşteri cihazının saati' : 'Customer device time'}>{tarihSaatYaz(t.istemciTarihi, undefined, dil)}</Alan>
        <div className="sm:col-span-2 lg:col-span-4 min-w-0">
          <dt className="text-[10px] font-bold text-gray-400 uppercase">{oc(dil).adres}</dt>
          <dd className="text-sm text-gray-800 whitespace-pre-wrap break-words">{yaDaCizgi(t.musteri.adres)}</dd>
        </div>
        <div className="sm:col-span-2 lg:col-span-4 min-w-0">
          <dt className="text-[10px] font-bold text-gray-400 uppercase">{tr ? 'Müşteri notu' : 'Customer note'}</dt>
          <dd className="text-sm text-gray-800 whitespace-pre-wrap break-words">{yaDaCizgi(t.not)}</dd>
        </div>
      </dl>

      {/* ── İKİ TABLO yan yana (V16): solda müşterinin BEYANI (hiçbir yazma yolunda değişmez), sağda personelin TEYİDİ. Teslim
          kutuları AKTİF kaynaktadır (`magazaTeslimKaynagi`): teyit varsa teyit satırlarında, beyan tablosu salt okunur. ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div role="group" aria-label={KALEM_KAYNAGI_BASLIGI.beyan[dil]} className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase">{KALEM_KAYNAGI_BASLIGI.beyan[dil]}</p>
            {kaynak === 'beyan' && teslimOzeti}
          </div>
          <div className="border border-gray-100 rounded-xl overflow-x-auto bg-white">
            <table className="w-full text-sm min-w-[560px]">
              <caption className="sr-only">{KALEM_KAYNAGI_BASLIGI.beyan[dil]}</caption>
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-[10px] font-bold text-gray-500 uppercase">
                  <th scope="col" className="px-4 py-2 text-left">{tr ? 'Stok kodu' : 'SKU'}</th>
                  <th scope="col" className="px-4 py-2 text-left">{oc(dil).urun}</th>
                  <th scope="col" className="px-4 py-2 text-left">{tr ? 'Marka' : 'Brand'}</th>
                  <th scope="col" className="px-4 py-2 text-right">{oc(dil).adet_2}</th>
                  <th scope="col" className="px-4 py-2 text-right">{tr ? 'Birim fiyat (sitede görülen)' : 'Unit price (as shown on site)'}</th>
                  {kaynak === 'beyan' && <th scope="col" className="px-4 py-2 text-left">{tr ? 'Teslim' : 'Delivery'}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {t.kalemler.length === 0 && (
                  <tr><td colSpan={kaynak === 'beyan' ? 6 : 5} className="px-4 py-3 text-xs text-gray-400">{tr ? 'Kalem okunamadı.' : 'No readable line items.'}</td></tr>
                )}
                {t.kalemler.map((k, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-gray-600 break-words">{yaDaCizgi(k.sku)}</td>
                    <td className="px-4 py-2 text-gray-800 break-words">
                      {yaDaCizgi(k.ad)}
                      {k.tedarik && <span className={`${ROZET} ml-2 bg-yellow-50 text-yellow-700`}>{tr ? 'tedarik edilecek' : 'to be sourced'}</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600 break-words">{yaDaCizgi(k.marka)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{sayi(k.adet)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {k.talepFiyat === null
                        ? <span className="font-semibold text-yellow-700">{tr ? 'fiyat sorulacak' : 'price to be quoted'}</span>
                        : paraYaz(k.talepFiyat)}
                    </td>
                    {/* Anahtar SAKLANMAZ, türetilir (beyanda `b:<dizin>`); dizi sırası kaynağın sırasıdır. Teyit varken beyan satırında kutu YOK. */}
                    {kaynak === 'beyan' && teslimHucresi(i < anahtarlar.length ? anahtarlar[i] : null, siraAdi(k.ad, i))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase">
              {tr ? 'Talep edilen tutarlar — müşterinin sitede gördüğü' : 'Requested amounts — as the customer saw them on the site'}
            </p>
            <dl className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2">
              <Alan etiket={tr ? 'Ara toplam' : 'Subtotal'}><span className="tabular-nums">{paraYaz(t.talepEdilen.araToplam)}</span></Alan>
              <Alan etiket={oc(dil).kdv}><span className="tabular-nums">{paraYaz(t.talepEdilen.kdv)}</span></Alan>
              <Alan etiket={oc(dil).toplam}>
                <span className="tabular-nums font-semibold">{paraYaz(t.talepEdilen.toplam)}</span>
                {eksik && <span className={`${ROZET} ml-2 bg-yellow-50 text-yellow-700`}>{eksikNotu(t, dil)}</span>}
              </Alan>
            </dl>
          </div>
        </div>

        <div role="group" aria-label={KALEM_KAYNAGI_BASLIGI.teyit[dil]} className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase">{KALEM_KAYNAGI_BASLIGI.teyit[dil]}</p>
            {kaynak === 'teyit' && teslimOzeti}
          </div>
          {teyit === null ? (
            <p className="text-xs text-gray-500">
              {tr
                ? 'Henüz teyit edilmedi — «Düzenle» ile adet, KDV hariç fiyat ve KDV oranı teyit edilir; müşterinin talebi değişmez.'
                : 'Not confirmed yet — use “Edit” to confirm quantities, prices excl. VAT and VAT rates; the customer’s request is not changed.'}
            </p>
          ) : (
            <>
              <p className="text-[11px] text-gray-500 break-words">
                {tr ? 'Teyit eden' : 'Confirmed by'}: {yaDaCizgi(teyit.kim.ad)} · {tarihSaatYaz(teyit.zaman, undefined, dil)}
              </p>
              <div className="border border-gray-100 rounded-xl overflow-x-auto bg-white">
                <table className="w-full text-sm min-w-[640px]">
                  <caption className="sr-only">{KALEM_KAYNAGI_BASLIGI.teyit[dil]}</caption>
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr className="text-[10px] font-bold text-gray-500 uppercase">
                      <th scope="col" className="px-4 py-2 text-left">{tr ? 'Stok kodu' : 'SKU'}</th>
                      <th scope="col" className="px-4 py-2 text-left">{oc(dil).urun}</th>
                      <th scope="col" className="px-4 py-2 text-left">{tr ? 'Marka' : 'Brand'}</th>
                      <th scope="col" className="px-4 py-2 text-right">{oc(dil).adet_2}</th>
                      <th scope="col" className="px-4 py-2 text-right">{tr ? 'Birim fiyat (KDV hariç)' : 'Unit price (excl. VAT)'}</th>
                      <th scope="col" className="px-4 py-2 text-left">{tr ? 'KDV oranı' : 'VAT rate'}</th>
                      <th scope="col" className="px-4 py-2 text-left">{tr ? 'Teslim' : 'Delivery'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {teyit.kalemler.map((k, i) => (
                      <tr key={k.anahtar}>
                        <td className="px-4 py-2 text-gray-600 break-words">{yaDaCizgi(k.sku)}</td>
                        <td className="px-4 py-2 text-gray-800 break-words">
                          {yaDaCizgi(k.ad)}
                          {k.tedarik && <span className={`${ROZET} ml-2 bg-yellow-50 text-yellow-700`}>{tr ? 'tedarik edilecek' : 'to be sourced'}</span>}
                        </td>
                        <td className="px-4 py-2 text-gray-600 break-words">{yaDaCizgi(k.marka)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{sayi(k.adet)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {k.birimFiyat === null
                            ? <span className="font-semibold text-yellow-700">{tr ? 'fiyat sorulacak' : 'price to be quoted'}</span>
                            : paraYaz(k.birimFiyat)}
                        </td>
                        <td className="px-4 py-2 tabular-nums">
                          %{k.kdvOrani}
                          {/* «varsayılan» imi: oran ürün kaydından OKUNAMADI, %20 varsayıldı — kesin oran gibi görünmesin. */}
                          {k.kdvKaynagi === 'varsayilan' && (
                            <span
                              className={`${ROZET} ml-2 bg-yellow-50 text-yellow-700`}
                              title={tr ? 'Ürün kaydından oran okunamadı; %20 varsayıldı. Doğru oranı «Düzenle» ile seçin.' : 'No rate could be read from the product record; 20% was assumed. Select the correct rate with “Edit”.'}
                            >
                              {tr ? 'varsayılan' : 'default'}
                            </span>
                          )}
                        </td>
                        {/* Teyit kaleminin anahtarı SUNUCUNUN ürettiği `t:` değeridir (kalem ekle / sil / sırala ile kaymaz). */}
                        {teslimHucresi(k.anahtar, siraAdi(k.ad, i))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">
                  {tr ? 'Teyit edilen tutarlar — birim fiyatlar KDV hariç; tutarları sunucu hesaplar' : 'Confirmed amounts — unit prices excl. VAT; amounts are calculated by the server'}
                </p>
                <dl className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2">
                  <Alan etiket={tr ? 'Ara toplam (KDV hariç)' : 'Subtotal (excl. VAT)'}>{teyitTutari(teyit.araToplam, teyitFiyatsiz, dil)}</Alan>
                  <Alan etiket={oc(dil).kdv}>{teyitTutari(teyit.kdv, teyitFiyatsiz, dil)}</Alan>
                  <Alan etiket={tr ? 'Genel toplam' : 'Grand total'}><span className="font-semibold">{teyitTutari(teyit.toplam, teyitFiyatsiz, dil)}</span></Alan>
                </dl>
              </div>
            </>
          )}
        </div>
      </div>

      {t.elle !== null && (
        <p className="text-[11px] text-gray-500 break-words">
          {tr ? "ERP'de elle açıldı" : 'Opened manually in the ERP'}: {yaDaCizgi(t.elle.kim.ad)} · {tarihSaatYaz(t.elle.zaman, undefined, dil)}
        </p>
      )}

      <p className={`text-[11px] ${bildirimAciklamaRengi(g)}`}>
        {bildirimAciklamasi(t.bildirim, g, dil, false)}
        {bildirimEkleri(t.bildirim, g, dil)}
      </p>
      {/* Revize bildirimi: alan yoksa (ya da okunamadıysa) revizyon yoktur — ikinci satır hiç çizilmez. */}
      {t.bildirimRevize !== null && gRevize !== null && (
        <p className={`text-[11px] ${bildirimAciklamaRengi(gRevize)}`}>
          {bildirimAciklamasi(t.bildirimRevize, gRevize, dil, true)}
          {revizeAlanMetni(t.bildirimRevize.alanlar, dil) !== null && <> {tr ? 'Değişen alanlar' : 'Changed fields'}: {revizeAlanMetni(t.bildirimRevize.alanlar, dil)}.</>}
          {t.bildirimRevize.kim.ad.trim() !== '' && <> {tr ? 'Revize eden' : 'Revised by'}: {t.bildirimRevize.kim.ad}.</>}
          {bildirimEkleri(t.bildirimRevize, gRevize, dil)}
        </p>
      )}
    </div>
  );
}

// ── Bileşen ─────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Props {
  /** `useMagazaTalepleri(...).talepler` — sırasız; süzgeç, arama, sıralama ve ekran sınırı burada. */
  talepler: readonly MagazaTalepSatiri[];
  yukleniyor: boolean;
  hata: string | null;
  currentLanguage: Dil;
  /** Aşama / açıklama yazımı — `services/magazaTalepIstemcisi.ts` `magazaTalepDurumuYaz` (OrdersPage verir). */
  onDurumDegistir: (id: string, girdi: MagazaDurumGirdisi) => Promise<MagazaDurumSonucu>;
  /** Kalem teslim işareti — `magazaKalemTeslimYaz`. */
  onKalemTeslim: (id: string, girdi: MagazaKalemTeslimGirdisi) => Promise<MagazaKalemTeslimSonucu>;
  /**
   * Bildirimi elle kuyruğa alma («Yeniden gönder») — `magazaBildirimGonder`. `tur: 'revize'` REVİZE bildirimini kuyruğa alır
   * (2b); verilmezse ilk bildirim (2a çağrıları `tur`'suz kalır).
   */
  onBildirimGonder: (id: string, tur?: 'revize') => Promise<MagazaBildirimGonderSonucu>;
  /** İçerik düzenleme (müşteri bilgileri, not, teyit kalemleri) — `magazaTalepIcerigiYaz`. Form her zaman TAM gövde gönderir. */
  onIcerikKaydet: (id: string, govde: MagazaIcerikGirdisi) => Promise<MagazaIcerikSonucu>;
  /**
   * Yumuşak silme ve (`geriAl: true`) geri alma — `magazaTalepSil`. `null` = bu rol silemez / geri alamaz: «Sil» ve «Geri al»
   * ÇİZİLMEZ (OrdersPage `magazaTalepSilmeYetkisi(rol)`'ü okur; istemci rolü yalnız gösterimdir, hüküm sunucuda).
   */
  onSil: ((id: string, girdi: MagazaSilGirdisi) => Promise<MagazaSilSonucu>) | null;
  /** ERP'de elle talep açma (telefonla gelen iş) — `magazaElleTalepAc`. */
  onElleTalep: (govde: MagazaElleTalepGirdisi) => Promise<MagazaElleTalepSonucu>;
  /**
   * Kalem stok kodunun ERP ürün kaydındaki KDV oranı (bulunamazsa / çelişirse `undefined`) — OrdersPage
   * `sku => magazaUrunKdvOrani(inventory, sku)` verir; ürün listesinin TAMAMI bileşene geçmez. İçerik formunun önizlemesi okur.
   */
  urunKdvOrani: (sku: string) => number | undefined;
}

export default function MagazaTalepleri({
  talepler, yukleniyor, hata, currentLanguage, onDurumDegistir, onKalemTeslim, onBildirimGonder, onIcerikKaydet, onSil, onElleTalep, urunKdvOrani,
}: Props) {
  const dil = currentLanguage;
  const tr = dil === 'tr';
  const kok = useId();
  const [acikId, setAcikId] = useState<string | null>(null);
  const [suzgec, setSuzgec] = useState<MagazaDurumSuzgeci>('acik');
  // Arama metni bileşen içi durumdur: depolamaya yazılmaz, nitelik değildir.
  const [arama, setArama] = useState('');
  const aramaVar = arama.trim() !== '';
  // «Silinen / İptal» sekmesi ekranda SEÇİLİ mi — sekme düğmesinin `aria-pressed` koşuluyla AYNI (arama doluyken hiçbiri seçili değil).
  const geriAlSekmesinde = !aramaVar && suzgec === 'silinenIptal';
  const liste = useMemo(() => magazaTalepListesi(talepler, suzgec, arama), [talepler, suzgec, arama]);
  // Dört düğmenin sayısı süzgeçle AYNI kuraldan (`lib/magazaTalep.ts`); «Hepsi» = silinmemişlerin tamamı.
  const suzgecSayisi = useMemo(() => magazaSuzgecSayilari(talepler), [talepler]);

  const [islemler, setIslemler] = useState<Record<string, SatirIslemi>>({});
  // İçerik kaydından sonraki akış beklemesi (talep başına); `durumSurum` kilidinden ayrıdır — `icerikKilidiSuruyor`.
  const [icerikBekleyen, setIcerikBekleyen] = useState<Record<string, IcerikBeklemesi>>({});
  // Elle talep formu açık mı; liste düzeyindeki son bilgi iletisi (elle talep açıldı / silindi / geri alındı).
  const [yeniTalepAcik, setYeniTalepAcik] = useState(false);
  const [listeIletisi, setListeIletisi] = useState<ListeIletisi | null>(null);
  // Uçuştaki istekler: durum güncellemesi çizime yansımadan gelen ikinci tıklama da istek ÜRETMEZ.
  const ucusta = useRef<Set<string>>(new Set());
  const islemYaz = (id: string, yeni: SatirIslemi): void => setIslemler(o => ({ ...o, [id]: yeni }));

  // Saatle değişen üç şey veriyle değil ZAMANLA yeniden çizilir (tek zamanlayıcı, en yakın eşik):
  //   • «gönderiliyor» → «bildirim gönderilmedi»: bildirim işçisi durmuşsa doküman hiç değişmez, ekran «gönderiliyor»da takılırdı
  //     (ilk bildirim ve revize bildirimi — `sonrakiBeklemeEsigi` ikisini de sayar);
  //   • akış bekleme kilidi: akış yeni sürümü getirmezse düğmeler `MAGAZA_AKIS_BEKLEME_MS` sonra açılır;
  //   • içerik kaydı beklemesi: aynı süre sonunda «Düzenle» açılır.
  const [, yenidenCiz] = useState(0);
  const simdi = Date.now();
  useEffect(() => {
    const su = Date.now();
    const bildirimEsigi = sonrakiBeklemeEsigi(liste.gorunen, su);
    let enYakin: number | null = bildirimEsigi === null ? null : bildirimEsigi + 1000;
    const bak = (bitisMs: number): void => {
      if (bitisMs > su && (enYakin === null || bitisMs < enYakin)) enYakin = bitisMs;
    };
    for (const i of Object.values(islemler)) if (i.bekleyen !== undefined) bak(i.bekleyen.bitisMs);
    for (const b of Object.values(icerikBekleyen)) bak(b.bitisMs);
    if (enYakin === null) return;
    const zamanlayici = setTimeout(() => yenidenCiz(n => n + 1), Math.max(0, enYakin - su));
    return () => clearTimeout(zamanlayici);
  });

  /** Akış bu sürümü geçene kadar (en çok `MAGAZA_AKIS_BEKLEME_MS`) kilit. */
  const bekleyen = (t: MagazaTalepSatiri, asama?: MagazaTalepAsamasi): NonNullable<SatirIslemi['bekleyen']> =>
    ({ surum: t.durumSurum, bitisMs: Date.now() + MAGAZA_AKIS_BEKLEME_MS, ...(asama !== undefined ? { asama } : {}) });

  /**
   * Sürüme bağlı yazım (aşama / not / kalem) şu an yapılamaz mı: istek uçuşta ya da akış bekleniyor. Düğmeler zaten pasif
   * çizilir; bu denetim işleyicide de durur (pasif düğmeye ulaşan bir olay bayat sürümle istek ÜRETMESİN).
   */
  const yazimKilitli = (t: MagazaTalepSatiri): boolean => ucusta.current.has(t.id) || kilitSuruyor(islemler[t.id], t, Date.now());

  /** Aşama geçişi ya da (aynı aşamada) açıklama yazımı. Gövdede satırın ekranda görülen sürümü gider. Silinmiş talep donuktur. */
  const asamaYaz = async (t: MagazaTalepSatiri, hedef: MagazaTalepAsamasi, aciklama?: string): Promise<boolean> => {
    if (t.durum === null || magazaSilinmisMi(t) || yazimKilitli(t)) return false;
    ucusta.current.add(t.id);
    islemYaz(t.id, { mesgul: true });
    let s: MagazaDurumSonucu;
    try {
      s = await onDurumDegistir(t.id, { onceki: t.durum, surum: t.durumSurum, durum: hedef, ...(aciklama !== undefined ? { aciklama } : {}) });
    } catch {
      s = { ok: false, kod: 'ag' };
    }
    ucusta.current.delete(t.id);
    if (s.ok) islemYaz(t.id, { bekleyen: bekleyen(t) });
    else if (s.kod === 'gecis-yok') islemYaz(t.id, { bekleyen: bekleyen(t, s.durum), ileti: { kod: 'degisti' } });
    else islemYaz(t.id, { ileti: { kod: s.kod } });
    return s.ok;
  };

  /** «İlerlet»: `teslim`e geçmeden ÖNCE işaretsiz kalem varsa uyarı + onay (engel değil; işaretsizler OTOMATİK işaretlenmez). */
  const ilerlet = (t: MagazaTalepSatiri, hedef: MagazaTalepAsamasi): void => {
    if (yazimKilitli(t)) return;
    if (hedef === 'teslim' && magazaTeslimIsaretsiz(t) > 0) { islemYaz(t.id, { teslimOnayi: true }); return; }
    void asamaYaz(t, hedef);
  };

  /** Kalem teslim işareti; `'hepsi'` TEK istektir. `gecersiz` ve `surum-eski` de «başka biri değiştirdi» gibi ele alınır. */
  const teslimYaz = async (t: MagazaTalepSatiri, teslim: boolean, kalemler: string[] | 'hepsi'): Promise<void> => {
    if (teslimYazilamaz(t.durum) || magazaSilinmisMi(t) || yazimKilitli(t)) return;
    ucusta.current.add(t.id);
    islemYaz(t.id, { mesgul: true });
    let s: MagazaKalemTeslimSonucu;
    try {
      s = await onKalemTeslim(t.id, { surum: t.durumSurum, teslim, kalemler });
    } catch {
      s = { ok: false, kod: 'ag' };
    }
    ucusta.current.delete(t.id);
    if (s.ok) islemYaz(t.id, { bekleyen: bekleyen(t) });
    else if (s.kod === 'gecis-yok' || s.kod === 'gecersiz' || s.kod === 'surum-eski') islemYaz(t.id, { bekleyen: bekleyen(t, s.durum), ileti: { kod: 'degisti' } });
    else islemYaz(t.id, { ileti: { kod: s.kod } });
  };

  /**
   * «Yeniden gönder»: iyimser rozet YOK — başarıda sunucu `bekliyor` yazar, rozet akıştan «gönderiliyor»a döner. `tur: 'revize'`
   * REVİZE bildirimini gönderir (aynı nitelik, ikinci değişken); ilk bildirimde nitelik TEK değişkenle çağrılır. Silinmiş talep
   * donuktur: düğme çizilmez, bu denetim de işleyicide durur.
   */
  const bildirimGonder = async (t: MagazaTalepSatiri, tur?: 'revize'): Promise<void> => {
    if (magazaSilinmisMi(t) || ucusta.current.has(t.id)) return;
    ucusta.current.add(t.id);
    // Bildirim yazımı sürümü ilerletmez: süren akış kilidi (varsa) korunur.
    const onceki = islemler[t.id]?.bekleyen;
    const koru: SatirIslemi = onceki !== undefined ? { bekleyen: onceki } : {};
    islemYaz(t.id, { ...koru, mesgul: true });
    let s: MagazaBildirimGonderSonucu;
    try {
      s = tur === 'revize' ? await onBildirimGonder(t.id, 'revize') : await onBildirimGonder(t.id);
    } catch {
      s = { ok: false, kod: 'ag' };
    }
    ucusta.current.delete(t.id);
    if (s.ok) islemYaz(t.id, { ...koru, ileti: { kod: 'bildirim-kuyrukta' } });
    else if (s.kod === 'yapilandirilmamis') islemYaz(t.id, { ...koru, ileti: { kod: 'bildirim-ayar-eksik', ...(s.eksik !== undefined ? { eksik: s.eksik } : {}) } });
    else if (s.kod === 'kapali') islemYaz(t.id, { ...koru, ileti: { kod: 'bildirim-kapali' } });
    else if (s.kod === 'zaten-gitti') islemYaz(t.id, { ...koru, ileti: { kod: 'bildirim-zaten-gitti' } });
    else if (s.kod === 'revize-yok') islemYaz(t.id, { ...koru, ileti: { kod: 'bildirim-revize-yok' } });
    else islemYaz(t.id, { ...koru, ileti: { kod: s.kod } });
  };

  /**
   * İçerik formunun «Kaydet»i: isteği nitelik atar, sonuç FORMA döner (form kendi iletisini basar; `tamam` → form kapanır).
   * `degisti: false` yazım DEĞİLDİR («değişiklik yok» — form açık kalır). Başarıda akış yeni `icerikSurum`'u getirene kadar
   * «Düzenle» kilitlenir; satırın `durumSurum` kilidine ve iletisine DOKUNULMAZ (içerik yazımı o sürümü ilerletmez).
   */
  const icerikYaz = async (t: MagazaTalepSatiri, govde: MagazaIcerikGirdisi): Promise<MagazaFormSonucu> => {
    let s: MagazaIcerikSonucu;
    try {
      s = await onIcerikKaydet(t.id, govde);
    } catch {
      s = { ok: false, kod: 'ag' };
    }
    if (!s.ok) return { tamam: false, kod: s.kod };
    if (!s.degisti) return { tamam: false, kod: 'degisiklik-yok' };
    setIcerikBekleyen(o => ({ ...o, [t.id]: { surum: t.icerikSurum, bitisMs: Date.now() + MAGAZA_AKIS_BEKLEME_MS } }));
    setIslemler(o => ({ ...o, [t.id]: { ...o[t.id], ileti: { kod: 'icerik-kaydedildi' } } }));
    return { tamam: true };
  };

  /**
   * «Sil» (YUMUŞAK: kayıt durur, `silindi` işareti alır) ve «Geri al». İkisi de satırın ekranda görülen `durumSurum`'unu
   * gönderir (silme ve geri alma o sürümü ilerletir). Silme onay ister; onay penceresi açıkken gelen ikinci tıklama istek
   * ÜRETMEZ (`ucusta`), vazgeçilirse istek atılmaz. Onay metni «kalıcı» DEMEZ: kayıt silinmez, geri alınabilir.
   */
  const silYaz = async (t: MagazaTalepSatiri, geriAl: boolean): Promise<void> => {
    if (onSil === null || magazaSilinmisMi(t) !== geriAl || yazimKilitli(t)) return;
    ucusta.current.add(t.id);
    if (!geriAl) {
      const no = t.talepNo.trim() === '' ? (tr ? 'Bu talep' : 'This request') : `«${t.talepNo}»`;
      let onay = false;
      try {
        onay = await confirmAction(tr
          ? {
            title: 'Talebi sil',
            message: `${no} silinecek. Kayıt durur: «Silinen / İptal» sekmesinde görünür ve Yönetici geri alabilir. Silinmiş talepte aşama, not, içerik ve teslim işareti değiştirilemez; müşteri takip sayfasında «talebiniz silinmiş» görür. Silinsin mi?`,
            confirmLabel: 'Talebi sil',
            variant: 'danger',
          }
          : {
            title: 'Delete request',
            message: `${no} will be deleted. The record is kept: it is listed under “Deleted / Cancelled” and an administrator can restore it. A deleted request cannot have its stage, note, content or delivery marks changed; on the tracking page the customer sees “your request has been deleted”. Delete it?`,
            confirmLabel: 'Delete request',
            variant: 'danger',
          });
      } catch {
        onay = false;
      }
      if (!onay) { ucusta.current.delete(t.id); return; }
    }
    islemYaz(t.id, { mesgul: true });
    let s: MagazaSilSonucu;
    try {
      s = await onSil(t.id, geriAl ? { surum: t.durumSurum, geriAl: true } : { surum: t.durumSurum });
    } catch {
      s = { ok: false, kod: 'ag' };
    }
    ucusta.current.delete(t.id);
    if (s.ok) {
      islemYaz(t.id, { bekleyen: bekleyen(t) });
      setListeIletisi({ kod: geriAl ? 'geri-alma-tamam' : 'silme-tamam', talepNo: t.talepNo.trim() === '' ? null : t.talepNo });
    } else if (s.kod === 'surum-eski') islemYaz(t.id, { bekleyen: bekleyen(t), ileti: { kod: 'degisti' } });
    else islemYaz(t.id, { ileti: { kod: s.kod } });
  };

  /** Elle talep formunun «Talebi aç»ı: sonuç forma döner; başarıda form kapanır ve talep numarası liste başında yazılır. */
  const elleTalepAc = async (govde: MagazaElleTalepGirdisi): Promise<MagazaFormSonucu> => {
    let s: MagazaElleTalepSonucu;
    try {
      s = await onElleTalep(govde);
    } catch {
      s = { ok: false, kod: 'ag' };
    }
    if (!s.ok) return { tamam: false, kod: s.kod };
    setYeniTalepAcik(false);
    setListeIletisi({ kod: 'elle-acildi', talepNo: s.talepNo });
    return { tamam: true };
  };

  /** Barkod okuyucu klavye gibi yazar + Enter: süzülmüş kümede TAM BİR eşleşme varsa o talebin detayı açılır. İstek atılmaz. */
  const aramaTusu = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return;
    const metin = e.currentTarget.value;
    if (metin.trim() === '') return;
    const eslesen = magazaTalepListesi(talepler, suzgec, metin).suzulen;
    if (eslesen.length !== 1) return;
    setAcikId(eslesen[0].id);
    e.currentTarget.select();   // sıradaki barkod eski metnin ÜSTÜNE yazılsın
  };

  const listeHazir = hata === null && !yukleniyor;

  return (
    <section className="apple-card overflow-hidden" aria-label={op(dil).magaza_talepleri}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-bold text-sm text-gray-800">
          {op(dil).magaza_talepleri}
          {/* Başlıktaki sayı CANLI (silinmemiş) taleplerin tamamıdır — «Hepsi» düğmesiyle aynı sayı; süzgeçten ve aramadan bağımsız. */}
          {listeHazir && <span className="ml-2 text-xs font-semibold text-gray-400 tabular-nums">{suzgecSayisi.hepsi}</span>}
        </h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {tr
            ? 'Mağaza sitesinden gelen sipariş talepleri — sipariş değildir; ciroya ve sipariş listesine girmez. Tutarlar müşterinin sitede gördüğü rakamlardır, onaylanmış fiyat değildir.'
            : 'Order requests from the store site — not orders; excluded from revenue and the order list. Amounts are what the customer saw on the site, not confirmed prices.'}
        </p>
      </div>

      {listeHazir && (
        <div className="px-4 py-2.5 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="apple-input min-w-0 flex-1 basis-64"
            aria-label={tr ? 'Talep ara (no, telefon son 4 hane, müşteri)' : 'Search requests (no, last 4 digits of phone, customer)'}
            placeholder={tr ? 'Talep ara: no, telefon son 4 hane, müşteri' : 'Search: no, last 4 digits of phone, customer'}
            autoComplete="off"
            value={arama}
            onChange={e => setArama(e.target.value)}
            onKeyDown={aramaTusu}
          />
          <div role="group" aria-label={tr ? 'Durum süzgeci' : 'Status filter'} className="flex flex-wrap items-center gap-1">
            {MAGAZA_DURUM_SUZGECLERI.map(s => {
              // Arama doluyken durum süzgeci YOK sayılır ve dört düğmenin HİÇBİRİ seçili çizilmez: arama kümesi silinmişler dâhil
              // bütün taleplerdir, «Hepsi» ise silinmişleri göstermez — «Hepsi»yi seçili çizmek yanlış olurdu. Düğmeler pasiftir.
              const secili = !aramaVar && s === suzgec;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={secili}
                  disabled={aramaVar}
                  onClick={() => { setSuzgec(s); setListeIletisi(null); }}
                  className={`${DUGME} ${secili ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  {SUZGEC_ETIKETI[s][dil]} <span className="ml-1 tabular-nums">{suzgecSayisi[s]}</span>
                </button>
              );
            })}
          </div>
          {/* Elle talep: telefonla gelen iş. Sekmeyi gören her rol açabilir (hüküm sunucuda); form açıkken düğme pasiftir. */}
          <button type="button" className={DUGME_ANA} disabled={yeniTalepAcik} onClick={() => { setYeniTalepAcik(true); setListeIletisi(null); }}>
            {tr ? 'Yeni talep (elle)' : 'New request (manual)'}
          </button>
          {aramaVar && (
            <p className="basis-full text-[11px] text-gray-500">
              {tr
                ? 'Arama silinmişler dâhil bütün taleplerde yapılır (süzgeç yok sayılır); Enter tek eşleşmenin detayını açar.'
                : 'Search covers all requests, including deleted ones (the filter is ignored); Enter opens the detail of a single match.'}
            </p>
          )}
        </div>
      )}

      {listeHazir && yeniTalepAcik && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
          <MagazaTalepDuzenle kip="yeni" dil={dil} onVazgec={() => setYeniTalepAcik(false)} onKaydet={elleTalepAc} />
        </div>
      )}
      {listeHazir && listeIletisi !== null && (
        <p role="status" className="px-4 py-2 text-xs text-gray-700 bg-gray-50 border-b border-gray-100">{listeIletiMetni(listeIletisi, dil)}</p>
      )}

      {hata !== null ? (
        <p role="alert" className="px-4 py-3 text-xs text-red-700 bg-red-50">
          {tr ? `Mağaza talepleri okunamadı: ${hata}` : `Could not read store requests: ${hata}`}
        </p>
      ) : yukleniyor ? (
        <p className="px-4 py-3 text-xs text-gray-400">{oc(dil).yukleniyor}</p>
      ) : talepler.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-400">{tr ? 'Henüz mağaza talebi yok.' : 'No store requests yet.'}</p>
      ) : liste.suzulen.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-500">
          {aramaVar
            ? (tr ? 'Aramayla eşleşen talep yok.' : 'No request matches the search.')
            : (tr ? 'Bu süzgeçte talep yok.' : 'No requests in this filter.')}
        </p>
      ) : (
        <>
          <div aria-hidden="true" className="hidden md:flex border-b border-gray-100 bg-gray-50/60 text-xs font-bold text-gray-400 uppercase">
            <div className={`${BASLIK_IZGARASI} flex-1 min-w-0 px-4 py-2.5`}>
              <span>{tr ? 'Talep no / durum' : 'Request no / status'}</span>
              <span>{oc(dil).tarih}</span>
              <span>{tr ? 'Müşteri / firma' : 'Customer / company'}</span>
              <span>{tr ? 'İl' : 'Province'}</span>
              <span>{oc(dil).kalemler}</span>
              <span>{tr ? 'Talep edilen toplam' : 'Requested total'}</span>
              <span>{tr ? 'Bildirim' : 'Notification'}</span>
            </div>
            <div className={`hidden lg:block ${ISLEM_HUCRESI_GENISLIGI} px-3 py-2.5`}>{oc(dil).islem}</div>
          </div>
          <ul className="divide-y divide-gray-50">
            {liste.gorunen.map((t, i) => {
              const acik = acikId === t.id;
              const g = bildirimGorunumu(t.bildirim, t.olusturma, simdi);
              const detayId = `${kok}-detay-${i}`;
              const islem = islemler[t.id];
              const kilit = kilitSuruyor(islem, t, simdi);
              const mesgul = islem?.mesgul === true;
              const kilitli = mesgul || kilit;
              // 409 gövdesindeki güncel aşama: akış o sürümü geçene kadar rozet onu basar (sonra akışın getirdiği belge).
              // Rozet SÜREYE değil SÜRÜME bağlıdır (inceleme 2026-10-10): düğme kilidi `MAGAZA_AKIS_BEKLEME_MS` sonra açılır,
              // ama akış o arada gelmediyse rozet sunucunun bildirdiği aşamada KALIR — süreye bağlıyken bayat aşamaya dönüyordu.
              const asama = islem?.bekleyen?.asama !== undefined && islem.bekleyen.surum === t.durumSurum ? islem.bekleyen.asama : t.durum;
              const durum = t.durum;
              // Silinmiş talep DONUKTUR: «ilerlet» ve «Yeniden gönder» çizilmez (sunucu 409 `silindi` döner).
              const silinmis = magazaSilinmisMi(t);
              // Revize rozeti yalnız alan VARSA: `null` (alan yok / bozuk) ise rozet kuralı o satır için ikinci kez ÇAĞRILMAZ.
              const gRevize = t.bildirimRevize === null ? null : bildirimGorunumu(t.bildirimRevize, t.icerikZamani, simdi);
              const ileri = durum === null || silinmis ? undefined : magazaIzinliGecisler(durum, t.iptalOncesi).find(h => { const x = magazaGecisi(durum, h, t.iptalOncesi); return x.izinli && x.tur === 'ileri'; });
              const yenidenGonder = !silinmis && magazaYenidenGonderilebilir(g);
              const revizeGonder = !silinmis && gRevize !== null && magazaYenidenGonderilebilir(gRevize);
              const isaretsiz = magazaTeslimIsaretsiz(t);
              const onayAcik = islem?.teslimOnayi === true && ileri === 'teslim' && isaretsiz > 0;
              return (
                <li key={t.id}>
                  <div className="lg:flex lg:items-stretch">
                    <button
                      type="button"
                      aria-expanded={acik}
                      aria-controls={detayId}
                      onClick={() => setAcikId(acik ? null : t.id)}
                      className={`w-full lg:flex-1 lg:min-w-0 text-left px-4 py-3 ${SATIR_IZGARASI} text-sm hover:bg-gray-50/60 focus-visible:outline-2 focus-visible:outline-brand transition-colors`}
                    >
                      <span className="min-w-0">
                        <span className={HUCRE_ETIKETI}>{tr ? 'Talep no' : 'Request no'}</span>
                        <span className="font-medium text-gray-800 break-words">{yaDaCizgi(t.talepNo)}</span>
                        {/* «Silindi» ve «ERP'de açıldı» imleri aşama rozetinden ÖNCE; silinmiş + iptal satır iki rozeti birden taşır. */}
                        {(silinmis || t.elle !== null) && (
                          <span className="flex flex-wrap gap-1 mt-0.5">
                            {silinmis && <span className={`${ROZET} bg-gray-200 text-gray-700`}>{oc(dil).silindi}</span>}
                            {t.elle !== null && <span className={`${ROZET} bg-blue-50 text-blue-700`}>{tr ? "ERP'de açıldı" : 'Opened in ERP'}</span>}
                          </span>
                        )}
                        {/* Silinmiş satırda aşama rozeti SÖNÜK (renksiz): aşama bilgidir, talep donuktur. */}
                        <span className={silinmis ? 'block mt-0.5 grayscale' : 'block mt-0.5'}><AsamaRozeti asama={asama} dil={dil} /></span>
                      </span>
                      <span className="min-w-0">
                        <span className={HUCRE_ETIKETI}>{oc(dil).tarih}</span>
                        <span className="text-gray-600 tabular-nums">{tarihSaatYaz(t.olusturma, undefined, dil)}</span>
                      </span>
                      <span className="min-w-0">
                        <span className={HUCRE_ETIKETI}>{tr ? 'Müşteri / firma' : 'Customer / company'}</span>
                        <span className="block font-medium text-gray-800 break-words">{yaDaCizgi(t.musteri.ad)}</span>
                        {t.musteri.firma.trim() !== '' && <span className="block text-xs text-gray-500 break-words">{t.musteri.firma}</span>}
                      </span>
                      <span className="min-w-0">
                        <span className={HUCRE_ETIKETI}>{tr ? 'İl' : 'Province'}</span>
                        <span className="text-gray-600 break-words">{yaDaCizgi(t.musteri.il)}</span>
                      </span>
                      <span className="min-w-0">
                        <span className={HUCRE_ETIKETI}>{oc(dil).kalemler}</span>
                        <span className="text-gray-600 tabular-nums">{t.kalemler.length} {oc(dil).kalem}</span>
                      </span>
                      <span className="min-w-0">
                        <span className={HUCRE_ETIKETI}>{tr ? 'Talep edilen toplam' : 'Requested total'}</span>
                        <span className="font-semibold text-gray-800 tabular-nums">{paraYaz(t.talepEdilen.toplam)}</span>
                        {toplamEksikMi(t) && <span className="block text-[11px] font-semibold text-yellow-700">{eksikNotu(t, dil)}</span>}
                      </span>
                      <span className="min-w-0">
                        {/* «gitti» işaretsizdir: dar ekranda etiket de çizilmez (boş bir «Bildirim» başlığı kalmasın). Revize bildirimi
                            varsa etiket her durumda çizilir — ikinci rozet «gönderildi»yi de yazar. */}
                        {(g.tur !== 'isaretsiz' || gRevize !== null) && <span className={HUCRE_ETIKETI}>{tr ? 'Bildirim' : 'Notification'}</span>}
                        {g.tur !== 'isaretsiz' && <BildirimRozeti g={g} dil={dil} />}
                        {gRevize !== null && t.bildirimRevize !== null && <RevizeRozeti g={gRevize} alanlar={t.bildirimRevize.alanlar} dil={dil} />}
                      </span>
                    </button>
                    {/* İşlem hücresi satır düğmesinin KARDEŞİDİR (iç içe etkileşimli öğe olmaz). Aşaması okunamayan ve silinmiş satırda
                        ilerlet çizilmez. Düğmesi olmayan satırda da hücre geniş ekranda YER TUTAR: satırın sütunları başlıktaki «İşlem»
                        sütunuyla hizalı kalsın. */}
                    <div className={`${ISLEM_HUCRESI_GENISLIGI} ${ileri !== undefined || yenidenGonder || revizeGonder ? 'px-4 pb-3 lg:px-3 lg:py-3 flex flex-wrap lg:flex-col lg:justify-center gap-2' : 'hidden lg:block'}`}>
                      {ileri !== undefined && durum !== null && (
                        <button type="button" className={DUGME_ANA} disabled={kilitli} onClick={() => ilerlet(t, ileri)}>
                          {gecisEtiketi(durum, ileri, t.iptalOncesi, dil)}
                        </button>
                      )}
                      {yenidenGonder && (
                        <button type="button" className={DUGME_IKINCIL} disabled={mesgul} onClick={() => { void bildirimGonder(t); }}>
                          {tr ? 'Yeniden gönder' : 'Resend'}
                        </button>
                      )}
                      {/* Revize bildirimi AYRI düğmedir (ilk bildirimle aynı kural, aynı nitelik; ikinci değişken `'revize'`). */}
                      {revizeGonder && (
                        <button type="button" className={DUGME_IKINCIL} disabled={mesgul} onClick={() => { void bildirimGonder(t, 'revize'); }}>
                          {tr ? 'Revizeyi yeniden gönder' : 'Resend revision notice'}
                        </button>
                      )}
                    </div>
                  </div>
                  {onayAcik && (
                    <div role="alert" className="px-4 py-2 text-xs text-yellow-700 bg-yellow-50 flex flex-wrap items-center gap-2">
                      <span>
                        {tr
                          ? `${isaretsiz} kalem teslim işaretsiz. Talep yine de «${magazaTalepDurumEtiketi('teslim', dil)}» yapılsın mı? İşaretsiz kalemler kendiliğinden işaretlenmez.`
                          : `${isaretsiz} item${isaretsiz === 1 ? ' is' : 's are'} not marked as delivered. Set the request to “${magazaTalepDurumEtiketi('teslim', dil)}” anyway? Unmarked items are not marked automatically.`}
                      </span>
                      <button type="button" className={DUGME_ANA} disabled={kilitli} onClick={() => { void asamaYaz(t, 'teslim'); }}>
                        {tr ? 'Yine de ilerlet' : 'Advance anyway'}
                      </button>
                      <button type="button" className={DUGME_IKINCIL} onClick={() => islemYaz(t.id, {})}>{oc(dil).vazgec}</button>
                    </div>
                  )}
                  {islem?.ileti !== undefined && (
                    <p
                      role={iletiBilgiMi(islem.ileti) ? 'status' : 'alert'}
                      className={`px-4 py-2 text-xs ${iletiBilgiMi(islem.ileti) ? 'text-gray-700 bg-gray-50' : 'text-red-700 bg-red-50'}`}
                    >
                      {iletiMetni(islem.ileti, dil)}
                    </p>
                  )}
                  <div id={detayId} role="region" aria-label={tr ? `${yaDaCizgi(t.talepNo)} talep detayı` : `Request ${yaDaCizgi(t.talepNo)} detail`} hidden={!acik}>
                    {acik && (
                      <TalepDetayi
                        t={t}
                        g={g}
                        gRevize={gRevize}
                        dil={dil}
                        islem={{
                          asama,
                          kilitli,
                          onGecis: hedef => { void asamaYaz(t, hedef); },
                          onAciklama: metin => (t.durum === null ? Promise.resolve(false) : asamaYaz(t, t.durum, metin)),
                          onTeslim: (teslim, kalemler) => { void teslimYaz(t, teslim, kalemler); },
                          icerikKilitli: icerikKilidiSuruyor(icerikBekleyen[t.id], t, simdi),
                          urunKdvOrani,
                          onIcerik: govde => icerikYaz(t, govde),
                          onSil: onSil === null ? null : () => { void silYaz(t, false); },
                          // «Geri al» yalnız «Silinen / İptal» sekmesi ekranda SEÇİLİYKEN (V24). Arama doluyken süzgeç yok sayılır ve
                          // hiçbir sekme seçili çizilmez: düğmenin görünürlüğü o sırada ekranda GÖRÜNMEYEN `suzgec` durumuna bağlı
                          // kalmasın diye aramada düğme HİÇ çizilmez (en son hangi sekmede kalındığından bağımsız); yerinde ipucu durur.
                          onGeriAl: onSil !== null && silinmis && geriAlSekmesinde ? () => { void silYaz(t, true); } : null,
                          geriAlIpucu: onSil !== null && silinmis && !geriAlSekmesinde,
                        }}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {liste.dahaEski > 0 && (
            <p role="status" className="px-4 py-3 text-xs text-gray-600 bg-gray-50 border-t border-gray-100">
              {tr
                ? `En yeni ${MAGAZA_TALEP_EKRAN_SINIRI} talep gösteriliyor — daha eski ${liste.dahaEski} talep bu listede çizilmedi.`
                : `Showing the newest ${MAGAZA_TALEP_EKRAN_SINIRI} requests — ${liste.dahaEski} older request${liste.dahaEski === 1 ? ' is' : 's are'} not drawn in this list.`}
            </p>
          )}
          {liste.gizliTarihsiz > 0 && (
            <p role="status" className="px-4 py-3 text-xs text-yellow-700 bg-yellow-50 border-t border-gray-100">
              {tr
                ? `Tarihi okunamayan ${liste.gizliTarihsiz} talep daha var; bu listede çizilmedi.`
                : `${liste.gizliTarihsiz} more request${liste.gizliTarihsiz === 1 ? '' : 's'} with an unreadable date ${liste.gizliTarihsiz === 1 ? 'is' : 'are'} not drawn in this list.`}
            </p>
          )}
          {liste.cizilmeyenAcik > 0 && (
            <p role="status" className="px-4 py-3 text-xs font-semibold text-red-700 bg-red-50 border-t border-gray-100">
              {tr
                ? `Çizilmeyen ${liste.cizilmeyenAcik} açık talep var — aramayla bulunabilir.`
                : `${liste.cizilmeyenAcik} open request${liste.cizilmeyenAcik === 1 ? ' is' : 's are'} not drawn — use search to find ${liste.cizilmeyenAcik === 1 ? 'it' : 'them'}.`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
