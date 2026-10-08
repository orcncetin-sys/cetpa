// @vitest-environment node
/**
 * opsWatchdog.magazaTalep.test.ts — bekçinin `magaza_talep` kontrolü (mağaza dilim 1 şartnamesi § 6).
 *
 * Kontrol GERÇEK giriş noktasından (`runOpsWatchdog`) koşturulur: «yazıldı ama
 * bağlanmadı» sınıfı burada da yakalansın. Diğer kontrollerin dış dünyaya çıkan
 * yolları (ağ, TLS, PostgreSQL istemcisi, Resend) taklit edilir; hiçbir test
 * gerçek ağa çıkmaz.
 *
 * `smtpPosta` ve `magazaRoutes` taklittir: bekçinin sözleşmesi onların DÖNÜŞ
 * değerine karşı sınanır (gövdeleri başka parçalarda yazılıyor).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initOpsWatchdog, runOpsWatchdog, type OpsDeps } from './opsWatchdog';
import { smtpYapilandirmasi, smtpDogrula } from './smtpPosta.js';
import { magazaSayaclari } from './routes/magazaRoutes.js';
import { ortamdanKiraci } from './kiraciOrtami.js';
import {
  MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_TALEP_KOLEKSIYONU,
  type MagazaBildirimHataSinifi,
} from '../lib/magazaTalep';

vi.mock('./smtpPosta.js', () => ({ smtpYapilandirmasi: vi.fn(), smtpDogrula: vi.fn() }));
vi.mock('./routes/magazaRoutes.js', () => ({ magazaSayaclari: vi.fn() }));
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
const TAM_SAYACLAR = { eklenen: 3, cakisan: 1, r400: 0, r403: 2, r404: 0, r413: 0, r415: 0, r429: 0, r500: 0, r503: 4 };

interface HavuzAyari {
  /** Sayım sorgusunun tek satırı; `Error` ise sorgu fırlatır; `null` ise satır dönmez. */
  sayim?: Record<string, unknown> | Error | null;
  /** Kiracı eşleşme sorgusunun `n` hücresi; `Error` ise sorgu fırlatır. */
  eslesen?: unknown;
}
const sorgular: Array<{ sql: string; params: unknown[] }> = [];
function sahteHavuz(ayar: HavuzAyari = {}) {
  const sayim = 'sayim' in ayar ? ayar.sayim : TEMIZ_SAYIM;
  const eslesen = 'eslesen' in ayar ? ayar.eslesen : 1;
  return {
    query: async (sql: string, params: unknown[] = []) => {
      sorgular.push({ sql, params });
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
const sayimSorgulari = () => sorgular.filter(s => s.params[0] === MAGAZA_TALEP_KOLEKSIYONU);
const kiraciSorgulari = () => sorgular.filter(s => s.sql.includes("coll = 'users'"));

const durum: {
  havuz: ReturnType<typeof sahteHavuz> | null;
  havuzHatasi: Error | null;
  kiraci: string;
  kiraciHatasi: Error | null;
} = { havuz: null, havuzHatasi: null, kiraci: '', kiraciHatasi: null };

const BAGIMLILIKLAR: OpsDeps = {
  getPgPool: () => { if (durum.havuzHatasi) throw durum.havuzHatasi; return durum.havuz; },
  getAdminDb: () => null,
  pgServerTimestamp: () => 'taklit-zaman',
  getMikroCreds: async () => null,
  getCachedExchangeRates: () => null,
  getAiHealthProbe: () => null,
  serverTenantId: async () => { if (durum.kiraciHatasi) throw durum.kiraciHatasi; return durum.kiraci; },
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
  vi.mocked(smtpYapilandirmasi).mockReset().mockReturnValue({ tamam: true, eksik: [] });
  vi.mocked(smtpDogrula).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(magazaSayaclari).mockReset().mockReturnValue(TAM_SAYACLAR);
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
    expect(m.detail.split(' · ')).toHaveLength(4);   // kiracı · SMTP · sayım · uç sayaçları — başka parça yok (500 sayacı 0: kırmızı parça eklenmez)
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
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: ['SMTP_USER', 'SMTP_PASS'] });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP yapılandırılmamış — eksik: SMTP_USER, SMTP_PASS');
    expect(smtpDogrula).not.toHaveBeenCalled();
    // Bozuk parça başa yazılır: uyarı e-postasında ilk okunan yer neden olsun.
    expect(m.detail.startsWith('SMTP yapılandırılmamış')).toBe(true);
  });

  it('eksik deyip anahtar adı vermeyen yapılandırma okuyucu → yine KIRMIZI; bağlantı denenmez', async () => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: [] });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('SMTP yapılandırılmamış — eksik: anahtar adı bildirilmedi');
    expect(smtpDogrula).not.toHaveBeenCalled();
  });

  it('anahtar ADI biçiminde olmayan değer ayrıntıya GİRMEZ (değer sızmaz)', async () => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: ['SMTP_PASS=cok-gizli-parola', 'smtp_user', 'SMTP_HOST'] });
    const m = await kos();
    expect(m.ok).toBe(false);
    expect(m.detail).toContain('eksik: ?, ?, SMTP_HOST');
    expect(m.detail).not.toContain('cok-gizli-parola');
    expect(m.detail).not.toContain('smtp_user');
  });

  const ETIKET: Record<MagazaBildirimHataSinifi, string> = {
    kimlik: 'kimlik doğrulama', tls: 'TLS / sertifika', baglanti: 'bağlantı', 'alici-reddi': 'alıcı reddi', diger: 'diğer',
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

    vi.mocked(smtpYapilandirmasi).mockReset().mockReturnValue({ tamam: true, eksik: [] });
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
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'gonderilemedi' AND NOT ${PENCEREDEN_ESKI}))::int AS gonderilemedi`);
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'yapilandirilmamis' AND NOT ${PENCEREDEN_ESKI}))::int AS yapilandirilmamis`);
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE data->'bildirim'->>'durum' = 'bekliyor' AND NOT COALESCE((data->>'olusturma') COLLATE "C" BETWEEN $3 AND $4, false) AND NOT ${PENCEREDEN_ESKI}))::int AS bekleyen`);
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
    expect(m.detail.split(' · ')).toHaveLength(3);   // havuz · SMTP · uç sayaçları — olmayan havuzda sorgu DENENMEZ (ikinci bir hata parçası yok)
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
    expect(m.detail.split(' · ')).toHaveLength(5);   // 500 · kiracı · SMTP · sayım · uç sayaçları — kırmızı olan YALNIZ 500 parçası
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

// Bekçi iki modülün DÖNÜŞ değerini metne çevirir; yukarıdaki testler o değerleri taklit eder.
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

  it('gerçek smtpYapilandirmasi({}): eksik anahtar adlarının hepsi ayrıntıya ADIYLA yazılır («?» olmaz)', async ({ skip }) => {
    const gercek = await vi.importActual<typeof import('./smtpPosta')>('./smtpPosta.js');
    skip(taslakMi(() => gercek.smtpYapilandirmasi({})), 'smtpYapilandirmasi() henüz taslak');
    const yapi = gercek.smtpYapilandirmasi({});                          // boş ortam: gerçek ortam değişkeni OKUNMAZ
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
    // Bekçi bu ikisini GERÇEKTEN içe aktarıyor (çit boş kümeyi sınamasın).
    const dogrudan = komsular(bekci);
    for (const modul of ['smtpPosta.ts', 'routes/magazaRoutes.ts']) {
      const yol = path.resolve(__dirname, modul);
      expect(dogrudan, modul).toContain(yol);
      const ulasilan = erisilen(yol);
      expect(ulasilan.has(bekci), `${modul} → opsWatchdog.ts`).toBe(false);
      expect(ulasilan.has(sunucu), `${modul} → server.ts`).toBe(false);
    }
  });
});
