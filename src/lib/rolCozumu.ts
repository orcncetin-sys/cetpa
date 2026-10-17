/**
 * rolCozumu.ts — oturum açılışında ROLÜN çözümü: durum, ret sınıflandırması, yeniden deneme beklemeleri, veri kapısı
 * (2026-10-17, şartname «kayıt kapanışı ve kuruş» R1–R4, R1′, R2′, R2″; kullanıcı kararı «ok ekle»).
 *
 * NEDEN: kullanıcı bildirimi (2026-10-11) «kullanıcım refresh yiyince değişebiliyor … ben adminim normalde». Kendi `users` belgesi
 * okunamayınca (her hata «iki adımlı doğrulama bekliyor» sayılıyordu) ya da son giriş yazımı düşünce rol HİÇ atanmıyor, açılış
 * varsayılanı `Sales` kalıyor ve arayüzün tamamı Satış rolüyle çiziliyordu (sunucu yetkisi etkilenmez — rolü kendi kaydından okur).
 * Artık rol çözülmeden (`'cozuldu'`) ne kabuk çizilir ne veri başlar; okunamayan profil açıkça söylenir.
 *
 * Saf modül: oturum dinleyicisi ve çizim kapısı `App.tsx`'te, bu dosyanın işlevlerini ÇAĞIRIR. Uygulama düzeyi davranış testi:
 * `src/components/DisRolEkrani.uygulama.test.tsx` («R —» bölümleri); saf vektörler: `rolCozumu.test.ts`.
 */
import { DbIstekHatasi } from './dbClient';

/**
 * Oturum açılışında rolün durumu.
 *  - `bekliyor`  : çözüm sürüyor (ya da oturum yok) → yükleniyor görünümü;
 *  - `cozuldu`   : kendi `users` belgesi okundu (rol atandı ya da belgede rol YOK — «rol atanmamış» ekranı ayrıca çizilir);
 *  - `dogrulama` : sunucu iki adımlı doğrulama istiyor (403 + `mfaRequired`) → doğrulama penceresi;
 *  - `okunamadi` : yeniden denemeler bitti, profil okunamadı → «Profiliniz yüklenemedi.» + «Yeniden dene» + «Çıkış».
 */
export type RolDurumu = 'bekliyor' | 'cozuldu' | 'dogrulama' | 'okunamadi';

/** Kendiliğinden yeniden denemeler arasındaki beklemeler (artan): ilk denemeden sonra en çok ÜÇ deneme daha, sonra `okunamadi`. */
export const ROL_YENIDEN_DENEME_MS: readonly number[] = Object.freeze([1_000, 3_000, 9_000]);

/** Ret sınıfı: `dogrulama` YALNIZ 403 + `mfaRequired: true`; diğer her ret (401, başka 403, 429, 5xx, ağ, beklenmeyen) yeniden denenir. */
export type ProfilHatasi =
  | { tur: 'dogrulama'; durum: 403 }
  | { tur: 'yeniden'; durum: number | 'ağ' };

/**
 * Oturum açılışındaki reddi sınıflandırır (R2). Durum kodu ve gövde `DbIstekHatasi`ndan okunur; ileti metnine BAKILMAZ. `durum`
 * günlüğe yazılan TEK bilgidir (R4: e-posta / kimlik yazılmaz): sunucu reddinde HTTP kodu, başka her hatada (ağ, belirteç alınamadı,
 * beklenmeyen istisna) `'ağ'`.
 */
export function profilHatasiSinifi(e: unknown): ProfilHatasi {
  if (!(e instanceof DbIstekHatasi)) return { tur: 'yeniden', durum: 'ağ' };
  const govde = e.govde;
  const mfa = typeof govde === 'object' && govde !== null && (govde as { mfaRequired?: unknown }).mfaRequired === true;
  if (e.status === 403 && mfa) return { tur: 'dogrulama', durum: 403 };
  return { tur: 'yeniden', durum: e.status };
}

/**
 * Veri kapısı (R1′): `user`'a bakan HER veri kapısı (dinleyiciler, akış bağlantısı, rapor özeti, Mikro zamanlayıcısı, sekme kapılı
 * kanca…) oturumu BU değerden alır; kapı efekt efekt yazılmaz. Rol çözülmeden (`'cozuldu'` değilken) ve belgede rol YOKKEN
 * (`rolYok` — «rol atanmamış» hesap; o durumda `userRole` açılış varsayılanındadır) `null`: sorgu Satış biçimiyle kurulmaz.
 */
export function veriOturumuSec<T>(user: T | null, rolDurumu: RolDurumu, rolYok: boolean): T | null {
  return rolDurumu === 'cozuldu' && !rolYok ? user : null;
}
