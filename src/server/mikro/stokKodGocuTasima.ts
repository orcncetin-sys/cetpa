/**
 * stokKodGocuTasima.ts — stok kodu göçünün UYGULAMA kararları: SAF çekirdek (şartname `.wf/SARTNAME-mikro-baglanti-d-kod.md`
 * D2 / D3 / D4 / D5 + kapı hükümleri DH5, DH7, DH10, DH11, DH14, DH17, DH18, DH19; kullanıcı yanıtları 05.11.2026).
 *
 * GİRDİ / ÇIKTI YOK: veritabanı ve kilit uygulama motorundadır (`stokKodGocuUygula.ts`); bu dosya yalnız karar verir:
 *   • uygulama / geri alma gövdesi (DH16 / DH17),
 *   • onaylı çiftin kuru koşuyla doğrulanması (D4: yalnız kuru koşunun satırları; DH2 / DH14 engelleri; DH7 yalnız referans),
 *   • bağlı belgenin yeni koda taşınması (D3; DH1 tablosunun ALAN YOLLARIYLA — tabloda olmayan alan yazılmaz),
 *   • kalan karta alan katlama (D2 + DH5: yalnız elle girilmiş alan, kalan kartta boşsa),
 *   • alan düzeyinde geri alma kararı (DH11) ve geri alma beyaz listesi (DH10),
 *   • mağaza eş çözümü yardımcısı (DH14; bu dilimde ekran / uç bağlantısı YOK — şartname D3 (b)).
 *
 * Kullanıcı kararları (05.11.2026): yeni kodlu kart (Mikro'nun açtığı ikiz) KALIR, eski kart geri alınabilir biçimde kaldırılır;
 * belirsizde Mikro'daki güncel kod; çalıştıran ops jetonu (`ops-istek.sh`), onay listesi kullanıcıdan.
 */
import { kanonikJson } from './gonderimOzeti.js';
import { BAGLI_KAYIT_TABLOSU, KOD_UZUNLUK_SINIRI, KURU_TABLO_SATIR_SINIRI, depoKimlikParcasi, kodAnahtari, kuruGovdesiniCoz, type BagliKayitTanimi, type GocSatiri, type TabloCifti } from './stokKodGocu.js';
import type { KuruIc } from './stokKodGocuKuru.js';
import { magazaTabanSku } from '../../lib/magazaTalep.js';

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Koleksiyonlar (DH10)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Kod eşleri (D3): `<kiracı8>:<eski kod NFC>` → `{ eski, yeni, kanit, calismaId, tarih, stoGuid, eskiKartlar, kalanKart }`. */
export const ES_KOLEKSIYONU = 'stokKodEsleri';
/** Geri alma kaydı (D4): başlık `<calismaId>`, çift parçaları `<calismaId>~<sıra>`. */
export const KAYIT_KOLEKSIYONU = 'stokKodGocuKayitlari';

/**
 * DH10 · geri almanın YAZABİLDİĞİ koleksiyonlar — kayıtta bunun dışında bir koleksiyon (ör. `users`) varsa geri alma HİÇBİR ŞEY yazmadan
 * reddeder. ŞARTNAMEYE EK: `quotations` — DH1 tablosundaki `quotes`'un gerçek koleksiyonu (`stokKodGocu.ts` BAGLI_KAYIT_TABLOSU notu);
 * uygulama oraya yazdığı için geri alma da yazabilmeli.
 */
export const GERI_ALMA_KOLEKSIYONLARI: ReadonlySet<string> = new Set([
  'inventory', 'orders', 'quotes', 'quotations', 'priceLists', 'inventoryMovements', 'warehouseItems', 'stockDiscrepancies',
  'locationStocks', 'consignments', 'purchaseOrders', 'bom', 'skuMappings', 'shipments', 'vehicles', ES_KOLEKSIYONU,
]);

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Gövdeler (DH16 / DH17)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export interface OnayliCift { eski: string; yeni: string }
export interface UygulaGovdesi {
  planImza: string;
  ciftler: TabloCifti[];
  yokSayilan: { ayniKod: number; tekrar: number };
  onayli: OnayliCift[];
  /** D5: pasif listeye alınacak eski kodlar (karşılıksız + kullanıcının «Hayır» dediği satırlar). */
  pasif: string[];
}
export type GovdeSonucu<T> = { tamam: true; g: T } | { tamam: false; error: string };

const IMZA_BICIMI = /^[0-9a-f]{64}$/;
const DENETIM_KARAKTERI = /[\u0000-\u001F\u007F-\u009F]/;

function kodAlani(v: unknown, yer: string): { kod: string } | { error: string } {
  if (typeof v !== 'string') return { error: `${yer} metin olmalı.` };
  if (DENETIM_KARAKTERI.test(v)) return { error: `${yer} denetim karakteri taşıyor.` };
  const kod = kodAnahtari(v);
  if (!kod) return { error: `${yer} boş.` };
  if (kod.length > KOD_UZUNLUK_SINIRI) return { error: `${yer} ${KOD_UZUNLUK_SINIRI} karakteri aşıyor.` };
  return { kod };
}

