/**
 * stokFiyat.ts — Fiyat Karşılaştırma raporunun HESABI, tek kaynak (2026-09-18). Test: stokFiyat.test.ts (ÖNCE yazıldı).
 * Hem sunucu (src/server/routes/reportsRoutes.ts) hem test aynı saf fonksiyonları kullanır.
 *
 * NEDEN VAR — kullanıcı bildirimi (2026-09-18): "Fatura altı iskontoları ortalama alım fiyatına dahil edilmiyor,
 * hatalı fiyat geliyor." Rapor `SUM(sth_tutar) / SUM(sth_miktar)` kullanıyordu ve hiçbir iskontoyu düşmüyordu;
 * iskontolu alımda ortalama alış fiyatı olduğundan YÜKSEK, marj olduğundan DÜŞÜK görünüyordu (kullanıcının örneği:
 * NOVA-350-11304, evrak 48 — 100 × ₺22,40). Mikro'nun belgelenen düzeni: `sth_tutar` brüt satır tutarı, satır ve
 * satıra dağıtılmış fatura altı iskontoları `sth_iskonto1…N` TUTAR alanlarında — ama bu kurulumda teyit edilemediği
 * için hesap buna KÖRÜ KÖRÜNE güvenmez (bkz. aşağıda "NET NASIL BELİRLENİR").
 *
 * KOLON ADI TAHMİNİ YOK (CLAUDE.md): `/api/mikro/import/stok-hareket` aynası `SELECT *` ile iner, yani ayna
 * dokümanında Mikro şemasında GERÇEKTEN var olan her `sth_` kolonu bulunur. İskonto alanları dokümanın KENDİ
 * anahtarlarından, katı aile deseniyle (`^sth_iskonto<rakam>$`) okunur; gevşek `/iskonto/` deseni bilerek
 * kullanılmaz (`sth_isk_mas*` bayrakları, açıklama alanları tutar değildir — `sfiyat_Guid` arıza sınıfı).
 * Bulunan kolonlar `iskontoKolonlari` ile rapora yazılır: liste BOŞSA aynada iskonto kolonu yoktur ve ekran bunu
 * söyler (sessizce brüt fiyat basmaz).
 *
 * İKİNCİ ARIZA (aynı döngüde): `Number(m.sth_tutar) || 0` tutarı bilinmeyen satırı ₺0 tutarla ama GERÇEK miktarla
 * ortalamaya sokup fiyatı aşağı çekiyordu. Artık tutarı/miktarı bilinmeyen satır ortalamaya GİRMEZ, SAYILIR
 * (`bilinmeyenSatir`). Bedelsiz satır (tutar 0) gerçek sıfırdır ve girer.
 *
 * BİLİNÇLİ KORUNANLAR (eski davranış): yön `sth_tip === 0` alış, diğerleri satış; eksi miktar/tutar mutlak değere
 * çevrilir; `sth_masraf*` (nakliye vb. masraf payı) fiyata EKLENMEZ — kullanıcı yalnız iskontoyu istedi, masrafın
 * alış maliyetine girip girmeyeceği ayrı bir iş kararı.
 *
 * NET NASIL BELİRLENİR — VERİ KARAR VERİR (2026-09-18 inceleme turu). İki bağımsız inceleme aynı riski buldu:
 * `sth_tutar`ın brüt mü net mi olduğu ve fatura altı iskontosunun satıra dağıtılıp dağıtılmadığı bu kurulumda
 * canlı veriyle teyit EDİLEMEDİ (lokalde Mikro verisi yok); yanlış varsayım iskontoyu ÇİFT düşerdi ya da hiç
 * düşmezdi. Bu yüzden net, satırın KENDİ KDV'siyle (`sth_vergi`) sağlanır — KDV her zaman gerçek matrah üzerinden
 * hesaplanır, dolayısıyla hangi adayın gerçek matrah olduğunu ele verir:
 *   1. KDV, (brüt − Σiskonto) [± masraf] üzerinden geçerli bir orana oturuyorsa → net = brüt − Σiskonto  ('satirIskontosu' / 'iskontosuz')
 *   2. KDV, sth_tutar'ın kendisine oturuyor ve iskonto alanı doluysa → sth_tutar ZATEN net, tekrar düşülmez ('tutarZatenNet')
 *   3. Hiçbiri oturmuyor ama geçerli bir oranla KDV/oran ≤ (brüt − Σiskonto) tek bir makul matrah veriyorsa → satıra
 *      yazılmamış (yalnız fatura başlığındaki) FATURA ALTI iskonto vardır; net = KDV / oran  ('faturaAltiKdvden')
 *   4. KDV yok/bilinmiyor ya da belirsiz → belgelenmiş Mikro davranışı (brüt − Σiskonto) uygulanır ve satır
 *      'dogrulanamadi' diye İŞARETLENİR; rapor bu sayıları `netKaynaklari` ile ekrana verir.
 *   5. FATURA BAŞLIĞI HAKEMDİR: 3 ve 4 tek satırdan ayırt edilemeyen durumlar içerir ("%18 KDV iskontosuz" ≡ "%20 KDV +
 *      %10 fatura altı"). Evrakın başlığı (`mikroFaturalar`.cha_meblag) eldeyse bu satırlar başlık toplamıyla çözülür:
 *      meblağ satırları tutuyorsa iskonto yoktur, daha küçükse fark fatura altı iskontodur ('faturaAltiBasliktan').
 * Geçerli KDV oranları tarihe bağlıdır (2023-07-10: %18→%20, %8→%10); tarih yoksa hepsi denenir. `sth_vergi_pntr`
 * yalnız belirsizlikte hakem olarak kullanılır (uygulamanın zaten kullandığı 1→%0, 2→%1, 3→%10, 4→%20 eşlemesi).
 * Canlı teyit için ayrıca `GET /api/mikro/sema-kesif` → `sthIskontoKolonlari`, `iskontoluAlisSatirOrnegi`,
 * `iskontoluAlisBaslikOrnegi`; ekranda detay tablosu Brüt / İskonto / Net ve kaynağını basar.
 */
