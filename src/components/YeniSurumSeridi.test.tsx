// @vitest-environment jsdom
/**
 * YeniSurumSeridi.test.tsx — şeridin kendisi (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S3, S4, S6): metin, düğmeler,
 * erişilebilirlik, dil, bağlanınca denetimin başlaması. Karar / zamanlama ayrıntısı src/lib/yeniSurum.test.ts'te; gerçek App
 * içinde (giriş ekranı, dış rol sayfası) DisRolEkrani.uygulama.test.tsx'te.
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import YeniSurumSeridi from './YeniSurumSeridi';
import AIChat from './AIChat';
import { SURUM_DENETIM_ARALIGI_MS, seritDeposuOlustur, type SeritDeposu } from '../lib/yeniSurum';
import { SURUM_META_ADI, SURUM_UCU } from '../lib/surumKimligi';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gorece, kaynakDosyalari, kodSatirlari, SRC_KOK } from '../test/kaynakTarama';

// AIChat (Y5 katman sınaması) oturum jetonunu firebase'den okur; pencere açılırken istek atılmaz — sahte yeter.
vi.mock('../firebase', () => ({ auth: { currentUser: null } }));

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const TR_YENI = 'Yeni sürüm yayında. Kaydedilmemiş işiniz yoksa yenileyin.';
const TR_SAYFA = 'Bu sayfa için yenileme gerekiyor';

let depo: SeritDeposu;
const metaKoy = (icerik: string) => {
  const m = document.createElement('meta');
  m.setAttribute('name', SURUM_META_ADI);
  m.setAttribute('content', icerik);
  document.head.appendChild(m);
};

beforeEach(() => { depo = seritDeposuOlustur(); document.documentElement.lang = 'tr'; });
afterEach(() => {
  cleanup();
  document.head.querySelectorAll(`meta[name="${SURUM_META_ADI}"]`).forEach(m => m.remove());
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('şerit', () => {
  it('`role="status"` bölgesi her zaman sayfada, şerit yokken BOŞ', () => {
    render(<YeniSurumSeridi depo={depo} />);
    const bolge = screen.getByRole('status');
    expect(bolge).toHaveAttribute('aria-live', 'polite');
    expect(bolge.textContent).toBe('');
    expect(bolge.querySelector('button')).toBeNull();
  });

  it('yeni sürüm: metin + «Yenile» + kapatma düğmesi; odak çalınmaz', () => {
    render(<YeniSurumSeridi depo={depo} />);
    const odak = document.activeElement;
    act(() => depo.goster({ tur: 'yeni-surum', surum: B }));
    expect(screen.getByRole('status')).toHaveTextContent(TR_YENI);
    expect(screen.getByRole('button', { name: 'Yenile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bildirimi kapat' })).toBeInTheDocument();
    expect(document.activeElement).toBe(odak);                     // S6: odak tuzağı / odak çalma yok
    expect(screen.getByRole('status').querySelector('[aria-modal], [role="dialog"], [role="alertdialog"]')).toBeNull();
  });

  it('«Yenile» sayfayı yeniler (kendiliğinden değil, tıklamayla)', () => {
    const yenile = vi.fn();
    render(<YeniSurumSeridi depo={depo} yenile={yenile} />);
    act(() => depo.goster({ tur: 'yeni-surum', surum: B }));
    expect(yenile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(yenile).toHaveBeenCalledTimes(1);
  });

  it('«Yenile» (sınama yenileyicisi verilmeden) sayfanın kendi `location.reload()`unu çağırır — yalnız tıklamayla', () => {
    const reload = vi.fn();
    const sahteKonum: Pick<Location, 'reload'> = { reload };
    vi.spyOn(window, 'location', 'get').mockReturnValue(sahteKonum as Location);
    render(<YeniSurumSeridi depo={depo} />);
    act(() => depo.goster({ tur: 'yeni-surum', surum: B }));
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('kapat → şerit kalkar, sürüm kapatma hafızasına yazılır', () => {
    render(<YeniSurumSeridi depo={depo} />);
    act(() => depo.goster({ tur: 'yeni-surum', surum: B }));
    fireEvent.click(screen.getByRole('button', { name: 'Bildirimi kapat' }));
    expect(screen.getByRole('status').textContent).toBe('');
    expect(depo.kapatilan()).toBe(B);
  });

  it('eksik sayfa parçası: «Bu sayfa için yenileme gerekiyor»', () => {
    render(<YeniSurumSeridi depo={depo} />);
    act(() => depo.goster({ tur: 'sayfa-yenileme', surum: null }));
    expect(screen.getByRole('status')).toHaveTextContent(TR_SAYFA);
    expect(screen.getByRole('status')).not.toHaveTextContent(TR_YENI);
  });

  it('dil `<html lang>`dan: İngilizceye geçince metin de geçer', async () => {
    render(<YeniSurumSeridi depo={depo} />);
    act(() => depo.goster({ tur: 'yeni-surum', surum: B }));
    await act(async () => { document.documentElement.lang = 'en'; await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('A new version is live. Reload if you have no unsaved work.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
    act(() => depo.goster({ tur: 'sayfa-yenileme', surum: null }));
    expect(screen.getByRole('status')).toHaveTextContent('This page needs a reload');
  });
});

// ── Katman ve konum (inceleme 1: Y3, Y4) ────────────────────────────────────────────────────────────────────────────────────

/**
 * Y3 taramasının istisnaları (inceleme 2, Y5): kullanıcının AÇTIĞI pencereler «altta sabit duran öğe» değildir — açıkken şeridin
 * ÜSTÜNDE olmalıdırlar (şerit pencerenin içeriğini örtmesin), modal katmanının altında. Ad ve gerekçe zorunlu.
 */
