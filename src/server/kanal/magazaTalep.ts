/**
 * magazaTalep.ts — mağaza sipariş talebinin SAF eşleyicisi.
 * Ağ, veritabanı, saat OKUMAZ: saat ve kiracı bağlamla verilir.
 *
 * Şemanın (schemas.ts `MagazaSiparisTalebiSchema`) ardındaki TEK dönüşüm: temizlik + kırpma + doküman kurma.
 * Bağlam (kiracı, saat) gerektirdiği için şema dönüşümü DEĞİL; rota `talepEsle(girdi, { companyId, simdi })` çağırır.
 *
 * TEMİZLİK (bütün metin alanları):
 *  • U+0000 ve diğer C0 / C1 denetim karakterleri atılır. U+0000 jsonb eklemesini düşürür (PostgreSQL metinde NUL saklamaz).
 *  • Satır ayırıcılar — CRLF, CR, LF, VT, FF, NEL (U+0085), LS (U+2028), PS (U+2029): tek satırlık alanlarda (sekmeyle
 *    birlikte) BOŞLUĞA, çok satırlılarda (`adres`, `not`) `\n`'e iner; çok satırlıda yalnız `\n` ve sekme kalır.
 *    U+2028 / U+2029 KARARI: denetim karakteri değiller (Zl / Zp) ama satır ayırıcıdırlar — tek satırlık alanda satır
 *    kıramasınlar (liste satırı, e-posta gövdesi), çok satırlıda tek biçime (`\n`) insinler diye ayırıcı sayılır.
 *  • `toWellFormed()`: eşi olmayan vekil (JSON'da `"\ud83d"` kaçışıyla gelebilir) U+FFFD olur — jsonb onu da reddeder.
 *  • Baştaki / sondaki boşluk atılır (yalnız boşluktan oluşan ad = boş ad).
 *  • Türkçe harfe dokunan dönüşüm YOK: büyük / küçük harf çevirme, `normalize`, ASCII'ye indirgeme yapılmaz.
 *
 * KIRPMA: üst sınırı aşan metin REDDEDİLMEZ, kırpılır ve dokümana `kirpildi: true` yazılır (mağaza yanıtı okumuyor —
 * ret sessiz kayıp olurdu). Sınır UTF-16 kod birimidir; kesim vekil çiftini BÖLMEZ.
 *
 * TUTARLAR BEYANDIR: `birimFiyat` yok ya da null = «fiyat sorulacak» → `talepFiyat: null` (0'a ÇEVRİLMEZ);
 * toplamlar gönderilmediyse `null`. `fiyatiSorulacakVar` istemciden alınmaz, burada kalemlerden türetilir.
 *
 * DİLİM 2b (şartname v6 § 10.2): müşteri bloğu (`musteriEsle`), kalem bloğu (`kalemEsle`) ve not (`notEsle`) DIŞA AÇIKTIR —
 * ERP'deki içerik düzenleme ve elle talep (`kanal/magazaIcerik.ts`) AYNI temizlik / kırpma / ret kuralını bunlardan alır;
 * `talepEsle` onları çağırmaya devam eder (kopya eşleyici yok — çit: magazaTalep.test.ts).
 */
// `toWellFormed` ES2024'tür; tsconfig `lib` ES2022. Aşağıdaki yönerge yalnız dizge TİPLERİNİ ekler (çalışma anı: Node ≥ 20).
/// <reference lib="es2024.string" />
import { createHash } from 'node:crypto';
import { MAGAZA_TALEP_NO_DESENI } from '../../lib/magazaTalep.js';
import type { MagazaTalebi, MagazaTalepKalemi, MagazaTalepMusteri } from '../../lib/magazaTalep.js';

/** Şemadan (schemas.ts `MagazaSiparisTalebiSchema`) çıkan, henüz TEMİZLENMEMİŞ gövde. */
export interface MagazaTalepGirdisi {
  no: string;
  tarih?: string;
  musteri: { ad: string; telefon: string; firma?: string; eposta?: string; il?: string; adres?: string; vergi?: string };
  not?: string;
  kalemler: Array<{ ad: string; adet: number; id?: string; sku?: string; marka?: string; birimFiyat?: number | null; tedarik?: boolean }>;
  araToplam?: number;
  kdv?: number;
  toplam?: number;
}

export type TalepEsleSonucu = { ok: true; id: string; belge: MagazaTalebi } | { ok: false };

