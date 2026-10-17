/**
 * disRol.ts — src/components/DisRolEkrani.tsx modülünün KENDİ çeviri sözlüğü (2026-10-11; ELLE yazıldı,
 * biçimi scripts/modul-sozluk-kodmod.py'nin ürettiği sözlüklerle AYNI — modulSozluk.degismez.test.ts bu dosyayı da tarar).
 * Dış rol (B2B / Bayi) hesabının ERP'de gördüğü tek sayfanın metinleri (şartname dış-rol-kapanışı D5).
 * «Çıkış» ORTAK sözlükten ALINMADI: oradaki `cikis` stok ÇIKIŞI'dır (İngilizcesi 'Out'); buradaki oturum kapatmadır.
 * Bayi ekranı bağlantısı YOK: o ekran yayında değil; bağlantı bayi dilimiyle eklenir (ölü bağlantı konmaz).
 * Kullanım: `disRolMetni(currentLanguage).<anahtar>` (dil kodu ya da eski boolean bayrak).
 * Kapsam: src/components/DisRolEkrani.tsx
 */
export const DIS_ROL = {
  tr: {
    bu_hesap_bayi_hesabidir: 'Bu hesap bayi hesabıdır',
    erp_bayi_hesaplarina_kapali: 'ERP ekranı bayi hesaplarına kapalıdır. Sipariş ve bilgi için CETPA ile iletişime geçin.',
    cikis: 'Çıkış',
  },
  en: {
    bu_hesap_bayi_hesabidir: 'This is a dealer account',
    erp_bayi_hesaplarina_kapali: 'The ERP screen is closed to dealer accounts. For orders and information, please contact CETPA.',
    cikis: 'Log out',
  },
} as const;

export type DisRolAnahtar = keyof typeof DIS_ROL.tr;
type Sozluk = { readonly [K in DisRolAnahtar]: string };

export function disRolMetni(dil: 'tr' | 'en' | boolean | string | undefined): Sozluk {
  const tr = dil === true || dil === 'tr' || dil === undefined;
  return (tr ? DIS_ROL.tr : DIS_ROL.en) as Sozluk;
}
