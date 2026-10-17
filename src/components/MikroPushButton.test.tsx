/**
 * MikroPushButton.test.tsx — «Mikro'ya Gönder» düğmesi, yöntem kapısından GEÇEMEYEN rolde ÇİZİLMEZ
 * (karar turu 2026-10-11 — şartname § 10: İ3 «ölü düğme yok», İ4 «tek kaynak», H7 «evrak düğmeleri tek yerde»).
 *
 * `POST /api/mikro/evrak/kaydet` yönteme göre rol kapılı. Karar turu bazı iç rolleri BİLEREK kilitledi (K3-a … K3-k);
 * düğme o rollerde çizili kalsaydı her tıklama 403 dönerdi. On iki çağıranın hiçbirine rol koşulu yazılmadı: düğme rolü
 * depodan okur ve soruyu sunucu kapısının okuduğu AYNI tablodan sorar. Bu dosya üç şeyi kilitler:
 *   1) TEK KAYNAK — tablodaki her yöntem × her rol: düğme çizilir ⇔ `evrakKapisindanGecer` (tablo değişirse düğme izler);
 *   2) KARAR TABLOSU — § 10.1 «Geçen roller» / «Kilitlenen» sütunları ELLE (tablo yanlış değişirse burası kırılır);
 *   3) «kilitli rolde çağrı HİÇ yapılmaz» — düğme yoksa gövde üreticisi de gönderim de koşmaz.
 * Ayrıca: çağıran yerlerdeki her yöntem adı tabloda mı (kaynak çiti) ve rol kaynağı olarak deponun bilinen sınırları.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import MikroPushButton from './MikroPushButton';
import { useAppStore } from '../store/appStore';
import { UserRole } from '../types';
import { ADMIN_ROLES, APP_ROLES } from '../lib/rbac';
import { MIKRO_EVRAK_KAPILARI, evrakKapisindanGecer } from '../lib/mikroEvrakKapilari';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari, oku } from '../test/kaynakTarama';

const h = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('../services/mikroEvrak', () => ({ pushMikroEvrak: (...a: unknown[]) => h.push(...a) }));

const ROLLER = Object.values(UserRole);
/** Depodaki rolü değiştirir (gerçek depo — bileşenin okuduğu yer). `unknown`: bozuk / rolsüz değerler de denenir. */
const rolKoy = (rol: unknown) => { act(() => { useAppStore.setState({ userRole: rol as UserRole }); }); };
const ciz = (method: string, ek: { buildPayload?: () => Record<string, unknown> | null; onSuccess?: () => void } = {}) =>
  render(<MikroPushButton method={method} entityType="deneme" entityId="k1" buildPayload={ek.buildPayload ?? (() => ({ a: 1 }))} onSuccess={ek.onSuccess} />);
/** Düğmeyi GERÇEKTEN çizen roller (her rol için ayrı çizim). */
const cizenRoller = (method: string): UserRole[] => ROLLER.filter(rol => {
  rolKoy(rol);
  const { container, unmount } = ciz(method);
  const var_ = container.querySelector('button') !== null;
  unmount();
  return var_;
});
const sirali = (a: readonly string[]): string[] => [...a].sort();

/**
 * § 10.1 «Geçen roller» — düğmesi OLAN yöntemler (on iki çağıran, on bir yöntem). ELLE yazılır; `rbac.ts` ya da kapı
 * tablosu değişip bu kümelerden biri oynarsa test kırılır ve değişiklik BİLİNÇLİ yapılır (kullanıcı kararı).
 */
const IC_ROLLER = [UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.Logistics, UserRole.Accounting, UserRole.HR,
  UserRole.Purchasing, UserRole.Legal, UserRole.Corporate, UserRole.Quality];
