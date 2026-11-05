/**
 * Müşteri / bayi ekranı «ERP ile giriş» onay sayfası — `/magaza-bayi-baglan#meydan=…&tur=…` (2026-10-21, şartname
 * `.wf/SARTNAME-musteri-siparislerim.md` K4, K5, H4, H16).
 *
 * Bayi ekranı (`www.cetpa.com.tr/bayi.html`) AYNI sekmeyi buraya yollar; müşteri hesabı (ERP rolü B2B / Bayi) onaylarsa sunucu tek
 * kullanımlık yetki kodunu taşıyan dönüş adresini verir ve sekme bayi ekranına döner. Panel onay sayfasının (`MagazaPanelBaglanPage`)
 * eşidir ama AYRI dosyadır: panel sayfasının çiti efekt kancasına izin vermez, bu sayfa ise firma adını açılışta okur.
 *
 * GÜVENLİK SÖZLEŞMESİ (çitleri `MagazaBayiBaglanPage.test.tsx`):
 *  • Açılışta TEK efekt, TEK istek: `GET /api/magaza-bayi/hesap` (yalnız `{ firma }` döner — kod üretmez). Firma gelmezse ya da okuma
 *    hata verirse onay düğmesi ÇİZİLMEZ.
 *  • `yetki-kodu` isteği YALNIZ düğmenin `click` işleyicisinde (`onayla`) gider; efektte, yüklenişte, MFA dönüşünde kendiliğinden
 *    çağrı YOK. Saldırganın hazırladığı bağlantıda doğrulayıcı saldırgandadır; kalan engel kullanıcının bilinçli tıklamasıdır.
 *  • Parametreler İLK çizimde bir kez okunur ve panelle ORTAK işlevden geçer (`lib/magazaPanelBaglan` — kopya yok). Biçim tutmuyorsa
 *    düğme ÇİZİLMEZ.
 *  • Dönüş adresi yalnız `window.location.replace`'e gider (ortak `baglanDonusuGecerli` ikinci kilidiyle): duruma, günlüğe YAZILMAZ.
 *  • İstemci rolüyle kapı YOK: hüküm sunucudan (iç rol, rolsüz hesap, bağsız / kapalı bağ, Google girişi hepsi sunucunun `kod`'uyla).
 *  • Ret metni yanıtın `kod` / `code` / `mfaRequired` alanından ve durum kodundan; sunucunun `error` metni OKUNMAZ, basılmaz.
 *  • Yeniden giriş (`yeniden-giris` — ERP girişi 12 saatten eski ya da çıkıştan önceki; `sifre-gerekli` — Google girişi): sayfa içinde
 *    yeniden doğrulama YOK; «Çıkış yap» App'in çıkış işleyicisini çağırır, kullanıcı giriş ekranında e-posta ve şifreyle yeniden girer.
 *    Yol ve parça yerinde kaldığı için (useRouteSync bu yolda adrese dokunmaz) girişten sonra bu sayfa yeniden çizilir.
 */
import { useEffect, useRef, useState } from 'react';
import { MfaChallengeModal } from '../components/MfaSettings';
import { baglanDonusuGecerli, baglanParametreleri, type BaglanParametreleri } from '../lib/magazaPanelBaglan';
import { authFetch } from '../services/authFetch';
import type { Language } from '../translations';

/** Firma okuma ucu (ERP kökeni; `src/server/routes/magazaErpRoutes.ts`) — yetki kodu ucuyla AYNI yetki işlevinden geçer. */
const HESAP_UCU = '/api/magaza-bayi/hesap';

type HataKodu =
  | 'yeniden-giris' | 'oturum' | 'rol' | 'bag' | 'kiraci' | 'denetlenemedi' | 'sinir' | 'yapilandirilmamis' | 'firma-yok'
  | 'okuma' | 'ag';
type Okuma =
  | { tur: 'okunuyor' }
  | { tur: 'tamam'; firma: string }
  | { tur: 'mfa' }
  | { tur: 'hata'; kod: HataKodu };
type Islem =
  | { tur: 'bos' }
  | { tur: 'gonderiliyor' }
  | { tur: 'yonleniyor' }
  | { tur: 'mfa' }
  | { tur: 'mfa-tamam' }
  | { tur: 'hata'; kod: HataKodu };

/** «Çıkış yap» düğmesini getiren retler: oturumla düzelir (sayfa içinde yeniden doğrulama yok). */
const CIKIS_GEREKEN: ReadonlySet<HataKodu> = new Set<HataKodu>(['yeniden-giris', 'oturum']);
/** Firma okumasında «Yeniden dene» gösterilen geçici retler. */
const GECICI: ReadonlySet<HataKodu> = new Set<HataKodu>(['denetlenemedi', 'sinir', 'okuma', 'ag']);

