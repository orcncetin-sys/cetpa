/**
 * faturaDurumu — "bu siparişin faturası VAR mı" ile "faturalı satış mı" AYRI sorulardır.
 *
 * Neden var (2026-09-24, kullanıcı kuralı: "faturası olan bir şeye tekrar fatura kestiremeyiz"):
 * OrdersPage:1449 'Fatura Kes' düğmesi `!hasInvoice && faturali !== false` ile açılıyordu.
 * Mikro'dan gelen fatura satırları (`source: 'mikro-fatura'`, sunucu `faturali: true` yazar,
 * `mikroFaturaNo` dolu) bu koşulu GEÇİYOR ve MF-383 gibi zaten-fatura olan satırda
 * 'Fatura Kes' görünüyordu. Kök neden: `faturali` bayrağı "faturalı satış / faturasız satış"
 * ayrımıdır (App.tsx:3121 form alanı, kdvAylik sayacı), "fatura kesildi" anlamına gelmez.
 *
 * Sözleşme:
 *  - `siparisFaturaVar`: Cetpa faturası (`hasInvoice`) YA DA Mikro faturası (`mikroFaturaNo`)
 *    YA DA satırın kendisi bir Mikro faturası (`source === 'mikro-fatura'`). Yalnız GERÇEK
 *    boolean/string kabul edilir — `'true'`/`1` gibi değerler fatura kanıtı sayılmaz.
 *  - `faturaKesilebilir`: faturasız satış (`faturali === false`) DEĞİL, faturası YOK ve Mikro faturası kesilmiş OLAMAZ
 *    (`mikroFaturasiKesilmisOlabilir` — aşağıda; 2026-10-17).
 *  - `mikroyaFaturaGonderilebilir`: Mikro'da faturası yok ve satır Mikro faturası değil;
 *    Cetpa-iç faturanın (`hasInvoice`) olması Mikro'ya e-Fatura göndermeyi ENGELLEMEZ
 *    (yerel kayıt → Mikro e-Fatura akışı meşru). `faturali === false` yine kapatır.
 *    ÇEVRİM İÇİ MAĞAZA siparişi (`source === MAGAZA_KAYNAGI`) de KAPALI (2026-10-07): eşleyici kalemde `price`
 *    yazmaz ve sipariş cariye bağlı gelmez — gönderim her yoldan sunucu şemasında 400 ile bitiyor, düğme ise
 *    kullanıcıyı «belge tipini seç» + resmî belge onayına yürütüp ölü uca çıkarıyordu. Mağaza siparişine fatura
 *    yolu yazıldığında (kaleme `price` + cari eşlemesi) bu dal onunla BİRLİKTE açılır.
 *    `faturaKesilebilir` bu kuralın DIŞINDA: o düğme yalnız Muhasebe sekmesine götürür, çıkmaz üretmez.
 *
 * Parite: eşleşen bilinen girdilerde (native sipariş, hasInvoice yok, faturali undefined/true)
 * eski davranışla BİREBİR; tek fark Mikro faturası olan satırlarda düğmenin KAPANMASI.
 *
 * ÇİFT KESİM (2026-10-17, şartname «e-Fatura çift kesim» D5 / D10 / D12): Mikro numarayı bilinen anahtarlarda döndürmeyince
 * düğme kesimden SONRA da görünüyordu. Kural artık sunucu işaretine de bakar (`mikroFaturaGonderimi`, lib/faturaGonderimi):
 *  - `mikroFaturasiKesilmisOlabilir`: TEK yüklem — `mikroFaturaNo` / `ettn` dolu YA DA işaret `gonderiliyor` (taze / bayat),
 *    `gonderildi`, `belirsiz`. Düğme görünürlüğü (`mikroyaFaturaGonderilebilir`), düzenleme kilidi (OrdersPage) ve Muhasebe
 *    takip tablosu bundan okur — iki ayrı liste tutulmaz. `reddedildi` ve işaretsiz sipariş yeniden gönderilebilir.
 *    (`ettn`: sunucu talebiyle AYNI kural — ETTN'li siparişe sunucu 409 döner; düğme ölü kalmasın.)
 *  - `faturaSonucuCozulebilir`: `belirsiz` ya da bayat `gonderiliyor` → «Mikro'da var / yok» seçenekleri (D6).
 *  - `mikroFaturaDurumMetni`: rozet metni (D12).
 */
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi';
import { faturaGonderimDurumu, faturaIsareti } from '../../lib/faturaGonderimi';

