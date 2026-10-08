/**
 * MagazaTalepleri.tsx — Siparişler ekranının üçüncü kaynak sekmesi: mağazadan (www.cetpa.com.tr) gelen sipariş
 * TALEPLERİ (dilim 1, 2026-10-08). Kullanıcı kararı K1: talep `orders`'a yazılmaz; ayrı koleksiyon, ayrı sekme.
 *
 * SALT OKUNUR: liste + detay. Bu dilimde işlem düğmesi YOKTUR (teyit / ret / siparişe çevirme dilim 2); koleksiyona
 * istemciden yazmak zaten kapalıdır (`lib/rbac.ts` SUNUCU_YAZAR_COLLECTIONS).
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
 * en yeni `MAGAZA_TALEP_EKRAN_SINIRI` talebi çizer, gerisini «daha eski N talep» diye SAYAR. Saklama / arşiv dilim 2.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { paraYaz } from '../../utils/currency';
import { tarihSaatYaz, zamanMs } from '../../utils/zaman';
import { oc } from '../../i18n/ortak';
import { op } from '../../i18n/orders';
import { MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, type MagazaBildirimHataSinifi } from '../../lib/magazaTalep';
import { magazaTalepOlusturmaMs, type MagazaTalepSatiri } from '../../hooks/useMagazaTalepleri';

type Dil = 'tr' | 'en';

/** Ekranda çizilen en yeni talep sayısı; fazlası sayılır, çizilmez. */
export const MAGAZA_TALEP_EKRAN_SINIRI = 200;

// ── Saf görünüm kuralları (testleri: MagazaTalepleri.test.tsx) ──────────────────────────────────────────────────────

export interface MagazaTalepGorunumu {
  /** Çizilecek satırlar: en yeni önce; `olusturma`'sı çözülemeyenler SONDA. */
  gorunen: MagazaTalepSatiri[];
  /** Sınır yüzünden çizilmeyen (daha eski) talep sayısı. */
  dahaEski: number;
  /** Sınır yüzünden çizilmeyen, tarihi okunamayan talep sayısı («daha eski» DENEMEZ — ne zaman geldiği bilinmiyor). */
  gizliTarihsiz: number;
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
  return {
    gorunen: [...gorunenTarihli, ...gorunenTarihsiz],
    dahaEski: tarihli.length - gorunenTarihli.length,
    gizliTarihsiz: tarihsiz.length - gorunenTarihsiz.length,
  };
}

/** Fiyatı sorulacak (müşteri sitede fiyat GÖRMEDİ) kalem sayısı. */
export function fiyatiSorulacakKalemSayisi(t: Pick<MagazaTalepSatiri, 'kalemler'>): number {
  return t.kalemler.filter(k => k.talepFiyat === null).length;
}

/** Talep edilen toplam EKSİK mi: sunucunun işareti YA DA fiyatsız kalem (işaret eski / bozuk dokümanda eksik olabilir). */
export function toplamEksikMi(t: Pick<MagazaTalepSatiri, 'kalemler' | 'fiyatiSorulacakVar'>): boolean {
  return t.fiyatiSorulacakVar || fiyatiSorulacakKalemSayisi(t) > 0;
}

export type BildirimGorunumu =
  | { tur: 'isaretsiz' }                                                                                   // gitti
  | { tur: 'gonderiliyor' }                                                                                // taze «bekliyor»
  | { tur: 'uyari'; neden: 'gonderilemedi' | 'yapilandirilmamis' | 'bekleme-asildi' | 'okunamadi' };

/**
 * «bekliyor» ne zamandır sürüyor: talebin KAYIT saati ile bildirimin son durum saatinden ERKEN olanı. Bildirim kayıtla
 * birlikte «bekliyor» başlar; her başarısız deneme `bildirim.zaman`'ı ileri alır ama durum hâlâ «bekliyor»dur — yalnız
 * `bildirim.zaman`'a bakılsaydı 5 kez denenmiş, 40 dakikalık talep her denemeden sonra yeniden «gönderiliyor» görünürdü.
 * İkisi de çözülemiyorsa `null`.
 */
