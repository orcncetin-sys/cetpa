/**
 * faturaGonderimi.ts — e-Fatura ÇİFT KESİM koruması: sunucu işaretinin ORTAK tanımı (şartname
 * `.wf/SARTNAME-efatura-cift-kesim.md` E1, D5, D9, D13, D14; 2026-10-17).
 *
 * NEDEN: aynı sipariş için iki resmî e-Fatura kesilebiliyordu — sunucu «zaten faturalandı mı» diye bakmıyordu, istemcinin
 * «gönderiliyor» kilidi ölüydü, Mikro numarayı bilinen anahtarlarda döndürmeyince düğme kesimden sonra da görünüyordu, yanıt
 * kaybında «kesilmiş OLABİLİR» denmiyordu. Tek kaynak artık siparişin kendi belgesindeki işarettir:
 *   `orders/<id>.mikroFaturaGonderimi = { durum, istekNo, zaman, kim, numara?, cariKod?, faturaTarihi? }`
 *   (`cariKod` / `faturaTarihi` 2026-10-19'dan beri talepte yazılır — gece faturadan-sipariş bekletmesi okur, şartname «fatura
 *   gövde + gece MF» § 9.A A1)
 * İşareti YALNIZ sunucu yazar ve siler (`/api/db` yazamaz — collections.SUNUCU_TURETILEN_ALANLAR). Mikro'ya istekten ÖNCE
 * koşullu tek SQL ile `gonderiliyor` yazılır; yanıttan sonra `gonderildi` / `reddedildi` / `belirsiz` (server/mikro/faturaGonderimi).
 *
 * BAYATLIK (D5): `zaman` + `FATURA_GONDERIM_BAYATLIK_MS` geçmiş `gonderiliyor` OKUNURKEN `belirsiz` sayılır (yazılmaz, türetilir).
 * Sunucu kararı SQL `now()` ile verilir; istemci saati yalnız gösterimi etkiler. Eşik, işaretten sonraki ağ bütçesinden
 * (belirteç + `FaturaKaydetV2`, her biri global 30 sn; stub tekrarı bu çağrıda KAPALI) BÜYÜK olmalı — sınama: T31.
 *
 * Saf modül: sunucu (rota, SQL parametresi) ve istemci (düğme, rozet, kilit, düzenleme kilidi) AYNI sabiti ve türetmeyi okur.
 */

/** Siparişteki işaret alanının adı. Korunan alan listesi (`SUNUCU_TURETILEN_ALANLAR`) ve SQL bu sabitten okur. */
export const FATURA_GONDERIM_ALANI = 'mikroFaturaGonderimi' as const;

/** `gonderiliyor` işaretinin bayatlık eşiği (ms). Sunucu ve istemci AYNI sabiti okur (D5). */
export const FATURA_GONDERIM_BAYATLIK_MS = 120_000;

export type FaturaGonderimDurumu = 'gonderiliyor' | 'gonderildi' | 'reddedildi' | 'belirsiz';
const DURUMLAR: readonly FaturaGonderimDurumu[] = ['gonderiliyor', 'gonderildi', 'reddedildi', 'belirsiz'];

export interface MikroFaturaGonderimi {
  durum: FaturaGonderimDurumu;
  /** Talep anında SUNUCUNUN ürettiği kimlik (`crypto.randomUUID()`); istemci göndermez (D13). */
  istekNo: string;
  /** Talebin sunucu saatiyle ISO zamanı. */
  zaman: string;
  /** Talebi açan oturum (e-posta, yoksa uid). */
  kim: string;
  /** Okunabildiyse Mikro evrak numarası; okunamadıysa alan YOKTUR (uydurulmaz). */
  numara?: string;
  /**
   * Talep anında Mikro gövdesine yazılan cari kodu (`evrak.cha_kod`; şartname «fatura gövde + gece MF» § 9.A A1, 2026-10-19).
   * Gece faturadan-sipariş bekletmesi «aynı müşteri» kararını bununla verir. Sunucuda başka kaynak YOK: değeri istemci müşteri
   * kartından hesaplıyor (istek gövdesi `order.mikroCariKod`), kart sonradan değişebilir — yeniden türetmek YASAK (kayar).
   * Alanı olmayan işaret (2026-10-19'dan önceki kayıt) = «carisi bilinmiyor».
   */
  cariKod?: string;
  /** Talep anında gövdeye yazılan fatura tarihi (`cha_tarihi`, `GG.AA.YYYY`) — bekletmenin tarih sınırı (§ 9.A A2). */
  faturaTarihi?: string;
}

