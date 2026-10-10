/**
 * Mağaza paneli «ERP ile bağlan» onay sayfası — `/magaza-panel-baglan#meydan=…&tur=…` (şartname v6 § 3.2, § 5.3).
 *
 * Mağaza paneli (`www.cetpa.com.tr/panel.html`) AYNI sekmeyi buraya yollar; kullanıcı onaylarsa sunucu tek kullanımlık
 * yetki kodunu taşıyan dönüş adresini verir ve sekme panele geri döner.
 *
 * GÜVENLİK SÖZLEŞMESİ (çitleri `MagazaPanelBaglanPage.test.tsx`):
 *  • `yetki-kodu` isteği YALNIZ düğmenin `click` işleyicisinde gider. Sayfa yüklenince, giriş dönüşünde, MFA
 *    doğrulanınca ya da bir efekt içinde kendiliğinden çağrı YOKTUR — bu dosyada efekt kancası hiç yok. Saldırganın
 *    hazırladığı bağlantıda doğrulayıcı saldırgandadır; kalan engel kullanıcının bilinçli tıklamasıdır.
 *  • Parametreler İLK çizimde bir kez okunur. Biçim tutmuyorsa düğme ÇİZİLMEZ.
 *  • Dönüş adresi yalnız `window.location.replace`'e gider: duruma (state), günlüğe, hata raporuna YAZILMAZ.
 *  • İstemci rolüyle kapı YOK: düğme her oturumlu kullanıcıya çizilir, hüküm tıklamadan sonra sunucudan gelir (MFA
 *    beklerken istemcideki rol varsayılan Satış'tır, güvenilmez).
 *  • Yanıt `kod` / `mfaRequired` / `code` alanından tanınır; sunucunun `error` metni OKUNMAZ ve ekrana basılmaz — metin
 *    bu dosyanın iki dilli sözlüğündendir.
 *  • `403 mfaRequired`: doğrulama penceresini sayfa KENDİSİ çizer; doğrulamadan sonra istek YİNELENMEZ, kullanıcı
 *    düğmeye yeniden basar.
 */
import { useRef, useState } from 'react';
import { MfaChallengeModal } from '../components/MfaSettings';
import { baglanDonusuGecerli, baglanParametreleri, type BaglanParametreleri } from '../lib/magazaPanelBaglan';
import { authFetch } from '../services/authFetch';
import type { Language } from '../translations';

/** Yetki kodu ucu (ERP kökeni; `src/server/routes/magazaErpRoutes.ts`). */
const YETKI_KODU_UCU = '/api/magaza-panel/yetki-kodu';

type HataKodu = 'rol' | 'kiraci' | 'sinir' | 'panel-yapilandirilmamis' | 'askida' | 'oturum' | 'okuma' | 'ag';
type Durum =
  | { tur: 'bos' }
  | { tur: 'gonderiliyor' }
  | { tur: 'yonleniyor' }
  | { tur: 'mfa' }
  | { tur: 'mfa-tamam' }
  | { tur: 'hata'; kod: HataKodu };

interface Metin {
  baslik: string;
  kullaniciEtiket: string;
  hedefEtiket: string;
  hedef: string;
  yetkiEtiket: string;
  yetki: string;
  uyari: string;
  dugme: string;
  gonderiliyor: string;
  bozuk: string;
  mfaSonrasi: string;
  hata: Record<HataKodu, string>;
}

