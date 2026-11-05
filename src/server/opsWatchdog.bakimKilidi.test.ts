// @vitest-environment node
/**
 * opsWatchdog.bakimKilidi.test.ts — bekçinin `bakim_kilidi` kontrolü (stok kodu göçü şartnamesi DH8, 05.11.2026): kilitte TTL yok;
 * 2 saatten eski bakım kilidi yarım kalmış bakımdır ve saatlik Mikro senkronunu / importları sessizce durdurur → FAIL.
 *
 * Saf kural `bakimKilidi.test` / `stokKodGocuTasima.test` içinde sınanıyor; bu dosya kontrolün GERÇEK giriş noktasına (`runOpsWatchdog`)
 * BAĞLANDIĞINI kanıtlar («yazıldı ama bağlanmadı» çiti): kontrol bekçiden çıkarılırsa ya da kilit okunmazsa burası kırmızıdır.
 * Diğer kontrollerin dış dünyaya çıkan yolları (ağ, TLS, PostgreSQL istemcisi, Resend, SMTP) taklittir (opsWatchdog.kuyruk.test deseni).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { initOpsWatchdog, runOpsWatchdog, type OpsDeps } from './opsWatchdog';
import type { AdminDbLike, AdminDocRef } from './adminDbTypes';
import { smtpYapilandirmasi, smtpDogrula } from './smtpPosta.js';
import { magazaSayaclari, magazaTakipSayaclari } from './routes/magazaRoutes.js';
import { magazaPanelSayaclari } from './routes/magazaPanelZinciri.js';
import { ortamdanKiraci } from './kiraciOrtami.js';
import { BAKIM_KILIDI } from './bakimKilidi.js';

vi.mock('./smtpPosta.js', () => ({ smtpYapilandirmasi: vi.fn(), smtpDogrula: vi.fn() }));
vi.mock('./routes/magazaRoutes.js', () => ({ magazaSayaclari: vi.fn(), magazaTakipSayaclari: vi.fn() }));
vi.mock('./routes/magazaPanelZinciri.js', () => ({ magazaPanelSayaclari: vi.fn() }));
vi.mock('./kiraciOrtami.js', () => ({ ortamdanKiraci: vi.fn() }));
vi.mock('./eposta.js', async (asil) => ({
  ...(await asil<typeof import('./eposta')>()),
  resendGonderici: () => 'bekci@example.invalid',
  resendSagligi: vi.fn(async () => ({ ok: true, detay: 'taklit' })),
}));
vi.mock('./zamanla.js', async (asil) => ({ ...(await asil<typeof import('./zamanla')>()), zamanla: vi.fn() }));
vi.mock('tls', async () => {
  const { EventEmitter } = await import('events');
  const connect = () => {
    const soket = new EventEmitter();
    queueMicrotask(() => soket.emit('error', new Error('taklit: TLS yok')));
    return soket;
  };
  return { default: { connect }, connect };
});
vi.mock('pg', () => {
  class Client {
    connect() { return Promise.reject(new Error('taklit: bağlantı yok')); }
    end() { return Promise.resolve(); }
  }
  return { default: { Client }, Client };
});

const SIMDI = new Date('2026-11-05T05:30:00Z').getTime();
const DAKIKA = 60 * 1000;

/** Bekçinin PostgreSQL yüzeyi: yalnız bakım kilidi satırı döner; öbür her sorgu boş. */
const durum: { kilit: { aciklama: string; baslangic: string } | null; kilitOkundu: number } = { kilit: null, kilitOkundu: 0 };
const sahteHavuz = {
  query: async (_sql: string, params?: unknown[]) => {
    if (params && params[0] === BAKIM_KILIDI.coll && params[1] === BAKIM_KILIDI.id) {
      durum.kilitOkundu++;
      return { rows: durum.kilit ? [{ data: durum.kilit }] : [] };
    }
    return { rows: [] };
  },
};

const sahteDb: AdminDbLike = {
  collection() {
    const ref = (id: string): AdminDocRef => ({
      id,
      get: async () => ({ exists: false, id, data: () => undefined }),
      set: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    });
    const sorgu = {
      where: () => sorgu, orderBy: () => sorgu, limit: () => sorgu,
      get: async () => ({ docs: [], empty: true, size: 0 }),
    };
    return { ...sorgu, doc: (id?: string) => ref(id ?? 'yeni'), add: async () => ref('yeni') };
  },
  batch: () => ({ set: () => undefined, update: () => undefined, delete: () => undefined, commit: async () => undefined }),
};

