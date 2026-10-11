// @vitest-environment node
/**
 * opsWatchdog.magazaTalep.test.ts — bekçinin `magaza_talep` kontrolü (mağaza dilim 1 şartnamesi § 6; dilim 2a § 6 / § 7 «Bekçi»:
 * açık talep sayımı, site paneli yapılandırması, panel ve takip sayaçları AYRI parçalarda, sayım SQL üreticisi;
 * dilim 2b § 10.7 / § 10.8: revize bildirimi sayımı AYRI parçada (aynı üretici, yaş `icerikZamani`), «silinmiş: N (son 30 gün)»
 * parçası, içerik / silme / elle talep / revize sayaçlarının etiketleri, takip sayacında `silindi`).
 *
 * Kontrol GERÇEK giriş noktasından (`runOpsWatchdog`) koşturulur: «yazıldı ama
 * bağlanmadı» sınıfı burada da yakalansın. Diğer kontrollerin dış dünyaya çıkan
 * yolları (ağ, TLS, PostgreSQL istemcisi, Resend) taklit edilir; hiçbir test
 * gerçek ağa çıkmaz.
 *
 * `smtpPosta`, `magazaRoutes` ve `magazaPanelZinciri` taklittir: bekçinin sözleşmesi onların DÖNÜŞ
 * değerine karşı sınanır (gövdeleri başka parçalarda yazılıyor).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  initOpsWatchdog, runOpsWatchdog, magazaTalepSayimSql, MAGAZA_PANEL_SAYAC_ETIKETLERI, MAGAZA_TAKIP_SAYAC_ETIKETLERI, type OpsDeps,
} from './opsWatchdog';
import { smtpYapilandirmasi, smtpDogrula } from './smtpPosta.js';
import { magazaSayaclari, magazaTakipSayaclari } from './routes/magazaRoutes.js';
import { magazaPanelSayaclari } from './routes/magazaPanelZinciri.js';
import { ortamdanKiraci } from './kiraciOrtami.js';
import { MAGAZA_ACIK_SAYIM_SQL, MAGAZA_SILINMIS_SAYIM_SQL } from './kanal/magazaAcikSayim';
import { MAGAZA_ACIK_SQL, MAGAZA_SILINMEMIS_SQL, MAGAZA_SILINMIS_SQL } from './kanal/magazaDurum';
import { kodSatirlari } from '../test/kaynakTarama';
import {
  MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_TALEP_KOLEKSIYONU,
  type MagazaBildirimHataSinifi,
} from '../lib/magazaTalep';

vi.mock('./smtpPosta.js', () => ({ smtpYapilandirmasi: vi.fn(), smtpDogrula: vi.fn() }));
vi.mock('./routes/magazaRoutes.js', () => ({ magazaSayaclari: vi.fn(), magazaTakipSayaclari: vi.fn() }));
vi.mock('./routes/magazaPanelZinciri.js', () => ({ magazaPanelSayaclari: vi.fn() }));
// Kiracının KAYNAĞI (ortam değişkeni mi, tarama mı): gerçek ortam OKUNMAZ; her test kendi değerini verir.
vi.mock('./kiraciOrtami.js', () => ({ ortamdanKiraci: vi.fn() }));
// Gerçek dışa aktarımlar KALIR (yalnız ağ okuyan ikisi taklit): gerçek `smtpPosta` (aşağıdaki sözleşme testi `importActual` ile
// yükler) `isValidEmail`'i bu modülden alır — eksik taklit o testi parçalar birleşince kırıyordu (2026-10-08).
vi.mock('./eposta.js', async (asil) => ({
  ...(await asil<typeof import('./eposta')>()),
  resendGonderici: () => 'bekci@example.invalid',
  resendSagligi: vi.fn(async () => ({ ok: true, detay: 'taklit' })),
}));
// Zamanlayıcı kaydı taklit (cron kurulmasın); `isGunu` gerçek.
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

/** Ayrıntıya ASLA düşmemesi gereken veri: hata iletilerine ve hata alanlarına gömülür. */
const GIZLI = 'AHMET YILMAZ 05321234567 Atatürk Cad. No:5';
const pgHatasi = (kod: string) => Object.assign(new Error(`invalid input syntax for type json: "${GIZLI}"`), {
  code: kod, detail: `Failing row contains (${GIZLI}).`, where: `JSON data, line 1: ${GIZLI}`,
});

const TEMIZ_SAYIM = { toplam: 42, son24: 3, gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 0, eski_gitmeyen: 0 };
/** (2b) Revize bildirimi sayımının satırı — AYNI sütunlar (aynı üretici); `toplam` koleksiyonun satır sayısı, `son24` son 24 saatte revize edilen. */
const TEMIZ_REVIZE = { toplam: 42, son24: 1, gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 0, eski_gitmeyen: 0 };
/** (2b) Silinmiş talep sayımının satırı (kanal/magazaAcikSayim.ts `MAGAZA_SILINMIS_SAYIM_SQL` sütunları). */
const TEMIZ_SILINMIS = { pencerede: 2, tarihsiz: 0 };
const TAM_SAYACLAR = { eklenen: 3, cakisan: 1, r400: 0, r403: 2, r404: 0, r413: 0, r415: 0, r429: 0, r500: 0, r503: 4 };
/** Açık sayım sorgusunun satırı (kanal/magazaAcikSayim.ts sütunları): 7 açık talep, en eskisi 2026-10-05'te geldi. */
const TEMIZ_ACIK = { acik: 7, asama_yeni: 2, asama_teyit: 1, asama_hazirlaniyor: 3, asama_sevk: 1, asama_bilinmiyor: 0, tarihsiz: 0, en_eski: '2026-10-05T09:00:00.000Z' };
/**
 * Süreç başında panel / takip sayaçları: hepsi sıfır. Anahtar kümesi `magazaPanelSayaclari()` / `magazaTakipSayaclari()`
 * sözleşmesidir (routes/magazaPanelZinciri.ts, routes/magazaRoutes.ts) — gerçek modülle eşitliği aşağıda «gerçek
 * modüllerle sözleşme» bloğu kilitler.
 */
const SIFIR_PANEL = {
  oturum: 0, oturum401: 0, oturum503: 0, yetkiKodu: 0, yetkiKoduRet: 0, yetkiKoduIptalDenetimsiz: 0,
  durumPanel: 0, durumPanel409: 0, durumErp: 0, durumErp409: 0,
  kalemTeslimPanel: 0, kalemTeslimPanel409: 0, kalemTeslimErp: 0, kalemTeslimErp409: 0,
  etiketBasildi: 0, etiketBasildi404: 0, etiketBasildi409: 0, bildirimGonder: 0, bildirimGonder409: 0,
  // Dilim 2b (§ 10.7): revize bildirimi (elle yeniden gönderme + istek), içerik, silme / geri alma, elle talep.
  bildirimGonderRevize: 0, bildirimGonderRevize409: 0, revizeBildirimIstendi: 0, revizeBildirimIstenemedi: 0,
  icerik: 0, icerikDegisiklikYok: 0, icerik409: 0, icerik400: 0, icerik503: 0, icerik429: 0,
  silPanel: 0, silPanel409: 0, silErp: 0, silErp409: 0, geriAl: 0, geriAl409: 0,
  elleTalep: 0, elleTalepCakisti: 0,
  cikisUidsiz: 0,
  r401: 0, r403: 0, r404: 0, r429: 0, r500: 0, r503: 0,
};
const PANEL_SAYAC_ADEDI = Object.keys(SIFIR_PANEL).length;
const SIFIR_TAKIP = { bulundu: 0, bulunamadi: 0, silindi: 0 };

interface HavuzAyari {
  /** Sayım sorgusunun tek satırı; `Error` ise sorgu fırlatır; `null` ise satır dönmez. */
  sayim?: Record<string, unknown> | Error | null;
  /** (2b) Revize bildirimi sayımının tek satırı; `Error` ise sorgu fırlatır; `null` ise satır dönmez. */
  revize?: Record<string, unknown> | Error | null;
  /** (2b) Silinmiş talep sayımının tek satırı; `Error` ise sorgu fırlatır; `null` ise satır dönmez. */
  silinmis?: Record<string, unknown> | Error | null;
  /** Açık talep sayımının tek satırı; `Error` ise sorgu fırlatır; `null` ise satır dönmez. */
  acik?: Record<string, unknown> | Error | null;
  /** Kiracı eşleşme sorgusunun `n` hücresi; `Error` ise sorgu fırlatır. */
  eslesen?: unknown;
}
const sorgular: Array<{ sql: string; params: unknown[] }> = [];
/**
 * Açık talep sayımı, silinmiş sayımı ve iki bildirim sayımı AYNI koleksiyonu sorar; dördünü sorgu METNİ ayırır (dört ayrı
 * sabit). Revize sayımı üreticinin `'bildirimRevize'` çıktısıdır; ilk bildirim sayımı «koleksiyonu soran, öbür üçü olmayan»
 * sorgudur (2a'daki ayırıcı aynen — bekçi beklenmedik bir beşinci sorgu atarsa ilk bildirim sayımına düşer ve adet çitleri kırılır).
 */
const acikSorgusuMu = (sql: string): boolean => sql === MAGAZA_ACIK_SAYIM_SQL;
const silinmisSorgusuMu = (sql: string): boolean => sql === MAGAZA_SILINMIS_SAYIM_SQL;
const revizeSorgusuMu = (sql: string): boolean => sql === magazaTalepSayimSql('bildirimRevize');
function sahteHavuz(ayar: HavuzAyari = {}) {
  const sayim = 'sayim' in ayar ? ayar.sayim : TEMIZ_SAYIM;
  const revize = 'revize' in ayar ? ayar.revize : TEMIZ_REVIZE;
  const silinmis = 'silinmis' in ayar ? ayar.silinmis : TEMIZ_SILINMIS;
  const acik = 'acik' in ayar ? ayar.acik : TEMIZ_ACIK;
  const eslesen = 'eslesen' in ayar ? ayar.eslesen : 1;
  const tekSatir = (deger: Record<string, unknown> | Error | null | undefined): { rows: Array<Record<string, unknown>> } => {
    if (deger instanceof Error) throw deger;
    return { rows: deger === null || deger === undefined ? [] : [deger] };
  };
  return {
    query: async (sql: string, params: unknown[] = []) => {
      sorgular.push({ sql, params });
      if (acikSorgusuMu(sql)) {
        if (acik instanceof Error) throw acik;
        return { rows: acik === null || acik === undefined ? [] : [acik] };
      }
      if (silinmisSorgusuMu(sql)) return tekSatir(silinmis);
      if (revizeSorgusuMu(sql)) return tekSatir(revize);
      if (params[0] === MAGAZA_TALEP_KOLEKSIYONU) {
        if (sayim instanceof Error) throw sayim;
        return { rows: sayim === null || sayim === undefined ? [] : [sayim] };
      }
      if (sql.includes("coll = 'users'")) {
        if (eslesen instanceof Error) throw eslesen;
        return { rows: [{ n: eslesen }] };
      }
      return { rows: [] };   // diğer kontrollerin sorguları
    },
  };
}
const sayimSorgulari = () => sorgular.filter(s => s.params[0] === MAGAZA_TALEP_KOLEKSIYONU && !acikSorgusuMu(s.sql) && !silinmisSorgusuMu(s.sql) && !revizeSorgusuMu(s.sql));
const revizeSorgulari = () => sorgular.filter(s => revizeSorgusuMu(s.sql));
const silinmisSorgulari = () => sorgular.filter(s => silinmisSorgusuMu(s.sql));
const acikSorgulari = () => sorgular.filter(s => acikSorgusuMu(s.sql));
const kiraciSorgulari = () => sorgular.filter(s => s.sql.includes("coll = 'users'"));

const PANEL_HAZIR = { anahtarVar: true, donusVar: true };
const durum: {
  havuz: ReturnType<typeof sahteHavuz> | null;
  havuzHatasi: Error | null;
  kiraci: string;
  kiraciHatasi: Error | null;
  /** Site paneli yapılandırması (server.ts'in verdiği varlık çifti). */
  panel: { anahtarVar: boolean; donusVar: boolean };
  panelHatasi: Error | null;
} = { havuz: null, havuzHatasi: null, kiraci: '', kiraciHatasi: null, panel: PANEL_HAZIR, panelHatasi: null };

const BAGIMLILIKLAR: OpsDeps = {
  getPgPool: () => { if (durum.havuzHatasi) throw durum.havuzHatasi; return durum.havuz; },
  getAdminDb: () => null,
  pgServerTimestamp: () => 'taklit-zaman',
  getMikroCreds: async () => null,
  getCachedExchangeRates: () => null,
  getAiHealthProbe: () => null,
  serverTenantId: async () => { if (durum.kiraciHatasi) throw durum.kiraciHatasi; return durum.kiraci; },
  magazaPanelYapilandirmasi: () => { if (durum.panelHatasi) throw durum.panelHatasi; return durum.panel; },
};

/** Bekçiyi koşturur; `magaza_talep` sonucunun TAM BİR tane olduğunu doğrulayıp döndürür. */
async function kos() {
  const sonuc = await runOpsWatchdog();
  const bulunan = sonuc.checks.filter(c => c.key === 'magaza_talep');
  expect(bulunan).toHaveLength(1);
  return { ...bulunan[0], tumu: sonuc.checks };
}

