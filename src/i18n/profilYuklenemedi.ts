/**
 * profilYuklenemedi.ts — src/components/ProfilYuklenemediEkrani.tsx modülünün KENDİ çeviri sözlüğü (2026-10-17; ELLE yazıldı,
 * biçimi scripts/modul-sozluk-kodmod.py'nin ürettiği sözlüklerle AYNI — modulSozluk.degismez.test.ts bu dosyayı da tarar).
 * Oturum açılışında kendi profili (`users` belgesi) okunamayan hesabın gördüğü tek sayfanın metinleri (şartname «kayıt kapanışı
 * ve kuruş» R1). «Çıkış» ORTAK sözlükten ALINMADI: oradaki `cikis` stok ÇIKIŞI'dır (İngilizcesi 'Out'); buradaki oturum kapatmadır.
 * Kullanım: `profilYuklenemediMetni(currentLanguage).<anahtar>` (dil kodu ya da eski boolean bayrak).
 * Kapsam: src/components/ProfilYuklenemediEkrani.tsx
 */
export const PROFIL_YUKLENEMEDI = {
  tr: {
    profiliniz_yuklenemedi: 'Profiliniz yüklenemedi.',
    aciklama: 'Hesap bilgileriniz şu anda okunamıyor; bağlantı ya da sunucu geçici olarak yanıt vermiyor olabilir. Yeniden deneyin; sorun sürerse CETPA yöneticinize bildirin.',
    yeniden_dene: 'Yeniden dene',
    deneniyor: 'Deneniyor…',
    cikis: 'Çıkış',
  },
  en: {
    profiliniz_yuklenemedi: 'Your profile could not be loaded.',
    aciklama: 'Your account details cannot be read right now; the connection or the server may be temporarily unavailable. Please try again; if the problem persists, let your CETPA administrator know.',
    yeniden_dene: 'Try again',
    deneniyor: 'Trying…',
    cikis: 'Log out',
  },
} as const;

export type ProfilYuklenemediAnahtar = keyof typeof PROFIL_YUKLENEMEDI.tr;
type Sozluk = { readonly [K in ProfilYuklenemediAnahtar]: string };

export function profilYuklenemediMetni(dil: 'tr' | 'en' | boolean | string | undefined): Sozluk {
  const tr = dil === true || dil === 'tr' || dil === undefined;
  return (tr ? PROFIL_YUKLENEMEDI.tr : PROFIL_YUKLENEMEDI.en) as Sozluk;
}
