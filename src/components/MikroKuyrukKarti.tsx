/**
 * MikroKuyrukKarti.tsx — Ayarlar → Mikro panelindeki «Retry Kuyruğu» kartı (başarısız Mikro gönderimleri otomatik yeniden
 * denenir). `MikroSyncPanel.tsx`'ten ayrıldı (K10, 2026-10-11): kart kendi durumunu okur, panel yalnız çizer.
 *
 * K10 — iş SAHİBİNİNDİR (kural: lib/kuyrukSahipligi; sunucu damgası: lib/tenantErisim):
 *   • «Şimdi Dene» SÜZGEÇLİ koşar: yürütücüye bu oturumun kimliği (kullanıcı + rol) verilir. Eskiden argümansız çağrılıyordu —
 *     süzgeç yoktu; sunucu Yönetici'ye bütün kuyruğu listelediği için başkasının işi Yönetici kimliğiyle Mikro'ya gidiyordu.
 *   • Sayılar oturuma göredir: «bekliyor» = bu oturumun göndereceği iş. Rolün gönderemediği kendi işi ve başka kullanıcının işi
 *     AYRI yazılır; düğme onları çalıştırmaz.
 *   • ÖLÜ DÜĞME YOK (İ3): «Şimdi Dene» yalnız gönderilecek iş varken, «Takılanları Kapat» yalnız kapatılabilecek iş varken,
 *     «Ölüleri Temizle» yalnız silinecek iş varken ve rol silebiliyorken çizilir. Kuyruğu yürütemeyen oturumda (dış rol, rolsüz
 *     hesap, oturum yok) istek HİÇ atılmaz, kart çizilmez.
 *   • YÖNETİCİ ÇIKIŞI — iki sınıf, iki çıkış (H9 «devral / kapat»). Yalnız sahibinin oturumunda çalışan iş, sahibi gönder(e)mezse
 *     (ayrıldı / oturum açmıyor ya da rolü yöntemin kapısından geçmiyor) sonsuza dek bekler ve bekçiyi (`retry_queue`) kırmızıda
 *     tutar:
 *       – damgasız (K10 öncesi) eski işi Yönetici DEVRALIR: «bekliyor» sayısındadır, «Şimdi Dene» ile kendi gönderir, sunucu
 *         onu sahibi yapar;
 *       – damgalı (başkasının) işi 24 saatten eskiyse Yönetici KAPATIR: çalıştırılmaz, ölü işaretlenir, Mikro'ya hiçbir şey
 *         gitmez. Damgalı işte devralma YOK — başkasının işini Yönetici kimliğiyle göndermek, kapatılan açığın kendisidir.
 *
 * Bileşende rol ADI yazılmaz: «kim kapatır / kim gönderir» sayıları servisten (aynı saf kuraldan) gelir, silme hakkı
 * `isAllowed` tablosundan sorulur.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { auth } from '../firebase';
import { isAllowed } from '../lib/rbac';
import { KUYRUK_KOLEKSIYONU, type YurutucuKimligi } from '../lib/kuyrukSahipligi';
import { confirmAction } from '../lib/confirm';
import { useAppStore } from '../store/appStore';
import { getSyncQueueStats, clearDeadJobs, takilanIsleriKapat, type KuyrukDurumu } from '../services/syncRetryService';
import { processMikroRetries } from '../services/mikroEvrak';

interface MikroKuyrukKartiProps {
  currentLanguage?: string;
}

export default function MikroKuyrukKarti({ currentLanguage = 'tr' }: MikroKuyrukKartiProps) {
  const t = currentLanguage === 'tr';
  const userRole = useAppStore(s => s.userRole);
  const [durum, setDurum] = useState<KuyrukDurumu | null>(null);
  const [mesgul, setMesgul] = useState(false);

  // Kimlik her ÇAĞRIDA okunur (çizimde değil): isteğin jetonu da `auth.currentUser`'dan gelir — ikisi aynı kullanıcı olmalı.
  const kimlik = useCallback((): YurutucuKimligi => ({ uid: auth.currentUser?.uid, rol: userRole }), [userRole]);
  const yenile = useCallback(async () => {
    try { setDurum(await getSyncQueueStats(kimlik())); }
    catch { /* sessiz: durum okunamadıysa kart çizilmez (eski davranış) */ }
  }, [kimlik]);
  useEffect(() => { void yenile(); }, [yenile]);

  const calistir = async (is: () => Promise<unknown>) => {
    setMesgul(true);
    try { await is(); } finally { await yenile(); setMesgul(false); }
  };
  const kapat = async (adet: number) => {
    const onay = await confirmAction({
      title: t ? 'Takılan işler kapatılsın mı?' : 'Close stuck jobs?',
      message: t
        ? `${adet} iş 24 saatten uzun süredir bekliyor ve bu oturumdan gönderilemiyor (başka kullanıcının işi ya da rolün gönderemediği iş). Kapatılan iş Mikro'ya GÖNDERİLMEZ; kayıt Cetpa'da durur — gerekiyorsa ilgili ekrandan yeniden gönderin.`
        : `${adet} job(s) have been waiting for more than 24 hours and cannot be sent from this session (another user's job, or a job your role cannot send). Closed jobs are NOT sent to Mikro; the record stays in Cetpa — resend it from its own screen if needed.`,
      confirmLabel: t ? 'Kapat' : 'Close',
      variant: 'warning',
    });
    if (!onay) return;
    await calistir(() => takilanIsleriKapat(kimlik()));
  };

  if (!durum) return null;
  const bekleyen = durum.gonderilebilir + durum.rolYetmiyor + durum.baskasinin;
  if (bekleyen === 0 && durum.dead === 0) return null;
  const silebilir = isAllowed(userRole, KUYRUK_KOLEKSIYONU, 'delete');

  return (
    <section
      aria-label={t ? 'Retry Kuyruğu' : 'Retry Queue'}
      className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center justify-between flex-wrap gap-3"
    >
      <div className="flex items-center gap-3">
        <RefreshCw className="w-4 h-4 text-amber-500" />
        <div className="text-sm">
          <span className="font-semibold text-gray-800">{t ? 'Retry Kuyruğu' : 'Retry Queue'}</span>
          <span className="text-gray-500 ml-2">
            {durum.gonderilebilir} {t ? 'bekliyor' : 'queued'}
            {durum.rolYetmiyor > 0 && (
              <span className="text-amber-600"> · {durum.rolYetmiyor} {t ? 'iş rolünüzle gönderilemiyor' : 'cannot be sent with your role'}</span>
            )}
            {durum.baskasinin > 0 && (
              <span> · {durum.baskasinin} {t ? 'iş başka kullanıcının (sahibi oturum açınca gönderilir)' : 'owned by other users (sent when the owner signs in)'}</span>
            )}
            {durum.dead > 0 && <span className="text-red-500"> · {durum.dead} {t ? 'ölü' : 'dead'}</span>}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {durum.gonderilebilir > 0 && (
          <button
            onClick={() => { void calistir(() => processMikroRetries(kimlik())); }}
            disabled={mesgul}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#1a3a5c]/10 text-[#1a3a5c] hover:bg-[#1a3a5c]/20 transition-colors disabled:opacity-50"
          >
            {mesgul ? (t ? 'Deneniyor…' : 'Retrying…') : (t ? 'Şimdi Dene' : 'Retry Now')}
          </button>
        )}
        {durum.kapatilabilir > 0 && (
          <button
            onClick={() => { void kapat(durum.kapatilabilir); }}
            disabled={mesgul}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            {t ? `Takılanları Kapat (${durum.kapatilabilir})` : `Close Stuck (${durum.kapatilabilir})`}
          </button>
        )}
        {durum.temizlenebilir > 0 && silebilir && (
          <button
            onClick={() => { void calistir(() => clearDeadJobs()); }}
            disabled={mesgul}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            {t ? 'Ölüleri Temizle' : 'Clear Dead'}
          </button>
        )}
      </div>
    </section>
  );
}