beforeAll(() => {
  vi.useFakeTimers();
  initOpsWatchdog(BAGIMLILIKLAR);
  vi.clearAllTimers();   // init'in 30 sn sonraya kurduğu ilk disk nöbetçisi koşusu testte çalışmasın
  vi.useRealTimers();
});

beforeEach(() => {
  sorgular.length = 0;
  durum.havuz = sahteHavuz();
  durum.havuzHatasi = null;
  durum.kiraci = 'kiraci-1';
  durum.kiraciHatasi = null;
  durum.panel = PANEL_HAZIR;
  durum.panelHatasi = null;
  vi.mocked(smtpYapilandirmasi).mockReset().mockReturnValue({ tamam: true, eksik: [], kip: 'kimlikli' });
  vi.mocked(smtpDogrula).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(magazaSayaclari).mockReset().mockReturnValue(TAM_SAYACLAR);
  vi.mocked(magazaPanelSayaclari).mockReset().mockReturnValue(SIFIR_PANEL);
  vi.mocked(magazaTakipSayaclari).mockReset().mockReturnValue(SIFIR_TAKIP);
  vi.mocked(ortamdanKiraci).mockReset().mockReturnValue('kiraci-1');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('taklit: ağ yok'); }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('magaza_talep — kiracının KAYNAĞI (kurulum eksiği bugünden görünür)', () => {
  it('kiracı çözülüyor ama ortam değişkeninden DEĞİL (tek kiracı taraması) → KIRMIZI: ikinci hesap açılınca uç 503 döner', async () => {
    vi.mocked(ortamdanKiraci).mockReturnValue('');
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('KİRACI TARAMAYLA ÇÖZÜLÜYOR — SERVER_TENANT_COMPANY_ID tanımlı değil');
    expect(m.detail.startsWith('KİRACI TARAMAYLA ÇÖZÜLÜYOR')).toBe(true);   // bozuk parça başta
    expect(m.detail).not.toContain('kiracı çözüldü');
    expect(m.detail).not.toContain('kiraci-1');                             // kimlik ayrıntıya yazılmaz
    expect(kiraciSorgulari()).toHaveLength(1);                              // eşleşme yine sorgulandı (hayalet denetimi önce)
  });
  it('ortam değişkeni dolu → kaynak uyarısı yok', async () => {
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(m.detail).not.toContain('TARAMAYLA');
  });
  it('hayalet kiracı kaynak uyarısından ÖNCE gelir (ortam değişkeni yanlışsa asıl sorun odur)', async () => {
    durum.havuz = sahteHavuz({ eslesen: 0 });
    const m = await kos();
    expect(m.detail).toContain('HAYALET KİRACI');
    expect(m.detail).not.toContain('TARAMAYLA');
  });
});

describe('magaza_talep — hepsi temiz', () => {
  it('yapılandırma tam + doğrulama başarılı + sayım temiz + kiracı eşleşiyor → YEŞİL; ayrıntıda toplam, son 24 saat ve uç sayaçları', async () => {
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(m.detail).toContain('SMTP hazır');
    expect(m.detail).toContain('kiracı çözüldü');
    expect(m.detail).toContain('42 talep, son 24 saatte 3');
    expect(m.detail).toContain('gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 0 (bilgi)');
    expect(m.detail).toContain('eklenen: 3, çakışan: 1, 400: 0, 403: 2, 404: 0, 413: 0, 415: 0, 429: 0, 500: 0, 503: 4');
    // Dilim 2a: dilim 1'in dört parçası (kiracı · SMTP · sayım · uç sayaçları) + site paneli yapılandırması + açık talepler
    // + panel sayaçları + takip sayaçları. Dilim 2b: + revize bildirimi sayımı (ilk bildirim sayımının hemen ardında) +
    // silinmiş talepler (açık taleplerin hemen ardında). Sıra da sabit; başka parça yok (500 sayacı 0: kırmızı parça eklenmez).
    expect(m.detail.split(' · ')).toEqual([
      'kiracı çözüldü',
      'SMTP hazır (bağlantı ve kimlik doğrulandı)',
      'site paneli yapılandırılmış (anahtar ve dönüş adresi var)',
      '42 talep, son 24 saatte 3 — bildirim: gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 0 (bilgi)',
      'revize bildirimi: gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 0 (bilgi)',
      expect.stringMatching(/^açık talep 7 \(yeni 2, teyit 1, hazırlanıyor 3, sevk 1, aşaması bilinmeyen 0\) — en eski açığın yaşı \d+ (gün|sa)$/),
      'silinmiş: 2 (son 30 gün)',
      'uç sayaçları (süreç başından beri) — eklenen: 3, çakışan: 1, 400: 0, 403: 2, 404: 0, 413: 0, 415: 0, 429: 0, 500: 0, 503: 4',
      'panel sayaçları (süreç başından beri) — hepsi 0 (44 sayaç)',
      'takip sayaçları (süreç başından beri) — hepsi 0 (3 sayaç)',
    ]);
    expect(m.detail).not.toContain('500 DÖNDÜ');
    expect(smtpDogrula).toHaveBeenCalledTimes(1);
  });

  it('doğrulama zamanında biterse süre sınırı zamanlayıcısı bırakılmaz', async () => {
    vi.useFakeTimers();
    await kos();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bekçinin kaynağındaki her kontrol anahtarı bir koşuda TAM BİR sonuç üretir (magaza_talep dâhil)', async () => {
    const kaynak = fs.readFileSync(path.resolve(__dirname, 'opsWatchdog.ts'), 'utf8');
    const kaynaktaki = [...new Set([...kaynak.matchAll(/add\('([a-z_]+)'/g)].map(e => e[1]))].sort();
    expect(kaynaktaki).toContain('magaza_talep');
    const { tumu } = await kos();
    expect(tumu.map(c => c.key).sort()).toEqual(kaynaktaki);
  });
});

describe('magaza_talep — (a) yapılandırma', () => {
  it('eksik anahtar → KIRMIZI, yalnız anahtar ADI; bağlantı DENENMEZ; talep sayısından bağımsız (0 talepte de)', async () => {
    durum.havuz = sahteHavuz({ sayim: { toplam: 0, son24: 0, gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 0, eski_gitmeyen: 0 } });
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: ['SMTP_USER', 'SMTP_PASS'], kip: 'kimlikli' });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP yapılandırılmamış — eksik: SMTP_USER, SMTP_PASS');
    expect(smtpDogrula).not.toHaveBeenCalled();
    // Bozuk parça başa yazılır: uyarı e-postasında ilk okunan yer neden olsun.
    expect(m.detail.startsWith('SMTP yapılandırılmamış')).toBe(true);
  });

  it('eksik deyip anahtar adı vermeyen yapılandırma okuyucu → yine KIRMIZI; bağlantı denenmez', async () => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: [], kip: 'kimlikli' });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP yapılandırılmamış — eksik: anahtar adı bildirilmedi');
    expect(smtpDogrula).not.toHaveBeenCalled();
  });

  it('anahtar ADI biçiminde olmayan değer ayrıntıya GİRMEZ (değer sızmaz)', async () => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: ['SMTP_PASS=cok-gizli-parola', 'smtp_user', 'SMTP_HOST'], kip: 'kimlikli' });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('eksik: ?, ?, SMTP_HOST');
    expect(m.detail).not.toContain('cok-gizli-parola');
    expect(m.detail).not.toContain('smtp_user');
  });

  const ETIKET: Record<MagazaBildirimHataSinifi, string> = {
    kimlik: 'kimlik doğrulama', tls: 'TLS / sertifika', baglanti: 'bağlantı', 'gonderen-reddi': 'gönderen reddi (MAIL FROM)', 'alici-reddi': 'alıcı reddi', diger: 'diğer',
  };
  it.each(MAGAZA_BILDIRIM_HATA_SINIFLARI.map(sinif => [sinif, ETIKET[sinif]] as const))(
    'doğrulama başarısız (%s) → KIRMIZI + hata sınıfı «%s»', async (sinif, etiket) => {
      vi.mocked(smtpDogrula).mockResolvedValue({ ok: false, sinif });
      const m = await kos();
      expect(m.ok).toBe(false);
      expect(m.detail).toContain(`SMTP doğrulaması BAŞARISIZ — hata sınıfı: ${etiket}`);
    });

  it('kapalı kümede OLMAYAN sınıf (yanlışlıkla hata metni) → «diğer»; metin ayrıntıya girmez', async () => {
    // Sözleşmeyi BOZAN bir doğrulayıcı canlandırılıyor: değer bilerek tip dışı.
    const bozuk: unknown = { ok: false, sinif: `535 Authentication failed for ${GIZLI}` };
    vi.mocked(smtpDogrula).mockResolvedValue(bozuk as Awaited<ReturnType<typeof smtpDogrula>>);
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('hata sınıfı: diğer');
    expect(m.detail).not.toContain('AHMET');
    expect(m.detail).not.toContain('535');
  });

  it('doğrulayıcı «yapılandırılmamış» dönerse → KIRMIZI', async () => {
    vi.mocked(smtpDogrula).mockResolvedValue({ ok: false, yapilandirilmamis: true });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP yapılandırılmamış');
  });

  it('doğrulama 10 sn içinde bitmezse beklenmez → KIRMIZI (bağlantı)', async () => {
    let ac: () => void = () => {};
    const cagrildi = new Promise<void>(coz => { ac = coz; });
    vi.mocked(smtpDogrula).mockImplementation(() => { ac(); return new Promise(() => {}); });
    vi.useFakeTimers();
    const kosu = kos();
    await cagrildi;                                // önceki kontrollerin gerçek G/Ç'si bitsin, sınır kurulsun
    await vi.advanceTimersByTimeAsync(9_999);
    let bitti = false;
    void kosu.then(() => { bitti = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(bitti).toBe(false);                     // sınırdan ÖNCE vazgeçilmez
    await vi.advanceTimersByTimeAsync(1);
    const m = await kosu;
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP doğrulaması BAŞARISIZ — hata sınıfı: bağlantı (10 sn içinde yanıt yok)');
  });

  it('süre dolduktan SONRA gelen ret yakalanmamış kalmaz (unhandledRejection tetiklenmez)', async () => {
    let reddet: (hata: Error) => void = () => {};
    let ac: () => void = () => {};
    const cagrildi = new Promise<void>(coz => { ac = coz; });
    vi.mocked(smtpDogrula).mockImplementation(() => { ac(); return new Promise((_coz, ret) => { reddet = ret; }); });
    const yakalanmayan = vi.fn();
    process.on('unhandledRejection', yakalanmayan);
    try {
      vi.useFakeTimers();
      const kosu = kos();
      await cagrildi;
      await vi.advanceTimersByTimeAsync(10_000);
      const m = await kosu;
      expect(m.ok).toBe(false);
      vi.useRealTimers();
      reddet(new Error(`geç ret: ${GIZLI}`));
      await new Promise(coz => setTimeout(coz, 20));   // olay döngüsü dönsün: yakalanmamış ret burada bildirilirdi
      expect(yakalanmayan).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', yakalanmayan);
    }
  });

  it('yapılandırma okuyucu ya da doğrulayıcı fırlatırsa → KIRMIZI, yalnız hata türü (ileti yok)', async () => {
    vi.mocked(smtpYapilandirmasi).mockImplementation(() => { throw new TypeError(`okunamadı: ${GIZLI}`); });
    let m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP kontrol edilemedi (TypeError)');
    expect(m.detail).not.toContain('AHMET');

    vi.mocked(smtpYapilandirmasi).mockReset().mockReturnValue({ tamam: true, eksik: [], kip: 'kimlikli' });
    vi.mocked(smtpDogrula).mockRejectedValue(Object.assign(new Error(`connect ${GIZLI}`), { code: 'ECONNREFUSED' }));
    m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP kontrol edilemedi (ECONNREFUSED)');
    expect(m.detail).not.toContain('AHMET');
  });
});

