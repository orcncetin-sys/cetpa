/**
 * mfa.ts — Kendi sunucumuz üzerinden TOTP 2FA istemci yardımcıları.
 *
 * Firebase MFA (Blaze + Identity Platform gerektirir) YERİNE kendi Express +
 * PostgreSQL altyapımızı kullanır — Spark planında ücretsiz çalışır.
 * Secret'lar yalnız sunucuda (mfa_secrets tablosu); istemci hiç görmez.
 * Doğrulama httpOnly __cetpa_mfa çerezi ile taşınır.
 */
import { auth } from '../firebase';

async function authedFetch(path: string, body?: unknown): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Oturum yok.');
  const token = await user.getIdToken();
  return fetch(path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** MFA durumu: açık mı + bu oturum doğrulanmış mı? */
export async function getMfaStatus(): Promise<{ enabled: boolean; verified: boolean }> {
  try {
    const res = await authedFetch('/api/mfa/status');
    if (!res.ok) return { enabled: false, verified: true };
    return await res.json();
  } catch { return { enabled: false, verified: true }; }
}

/** Kayıt 1. adım: otpauth URL + manuel secret döner (QR için). */
export async function startEnrollment(): Promise<{ otpauth: string; secretKey: string }> {
  const res = await authedFetch('/api/mfa/enroll/start', {});
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Kayıt başlatılamadı.');
  return res.json();
}

/** Kayıt 2. adım: kodu doğrula → 2FA aktif + oturum doğrulanır. */
export async function finishEnrollment(code: string): Promise<void> {
  const res = await authedFetch('/api/mfa/enroll/verify', { code });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Kod hatalı.');
}

/** Girişte 2FA challenge: kodu doğrula → oturum doğrulanır. */
export async function verifyLogin(code: string): Promise<void> {
  const res = await authedFetch('/api/mfa/verify', { code });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Kod hatalı.');
}

/** 2FA'yı kapat (mevcut kod doğrulamasıyla). */
export async function disableMfa(code: string): Promise<void> {
  const res = await authedFetch('/api/mfa/disable', { code });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'İşlem başarısız.');
}