const ELLE: Record<string, UserRole[]> = {
  VerilenTeklifKaydetV2: [UserRole.Admin, UserRole.Manager, UserRole.Sales],                           // K3-b (iç rol VE teklif yazma — H4)
  DahiliStokHareketKaydetV2: [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Purchasing], // K3-c
  EtiketBasimKaydetV2: IC_ROLLER,                                                                      // K3-e (iç personel kalır)
  PersonelIzinTalepKaydetV2: [UserRole.Admin, UserRole.HR, UserRole.Manager],                          // K3-f
  UrunReceteKaydetV2: [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Purchasing],     // K3-g
  UretimTalepKaydetV2: [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Quality],       // K3-h
  UretimIsEmriOlusturV2: [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Quality],     // K3-h
  SatinAlmaTalepKaydetV2: [UserRole.Admin, UserRole.Manager, UserRole.Purchasing],                     // K3-i
  BakimTalepKaydetV2: [UserRole.Admin, UserRole.Manager, UserRole.Logistics],                          // K3-j
  DepolarArasiSiparisKaydetV2: [UserRole.Admin, UserRole.Manager, UserRole.Logistics],                 // K3-k
  ServisIsEmriKaydetV2: [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Sales],        // ilk tur (değişmedi)
};
/** § 10.1 «Kilitlenen (bilerek)» sütunu — ekranı görüp düğmeyi artık GÖRMEYEN roller. */
const KILITLI: [karar: string, yontem: string, rol: UserRole][] = [
  ['K3-b', 'VerilenTeklifKaydetV2', UserRole.Accounting],
  ['K3-b (ilk tur)', 'VerilenTeklifKaydetV2', UserRole.B2B],
  ['K3-b (ilk tur)', 'VerilenTeklifKaydetV2', UserRole.Dealer],
  ['K3-c', 'DahiliStokHareketKaydetV2', UserRole.Accounting],
  ['K3-e (dış rol)', 'EtiketBasimKaydetV2', UserRole.Dealer],
  ['K3-f', 'PersonelIzinTalepKaydetV2', UserRole.Accounting],
  ['K3-g', 'UrunReceteKaydetV2', UserRole.Quality],
  ['K3-h', 'UretimTalepKaydetV2', UserRole.Purchasing],
  ['K3-h', 'UretimTalepKaydetV2', UserRole.Accounting],
  ['K3-h', 'UretimIsEmriOlusturV2', UserRole.Purchasing],
  ['K3-h', 'UretimIsEmriOlusturV2', UserRole.Accounting],
  ['K3-i', 'SatinAlmaTalepKaydetV2', UserRole.Logistics],
  ['K3-i', 'SatinAlmaTalepKaydetV2', UserRole.Accounting],
  ['K3-i', 'SatinAlmaTalepKaydetV2', UserRole.Quality],
  ['K3-j', 'BakimTalepKaydetV2', UserRole.Purchasing],
  ['K3-k', 'DepolarArasiSiparisKaydetV2', UserRole.Purchasing],
  ['K3-k', 'DepolarArasiSiparisKaydetV2', UserRole.Accounting],
  ['K3-k', 'DepolarArasiSiparisKaydetV2', UserRole.Sales],
];

beforeEach(() => { h.push.mockReset(); });
afterEach(() => {
  cleanup();
  act(() => { useAppStore.setState(useAppStore.getInitialState(), true); });   // rol testler arasında sızmasın
});

describe('MikroPushButton — tek kaynak: düğme ⇔ sunucunun yöntem kapısı', () => {
  it('denenen rol listesi sunucunun rol listesiyle AYNI (yeni rol eklenirse bu dosya da onu dener)', () => {
    expect(sirali(ROLLER)).toEqual(sirali(APP_ROLES));
  });

  it('tablodaki HER yöntem × HER rol: düğme çizilir ⇔ rol yöntemin kapısından geçer', () => {
    const ayrisan: string[] = [];
    let cizilen = 0, gizlenen = 0;
    for (const yontem of MIKRO_EVRAK_KAPILARI.keys()) {
      const cizen = new Set(cizenRoller(yontem));
      for (const rol of ROLLER) {
        const gecer = evrakKapisindanGecer(rol, yontem);
        if (cizen.has(rol) !== gecer) ayrisan.push(`${yontem} × ${rol}: düğme ${cizen.has(rol) ? 'VAR' : 'YOK'}, kapı ${gecer ? 'geçirir' : 'geçirmez'}`);
        if (gecer) cizilen++; else gizlenen++;
      }
    }
    expect(ayrisan).toEqual([]);
    // Boş döngü / hep aynı sonuç yanlış yeşil vermesin: iki durum da gerçekten görüldü.
    expect(cizilen).toBeGreaterThan(MIKRO_EVRAK_KAPILARI.size);
    expect(gizlenen).toBeGreaterThan(MIKRO_EVRAK_KAPILARI.size);
    expect(h.push).not.toHaveBeenCalled();   // çizmek gönderim yapmaz
  });
});

describe('MikroPushButton — karar tablosu (§ 10.1), ELLE', () => {
  it.each(Object.entries(ELLE))('%s: düğmeyi çizen roller TAM OLARAK karardaki «geçen roller»', (yontem, gecen) => {
    expect(sirali(cizenRoller(yontem))).toEqual(sirali(gecen));
  });

  it.each(KILITLI)('%s — %s × %s: düğme ÇİZİLMEZ, gövde üretilmez, istek atılmaz', (_karar, yontem, rol) => {
    rolKoy(rol);
    const buildPayload = vi.fn(() => ({ a: 1 }));
    const { container } = ciz(yontem, { buildPayload });
    expect(container).toBeEmptyDOMElement();   // düğme de, sonuç metni de, boş sarmalayıcı da yok
    expect(buildPayload).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
  });

  it('kilitlenen her rol, AYNI yöntemin geçen rolleri arasında değil (iki elle tablo birbiriyle çelişmiyor)', () => {
    for (const [karar, yontem, rol] of KILITLI) expect(ELLE[yontem], `${karar} ${yontem}`).not.toContain(rol);
  });
});