describe('magaza_talep — (b) sayım', () => {
  /** Sorgudaki «pencereden KANITLI eski» parçası (boşlukları teke indirilmiş): biçim deseni + $5 eşiği; kanıt yoksa `false`. */
  const PENCEREDEN_ESKI = `COALESCE((data->>'olusturma') COLLATE "C" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' AND (data->>'olusturma') COLLATE "C" < $5, false)`;

  // Eşik 1'dir (`> 0`): düşük hacimli mağazada TEK gitmeyen bildirim olağan arıza biçimidir; 2 ile sınamak `> 1` gerilemesini kaçırırdı.
  it.each([
    ['gonderilemedi', 1, 'gönderilemedi 1'],
    ['yapilandirilmamis', 1, 'yapılandırılmamış 1'],
    ['bekleyen', 1, '10 dk+ bekleyen 1'],
    ['gonderilemedi', 2, 'gönderilemedi 2'],
    ['yapilandirilmamis', 2, 'yapılandırılmamış 2'],
    ['bekleyen', 2, '10 dk+ bekleyen 2'],
  ] as const)('%s = %i → KIRMIZI (diğer ikisi 0 iken)', async (alan, adet, beklenen) => {
    durum.havuz = sahteHavuz({ sayim: { ...TEMIZ_SAYIM, [alan]: adet } });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain(beklenen);
  });

  it('kırmızı penceresinin DIŞINDAKİ (7 günden eski) gitmeyen kırmızı YAPMAZ → YEŞİL; ayrıntıda bilgi olarak sayılır', async () => {
    durum.havuz = sahteHavuz({ sayim: { ...TEMIZ_SAYIM, eski_gitmeyen: 3 } });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(m.detail).toContain('gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 3 (bilgi)');
    expect(m.detail).not.toContain('SAYIM OKUNAMADI');
  });

  it('pencere İÇİNDEKİ gitmeyen → KIRMIZI; yanında eski gitmeyen olması bunu değiştirmez (ikisi ayrı sayılır)', async () => {
    durum.havuz = sahteHavuz({ sayim: { ...TEMIZ_SAYIM, gonderilemedi: 1, eski_gitmeyen: 3 } });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('gönderilemedi 1, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 3 (bilgi)');
  });

  it('ölçüt `olusturma` METNİDİR, `updated_at` DEĞİL; eşikler: 24 saat, ortak bekleme sınırı, üst sınır şimdi + 5 dk, kırmızı penceresi 7 gün', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const simdi = Date.parse('2026-10-08T09:00:00.000Z');
    vi.setSystemTime(simdi);
    await kos();
    const s = sayimSorgulari();
    expect(s).toHaveLength(1);
    expect(s[0].sql).toBe(magazaTalepSayimSql('bildirim'));   // bekçinin gönderdiği sorgu üreticinin çıktısıdır (§ 6)
    expect(s[0].sql).toContain("data->>'olusturma'");
    expect(s[0].sql).not.toContain('updated_at');
    expect(s[0].params).toEqual([
      'magazaTalepleri',
      '2026-10-07T09:00:00.000Z',
      new Date(simdi - MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS).toISOString(),
      '2026-10-08T09:05:00.000Z',
      '2026-10-01T09:00:00.000Z',   // kırmızı penceresinin başı: şimdi − 7 gün
    ]);
    // Hangi eşik hangi sayıma gidiyor: son 24 saat → $2, bekleyen → $3 (ikisi de üst sınır $4 ile), kırmızı penceresi → $5.
    const tekSatir = s[0].sql.replace(/\s+/g, ' ');
    expect(tekSatir).not.toContain('${');   // şablon parçası çözülmeden sorguya gitmedi
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE (data->>'olusturma') COLLATE "C" BETWEEN $2 AND $4))::int AS son24`);
    // (İnceleme 2b, bulgu 8 — bilerek değişen çit) üç kırmızı sütun silinmiş talebi dışlar; bilgi sütunu (`eski_gitmeyen`) dışlamaz.
    const SILINMEMIS = `jsonb_typeof(data->'silindi') IS DISTINCT FROM 'object'`;
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'gonderilemedi' AND NOT ${PENCEREDEN_ESKI} AND ${SILINMEMIS}))::int AS gonderilemedi`);
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'yapilandirilmamis' AND NOT ${PENCEREDEN_ESKI} AND ${SILINMEMIS}))::int AS yapilandirilmamis`);
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'bekliyor' AND NOT COALESCE((data->>'olusturma') COLLATE "C" BETWEEN $3 AND $4, false) AND NOT ${PENCEREDEN_ESKI} AND ${SILINMEMIS}))::int AS bekleyen`);
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE data->'bildirim'->>'durum' IN ('gonderilemedi', 'yapilandirilmamis', 'bekliyor') AND ${PENCEREDEN_ESKI}))::int AS eski_gitmeyen`);
    expect(tekSatir).toContain('FROM docs WHERE coll = $1');
    expect([...new Set(tekSatir.match(/\$\d+/g))].sort()).toEqual(['$1', '$2', '$3', '$4', '$5']);   // verilen beş parametrenin hepsi kullanılıyor, altıncı yok
  });

  it('`olusturma`sı eksik / biçimsiz satır «eski» SAYILMAZ, kırmızı sayımında kalır: «eski» KANITLA sayılır (biçim + eşik), kanıt yoksa `false`', async () => {
    // Sahte havuz SQL koşturmaz; kural bekçinin GÖNDERDİĞİ sorgunun metninde kilitlidir (gerçek motorda ölçüldü: eksik, null,
    // boş dizge, '0', '2020-bozuk', sayı olarak yazılmış zaman, yerel biçim, milisaniyesiz ISO → hepsi kırmızı sayımında, bilgi 0).
    //  • NULL `olusturma`: `NULL ~ …` ve `NULL < $5` NULL'dur; `COALESCE(…, false)` onu «eski değil» yapar → `AND NOT …` satırı tutar.
    //  • Biçimsiz değer: yalnız metin karşılaştırmasında boş dizge / rakamla başlayan değer eşikten küçük çıkardı; biçim deseni onu eler.
    await kos();
    const tekSatir = sayimSorgulari()[0].sql.replace(/\s+/g, ' ');
    // $5 sorguda YALNIZ kanıt parçasının içinde geçer: üç kırmızı sayımda `AND NOT`, bilgi sütununda `AND` — çıplak `< $5` yok.
    const kanitlar = [...tekSatir.matchAll(/COALESCE\(\(data->>'olusturma'\) COLLATE "C" ~ '([^']+)' AND \(data->>'olusturma'\) COLLATE "C" < \$5, false\)/g)];
    expect(kanitlar).toHaveLength(4);
    expect(tekSatir.match(/\$5/g)).toHaveLength(4);
    expect(tekSatir.match(/AND NOT COALESCE\(\(data->>'olusturma'\) COLLATE "C" ~/g)).toHaveLength(3);
    const desenler = [...new Set(kanitlar.map(e => e[1]))];
    expect(desenler).toHaveLength(1);
    const desen = desenler[0];
    // Desen PostgreSQL'e AYNEN gider; ters bölü taşımaz ve baştan sona çapalıdır, yani JavaScript'te de aynı anlama gelir:
    // sunucunun yazdığı biçimi (`toISOString()`) tanır, bozuğu tanımaz.
    expect(desen).not.toContain('\\');
    expect(desen.startsWith('^') && desen.endsWith('$')).toBe(true);
    const bicim = new RegExp(desen);
    expect(bicim.test(new Date(0).toISOString())).toBe(true);
    expect(bicim.test('2026-10-08T09:00:00.000Z')).toBe(true);
    for (const bozuk of ['', '0', '2020-bozuk', '1759900000000', '08.10.2026 09:00', '2026-09-01T09:00:00Z', '2026-10-08T09:00:00.000Z ', 'x2026-10-08T09:00:00.000Z']) {
      expect(bicim.test(bozuk), JSON.stringify(bozuk)).toBe(false);
    }
  });

  it.each([
    ['satır dönmedi', null],
    ['hücre null', { ...TEMIZ_SAYIM, bekleyen: null }],
    ['hücre metin', { ...TEMIZ_SAYIM, gonderilemedi: '0' }],
    ['hücre eksik', { toplam: 1, son24: 1, gonderilemedi: 0, yapilandirilmamis: 0, eski_gitmeyen: 0 }],
    ['bilgi hücresi (eski gitmeyen) eksik', { toplam: 1, son24: 1, gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 0 }],
    ['bilgi hücresi (eski gitmeyen) eksi', { ...TEMIZ_SAYIM, eski_gitmeyen: -1 }],
    ['hücre NaN', { ...TEMIZ_SAYIM, toplam: Number.NaN }],
  ] as const)('okunamayan sayı sıfır SAYILMAZ (%s) → KIRMIZI ve «—»', async (_ad, sayim) => {
    durum.havuz = sahteHavuz({ sayim });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('—');
    expect(m.detail).toContain('SAYIM OKUNAMADI');
  });

  it('sorgu fırlatırsa → KIRMIZI, yalnız hata KODU; pg iletisi / detail / where ayrıntıya girmez', async () => {
    durum.havuz = sahteHavuz({ sayim: pgHatasi('22P02') });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('sayım yapılamadı (22P02)');
    expect(m.detail).not.toContain('AHMET');
    expect(m.detail).not.toContain('0532');
    expect(m.detail).not.toContain('Failing row');
  });
});

// ── Dilim 2b (§ 10.7 / § 10.8) ────────────────────────────────────────────────────────────────────────────────────────
describe('magaza_talep — (b) revize bildirimi sayımı (dilim 2b: AYRI sorgu, AYRI parça, aynı hüküm)', () => {
  const revizeParcasi = (detail: string): string => String(detail.split(' · ').find(p => p.startsWith('revize bildirimi')));
  const ilkParca = (detail: string): string => String(detail.split(' · ').find(p => p.includes(' talep, son 24 saatte ')));

  // Eşik 1'dir (`> 0`): tek gitmeyen revize bildirimi de kırmızıdır.
  it.each([
    ['gonderilemedi', 1, 'revize bildirimi: gönderilemedi 1, yapılandırılmamış 0, 10 dk+ bekleyen 0'],
    ['yapilandirilmamis', 1, 'revize bildirimi: gönderilemedi 0, yapılandırılmamış 1, 10 dk+ bekleyen 0'],
    ['bekleyen', 1, 'revize bildirimi: gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 1'],
    ['bekleyen', 4, 'revize bildirimi: gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 4'],
  ] as const)('revize %s = %i → KIRMIZI (ilk bildirim sayımı tertemizken); kırmızı parça BAŞTA', async (alan, adet, beklenen) => {
    durum.havuz = sahteHavuz({ revize: { ...TEMIZ_REVIZE, [alan]: adet } });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail.startsWith(beklenen)).toBe(true);
    // İlk bildirimin parçası DEĞİŞMEDİ: revize sayıları ona karışmaz.
    expect(ilkParca(m.detail)).toBe('42 talep, son 24 saatte 3 — bildirim: gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 0 (bilgi)');
  });

  it('tersi: ilk bildirim kırmızıyken revize parçası temiz kalır (iki alan birbirini boyamaz); ikisi de kırmızıysa ikisi de yazılır', async () => {
    durum.havuz = sahteHavuz({ sayim: { ...TEMIZ_SAYIM, gonderilemedi: 2 } });
    const yalnizIlk = await kos();
    expect(yalnizIlk.ok).toBe(false);
    expect(revizeParcasi(yalnizIlk.detail)).toBe('revize bildirimi: gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 0 (bilgi)');
    durum.havuz = sahteHavuz({ sayim: { ...TEMIZ_SAYIM, gonderilemedi: 2 }, revize: { ...TEMIZ_REVIZE, bekleyen: 3 } });
    const ikisi = await kos();
    expect(ikisi.ok).toBe(false);
    expect(ilkParca(ikisi.detail)).toContain('bildirim: gönderilemedi 2,');
    expect(revizeParcasi(ikisi.detail)).toContain('10 dk+ bekleyen 3');
  });

  it('kırmızı penceresinin DIŞINDAKİ (7 günden eski revizyon) gitmeyen revize kırmızı YAPMAZ → YEŞİL; bilgi olarak sayılır', async () => {
    durum.havuz = sahteHavuz({ revize: { ...TEMIZ_REVIZE, eski_gitmeyen: 5 } });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(revizeParcasi(m.detail)).toBe('revize bildirimi: gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 5 (bilgi)');
  });

  it('kapalı kipte revize `yapilandirilmamis` da BİLGİDİR (kırmızı değil); yerel / kimlikli kipte kırmızı; `gonderilemedi` kapalıyken de kırmızı', async () => {
    durum.havuz = sahteHavuz({ revize: { ...TEMIZ_REVIZE, yapilandirilmamis: 2 } });
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: [], kip: 'kapali' });
    const kapali = await kos();
    expect(kapali.ok).toBe(true);
    expect(revizeParcasi(kapali.detail)).toContain('yapılandırılmamış 2 (kapalı kip, bilgi)');
    for (const kip of ['yerel', 'kimlikli'] as const) {
      vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: true, eksik: [], kip });
      const m = await kos();
      expect(m.ok, kip).toBe(false);
      expect(revizeParcasi(m.detail)).not.toContain('(kapalı kip, bilgi)');
    }
    durum.havuz = sahteHavuz({ revize: { ...TEMIZ_REVIZE, gonderilemedi: 1 } });
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: [], kip: 'kapali' });
    expect((await kos()).ok).toBe(false);
  });

  it('sorgu üreticinin `bildirimRevize` çıktısıdır; ilk bildirim sayımıyla AYNI beş parametre (tek «şimdi»); koşu başına birer sorgu', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const simdi = Date.parse('2026-10-08T09:00:00.000Z');
    vi.setSystemTime(simdi);
    await kos();
    expect(sayimSorgulari()).toHaveLength(1);
    const r = revizeSorgulari();
    expect(r).toHaveLength(1);
    expect(r[0].sql).toBe(magazaTalepSayimSql('bildirimRevize'));
    expect(r[0].sql).not.toBe(magazaTalepSayimSql('bildirim'));
    expect(r[0].params).toEqual(sayimSorgulari()[0].params);
    expect(r[0].params).toEqual([
      'magazaTalepleri', '2026-10-07T09:00:00.000Z', new Date(simdi - MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS).toISOString(), '2026-10-08T09:05:00.000Z', '2026-10-01T09:00:00.000Z',
    ]);
    // Sıra: ilk bildirim sayımı revize sayımından ÖNCE (parça sırası da öyle).
    expect(sorgular.findIndex(s => revizeSorgusuMu(s.sql))).toBeGreaterThan(sorgular.findIndex(s => s === sayimSorgulari()[0]));
  });

  it.each([
    ['satır dönmedi', null],
    ['hücre null', { ...TEMIZ_REVIZE, bekleyen: null }],
    ['hücre metin', { ...TEMIZ_REVIZE, gonderilemedi: '0' }],
    ['kırmızı hücresi eksik', { toplam: 1, son24: 0, gonderilemedi: 0, yapilandirilmamis: 0, eski_gitmeyen: 0 }],
    ['bilgi hücresi (eski gitmeyen) eksik', { toplam: 1, son24: 0, gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 0 }],
    ['bilgi hücresi eksi', { ...TEMIZ_REVIZE, eski_gitmeyen: -1 }],
  ] as const)('okunamayan revize sayısı sıfır SAYILMAZ (%s) → KIRMIZI ve «—»; ilk bildirim parçası yine yazılır', async (_ad, revize) => {
    durum.havuz = sahteHavuz({ revize });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(revizeParcasi(m.detail)).toContain('—');
    expect(revizeParcasi(m.detail)).toContain('(REVİZE SAYIMI OKUNAMADI)');
    expect(ilkParca(m.detail)).not.toContain('OKUNAMADI');
  });

  it('revize satırında `toplam` / `son24` OKUNMAZ: o iki hücre bozuk olsa da parça temizdir (talep sayısı ilk parçadadır)', async () => {
    durum.havuz = sahteHavuz({ revize: { gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 0, eski_gitmeyen: 0, toplam: 'x', son24: null } });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(revizeParcasi(m.detail)).toBe('revize bildirimi: gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 0 (bilgi)');
  });

  it('revize sorgusu fırlatırsa → KIRMIZI, yalnız hata KODU; ilk bildirim sayımı, açık ve silinmiş parçaları yine yazılır', async () => {
    durum.havuz = sahteHavuz({ revize: pgHatasi('42883') });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail.startsWith('revize bildirimi sayımı yapılamadı (42883)')).toBe(true);
    expect(m.detail).toContain('42 talep, son 24 saatte 3');
    expect(m.detail).toContain('açık talep 7');
    expect(m.detail).toContain('silinmiş: 2 (son 30 gün)');
    expect(m.detail).not.toContain('AHMET');
    expect(m.detail).not.toContain('Failing row');
  });

  it('ilk bildirim sorgusu fırlatırsa revize sayımı YİNE koşar ve yazılır (iki sayım birbirine bağlı değil)', async () => {
    durum.havuz = sahteHavuz({ sayim: pgHatasi('22P02') });
    const m = await kos();
    expect(m.detail).toContain('sayım yapılamadı (22P02)');
    expect(revizeSorgulari()).toHaveLength(1);
    expect(revizeParcasi(m.detail)).toBe('revize bildirimi: gönderilemedi 0, yapılandırılmamış 0, 10 dk+ bekleyen 0, 7 günden eski gitmeyen 0 (bilgi)');
  });
});

describe('magaza_talep — (e) silinmiş talepler (dilim 2b: «silinmiş: N (son 30 gün)»; bilgi)', () => {
  const silinmisParcasi = (detail: string): string => String(detail.split(' · ').find(p => p.startsWith('silinmiş')));

  it('pencere içinde silinen sayısı ayrıntıda; YEŞİL (bilgi) — sayı ne kadar büyük olursa olsun kırmızı yapmaz', async () => {
    expect(silinmisParcasi((await kos()).detail)).toBe('silinmiş: 2 (son 30 gün)');
    durum.havuz = sahteHavuz({ silinmis: { pencerede: 0, tarihsiz: 0 } });
    expect(silinmisParcasi((await kos()).detail)).toBe('silinmiş: 0 (son 30 gün)');
    durum.havuz = sahteHavuz({ silinmis: { pencerede: 900, tarihsiz: 0 } });
    const cok = await kos();
    expect(cok.ok).toBe(true);
    expect(silinmisParcasi(cok.detail)).toBe('silinmiş: 900 (son 30 gün)');
  });

  it('silinme zamanı okunamayan satır pencereye UYDURULMAZ: ayrıca sayılır', async () => {
    durum.havuz = sahteHavuz({ silinmis: { pencerede: 1, tarihsiz: 3 } });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(silinmisParcasi(m.detail)).toBe('silinmiş: 1 (son 30 gün), silinme zamanı okunamayan 3');
  });

  it.each([
    ['satır dönmedi', null],
    ['sayı null', { pencerede: null, tarihsiz: 0 }],
    ['sayı metin', { pencerede: '2', tarihsiz: 0 }],
    ['sütun eksik', { pencerede: 2 }],
    ['eksi', { pencerede: 2, tarihsiz: -1 }],
  ] as const)('okunamayan sayım sıfır SAYILMAZ (%s) → KIRMIZI «OKUNAMADI»', async (_ad, silinmis) => {
    durum.havuz = sahteHavuz({ silinmis });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail.startsWith('silinmiş talep sayımı OKUNAMADI')).toBe(true);
    expect(m.detail).not.toMatch(/silinmiş: \d/);
  });

  it('sorgu fırlatırsa → KIRMIZI, yalnız hata KODU; açık talep parçası yine yazılır', async () => {
    durum.havuz = sahteHavuz({ silinmis: pgHatasi('57014') });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail.startsWith('silinmiş talep sayımı yapılamadı (57014)')).toBe(true);
    expect(m.detail).toContain('açık talep 7');
    expect(m.detail).not.toContain('AHMET');
  });

  it('açık talep sorgusu fırlatırsa silinmiş sayımı YİNE koşar (ayrı yakalayıcı)', async () => {
    durum.havuz = sahteHavuz({ acik: pgHatasi('42883') });
    const m = await kos();
    expect(m.detail).toContain('açık talep sayımı yapılamadı (42883)');
    expect(silinmisSorgulari()).toHaveLength(1);
    expect(silinmisParcasi(m.detail)).toBe('silinmiş: 2 (son 30 gün)');
  });

  it('sorgu: koşu başına TEK sorgu; parametreler koleksiyon + pencerenin başı (şimdi − 30 gün); ölçüt her yerdeki AYNI sabit (`MAGAZA_SILINMIS_SQL`); yaş `silindi.zaman`', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-31T09:00:00.000Z'));
    await kos();
    const s = silinmisSorgulari();
    expect(s).toHaveLength(1);
    expect(s[0].params).toEqual(['magazaTalepleri', '2026-10-01T09:00:00.000Z']);
    const tekSatir = s[0].sql.replace(/\s+/g, ' ');
    expect(tekSatir).not.toContain('${');
    expect(MAGAZA_SILINMIS_SQL).toBe(`jsonb_typeof(data->'silindi') = 'object'`);
    expect(tekSatir.endsWith(`FROM docs WHERE coll = $1 AND ${MAGAZA_SILINMIS_SQL}`)).toBe(true);
    expect(tekSatir).toContain(`(data->'silindi'->>'zaman') COLLATE "C" >= $2`);
    expect([...new Set(tekSatir.match(/\$\d+/g))].sort()).toEqual(['$1', '$2']);
    // Silinmiş satırdan okunan TEK alt alan zamandır: silen kişi (`kim`), kanal, müşteri alanı sorguya girmez; GROUP BY yok.
    expect([...new Set([...tekSatir.matchAll(/data->'silindi'->>'([A-Za-z]+)'/g)].map(e => e[1]))]).toEqual(['zaman']);
    for (const yasak of ['kim', 'kanal', 'musteri', 'olusturma', 'updated_at', 'timestamptz', 'GROUP BY', 'IS NULL']) expect(tekSatir, yasak).not.toContain(yasak);
    // «Biçimli tarih» deseni açık sayımındaki ve bekçinin «pencereden eski» kanıtındaki desenle AYNI metin.
    const desenler = (sql: string, alan: string): string[] => [...sql.matchAll(new RegExp(`\\(${alan}\\) COLLATE "C" ~ '([^']+)'`, 'g'))].map(e => e[1]);
    const silinme = [...new Set(desenler(s[0].sql, `data->'silindi'->>'zaman'`))];
    expect(silinme).toHaveLength(1);
    expect(silinme).toEqual([...new Set(desenler(acikSorgulari()[0].sql, `data->>'olusturma'`))]);
    expect(silinme).toEqual([...new Set(desenler(sayimSorgulari()[0].sql, `data->>'olusturma'`))]);
  });
});

