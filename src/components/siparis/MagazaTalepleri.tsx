/**
 * MagazaTalepleri.tsx — Siparişler ekranının üçüncü kaynak sekmesi: mağazadan (www.cetpa.com.tr) gelen sipariş
 * TALEPLERİ (dilim 1, 2026-10-08). Kullanıcı kararı K1: talep `orders`'a yazılmaz; ayrı koleksiyon, ayrı sekme.
 *
 * DİLİM 2a (şartname v6 § 5.2, 2026-10-10) — liste + detay + İŞLEM: aşama rozeti ve ilerlet / geri al / iptal, müşteriye
 * görünen not, kalem kalem «teslim edildi» işareti, bildirimi «Yeniden gönder», arama kutusu (barkod + Enter), «Etiket
 * basıldı» satırı (salt okunur). Talep İÇERİĞİ (müşteri, kalem, tutar) bu dilimde DEĞİŞMEZ; elle talep ve silme 2b'dedir.
 *
 * BİLEŞEN İSTEK ATMAZ: yazma üç nitelikten gelir (`onDurumDegistir`, `onKalemTeslim`, `onBildirimGonder` — OrdersPage
 * `services/magazaTalepIstemcisi.ts` işlevlerini verir). Koleksiyona istemciden yazmak zaten kapalıdır (`lib/rbac.ts`
 * SUNUCU_YAZAR_COLLECTIONS). İYİMSER GÜNCELLEME YOK: aşama, işaret ve bildirim rozeti akıştan gelen belgeyle çizilir.
 * Her yazım satırın ekranda görülen `durumSurum`'unu geri gönderir (sunucuda CAS); 409'da «başka biri değiştirdi» uyarısı
 * basılır, rozet yanıttaki güncel aşamayı gösterir ve akış o sürümü geçene kadar o talebin işlem düğmeleri kilitlenir
 * (bayat sürümle ikinci istek yine 409 alırdı). Akış gelmezse kilit `MAGAZA_AKIS_BEKLEME_MS` sonra kendiliğinden açılır.
 *
 * KURALLAR TEK KAYNAKTAN: geçiş tablosu `magazaIzinliGecisler` / `magazaGecisi`, açık–kapalı ölçütü `magazaAcikMi`
 * (aşaması okunamayan satır AÇIKTIR — listeden kaybolmaz), kalem teslim işlevleri (`magazaKalemAnahtarlari`,
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
  MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_DURUM_ACIKLAMA_SINIRI,
  bildirimGorunumu, bildirimBeklemeBaslangiciMs, magazaYenidenGonderilebilir,
  magazaAcikMi, magazaGecisi, magazaIzinliGecisler,
  magazaTeslimKaynagi, magazaKalemAnahtarlari, magazaKalemTeslimMi, magazaTeslimIsaretsiz, magazaGuncellemeZamani,
  type BildirimGorunumu, type MagazaBildirimHataSinifi, type MagazaTalepAsamasi,
} from '../../lib/magazaTalep';
import { magazaTalepAramasi } from '../../lib/magazaTalepAramasi';
import { magazaTalepOlusturmaMs, type MagazaTalepSatiri } from '../../hooks/useMagazaTalepleri';
// Yalnız TİP: bu dosya istek atmaz; üç işlevin kendisi OrdersPage'den nitelik olarak gelir.
import type {
  MagazaDurumGirdisi, MagazaDurumSonucu, MagazaKalemTeslimGirdisi, MagazaKalemTeslimSonucu, MagazaBildirimGonderSonucu,
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
  /** Sınır yüzünden çizilmeyenlerden AÇIK olanların sayısı (`magazaAcikMi`; aşaması okunamayan da açıktır). */
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
    cizilmeyenAcik: cizilmeyen.filter(t => magazaAcikMi(t.durum)).length,
  };
}

/** Liste süzgeci: açık / kapalı / hepsi. Varsayılan «açık». */
export type MagazaDurumSuzgeci = 'acik' | 'kapali' | 'hepsi';
const SUZGECLER: readonly MagazaDurumSuzgeci[] = ['acik', 'kapali', 'hepsi'];

/**
 * Durum süzgeci — ölçüt YALNIZ `magazaAcikMi`: aşaması okunamayan (`null`) satır «açık»ta çizilir, «kapalı»da çizilmez
 * (aşama listesiyle `includes` süzgeci panelin açık saydığı satırı burada kaybederdi — kapı 2 deneyi S-C).
 */
