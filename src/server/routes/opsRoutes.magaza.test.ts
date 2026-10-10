// @vitest-environment node
/**
 * /api/ops/summary → `magaza` bloğu (dilim 2a, § 6): açık talep sayımı (bekçiyle AYNI sorgu) + üç süreç içi sayaç kümesi
 * (dilim 1 uçları / panel + ERP uçları / takip sorgusu).
 *
 * Çitler: blok jeton kapısının ARKASINDA; her okuma kendi yakalayıcısında (biri düşerse o alan `null`, özet 200 kalır);
 * yanıta yalnız sayı ve kapalı küme anahtarı girer (kişisel veri, hata metni, sözleşme dışı değer sızmaz); mevcut
 * `magazaBildirim` bloğu DEĞİŞMEZ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';

vi.mock('../smtpPosta.js', () => ({ smtpYapilandirmasi: vi.fn(() => ({ tamam: true, eksik: [], kip: 'yerel' })) }));
vi.mock('../mikroClient.js', () => ({ MIKRO_API_BASE: 'x', MIKRO_JUMP_SURUM: 17, MIKRO_LOCAL_MODE: false, getMikroCreds: async () => null, mikroSql: async () => [] }));
vi.mock('../saatTanisi.js', () => ({ saatTanisi: async () => ({}) }));
vi.mock('../opsWatchdog.js', () => ({ runOpsWatchdog: vi.fn(), diskNobetcisi: vi.fn() }));
vi.mock('../opsJeton.js', () => ({ opsJetonuGecerli: vi.fn(() => true) }));
vi.mock('../pgShim.js', () => ({ broadcastDocChange: vi.fn() }));
vi.mock('./magazaRoutes.js', () => ({ magazaSayaclari: vi.fn(), magazaTakipSayaclari: vi.fn() }));
vi.mock('./magazaPanelZinciri.js', () => ({ magazaPanelSayaclari: vi.fn() }));

import { opsJetonuGecerli } from '../opsJeton.js';
import { magazaSayaclari, magazaTakipSayaclari } from './magazaRoutes.js';
import { magazaPanelSayaclari } from './magazaPanelZinciri.js';
import { MAGAZA_ACIK_SAYIM_SQL } from '../kanal/magazaAcikSayim';
import { opsRoutes } from './opsRoutes.js';

const GIZLI = 'Zeynep Kaya 0532 111 22 33';
const ACIK_SATIRI = { acik: 7, asama_yeni: 2, asama_teyit: 1, asama_hazirlaniyor: 3, asama_sevk: 1, asama_bilinmiyor: 0, tarihsiz: 0, en_eski: '2026-10-05T09:00:00.000Z' };
const ACIK = { toplam: 7, asama: { yeni: 2, teyit: 1, hazirlaniyor: 3, sevk: 1, bilinmiyor: 0 }, tarihsiz: 0, enEski: '2026-10-05T09:00:00.000Z' };
const UC = { eklenen: 3, cakisan: 1, r400: 0, r403: 2, r404: 0, r413: 0, r415: 0, r429: 0, r500: 0, r503: 4 };
const PANEL = { oturum: 2, oturum401: 1, kalemTeslimPanel: 5, bildirimGonder: 1, etiketBasildi: 3, r401: 7 };
const TAKIP = { bulundu: 12, bulunamadi: 5 };

type Havuz = { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
const sorgular: string[] = [];
/** Açık sayım sorgusuna `acik` satırını (ya da hatayı), öbür her sorguya boş satır döndüren havuz. */
function havuz(acik: Record<string, unknown> | Error | null = ACIK_SATIRI): Havuz {
  return {
    query: async (sql) => {
      sorgular.push(sql);
      if (sql !== MAGAZA_ACIK_SAYIM_SQL) return { rows: [] };
      if (acik instanceof Error) throw acik;
      return { rows: acik === null ? [] : [acik] };
    },
  };
}

async function ozet(pool: Havuz | null): Promise<{ durum: number; govde: Record<string, unknown> }> {
  const app = express();
  opsRoutes(app, {
    requireAuth: (_q: unknown, _s: unknown, n: () => void) => n(), requireSuperAdmin: (_q: unknown, _s: unknown, n: () => void) => n(), requireMfaVerified: (_q: unknown, _s: unknown, n: () => void) => n(),
    getAdminDb: () => null, getPgPool: () => pool,
  } as unknown as Parameters<typeof opsRoutes>[1]);
  const sunucu = app.listen(0);
  try {
    const { port } = sunucu.address() as AddressInfo;
    const yanit = await fetch(`http://127.0.0.1:${port}/api/ops/summary`, { headers: { 'X-Ops-Token': 'x' } });
    return { durum: yanit.status, govde: (await yanit.json()) as Record<string, unknown> };
  } finally {
    sunucu.close();
  }
}