import { bilinenSayi } from '../utils/para.js';

/** Ayna dokümanı — STOK_HAREKETLERI satırının tüm kolonları (SELECT *). */
export type StokHareketi = Readonly<Record<string, unknown>>;

const ISKONTO_KOLONU = /^sth_iskonto\d+$/i;
const MASRAF_KOLONU = /^sth_masraf\d+$/i;

/** Net tutarın hangi yolla belirlendiği (ekranda ve raporda görünür). */
export type NetKaynagi = 'iskontosuz' | 'satirIskontosu' | 'tutarZatenNet' | 'faturaAltiKdvden' | 'faturaAltiBasliktan' | 'dogrulanamadi';

export type SatirNet =
  | { durum: 'tamam'; miktar: number; brut: number; iskonto: number; net: number; birimFiyat: number; iskontoKolonlari: string[]; kaynak: NetKaynagi }
  | { durum: 'tutarBilinmiyor' | 'miktarBilinmiyor' | 'miktarSifir' | 'iskontoTutarsiz'; miktar: number | null };

const iptalMi = (h: StokHareketi): boolean => h.sth_iptal === true || (bilinenSayi(h.sth_iptal) && Number(h.sth_iptal) === 1);
const skuOku = (h: StokHareketi): string => String(h.sth_stok_kod ?? '').trim();
const yonOku = (h: StokHareketi): 'alis' | 'satis' => (Number(h.sth_tip) === 0 ? 'alis' : 'satis');

/** Satıra düşen masraf payı (Σ sth_masraf<N>) — fatura sağlamasında kullanılır; alış fiyatına EKLENMEZ. */
export const satirMasrafi = (h: StokHareketi): number => aileToplami(h, MASRAF_KOLONU).toplam;

/** Dokümanda bulunan kolon ailesinin (iskonto / masraf) bilinen değerlerinin mutlak toplamı + kolon adları. */
function aileToplami(h: StokHareketi, desen: RegExp): { toplam: number; kolonlar: string[] } {
  let toplam = 0;
  const kolonlar: string[] = [];
  for (const [k, v] of Object.entries(h)) {
    if (!desen.test(k)) continue;
    if (!bilinenSayi(v)) continue;          // boş/null alan = yok
    kolonlar.push(k.toLowerCase());
    toplam += Math.abs(Number(v));
  }
  return { toplam, kolonlar: kolonlar.sort() };
}

/**
 * KDV oran geçişi: 10 Temmuz 2023'te %18→%20 ve %8→%10. Tarih çözülemezse iki küme birden denenir. Geçişi izleyen
 * dönemde (2023 sonuna kadar) eski oranla kesilmiş iade/düzeltme satırları olağandır: o pencerede iki küme de geçerli
 * sayılır — aksi hâlde "KDV %18, iskonto yok" satırı "KDV %20 + %10 fatura altı iskonto" diye yanlış okunurdu.
 */
const ORAN_GECISI = '2023-07-10';
const GECIS_SONU = '2024-01-01';
function gecerliOranlar(tarih: unknown): readonly number[] {
  const t = typeof tarih === 'string' ? tarih.slice(0, 10) : tarih instanceof Date && Number.isFinite(tarih.getTime()) ? tarih.toISOString().slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return [20, 18, 10, 8, 1];
  if (t < ORAN_GECISI) return [18, 8, 1];
  return t < GECIS_SONU ? [20, 18, 10, 8, 1] : [20, 10, 1];
}
/** Uygulamanın fatura ekranlarında zaten kullandığı işaretçi→oran eşlemesi (hooks/useMikroFaturalar VERGI_PNTR_ORAN). */
const PNTR_ORAN: Readonly<Record<string, number>> = { '1': 0, '2': 1, '3': 10, '4': 20 };

/**
 * Kuruş yuvarlaması + kayan nokta payı. SIKI tutulur (on binde 5): gevşek pay (%0,4) küçük iskontoda "tutar zaten net"
 * ile "iskonto düşüldü"yü ayırt edemiyordu — 10.000'lik satırda 40 ₺'ye kadar iskonto yanlış tarafa düşüyordu (hakem).
 */
const tol = (x: number): number => Math.max(0.06, Math.abs(x) * 0.0005);

/** Net tutarın hangi yolla belirlendiği (ekranda ve raporda görünür). */
type TutarCozumu =
  | { ok: true; tutar: number; isk: number; mas: number; vergi: number; brut: number; net: number; kaynak: NetKaynagi; kdvDogrulandi: boolean; iskontoKolonlari: string[] }
  | { ok: false; neden: 'tutarBilinmiyor' | 'iskontoTutarsiz' };

