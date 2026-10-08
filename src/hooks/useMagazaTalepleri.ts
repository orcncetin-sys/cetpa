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
 * eklenmez. Sayaç bu yüzden Siparişler ekranı açıkken çalışır (kenar çubuğu rozeti dilim 2).
 *
 * AKIŞTAN GELEN DOKÜMAN GÜVENİLMEZ BİÇİMDEDİR (eski sürümün yazdığı satır, elle düzeltilmiş kayıt, yarım göç):
 * `magazaTalebiDaralt` her alanı tek tek daraltır. Bilinmeyen sayı 0'a ÇEVRİLMEZ (`null`; adet için NaN) — ekran '—'
 * ya da «fiyat sorulacak» basar. `olusturma`'sı çözülemeyen kayıt ATILMAZ: listede kalır, yalnız «yeni» sayılmaz.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from '../lib/dbClient';
import { db } from '../firebase';
import { zamanMs } from '../utils/zaman';
import {
  MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_BILDIRIM_HATA_SINIFLARI,
  type MagazaTalebi, type MagazaTalepKalemi, type MagazaTalepMusteri, type MagazaBildirim, type MagazaBildirimDurumu,
} from '../lib/magazaTalep';

/**
 * Ekrandaki talep satırı: sözleşme tipi (`lib/magazaTalep.ts` `MagazaTalebi`) + doküman kimliği.
 *
 * TEK FARK `bildirim`: dokümanda okunamıyorsa (alan yok / bilinmeyen durum) `null`'dır. Sözleşme tipi orada bir durum
 * ZORUNLU kılar; uydurulacak her değer yanlış bir şey söylerdi («gitti» = sahte güvence, «bekliyor» = sahte bekleme).
 */
export type MagazaTalepSatiri = Omit<MagazaTalebi, 'bildirim'> & { id: string; bildirim: MagazaBildirim | null };

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

/** Akıştan gelen ham dokümanı ekran satırına daraltır. HİÇBİR kaydı atmaz: okunamayan alan boş / `null` / NaN olur. */
export function magazaTalebiDaralt(id: string, ham: unknown): MagazaTalepSatiri {
  const d = nesne(ham);
  const t = nesne(d.talepEdilen);
  return {
    id,
    companyId: metin(d.companyId),
    talepNo: metin(d.talepNo),
    durum: 'yeni',   // dilim 1'de tek değer; ekran bu alanı göstermez (teyit / ret durumları dilim 2)
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
  };
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
  return yeniTalepSayisi(talepler, sonGorulen);
}
