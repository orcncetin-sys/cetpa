/**
 * useMagazaTalepleri.ts — mağaza sipariş taleplerinin TEK istemci aboneliği + «yeni» sayacı (dilim 1, 2026-10-08).
 *
 * Kalıp `useMikroSiparisler`: `enabled` yanlışken `onSnapshot` HİÇ çağrılmaz. Burada `enabled` = YETKİ
 * (`isAllowed(rol, 'magazaTalepleri', 'read')` — çağıran `pages/OrdersPage.tsx`; kullanıcı kararı K3). Neden şart
 * (ölçüldü): sunucu yetkisiz rolün istediği koleksiyonu akıştan SESSİZCE düşürür — ne hata ne boş init gönderir;
 * geri çağrı hiç tetiklenmez ve akış yöneticisi o init'i beklerken yeni abonelik eklemeyi 60 sn erteler
 * (`lib/dbClient.ts` INIT_GUARD_MS).
 *
 * İLK GÖRÜNTÜ SÜRE SINIRI: `enabled` doğruyken de geri çağrı hiç gelmeyebilir — istemcinin bildiği rol sunucudakiyle
 * uyuşmuyorsa (açılışta profil okunamadı, rol varsayılanda kaldı) sunucu koleksiyonu yine sessizce düşürür. İlk
 * görüntü `MAGAZA_ILK_GORUNTU_SURESI_MS` içinde gelmezse durum «yükleniyor»dan HATAYA geçer (ekran sonsuza dek
 * «Yükleniyor…» demez, «okunamadı» der). Geç gelen görüntü hatayı siler: yavaş ama meşru abonelik kilitli kalmaz.
 *
 * Abonelik YALNIZ buradadır: `components/siparis/MagazaTalepleri.tsx` kendi aboneliğini AÇMAZ, App.tsx'e dinleyici
 * eklenmez. Sayaç bu yüzden Siparişler ekranı açıkken çalışır (kenar çubuğunda rozet YOK — ayrı iş, bu dilimde değil).
 *
 * AKIŞTAN GELEN DOKÜMAN GÜVENİLMEZ BİÇİMDEDİR (eski sürümün yazdığı satır, elle düzeltilmiş kayıt, yarım göç):
 * `magazaTalebiDaralt` her alanı tek tek daraltır. Bilinmeyen sayı 0'a ÇEVRİLMEZ (`null`; adet için NaN) — ekran '—'
 * ya da «fiyat sorulacak» basar. `olusturma`'sı çözülemeyen kayıt ATILMAZ: listede kalır, yalnız «yeni» sayılmaz.
 *
 * DİLİM 2a (şartname v6 § 5.1, 2026-10-09): `durum` dokümandan okunur ve KAPALI kümeden geçer — bilinmeyen / eksik değer
 * `'yeni'`ye ÇEVRİLMEZ, `null` olur (ekran «durum okunamadı» basar, işlem düğmesi çizmez). `durumSurum` sayı değilse 0 (CAS
 * için istemci gördüğü sürümü geri gönderir). `kalemTeslim` giriş giriş daraltılır (uymayan GİRİŞ düşer, nesnenin tamamı
 * değil); beyan kalemine `teslim` / `anahtar` YAZILMAZ (V16) — ekran anahtarı `magazaKalemAnahtarlari` ile türetir.
 * YAZMA bu dosyada DEĞİL: `services/magazaTalepIstemcisi.ts` (`authFetch`); bu kanca ağ isteği atmaz.
 *
 * DİLİM 2b (şartname v6 § 10.4, 2026-10-10): `teyit` (kalemler tek tek — anahtarı desene uymayan, KDV oranı küme dışı ya da
 * oran kaynağı tanınmayan TEK kalem `teyit`'i bütünüyle `null` yapar: yarım okunmuş teyit yanlış tutar basardı), `icerikSurum`
 * (sayı değilse 0), `icerikZamani`, `silindi`, `elle`, `bildirimRevize` (ilk bildirimle AYNI daraltıcı ve AYNI sözlük; `alanlar`
 * `alanlariBirlestir` ile tekilleşir). `silindi` NESNE ise satır SİLİNMİŞTİR — ölçüt `magazaSilinmisMi` (SQL eşi
 * `jsonb_typeof(…) = 'object'`): alanları bozuk bir silme nesnesi `null`'a DÜŞMEZ, yoksa sunucunun 409 `silindi` verdiği
 * talep ekranda canlı görünürdü. Sayaçlar (sekme rozetinin iki sayısı) YALNIZ canlı talepleri sayar.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from '../lib/dbClient';
import { db } from '../firebase';
import { zamanMs } from '../utils/zaman';
import {
  MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_KALEM_ANAHTARI_DESENI, magazaAsamasiMi, magazaAcikAsamaMi,
  alanlariBirlestir, magazaKdvKaynagiMi, magazaKdvOraniMi, magazaSilinmisMi,
  type MagazaTalebi, type MagazaTalepKalemi, type MagazaTalepMusteri, type MagazaBildirim, type MagazaBildirimDurumu,
  type MagazaTalepAsamasi, type MagazaAcikAsama, type MagazaDurumGecisi, type MagazaKalemTeslimGirisi, type MagazaEtiketBasildi,
  type MagazaKanal, type MagazaTeyit, type MagazaTeyitKalemi, type MagazaElle, type MagazaRevizeAlani,
} from '../lib/magazaTalep';

/**
 * Ekrandaki talep satırı: sözleşme tipi (`lib/magazaTalep.ts` `MagazaTalebi`) + doküman kimliği.
 *
 * Sözleşmeden FARKLARI (hepsi «okunamayan değer uydurulmaz» kuralından):
 *   - `bildirim`: dokümanda okunamıyorsa (alan yok / bilinmeyen durum) `null`. Sözleşme tipi orada bir durum ZORUNLU kılar;
 *     uydurulacak her değer yanlış bir şey söylerdi («gitti» = sahte güvence, «bekliyor» = sahte bekleme).
 *   - `durum`: kapalı küme dışı / eksik → `null` (`'yeni'` DEĞİL — § 5.1).
 *   - `durumSurum` hep sayı (yoksa 0), `durumAciklama` hep metin (yoksa `''`), `iptalOncesi` dört açık aşamadan biri ya da
 *     `null`, `durumGecmisi` daraltılmış girişler (yoksa `[]`), `kalemTeslim` hep nesne (yoksa `{}`), `etiketBasildi`
 *     nesne ya da `null` (= basılmadı).
 *   - (2b) `teyit` okunabilen TAM teyit ya da `null` (= teyit yok / okunamadı; ekran «henüz teyit edilmedi» basar),
 *     `icerikSurum` hep sayı (yoksa 0), `silindi` nesne ya da `null` (= silinmemiş), `elle` nesne ya da `null` (= mağazadan
 *     geldi), `bildirimRevize` nesne ya da `null` (= revizyon yok / okunamadı — ikinci rozet çizilmez).
 */