const ACILIR_PENCERELER: ReadonlyArray<{ dosya: string; z: number; ad: string; gerekce: string }> = [
  {
    dosya: 'src/components/AIChat.tsx',
    z: 69,
    ad: 'AIChat sohbet penceresi',
    gerekce: 'açma düğmesiyle kullanıcı açar (altta sabit duran öğe değil); şeridin üstünde, sayfa modallarının (`z-[70]`+) ve modal katmanının altında. Açma düğmesi `z-50` kalır.',
  },
];

/** Sınıf dizisindeki tek `z-[N]` değeri; yoksa / birden çoksa `null`. */
const zDegeri = (sinif: string): number | null => {
  const hepsi = [...sinif.matchAll(/(?:^|\s)z-\[(\d+)\](?=\s|$)/g)];
  return hepsi.length === 1 ? Number(hepsi[0][1]) : null;
};

describe('katman ve konum', () => {
  it('Y3 katman: modal katmanının (ConfirmModal `z-[100]`) ALTINDA, altta sabit duran `z-[60]`…`z-[99]` öğelerin ÜSTÜNDE — `z-[65]`', () => {
    render(<YeniSurumSeridi depo={depo} />);
    const z = zDegeri(screen.getByRole('status').className);
    // Değer ölçülerek seçildi (YeniSurumSeridi.tsx başlığı); 9998'e geri alınırsa şerit açık pencerelerin düğmelerini örter.
    expect(z).toBe(65);
    if (z === null) return;

    // Modal katmanı: genel onay penceresinin katmanı (kaynaktan ölçülür).
    const modalSatiri = kodSatirlari(join(SRC_KOK, 'components', 'ConfirmModal.tsx')).find(sat => /fixed inset-0/.test(sat.kod));
    const modalZ = modalSatiri ? zDegeri(modalSatiri.kod.match(/className="([^"]*)"/)?.[1] ?? '') : null;
    expect(modalZ).toBe(100);
    if (modalZ !== null) expect(z).toBeLessThan(modalZ);

    // Altta sabit duran öğeler (`fixed` + `bottom-N`) `z-[60]`…`z-[99]` aralığındaysa şerit onların üstünde (bugün: SabitKiymetModule
    // bildirimi `z-[60]`). Aralığa yeni bir alt öğe eklenir ve şeridin üstüne çıkarsa burası adıyla kırmızı.
    const bulunan = kaynakDosyalari(SRC_KOK)
      .filter(yol => !yol.endsWith('YeniSurumSeridi.tsx') && readFileSync(yol, 'utf-8').includes('bottom-'))
      .flatMap(yol => kodSatirlari(yol)
        .filter(sat => /\bfixed\b/.test(sat.kod) && /\bbottom-\d/.test(sat.kod))
        .flatMap(sat => [...sat.kod.matchAll(/\bz-\[(\d+)\]/g)].map(e => ({ dosya: gorece(yol), site: `${gorece(yol)}:${sat.n}`, z: Number(e[1]) }))))
      .filter(o => o.z >= 60 && o.z <= 99);
    // İstisna (Y5): kullanıcının AÇTIĞI pencereler «altta sabit duran öğe» değildir — şeridin ÜSTÜNDE olmaları gerekir. Her istisna
    // tam olarak BİR siteyle eşleşmeli (bayatlarsa ya da aynı dosyada ikinci bir alt öğeyi örterse kırmızı).
    for (const istisna of ACILIR_PENCERELER) {
      expect(bulunan.filter(o => o.dosya === istisna.dosya && o.z === istisna.z).map(o => o.site), istisna.ad).toHaveLength(1);
    }
    const altOgeleri = bulunan.filter(o => !ACILIR_PENCERELER.some(i => i.dosya === o.dosya && i.z === o.z));
    expect(altOgeleri.length).toBeGreaterThan(0);                  // ölçüm boşa dönmesin (SabitKiymetModule `z-[60]`)
    expect(altOgeleri.filter(o => o.z >= z)).toEqual([]);
  });

  it('Y5 AIChat: kullanıcının açtığı sohbet penceresi `z-[69]` — şeridin ÜSTÜNDE, sayfa modallarının (`z-[70]`+) altında; açma düğmesi `z-50` kalır', async () => {
    // jsdom'da `scrollIntoView` yok; AIChat ileti listesini kaydırır. Sınamadan sonra eski hâline döner.
    const onceki = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    onTestFinished(() => {
      if (onceki) Object.defineProperty(Element.prototype, 'scrollIntoView', onceki);
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    });
    render(<YeniSurumSeridi depo={depo} />);
    const seritZ = zDegeri(screen.getByRole('status').className);
    const { container } = render(<AIChat currentLanguage="tr" />);
    const acmaDugmesi = container.querySelector('button');
    expect(acmaDugmesi).not.toBeNull();
    if (!acmaDugmesi) return;
    expect(acmaDugmesi.className.split(/\s+/)).toContain('z-50');
    expect(zDegeri(acmaDugmesi.className)).toBeNull();
    fireEvent.click(acmaDugmesi);
    const pencere = (await screen.findByText('Cetpa AI Asistan')).closest('.fixed');
    expect(pencere).not.toBeNull();
    if (!pencere || seritZ === null) return;
    const pencereZ = zDegeri(pencere.className);
    // `z-50`ye geri alınırsa açık pencere şeridin altında kalır (şerit yanıt alanını örter) → kırmızı.
    expect(pencereZ).toBe(ACILIR_PENCERELER[0].z);
    if (pencereZ === null) return;
    expect(pencereZ).toBeGreaterThan(seritZ);
    expect(pencereZ).toBeLessThan(100);                             // modal katmanı (ConfirmModal `z-[100]`) yine üstte
    expect(pencereZ).toBeLessThan(70);                              // sayfa modalları (DrillDown `fixed inset-0 z-[70]`, AccountingModule) üstte (inceleme 3)
  });

  it('Y4 alt boşluk `pb-24`: şerit `bottom-6` sabit düğmelerin (toplu işlem çubuğu, AIChat, «Başa dön») ÜSTÜNDE durur, onları örtmez', () => {
    render(<YeniSurumSeridi depo={depo} />);
    const siniflar = screen.getByRole('status').className.split(/\s+/);
    // pb-24 = 6rem; en yüksek `bottom-6` düğme (AIChat) 1,5rem + 3,5rem = 5rem'de biter. `pb-4`e dönerse şerit onları örter.
    expect(siniflar.filter(c => /^pb-/.test(c))).toEqual(['pb-24']);
    expect(siniflar).toEqual(expect.arrayContaining(['fixed', 'bottom-0']));
  });
});