function beklemeBaslangiciMs(t: Pick<MagazaTalepSatiri, 'olusturma' | 'bildirim'>): number | null {
  const kayit = magazaTalepOlusturmaMs(t);
  const durum = t.bildirim === null ? null : zamanMs(t.bildirim.zaman);
  if (kayit === null) return durum;
  return durum === null ? kayit : Math.min(kayit, durum);
}

/**
 * Bildirim e-postasının ekrandaki durumu. Uyarı çizilenler: `gonderilemedi`, `yapilandirilmamis`,
 * `MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS`'ten eski `bekliyor` ve OKUNAMAYAN durum. Süresi ölçülemeyen «bekliyor» TAZE
 * SAYILMAZ (ne kadar beklediği bilinmiyor — «gönderiliyor» demek sahte güvence olurdu).
 */
export function bildirimGorunumu(t: Pick<MagazaTalepSatiri, 'olusturma' | 'bildirim'>, simdiMs: number): BildirimGorunumu {
  const b = t.bildirim;
  if (b === null) return { tur: 'uyari', neden: 'okunamadi' };
  if (b.durum === 'gitti') return { tur: 'isaretsiz' };
  if (b.durum === 'gonderilemedi' || b.durum === 'yapilandirilmamis') return { tur: 'uyari', neden: b.durum };
  const baslangic = beklemeBaslangiciMs(t);
  return baslangic !== null && simdiMs - baslangic <= MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS
    ? { tur: 'gonderiliyor' }
    : { tur: 'uyari', neden: 'bekleme-asildi' };
}

/** Şu an «gönderiliyor» görünen taleplerin uyarıya döneceği EN YAKIN an (ms); yoksa `null`. */
export function sonrakiBeklemeEsigi(talepler: readonly Pick<MagazaTalepSatiri, 'olusturma' | 'bildirim'>[], simdiMs: number): number | null {
  let enYakin: number | null = null;
  for (const t of talepler) {
    if (bildirimGorunumu(t, simdiMs).tur !== 'gonderiliyor') continue;
    const baslangic = beklemeBaslangiciMs(t);
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

// ── Metinler ────────────────────────────────────────────────────────────────────────────────────────────────────────

const HATA_SINIFI_ETIKETI: Record<MagazaBildirimHataSinifi, Record<Dil, string>> = {
  kimlik: { tr: 'kimlik doğrulama', en: 'authentication' },
  tls: { tr: 'TLS / sertifika', en: 'TLS / certificate' },
  baglanti: { tr: 'bağlantı', en: 'connection' },
  'alici-reddi': { tr: 'alıcı reddi', en: 'recipient rejected' },
  diger: { tr: 'diğer', en: 'other' },
};

const BEKLEME_DAKIKA = Math.round(MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS / 60_000);

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
    return tr
      ? 'E-posta bildirimi yapılandırılmamış (sunucuda SMTP ayarı eksik). Bu talep için e-posta gitmedi.'
      : 'E-mail notification is not configured (SMTP settings missing on the server). No e-mail went out for this request.';
  }
  if (g.neden === 'bekleme-asildi') {
    return tr
      ? `Bildirim e-postası ${BEKLEME_DAKIKA} dakikadan uzun süredir gönderilemedi.`
      : `The notification e-mail has not been sent for more than ${BEKLEME_DAKIKA} minutes.`;
  }
  return tr ? 'Bildirim durumu okunamadı.' : 'The notification status could not be read.';
}

// ── Parçalar ────────────────────────────────────────────────────────────────────────────────────────────────────────

const ROZET = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold';
// Liste satırı ve başlığı AYNI sütunları kullanır (md ve üstü 7 sütun). Dar ekranda satır iki sütuna katlanır, başlık çizilmez.
const SUTUNLAR = 'gap-x-4 gap-y-1 md:grid-cols-[8.5rem_8.5rem_minmax(0,1.4fr)_minmax(0,0.7fr)_4.5rem_minmax(0,1.2fr)_minmax(0,1fr)] md:items-center';
const SATIR_IZGARASI = `grid grid-cols-2 ${SUTUNLAR}`;
const BASLIK_IZGARASI = `hidden md:grid ${SUTUNLAR}`;
// Hücre etiketi: dar ekranda görünür (başlık satırı yok), geniş ekranda yalnız ekran okuyucuya.
const HUCRE_ETIKETI = 'block text-[10px] font-bold text-gray-400 uppercase md:sr-only';

