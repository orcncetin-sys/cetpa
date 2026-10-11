/**
 * magazaTalepFormu.ts — ERP «Mağaza Talepleri» içerik formunun SAF kuralları (dilim 2b, şartname v6 § 10.4; 2026-10-10).
 *
 * Yaprak modül (React / ağ / depolama yok): form bileşeni (`components/siparis/MagazaTalepDuzenle.tsx`) taslağı buradan kurar,
 * gövdeyi buradan üretir; istek `services/magazaTalepIstemcisi.ts`'te, yazma kuralı sunucudadır
 * (`src/server/kanal/magazaIcerik.ts`). İki kip:
 *   • düzenle — mevcut talebin müşteri bilgileri + not + TEYİT kalemleri (`POST …/:id/icerik`);
 *   • yeni    — ERP'de elle talep: müşteri + not + kalemler, yani telefonla alınan BEYAN (`POST /api/magaza-talepleri`).
 *
 * KURALLAR:
 *  • MÜŞTERİNİN İLK TALEBİ DOKUNULMAZDIR (V16): düzenleme gövdesinde `kalemler` / `talepEdilen` anahtarı YOKTUR. Form beyanı
 *    KOPYALAR (`taslakBeyandan`); kopyalanan satır gövdeye `anahtar: 'b:<dizin>'` ile gider — sunucu yeni teyit anahtarı üretir
 *    ve beyan kaleminin teslim işaretini ona taşır. Mevcut teyit kalemi kendi `t:` anahtarıyla, elle eklenen kalem ANAHTARSIZ.
 *  • TEYİT BÖLÜMÜ İLK AÇILIŞTA `teyit ?? kalemler`'DEN KOPYALANIR (§ 10.4; inceleme 2b, bulgu 6): teyit varsa kendi kalemleriyle,
 *    yoksa müşteri BEYANININ kopyasıyla (`b:<dizin>` satırları) açılır. Form TAM gövde gönderir: satır varsa `teyit` gövdededir
 *    (form değişen bölümü SEÇMEZ, «ne değişti» sunucuda ölçülür — K13). Sonucu: teyidi olmayan talepte satırlara hiç dokunmadan
 *    kaydetmek de beyandaki adet ve fiyatla TEYİT yazar — ekran bunu kaydetmeden önce söyler (`MagazaTalepDuzenle.tsx`).
 *    Personel bütün satırları kaldırırsa bölüm boştur ve gövdede `teyit` YOKTUR; bu yalnız teyidi OLMAYAN talepte serbesttir
 *    (teyit yazılmış talepte satırsız kayıt `kalemYok` hatasıdır — teyit geri alınamaz).
 *  • PARA (V19): birim fiyat KDV HARİÇ net. Boş fiyat = `null` = «fiyat sorulacak» (0 DEĞİL). Okunamayan adet / fiyat alan
 *    HATASIDIR — `null`'a ya da 0'a ÇEVRİLMEZ, gövde üretilmez. Toplamlar gövdeye GİRMEZ (sunucu türetir); önizleme
 *    `magazaTeyitToplamlari` ile — sunucunun kayıtlı tutarı ürettiği AYNI işlev.
 *  • KDV ORANI: personel bu oturumda seçtiyse (ya da «varsayılan» oranı açıkça ONAYLADIYSA — seçimle aynı alan) gövdeye
 *    `kdvOrani` girer ve sunucu kaynağı `personel` yazar; seçmediyse gövdede YOKTUR. `kdvKaynagi` gövdeye HİÇ girmez.
 *    Önizlemenin oranı `magazaTaslakKdv` — sunucunun YAZACAĞI oranla AYNI kural (`src/server/kanal/magazaIcerik.ts`
 *    `teyitHazirla`; şartname § 10.2 (a) 3 ve inceleme 2b istisnası): seçilen → mevcut teyit kaleminin KAYITLI oranı ve kaynağı
 *    (stok kodu değişmedikçe; kaynağı `personel` ise her zaman) → `magazaKdvVarsayilani(urunKdvOrani(sku))`. Teyit edilen
 *    rakam, ona dokunulmadıkça sabittir: ürün kartının oranı sonradan değişse de ekranda görülen oran ve toplam, kaydın
 *    yazacağı oran ve toplamdır (çit: `magazaTalepFormu.sunucu.pglite.test.ts` — formun gövdesi GERÇEK yazma işlevinden geçer).
 *    Kayıtlı `varsayilan` satırda ürün kaydı önizleme için sorulmaz; yalnız BİLGİ için okunur
 *    (`magazaKayitliVarsayilaninKartOrani` — «ürün kaydı şimdi %N»; önizlemeye ve gövdeye girmez).
 *  • SAYI GİRDİSİ METİNDİR (`type=number` veri kaybı tuzağı). Adet yalnız rakam. Fiyatta ondalık ayraç virgül ya da nokta;
 *    binlik ayraç KABUL EDİLMEZ ve «1.250» gibi BELİRSİZ yazım (nokta + tam üç hane) HATADIR: Türkçe yazımda 1250 demektir,
 *    `Number('1.250')` ise 1,25 okur — sessizce bin kat küçük fiyat yazılırdı.
 */
