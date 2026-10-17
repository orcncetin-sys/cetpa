/**
 * ProfilYuklenemediEkrani.tsx — oturum açılışında kendi profili (`users/<uid>`) okunamayan hesabın gördüğü TEK sayfa
 * (2026-10-17, şartname «kayıt kapanışı ve kuruş» R1 / R2 / R2″).
 *
 * NEDEN: eskiden profil okunamayınca rol hiç atanmıyor, açılış varsayılanı (`Sales`) kalıyor ve ERP kabuğu Satış rolüyle
 * çiziliyordu (kullanıcı bildirimi 2026-10-11: «refresh yiyince rolüm değişiyor»). Artık kabuk ÇİZİLMEZ ve veri İSTENMEZ
 * (App.tsx çizim kapısı + `veriOturumu`); kendiliğinden yapılan yeniden denemeler bitince bu sayfa çizilir.
 *
 * «Yeniden dene» oturum açılışının AYNI çözümünü (iki adımlı doğrulama durumu, davet, profil okuma, sahip kurulumu) baştan koşar;
 * çözüm sürerken düğme pasiftir (`suruyor`) — iki tıklama iki paralel çözüm başlatmaz. ÇIKIŞ sürerken de pasiftir (`cikiyor`;
 * inceleme 2 İ2-a, 2026-10-17): çıkış sunucu yanıtını beklerken oturum hâlâ açıktır, o arada başlayan çözüm Yönetici kabuğunu
 * açıyordu. Etiket «Yeniden dene» kalır (çözüm sürmüyor — «Deneniyor…» yanıltırdı). Aynı kapı App.tsx'te de var
 * (`cikisSuruyorRef`): bu düğme ilk katmandır. «Çıkış» uygulamanın mevcut çıkış işleyicisi.
 * Yerleşim ve stil `DisRolEkrani.tsx`'in kalıbıdır (kabuğun ÜSTÜNDE değil, YERİNE çizilir).
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { profilYuklenemediMetni } from '../i18n/profilYuklenemedi';

interface ProfilYuklenemediEkraniProps {
  /** Arayüz dili (`tr` | `en`); sayfanın `lang` niteliğine de yazılır. */
  dil: string;
  /** Oturum açılışının çözümünü baştan koşar (App.tsx). */
  onYenidenDene: () => void;
  /** Çözüm sürüyor mu — sürerken «Yeniden dene» pasif. */
  suruyor: boolean;
  /** Uygulamanın mevcut çıkış işleyicisi (sunucu çıkışı + oturum kapatma). */
  onCikis: () => void | Promise<void>;
}

export default function ProfilYuklenemediEkrani({ dil, onYenidenDene, suruyor, onCikis }: ProfilYuklenemediEkraniProps) {
  const t = profilYuklenemediMetni(dil);
  const baslik = useRef<HTMLHeadingElement>(null);
  const [cikiyor, setCikiyor] = useState(false);

  // Sayfa bir yükleniyor göstergesinin yerine gelir: odak başlığa taşınır ki ekran okuyucu değişikliği duyursun.
  useEffect(() => { baslik.current?.focus(); }, []);

  // Çıkış sunucu yanıtını bekler (en çok 5 sn). O sürede iki düğme de `disabled`: ikinci tıklama ikinci çıkış isteği atmaz,
  // «Yeniden dene» kapanmakta olan oturumda çözüm başlatmaz (İ2-a).
  const cik = async () => {
    setCikiyor(true);
    try { await onCikis(); } finally { setCikiyor(false); }
  };

  return (
    // `pb-48 sm:pb-4`: dar ekranda «Yeni sürüm yayında» şeridi (YeniSurumSeridi, `fixed`, alttan ~178 px) kartın düğmelerini
    // örtmesin; 640 px ve üstünde şerit tek satıra iner (yayin-16 birleşme incelemesi).
    <main
      lang={dil}
      className="min-h-screen flex items-center justify-center p-4 pb-48 sm:pb-4 font-avenir"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <div className="apple-card max-w-md w-full p-8 space-y-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto" aria-hidden="true">
          <AlertTriangle className="w-6 h-6 text-amber-600" />
        </div>
        {/* Renkler tema belirteçlerinden (index.css `--text-*`): `text-gray-*` sınıfları koyu temada yeniden eşlenmiyor. */}
        <h1 ref={baslik} tabIndex={-1} className="font-bold text-base outline-none" style={{ color: 'var(--text-primary)' }}>
          {t.profiliniz_yuklenemedi}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {t.aciklama}
        </p>
        <button type="button" onClick={onYenidenDene} disabled={suruyor || cikiyor} aria-busy={suruyor} className="apple-button-primary w-full justify-center py-2.5 text-sm">
          {suruyor ? t.deneniyor : t.yeniden_dene}
        </button>
        <button type="button" onClick={cik} disabled={cikiyor} aria-busy={cikiyor} className="apple-button-secondary w-full justify-center py-2.5 text-sm">
          {t.cikis}
        </button>
      </div>
    </main>
  );
}