export interface MagazaTalepSatiri extends Omit<MagazaTalebi,
  'bildirim' | 'durum' | 'durumAciklama' | 'durumZamani' | 'durumSurum' | 'iptalOncesi' | 'durumGecmisi' | 'durumGecmisiDusen' | 'kalemTeslim' | 'etiketBasildi'
  | 'teyit' | 'icerikSurum' | 'icerikZamani' | 'silindi' | 'elle' | 'bildirimRevize'> {
  id: string;
  bildirim: MagazaBildirim | null;
  durum: MagazaTalepAsamasi | null;
  durumAciklama: string;
  /** Yalnız dokümanda metin olarak varsa; `magazaGuncellemeZamani` biçimi ayrıca denetler. */
  durumZamani?: string;
  durumSurum: number;
  iptalOncesi: MagazaAcikAsama | null;
  durumGecmisi: MagazaDurumGecisi[];
  /** Yalnız dokümanda negatif olmayan tam sayı olarak varsa. */
  durumGecmisiDusen?: number;
  kalemTeslim: Record<string, MagazaKalemTeslimGirisi>;
  etiketBasildi: MagazaEtiketBasildi | null;
  // ── dilim 2b ──
  teyit: MagazaTeyit | null;
  /** İçerik yazımının CAS'ı için: form AÇILDIĞI andaki sürümü geri gönderir. */
  icerikSurum: number;
  /** Yalnız dokümanda metin olarak varsa (revize bildirimi rozetinin bekleme tabanı). */
  icerikZamani?: string;
  silindi: MagazaSatirSilindi | null;
  elle: MagazaElle | null;
  bildirimRevize: MagazaSatirBildirimRevize | null;
}