/** Satırın TUTAR çözümü — miktardan bağımsız (miktarı 0 olan fiyat farkı satırı da fatura sağlamasına girer). */
function tutarCoz(h: StokHareketi): TutarCozumu {
  if (!bilinenSayi(h.sth_tutar)) return { ok: false, neden: 'tutarBilinmiyor' };
  const tutar = Math.abs(Number(h.sth_tutar));
  const { toplam: isk, kolonlar } = aileToplami(h, ISKONTO_KOLONU);
  const { toplam: mas } = aileToplami(h, MASRAF_KOLONU);
  if (isk > tutar + tol(tutar)) return { ok: false, neden: 'iskontoTutarsiz' };
  const a = Math.max(0, tutar - isk);                       // belgelenmiş Mikro davranışı: brüt − Σiskonto
  const vergi = bilinenSayi(h.sth_vergi) ? Math.abs(Number(h.sth_vergi)) : NaN;
  const sonuc = (brut: number, net: number, kaynak: NetKaynagi, kdvDogrulandi: boolean): TutarCozumu =>
    ({ ok: true, tutar, isk, mas, vergi, brut, net, kaynak, kdvDogrulandi, iskontoKolonlari: kolonlar });
  if (!(vergi > 0)) return sonuc(tutar, a, 'dogrulanamadi', false);      // KDV'siz ya da KDV'si bilinmeyen satır sağlanamaz

  const oranlar = gecerliOranlar(h.sth_tarih);
  /** Matrah adayının KDV'ye en iyi oturan geçerli orandaki artığı; tolerans dışındaysa Infinity. */
  const artik = (matrah: number): number => {
    if (!(matrah > 0)) return Infinity;
    const enIyi = Math.min(...oranlar.map(r => Math.abs(vergi - (matrah * r) / 100)));
    return enIyi <= tol(vergi) ? enIyi : Infinity;
  };
  const artikA = Math.min(artik(a), mas > 0 ? artik(a + mas) : Infinity);
  const artikT = isk > 0 ? Math.min(artik(tutar), mas > 0 ? artik(tutar + mas) : Infinity) : Infinity;
  // İkisi de oturuyorsa ARTIĞI KÜÇÜK olan kazanır; eşitlikte belgelenmiş davranış (brüt − iskonto).
  if (artikA !== Infinity && artikA <= artikT) return sonuc(tutar, a, isk > 0 ? 'satirIskontosu' : 'iskontosuz', true);
  if (artikT !== Infinity) return sonuc(tutar + isk, tutar, 'tutarZatenNet', true);

  // Satıra yazılmamış fatura altı iskonto: KDV / oran, (brüt − Σiskonto)'nun ALTINDA tek bir makul matrah vermeli.
  // BİLİNEN SINIR: "%18 KDV, iskonto yok" ile "%20 KDV + %10 fatura altı iskonto" tek satırda aritmetik olarak AYNIDIR.
  // 2024 ve sonrasında %18'lik belge yalnız eski işlemlerin iade/düzeltmesidir (nadir), %10 fatura altı iskonto ise
  // toptan alımda olağandır — başlık yoksa olası okuma seçilir ve satır 'faturaAltiKdvden' diye İŞARETLENİR. Fatura
  // başlığı (cha_meblag) eldeyse hakem ODUR: bkz. netleriCoz.
  const makul = oranlar.map(r => ({ r, m: vergi / (r / 100) })).filter(x => x.m <= a + tol(a) && x.m >= a * 0.5);
  const pntr = PNTR_ORAN[String(h.sth_vergi_pntr ?? '')];
  const secilen = pntr !== undefined && pntr > 0 ? makul.find(x => x.r === pntr) : makul.length === 1 ? makul[0] : undefined;
  if (secilen) return sonuc(tutar, Math.min(a, secilen.m), 'faturaAltiKdvden', false);
  return sonuc(tutar, a, 'dogrulanamadi', false);
}

const miktarOku = (h: StokHareketi): number | null => (bilinenSayi(h.sth_miktar) ? Math.abs(Number(h.sth_miktar)) : null);

function satirdan(h: StokHareketi, c: TutarCozumu): SatirNet {
  const miktar = miktarOku(h);
  if (miktar === null) return { durum: 'miktarBilinmiyor', miktar: null };
  if (miktar === 0) return { durum: 'miktarSifir', miktar: 0 };
  if (!c.ok) return { durum: c.neden, miktar };
  return { durum: 'tamam', miktar, brut: c.brut, iskonto: Math.max(0, c.brut - c.net), net: c.net, birimFiyat: c.net / miktar, iskontoKolonlari: c.iskontoKolonlari, kaynak: c.kaynak };
}

/** Tek satırın NET tutarı ve net birim fiyatı (yalnız satırın kendi verisiyle); hesaplanamıyorsa nedenini döner (₺0 uydurmaz). */
export function satirNet(h: StokHareketi): SatirNet {
  return satirdan(h, tutarCoz(h));
}

// ── Fatura başlığı hakemliği ─────────────────────────────────────────────────────────────────────