export interface FaturaDurumuGirdisi {
  source?: string;
  hasInvoice?: boolean;
  mikroFaturaNo?: string;
  ettn?: string;
  lucaFaturaNo?: string;
  faturali?: boolean;
  /** Sunucunun gönderim işareti — bilinmeyen biçim `faturaIsareti` ile süzülür. */
  mikroFaturaGonderimi?: unknown;
}

const doluMetin = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

export function siparisFaturaVar(o: FaturaDurumuGirdisi | null | undefined): boolean {
  if (!o) return false;
  if (o.source === 'mikro-fatura') return true;
  if (typeof o.mikroFaturaNo === 'string' && o.mikroFaturaNo.trim() !== '') return true;
  return o.hasInvoice === true;
}

/** «Fatura Kes» düğmesi (Muhasebe sekmesine götürür). ÇİFT KESİM (inceleme 1, İ1-3): Mikro faturası kesilmiş OLABİLEN siparişte
 *  de (gönderim sürüyor / sonucu bilinmiyor / numarasız `gonderildi`) çizilmez — kullanıcıyı ikinci fatura yoluna yürütmesin.
 *  `reddedildi` ve işaretsiz sipariş açık kalır. `simdiMs` yalnız sınamalar için (bayatlık türetmesi). */
export function faturaKesilebilir(o: FaturaDurumuGirdisi | null | undefined, simdiMs: number = Date.now()): boolean {
  if (!o) return false;
  if (o.faturali === false) return false;
  return !siparisFaturaVar(o) && !mikroFaturasiKesilmisOlabilir(o, simdiMs);
}

/** Bu siparişin Mikro faturası kesilmiş OLABİLİR mi (D10) — kesilmişse ya da sonucu beklenen / bilinmeyen gönderim varsa `true`.
 *  `simdiMs` yalnız sınamalar için (bayatlık türetmesi gösterimi etkiler; karar sunucuda). */
export function mikroFaturasiKesilmisOlabilir(o: FaturaDurumuGirdisi | null | undefined, simdiMs: number = Date.now()): boolean {
  if (!o) return false;
  if (doluMetin(o.mikroFaturaNo) || doluMetin(o.ettn)) return true;
  const durum = faturaGonderimDurumu(o, simdiMs);
  return durum === 'gonderiliyor' || durum === 'gonderildi' || durum === 'belirsiz';
}

export function mikroyaFaturaGonderilebilir(o: FaturaDurumuGirdisi | null | undefined, simdiMs: number = Date.now()): boolean {
  if (!o) return false;
  if (o.faturali === false) return false;
  if (o.source === 'mikro-fatura') return false;
  if (o.source === MAGAZA_KAYNAGI) return false;
  return !mikroFaturasiKesilmisOlabilir(o, simdiMs);
}

/** «Mikro'da var / yok» ile çözülebilir mi (D6): işaret `belirsiz` ya da bayat `gonderiliyor`. Sunucu kabulüyle AYNI kural. */
export function faturaSonucuCozulebilir(o: FaturaDurumuGirdisi | null | undefined, simdiMs: number = Date.now()): boolean {
  return faturaGonderimDurumu(o, simdiMs) === 'belirsiz';
}

/**
 * Muhasebe → e-Fatura Takip tablosu (D12): «faturası VAR» sayılır mı. Eski üç alan (`hasInvoice`, Mikro / LUCA numarası —
 * doğruluk değeriyle, parite) + Mikro faturası kesilmiş OLABİLİR (`gonderiliyor` / `belirsiz` / numarasız `gonderildi`).
 * Gönderimi süren ya da sonucu bilinmeyen sipariş «Fatura yok» SAYILMAZ ve «Faturalandı» düğmesi çizilmez — o düğme yalnız
 * `hasInvoice` yazar, işareti çözmez; çözüm sipariş ayrıntısındaki iki seçenektir (D6).
 */
export function faturaTakipFaturaVar(o: FaturaDurumuGirdisi | null | undefined, simdiMs: number = Date.now()): boolean {
  if (!o) return false;
  return !!o.hasInvoice || !!o.mikroFaturaNo || !!o.lucaFaturaNo || mikroFaturasiKesilmisOlabilir(o, simdiMs);
}

