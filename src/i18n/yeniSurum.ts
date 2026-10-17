/**
 * yeniSurum.ts — src/components/YeniSurumSeridi.tsx modülünün KENDİ çeviri sözlüğü (2026-10-17; ELLE yazıldı,
 * biçimi scripts/modul-sozluk-kodmod.py'nin ürettiği sözlüklerle AYNI — modulSozluk.degismez.test.ts bu dosyayı da tarar).
 * «Yeni sürüm var, yenile» şeridinin metinleri (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S3, S4, S6).
 * Dil, sayfanın `<html lang>` niteliğinden okunur (App seçili dile göre günceller); şerit App'in dil durumunun dışında,
 * kökte durur — giriş ekranında ve dış rol sayfasında da aynı şerittir.
 * Kullanım: `yeniSurumMetni(dil).<anahtar>`.
 * Kapsam: src/components/YeniSurumSeridi.tsx
 */
export const YENI_SURUM = {
  tr: {
    yeni_surum_yayinda: 'Yeni sürüm yayında. Kaydedilmemiş işiniz yoksa yenileyin.',
    bu_sayfa_icin_yenileme_gerekiyor: 'Bu sayfa için yenileme gerekiyor',
    yenile: 'Yenile',
    bildirimi_kapat: 'Bildirimi kapat',
  },
  en: {
    yeni_surum_yayinda: 'A new version is live. Reload if you have no unsaved work.',
    bu_sayfa_icin_yenileme_gerekiyor: 'This page needs a reload',
    yenile: 'Reload',
    bildirimi_kapat: 'Dismiss notification',
  },
} as const;

export type YeniSurumAnahtar = keyof typeof YENI_SURUM.tr;
type Sozluk = { readonly [K in YeniSurumAnahtar]: string };

/** `<html lang>` değeri: 'en' (ya da 'en-…') İngilizce; başka her şey (boş dâhil) Türkçe — sayfanın varsayılanı `lang="tr"`. */
export function yeniSurumMetni(dil: string | undefined): Sozluk {
  const en = typeof dil === 'string' && /^en(?:-|$)/i.test(dil);
  return (en ? YENI_SURUM.en : YENI_SURUM.tr) as Sozluk;
}