/** Evrak anahtarı: seri + sıra + yön. Satırda yön `sth_evraktip` 3 (alış) / 4 (satış) — canlıda doğrulanmış birleştirme
 *  anahtarı (mikroRoutes fatura importu); başka evrak tipi (irsaliye, sayım…) fatura başlığına BAĞLANMAZ. */
const anahtar = (seri: unknown, sira: unknown, yon: 'gelen' | 'giden'): string | null => {
  const s = String(sira ?? '').trim();
  return s ? `${yon}|${String(seri ?? '').trim()}|${s}` : null;
};
/** Bir stok hareketinin FATURA anahtarı. */
export interface FaturaAnahtari { seri: string; sira: string; yon: 'gelen' | 'giden' }

/**
 * Stok hareketinin ait olduğu FATURA (seri + sıra + yön). Yalnız `sth_evraktip` 3 (alış faturası) / 4 (satış
 * faturası) — yukarıdaki doğrulanmış kural; irsaliye/sayım/virman fatura DEĞİLDİR → `null`. Tek tanım: başlık
 * hakemliği (`satirAnahtari`) ve ekranlardaki "evraka bas → faturayı aç" düğmeleri (`utils/faturaEsle.hareketFaturasi`)
 * bunu kullanır. `/api/mikro/fatura/kalemler` aynı üçlüyle (seri, sıra, yön→3/4) okur.
 */
export function faturaAnahtari(h: StokHareketi): FaturaAnahtari | null {
  const tip = Number(h.sth_evraktip);
  const yon = tip === 3 ? 'gelen' : tip === 4 ? 'giden' : null;
  const sira = String(h.sth_evrakno_sira ?? '').trim();
  if (yon === null || sira === '') return null;
  return { seri: String(h.sth_evrakno_seri ?? '').trim(), sira, yon };
}

const satirAnahtari = (h: StokHareketi): string | null => {
  const f = faturaAnahtari(h);
  return f ? anahtar(f.seri, f.sira, f.yon) : null;
};

/**
 * `mikroFaturalar` aynasındaki başlıklardan (cha_*) evrak → genel toplam (cha_meblag, KDV dâhil) eşlemesi. İptal başlık,
 * meblağı bilinmeyen başlık ve AYNI anahtara düşen birden çok başlık (belirsiz) hakem olamaz → eşlemeye girmez.
 */
export function faturaToplamlari(basliklar: readonly Readonly<Record<string, unknown>>[]): Map<string, number> {
  const sayac = new Map<string, number>(), toplam = new Map<string, number>();
  for (const b of basliklar) {
    if (b.cha_iptal === true || (bilinenSayi(b.cha_iptal) && Number(b.cha_iptal) === 1)) continue;
    if (!bilinenSayi(b.cha_meblag)) continue;
    const k = anahtar(b.cha_evrakno_seri, b.cha_evrakno_sira, Number(b.cha_tip) === 1 ? 'gelen' : 'giden');
    if (!k) continue;
    sayac.set(k, (sayac.get(k) ?? 0) + 1);
    toplam.set(k, Math.abs(Number(b.cha_meblag)));
  }
  for (const [k, n] of sayac) if (n > 1) toplam.delete(k);
  return toplam;
}

export interface NetSecenegi { faturaToplamlari?: ReadonlyMap<string, number> }

/**
 * Bir evrakın satır çözümlerini BAŞLIK TOPLAMIYLA hakemler. Yalnız KDV ile doğrulanamamış satırlara ('faturaAltiKdvden',
 * 'dogrulanamadi') dokunur: KDV'si geçerli orana oturan satır doğrudur (tevkifatlı faturada meblağ düşük çıkar, satır değil).
 *   hedef = meblağ − ΣKDV − Σmasraf − Σ(doğrulanmış satır neti);  oran = hedef / Σ(belirsiz satırların brüt − iskonto)
 *   oran ≈ 1            → iskonto YOK (ör. eski oranlı %18 satır): net = brüt − iskonto
 *   0,5 ≤ oran < 1      → fark FATURA ALTI iskontodur, belirsiz satırlara orantılı dağıtılır ('faturaAltiBasliktan')
 *   diğer / eksik veri  → başlık satırlarla bağdaşmıyor (tevkifat, ÖTV, aynada eksik satır): satır sonucu KALIR
 */
function basliklaHakemle(cozumler: TutarCozumu[], meblag: number): void {
  let kdv = 0, mas = 0, dogrulanmis = 0, belirsizTaban = 0;
  const belirsiz: Extract<TutarCozumu, { ok: true }>[] = [];
  for (const c of cozumler) {
    if (!c.ok || !Number.isFinite(c.vergi)) return;          // bir satırın tutarı/KDV'si bilinmiyorsa sağlama yapılamaz
    kdv += c.vergi; mas += c.mas;
    if (c.kdvDogrulandi) dogrulanmis += c.net; else { belirsiz.push(c); belirsizTaban += Math.max(0, c.tutar - c.isk); }
  }
  if (!belirsiz.length || !(belirsizTaban > 0)) return;
  const hedef = meblag - kdv - mas - dogrulanmis;
  const pay = Math.max(0.5, meblag * 0.0015);                // kuruş yuvarlamaları satır sayısıyla birikir
  if (Math.abs(hedef - belirsizTaban) <= pay) {
    for (const c of belirsiz) { c.net = Math.max(0, c.tutar - c.isk); c.brut = c.tutar; c.kaynak = c.isk > 0 ? 'satirIskontosu' : 'iskontosuz'; }
  } else if (hedef < belirsizTaban && hedef >= belirsizTaban * 0.5) {
    const oran = hedef / belirsizTaban;
    for (const c of belirsiz) { c.net = Math.max(0, c.tutar - c.isk) * oran; c.brut = c.tutar; c.kaynak = 'faturaAltiBasliktan'; }
  }
}