describe('magaza_talep — (c) kullanılabilirlik', () => {
  it('kiracı çözülemiyor (boş dizge) → KIRMIZI; eşleşme sorgusu koşmaz', async () => {
    durum.kiraci = '';
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('KİRACI ÇÖZÜLEMİYOR');
    expect(kiraciSorgulari()).toEqual([]);
  });

  it.each([['null', null], ['undefined', undefined], ['sayı', 7]] as const)(
    'çözümleyici sözleşme dışı değer (%s) dönerse çözülmüş SAYILMAZ → KIRMIZI; eşleşme sorgusu koşmaz', async (_ad, deger) => {
      // Sözleşmeyi BOZAN bir çözümleyici canlandırılıyor: değer bilerek tip dışı.
      const bozuk: unknown = deger;
      durum.kiraci = bozuk as string;
      const m = await kos();
      expect(m.ok).toBe(false);
      expect(m.detail).toContain('KİRACI ÇÖZÜLEMİYOR');
      expect(kiraciSorgulari()).toEqual([]);
    });

  it('hayalet kiracı (çözülen kimlik users içinde hiçbir kiracıyla eşleşmiyor) → KIRMIZI; kimlik ayrıntıya yazılmaz', async () => {
    durum.kiraci = 'hayalet-kiraci-9';
    durum.havuz = sahteHavuz({ eslesen: 0 });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('HAYALET KİRACI');
    expect(m.detail).not.toContain('hayalet-kiraci-9');
    const s = kiraciSorgulari();
    expect(s).toHaveLength(1);
    expect(s[0].params).toEqual(['hayalet-kiraci-9']);
    // Kiracı = companyId, o yoksa kullanıcının kendi kimliği (server.ts ile aynı formül).
    expect(s[0].sql).toContain("COALESCE(NULLIF(data->>'companyId', ''), id) = $1");
  });

  it.each([['null', null], ['metin', '1'], ['eksi', -1]] as const)(
    'eşleşme sayısı okunamıyorsa (%s) eşleşmiş SAYILMAZ → KIRMIZI', async (_ad, eslesen) => {
      durum.havuz = sahteHavuz({ eslesen });
      const m = await kos();
      expect(m.ok).toBe(false);
      expect(m.detail).toContain('kiracı eşleşmesi OKUNAMADI');
    });

  it('pg havuzu yok → KIRMIZI; SMTP yine ölçülür, sayım / eşleşme sorgusu yok', async () => {
    durum.havuz = null;
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('PG HAVUZU YOK');
    expect(m.detail).toContain('SMTP hazır');
    // havuz · SMTP · site paneli · uç sayaçları · panel sayaçları · takip sayaçları — olmayan havuzda sorgu DENENMEZ
    // (bildirim sayımı, revize sayımı, açık ve silinmiş talep sayımı için ayrı hata parçası yok).
    expect(m.detail.split(' · ')).toHaveLength(6);
    expect(m.detail).not.toContain('açık talep');
    expect(m.detail).not.toContain('revize bildirimi');
    expect(m.detail).not.toContain('silinmiş');
    expect(smtpDogrula).toHaveBeenCalledTimes(1);
    expect(sorgular).toEqual([]);
  });

  it('kiracı çözümleyici ya da eşleşme sorgusu fırlatırsa → KIRMIZI, yalnız kod / tür', async () => {
    durum.kiraciHatasi = new Error(`users okunamadı: ${GIZLI}`);
    let m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('kiracı kontrol edilemedi (Error)');
    expect(m.detail).not.toContain('AHMET');

    durum.kiraciHatasi = null;
    durum.havuz = sahteHavuz({ eslesen: pgHatasi('57014') });
    m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('kiracı kontrol edilemedi (57014)');
    expect(m.detail).not.toContain('AHMET');
  });

  it('kontrolün kendisi fırlatırsa → «kontrol edilemedi» KIRMIZISI; ham ileti yazılmaz', async () => {
    durum.havuzHatasi = Object.assign(new Error(`havuz: ${GIZLI}`), { code: 'ECONNRESET' });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toBe('kontrol edilemedi: ECONNRESET');
  });

  it('kod / tür adı güvenli desene uymuyorsa yazılmaz', async () => {
    durum.havuzHatasi = Object.assign(new Error('x'), { code: `kod ${GIZLI}`, name: `ad ${GIZLI}` });
    const m = await kos();
    expect(m.detail).toBe('kontrol edilemedi: bilinmeyen hata');
  });

  it('hata nesnesi olmayan ret (düz metin) ayrıntıya girmez', async () => {
    vi.mocked(smtpDogrula).mockRejectedValue(`düz metin ret: ${GIZLI}`);
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP kontrol edilemedi (bilinmeyen hata)');
    expect(m.detail).not.toContain('AHMET');
  });
});