/**
 * `POST …/stok-kod-gocu/uygula` gövdesi: `{ planImza, ciftler, onayli, pasif? }` (DH16). `planImza` yoksa ya da biçimsizse 400 (DH17
 * «imzasız istek 400»); imzanın DOĞRULUĞU motorda (409). `ciftler` kuru koşuya giden tablo dosyasıyla AYNIDIR (aynı çözücü).
 * `onayli` / `pasif` en çok 2.000 satır; aynı eski kod iki farklı yeniyle ya da hem onaylı hem pasif → 400. İkisi birden boşsa 400.
 */
export function uygulaGovdesiniCoz(govde: unknown): GovdeSonucu<UygulaGovdesi> {
  if (!govde || typeof govde !== 'object' || Array.isArray(govde)) return { tamam: false, error: 'Gövde bir nesne olmalı: { planImza, ciftler, onayli, pasif? }.' };
  const o = govde as Record<string, unknown>;
  const fazla = Object.keys(o).filter(k => !['planImza', 'ciftler', 'onayli', 'pasif'].includes(k));
  if (fazla.length) return { tamam: false, error: `Tanınmayan alan: ${fazla.slice(0, 5).join(', ')}.` };
  if (typeof o.planImza !== 'string' || !IMZA_BICIMI.test(o.planImza)) {
    return { tamam: false, error: '`planImza` eksik ya da biçimsiz (kuru koşunun 64 haneli imzası).' };
  }
  const tablo = kuruGovdesiniCoz(o.ciftler === undefined ? undefined : { ciftler: o.ciftler });
  if (!tablo.tamam) return { tamam: false, error: tablo.error };

  const onayli: OnayliCift[] = [];
  const onayHaritasi = new Map<string, string>();
  if (o.onayli !== undefined && !Array.isArray(o.onayli)) return { tamam: false, error: '`onayli` bir dizi olmalı.' };
  const hamOnay = (o.onayli ?? []) as unknown[];
  if (hamOnay.length > KURU_TABLO_SATIR_SINIRI) return { tamam: false, error: `\`onayli\` en çok ${KURU_TABLO_SATIR_SINIRI} satır olabilir.` };
  for (const [i, satir] of hamOnay.entries()) {
    const no = i + 1;
    if (!satir || typeof satir !== 'object' || Array.isArray(satir)) return { tamam: false, error: `onayli ${no}. satır bir nesne olmalı.` };
    const s = satir as Record<string, unknown>;
    const fazlaAlan = Object.keys(s).filter(k => k !== 'eski' && k !== 'yeni');
    if (fazlaAlan.length) return { tamam: false, error: `onayli ${no}. satırda tanınmayan alan: ${fazlaAlan.slice(0, 5).join(', ')}.` };
    const e = kodAlani(s.eski, `onayli ${no}. satır \`eski\``);
    if ('error' in e) return { tamam: false, error: e.error };
    const y = kodAlani(s.yeni, `onayli ${no}. satır \`yeni\``);
    if ('error' in y) return { tamam: false, error: y.error };
    if (e.kod === y.kod) return { tamam: false, error: `onayli ${no}. satır: eski ve yeni kod aynı.` };
    const onceki = onayHaritasi.get(e.kod);
    if (onceki !== undefined) {
      if (onceki !== y.kod) return { tamam: false, error: `onayli ${no}. satır: \`${e.kod}\` iki farklı yeni koda onaylanmış.` };
      continue;
    }
    onayHaritasi.set(e.kod, y.kod);
    onayli.push({ eski: e.kod, yeni: y.kod });
  }

  if (o.pasif !== undefined && !Array.isArray(o.pasif)) return { tamam: false, error: '`pasif` bir dizi olmalı.' };
  const hamPasif = (o.pasif ?? []) as unknown[];
  if (hamPasif.length > KURU_TABLO_SATIR_SINIRI) return { tamam: false, error: `\`pasif\` en çok ${KURU_TABLO_SATIR_SINIRI} satır olabilir.` };
  const pasif: string[] = [];
  for (const [i, v] of hamPasif.entries()) {
    const k = kodAlani(v, `pasif ${i + 1}. satır`);
    if ('error' in k) return { tamam: false, error: k.error };
    if (onayHaritasi.has(k.kod)) return { tamam: false, error: `pasif ${i + 1}. satır: \`${k.kod}\` hem onaylı hem pasif listede.` };
    if (!pasif.includes(k.kod)) pasif.push(k.kod);
  }
  if (!onayli.length && !pasif.length) return { tamam: false, error: '`onayli` ve `pasif` ikisi de boş; yapılacak iş yok.' };
  return { tamam: true, g: { planImza: o.planImza, ciftler: tablo.ciftler, yokSayilan: tablo.yokSayilan, onayli, pasif } };
}

/** Çalışma kimliği: `skg-<YYYYMMDDHHmmss>-<6 küçük harf / rakam>` (URL yolunda ve kilit açıklamasında güvenle durur). */
export const CALISMA_KIMLIGI = /^skg-\d{14}-[a-z0-9]{6}$/;

