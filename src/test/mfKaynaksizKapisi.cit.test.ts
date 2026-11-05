/**
 * mfKaynaksizKapisi.cit.test.ts: kaynaksız MF kapısının KAYNAK çiti (şartname «Mikro bağlantı B» BH16 «Kaynak çiti», 05.11.2026).
 *
 *   1. «Değişenler» #1–#12'deki her dosya (yorum hariç kodda) `mfKaynaksizMi(`, `mfYerelDisi(` ya da `mfKaynaksizSay(` çağırır.
 *   2. `mfIkiziListede(` çağıran her üretim dosyası (tanım dosyası `mikroBirlesim.ts` hariç) aynı dosyada `mfYerelDisi(` ya da
 *      `mfKaynaksizMi(` de çağırır; çağırmıyorsa aşağıdaki izinli listede gerekçesiyle durur. Yeni bir ciro okuyucusu yalnız
 *      `mfIkiziListede` ile yazılırsa bu çit kırmızıya döner.
 *   3. Notlar ekrana BAĞLI («yazıldı ama bağlanmadı» sınıfı): sayaçların basıldığı yerler `data-mf-kaynaksiz-notu` taşır.
 *   4. OKUYUCU SAYIMI (MB1 hakem bulgusu 2, 05.11.2026): BH15 sayımı `faturali` / `hasInvoice` / `MF_KAYNAGI` grep'iyle yapılmıştı;
 *      bu anahtarları taşımayan ciro okuyucuları (Bütçe, P557, CRM, pano işlevleri…) sayıma girmemişti. Bu çit anahtardan bağımsız
 *      yeniden sayar: üretim kodunda `totalPrice` ya da `siparisTutari` TOPLAYAN (`+=`, `reduce`, `toplaBilinen`) her dosya ya kapı
 *      çağırır ya da aşağıdaki İSTİSNA listesinde gerekçesiyle durur. Yeni bir ciro okuyucusu kapısız yazılırsa çit kırmızıya döner.
 *      CRMPage (çok bloklu, sayım ham kalır) satır düzeyinde: her toplama satırının kendisinde ya da önceki 8 satırda
 *      `ciroSiparisleri` / `mfKaynaksizMi(` geçer.
 *   5. KALEM CİROSU OKUYUCULARI (Y29 son inceleme bulgu 1, 06.11.2026): (4) yalnız `totalPrice` / `siparisTutari` toplamasını
 *      arıyordu; Pano «En Çok Satan Ürünler» `satirCirosu` ile kalem netini topluyor ve sayıma girmiyordu. Kalem tutarı seçicisini
 *      (`satirCirosu` / `kalemTutari`) ya da ürün gruplamasını (`urunSatislari` / `enCokSatanlar` / `panoEnCokSatanlar`) kullanan
 *      her üretim dosyası ya kapı çağırır ya da İSTİSNA listesinde gerekçesiyle durur.
 * Mutasyon (yapılıp geri alındı, raporda): bir dosyadan içe aktarma / çağrı silinir → (1) / (4) / (5) kırmızı.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { kaynakDosyalari, kodSatirlari, gorece, oku, SRC_KOK } from './kaynakTarama';

const kodu = (ad: string) => kodSatirlari(join(SRC_KOK, ad)).map(s => s.kod).join('\n');
const KAPI = /\b(mfKaynaksizMi|mfYerelDisi|mfKaynaksizSay)\(/;

/** «Değişenler» #1–#12 (§ 4.3 + BH13 #10 + BH15 #11 / #12). #4 VergiTakvimi'nin önerisi saf modüle taşındı (B2). */
const DEGISENLER: Record<string, string> = {
  '#1 Satışlar': 'utils/muhasebe/satislar.ts',
  '#2 Finans sayaçları': 'utils/muhasebe/mikroCiro.ts',
  '#3 Raporlar': 'pages/RaporlarPage.tsx',
  '#4 Vergi Takvimi KDV önerisi': 'utils/muhasebe/vergiTakvimiKdv.ts',
  '#5 KDV borcu': 'utils/muhasebe/nakitBilanco.ts',
  '#6 KDV aylık': 'utils/muhasebe/kdvAylik.ts',
  '#7 Genel faturalı tahsilat': 'components/reports/genel/GenelBloklar4.tsx',
  '#8 Sipariş CSV': 'utils/export.ts',
  '#9 Rozet': 'components/orders/MfKaynakRozeti.tsx',
  '#10 Durum metni': 'utils/siparisler/faturaDurumu.ts',
  '#11 / #12 Tahmin + kâr merkezi': 'utils/muhasebe/faturaTakipTahmin.ts',
  // MB1 hakem bulguları 0–2 (05.11.2026) ve (4) sayımının kapattığı okuyucular — şartname §4.3 «Değişenler» sapması, raporda.
  '#13 Bütçe / Gerçekleşen': 'utils/muhasebe/butceGercek.ts',
  '#14 P557 Senaryo bütçesi': 'utils/muhasebe/babsKdvAnaliz.ts',
  '#15 CRM (Hedefler, sıralama, temsilci, puan, RFM, komisyon, CLV)': 'pages/CRMPage.tsx',
  '#16 AIChat iş bağlamı cirosu': 'App.tsx',
  '#17 Yönetici ciro kartı': 'pages/AdminPage.tsx',
  '#18 İK temsilci satışı (P629)': 'pages/IKPage.tsx',
  '#19 Bayi komisyonu': 'components/DealerCommissionPanel.tsx',
  '#20 Bölge gerçekleşeni': 'components/TerritoryModule.tsx',
  '#21 Talep tahmini ciro projeksiyonu': 'components/DemandForecastPanel.tsx',
  '#22 Haftalık e-posta cirosu': 'server/crons.ts',
  '#23 /api/reports/summary cirosu': 'server/routes/reportsRoutes.ts',
  '#24 Pano hedef / dönem / hafta cirosu': 'utils/pano/hedefButce.ts',
  '#25 Pano müşteri / segment cirosu': 'utils/pano/musteriAnaliz.ts',
  '#26 Pano aylık ciro değişimi': 'utils/pano/finansKpi.ts',
};