describe('MikroPushButton — geçen rolde düğme ÇALIŞIR', () => {
  it('tıklama: gövde üretilir, gönderim BİR kez yapılır (yöntem + gövde + varlık), başarı metni ve onSuccess', async () => {
    h.push.mockResolvedValue({ success: true });
    rolKoy(UserRole.Logistics);
    const onSuccess = vi.fn();
    ciz('BakimTalepKaydetV2', { onSuccess });
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Mikro’ya kaydedildi ✓')).toBeInTheDocument();
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith('BakimTalepKaydetV2', { a: 1 }, { entityType: 'deneme', entityId: 'k1' });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('rol istemcide BAYAT (düğme çizildi, sunucu 403 döndü): sunucunun metni düğmenin yanında GÖRÜNÜR — sessiz kalmaz', async () => {
    h.push.mockResolvedValue({ error: 'Bu veri için yetkiniz yok.', yetkiYok: true });
    rolKoy(UserRole.Logistics);
    const onSuccess = vi.fn();
    ciz('BakimTalepKaydetV2', { onSuccess });
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Bu veri için yetkiniz yok.')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('gönderim rol süzgecinde durduysa (istek atılmadı) o metin de görünür; başarı sayılmaz', async () => {
    h.push.mockResolvedValue({ success: false, yetkiYok: true, istekAtilmadi: true, error: 'Rolünüz bu işlemi Mikro\'ya gönderemez; istek atılmadı.' });
    rolKoy(UserRole.Logistics);
    const onSuccess = vi.fn();
    ciz('BakimTalepKaydetV2', { onSuccess });
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Rolünüz bu işlemi Mikro\'ya gönderemez; istek atılmadı.')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('MikroPushButton — rol kaynağı DEPO: bilinen sınırlar', () => {
  it('rol değişince düğme yeniden değerlendirilir (erken dönüş kancalardan SONRA — kanca sırası bozulmaz)', () => {
    rolKoy(UserRole.Purchasing);                       // K3-j: bakım talebinde kilitli
    const { container } = ciz('BakimTalepKaydetV2');
    expect(container).toBeEmptyDOMElement();
    rolKoy(UserRole.Logistics);                        // profil geldi / rol değişti → düğme belirir
    expect(screen.getByRole('button')).toBeEnabled();
    rolKoy(UserRole.Purchasing);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['null', null], ['undefined', undefined], ['boş dize', ''], ['küçük harfli rol', 'admin'], ['tanınmayan rol', 'Depocu'],
  ])('rolsüz / bozuk rol değeri (%s): HİÇBİR yöntemde çizilmez — iç personel kapılı ve tabloda olmayan yöntem dâhil', (_ad, rol) => {
    rolKoy(rol);
    for (const yontem of [...MIKRO_EVRAK_KAPILARI.keys(), 'TablodaOlmayanYontemV2']) {
      const { container, unmount } = ciz(yontem);
      expect(container, yontem).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('yüklenmemiş rol: deponun varsayılan rolü yönetici DEĞİL ve her kapıdan geçmiyor (profil gelmeden kilitli düğme açılmaz)', () => {
    const ilk = useAppStore.getInitialState().userRole;
    expect(ADMIN_ROLES.map(String)).not.toContain(ilk);
    const gecemedigi = [...MIKRO_EVRAK_KAPILARI.keys()].filter(y => !evrakKapisindanGecer(ilk, y));
    expect(gecemedigi).toContain('DekontKaydetV2');                // cari borç / alacak yazımı
    expect(gecemedigi).toContain('DepolarArasiSiparisKaydetV2');
    // Depoya hiç dokunulmadan (afterEach ilk duruma döndürür) çizim: kilitli düğme yok.
    const { container } = ciz('DepolarArasiSiparisKaydetV2');
    expect(container).toBeEmptyDOMElement();
  });

  it('karar yalnız ROLDEN: depodaki kullanıcı kim olursa olsun (sahip hesabı dâhil) kilitli rolde düğme GİZLİ kalır', () => {
    // Sunucu süper yöneticiyi rolüne bakmadan geçirir; istemci role bakar. Fark bilerek kabul edildi: gizli düğme, ölü düğme değil.
    act(() => { useAppStore.setState({ user: { uid: 'sahip', email: 'sahip@example.com' } as NonNullable<ReturnType<typeof useAppStore.getState>['user']> }); });
    rolKoy(UserRole.Purchasing);
    expect(ciz('BakimTalepKaydetV2').container).toBeEmptyDOMElement();
  });
});

// ── Kaynak çitleri ──────────────────────────────────────────────────────────
/** `<MikroPushButton … method=…>` çağrı yerleri ve `method` özniteliğindeki yöntem adları (yorumlar hariç). */
function cagiranlar(): { site: string; yontemler: string[] }[] {
  const out: { site: string; yontemler: string[] }[] = [];
  for (const yol of kaynakDosyalari(SRC_KOK)) {
    if (yol.endsWith('/MikroPushButton.tsx') || !oku(yol).includes('<MikroPushButton')) continue;
    const kod = kodSatirlari(yol).map(s => s.kod).join('\n');
    const baslar = [...kod.matchAll(/<MikroPushButton\b/g)].map(m => m.index);
    baslar.forEach((bas, sira) => {
      const site = `${gorece(yol)}:${kod.slice(0, bas).split('\n').length}`;
      const son = baslar[sira + 1] ?? kod.length;
      const i = kod.indexOf('method=', bas);
      if (i < 0 || i >= son) { out.push({ site, yontemler: [] }); return; }
      if (kod[i + 7] !== '{') {            // method="A"
        out.push({ site, yontemler: [kod.slice(i + 8, kod.indexOf('"', i + 8))] });
        return;
      }
      // method={koşul ? 'A' : 'B'} — eşleşen süslü paranteze kadar; yalnız DEĞER konumundaki dizeler yöntem adıdır
      // (`{`, `?`, `:`, `||`, `??` ardından). Koşuldaki karşılaştırma dizesi (`=== 'purchase'`) yöntem sayılmaz.
      let derinlik = 0, j = i + 7;
      do { if (kod[j] === '{') derinlik++; else if (kod[j] === '}') derinlik--; j++; } while (derinlik > 0 && j < son);
      const ifade = kod.slice(i + 7, j);
      out.push({ site, yontemler: [...ifade.matchAll(/(?:[{?:]|\|\||\?\?)\s*['"]([A-Za-z0-9_]+)['"]/g)].map(m => m[1]) });
    });
  }
  return out;
}

describe('ÇİT: düğmenin çağıranları', () => {
  const SITELER = cagiranlar();

  it('tarama gerçekten oldu: çağıran yerler bulundu ve HER birinde yöntem adı okunabildi', () => {
    expect(SITELER.length).toBeGreaterThanOrEqual(12);
    expect(SITELER.filter(s => s.yontemler.length === 0).map(s => s.site)).toEqual([]);
  });

  it('çağıranlardaki HER yöntem beyaz listede (tabloda olmayan yöntemin düğmesi her tıklamada 400 dönerdi — ölü düğme)', () => {
    const disarida = SITELER.flatMap(s => s.yontemler.filter(y => !MIKRO_EVRAK_KAPILARI.has(y)).map(y => `${s.site} ${y}`));
    expect(disarida).toEqual([]);
  });

  it('çağıranı olan HER yöntemin elle «geçen roller» satırı var; elle tabloda çağıranı olmayan yöntem yok', () => {
    expect(sirali([...new Set(SITELER.flatMap(s => s.yontemler))])).toEqual(sirali(Object.keys(ELLE)));
  });

  it('bileşen kararı ortak tablodan soruyor: rol depodan, koşul `evrakKapisindanGecer` — kopya rol listesi yok', () => {
    const kod = kodSatirlari(`${SRC_KOK}/components/MikroPushButton.tsx`).map(s => s.kod).join('\n');
    const adet = (parca: string) => kod.split(parca).length - 1;
    expect(adet('const rol = useAppStore(s => s.userRole);')).toBe(1);
    expect(adet('if (!evrakKapisindanGecer(rol, method)) return null;')).toBe(1);
    // Bileşende rol adı YAZILMAZ (yorumlar hariç): hiçbir rol değeri dize olarak geçmez.
    expect(APP_ROLES.filter(r => new RegExp(`['"\`]${r}['"\`]`).test(kod))).toEqual([]);
    // Erken dönüş, bileşendeki son kancadan SONRA.
    expect(kod.indexOf('if (!evrakKapisindanGecer(rol, method)) return null;')).toBeGreaterThan(Math.max(kod.lastIndexOf('useState'), kod.lastIndexOf('useAppStore(')));
  });
});
