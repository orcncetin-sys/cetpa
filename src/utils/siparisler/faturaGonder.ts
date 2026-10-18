/**
 * faturaGonder.ts — `/api/mikro/fatura/kaydet` ve `/api/mikro/fatura/sonuc` YANITLARININ iletisi (2026-10-17, şartname
 * `.wf/SARTNAME-efatura-cift-kesim.md` § 7 D9; `irsaliyeYanitMesaji` kalıbı — irsaliyeGonder.ts). SAF: React, DB, ağ yok.
 * Test: faturaGonder.test.ts (B3).
 *
 * KURAL: ileti yanıttaki `kod`'dan seçilir, HTTP durumundan DEĞİL — Mikro 5xx'i ve stub'ı eskiden Cetpa 200 olarak dönüyordu;
 * aynı `kod` HTTP 200 de 502 de gelse AYNI metni verir. HTTP durumu yalnız iki yerde okunur: (1) 409'lar «daha ÖNCEKİ bir
 * denemenin» durumunu söyler (sunucu bu istekte Mikro'ya hiç gitmedi) — `FATURA_SONUCU_BILINMIYOR` 409'da «önce kaydı çözün»,
 * başka durumda «kesilmiş OLABİLİR» der; (2) `kod` taşımayan yanıt (vekil / kimlik katmanı): 4xx istek sunucuya bile ulaşmadı
 * → «gönderilmedi», 5xx / yanıt yok → «kesilmiş OLABİLİR» (güvenli yön).
 *
 * «Gönderilmedi» ile «kesilmiş OLABİLİR» AYRIDIR: gönderim başlamadan düşen hata (gövde, kimlik bilgisi, belirteç) için
 * «OLABİLİR» demek kullanıcıyı gereksiz Mikro kontrolüne ve sonra da yanlış «Mikro'da var» seçimine iterdi.
 */
import type { ArayuzDili } from '../zaman';
import type { FaturaKesilemezNedeni, FaturaSonucKarari, FaturaYanitKodu, MikroFaturaGonderimi } from '../../lib/faturaGonderimi';

/** Sunucunun fatura yanıtı (istemci tipi — App.tsx `handleMikroFatura` / `handleMikroFaturaSonuc`). */
export interface FaturaYaniti {
  success?: boolean;
  kod?: FaturaYanitKodu;
  error?: string | null;
  mikroFaturaNo?: string | null;
  /** Kaydet: Mikro'nun döndürdüğü ETTN. `fatura/sonuc` + ETTN: sunucunun YAZDIĞI satırdaki anahtar — istemci yerel yamasını
   *  bununla yapar, ham girdiyle değil (§ 9.B B5). */
  ettn?: string | null;
  /** 409 `FATURA_GONDERILDI`: siparişin (yoksa işaretin) numarası; yoksa alan YOK (D14). */
  numara?: string;
  neden?: FaturaKesilemezNedeni;
  notConfigured?: boolean;
  localUpdateFailed?: boolean;
  belgeTipiIletildi?: boolean;
  /** Güncel gönderim işareti (D8); `null` = işaret yok (geri alındı / çözüldü). 404'te alan yoktur. */
  mikroFaturaGonderimi?: MikroFaturaGonderimi | null;
  /** `fatura/sonuc` yanıtında uygulanan karar (`ettnEkle` — şartname «fatura gövde + gece MF» § 9.B B2). */
  karar?: FaturaSonucKarari;
  /** `fatura/sonuc` + ETTN: fatura aynasında ETTN yok ya da carisi doğrulanamadı — yazım KABUL edildi (§ 9.B B3). */
  uyari?: string;
}

export interface FaturaMesaji {
  tur: 'success' | 'error' | 'info';
  metin: string;
}

const doluMetin = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** «Kesilmiş OLABİLİR» — e-İrsaliyenin «yanıt alınamadı» iletisinin karşılığı (App.tsx `handleEIrsaliye`). */
export function faturaOlabilirMetni(dil: ArayuzDili): string {
  return dil === 'tr'
    ? 'Fatura Mikro\'da kesilmiş OLABİLİR. Tekrar göndermeden önce Mikro\'dan kontrol edin.'
    : 'The invoice MAY have been issued in Mikro. Check Mikro before sending again.';
}

function kesilemezMetni(neden: FaturaKesilemezNedeni | undefined, dil: ArayuzDili): string {
  const tr = dil === 'tr';
  if (neden === 'mikro-fatura') return tr ? 'Bu kayıt Mikro faturasından türetildi — ikinci fatura kesilemez.' : 'This record was derived from a Mikro invoice — a second invoice cannot be issued.';
  if (neden === 'magaza') return tr ? 'Çevrim içi mağaza siparişine buradan fatura kesilemez.' : 'An invoice cannot be issued here for an online store order.';
  if (neden === 'faturasiz') return tr ? 'Faturasız satışa fatura kesilemez.' : 'An invoice cannot be issued for a sale without invoice.';
  return tr ? 'Bu siparişe fatura kesilemez.' : 'An invoice cannot be issued for this order.';
}