/** Fatura uçlarının `kod` alanı — istemci iletiyi HTTP durumundan değil bundan seçer (D9). */
export type FaturaYanitKodu =
  | 'FATURA_GONDERILMEDI'
  | 'FATURA_REDDEDILDI'
  | 'FATURA_SONUCU_BILINMIYOR'
  | 'FATURA_GONDERILIYOR'
  | 'FATURA_GONDERILDI'
  | 'FATURA_KESILEMEZ'
  | 'FATURA_SONUC_YOK'
  // `fatura/sonuc` ETTN kodları (§ 9.B B2 / B3, 2026-10-19):
  /** 400 — verilen ETTN geçersiz (`cetpaEttnAnahtari` boş: sıfır, biçimsiz, tire yeri bozuk). */
  | 'FATURA_ETTN_GECERSIZ'
  /** 409 — «ETTN ekle»: siparişte geçerli ETTN zaten kayıtlı. */
  | 'FATURA_ETTN_VAR'
  /** 409 — aynı ETTN aynı kiracının başka bir Cetpa siparişinde kayıtlı. */
  | 'FATURA_ETTN_BASKA_SIPARISTE'
  /** 409 — fatura aynasına göre ETTN bir alış faturasının ya da başka bir carinin faturası. */
  | 'FATURA_ETTN_BASKA_CARI'
  /** 409 — «ETTN ekle»: okunan ham ETTN araya giren bir yazımla değişti. */
  | 'FATURA_ETTN_DEGISTI'
  /** 409 — fatura aynasına göre ETTN aynı carinin talep sınırından ÖNCEKİ (bu siparişin olamayacak) bir faturasının. */
  | 'FATURA_ETTN_ONCEKI_FATURA';

/** `FATURA_KESILEMEZ` nedeni (D1 öncelik 2). `luca-gonderildi` (2026-10-19, şartname «takip kodu + LUCA reddi» LB): sipariş LUCA'ya
 *  Cetpa'dan aktarılmış (`lucaSynced` / `lucaFaturaNo`) — Mikro'da da kesilirse muhasebecinin aktarımıyla LUCA'da çift kayıt. */
export type FaturaKesilemezNedeni = 'mikro-fatura' | 'magaza' | 'faturasiz' | 'luca-gonderildi';

/** `POST /api/mikro/fatura/sonuc` kararı (E3 / D6). `ettnEkle` (§ 9.B B2, 2026-10-19): `gonderildi` ama geçerli ETTN'si olmayan
 *  siparişe sonradan ETTN yazar — aynı uç, aynı kapı. */
export type FaturaSonucKarari = 'mikrodaVar' | 'mikrodaYok' | 'ettnEkle';

const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Kayıttaki işaret. Yalnız NESNE ve bilinen `durum` kabul edilir; alan yok, JSON `null`, dizi ya da bilinmeyen durum → `null`.
 *  `cariKod` yalnız kırpılmış ve boş değilse, `faturaTarihi` yalnız `GG.AA.YYYY` biçimindeyse döner (yoksa alan YOK). */
export function faturaIsareti(o: { mikroFaturaGonderimi?: unknown } | null | undefined): MikroFaturaGonderimi | null {
  const ham = o?.mikroFaturaGonderimi;
  if (!nesneMi(ham)) return null;
  const durum = DURUMLAR.find(d => d === ham.durum);
  if (!durum) return null;
  const metin = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    durum,
    istekNo: metin(ham.istekNo),
    zaman: metin(ham.zaman),
    kim: metin(ham.kim),
    ...(typeof ham.numara === 'string' && ham.numara.trim() !== '' ? { numara: ham.numara } : {}),
    ...(typeof ham.cariKod === 'string' && ham.cariKod.trim() !== '' ? { cariKod: ham.cariKod.trim() } : {}),
    ...(typeof ham.faturaTarihi === 'string' && /^\d{2}\.\d{2}\.\d{4}$/.test(ham.faturaTarihi) ? { faturaTarihi: ham.faturaTarihi } : {}),
  };
}

/** `gonderiliyor` işareti bayat mı? Zamanı okunamayan işaret bayat sayılır (güvenli yön: «sonuç bilinmiyor», yeniden gönderilemez). */
export function gonderimBayatMi(isaret: MikroFaturaGonderimi, simdiMs: number = Date.now()): boolean {
  if (isaret.durum !== 'gonderiliyor') return false;
  const t = Date.parse(isaret.zaman);
  if (!Number.isFinite(t)) return true;
  return t + FATURA_GONDERIM_BAYATLIK_MS < simdiMs;
}

/** İşaretin OKUNAN durumu: bayat `gonderiliyor` → `belirsiz` (D5). İşaret yoksa `null`. */
export function faturaGonderimDurumu(o: { mikroFaturaGonderimi?: unknown } | null | undefined, simdiMs: number = Date.now()): FaturaGonderimDurumu | null {
  const isaret = faturaIsareti(o);
  if (!isaret) return null;
  return gonderimBayatMi(isaret, simdiMs) ? 'belirsiz' : isaret.durum;
}