/** Tüm hareketlerin tutar çözümü; başlığı bilinen fatura evraklarında belirsiz satırlar başlıkla hakemlenir. */
function netleriCoz(hareketler: readonly StokHareketi[], secenek?: NetSecenegi): Map<StokHareketi, TutarCozumu> {
  const sonuc = new Map<StokHareketi, TutarCozumu>();
  const evraklar = new Map<string, TutarCozumu[]>();
  for (const h of hareketler) {
    if (iptalMi(h)) continue;
    const c = tutarCoz(h);
    sonuc.set(h, c);
    const k = secenek?.faturaToplamlari?.size ? satirAnahtari(h) : null;
    if (k && secenek?.faturaToplamlari?.has(k)) { const l = evraklar.get(k); if (l) l.push(c); else evraklar.set(k, [c]); }
  }
  for (const [k, liste] of evraklar) {
    const meblag = secenek?.faturaToplamlari?.get(k);
    if (meblag !== undefined) basliklaHakemle(liste, meblag);
  }
  return sonuc;
}

export interface KalemCozumu { miktar: number | null; brut: number | null; iskonto: number | null; net: number | null; birimFiyat: number | null; kaynak: NetKaynagi | null }

/**
 * Fatura modalı: TEK evrakın kalemleri + (biliniyorsa) başlık toplamı. Miktarı 0 olan satırın (fiyat farkı) TUTARI da
 * döner — yoksa "kalem neti + KDV = fatura toplamı" sağlaması yanlış alarm verirdi (hakem). Tutarı bilinmeyen kalem null.
 */
export function kalemleriCoz(kalemler: readonly StokHareketi[], meblag?: unknown): KalemCozumu[] {
  const cozumler = kalemler.map(tutarCoz);
  if (bilinenSayi(meblag)) basliklaHakemle(cozumler, Math.abs(Number(meblag)));
  return kalemler.map((k, i): KalemCozumu => {
    const c = cozumler[i], miktar = miktarOku(k);
    if (!c || !c.ok) return { miktar, brut: null, iskonto: null, net: null, birimFiyat: null, kaynak: null };
    return { miktar, brut: c.brut, iskonto: Math.max(0, c.brut - c.net), net: c.net, birimFiyat: miktar !== null && miktar > 0 ? c.net / miktar : null, kaynak: c.kaynak };
  });
}

/**
 * Net birim fiyat ekranda kaç ondalıkla basılır: (yuvarlanmış birim × miktar) satırın NET tutarını yarım kuruş içinde
 * geri üreten EN AZ ondalık (2…6). Örnek: ₺183,34 / 20 = 9,167 → "₺9,17" yazılırsa 20 × 9,17 = ₺183,40 olur ve
 * kullanıcı faturayı elle sağlayamaz; "₺9,167" yazılır. Çok adetli satırda 4 de yetmez: 5.000 vida / ₺418,37 →
 * "₺0,0837" × 5.000 = ₺418,50; 6 ondalık ("₺0,083674") tutar. Hiçbiri tutmuyorsa 6. Yuvarlanmış birim fiyat bir
 * GÖSTERİMDİR — hiçbir hesaba girmez (hesap `KalemCozumu.birimFiyat`'ın tam değeriyle yapılır). Girdi bilinmiyorsa 2
 * (sütun zaten '—' basar).
 */
export function birimFiyatOndaligi(birimFiyat: unknown, miktar: unknown, net: unknown): number {
  if (!bilinenSayi(birimFiyat) || !bilinenSayi(miktar) || !bilinenSayi(net)) return 2;
  for (let ondalik = 2; ondalik < 6; ondalik++) {
    const kat = 10 ** ondalik;
    const yuvarlak = Math.round(Number(birimFiyat) * kat) / kat;
    if (Math.abs(yuvarlak * Number(miktar) - Number(net)) <= 0.005) return ondalik;
  }
  return 6;
}

export interface StokFiyatSatiri {
  sku: string;
  /** NET ağırlıklı ortalama (Σnet / Σmiktar); o yönde hesaplanabilir satır yoksa null. */
  alisOrtFiyat: number | null; alisMiktar: number; alisTutar: number; alisBrutTutar: number; alisIskonto: number; alisAdet: number;
  satisOrtFiyat: number | null; satisMiktar: number; satisTutar: number; satisBrutTutar: number; satisIskonto: number; satisAdet: number;
  marjTL: number | null; marjYuzde: number | null;
  /** Tutarı/miktarı bilinmeyen ya da iskontosu tutarsız olduğu için ortalamaya GİRMEYEN satır sayısı (toplam ve yön bazında). */
  bilinmeyenSatir: number; alisBilinmeyen: number; satisBilinmeyen: number;
  /** Miktarı 0 ama tutarı dolu satır (fiyat farkı / dönem sonu iskonto faturası olabilir) — birim fiyata bölünemez, SAYILIR. */
  miktarsizSatir: number;
}
export interface StokFiyatOzeti {
  satirlar: StokFiyatSatiri[];
  iskontoKolonlari: string[];
  /** Ortalamaya giren satırların net kaynağı dökümü — ekran "kaç satır hangi yolla" bilgisini basar. */
  netKaynaklari: Partial<Record<NetKaynagi, number>>;
}

