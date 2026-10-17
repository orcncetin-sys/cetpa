/**
 * mikroRolIstemci.cit.test.ts — İSTEMCİ kaynak çiti: Mikro uç kapıları ortak tablodan sorulur
 * (karar turu 2026-10-11 — İ3 «ölü düğme yok», İ4 «tek kaynak», H3, H6; şartname `.wf/SARTNAME-mikro-rol-kapisi.md` § 10).
 *
 * NEDEN VAR — yarım düzeltmeyi yakalar: sunucu kapısı daralınca o ucu çağıran HER istemci yüzeyi aynı commit'te kapıyı
 * sormalıdır (düğme çizilmez, sessiz çağrı yapılmaz). Bir yüzey unutulursa orada ölü düğme / sessiz 403 kalır ve hiçbir
 * bileşen testi bunu görmez (unutulan yüzeyin testi de yazılmamıştır). Bu çit bileşen bilmez, DOSYA tarar:
 *
 *   Ç-İ1  `MIKRO_UC_KAPILARI`'ndaki yollardan birini KOD satırında geçiren her istemci dosyası ortak tablodan
 *         (`lib/mikroUcKapilari`) içe aktarım yapar. İstisnalar ADIYLA ve gerekçesiyle; her gerekçe ayrı çitle sınanır.
 *   Ç-İ2  Dosya, çağırdığı ucun KENDİ anahtarını (`'YÖNTEM /yol'`) taşır — tabloyu içe aktarıp başka ucun kapısını sormak
 *         geçmez. (Anahtar tipi `MikroKapiliUc` olduğu için yanlış yazılan anahtar zaten derlenmez.)
 *   Ç-İ3  K1 / H3: `cari/listesi` ucunun istemcide ÇAĞIRANI YOK — iki sarmalayıcının (`pullCariFromMikro`, `fullCariSync`)
 *         çağıranı kalmadı; yol yalnız sarmalayıcının kendi dosyasında geçer.
 *   Ç-İ4  K1 / H3: iki «Mikro'da ara» kutusunun kodu (durum, işleyici, metin) Satın Alma'da ve CRM'de yok; CRM'deki
 *         açıklama cümlesi duruyor.
 *   Ç-İ5  K2: dekont penceresi (tür listesini okuyan tek yüzey) yalnız kapılı düğmeden açılır ve o düğmeyi gören her rol
 *         tür listesi ucunun kapısından da geçer.
 *   Ç-İ6  Adresi parçalardan kuran çağrı (şablon dizesi / birleştirme) Ç-İ1'den KAÇAR; bilinen tek örnek adıyla yazılı.
 *
 * Davranış tarafı bileşen / kanca testlerinde: `MikroSyncPanel.test.tsx`, `useMikroPersonel.test.ts`,
 * `useMikroUretimReceteleri.test.ts`, `HRModule.rol.test.tsx`, `TahsilatModule.rol.test.tsx`, `PurchasingModule.rol.test.tsx`.
 * Sunucu tarafı: `server/routes/mikroRoutes.rolKapisi.test.ts` (rota satırı ═ beklenen tablo ═ ortak tablo).
 *
 * Tarama YALNIZ kod satırlarına bakar (`kodSatirlari` — yorum, JSX yorumu hariç): çit kendi açıklamasına ya da bir dosyanın
 * «eskiden şu uç çağrılıyordu» yorumuna takılmaz.
 */
import { describe, it, expect } from 'vitest';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari } from './kaynakTarama';
import { MIKRO_UC_KAPILARI, ucKapisindanGecer, type MikroKapiliUc } from '../lib/mikroUcKapilari';
import { evrakKapisindanGecer } from '../lib/mikroEvrakKapilari';
import { APP_ROLES } from '../lib/rbac';

const ANAHTARLAR = Object.keys(MIKRO_UC_KAPILARI) as MikroKapiliUc[];
/** Ortak tablo anahtarının yol parçası: `'POST /api/mikro/x'` → `'/api/mikro/x'`. */
const yolu = (anahtar: MikroKapiliUc): string => anahtar.slice(anahtar.indexOf(' ') + 1);
const kacis = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Yol TAM geçmeli: `/api/mikro/ebelge/giden`, `/api/mikro/ebelge/giden-ozet` içinde eşleşmez. */
const yolDeseni = (anahtar: MikroKapiliUc): RegExp => new RegExp(`${kacis(yolu(anahtar))}(?![\\w/-])`);

