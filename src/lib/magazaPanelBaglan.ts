/**
 * Mağaza paneli «ERP ile bağlan» onay sayfası — saf yardımcılar (şartname v6 § 5.3).
 *
 * Yaprak modül: yalnız ortak sözleşmeyi (`./magazaTalep`) içe aktarır. Yol sabiti App.tsx ve useRouteSync tarafından STATİK
 * içe aktarılır: doğrulama betiğinin 7. sondası bu metni ana betikte (`/assets/index-….js`) arar — sabit yalnız tembel
 * yüklenen sayfada kalsaydı sonda canlıda yanlış FAIL verirdi (çit: `src/test/verifyDeployMagaza.test.ts`).
 *
 * DESENLER KOPYALANMAZ: `meydan` / `tur` biçimi sunucu şemasının (`src/server/schemas.ts` `YetkiKoduGovdesi`) okuduğu AYNI
 * iki sabitten gelir. Sayfa biçimi tutmayan parametrede düğmeyi hiç çizmez; sunucu yine kendi şemasıyla doğrular.
 */
import { MAGAZA_PANEL_43_DESENI, MAGAZA_PANEL_TUR_DESENI } from './magazaTalep';

export const MAGAZA_PANEL_BAGLAN_YOLU = '/magaza-panel-baglan';

export interface BaglanParametreleri { meydan: string; tur: string }

/**
 * Adres parçasından (`#meydan=…&tur=…`) doğrulanmış çifti çıkarır. Biçim tutmuyorsa, alan eksikse ya da YİNELENİYORSA
 * `null` (hangi değerin geçerli olduğu tahmin edilmez). Değerler HAM okunur — yüzde kaçışı çözülmez: base64url kaçış
 * gerektirmez, `%2D` gibi bir yazım desene uymaz ve reddedilir. Tanınmayan başka alan yok sayılır (istekte yalnız bu ikisi gider).
 */
export function baglanParametreleri(hash: string): BaglanParametreleri | null {
  const govde = hash.startsWith('#') ? hash.slice(1) : hash;
  const alanlar = govde.split('&').map((parca): [string, string] => {
    const esit = parca.indexOf('=');
    return esit < 0 ? [parca, ''] : [parca.slice(0, esit), parca.slice(esit + 1)];
  });
  const degerler = (ad: string): string[] => alanlar.filter(([a]) => a === ad).map(([, deger]) => deger);
  const meydanlar = degerler('meydan');
  const turlar = degerler('tur');
  if (meydanlar.length !== 1 || turlar.length !== 1) return null;
  const [meydan] = meydanlar;
  const [tur] = turlar;
  if (!MAGAZA_PANEL_43_DESENI.test(meydan) || !MAGAZA_PANEL_TUR_DESENI.test(tur)) return null;
  return { meydan, tur };
}

/**
 * Sunucunun döndürdüğü dönüş adresi yönlenmeye uygun mu: dolu dizge ve `http(s):` şemalı mutlak adres. Sunucu bu adresi
 * doğrulanmış yapılandırmadan üretir (istekten parça almaz); buradaki denetim yalnız `javascript:` / `data:` gibi bir
 * şemanın `location.replace`'e ulaşmasını engelleyen ikinci kilittir.
 */
export function baglanDonusuGecerli(donus: unknown): donus is string {
  if (typeof donus !== 'string' || donus === '') return false;
  try {
    const u = new URL(donus);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
