/**
 * teslimatAdresi.cit.test.ts — teslimat adresi OKUYUCU ÇİTİ (kaynak tarar; yorumlar hariç, `kodSatirlari`). 2026-10-10.
 *
 * Kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist (otomatik liste yap)» — sipariş adresi tek kutudan üçlüye
 * (Ülke · İl / Şehir · Adres) ayrıldı. `Order.shippingAddress` artık yalnız «kalan»dır (ilçe, mahalle, sokak); il
 * `teslimatSehri`nde, ülke `teslimatUlke`dedir. Alanı doğrudan basan / arayan HER yüzey ili ve ülkeyi DÜŞÜRÜR — bu yüzden
 * tam adres isteyen okuyucular `teslimatAdresiMetni`'ne bağlandı ve alanı doğrudan okuyan dosyalar burada ADIYLA sabit.
 *
 * Saf işlevlerin davranışı `teslimatAdresi.test.ts`'te, pencereler `AddOrderModal.test.tsx` ve
 * `OrdersPage.teslimatAdresi.test.tsx`'te gerçekten çizilerek sınanır; burada sabitlenen BAĞLANTIDIR (yazıldı ama
 * bağlanmadı arıza sınıfı): okuyucunun eski okumayı bırakması yetmez, yeni işlevi ÇAĞIRMASI da gerekir.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari, oku } from '../../test/kaynakTarama';

const DEPO_KOK = join(SRC_KOK, '..');
const yol = (g: string): string => join(DEPO_KOK, g);

/** Taranan üretim kaynakları: `src/` altı (test hariç) + kök `server.ts`. */
const DOSYALAR = [...kaynakDosyalari(SRC_KOK), yol('server.ts')];
/** Dosyanın yorumsuz kodu, tek metin. */
const kod = (g: string): string => kodSatirlari(yol(g)).map(s => s.kod).join('\n');
const say = (metin: string, desen: RegExp): number => (metin.match(desen) ?? []).length;

/** Alanı NOKTAYLA okuyan ifade (`o.shippingAddress`, `o?.shippingAddress`). Nesne anahtarı / dize anahtarı / yıkım değildir. */
const NOKTALI_OKUMA = /\.shippingAddress\b/g;
const okuyanDosyalar = (): string[] => DOSYALAR.filter(d => kodSatirlari(d).some(s => /\.shippingAddress\b/.test(s.kod))).map(gorece).sort();

describe('teslimat adresi — `.shippingAddress` okuyan dosyalar ADIYLA sabit', () => {
  it('tarama GERÇEKTEN oldu (taranan dosya sayısı > 100; çit boş kümeyle geçmiyor)', () => {
    expect(DOSYALAR.length).toBeGreaterThan(100);
    expect(DOSYALAR.map(gorece)).toContain('server.ts');
    expect(DOSYALAR.map(gorece)).toContain('src/pages/OrdersPage.tsx');
    // Desen canlı: tek kaynağın kendisi alanı noktayla okur.
    expect(say(kod('src/utils/siparisler/teslimatAdresi.ts'), NOKTALI_OKUMA)).toBeGreaterThan(0);
  });

  it('kod satırında alanı okuyan dosyalar TAM şu 8 dosya — listeye yeni dosya eklemek yerine `teslimatAdresiMetni` çağır', () => {
    expect(okuyanDosyalar()).toEqual([
      // (c) şehir türeten: yalnız ESKİ kayıt dalı (yapısal şehir yoksa) alanı okur
      'server.ts',
      // yazıcılar: form durumu, oto-adres, girdi
      'src/components/AddOrderModal.tsx',
      // sunucunun maskeli takip YANITINI basar (Order'ı değil)
      'src/components/OrderTrackingView.tsx',
      'src/components/reports/LojistikRapor.tsx',
      'src/components/reports/crm/CrmBloklar7.tsx',
      // yazıcı: kopya tohumu, düzenleme girdisi, yama çağrısı
      'src/pages/OrdersPage.tsx',
      // yazıcı: düzenleme yaması
      'src/utils/siparisler/formKayit.ts',
      // tek kaynak
      'src/utils/siparisler/teslimatAdresi.ts',
    ]);
  });

  it('`OrdersPage.tsx` alanı TAM 3 kez okur: kopya tohumu, düzenleme girdisi, yama çağrısı (eskiden 13)', () => {
    const sayfa = kod('src/pages/OrdersPage.tsx');
    expect(say(sayfa, NOKTALI_OKUMA)).toBe(3);
    expect(sayfa).toMatch(/shippingAddress: o\.shippingAddress,/);                                                  // kopya tohumu
    expect(sayfa).toMatch(/value=\{\(editingOrderData\.shippingAddress as string\) \?\? ''\}/);                    // düzenleme girdisi
    expect(sayfa).toMatch(/shippingAddress: magazaKilidi \? undefined : editingOrderData\.shippingAddress,/);       // yama çağrısı
  });

  it('rapor dosyalarında okuma yalnız ESKİ kayıt dalındadır: `LojistikRapor` 3, `CrmBloklar7` 1', () => {
    expect(say(kod('src/components/reports/LojistikRapor.tsx'), NOKTALI_OKUMA)).toBe(3);   // dış koşul + atlama + son parça türetimi
    expect(say(kod('src/components/reports/crm/CrmBloklar7.tsx'), NOKTALI_OKUMA)).toBe(1);
  });
});