/** Sayfanın KENDİ iki dilli sözlüğü: ekrana basılan her metin buradan (sunucu metni basılmaz). */
const METIN: Record<Language, Metin> = {
  tr: {
    baslik: 'Mağaza paneline bağlan',
    kullaniciEtiket: 'Oturum açan kullanıcı',
    hedefEtiket: 'Bağlanılacak yer',
    hedef: 'www.cetpa.com.tr mağaza paneli',
    yetkiEtiket: 'Verilecek yetki',
    yetki: 'Sipariş taleplerini görme, durum değiştirme, müşteriye görünen not yazma, kalem teslim işaretleme; 8 saat',
    uyari: 'Bu isteği siz başlatmadıysanız onaylamayın.',
    dugme: 'Onayla ve bağlan',
    gonderiliyor: 'Bağlanıyor…',
    bozuk: 'Bağlantı isteği eksik ya da bozuk. Mağaza panelindeki «ERP ile giriş yap» düğmesiyle yeniden başlatın.',
    mfaSonrasi: 'Doğrulama tamamlandı. Bağlanmak için düğmeye yeniden basın.',
    hata: {
      rol: 'Bu hesabın mağaza paneline bağlanma yetkisi yok.',
      kiraci: 'Bu hesap mağazanın bağlı olduğu şirkete ait değil.',
      sinir: 'Çok fazla deneme yapıldı. Bir süre sonra yeniden deneyin.',
      'panel-yapilandirilmamis': 'Mağaza paneli bağlantısı sunucuda henüz yapılandırılmamış. Yöneticinize haber verin.',
      askida: 'Şirket hesabı askıya alınmış.',
      oturum: 'Oturumunuz geçerli değil. Uygulamadan çıkış yapıp yeniden giriş yapın, sonra bağlantıyı mağaza panelinden yeniden başlatın.',
      okuma: 'Sunucu isteği şu an tamamlayamadı. Bir süre sonra yeniden deneyin.',
      ag: 'Sunucuya ulaşılamadı. Bağlantınızı denetleyip yeniden deneyin.',
    },
  },
  en: {
    baslik: 'Connect to the store panel',
    kullaniciEtiket: 'Signed-in user',
    hedefEtiket: 'Destination',
    hedef: 'www.cetpa.com.tr store panel',
    yetkiEtiket: 'Access granted',
    yetki: 'View order requests, change status, write customer-visible notes, mark items as delivered; 8 hours',
    uyari: 'Do not approve if you did not start this request yourself.',
    dugme: 'Approve and connect',
    gonderiliyor: 'Connecting…',
    bozuk: 'The connection request is missing or malformed. Start again with the “Sign in with ERP” button in the store panel.',
    mfaSonrasi: 'Verification complete. Press the button again to connect.',
    hata: {
      rol: 'This account is not allowed to connect to the store panel.',
      kiraci: 'This account does not belong to the company the store is linked to.',
      sinir: 'Too many attempts. Try again in a while.',
      'panel-yapilandirilmamis': 'The store panel connection is not configured on the server yet. Let your administrator know.',
      askida: 'The company account is suspended.',
      oturum: 'Your session is not valid. Sign out of the app and sign in again, then restart the connection from the store panel.',
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
  if (k.code === 'COMPANY_SUSPENDED') return 'askida';
  if (k.kod === 'rol') return 'rol';
  if (k.kod === 'kiraci') return 'kiraci';
  if (k.kod === 'sinir' || durumKodu === 429) return 'sinir';
  if (k.kod === 'panel-yapilandirilmamis') return 'panel-yapilandirilmamis';
  if (durumKodu === 401) return 'oturum';
  return 'okuma';
}

export interface MagazaPanelBaglanPageProps {
  currentLanguage: Language;
  /** Oturum açan kullanıcının görünen adı (yoksa boş) ve e-postası — yalnız GÖSTERİM; yetki sunucuda. */
  ad: string;
  eposta: string;
}

export default function MagazaPanelBaglanPage({ currentLanguage, ad, eposta }: MagazaPanelBaglanPageProps) {
  // İLK çizimde bir kez: adres sonradan değişse de doğrulanmış çift sabit kalır.
  const [parametre] = useState<BaglanParametreleri | null>(() => baglanParametreleri(window.location.hash));
  const [durum, setDurum] = useState<Durum>({ tur: 'bos' });
  // Aynı tikte çift tıklama iki kod üretmesin (durum henüz güncellenmemiş olur): kilit eşzamanlı okunur.
  const mesgul = useRef(false);
  const m = METIN[currentLanguage];

  // `yetki-kodu` çağrısının TEK yeri: düğmenin `click` işleyicisi.
  const onayla = async (): Promise<void> => {
    if (parametre === null || mesgul.current) return;
    mesgul.current = true;
    setDurum({ tur: 'gonderiliyor' });
    let yanit: Response;
    try {
      yanit = await authFetch(YETKI_KODU_UCU, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meydan: parametre.meydan, tur: parametre.tur }),
      });
    } catch {
      mesgul.current = false;
      setDurum({ tur: 'hata', kod: 'ag' });
      return;
    }
    let govde: unknown = null;
    try { govde = await yanit.json(); } catch { govde = null; }
    if (yanit.ok) {
      const adres = kayit(govde).donus;
      if (baglanDonusuGecerli(adres)) {
        // Kilit AÇILMAZ: sekme ayrılıyor, ikinci tıklama ikinci kod üretmesin. Onay sayfası geçmişte kalmaz.
        setDurum({ tur: 'yonleniyor' });
        window.location.replace(adres);
        return;
      }
      mesgul.current = false;
      setDurum({ tur: 'hata', kod: 'okuma' });
      return;
    }
    const kod = retKodu(yanit.status, govde);
    mesgul.current = false;
    setDurum(kod === 'mfa' ? { tur: 'mfa' } : { tur: 'hata', kod });
  };

  const beklemede = durum.tur === 'gonderiliyor' || durum.tur === 'yonleniyor';
  const kimlik = ad !== '' ? ad : eposta;
  return (
    <div lang={currentLanguage} className="min-h-screen flex items-center justify-center bg-[#F5F5F7] p-4">
      <main className="apple-card w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">{m.baslik}</h1>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-gray-600">{m.kullaniciEtiket}</dt>
            <dd className="font-medium text-gray-900">{kimlik !== '' ? kimlik : '—'}</dd>
            {ad !== '' && eposta !== '' && <dd className="text-gray-700">{eposta}</dd>}
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
        {parametre === null
          ? <p role="alert" className="text-sm text-red-700">{m.bozuk}</p>
          : (
            <button type="button" className="apple-button-primary w-full justify-center" disabled={beklemede} onClick={() => { void onayla(); }}>
              {beklemede ? m.gonderiliyor : m.dugme}
            </button>
          )}
        {durum.tur === 'hata' && <p role="alert" className="text-sm text-red-700">{m.hata[durum.kod]}</p>}
        {durum.tur === 'mfa-tamam' && <p role="status" className="text-sm text-gray-700">{m.mfaSonrasi}</p>}
      </main>
      {durum.tur === 'mfa' && (
        <MfaChallengeModal
          currentLanguage={currentLanguage}
          onSuccess={() => setDurum({ tur: 'mfa-tamam' })}
          onCancel={() => setDurum({ tur: 'bos' })}
        />
      )}
    </div>
  );
}