import {
  MAGAZA_MUSTERI_ALANLARI, magazaKdvVarsayilani, magazaTeyitToplamlari,
  type MagazaKdvKaynagi, type MagazaKdvOrani, type MagazaTalepKalemi, type MagazaTalepMusteri, type MagazaTeyitKalemi, type MagazaTeyitToplami,
} from './magazaTalep';

// ── Gövdeler (sunucu şemalarıyla AYNI biçim: `src/server/schemas.ts` `ErpIcerikGovdesi` / `ErpElleTalepGovdesi`) ─────────

/** İçerik gövdesinin teyit kalemi. */
export interface MagazaIcerikKalemGirdisi {
  /** «Hangi kalem» bilgisi (işaret DEĞİL): mevcut teyit kaleminin `t:` anahtarı / beyandan kopyada `b:<dizin>` / yeni kalemde YOK. */
  anahtar?: string;
  id?: string;
  sku?: string;
  ad: string;
  marka?: string;
  /** Tam sayı > 0. */
  adet: number;
  /** KDV HARİÇ net; `null` = «fiyat sorulacak» (0 DEĞİL). */
  birimFiyat: number | null;
  /** YALNIZ personel bu oturumda seçtiyse / onayladıysa; yoksa sunucu mevcut kalemde kayıtlı oranı korur, öbür durumda ürün kaydından çözer. */
  kdvOrani?: MagazaKdvOrani;
  tedarik?: boolean;
}

/** `POST …/:id/icerik` gövdesi. `icerikSurum` = formun AÇILDIĞI andaki sürüm (CAS). `musteri` YEDİ alan birden. */
export interface MagazaIcerikGirdisi {
  icerikSurum: number;
  musteri?: MagazaTalepMusteri;
  not?: string;
  teyit?: { kalemler: MagazaIcerikKalemGirdisi[] };
}

/** `POST /api/magaza-talepleri` gövdesi — mağaza talebi gövdesinin `no` ve `tarih`'siz hâli. Toplam GÖNDERİLMEZ (beyan yok). */
export interface MagazaElleTalepGirdisi {
  musteri: { ad: string; telefon: string; firma?: string; eposta?: string; il?: string; adres?: string; vergi?: string };
  not?: string;
  kalemler: Array<{ ad: string; adet: number; sku?: string; marka?: string; birimFiyat?: number | null; tedarik?: boolean }>;
}

// ── Sayı girdisi ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MagazaSayiGirdisi = { tur: 'bos' } | { tur: 'sayi'; deger: number } | { tur: 'gecersiz' };

/** Adet: yalnız rakam; güvenli tam sayı VE > 0. `12,5`, `1.000`, `abc`, `0`, `-3` → `gecersiz`; boş → `bos`. */
export function magazaAdetCoz(ham: string): MagazaSayiGirdisi {
  const metin = ham.trim();
  if (metin === '') return { tur: 'bos' };
  if (!/^\d+$/.test(metin)) return { tur: 'gecersiz' };
  const n = Number(metin);
  return Number.isSafeInteger(n) && n > 0 ? { tur: 'sayi', deger: n } : { tur: 'gecersiz' };
}

