/**
 * MagazaTalepDuzenle.tsx — mağaza talebinin İÇERİK formu (dilim 2b, şartname v6 § 10.4; 2026-10-10). İki kip, TEK form:
 *   • `duzenle` — mevcut talep: müşteri bilgileri (yedi alan), not ve TEYİT EDİLEN kalemler;
 *   • `yeni`    — ERP'de elle talep (telefonla gelen iş): müşteri + not + kalemler (bunlar talebin BEYANI olur).
 *
 * FORM İSTEK ATMAZ: gövdeyi `lib/magazaTalepFormu.ts` saf işlevleriyle üretir ve `onKaydet` niteliğine verir; isteği
 * OrdersPage'in verdiği işlev atar (`MagazaTalepleri` araya yalnız sonuç eşlemesi koyar). Kurallar o saf modüldedir — burada
 * yalnız çizim ve durum vardır.
 *
 * MÜŞTERİNİN İLK TALEBİ DEĞİŞMEZ (V16): form beyanı KOPYALAR; `talep` niteliğine yazmaz. Teyit bölümü ilk açılışta
 * `teyit ?? kalemler`'den kopyalanır (§ 10.4; inceleme 2b, bulgu 6): teyit varsa kendi kalemleriyle, yoksa müşteri beyanının
 * KOPYASIYLA açılır. Form tam gövde gönderdiği için teyidi olmayan talepte satırlara dokunmadan kaydetmek de beyandaki adet
 * ve fiyatla TEYİT yazar; bölümün başındaki not bunu kaydetmeden ÖNCE söyler ve çıkış yolunu gösterir (bütün kalemler
 * kaldırılırsa gövdede `teyit` yoktur — yalnız müşteri bilgisini düzelten kişi adet ve fiyatı teyit etmek ZORUNDA değildir).
 *
 * EKRAN SIRASI (V19, kullanıcı sözü «hariç ver sonra KDV'leri seçerek ekle»): (1) kalemler + KDV HARİÇ birim fiyat →
 * «Ara toplam (KDV hariç)»; (2) kalem başına KDV oranı → «KDV» ve «Genel toplam». Toplamlar canlı ÖNİZLEMEDİR
 * (`magazaTaslakOnizlemesi` → `magazaTeyitToplamlari`); gövdeye girmez, kayıtlı tutar sunucunundur ve akıştan gelir.
 * Herhangi bir fiyat boşsa üç toplam da «fiyat sorulacak» (kısmi toplam basılmaz, sıfır değil).
 *
 * KDV SEÇİCİSİ: başlangıç oranı `magazaTaslakKdv` (seçilen → mevcut teyit kaleminin kayıtlı oranı → ürün kaydı; sunucunun
 * yazacağı oranla AYNI kural). Kaynağı `varsayilan` olan satırda «varsayılan» imi GÖRÜNÜR (ürün kaydından okunamadı — %20
 * varsayıldı). Personel başka oran SEÇİNCE ya da görünen oranı «oranı onayla» düğmesiyle ONAYLAYINCA im kalkar ve gövdeye
 * `kdvOrani` girer (sunucu kaynağı `personel` yazar). Onay düğmesi şarttır: zaten seçili seçeneği yeniden seçmek `change`
 * üretmez — %20 DOĞRU oransa personel onu seçiciyle onaylayamazdı, im ve `varsayilan` kaynağı kalırdı (inceleme 2b, bulgu 5).
 * Dokunulmayan satırda gövdede `kdvOrani` YOKTUR: mevcut teyit kaleminde kayıtlı oran korunur (stok kodu değişmedikçe), yeni
 * kalemde sunucu ürün kaydından çözer.
 * KAYITLI «varsayılan» satır (mevcut teyit kalemi; inceleme 2b, ikinci tur): ürün kaydı ÖNİZLEME için sorulmaz — oran ve toplam
 * kayıtlı olandır. Kart teyitten SONRA eşlenmiş olabilir; ürün kaydının BUGÜNKÜ oranı yalnız BİLGİ olarak okunur
 * (`magazaKayitliVarsayilaninKartOrani`) ve satırda «ürün kaydı şimdi %N» diye görünür. Oran kayıtlıdan farklıysa «ürün
 * kaydının oranını seç (%N)» düğmesi çizilir (seçimle AYNI alan) ve onay düğmesi onayladığı oranı adıyla söyler («oranı
 * onayla (%M)»). Dokunulmadıkça önizleme de gövde de DEĞİŞMEZ. İki düğme de tıklanınca DOM'dan kalkar; odak önce aynı
 * satırın oran seçicisine alınır (yoksa `body`'ye düşerdi).
 *
 * SÜRÜM: `icerikSurum` formun AÇILDIĞI anda yakalanır. Kaydetme anındaki güncel sürüm gönderilseydi, form açıkken başkasının
 * yaptığı düzenleme sessizce bu formun bayat içeriğiyle ezilirdi; yakalanan sürümle sunucu 409 `surum-eski` döner.
 *
 * `<form>` öğesi YOKTUR (Enter ile gönderim / sayfa yenilemesi olmasın); sayı alanları METİNDİR (`inputMode`).
 *
 * KURUŞ (kullanıcı kararı 2026-10-17, B2): birim fiyat en çok iki ondalık. Üçüncü ondalık (ör. «83,3333»; beyandan kopyalanan
 * satırda da) kaydetmede ALAN HATASIDIR — metin sunucu şemasınınkiyle AYNI sabit (`MAGAZA_BIRIM_FIYAT_KURUS_HATASI`), gövde
 * üretilmez, kuruşa yuvarlanmaz; önizleme o satırda tutar basmaz. Hüküm saf modülde (`magazaFiyatCoz` → `magazaKurusluMu`).
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { paraYaz } from '../../utils/currency';
import { oc } from '../../i18n/ortak';
import { MAGAZA_BIRIM_FIYAT_KURUS_HATASI, MAGAZA_KDV_ORANLARI, MAGAZA_MUSTERI_ALANLARI, magazaKdvOraniMi, type MagazaTalepMusteri } from '../../lib/magazaTalep';
import {
  MAGAZA_NOT_HAM_SINIRI, bosKalemTaslagi, duzenlemeTaslagi, magazaElleTalepGovdesi, magazaIcerikGovdesi, magazaKayitliVarsayilaninKartOrani, magazaTaslakKdv,
  magazaTaslakOnizlemesi,
  taslakBeyandan, yeniTalepTaslagi,
  type MagazaElleTalepGirdisi, type MagazaFormHatalari, type MagazaFormTaslagi, type MagazaIcerikGirdisi, type MagazaKalemTaslagi, type MagazaTaslakOnizlemesi,
} from '../../lib/magazaTalepFormu';
import type { MagazaTalepSatiri } from '../../hooks/useMagazaTalepleri';

type Dil = 'tr' | 'en';

/** Kaydetmenin forma dönen sonucu. `tamam` = çağıran formu KAPATIR; diğerlerinde form açık kalır ve iletiyi basar. */
export type MagazaFormSonucu =
  | { tamam: true }
  | { tamam: false; kod: 'degisiklik-yok' | 'surum-eski' | 'silindi' | 'gecersiz' | 'yetki' | 'bulunamadi' | 'ag' };