describe('teslimat adresi — BAĞLANDI çiti (eski okumayı kaldırmak yetmez)', () => {
  /** Okuyucu tablosu (a) TAM ADRES + (b) ARAMA: istemci dosyası → `teslimatAdresiMetni(` çağrı sayısı (yüzey başına bir). */
  const ISTEMCI_OKUYUCULARI: ReadonlyArray<readonly [dosya: string, cagri: number, yuzeyler: string]> = [
    ['src/pages/OrdersPage.tsx', 9, 'sevkiyat araması, 3 sipariş araması, 505 belgesi, detay, rota kartı, hızlı sevkiyat onayı, shipments.destination'],
    ['src/pages/CRMPage.tsx', 2, 'CRM sipariş araması, müşteri kartındaki sipariş'],
    ['src/App.tsx', 2, 'rota durağı, iyzico isteği'],
    ['src/components/QuickShipmentModal.tsx', 2, 'sevkiyat destination yedeği, adres kutusu varsayılanı'],
    ['src/utils/pdf.ts', 1, 'sipariş / teklif PDF\'i müşteri kutusu'],
    ['src/utils/export.ts', 1, 'dışa aktarma sütunu'],
    ['src/utils/siparisler/irsaliyeGonder.ts', 1, 'e-İrsaliye destination'],
    ['src/components/reports/LojistikRapor.tsx', 1, 'rapor hücresi'],
    ['src/components/LogisticsMap.tsx', 1, 'harita balonu'],
    ['src/pages/MuhasebePage.tsx', 1, 'fatura / sipariş detayı'],
    ['src/components/GlobalSearch.tsx', 1, 'genel arama puanı'],
  ];

  it.each(ISTEMCI_OKUYUCULARI)('%s `teslimatAdresiMetni(` çağırır — %i yüzey (%s)', (dosya, cagri) => {
    const metin = kod(dosya);
    expect(say(metin, /\bteslimatAdresiMetni\(/g)).toBe(cagri);
    expect(metin).toMatch(/import \{[^}]*\bteslimatAdresiMetni\b[^}]*\} from '[./a-zA-Z]*teslimatAdresi';/);
  });

  it('(a) + (b) tablolarındaki 12 dosyanın TAMAMI çağırır (11 istemci dosyası + `server.ts` LUCA gövdesi)', () => {
    const hepsi = [...ISTEMCI_OKUYUCULARI.map(([dosya]) => dosya), 'server.ts'];
    expect(hepsi).toHaveLength(12);
    expect(hepsi.filter(d => !/\bteslimatAdresiMetni\(/.test(kod(d)))).toEqual([]);
  });

  it('arama ifadelerinde adres terimi Türkçe-duyarlı `eslesir` ile: `eslesir(…, teslimatAdresiMetni(o))`', () => {
    // 'İstanbul'.toLowerCase().includes('istanbul') YANLIŞTIR (i + birleşik nokta): il listeden büyük «İ» ile yazılır.
    const sayfa = kod('src/pages/OrdersPage.tsx');
    expect(say(sayfa, /eslesir\(orderSearch, teslimatAdresiMetni\(o\)\)/g)).toBe(3);
    expect(sayfa).toMatch(/eslesir\(sevkiyatArama, gorunenSiparisNo\(o\), o\.trackingNumber, o\.customerName, teslimatAdresiMetni\(o\)\)/);
    expect(say(kod('src/pages/CRMPage.tsx'), /eslesir\(orderSearch, teslimatAdresiMetni\(o\)\)/g)).toBe(1);
    // Genel aramada yalnız aranan METİN değişti; ortak `fieldScore` aynen.
    expect(kod('src/components/GlobalSearch.tsx')).toMatch(/fieldScore\(teslimatAdresiMetni\(o\), q\)/);
  });

  it('boş adresin bugünkü yedek metni yerinde: detay «--», rapor «—», rota «Unknown Address», iyzico «Türkiye»', () => {
    expect(kod('src/pages/OrdersPage.tsx')).toMatch(/\{teslimatAdresiMetni\(selectedOrder\) \|\| '--'\}/);
    expect(kod('src/components/reports/LojistikRapor.tsx')).toMatch(/\{teslimatAdresiMetni\(o\)\|\|'—'\}/);
    expect(kod('src/App.tsx')).toMatch(/address: teslimatAdresiMetni\(o\) \|\| 'Unknown Address',/);
    expect(kod('src/App.tsx')).toMatch(/shippingAddress: teslimatAdresiMetni\(order\) \|\| 'Türkiye',/);
  });

  it('şehir türeten iki rapor ÖNCE `siparisSehri` okur', () => {
    const lojistik = kod('src/components/reports/LojistikRapor.tsx');
    // Dış koşul ve döngü: «yapısal şehir dolu YA DA adres dolu» — yalnız ili seçilmiş, adres kutusu boş sipariş de sayılır.
    expect(lojistik).toMatch(/orders\.some\(o => siparisSehri\(o\) !== null \|\| o\.shippingAddress\)/);
    expect(lojistik).toMatch(/const yapisalSehir = siparisSehri\(o\);\s+let city: string;\s+if \(yapisalSehir !== null\) city = yapisalSehir;\s+else \{\s+if \(!o\.shippingAddress\) continue;/);
    expect(say(lojistik, /\bsiparisSehri\(/g)).toBe(2);
    const crm = kod('src/components/reports/crm/CrmBloklar7.tsx');
    // Şehir `katla()` ile katlanır — `toLowerCase()` «İstanbul» / «İzmir»i eşleştiremez (i + U+0307). Kovanın doğruluğu
    // davranışla da sınanır: components/reports/crm/CrmBloklar7.bolge.test.tsx (inceleme 2026-10-10).
    expect(crm).toMatch(/const sehir = siparisSehri\(o\);\s+if \(sehir !== null\) \{\s+const katli = katla\(sehir\);/);
    expect(crm).toMatch(/BOLGE_ILLERI\.find\(il => katla\(il\) === katli\) \?\? \(etkinUlke\(o\.teslimatUlke\) === 'TR' \? 'Other TR' : 'Other'\)/);
    expect(crm).toMatch(/const BOLGE_ILLERI = \['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana'\] as const;/);
  });

  it('`siparisSehri(` çağıranlar ADIYLA sınırlı: `deliveryCity` / `city` okuyan beş rapor bloğu bu işte BAĞLANMADI', () => {
    // Satış Bölgesi şehir adları `TR.json` yazımıyla tutulur; il listesiyle eşleme kuralı ayrı iştir (TerritoryModule,
    // GenelBloklar4, LojistikRapor'un öteki üç bloğu). `paymentRoutes` sunucu tarafıdır (iyzico `city`).
    const cagiranlar = DOSYALAR.filter(d => kodSatirlari(d).some(s => /\bsiparisSehri\(/.test(s.kod))).map(gorece).sort();
    const IZINLI = [
      'src/components/reports/LojistikRapor.tsx',
      'src/components/reports/crm/CrmBloklar7.tsx',
      'src/server/routes/paymentRoutes.ts',
      'src/utils/siparisler/teslimatAdresi.ts',
    ];
    expect(cagiranlar.filter(d => !IZINLI.includes(d))).toEqual([]);
    expect(cagiranlar).toContain('src/components/reports/LojistikRapor.tsx');
    expect(cagiranlar).toContain('src/components/reports/crm/CrmBloklar7.tsx');
  });

  it('e-İrsaliye: girdi tipi il / ülkeyi taşır, `destination` tam adres metni', () => {
    const irsaliye = kod('src/utils/siparisler/irsaliyeGonder.ts');
    const tip = irsaliye.slice(irsaliye.indexOf('export interface IrsaliyeSiparisi {'), irsaliye.indexOf('export interface IrsaliyeCarisi'));
    expect(tip.length).toBeGreaterThan(100);
    expect(tip).toMatch(/teslimatSehri\?: unknown;\s+teslimatUlke\?: unknown;/);
    expect(irsaliye).toMatch(/destination:\s+teslimatAdresiMetni\(siparis\),/);
  });
});

describe('teslimat adresi — sunucu okuyucuları (`server.ts`)', () => {
  const sunucu = kod('server.ts');

  it('`server.ts` alanı TAM 1 kez okur: takip ucunun ESKİ kayıt dalı (`maskAddress`; eskiden 2)', () => {
    expect(say(sunucu, NOKTALI_OKUMA)).toBe(1);
    expect(sunucu).toMatch(/maskAddress\(o\.shippingAddress\)/);
  });

  it('kimliksiz takip yanıtı `takipAdresi(` üzerinden (yapısal kayıtta «kalan» dışarı verilmez)', () => {
    expect(sunucu).toMatch(/\btakipAdresi\(/);
  });

  it('LUCA gövdesi `musteri.adres` için `teslimatAdresiMetni(` çağırır', () => {
    expect(sunucu).toMatch(/adres:\s+teslimatAdresiMetni\(order\)/);
  });
});

describe('teslimat adresi — iki pencere AYNI üçlüyü AYNI bileşenlerle gösterir', () => {
  const yeni = kod('src/components/AddOrderModal.tsx');
  const sayfa = kod('src/pages/OrdersPage.tsx');
  const duzenle = sayfa.slice(sayfa.indexOf('{isEditingOrder && ('), sayfa.indexOf('{showQuickShipment && ('));

  it('tarama deseni canlı: düzenleme penceresi dilimi bulundu', () => {
    expect(sayfa.indexOf('{isEditingOrder && (')).toBeGreaterThan(-1);
    expect(duzenle.length).toBeGreaterThan(2000);
  });

  it.each([['Yeni Sipariş (AddOrderModal)', 'yeni-siparis'], ['Sipariş Düzenle (OrdersPage)', 'siparis-duzenle']] as const)(
    '%s: ortak `UlkeSecici` + `IlSecici`, üç etiket `oc()` ile ve `htmlFor` ile bağlı, grup başlıklı', (_ad, onek) => {
      const pencere = onek === 'yeni-siparis' ? yeni : duzenle;
      expect(say(pencere, /<UlkeSecici\b/g)).toBe(1);
      expect(say(pencere, /<IlSecici\b/g)).toBe(1);
      expect(pencere).toContain(`<UlkeSecici id="${onek}-ulke"`);
      expect(pencere).toContain(`<IlSecici id="${onek}-il"`);
      expect(pencere).toContain(`<input id="${onek}-adres" type="text"`);
      // Etiketler ORTAK sözlükten (satır içi `tr ? … : …` çifti YOK) ve kutularına bağlı.
      expect(pencere).toMatch(new RegExp(`<label htmlFor="${onek}-ulke"[^>]*>\\{oc\\(currentLanguage\\)\\.ulke\\}</label>`));
      expect(pencere).toMatch(new RegExp(`<label htmlFor="${onek}-il"[^>]*>\\{oc\\(currentLanguage\\)\\.il_sehir\\}</label>`));
      expect(pencere).toMatch(new RegExp(`<label htmlFor="${onek}-adres"[^>]*>\\{oc\\(currentLanguage\\)\\.adres_ilce_mahalle_sokak\\}</label>`));
      // Üçlü tek grup; «Teslimat Adresi» grup başlığı olarak KALIR.
      expect(pencere).toContain(`<div role="group" aria-labelledby="${onek}-teslimat-baslik"`);
      expect(pencere).toMatch(new RegExp(`<p id="${onek}-teslimat-baslik"[^>]*>\\{(currentT\\.shipping_address|oc\\(currentLanguage\\)\\.teslimat_adresi)\\}</p>`));
      // Ülke değişince il boşalır — iki pencere AYNI saf işlevi çağırır (kopya kural yok).
      expect(say(pencere, /\bulkeSecimiYamasi\(/g)).toBe(1);
      // İl kutusuna ETKİN ülke verilir (alanı olmayan eski kayıt Türkiye kipinde açılır).
      expect(pencere).toMatch(/ulke=\{etkinUlke\((newOrder|editingOrderData)\.teslimatUlke\)\}/);
    });

  it('`AddOrderModal`: form başlangıcı TEK sabit — `shippingAddress: \'\'` tek yerde, ilk çizim ve sıfırlama aynı nesne', () => {
    expect(say(yeni, /shippingAddress: ''/g)).toBe(1);
    expect(yeni).toMatch(/const BOS_SIPARIS_FORMU: Readonly<Partial<Order>> = \{ status: 'Pending', shippingAddress: '', faturali: true, kdvOran: 20, teslimatUlke: 'TR' \};/);
    expect(yeni).toMatch(/useState<Partial<Order>>\(BOS_SIPARIS_FORMU\)/);
    expect(yeni).toMatch(/setNewOrder\(BOS_SIPARIS_FORMU\);/);
    expect(say(yeni, /\bBOS_SIPARIS_FORMU\b/g)).toBe(3);
  });

  it('`AddOrderModal`: kayıt gövdesi `adresKayitAlanlari` ile; il müşteriden `ilBul` ile (ülke müşteriden OKUNMAZ)', () => {
    expect(yeni).toMatch(/const \{ fiyatGirisi: _eskiGiris, teslimatUlke: _formUlke, teslimatSehri: _formIl, \.\.\.siparis \} = newOrder;/);
    expect(yeni).toMatch(/await onSubmit\(\{ \.\.\.siparis, \.\.\.adresKayitAlanlari\(newOrder\), customerName: musteriAdi,/);
    expect(yeni).toMatch(/\.\.\.\(degistir \? \{ teslimatSehri: etkinUlke\(prev\.teslimatUlke\) === 'TR' \? \(ilBul\(selectedLead\.city\) \?\? ''\) : '' \} : \{\}\),/);
    expect(yeni).not.toMatch(/selectedLead\??\.country/);
    expect(yeni).not.toMatch(/selectedLead\??\.district/);
  });

  it('`OrdersPage`: yerel durum yamadaki `null`\'ı alanın yokluğuna çevirir (`yerelMetin`); kopya tohumu ülke / ili taşır', () => {
    expect(duzenle).toMatch(/teslimatUlke: yerelMetin\(yama\.teslimatUlke, o\.teslimatUlke\),\s+teslimatSehri: yerelMetin\(yama\.teslimatSehri, o\.teslimatSehri\),/);
    // Mağaza siparişinin «ilçe / il»i 81 il listesinde yoktur → kopyaya taşınmaz.
    expect(sayfa).toMatch(/teslimatUlke: o\.teslimatUlke,\s+\.\.\.\(magazaSiparisiMi\(o\) \? \{\} : \{ teslimatSehri: o\.teslimatSehri \}\),/);
  });
});

describe('teslimat adresi — i18n', () => {
  /** `src/` altındaki TÜM `.ts` / `.tsx` (testler dâhil) — bu dosyanın kendisi hariç (aranan dize burada geçiyor). */
  const tumDosyalar = (dizin: string): string[] => readdirSync(dizin).flatMap(ad => {
    const tam = join(dizin, ad);
    if (statSync(tam).isDirectory()) return tumDosyalar(tam);
    return /\.tsx?$/.test(ad) && tam !== __filename ? [tam] : [];
  });

  it('eski yer tutucu anahtarı `city_district` depoda 0 eşleşme (tek kullanımı kalktı)', () => {
    const hepsi = [...tumDosyalar(SRC_KOK), yol('server.ts')];
    expect(hepsi.length).toBeGreaterThan(DOSYALAR.length);            // testler de tarandı
    expect(hepsi.filter(d => oku(d).includes('city_district')).map(gorece)).toEqual([]);
  });
});