/**
 * Birim fiyat (KDV hariç): rakamlar + isteğe bağlı TEK ondalık ayraç (virgül ya da nokta). Boş → `bos` (= «fiyat sorulacak»).
 * Binlik ayraç, eksi işaret, üs, boşluk → `gecersiz`. NOKTA + TAM ÜÇ HANE (`1.250`) → `gecersiz`: binlik ayraç mı ondalık mı
 * belirsizdir (dosya başı). Aynı değer virgülle açıktır: `1,250` = 1,25; `1250` = bin iki yüz elli.
 */
export function magazaFiyatCoz(ham: string): MagazaSayiGirdisi {
  const metin = ham.trim();
  if (metin === '') return { tur: 'bos' };
  if (!/^\d+(?:[.,]\d+)?$/.test(metin)) return { tur: 'gecersiz' };
  if (/\.\d{3}$/.test(metin)) return { tur: 'gecersiz' };
  const n = Number(metin.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? { tur: 'sayi', deger: n } : { tur: 'gecersiz' };
}

/** Sayı → giriş metni: ondalık ayraç VİRGÜL (formun okuduğu yazım; `magazaFiyatCoz` aynı değeri geri verir). Bilinmeyen → boş. */
export function magazaSayiMetni(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '' : String(n).replace('.', ',');
}

/**
 * Telefonda EN AZ 10 ASCII rakam var mı — takip ucu talebi `no` + telefonun son 10 rakamıyla bulur. Hüküm sunucudadır
 * (`src/server/kanal/magazaTalep.ts` `telefonSon10`); bu işlev yalnız formun erken uyarısıdır ve o işlevle ADAY ADAY
 * karşılaştırılır (çit: `magazaTalepFormu.test.ts`).
 */
export function magazaTelefonGecerli(telefon: string): boolean {
  return telefon.replace(/[^0-9]/g, '').length >= 10;
}

// ── Taslak ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MagazaKalemTaslagi {
  /** Yerel satır kimliği (React anahtarı, alan hatasının adresi); gövdeye GİRMEZ. */
  yerel: number;
  /** Sunucuya giden «hangi kalem» bilgisi; yeni kalemde `null`. */
  anahtar: string | null;
  /** Kaynağın `id`'si (düzenlenmez; boş olabilir, tekil değildir — adresleme yapmaz). */
  id: string;
  sku: string;
  ad: string;
  marka: string;
  /** METİN: kaydetme anında `magazaAdetCoz` / `magazaFiyatCoz` ile okunur. */
  adet: string;
  fiyat: string;
  tedarik: boolean;
  /** Personelin BU oturumda seçtiği (ya da «oranı onayla» ile onayladığı) oran; `null` = dokunmadı (gövdede `kdvOrani` yok). */
  secilenKdv: MagazaKdvOrani | null;
  /** Mevcut teyit kaleminin KAYITLI oranı, kaynağı ve o orana dayanak olan stok kodu; yeni / kopyalanan kalemde `null`. */
  kayitliKdv: { kdvOrani: MagazaKdvOrani; kdvKaynagi: MagazaKdvKaynagi; sku: string } | null;
}

export interface MagazaFormTaslagi {
  musteri: MagazaTalepMusteri;
  not: string;
  kalemler: MagazaKalemTaslagi[];
}

const BOS_MUSTERI: MagazaTalepMusteri = { ad: '', firma: '', telefon: '', eposta: '', il: '', adres: '', vergi: '' };

/** Boş kalem satırı («Kalem ekle»): anahtarsız, işaretsiz, adedi ve fiyatı BOŞ (varsayılan adet uydurulmaz). */
export function bosKalemTaslagi(yerel: number): MagazaKalemTaslagi {
  return { yerel, anahtar: null, id: '', sku: '', ad: '', marka: '', adet: '', fiyat: '', tedarik: false, secilenKdv: null, kayitliKdv: null };
}

