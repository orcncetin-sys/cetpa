/**
 * MfaSettings.tsx — İki bileşen:
 *  - MfaSettings: kullanıcı kendi 2FA'sını (TOTP) kurar/kaldırır.
 *  - MfaChallengeModal: girişte 2FA kodu istenince çözücüyü tamamlar.
 *
 * Firebase Console'da Authentication > Multi-factor (TOTP) etkin olmalı.
 */
import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, ShieldOff, Loader2, X, KeyRound } from 'lucide-react';
import type { TotpSecret, User, MultiFactorResolver } from 'firebase/auth';
import {
  getEnrolledFactors, hasMfa, startTotpEnrollment, finishTotpEnrollment,
  unenrollFactor, resolveTotpSignIn,
} from '../lib/mfa';

// ── 2FA kurulum/yönetim (kullanıcı kendi hesabı) ─────────────────────────────
export function MfaSettings({ user, currentLanguage }: { user: User; currentLanguage: 'tr' | 'en' }) {
  const tr = currentLanguage === 'tr';
  const [factors, setFactors] = useState(() => getEnrolledFactors(user));
  const [step, setStep] = useState<'idle' | 'qr' | 'verify'>('idle');
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const begin = async () => {
    setErr(null); setBusy(true);
    try {
      const { secret: s, qrUrl: q } = await startTotpEnrollment(user);
      setSecret(s); setQrUrl(q); setStep('qr');
    } catch (e) {
      setErr(reauthMsg(e, tr));
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (!secret || code.length < 6) return;
    setErr(null); setBusy(true);
    try {
      await finishTotpEnrollment(user, secret, code);
      setFactors(getEnrolledFactors(user));
      setStep('idle'); setCode(''); setSecret(null);
    } catch {
      setErr(tr ? 'Kod hatalı veya süresi doldu. Tekrar deneyin.' : 'Invalid or expired code. Try again.');
    } finally { setBusy(false); }
  };

  const remove = async (uid: string) => {
    setErr(null); setBusy(true);
    try {
      await unenrollFactor(user, uid);
      setFactors(getEnrolledFactors(user));
    } catch (e) {
      setErr(reauthMsg(e, tr));
    } finally { setBusy(false); }
  };

  return (
    <div className="apple-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        {hasMfa(user)
          ? <ShieldCheck className="w-5 h-5 text-emerald-600" />
          : <ShieldOff className="w-5 h-5 text-gray-400" />}
        <h3 className="text-sm font-bold text-gray-900">
          {tr ? 'İki Faktörlü Doğrulama (2FA)' : 'Two-Factor Authentication (2FA)'}
        </h3>
        <span className={`ml-auto text-[10px] font-bold px-2.5 py-1 rounded-full ${hasMfa(user) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {hasMfa(user) ? (tr ? 'Aktif' : 'On') : (tr ? 'Kapalı' : 'Off')}
        </span>
      </div>

      <p className="text-xs text-gray-500">
        {tr
          ? 'Hesabınıza authenticator uygulaması (Google Authenticator, Authy vb.) ile ek güvenlik katmanı ekleyin.'
          : 'Add an extra layer with an authenticator app (Google Authenticator, Authy, etc.).'}
      </p>

      {/* Kayıtlı faktörler */}
      {factors.length > 0 && (
        <div className="space-y-2">
          {factors.map(f => (
            <div key={f.uid} className="flex items-center justify-between border border-gray-100 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-semibold text-gray-800">{f.displayName || 'Authenticator'}</span>
              </div>
              <button onClick={() => remove(f.uid)} disabled={busy}
                className="text-[11px] font-bold text-red-600 hover:underline disabled:opacity-50">
                {tr ? 'Kaldır' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      {/* Kurulum akışı */}
      {step === 'idle' && (
        <button onClick={begin} disabled={busy} className="apple-button-primary text-xs">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          {factors.length > 0 ? (tr ? 'Yeni Cihaz Ekle' : 'Add Device') : (tr ? '2FA Etkinleştir' : 'Enable 2FA')}
        </button>
      )}

      {step === 'qr' && (
        <div className="space-y-3 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-700">
            {tr ? '1. Authenticator uygulamanızla QR kodu tarayın:' : '1. Scan this QR with your authenticator app:'}
          </p>
          <div className="flex justify-center bg-white p-3 rounded-xl border border-gray-100 w-fit mx-auto">
            {qrUrl && <QRCodeSVG value={qrUrl} size={160} />}
          </div>
          {secret && (
            <p className="text-[10px] text-gray-400 text-center">
              {tr ? 'Manuel kod: ' : 'Manual key: '}<span className="font-mono select-all">{secret.secretKey}</span>
            </p>
          )}
          <p className="text-xs font-semibold text-gray-700">
            {tr ? '2. Uygulamadaki 6 haneli kodu girin:' : '2. Enter the 6-digit code from the app:'}
          </p>
          <div className="flex gap-2">
            <input
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" inputMode="numeric"
              className="apple-input text-center font-mono text-lg tracking-widest flex-1"
            />
            <button onClick={verify} disabled={busy || code.length < 6} className="apple-button-primary text-xs whitespace-nowrap">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (tr ? 'Doğrula' : 'Verify')}
            </button>
          </div>
          <button onClick={() => { setStep('idle'); setCode(''); setErr(null); }} className="text-[11px] text-gray-400 hover:underline">
            {tr ? 'İptal' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Girişte 2FA challenge (resolver tamamlama) ───────────────────────────────
export function MfaChallengeModal({
  resolver, currentLanguage, onSuccess, onCancel,
}: {
  resolver: MultiFactorResolver;
  currentLanguage: 'tr' | 'en';
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const tr = currentLanguage === 'tr';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (code.length < 6) return;
    setErr(null); setBusy(true);
    try {
      await resolveTotpSignIn(resolver, code);
      onSuccess();
    } catch {
      setErr(tr ? 'Kod hatalı veya süresi doldu.' : 'Invalid or expired code.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-brand" />
            {tr ? 'İki Faktörlü Doğrulama' : 'Two-Factor Verification'}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-500">
          {tr ? 'Authenticator uygulamanızdaki 6 haneli kodu girin.' : 'Enter the 6-digit code from your authenticator app.'}
        </p>
        <input
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
          placeholder="000000" inputMode="numeric" autoFocus
          className="apple-input text-center font-mono text-2xl tracking-[0.4em] w-full"
        />
        {err && <p className="text-xs text-red-600 text-center">{err}</p>}
        <button onClick={submit} disabled={busy || code.length < 6} className="apple-button-primary w-full justify-center py-3">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (tr ? 'Doğrula ve Giriş Yap' : 'Verify & Sign In')}
        </button>
      </div>
    </div>
  );
}

/** Firebase 'recent login required' hatasını kullanıcı diline çevirir. */
function reauthMsg(e: unknown, tr: boolean): string {
  const code = (e as { code?: string })?.code;
  if (code === 'auth/requires-recent-login') {
    return tr ? 'Bu işlem için yeniden giriş yapmanız gerekir. Çıkış yapıp tekrar girin.' : 'Please sign in again to perform this action.';
  }
  return tr ? `İşlem başarısız: ${code || 'bilinmeyen hata'}` : `Failed: ${code || 'unknown error'}`;
}