interface Metin {
  baslik: string;
  kullaniciEtiket: string;
  firmaEtiket: string;
  hedefEtiket: string;
  hedef: string;
  yetkiEtiket: string;
  yetki: string;
  okunuyor: string;
  uyari: string;
  dugme: string;
  gonderiliyor: string;
  cikis: string;
  yenidenDene: string;
  bozuk: string;
  mfaSonrasi: string;
  hata: Record<HataKodu, string>;
}

/** Sayfanın KENDİ iki dilli sözlüğü: ekrana basılan her metin buradan (sunucu metni basılmaz). */
const METIN: Record<Language, Metin> = {
  tr: {
    baslik: 'Bayi ekranına giriş',
    kullaniciEtiket: 'Oturum açan kullanıcı',
    firmaEtiket: 'Firma',
    hedefEtiket: 'Bağlanılacak yer',
    hedef: 'www.cetpa.com.tr bayi ekranı',
    yetkiEtiket: 'Verilecek yetki',
    yetki: 'Firmanızın siparişlerini görme (salt okuma); 8 saat',
    okunuyor: 'Hesap bilgisi okunuyor…',
    uyari: 'Bu isteği siz başlatmadıysanız onaylamayın.',
    dugme: 'Onayla ve giriş yap',
    gonderiliyor: 'Bağlanıyor…',
    cikis: 'Çıkış yap',
    yenidenDene: 'Yeniden dene',
    bozuk: 'Bağlantı isteği eksik ya da bozuk. Bayi ekranındaki «ERP ile giriş» düğmesiyle yeniden başlatın.',
    mfaSonrasi: 'Doğrulama tamamlandı. Giriş için düğmeye yeniden basın.',
    hata: {
      'yeniden-giris': 'Güvenlik için çıkış yapıp e-posta ve şifrenizle yeniden girin. Şifreniz yoksa giriş ekranındaki «Şifremi Unuttum» ile oluşturun.',
      oturum: 'Oturumunuz geçerli değil. Çıkış yapıp e-posta ve şifrenizle yeniden girin.',
      rol: 'Bu bağlantı yalnız müşteri hesapları içindir.',
      bag: 'Hesabınız bir firmaya bağlı değil ya da erişiminiz kapalı — Cetpa ile görüşün.',
      kiraci: 'Bu hesap bayi ekranının bağlı olduğu şirkete ait değil ya da şirket hesabı askıda — Cetpa ile görüşün.',
      denetlenemedi: 'Şu an doğrulanamadı, biraz sonra yeniden deneyin.',
      sinir: 'Çok fazla deneme yapıldı. Bir süre sonra yeniden deneyin.',
      yapilandirilmamis: 'Bayi ekranı bağlantısı sunucuda henüz yapılandırılmamış — Cetpa ile görüşün.',
      'firma-yok': 'Hesabınızın firma bilgisi eksik — Cetpa ile görüşün.',
      okuma: 'Sunucu isteği şu an tamamlayamadı. Bir süre sonra yeniden deneyin.',
      ag: 'Sunucuya ulaşılamadı. Bağlantınızı denetleyip yeniden deneyin.',
    },
  },
  en: {
    baslik: 'Sign in to the dealer screen',
    kullaniciEtiket: 'Signed-in user',
    firmaEtiket: 'Company',
    hedefEtiket: 'Destination',
    hedef: 'www.cetpa.com.tr dealer screen',
    yetkiEtiket: 'Access granted',
    yetki: 'View your company’s orders (read only); 8 hours',
    okunuyor: 'Reading account details…',
    uyari: 'Do not approve if you did not start this request yourself.',
    dugme: 'Approve and sign in',
    gonderiliyor: 'Connecting…',
    cikis: 'Sign out',
    yenidenDene: 'Try again',
    bozuk: 'The sign-in request is missing or malformed. Start again with the “Sign in with ERP” button on the dealer screen.',
    mfaSonrasi: 'Verification complete. Press the button again to sign in.',
    hata: {
      'yeniden-giris': 'For security, sign out and sign in again with your email and password. If you have no password, create one with “Forgot password?” on the sign-in screen.',
      oturum: 'Your session is not valid. Sign out and sign in again with your email and password.',
      rol: 'This link is for customer accounts only.',
      bag: 'Your account is not linked to a company or your access is closed — contact Cetpa.',
      kiraci: 'This account does not belong to the company the dealer screen is linked to, or the company account is suspended — contact Cetpa.',
      denetlenemedi: 'Could not be verified right now; try again shortly.',
      sinir: 'Too many attempts. Try again in a while.',
      yapilandirilmamis: 'The dealer screen connection is not configured on the server yet — contact Cetpa.',
      'firma-yok': 'Your account’s company details are missing — contact Cetpa.',
      okuma: 'The server could not complete the request right now. Try again in a while.',
      ag: 'The server could not be reached. Check your connection and try again.',
    },
  },
};