/**
 * Müşterinin beyan kalemlerinin KOPYASI (girdi dizisi ve kalemleri değişmez). Satır `b:<dizin>` anahtarını taşır; beyan fiyatı
 * (sitede görülen, KDV hariç) başlangıç fiyatıdır — `null` ise kutu boş kalır («fiyat sorulacak»). Okunamayan adet boş kalır.
 */
export function taslakBeyandan(kalemler: readonly MagazaTalepKalemi[], ilkYerel: number): MagazaKalemTaslagi[] {
  return kalemler.map((k, i) => ({
    yerel: ilkYerel + i,
    anahtar: `b:${i}`,
    id: k.id, sku: k.sku, ad: k.ad, marka: k.marka,
    adet: magazaSayiMetni(Number.isFinite(k.adet) ? k.adet : null),
    fiyat: magazaSayiMetni(k.talepFiyat),
    tedarik: k.tedarik,
    secilenKdv: null,
    kayitliKdv: null,
  }));
}

/** Mevcut teyit kalemlerinin kopyası: kendi `t:` anahtarı, kayıtlı oranı ve kaynağıyla. */
export function taslakTeyitten(kalemler: readonly MagazaTeyitKalemi[], ilkYerel: number): MagazaKalemTaslagi[] {
  return kalemler.map((k, i) => ({
    yerel: ilkYerel + i,
    anahtar: k.anahtar,
    id: k.id, sku: k.sku, ad: k.ad, marka: k.marka,
    adet: magazaSayiMetni(Number.isFinite(k.adet) ? k.adet : null),
    fiyat: magazaSayiMetni(k.birimFiyat),
    tedarik: k.tedarik,
    secilenKdv: null,
    kayitliKdv: { kdvOrani: k.kdvOrani, kdvKaynagi: k.kdvKaynagi, sku: k.sku },
  }));
}

/**
 * Düzenleme formunun İLK hâli (§ 10.4: «ilk açılışta `teyit ?? kalemler`'den kopyalanır»): müşteri ve not saklanan değerle;
 * teyit VARSA kendi kalemleri (`t:` anahtarı, kayıtlı oran ve kaynak), YOKSA müşteri beyanının KOPYASI (`b:<dizin>` anahtarı;
 * beyan fiyatı başlangıç fiyatıdır, oran ürün kaydından). Girdi DEĞİŞMEZ — beyan hiçbir yolda yazılmaz (V16).
 */
export function duzenlemeTaslagi(t: {
  musteri: MagazaTalepMusteri; not: string; kalemler: readonly MagazaTalepKalemi[]; teyit: { kalemler: readonly MagazaTeyitKalemi[] } | null;
}): MagazaFormTaslagi {
  return { musteri: { ...t.musteri }, not: t.not, kalemler: t.teyit === null ? taslakBeyandan(t.kalemler, 1) : taslakTeyitten(t.teyit.kalemler, 1) };
}

/** Elle talep formunun ilk hâli: her şey boş, tek boş kalem satırı. */
export function yeniTalepTaslagi(): MagazaFormTaslagi {
  return { musteri: { ...BOS_MUSTERI }, not: '', kalemler: [bosKalemTaslagi(1)] };
}