type FormHataKodu = Exclude<MagazaFormSonucu, { tamam: true }>['kod'];

interface OrtakNitelikler {
  dil: Dil;
  onVazgec: () => void;
}
interface DuzenleNitelikleri extends OrtakNitelikler {
  kip: 'duzenle';
  /** Formun açıldığı talep; ilk çizimde KOPYALANIR, sonraki akış güncellemeleri taslağı değiştirmez. */
  talep: MagazaTalepSatiri;
  /** Kalem stok kodunun ERP ürün kaydındaki KDV oranı (OrdersPage verir); bulunamazsa / çelişirse `undefined`. */
  urunKdvOrani: (sku: string) => number | undefined;
  onKaydet: (govde: MagazaIcerikGirdisi) => Promise<MagazaFormSonucu>;
}
interface YeniNitelikleri extends OrtakNitelikler {
  kip: 'yeni';
  onKaydet: (govde: MagazaElleTalepGirdisi) => Promise<MagazaFormSonucu>;
}
export type MagazaTalepDuzenleNitelikleri = DuzenleNitelikleri | YeniNitelikleri;

// ── Metinler ────────────────────────────────────────────────────────────────────────────────────────────────────────

const SONUC_METNI: Record<FormHataKodu, Record<Dil, string>> = {
  'degisiklik-yok': { tr: 'Değişiklik yok — kayıtlı içerikle aynı; hiçbir şey yazılmadı.', en: 'No changes — identical to the saved content; nothing was written.' },
  'surum-eski': {
    tr: 'Başka biri bu talebin içeriğini düzenledi; kaydedilmedi. Formu kapatıp yeniden açın.',
    en: 'Someone else edited this request; nothing was saved. Close the form and open it again.',
  },
  silindi: { tr: 'Talep silinmiş; içerik düzenlenemez.', en: 'The request has been deleted; its content cannot be edited.' },
  gecersiz: {
    tr: 'Sunucu içeriği kabul etmedi — müşteri adını, telefonu, kalem adlarını, adet ve fiyatları kontrol edin.',
    en: 'The server rejected the content — check the customer name, phone, item names, quantities and prices.',
  },
  yetki: { tr: 'Bu işlem için yetkiniz yok.', en: 'You are not authorised for this action.' },
  bulunamadi: { tr: 'Talep bulunamadı.', en: 'Request not found.' },
  ag: { tr: 'Bağlantı hatası, yeniden deneyin.', en: 'Connection error, please try again.' },
};