interface Yon { net: number; brut: number; iskonto: number; miktar: number; adet: number; bilinmeyen: number }
const bosYon = (): Yon => ({ net: 0, brut: 0, iskonto: 0, miktar: 0, adet: 0, bilinmeyen: 0 });

/** SKU + yön bazında NET ağırlıklı ortalama fiyat. İptal ve SKU'suz (native Cetpa) hareketler dışarıda. */
/** Hareketlerin net çözümü (başlık hakemliği dâhil) — `stokFiyatOzeti` ile `birimSapmalari` AYNI çözümü paylaşsın diye
 *  dışa açık: özet ucu tüm hareketleri iki kez çözmesin (inceleme 2026-09-25). */
export type NetCozumleri = ReadonlyMap<StokHareketi, TutarCozumu>;
export function netCozumleri(hareketler: readonly StokHareketi[], secenek?: NetSecenegi): NetCozumleri {
  return netleriCoz(hareketler, secenek);
}

export function stokFiyatOzeti(hareketler: readonly StokHareketi[], secenek?: NetSecenegi, hazirCozum?: NetCozumleri): StokFiyatOzeti {
  const cozumler = hazirCozum ?? netleriCoz(hareketler, secenek);
  const gruplar = new Map<string, { alis: Yon; satis: Yon; miktarsiz: number }>();
  const kolonSet = new Set<string>();
  const netKaynaklari: Partial<Record<NetKaynagi, number>> = {};
  for (const h of hareketler) {
    const sku = skuOku(h);
    if (!sku || iptalMi(h)) continue;
    for (const k of Object.keys(h)) if (ISKONTO_KOLONU.test(k)) kolonSet.add(k.toLowerCase());   // kolon VAR (değeri 0 olsa da)
    const g = gruplar.get(sku) ?? { alis: bosYon(), satis: bosYon(), miktarsiz: 0 };
    gruplar.set(sku, g);
    const c = cozumler.get(h);
    if (!c) continue;
    const s = satirdan(h, c);
    const y = yonOku(h) === 'alis' ? g.alis : g.satis;
    if (s.durum === 'miktarSifir') { if (bilinenSayi(h.sth_tutar) && Number(h.sth_tutar) !== 0) g.miktarsiz++; continue; }
    if (s.durum !== 'tamam') { y.bilinmeyen++; continue; }
    y.net += s.net; y.brut += s.brut; y.iskonto += s.iskonto; y.miktar += s.miktar; y.adet++;
    netKaynaklari[s.kaynak] = (netKaynaklari[s.kaynak] ?? 0) + 1;
  }
  const satirlar = [...gruplar.entries()]
    .filter(([, g]) => g.alis.adet > 0 || g.satis.adet > 0 || g.alis.bilinmeyen > 0 || g.satis.bilinmeyen > 0)
    .map(([sku, g]): StokFiyatSatiri => {
      const alisOrt = g.alis.miktar > 0 ? g.alis.net / g.alis.miktar : null;
      const satisOrt = g.satis.miktar > 0 ? g.satis.net / g.satis.miktar : null;
      const marj = alisOrt !== null && satisOrt !== null ? satisOrt - alisOrt : null;
      return {
        sku,
        alisOrtFiyat: alisOrt, alisMiktar: g.alis.miktar, alisTutar: g.alis.net, alisBrutTutar: g.alis.brut, alisIskonto: g.alis.iskonto, alisAdet: g.alis.adet,
        satisOrtFiyat: satisOrt, satisMiktar: g.satis.miktar, satisTutar: g.satis.net, satisBrutTutar: g.satis.brut, satisIskonto: g.satis.iskonto, satisAdet: g.satis.adet,
        marjTL: marj, marjYuzde: marj !== null && alisOrt !== null && alisOrt > 0 ? (marj / alisOrt) * 100 : null,
        bilinmeyenSatir: g.alis.bilinmeyen + g.satis.bilinmeyen, alisBilinmeyen: g.alis.bilinmeyen, satisBilinmeyen: g.satis.bilinmeyen,
        miktarsizSatir: g.miktarsiz,
      };
    })
    .sort((a, b) => (b.alisTutar + b.satisTutar) - (a.alisTutar + a.satisTutar));
  return { satirlar, iskontoKolonlari: [...kolonSet].sort(), netKaynaklari };
}

export interface StokFiyatDetaySatiri {
  tarih: unknown; yon: 'alis' | 'satis'; miktar: number | null;
  /** null = hesaplanamadı (tutar/miktar bilinmiyor ya da iskonto tutarsız) — ekran '—' basar, ₺0 değil. */
  brutTutar: number | null; iskonto: number | null; tutar: number | null; birimFiyat: number | null;
  /** Netin hangi yolla belirlendiği; hesaplanamayan satırda null. */
  kaynak: NetKaynagi | null;
  cariKod: unknown; evrakNo: string | null;
  /** Hareketin faturası (`faturaAnahtari`); fatura olmayan evrakta (irsaliye, sayım) `null`. */
  fatura: FaturaAnahtari | null;
}