/**
 * Satırın önizlemedeki (ve seçicide görünen) KDV oranı ve kaynağı — sunucunun YAZACAĞI değer, sunucuyla BİREBİR aynı kuralla
 * (`src/server/kanal/magazaIcerik.ts` `teyitHazirla`; şartname § 10.2 (a) 3 + inceleme 2b istisnası, bulgu 1 ve 3):
 *   1. personel bu oturumda seçti / onayladı → o oran, `personel` (gövdeye `kdvOrani` girer);
 *   2. mevcut teyit kaleminin (`t:`) KAYITLI oranı ve kaynağı KORUNUR — kaynağı `personel` ise her zaman; `urun` / `varsayilan`
 *      ise stok kodu DEĞİŞMEDİYSE. Ürün kartının oranı arada değişmiş olsa da ürün kaydı ÖNİZLEME İÇİN SORULMAZ: teyit edilen
 *      rakam, ona dokunulmadıkça sabit kalır (yalnız notu düzelten kayıt teyit toplamını değiştirmez). «Varsayılan» kalem, kartı
 *      sonradan eşlense de kendiliğinden ürün oranını ALMAZ — oranı personel seçer ya da onaylar. Kayıtlı `varsayilan` satırda
 *      ürün kaydı yalnız BİLGİ için okunur (`magazaKayitliVarsayilaninKartOrani`: ekran «ürün kaydı şimdi %N» der; oran ve
 *      toplam değişmez);
 *   3. yeni kalem, beyandan kopya (`b:`) ve stok kodu DEĞİŞEN mevcut kalem: `magazaKdvVarsayilani(urunKdvOrani(sku))` — ürün
 *      kaydından; okunamıyorsa 20 + `varsayilan` (ekran im basar).
 * `urunKdvOrani` satırın stok koduyla (baş / son boşluksuz) çağrılır; paket soneki kuralı o işlevin içindedir, burada kırpılmaz.
 * «Stok kodu değişmedi» karşılaştırması da baş / son boşluksuz METİN eşitliğidir (büyük / küçük harf farkı değişikliktir).
 * BİLİNEN SINIR: sunucu aynı karşılaştırmayı kendi temizliğinden SONRA yapar (`kanal/magazaTalep.ts` `kalemEsle`: denetim
 * karakteri ayıklama + 60 birimde kırpma; o modül sunucuya özgüdür, buraya içe aktarılamaz ve kopyalanmadı). Metin kutusuna
 * yazılabilen kodlarda iki karşılaştırma aynı sonucu verir; yalnız 60 birimi aşan ya da denetim karakteri taşıyan kodda
 * ayrışabilir (önizleme yeniden çözer, sunucu kayıtlı oranı korur) — kayıtlı tutar her durumda sunucunundur.
 */
export function magazaTaslakKdv(
  k: Pick<MagazaKalemTaslagi, 'sku' | 'secilenKdv' | 'kayitliKdv'>, urunKdvOrani: (sku: string) => number | undefined,
): { kdvOrani: MagazaKdvOrani; kdvKaynagi: MagazaKdvKaynagi } {
  if (k.secilenKdv !== null) return { kdvOrani: k.secilenKdv, kdvKaynagi: 'personel' };
  const sku = k.sku.trim();
  if (k.kayitliKdv !== null && (k.kayitliKdv.kdvKaynagi === 'personel' || k.kayitliKdv.sku === sku)) {
    return { kdvOrani: k.kayitliKdv.kdvOrani, kdvKaynagi: k.kayitliKdv.kdvKaynagi };
  }
  return magazaKdvVarsayilani(urunKdvOrani(sku));
}

/**
 * KAYITLI «varsayılan» satırda ürün kaydının BUGÜNKÜ oranı — yalnız BİLGİ: önizlemeye ve gövdeye GİRMEZ, `magazaTaslakKdv`
 * kural 2 değişmez (teyit edilen rakam sabit). Satır kayıtlı `varsayilan` oranla duruyorsa (mevcut teyit kalemi, stok kodu
 * aynı, personel bu oturumda seçmedi) ve kart artık okunuyorsa o oran; öbür her durumda `null`. Ekran bunu «ürün kaydı şimdi
 * %N» diye basar: im «teyit yazılırken okunamamıştı» demektir, kart sonradan eşlenmiş olabilir (inceleme 2b, ikinci tur).
 */
export function magazaKayitliVarsayilaninKartOrani(
  k: Pick<MagazaKalemTaslagi, 'sku' | 'secilenKdv' | 'kayitliKdv'>, urunKdvOrani: (sku: string) => number | undefined,
): MagazaKdvOrani | null {
  const sku = k.sku.trim();
  if (k.secilenKdv !== null || k.kayitliKdv === null || k.kayitliKdv.kdvKaynagi !== 'varsayilan' || k.kayitliKdv.sku !== sku) return null;
  const kart = magazaKdvVarsayilani(urunKdvOrani(sku));
  return kart.kdvKaynagi === 'urun' ? kart.kdvOrani : null;
}

