/**
 * entegrasyonRolIstemci.cit.test.ts — İSTEMCİ kaynak çiti: entegrasyon uçlarının kapısı ORTAK TABLODAN sorulur
 * (2026-10-17, iç rol daraltma — `.wf/SARTNAME-ic-rol-daraltma.md` § 2 İ3 / İ4, § 7 K3 / K5).
 *
 * NEDEN VAR — yarım düzeltmeyi ve «yazıldı ama bağlanmadı»yı yakalar: sunucu kapısı daralınca o ucu çağıran HER istemci
 * yüzeyi aynı commit'te kapıyı sormalıdır. Bir yüzey unutulursa orada ölü düğme / sessiz 403 kalır ve hiçbir bileşen testi
 * bunu görmez. Bu çit bileşen bilmez, DOSYA tarar (kalıp: `mikroRolIstemci.cit.test.ts`):
 *
 *   Ç-E1  `ENTEGRASYON_UC_KAPILARI`'ndaki yollardan birini KOD satırında geçiren her istemci dosyası ortak tablodan içe aktarım
 *         yapar ve çağırdığı ucun KENDİ anahtarını (`'YÖNTEM /yol'`) taşır. İstisnalar ADIYLA ve gerekçesiyle.
 *   Ç-E2  Çağıranı OLMAYAN uçlar (L3 yevmiye, P1 Paraşüt fatura) adıyla: yol tablo dışında hiçbir istemci dosyasında geçmez.
 *   Ç-E3  Kilit çakışması (İ3): ucu çağıran ekranı GÖREN roller (App.tsx sekme tablosundan OKUNUR) − kapıdan geçen roller =
 *         bilerek kilitlenenler (`KARAR_KILIDI`, elle). Sekme kümesi kapıdan genişse fark burada adıyla yazılıdır.
 *   Ç-E4  Bağlantı: her yüzeyi AÇAN kod var (bileşen gerçekten bir sekmede çizilir — «yazıldı ama bağlanmadı» çiti).
 *
 * Tarama YALNIZ kod satırlarına bakar (`kodSatirlari` — yorum, JSX yorumu hariç).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari } from './kaynakTarama';
import { ENTEGRASYON_UC_KAPILARI, entegrasyonUcKapisindanGecer, type EntegrasyonKapiliUc } from '../lib/entegrasyonUcKapilari';
import { APP_ROLES, STAFF_ROLES, type AppRole } from '../lib/rbac';

const ANAHTARLAR = Object.keys(ENTEGRASYON_UC_KAPILARI) as EntegrasyonKapiliUc[];
const yolu = (anahtar: EntegrasyonKapiliUc): string => anahtar.slice(anahtar.indexOf(' ') + 1);
const kacis = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Yol TAM geçmeli: `/api/shopify/sync` `/api/shopify/sync-x` içinde eşleşmez. */
const yolDeseni = (anahtar: EntegrasyonKapiliUc): RegExp => new RegExp(`${kacis(yolu(anahtar))}(?![\\w/-])`);

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
const gecenAnahtarlar = (d: Dosya): EntegrasyonKapiliUc[] => ANAHTARLAR.filter(a => d.kod.some(k => yolDeseni(a).test(k)));
const tabloyuIceAktarir = (d: Dosya): boolean => d.kod.some(k => /from\s+['"][^'"]*\/entegrasyonUcKapilari['"]/.test(k));

const TABLO = 'src/lib/entegrasyonUcKapilari.ts';
const SARMALAYICI = 'src/services/shopifyService.ts';

/** Ç-E1 İSTİSNALARI — yolu geçirdiği hâlde tabloyu içe aktarması GEREKMEYEN dosyalar. ELLE, gerekçesiyle; gerekçe ayrı sınanır. */
const ISTISNA: Record<string, { yollar: EntegrasyonKapiliUc[]; gerekce: string }> = {
  [TABLO]: { yollar: ANAHTARLAR, gerekce: 'tablonun kendisi' },
  [SARMALAYICI]: {
    yollar: ['POST /api/shopify/sync', 'POST /api/shopify/draft-order'],
    gerekce: 'ince sarmalayıcı (rol bilmez): `syncShopify`\'ın tek çağıranı B2BPortal (kapılı kart), `createShopifyDraftOrder`\'ın çağıranı yok',
  },
};

