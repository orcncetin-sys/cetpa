/**
 * sevkiyatKartlari.ts — Lojistik → Sevkiyat ekranındaki ÖZET KARTLARI ile altındaki sevkiyat LİSTESİNİN tek kaynağı. Saf (2026-10-02).
 *
 * NEDEN (kullanıcı bildirimi: «kartlar detaya gitmeli»): kartlar yalnız sayı gösteriyordu — "Teslim Edildi 389"un hangi 389
 * sipariş olduğuna ulaşmanın yolu yoktu. Kart sayısı ile kartın açtığı liste AYNI kovadan gelsin diye ikisi burada kurulur
 * (ayrı ayrı süzülürse "kartta 12, listede 11" ayrışması çıkar).
 *
 * TESLİMAT SÜRESİ (SLA) — eski şerit süreyi `|syncedAt − createdAt|` ile "ölçüyordu": bu iki alan teslimatla ilgisizdir
 * (Mikro faturasından türeyen siparişte ikisi de import anıdır) → 389 fatura "zamanında, ort. 0,0 gün, %100" görünüyordu.
 * Süre artık GERÇEK teslim anından (`deliveredAt`, durum 'Teslim Edildi'ye çekilirken yazılır) ölçülür; teslim anı ya da
 * oluşturma anı okunamayan teslimat ÖLÇÜLEMEZ sayılır ve AYRI kovada SAYILIR — "zamanında" da "gecikmeli" de değildir.
 */
import { zamanMs, gunAnahtari } from '../zaman';

/** Zamanında teslim eşiği (gün): oluşturmadan teslime en çok bu kadar. Ekrandaki "≤7 gün = zamanında" notuyla aynı sabit. */
export const SLA_GUN = 7;
const GUN_MS = 86400000;

export type SevkiyatKovasi = 'suren' | 'kargoda' | 'bugun' | 'hazirlaniyor' | 'teslim' | 'zamaninda' | 'gecikmeli' | 'olculemeyen';

export interface SevkiyatSiparisi {
  id?: string; status?: string; createdAt?: unknown; syncedAt?: unknown; deliveredAt?: unknown;
}

/** Oluşturmadan teslime geçen gün; teslim ya da oluşturma anı okunamıyorsa (ya da teslim oluşturmadan önceyse) null. */
export function teslimSuresiGun(o: SevkiyatSiparisi): number | null {
  const teslim = zamanMs(o.deliveredAt), olusma = zamanMs(o.createdAt);
  if (teslim === null || olusma === null || teslim < olusma) return null;
  return (teslim - olusma) / GUN_MS;
}

export interface SevkiyatKovalari<T> {
  /** Sevkiyatı süren: teslim edilmemiş ve iptal edilmemiş (rota kurucunun tanımı — utils/logistics `sevkiyatiSuruyor`). */
  suren: T[];
  kargoda: T[];
  /** Kargoda olup BUGÜN oluşturulan (kartın eski tanımı — kayıtta ayrı bir "kargoya veriliş" anı yok). */
  bugun: T[];
  hazirlaniyor: T[];
  teslim: T[];
  zamaninda: T[];
  gecikmeli: T[];
  /** Teslim edilmiş ama süresi ölçülemeyen (teslim anı kaydı yok — ör. Mikro faturasından türeyen sipariş). */
  olculemeyen: T[];
}

export function sevkiyatKovalari<T extends SevkiyatSiparisi>(siparisler: readonly T[], bugun: string): SevkiyatKovalari<T> {
  const k: SevkiyatKovalari<T> = { suren: [], kargoda: [], bugun: [], hazirlaniyor: [], teslim: [], zamaninda: [], gecikmeli: [], olculemeyen: [] };
  for (const o of siparisler) {
    if (o.status !== 'Delivered' && o.status !== 'Cancelled') k.suren.push(o);
    if (o.status === 'Shipped') {
      k.kargoda.push(o);
      if (gunAnahtari(o.createdAt ?? o.syncedAt) === bugun) k.bugun.push(o);
    }
    if (o.status === 'Processing') k.hazirlaniyor.push(o);
    if (o.status === 'Delivered') {
      k.teslim.push(o);
      const gun = teslimSuresiGun(o);
      if (gun === null) k.olculemeyen.push(o);
      else if (gun <= SLA_GUN) k.zamaninda.push(o);
      else k.gecikmeli.push(o);
    }
  }
  return k;
}

export interface SlaOzeti {
  /** Zamanında / ölçülen × 100, tam sayıya yuvarlı. Ölçülen teslimat yoksa null ('—' — "%100" UYDURULMAZ). */
  oran: number | null;
  zamaninda: number; gecikmeli: number; olculen: number; olculemeyen: number;
  /** Ölçülen teslimatların ortalama süresi (gün); ölçüm yoksa null. */
  ortGun: number | null;
}

export function slaOzeti<T extends SevkiyatSiparisi>(k: SevkiyatKovalari<T>): SlaOzeti {
  const olculenler = [...k.zamaninda, ...k.gecikmeli];
  const olculen = olculenler.length;
  let toplamGun = 0;
  for (const o of olculenler) toplamGun += teslimSuresiGun(o) ?? 0;   // null olamaz: bu iki kovaya yalnız süresi ölçülenler girer
  return {
    oran: olculen > 0 ? Math.round((k.zamaninda.length / olculen) * 100) : null,
    zamaninda: k.zamaninda.length, gecikmeli: k.gecikmeli.length, olculen, olculemeyen: k.olculemeyen.length,
    ortGun: olculen > 0 ? toplamGun / olculen : null,
  };
}

const KOVA_ETIKETI: Record<SevkiyatKovasi, { tr: string; en: string }> = {
  suren:        { tr: 'Aktif Sevkiyatlar',        en: 'Active Shipments' },
  kargoda:      { tr: 'Kargodaki sevkiyatlar',    en: 'Shipments in transit' },
  bugun:        { tr: 'Bugün gönderilenler',      en: 'Shipped today' },
  hazirlaniyor: { tr: 'Hazırlanan sevkiyatlar',   en: 'Shipments being prepared' },
  teslim:       { tr: 'Teslim edilenler',         en: 'Delivered' },
  zamaninda:    { tr: 'Zamanında teslim edilenler', en: 'Delivered on time' },
  gecikmeli:    { tr: 'Gecikmeli teslim edilenler', en: 'Delivered late' },
  olculemeyen:  { tr: 'Süresi ölçülemeyen teslimatlar', en: 'Deliveries without a measured duration' },
};
/** Liste başlığı: hangi kartın süzgeci açık. */
export function sevkiyatKovaEtiketi(kova: SevkiyatKovasi, dil: 'tr' | 'en'): string {
  return KOVA_ETIKETI[kova][dil];
}