/**
 * Rozet metni (D12): «Fatura gönderiliyor» · «Fatura sonucu bilinmiyor» · «Mikro reddetti» · numarasız `gonderildi` için «Fatura
 * kesildi (numara okunamadı)». Numaralı faturada `null` (numara rozeti zaten çizilir); işaretsiz siparişte `null`.
 * Metin zaten doğru yazımla döner — `toUpperCase` YOK (büyük harf gerekiyorsa CSS + `lang="tr"`).
 */
export function mikroFaturaDurumMetni(o: FaturaDurumuGirdisi | null | undefined, dil: 'tr' | 'en' = 'tr', simdiMs: number = Date.now()): string | null {
  if (!o) return null;
  const durum = faturaGonderimDurumu(o, simdiMs);
  const tr = dil === 'tr';
  if (durum === 'gonderiliyor') return tr ? 'Fatura gönderiliyor' : 'Invoice being sent';
  if (durum === 'belirsiz') return tr ? 'Fatura sonucu bilinmiyor' : 'Invoice result unknown';
  if (durum === 'reddedildi') return tr ? 'Mikro reddetti' : 'Rejected by Mikro';
  if (durum === 'gonderildi' && !doluMetin(o.mikroFaturaNo)) {
    // Numara yalnız işarette kaldıysa (sipariş alanı sonradan boşaltıldı) o gösterilir; hiç okunamadıysa uydurulmaz.
    const numara = faturaIsareti(o)?.numara;
    if (numara) return tr ? `Fatura kesildi (No: ${numara})` : `Invoice issued (No: ${numara})`;
    return tr ? 'Fatura kesildi (numara okunamadı)' : 'Invoice issued (number not read)';
  }
  return null;
}

// ── Bayat kalem: satır KDV'si hangi orana ait ────────────────────────────────────────────────────────────────────
// Sipariş penceresi kaleme satır KDV'sini (`kdv`) ve — KDV dâhil girilen fiyatta — orana bağlı net birim fiyatı kalemin
// `vatRate`'iyle yazar. Sipariş oranı (`kdvOran`) ondan FARKLIYSA kalem eski orana aittir (bayat). Üç durum, iki saf işlev:
//   • kalem oranı = sipariş oranı        → satır KDV'si belgeye aynen gider (`kalemSatirKdv`);
//   • kalem oranı BİLİNİYOR ve farklı    → belge KESİLMEZ (`bayatKalemVar`): yalnız KDV'yi düşürüp göndermek KDV dâhil çapada
//                                           bayat net fiyatla yanlış toplamlı belge keserdi (yazılan 50,01 yerine 45,85);
//   • kalemde oran YOK (pencere dışı kalem) → KDV'nin hangi orana ait olduğu bilinmez: gönderilmez, sunucu güncel orandan
//                                           hesaplar; belge engellenmez (o kalemde net birim orana bağlı değildir).
// App.tsx `handleMikroFatura` bu ikisini kullanır; yüklem satır içi dururken çit testi yalnız METNİ kilitleyebiliyordu
// (kapıyı söndüren mutantlar yeşil kalıyordu — inceleme 2026-10-08).

interface KdvliKalem { kdv?: unknown; vatRate?: unknown }
const sonluSayi = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Siparişte, satır KDV'si sipariş oranından FARKLI bir orana ait kalem var mı (→ fatura isteği gönderilmez). */
export function bayatKalemVar(o: { kdvOran?: unknown; lineItems?: ReadonlyArray<KdvliKalem> | null } | null | undefined): boolean {
  if (!o || !sonluSayi(o.kdvOran)) return false;      // sipariş oranı yoksa karışılmaz — sunucu 400 ile sebebini söyler
  return (o.lineItems ?? []).some(l => sonluSayi(l.kdv) && sonluSayi(l.vatRate) && l.vatRate !== o.kdvOran);
}

/** Fatura isteğine konacak satır KDV'si: yalnız kalemin oranı sipariş oranıyla AYNIYSA; değilse `undefined` (alan gönderilmez). */
export function kalemSatirKdv(l: KdvliKalem, kdvOran: unknown): number | undefined {
  return sonluSayi(l.kdv) && sonluSayi(kdvOran) && l.vatRate === kdvOran ? l.kdv : undefined;
}