/**
 * Satırdaki silme işareti. Nesnenin VARLIĞI «silinmiş» demektir; alanları okunamıyorsa boş / `null` kalır (kim sildiği
 * bilinmiyor diye talep canlı sayılmaz).
 */
export interface MagazaSatirSilindi {
  zaman: string;
  kim: { uid: string; ad: string };
  kanal: MagazaKanal | null;
}

/** Satırdaki revize bildirimi: ilk bildirimin alanları + tekilleştirilmiş `alanlar`; `icerikSurum` okunamıyorsa `null`. */
export interface MagazaSatirBildirimRevize extends MagazaBildirim {
  alanlar: MagazaRevizeAlani[];
  kim: { uid: string; ad: string };
  icerikSurum: number | null;
}

export interface MagazaTalepleriDurumu {
  /** Daraltılmış talepler — SIRASIZ (akış önbelleğinin sırası); sıralama ve 200 sınırı ekranın işidir. */
  talepler: MagazaTalepSatiri[];
  /**
   * İlk anlık görüntü henüz gelmedi VE süre sınırı dolmadı. `enabled` yanlışken HER ZAMAN `false` (abonelik yok —
   * beklenen bir şey yok); süre sınırı dolunca da `false` olur (`hata` dolar).
   */
  yukleniyor: boolean;
  /**
   * Abonelik kurulamadıysa ya da ilk görüntü süre sınırı içinde gelmediyse hata metni; bu durumda boş liste
   * «talep yok» demek DEĞİLDİR.
   */
  hata: string | null;
}

// ── Savunmacı daraltma ──────────────────────────────────────────────────────────────────────────────────────────────

const nesne = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const metin = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Sonlu SAYI ise kendisi; değilse `null` (BİLİNMİYOR). Sayısal metin KABUL EDİLMEZ: sunucu sayı yazar, metin bozuk kayıttır. */
const sayiYaDaNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// `Record<…, true>`: sözleşmeye yeni bir bildirim durumu eklenirse burası DERLENMEZ (dizi olsaydı sessizce eksik kalırdı).
const BILINEN_BILDIRIM_DURUMU: Record<MagazaBildirimDurumu, true> = { bekliyor: true, gitti: true, gonderilemedi: true, yapilandirilmamis: true };
const bildirimDurumuMu = (v: unknown): v is MagazaBildirimDurumu =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(BILINEN_BILDIRIM_DURUMU, v);

function bildirimDaralt(v: unknown): MagazaBildirim | null {
  const b = nesne(v);
  if (!bildirimDurumuMu(b.durum)) return null;
  const deneme = sayiYaDaNull(b.deneme);
  // Kapalı küme dışındaki sınıf (ya da sunucudan sızmış hata METNİ) ekrana taşınmaz.
  const hataSinifi = MAGAZA_BILDIRIM_HATA_SINIFLARI.find(s => s === b.hataSinifi);
  return {
    durum: b.durum,
    zaman: metin(b.zaman),
    ...(deneme !== null ? { deneme } : {}),
    ...(hataSinifi !== undefined ? { hataSinifi } : {}),
  };
}

function kalemDaralt(v: unknown): MagazaTalepKalemi {
  const k = nesne(v);
  return {
    id: metin(k.id),
    sku: metin(k.sku),
    ad: metin(k.ad),
    marka: metin(k.marka),
    // NaN = BİLİNMİYOR (`useMikroSiparisler.tutar` ile aynı karar): 0 «sıfır adet», 1 «bir adet» demek olurdu — ikisi de uydurma.
    adet: typeof k.adet === 'number' && Number.isFinite(k.adet) ? k.adet : NaN,
    talepFiyat: sayiYaDaNull(k.talepFiyat),   // null = fiyat sorulacak (0 DEĞİL)
    tedarik: k.tedarik === true,
  };
}

function musteriDaralt(v: unknown): MagazaTalepMusteri {
  const m = nesne(v);
  return {
    ad: metin(m.ad), firma: metin(m.firma), telefon: metin(m.telefon), eposta: metin(m.eposta),
    il: metin(m.il), adres: metin(m.adres), vergi: metin(m.vergi),
  };
}

