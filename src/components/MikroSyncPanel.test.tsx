/**
 * MikroSyncPanel.test.tsx — 14 import düğmesi + stok-miktar (15) ARKA PLAN kartına bağlandı mı, "Tümünü Çek" işi bekliyor mu,
 * Senkron Geçmişi yetkisizlik ≠ boşluk (mikro-import-arkaplan istemci şartnamesi §C, 2026-09-24). ÖNCE YAZILDI.
 *
 * "Yazıldı ama bağlanmadı" bu projede 4 kez tekrarladı: kart yazılır, panel çağırmaz. Bu test paneli
 * GERÇEKTEN çizer ve kartları ARIA rolüyle sayar (çalışma zamanı) + kaynak metnini tarar (statik bağ).
 * Kilit GLOBAL tek iş (K-C): "Tümünü Çek" 2. adımı 1. işin `{running:false, finishedAt}` yayını GELMEDEN
 * başlatırsa hepsi `alreadyRunning` alır — bu yüzden sıralama vakası şart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import MikroSyncPanel from './MikroSyncPanel';
import { mikroIsAdi } from '../lib/mikroIsAdi';
import { yayinla, sifirla, koleksiyonAyarla } from '../hooks/useArkaPlanIsi.testDuzenegi';
import { tumunuCekSifirla } from '../hooks/useTumunuCek';
import { auth } from '../firebase';
import * as servis from '../services/mikroService';

const durum = vi.hoisted(() => ({ rol: 'Admin' }));

vi.mock('../lib/dbClient', async () => (await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);
vi.mock('../services/mikroService', () => ({
  getMikroStatus: vi.fn(() => Promise.resolve({ configured: true, connected: true, mode: 'local' })),
  mikroImportBaslat: vi.fn(),
}));
vi.mock('../services/syncRetryService', () => ({
  getSyncQueueStats: vi.fn(() => Promise.resolve({ queued: 0, dead: 0, lastSuccess: null })),
  clearDeadJobs: vi.fn(),
}));
vi.mock('../services/mikroEvrak', () => ({ processMikroRetries: vi.fn() }));
vi.mock('../store/appStore', () => ({
  useAppStore: (sec: (s: { userRole: string }) => unknown) => sec({ userRole: durum.rol }),
}));

const baslat = vi.mocked(servis.mikroImportBaslat);
const bekleMikro = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const KAYNAK = readFileSync(join(__dirname, 'MikroSyncPanel.tsx'), 'utf8');
const say = (m: string) => KAYNAK.split(m).length - 1;

beforeEach(() => {
  sifirla();
  tumunuCekSifirla();   // Tümünü Çek sırası modül düzeyinde (delta bulgu 9) — testler arasında sızmasın
  durum.rol = 'Admin';
  baslat.mockReset();
  baslat.mockImplementation(route => Promise.resolve({ success: true, started: true, job: mikroIsAdi(route) }));
});
afterEach(() => vi.unstubAllGlobals());

async function cizVeBekle() {
  const r = render(<MikroSyncPanel currentLanguage="tr" />);
  await screen.findByText('Bağlı');   // status geldi → düğmeler açık
  await act(bekleMikro);
  return r;
}

describe('MikroSyncPanel — 14 uç + miktar = 15 arka plan kartı (çalışma zamanı)', () => {
  it('render → role=group kart sayısı 15 (stok, cari, miktar, 12 SQL); düğmeler ≥ 15', async () => {
    await cizVeBekle();
    const gruplar = screen.getAllByRole('group');
    expect(gruplar).toHaveLength(15);
    const adlar = gruplar.map(g => g.getAttribute('aria-label'));
    expect(adlar).toEqual(expect.arrayContaining(['Stok İçeri Al', 'Cari İçeri Al', 'Stok Miktarlarını Çek', 'Cari Hareketler (Tümü)', 'Faturalar', 'Siparişler']));
    expect(screen.getAllByRole('button', { name: /Çek$|İçeri Al$|Miktarları Çek/ }).length).toBeGreaterThanOrEqual(15);
    // 4 senkron uç PullCard olarak KALIR (grup değil): Faturadan Sipariş, Personel, Reçete, Cari Adres
    for (const ad of ['Faturadan Sipariş Türet', 'Personel', 'Üretim Reçeteleri', 'Cari Adresleri']) {
      expect(screen.getByText(ad)).toBeInTheDocument();
      expect(adlar).not.toContain(ad);
    }
  });

  it('kart düğmesi rotayı mikroImportBaslat ile başlatır; miktar kartı jobs/stokMiktarImport okur (parite)', async () => {
    await cizVeBekle();
    fireEvent.click(screen.getByRole('button', { name: /^Miktarları Çek$/ }));
    await act(bekleMikro);
    expect(baslat).toHaveBeenCalledWith('/api/mikro/import/stok-miktar');
    await act(async () => { yayinla('stokMiktarImport', { running: false, processed: 10, updated: 10, failed: 0, total: 10, depoDagilimliUrun: 4, depoDevirli: 1, depoUyusmazlik: 0 }); });
    const kart = screen.getByRole('group', { name: 'Stok Miktarlarını Çek' });
    expect(kart.textContent).toContain('10/10');
    expect(kart.textContent).toContain('Depo dağılımı yazılan ürün');
    expect(kart.textContent).toMatch(/1 üründe açılış\/devir/);
    expect(kart.textContent).not.toContain('FAZLA');   // uyuşmazlık 0 → basılmaz
  });

  it('stok kartı fiyatliUrun === 0 rehberini ekOzet ile basar', async () => {
    await cizVeBekle();
    await act(async () => { yayinla('mikroImport-stok', { running: false, created: 1, updated: 2, fiyatliUrun: 0 }); });
    expect(screen.getByRole('group', { name: 'Stok İçeri Al' }).textContent).toContain('Satış Fiyatları → Çek');
  });
});

describe('MikroSyncPanel — statik bağ (kaynak tarayan)', () => {
  it('ImportCard yok; eski importXFromMikro/MikroImportResult 0; arkaPlan: true 12; d.total ?? 0 yok; isiBaslatVeBekle ≥ 1; <ArkaPlanIsiKarti 4; literal "stokMiktarImport"/"jobs" yok', () => {
    expect(say('ImportCard')).toBe(0);
    expect(say('importStokFromMikro') + say('importCariFromMikro') + say('MikroImportResult')).toBe(0);
    expect(say('arkaPlan: true')).toBe(12);
    expect(say('d.total ?? 0')).toBe(0);
    expect(say('isiBaslatVeBekle(')).toBeGreaterThanOrEqual(1);
    expect(say('<ArkaPlanIsiKarti')).toBe(4);
    expect(say("'stokMiktarImport'")).toBe(0);   // tek sözlük: mikroIsAdi(route)
    expect(say("'jobs'")).toBe(0);               // jobs/ okuması TEK hook (useArkaPlanIsi)
    expect(say('useArkaPlanIsi(')).toBe(0);      // kanca kartın dışından çağrılmaz
  });
});

describe('MikroSyncPanel — Tümünü Çek işin bitişini BEKLER (Mikro eşzamanlı yük)', () => {
  it('2. adımın baslat çağrısı, 1. işin {running:false, finishedAt} yayını GELMEDEN yapılmaz', async () => {
    await cizVeBekle();
    fireEvent.click(screen.getByRole('button', { name: /Tümünü Çek/ }));
    await act(bekleMikro);
    expect(baslat).toHaveBeenCalledTimes(1);
    expect(baslat).toHaveBeenCalledWith('/api/mikro/import/stok');
    await act(bekleMikro);
    expect(baslat).toHaveBeenCalledTimes(1);   // hâlâ 1: bekliyor
    await act(async () => { yayinla('mikroImport-stok', { running: true, finishedAt: null }); });
    expect(baslat).toHaveBeenCalledTimes(1);
    await act(async () => { yayinla('mikroImport-stok', { running: false, finishedAt: { _seconds: 1, _nanoseconds: 0 } }); });
    await waitFor(() => expect(baslat).toHaveBeenCalledTimes(2));
    expect(baslat).toHaveBeenLastCalledWith('/api/mikro/import/cari');
  });

  // Hakem bulgusu (2026-09-25): `catch { hata++ }` hata metnini hiçbir yere yazmıyordu; özet "ayrıntı ilgili
  // kartta" diyordu ama kartın `baslatmaHatasi` state'i yalnız KENDİ düğmesiyle dolar. Bakım kilidi açıkken
  // Stok İçeri Al kartında önceki koşunun yeşil "2384/2384 tamamlandı" satırı duruyor, hata hiçbir yerde
  // yoktu (2026-08-28'de düzeltilen "başlatılamadı ile önceki koşu karışıyor" arızasının aynısı).
  it('adım başlatma hataları ÖZETTE adıyla + metniyle basılır; "ayrıntı ilgili kartta" YOK', async () => {
    // 4 senkron uç + bakiye/mizan/kdv ham fetch kullanır — sahte başarı (ağa çıkılmaz).
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })));
    baslat.mockImplementation(route => Promise.resolve(
      route === '/api/mikro/import/stok' ? { success: false, error: 'Bakım kilidi: lead-birlestir' }
        : route === '/api/mikro/import/cari' ? { success: false, error: 'HTTP 403' }
          : { success: false, error: 'HTTP 502' },
    ));
    await cizVeBekle();
    // Stok kartında ÖNCEKİ başarılı koşu duruyor — özet olmadan kullanıcı yalnız bunu görürdü.
    await act(async () => { yayinla('mikroImport-stok', { running: false, processed: 2384, total: 2384, finishedAt: { _seconds: 1, _nanoseconds: 0 } }); });
    fireEvent.click(screen.getByRole('button', { name: /Tümünü Çek/ }));
    const ozet = await screen.findByRole('status', { name: 'Tümünü Çek özeti' });
    const metin = ozet.textContent ?? '';
    expect(metin).toContain('15 adım hatalı');    // stok, cari, 12 SQL, miktar (arka plan adımları)
    expect(metin).toContain('7 adım tamam');      // 4 senkron uç + bakiye/mizan/kdv
    expect(metin).toContain('Stok kartları: Bakım kilidi: lead-birlestir');
    expect(metin).toContain('Cariler: HTTP 403');
    expect(metin).toContain('Stok miktarları: HTTP 502');
    expect(within(ozet).getAllByRole('listitem')).toHaveLength(15);
    expect(metin).not.toContain('ayrıntı ilgili kartta');
    expect(say('ayrıntı ilgili kartta') + say('see the card')).toBe(0);
  });

  // Delta hakem 2026-09-25 (orta): eskiden 'başka iş çalışıyor' adımı hatalı sayılıp sıra SÜRÜYORDU — elle başlatılmış
  // iş koşarken senkron adımlar (bakiye/mizan/kdv/personel/reçete/adres) onunla EŞZAMANLI Mikro'ya gidiyordu.
  it('bir adım "başka iş çalışıyor" alırsa BEKLEMEZ ve sıra DURUR: sonraki adım başlatılmaz, senkron adımlar Mikro\'ya gitmez', async () => {
    const fetchSahte = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }));
    vi.stubGlobal('fetch', fetchSahte);
    baslat.mockImplementationOnce(() => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: 'stokMiktarImport' }));
    await cizVeBekle();
    fetchSahte.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Tümünü Çek/ }));
    const ozet = await screen.findByRole('status', { name: 'Tümünü Çek özeti' });
    expect(baslat.mock.calls.map(c => c[0])).toEqual(['/api/mikro/import/stok']);
    expect(fetchSahte).not.toHaveBeenCalled();
    expect(ozet.textContent).toContain("Stok kartları: Başka bir iş çalışıyor: stokMiktarImport — sıra durduruldu; o iş bitince Tümünü Çek'i yeniden başlatın");
    expect(ozet.textContent).toContain('Koşturulmayan adımlar: Cariler');
  });
});

// Delta hakem 2026-09-25 (CONFIRMED): kanca testleri `kimlik`i kendileri veriyor — panelin onu GERÇEKTEN
// `auth.currentUser`a bağladığını hiçbir test sınamıyordu (bağ silinse ya da sabitlense suite yeşil kalırdı).
describe('MikroSyncPanel — Tümünü Çek oturum değişince durur (panel → auth bağı)', () => {
  it('adım sürerken kullanıcı değişirse sonraki adım başlatılmaz; özet "Oturum değişti" + koşturulmayan adımlar', async () => {
    const fetchSahte = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }));
    vi.stubGlobal('fetch', fetchSahte);
    const oturum = auth as unknown as { currentUser: { uid: string; getIdToken?: () => Promise<string> } | null };
    const onceki = oturum.currentUser;
    oturum.currentUser = { uid: 'u1', getIdToken: () => Promise.resolve('t') };
    try {
      await cizVeBekle();
      fetchSahte.mockClear();
      fireEvent.click(screen.getByRole('button', { name: /Tümünü Çek/ }));
      await act(bekleMikro);
      expect(baslat).toHaveBeenCalledTimes(1);
      oturum.currentUser = { uid: 'u2', getIdToken: () => Promise.resolve('t') };   // çıkış + başka kullanıcıyla giriş
      await act(async () => { yayinla('mikroImport-stok', { running: false, finishedAt: { _seconds: 7, _nanoseconds: 0 } }); });
      const ozet = await screen.findByRole('status', { name: 'Tümünü Çek özeti' });
      expect(ozet.textContent).toContain('Oturum değişti — sıra durduruldu.');
      expect(ozet.textContent).toContain('Koşturulmayan adımlar: Cariler');
      expect(baslat).toHaveBeenCalledTimes(1);
      expect(fetchSahte).not.toHaveBeenCalled();
    } finally {
      oturum.currentUser = onceki;
    }
  });
});

// İnceleme bulgusu 2026-09-25: (1) SQL işi sayfa tavanına çarpınca iş hatasız biter ama veri EKSİK — özet onu
// 'tamam' sayıyordu. (2) Bekleme tavanı dolunca iş sunucuda sürüyor, kilidi tutuyor; sıra sürseydi senkron
// adımlar koşan işle EŞZAMANLI Mikro'ya giderdi → sıra DURUR, kalan adımlar koşturulmadı diye yazılır.
describe('MikroSyncPanel — Tümünü Çek: sayfa tavanı = hatalı adım; zaman aşımı sırayı durdurur', () => {
  it('iş truncated:true + limit ile biterse adım HATALI: "Sayfa tavanına çarptı — veri EKSİK (yalnız ilk 20.000 satır alındı)"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })));
    baslat.mockImplementation(route => Promise.resolve(
      route === '/api/mikro/import/stok' ? { success: true, started: true, job: mikroIsAdi(route) } : { success: false, error: 'HTTP 502' },
    ));
    await cizVeBekle();
    fireEvent.click(screen.getByRole('button', { name: /Tümünü Çek/ }));
    await act(bekleMikro);
    await act(async () => { yayinla('mikroImport-stok', { running: false, truncated: true, limit: 20000, finishedAt: { _seconds: 5, _nanoseconds: 0 } }); });
    const ozet = await screen.findByRole('status', { name: 'Tümünü Çek özeti' });
    expect(ozet.textContent).toContain('Stok kartları: Sayfa tavanına çarptı — veri EKSİK (yalnız ilk 20.000 satır alındı)');
    expect(ozet.textContent).toContain('7 adım tamam');   // yalnız senkron adımlar; stok artık 'tamam' DEĞİL
  });

  it('bekleme tavanı dolarsa sıra DURUR: 2. adım başlatılmaz, özet "Sıra durduruldu" + koşturulmayan adımları listeler', async () => {
    const fetchSahte = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }));
    vi.stubGlobal('fetch', fetchSahte);
    await cizVeBekle();
    fetchSahte.mockClear();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: /Tümünü Çek/ }));
      await act(bekleMikro);
      await act(async () => { yayinla('mikroImport-stok', { running: true, finishedAt: null }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
      await act(bekleMikro);
      const ozet = screen.getByRole('status', { name: 'Tümünü Çek özeti' });
      expect(ozet.textContent).toContain('Stok kartları: İş 30 dk içinde bitmedi — iş hâlâ sürüyor olabilir, sıra durduruldu');
      expect(ozet.textContent).toContain('Sıra durduruldu.');
      expect(ozet.textContent).toContain('Koşturulmayan adımlar: Cariler');
      expect(ozet.textContent).toContain('Stok miktarları');
      expect(baslat).toHaveBeenCalledTimes(1);          // cari ve sonrası BAŞLATILMADI
      expect(fetchSahte).not.toHaveBeenCalled();        // senkron adımlar Mikro'ya GİTMEDİ
    } finally {
      vi.useRealTimers();
    }
  });
});

// Delta hakem 2026-09-25 (bulgu 10, CONFIRMED/orta — yarım düzeltme): özet hataları adıyla listeliyordu ama
// 7 senkron adım (4 senkron uç + bakiye/mizan/kdv) hatayı kendi kart state'ine yutup resolve ediyordu →
// her zaman 'tamam' sayılıyordu. pull/personel 120 sn'de HTML 502 → Personel kartı kırmızı, özet YEŞİL
// 'Bitti — 22 adım tamam.' (eski '7 adım tamam' iddiası yalnız fetch hep success döndüğü için yeşildi).
describe('MikroSyncPanel — Tümünü Çek: SENKRON adım hatası da özete girer', () => {
  it("pull/personel {success:false,'HTTP 502'} + bakiye HTML 502 (json patlar) → özette 'Personel: HTTP 502' ve 'Cari bakiyeler: …'; tamam sayısı 5", async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(
      url === '/api/mikro/pull/personel' ? { ok: false, json: () => Promise.resolve({ success: false, error: 'HTTP 502' }) }
        : url === '/api/mikro/pull/bakiye' ? { ok: false, json: () => Promise.reject(new SyntaxError("Unexpected token '<'")) }
          : { ok: true, json: () => Promise.resolve({ success: true }) },
    )));
    baslat.mockImplementation(() => Promise.resolve({ success: false, error: 'X' }));   // 15 arka plan adımı hızla hatalı
    await cizVeBekle();
    fireEvent.click(screen.getByRole('button', { name: /Tümünü Çek/ }));
    const ozet = await screen.findByRole('status', { name: 'Tümünü Çek özeti' });
    const metin = ozet.textContent ?? '';
    expect(metin).toContain('5 adım tamam');       // 7 senkron adımdan 2'si hatalı
    expect(metin).toContain('17 adım hatalı');     // 15 arka plan + personel + bakiye
    expect(metin).toContain('Personel: HTTP 502');
    expect(metin).toContain("Cari bakiyeler: Unexpected token '<'");
    // Kart da kendi hatasını gösterir (davranış korunur).
    expect(screen.getAllByText('HTTP 502').length).toBeGreaterThanOrEqual(1);
  });
});

// Delta hakem 2026-09-25 (bulgu 9, CONFIRMED/orta): döngü bileşen ömrüne bağlıydı — panel unmount olunca
// görünmeden sürüyor, geri dönüşte düğme yeniden basılabiliyor, ikinci döngü senkron uçları birincinin koşan
// işiyle eşzamanlı Mikro'ya gönderiyordu; birincinin özeti kayboluyordu.
describe('MikroSyncPanel — Tümünü Çek panel ömründen BAĞIMSIZ', () => {
  it('panel kapanıp yeniden açılınca sıra SÜRÜYOR: düğme "Çekiliyor: Stok kartları" + KAPALI; ikinci döngü YOK; bitince özet yeni panelde', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })));
    const ilk = await cizVeBekle();
    fireEvent.click(screen.getByRole('button', { name: /Tümünü Çek/ }));
    await act(bekleMikro);
    expect(baslat).toHaveBeenCalledTimes(1);
    ilk.unmount();

    await cizVeBekle();
    const dugme = screen.getByRole('button', { name: /Çekiliyor: Stok kartları/ });
    expect(dugme).toBeDisabled();
    fireEvent.click(dugme);
    await act(bekleMikro);
    expect(baslat).toHaveBeenCalledTimes(1);   // ikinci döngü başlamadı

    // Kalan arka plan adımları hızla hatalı (sıra çabuk bitsin); 1. adım bitişi yayınlanır.
    baslat.mockImplementation(() => Promise.resolve({ success: false, error: 'X' }));
    await act(async () => { yayinla('mikroImport-stok', { running: false, finishedAt: { _seconds: 2, _nanoseconds: 0 } }); });
    const ozet = await screen.findByRole('status', { name: 'Tümünü Çek özeti' });
    expect(ozet.textContent).toContain('8 adım tamam');   // stok + 7 senkron
    expect(ozet.textContent).toContain('14 adım hatalı');
    expect(screen.getByRole('button', { name: /Tümünü Çek/ })).toBeEnabled();
  });
});

describe('MikroSyncPanel — Senkron Geçmişi: yetkisizlik ≠ boşluk', () => {
  it("userRole 'Sales' → geçmiş açılınca 'göremez — yalnız Admin/Manager' metni", async () => {
    durum.rol = 'Sales';
    await cizVeBekle();
    fireEvent.click(screen.getByRole('button', { name: /Senkronizasyon Geçmişi/ }));
    expect(screen.getByText(/Bu rol \(Sales\) senkronizasyon geçmişini göremez — yalnız Admin\/Manager okur/)).toBeInTheDocument();
    expect(screen.queryByText(/Henüz senkronizasyon kaydı yok/)).toBeNull();
  });

  // Hakem bulgusu (2026-09-25): 'göremez' dalı liste dalından ÖNCE geliyordu → istemcinin rol tahmini
  // yanlışsa (appStore varsayılanı Sales; profil senkronu düşerse storeSetRole hiç çağrılmaz) sunucunun
  // GERÇEKTEN gönderdiği kayıtlar gizleniyordu. 'Göremez' notu yalnız liste BOŞKEN anlamlı.
  it("rol tahmini 'Sales' ama sunucu kayıt gönderdi → kayıtlar GÖRÜNÜR, 'göremez' notu YOK", async () => {
    durum.rol = 'Sales';
    koleksiyonAyarla('syncLog', [{ id: 'k1', veri: {
      operation: 'SQL:CARI_HESAP_HAREKETLERI', entityType: 'mikroCariHareket', entityId: 'bulk',
      success: true, mikroRef: null, error: null, duration: 1200,
    } }]);
    await cizVeBekle();
    fireEvent.click(screen.getByRole('button', { name: /Senkronizasyon Geçmişi/ }));
    expect(screen.getByText('SQL:CARI_HESAP_HAREKETLERI')).toBeInTheDocument();
    expect(screen.queryByText(/göremez/)).toBeNull();
  });

  it("userRole 'Admin' + boş liste → 'Henüz senkronizasyon kaydı yok'", async () => {
    await cizVeBekle();
    fireEvent.click(screen.getByRole('button', { name: /Senkronizasyon Geçmişi/ }));
    expect(screen.getByText(/Henüz senkronizasyon kaydı yok/)).toBeInTheDocument();
    expect(screen.queryByText(/göremez/)).toBeNull();
  });

  it('Tümünü Çek özeti "Stok miktarları arka planda sürüyor olabilir" DEMEZ (artık her adım beklenir)', () => {
    expect(say('arka planda sürüyor olabilir')).toBe(0);
    expect(within(document.body).queryByText(/arka planda sürüyor olabilir/)).toBeNull();
  });
});

// 2026-09-25: MEVCUT MF siparişlerinin kalemi yalnız açık iki adımla yenilenir (şartname kapısı: kuru koşu şart).
describe('MikroSyncPanel — MF sipariş kalemlerini yenile (önizle → uygula)', () => {
  it("önizle 'onizle' gönderir ve sayı + örnek basar; uygula 'uygula' gönderir ve sonucu basar", async () => {
    const fetchSahte = vi.fn((_u: string, init?: { body?: string }) => {
      const govde = JSON.parse(String(init?.body ?? '{}')) as { kalemYenile?: string };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(govde.kalemYenile === 'onizle'
        ? { success: true, onizleme: true, kalemYenilenecek: 2, kalemOrnek: [{ orderNumber: 'MF-383', eski: 0, yeni: 3 }],
            note: "1 kalemin tutarı çözülemiyor — yenilenirse '—' görünür" }
        : { success: true, kalemYenilenen: 2, note: null }) });
    });
    vi.stubGlobal('fetch', fetchSahte);
    await cizVeBekle();
    const bolum = screen.getByRole('region', { name: 'MF sipariş kalemlerini yenile' });
    fireEvent.click(within(bolum).getByRole('button', { name: 'Önizle' }));
    await within(bolum).findByText(/MF-383 \(0 → 3 kalem\)/);
    expect(within(bolum).getByText(/1 kalemin tutarı çözülemiyor/)).toBeTruthy();   // önizleme notu ATILMAZ
    const onizleCagri = fetchSahte.mock.calls.find(c => String(c[0]) === '/api/mikro/import/faturadan-siparis');
    expect(JSON.parse(String(onizleCagri?.[1]?.body))).toEqual({ kalemYenile: 'onizle' });
    fireEvent.click(within(bolum).getByRole('button', { name: '2 Siparişi Yenile' }));
    await within(bolum).findByText(/2 siparişin kalemi yenilendi/);
    const uygulaCagri = fetchSahte.mock.calls.filter(c => String(c[0]) === '/api/mikro/import/faturadan-siparis').pop();
    expect(JSON.parse(String(uygulaCagri?.[1]?.body))).toEqual({ kalemYenile: 'uygula' });
  });
});

// İnceleme 2026-09-25 (CONFIRMED): kalemler artık stok hareketlerinden yazılıyor — Tümünü Çek sipariş türetmeyi stok
// hareketlerinden ÖNCE koşarsa bugünün faturasının siparişi kalemsiz türer.
describe('MikroSyncPanel — Tümünü Çek: faturadan sipariş stok hareketlerinden SONRA', () => {
  it('sıra: /import/stok-hareket başlatılır, faturadan-siparis ondan sonra çağrılır', async () => {
    const olaylar: string[] = [];
    baslat.mockImplementation(route => { olaylar.push(route); return Promise.resolve({ success: false, error: 'x' }); });
    vi.stubGlobal('fetch', vi.fn((u: string) => { olaylar.push(String(u)); return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }); }));
    await cizVeBekle();
    olaylar.length = 0;
    fireEvent.click(screen.getByRole('button', { name: /Tümünü Çek/ }));
    await screen.findByRole('status', { name: 'Tümünü Çek özeti' });
    const stokHareket = olaylar.indexOf('/api/mikro/import/stok-hareket');
    const faturadanSiparis = olaylar.indexOf('/api/mikro/import/faturadan-siparis');
    expect(stokHareket).toBeGreaterThanOrEqual(0);
    expect(faturadanSiparis).toBeGreaterThan(stokHareket);
  });
});