/** Gövde nesneyse alanlarını okunur kılar; değilse boş kayıt (dizi, dizge, `null` → alan yok). */
function kayit(govde: unknown): Record<string, unknown> {
  return typeof govde === 'object' && govde !== null && !Array.isArray(govde) ? { ...govde } : {};
}

/** Ret yanıtını `mfaRequired` / `code` / `kod` alanından ve durum kodundan tanır; `error` metnine BAKMAZ. */
function retKodu(durumKodu: number, govde: unknown): HataKodu | 'mfa' {
  const k = kayit(govde);
  if (k.mfaRequired === true) return 'mfa';
  if (k.kod === 'yeniden-giris' || k.kod === 'sifre-gerekli') return 'yeniden-giris';
  if (k.kod === 'rol' || k.code === 'ROL_YOK') return 'rol';
  if (k.kod === 'bag-yok' || k.kod === 'kapali') return 'bag';
  if (k.kod === 'kiraci' || k.code === 'COMPANY_SUSPENDED') return 'kiraci';
  if (k.kod === 'denetlenemedi') return 'denetlenemedi';
  if (k.kod === 'sinir' || durumKodu === 429) return 'sinir';
  if (k.kod === 'bayi-yapilandirilmamis') return 'yapilandirilmamis';
  if (durumKodu === 401) return 'oturum';
  return 'okuma';
}

export interface MagazaBayiBaglanPageProps {
  currentLanguage: Language;
  /** Oturum açan kullanıcının e-postası — yalnız GÖSTERİM; yetki sunucuda. */
  eposta: string;
  /** App'in çıkış işleyicisi (`handleLogout`): yeniden giriş gereken retlerde «Çıkış yap». */
  onCikis: () => void | Promise<void>;
  /**
   * Davet bağlantısı işlenemediyse sunucunun gerekçesi (`App.tsx` `inviteError`). Açılış daveti yoldan bağımsız kullanır; müşteri
   * hesabına davet UYGULANMAZ (409, belirteç atılır). Gerekçe burada da görünür (kilit ekranındaki satırın eşi, `DisRolEkrani`).
   */
  davetHatasi?: string | null;
}