// ── Dilim 2a alanları ──
// `Record<…, true>`: aşama kümesine değer eklenirse burası DERLENMEZ (dizi `includes` sessizce eksik kalırdı). Bilinmeyen /
// eksik değer `'yeni'`ye ÇEVRİLMEZ: `null` (§ 5.1).
const BILINEN_ASAMA: Record<MagazaTalepAsamasi, true> = { yeni: true, teyit: true, hazirlaniyor: true, sevk: true, teslim: true, iptal: true };
const asamaYaDaNull = (v: unknown): MagazaTalepAsamasi | null =>
  (typeof v === 'string' && Object.prototype.hasOwnProperty.call(BILINEN_ASAMA, v) && magazaAsamasiMi(v) ? v : null);
const kanalMi = (v: unknown): v is MagazaKanal => v === 'panel' || v === 'erp';
/** `{ uid, ad }` — ikisi de metin değilse giriş düşer (`null`). */
const kimDaralt = (v: unknown): { uid: string; ad: string } | null => {
  const k = nesne(v);
  return typeof k.uid === 'string' && typeof k.ad === 'string' ? { uid: k.uid, ad: k.ad } : null;
};

/** Geçmiş girişi: aşama çifti kapalı kümeden, `zaman` metin, `kim` tam, `kanal` iki değerden biri; biri bozuksa giriş düşer. */
function gecisDaralt(v: unknown): MagazaDurumGecisi | null {
  const g = nesne(v);
  const onceki = asamaYaDaNull(g.onceki), yeni = asamaYaDaNull(g.yeni), kim = kimDaralt(g.kim);
  if (onceki === null || yeni === null || kim === null || typeof g.zaman !== 'string' || !kanalMi(g.kanal)) return null;
  return { onceki, yeni, zaman: g.zaman, kim, kanal: g.kanal };
}

/**
 * Kalem teslim nesnesi: anahtar kurallı desene uymalı, giriş `{ durum: 'bekliyor' | 'teslim', zaman: metin, kim: { uid, ad } }`.
 * Uymayan GİRİŞ düşer — nesnenin tamamı değil (akış güvenilmez biçimdedir). Desene uyan anahtar `b:<n>` / `t:<hex>` olduğu
 * için prototip adı (`__proto__`, `constructor`) hiç geçemez.
 */
function kalemTeslimDaralt(v: unknown): Record<string, MagazaKalemTeslimGirisi> {
  const ham = nesne(v);
  const out: Record<string, MagazaKalemTeslimGirisi> = {};
  for (const anahtar of Object.keys(ham)) {
    if (!MAGAZA_KALEM_ANAHTARI_DESENI.test(anahtar)) continue;
    const g = nesne(ham[anahtar]);
    const kim = kimDaralt(g.kim);
    if ((g.durum !== 'bekliyor' && g.durum !== 'teslim') || typeof g.zaman !== 'string' || kim === null) continue;
    out[anahtar] = { durum: g.durum, zaman: g.zaman, kim };
  }
  return out;
}

/** (V23) `etiketBasildi`: nesne ve `zaman` metin ise `{ zaman, koli?: pozitif tam sayıysa, kim }`; yok / `null` / bozuk → `null`. */
function etiketBasildiDaralt(v: unknown): MagazaEtiketBasildi | null {
  const e = nesne(v);
  if (typeof e.zaman !== 'string') return null;
  const kimHam = nesne(e.kim);
  const kim: MagazaEtiketBasildi['kim'] = {
    ...(typeof kimHam.uid === 'string' ? { uid: kimHam.uid } : {}),
    ...(kimHam.panel === true ? { panel: true as const } : {}),
  };
  const koli = typeof e.koli === 'number' && Number.isInteger(e.koli) && e.koli >= 1 ? e.koli : null;
  return { zaman: e.zaman, ...(koli !== null ? { koli } : {}), kim };
}

// ── Dilim 2b alanları ──
/** `kim` okunamıyorsa: ad basılmaz ('—'), kayıt yine de taşınır (silme / teyit bilgisi kaybolmasın). */
const kimYaDaBos = (v: unknown): { uid: string; ad: string } => kimDaralt(v) ?? { uid: '', ad: '' };
const surumYaDaNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * Teyit kalemi. Üç alan kalemi BOZUK sayar (→ `null`, çağıran teyidi bütünüyle düşürür): `anahtar` kurallı desene uymuyor
 * (teslim işareti bu anahtara bağlıdır), `kdvOrani` küme dışı ya da `kdvKaynagi` tanınmıyor (tutarın dayanağı). Metinler ve
 * `tedarik` beyan kalemiyle aynı daraltmadan geçer; `adet` sayı değilse NaN, `birimFiyat` sayı değilse `null` («fiyat sorulacak»).
 */