/** Ucu çağıran yüzey(ler) — dosya + yüzeyin göründüğü sekme(ler). ELLE (ölçüldü 2026-10-17). */
const YUZEY: Record<string, { dosyalar: string[]; sekmeler: string[] }> = {
  'GET /api/luca/kontor': { dosyalar: ['src/components/EBelgeMerkezi.tsx'], sekmeler: ['ebelge'] },
  'POST /api/luca/fatura-gonder': { dosyalar: ['src/components/EBelgeMerkezi.tsx'], sekmeler: ['ebelge'] },
  'POST /api/luca/sync/stok': { dosyalar: ['src/components/LucaSyncPanel.tsx'], sekmeler: ['settings'] },
  'POST /api/luca/sync/fatura': { dosyalar: ['src/components/LucaSyncPanel.tsx'], sekmeler: ['settings'] },
  'POST /api/ai/satis-ajani': { dosyalar: ['src/components/SatisAjaniPanel.tsx'], sekmeler: ['crm'] },
  'POST /api/ai/satinalma-ajani': { dosyalar: ['src/components/SatinAlmaAjaniPanel.tsx'], sekmeler: ['satin-alma'] },
  'POST /api/shopify/draft-order': { dosyalar: ['src/components/B2BPortal.tsx'], sekmeler: ['b2b', 'crm'] },
  'POST /api/shopify/sync': { dosyalar: ['src/components/B2BPortal.tsx'], sekmeler: ['b2b', 'crm'] },
  'POST /api/sku-mapping/auto-match': { dosyalar: ['src/components/SkuMappingPanel.tsx'], sekmeler: ['settings'] },
  'POST /api/inventory/auto-reorder': { dosyalar: ['src/components/InventoryView.tsx'], sekmeler: ['inventory'] },
};
/** İstemcide çağıranı OLMAYAN uçlar (ölçüldü 2026-10-17). Çağıran eklenince `YUZEY`'e taşınır. */
const CAGIRANI_YOK: EntegrasyonKapiliUc[] = ['POST /api/luca/sync/yevmiye', 'POST /api/parasut/fatura'];
/**
 * KİLİTLENENLER — ekranı (sekmeyi) görüp kapıdan geçemeyen iç roller: § 7 K5 «bilerek kilitlenenler» + A1 ölçümü. ELLE.
 * Bu roller düğmeyi / paneli artık GÖRMEZ (İ3) ve doğrudan istek 403 alır. Satır eklemek ya da çıkarmak kullanıcı kararıdır.
 */
const KARAR_KILIDI: Partial<Record<EntegrasyonKapiliUc, AppRole[]>> = {
  'POST /api/ai/satis-ajani': ['Purchasing'],                                   // K5 — CRM salt okunur; müşteri satış geçmişi modele gitmez
  'POST /api/shopify/draft-order': ['Accounting', 'Purchasing'],                // K5 — b2b / crm salt okunur; Shopify'da sipariş açmak yazmadır
  'POST /api/inventory/auto-reorder': ['Logistics', 'Accounting', 'Sales'],     // A1 — Stok sekmesi (Lojistik tam, Muhasebe / Satış salt okunur)
};

/** App.tsx `TAB_PERMISSIONS` satırından sekmeyi gören İÇ roller (tam + salt okunur). Ayarlar sekmesi App.tsx'te ayrıca
 *  Yönetici / Müdür / sahip koşuluyla çizilir — tablo satırı aynı kümeyi söyler. */
function sekmeyiGorenler(sekme: string): AppRole[] {
  const app = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod.trim());
  const desen = new RegExp(`^'?${kacis(sekme)}'?:\\s+\\{ full: \\[([^\\]]*)\\], readonly: \\[([^\\]]*)\\] \\},`);
  const satir = app.filter(k => desen.test(k));
  if (satir.length !== 1) throw new Error(`App.tsx TAB_PERMISSIONS: '${sekme}' satırı ${satir.length} kez bulundu`);
  const roller = [...satir[0].matchAll(/UserRole\.(\w+)/g)].map(m => m[1]);
  const bilinmeyen = roller.filter(r => !(APP_ROLES as readonly string[]).includes(r));
  if (bilinmeyen.length) throw new Error(`'${sekme}': tanınmayan rol ${bilinmeyen.join(', ')}`);
  return [...new Set(roller)] as AppRole[];
}
const sirali = (a: readonly string[]): string[] => [...a].sort();