beforeEach(() => {
  sorgular.length = 0;
  vi.mocked(opsJetonuGecerli).mockReset().mockReturnValue(true);
  vi.mocked(magazaSayaclari).mockReset().mockReturnValue(UC);
  vi.mocked(magazaPanelSayaclari).mockReset().mockReturnValue(PANEL);
  vi.mocked(magazaTakipSayaclari).mockReset().mockReturnValue(TAKIP);
});

describe('/api/ops/summary — magaza bloğu', () => {
  it('havuz varken: açık talep sayımı (toplam, aşama dağılımı, tarihsiz, en eski) + üç AYRI sayaç kümesi', async () => {
    const { durum, govde } = await ozet(havuz());
    expect(durum).toBe(200);
    expect(govde.magaza).toEqual({ acik: ACIK, sayaclar: { uc: UC, panel: PANEL, takip: TAKIP } });
    expect(sorgular.filter(s => s === MAGAZA_ACIK_SAYIM_SQL)).toHaveLength(1);   // bekçiyle AYNI sorgu, istek başına bir kez
  });

  it('mevcut `magazaBildirim` bloğu DEĞİŞMEZ: aynı dört alan, yanında yeni blok', async () => {
    const { govde } = await ozet(null);
    expect(govde.magazaBildirim).toEqual({ kip: 'yerel', eksik: [], pencereGun: 7, sayim: null });
    expect(Object.keys(govde)).toContain('magaza');
  });

  it('havuz yokken açık sayım `null` (uydurma sıfır yok); sayaçlar yine döner; özet 200', async () => {
    const { durum, govde } = await ozet(null);
    expect(durum).toBe(200);
    expect(govde.magaza).toEqual({ acik: null, sayaclar: { uc: UC, panel: PANEL, takip: TAKIP } });
  });

  it.each([
    ['sorgu fırlatır', Object.assign(new Error(`invalid input syntax for type json: "${GIZLI}"`), { code: '22P02', detail: GIZLI })],
    ['satır dönmez', null],
    ['satır okunamaz (sayı metin)', { ...ACIK_SATIRI, acik: '7' }],
    ['alakasız satır', { dilim: 'Europe/Istanbul', simdi: 'x' }],
  ] as const)('açık sayım okunamazsa (%s) `acik: null`; özet 200, sayaçlar yerinde, hata metni sızmaz', async (_ad, acik) => {
    const { durum, govde } = await ozet(havuz(acik));
    expect(durum).toBe(200);
    expect(govde.magaza).toEqual({ acik: null, sayaclar: { uc: UC, panel: PANEL, takip: TAKIP } });
    expect(JSON.stringify(govde)).not.toContain('Zeynep');
  });

  it('bir sayaç okuyucusu fırlatırsa YALNIZ o küme `null`; öbür ikisi ve açık sayım yerinde; hata metni sızmaz', async () => {
    vi.mocked(magazaPanelSayaclari).mockImplementation(() => { throw new Error(`sayaç: ${GIZLI}`); });
    const { durum, govde } = await ozet(havuz());
    expect(durum).toBe(200);
    expect(govde.magaza).toEqual({ acik: ACIK, sayaclar: { uc: UC, panel: null, takip: TAKIP } });
    expect(JSON.stringify(govde)).not.toContain('Zeynep');
  });

  it.each([['null', null], ['dizi', [1, 2]], ['dizge', 'sayaç'], ['sayı', 7]] as const)('okuyucu sayaç nesnesi dönmezse (%s) küme `null` (boş nesne DEĞİL)', async (_ad, deger) => {
    // Sözleşmeyi BOZAN bir okuyucu canlandırılıyor: değer bilerek tip dışı.
    const bozuk: unknown = deger;
    vi.mocked(magazaTakipSayaclari).mockReturnValue(bozuk as Record<string, number>);
    const { govde } = await ozet(null);
    expect((govde.magaza as { sayaclar: Record<string, unknown> }).sayaclar.takip).toBeNull();
  });

  it('yanıta YALNIZ kod kimliği biçimindeki anahtar ve eksi olmayan tam sayı girer: metin, kesir, eksi, NaN, iç içe nesne, tuhaf anahtar süzülür', async () => {
    const kirli: unknown = {
      oturum: 4, r401: 0, metin: GIZLI, kesir: 1.5, eksi: -1, nan: Number.NaN, ic: { musteri: GIZLI }, sayiMetni: '9',
      [`ad ${GIZLI}`]: 3, '9basta': 2, __proto__gibi: 5,
    };
    vi.mocked(magazaPanelSayaclari).mockReturnValue(kirli as Record<string, number>);
    const { govde } = await ozet(null);
    expect((govde.magaza as { sayaclar: Record<string, unknown> }).sayaclar.panel).toEqual({ oturum: 4, r401: 0 });
    expect(JSON.stringify(govde)).not.toContain('Zeynep');
  });

  it('jeton kapısı reddederse blok DÖNMEZ ve hiçbir mağaza okuması yapılmaz (blok kapının arkasında)', async () => {
    vi.mocked(opsJetonuGecerli).mockImplementation((_req, res) => { res.status(401).json({ error: 'yetkisiz' }); return false; });
    const { durum, govde } = await ozet(havuz());
    expect(durum).toBe(401);
    expect(govde).toEqual({ error: 'yetkisiz' });
    expect(sorgular).toEqual([]);
    expect(magazaSayaclari).not.toHaveBeenCalled();
    expect(magazaPanelSayaclari).not.toHaveBeenCalled();
    expect(magazaTakipSayaclari).not.toHaveBeenCalled();
  });
});