function teyitKalemiDaralt(v: unknown): MagazaTeyitKalemi | null {
  const k = nesne(v);
  if (typeof k.anahtar !== 'string' || !MAGAZA_KALEM_ANAHTARI_DESENI.test(k.anahtar)) return null;
  if (!magazaKdvOraniMi(k.kdvOrani) || !magazaKdvKaynagiMi(k.kdvKaynagi)) return null;
  return {
    anahtar: k.anahtar,
    id: metin(k.id),
    sku: metin(k.sku),
    ad: metin(k.ad),
    marka: metin(k.marka),
    adet: typeof k.adet === 'number' && Number.isFinite(k.adet) ? k.adet : NaN,
    birimFiyat: sayiYaDaNull(k.birimFiyat),
    kdvOrani: k.kdvOrani,
    kdvKaynagi: k.kdvKaynagi,
    tedarik: k.tedarik === true,
  };
}

/**
 * `teyit`: nesne VE `kalemler` boş olmayan dizi VE HER kalem okunabiliyor VE anahtarlar tekil ise teyit; değilse `null`.
 * Üç toplam sunucunun türettiği değerdir (`sayiYaDaNull` — okunamayan toplam 0 olmaz); ekran bunlardan yeniden hesap YAPMAZ.
 */
function teyitDaralt(v: unknown): MagazaTeyit | null {
  const t = nesne(v);
  if (!Array.isArray(t.kalemler) || t.kalemler.length === 0) return null;
  const kalemler: MagazaTeyitKalemi[] = [];
  const gorulen = new Set<string>();
  for (const ham of t.kalemler) {
    const k = teyitKalemiDaralt(ham);
    if (k === null || gorulen.has(k.anahtar)) return null;
    gorulen.add(k.anahtar);
    kalemler.push(k);
  }
  return {
    kalemler,
    araToplam: sayiYaDaNull(t.araToplam), kdv: sayiYaDaNull(t.kdv), toplam: sayiYaDaNull(t.toplam),
    zaman: metin(t.zaman),
    kim: kimYaDaBos(t.kim),
  };
}

/** `silindi`: NESNE ise silinmiş (alanları tek tek daraltılır, nesne düşmez); `null` (geri alınmış) / yok / başka tür → `null`. */
function silindiDaralt(v: unknown): MagazaSatirSilindi | null {
  if (!magazaSilinmisMi({ silindi: v })) return null;
  const s = nesne(v);
  return { zaman: metin(s.zaman), kim: kimYaDaBos(s.kim), kanal: kanalMi(s.kanal) ? s.kanal : null };
}

/** `elle`: nesne ise ERP'de elle açılmış talep; yok / başka tür → `null` (mağazadan geldi). */
function elleDaralt(v: unknown): MagazaElle | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const e = nesne(v);
  return { zaman: metin(e.zaman), kim: kimYaDaBos(e.kim) };
}

/**
 * `bildirimRevize`: ilk bildirimle AYNI daraltıcı (aynı dört durumlu sözlük — bilinmeyen durum → `null`, ikinci rozet çizilmez)
 * + `alanlar` (`alanlariBirlestir`: SQL birleştirmesinin bıraktığı yinelenen ad tekilleşir, bilinmeyen ad düşer).
 */
function bildirimRevizeDaralt(v: unknown): MagazaSatirBildirimRevize | null {
  const taban = bildirimDaralt(v);
  if (taban === null) return null;
  const b = nesne(v);
  return { ...taban, alanlar: alanlariBirlestir(b.alanlar), kim: kimYaDaBos(b.kim), icerikSurum: surumYaDaNull(b.icerikSurum) };
}

