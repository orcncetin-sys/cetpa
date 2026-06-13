/**
 * mfa.ts — Firebase çok faktörlü kimlik doğrulama (2FA) yardımcıları.
 *
 * TOTP (authenticator app) tabanlı — SMS maliyeti/telefon sağlayıcısı
 * gerektirmez. Firebase Console'da Authentication > MFA etkin olmalı
 * (Identity Platform). Kayıt taze oturum gerektirir (recent login).
 */
import {
  multiFactor,
  getMultiFactorResolver,
  TotpMultiFactorGenerator,
  TotpSecret,
  type MultiFactorResolver,
  type MultiFactorError,
  type User,
  type Auth,
} from 'firebase/auth';

/** Kullanıcının kayıtlı 2FA faktörlerini döner. */
export function getEnrolledFactors(user: User): { uid: string; displayName: string | null; factorId: string }[] {
  return multiFactor(user).enrolledFactors.map(f => ({
    uid: f.uid, displayName: f.displayName, factorId: f.factorId,
  }));
}

export function hasMfa(user: User): boolean {
  return multiFactor(user).enrolledFactors.length > 0;
}

/**
 * TOTP kayıt akışı 1. adım: gizli anahtar üret + otpauth URL döner
 * (QR kod ve manuel giriş için). Kullanıcı authenticator'a ekler.
 */
export async function startTotpEnrollment(user: User, issuer = 'CETPA'): Promise<{ secret: TotpSecret; qrUrl: string; secretKey: string }> {
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const qrUrl = secret.generateQrCodeUrl(user.email || user.uid, issuer);
  return { secret, qrUrl, secretKey: secret.secretKey };
}

/**
 * TOTP kayıt akışı 2. adım: kullanıcının authenticator'dan girdiği 6 haneli
 * kodu doğrula ve faktörü kaydet.
 */
export async function finishTotpEnrollment(
  user: User, secret: TotpSecret, code: string, displayName = 'Authenticator',
): Promise<void> {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim());
  await multiFactor(user).enroll(assertion, displayName);
}

/** Kayıtlı bir 2FA faktörünü kaldırır (factor uid ile). */
export async function unenrollFactor(user: User, factorUid: string): Promise<void> {
  await multiFactor(user).unenroll(factorUid);
}

/** Login hatası 2FA gerektiriyor mu? */
export function isMfaRequired(error: unknown): boolean {
  return (error as { code?: string })?.code === 'auth/multi-factor-auth-required';
}

/** Login sırasında 2FA çözücü (resolver) al — challenge modalını sürer. */
export function getMfaResolver(auth: Auth, error: unknown): MultiFactorResolver {
  return getMultiFactorResolver(auth, error as MultiFactorError);
}

/**
 * Login 2FA challenge'ı: kullanıcının girdiği TOTP kodunu doğrulayıp
 * oturumu tamamlar. resolver.hints[0] TOTP faktörü varsayılır.
 */
export async function resolveTotpSignIn(resolver: MultiFactorResolver, code: string): Promise<void> {
  const totpHint = resolver.hints.find(h => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) ?? resolver.hints[0];
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(totpHint.uid, code.trim());
  await resolver.resolveSignIn(assertion);
}
