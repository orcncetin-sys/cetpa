// @vitest-environment node
/**
 * opsWatchdog.kuyruk.test.ts — bekçinin `retry_queue` kontrolü × K10 (yeniden deneme kuyruğunda iş SAHİBİNİNDİR).
 * Şartname § 10.4 H9 «bekçi metni»; kapı bulgusu K10-8.
 *
 * K10'dan sonra iş yalnız sahibinin oturumunda çalışır. İki sınıf kendiliğinden ÇÖZÜLMEZ ve bekçide AYRI sayılır:
 *   • damgasız eski iş — yalnız Yönetici oturumu çalıştırır;
 *   • sahibi gönderemeyen iş — sahibinin BUGÜNKÜ rolü yöntemin kapısından geçmiyor / hesabı yok / kimlik sahibini taşımıyor:
 *     Yönetici kapatmadıkça sonsuza dek bekler.
 * Sınıf kuralı istemci yürütücüsüyle AYNI işlevdedir (lib/kuyrukSahipligi.bekleyenIsSinifi — saf testi kuyrukSahipligi.test).
 * Geçti / kaldı koşulu DEĞİŞMEDİ (24 saatten eski bekleyen iş ya da 10'dan fazla ölü iş → kırmızı): yalnız metin genişledi.
 *
 * Kontrol GERÇEK giriş noktasından (`runOpsWatchdog`) koşturulur — «yazıldı ama bağlanmadı» burada da yakalansın. Diğer
 * kontrollerin dış dünyaya çıkan yolları (ağ, TLS, PostgreSQL istemcisi, Resend, SMTP) taklittir; hiçbir test gerçek ağa çıkmaz.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { initOpsWatchdog, runOpsWatchdog, type OpsDeps } from './opsWatchdog';
import type { AdminDbLike, AdminDocRef } from './adminDbTypes';
import { smtpYapilandirmasi, smtpDogrula } from './smtpPosta.js';
import { magazaSayaclari, magazaTakipSayaclari } from './routes/magazaRoutes.js';
import { magazaPanelSayaclari } from './routes/magazaPanelZinciri.js';
import { ortamdanKiraci } from './kiraciOrtami.js';
import { isKimligi } from '../lib/kuyrukSahipligi';
import { SRC_KOK, kodSatirlari } from '../test/kaynakTarama';

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

type Belge = Record<string, unknown>;
const SIMDI = new Date('2026-10-11T05:30:00Z').getTime();
const SAAT = 60 * 60 * 1000;

const durum: { isler: Map<string, Belge>; kullanicilar: Map<string, Belge>; okumalar: string[] } = { isler: new Map(), kullanicilar: new Map(), okumalar: [] };

/** Bekçinin kullandığı `adminDb` yüzeyi: koleksiyon okuma, tek belge okuma / yazma. Diğer koleksiyonlar boş döner. */
const sahteDb: AdminDbLike = {
  collection(ad: string) {
    const belgeler = (): Map<string, Belge> => (ad === 'syncJobs' ? durum.isler : ad === 'users' ? durum.kullanicilar : new Map<string, Belge>());
    const ref = (id: string): AdminDocRef => ({
      id,
      get: async () => { durum.okumalar.push(`${ad}/${id}`); const b = belgeler().get(id); return { exists: b !== undefined, id, data: () => b }; },
      set: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    });
    const sorgu = {
      where: () => sorgu, orderBy: () => sorgu, limit: () => sorgu,
      get: async () => {
        durum.okumalar.push(`${ad}/*`);
        const docs = [...belgeler().entries()].map(([id, b]) => ({ id, data: () => b, ref: ref(id) }));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
    return { ...sorgu, doc: (id?: string) => ref(id ?? 'yeni'), add: async () => ref('yeni') };
  },
  batch: () => ({ set: () => undefined, update: () => undefined, delete: () => undefined, commit: async () => undefined }),
};

const BAGIMLILIKLAR: OpsDeps = {
  getPgPool: () => ({ query: async () => ({ rows: [] }) }),
  getAdminDb: () => sahteDb,
  pgServerTimestamp: () => 'taklit-zaman',
  getMikroCreds: async () => null,
  getCachedExchangeRates: () => null,
  getAiHealthProbe: () => null,
  serverTenantId: async () => 'kiraci-1',
  magazaPanelYapilandirmasi: () => ({ anahtarVar: true, donusVar: true }),
};

/** `kim`in kuyruğa koyduğu iş (kimlik sahibinin sonekini taşır; sunucu damgalamış). */
const is = (kim: string, yontem: string, ek: Belge = {}): [string, Belge] => {
  const id = isKimligi(`mikro_${yontem}_L1`, kim);
  return [id, { id, type: 'mikro', payload: { method: yontem, payload: {} }, status: 'queued', attempts: 0, createdAt: SIMDI - SAAT, sahipUid: kim, companyId: 'A', ...ek }];
};
/** K10 öncesinden kalan iş: sahip damgası yok, kimlik soneksiz. */
const eskiIs = (id: string, ek: Belge = {}): [string, Belge] =>
  [id, { id, type: 'mikro', payload: { method: 'DekontKaydetV2', payload: {} }, status: 'queued', attempts: 0, createdAt: SIMDI - SAAT, companyId: 'A', ...ek }];

/** Bekçiyi koşturur; `retry_queue` sonucunun TAM BİR tane olduğunu doğrulayıp döndürür. */
async function kos() {
  const sonuc = await runOpsWatchdog();
  const bulunan = sonuc.checks.filter(c => c.key === 'retry_queue');
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
  durum.isler = new Map();
  durum.kullanicilar = new Map<string, Belge>([
    ['muhasebe', { role: 'Accounting', companyId: 'A' }],
    ['ik', { role: 'HR', companyId: 'A' }],
    ['satis', { role: 'Sales', companyId: 'A' }],
    ['yonetici', { role: 'Admin', companyId: 'A' }],
    ['rolsuz', { companyId: 'A' }],
    ['bozuk-rol', { role: 'Patron', companyId: 'A' }],
  ]);
  durum.okumalar = [];
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

describe('retry_queue — boş ve temiz kuyruk', () => {
  it('boş kuyruk → YEŞİL; iki yeni sayaç sıfır, yönlendirme cümlesi yok; kullanıcı kaydı okunmaz', async () => {
    const m = await kos();
    expect(m).toEqual({ key: 'retry_queue', ok: true, detail: 'bekleyen 0 (24s+ takılı 0; damgasız eski 0, sahibi gönderemeyen 0), ölü 0' });
    expect(durum.okumalar.filter(o => o.startsWith('users/'))).toEqual([]);
  });

  it('sahibi gönderebilen taze işler → YEŞİL; iki sayaç sıfır', async () => {
    durum.isler = new Map([is('muhasebe', 'DekontKaydetV2'), is('satis', 'ZiyaretKaydetV2'), is('yonetici', 'DekontKaydetV2')]);
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(m.detail).toBe('bekleyen 3 (24s+ takılı 0; damgasız eski 0, sahibi gönderemeyen 0), ölü 0');
  });
});

describe('retry_queue — kendiliğinden çözülmeyen iki sınıf AYRI sayılır', () => {
  it('damgasız eski iş: «damgasız eski» sayılır (boş / bozuk damga da); yönlendirme cümlesi eklenir', async () => {
    durum.isler = new Map([eskiIs('eski-1'), eskiIs('eski-2', { sahipUid: '' }), eskiIs('eski-3', { sahipUid: 7 }), is('muhasebe', 'DekontKaydetV2')]);
    const m = await kos();
    expect(m.ok).toBe(true);                                    // taze: geçti / kaldı koşulu değişmedi
    expect(m.detail).toContain('bekleyen 4 (24s+ takılı 0; damgasız eski 3, sahibi gönderemeyen 0), ölü 0');
    expect(m.detail).toContain('damgasız eski işi Yönetici oturumu gönderir');
  });

  it('sahibi gönderemeyen iş: rolü yöntemin kapısından geçmiyor (açığın biçimi: İK dekont işi yazdı) · hesabı yok · rolü yok / tanınmıyor · kimlik sahibini taşımıyor', async () => {
    durum.isler = new Map([
      is('ik', 'DekontKaydetV2'),                               // İK dekont gönderemez
      is('ayrilan', 'ZiyaretKaydetV2'),                         // kullanıcı kaydı yok
      is('rolsuz', 'EtiketBasimKaydetV2'),                      // rol alanı boş
      is('bozuk-rol', 'EtiketBasimKaydetV2'),                   // rol tanınmıyor
      eskiIs('mikro_DekontKaydetV2_L9', { sahipUid: 'muhasebe' }),   // yayın öncesi ekilmiş sahip (kimlik soneksiz)
      is('muhasebe', 'DekontKaydetV2'),                         // sahibi gönderir
      is('ik', 'EtiketBasimKaydetV2'),                          // İK etiketi gönderir
    ]);
    const m = await kos();
    expect(m.detail).toContain('bekleyen 7 (24s+ takılı 0; damgasız eski 0, sahibi gönderemeyen 5), ölü 0');
    expect(m.detail).toContain('sahibi gönderemeyen işi Yönetici Ayarlar → Mikro kuyruk kartından kapatır');
  });

  it('Yönetici\'nin dokunduğu eski iş (soneksiz kimlik, sahibi Yönetici) «sahibi gönderir» sınıfındadır', async () => {
    durum.isler = new Map([eskiIs('eski-1', { sahipUid: 'yonetici' })]);
    expect((await kos()).detail).toBe('bekleyen 1 (24s+ takılı 0; damgasız eski 0, sahibi gönderemeyen 0), ölü 0');
  });

  it('sahibinin rolü işin gövdesinden DEĞİL kullanıcı kaydından okunur; sahip başına TEK okuma', async () => {
    durum.isler = new Map([
      is('ik', 'DekontKaydetV2', { rol: 'Admin', role: 'Admin' }),    // gövdeye yazılmış sahte rol işe yaramaz
      [isKimligi('mikro_DekontKaydetV2_L2', 'ik'), { ...is('ik', 'DekontKaydetV2')[1] }],
      [isKimligi('mikro_DekontKaydetV2_L3', 'ik'), { ...is('ik', 'DekontKaydetV2')[1] }],
    ]);
    const m = await kos();
    expect(m.detail).toContain('sahibi gönderemeyen 3');
    expect(durum.okumalar.filter(o => o.startsWith('users/'))).toEqual(['users/ik']);
  });

  it('iş kimliği BELGEDEN okunur: gövdesinde başka kimlik taşıyan iş kendi belge kimliğiyle sınıflanır', async () => {
    // Belge kimliği sahibinin sonekini taşıyor; gövdedeki `id` taşımıyor → sahibi gönderir (gövdeye bakılsaydı «gönderemez» sayılırdı).
    const [id, govde] = is('muhasebe', 'DekontKaydetV2');
    durum.isler = new Map([[id, { ...govde, id: 'baska-bir-kimlik' }]]);
    expect((await kos()).detail).toContain('sahibi gönderemeyen 0');
  });
});

describe('retry_queue — geçti / kaldı koşulu DEĞİŞMEDİ', () => {
  it('24 saatten eski bekleyen iş → KIRMIZI (sınıfı ne olursa olsun); sayaçlar yine ayrı', async () => {
    durum.isler = new Map([is('ik', 'DekontKaydetV2', { createdAt: SIMDI - 25 * SAAT }), eskiIs('eski-1')]);
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('bekleyen 2 (24s+ takılı 1; damgasız eski 1, sahibi gönderemeyen 1), ölü 0');
  });

  it('Yönetici kapatınca (iş ölü): takılı da «gönderemeyen» de sayılmaz → YEŞİL; ölü sayısı artar', async () => {
    durum.isler = new Map([is('ik', 'DekontKaydetV2', { createdAt: SIMDI - 25 * SAAT, status: 'dead' })]);
    const m = await kos();
    expect(m).toMatchObject({ ok: true, detail: 'bekleyen 0 (24s+ takılı 0; damgasız eski 0, sahibi gönderemeyen 0), ölü 1' });
  });

  it('10\'dan fazla ölü iş → KIRMIZI; sahiplenilmiş (in-progress) iş bekleyen sayılır, başarılı iş sayılmaz', async () => {
    const oluler = Array.from({ length: 11 }, (_, i): [string, Belge] => [`olu-${i}_muhasebe`, { ...is('muhasebe', 'DekontKaydetV2')[1], status: 'dead' }]);
    durum.isler = new Map([
      ...oluler,
      [isKimligi('mikro_DekontKaydetV2_L2', 'muhasebe'), { ...is('muhasebe', 'DekontKaydetV2')[1], status: 'in-progress' }],
      [isKimligi('mikro_DekontKaydetV2_L3', 'muhasebe'), { ...is('muhasebe', 'DekontKaydetV2')[1], status: 'success' }],
    ]);
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toBe('bekleyen 1 (24s+ takılı 0; damgasız eski 0, sahibi gönderemeyen 0), ölü 11');
  });

  // İnceleme düzeltmesi (2026-10-17): yürütücü, kuyruk kartı ve «Takılanları Kapat» yalnız `queued` işe dokunur. Gönderimde
  // yarım kalan (`in-progress`) iş sınıf sayımına girseydi bekçi «Yönetici gönderir / kapatır» derdi; kart çizilmez, kapatma
  // sıfır iş kapatırdı. Geçti / kaldı koşulu DEĞİŞMEZ (iş yine «bekleyen» ve «takılı» sayılır).
  it('24 saatten eski in-progress iş sınıf sayımına ve Yönetici ipucuna GİRMEZ, ayrı adla yazılır (damgasız da damgalı da)', async () => {
    const BEKLENEN = 'bekleyen 1 (24s+ takılı 1; damgasız eski 0, sahibi gönderemeyen 0, gönderimde yarım kalan 1), ölü 0'
      + ' — gönderimde yarım kalan işi kuyruk kartı saymaz, kapatmaz (panelde çıkışı yok)';
    for (const isi of [
      eskiIs('eski-1', { status: 'in-progress', createdAt: SIMDI - 30 * SAAT }),
      is('ik', 'DekontKaydetV2', { status: 'in-progress', createdAt: SIMDI - 30 * SAAT }),
    ]) {
      durum.isler = new Map([isi]);
      durum.okumalar = [];
      const m = await kos();
      expect(m, isi[0]).toEqual({ key: 'retry_queue', ok: false, detail: BEKLENEN });
      expect(durum.okumalar.filter(o => o.startsWith('users/')), isi[0]).toEqual([]);   // sınıflanmayan işin sahibi okunmaz
    }
  });

  it('yarım kalan iş ile çıkışı olan iş birlikteyse iki ipucu da yazılır; `queued` işin sınıfı eskisi gibi', async () => {
    durum.isler = new Map([
      eskiIs('eski-1', { createdAt: SIMDI - 30 * SAAT }),
      is('ik', 'DekontKaydetV2', { status: 'in-progress', createdAt: SIMDI - 30 * SAAT }),
    ]);
    const m = await kos();
    expect(m).toEqual({
      key: 'retry_queue', ok: false,
      detail: 'bekleyen 2 (24s+ takılı 2; damgasız eski 1, sahibi gönderemeyen 0, gönderimde yarım kalan 1), ölü 0'
        + ' — damgasız eski işi Yönetici oturumu gönderir; sahibi gönderemeyen işi Yönetici Ayarlar → Mikro kuyruk kartından kapatır'
        + ' — gönderimde yarım kalan işi kuyruk kartı saymaz, kapatmaz (panelde çıkışı yok)',
    });
  });

  it('kullanıcı kaydı okunamazsa sayım ve karar YİNE raporlanır; sınıf «okunamadı» yazılır (uydurma sayı / yanlış sınıf basılmaz)', async () => {
    durum.isler = new Map([is('ik', 'DekontKaydetV2'), eskiIs('eski-1')]);
    const asil = sahteDb.collection.bind(sahteDb);
    vi.spyOn(sahteDb, 'collection').mockImplementation((ad: string) => {
      const k = asil(ad);
      return ad === 'users' ? { ...k, doc: (id?: string) => ({ ...k.doc(id), get: async () => { throw new Error('taklit: okuma hatası'); } }) } : k;
    });
    const m = await kos();
    expect(m).toEqual({ key: 'retry_queue', ok: true, detail: 'bekleyen 2 (24s+ takılı 0; sahip sınıfı okunamadı: taklit: okuma hatası), ölü 0' });
  });

  it('kuyruğun KENDİSİ okunamazsa kontrol kırmızıdır (eski davranış)', async () => {
    const asil = sahteDb.collection.bind(sahteDb);
    vi.spyOn(sahteDb, 'collection').mockImplementation((ad: string) => {
      const k = asil(ad);
      return ad === 'syncJobs' ? { ...k, get: async () => { throw new Error('taklit: kuyruk okunamadı'); } } : k;
    });
    expect(await kos()).toEqual({ key: 'retry_queue', ok: false, detail: 'taklit: kuyruk okunamadı' });
  });
});

describe('kaynak çiti — bekçi sınıfı ORTAK kuraldan sorar', () => {
  it('opsWatchdog `bekleyenIsSinifi` / `isSahibi` çağırır; kendi içinde rol adı ya da sahip alanı adı yazmaz', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'server', 'opsWatchdog.ts')).map(s => s.kod);
    const blok = kod.slice(kod.findIndex(s => s.includes('db.collection(KUYRUK_KOLEKSIYONU).get()')), kod.findIndex(s => s.includes("add('retry_queue', stuck === 0 && dead <= 10,")) + 1).join('\n');
    expect(blok).toContain('bekleyenIsSinifi(j, sahip === null ? null : roller.get(sahip))');
    expect(blok).toContain("if (j.status === 'queued') bekleyenler.push({ ...j, id: d.id });");   // sınıf yalnız `queued` işten
    expect(blok.includes('sahipUid')).toBe(false);
    expect(blok.includes("'Admin'")).toBe(false);
    expect(kod.join('\n')).toContain("from '../lib/kuyrukSahipligi.js';");
  });
});
