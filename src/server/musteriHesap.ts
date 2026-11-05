/**
 * musteriHesap.ts — müşteri / bayi hesabının CARİ BAĞI (2026-10-21, şartname `.wf/SARTNAME-musteri-siparislerim.md` K2, H5, H8,
 * H9, H15).
 *
 * KAYIT: `musteriHesaplari/{uid}` = `{ companyId, leadId, cariKod, firma, durum: 'acik' | 'kapali', olusturan, olusturma,
 * guncelleme }` (SERVER_ONLY — /api/db, akış ve kiracı yedeği dışında; lib/collections). Bir hesap TEK cari; bir carinin birden
 * çok hesabı olabilir (firmadaki her kişiye ayrı hesap). `users` belgesine cari alanı KONMAZ (kişi kendi `users` belgesini
 * yazabiliyor).
 *
 * CARİ KODU (H5): bağ kurulurken lead'in `mikroCariKod`'undan KIRPILARAK alınır ve SABİTLENİR (canlı lead okunmaz — Satış lead'i
 * değiştirebilir); boşsa `null` (bağ yine kurulur, müşteri yalnız Cetpa siparişlerini görür — kullanıcı sorusu 2'nin varsayılanı);
 * BÜYÜTÜLMEZ (MF siparişindeki `mikroCariKod` de yalnız kırpılmıştır — server/mikro/eslemeFatura). `cariKod: ''` HİÇ yazılmaz.
 * Aynı `leadId` ile yeniden bağlama = Yönetici'nin AÇIK «cari kodunu tazele»si (otomatik / arka planda tazeleme YOK).
 *
 * YAZAN TEK ÇEKİRDEK: `musteriBagiKur` — `POST /api/admin/users` (dış rol hesabı açılırken, routes/epostaRoutes) ve
 * `PUT /api/admin/musteri-hesaplari/:uid` (routes/musteriHesapRoutes) ikisi de bunu çağırır. Lead doğrulaması
 * (`musteriLeadiDogrula`) hesap açılmadan ÖNCE ayrıca çağrılabilir: yabancı lead'le bağsız hesap kalmasın.
 *
 * OKUYUCU (`musteriHesapOkuyucuKur`): mağaza bayi köprüsünün her isteği bağı YENİDEN okur; 60 sn önbellek, `users` ve
 * `musteriHesaplari` değişiklik olayında düşer (server.ts dinleyicisi; SERVER_ONLY yazımı da süreç içi olay üretir — pgShim).
 * Okuma HATASI yutulmaz (fırlatır → kapı 503). Bozuk kayıt «bağ yok» sayılır (kapalı başarısız).
 */
import type { AdminDbLike } from './adminDbTypes.js';
import { magazaMetniKirp, magazaMetniTemizle } from './kanal/magazaTalep.js';
import { surumluOnbellekKur } from './surumluOnbellek.js';

export const MUSTERI_HESAP_KOLEKSIYONU = 'musteriHesaplari';
/** Bağdaki firma adının üst sınırı (birim). */
export const MUSTERI_FIRMA_SINIRI = 120;
export const MUSTERI_HESAP_ONBELLEK_MS = 60_000;

export type MusteriHesapDurumu = 'acik' | 'kapali';

export interface MusteriHesabi {
  companyId: string;
  leadId: string;
  /** Kırpılmış Mikro cari kodu; yoksa `null` (MF siparişleri görünmez). */
  cariKod: string | null;
  firma: string;
  durum: MusteriHesapDurumu;
  olusturan: string;
  olusturma: string;
  guncelleme: string;
}

const nesneMi = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const doluMetin = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Lead'in `mikroCariKod`'undan bağın cari kodu (SAF): metin ya da sonlu sayı → metin + KIRPMA; boş → `null`. Büyük / küçük harf
 * DEĞİŞMEZ. Başka tür (nesne, mantıksal) → `null` (kapalı başarısız: uydurma bir kod yazılmaz).
 */
export function bagCariKodu(ham: unknown): string | null {
  const metin = typeof ham === 'string' ? ham : typeof ham === 'number' && Number.isFinite(ham) ? String(ham) : '';
  const kirpik = metin.trim();
  return kirpik === '' ? null : kirpik;
}

/** Lead'den bağdaki firma adı (SAF): `company` → `name` → ''; tek satır temizliği + `MUSTERI_FIRMA_SINIRI` birime kırpma. */
export function bagFirmasi(lead: Record<string, unknown>): string {
  const ham = doluMetin(lead.company) ? lead.company : doluMetin(lead.name) ? lead.name : '';
  return magazaMetniKirp(magazaMetniTemizle(ham, false), MUSTERI_FIRMA_SINIRI).metin;
}