interface Dosya { ad: string; kod: string[] }
/** İstemci kaynakları: `src/` altındaki üretim dosyaları, sunucu ağacı (`src/server/`) hariç. Kök `server.ts` zaten `src` dışında. */
const ISTEMCI: Dosya[] = kaynakDosyalari(SRC_KOK)
  .map(y => ({ ad: gorece(y), kod: kodSatirlari(y).map(s => s.kod) }))
  .filter(d => !d.ad.startsWith('src/server/'));
const dosya = (ad: string): Dosya => {
  const d = ISTEMCI.find(x => x.ad === ad);
  if (!d) throw new Error(`istemci dosyası bulunamadı: ${ad}`);
  return d;
};
const gecenAnahtarlar = (d: Dosya): MikroKapiliUc[] => ANAHTARLAR.filter(a => d.kod.some(k => yolDeseni(a).test(k)));
const tabloyuIceAktarir = (d: Dosya): boolean => d.kod.some(k => /from\s+['"][^'"]*\/mikroUcKapilari['"]/.test(k));
/** Tanımlayıcıyı (tam sözcük) KOD satırında geçiren istemci dosyaları. */
const gecenDosyalar = (desen: RegExp): string[] => ISTEMCI.filter(d => d.kod.some(k => desen.test(k))).map(d => d.ad).sort();

const TABLO = 'src/lib/mikroUcKapilari.ts';
const SARMALAYICI = 'src/services/mikroService.ts';
const DEKONT_PENCERESI = 'src/components/DekontModal.tsx';
const MUSTERILER_SEKMESI = 'src/components/accounting/MusterilerTab.tsx';

/**
 * Ç-İ1 İSTİSNALARI — yolu kod satırında geçirdiği hâlde tabloyu içe aktarması GEREKMEYEN dosyalar. ELLE, gerekçesiyle.
 * Satır eklemek «bu yüzey kapıyı sormadan o ucu çağırabilir» demektir: gerekçeyi sınayan çit de birlikte yazılır.
 */
const ISTISNA: Record<string, { yollar: MikroKapiliUc[]; gerekce: string }> = {
  [TABLO]: { yollar: ANAHTARLAR, gerekce: 'tablonun kendisi' },
  [SARMALAYICI]: {
    yollar: ['POST /api/mikro/cari/listesi'],
    gerekce: 'ince sarmalayıcı (rol bilmez); iki sarmalayıcının da çağıranı yok — Ç-İ3',
  },
  [DEKONT_PENCERESI]: {
    yollar: ['GET /api/mikro/cari-hareket/turler'],
    gerekce: 'pencere yalnız dekont yöntem kapısına bağlı düğmeden açılır; o düğmeyi gören rol tür listesini de okur — Ç-İ5',
  },
};