describe('(1) «Değişenler» dosyaları kapıyı çağırır', () => {
  for (const [ad, dosya] of Object.entries(DEGISENLER)) {
    it(`${ad}: ${dosya}`, () => { expect(KAPI.test(kodu(dosya)), dosya).toBe(true); });
  }
  it('#3 Raporlar: TEK kapı rapor listesinde (`ordersProp.filter(o => !mfKaynaksizMi(o))`); #4 bileşen saf modülü çağırır', () => {
    expect(kodu('pages/RaporlarPage.tsx')).toContain('return [...ordersProp.filter(o => !mfKaynaksizMi(o)), ...mikroOrders];');
    // Y29 bulgu 2: işaretli MF'nin anahtarı `cetpaEvrak`'a girmez (ikizli işaretli MF'de Mikro satırı bir kez sayılır).
    expect(kodu('pages/RaporlarPage.tsx')).toContain('if (o.source === MF_KAYNAGI && o.mikroEvrak && !mfKaynaksizMi(o)) {');
    expect(kodu('components/VergiTakvimi.tsx')).toContain('const ayKdvOner = (donem: string): number => ayKdvOnerisi(orders, donem);');
  });
  // MB2 hakem bulgusu 1 (06.11.2026): iki dosyada not satırındaki `mfKaynaksizSay(` (1)'i yeşil tutuyordu; toplamanın kapısı
  // sökülünce hiçbir test kırmızıya dönmüyordu. Kapı TOPLAMA satırının kendisinde aranır.
  it('#17 Yönetici ciro kartı ve #22 haftalık e-posta: kapı TOPLAMANIN kendisinde (not satırındaki `mfKaynaksizSay(` yetmez)', () => {
    const c = kodu('server/crons.ts');
    expect(c).toContain('toplaBilinen(thisWeek.filter(o => !mfKaynaksizMi(o)), siparisTutari)');
    expect(c).toContain('toplaBilinen(prevWeek.filter(o => !mfKaynaksizMi(o)), siparisTutari)');
    expect(kodu('pages/AdminPage.tsx')).toContain('const totalTRY = orders.filter(o => !mfKaynaksizMi(o)).reduce(');
  });
});