export function magazaDurumSuzgeci(talepler: readonly MagazaTalepSatiri[], suzgec: MagazaDurumSuzgeci): MagazaTalepSatiri[] {
  if (suzgec === 'hepsi') return [...talepler];
  return talepler.filter(t => magazaAcikMi(t.durum) === (suzgec === 'acik'));
}

export interface MagazaTalepListesi extends MagazaTalepGorunumu {
  /** Süzgeçlerden geçen talepler — sıralama ve ekran sınırından ÖNCE (Enter'daki «tam bir eşleşme» bunu sayar). */
  suzulen: MagazaTalepSatiri[];
}

/**
 * Listenin tamamı, sırayla: durum süzgeci → arama → sıralama + 200 sınırı. Arama metni doluyken durum süzgeci YOK sayılır
 * (hepsi): barkodu okunan KAPALI talep de bulunur. Sayımlar (`dahaEski`, `cizilmeyenAcik`) süzülmüş kümeden yapılır.
 */
export function magazaTalepListesi(
  talepler: readonly MagazaTalepSatiri[], suzgec: MagazaDurumSuzgeci, arama: string, sinir: number = MAGAZA_TALEP_EKRAN_SINIRI,
): MagazaTalepListesi {
  const suzulen = arama.trim() === '' ? magazaDurumSuzgeci(talepler, suzgec) : magazaTalepAramasi([...talepler], arama);
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
 * Şu an «gönderiliyor» görünen taleplerin uyarıya döneceği EN YAKIN an (ms); yoksa `null`. Rozet kuralı ve bekleme
 * başlangıcı (`max(olusturma, bildirim.zaman)` — kapı 4, Y2) `lib/magazaTalep.ts`'tedir; burada kopyası yoktur.
 */
export function sonrakiBeklemeEsigi(talepler: readonly Pick<MagazaTalepSatiri, 'olusturma' | 'bildirim'>[], simdiMs: number): number | null {
  let enYakin: number | null = null;
  for (const t of talepler) {
    if (bildirimGorunumu(t.bildirim, t.olusturma, simdiMs).tur !== 'gonderiliyor') continue;
    const baslangic = bildirimBeklemeBaslangiciMs(t.bildirim, t.olusturma);
    if (baslangic === null) continue;   // «gönderiliyor» ise başlangıç çözülmüştür; derleyici için
    const esik = baslangic + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS;
    if (enYakin === null || esik < enYakin) enYakin = esik;
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
  | 'degisti' | 'yetki' | 'ag' | 'bulunamadi' | 'silindi'
  | 'bildirim-kuyrukta' | 'bildirim-ayar-eksik' | 'bildirim-kapali' | 'bildirim-zaten-gitti';

interface SatirIletisi {
  kod: IletiKodu;
  /** Yalnız `bildirim-ayar-eksik`: ortam değişkeni ADLARI (değer / sır değil). */
  eksik?: string[];
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
 * Diğer beş aşamada — `yeni` ve `teslim` dâhil — serbesttir. Kutuların çizimi ve işleyici AYNI kuralı okur.
 */
const teslimYazilamaz = (durum: MagazaTalepAsamasi | null): boolean => durum === null || durum === 'iptal';

const kilitSuruyor = (i: SatirIslemi | undefined, t: Pick<MagazaTalepSatiri, 'durumSurum'>, simdiMs: number): boolean =>
  i?.bekleyen !== undefined && i.bekleyen.surum === t.durumSurum && simdiMs < i.bekleyen.bitisMs;

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

const SUZGEC_ETIKETI: Record<MagazaDurumSuzgeci, Record<Dil, string>> = {
  acik: { tr: 'Açık', en: 'Open' },
  kapali: { tr: 'Kapalı', en: 'Closed' },
  hepsi: { tr: 'Hepsi', en: 'All' },
};

/** Kalem listesinin başlığı kaynağı söyler; `teyit` 2b'de çizilir (2a'da kaynak hep beyandır). */
const KALEM_KAYNAGI_BASLIGI: Record<'beyan' | 'teyit', Record<Dil, string>> = {
  beyan: { tr: 'Kalemler — müşteri beyanı', en: 'Line items — as declared by the customer' },
  teyit: { tr: 'Kalemler — teyit edilen', en: 'Line items — as confirmed' },
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
  'bildirim-kuyrukta': { tr: 'Bildirim kuyruğa alındı.', en: 'Notification queued.' },
  // Ayar ADI çevrilmez: sunucudaki ortam değişkeninin kendisidir.
  'bildirim-kapali': { tr: 'Bildirim bu sunucuda kapalı (MAGAZA_BILDIRIM=kapali)', en: 'Notifications are turned off on this server (MAGAZA_BILDIRIM=kapali)' },
  'bildirim-zaten-gitti': { tr: 'Bildirim zaten gönderilmiş', en: 'The notification has already been sent' },
};

function iletiMetni(i: SatirIletisi, dil: Dil): string {
  if (i.kod !== 'bildirim-ayar-eksik') return ILETI_METNI[i.kod][dil];
  const taban = dil === 'tr' ? 'Sunucu posta ayarı eksik' : 'Server mail setting missing';
  // Adlar yanıttan gelir (ör. `APP_URL`); ekran tahmin etmez, değer basmaz. Liste boşsa iki nokta da yok.
  return i.eksik !== undefined && i.eksik.length > 0 ? `${taban}: ${i.eksik.join(', ')}` : taban;
}

/** Yalnız `bildirim-kuyrukta` bilgidir; diğer her ileti uyarı olarak okunur. */
const iletiBilgiMi = (i: SatirIletisi): boolean => i.kod === 'bildirim-kuyrukta';

function eksikNotu(t: MagazaTalepSatiri, dil: Dil): string {
  const n = fiyatiSorulacakKalemSayisi(t);
  if (dil === 'tr') return n > 0 ? `eksik — ${n} kalemin fiyatı sorulacak` : 'eksik — fiyatı sorulacak kalem var';
  return n > 0 ? `incomplete — price to be quoted for ${n} item${n === 1 ? '' : 's'}` : 'incomplete — some items need a price quote';
}

function bildirimAciklamasi(t: MagazaTalepSatiri, g: BildirimGorunumu, dil: Dil): string {
  const tr = dil === 'tr';
  if (g.tur === 'isaretsiz') {
    const zaman = t.bildirim === null ? '—' : tarihSaatYaz(t.bildirim.zaman, undefined, dil);
    return tr ? `Bildirim e-postası gönderildi (${zaman}).` : `Notification e-mail sent (${zaman}).`;
  }
  if (g.tur === 'gonderiliyor') return tr ? 'Bildirim e-postası gönderiliyor.' : 'Notification e-mail is being sent.';
  if (g.neden === 'gonderilemedi') {
    return tr
      ? 'Bildirim e-postası gönderilemedi — denemeler tükendi. Bu talep için e-posta gitmedi.'
      : 'The notification e-mail could not be sent — retries exhausted. No e-mail went out for this request.';
  }
  if (g.neden === 'yapilandirilmamis') {
    // Hangi ayarın eksik olduğu burada SÖYLENMEZ (yerel kipte eksik olan adres ayarı olabilir): ad, düğmeye basılınca yanıttan gelir.
    return tr
      ? 'Sunucu posta ayarı eksik; Yeniden gönder ile denenebilir. Bu talep için e-posta gitmedi.'
      : 'A server mail setting is missing; it can be retried with Resend. No e-mail went out for this request.';
  }
  if (g.neden === 'bekleme-asildi') {
    return tr
      ? `Bildirim e-postası ${BEKLEME_DAKIKA} dakikadan uzun süredir gönderilemedi.`
      : `The notification e-mail has not been sent for more than ${BEKLEME_DAKIKA} minutes.`;
  }
  return tr ? 'Bildirim durumu okunamadı.' : 'The notification status could not be read.';
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
}

function TalepDetayi({ t, g, dil, islem }: { t: MagazaTalepSatiri; g: BildirimGorunumu; dil: Dil; islem: DetayIslemleri }) {
  const tr = dil === 'tr';
  const kok = useId();
  const tel = telBaglantisi(t.musteri.telefon);
  const eposta = epostaBaglantisi(t.musteri.eposta);
  const eksik = toplamEksikMi(t);

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

  return (
    <div className="px-4 pb-4 pt-1 space-y-4 bg-gray-50/60">
      {t.kirpildi === true && (
        <p role="note" className="text-[11px] text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
          {tr ? 'Bazı alanlar uzunluk sınırında kırpıldı — müşterinin yazdığı metnin tamamı kayıtta yok.' : 'Some fields were truncated at the length limit — the full text the customer wrote is not on record.'}
        </p>
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

        {durum !== null && (
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

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase">{KALEM_KAYNAGI_BASLIGI[kaynak][dil]}</p>
          {anahtarlar.length > 0 && (
            <p className="text-xs font-semibold text-gray-600 tabular-nums">
              {tr ? `${anahtarlar.length - isaretsiz} / ${anahtarlar.length} kalem teslim` : `${anahtarlar.length - isaretsiz} / ${anahtarlar.length} items delivered`}
            </p>
          )}
          {/* «Tümünü işaretle / kaldır» TEK istektir (`'hepsi'`), kalem başına istek değil; «kaldır» yalnız hepsi işaretliyken çizilir. */}
          {anahtarlar.length > 0 && !teslimPasif && (
            <button type="button" className={DUGME_IKINCIL} disabled={islem.kilitli} onClick={() => islem.onTeslim(isaretsiz > 0, 'hepsi')}>
              {isaretsiz > 0 ? (tr ? 'Tümünü işaretle' : 'Mark all') : (tr ? 'Tümünü kaldır' : 'Unmark all')}
            </button>
          )}
        </div>
        <div className="border border-gray-100 rounded-xl overflow-x-auto bg-white">
          <table className="w-full text-sm min-w-[680px]">
            <caption className="sr-only">{KALEM_KAYNAGI_BASLIGI[kaynak][dil]}</caption>
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-[10px] font-bold text-gray-500 uppercase">
                <th scope="col" className="px-4 py-2 text-left">{tr ? 'Stok kodu' : 'SKU'}</th>
                <th scope="col" className="px-4 py-2 text-left">{oc(dil).urun}</th>
                <th scope="col" className="px-4 py-2 text-left">{tr ? 'Marka' : 'Brand'}</th>
                <th scope="col" className="px-4 py-2 text-right">{oc(dil).adet_2}</th>
                <th scope="col" className="px-4 py-2 text-right">{tr ? 'Birim fiyat (sitede görülen)' : 'Unit price (as shown on site)'}</th>
                <th scope="col" className="px-4 py-2 text-left">{tr ? 'Teslim' : 'Delivery'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {t.kalemler.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-3 text-xs text-gray-400">{tr ? 'Kalem okunamadı.' : 'No readable line items.'}</td></tr>
              )}
              {t.kalemler.map((k, i) => {
                // Anahtar SAKLANMAZ, türetilir (beyanda `b:<dizin>`); dizi sırası kaynağın sırasıdır.
                const anahtar = i < anahtarlar.length ? anahtarlar[i] : null;
                const teslim = anahtar !== null && magazaKalemTeslimMi(t.kalemTeslim, anahtar);
                const giris = anahtar !== null && Object.prototype.hasOwnProperty.call(t.kalemTeslim, anahtar) ? t.kalemTeslim[anahtar] : null;
                const kalemAdi = k.ad.trim() === '' ? (tr ? `${i + 1}. kalem` : `item ${i + 1}`) : k.ad;
                return (
                  <tr key={i}>
                    <td className="px-4 py-2 text-gray-600 break-words">{yaDaCizgi(k.sku)}</td>
                    <td className="px-4 py-2 text-gray-800 break-words">
                      {yaDaCizgi(k.ad)}
                      {k.tedarik && <span className={`${ROZET} ml-2 bg-yellow-50 text-yellow-700`}>{tr ? 'tedarik edilecek' : 'to be sourced'}</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600 break-words">{yaDaCizgi(k.marka)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number.isFinite(k.adet) ? k.adet.toLocaleString(tr ? 'tr-TR' : 'en-US') : '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {k.talepFiyat === null
                        ? <span className="font-semibold text-yellow-700">{tr ? 'fiyat sorulacak' : 'price to be quoted'}</span>
                        : paraYaz(k.talepFiyat)}
                    </td>
                    <td className="px-4 py-2">
                      {anahtar !== null && (
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
                      )}
                      {/* İşareti verenin adı ve zamanı personel bilgisidir (ERP'de görünür; panel kartına ve takip yanıtına dönmez). */}
                      {teslim && giris !== null && (
                        <span className="block text-[11px] text-gray-500 break-words">{yaDaCizgi(giris.kim.ad)} · {tarihSaatYaz(giris.zaman, undefined, dil)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

      <p className={`text-[11px] ${g.tur === 'uyari' ? (g.neden === 'gonderilemedi' || g.neden === 'yapilandirilmamis' ? 'text-red-700' : 'text-yellow-700') : 'text-gray-500'}`}>
        {bildirimAciklamasi(t, g, dil)}
        {g.tur !== 'isaretsiz' && t.bildirim !== null && t.bildirim.deneme !== undefined && (
          <> {tr ? `Başarısız deneme: ${t.bildirim.deneme}.` : `Failed attempts: ${t.bildirim.deneme}.`}</>
        )}
        {g.tur !== 'isaretsiz' && t.bildirim !== null && t.bildirim.hataSinifi !== undefined && (
          <> {tr ? `Hata sınıfı: ${HATA_SINIFI_ETIKETI[t.bildirim.hataSinifi].tr}.` : `Error class: ${HATA_SINIFI_ETIKETI[t.bildirim.hataSinifi].en}.`}</>
        )}
      </p>
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
  /** Bildirimi elle kuyruğa alma («Yeniden gönder») — `magazaBildirimGonder`. */
  onBildirimGonder: (id: string) => Promise<MagazaBildirimGonderSonucu>;
}

export default function MagazaTalepleri({ talepler, yukleniyor, hata, currentLanguage, onDurumDegistir, onKalemTeslim, onBildirimGonder }: Props) {
  const dil = currentLanguage;
  const tr = dil === 'tr';
  const kok = useId();
  const [acikId, setAcikId] = useState<string | null>(null);
  const [suzgec, setSuzgec] = useState<MagazaDurumSuzgeci>('acik');
  // Arama metni bileşen içi durumdur: depolamaya yazılmaz, nitelik değildir.
  const [arama, setArama] = useState('');
  const aramaVar = arama.trim() !== '';
  const liste = useMemo(() => magazaTalepListesi(talepler, suzgec, arama), [talepler, suzgec, arama]);
  const acikSayisi = useMemo(() => talepler.filter(t => magazaAcikMi(t.durum)).length, [talepler]);
  const suzgecSayisi: Record<MagazaDurumSuzgeci, number> = { acik: acikSayisi, kapali: talepler.length - acikSayisi, hepsi: talepler.length };

  const [islemler, setIslemler] = useState<Record<string, SatirIslemi>>({});
  // Uçuştaki istekler: durum güncellemesi çizime yansımadan gelen ikinci tıklama da istek ÜRETMEZ.
  const ucusta = useRef<Set<string>>(new Set());
  const islemYaz = (id: string, yeni: SatirIslemi): void => setIslemler(o => ({ ...o, [id]: yeni }));

  // Saatle değişen iki şey veriyle değil ZAMANLA yeniden çizilir (tek zamanlayıcı, en yakın eşik):
  //   • «gönderiliyor» → «bildirim gönderilmedi»: bildirim işçisi durmuşsa doküman hiç değişmez, ekran «gönderiliyor»da takılırdı;
  //   • akış bekleme kilidi: akış yeni sürümü getirmezse düğmeler `MAGAZA_AKIS_BEKLEME_MS` sonra açılır.
  const [, yenidenCiz] = useState(0);
  const simdi = Date.now();
  useEffect(() => {
    const su = Date.now();
    const bildirimEsigi = sonrakiBeklemeEsigi(liste.gorunen, su);
    let enYakin: number | null = bildirimEsigi === null ? null : bildirimEsigi + 1000;
    for (const i of Object.values(islemler)) {
      if (i.bekleyen === undefined || i.bekleyen.bitisMs <= su) continue;
      if (enYakin === null || i.bekleyen.bitisMs < enYakin) enYakin = i.bekleyen.bitisMs;
    }
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

  /** Aşama geçişi ya da (aynı aşamada) açıklama yazımı. Gövdede satırın ekranda görülen sürümü gider. */
  const asamaYaz = async (t: MagazaTalepSatiri, hedef: MagazaTalepAsamasi, aciklama?: string): Promise<boolean> => {
    if (t.durum === null || yazimKilitli(t)) return false;
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
    if (teslimYazilamaz(t.durum) || yazimKilitli(t)) return;
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

  /** «Yeniden gönder»: iyimser rozet YOK — başarıda sunucu `bekliyor` yazar, rozet akıştan «gönderiliyor»a döner. */
  const bildirimGonder = async (t: MagazaTalepSatiri): Promise<void> => {
    if (ucusta.current.has(t.id)) return;
    ucusta.current.add(t.id);
    // Bildirim yazımı sürümü ilerletmez: süren akış kilidi (varsa) korunur.
    const onceki = islemler[t.id]?.bekleyen;
    const koru: SatirIslemi = onceki !== undefined ? { bekleyen: onceki } : {};
    islemYaz(t.id, { ...koru, mesgul: true });
    let s: MagazaBildirimGonderSonucu;
    try {
      s = await onBildirimGonder(t.id);
    } catch {
      s = { ok: false, kod: 'ag' };
    }
    ucusta.current.delete(t.id);
    if (s.ok) islemYaz(t.id, { ...koru, ileti: { kod: 'bildirim-kuyrukta' } });
    else if (s.kod === 'yapilandirilmamis') islemYaz(t.id, { ...koru, ileti: { kod: 'bildirim-ayar-eksik', ...(s.eksik !== undefined ? { eksik: s.eksik } : {}) } });
    else if (s.kod === 'kapali') islemYaz(t.id, { ...koru, ileti: { kod: 'bildirim-kapali' } });
    else if (s.kod === 'zaten-gitti') islemYaz(t.id, { ...koru, ileti: { kod: 'bildirim-zaten-gitti' } });
    else islemYaz(t.id, { ...koru, ileti: { kod: s.kod } });
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
          {listeHazir && <span className="ml-2 text-xs font-semibold text-gray-400 tabular-nums">{talepler.length}</span>}
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
            {SUZGECLER.map(s => {
              // Arama doluyken durum süzgeci YOK sayılır: geçerli olan «hepsi»dir, düğmeler pasif çizilir.
              const secili = aramaVar ? s === 'hepsi' : s === suzgec;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={secili}
                  disabled={aramaVar}
                  onClick={() => setSuzgec(s)}
                  className={`${DUGME} ${secili ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  {SUZGEC_ETIKETI[s][dil]} <span className="ml-1 tabular-nums">{suzgecSayisi[s]}</span>
                </button>
              );
            })}
          </div>
          {aramaVar && (
            <p className="basis-full text-[11px] text-gray-500">
              {tr ? 'Arama açık ve kapalı bütün taleplerde yapılır; Enter tek eşleşmenin detayını açar.' : 'Search covers all requests, open and closed; Enter opens the detail of a single match.'}
            </p>
          )}
        </div>
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
              const ileri = durum === null ? undefined : magazaIzinliGecisler(durum, t.iptalOncesi).find(h => { const x = magazaGecisi(durum, h, t.iptalOncesi); return x.izinli && x.tur === 'ileri'; });
              const yenidenGonder = magazaYenidenGonderilebilir(g);
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
                        <span className="block mt-0.5"><AsamaRozeti asama={asama} dil={dil} /></span>
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
                        {/* «gitti» işaretsizdir: dar ekranda etiket de çizilmez (boş bir «Bildirim» başlığı kalmasın). */}
                        {g.tur !== 'isaretsiz' && (
                          <>
                            <span className={HUCRE_ETIKETI}>{tr ? 'Bildirim' : 'Notification'}</span>
                            <BildirimRozeti g={g} dil={dil} />
                          </>
                        )}
                      </span>
                    </button>
                    {/* İşlem hücresi satır düğmesinin KARDEŞİDİR (iç içe etkileşimli öğe olmaz). Aşaması okunamayan satırda ilerlet çizilmez.
                        Düğmesi olmayan satırda da hücre geniş ekranda YER TUTAR: satırın sütunları başlıktaki «İşlem» sütunuyla hizalı kalsın. */}
                    <div className={`${ISLEM_HUCRESI_GENISLIGI} ${ileri !== undefined || yenidenGonder ? 'px-4 pb-3 lg:px-3 lg:py-3 flex flex-wrap lg:flex-col lg:justify-center gap-2' : 'hidden lg:block'}`}>
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
                        dil={dil}
                        islem={{
                          asama,
                          kilitli,
                          onGecis: hedef => { void asamaYaz(t, hedef); },
                          onAciklama: metin => (t.durum === null ? Promise.resolve(false) : asamaYaz(t, t.durum, metin)),
                          onTeslim: (teslim, kalemler) => { void teslimYaz(t, teslim, kalemler); },
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