export type BagKaydiDogrulamasi =
  | { ok: true; leadId: string; cariKod: string | null; firma: string }
  | { ok: false; kod: 400 | 404 };

/**
 * Bağ yazımının girdisi (SAF): `leadId` boş olmayan metin değilse 400; lead yok, `companyId`'siz ya da başka kiracının → 404
 * («yok» ile aynı yanıt — başka kiracıdaki lead'in varlığı sızmaz). Geçerse bağın üç türetilmiş alanı.
 */
export function bagKaydiDogrula(g: { leadId: unknown; lead: Record<string, unknown> | null; kiraci: string }): BagKaydiDogrulamasi {
  if (!doluMetin(g.leadId)) return { ok: false, kod: 400 };
  const lead = g.lead;
  if (lead === null || !doluMetin(lead.companyId) || g.kiraci === '' || lead.companyId !== g.kiraci) return { ok: false, kod: 404 };
  return { ok: true, leadId: g.leadId, cariKod: bagCariKodu(lead.mikroCariKod), firma: bagFirmasi(lead) };
}

/**
 * Saklı kaydın çözümü (SAF): alanlar türüne uymuyorsa `null` («bağ yok» — kapalı başarısız). `cariKod` boş / boşluklu metinse
 * `null`'a iner (eski / elle bozulmuş kayıt; sorgu ayrıca `null` geçer).
 */
export function musteriHesabiCoz(ham: unknown): MusteriHesabi | null {
  if (!nesneMi(ham)) return null;
  const { companyId, leadId, cariKod, firma, durum, olusturan, olusturma, guncelleme } = ham;
  if (!doluMetin(companyId) || !doluMetin(leadId)) return null;
  if (durum !== 'acik' && durum !== 'kapali') return null;
  if (cariKod !== null && typeof cariKod !== 'string') return null;
  return {
    companyId, leadId,
    cariKod: typeof cariKod === 'string' && cariKod.trim() !== '' ? cariKod : null,
    firma: typeof firma === 'string' ? firma : '',
    durum,
    olusturan: typeof olusturan === 'string' ? olusturan : '',
    olusturma: typeof olusturma === 'string' ? olusturma : '',
    guncelleme: typeof guncelleme === 'string' ? guncelleme : '',
  };
}

export interface MusteriHesapDeps {
  adminDb: () => AdminDbLike | null;
  simdi?: () => Date;
}

const veritabani = (D: MusteriHesapDeps): AdminDbLike => {
  const db = D.adminDb();
  if (!db) throw new Error('musteriHesap: adminDb yok');
  return db;
};

/** Lead'i okuyup bağ girdisini doğrular (`bagKaydiDogrula`); okuma hatası FIRLATIR. Hesap açılmadan ÖNCE çağrılabilir. */
export async function musteriLeadiDogrula(D: MusteriHesapDeps, g: { kiraci: string; leadId: unknown }): Promise<BagKaydiDogrulamasi> {
  if (!doluMetin(g.leadId)) return { ok: false, kod: 400 };
  const snap = await veritabani(D).collection('leads').doc(g.leadId).get();
  return bagKaydiDogrula({ leadId: g.leadId, lead: snap.exists ? (snap.data() ?? {}) : null, kiraci: g.kiraci });
}

export type MusteriBagiSonucu =
  | { sonuc: 'gecersiz' }
  | { sonuc: 'lead-yok' }
  | {
    sonuc: 'tamam';
    /** Yazımdan önceki çözülmüş kayıt (yoksa / bozuksa `null`). */
    onceki: MusteriHesabi | null;
    kayit: MusteriHesabi;
    /** Önceki kayıt vardı ve `leadId` ya da `cariKod` değişti → çağıran o kişinin mağaza belirteçlerini öldürür (`iptalEt`). */
    bagDegisti: boolean;
  };

/**
 * TEK bağ yazma çekirdeği. Lead YENİDEN okunur (cari kodu tazeleme bu okumayla olur); var olan kayıtta `olusturan`, `olusturma`,
 * `durum` korunur — saklı `durum` okunamıyorsa `kapali` (kapalı başarısız); yeni kayıtta `durum: 'acik'`. Yazım TAM kayıttır
 * (birleştirme değil): eski kayıttan tanınmayan alan taşınmaz. Okuma / yazma hatası FIRLATIR.
 */