/** Müşteri alanlarının etiketi ve zorunluluk imi; sıra `MAGAZA_MUSTERI_ALANLARI`. */
function musteriEtiketi(alan: keyof MagazaTalepMusteri, dil: Dil): string {
  const tr = dil === 'tr';
  switch (alan) {
    case 'ad': return tr ? 'Müşteri adı (zorunlu)' : 'Customer name (required)';
    case 'firma': return oc(dil).firma;
    case 'telefon': return tr ? 'Telefon (zorunlu, en az 10 rakam)' : 'Phone (required, at least 10 digits)';
    case 'eposta': return oc(dil).e_posta;
    case 'il': return tr ? 'İl' : 'Province';
    case 'adres': return oc(dil).adres;
    case 'vergi': return oc(dil).vergi_no;
  }
}

const ALAN_HATASI = 'text-[11px] font-semibold text-red-700';
const ETIKET = 'block text-[10px] font-bold text-gray-400 uppercase';
const DUGME = 'inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const DUGME_ANA = `${DUGME} bg-brand hover:bg-brand-hover text-white`;
const DUGME_IKINCIL = `${DUGME} bg-white border border-gray-200 text-gray-700 hover:bg-gray-50`;
const ROZET = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold';

/** Önizleme tutarı: dolu → para; fiyatı boş kalem → «fiyat sorulacak»; okunamayan girdi → '—' (tutar uydurulmaz). */
function onizlemeMetni(o: MagazaTaslakOnizlemesi, deger: number | null, dil: Dil): ReactNode {
  if (o.durum === 'tutar') return <span className="tabular-nums font-semibold">{paraYaz(deger)}</span>;
  if (o.durum === 'fiyat-sorulacak') return <span className="font-semibold text-yellow-700">{dil === 'tr' ? 'fiyat sorulacak' : 'price to be quoted'}</span>;
  return '—';
}

/** Satırın ekranda anılan adı: ürün adı; boşsa sıra numarası. */
const kalemAdi = (k: MagazaKalemTaslagi, sira: number, dil: Dil): string =>
  (k.ad.trim() === '' ? (dil === 'tr' ? `${sira}. kalem` : `item ${sira}`) : k.ad);