export interface MagazaTaslakOnizlemesi extends MagazaTeyitToplami {
  /**
   * `tutar` = üç toplam dolu; `fiyat-sorulacak` = en az bir fiyat boş (üçü de `null` — kısmi toplam basılmaz); `okunamadi` =
   * okunamayan adet / fiyat var (toplam uydurulmaz); `kalem-yok` = satır yok.
   */
  durum: 'tutar' | 'fiyat-sorulacak' | 'okunamadi' | 'kalem-yok';
}

/** Canlı önizleme: kuruş formülü `magazaTeyitToplamlari`'ndadır (kopya formül yok); burada yalnız girdiler okunur. */
export function magazaTaslakOnizlemesi(kalemler: readonly MagazaKalemTaslagi[], urunKdvOrani: (sku: string) => number | undefined): MagazaTaslakOnizlemesi {
  const bos = { araToplam: null, kdv: null, toplam: null };
  if (kalemler.length === 0) return { ...bos, durum: 'kalem-yok' };
  const girdiler: Array<{ adet: number; birimFiyat: number | null; kdvOrani: MagazaKdvOrani }> = [];
  let fiyatsiz = false;
  for (const k of kalemler) {
    const adet = magazaAdetCoz(k.adet), fiyat = magazaFiyatCoz(k.fiyat);
    if (adet.tur !== 'sayi' || fiyat.tur === 'gecersiz') return { ...bos, durum: 'okunamadi' };
    if (fiyat.tur === 'bos') fiyatsiz = true;
    girdiler.push({ adet: adet.deger, birimFiyat: fiyat.tur === 'sayi' ? fiyat.deger : null, kdvOrani: magazaTaslakKdv(k, urunKdvOrani).kdvOrani });
  }
  if (fiyatsiz) return { ...bos, durum: 'fiyat-sorulacak' };
  const t = magazaTeyitToplamlari(girdiler);
  return t.toplam === null ? { ...bos, durum: 'okunamadi' } : { ...t, durum: 'tutar' };
}

// ── Gövde üretimi ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Kalem satırının alan hataları (satırın `yerel` kimliğiyle adreslenir). */
export interface MagazaKalemHatasi { ad?: true; adet?: 'bos' | 'gecersiz'; fiyat?: true }

export interface MagazaFormHatalari {
  /** Müşteri adı boş. */
  ad?: true;
  /** Telefonda 10 rakam yok. */
  telefon?: true;
  /** Not, şemanın ham üst sınırını aşıyor. */
  not?: true;
  /** En az bir kalem gerekli (elle talep; teyidi OLAN talepte bütün kalemler kaldırılamaz — talep iptal edilir). */
  kalemYok?: true;
  kalemler: Record<number, MagazaKalemHatasi>;
}

/** `not` alanının HAM üst sınırı (`schemas.ts` `ErpIcerikGovdesi.not`); aşım 400 olurdu. Temizlik ve 1.000 birime kırpma sunucuda. */
export const MAGAZA_NOT_HAM_SINIRI = 4000;

const hataVar = (h: MagazaFormHatalari): boolean =>
  h.ad === true || h.telefon === true || h.not === true || h.kalemYok === true || Object.keys(h.kalemler).length > 0;

interface CozulmusKalem { k: MagazaKalemTaslagi; adet: number; birimFiyat: number | null }

