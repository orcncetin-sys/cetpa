// @vitest-environment node
/**
 * MagazaPanelBaglanPage.baglama.degismez.test.ts — «yazıldı ama bağlanmadı» çiti (şartname v6 § 5.3, § 7): onay sayfası
 * App.tsx'e DÖRT dokunuşla bağlıdır ve sırası sabittir.
 *
 *   1. yol sabiti STATİK içe aktarılır (doğrulama betiğinin 7. sondası metni ana betikte arar), sayfa TEMBEL yüklenir;
 *   2. `baglanSayfasi` ilk yoldan türer;
 *   3. pazarlama sayfası koşulu `&& !baglanSayfasi` taşır → OTURUMSUZ kullanıcı doğrudan giriş sayfasına düşer;
 *   4. sayfanın dönüşü giriş bloğundan SONRA, Onboarding kapısından ÖNCE → OTURUMLU kullanıcı onay sayfasını görür.
 *
 * App.tsx testte çizilemez (Firebase + 6 bin satır); bu yüzden «oturumsuz → giriş, oturumlu → onay» burada dönüş
 * ifadelerinin SIRASIYLA kilitlenir. Sayfanın kendi davranışı `MagazaPanelBaglanPage.test.tsx`'te, adresin yerinde kalması
 * `src/hooks/useRouteSync.magazaPanelBaglan.test.tsx`'te, statik içe aktarım kapanışı `src/test/verifyDeployMagaza.test.ts`'te.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { gorece, kaynakDosyalari, kodSatirlari, SRC_KOK } from '../test/kaynakTarama';
import { MAGAZA_PANEL_BAGLAN_YOLU } from '../lib/magazaPanelBaglan';

const APP = kodSatirlari(join(SRC_KOK, 'App.tsx'));
const KANCA = kodSatirlari(join(SRC_KOK, 'hooks', 'useRouteSync.ts'));
/** Desene uyan kod satırlarının 1 tabanlı numaraları. */
const satirNo = (satirlar: typeof APP, desen: RegExp): number[] => satirlar.filter(s => desen.test(s.kod)).map(s => s.n);
/** Desen TAM bir satırda geçer; numarasını verir (0 ya da birden çok eşleşme çiti kırar). */
const tek = (satirlar: typeof APP, desen: RegExp): number => {
  const bulunan = satirNo(satirlar, desen);
  expect(bulunan, String(desen)).toHaveLength(1);
  return bulunan[0];
};