/** Akıştan gelen ham dokümanı ekran satırına daraltır. HİÇBİR kaydı atmaz: okunamayan alan boş / `null` / NaN olur. */
export function magazaTalebiDaralt(id: string, ham: unknown): MagazaTalepSatiri {
  const d = nesne(ham);
  const t = nesne(d.talepEdilen);
  const dusen = typeof d.durumGecmisiDusen === 'number' && Number.isInteger(d.durumGecmisiDusen) && d.durumGecmisiDusen >= 0 ? d.durumGecmisiDusen : null;
  return {
    id,
    companyId: metin(d.companyId),
    talepNo: metin(d.talepNo),
    durum: asamaYaDaNull(d.durum),
    olusturma: metin(d.olusturma),
    istemciTarihi: typeof d.istemciTarihi === 'string' ? d.istemciTarihi : null,
    musteri: musteriDaralt(d.musteri),
    telefonSon10: metin(d.telefonSon10),
    not: metin(d.not),
    kalemler: Array.isArray(d.kalemler) ? d.kalemler.map(kalemDaralt) : [],
    talepEdilen: { araToplam: sayiYaDaNull(t.araToplam), kdv: sayiYaDaNull(t.kdv), toplam: sayiYaDaNull(t.toplam) },
    fiyatiSorulacakVar: d.fiyatiSorulacakVar === true,
    ...(d.kirpildi === true ? { kirpildi: true as const } : {}),
    bildirim: bildirimDaralt(d.bildirim),
    // ── dilim 2a ──
    durumAciklama: metin(d.durumAciklama),
    ...(typeof d.durumZamani === 'string' ? { durumZamani: d.durumZamani } : {}),
    // Sayı değilse 0: istemci CAS için gördüğü sürümü geri gönderir; dilim 1 kaydında alan yoktur (= 0).
    durumSurum: typeof d.durumSurum === 'number' && Number.isInteger(d.durumSurum) && d.durumSurum >= 0 ? d.durumSurum : 0,
    iptalOncesi: magazaAcikAsamaMi(d.iptalOncesi) ? d.iptalOncesi : null,
    durumGecmisi: Array.isArray(d.durumGecmisi) ? d.durumGecmisi.flatMap(g => { const x = gecisDaralt(g); return x === null ? [] : [x]; }) : [],
    ...(dusen !== null ? { durumGecmisiDusen: dusen } : {}),
    kalemTeslim: kalemTeslimDaralt(d.kalemTeslim),
    etiketBasildi: etiketBasildiDaralt(d.etiketBasildi),
    // ── dilim 2b ──
    teyit: teyitDaralt(d.teyit),
    // Sayı değilse 0: 2a ve dilim 1 kaydında alan yoktur (= 0); sunucu CAS'ı `COALESCE(…, '0')` ile aynı okur.
    icerikSurum: typeof d.icerikSurum === 'number' && Number.isInteger(d.icerikSurum) && d.icerikSurum >= 0 ? d.icerikSurum : 0,
    ...(typeof d.icerikZamani === 'string' ? { icerikZamani: d.icerikZamani } : {}),
    silindi: silindiDaralt(d.silindi),
    elle: elleDaralt(d.elle),
    bildirimRevize: bildirimRevizeDaralt(d.bildirimRevize),
  };
}

/**
 * Sekme rozetinin ikinci sayısı: aşaması `yeni` olan CANLI talepler (panelin «Yeni»siyle AYNI sayı — § 5.2). Silinmiş talep
 * SAYILMAZ (2b, § 10.4): panel listesi silinmişi zaten dışlar; ERP rozeti onu saysaydı iki ekran ayrışırdı.
 */
export function yeniAsamaSayisi(talepler: readonly { durum: MagazaTalepAsamasi | null; silindi?: unknown }[]): number {
  return talepler.filter(t => t.durum === 'yeni' && !magazaSilinmisMi(t)).length;
}

// ── Abonelik ────────────────────────────────────────────────────────────────────────────────────────────────────────

const BEKLENIYOR: MagazaTalepleriDurumu = { talepler: [], yukleniyor: true, hata: null };
const KAPALI: MagazaTalepleriDurumu = { talepler: [], yukleniyor: false, hata: null };

/**
 * İlk görüntü bu sürede gelmezse «Yükleniyor…» yerine hata gösterilir. `lib/dbClient.ts` INIT_GUARD_MS'ten (60 sn) UZUN
 * olmalı: meşru bir abonelik, uçuştaki başka bir init yüzünden o kadar ertelenebilir (çit: useMagazaTalepleri.test.ts).
 */
export const MAGAZA_ILK_GORUNTU_SURESI_MS = 90_000;
/** Süre sınırı dolunca `hata`'ya yazılan metin; ekran «Mağaza talepleri okunamadı: …» önekiyle basar. */
export const MAGAZA_ILK_GORUNTU_HATASI = 'sunucu bu listeyi göndermedi (yetki ya da bağlantı) — sayfayı yenileyin';

/**
 * @param enabled YETKİ kapısı — varsayılanı BİLEREK yok: çağıran «yetkili mi» sorusunu atlayamasın.
 */