describe('magaza_talep — uç sayaçları', () => {
  it('eksik ya da sayı olmayan sayaç «—» yazılır (sıfır değil); sonuç yeşil kalır — 500 sayacı YOKSA kırmızı parça eklenmez', async () => {
    vi.mocked(magazaSayaclari).mockReturnValue({ eklenen: 7, r403: 2, r429: Number.NaN });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(m.detail).toContain('eklenen: 7, çakışan: —, 400: —, 403: 2, 404: —, 413: —, 415: —, 429: —, 500: —, 503: —');
    expect(m.detail).not.toContain('500 DÖNDÜ');
  });

  it.each([1, 3])('uç süreç başından beri %i kez 500 döndüyse → KIRMIZI (geri kalan her şey sağlıklıyken); bilgi satırı yine yazılır', async (adet) => {
    vi.mocked(magazaSayaclari).mockReturnValue({ ...TAM_SAYACLAR, r500: adet });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail.startsWith(`UÇ ${adet} KEZ 500 DÖNDÜ (süreç başından beri)`)).toBe(true);   // bozuk parça başta
    expect(m.detail).toContain('süreç günlüğünde «[magaza]» satırlarına bak');
    expect(m.detail).toContain(`429: 0, 500: ${adet}, 503: 4`);
    // 500 · kiracı · SMTP · site paneli · sayım · revize sayımı · açık talepler · silinmiş · uç sayaçları · panel sayaçları · takip sayaçları — kırmızı olan YALNIZ 500 parçası
    expect(m.detail.split(' · ')).toHaveLength(11);
    expect(m.detail).toContain('kiracı çözüldü');
    expect(m.detail).toContain('SMTP hazır');
  });

  it('öbür ret sayaçları (403 / 429 / 503 …) ne kadar büyük olursa olsun kırmızı YAPMAZ (yalnız bilgi; eşik kullanıcı kararı)', async () => {
    vi.mocked(magazaSayaclari).mockReturnValue({ ...TAM_SAYACLAR, r400: 12, r403: 5700, r404: 9, r413: 2, r415: 1, r429: 310, r503: 88 });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(m.detail).not.toContain('500 DÖNDÜ');
  });

  it('sayaç okuyucu fırlatırsa → KIRMIZI, ileti yazılmaz', async () => {
    vi.mocked(magazaSayaclari).mockImplementation(() => { throw new Error(`sayaç: ${GIZLI}`); });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('uç sayaçları okunamadı (Error)');
    expect(m.detail).not.toContain('AHMET');
  });
});

// ── Dilim 2a (§ 6 / § 7 «Bekçi») ─────────────────────────────────────────────────────────────────────────────────────
describe('magaza_talep — (d) site paneli yapılandırması', () => {
  it.each([
    ['dönüş adresi yok (anahtar ondan türediği için o da yok)', { anahtarVar: false, donusVar: false }, 'dönüş adresi geçersiz: MAGAZA_PANEL_DONUS https olmalı'],
    ['dönüş adresi yok, anahtar «var» (kök neden yine adres)', { anahtarVar: true, donusVar: false }, 'dönüş adresi geçersiz: MAGAZA_PANEL_DONUS https olmalı'],
    ['anahtar yok', { anahtarVar: false, donusVar: true }, 'oturum sırrı yok (SESSION_TOKEN_SECRET ya da FIREBASE_PRIVATE_KEY tanımlı değil)'],
  ] as const)('%s → KIRMIZI: panel hiç çalışmaz; geri kalan her şey sağlıklıyken', async (_ad, panel, neden) => {
    durum.panel = panel;
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail.startsWith('SİTE PANELİ ÇALIŞMIYOR — ')).toBe(true);   // bozuk parça başta
    expect(m.detail).toContain(neden);
    expect(m.detail).toContain('panel uçları 503 «panel-yapilandirilmamis» döner');
    expect(m.detail).not.toContain('site paneli yapılandırılmış');
    expect(m.detail.split(' · ')).toHaveLength(10);                       // parça sayısı aynı: yeşil panel parçasının yerine kırmızısı
    expect(m.detail).toContain('kiracı çözüldü');
    expect(m.detail).toContain('SMTP hazır');
  });

  it('dönüş adresi yokken «oturum sırrı yok» DENMEZ (anahtar adresten türer; sır hakkında hüküm verilemez)', async () => {
    durum.panel = { anahtarVar: false, donusVar: false };
    expect((await kos()).detail).not.toContain('oturum sırrı yok');
  });

  it('ikisi de varken YEŞİL ve ayrıntı bunu AÇIKÇA söyler (atlanan kontrol ile geçen kontrol aynı görünmez)', async () => {
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(m.detail).toContain('site paneli yapılandırılmış (anahtar ve dönüş adresi var)');
    expect(m.detail).not.toContain('SİTE PANELİ ÇALIŞMIYOR');
  });

  it.each([
    ['null', null], ['undefined', undefined], ['dizge', 'hazır'], ['alan eksik', { anahtarVar: true }],
    ['boolean olmayan alan', { anahtarVar: 1, donusVar: 'evet' }],
  ] as const)('okuyucu sözleşme dışı değer (%s) dönerse yapılandırılmış SAYILMAZ → KIRMIZI «OKUNAMADI»', async (_ad, deger) => {
    // Sözleşmeyi BOZAN bir okuyucu canlandırılıyor: değer bilerek tip dışı.
    const bozuk: unknown = deger;
    durum.panel = bozuk as typeof PANEL_HAZIR;
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('site paneli yapılandırması OKUNAMADI');
    expect(m.detail).not.toContain('site paneli yapılandırılmış');
  });

  it('okuyucu fırlatırsa → KIRMIZI, yalnız hata türü / kodu (ileti yok)', async () => {
    durum.panelHatasi = new RangeError(`panel: ${GIZLI}`);
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('site paneli yapılandırması kontrol edilemedi (RangeError)');
    expect(m.detail).not.toContain('AHMET');
  });

  it('ayrıntıya değer yazılmaz: yalnız ortam değişkeni ADLARI (anahtar / adres / köken değeri yok)', async () => {
    for (const panel of [{ anahtarVar: false, donusVar: false }, { anahtarVar: false, donusVar: true }, PANEL_HAZIR]) {
      durum.panel = panel;
      const m = await kos();
      expect(m.detail).not.toMatch(/https?:\/\//);
      expect(m.detail).not.toMatch(/[A-Z_]{4,}=/);
    }
  });

  it('kiracı çözülemiyorsa (boş dizge) KIRMIZI ileti paneli de anar: panel de 503 verir', async () => {
    durum.kiraci = '';
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('KİRACI ÇÖZÜLEMİYOR — mağaza ucu ve site paneli 503 döner');
  });
});

describe('magaza_talep — (e) açık talepler', () => {
  const SIMDI = Date.parse('2026-10-10T09:00:00.000Z');
  const sabitSaat = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(SIMDI); };
  const acikParcasi = (detail: string): string => String(detail.split(' · ').find(p => p.startsWith('açık talep')));

  it('açık sayısı, aşama dağılımı ve en eski açığın yaşı ayrıntıda; YEŞİL (bilgi)', async () => {
    sabitSaat();
    const m = await kos();
    expect(m.ok).toBe(true);
    // En eski açık 2026-10-05T09:00Z geldi; şimdi 2026-10-10T09:00Z → tam 5 gün.
    expect(acikParcasi(m.detail)).toBe('açık talep 7 (yeni 2, teyit 1, hazırlanıyor 3, sevk 1, aşaması bilinmeyen 0) — en eski açığın yaşı 5 gün');
  });

  it.each([
    ['30 dakika önce', SIMDI - 30 * 60_000, '30 dk'],
    ['59 dk 59 sn önce', SIMDI - (60 * 60_000 - 1000), '59 dk'],
    ['tam 1 saat önce', SIMDI - 60 * 60_000, '1 sa'],
    ['47 saat 59 dk önce', SIMDI - (48 * 3_600_000 - 60_000), '47 sa'],
    ['tam 2 gün önce', SIMDI - 2 * 86_400_000, '2 gün'],
    ['40 gün önce', SIMDI - 40 * 86_400_000, '40 gün'],
    ['saat kayması: 2 dk İLERİDE', SIMDI + 120_000, '0 dk'],
  ] as const)('yaş birimi (%s) → «%s»', async (_ad, enEskiMs, beklenen) => {
    sabitSaat();
    durum.havuz = sahteHavuz({ acik: { ...TEMIZ_ACIK, en_eski: new Date(enEskiMs).toISOString() } });
    expect(acikParcasi((await kos()).detail).endsWith(`— en eski açığın yaşı ${beklenen}`)).toBe(true);
  });

  it('açık talep yoksa «açık talep 0»; yaş YAZILMAZ; YEŞİL', async () => {
    durum.havuz = sahteHavuz({ acik: { acik: 0, asama_yeni: 0, asama_teyit: 0, asama_hazirlaniyor: 0, asama_sevk: 0, asama_bilinmiyor: 0, tarihsiz: 0, en_eski: null } });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(acikParcasi(m.detail)).toBe('açık talep 0');
  });

  it('açık var ama hiçbirinin tarihi okunamıyor → yaş UYDURULMAZ, açıkça söylenir; tarihsiz sayısı yazılır', async () => {
    durum.havuz = sahteHavuz({ acik: { ...TEMIZ_ACIK, acik: 2, asama_yeni: 0, asama_teyit: 0, asama_hazirlaniyor: 0, asama_sevk: 0, asama_bilinmiyor: 2, tarihsiz: 2, en_eski: null } });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(acikParcasi(m.detail)).toBe('açık talep 2 (yeni 0, teyit 0, hazırlanıyor 0, sevk 0, aşaması bilinmeyen 2) — en eski açığın yaşı okunamadı, tarihi okunamayan 2');
  });

  it('bir kısmının tarihi okunamıyorsa yaş okunanlardan, okunamayanlar ayrıca sayılır', async () => {
    sabitSaat();
    durum.havuz = sahteHavuz({ acik: { ...TEMIZ_ACIK, tarihsiz: 1 } });
    expect(acikParcasi((await kos()).detail).endsWith('— en eski açığın yaşı 5 gün, tarihi okunamayan 1')).toBe(true);
  });

  it('açık talep sayısı ve yaşı ne kadar büyük olursa olsun kırmızı YAPMAZ (yalnız bilgi; eşik kullanıcı kararı)', async () => {
    sabitSaat();
    durum.havuz = sahteHavuz({ acik: { ...TEMIZ_ACIK, acik: 480, asama_yeni: 470, asama_bilinmiyor: 4, en_eski: '2025-01-01T00:00:00.000Z' } });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(acikParcasi(m.detail)).toContain('açık talep 480 (yeni 470, ');
  });

  it.each([
    ['satır dönmedi', null],
    ['sayı null', { ...TEMIZ_ACIK, acik: null }],
    ['sayı metin', { ...TEMIZ_ACIK, asama_sevk: '1' }],
    ['aşama sütunu eksik', { acik: 7, asama_yeni: 2, asama_teyit: 1, asama_sevk: 1, asama_bilinmiyor: 0, tarihsiz: 0, en_eski: null }],
    ['tarihsiz eksi', { ...TEMIZ_ACIK, tarihsiz: -1 }],
    ['en eski biçimsiz', { ...TEMIZ_ACIK, en_eski: '05.10.2026 09:00' }],
    ['en eski sayı', { ...TEMIZ_ACIK, en_eski: 1759654800000 }],
  ] as const)('okunamayan sayım sıfır / uydurma tarih SAYILMAZ (%s) → KIRMIZI «OKUNAMADI»', async (_ad, acik) => {
    durum.havuz = sahteHavuz({ acik });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('açık talep sayımı OKUNAMADI');
    expect(m.detail).not.toMatch(/açık talep \d/);
  });

  it('sorgu fırlatırsa → KIRMIZI, yalnız hata KODU; pg iletisi ayrıntıya girmez; bildirim sayımı yine yazılır', async () => {
    durum.havuz = sahteHavuz({ acik: pgHatasi('42883') });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('açık talep sayımı yapılamadı (42883)');
    expect(m.detail).toContain('42 talep, son 24 saatte 3');
    expect(m.detail).not.toContain('AHMET');
    expect(m.detail).not.toContain('Failing row');
  });

  it('sorgu: koşu başına TEK sorgu, tek parametre (koleksiyon); açıklık ölçütü panel listesiyle AYNI sabit (`MAGAZA_ACIK_SQL`)', async () => {
    await kos();
    const s = acikSorgulari();
    expect(s).toHaveLength(1);
    expect(s[0].params).toEqual(['magazaTalepleri']);
    const tekSatir = s[0].sql.replace(/\s+/g, ' ');
    expect(tekSatir).not.toContain('${');
    expect(tekSatir.endsWith(`FROM docs WHERE coll = $1 AND ${MAGAZA_ACIK_SQL}`)).toBe(true);
    // Dilim 2b (bilerek değişen çit, § 4 / § 10.7): AÇIK koşulu + silinmemiş koşulu TEK sabittir — silinmiş talep açık sayılmaz.
    expect(MAGAZA_ACIK_SQL).toBe(`COALESCE(data->>'durum', '') NOT IN ('teslim', 'iptal') AND jsonb_typeof(data->'silindi') IS DISTINCT FROM 'object'`);
    expect([...new Set(tekSatir.match(/\$\d+/g))]).toEqual(['$1']);
  });

  it('yaş `olusturma`dan ölçülür: sorgu metninde kalem teslim / etiket / aşama zamanı / bildirim alanı YOK (işaret ve etiket açıklığı da yaşı da değiştirmez)', async () => {
    await kos();
    const sql = acikSorgulari()[0].sql;
    expect(sql).toContain(`min((data->>'olusturma') COLLATE "C")`);
    for (const yasak of ['kalemTeslim', 'etiketBasildi', 'durumZamani', 'bildirim', 'updated_at', 'timestamptz', 'GROUP BY']) expect(sql, yasak).not.toContain(yasak);
  });

  it('«biçimli tarih» deseni bekçinin «pencereden eski» kanıtındaki desenle AYNI metin (iki sorgu aynı satıra farklı yaş hükmü vermez)', async () => {
    await kos();
    const desenler = (sql: string): string[] => [...sql.matchAll(/\(data->>'olusturma'\) COLLATE "C" ~ '([^']+)'/g)].map(e => e[1]);
    const acik = [...new Set(desenler(acikSorgulari()[0].sql))];
    const sayim = [...new Set(desenler(sayimSorgulari()[0].sql))];
    expect(acik).toHaveLength(1);
    expect(sayim).toEqual(acik);
    expect(acik[0]).not.toContain('\\');
    const bicim = new RegExp(acik[0]);
    expect(bicim.test(new Date(0).toISOString())).toBe(true);
    for (const bozuk of ['', '0', '2020-bozuk', '2026-10-08T09:00:00Z', '2026-10-08T12:00:00.000+03:00']) expect(bicim.test(bozuk), JSON.stringify(bozuk)).toBe(false);
  });
});

