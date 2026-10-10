/**
 * magazaPanelKod.ts — «ERP ile bağlan» yetki kodu deposu + PKCE benzeri meydan yardımcıları (dilim 2a, § 3.1–3.3, 3.8).
 *
 * DEPO TEK ÖRNEKTİR: server.ts BİR kez kurar ve iki bağlama da — yazan `magazaErpRoutes.ts` ile okuyup silen
 * `/api/magaza/panel/oturum` (`magazaPanelZinciri.ts`) — AYNI tanımlayıcıyı verir (her modül kendi `Map`'ini kursaydı her
 * değişim 401 dönerdi; kapı 2 aci2-B5). Bellekte (tek süreç); süreç 60 sn içinde yeniden başlarsa bağlanma yinelenir.
 *
 * KURALLAR:
 *  • Kullanıcı başına EN ÇOK 1 canlı kod (`uid → kodÖzeti` dizini; yeni kod öncekini siler) → toplam girdi ≤ yetkili
 *    kullanıcı sayısı; süresi dolanlar her yazımda süpürülür. «En eski düşer» tahliyesi YOK (başkasının canlı kodunu düşürüyordu).
 *  • `al(kodOzeti)` EŞZAMANLI siler ve döndürür (eşleşsin eşleşmesin TEK deneme). Çağıran bunu herhangi bir `await`'ten ÖNCE
 *    yapar (kapı ölçümü: silme beklemeden sonraya kalınca aynı kod 3 belirteç üretti). Süre denetimi silinmiş kopyada çağıranındır.
 *  • Meydan: `base64url(sha256(<doğrulayıcı METNİ, UTF-8>))` — ham 32 bayt DEĞİL (PKCE S256 ile aynı; mağaza 2026-10-08'de
 *    böyle uyguladı). Karşılaştırma eşit bayt uzunluğu + `timingSafeEqual`.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Kod ömrü (ms). */
export const MAGAZA_PANEL_KOD_OMRU_MS = 60_000;

export interface PanelKodKaydi {
  /** sha256(kod) onaltılık — kodun KENDİSİ saklanmaz. */
  kodOzeti: string;
  meydan: string;
  uid: string;
  cid: string;
  /** `panelKullanicisi(uid).ad` — temizlenmiş, ≤ 80 birim. */
  ad: string;
  eposta: string;
  /** Veriliş anında MFA açık mıydı. */
  mfa: boolean;
  /** ms; `şimdi + MAGAZA_PANEL_KOD_OMRU_MS`. */
  bitis: number;
}

export interface PanelKodDeposu {
  ver: (kayit: PanelKodKaydi) => void;
  /** Eşzamanlı: kaydı siler ve döndürür; yoksa `undefined`. */
  al: (kodOzeti: string) => PanelKodKaydi | undefined;
  /** Test / bekçi: canlı girdi sayısı. */
  boyut: () => number;
}

export function kodDeposuKur(D: { simdi?: () => Date } = {}): PanelKodDeposu {
  const kayitlar = new Map<string, PanelKodKaydi>();
  const uidDizini = new Map<string, string>();
  const simdiMs = (): number => (D.simdi?.() ?? new Date()).getTime();
  const sil = (kodOzeti: string): PanelKodKaydi | undefined => {
    const k = kayitlar.get(kodOzeti);
    if (!k) return undefined;
    kayitlar.delete(kodOzeti);
    if (uidDizini.get(k.uid) === kodOzeti) uidDizini.delete(k.uid);
    return k;
  };
  return {
    ver(kayit) {
      const suan = simdiMs();
      for (const [ozet, k] of kayitlar) if (k.bitis <= suan) sil(ozet);
      const onceki = uidDizini.get(kayit.uid);
      if (onceki !== undefined) sil(onceki);
      kayitlar.set(kayit.kodOzeti, kayit);
      uidDizini.set(kayit.uid, kayit.kodOzeti);
    },
    al(kodOzeti) { return sil(kodOzeti); },
    boyut() { return kayitlar.size; },
  };
}

/** 32 rastgele bayt → 43 karakter base64url (kod, doğrulayıcı). */
export function panelKoduUret(): string {
  return randomBytes(32).toString('base64url');
}

/** Depo anahtarı: sha256(kod) onaltılık. */
export function kodOzetiHesapla(kod: string): string {
  return createHash('sha256').update(kod, 'utf8').digest('hex');
}

/** `base64url(sha256(doğrulayıcı METNİ))` — 43 karakter. */
export function meydanHesapla(dogrulayici: string): string {
  return createHash('sha256').update(dogrulayici, 'utf8').digest('base64url');
}

/** Eşit bayt uzunluğu + sabit zamanlı karşılaştırma; uzunluk farkı da «eşleşmedi»dir (fırlatmaz). */
export function meydanEslesiyor(dogrulayici: string, meydan: string): boolean {
  const a = Buffer.from(meydanHesapla(dogrulayici), 'utf8');
  const b = Buffer.from(meydan, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