/** Metin üst sınırları (UTF-16 kod birimi). Aşım ret değil KIRPMA. */
export const MAGAZA_METIN_SINIRLARI = {
  ad: 200, firma: 200, telefon: 40, eposta: 254, il: 80, adres: 500, vergi: 20, not: 1000,
  kalemAd: 200, kalemSku: 60, kalemId: 128, kalemMarka: 60,
} as const;

// Denetim karakteri desenleri kaynakta HAM karakterle değil KAÇIŞLA yazılır (ham NUL / CR dosyayı ve diff'i bozar).
/** Satır ayırıcılar: CRLF (tek ayırıcı), LF, CR, VT, FF, NEL (U+0085), LS (U+2028), PS (U+2029). */
// eslint-disable-next-line no-control-regex -- desen bilerek denetim karakteri eşler
const SATIR_AYIRICI = /\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/g;
/** C0 (U+0000–U+001F), DEL (U+007F) ve C1 (U+0080–U+009F) — tamamı. */
// eslint-disable-next-line no-control-regex -- desen bilerek denetim karakteri eşler
const DENETIM = /[\u0000-\u001F\u007F-\u009F]/g;
/** Aynı küme, sekme (U+0009) ve satır sonu (U+000A) HARİÇ — çok satırlı alanda bu ikisi kalır. */
// eslint-disable-next-line no-control-regex -- desen bilerek denetim karakteri eşler
const DENETIM_SEKME_VE_SATIR_SONU_HARIC = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * Tek metin alanının temizliği (kırpma HARİÇ). Sıra önemli: önce satır ayırıcılar hedef biçime iner (CRLF TEK
 * ayırıcıdır — parçaları ayrı ele alınsaydı çok satırlıda çift satır sonu, tek satırlıda çift boşluk olurdu), sonra
 * kalan denetim karakterleri atılır.
 */
export function magazaMetniTemizle(ham: string, cokSatirli: boolean): string {
  const ayiklanmis = cokSatirli
    ? ham.replace(SATIR_AYIRICI, '\n').replace(DENETIM_SEKME_VE_SATIR_SONU_HARIC, '')
    : ham.replace(SATIR_AYIRICI, ' ').replace(/\t/g, ' ').replace(DENETIM, '');
  return ayiklanmis.toWellFormed().trim();
}

/**
 * Üst sınırda keser; kesim noktası bir vekil çiftinin ortasına geliyorsa çiftin TAMAMI dışarıda kalır.
 * Dilim 2a'da dışa açıldı (eski ad `kirp`): `durumAciklama` (500), panel `kim.ad` (80) ve takip yanıtının kalem metinleri
 * aynı kesimi kullanır — kopyalanmaz. Girdi iyi biçimli olmalı (`magazaMetniTemizle` çıktısı).
 */
export function magazaMetniKirp(metin: string, sinir: number): { metin: string; kirpildi: boolean } {
  if (metin.length <= sinir) return { metin, kirpildi: false };
  const sonBirim = metin.charCodeAt(sinir - 1);
  // Metin iyi biçimli (`toWellFormed`): içeride kalan son birim üst vekilse eşi sınırın hemen dışındadır.
  const ustVekil = sonBirim >= 0xD800 && sonBirim <= 0xDBFF;
  return { metin: metin.slice(0, ustVekil ? sinir - 1 : sinir), kirpildi: true };
}

/** Telefonun son 10 rakamı; 10'dan az rakam varsa `null`. */
export function telefonSon10(telefon: string): string | null {
  // Yalnız ASCII rakam: takip sorgusunun anahtarı (`POST /siparis-durumu`, routes/magazaRoutes.ts) iki tarafta aynı kümeden üretilir.
  const rakamlar = telefon.replace(/[^0-9]/g, '');
  return rakamlar.length >= 10 ? rakamlar.slice(-10) : null;
}

/** `mt-` + sha256(cid | talepNo | telefonSon10) ilk 32 onaltılık hane. */
export function magazaTalepKimligi(companyId: string, talepNo: string, son10: string): string {
  // Ayraç belirsizliği yok: talep no ve son 10 hane SABİT boydadır (kiracı kimliği `|` içerse bile sonek ayrışır).
  return `mt-${createHash('sha256').update(`${companyId}|${talepNo}|${son10}`).digest('hex').slice(0, 32)}`;
}