describe('(2) `mfIkiziListede(` çağıran her dosya kaynaksız kapısını da taşır', () => {
  /** Kapı taşımadan `mfIkiziListede` çağırabilecek dosyalar: gerekçesiyle (bugün boş). */
  const IZINLI: Record<string, string> = {};
  it('çağıranlar kümesi ve kapı', () => {
    const cagiranlar = kaynakDosyalari(SRC_KOK)
      .filter(y => !y.endsWith(join('pano', 'mikroBirlesim.ts')))
      // Ham metinde geçmeyen dosyada kodda da geçemez: yorum süzgeci yalnız adaylarda koşar (tam tarama yük altında 5 sn'yi aşıyordu).
      .filter(y => oku(y).includes('mfIkiziListede(') && /\bmfIkiziListede\(/.test(kodSatirlari(y).map(s => s.kod).join('\n')))
      .map(gorece).sort();
    expect(cagiranlar).toEqual(['src/pages/RaporlarPage.tsx', 'src/utils/muhasebe/mikroCiro.ts', 'src/utils/muhasebe/satislar.ts']);
    const kapisiz = cagiranlar.filter(y => !/\b(mfYerelDisi|mfKaynaksizMi)\(/.test(kodu(y.replace(/^src\//, ''))) && !(y in IZINLI));
    expect(kapisiz).toEqual([]);
  });
});

describe('(3) notlar ekrana bağlı', () => {
  it('Satışlar: AccountingModule notu hesaplar ve sekmeye verir; sekme basar', () => {
    expect(kodu('components/AccountingModule.tsx')).toMatch(/satisKaynaksizNotu=\{satisKaynaksizNotu\}/);
    // Sayaç sekme testiyle (SatislarTab.mfKaynaksiz.test.tsx) AYNI işlevden.
    expect(kodu('components/AccountingModule.tsx')).toContain('mfKaynaksizNotu(satisKaynaksizDisi(orders, satisCiftSayim), currentLanguage)');
    expect(kodu('components/accounting/SatislarTab.tsx')).toContain('data-mf-kaynaksiz-notu="satislar"');
  });
  it('Finans, Raporlar ve Muhasebe panelleri (KDV borcu, KDV aylık, P565, P566, P610, Bütçe, P557) notu basar', () => {
    expect(kodu('components/FinancePanel.tsx')).toContain('mfKaynaksizNotu(siparisSayaclari.kaynaksizDisi, currentLanguage)');
    expect(kodu('pages/RaporlarPage.tsx')).toContain('data-mf-kaynaksiz-notu="raporlar"');
    const m = kodu('pages/MuhasebePage.tsx');
    for (const yer of ['kdv-borcu', 'kdv-aylik', 'p565', 'p566', 'p610', 'butce', 'p557']) expect(m, yer).toContain(`data-mf-kaynaksiz-notu="${yer}"`);
    expect(m).toContain('mfKaynaksizNotu(t565.kaynaksizDisi, currentLanguage)');
    expect(m).toContain('mfKaynaksizNotu(karMerkeziKaynaksizDisi(periodOrders), currentLanguage)');
    expect(m).toContain('mfKaynaksizNotu(ozet.kaynaksizDisi, currentLanguage)');
    expect(m).toContain('mfKaynaksizNotu(temel.kaynaksizDisi, currentLanguage)');
  });
  it('CRM (Hedefler, sıralama), Yönetici ciro kartı ve haftalık e-posta notu basar', () => {
    const c = kodu('pages/CRMPage.tsx');
    for (const yer of ['crm-hedefler', 'crm-siralama']) expect(c, yer).toContain(`data-mf-kaynaksiz-notu="${yer}"`);
    expect(kodu('pages/AdminPage.tsx')).toContain('data-mf-kaynaksiz-notu="admin-ciro"');
    expect(kodu('server/crons.ts')).toContain('Bu hafta: ${kaynaksizNotu}');
  });
  // MB2 hakem bulgusu 2 (06.11.2026): Pano'nun tek notu B2'den etkilenmeyen `panoCirosu` kartının altındaydı ve başka pencereyle
  // sayıyordu. Not artık B2'nin değiştirdiği her panelde, o panelin işlevinin KENDİ penceresinden dönen `kaynaksizDisi`'nden.
  it('Pano: B2 panelleri kendi işaretiyle ve kendi pencere sayacıyla notu basar; ciro kartında kaynaksız notu YOK', () => {
    const d = kodu('pages/DashboardPage.tsx');
    const PANELLER: Record<string, string> = {
      'pano-icgoru': 'ciroNotu90 = mfKaynaksizNotu(aylik90.kaynaksizDisi, currentLanguage)',
      'pano-p42': 'mfKaynaksizNotu(aov.kaynaksizDisi, currentLanguage)',
      'pano-p99': 'mfKaynaksizNotu(ay99.kaynaksizDisi, currentLanguage)',
      'pano-p130': 'mfKaynaksizNotu(nakit130.kaynaksizDisi, currentLanguage)',
      'pano-p159': 'mfKaynaksizNotu(mfKaynaksizBirlestir(son30.kaynaksizDisi, onceki30.kaynaksizDisi), currentLanguage)',
      'pano-p174': 'mfKaynaksizNotu(mfKaynaksizBirlestir(...aylar174.map(a => a.pencere.kaynaksizDisi)), currentLanguage)',
      'pano-p124': 'mfKaynaksizNotu(k124.kaynaksizDisi, currentLanguage)',
      'pano-p77': 'mfKaynaksizNotu(m77.kaynaksizDisi, currentLanguage)',
      'pano-p79': 'mfKaynaksizNotu(s79.kaynaksizDisi, currentLanguage)',
      'pano-p106': 'mfKaynaksizNotu(s106.kaynaksizDisi, currentLanguage)',
      'pano-urun': 'mfKaynaksizNotu(urun5.kaynaksizDisi, currentLanguage)',   // Y29 bulgu 1: En Çok Satan Ürünler
    };
    for (const [yer, sayac] of Object.entries(PANELLER)) {
      expect(d, yer).toContain(`data-mf-kaynaksiz-notu="${yer}"`);
      expect(d, yer).toContain(sayac);
    }
    // P159 çubuk ipucu hafta kovasının kendi sayacından.
    expect(d).toContain('title={mfKaynaksizNotu(w.kaynaksizDisi, currentLanguage) ?? undefined}');
    // Ciro kartı (`panoCirosu`, §4.3 «Değişmeyenler»): eski not ve seçili aralık sayacı kalktı.
    expect(d).not.toContain('data-mf-kaynaksiz-notu="pano"');
    expect(d).not.toContain('panoKaynaksizNotu');
    expect(d).not.toMatch(/\bmfKaynaksizSay\(/);
  });
});

/** Ciro TOPLAMA satırı: `totalPrice` / `siparisTutari`'nı `+=`, `reduce` ya da `toplaBilinen` ile toplar. */
const TOPLA = /(\+=[^;]*\btotalPrice\b|\breduce\([^;]*\b(totalPrice|siparisTutari)\b|[Tt]oplaBilinen\([^;]*\b(totalPrice|siparisTutari)\b|\+\s*\(?\s*(Number\()?\w+\.totalPrice\b)/;

/**
 * (4) KAPISIZ toplayabilecek dosyalar — GEREKÇESİYLE. Her satır ağaçta okundu (05.11.2026). Gerekçe sınıfları:
 *   RAPOR: `RaporlarPage.tsx` TEK kapısından (`ordersProp.filter(o => !mfKaynaksizMi(o))`, #3) gelen listeyi okur
 *          (ReportsDashboard ctx → CrmRapor / Envanter / IK / Lojistik; Genel bloklar useReportsData üstünden; Analitik).
 *   TAKİP: `odemeTakipli` / `yaslandirmaAdayi` / `mikroTurevi` MF'yi zaten dışlar (tahsilat, alacak, nakit; ciro değil ya da MF'siz).
 *   DEĞİL: `orders` cirosu değil (sepet, Cetpa `invoices` dokümanı, müşteri ekstresi, sunucu ölçüsü, risk bakiyesi).
 */
const IZINLI_TOPLAYICI: Record<string, string> = {
  'src/components/B2BPortal.tsx': 'TAKİP: kredi kullanımı `odemeTakipli` süzgeciyle (MF tahsilatı Mikro\'da)',
  'src/components/CPQPanel.tsx': 'DEĞİL: teklif sepeti satırları (`cartItems`), sipariş değil',
  'src/components/CustomerStatementModal.tsx': 'DEĞİL: tek müşterinin sipariş ekstresi (döküm); ciro raporu değil — satırlar görünür kalır',
  'src/components/FinancePanel.tsx': 'TAKİP: alacak / kova / nakit `odemeTakipli`den; sayaçlar `mikroCiro.finansSiparisSayaclari` (#2 kapısı)',
  'src/components/OverduePanel.tsx': 'TAKİP: gecikmiş alacak `odemeTakipli`',
  'src/components/SubeModule.tsx': 'DEĞİL: şube eşlemesi `subeAdi` ile; MF yazıcısı (eslemeFatura) `subeAdi` yazmaz, şube Mikro geliri `subeNo` ile',
  'src/components/AnalyticsPanel.tsx': 'RAPOR: RaporlarPage `orders` (kapılı liste) → Analitik alt sekmesi',
  'src/components/reports/EnvanterRapor.tsx': 'RAPOR', 'src/components/reports/IKRapor.tsx': 'RAPOR', 'src/components/reports/LojistikRapor.tsx': 'RAPOR',
  'src/components/reports/crm/CrmBloklar1.tsx': 'RAPOR', 'src/components/reports/crm/CrmBloklar2.tsx': 'RAPOR',
  'src/components/reports/crm/CrmBloklar3.tsx': 'RAPOR', 'src/components/reports/crm/CrmBloklar4.tsx': 'RAPOR',
  'src/components/reports/crm/CrmBloklar6.tsx': 'RAPOR', 'src/components/reports/crm/CrmBloklar7.tsx': 'RAPOR',
  'src/components/reports/crm/CrmBloklar8.tsx': 'RAPOR', 'src/components/reports/crm/CrmBloklar9.tsx': 'RAPOR',
  'src/components/reports/crm/CrmOzetBolumu.tsx': 'RAPOR', 'src/components/reports/crm/MusteriChurnAnalizi.tsx': 'RAPOR',
  'src/components/reports/crm/MusteriKademeTrendi.tsx': 'RAPOR',
  'src/components/reports/genel/GenelBloklar1.tsx': 'RAPOR (+ `mikroTurevi`)', 'src/components/reports/genel/GenelBloklar2.tsx': 'RAPOR',
  'src/components/reports/genel/GenelOzet.tsx': 'RAPOR (+ `odemeTakipli`)',
  'src/server/mikro/seriOzet.ts': 'DEĞİL: sunucu seri ölçüsü (§4.3 Değişmeyenler)',
  'src/utils/muhasebe/bankaMutabakat.ts': 'TAKİP: banka tahsilatı `odemeTakipli`',
  'src/utils/muhasebe/faturalar.ts': 'DEĞİL: Cetpa `invoices` dokümanı (`i.totalPrice`), sipariş değil',
  'src/utils/muhasebe/finansalOranlar.ts': 'TAKİP: `cetpaCiro` `source !== mikro-fatura` (§4.3 Değişmeyenler) + `odemeTakipli`',
  'src/utils/muhasebe/gelirTablosu.ts': 'TAKİP: `karZarar.geliriMikroda` — MF geliri Mikro\'dan (§4.3 Değişmeyenler)',
  'src/utils/muhasebe/isletmeSermayesi.ts': 'TAKİP: alacak `odemeTakipli`',
  'src/utils/muhasebe/karZarar.ts': 'TAKİP: `geliriMikroda` (§4.3 Değişmeyenler)',
  'src/utils/muhasebe/mutabakatMasraf.ts': 'TAKİP: `odemeTakipli` (§4.3 Değişmeyenler)',
  'src/utils/pano/ciroDonem.ts': 'TAKİP: `mikro*` kaynaklı sipariş native ciroda sayılmaz; Mikro tarafı faturadan',
  'src/utils/para.ts': 'TAKİP: `tahsilatOrani` `mikro*` kaynağı dışlar',
  'src/utils/pdf.ts': 'DEĞİL: müşteri ekstresi PDF\'i (döküm)',
  'src/utils/siparisler/tahsilatVade.ts': 'TAKİP: `yaslandirmaAdayi` → `odemeTakipli`',
};

describe('(4) ciro toplayan her dosya kapı çağırır ya da gerekçeli istisnadır (anahtardan bağımsız sayım)', () => {
  const dosyalar = [...kaynakDosyalari(SRC_KOK), join(SRC_KOK, '..', 'server.ts')]
    .filter(y => { const h = oku(y); return h.includes('totalPrice') || h.includes('siparisTutari'); });
  const toplayicilar = dosyalar.filter(y => kodSatirlari(y).some(s => TOPLA.test(s.kod))).map(gorece).sort();
  it('sayım boş değil: bilinen okuyucular toplayıcı kümesinde', () => {
    for (const g of ['src/pages/CRMPage.tsx', 'src/utils/muhasebe/butceGercek.ts', 'src/utils/muhasebe/babsKdvAnaliz.ts', 'src/utils/pano/hedefButce.ts', 'src/server/crons.ts']) {
      expect(toplayicilar, g).toContain(g);
    }
    expect(toplayicilar.length).toBeGreaterThan(50);
  });
  it('kapısız toplayıcı yok; istisna listesi bayatlamadı', () => {
    const kodOku = (g: string) => kodSatirlari(join(SRC_KOK, '..', g)).map(s => s.kod).join('\n');
    const kapisiz = toplayicilar.filter(g => !KAPI.test(kodOku(g)) && !(g in IZINLI_TOPLAYICI));
    expect(kapisiz).toEqual([]);
    // İstisna listesindeki her dosya hâlâ toplayıcıdır (bayat satır kalmaz) ve kapı çağırmaz (çağırıyorsa listeden çıkar).
    expect(Object.keys(IZINLI_TOPLAYICI).filter(g => !toplayicilar.includes(g))).toEqual([]);
    expect(Object.keys(IZINLI_TOPLAYICI).filter(g => KAPI.test(kodOku(g)))).toEqual([]);
  });
  it('CRMPage: her ciro toplama satırında ya da önceki 8 satırda `ciroSiparisleri` / `mfKaynaksizMi(` geçer', () => {
    const satirlar = kodSatirlari(join(SRC_KOK, 'pages', 'CRMPage.tsx'));
    const GECIT = /\bciroSiparisleri\b|\bmfKaynaksizMi\(/;
    const kapisiz = satirlar
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => TOPLA.test(s.kod));
    expect(kapisiz.length, 'CRMPage toplama satırı sayısı').toBeGreaterThanOrEqual(15);
    const gecitsiz = kapisiz
      .filter(({ i }) => !satirlar.slice(Math.max(0, i - 8), i + 1).some(x => GECIT.test(x.kod)))
      .map(({ s }) => `src/pages/CRMPage.tsx:${s.n}: ${s.kod.trim()}`);
    expect(gecitsiz).toEqual([]);
  });
});

/** Kalem (ürün) cirosu okuyucusu: kalem tutarı seçicisi ya da ürün gruplaması (yorum hariç kodda). */
const KALEM = /\b(satirCirosu|kalemTutari|urunSatislari|enCokSatanlar|panoEnCokSatanlar)\b/;

/**
 * (5) KAPISIZ kalem cirosu okuyabilecek dosyalar — GEREKÇESİYLE (06.11.2026, ağaçta okundu). Sınıflar (4) ile aynı; ek olarak
 *   TANIM: seçicinin / tek siparişin hesabının tanımlandığı modül (toplayan çağıran kendi kapısını taşır).
 *   MODÜL: kapı çağrılan modülde (adıyla); sayfa kapısız işlevi doğrudan çağırmaz (aşağıdaki ayrı iddia).
 */
const IZINLI_KALEM: Record<string, string> = {
  'src/pages/DashboardPage.tsx': 'MODÜL: `stokSevkiyat.panoEnCokSatanlar` (kapı + sayaç; T-B2-5q); sayfa `enCokSatanlar(` / `urunSatislari(` çağırmaz',
  'src/utils/siparisler/siparisKarlilik.ts': 'TANIM: `satirCirosu`; `siparisKarliligi` / `kalemlerTutari` TEK siparişin kalemleri (toplayan Pano P124 `segmentKarliligi` #25 kapısında)',
  'src/utils/pdf.ts': 'DEĞİL: tek belgenin kalem satırı (döküm)',
  'src/components/reports/UrunlerRapor.tsx': 'RAPOR',
  'src/components/reports/genel/GenelBloklar1.tsx': 'RAPOR', 'src/components/reports/genel/GenelBloklar5.tsx': 'RAPOR',
  'src/components/reports/genel/GenelBloklar6.tsx': 'RAPOR',
};

describe('(5) kalem cirosu okuyan her dosya kapı çağırır ya da gerekçeli istisnadır (Y29 bulgu 1)', () => {
  const kodOku = (g: string) => kodSatirlari(join(SRC_KOK, '..', g)).map(s => s.kod).join('\n');
  const okuyucular = [...kaynakDosyalari(SRC_KOK), join(SRC_KOK, '..', 'server.ts')]
    .filter(y => KALEM.test(oku(y)) && kodSatirlari(y).some(s => KALEM.test(s.kod)))
    .map(gorece).sort();
  it('sayım boş değil: bilinen okuyucular kümede', () => {
    for (const g of ['src/pages/DashboardPage.tsx', 'src/utils/pano/stokSevkiyat.ts', 'src/components/reports/UrunlerRapor.tsx']) expect(okuyucular, g).toContain(g);
  });
  it('kapısız kalem cirosu okuyucusu yok; istisna listesi bayatlamadı', () => {
    const kapisiz = okuyucular.filter(g => !KAPI.test(kodOku(g)) && !(g in IZINLI_KALEM));
    expect(kapisiz).toEqual([]);
    expect(Object.keys(IZINLI_KALEM).filter(g => !okuyucular.includes(g))).toEqual([]);
    expect(Object.keys(IZINLI_KALEM).filter(g => KAPI.test(kodOku(g)))).toEqual([]);
  });
  it('Pano «En Çok Satan Ürünler»: kapı `panoEnCokSatanlar` içinde; sayfa kapısız gruplamayı doğrudan çağırmaz', () => {
    expect(kodOku('src/utils/pano/stokSevkiyat.ts')).toContain('enCokSatanlar(siparisler.filter(o => !mfKaynaksizMi(o)), n, tutarSec)');
    const d = kodOku('src/pages/DashboardPage.tsx');
    expect(d).toContain('panoEnCokSatanlar(orders, 5, satirCirosu)');
    expect(d).not.toMatch(/\b(enCokSatanlar|urunSatislari)\(/);
  });
});