/**
 * «Yeni» talep rozeti — sekme düğmesinin İÇİNE konur (sayı: `useMagazaYeniSayaci`). Sayı 0 ise hiçbir şey çizmez.
 * `aria-label` düğmenin erişilebilir adına katılır: «Mağaza Talepleri 3 yeni talep».
 */
export function MagazaYeniRozeti({ sayi, currentLanguage }: { sayi: number; currentLanguage: Dil }) {
  if (!(sayi > 0)) return null;
  const etiket = currentLanguage === 'tr' ? `${sayi} yeni talep` : `${sayi} new request${sayi === 1 ? '' : 's'}`;
  return (
    <span aria-label={etiket} title={etiket} className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-red-50 text-red-700 text-[11px] font-bold tabular-nums">
      {sayi}
    </span>
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

function TalepDetayi({ t, g, dil }: { t: MagazaTalepSatiri; g: BildirimGorunumu; dil: Dil }) {
  const tr = dil === 'tr';
  const tel = telBaglantisi(t.musteri.telefon);
  const eposta = epostaBaglantisi(t.musteri.eposta);
  const eksik = toplamEksikMi(t);
  return (
    <div className="px-4 pb-4 pt-1 space-y-4 bg-gray-50/60">
      {t.kirpildi === true && (
        <p role="note" className="text-[11px] text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
          {tr ? 'Bazı alanlar uzunluk sınırında kırpıldı — müşterinin yazdığı metnin tamamı kayıtta yok.' : 'Some fields were truncated at the length limit — the full text the customer wrote is not on record.'}
        </p>
      )}

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

      <div className="border border-gray-100 rounded-xl overflow-x-auto bg-white">
        <table className="w-full text-sm min-w-[560px]">
          <caption className="sr-only">{oc(dil).kalemler}</caption>
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-[10px] font-bold text-gray-500 uppercase">
              <th scope="col" className="px-4 py-2 text-left">{tr ? 'Stok kodu' : 'SKU'}</th>
              <th scope="col" className="px-4 py-2 text-left">{oc(dil).urun}</th>
              <th scope="col" className="px-4 py-2 text-left">{tr ? 'Marka' : 'Brand'}</th>
              <th scope="col" className="px-4 py-2 text-right">{oc(dil).adet_2}</th>
              <th scope="col" className="px-4 py-2 text-right">{tr ? 'Birim fiyat (sitede görülen)' : 'Unit price (as shown on site)'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {t.kalemler.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-3 text-xs text-gray-400">{tr ? 'Kalem okunamadı.' : 'No readable line items.'}</td></tr>
            )}
            {t.kalemler.map((k, i) => (
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
  /** `useMagazaTalepleri(...).talepler` — sırasız; sıralama ve ekran sınırı burada. */
  talepler: readonly MagazaTalepSatiri[];
  yukleniyor: boolean;
  hata: string | null;
  currentLanguage: Dil;
}

export default function MagazaTalepleri({ talepler, yukleniyor, hata, currentLanguage }: Props) {
  const dil = currentLanguage;
  const tr = dil === 'tr';
  const kok = useId();
  const [acikId, setAcikId] = useState<string | null>(null);
  const gorunum = useMemo(() => magazaTalepGorunumu(talepler), [talepler]);

  // «gönderiliyor» → «bildirim gönderilmedi» geçişi SAATLE olur, veriyle değil: bildirim işçisi durmuşsa doküman hiç
  // değişmez ve ekran «gönderiliyor»da takılırdı. En yakın eşikte bir kez yeniden çizilir (tek zamanlayıcı).
  const [, yenidenCiz] = useState(0);
  const simdi = Date.now();
  useEffect(() => {
    const esik = sonrakiBeklemeEsigi(gorunum.gorunen, Date.now());
    if (esik === null) return;
    const zamanlayici = setTimeout(() => yenidenCiz(n => n + 1), Math.max(0, esik - Date.now()) + 1000);
    return () => clearTimeout(zamanlayici);
  });

  return (
    <section className="apple-card overflow-hidden" aria-label={op(dil).magaza_talepleri}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-bold text-sm text-gray-800">
          {op(dil).magaza_talepleri}
          {!yukleniyor && hata === null && <span className="ml-2 text-xs font-semibold text-gray-400 tabular-nums">{talepler.length}</span>}
        </h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {tr
            ? 'Mağaza sitesinden gelen sipariş talepleri — sipariş değildir; ciroya ve sipariş listesine girmez. Tutarlar müşterinin sitede gördüğü rakamlardır, onaylanmış fiyat değildir.'
            : 'Order requests from the store site — not orders; excluded from revenue and the order list. Amounts are what the customer saw on the site, not confirmed prices.'}
        </p>
      </div>

      {hata !== null ? (
        <p role="alert" className="px-4 py-3 text-xs text-red-700 bg-red-50">
          {tr ? `Mağaza talepleri okunamadı: ${hata}` : `Could not read store requests: ${hata}`}
        </p>
      ) : yukleniyor ? (
        <p className="px-4 py-3 text-xs text-gray-400">{oc(dil).yukleniyor}</p>
      ) : talepler.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-400">{tr ? 'Henüz mağaza talebi yok.' : 'No store requests yet.'}</p>
      ) : (
        <>
          <div aria-hidden="true" className={`${BASLIK_IZGARASI} px-4 py-2.5 border-b border-gray-100 bg-gray-50/60 text-xs font-bold text-gray-400 uppercase`}>
            <span>{tr ? 'Talep no' : 'Request no'}</span>
            <span>{oc(dil).tarih}</span>
            <span>{tr ? 'Müşteri / firma' : 'Customer / company'}</span>
            <span>{tr ? 'İl' : 'Province'}</span>
            <span>{oc(dil).kalemler}</span>
            <span>{tr ? 'Talep edilen toplam' : 'Requested total'}</span>
            <span>{tr ? 'Bildirim' : 'Notification'}</span>
          </div>
          <ul className="divide-y divide-gray-50">
            {gorunum.gorunen.map((t, i) => {
              const acik = acikId === t.id;
              const g = bildirimGorunumu(t, simdi);
              const detayId = `${kok}-detay-${i}`;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    aria-expanded={acik}
                    aria-controls={detayId}
                    onClick={() => setAcikId(acik ? null : t.id)}
                    className={`w-full text-left px-4 py-3 ${SATIR_IZGARASI} text-sm hover:bg-gray-50/60 focus-visible:outline-2 focus-visible:outline-brand transition-colors`}
                  >
                    <span className="min-w-0">
                      <span className={HUCRE_ETIKETI}>{tr ? 'Talep no' : 'Request no'}</span>
                      <span className="font-medium text-gray-800 break-words">{yaDaCizgi(t.talepNo)}</span>
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
                  <div id={detayId} role="region" aria-label={tr ? `${yaDaCizgi(t.talepNo)} talep detayı` : `Request ${yaDaCizgi(t.talepNo)} detail`} hidden={!acik}>
                    {acik && <TalepDetayi t={t} g={g} dil={dil} />}
                  </div>
                </li>
              );
            })}
          </ul>
          {gorunum.dahaEski > 0 && (
            <p role="status" className="px-4 py-3 text-xs text-gray-600 bg-gray-50 border-t border-gray-100">
              {tr
                ? `En yeni ${MAGAZA_TALEP_EKRAN_SINIRI} talep gösteriliyor — daha eski ${gorunum.dahaEski} talep bu listede çizilmedi.`
                : `Showing the newest ${MAGAZA_TALEP_EKRAN_SINIRI} requests — ${gorunum.dahaEski} older request${gorunum.dahaEski === 1 ? ' is' : 's are'} not drawn in this list.`}
            </p>
          )}
          {gorunum.gizliTarihsiz > 0 && (
            <p role="status" className="px-4 py-3 text-xs text-yellow-700 bg-yellow-50 border-t border-gray-100">
              {tr
                ? `Tarihi okunamayan ${gorunum.gizliTarihsiz} talep daha var; bu listede çizilmedi.`
                : `${gorunum.gizliTarihsiz} more request${gorunum.gizliTarihsiz === 1 ? '' : 's'} with an unreadable date ${gorunum.gizliTarihsiz === 1 ? 'is' : 'are'} not drawn in this list.`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