describe('Ç-E1 — entegrasyon ucunun yolunu çağıran her istemci dosyası kapıyı ORTAK TABLODAN sorar', () => {
  it('tarama boş değil: istemci dosyaları okundu, tablo yolları kod satırlarında bulunuyor', () => {
    expect(ISTEMCI.length).toBeGreaterThan(200);
    expect(ANAHTARLAR).toHaveLength(12);
    expect(ISTEMCI.filter(d => gecenAnahtarlar(d).length > 0).length).toBeGreaterThanOrEqual(8);
  });

  it('yolu geçiren dosyaların kümesi = YÜZEY + istisnalar (yeni çağıran eklenince bu liste bilinçli güncellenir)', () => {
    const gecen = sirali(ISTEMCI.filter(d => gecenAnahtarlar(d).length > 0).map(d => d.ad));
    const beklenen = sirali([...new Set([...Object.values(YUZEY).flatMap(y => y.dosyalar), ...Object.keys(ISTISNA)])]);
    expect(gecen).toEqual(beklenen);
  });

  it('istisna dışındaki her dosya tabloyu içe aktarır ve çağırdığı ucun KENDİ anahtarını (`YÖNTEM /yol`) koşulda taşır', () => {
    for (const d of ISTEMCI) {
      const anahtarlar = gecenAnahtarlar(d);
      if (anahtarlar.length === 0) continue;
      const istisna = ISTISNA[d.ad];
      if (istisna) { expect(anahtarlar.filter(a => !istisna.yollar.includes(a)), `${d.ad}: istisna dışı yol`).toEqual([]); continue; }
      expect(tabloyuIceAktarir(d), `${d.ad}: ortak tablo içe aktarılmıyor`).toBe(true);
      for (const a of anahtarlar) {
        expect(d.kod.filter(k => k.includes(`entegrasyonUcKapisindanGecer(`) && k.includes(`'${a}'`)), `${d.ad}: '${a}' kapısı sorulmuyor`).toHaveLength(1);
      }
    }
  });

  it('sarmalayıcı istisnası: `syncShopify`\'ın tek çağıranı B2BPortal; `createShopifyDraftOrder`\'ın çağıranı YOK', () => {
    const cagiran = (ad: string): string[] => sirali(ISTEMCI.filter(d => d.ad !== SARMALAYICI && d.kod.some(k => new RegExp(`\\b${ad}\\(`).test(k))).map(d => d.ad));
    expect(cagiran('syncShopify')).toEqual(['src/components/B2BPortal.tsx']);
    expect(cagiran('createShopifyDraftOrder')).toEqual([]);
    // Sarmalayıcı belirteç / mağaza adresi GÖNDERMEZ (K1: sunucu artık kabul etmiyor).
    expect(dosya(SARMALAYICI).kod.filter(k => /accessToken|storeUrl/.test(k))).toEqual([]);
  });

  it('kapıyı soran dosyalarda rol ADI yazılmaz — koşul yalnız ortak tablodan (İ4)', () => {
    // B2BPortal bu taramanın DIŞINDA: bayi / fiyat listesi dalları (Faz 4 listesindeki eski rol koşulları) bu işin kapsamında
    // değil; iki Shopify koşulunun ortak tablodan geldiği `B2BPortal.test.tsx` kaynak çitinde satırıyla sabit.
    const ROL_ADI = /['"`](Admin|Manager|Sales|Logistics|Accounting|HR|Purchasing|Legal|Corporate|Quality|B2B|Dealer)['"`]|\bUserRole\.|\bhasFullAccess\b|\b(STAFF|ADMIN|EXTERNAL)_ROLES\b/;
    const taranan = [...new Set(Object.values(YUZEY).flatMap(y => y.dosyalar))].filter(ad => ad !== 'src/components/B2BPortal.tsx');
    expect(taranan).toHaveLength(6);
    // `'Dealer'` aynı zamanda FİYAT KADEMESİ adıdır (stok kartının `prices` anahtarı) — rol değil; o iki satır adıyla ayrılır.
    const FIYAT_KADEMESI = /^'Dealer'(\?)?: /;
    for (const ad of taranan) expect(dosya(ad).kod.map(k => k.trim()).filter(k => ROL_ADI.test(k) && !FIYAT_KADEMESI.test(k)), ad).toEqual([]);
  });
});

describe('Ç-E2 — çağıranı olmayan uçlar adıyla (kilitlenecek ekran yok)', () => {
  it('L3 yevmiye ve P1 Paraşüt fatura: yol tablo dışında hiçbir istemci dosyasının KOD satırında geçmez', () => {
    for (const a of CAGIRANI_YOK) {
      expect(ISTEMCI.filter(d => d.ad !== TABLO && d.kod.some(k => yolDeseni(a).test(k))).map(d => d.ad), a).toEqual([]);
    }
    expect(sirali([...Object.keys(YUZEY), ...CAGIRANI_YOK])).toEqual(sirali(ANAHTARLAR));
  });
});

describe('Ç-E3 — kilit çakışması (İ3): ekranı gören − kapıdan geçen = bilerek kilitlenenler', () => {
  it('her uç: sekme(ler)i gören iç roller App.tsx\'ten okunur; kapıdan geçemeyenler TAM OLARAK `KARAR_KILIDI`', () => {
    for (const a of Object.keys(YUZEY) as EntegrasyonKapiliUc[]) {
      const goren = [...new Set(YUZEY[a].sekmeler.flatMap(sekmeyiGorenler))];
      const kilitli = goren.filter(r => !entegrasyonUcKapisindanGecer(r, a));
      expect(sirali(kilitli), a).toEqual(sirali(KARAR_KILIDI[a] ?? []));
      // Kilitli her rol iç roldür (dış rol hiçbir sekmeyi görmez) ve ortak tablo ona «geçemez» der.
      for (const r of KARAR_KILIDI[a] ?? []) {
        expect(STAFF_ROLES, `${a} × ${r}`).toContain(r);
        expect(entegrasyonUcKapisindanGecer(r, a), `${a} × ${r}`).toBe(false);
      }
    }
  });

  it('ölçülen sekme kümeleri (2026-10-17) — sekme tablosu değişirse kilit tablosu bilinçli yeniden düşünülür', () => {
    expect(sirali(sekmeyiGorenler('ebelge'))).toEqual(sirali(['Admin', 'Accounting', 'Manager']));
    expect(sirali(sekmeyiGorenler('settings'))).toEqual(sirali(['Admin', 'Manager']));
    expect(sirali(sekmeyiGorenler('crm'))).toEqual(sirali(['Admin', 'Manager', 'Sales', 'Accounting', 'Purchasing']));
    expect(sirali(sekmeyiGorenler('b2b'))).toEqual(sirali(['Admin', 'Manager', 'Sales', 'Accounting']));
    expect(sirali(sekmeyiGorenler('satin-alma'))).toEqual(sirali(['Admin', 'Manager', 'Logistics', 'Purchasing', 'Accounting']));
    expect(sirali(sekmeyiGorenler('inventory'))).toEqual(sirali(['Admin', 'Manager', 'Logistics', 'Purchasing', 'Accounting', 'Sales']));
  });
});

describe('Ç-E4 — bağlantı: her yüzeyi AÇAN kod var («yazıldı ama bağlanmadı» çiti)', () => {
  /** Bileşen → onu JSX ile çizen dosya(lar). ELLE (ölçüldü 2026-10-17). */
  const ACAN: Record<string, string[]> = {
    EBelgeMerkezi: ['src/App.tsx'],
    ERPHubPanel: ['src/pages/SettingsPage.tsx'],
    SkuMappingPanel: ['src/pages/SettingsPage.tsx'],
    SettingsPage: ['src/App.tsx'],
    SatisAjaniPanel: ['src/pages/CRMPage.tsx'],
    SatinAlmaAjaniPanel: ['src/pages/SatinAlmaPage.tsx'],
    B2BPortal: ['src/App.tsx', 'src/pages/CRMPage.tsx'],
    InventoryView: ['src/pages/InventoryPage.tsx'],
    InventoryPage: ['src/App.tsx'],
    CRMPage: ['src/App.tsx'],
    SatinAlmaPage: ['src/App.tsx'],
  };
  it('her bileşen en az bir yerde çiziliyor ve çizen dosya kümesi ölçülenle aynı', () => {
    for (const [bilesen, beklenen] of Object.entries(ACAN)) {
      const cizen = sirali(ISTEMCI.filter(d => d.kod.some(k => new RegExp(`<${bilesen}\\b`).test(k))).map(d => d.ad));
      expect(cizen, bilesen).toEqual(sirali(beklenen));
    }
    // LUCA paneli ERP merkezinin panel haritasından seçilir (JSX değil, eşleme): bağlantı satırı adıyla.
    expect(dosya('src/components/ERPHubPanel.tsx').kod.map(k => k.trim()).filter(k => /^luca:\s+LucaSyncPanel,$/.test(k))).toHaveLength(1);
  });
});