const BAGIMLILIKLAR: OpsDeps = {
  getPgPool: () => sahteHavuz,
  getAdminDb: () => sahteDb,
  pgServerTimestamp: () => 'taklit-zaman',
  getMikroCreds: async () => null,
  getCachedExchangeRates: () => null,
  getAiHealthProbe: () => null,
  serverTenantId: async () => 'kiraci-1',
  magazaPanelYapilandirmasi: () => ({ anahtarVar: true, donusVar: true }),
  magazaBayiYapilandirmasi: () => ({ anahtarVar: true, donusVar: true }),
};

/** Bekçiyi koşturur; `bakim_kilidi` sonucunun TAM BİR tane olduğunu doğrulayıp döndürür. */
async function kos() {
  const sonuc = await runOpsWatchdog();
  const bulunan = sonuc.checks.filter(c => c.key === 'bakim_kilidi');
  expect(bulunan).toHaveLength(1);
  return bulunan[0];
}

beforeAll(() => {
  vi.useFakeTimers();
  initOpsWatchdog(BAGIMLILIKLAR);
  vi.clearAllTimers();   // init'in 30 sn sonraya kurduğu ilk disk nöbetçisi koşusu testte çalışmasın
  vi.useRealTimers();
});

beforeEach(() => {
  durum.kilit = null;
  durum.kilitOkundu = 0;
  vi.mocked(smtpYapilandirmasi).mockReset().mockReturnValue({ tamam: true, eksik: [], kip: 'kimlikli' });
  vi.mocked(smtpDogrula).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(magazaSayaclari).mockReset().mockReturnValue({ eklenen: 0, cakisan: 0, r400: 0, r403: 0, r404: 0, r413: 0, r415: 0, r429: 0, r500: 0, r503: 0 });
  vi.mocked(magazaPanelSayaclari).mockReset().mockReturnValue({
    oturum: 0, oturum401: 0, oturum503: 0, yetkiKodu: 0, yetkiKoduRet: 0, yetkiKoduIptalDenetimsiz: 0,
    durumPanel: 0, durumPanel409: 0, durumErp: 0, durumErp409: 0,
    kalemTeslimPanel: 0, kalemTeslimPanel409: 0, kalemTeslimErp: 0, kalemTeslimErp409: 0,
    etiketBasildi: 0, etiketBasildi404: 0, etiketBasildi409: 0, bildirimGonder: 0, bildirimGonder409: 0, cikisUidsiz: 0,
    r401: 0, r403: 0, r404: 0, r429: 0, r500: 0, r503: 0,
  });
  vi.mocked(magazaTakipSayaclari).mockReset().mockReturnValue({ bulundu: 0, bulunamadi: 0 });
  vi.mocked(ortamdanKiraci).mockReset().mockReturnValue('kiraci-1');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('taklit: ağ yok'); }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SIMDI);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bakim_kilidi — bekçinin gerçek giriş noktasından (DH8)', () => {
  it('kilit yok → YEŞİL; kilit satırı GERÇEKTEN okunur', async () => {
    const m = await kos();
    expect(m).toEqual({ key: 'bakim_kilidi', ok: true, detail: 'bakım kilidi yok' });
    expect(durum.kilitOkundu).toBeGreaterThan(0);
  });

  it('30 dakikalık stok kodu göçü kilidi → YEŞİL (iş sürüyor), açıklama ayrıntıda', async () => {
    durum.kilit = { aciklama: 'stok-kod-gocu skg-20261105050000-abc123', baslangic: new Date(SIMDI - 30 * DAKIKA).toISOString() };
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(m.detail).toBe('bakım kilidi var (30 dk): stok-kod-gocu skg-20261105050000-abc123');
  });

  it('3 saatlik kilit → FAIL (yarım kalmış bakım saatlik senkronu durduruyor); başlangıcı okunamayan kilit → FAIL', async () => {
    durum.kilit = { aciklama: 'stok-kod-gocu skg-20261105023000-abc123', baslangic: new Date(SIMDI - 180 * DAKIKA).toISOString() };
    const eski = await kos();
    expect(eski.ok).toBe(false);
    expect(eski.detail).toContain('bakım kilidi 180 dk\'dır duruyor (eşik 120 dk)');
    expect(eski.detail).toContain('saatlik senkron ve importlar atlanıyor');

    durum.kilit = { aciklama: 'lead-birlestir', baslangic: '' };
    const bozuk = await kos();
    expect(bozuk.ok).toBe(false);
    expect(bozuk.detail).toBe('bakım kilidi var, başlangıcı okunamadı: lead-birlestir');
  });
});