describe('onay sayfası App.tsx\'e bağlı — dört dokunuş (§ 5.3)', () => {
  it('1. dokunuş: yol sabiti STATİK, sayfa TEMBEL içe aktarılır (sayfanın statik içe aktarımı yok)', () => {
    tek(APP, /^import \{ MAGAZA_PANEL_BAGLAN_YOLU \} from '\.\/lib\/magazaPanelBaglan';$/);
    tek(APP, /^const MagazaPanelBaglanPage = React\.lazy\(\(\) => import\('\.\/pages\/MagazaPanelBaglanPage'\)\);$/);
    expect(satirNo(APP, /from ['"]\.\/pages\/MagazaPanelBaglanPage['"]/)).toEqual([]);
    // Sabit App.tsx'te yalnız iki yerde: içe aktarım + `baglanSayfasi` türetimi. Yol metni elle YAZILMAZ.
    expect(satirNo(APP, /\bMAGAZA_PANEL_BAGLAN_YOLU\b/)).toHaveLength(2);
    expect(satirNo(APP, /magaza-panel-baglan/)).toEqual([]);
  });

  it('2. dokunuş: `baglanSayfasi` İLK yoldan türer (kanca değil), koşullu dönüşlerden önce', () => {
    const ilkYol = tek(APP, /^\s*const \[ilkYol\] = useState\(\(\) => window\.location\.pathname\);$/);
    const sabit = tek(APP, /^\s*const baglanSayfasi = ilkYol === MAGAZA_PANEL_BAGLAN_YOLU;$/);
    expect(sabit).toBeGreaterThan(ilkYol);
    expect(sabit).toBeLessThan(tek(APP, /^\s*if \(!isAuthReady\) return \($/));
    // Üç kullanım: türetim, pazarlama koşulu, sayfanın dönüşü.
    expect(satirNo(APP, /\bbaglanSayfasi\b/)).toHaveLength(3);
  });

  it('3. dokunuş — OTURUMSUZ → giriş sayfası: pazarlama sayfası koşulu `&& !baglanSayfasi` taşır; giriş bloğu hemen ardındaki dönüştür', () => {
    const kosul = tek(APP, /^\s*if \(\(!showLoginPage \|\| user\) && !baglanSayfasi\) \{$/);
    expect(satirNo(APP, /^\s*if \(!showLoginPage \|\| user\) \{$/)).toEqual([]);   // eski koşul kalmadı
    const pazarlama = tek(APP, /^\s*<LandingPage$/);
    const giris = tek(APP, /^\s*if \(!user && !isGuestMode\) \{$/);
    expect(kosul).toBeGreaterThan(tek(APP, /^\s*if \(!isAuthReady\) return \($/));
    expect(pazarlama).toBeGreaterThan(kosul);
    expect(giris).toBeGreaterThan(pazarlama);
  });

  it('4. dokunuş — OTURUMLU → onay: sayfanın dönüşü giriş bloğundan SONRA, Onboarding kapısından ÖNCE; istemci rol kapısı yok', () => {
    const giris = tek(APP, /^\s*if \(!user && !isGuestMode\) \{$/);
    const kapi = tek(APP, /^\s*if \(baglanSayfasi && user\) \{$/);
    const sayfa = tek(APP, /<MagazaPanelBaglanPage\b/);
    const onboarding = tek(APP, /^\s*if \(user && subscriptionLoaded && !userSubscription && !isGuestMode && !showPricingPage && !isOwnerAdmin\) \{$/);
    expect(kapi).toBeGreaterThan(giris);
    expect(sayfa).toBeGreaterThan(kapi);
    expect(sayfa).toBeLessThan(kapi + 5);
    expect(onboarding).toBeGreaterThan(sayfa);
    expect(tek(APP, /^\s*<OnboardingFlow$/)).toBeGreaterThan(onboarding);
    // Sayfa yalnız dil + GÖSTERİM kimliği alır: rol / yetki / koleksiyon verisi geçmez (hüküm sunucuda).
    expect(APP[sayfa - 1].kod.trim()).toBe("<MagazaPanelBaglanPage currentLanguage={currentLanguage} ad={user.displayName ?? ''} eposta={user.email ?? ''} />");
    // Kapı ile Onboarding arasında başka koşul yok: `if (` yalnız kapının kendisi.
    expect(satirNo(APP, /^\s*if \(/).filter(n => n >= kapi && n < onboarding)).toEqual([kapi]);
  });

  it('yol metni üretim kaynağında TEK yerde yazılır (sabit); App.tsx ve useRouteSync sabiti okur', () => {
    const tasiyanlar = kaynakDosyalari(SRC_KOK).filter(yol => kodSatirlari(yol).some(s => s.kod.includes(MAGAZA_PANEL_BAGLAN_YOLU)));
    expect(tasiyanlar.map(gorece)).toEqual(['src/lib/magazaPanelBaglan.ts']);
  }, 60_000);   // `src/`in tamamı tek testte taranır: yük altında 5 sn'lik varsayılan süre yetmez (depo kalıbı)
});

describe('useRouteSync onay sayfası yolunda adrese dokunmaz — koruma «durum → adres» efektinde, `navigate`ten ÖNCE', () => {
  it('sabit STATİK içe aktarılır; koruma genel sayfa korumasının hemen ardında ve sekme denetiminden önce', () => {
    tek(KANCA, /^import \{ MAGAZA_PANEL_BAGLAN_YOLU \} from '\.\.\/lib\/magazaPanelBaglan';$/);
    const genel = tek(KANCA, /^\s*if \(publicPageKey\(location\.pathname\)\) return;$/);
    const koruma = tek(KANCA, /^\s*if \(location\.pathname === MAGAZA_PANEL_BAGLAN_YOLU\) return;$/);
    const sekme = tek(KANCA, /^\s*if \(!TOP_LEVEL_TABS\.has\(activeTab\)\) return;/);
    const gezin = tek(KANCA, /^\s*navigate\(target, \{ replace: false \}\);$/);
    expect(koruma).toBeGreaterThan(genel);
    expect(koruma).toBeLessThan(sekme);
    expect(sekme).toBeLessThan(gezin);
    expect(satirNo(KANCA, /\bnavigate\(/)).toEqual([gezin]);   // adresi değiştiren TEK çağrı korumanın arkasında
  });
});
