/**
 * MfaSifirlaDugmesi.tsx — Kullanıcılar ekranında «2FA'yı sıfırla» düğmesi (şartname «dış rol kapanışı» D10, 2026-10-11).
 *
 * NEDEN VAR: `POST /api/mfa/enroll/start` artık ikinci adımı doğrulanmış oturum ister (yalnız parolayı bilen biri kullanıcının
 * iki faktörlü doğrulamasını kapatıp kendi telefonunu bağlayamasın diye). Yan etkisi: telefonunu kaybeden kullanıcı kendi kendine
 * sıfırlayamaz. Kurtarma yolu Yönetici ucudur (`POST /api/admin/users/:uid/mfa-sifirla`) — ama uç tek başına kurtarma yolu
 * DEĞİLDİR: ekranda çağıranı olmasaydı Yönetici elle istek atmak zorunda kalırdı («yazıldı ama bağlanmadı»). Bu düğme o çağırandır.
 *
 * KİM GÖRÜR: sunucudaki kapıyla AYNI kural (`yalnizYoneticiMi` — rol `Admin` ya da süper yönetici; Müdür DEĞİL) ve kişinin KENDİ
 * satırında değil (kendi doğrulamasını kapatmanın yolu kod isteyen Güvenlik ekranıdır; sunucu da 400 döner). Görünürlük yalnız
 * kolaylıktır: kararı sunucu verir, düğmeyi gören ama yetkisi yetmeyen çağıran sunucunun iletisini görür.
 *
 * Onay penceresi ve bildirim ekranın kendi araçlarıdır (`openConfirm`, `toast`) — burada yeniden yazılmaz.
 */
import { useState } from 'react';
import { ShieldOff } from 'lucide-react';
import { authFetch } from '../services/authFetch';
import { APP_ROLES, yalnizYoneticiMi, type AppRole } from '../lib/rbac';

export interface MfaSifirlaGorunurGirdisi {
  /** Oturumdaki kullanıcının rolü (ekranın elindeki ham değer). */
  cagiranRol: string | null | undefined;
  superAdmin: boolean;
  cagiranUid: string | null | undefined;
  hedefUid: string;
}

/** Düğme bu satırda gösterilsin mi? Sunucu kapısıyla aynı kural; kendi satırında ve kimliği bilinmeyen oturumda HAYIR. */
export function mfaSifirlaGorunur(g: MfaSifirlaGorunurGirdisi): boolean {
  if (!g.hedefUid || !g.cagiranUid || g.hedefUid === g.cagiranUid) return false;
  const rol = typeof g.cagiranRol === 'string' && (APP_ROLES as readonly string[]).includes(g.cagiranRol) ? (g.cagiranRol as AppRole) : null;
  return yalnizYoneticiMi(rol, g.superAdmin === true);
}

/** Uç yolu — kimlik yol parçası olarak kaçışlanır. */
export const mfaSifirlaYolu = (uid: string): string => `/api/admin/users/${encodeURIComponent(uid)}/mfa-sifirla`;

const METIN = {
  tr: {
    dugme: '2FA\'yı sıfırla',
    baslik: 'İki faktörlü doğrulamayı (2FA) sıfırla',
    onay: (ad: string) => `${ad} için iki faktörlü doğrulama kaydı silinecek. Kullanıcı bir sonraki girişte kodsuz girer ve doğrulamayı yeniden kurabilir. Yalnız telefonunu kaybeden ya da doğrulama uygulamasına erişemeyen kullanıcı için kullanın.`,
    onayDugmesi: 'Sıfırla',
    sifirlandi: (ad: string) => `${ad}: iki faktörlü doğrulama sıfırlandı.`,
    kayitYoktu: (ad: string) => `${ad}: iki faktörlü doğrulama zaten kurulu değildi.`,
    olmadi: 'İki faktörlü doğrulama sıfırlanamadı.',
  },
  en: {
    dugme: 'Reset 2FA',
    baslik: 'Reset two-factor authentication (2FA)',
    onay: (ad: string) => `The two-factor authentication record for ${ad} will be deleted. The user signs in without a code next time and can set it up again. Use only for a user who lost their phone or cannot reach their authenticator app.`,
    onayDugmesi: 'Reset',
    sifirlandi: (ad: string) => `${ad}: two-factor authentication was reset.`,
    kayitYoktu: (ad: string) => `${ad}: two-factor authentication was not set up.`,
    olmadi: 'Two-factor authentication could not be reset.',
  },
} as const;

interface Props extends MfaSifirlaGorunurGirdisi {
  /** Onay ve bildirimde görünen ad (e-posta ya da görünen ad). */
  hedefAd: string;
  dil: 'tr' | 'en';
  openConfirm: (opts: { title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'default'; onConfirm: () => void }) => void;
  toast: (msg: string, type?: string) => void;
}

export default function MfaSifirlaDugmesi({ hedefUid, hedefAd, cagiranUid, cagiranRol, superAdmin, dil, openConfirm, toast }: Props) {
  const [suruyor, setSuruyor] = useState(false);
  if (!mfaSifirlaGorunur({ hedefUid, cagiranUid, cagiranRol, superAdmin })) return null;
  const t = dil === 'tr' ? METIN.tr : METIN.en;

  const sifirla = async () => {
    setSuruyor(true);
    try {
      const r = await authFetch(mfaSifirlaYolu(hedefUid), { method: 'POST' });
      // Gövde JSON olmayabilir (vekilin hata sayfası): o durumda sunucu iletisi yoktur, genel ileti gösterilir.
      const d = await r.json().catch(() => null) as { success?: boolean; kayitVardi?: boolean; error?: string } | null;
      if (!r.ok || d?.success !== true) { toast(typeof d?.error === 'string' && d.error ? d.error : t.olmadi, 'error'); return; }
      toast(d.kayitVardi === false ? t.kayitYoktu(hedefAd) : t.sifirlandi(hedefAd), d.kayitVardi === false ? 'info' : 'success');
    } catch {
      toast(t.olmadi, 'error');
    } finally {
      setSuruyor(false);
    }
  };

  return (
    <button
      type="button"
      disabled={suruyor}
      aria-busy={suruyor}
      onClick={() => openConfirm({ title: t.baslik, message: t.onay(hedefAd), confirmLabel: t.onayDugmesi, variant: 'danger', onConfirm: () => { void sifirla(); } })}
      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
    >
      <ShieldOff className="w-3 h-3" aria-hidden="true" /> {t.dugme}
    </button>
  );
}
