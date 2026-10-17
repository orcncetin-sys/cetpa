/**
 * DisRolEkrani.tsx — dış rol (B2B / Bayi) hesabının ERP'de gördüğü TEK sayfa ve bu kapının saf koşulları
 * (şartname `.wf/SARTNAME-dis-rol-kapanisi.md` D5, 2026-10-11).
 *
 * NEDEN: bayi ekranı ERP'nin DIŞINDA çalışacak; dış rol ERP hesabıyla yalnız oturum açar. 2026-10-11 ölçümü: dış rol
 * ERP kabuğunu görüyor, 30'dan fazla koleksiyonu (stok maliyeti, bütün müşterilerin teklifleri) akıştan alıyordu.
 * Sunucu bu yüzeyi kendi tarafında kapatır (tek boğaz, D1 / D4′); istemci de kabuğu ÇİZMEZ ve veri İSTEMEZ — yoksa bayi
 * hesabı boş bir ERP kabuğu ve konsolda bir dizi 403 görürdü.
 *
 * Üç saf koşul burada, `App.tsx` yalnız ÇAĞIRIR (bileşende rol adı yazılmaz; üyeliğin tek kaynağı `rbac.ts`
 * `EXTERNAL_ROLES`). Bağ çiti ve uygulama düzeyi davranış testi: `DisRolEkrani.uygulama.test.tsx`.
 *
 * Bu sayfada bayi ekranı BAĞLANTISI yok: o ekran yayında değil; bağlantı bayi dilimiyle eklenir (ölü bağlantı konmaz).
 */
import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { EXTERNAL_ROLES } from '../lib/rbac';
import { disRolMetni } from '../i18n/disRol';

/** Rol dış rol mü? Rol bilinmiyorsa (`null` / `undefined` / boş) HAYIR: rolsüz hesap bu kapının konusu değildir. */
export function disRolMu(rol: string | null | undefined): boolean {
  return typeof rol === 'string' && (EXTERNAL_ROLES as readonly string[]).includes(rol);
}

/**
 * Dış rol sayfası çizilsin mi (ERP kabuğu YERİNE)?
 *
 * `ikiAdimBekliyor` iken HAYIR: iki adımlı doğrulama bekleyen oturumda kendi `users` belgesi okunamaz (403), yani
 * eldeki rol BU oturumun rolü değildir (açılış varsayılanı ya da aynı sekmedeki ÖNCEKİ oturumdan kalma). Doğrulama
 * penceresi kabuğun içinde çizilir; sayfa onun yerine geçseydi, bayi hesabından sonra aynı sekmede giriş yapan ve
 * doğrulaması açık olan personel kodu giremeden takılırdı. Karar, doğrulamadan sonraki yeniden yüklemede verilir.
 */
export function disRolEkraniGosterilir(d: { oturumVar: boolean; rol: string | null | undefined; ikiAdimBekliyor: boolean }): boolean {
  return d.oturumVar && !d.ikiAdimBekliyor && disRolMu(d.rol);
}

/**
 * Sekme kapılı veri dinleyicilerine (`useSekmeVerileri`, stok sayım oturumu) giden sekme.
 *
 * Oturum YOKKEN ve dış rolde BOŞ döner (hiçbir sekme kapısı açılmaz). Oturumu beklemek ŞART: bu dinleyicilerin kendi
 * oturum koşulu yok, bileşen bağlanır bağlanmaz abone oluyorlardı; rol ise oturum dinleyicisi bitince, kullanıcıyla AYNI
 * anda belli olur. Yalnız `disRolMu` sorulsaydı dış rolde akış bağlantısı rol okunmadan ÖNCE açılırdı (abonelikten
 * 400 ms sonra bağlanır). İç rolde tek fark zamanlamadır: bu dinleyiciler bileşen bağlanırken değil, diğer veri
 * dinleyicileriyle birlikte (oturum dinleyicisi bitince) başlar. Ölçüm 2026-10-11: on iç rol + rolsüz hesap × 43 adres,
 * açılış sonu durumu (çizim, istekler, dinleyiciler, akış koleksiyonları, zamanlayıcılar) değişiklik öncesiyle birebir aynı.
 */
export function veriSekmesi(d: { oturumVar: boolean; rol: string | null | undefined; sekme: string }): string {
  return d.oturumVar && !disRolMu(d.rol) ? d.sekme : '';
}

interface DisRolEkraniProps {
  /** Arayüz dili (`tr` | `en`); sayfanın `lang` niteliğine de yazılır. */
  dil: string;
  /** Uygulamanın mevcut çıkış işleyicisi (sunucu çıkışı + oturum kapatma). */
  onCikis: () => void | Promise<void>;
}

/** Yerleşim ve stil «hesabınıza rol atanmamış» ekranının kalıbıdır (`App.tsx` `roleMissing`); fark: kabuğun ÜSTÜNDE değil, YERİNE çizilir. */
export default function DisRolEkrani({ dil, onCikis }: DisRolEkraniProps) {
  const t = disRolMetni(dil);
  const baslik = useRef<HTMLHeadingElement>(null);
  const [cikiyor, setCikiyor] = useState(false);

  // Sayfa bir yükleniyor göstergesinin yerine gelir: odak başlığa taşınır ki ekran okuyucu değişikliği duyursun.
  useEffect(() => { baslik.current?.focus(); }, []);

  // Çıkış sunucu yanıtını bekler (en çok 5 sn). O sürede düğme `disabled`: ikinci tıklama ikinci çıkış isteği atmaz.
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
          <Lock className="w-6 h-6 text-amber-600" />
        </div>
        {/* Renkler tema belirteçlerinden (index.css `--text-*`): `text-gray-*` sınıfları koyu temada yeniden eşlenmiyor. */}
        <h1 ref={baslik} tabIndex={-1} className="font-bold text-base outline-none" style={{ color: 'var(--text-primary)' }}>
          {t.bu_hesap_bayi_hesabidir}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {t.erp_bayi_hesaplarina_kapali}
        </p>
        <button type="button" onClick={cik} disabled={cikiyor} aria-busy={cikiyor} className="apple-button-primary w-full justify-center py-2.5 text-sm">
          {t.cikis}
        </button>
      </div>
    </main>
  );
}