describe('opsRoutes.ts — magaza bloğu kaynak çitleri', () => {
  const kod = kodSatirlari(join(SRC_KOK, 'server', 'routes', 'opsRoutes.ts'));
  const no = (desen: RegExp): number[] => kod.filter(s => desen.test(s.kod)).map(s => s.n);

  it('mağaza okumaları YALNIZ `/api/ops/summary` işleyicisinde, jeton denetiminden SONRA ve bir sonraki rotadan ÖNCE', () => {
    const ozetRotasi = no(/app\.get\('\/api\/ops\/summary'/);
    expect(ozetRotasi).toHaveLength(1);
    const rotalar = no(/^\s*app\.(get|post|put|delete|patch)\(/);
    const sonraki = rotalar.find(n => n > ozetRotasi[0]);
    if (sonraki === undefined) throw new Error('özet rotasından sonra kayıtlı rota bulunamadı (çitin üst sınırı yok)');
    const jeton = no(/opsJetonuGecerli\(req, res, 'ops summary/);
    expect(jeton).toHaveLength(1);
    expect(jeton[0]).toBe(ozetRotasi[0] + 1);   // işleyicinin İLK satırı: kapıdan önce hiçbir okuma yok
    for (const desen of [/magazaAcikSayimi\(pool\)/, /sayacKumesi\(magazaSayaclari\)/, /sayacKumesi\(magazaPanelSayaclari\)/, /sayacKumesi\(magazaTakipSayaclari\)/]) {
      const yer = no(desen);
      expect(yer, String(desen)).toHaveLength(1);
      expect(yer[0], String(desen)).toBeGreaterThan(jeton[0]);
      expect(yer[0], String(desen)).toBeLessThan(sonraki);
    }
  });

  it('sayaç okuyucuları server.ts ve bekçiyle AYNI yoldan içe aktarılır (farklı yol = ikinci modül örneği = hep sıfır)', () => {
    const metin = kod.map(s => s.kod).join('\n');
    expect(metin).toContain(`import { magazaSayaclari, magazaTakipSayaclari } from './magazaRoutes.js';`);
    expect(metin).toContain(`import { magazaPanelSayaclari } from './magazaPanelZinciri.js';`);
    const bekci = kodSatirlari(join(SRC_KOK, 'server', 'opsWatchdog.ts')).map(s => s.kod).join('\n');
    expect(bekci).toContain(`import { magazaSayaclari, magazaTakipSayaclari } from './routes/magazaRoutes.js';`);
    expect(bekci).toContain(`import { magazaPanelSayaclari } from './routes/magazaPanelZinciri.js';`);
    const sunucu = kodSatirlari(join(SRC_KOK, '..', 'server.ts')).map(s => s.kod).join('\n');
    expect(sunucu).toMatch(/from "\.\/src\/server\/routes\/magazaRoutes\.js";/);
    expect(sunucu).toMatch(/from "\.\/src\/server\/routes\/magazaPanelZinciri\.js";/);
  });
});