export function useMagazaTalepleri(enabled: boolean): MagazaTalepleriDurumu {
  const [durum, setDurum] = useState<MagazaTalepleriDurumu>(BEKLENIYOR);

  useEffect(() => {
    if (!enabled) return;

    // Sunucu koleksiyonu akıştan sessizce düşürürse geri çağrı HİÇ gelmez (dosya başı «İLK GÖRÜNTÜ SÜRE SINIRI»).
    // Yalnız hâlâ beklenirken hata yazar: görüntü ya da abonelik hatası zamanında geldiyse hiçbir şeyi değiştirmez.
    // Geç gelen görüntü durumu yine düzeltir — aşağıdaki geri çağrı `hata: null` yazar.
    const sure = setTimeout(
      () => setDurum(o => (o.yukleniyor ? { talepler: [], yukleniyor: false, hata: MAGAZA_ILK_GORUNTU_HATASI } : o)),
      MAGAZA_ILK_GORUNTU_SURESI_MS,
    );

    const unsub = onSnapshot(
      query(collection(db, MAGAZA_TALEP_KOLEKSIYONU)),
      snap => setDurum({ talepler: snap.docs.map(d => magazaTalebiDaralt(d.id, d.data())), yukleniyor: false, hata: null }),
      err => setDurum({ talepler: [], yukleniyor: false, hata: err instanceof Error ? err.message : String(err) }),
    );

    // Yetki düşerse (rol değişti) önceki rolün gördüğü talepler bellekte KALMAZ; yeniden açılırsa «Yükleniyor…»dan başlar.
    // Zamanlayıcı da kapanır: kapalıyken (ya da bileşen kaldırıldıktan sonra) süre dolup hata ÜRETMEZ.
    return () => { clearTimeout(sure); unsub(); setDurum(BEKLENIYOR); };
  }, [enabled]);

  return enabled ? durum : KAPALI;
}

// ── Adresle açılış ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Siparişler ekranının İLK çizimdeki kaynak sekmesi: adres `?kaynak=magaza` taşıyorsa VE rol yetkiliyse `'magaza'`,
 * diğer her durumda `'cetpa'` (bildirim e-postasındaki bağlantı `/orders?kaynak=magaza` — şartname § 3).
 * Yetkisiz rolde adres sekmeyi AÇMAZ: düğmesi çizilmeyen, aboneliği açılmayan bir sekmeye adresle girilemesin.
 *
 * @param arama   `window.location.search` (baştaki `?` ile ya da onsuz).
 * @param yetkili `isAllowed(rol, 'magazaTalepleri', 'read')`.
 */
export function magazaIlkKaynakSekmesi(arama: string, yetkili: boolean): 'cetpa' | 'magaza' {
  return yetkili && new URLSearchParams(arama).get('kaynak') === 'magaza' ? 'magaza' : 'cetpa';
}

// ── «Yeni» sayacı ───────────────────────────────────────────────────────────────────────────────────────────────────
// Saklanan değer `Date.now()` DEĞİL, kullanıcının gördüğü taleplerin EN BÜYÜK `olusturma` değeridir (ms): sunucu saati
// sunucu saatiyle karşılaştırılır — kullanıcının bilgisayar saati yanlışsa sayaç şaşmaz.

/** `olusturma` (sunucunun ISO-8601 kayıt saati) → ms; çözülemezse `null` (sayaca girmez, listede '—' ile kalır). */
export function magazaTalepOlusturmaMs(t: { olusturma: string }): number | null {
  return zamanMs(t.olusturma);
}

/** Verilen taleplerin en büyük `olusturma` değeri (ms); hiçbiri çözülemiyorsa / liste boşsa `null`. */
export function enBuyukOlusturmaMs(talepler: readonly { olusturma: string }[]): number | null {
  let enBuyuk: number | null = null;
  for (const t of talepler) {
    const ms = magazaTalepOlusturmaMs(t);
    if (ms !== null && (enBuyuk === null || ms > enBuyuk)) enBuyuk = ms;
  }
  return enBuyuk;
}

/**
 * «Yeni» talep sayısı: `olusturma` > son görülen. Son görülen YOKSA (`null`) çözülebilen bütün talepler yenidir.
 * `olusturma`'sı çözülemeyen talep SAYILMAZ (ne zaman geldiği bilinmiyor — «yeni» demek uydurma olurdu).
 */