/** 409 ve «zaten» durumları — ÖNCEKİ bir denemenin hâli (bu istekte Mikro'ya gidilmedi). */
function oncekiDurumMesaji(kod: FaturaYanitKodu, yanit: FaturaYaniti, dil: ArayuzDili): FaturaMesaji | null {
  const tr = dil === 'tr';
  if (kod === 'FATURA_GONDERILIYOR') return { tur: 'info', metin: tr ? 'Bu siparişin faturası şu an gönderiliyor.' : 'The invoice for this order is being sent right now.' };
  if (kod === 'FATURA_GONDERILDI') {
    const no = doluMetin(yanit.numara) ? ` (No: ${yanit.numara})` : '';
    return { tur: 'info', metin: tr ? `Bu siparişin faturası zaten kesildi${no}.` : `The invoice for this order was already issued${no}.` };
  }
  if (kod === 'FATURA_SONUCU_BILINMIYOR') {
    return { tur: 'error', metin: tr
      ? 'Bu siparişin fatura sonucu bilinmiyor; önce Mikro\'dan kontrol edip kaydı çözün.'
      : 'The invoice result for this order is unknown; check Mikro and resolve the record first.' };
  }
  if (kod === 'FATURA_SONUC_YOK') return { tur: 'info', metin: tr ? 'Bu siparişte çözülecek bir fatura sonucu yok.' : 'There is no invoice result to resolve on this order.' };
  // `fatura/sonuc` ETTN kodları (§ 9.B B2 / B3). Sunucu iletisi ayrıntıyı (öteki siparişin numarası, faturanın carisi) taşır:
  // Türkçede ileti odur (yoksa genel cümle), İngilizcede genel cümle + parantez içinde sunucu iletisi.
  const ayrinti = doluMetin(yanit.error) ? yanit.error.trim().replace(/\.$/, '') : '';
  const ettnRet = (trGenel: string, enGenel: string): FaturaMesaji => ({ tur: 'error', metin: tr
    ? `ETTN yazılmadı. ${ayrinti || trGenel}. Mikro'daki ETTN'yi denetleyin.`
    : `ETTN not saved: ${enGenel}${ayrinti ? ` (${ayrinti})` : ''}. Check the ETTN in Mikro.` });
  if (kod === 'FATURA_ETTN_VAR') return { tur: 'info', metin: tr ? 'Bu siparişin ETTN\'si zaten kayıtlı.' : 'This order already has an ETTN on record.' };
  if (kod === 'FATURA_ETTN_BASKA_SIPARISTE') return ettnRet('Bu ETTN başka bir siparişte kayıtlı', 'this ETTN is recorded on another order');
  if (kod === 'FATURA_ETTN_BASKA_CARI') {
    return ettnRet('Mikro fatura kayıtlarına göre bu ETTN bu siparişin faturası değil', 'according to Mikro\'s invoice records this ETTN is not this order\'s invoice');
  }
  if (kod === 'FATURA_ETTN_ONCEKI_FATURA') {
    // Aynı carinin talepten ÖNCEKİ faturası (o fatura zaten Mikro faturası siparişine dönüşmüştür) — sunucu iletisi iki günü taşır.
    return ettnRet('Mikro fatura kayıtlarına göre bu ETTN talepten önceki bir faturanın; bu siparişin faturası olamaz',
      'according to Mikro\'s invoice records this ETTN belongs to an invoice dated before the request, so it cannot be this order\'s invoice');
  }
  if (kod === 'FATURA_ETTN_DEGISTI') return { tur: 'error', metin: tr ? 'Kayıt bu arada değişti; sayfayı yenileyip yeniden deneyin.' : 'The record changed in the meantime; refresh and try again.' };
  return null;
}

/**
 * `fatura/kaydet` yanıtının iletisi. `durum` = HTTP durumu (`null` = yanıt alınamadı); `yanit` = JSON gövde (`null` = gövde
 * okunamadı: ağ hatası, vekilin HTML'i). Başarı iletisi çağıranda (belge tipi uyarısıyla birlikte) — burada yalnız kısa metin.
 */
