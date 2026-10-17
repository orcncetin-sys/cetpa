/**
 * faturaGonderimi.ts — e-Fatura ÇİFT KESİM koruması: sunucu işaretinin ORTAK tanımı (şartname
 * `.wf/SARTNAME-efatura-cift-kesim.md` E1, D5, D9, D13, D14; 2026-10-17).
 *
 * NEDEN: aynı sipariş için iki resmî e-Fatura kesilebiliyordu — sunucu «zaten faturalandı mı» diye bakmıyordu, istemcinin
 * «gönderiliyor» kilidi ölüydü, Mikro numarayı bilinen anahtarlarda döndürmeyince düğme kesimden sonra da görünüyordu, yanıt
 * kaybında «kesilmiş OLABİLİR» denmiyordu. Tek kaynak artık siparişin kendi belgesindeki işarettir:
 *   `orders/<id>.mikroFaturaGonderimi = { durum, istekNo, zaman, kim, numara? }`
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
}

/** Fatura uçlarının `kod` alanı — istemci iletiyi HTTP durumundan değil bundan seçer (D9). */
export type FaturaYanitKodu =
  | 'FATURA_GONDERILMEDI'
  | 'FATURA_REDDEDILDI'
  | 'FATURA_SONUCU_BILINMIYOR'
  | 'FATURA_GONDERILIYOR'
  | 'FATURA_GONDERILDI'
  | 'FATURA_KESILEMEZ'
  | 'FATURA_SONUC_YOK';

/** `FATURA_KESILEMEZ` nedeni (D1 öncelik 2). */
export type FaturaKesilemezNedeni = 'mikro-fatura' | 'magaza' | 'faturasiz';

/** `POST /api/mikro/fatura/sonuc` kararı (E3 / D6). */
export type FaturaSonucKarari = 'mikrodaVar' | 'mikrodaYok';

const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Kayıttaki işaret. Yalnız NESNE ve bilinen `durum` kabul edilir; alan yok, JSON `null`, dizi ya da bilinmeyen durum → `null`. */
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