describe('magaza_talep — panel ve takip sayaçları (AYRI okuyucular, AYRI parçalar)', () => {
  const parca = (detail: string, bas: string): string => String(detail.split(' · ').find(p => p.startsWith(bas)));

  it('üç okuyucu üç AYRI parçada: sıfırdan büyük sayaçlar adıyla, sıfırlar adetle; elle bildirim / kalem teslim / etiket sayaçları PANEL parçasında', async () => {
    vi.mocked(magazaPanelSayaclari).mockReturnValue({ ...SIFIR_PANEL, oturum: 3, kalemTeslimPanel: 4, kalemTeslimErp409: 1, etiketBasildi: 1, bildirimGonder: 2, bildirimGonder409: 6, cikisUidsiz: 1, r401: 9 });
    vi.mocked(magazaTakipSayaclari).mockReturnValue({ bulundu: 12, bulunamadi: 5 });
    const m = await kos();
    expect(m.ok).toBe(true);
    const uc = parca(m.detail, 'uç sayaçları');
    const panel = parca(m.detail, 'panel sayaçları');
    const takip = parca(m.detail, 'takip sayaçları');
    expect(panel).toBe('panel sayaçları (süreç başından beri) — panel oturumu: 3, kalem teslim (panel): 4, kalem teslim 409 (ERP): 1, etiket basıldı: 1, '
      + `elle bildirim: 2, elle bildirim 409: 6, ERP çıkışında panel iptali atlandı (oturum çerezi yok): 1, panel 401: 9; diğer ${PANEL_SAYAC_ADEDI - 8} sayaç 0`);
    expect(takip).toBe('takip sayaçları (süreç başından beri) — bulundu: 12, bulunamadı: 5');   // `silindi` taklitte yok: yalnız dönen anahtarlar yazılır
    // Dilim 1 parçası DEĞİŞMEZ ve panel / takip sayaçlarını taşımaz (`magazaSayaclari()` sabit on anahtarıyla kalır).
    expect(uc).toBe('uç sayaçları (süreç başından beri) — eklenen: 3, çakışan: 1, 400: 0, 403: 2, 404: 0, 413: 0, 415: 0, 429: 0, 500: 0, 503: 4');
    for (const ad of ['elle bildirim', 'kalem teslim', 'etiket', 'bulundu', 'oturum']) expect(uc, ad).not.toContain(ad);
    expect(takip).not.toContain('elle bildirim');
    expect(magazaSayaclari).toHaveBeenCalledTimes(1);
    expect(magazaPanelSayaclari).toHaveBeenCalledTimes(1);
    expect(magazaTakipSayaclari).toHaveBeenCalledTimes(1);
  });

  it('süreç başında (hepsi sıfır) parça yine yazılır ve sayaç ADEDİNİ söyler', async () => {
    const m = await kos();
    expect(parca(m.detail, 'panel sayaçları')).toBe(`panel sayaçları (süreç başından beri) — hepsi 0 (${PANEL_SAYAC_ADEDI} sayaç)`);
    // 2026-10-10: 26 (+ `yetkiKoduIptalDenetimsiz`). Dilim 2b (bilerek değişen çit, § 10.7): + 18 = 44 — elle revize bildirimi (2),
    // revize bildirimi isteği (2), içerik (6), silme panel / ERP + geri alma (6), elle talep (2). Takip: + `silindi` (2 → 3).
    expect(PANEL_SAYAC_ADEDI).toBe(44);
    expect(parca(m.detail, 'takip sayaçları')).toBe('takip sayaçları (süreç başından beri) — hepsi 0 (3 sayaç)');
  });

  it('okunamayan sayaç «—» yazılır (sıfır SAYILMAZ, «diğer N sayaç 0» adedine girmez); sonuç yeşil kalır', async () => {
    vi.mocked(magazaPanelSayaclari).mockReturnValue({ oturum: Number.NaN, yetkiKodu: -1, bildirimGonder: 1.5, etiketBasildi: 0 });
    const bozuk: unknown = { bulundu: '3', bulunamadi: null };
    vi.mocked(magazaTakipSayaclari).mockReturnValue(bozuk as Record<string, number>);
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(parca(m.detail, 'panel sayaçları')).toBe('panel sayaçları (süreç başından beri) — panel oturumu: —, yetki kodu: —, elle bildirim: —; diğer 1 sayaç 0');
    expect(parca(m.detail, 'takip sayaçları')).toBe('takip sayaçları (süreç başından beri) — bulundu: —, bulunamadı: —');
  });

  it('panel / takip sayaçları ne kadar büyük olursa olsun kırmızı YAPMAZ (yalnız bilgi; eşik kullanıcı kararı)', async () => {
    vi.mocked(magazaPanelSayaclari).mockReturnValue({ ...SIFIR_PANEL, oturum401: 9000, oturum503: 40, r401: 4200, r429: 800, r500: 12, r503: 77, durumPanel409: 31, cikisUidsiz: 600 });
    vi.mocked(magazaTakipSayaclari).mockReturnValue({ bulundu: 0, bulunamadi: 50_000 });
    expect((await kos()).ok).toBe(true);
  });

  it.each([
    ['panel sayaçları', () => vi.mocked(magazaPanelSayaclari)],
    ['takip sayaçları', () => vi.mocked(magazaTakipSayaclari)],
  ] as const)('%s okuyucusu fırlatırsa → KIRMIZI, ileti yazılmaz; öbür iki sayaç parçası yine yazılır', async (ad, okuyucu) => {
    okuyucu().mockImplementation(() => { throw new Error(`sayaç: ${GIZLI}`); });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail.startsWith(`${ad} okunamadı (Error)`)).toBe(true);
    expect(m.detail).not.toContain('AHMET');
    expect(m.detail).toContain('uç sayaçları (süreç başından beri)');
    expect(m.detail.split(' · ').filter(p => p.includes('sayaçları'))).toHaveLength(3);
  });

  it.each([['null', null], ['dizi', [1, 2]], ['sayı', 7], ['boş nesne', {}]] as const)(
    'okuyucu sayaç nesnesi dönmezse (%s) → KIRMIZI (sessizce «hepsi 0» yazılmaz)', async (_ad, deger) => {
      // Sözleşmeyi BOZAN bir okuyucu canlandırılıyor: değer bilerek tip dışı.
      const bozuk: unknown = deger;
      vi.mocked(magazaPanelSayaclari).mockReturnValue(bozuk as Record<string, number>);
      const m = await kos();
      expect(m.ok).toBe(false);
      expect(m.detail).toContain('panel sayaçları okunamadı (sayaç nesnesi dönmedi)');
      expect(m.detail).not.toContain('hepsi 0 (0 sayaç)');
    });

  it('etiket tablosunda OLMAYAN sayaç sessizce düşmez: ham adıyla yazılır; kod kimliği biçiminde olmayan ad ayrıntıya GİRMEZ («?»)', async () => {
    vi.mocked(magazaPanelSayaclari).mockReturnValue({ [`ad ${GIZLI}`]: 2, oturum: 1, yeniSayac2b: 4, toString: 3 });
    const m = await kos();
    expect(parca(m.detail, 'panel sayaçları')).toBe('panel sayaçları (süreç başından beri) — ?: 2, panel oturumu: 1, yeniSayac2b: 4, toString: 3');
    expect(m.detail).not.toContain('AHMET');
  });
});