describe('Ç-İ1 / Ç-İ2 — Mikro uç yolunu çağıran her istemci dosyası kapıyı ORTAK TABLODAN sorar', () => {
  it('tarama boş değil: istemci dosyaları okundu, tablo yolları kod satırlarında bulunuyor', () => {
    expect(ISTEMCI.length).toBeGreaterThan(200);
    expect(ANAHTARLAR.length).toBeGreaterThanOrEqual(10);
    expect(gecenAnahtarlar(dosya(TABLO)).sort()).toEqual([...ANAHTARLAR].sort());   // desen tablonun kendi satırlarını buluyor
    // Yol sınırı: bir yol başka bir tablo yolunun öneki değil (aksi hâlde `yolDeseni` iki anahtarı karıştırırdı).
    for (const a of ANAHTARLAR) for (const b of ANAHTARLAR) if (a !== b) expect(yolDeseni(a).test(yolu(b)), `${a} ~ ${b}`).toBe(false);
  });

  it('Ç-İ1 — yolu kod satırında geçiren her dosya `lib/mikroUcKapilari`\'ndan içe aktarım yapar (istisnalar adıyla)', () => {
    const suclular = ISTEMCI
      .filter(d => !(d.ad in ISTISNA))
      .map(d => ({ dosya: d.ad, yollar: gecenAnahtarlar(d) }))
      .filter(x => x.yollar.length > 0 && !tabloyuIceAktarir(dosya(x.dosya)));
    expect(suclular).toEqual([]);
  });

  it('Ç-İ1 — bu turda kapıya bağlanan yüzeyler taramada GÖRÜNÜYOR (çit boş kümede geçmiyor)', () => {
    const gorulen = Object.fromEntries(ISTEMCI.filter(d => !(d.ad in ISTISNA)).map(d => [d.ad, gecenAnahtarlar(d)] as const).filter(([, y]) => y.length > 0));
    expect(gorulen).toMatchObject({
      'src/components/MikroSyncPanel.tsx': ['POST /api/mikro/pull/personel', 'POST /api/mikro/pull/uretim-receteleri'],
      'src/hooks/useMikroPersonel.ts': ['POST /api/mikro/pull/personel'],
      'src/hooks/useMikroUretimReceteleri.ts': ['POST /api/mikro/pull/uretim-receteleri'],
      'src/components/TahsilatModule.tsx': ['POST /api/mikro/tahsilat/kaydet'],
    });
  });

  it('Ç-İ2 — dosya, çağırdığı ucun KENDİ anahtarını taşır ve kapı işlevini çağırır', () => {
    const suclular: string[] = [];
    for (const d of ISTEMCI) {
      if (d.ad in ISTISNA) continue;
      const anahtarlar = gecenAnahtarlar(d);
      if (anahtarlar.length === 0) continue;
      const metin = d.kod.join('\n');
      for (const a of anahtarlar) if (!metin.includes(`'${a}'`)) suclular.push(`${d.ad} | ${yolu(a)} çağrılıyor ama '${a}' anahtarı sorulmuyor`);
      if (!/\bucKapisindanGecer\(/.test(metin)) suclular.push(`${d.ad} | ucKapisindanGecer( çağrısı yok`);
    }
    expect(suclular).toEqual([]);
  });

  it('istisnalar bayat değil: her istisna dosyası hâlâ o yolları (yalnız onları) kod satırında geçiriyor', () => {
    for (const [ad, { yollar }] of Object.entries(ISTISNA)) {
      expect(gecenAnahtarlar(dosya(ad)).sort(), ad).toEqual([...yollar].sort());
    }
  });
});

describe('Ç-İ3 — K1 / H3: `cari/listesi` ucunun istemcide çağıranı yok', () => {
  it('`pullCariFromMikro` ve `fullCariSync` yalnız tanımlandıkları dosyada geçer (çağıran kalmadı)', () => {
    expect(gecenDosyalar(/\bpullCariFromMikro\b/)).toEqual([SARMALAYICI]);
    expect(gecenDosyalar(/\bfullCariSync\b/)).toEqual([SARMALAYICI]);
    // Tanımlar duruyor (çit, sarmalayıcı silinince boş kümede geçmesin diye).
    const kod = dosya(SARMALAYICI).kod.join('\n');
    expect(kod.includes('export async function pullCariFromMikro('), 'pullCariFromMikro tanımı').toBe(true);
    expect(kod.includes('export async function fullCariSync('), 'fullCariSync tanımı').toBe(true);
    // Sarmalayıcı dosyası kendi içinde de çağırmıyor: ad yalnız tanım satırında.
    expect(kod.split('pullCariFromMikro').length - 1).toBe(1);
    expect(kod.split('fullCariSync').length - 1).toBe(1);
  });

  it('yol istemcide yalnız sarmalayıcıda ve tabloda geçer (doğrudan `fetch` ile çağıran da yok)', () => {
    const desen = yolDeseni('POST /api/mikro/cari/listesi');
    expect(gecenDosyalar(desen)).toEqual([TABLO, SARMALAYICI].sort());
  });
});

describe("Ç-İ4 — K1 / H3: iki «Mikro'da ara» kutusunun kodu kaldırıldı", () => {
  const SATIN_ALMA = 'src/components/PurchasingModule.tsx';
  const CRM = 'src/pages/CRMPage.tsx';
  /** Kutuların durumu, işleyicileri ve metinleri (TR + EN). Kod satırında bir tanesi bile kalmamalı. */
  const KUTU = /mikroSearch|mikroLink|handleSearchMikroSupplier|handleImportMikroSupplier|searchMikroForLead|linkLeadToMikroCari|MikroCariItem|Search Mikro|Mikro\\?'da (?:firma adıyla ara|aranıyor|bulunamadı|")|Mikro sonuçları/i;

  it.each([SATIN_ALMA, CRM])('%s — kutunun durumu / işleyicisi / metni kod satırında yok', ad => {
    expect(dosya(ad).kod.map((k, i) => ({ satir: i + 1, kod: k.trim() })).filter(s => KUTU.test(s.kod))).toEqual([]);
  });

  it('CRM — aday ayrıntısındaki açıklama cümlesi DURUYOR (kutu gitti, neden görünmediği yazıyor)', () => {
    const kod = dosya(CRM).kod.join('\n');
    expect(kod.split("Bu aday Mikro\\'ya bağlı değil — cari ekstre/bakiye görünmüyor.").length - 1).toBe(1);
    expect(kod.split("This lead isn\\'t linked to Mikro — no account statement/balance.").length - 1).toBe(1);
  });

  it('Satın Alma — tedarikçi seçiminin öbür iki yolu duruyor (kayıtlı liste + yeni tedarikçi)', () => {
    const kod = dosya(SATIN_ALMA).kod.join('\n');
    expect(kod.includes('matchingSuppliers.map(s => ('), 'kayıtlı tedarikçi listesi').toBe(true);
    expect(kod.includes('onClick={() => void handleCreateLocalSupplier()}'), '«Yeni tedarikçi oluştur» düğmesi').toBe(true);
  });

  it('desen canlı: eski kutunun satırlarını yakalıyor', () => {
    for (const eski of [
      'const [mikroSearchResults, setMikroSearchResults] = useState<MikroCariItem[] | null>(null);',
      "? (currentLanguage === 'tr' ? 'Mikro\\'da aranıyor…' : 'Searching Mikro…')",
      "placeholder={currentLanguage === 'tr' ? 'Mikro\\'da firma adıyla ara...' : 'Search Mikro by company name...'}",
      '{mikroLinkResults && (',
      'setMikroSearchResults(null);',
    ]) expect(KUTU.test(eski), eski).toBe(true);
    expect(KUTU.test("{/* Mikro'da İPTAL edilen faturalar */}")).toBe(false);
  });
});

describe('Ç-İ5 — K2: dekont penceresi yalnız kapılı düğmeden açılır', () => {
  it('pencere tek yerde çizilir, hedefi tek yerden atanır', () => {
    expect(gecenDosyalar(/<DekontModal\b/)).toEqual(['src/components/AccountingModule.tsx']);
    expect(gecenDosyalar(/\bsetDekontHedef\(\s*\{/)).toEqual([MUSTERILER_SEKMESI]);
  });

  it('hedefi atayan düğme dekont yöntem kapısını ortak tablodan sorar', () => {
    const kod = dosya(MUSTERILER_SEKMESI).kod;
    expect(kod.some(k => /from\s+['"][^'"]*\/mikroEvrakKapilari['"]/.test(k)), 'yöntem tablosu içe aktarılıyor').toBe(true);
    // Soru AYNI satırda dekont yöntemiyle sorulur (içe aktarıp başka yöntemi sormak geçmez).
    expect(kod.filter(k => k.includes('evrakKapisindanGecer(') && k.includes("'DekontKaydetV2'")), 'dekont yöntem kapısı sorusu').toHaveLength(1);
  });

  it('düğmeyi gören (dekont yazabilen) her rol tür listesi ucunun kapısından da geçer', () => {
    const acabilen = APP_ROLES.filter(r => evrakKapisindanGecer(r, 'DekontKaydetV2'));
    expect(acabilen.length).toBeGreaterThan(0);
    expect(acabilen.filter(r => !ucKapisindanGecer(r, 'GET /api/mikro/cari-hareket/turler'))).toEqual([]);
  });
});

describe('Ç-İ6 — adresi parçalardan kuran Mikro çağrıları (Ç-İ1\'in göremediği yol)', () => {
  it('şablon dizesi / birleştirmeyle kurulan `/api/mikro/…` adresleri: bilinen tek örnek (cari ekstre, tabloda olmayan uç)', () => {
    const DEVINGEN = /\/api\/mikro\/[\w/-]*(?:\$\{|['"`]\s*\+)/;
    const bulunan = ISTEMCI.flatMap(d => d.kod.filter(k => DEVINGEN.test(k)).map(() => d.ad));
    // `cari-hareket/${cariKod}`: `GET /api/mikro/cari-hareket/:cariKod` — ayrı uç (cari ekstre). Yeni bir şablon adres
    // tablo yollarından birini üretebiliyorsa burada ad eklemek yerine yolu düz metin yazıp kapıyı ortak tablodan sorun.
    expect(bulunan).toEqual(['src/components/CariEkstrePanel.tsx']);
  });
});