export function yeniTalepSayisi(talepler: readonly { olusturma: string }[], sonGorulenMs: number | null): number {
  let sayi = 0;
  for (const t of talepler) {
    const ms = magazaTalepOlusturmaMs(t);
    if (ms !== null && (sonGorulenMs === null || ms > sonGorulenMs)) sayi++;
  }
  return sayi;
}

/** `cetpa:magazaTalepSonGorulen:<companyId>:<uid>` — kimliklerden biri bilinmiyorsa `null` (değer SAKLANMAZ). */
export function magazaSonGorulenAnahtari(companyId: string | null | undefined, uid: string | null | undefined): string | null {
  return companyId && uid ? `cetpa:magazaTalepSonGorulen:${companyId}:${uid}` : null;
}

/** Saklanan son görülen (ms). Anahtar yok / değer bozuk / depolama kapalı (özel pencere) → `null`. */
export function magazaSonGorulenOku(anahtar: string | null): number | null {
  if (anahtar === null) return null;
  try {
    const ham = localStorage.getItem(anahtar);
    if (ham === null) return null;
    const ms = Number(ham);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/** Son görüleni yazar — yalnız İLERİ: başka bir sekmenin yazdığı daha yeni değer geriye çekilmez. */
export function magazaSonGorulenYaz(anahtar: string | null, ms: number): void {
  if (anahtar === null || !Number.isFinite(ms)) return;
  try {
    const onceki = magazaSonGorulenOku(anahtar);
    if (onceki !== null && onceki >= ms) return;
    localStorage.setItem(anahtar, String(ms));
  } catch {
    /* depolama kapalı / kota dolu: sayaç bu oturumda bellekten çalışmaya devam eder */
  }
}

/**
 * «Yeni» talep sayısı (sekme düğmesindeki rozet).
 *
 * Sekme AÇIKKEN gelen talep GÖRÜLMÜŞ sayılır: açıkken sayı 0'dır ve görülenlerin en büyük `olusturma`'sı her yeni
 * talepte ileri alınır (bellek + depolama). Sekmeden çıkıldığında saklanan değer bu yüzden günceldir; sayfa sekme
 * açıkken yenilense de görülen talepler yeniden «yeni» sayılmaz.
 *
 * @param anahtar   `magazaSonGorulenAnahtari(...)`; `null` ise değer yalnız bellekte tutulur.
 * @param sekmeAcik Mağaza Talepleri listesi EKRANDA mı (yalnız seçili olması yetmez — başka sayfa / detay açıkken görülmez).
 */
export function useMagazaYeniSayaci(talepler: readonly MagazaTalepSatiri[], anahtar: string | null, sekmeAcik: boolean): number {
  // Depodaki değer anahtar başına BİR kez okunur; bu oturumda görülenler `bellek`te (depolama kapalıyken de çalışsın diye).
  const kayitli = useMemo(() => magazaSonGorulenOku(anahtar), [anahtar]);
  const [bellek, setBellek] = useState<{ anahtar: string | null; ms: number } | null>(null);
  const enBuyuk = useMemo(() => enBuyukOlusturmaMs(talepler), [talepler]);

  useEffect(() => {
    if (!sekmeAcik || enBuyuk === null) return;
    setBellek(o => (o !== null && o.anahtar === anahtar && o.ms >= enBuyuk ? o : { anahtar, ms: enBuyuk }));
    magazaSonGorulenYaz(anahtar, enBuyuk);
  }, [sekmeAcik, enBuyuk, anahtar]);

  if (sekmeAcik) return 0;
  // Başka kimliğin (kiracı / kullanıcı değişti) bellekteki değeri bu kimlik için geçersizdir.
  const bellekMs = bellek !== null && bellek.anahtar === anahtar ? bellek.ms : null;
  const sonGorulen = kayitli === null ? bellekMs : bellekMs === null ? kayitli : Math.max(kayitli, bellekMs);
  // (2b) «görülmemiş» yalnız CANLI talepleri sayar: silinmiş talep rozeti kabartmaz. «Görüldü» işareti (yukarıdaki `enBuyuk`)
  // ise BÜTÜN taleplerden: silinmiş talep de görülmüştür, geri alınınca yeniden «görülmemiş» olmaz.
  return yeniTalepSayisi(talepler.filter(t => !magazaSilinmisMi(t)), sonGorulen);
}