describe('sayım SQL üreticisi — magazaTalepSayimSql (§ 6; kapı 3 K2, kapı 4 Y2)', () => {
  /**
   * Dilim 1'in (yayin-8) `MAGAZA_TALEP_SAYIM_SQL` metni, boşlukları teke indirilmiş + (inceleme 2b, bulgu 8 — bilerek değişen
   * çit) üç KIRMIZI sütunda silinmemiş koşulu. Çit gevşetilmedi: üretici çıktısı bu metne harfi harfine EŞİT kalır.
   */
  const ESKI = `COALESCE((data->>'olusturma') COLLATE "C" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' AND (data->>'olusturma') COLLATE "C" < $5, false)`;
  const SILINMEMIS = `jsonb_typeof(data->'silindi') IS DISTINCT FROM 'object'`;
  const DILIM1_SAYIM_SQL = `SELECT count(*)::int AS toplam, (count(*) FILTER (WHERE (data->>'olusturma') COLLATE "C" BETWEEN $2 AND $4))::int AS son24, `
    + `(count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'gonderilemedi' AND NOT ${ESKI} AND ${SILINMEMIS}))::int AS gonderilemedi, `
    + `(count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'yapilandirilmamis' AND NOT ${ESKI} AND ${SILINMEMIS}))::int AS yapilandirilmamis, `
    + `(count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'bekliyor' AND NOT COALESCE((data->>'olusturma') COLLATE "C" BETWEEN $3 AND $4, false) AND NOT ${ESKI} AND ${SILINMEMIS}))::int AS bekleyen, `
    + `(count(*) FILTER (WHERE data->'bildirim'->>'durum' IN ('gonderilemedi', 'yapilandirilmamis', 'bekliyor') AND ${ESKI}))::int AS eski_gitmeyen `
    + `FROM docs WHERE coll = $1`;

  it("`'bildirim'` çıktısı dilim 1'in sorgusu + üç kırmızı sütunda silinmemiş koşulu — tam metin (elle gönderim bekçinin sayımını değiştirmez)", () => {
    expect(magazaTalepSayimSql('bildirim').replace(/\s+/g, ' ').trim()).toBe(DILIM1_SAYIM_SQL);
  });

  it('(inceleme 2b, bulgu 8) silinmiş talep KIRMIZIYA sayılmaz: üç kırmızı sütunun üçü de silinmemiş koşulunu taşır — iki yolda da; `toplam` / `son24` / `eski_gitmeyen` taşımaz; ölçüt her yerdeki AYNI sabit', () => {
    expect(MAGAZA_SILINMEMIS_SQL).toBe(SILINMEMIS);
    for (const yol of ['bildirim', 'bildirimRevize'] as const) {
      const sql = magazaTalepSayimSql(yol).replace(/\s+/g, ' ').trim();
      const sutun = (ad: string): string => {
        const e = sql.match(new RegExp(`\\(count\\(\\*\\) FILTER \\(WHERE ((?:(?!::int AS).)*)\\)\\)::int AS ${ad}\\b`));
        expect(e, `${yol}.${ad}`).not.toBeNull();
        return e ? e[1] : '';
      };
      for (const ad of ['gonderilemedi', 'yapilandirilmamis', 'bekleyen']) expect(sutun(ad).endsWith(` AND ${SILINMEMIS}`), `${yol}.${ad}`).toBe(true);
      for (const ad of ['son24', 'eski_gitmeyen']) expect(sutun(ad), `${yol}.${ad}`).not.toContain('silindi');
      // Koşul tam ÜÇ kez (sütun başına bir); evren (`FROM docs WHERE coll = $1`) silinmişi DIŞLAMAZ — `toplam` koleksiyonun satır sayısıdır.
      expect(sql.split(SILINMEMIS), yol).toHaveLength(4);
      expect(sql.endsWith('FROM docs WHERE coll = $1'), yol).toBe(true);
      // `silindi` alanından okunan tek şey TÜRÜDÜR (zaman, kim, kanal sayıma girmez).
      expect(sql, yol).not.toMatch(/data->'silindi'->/);
    }
    // Bekçi ölçütü içe aktarır, kopyalamaz: üretim kodunda `jsonb_typeof(data->'silindi')` metni bekçide YAZILI DEĞİL.
    const bekciKodu = kodSatirlari(path.resolve(__dirname, 'opsWatchdog.ts')).map(s => s.kod).join('\n');
    expect(bekciKodu).toContain("import { MAGAZA_SILINMEMIS_SQL } from './kanal/magazaDurum.js';");
    expect(bekciKodu).not.toContain("jsonb_typeof(data->'silindi')");
  });

  it('«bekleyen» yaşı `olusturma`dan ölçülür: metinde `data->>\'olusturma\'` VAR, `bildirim.zaman` hiçbir koşulda YOK (elle gönderimin tazelediği zaman bekçiyi susturmaz)', () => {
    const sql = magazaTalepSayimSql('bildirim');
    expect(sql).toContain(`data->>'olusturma'`);
    expect(sql).not.toContain(`'bildirim'->>'zaman'`);
    expect(sql).not.toContain(`->>'zaman'`);
    expect(sql).not.toContain('icerikZamani');   // 2b'nin revize yaşı; 2a'da yok
    // `bildirim` yolundan okunan TEK alan `durum`dur.
    expect([...new Set([...sql.matchAll(/data->'bildirim'->>'([A-Za-z]+)'/g)].map(e => e[1]))]).toEqual(['durum']);
    expect(sql).not.toContain('bildirimRevize');   // ilk bildirim sorgusu revize alanına bakmaz
  });

  it("(2b) `'bildirimRevize'` çıktısı AYNI metnin `data->'bildirimRevize'` ve `icerikZamani` yaşıyla sürümü — iki yol TEK kalıptan (kopya sabit yok)", () => {
    const ilk = magazaTalepSayimSql('bildirim');
    const revize = magazaTalepSayimSql('bildirimRevize');
    // Kalıp aynı: ilk bildirim metninde yalnız iki parça değişir (alan yolu + yaş alanı).
    expect(revize).toBe(ilk.replaceAll(`data->'bildirim'->>`, `data->'bildirimRevize'->>`).replaceAll(`data->>'olusturma'`, `data->>'icerikZamani'`));
    expect(revize).not.toBe(ilk);
    // Sütun adları iki yolda AYNI (bekçi iki satırı aynı okuyucuyla okur).
    const sutunlar = (sql: string): string[] => [...sql.matchAll(/::int AS ([a-z0-9_]+)/g)].map(e => e[1]);
    expect(sutunlar(revize)).toEqual(['toplam', 'son24', 'gonderilemedi', 'yapilandirilmamis', 'bekleyen', 'eski_gitmeyen']);
    expect(sutunlar(revize)).toEqual(sutunlar(ilk));
    expect([...new Set(revize.match(/\$\d+/g))].sort()).toEqual(['$1', '$2', '$3', '$4', '$5']);
  });

  it('(2b; kapı 4, Y2) revize YAŞI `icerikZamani`dan ölçülür: `bildirimRevize.zaman` yaş sütunu olarak metinde YOK (işçinin her denemede tazelediği zaman bekçiyi susturmaz); `olusturma` da YOK', () => {
    const sql = magazaTalepSayimSql('bildirimRevize');
    expect(sql).toContain(`data->>'icerikZamani'`);
    expect(sql).not.toContain(`'bildirimRevize'->>'zaman'`);
    expect(sql).not.toContain(`->>'zaman'`);
    expect(sql).not.toContain('olusturma');
    // `bildirimRevize` yolundan okunan TEK alan `durum`dur (alan adları, revize eden, sürüm, deneme sayısı sayıma girmez).
    expect([...new Set([...sql.matchAll(/data->'bildirimRevize'->>'([A-Za-z]+)'/g)].map(e => e[1]))]).toEqual(['durum']);
    expect(sql).not.toContain(`data->'bildirim'->`);   // revize sorgusu ilk bildirim alanına bakmaz
    // Yaş alanının geçtiği yerler: son24 (1) + üç kırmızı sütunun «pencereden eski» kanıtı (2 × 3) + «bekleyen»in tazelik koşulu (1) + bilgi sütununun kanıtı (2).
    expect(sql.match(/data->>'icerikZamani'/g)).toHaveLength(10);
    expect(magazaTalepSayimSql('bildirim').match(/data->>'olusturma'/g)).toHaveLength(10);
  });

  it('dört dizgeden ÜÇÜ sayılır (`gitti` sayılmaz); dört değer dışında sütun / durum dizgesi yok — iki yolda da', () => {
    for (const yol of ['bildirim', 'bildirimRevize'] as const) {
      const sql = magazaTalepSayimSql(yol);
      const durumlar = [...new Set([...sql.matchAll(/'durum' (?:= |IN \()((?:'[a-z]+'(?:, )?)+)/g)].flatMap(e => e[1].match(/[a-z]+/g) ?? []))].sort();
      expect(durumlar, yol).toEqual(['bekliyor', 'gonderilemedi', 'yapilandirilmamis']);
      expect(sql, yol).not.toContain(`'gitti'`);
      expect(sql, yol).toContain(`'durum' IN ('gonderilemedi', 'yapilandirilmamis', 'bekliyor')`);
    }
  });
});

describe('sayaç etiketleri — ayrıntı ayraçlarıyla çakışmaz (dilim 2b: 18 yeni etiket)', () => {
  it('hiçbir etiket parça / sayaç / başlık ayracı taşımaz (« · », «, », «; », « — »): taşısaydı ayrıntı yanlış bölünürdü', () => {
    for (const [ad, etiket] of [...Object.entries(MAGAZA_PANEL_SAYAC_ETIKETLERI), ...Object.entries(MAGAZA_TAKIP_SAYAC_ETIKETLERI)]) {
      expect(etiket, ad).not.toMatch(/ · |, |; | — |: /);
    }
  });

  it('2b sayaçları adıyla yazılır: içerik / silme / geri alma / elle talep / revize bildirimi; takipte «silinmiş»', async () => {
    vi.mocked(magazaPanelSayaclari).mockReturnValue({
      ...SIFIR_PANEL, icerik: 5, icerikDegisiklikYok: 2, icerik409: 1, icerik503: 1, silPanel: 1, silErp: 2, silErp409: 1, geriAl: 1,
      elleTalep: 3, elleTalepCakisti: 1, revizeBildirimIstendi: 6, revizeBildirimIstenemedi: 1, bildirimGonderRevize: 1, bildirimGonderRevize409: 2,
    });
    vi.mocked(magazaTakipSayaclari).mockReturnValue({ bulundu: 4, bulunamadi: 1, silindi: 2 });
    const m = await kos();
    expect(m.ok).toBe(true);   // hepsi BİLGİ (eşik yok): 503 / istenemedi sayacı da kırmızı yapmaz
    const panel = String(m.detail.split(' · ').find(p => p.startsWith('panel sayaçları')));
    expect(panel).toBe('panel sayaçları (süreç başından beri) — elle revize bildirimi: 1, elle revize bildirimi 409: 2, revize bildirimi istendi: 6, '
      + 'revize bildirimi isteği BAŞARISIZ (isteyici reddetti): 1, içerik yazımı: 5, içerik (değişiklik yok): 2, içerik 409: 1, içerik 503 (ürün KDV oranı okunamadı): 1, '
      + `silme (panel): 1, silme (ERP): 2, silme 409 (ERP): 1, geri alma: 1, elle talep: 3, elle talep numara çakışması (503): 1; diğer ${PANEL_SAYAC_ADEDI - 14} sayaç 0`);
    // İlk bildirimin elle gönderim sayacı revize sayacından AYRI: revize artınca o sıfır kalır ve adıyla yazılmaz.
    expect(panel).not.toContain('elle bildirim:');
    expect(panel).not.toContain('elle bildirim 409:');
    expect(String(m.detail.split(' · ').find(p => p.startsWith('takip sayaçları')))).toBe('takip sayaçları (süreç başından beri) — bulundu: 4, bulunamadı: 1, silinmiş: 2');
  });
});

// Bekçi üç modülün DÖNÜŞ değerini metne çevirir; yukarıdaki testler o değerleri taklit eder.
// Gerçek gövdeler başka parçalarda yazılıyor: sözleşme kayarsa (sayaç anahtarı yeniden
// adlandırılır, eksik anahtar adı başka biçimde gelir) bekçi çökmez, ayrıntıya sessizce
// «—» / «?» yazar. Bu çitler gerçek modülle koşar; gövde hâlâ taslaksa (çağrılınca
// «uygulanmadı» fırlatıyorsa) ATLANIR — birleştirmeden sonra kendiliğinden devreye girer.
describe('gerçek modüllerle sözleşme (taslakken atlanır)', () => {
  const taslakMi = (cagir: () => unknown): boolean => {
    try { cagir(); return false; } catch (e) { return e instanceof Error && e.message === 'uygulanmadı'; }
  };

  it('gerçek magazaSayaclari(): her sayaç ayrıntıda sayıyla görünür, hiçbiri dışarıda kalmaz', async ({ skip }) => {
    const gercek = await vi.importActual<typeof import('./routes/magazaRoutes')>('./routes/magazaRoutes.js');
    skip(taslakMi(() => gercek.magazaSayaclari()), 'magazaSayaclari() henüz taslak');
    const sayaclar = gercek.magazaSayaclari();
    vi.mocked(magazaSayaclari).mockReturnValue(sayaclar);
    const m = await kos();
    const bolum = m.detail.split(' · ').find(p => p.startsWith('uç sayaçları'));
    expect(bolum).toBeDefined();
    const yazilan = String(bolum).split(' — ')[1].split(', ');
    expect(yazilan.join(', ')).not.toContain('—');                       // bekçinin beklediği her anahtar gerçekte var
    expect(yazilan).toHaveLength(Object.keys(sayaclar).length);          // gerçekteki her anahtar bekçide yazılıyor
  });

  it('gerçek magazaPanelSayaclari(): anahtar kümesi bekçinin etiket tablosuyla EŞİT (yeni / yeniden adlandırılan sayaç burada kırılır); hepsi sayı', async () => {
    const gercek = await vi.importActual<typeof import('./routes/magazaPanelZinciri')>('./routes/magazaPanelZinciri.js');
    const sayaclar = gercek.magazaPanelSayaclari();
    expect(Object.keys(sayaclar).sort()).toEqual(Object.keys(MAGAZA_PANEL_SAYAC_ETIKETLERI).sort());
    expect(Object.keys(sayaclar).sort()).toEqual(Object.keys(SIFIR_PANEL).sort());   // bu dosyanın taklidi de gerçek kümeyle aynı
    for (const [ad, deger] of Object.entries(sayaclar)) expect(Number.isInteger(deger) && deger >= 0, ad).toBe(true);
    // § 6'nın saydığı sayaçların hepsi PANEL kümesinde: oturum, yetki kodu, aşama, kalem teslim, etiket, elle bildirim, çıkış atlaması, panel retleri.
    for (const ad of ['oturum', 'yetkiKodu', 'durumPanel', 'durumErp', 'kalemTeslimPanel', 'kalemTeslimErp', 'etiketBasildi', 'bildirimGonder', 'cikisUidsiz', 'r401', 'r404', 'r429']) {
      expect(Object.hasOwn(sayaclar, ad), ad).toBe(true);
    }
    // § 10.7'nin saydığı 2b sayaçları da PANEL kümesinde: içerik (tamam / değişiklik yok / 409 / 400 / 503), silme (panel ve ERP
    // ayrı; tamam / 409), geri alma, elle talep (tamam / çakışma), revize bildirimi isteği (istendi / istenemedi) ve elle revize
    // bildirimi (`bildirimGonderRevize` — TEK yazım; `revizeBildirimGonder` adı YOK). Revize, ilk bildirim sayaçlarına KARIŞMAZ.
    for (const ad of ['icerik', 'icerikDegisiklikYok', 'icerik409', 'icerik400', 'icerik503', 'silPanel', 'silPanel409', 'silErp', 'silErp409', 'geriAl',
      'elleTalep', 'elleTalepCakisti', 'revizeBildirimIstendi', 'revizeBildirimIstenemedi', 'bildirimGonderRevize', 'bildirimGonderRevize409']) {
      expect(Object.hasOwn(sayaclar, ad), ad).toBe(true);
    }
    expect(Object.keys(sayaclar).filter(ad => /^revizeBildirimGonder/.test(ad))).toEqual([]);
    expect(MAGAZA_PANEL_SAYAC_ETIKETLERI.bildirimGonderRevize).not.toBe(MAGAZA_PANEL_SAYAC_ETIKETLERI.bildirimGonder);
    // Her etiket ayrı (iki sayaç ayrıntıda aynı adla görünmez) ve boş değil.
    const etiketler = Object.values(MAGAZA_PANEL_SAYAC_ETIKETLERI);
    expect(new Set(etiketler).size).toBe(etiketler.length);
    expect(etiketler.every(e => e.trim() !== '')).toBe(true);
    // Gerçek değerle koşu: her sayaç ayrıntıda görünür (süreç başında «hepsi 0» + adet; test sırasına göre sıfırdan büyük olanlar adıyla).
    vi.mocked(magazaPanelSayaclari).mockReturnValue(Object.fromEntries(Object.keys(sayaclar).map(ad => [ad, 1])));
    const m = await kos();
    const bolum = String(m.detail.split(' · ').find(p => p.startsWith('panel sayaçları')));
    expect(bolum.split(' — ')[1].split(', ')).toHaveLength(Object.keys(sayaclar).length);
    for (const ad of Object.keys(sayaclar)) expect(bolum, ad).toContain(`${MAGAZA_PANEL_SAYAC_ETIKETLERI[ad]}: 1`);
  });

  it('gerçek magazaTakipSayaclari(): anahtar kümesi etiket tablosuyla EŞİT; `magazaSayaclari()` (dilim 1) panel / takip anahtarı TAŞIMAZ', async () => {
    const gercek = await vi.importActual<typeof import('./routes/magazaRoutes')>('./routes/magazaRoutes.js');
    const takip = gercek.magazaTakipSayaclari();
    expect(Object.keys(takip).sort()).toEqual(Object.keys(MAGAZA_TAKIP_SAYAC_ETIKETLERI).sort());
    expect(Object.keys(takip).sort()).toEqual(Object.keys(SIFIR_TAKIP).sort());
    // Dilim 1'in sabit on anahtarı (`SIFIR_SAYACLAR` çiti magazaRoutes.test.ts'te): yeni sayaçlar ona EKLENMEDİ.
    expect(Object.keys(gercek.magazaSayaclari()).sort()).toEqual(Object.keys(TAM_SAYACLAR).sort());
    const panel = await vi.importActual<typeof import('./routes/magazaPanelZinciri')>('./routes/magazaPanelZinciri.js');
    const ortak = Object.keys(panel.magazaPanelSayaclari()).filter(ad => Object.hasOwn(takip, ad));
    expect(ortak).toEqual([]);   // takip sayaçları panel kümesinde de tutulmuyor (üç AYRI küme)
  });

  it('gerçek smtpYapilandirmasi (yarım kimlik): eksik anahtar adlarının hepsi ayrıntıya ADIYLA yazılır («?» olmaz)', async ({ skip }) => {
    const gercek = await vi.importActual<typeof import('./smtpPosta')>('./smtpPosta.js');
    skip(taslakMi(() => gercek.smtpYapilandirmasi({})), 'smtpYapilandirmasi() henüz taslak');
    // Boş ortam artık YEREL kip (tamam); eksik üretmek için yarım kimlik. Gerçek ortam değişkeni OKUNMAZ, kendi adresleri sabit.
    const yapi = gercek.smtpYapilandirmasi({ SMTP_USER: 'u' }, []);
    expect(yapi.tamam).toBe(false);
    expect(yapi.eksik.length).toBeGreaterThan(0);
    vi.mocked(smtpYapilandirmasi).mockReturnValue(yapi);
    const m = await kos();
    expect(m.detail).toContain(`SMTP yapılandırılmamış — eksik: ${yapi.eksik.join(', ')}`);
    expect(smtpDogrula).not.toHaveBeenCalled();
  });
});

describe('bekçi kaynak çitleri', () => {
  const oku = (goreli: string) => fs.readFileSync(path.resolve(__dirname, goreli), 'utf8');

  it('sabit kontrol SAYISI iddiası yok; ölçüm komutu iki dosyada da duruyor', () => {
    for (const dosya of ['opsWatchdog.ts', 'routes/opsRoutes.ts']) {
      const kaynak = oku(dosya);
      expect(kaynak, dosya).not.toMatch(/\d+\s+kontrol\b/i);
      expect(kaynak, dosya).toContain(`grep -oE "add\\('[a-z_]+'" src/server/opsWatchdog.ts | sort -u | wc -l`);
    }
  });

  it('«yazıldı ama bağlanmadı»: server.ts bekçiye site paneli yapılandırmasını panelin gördüğü AYNI tanımlayıcılardan verir', () => {
    // Kaynak, yorumlar süzülerek okunur (yorumdaki bir örnek çiti doyurmasın).
    const sunucu = kodSatirlari(path.resolve(__dirname, '../../server.ts')).map(k => k.kod);
    const metin = sunucu.join('\n');
    // Bekçi bağlamı: iki varlık da panelin tanımlayıcılarından okunur (ortamdan yeniden türetme YOK).
    const bag = sunucu.filter(k => k.includes('magazaPanelYapilandirmasi:'));
    expect(bag).toHaveLength(1);
    expect(bag[0].trim()).toBe('magazaPanelYapilandirmasi: () => ({ anahtarVar: magazaPanelAnahtari !== null, donusVar: magazaPanelDonusTabani !== null }),');
    const init = metin.slice(metin.indexOf('initOpsWatchdog({'));
    expect(init.slice(0, init.indexOf('});'))).toContain('magazaPanelYapilandirmasi:');
    // İki tanımlayıcı TEK kez ve ortak sözleşme işlevleriyle çözülür …
    expect(sunucu.filter(k => /^const magazaPanelDonusTabani = donusTabaniCoz\(/.test(k))).toHaveLength(1);
    expect(sunucu.filter(k => /^const magazaPanelAnahtari = panelAnahtariTuret\(/.test(k))).toHaveLength(1);
    // … ve panel zincirine giden anahtar ile yetki kodu ucuna giden dönüş adresi AYNI tanımlayıcılardır.
    expect(metin).toMatch(/panelAnahtari: magazaPanelAnahtari\b/);
    expect(metin).toMatch(/panelDonus: [^,\n]*\bmagazaPanelDonusTabani\b/);
    // Bekçide ortam değişkeninden ikinci bir türetme yok.
    const bekci = kodSatirlari(path.resolve(__dirname, 'opsWatchdog.ts')).map(k => k.kod).join('\n');
    for (const yasak of ['MAGAZA_PANEL_DONUS', 'SESSION_TOKEN_SECRET', 'donusTabaniCoz', 'panelAnahtariTuret']) {
      // Ayrıntı İLETİSİNDE ortam değişkeninin ADI geçer (operatöre yol); OKUMA (`process.env.X`) geçmez.
      expect(bekci, yasak).not.toContain(`process.env.${yasak}`);
      expect(bekci, yasak).not.toMatch(new RegExp(`\\b${yasak}\\(`));
    }
    expect(bekci).toContain('deps().magazaPanelYapilandirmasi()');
  });

  it('dilim 1\'in «dilim 2» diye ertelediği atıf bekçide KALMADI: «Yeniden gönder» artık var ve yorum onu gösterir', () => {
    const kaynak = oku('opsWatchdog.ts');
    expect(kaynak).not.toContain('«yeniden kuyruğa al» dilim 2');
    expect(kaynak).not.toMatch(/kapatacak yol yok/);
    expect(kaynak).toContain('/api/magaza-talepleri/:id/bildirim-gonder');
    // Ertelenmiş «dilim 2» atfı kalmadı: bekçideki her «dilim 2» anması «dilim 2a» ya da «dilim 2b» (yapılmış iş) biçimindedir.
    expect(kaynak.match(/dilim 2(?![ab])/gi) ?? []).toEqual([]);
  });

  it('bekçinin içe aktardığı mağaza modüllerinden bekçiye ya da server.ts\'e geri yol yok (döngü yok)', () => {
    const coz = (kimden: string, hedef: string): string | null => {
      if (!hedef.startsWith('.')) return null;
      const taban = path.resolve(path.dirname(kimden), hedef.replace(/\.js$/, ''));
      for (const uzanti of ['.ts', '.tsx', '/index.ts']) if (fs.existsSync(taban + uzanti)) return taban + uzanti;
      return null;
    };
    const komsular = (dosya: string): string[] => {
      const kaynak = fs.readFileSync(dosya, 'utf8');
      const hedefler = [
        // Değer içe / dışa aktarımları; `import type …` derlemede silinir, sayılmaz.
        ...[...kaynak.matchAll(/^\s*(?:import|export)\s+(?!type\s)[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(e => e[1]),
        ...[...kaynak.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map(e => e[1]),
        ...[...kaynak.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(e => e[1]),
      ];
      return hedefler.map(h => coz(dosya, h)).filter((y): y is string => y !== null);
    };
    const erisilen = (baslangic: string): Set<string> => {
      const gorulen = new Set<string>();
      const yigin = [baslangic];
      for (let d = yigin.pop(); d !== undefined; d = yigin.pop()) {
        if (gorulen.has(d)) continue;
        gorulen.add(d);
        yigin.push(...komsular(d));
      }
      return gorulen;
    };
    const bekci = path.resolve(__dirname, 'opsWatchdog.ts');
    const sunucu = path.resolve(__dirname, '../../server.ts');
    expect(fs.existsSync(sunucu)).toBe(true);
    // Yürüyücünün kendisi sınanır: bekçiyi GERÇEKTEN içe aktaran bir modülden bekçiye yol bulunmalı.
    expect(erisilen(path.resolve(__dirname, 'routes/opsRoutes.ts')).has(bekci)).toBe(true);
    // Bekçi bunları GERÇEKTEN içe aktarıyor (çit boş kümeyi sınamasın). Dilim 2a: panel sayaçları ve açık talep sayımı da;
    // dilim 2b: bildirim durumu kümesinin tek tanımı (`kanal/magazaBildirimSayim.ts`); inceleme 2b (bulgu 8): «silinmemiş»
    // ölçütünün tek sabiti (`kanal/magazaDurum.ts` — açık sayımı üzerinden zaten dolaylı erişiliyordu, artık doğrudan da).
    const dogrudan = komsular(bekci);
    for (const modul of ['smtpPosta.ts', 'routes/magazaRoutes.ts', 'routes/magazaPanelZinciri.ts', 'kanal/magazaAcikSayim.ts', 'kanal/magazaBildirimSayim.ts', 'kanal/magazaDurum.ts']) {
      const yol = path.resolve(__dirname, modul);
      expect(dogrudan, modul).toContain(yol);
      const ulasilan = erisilen(yol);
      expect(ulasilan.has(bekci), `${modul} → opsWatchdog.ts`).toBe(false);
      expect(ulasilan.has(sunucu), `${modul} → server.ts`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magaza_talep — SMTP kipleri (2026-10-09)', () => {
  it('kapalı kip (MAGAZA_BILDIRIM=kapali): YEŞİL, doğrulama çağrılmaz, metin kapalı der', async () => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: [], kip: 'kapali' });
    const m = await kos();
    expect(m.ok).toBe(true);
    expect(m.detail).toContain('bildirim KAPALI (MAGAZA_BILDIRIM=kapali)');
    expect(m.detail).not.toContain('SMTP yapılandırılmamış');
    expect(smtpDogrula).not.toHaveBeenCalled();
  });

  it('kapalı kipte `yapilandirilmamis` sayımı KIRMIZI YAPMAZ (bilgi); yerel / kimlikli kipte aynı sayım kırmızı; gonderilemedi kapalıyken de kırmızı', async () => {
    durum.havuz = sahteHavuz({ sayim: { ...TEMIZ_SAYIM, yapilandirilmamis: 3 } });
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: [], kip: 'kapali' });
    const kapali = await kos();
    expect(kapali.ok).toBe(true);
    expect(kapali.detail).toContain('yapılandırılmamış 3 (kapalı kip, bilgi)');
    for (const kip of ['yerel', 'kimlikli'] as const) {
      vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: true, eksik: [], kip });
      const m = await kos();
      expect(m.ok, kip).toBe(false);
      expect(m.detail).not.toContain('(kapalı kip, bilgi)');
    }
    durum.havuz = sahteHavuz({ sayim: { ...TEMIZ_SAYIM, gonderilemedi: 1 } });
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: [], kip: 'kapali' });
    expect((await kos()).ok).toBe(false);
  });

  it('yerel kip hazır: metin teslim sondasını anar (kimlik doğrulandı DEMEZ)', async () => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: true, eksik: [], kip: 'yerel' });
    vi.mocked(smtpDogrula).mockResolvedValue({ ok: true });
    const m = await kos();
    expect(m.detail).toContain('SMTP hazır — yerel kip');
    expect(m.detail).toContain('teslim sondası geçti');
    expect(m.detail).not.toContain('kimlik doğrulandı');
  });

  it.each([
    ['gonderen-reddi', 'Address spoofing'],
    ['alici-reddi', 'posta KUTUSU'],
    ['baglanti', '25 numaralı kapıda'],
  ] as const)('yerel kipte ret (%s): kırmızı + neden ve yol ipucu (%s); sır / adres değeri yok', async (sinif, ipucu) => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: true, eksik: [], kip: 'yerel' });
    vi.mocked(smtpDogrula).mockResolvedValue({ ok: false, sinif });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP doğrulaması BAŞARISIZ');
    expect(m.detail).toContain(ipucu);
    expect(m.detail).not.toMatch(/SMTP_PASS=|@gmail/);
  });

  it('kimlikli kipte aynı ret ipucu YAZILMAZ (yol MailEnable yerel teslimi için)', async () => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: true, eksik: [], kip: 'kimlikli' });
    vi.mocked(smtpDogrula).mockResolvedValue({ ok: false, sinif: 'gonderen-reddi' });
    const m = await kos();
    expect(m.detail).toContain('gönderen reddi (MAIL FROM)');
    expect(m.detail).not.toContain('Address spoofing');
  });

  it('eksik anahtar metni kipe göre yol gösterir', async () => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: ['SMTP_USER', 'SMTP_PASS'], kip: 'yerel' });
    expect((await kos()).detail).toContain('yerel kip: APP_URL https olmalı, SMTP_HOST yalnız bu makine olabilir');
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: ['SMTP_PASS'], kip: 'kimlikli' });
    expect((await kos()).detail).toContain('yarım kimlik: ikisini de doldurun ya da ikisini de silin');
  });
});