export default function MagazaBayiBaglanPage({ currentLanguage, eposta, onCikis, davetHatasi }: MagazaBayiBaglanPageProps) {
  // İLK çizimde bir kez: adres sonradan değişse de doğrulanmış çift sabit kalır.
  const [parametre] = useState<BaglanParametreleri | null>(() => baglanParametreleri(window.location.hash));
  const [okuma, setOkuma] = useState<Okuma>({ tur: 'okunuyor' });
  const [okumaNo, setOkumaNo] = useState(0);
  const [islem, setIslem] = useState<Islem>({ tur: 'bos' });
  const [cikiliyor, setCikiliyor] = useState(false);
  // Aynı tikte çift tıklama iki kod üretmesin (durum henüz güncellenmemiş olur): kilit eşzamanlı okunur.
  const mesgul = useRef(false);
  const m = METIN[currentLanguage];

  // Açılışın TEK efekti: firma adı. Kod ÜRETMEZ (yetki kodu yalnız `onayla`da). MFA doğrulaması ya da «Yeniden dene» yeniden okutur.
  useEffect(() => {
    let gecerli = true;
    void (async () => {
      let yanit: Response;
      try {
        yanit = await authFetch(HESAP_UCU);
      } catch {
        if (gecerli) setOkuma({ tur: 'hata', kod: 'ag' });
        return;
      }
      let govde: unknown = null;
      try { govde = await yanit.json(); } catch { govde = null; }
      if (!gecerli) return;
      if (yanit.ok) {
        const firma = kayit(govde).firma;
        setOkuma(typeof firma === 'string' && firma.trim() !== '' ? { tur: 'tamam', firma } : { tur: 'hata', kod: 'firma-yok' });
        return;
      }
      const kod = retKodu(yanit.status, govde);
      setOkuma(kod === 'mfa' ? { tur: 'mfa' } : { tur: 'hata', kod });
    })();
    return () => { gecerli = false; };
  }, [okumaNo]);

  // `yetki-kodu` çağrısının TEK yeri: düğmenin `click` işleyicisi.
  const onayla = async (): Promise<void> => {
    if (parametre === null || mesgul.current) return;
    mesgul.current = true;
    setIslem({ tur: 'gonderiliyor' });
    let yanit: Response;
    try {
      yanit = await authFetch('/api/magaza-bayi/yetki-kodu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meydan: parametre.meydan, tur: parametre.tur }),
      });
    } catch {
      mesgul.current = false;
      setIslem({ tur: 'hata', kod: 'ag' });
      return;
    }
    let govde: unknown = null;
    try { govde = await yanit.json(); } catch { govde = null; }
    if (yanit.ok) {
      const adres = kayit(govde).donus;
      if (baglanDonusuGecerli(adres)) {
        // Kilit AÇILMAZ: sekme ayrılıyor, ikinci tıklama ikinci kod üretmesin. Onay sayfası geçmişte kalmaz.
        setIslem({ tur: 'yonleniyor' });
        window.location.replace(adres);
        return;
      }
      mesgul.current = false;
      setIslem({ tur: 'hata', kod: 'okuma' });
      return;
    }
    const kod = retKodu(yanit.status, govde);
    mesgul.current = false;
    setIslem(kod === 'mfa' ? { tur: 'mfa' } : { tur: 'hata', kod });
  };

  /** Firma okumasını yeniden başlatır (MFA doğrulaması ya da «Yeniden dene»); okuma efektin kendisindedir. */
  const yenidenOku = (): void => {
    setOkuma({ tur: 'okunuyor' });
    setOkumaNo(n => n + 1);
  };

  const cik = (): void => {
    if (cikiliyor) return;
    setCikiliyor(true);
    void Promise.resolve(onCikis()).finally(() => { setCikiliyor(false); });
  };

  const beklemede = islem.tur === 'gonderiliyor' || islem.tur === 'yonleniyor';
  // Gösterilen ret: önce düğmenin (son tıklamanın), yoksa firma okumasının.
  const gorunenHata: HataKodu | null = islem.tur === 'hata' ? islem.kod : okuma.tur === 'hata' ? okuma.kod : null;
  const mfaAcik = okuma.tur === 'mfa' || islem.tur === 'mfa';
  return (
    <div lang={currentLanguage} className="min-h-screen flex items-center justify-center bg-[#F5F5F7] p-4">
      <main className="apple-card w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">{m.baslik}</h1>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-gray-600">{m.kullaniciEtiket}</dt>
            <dd className="font-medium text-gray-900">{eposta !== '' ? eposta : '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-600">{m.firmaEtiket}</dt>
            <dd className="font-medium text-gray-900" data-firma="">
              {okuma.tur === 'tamam' ? okuma.firma : okuma.tur === 'okunuyor' ? m.okunuyor : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-600">{m.hedefEtiket}</dt>
            <dd className="font-medium text-gray-900">{m.hedef}</dd>
          </div>
          <div>
            <dt className="text-gray-600">{m.yetkiEtiket}</dt>
            <dd className="text-gray-900">{m.yetki}</dd>
          </div>
        </dl>
        <p role="note" className="text-sm font-medium text-amber-800">{m.uyari}</p>
        {davetHatasi && (
          <p role="status" className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 leading-relaxed">
            {currentLanguage === 'tr' ? 'Davet bağlantısı işlenemedi: ' : 'Invite link could not be applied: '}
            <span className="font-semibold">{davetHatasi}</span>
          </p>
        )}
        {parametre === null && <p role="alert" className="text-sm text-red-700">{m.bozuk}</p>}
        {parametre !== null && okuma.tur === 'tamam' && (
          <button type="button" className="apple-button-primary w-full justify-center" disabled={beklemede} onClick={() => { void onayla(); }}>
            {beklemede ? m.gonderiliyor : m.dugme}
          </button>
        )}
        {gorunenHata !== null && <p role="alert" className="text-sm text-red-700">{m.hata[gorunenHata]}</p>}
        {gorunenHata !== null && CIKIS_GEREKEN.has(gorunenHata) && (
          <button type="button" className="apple-button-secondary w-full justify-center" disabled={cikiliyor} onClick={cik}>{m.cikis}</button>
        )}
        {okuma.tur === 'hata' && GECICI.has(okuma.kod) && (
          <button type="button" className="apple-button-secondary w-full justify-center" onClick={yenidenOku}>{m.yenidenDene}</button>
        )}
        {islem.tur === 'mfa-tamam' && <p role="status" className="text-sm text-gray-700">{m.mfaSonrasi}</p>}
      </main>
      {mfaAcik && (
        <MfaChallengeModal
          currentLanguage={currentLanguage}
          onSuccess={() => {
            if (okuma.tur === 'mfa') yenidenOku();
            setIslem(i => (i.tur === 'mfa' ? { tur: 'mfa-tamam' } : i));
          }}
          onCancel={() => {
            if (okuma.tur === 'mfa') setOkuma({ tur: 'hata', kod: 'oturum' });
            setIslem(i => (i.tur === 'mfa' ? { tur: 'bos' } : i));
          }}
        />
      )}
    </div>
  );
}
