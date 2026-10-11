// @vitest-environment node
/**
 * /api/ops/summary → `magazaBildirim` bloğu (K7, 2026-10-09): kip + eksik anahtar ADLARI + son 7 gün sayımı.
 * Çit: blok kendi try'ında — havuz yok / sorgu düşer / alakasız satır → `sayim: null`, özet 200 kalır; kişisel veri sızmaz.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

vi.mock('../smtpPosta.js', () => ({ smtpYapilandirmasi: vi.fn(() => ({ tamam: true, eksik: [], kip: 'yerel' })) }));
vi.mock('../mikroClient.js', () => ({ MIKRO_API_BASE: 'x', MIKRO_JUMP_SURUM: 17, MIKRO_LOCAL_MODE: false, getMikroCreds: async () => null, mikroSql: async () => [] }));
vi.mock('../saatTanisi.js', () => ({ saatTanisi: async () => ({}) }));
vi.mock('../opsWatchdog.js', () => ({ runOpsWatchdog: vi.fn(), diskNobetcisi: vi.fn() }));
vi.mock('../opsJeton.js', () => ({ opsJetonuGecerli: () => true }));
vi.mock('../pgShim.js', () => ({ broadcastDocChange: vi.fn() }));

import { smtpYapilandirmasi } from '../smtpPosta.js';
import { opsRoutes } from './opsRoutes.js';

const GIZLI = 'Zeynep Kaya 0532 111 22 33';

async function ozet(pool: { query: (sql: string, p: unknown[]) => Promise<{ rows: unknown[] }> } | null): Promise<{ durum: number; govde: Record<string, unknown> }> {
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

beforeEach(() => { vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: true, eksik: [], kip: 'yerel' }); });

describe('/api/ops/summary — magazaBildirim bloğu', () => {
  it('havuz varken: kip, eksik, pencere ve sayım; alakasız sütunlar ve metin yanıta girmez', async () => {
    // Dilim 2b (bilerek değişen çit, § 10.7 (b) / § 10.8): satır revize sütunlarını da taşır; `sayim` `revize: { durum, hataSinifi }` kazanır.
    const satir: Record<string, unknown> = {
      toplam: 3, durum_bekliyor: 0, durum_gitti: 2, durum_gonderilemedi: 1, durum_yapilandirilmamis: 0,
      revize_durum_bekliyor: 1, revize_durum_gitti: 4, revize_durum_gonderilemedi: 0, revize_durum_yapilandirilmamis: 2,
      hata_metni: GIZLI, revize_alanlar: GIZLI,
    };
    for (const s of ['kimlik', 'tls', 'baglanti', 'gonderen_reddi', 'alici_reddi', 'diger']) {
      satir[`sinif_${s}`] = s === 'gonderen_reddi' ? 1 : 0;
      satir[`revize_sinif_${s}`] = s === 'tls' ? 3 : 0;
    }
    const { durum, govde } = await ozet({ query: async () => ({ rows: [satir] }) });
    expect(durum).toBe(200);
    expect(govde.magazaBildirim).toEqual({
      kip: 'yerel', eksik: [], pencereGun: 7,
      sayim: {
        toplam: 3, durum: { bekliyor: 0, gitti: 2, gonderilemedi: 1, yapilandirilmamis: 0 }, hataSinifi: { kimlik: 0, tls: 0, baglanti: 0, 'gonderen-reddi': 1, 'alici-reddi': 0, diger: 0 },
        revize: { durum: { bekliyor: 1, gitti: 4, gonderilemedi: 0, yapilandirilmamis: 2 }, hataSinifi: { kimlik: 0, tls: 3, baglanti: 0, 'gonderen-reddi': 0, 'alici-reddi': 0, diger: 0 } },
      },
    });
    expect(JSON.stringify(govde)).not.toContain('Zeynep');
    expect(JSON.stringify(govde)).not.toContain('revize_alanlar');
  });

  it('(2b) revize sütunları OLMAYAN satır (2a biçimi) → sayım null: ilk bildirim sayıları «revize sıfır» diye tamamlanmaz', async () => {
    const satir: Record<string, unknown> = { toplam: 3, durum_bekliyor: 0, durum_gitti: 2, durum_gonderilemedi: 1, durum_yapilandirilmamis: 0 };
    for (const s of ['kimlik', 'tls', 'baglanti', 'gonderen_reddi', 'alici_reddi', 'diger']) satir[`sinif_${s}`] = 0;
    const { durum, govde } = await ozet({ query: async () => ({ rows: [satir] }) });
    expect(durum).toBe(200);
    expect(govde.magazaBildirim).toEqual({ kip: 'yerel', eksik: [], pencereGun: 7, sayim: null });
  });

  it('havuz yokken sayım null, özet 200; eksik anahtar ADLARI geçer, değer geçmez', async () => {
    vi.mocked(smtpYapilandirmasi).mockReturnValue({ tamam: false, eksik: ['SMTP_PASS'], kip: 'kimlikli' });
    const { durum, govde } = await ozet(null);
    expect(durum).toBe(200);
    expect(govde.magazaBildirim).toEqual({ kip: 'kimlikli', eksik: ['SMTP_PASS'], pencereGun: 7, sayim: null });
  });

  it('sorgu alakasız / boş satır dönerse sayım null, özet yine 200 (mevcut ops testlerinin havuz taklitleri)', async () => {
    expect((await ozet({ query: async () => ({ rows: [] }) })).govde.magazaBildirim).toMatchObject({ sayim: null });
    expect((await ozet({ query: async () => ({ rows: [{ dilim: 'Europe/Istanbul', simdi: 'x' }] }) })).govde.magazaBildirim).toMatchObject({ sayim: null });
  });

  it('yapılandırma okuyucusu fırlatırsa blok «okunamadi» der, özet 200; hata metni sızmaz', async () => {
    vi.mocked(smtpYapilandirmasi).mockImplementation(() => { throw new Error(`okunamadı: ${GIZLI}`); });
    const { durum, govde } = await ozet(null);
    expect(durum).toBe(200);
    expect(govde.magazaBildirim).toEqual({ kip: null, eksik: [], pencereGun: 7, sayim: null, hata: 'okunamadi' });
    expect(JSON.stringify(govde)).not.toContain('Zeynep');
  });
});