/** Bir SKU'nun tüm alım/satım satırları (iptal hariç), yeniden eskiye. */
export function stokFiyatDetay(hareketler: readonly StokHareketi[], sku: string, secenek?: NetSecenegi): StokFiyatDetaySatiri[] {
  // Başlık hakemliği evrakın TÜM satırlarını ister (başka SKU'lar dâhil) — çözüm tüm hareketlerde yapılır, sonra SKU süzülür.
  const cozumler = netleriCoz(hareketler, secenek);
  return hareketler
    .filter(h => skuOku(h) === sku && !iptalMi(h))
    .map((h): StokFiyatDetaySatiri => {
      const s = satirdan(h, cozumler.get(h) ?? tutarCoz(h));
      const tamam = s.durum === 'tamam';
      return {
        tarih: h.sth_tarih ?? null,
        yon: yonOku(h),
        miktar: s.miktar,
        brutTutar: tamam ? s.brut : null, iskonto: tamam ? s.iskonto : null, tutar: tamam ? s.net : null, birimFiyat: tamam ? s.birimFiyat : null,
        kaynak: tamam ? s.kaynak : null,
        cariKod: h.sth_cari_kodu ?? h.sth_cari_kod ?? null,
        evrakNo: [h.sth_evrakno_seri, h.sth_evrakno_sira].filter(v => v !== '' && v != null).join('-') || null,
        fatura: faturaAnahtari(h),
      };
    })
    .sort((a, b) => String(b.tarih ?? '').localeCompare(String(a.tarih ?? '')));
}

// ── Birim sapması: koli/adet karışıklığı ─────────────────────────────────────────────────────────────

/**
 * Şüpheli satır eşiği: satırın NET birim fiyatı, aynı ürünün medyan net birim fiyatının bu kadar KATI ya da 1/KATI.
 * Kullanıcı vakası 2026-09-25: DAYSON-DYS.029'un iki alış faturası (evrak 410, 394) koli olarak kesilmiş — adet
 * fiyatı ~₺129 iken ₺3.125 / ₺3.229 (≈24–25×) girmiş, ortalama alış ve marj (-%27) bozulmuş. Olağan alış–satış
 * farkı (marj) bu eşiğe yaklaşmaz; koli/adet karışıklığı tipik olarak 6–50 kat. Eşik tahmin DEĞİL, ölçüt: aşan
 * satır "hata" diye düzeltilmez, LİSTELENİR — kararı kullanıcı Mikro'da verir.
 */
export const BIRIM_SAPMA_KATI = 4;
/** Medyan ancak ürünün en az bu kadar fiyatı bilinen satırı varsa anlamlı (2 satırda hangisinin yanlış olduğu belirsiz). */
export const BIRIM_SAPMA_ASGARI_SATIR = 3;

export interface BirimSapmasi {
  sku: string; tarih: unknown; yon: 'alis' | 'satis';
  miktar: number;
  /** Satırın NET birim fiyatı (KDV hariç, iskontolar düşülmüş) — ekrandaki "Net birim fiyat" ile aynı hesap. */
  birimFiyat: number;
  /** Referans: ürünün ANA fiyat grubunun (en kalabalık) medyan net birim fiyatı. */
  medyan: number;
  /** birimFiyat / medyan — 24 = ana kümenin 24 katı (koli girilmiş olabilir); 0,04 = 1/25'i. */
  kat: number;
  /** true: ürünün fiyatları dengeli gruplara bölünüyor (ör. 2 adet + 2 koli satırı) — HANGİ grubun yanlış olduğu
   *  fiyattan anlaşılamaz; yalnız ana gruptan sapan satırlar listelenir, ekran "belirsiz" der. */
  belirsiz: boolean;
  cariKod: unknown; evrakNo: string | null; fatura: FaturaAnahtari | null;
}

export interface BirimSapmaSonucu {
  satirlar: BirimSapmasi[];
  /** Kontrol EDİLEBİLEN ürünler (≥ BIRIM_SAPMA_ASGARI_SATIR fiyatı bilinen satır). Listede olmayan ama burada olan
   *  ürünün şüpheli satırı GERÇEKTEN yoktur; burada olmayan ürün DEĞERLENDİRİLEMEDİ (0 değil, bilinmiyor). */
  degerlendirilen: ReadonlySet<string>;
}

const medyanOf = (sirali: readonly number[]): number => {
  const n = sirali.length, o = Math.floor(n / 2);
  return n % 2 === 1 ? sirali[o] : (sirali[o - 1] + sirali[o]) / 2;
};

