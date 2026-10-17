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
import { STAFF_ROLES, isAllowed, type AppRole } from './rbac';

/** `requireCollectionAccess(koleksiyon, eylem)` ikilisi. */
export type UcKoleksiyonKapisi = readonly [koleksiyon: string, eylem: 'read' | 'write'];
/**
 * Uç kapısı: koleksiyon ikilisi YA DA `'staff'` — sunucudaki `requireStaff` (yalnız iç personel; 2026-10-17, şartname «e-Fatura
 * çift kesim» D6). Personel kapısı tabloya girmeden istemci «bu rol geçer mi» sorusunu bu uçlar için soramıyordu; kopya karar
 * işlevi ya da elle rol listesi YAZILMAZ — karar aşağıdaki tek işlevde, `rbac.ts` `STAFF_ROLES`'tan (`requireStaff` ile aynı küme).
 */
export type UcKapisi = UcKoleksiyonKapisi | 'staff';

/** Bu rol, tablodaki ucun kapısından geçer mi? Rolsüz hesap ve tabloda OLMAYAN anahtar (tip dışı çağrı, miras anahtar —
 *  `constructor`, `toString`) GEÇEMEZ — kapalı başarısızlık. */
export function tablodakiUcKapisindanGecer<A extends string>(
  tablo: Readonly<Record<A, UcKapisi>>,
  rol: AppRole | null | undefined,
  uc: A,
): boolean {
  if (!rol || !Object.prototype.hasOwnProperty.call(tablo, uc)) return false;
  const kapi = tablo[uc];
  if (kapi === 'staff') return STAFF_ROLES.includes(rol);
  const [koleksiyon, eylem] = kapi;
  return isAllowed(rol, koleksiyon, eylem);
}