/** Müşteri + not + kalem satırlarının ortak denetimi; hata yoksa çözülmüş kalemler. */
function taslakDenetle(t: MagazaFormTaslagi): { hatalar: MagazaFormHatalari; kalemler: CozulmusKalem[] } {
  const hatalar: MagazaFormHatalari = { kalemler: {} };
  if (t.musteri.ad.trim() === '') hatalar.ad = true;
  if (!magazaTelefonGecerli(t.musteri.telefon)) hatalar.telefon = true;
  if (t.not.length > MAGAZA_NOT_HAM_SINIRI) hatalar.not = true;
  const kalemler: CozulmusKalem[] = [];
  for (const k of t.kalemler) {
    const h: MagazaKalemHatasi = {};
    if (k.ad.trim() === '') h.ad = true;
    const adet = magazaAdetCoz(k.adet), fiyat = magazaFiyatCoz(k.fiyat);
    if (adet.tur !== 'sayi') h.adet = adet.tur;
    if (fiyat.tur === 'gecersiz') h.fiyat = true;
    if (Object.keys(h).length > 0) { hatalar.kalemler[k.yerel] = h; continue; }
    // Buraya gelen satırda adet sayıdır, fiyat sayı ya da boştur (yukarıdaki iki denetim).
    if (adet.tur === 'sayi') kalemler.push({ k, adet: adet.deger, birimFiyat: fiyat.tur === 'sayi' ? fiyat.deger : null });
  }
  return { hatalar, kalemler };
}

/** Yedi alan — `MAGAZA_MUSTERI_ALANLARI` üzerinden (tipe alan eklenirse derleme sözleşme dosyasında kırılır). HAM metin: temizlik sunucuda. */
function musteriGovdesi(m: MagazaTalepMusteri): MagazaTalepMusteri {
  const out = { ...BOS_MUSTERI };
  for (const a of MAGAZA_MUSTERI_ALANLARI) out[a] = m[a];
  return out;
}

export type MagazaGovdeSonucu<G> = { ok: true; govde: G } | { ok: false; hatalar: MagazaFormHatalari };

/**
 * Düzenleme gövdesi — TAM gövde: `musteri` (yedi alan) ve `not` HER ZAMAN; `teyit` satır varsa (teyidi olmayan talepte form
 * beyan kopyasıyla açıldığı için satır VARDIR — personel hepsini kaldırmadıkça `teyit` gövdededir). `teyitVardi` (talepte teyit
 * zaten yazılı) iken satırsız taslak HATADIR (`kalemYok`): teyit geri alınamaz, bütün kalemleri silmek isteyen talebi iptal eder.
 * Gövdede `kalemler` / `talepEdilen` / toplam / `kdvKaynagi` anahtarı YOKTUR; `kdvOrani` yalnız personel seçtiyse vardır.
 */
export function magazaIcerikGovdesi(t: MagazaFormTaslagi, icerikSurum: number, teyitVardi: boolean): MagazaGovdeSonucu<MagazaIcerikGirdisi> {
  const { hatalar, kalemler } = taslakDenetle(t);
  if (teyitVardi && t.kalemler.length === 0) hatalar.kalemYok = true;
  if (hataVar(hatalar)) return { ok: false, hatalar };
  const govde: MagazaIcerikGirdisi = { icerikSurum, musteri: musteriGovdesi(t.musteri), not: t.not };
  if (kalemler.length > 0) {
    govde.teyit = {
      kalemler: kalemler.map(({ k, adet, birimFiyat }) => ({
        ...(k.anahtar !== null ? { anahtar: k.anahtar } : {}),
        ...(k.id !== '' ? { id: k.id } : {}),
        sku: k.sku, ad: k.ad, marka: k.marka, adet, birimFiyat,
        ...(k.secilenKdv !== null ? { kdvOrani: k.secilenKdv } : {}),
        tedarik: k.tedarik,
      })),
    };
  }
  return { ok: true, govde };
}

/** Elle talep gövdesi: en az bir kalem ZORUNLU; kalemler BEYANDIR (anahtar / KDV oranı yok); toplam gönderilmez. */
export function magazaElleTalepGovdesi(t: MagazaFormTaslagi): MagazaGovdeSonucu<MagazaElleTalepGirdisi> {
  const { hatalar, kalemler } = taslakDenetle(t);
  if (t.kalemler.length === 0) hatalar.kalemYok = true;
  if (hataVar(hatalar)) return { ok: false, hatalar };
  return {
    ok: true,
    govde: {
      musteri: musteriGovdesi(t.musteri),
      not: t.not,
      kalemler: kalemler.map(({ k, adet, birimFiyat }) => ({ ad: k.ad, adet, sku: k.sku, marka: k.marka, birimFiyat, tedarik: k.tedarik })),
    },
  };
}