describe('bağlanınca denetim başlar', () => {
  it('gömülü kimlik varsa: 5 dakika sonra sunucuya sorar, farklı sürümde şerit çıkar', async () => {
    vi.useFakeTimers();
    metaKoy(A);
    const getir = vi.fn(async () => new Response(JSON.stringify({ surum: B }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', getir);
    render(<YeniSurumSeridi depo={depo} />);
    expect(getir).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(SURUM_DENETIM_ARALIGI_MS); });
    expect(getir.mock.calls.map(c => String((c as unknown[])[0]))).toEqual([SURUM_UCU]);
    expect(screen.getByRole('status')).toHaveTextContent(TR_YENI);
  });

  it('gömülü kimlik YOKSA (geliştirme sunucusu): hiç sormaz, şerit çıkmaz', async () => {
    vi.useFakeTimers();
    const getir = vi.fn(async () => new Response(JSON.stringify({ surum: B }), { status: 200 }));
    vi.stubGlobal('fetch', getir);
    render(<YeniSurumSeridi depo={depo} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(SURUM_DENETIM_ARALIGI_MS * 3); });
    expect(getir).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('kaldırılınca zamanlayıcı da kalkar', async () => {
    vi.useFakeTimers();
    metaKoy(A);
    const getir = vi.fn(async () => new Response(JSON.stringify({ surum: B }), { status: 200 }));
    vi.stubGlobal('fetch', getir);
    const { unmount } = render(<YeniSurumSeridi depo={depo} />);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(SURUM_DENETIM_ARALIGI_MS * 2); });
    expect(getir).not.toHaveBeenCalled();
  });
});