/**
 * Ürünün fiyat düzeyinden `BIRIM_SAPMA_KATI` kat ve üzeri sapan satırlar (her iki yönde), sapması büyükten küçüğe.
 *
 * Referans = ANA GRUBUN medyanı. Tek medyan YETMEZ (inceleme 2026-09-25): koli satırları ürünün satırlarının yarısına
 * yaklaşınca medyan koli fiyatına kayar ve DOĞRU adet satırları şüpheli çıkar. Ana grup: her fiyat için yarısı ile iki
 * katı arasındaki (±√KAT) satırlar sayılır, en kalabalık pencere ana gruptur (eşitlikte en ucuz). Zincir kümelemesi
 * DEĞİL — aradaki bir köprü fiyat adet ve koli gruplarını birleştirip koli satırlarını gizliyordu (delta hakemleri).
 * Hiçbir iki fiyat birbirine yakın değilse (ana grup < 2 satır) fiyat düzeyi belirlenemez → ürün için hüküm yok.
 * Şüpheli = ana grup medyanından ≥ `BIRIM_SAPMA_KATI` kat uzak HER satır.
 * Kesinlik: şüpheli OLMAYAN satırlar tüm satırların en az ¾'ü ise `belirsiz: false`; değilse fiyatlar dengeli
 * gruplara ayrılıyor, hangisinin yanlış olduğu fiyattan anlaşılamaz → `belirsiz: true` (yalnız sapan satırlar
 * listelenir, ekran "belirsiz" der). ¾, az satırda yanlış hüküm vermemek için (1 adet + 2 koli: ⅔).
 * Sınır: yıllara yayılan enflasyon fiyat düzeyini kaydırır — liste bir KONTROL listesidir, hüküm değil.
 *
 * Yalnız net birim fiyatı hesaplanabilen, iptal olmayan satırlar; fiyatı bilinmeyen satır gruba GİRMEZ ve şüpheli
 * sayılmaz (bilinmeyen ≠ sapma). Alış + satış birlikte: koli hatası iki yönde de aynı düzeyden sapar, marj ise
 * eşiğin çok altında kalır.
 */
export function birimSapmalari(hareketler: readonly StokHareketi[], secenek?: NetSecenegi, hazirCozum?: NetCozumleri): BirimSapmaSonucu {
  const cozumler = hazirCozum ?? netleriCoz(hareketler, secenek);
  const gruplar = new Map<string, { h: StokHareketi; miktar: number; birimFiyat: number }[]>();
  for (const h of hareketler) {
    if (iptalMi(h)) continue;
    const sku = skuOku(h);
    if (!sku) continue;
    const s = satirdan(h, cozumler.get(h) ?? tutarCoz(h));
    if (s.durum !== 'tamam' || !(s.birimFiyat > 0)) continue;
    const g = gruplar.get(sku) ?? [];
    g.push({ h, miktar: s.miktar, birimFiyat: s.birimFiyat });
    gruplar.set(sku, g);
  }
  const satirlar: BirimSapmasi[] = [];
  const degerlendirilen = new Set<string>();
  for (const [sku, g] of gruplar) {
    if (g.length < BIRIM_SAPMA_ASGARI_SATIR) continue;
    // ANA GRUP = en kalabalık "±√KAT" fiyat penceresi (KAT 4 → her fiyatın yarısı ile iki katı arası). Zincir DEĞİL:
    // ardışık-oran kümelemesinde aradaki köprü fiyat adet ve koli gruplarını birleştirip koli satırlarını gizliyordu
    // (delta hakemi 2026-09-25). İki işaretçi, O(n). Eşitlikte EN UCUZ pencere (ilk bulunan).
    const sirali = [...g].sort((a, b) => a.birimFiyat - b.birimFiyat);
    const pencere = Math.sqrt(BIRIM_SAPMA_KATI);
    let bas = 0, son = 0, enBas = 0, enSon = 0;
    for (let i = 0; i < sirali.length; i++) {
      const fiyat = sirali[i].birimFiyat;
      while (sirali[bas].birimFiyat < fiyat / pencere) bas++;
      if (son < i + 1) son = i + 1;
      while (son < sirali.length && sirali[son].birimFiyat <= fiyat * pencere) son++;
      if (son - bas > enSon - enBas) { enBas = bas; enSon = son; }
    }
    const ana = sirali.slice(enBas, enSon);
    if (ana.length < 2) continue;                                        // hiçbir iki fiyat yakın değil → düzey belirsiz, hüküm yok
    degerlendirilen.add(sku);                                            // yalnız HÜKÜM verilebilen ürün (0 = gerçekten temiz)
    const medyan = medyanOf(ana.map(x => x.birimFiyat));
    const sapan = g.filter(x => { const k = x.birimFiyat / medyan; return k >= BIRIM_SAPMA_KATI || k <= 1 / BIRIM_SAPMA_KATI; });
    if (sapan.length === 0) continue;
    const belirsiz = (g.length - sapan.length) * 4 < g.length * 3;     // olağan satırlar ¾'ün altında
    for (const x of sapan) {
      satirlar.push({
        sku, tarih: x.h.sth_tarih ?? null, yon: yonOku(x.h), miktar: x.miktar, birimFiyat: x.birimFiyat, medyan,
        kat: x.birimFiyat / medyan, belirsiz,
        cariKod: x.h.sth_cari_kodu ?? x.h.sth_cari_kod ?? null,
        evrakNo: [x.h.sth_evrakno_seri, x.h.sth_evrakno_sira].filter(v => v !== '' && v != null).join('-') || null,
        fatura: faturaAnahtari(x.h),
      });
    }
  }
  const sapma = (k: number) => Math.max(k, 1 / k);
  return { satirlar: satirlar.sort((a, b) => sapma(b.kat) - sapma(a.kat)), degerlendirilen };
}

