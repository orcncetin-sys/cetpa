/**
 * ucKapisiCekirdegi.ts — UÇ düzeyi rol kapısı tablolarının ORTAK çekirdeği (2026-10-17, şartname «iç rol daraltma» İ4).
 *
 * NEDEN AYRI: iki tablo var — `mikroUcKapilari.ts` (`/api/mikro/*`) ve `entegrasyonUcKapilari.ts` (LUCA, Paraşüt, yapay zekâ,
 * Shopify, SKU eşleştirme, otomatik SAS). İkisi de AYNI soruyu sorar («bu rol, ucun sunucudaki kapısından geçer mi») ve AYNI
 * kuralla cevaplar: «tabloda yok = geçemez», rolsüz hesap geçemez, karar `rbac.ts` `isAllowed`'dadır. Karar işlevi iki tabloda
 * ayrı ayrı yazılsaydı biri gevşeyince öteki fark etmezdi (kopya işlev). Tablolar yalnız VERİDİR; karar burada, tek yerde.
 *
 * Saf modül: sunucu testi ve istemci (bileşen / kanca / servis) aynı işlevi okur.
 */
import { isAllowed, type AppRole } from './rbac';

/** `requireCollectionAccess(koleksiyon, eylem)` ikilisi. */
export type UcKapisi = readonly [koleksiyon: string, eylem: 'read' | 'write'];

/** Bu rol, tablodaki ucun kapısından geçer mi? Rolsüz hesap ve tabloda OLMAYAN anahtar (tip dışı çağrı, miras anahtar —
 *  `constructor`, `toString`) GEÇEMEZ — kapalı başarısızlık. */
export function tablodakiUcKapisindanGecer<A extends string>(
  tablo: Readonly<Record<A, UcKapisi>>,
  rol: AppRole | null | undefined,
  uc: A,
): boolean {
  if (!rol || !Object.prototype.hasOwnProperty.call(tablo, uc)) return false;
  const [koleksiyon, eylem] = tablo[uc];
  return isAllowed(rol, koleksiyon, eylem);
}