export function geriAlGovdesiniCoz(govde: unknown): GovdeSonucu<{ calismaId: string }> {
  if (!govde || typeof govde !== 'object' || Array.isArray(govde)) return { tamam: false, error: 'Gövde bir nesne olmalı: { calismaId }.' };
  const o = govde as Record<string, unknown>;
  const fazla = Object.keys(o).filter(k => k !== 'calismaId');
  if (fazla.length) return { tamam: false, error: `Tanınmayan alan: ${fazla.slice(0, 5).join(', ')}.` };
  if (typeof o.calismaId !== 'string' || !CALISMA_KIMLIGI.test(o.calismaId)) return { tamam: false, error: '`calismaId` eksik ya da biçimsiz.' };
  return { tamam: true, g: { calismaId: o.calismaId } };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D4 · Onaylı çiftlerin kuru koşuyla doğrulanması
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Onay olsa da UYGULANMAYAN satır gerekçeleri:
 *   • DH2 — Mikro'da eski kodla duran hareket / fiyat listesi / barkod satırı (gece 90 günlük merge yeni kodu eskiye geri çevirirdi)
 *     ve bu sayımın ÖLÇÜLEMEDİĞİ satır (boş sonuç kanıt değil);
 *   • DH14 — mağaza talebi eski kodda (kullanıcı mağaza eşleşmesini yeni koda çevirene kadar kart silinmez).
 * Öbür `dogrula` gerekçeleri (yalnız tablo, zayıf kaynak, çelişen kaynak, ara halka, zincir, harf farkı) kullanıcı onayıyla uygulanır
 * (kullanıcı 05.11.2026: «Mikro'da yeni kod var, eski kod yoksa onay bekleyen 56 da birleşir, liste tek tek»).
 */
export const ENGELLEYEN_GEREKCELER: ReadonlySet<string> = new Set([
  'mikro_hareket_eski_kodda', 'mikro_fiyat_listesi_eski_kodda', 'mikro_barkod_eski_kodda',
  'mikro_olcum_yok_hareket', 'mikro_olcum_yok_fiyat', 'mikro_olcum_yok_barkod',
  'magaza_talebi_eski_kodda',
]);

export type CiftKarari =
  /** D2 + D3: eski kart(lar) kalan karta katlanır ve silinir, bağlı belgeler taşınır, eş yazılır. */
  | { tur: 'tam'; eski: string; yeni: string; satir: GocSatiri; kalanKart: string; eskiKartlar: string[] }
  /** DH7: eski kart yok (önceki çalışma sildi), eş var, bağlı kayıt > 0 → YALNIZ referans adımı. */
  | { tur: 'referans'; eski: string; yeni: string; kalanKart: string | null; eskiKartlar: string[] }
  /** DH7: eski kart yok VE bağlı kayıt 0 → atlanır (ikinci koşu 0 değişiklik). */
  | { tur: 'atla'; eski: string; yeni: string; neden: 'zaten_uygulandi' };

export interface Gecersiz { eski: string; yeni: string | null; neden: string }

/** Kuru koşunun YAZILACAK koleksiyonlardaki (aynalar ve mağaza talebi hariç) bağlı belge sayısı (DH7). */
export function yazilacakBagliSayisi(ic: Pick<KuruIc, 'sayimlar'>, eski: string): number {
  let n = 0;
  for (const c of ic.sayimlar) {
    if (c.yalnizSayilir) continue;
    const ids = c.koduBasina.get(eski);
    if (ids) n += ids.size;
  }
  return n;
}

/**
 * D4: onaylı her çift YENİDEN hesaplanan kuru koşunun satırına karşılanır (istemcinin gönderdiği sınıfa güvenilmez):
 *   • satır karşılıksızsa → geçersiz (pasif listeye konmalı);
 *   • DH2 / DH14 engeli varsa → geçersiz (gerekçesiyle);
 *   • yeni kod kuru koşunun hedefi (ya da hedefsiz satırda Mikro'da VAR olan bir aday) değilse → geçersiz;
 *   • kalan kart yok ya da birden çoksa → geçersiz;
 *   • tam çiftte eski konum belgesinin (`locationStocks`) yeni kimliği doluysa ya da iki eski kart aynı kimliğe düşüyorsa → geçersiz;
 *   • eski kodun kartı yoksa: eşi aynı yeniyi gösteriyorsa DH7 (bağlı kayıt 0 → atla, değilse yalnız referans), göstermiyorsa geçersiz.
 * Pasif kod (D5) kuru koşuda kartı olan bir satır olmalı.
 */
export function onayliDogrula(ic: KuruIc, onayli: readonly OnayliCift[], pasif: readonly string[]): {
  kararlar: CiftKarari[];
  pasifler: Array<{ eski: string; kartlar: string[] }>;
  gecersiz: Gecersiz[];
} {
  const satirlar = new Map(ic.siniflama.satirlar.map(r => [r.eski, r]));
  const kararlar: CiftKarari[] = [];
  const gecersiz: Gecersiz[] = [];
  // Önceki GEÇERLİ tam çiftlerin konum hedefleri: iki eski kod aynı yeni koda gidiyorsa (ortak hedef) ikincisinin konum belgesi
  // birincinin taşıdığı kimliğe düşer; önizleme bunu da göstersin (MKD5 delta, 06.11.2026). Yalnız geçerli sayılan çiftin hedefi eklenir.
  const tumHedefler = new Set<string>();
  for (const { eski, yeni } of onayli) {
    const r = satirlar.get(eski);
    if (!r) {
      if (ic.evren.mikroKumesi.has(eski)) { gecersiz.push({ eski, yeni, neden: 'eski_kod_mikroda' }); continue; }
      const es = ic.esler.get(eski);
      if (!es || es.yeni !== yeni) { gecersiz.push({ eski, yeni, neden: 'kuru_kosuda_yok' }); continue; }
      if (yazilacakBagliSayisi(ic, eski) === 0) { kararlar.push({ tur: 'atla', eski, yeni, neden: 'zaten_uygulandi' }); continue; }
      const kalanlar = ic.evren.kodaGoreKartlar.get(yeni) ?? [];
      const kalanKart = kalanlar.length === 1 ? kalanlar[0].id : es.kalanKart;
      const eskiKartlar = [...(ic.eskiKartlar.get(eski) ?? es.eskiKartlar)];
      kararlar.push({ tur: 'referans', eski, yeni, kalanKart, eskiKartlar });
      continue;
    }
    if (r.sinif === 'karsiliksiz') { gecersiz.push({ eski, yeni, neden: 'karsiliksiz' }); continue; }
    const engel = r.gerekce.find(x => ENGELLEYEN_GEREKCELER.has(x));
    if (engel) { gecersiz.push({ eski, yeni, neden: `engel:${engel}` }); continue; }
    const izinli = r.yeni !== null ? [r.yeni] : r.adaylar.filter(a => a.mikroda).map(a => a.yeni);
    if (!izinli.includes(yeni) || !ic.evren.mikroKumesi.has(yeni)) { gecersiz.push({ eski, yeni, neden: 'yeni_kuru_kosuyla_uyusmuyor' }); continue; }
    const kalanlar = ic.evren.kodaGoreKartlar.get(yeni) ?? [];
    if (kalanlar.length === 0) { gecersiz.push({ eski, yeni, neden: 'kalan_kart_yok' }); continue; }
    if (kalanlar.length > 1) { gecersiz.push({ eski, yeni, neden: 'kalan_kart_birden_cok' }); continue; }
    // Tam çiftte eski konum belgesinin taşınacağı kimlik doluysa (ya da iki eski kart aynı yere düşüyorsa) uygulama çifti hata ile
    // geri çevirir (miktar BİRLEŞTİRİLMEZ) — önizleme bunu önceden göstersin (inceleme turu 06.11.2026, MKD4 dizin 1).
    const eskiSet = new Set(r.kartlar);
    const konumlar = ic.sayimlar.find(s => s.koleksiyon === 'locationStocks')?.koduBasina.get(eski);
    const hedefler = new Set<string>();
    let konumCakismasi = false;
    for (const id of konumlar ?? []) {
      const h = konumKimligiTasi(id, eskiSet, kalanlar[0].id);
      if (h === null) continue;
      if (ic.konumKimlikleri.has(h) || hedefler.has(h) || tumHedefler.has(h)) { konumCakismasi = true; break; }
      hedefler.add(h);
    }
    if (konumCakismasi) { gecersiz.push({ eski, yeni, neden: 'hedef_konum_belgesi_var' }); continue; }
    for (const h of hedefler) tumHedefler.add(h);
    kararlar.push({ tur: 'tam', eski, yeni, satir: r, kalanKart: kalanlar[0].id, eskiKartlar: r.kartlar.slice() });
  }
  const pasifler: Array<{ eski: string; kartlar: string[] }> = [];
  for (const eski of pasif) {
    const r = satirlar.get(eski);
    if (!r) { gecersiz.push({ eski, yeni: null, neden: 'pasif_kart_yok' }); continue; }
    pasifler.push({ eski, kartlar: r.kartlar.slice() });
  }
  return { kararlar, pasifler, gecersiz };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Değişiklik kaydı (DH11) + eşitlik
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Geri alma kaydının belge satırı (DH11):
 *   • `alan` — yalnız değişen ÜST DÜZEY alanlar: `once` (önceki değer), `onceYok` (önceden olmayan alan), `sonra` (yazılan değer);
 *   • `silindi` — silinen belgenin TAM JSON'u (`tam`);
 *   • `olusturuldu` — açılan belgenin TAM JSON'u (`tam`; geri almada yalnız hâlâ aynıysa silinir).
 */
export type BelgeDegisikligi =
  | { coll: string; id: string; tur: 'alan'; once: Record<string, unknown>; onceYok: string[]; sonra: Record<string, unknown> }
  | { coll: string; id: string; tur: 'silindi'; tam: Record<string, unknown> }
  | { coll: string; id: string; tur: 'olusturuldu'; tam: Record<string, unknown> };

/** Kanonik JSON eşitliği (anahtar sırasından bağımsız; PG jsonb gidiş-dönüşü anahtarları yeniden sıralar). */
export const esit = (a: unknown, b: unknown): boolean => kanonikJson(a) === kanonikJson(b);
const kendiAlani = (o: Readonly<Record<string, unknown>>, a: string): boolean => Object.prototype.hasOwnProperty.call(o, a);

export function alanDegisikligi(coll: string, id: string, once: Readonly<Record<string, unknown>>, sonra: Readonly<Record<string, unknown>>, alanlar: Iterable<string>): BelgeDegisikligi {
  const o: Record<string, unknown> = {}, s: Record<string, unknown> = {}, yok: string[] = [];
  for (const a of [...new Set(alanlar)].sort()) {
    if (kendiAlani(once, a)) o[a] = once[a]; else yok.push(a);
    s[a] = sonra[a];
  }
  return { coll, id, tur: 'alan', once: o, onceYok: yok, sonra: s };
}

/** Etiketsiz belge (DH19): `companyId` yok ya da boş. Yabancı kiracı: dolu ve çalışma kiracısından farklı (CLAUDE.md deseni). */
export const etiketsizMi = (v: Readonly<Record<string, unknown>>): boolean => typeof v.companyId !== 'string' || v.companyId === '';
export const yabanciMi = (v: Readonly<Record<string, unknown>>, cid: string): boolean => !etiketsizMi(v) && v.companyId !== cid;

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D3 · bağlı belgenin yeni koda taşınması (DH1 alan yolları)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** `a.b[].c` yolundaki her değeri `donustur` ile değiştirir (YERİNDE — çağıran kopyayı verir). Değişen değer sayısı döner. */
function yolDonustur(kok: Record<string, unknown>, yol: string, donustur: (v: unknown) => { yeni: unknown } | null): number {
  const parcalar = yol.split('.');
  let say = 0;
  const in_ = (dugum: unknown, i: number): void => {
    if (!dugum || typeof dugum !== 'object' || Array.isArray(dugum)) return;
    const o = dugum as Record<string, unknown>;
    const parca = parcalar[i];
    const dizi = parca.endsWith('[]');
    const ad = dizi ? parca.slice(0, -2) : parca;
    if (!kendiAlani(o, ad)) return;
    const son = i === parcalar.length - 1;
    if (dizi) {
      const v = o[ad];
      if (!Array.isArray(v)) return;
      for (let j = 0; j < v.length; j++) {
        if (!son) { in_(v[j], i + 1); continue; }
        const r = donustur(v[j]);
        if (r) { v[j] = r.yeni; say++; }
      }
      return;
    }
    if (!son) { in_(o[ad], i + 1); return; }
    const r = donustur(o[ad]);
    if (r) { o[ad] = r.yeni; say++; }
  };
  in_(kok, 0);
  return say;
}
const ustAlan = (yol: string): string => yol.split('.')[0].replace(/\[\]$/, '');

export interface TasimaBaglami {
  eski: string;
  /** Yazılan değer: kalan kartın sku'su (Mikro'nun döndürdüğü dizgi; DH15). */
  yeni: string;
  eskiKartlar: ReadonlySet<string>;
  kalanKart: string | null;
  companyId: string;
}

/**
 * D3: belgenin DH1 tablosundaki alan yollarında eski kodu (DH15 `kodAnahtari` ile — U+200E'li, NFD `İ`'li yazım da) yeni koda,
 * eski kart kimliğini kalan kart kimliğine çevirir. YALNIZ bu değerler değişir (sipariş kaleminin adı, tutarı, KDV'si, `updatedAt`
 * DOKUNULMAZ — MF `kalemYenile` kullanılmaz). Etiketsiz belgeye `companyId` yazılır (DH19). Değişiklik yoksa `null`.
 */
export function belgeyiTasi(t: Pick<BagliKayitTanimi, 'alanlar'>, veri: Readonly<Record<string, unknown>>, b: TasimaBaglami): { veri: Record<string, unknown>; alanlar: string[]; deger: number } | null {
  const kopya = structuredClone(veri) as Record<string, unknown>;
  const alanlar = new Set<string>();
  let deger = 0;
  for (const a of t.alanlar) {
    const n = yolDonustur(kopya, a.yol, v => {
      if (a.tur === 'kartKimligi') return typeof v === 'string' && b.kalanKart !== null && v !== b.kalanKart && b.eskiKartlar.has(v) ? { yeni: b.kalanKart } : null;
      return kodAnahtari(v) === b.eski ? { yeni: b.yeni } : null;
    });
    if (n) { alanlar.add(ustAlan(a.yol)); deger += n; }
  }
  if (!deger) return null;
  if (etiketsizMi(kopya)) { kopya.companyId = b.companyId; alanlar.add('companyId'); }
  return { veri: kopya, alanlar: [...alanlar].sort(), deger };
}

/** Uygulamanın YAZDIĞI bağlı koleksiyonlar (DH1 tablosu; aynalar ve mağaza talebi yalnız sayılır, alanı olmayanlar okunmaz). */
export const YAZILAN_TANIMLAR: readonly BagliKayitTanimi[] = BAGLI_KAYIT_TABLOSU.filter(t => !t.yalnizSayilir && t.alanlar.length > 0);

/**
 * `inventoryMovements` satırı yeni koda yazılır mı (D3 + DH2). Mikro satırı (kimlik = `sth_Guid`):
 *   • Mikro'da aynı GUID'le duruyorsa YALNIZ Mikro'nun güncel kodu yeni kodsa (Mikro'yla tutarlı; tam pencere importu da aynısını yazar);
 *   • yetimse (GUID Mikro'da yok) YALNIZ aynı evrak Mikro'da yeni GUID'le YOKSA (`false`); var ya da ölçülemediyse yazılmaz, listelenir.
 * Elle hareket (kimlik GUID değil) her zaman yazılır.
 */
export function hareketYazilirMi(guid: string, mikroKodu: ReadonlyMap<string, string> | null, yetimEvrakEsi: ReadonlyMap<string, boolean | null>, id: string, yeni: string): string | null {
  if (!guid) return null;
  if (mikroKodu === null) return 'mikro_hareketleri_okunamadi';
  const mk = mikroKodu.get(guid);
  if (mk !== undefined) return mk === yeni ? null : 'mikro_kodu_farkli';
  const es = yetimEvrakEsi.get(id);
  if (es === false) return null;
  return es === true ? 'yetim_evrak_esi_mikroda' : 'yetim_evrak_esi_olculmedi';
}

/**
 * DH18 değişmezi: iki FARKLI kod `/` `\` → `_` dönüşümünden sonra aynı warehouseItems kimlik parçasına düşüyorsa o parçalar döner
 * (o kodların depo belgesi SİLİNMEZ, listelenir — `YTONG-60*25*10 PL/48` gibi 5 eski kod `/` taşıyor).
 */
export function depoKimlikCakismalari(kodlar: Iterable<string>): Set<string> {
  const parcaKod = new Map<string, Set<string>>();
  for (const k of kodlar) {
    const p = depoKimlikParcasi(k);
    const s = parcaKod.get(p);
    if (s) s.add(k); else parcaKod.set(p, new Set([k]));
  }
  return new Set([...parcaKod].filter(([, s]) => s.size > 1).map(([p]) => p));
}

/** `locationStocks` kimliği `<tür>__<yer>__<productId>` (server.ts `locId`): eski kart kimliğiyle bitiyorsa kalan kartla yeni kimlik. */
export function konumKimligiTasi(id: string, eskiKartlar: ReadonlySet<string>, kalanKart: string | null): string | null {
  if (kalanKart === null) return null;
  for (const eski of eskiKartlar) if (id.endsWith(`__${eski}`) && id.length > eski.length + 2) return `${id.slice(0, id.length - eski.length)}${kalanKart}`;
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D2 + DH5 · kalan karta alan katlama
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * DH5 tablosu — eski karttan kalan karta YALNIZ bu alanlar katlanır, o da yalnız onu ELLE yazan bir ekran varsa (`elleYazan`,
 * 05.11.2026 `972b243` ağacında ölçüldü). Hiçbir ekranın yazmadığı alan «elle girilmiş» sayılmaz → katlanmaz, eski kartta doluysa
 * rapora yazılır.
 *   • `lowStockThreshold`: ProductForm.tsx:308 (giriş) → :97 (`updateDoc`); InventoryView.tsx:536 (CSV içe aktarma). Kural `esik`:
 *     kalan kartta 5 (import varsayılanı: eslemeStok.ts:174, crons.ts:259) ya da boşsa ve eski kartta 5'ten farklıysa eski değer.
 *   • `notes`: InventoryView.tsx:1131 (ürün notu düzenleyicisi). Kural `bossa`.
 *   • `location` (raf konumu) ve `warehouseId` (depo) — Y29 son inceleme bulgu 3 (06.11.2026): ProductForm.tsx:278 / :264 (giriş) →
 *     :97 (`updateDoc(doc(db,'inventory',id), { ...formData })`); `location` DataImportWizard.tsx:327, `warehouseId` InventoryView.tsx:544
 *     (CSV içe aktarma) da yazar. Mikro'dan türemez (eslemeStok.ts'te geçmez; mikroRoutes'taki `warehouseId` / `location` yazımı
 *     `warehouseItems` / `warehouses` koleksiyonuna). Eskiden listede yoktu: eski kart silinince değer yalnız geri alma JSON'unda
 *     kalıyor, hiçbir raporda görünmüyordu. Kural `bossa`; kalan kartta dolu ve farklıysa `kalan_dolu` raporu (şartname DH5 tablosu
 *     bu iki alanı anmıyor: şartname boşluğu, raporda).
 *   • `description`, `image`, `images`, `imageUrl`, `photo` (şartnamenin «açıklama, görsel» alanları): `inventory`'ye YAZAN ekran YOK
 *     (grep: yalnız okuyan EnvanterRapor.tsx:3544) → `elleYazan: null`.
 */
export interface KatlananAlan { alan: string; kural: 'bossa' | 'esik'; elleYazan: string | null }
export const KATLANAN_ALANLAR: readonly KatlananAlan[] = [
  { alan: 'lowStockThreshold', kural: 'esik', elleYazan: 'ProductForm.tsx:308 / :97, InventoryView.tsx:536' },
  { alan: 'notes', kural: 'bossa', elleYazan: 'InventoryView.tsx:1131' },
  { alan: 'location', kural: 'bossa', elleYazan: 'ProductForm.tsx:278 / :97, DataImportWizard.tsx:327' },
  { alan: 'warehouseId', kural: 'bossa', elleYazan: 'ProductForm.tsx:264 / :97, InventoryView.tsx:544' },
  { alan: 'description', kural: 'bossa', elleYazan: null },
  { alan: 'image', kural: 'bossa', elleYazan: null },
  { alan: 'images', kural: 'bossa', elleYazan: null },
  { alan: 'imageUrl', kural: 'bossa', elleYazan: null },
  { alan: 'photo', kural: 'bossa', elleYazan: null },
];
/**
 * DH5 · TAŞINMAYAN (Mikro'dan türeyen) alanlar — kalan karttan değişmez (Girilen ≠ türetilen): `costPrice` (eslemeStok.ts:267,
 * mikroRoutes.ts:4243), `barcode` (mikroRoutes.ts:3488), `prices` / `price` (kökeni ayırt edilemez; kademe farkı kuru koşuda), `stockLevel`,
 * `vatRate`, `unit`, `name`, `mikroStoKod`, `source`. `KATLANAN_ALANLAR` ile kesişmez (test).
 */
export const TASINMAYAN_ALANLAR: readonly string[] = ['costPrice', 'barcode', 'prices', 'price', 'stockLevel', 'vatRate', 'unit', 'name', 'mikroStoKod', 'source'];
export const IMPORT_ESIK_VARSAYILANI = 5;

export interface KatlamaRaporu { alan: string; eskiKart: string; neden: 'yazan_ekran_yok' | 'kalan_dolu' }

const bosMu = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** Y29 bulgu 3 · canlı plan ölçüsü (kuru koşu `eskiKartElleAlan`): kartlardan `alan`ı DOLU olanların SAYISI. Boşluk tanımı
 *  `kartAlanlariniKatla` ile aynı (`bosMu`); değer yanıta çıkmaz. Bulunamayan kart (`undefined`) sayılmaz. */
export function doluAlanSay(kartlar: Iterable<Readonly<Record<string, unknown>> | undefined>, alan: string): number {
  let n = 0;
  for (const k of kartlar) if (k && !bosMu(k[alan])) n++;
  return n;
}

/**
 * D2: eski kart(lar)dan kalan karta katlanacak alanlar (`yama`) ve katlanmayan dolu alanlar (`rapor`). `eskiler` ÖNCELİK sırasıyla
 * gelir — çağıran en yeni `updatedAt`'i başa koyar (D2 «alan çakışmasında en yeni updatedAt kazanır»); sonraki farklı değer çakışma
 * olarak rapora girer. Ortak hedefte (birden çok eski kod → aynı yeni) çiftler sırayla işlenir: ikinci çift kalan kartı dolu görür.
 */
export function kartAlanlariniKatla(kalan: Readonly<Record<string, unknown>>, eskiler: ReadonlyArray<{ id: string; veri: Readonly<Record<string, unknown>> }>): { yama: Record<string, unknown>; rapor: KatlamaRaporu[] } {
  const yama: Record<string, unknown> = {};
  const rapor: KatlamaRaporu[] = [];
  for (const f of KATLANAN_ALANLAR) {
    let simdiki: unknown = kalan[f.alan];
    let yamandi = false;
    for (const e of eskiler) {
      const ov = e.veri[f.alan];
      if (f.kural === 'esik') {
        if (typeof ov !== 'number' || !Number.isFinite(ov) || ov === IMPORT_ESIK_VARSAYILANI) continue;
        if (!f.elleYazan) { rapor.push({ alan: f.alan, eskiKart: e.id, neden: 'yazan_ekran_yok' }); continue; }
        if (!yamandi && (bosMu(simdiki) || simdiki === IMPORT_ESIK_VARSAYILANI)) { yama[f.alan] = ov; simdiki = ov; yamandi = true; continue; }
        if (ov !== simdiki) rapor.push({ alan: f.alan, eskiKart: e.id, neden: 'kalan_dolu' });
        continue;
      }
      if (bosMu(ov)) continue;
      if (!f.elleYazan) { rapor.push({ alan: f.alan, eskiKart: e.id, neden: 'yazan_ekran_yok' }); continue; }
      if (bosMu(simdiki)) { yama[f.alan] = structuredClone(ov); simdiki = ov; continue; }
      if (!esit(ov, simdiki)) rapor.push({ alan: f.alan, eskiKart: e.id, neden: 'kalan_dolu' });
    }
  }
  return { yama, rapor };
}

/** `updatedAt` (ISO metin, sayı ya da `{ seconds | _seconds }`) → ms; okunamazsa `docs.updated_at` sütunu; o da yoksa `null`. */
export function zamanMs(v: unknown, sutun?: unknown): number | null {
  if (typeof v === 'string') { const t = Date.parse(v); if (Number.isFinite(t)) return t; }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const sn = typeof o.seconds === 'number' ? o.seconds : typeof o._seconds === 'number' ? o._seconds : null;
    if (sn !== null && Number.isFinite(sn)) return sn * 1000;
  }
  if (sutun instanceof Date) return Number.isFinite(sutun.getTime()) ? sutun.getTime() : null;
  if (typeof sutun === 'string') { const t = Date.parse(sutun); if (Number.isFinite(t)) return t; }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DH11 · alan düzeyinde geri alma kararı
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type GeriAlmaKarari =
  | { islem: 'guncelle'; veri: Record<string, unknown>; atlananAlanlar: string[] }
  | { islem: 'ekle'; veri: Record<string, unknown> }
  | { islem: 'sil' }
  | { islem: 'atla'; neden: string; atlananAlanlar?: string[] };

/**
 * DH11: alan YALNIZ mevcut değeri `sonra`'ya eşitse `once`'ye döner (önceden yoksa silinir); eşit değilse atlanır ve listelenir —
 * geri almadan önce yapılmış yeni değişiklik ezilmez. Kalan kartta yalnız katlanan alanlar kayıtlıdır: `stockLevel`'a dokunulmaz.
 * Silinen belge o kimlikte belge YOKSA geri yazılır; açılan belge yalnız HÂLÂ aynıysa silinir.
 */
export function geriAlmaKarari(d: BelgeDegisikligi, mevcut: Readonly<Record<string, unknown>> | null): GeriAlmaKarari {
  if (d.tur === 'silindi') return mevcut === null ? { islem: 'ekle', veri: structuredClone(d.tam) } : { islem: 'atla', neden: 'kimlikte_belge_var' };
  if (d.tur === 'olusturuldu') {
    if (mevcut === null) return { islem: 'atla', neden: 'belge_yok' };
    return esit(mevcut, d.tam) ? { islem: 'sil' } : { islem: 'atla', neden: 'sonradan_degisti' };
  }
  if (mevcut === null) return { islem: 'atla', neden: 'belge_yok' };
  const veri = structuredClone(mevcut) as Record<string, unknown>;
  const atlanan: string[] = [];
  let degisen = 0;
  for (const a of Object.keys(d.sonra).sort()) {
    if (!kendiAlani(mevcut, a) || !esit(mevcut[a], d.sonra[a])) { atlanan.push(a); continue; }
    if (d.onceYok.includes(a)) delete veri[a]; else veri[a] = structuredClone(d.once[a]);
    degisen++;
  }
  if (!degisen) return { islem: 'atla', neden: 'sonradan_degisti', atlananAlanlar: atlanan };
  return { islem: 'guncelle', veri, atlananAlanlar: atlanan };
}

/**
 * DH10: kayıttaki her belge satırının geri alınabilirliği — koleksiyon beyaz listede ve kayıttaki görüntülerin `companyId`'si çalışma
 * kiracısı ya da boş (etiketsiz; DH19 — uygulama etiketsiz belgeye `companyId` yazdığı için tam geri dönüş onu yeniden siler). Bir satır
 * bile tutmazsa geri alma HİÇBİR ŞEY yazmadan reddeder (çağıran). Neden metni döner, sorun yoksa `null`.
 */
export function geriAlmaSatiriReddi(d: BelgeDegisikligi, cid: string): string | null {
  if (!GERI_ALMA_KOLEKSIYONLARI.has(d.coll)) return `koleksiyon beyaz listede değil: ${d.coll}`;
  if (typeof d.id !== 'string' || d.id === '') return `belge kimliği yok (${d.coll})`;
  const goruntuler = d.tur === 'alan' ? [d.once, d.sonra] : [d.tam];
  for (const g of goruntuler) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return `bozuk görüntü: ${d.coll}/${d.id}`;
    if (kendiAlani(g, 'companyId') && g.companyId !== cid && g.companyId !== '' && g.companyId !== null) return `yabancı kiracı belgesi: ${d.coll}/${d.id}`;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DH14 · mağaza eş çözümü (yardımcı; bu dilimde ekran / uç bağlantısı YOK)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** DYO renk varyantı → Mikro baz kartı: ilk 4 parça (`DYO-205-0001-45-7233` → `DYO-205-0001-45`; bellek `ikas-mikro-eslestirme` kural 2). */
const RENK_BAZ_PARCA = 4;

/**
 * Bulunamayan mağaza / sipariş kalemi sku'sunun TEK ADIM eş çözümü (DH14; şartname D3 `stokKodEsleri` okuyucusu (b)). Sıra sabittir:
 *   1. `kodAnahtari`  2. `-Dnnn` paket son eki ayrılır  3. eş çözümü  4. eş yoksa renk → baz (ilk 4 parça) ve yeniden eş çözümü
 *   5. son ek geri eklenir.
 * Renk → baz yolunda dönen kod BAZ KARTIN yeni kodudur (Mikro'da renk başına kart yok); renk parçası yeni koda EKLENMEZ — eklemek var
 * olmayan bir kod uydururdu. Eş zinciri izlenmez (eşin yenisi başka bir eşin eskisi olsa da tek adım). Bulunamazsa `null`.
 */
export function esCozumu(sku: unknown, esler: ReadonlyMap<string, string>): { kod: string; yol: 'es' | 'baz_es' } | null {
  const k = kodAnahtari(sku);
  if (!k) return null;
  const taban = magazaTabanSku(k);
  const govde = taban ?? k;
  const sonek = taban === null ? '' : k.slice(taban.length);
  const dogrudan = esler.get(govde);
  if (dogrudan !== undefined) return { kod: dogrudan + sonek, yol: 'es' };
  const parcalar = govde.split('-');
  if (parcalar.length <= RENK_BAZ_PARCA) return null;
  const baz = esler.get(parcalar.slice(0, RENK_BAZ_PARCA).join('-'));
  return baz === undefined ? null : { kod: baz + sonek, yol: 'baz_es' };
}