export function faturaYanitMesaji(durum: number | null, yanit: FaturaYaniti | null, dil: ArayuzDili): FaturaMesaji {
  const tr = dil === 'tr';
  if (!yanit) return { tur: 'error', metin: faturaOlabilirMetni(dil) };
  if (yanit.success === true && yanit.localUpdateFailed === true) {
    // Kesildi ama sipariş işaretlenemedi (D4 0 satır / yazım hatası — karar İA-2): e-İrsaliye «işaretlenemedi» iletisinin karşılığı.
    // «Kaydedildi» demek yetmez: liste işaretsiz görünür, kullanıcı yeniden göndermeyi dener (sunucu 409 der ama ileti önce uyarır).
    return { tur: 'error', metin: tr
      ? 'Fatura Mikro\'da kesildi ama sipariş işaretlenemedi — YENİDEN GÖNDERMEYİN, sayfayı yenileyin.'
      : 'The invoice was issued in Mikro but the order could not be marked — DO NOT resend, refresh the page.' };
  }
  if (yanit.success === true) {
    const no = doluMetin(yanit.mikroFaturaNo) ? yanit.mikroFaturaNo : '';
    return { tur: 'success', metin: `${tr ? 'Fatura kaydedildi' : 'Invoice recorded'}: ${no}` };
  }
  const kod = yanit.kod;
  const sebep = doluMetin(yanit.error) ? yanit.error : (tr ? 'bilinmeyen neden' : 'unknown reason');
  if (kod === undefined) {
    // `kod` taşımayan yanıt: kimlik / yetki katmanı (4xx — istek rotaya ulaşmadı) ya da vekil / çökme (5xx — bilinmiyor).
    if (durum !== null && durum >= 400 && durum < 500) return { tur: 'error', metin: `${tr ? 'Fatura gönderilmedi' : 'Invoice not sent'}: ${sebep}` };
    return { tur: 'error', metin: faturaOlabilirMetni(dil) };
  }
  if (kod === 'FATURA_GONDERILMEDI') return { tur: 'error', metin: `${tr ? 'Fatura gönderilmedi' : 'Invoice not sent'}: ${sebep}` };
  if (kod === 'FATURA_REDDEDILDI') {
    return { tur: 'error', metin: tr
      ? `Mikro faturayı reddetti: ${sebep}. Düzeltip yeniden gönderebilirsiniz.`
      : `Mikro rejected the invoice: ${sebep}. You can fix it and send again.` };
  }
  if (kod === 'FATURA_KESILEMEZ') return { tur: 'error', metin: kesilemezMetni(yanit.neden, dil) };
  if (durum === 409) {
    const onceki = oncekiDurumMesaji(kod, yanit, dil);
    if (onceki) return onceki;
  }
  // `FATURA_SONUCU_BILINMIYOR` (bu istek Mikro'ya gitti, sonucu okunamadı) ve tanınmayan kod: güvenli yön.
  return { tur: 'error', metin: faturaOlabilirMetni(dil) };
}

/**
 * `fatura/sonuc` yanıtının iletisi (D6). `istenen` = kullanıcının verdiği karar (başarısız yanıt kararı taşımaz): «ETTN ekle»
 * hatası «Kayıt çözülemedi» değil «ETTN eklenemedi» der. 409 dışındaki hatada (400 `FATURA_ETTN_GECERSIZ`, şema iletisi, 404)
 * SUNUCU iletisi gösterilir.
 */
export function faturaSonucMesaji(durum: number | null, yanit: FaturaYaniti | null, dil: ArayuzDili, istenen?: FaturaSonucKarari): FaturaMesaji {
  const tr = dil === 'tr';
  const ettnEkle = istenen === 'ettnEkle';
  const hataOnu = ettnEkle ? (tr ? 'ETTN eklenemedi' : 'Could not add the ETTN') : (tr ? 'Kayıt çözülemedi' : 'Could not resolve the record');
  if (!yanit) return { tur: 'error', metin: `${hataOnu}: ${tr ? 'yanıt alınamadı. Sayfayı yenileyip yeniden deneyin.' : 'no response. Refresh and try again.'}` };
  if (yanit.success === true) {
    if (yanit.karar === 'ettnEkle') return { tur: 'success', metin: tr ? 'ETTN eklendi: fatura bu siparişe bağlandı.' : 'ETTN added: the invoice is linked to this order.' };
    return yanit.karar === 'mikrodaYok'
      ? { tur: 'success', metin: tr ? 'Kayıt çözüldü: fatura Mikro\'da yok, yeniden gönderilebilir.' : 'Resolved: the invoice is not in Mikro and can be sent again.' }
      : { tur: 'success', metin: tr ? 'Kayıt çözüldü: fatura Mikro\'da kesilmiş olarak işaretlendi.' : 'Resolved: the invoice is marked as issued in Mikro.' };
  }
  if (yanit.kod !== undefined && durum === 409) {
    const onceki = oncekiDurumMesaji(yanit.kod, yanit, dil);
    if (onceki) return onceki;
  }
  return { tur: 'error', metin: `${hataOnu}: ${doluMetin(yanit.error) ? yanit.error : (tr ? 'bilinmeyen neden' : 'unknown reason')}` };
}

/** Başarılı ETTN yazımında sunucu `uyari` döndürdüyse (fatura aynasında ETTN yok / carisi doğrulanamadı — § 9.B B3) ek bilgi
 *  iletisi; yoksa `null`. Metin istemcide: sunucunun Türkçe iletisi İngilizce arayüze sızmasın. */
export function faturaSonucUyarisi(yanit: FaturaYaniti | null, dil: ArayuzDili): FaturaMesaji | null {
  if (!yanit || yanit.success !== true || !doluMetin(yanit.uyari)) return null;
  return { tur: 'info', metin: dil === 'tr'
    ? 'ETTN kaydedildi ama Mikro fatura aynasında henüz yok ya da carisi doğrulanamadı (ayna gece güncellenir). ETTN\'yi Mikro\'daki faturayla bir kez daha karşılaştırın.'
    : 'The ETTN was saved but is not yet in the Mikro invoice mirror, or its customer could not be verified (the mirror updates nightly). Compare the ETTN with the invoice in Mikro once more.' };
}
