/**
 * MfaSettings.tsx — İki bileşen (kendi sunucu TOTP 2FA'mız üzerinden):
 *  - MfaSettings: kullanıcı kendi 2FA'sını kurar/kaldırır.
 *  - MfaChallengeModal: girişte 2FA kodu istenince oturumu doğrular.
 *
 * Firebase MFA değil — Spark planında ücretsiz çalışan kendi /api/mfa/*
 * altyapımızı kullanır.
 */
import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, ShieldOff, Loader2, X, KeyRound } from 'lucide-react';
import { getMfaStatus, startEnrollment, finishEnrollment, disableMfa, verifyLogin } from '../lib/mfa';

// ── 2FA kurulum/yönetim (kullanıcı kendi hesabı) ─────────────────────────────
export function MfaSettings({ currentLanguage }: { currentLanguage: 'tr' | 'en' }) {
  const tr = currentLanguage === 'tr';
  const [enabled, setEnabled] = useState(false);
  const [step, setStep] = useState<'idle' | 'qr' | 'disable'>('idle');
  const [otpauth, setOtpauth] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void getMfaStatus().then(s => setEnabled(s.enabled)); }, []);

  const begin = async () => {
    setErr(null); setBusy(true);
    try {
      const { otpauth: o, secretKey: s } = await startEnrollment();
      setOtpauth(o); setSecretKey(s); setStep('qr'); setCode('');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    if (code.length < 6) return;
    setErr(null); setBusy(true);
    try { await finishEnrollment(code); setEnabled(true); setStep('idle'); setCode(''); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const doDisable = async () => {
    if (code.length < 6) return;
    setErr(null); setBusy(true);
    try { await disableMfa(code); setEnabled(false); setStep('idle'); setCode(''); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="apple-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        {enabled ? <ShieldCheck className="w-5 h-5 text-emerald-600" /> : <ShieldOff className="w-5 h-5 text-gray-400" />}
        <h3 className="text-sm font-bold text-gray-900">
          {tr ? 'İki Faktörlü Doğrulama (2FA)' : 'Two-Factor Authentication (2FA)'}
        </h3>
        <span className={`ml-auto text-[10px] font-bold px-2.5 py-1 rounded-full ${enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {enabled ? (tr ? 'Aktif' : 'On') : (tr ? 'Kapalı' : 'Off')}
        </span>
      </div>

      <p className="text-xs text-gray-500">
        {tr
          ? 'Hesabınıza authenticator uygulaması (Google Authenticator, Authy vb.) ile ek güvenlik katmanı ekleyin.'
          : 'Add an extra layer with an authenticator app (Google Authenticator, Authy, etc.).'}
      </p>

      {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      {/* Kapalı → kur / Açık → kaldır */}
      {step === 'idle' && (
        enabled ? (
          <button onClick={() => { setStep('disable'); setCode(''); setErr(null); }} className="apple-button-secondary text-xs text-red-600">
            <ShieldOff className="w-4 h-4" /> {tr ? '2FA Kapat' : 'Disable 2FA'}
          </button>
        ) : (
          <button onClick={begin} disabled={busy} className="apple-button-primary text-xs">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {tr ? '2FA Etkinleştir' : 'Enable 2FA'}
          </button>
        )
      )}

      {/* Kurulum: QR + kod */}
      {step === 'qr' && (
        <div className="space-y-3 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-700">
            {tr ? '1. Authenticator uygulamanızla QR kodu tarayın:' : '1. Scan this QR with your authenticator app:'}
          </p>
          <div className="flex justify-center bg-white p-3 rounded-xl border border-gray-100 w-fit mx-auto">
            {otpauth && <QRCodeSVG value={otpauth} size={160} />}
          </div>
          {secretKey && (
            <p className="text-[10px] text-gray-400 text-center">
              {tr ? 'Manuel kod: ' : 'Manual key: '}<span className="font-mono select-all">{secretKey}</span>
            </p>
          )}
          <p className="text-xs font-semibold text-gray-700">
            {tr ? '2. Uygulamadaki 6 haneli kodu girin:' : '2. Enter the 6-digit code from the app:'}
          </p>
          <div className="flex gap-2">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" inputMode="numeric"
              className="apple-input text-center font-mono text-lg tracking-widest flex-1" />
            <button onClick={verify} disabled={busy || code.length < 6} className="apple-button-primary text-xs whitespace-nowrap">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (tr ? 'Doğrula' : 'Verify')}
            </button>
          </div>
          <button onClick={() => { setStep('idle'); setCode(''); setErr(null); }} className="text-[11px] text-gray-400 hover:underline">
            {tr ? 'İptal' : 'Cancel'}
          </button>
        </div>
      )}

      {/* Kapatma: kod doğrulama */}
      {step === 'disable' && (
        <div className="space-y-3 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
            <KeyRound className="w-4 h-4 text-red-500" />
            {tr ? '2FA kapatmak için mevcut kodu girin:' : 'Enter current code to disable 2FA:'}
          </p>
          <div className="flex gap-2">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" inputMode="numeric"
              className="apple-input text-center font-mono text-lg tracking-widest flex-1" />
            <button onClick={doDisable} disabled={busy || code.length < 6} className="apple-button-secondary text-xs text-red-600 whitespace-nowrap">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (tr ? 'Kapat' : 'Disable')}
            </button>
          </div>
          <button onClick={() => { setStep('idle'); setCode(''); setErr(null); }} className="text-[11px] text-gray-400 hover:underline">
            {tr ? 'Vazgeç' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Girişte 2FA challenge (oturum doğrulama) ─────────────────────────────────
export function MfaChallengeModal({
  currentLanguage, onSuccess, onCancel,
}: {
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
    try { await verifyLogin(code); onSuccess(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
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
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
          placeholder="000000" inputMode="numeric" autoFocus
          className="apple-input text-center font-mono text-2xl tracking-[0.4em] w-full" />
        {err && <p className="text-xs text-red-600 text-center">{err}</p>}
        <button onClick={submit} disabled={busy || code.length < 6} className="apple-button-primary w-full justify-center py-3">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (tr ? 'Doğrula ve Giriş Yap' : 'Verify & Sign In')}
        </button>
      </div>
    </div>
  );
}