export default function MagazaTalepDuzenle(p: MagazaTalepDuzenleNitelikleri) {
  const { dil } = p;
  const tr = dil === 'tr';
  const kok = useId();
  const duzenle = p.kip === 'duzenle';

  // İlk hâl formun AÇILDIĞI anda kurulur (sonraki akış güncellemeleri taslağı ve yakalanan sürümü değiştirmez).
  const [taslak, setTaslak] = useState<MagazaFormTaslagi>(() => (p.kip === 'duzenle' ? duzenlemeTaslagi(p.talep) : yeniTalepTaslagi()));
  const [acilis] = useState(() => (p.kip === 'duzenle' ? { icerikSurum: p.talep.icerikSurum, teyitVardi: p.talep.teyit !== null } : null));
  const [hatalar, setHatalar] = useState<MagazaFormHatalari | null>(null);
  const [sonuc, setSonuc] = useState<FormHataKodu | null>(null);
  const [mesgul, setMesgul] = useState(false);
  // Uçuştaki istek: durum çizime yansımadan gelen ikinci tıklama da istek ÜRETMEZ.
  const ucusta = useRef(false);
  const siradakiYerel = useRef(taslak.kalemler.reduce((enBuyuk, k) => Math.max(enBuyuk, k.yerel), 0) + 1);
  const yerelAl = (adet: number): number => { const ilk = siradakiYerel.current; siradakiYerel.current += adet; return ilk; };

  const urunKdvOrani = p.kip === 'duzenle' ? p.urunKdvOrani : null;

  const musteriYaz = (alan: keyof MagazaTalepMusteri, deger: string): void => setTaslak(o => ({ ...o, musteri: { ...o.musteri, [alan]: deger } }));
  const kalemYaz = (yerel: number, yama: Partial<MagazaKalemTaslagi>): void =>
    setTaslak(o => ({ ...o, kalemler: o.kalemler.map(k => (k.yerel === yerel ? { ...k, ...yama } : k)) }));
  const kalemEkle = (): void => setTaslak(o => ({ ...o, kalemler: [...o.kalemler, bosKalemTaslagi(yerelAl(1))] }));
  const kalemSil = (yerel: number): void => setTaslak(o => ({ ...o, kalemler: o.kalemler.filter(k => k.yerel !== yerel) }));
  const beyandanKopyala = (): void => {
    if (p.kip !== 'duzenle') return;
    const beyan = p.talep.kalemler;
    setTaslak(o => ({ ...o, kalemler: taslakBeyandan(beyan, yerelAl(beyan.length)) }));
  };

  const kaydet = async (): Promise<void> => {
    if (ucusta.current) return;
    setSonuc(null);
    let istek: Promise<MagazaFormSonucu>;
    if (p.kip === 'duzenle') {
      // `acilis` düzenleme kipinde her zaman doludur (ilk çizimde aynı koşulla kuruldu); derleyici için.
      if (acilis === null) return;
      const g = magazaIcerikGovdesi(taslak, acilis.icerikSurum, acilis.teyitVardi);
      if (!g.ok) { setHatalar(g.hatalar); return; }
      istek = p.onKaydet(g.govde);
    } else {
      const g = magazaElleTalepGovdesi(taslak);
      if (!g.ok) { setHatalar(g.hatalar); return; }
      istek = p.onKaydet(g.govde);
    }
    setHatalar(null);
    ucusta.current = true;
    setMesgul(true);
    let s: MagazaFormSonucu;
    try {
      s = await istek;
    } catch {
      s = { tamam: false, kod: 'ag' };
    }
    ucusta.current = false;
    setMesgul(false);
    // `tamam`: formu çağıran kapatır (bu bileşen kaldırılır); burada yazılacak durum yok.
    if (!s.tamam) setSonuc(s.kod);
  };

  const onizleme = urunKdvOrani !== null ? magazaTaslakOnizlemesi(taslak.kalemler, urunKdvOrani) : null;
  const baslik = duzenle
    ? (tr ? `İçeriği düzenle — ${p.talep.talepNo}` : `Edit content — ${p.talep.talepNo}`)
    : (tr ? 'Yeni talep (elle)' : 'New request (manual)');
  const kalemBasligi = duzenle
    ? (tr ? '1. Teyit edilen kalemler — KDV hariç birim fiyat' : '1. Confirmed items — unit price excluding VAT')
    : (tr ? 'Kalemler (müşterinin telefonda istediği)' : 'Items (as requested by the customer on the phone)');

  return (
    <div role="group" aria-label={baslik} className="border border-gray-200 rounded-xl bg-white px-4 py-3 space-y-4">
      <div>
        <p className="font-bold text-sm text-gray-800">{baslik}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {duzenle
            ? (tr
              ? 'Müşterinin ilk talebi (sitede görülen kalemler ve tutarlar) DEĞİŞMEZ; burada yazılan adet ve fiyat «Teyit edilen» olarak ayrı saklanır. Kaydedince değişen alanlar için personele revize bildirimi e-postası gider.'
              : 'The customer’s original request (items and amounts as shown on the site) is NOT changed; quantities and prices entered here are stored separately as “Confirmed”. On save, a revision notice e-mail is sent to staff for the fields that changed.')
            : (tr
              ? 'Talep «Yeni» aşamasında açılır ve mağazadan gelen talep gibi bildirim e-postası gönderilir (mağaza bildirim adresine — müşteriye e-posta gitmez). İçerik sonradan düzenlenirse ayrıca revize bildirimi gider. Müşteri talebi takip sayfasında talep numarası ve bu telefonla sorgular.'
              : 'The request opens at the “New” stage and a notification e-mail is sent as for a store request (to the store notification address — no e-mail goes to the customer). A later content edit sends a separate revision notice. The customer can track it with the request number and this phone.')}
        </p>
      </div>

      {/* ── Müşteri bilgileri + not ── */}
      <div role="group" aria-label={tr ? 'Müşteri bilgileri' : 'Customer details'} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
        {MAGAZA_MUSTERI_ALANLARI.map(alan => {
          const id = `${kok}-m-${alan}`;
          const hata = alan === 'ad' ? hatalar?.ad === true : alan === 'telefon' ? hatalar?.telefon === true : false;
          return (
            <div key={alan} className={alan === 'adres' ? 'sm:col-span-2 min-w-0' : 'min-w-0'}>
              <label htmlFor={id} className={ETIKET}>{musteriEtiketi(alan, dil)}</label>
              {alan === 'adres'
                ? <textarea id={id} rows={2} className="apple-input w-full" value={taslak.musteri.adres} disabled={mesgul} onChange={e => musteriYaz('adres', e.target.value)} />
                : (
                  <input
                    id={id}
                    type="text"
                    inputMode={alan === 'telefon' ? 'tel' : undefined}
                    className="apple-input w-full"
                    value={taslak.musteri[alan]}
                    disabled={mesgul}
                    aria-invalid={hata}
                    onChange={e => musteriYaz(alan, e.target.value)}
                  />
                )}
              {alan === 'ad' && hata && <p role="alert" className={ALAN_HATASI}>{tr ? 'Müşteri adı boş olamaz.' : 'Customer name cannot be empty.'}</p>}
              {alan === 'telefon' && hata && (
                <p role="alert" className={ALAN_HATASI}>
                  {tr ? 'Telefonda en az 10 rakam olmalı (takip sayfası talebi bu numarayla bulur).' : 'The phone must contain at least 10 digits (the tracking page finds the request by this number).'}
                </p>
              )}
              {alan === 'telefon' && duzenle && (
                <p className="text-[11px] text-gray-500">
                  {tr ? `Takip telefonu değişmez: müşteri ilk numarayla sorgular (son 10 hane ${p.talep.telefonSon10}).` : `The tracking phone does not change: the customer still uses the first number (last 10 digits ${p.talep.telefonSon10}).`}
                </p>
              )}
            </div>
          );
        })}
        <div className="sm:col-span-2 lg:col-span-4 min-w-0">
          <label htmlFor={`${kok}-not`} className={ETIKET}>{tr ? 'Müşteri notu' : 'Customer note'}</label>
          <textarea
            id={`${kok}-not`}
            rows={2}
            className="apple-input w-full"
            maxLength={MAGAZA_NOT_HAM_SINIRI}
            value={taslak.not}
            disabled={mesgul}
            aria-invalid={hatalar?.not === true}
            onChange={e => setTaslak(o => ({ ...o, not: e.target.value }))}
          />
          {hatalar?.not === true && <p role="alert" className={ALAN_HATASI}>{tr ? 'Not çok uzun.' : 'The note is too long.'}</p>}
        </div>
      </div>

      {/* ── (1) Kalemler + KDV HARİÇ birim fiyat → ara toplam ── */}
      <div role="group" aria-label={kalemBasligi} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase">{kalemBasligi}</p>
          <button type="button" className={DUGME_IKINCIL} disabled={mesgul} onClick={kalemEkle}>{tr ? 'Kalem ekle' : 'Add item'}</button>
          {/* Yalnız bölüm BOŞKEN: dolu taslağın üstüne beyanı yeniden yazmak personelin girdiğini silerdi. */}
          {duzenle && taslak.kalemler.length === 0 && p.talep.kalemler.length > 0 && (
            <button type="button" className={DUGME_IKINCIL} disabled={mesgul} onClick={beyandanKopyala}>{tr ? 'Müşteri beyanından kopyala' : 'Copy from the customer’s request'}</button>
          )}
        </div>
        {/* Teyidi OLMAYAN talep beyan kopyasıyla açılır ve form tam gövde gönderir: «Kaydet» bu satırları TEYİT olarak yazar.
            Yalnız müşteri bilgisini düzeltecek kişi bunu kaydetmeden ÖNCE görsün (çıkış yolu: bütün kalemleri kaldırmak). */}
        {acilis?.teyitVardi === false && taslak.kalemler.length > 0 && (
          <p role="note" className="text-[11px] text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
            {tr
              ? 'Bu talep henüz teyit edilmedi — form müşteri beyanının kopyasıyla açılır. Kaydedince aşağıdaki adet ve fiyatlar «Teyit edilen» olarak yazılır. Yalnız müşteri bilgisini ya da notu düzeltecekseniz önce bütün kalemleri kaldırın: bu bölüm boş kaydedilirse teyit yazılmaz.'
              : 'This request has not been confirmed yet — the form opens with a copy of the customer’s request. On save, the quantities and prices below are stored as “Confirmed”. If you are only correcting customer details or the note, remove all items first: saving with this section empty writes no confirmation.'}
          </p>
        )}
        {taslak.kalemler.length === 0 ? (
          <p className="text-xs text-gray-500">
            {duzenle
              ? (acilis?.teyitVardi === true
                ? (tr ? 'Kalem kalmadı.' : 'No items left.')
                : (tr ? 'Henüz teyit edilmedi — kalemleri müşteri beyanından kopyalayın ya da kalem ekleyin. Bu bölüm boş kaydedilirse teyit yazılmaz.' : 'Not confirmed yet — copy the items from the customer’s request or add an item. Saving with this section empty writes no confirmation.'))
              : (tr ? 'Kalem yok.' : 'No items.')}
          </p>
        ) : (
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <caption className="sr-only">{kalemBasligi}</caption>
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-[10px] font-bold text-gray-500 uppercase">
                  <th scope="col" className="px-3 py-2 text-left">{tr ? 'Stok kodu' : 'SKU'}</th>
                  <th scope="col" className="px-3 py-2 text-left">{oc(dil).urun}</th>
                  <th scope="col" className="px-3 py-2 text-left">{tr ? 'Marka' : 'Brand'}</th>
                  <th scope="col" className="px-3 py-2 text-right">{oc(dil).adet_2}</th>
                  <th scope="col" className="px-3 py-2 text-right">{tr ? 'Birim fiyat (KDV hariç; boş = fiyat sorulacak)' : 'Unit price (excl. VAT; empty = to be quoted)'}</th>
                  <th scope="col" className="px-3 py-2 text-left">{oc(dil).islem}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {taslak.kalemler.map((k, i) => {
                  const ad = kalemAdi(k, i + 1, dil);
                  const h = hatalar?.kalemler[k.yerel];
                  return (
                    <tr key={k.yerel}>
                      <td className="px-3 py-2">
                        <input type="text" className="apple-input w-full" aria-label={tr ? `Stok kodu: ${i + 1}. kalem` : `SKU: item ${i + 1}`} value={k.sku} disabled={mesgul} onChange={e => kalemYaz(k.yerel, { sku: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" className="apple-input w-full" aria-label={tr ? `Ürün adı: ${i + 1}. kalem` : `Item name: item ${i + 1}`} aria-invalid={h?.ad === true} value={k.ad} disabled={mesgul} onChange={e => kalemYaz(k.yerel, { ad: e.target.value })} />
                        {h?.ad === true && <p role="alert" className={ALAN_HATASI}>{tr ? 'Ürün adı boş olamaz.' : 'Item name cannot be empty.'}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" className="apple-input w-full" aria-label={tr ? `Marka: ${i + 1}. kalem` : `Brand: item ${i + 1}`} value={k.marka} disabled={mesgul} onChange={e => kalemYaz(k.yerel, { marka: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" inputMode="numeric" className="apple-input w-20 text-right" aria-label={tr ? `Adet: ${ad}` : `Quantity: ${ad}`} aria-invalid={h?.adet !== undefined} value={k.adet} disabled={mesgul} onChange={e => kalemYaz(k.yerel, { adet: e.target.value })} />
                        {h?.adet !== undefined && (
                          <p role="alert" className={ALAN_HATASI}>
                            {h.adet === 'bos' ? (tr ? 'Adet boş olamaz.' : 'Quantity cannot be empty.') : (tr ? 'Adet sıfırdan büyük tam sayı olmalı (yalnız rakam).' : 'Quantity must be a whole number above zero (digits only).')}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" inputMode="decimal" className="apple-input w-28 text-right" aria-label={tr ? `Birim fiyat (KDV hariç): ${ad}` : `Unit price (excl. VAT): ${ad}`} aria-invalid={h?.fiyat !== undefined} value={k.fiyat} disabled={mesgul} onChange={e => kalemYaz(k.yerel, { fiyat: e.target.value })} />
                        {h?.fiyat === 'gecersiz' && (
                          <p role="alert" className={ALAN_HATASI}>
                            {tr ? 'Fiyat okunamadı. Binlik ayraç yazmayın; kuruş için virgül kullanın (ör. 1250,50).' : 'The price could not be read. Do not use thousands separators; use a comma for decimals (e.g. 1250,50).'}
                          </p>
                        )}
                        {h?.fiyat === 'kurustan-ince' && (
                          <p role="alert" className={ALAN_HATASI}>
                            {tr ? MAGAZA_BIRIM_FIYAT_KURUS_HATASI : 'The unit price may have at most two decimal places.'}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" className={DUGME_IKINCIL} disabled={mesgul} aria-label={tr ? `Kalemi kaldır: ${ad}` : `Remove item: ${ad}`} onClick={() => kalemSil(k.yerel)}>{oc(dil).kaldir}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hatalar?.kalemYok === true && (
          <p role="alert" className={ALAN_HATASI}>
            {duzenle
              ? (tr ? 'Teyit edilmiş talepte en az bir kalem kalmalı; bütün kalemler kalkacaksa talebi iptal edin.' : 'A confirmed request must keep at least one item; to drop all items, cancel the request.')
              : (tr ? 'En az bir kalem gerekli.' : 'At least one item is required.')}
          </p>
        )}
        {onizleme !== null && onizleme.durum !== 'kalem-yok' && (
          <p className="text-sm text-gray-800">
            <span className="text-[10px] font-bold text-gray-400 uppercase mr-2">{tr ? 'Ara toplam (KDV hariç)' : 'Subtotal (excl. VAT)'}</span>
            <output aria-label={tr ? 'Ara toplam (KDV hariç)' : 'Subtotal (excl. VAT)'}>{onizlemeMetni(onizleme, onizleme.araToplam, dil)}</output>
          </p>
        )}
      </div>

      {/* ── (2) Kalem başına KDV oranı → KDV ve genel toplam (yalnız düzenleme: elle talebin kalemleri beyandır, oran taşımaz) ── */}
      {urunKdvOrani !== null && onizleme !== null && taslak.kalemler.length > 0 && (
        <div role="group" aria-label={tr ? '2. Kalem başına KDV oranı' : '2. VAT rate per item'} className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase">{tr ? '2. Kalem başına KDV oranı' : '2. VAT rate per item'}</p>
          <ul className="space-y-1">
            {taslak.kalemler.map((k, i) => {
              const ad = kalemAdi(k, i + 1, dil);
              const kdv = magazaTaslakKdv(k, urunKdvOrani);
              // KAYITLI «varsayılan» (mevcut teyit kalemi): kural 2 ürün kaydını OKUMAZ — oran teyit yazılırken okunamamıştı. Kart o
              // günden sonra eşlenmiş olabilir. Önizleme ve gövde DEĞİŞMEZ (teyit edilen rakam sabit); yalnız kartın BUGÜNKÜ oranı
              // personele gösterilir — yoksa «okunamadı» denip %20 onaylatılır ve `personel` kaynağıyla kalıcılaşırdı.
              const kartOrani = magazaKayitliVarsayilaninKartOrani(k, urunKdvOrani);
              return (
                <li key={k.yerel} className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
                  <span className="min-w-0 basis-64 break-words">{ad}</span>
                  <select
                    className="apple-input w-24"
                    aria-label={tr ? `KDV oranı: ${ad}` : `VAT rate: ${ad}`}
                    value={String(kdv.kdvOrani)}
                    disabled={mesgul}
                    onChange={e => { const oran = Number(e.target.value); if (magazaKdvOraniMi(oran)) kalemYaz(k.yerel, { secilenKdv: oran }); }}
                  >
                    {MAGAZA_KDV_ORANLARI.map(oran => <option key={oran} value={String(oran)}>%{oran}</option>)}
                  </select>
                  {kdv.kdvKaynagi === 'varsayilan' && (
                    <span
                      className={`${ROZET} bg-yellow-50 text-yellow-700`}
                      title={kartOrani !== null
                        ? (tr
                          ? `Teyit yazılırken ürün kaydından oran okunamamış, %${kdv.kdvOrani} varsayılmıştı. Ürün kaydı şimdi %${kartOrani} diyor — doğru oranı seçin ya da onaylayın.`
                          : `When this was confirmed no rate could be read from the product record, so ${kdv.kdvOrani}% was assumed. The product record now says ${kartOrani}% — select the correct rate or confirm it.`)
                        : (tr
                          ? 'Ürün kaydından oran okunamadı (eşleşen stok kodu yok, oran yok ya da tanımsız, ya da çelişen kayıt); %20 varsayıldı — doğru oranı seçin ya da onaylayın.'
                          : 'No rate could be read from the product record (no matching SKU, no or unknown rate, or conflicting records); 20% was assumed — select the correct rate or confirm it.')}
                    >
                      {tr ? 'varsayılan' : 'default'}
                    </span>
                  )}
                  {kartOrani !== null && (
                    <span className="text-[11px] text-gray-600">{tr ? `ürün kaydı şimdi %${kartOrani}` : `product record now ${kartOrani}%`}</span>
                  )}
                  {kartOrani !== null && kartOrani !== kdv.kdvOrani && (
                    <button
                      type="button"
                      className={DUGME_IKINCIL}
                      disabled={mesgul}
                      aria-label={tr ? `Ürün kaydının oranını seç (%${kartOrani}): ${ad}` : `Use product record rate (${kartOrani}%): ${ad}`}
                      onClick={e => {
                        // Düğme bu tıklamayla DOM'dan kalkar: odak önce aynı satırın oran seçicisine alınır (yoksa `body`'ye düşer).
                        e.currentTarget.closest('li')?.querySelector('select')?.focus();
                        kalemYaz(k.yerel, { secilenKdv: kartOrani });
                      }}
                    >
                      {tr ? `ürün kaydının oranını seç (%${kartOrani})` : `use product record rate (${kartOrani}%)`}
                    </button>
                  )}
                  {/* Varsayılan oran DOĞRUYSA onay yolu: seçili seçeneği yeniden seçmek `change` üretmez. Onay = seçim (aynı alan):
                      kaynak `personel` olur, im ve bu düğme kalkar, gövdeye `kdvOrani` girer. «ürün kaydı şimdi %N» yazısının
                      yanında çıplak «oranı onayla» o oranı onaylıyor sanılır: bilgi basılan satırda onaylanan oran adıyla yazılır. */}
                  {kdv.kdvKaynagi === 'varsayilan' && (
                    <button
                      type="button"
                      className={DUGME_IKINCIL}
                      disabled={mesgul}
                      aria-label={tr ? `Oranı onayla (%${kdv.kdvOrani}): ${ad}` : `Confirm rate (${kdv.kdvOrani}%): ${ad}`}
                      onClick={e => {
                        // Düğme bu tıklamayla DOM'dan kalkar: odak önce aynı satırın oran seçicisine alınır (yoksa `body`'ye düşer).
                        e.currentTarget.closest('li')?.querySelector('select')?.focus();
                        kalemYaz(k.yerel, { secilenKdv: kdv.kdvOrani });
                      }}
                    >
                      {kartOrani !== null
                        ? (tr ? `oranı onayla (%${kdv.kdvOrani})` : `confirm rate (${kdv.kdvOrani}%)`)
                        : (tr ? 'oranı onayla' : 'confirm rate')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-gray-500">
            {tr
              ? 'Dokunmadığınız satırda: teyit edilmiş kalemin kayıtlı oranı korunur (stok kodu değişmedikçe); yeni kalemin oranını sunucu ürün kaydından belirler. Aşağıdaki tutarlar önizlemedir; kayıtlı tutarı sunucu hesaplar.'
              : 'For rows you do not touch: a confirmed item keeps its saved rate (unless its SKU changes); for a new item the server determines the rate from the product record. The amounts below are a preview; the saved amounts are calculated by the server.'}
          </p>
          <p className="text-sm text-gray-800">
            <span className="text-[10px] font-bold text-gray-400 uppercase mr-2">{oc(dil).kdv}</span>
            <output aria-label={oc(dil).kdv}>{onizlemeMetni(onizleme, onizleme.kdv, dil)}</output>
          </p>
          <p className="text-sm text-gray-800">
            <span className="text-[10px] font-bold text-gray-400 uppercase mr-2">{tr ? 'Genel toplam' : 'Grand total'}</span>
            <output aria-label={tr ? 'Genel toplam' : 'Grand total'}>{onizlemeMetni(onizleme, onizleme.toplam, dil)}</output>
          </p>
        </div>
      )}

      {sonuc !== null && <p role="alert" className="px-3 py-2 rounded-lg text-xs text-red-700 bg-red-50">{SONUC_METNI[sonuc][dil]}</p>}
      {hatalar !== null && <p role="alert" className="text-xs font-semibold text-red-700">{tr ? 'Kaydedilmedi — işaretli alanları düzeltin.' : 'Not saved — fix the marked fields.'}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={DUGME_ANA} disabled={mesgul} onClick={() => { void kaydet(); }}>
          {duzenle ? (tr ? 'İçeriği kaydet' : 'Save content') : (tr ? 'Talebi aç' : 'Open request')}
        </button>
        <button type="button" className={DUGME_IKINCIL} disabled={mesgul} onClick={p.onVazgec}>{oc(dil).vazgec}</button>
      </div>
    </div>
  );
}