export async function musteriBagiKur(
  D: MusteriHesapDeps, g: { uid: string; kiraci: string; leadId: unknown; olusturan: string },
): Promise<MusteriBagiSonucu> {
  const dogrulama = await musteriLeadiDogrula(D, { kiraci: g.kiraci, leadId: g.leadId });
  if (!dogrulama.ok) return dogrulama.kod === 400 ? { sonuc: 'gecersiz' } : { sonuc: 'lead-yok' };
  const db = veritabani(D);
  const ref = db.collection(MUSTERI_HESAP_KOLEKSIYONU).doc(g.uid);
  const oncekiSnap = await ref.get();
  const ham = oncekiSnap.exists ? (oncekiSnap.data() ?? {}) : null;
  const onceki = musteriHesabiCoz(ham);
  const simdi = (D.simdi?.() ?? new Date()).toISOString();
  const sakliDurum: MusteriHesapDurumu = ham === null ? 'acik' : ham.durum === 'acik' ? 'acik' : 'kapali';
  const kayit: MusteriHesabi = {
    companyId: g.kiraci,
    leadId: dogrulama.leadId,
    cariKod: dogrulama.cariKod,
    firma: dogrulama.firma,
    durum: sakliDurum,
    olusturan: ham !== null && doluMetin(ham.olusturan) ? ham.olusturan : g.olusturan,
    olusturma: ham !== null && doluMetin(ham.olusturma) ? ham.olusturma : simdi,
    guncelleme: simdi,
  };
  await ref.set({ ...kayit });
  const bagDegisti = onceki !== null && (onceki.leadId !== kayit.leadId || onceki.cariKod !== kayit.cariKod);
  return { sonuc: 'tamam', onceki, kayit, bagDegisti };
}

/**
 * Erişim durumunu yazar (bağın öbür alanlarına dokunmaz). Bağ yoksa `false` (yazım yok). Okuma / yazma hatası FIRLATIR.
 */
export async function musteriHesapDurumuYaz(
  D: MusteriHesapDeps, g: { uid: string; durum: MusteriHesapDurumu },
): Promise<{ onceki: MusteriHesabi; kayit: MusteriHesabi } | null> {
  const ref = veritabani(D).collection(MUSTERI_HESAP_KOLEKSIYONU).doc(g.uid);
  const snap = await ref.get();
  const onceki = snap.exists ? musteriHesabiCoz(snap.data()) : null;
  if (onceki === null) return null;
  const kayit: MusteriHesabi = { ...onceki, durum: g.durum, guncelleme: (D.simdi?.() ?? new Date()).toISOString() };
  await ref.set({ ...kayit });
  return { onceki, kayit };
}

export interface MusteriHesapOkuyucu {
  /** Bağ yoksa / bozuksa `null`; okuma hatası FIRLATIR (kapı 503). */
  musteriHesabi: (uid: string) => Promise<MusteriHesabi | null>;
  dusur: (uid: string) => void;
  temizle: () => void;
}

/**
 * Bağ okuyucu — kendi 60 sn önbelleği (bulunan ve bulunmayan sonuç ikisi de; olayla düşer).
 *
 * OKUMA / DÜŞÜRME YARIŞI (Tur 1 incelemesi, 2026-10-21): okuma `await` içindeyken kayıt değişir ve olay `dusur`'u çağırırsa,
 * bekleyen okuma ESKİ değeri önbelleğe yazıp 60 sn yaşatırdı (kapatılan erişim bir dakika açık kalırdı). Sürüm sayacı ortak
 * yardımcıdadır (`./surumluOnbellek` — panel kullanıcı okuyucusu da aynısını kullanır; kopya yok).
 */
export function musteriHesapOkuyucuKur(D: MusteriHesapDeps): MusteriHesapOkuyucu {
  const onbellek = surumluOnbellekKur<MusteriHesabi | null>({
    omurMs: MUSTERI_HESAP_ONBELLEK_MS,
    simdiMs: () => (D.simdi?.() ?? new Date()).getTime(),
  });
  const oku = async (uid: string): Promise<MusteriHesabi | null> => {
    const snap = await veritabani(D).collection(MUSTERI_HESAP_KOLEKSIYONU).doc(uid).get();
    return snap.exists ? musteriHesabiCoz(snap.data()) : null;
  };
  return {
    musteriHesabi: (uid) => onbellek.get(uid, () => oku(uid)),
    dusur: (uid) => { onbellek.dusur(uid); },
    temizle: () => { onbellek.temizle(); },
  };
}