/**
 * ISO-8601 tarih-saat, saat dilimi belirteciyle (`Z` ya da `±ss:dd`). Dilimsiz değer sunucunun yerel saatiyle
 * yorumlanırdı; gevşek biçimleri (`"1"` → 2001 yılı) `Date` kabul eder — ikisi de «çözülemedi» sayılır.
 */
const ISO_TARIH_SAAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Müşteri cihazının saati (UTC, ISO-8601 metin); çözülemezse `null`. Güvenilmez — yalnız bilgi. */
function istemciTarihiCoz(ham: string | undefined): string | null {
  if (ham === undefined) return null;
  const metin = ham.trim();
  if (!ISO_TARIH_SAAT.test(metin)) return null;
  const ms = Date.parse(metin);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * İstemci BEYANI tutar: yok / null → `null` (BİLİNMİYOR; 0 DEĞİL). Sonlu ve eksi olmayan sayı aynen.
 * Şema zaten süzer; buradaki denetim, eşleyici şemasız çağrılırsa `NaN`'ın JSON'da `null`'a («fiyat sorulacak»)
 * dönüşmesini önler.
 */
function beyanTutari(deger: number | null | undefined): { ok: true; tutar: number | null } | { ok: false } {
  if (deger === undefined || deger === null) return { ok: true, tutar: null };
  return Number.isFinite(deger) && deger >= 0 ? { ok: true, tutar: deger } : { ok: false };
}

/** Kırpma izleyen temizleyici çifti: `metin` isteğe bağlı alan (yok = boş dizge), `kirpilmis` zaten temizlenmiş metin. */
function kirpici(): { kirpildi: () => boolean; kirpilmis: (temiz: string, sinir: number) => string; metin: (ham: string | undefined, sinir: number, cokSatirli?: boolean) => string } {
  let kirpildi = false;
  const kirpilmis = (temiz: string, sinir: number): string => {
    const sonuc = magazaMetniKirp(temiz, sinir);
    if (sonuc.kirpildi) kirpildi = true;
    return sonuc.metin;
  };
  /** İsteğe bağlı metin: yok = boş dizge. */
  const metin = (ham: string | undefined, sinir: number, cokSatirli = false): string =>
    kirpilmis(magazaMetniTemizle(ham ?? '', cokSatirli), sinir);
  return { kirpildi: () => kirpildi, kirpilmis, metin };
}

export type MusteriEsleSonucu =
  | { ok: true; musteri: MagazaTalepMusteri; /** Telefonun son 10 rakamı — KIRPMADAN ÖNCEKİ değerden. */ telefonSon10: string; kirpildi: boolean }
  | { ok: false };

/**
 * Müşteri bloğu: temizlik + kırpma. `ok: false` = temizlikten sonra `ad` boş ya da telefonda 10 rakam yok.
 * İçerik düzenlemesi (2b) dönen `telefonSon10`'u KULLANMAZ: takip anahtarı ve kimlik ilk telefonla kalır (V21).
 */
export function musteriEsle(m: MagazaTalepGirdisi['musteri']): MusteriEsleSonucu {
  // Zorunlu iki alan KIRPMADAN ÖNCEKİ değere bakar; `telefonSon10` da kırpmadan önceki değerin rakamlarından.
  const son10 = telefonSon10(m.telefon);
  if (son10 === null) return { ok: false };
  const adTemiz = magazaMetniTemizle(m.ad, false);
  if (adTemiz === '') return { ok: false };
  const S = MAGAZA_METIN_SINIRLARI;
  const { kirpildi, kirpilmis, metin } = kirpici();
  const musteri: MagazaTalepMusteri = {
    ad: kirpilmis(adTemiz, S.ad),
    firma: metin(m.firma, S.firma),
    telefon: metin(m.telefon, S.telefon),
    eposta: metin(m.eposta, S.eposta),
    il: metin(m.il, S.il),
    adres: metin(m.adres, S.adres, true),
    vergi: metin(m.vergi, S.vergi),
  };
  return { ok: true, musteri, telefonSon10: son10, kirpildi: kirpildi() };
}

export type KalemEsleSonucu = { ok: true; kalem: MagazaTalepKalemi; kirpildi: boolean } | { ok: false };

/**
 * Tek kalem: temizlik + kırpma. `ok: false` = temizlikten sonra ad boş, adet güvenli pozitif tam sayı değil ya da fiyat
 * geçersiz (eksi / sonlu değil). `birimFiyat` yok ya da null → `talepFiyat: null` («fiyat sorulacak»; 0 DEĞİL).
 */
export function kalemEsle(k: MagazaTalepGirdisi['kalemler'][number]): KalemEsleSonucu {
  const kalemAdi = magazaMetniTemizle(k.ad, false);
  if (kalemAdi === '') return { ok: false };
  // Üst sınır YOK (kullanıcı kararı K4); güvenli tam sayı dışı reddedilir.
  if (!Number.isSafeInteger(k.adet) || k.adet <= 0) return { ok: false };
  const fiyat = beyanTutari(k.birimFiyat);
  if (!fiyat.ok) return { ok: false };
  const S = MAGAZA_METIN_SINIRLARI;
  const { kirpildi, kirpilmis, metin } = kirpici();
  const kalem: MagazaTalepKalemi = {
    id: metin(k.id, S.kalemId),
    sku: metin(k.sku, S.kalemSku),
    ad: kirpilmis(kalemAdi, S.kalemAd),
    marka: metin(k.marka, S.kalemMarka),
    adet: k.adet,
    talepFiyat: fiyat.tutar,
    tedarik: k.tedarik === true,
  };
  return { ok: true, kalem, kirpildi: kirpildi() };
}

/** Not: çok satırlı temizlik + 1.000 birime kırpma (yok = boş dizge). */
export function notEsle(ham: string | undefined): { not: string; kirpildi: boolean } {
  const { kirpildi, metin } = kirpici();
  const not = metin(ham, MAGAZA_METIN_SINIRLARI.not, true);
  return { not, kirpildi: kirpildi() };
}

/**
 * Temizlik + kırpma + doküman kurma. `ok: false` = temizlikten sonra zorunlu alan boş
 * (ad, kalem adı) ya da telefonda 10 rakam yok → rota sabit 400 döner.
 */
export function talepEsle(girdi: MagazaTalepGirdisi, baglam: { companyId: string; simdi: Date }): TalepEsleSonucu {
  // Kiracısız doküman YAZILMAZ: rota kiracı çözülemeyince 503 döner ve buraya hiç gelmez. Yine de gelinirse bu bir
  // çağıran hatasıdır (400 değil) — sessizce etiketsiz kayıt üretmek yerine yüksek sesle dur.
  if (baglam.companyId.trim() === '') throw new Error('magazaTalep: kiracı kimliği boş — eşleyici kiracısız çağrılamaz');
  if (!MAGAZA_TALEP_NO_DESENI.test(girdi.no)) return { ok: false };

  const musteri = musteriEsle(girdi.musteri);
  if (!musteri.ok) return { ok: false };
  let kirpildi = musteri.kirpildi;

  const kalemler: MagazaTalepKalemi[] = [];
  for (const k of girdi.kalemler) {
    const kalem = kalemEsle(k);
    if (!kalem.ok) return { ok: false };
    if (kalem.kirpildi) kirpildi = true;
    kalemler.push(kalem.kalem);
  }
  if (kalemler.length === 0) return { ok: false };

  const araToplam = beyanTutari(girdi.araToplam);
  const kdv = beyanTutari(girdi.kdv);
  const toplam = beyanTutari(girdi.toplam);
  if (!araToplam.ok || !kdv.ok || !toplam.ok) return { ok: false };

  // `olusturma` ve `bildirim.zaman` aynı an: UTC, ISO-8601 METİN. `pgServerTimestamp()` nöbetçisi KULLANILMAZ —
  // ham `INSERT` onu çözmez, satıra `{ __op }` düşer ve ekran '—' basardı.
  const zaman = baglam.simdi.toISOString();
  const not = notEsle(girdi.not);
  if (not.kirpildi) kirpildi = true;

  const belge: MagazaTalebi = {
    companyId: baglam.companyId,
    talepNo: girdi.no,
    durum: 'yeni',
    olusturma: zaman,
    istemciTarihi: istemciTarihiCoz(girdi.tarih),
    musteri: musteri.musteri,
    telefonSon10: musteri.telefonSon10,
    not: not.not,
    kalemler,
    talepEdilen: { araToplam: araToplam.tutar, kdv: kdv.tutar, toplam: toplam.tutar },
    fiyatiSorulacakVar: kalemler.some(k => k.talepFiyat === null),
    ...(kirpildi ? { kirpildi: true as const } : {}),
    bildirim: { durum: 'bekliyor', zaman },
  };
  return { ok: true, id: magazaTalepKimligi(baglam.companyId, girdi.no, musteri.telefonSon10), belge };
}
