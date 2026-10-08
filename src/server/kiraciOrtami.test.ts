// @vitest-environment node
/**
 * kiraciOrtami.test.ts — sunucu kiracısının ortam okuyucusu (2026-10-08, mağaza dilim 1 inceleme turu).
 *
 * NEDEN VAR: `ortamdanKiraci` mağaza talep ucunun yazacağı kiracıyı (server.ts `serverTenantId`), açılış uyarısını ve bekçinin
 * «kiracı taramayla çözülüyor» kırmızısını besler; ama onu içe aktaran tek test (`opsWatchdog.magazaTalep.test.ts`) işlevi TAKLİT
 * ediyor, bağlama çiti de yalnız çağrı metnini arıyordu. Gövde `return '';` ya da yalnız `MIKRO_CRON_COMPANY_ID` okuyacak biçimde
 * bozulduğunda bütün paket yeşil kalıyordu (ölçüldü). Burada işlev GERÇEK gövdesiyle koşar; ortam nesnesi parametreyle verilir —
 * gerçek ortam yalnız son testte, `vi.stubEnv` ile okunur.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ortamdanKiraci } from './kiraciOrtami.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('ortamdanKiraci — sunucu kiracısının ortam okuyucusu', () => {
  it('öncelik: SERVER_TENANT_COMPANY_ID, MIKRO_CRON_COMPANY_ID değerinin önündedir', () => {
    expect(ortamdanKiraci({ SERVER_TENANT_COMPANY_ID: 'kiraci-a', MIKRO_CRON_COMPANY_ID: 'kiraci-b' })).toBe('kiraci-a');
  });

  it('SERVER_TENANT_COMPANY_ID yoksa / boşsa MIKRO_CRON_COMPANY_ID değerine düşer', () => {
    expect(ortamdanKiraci({ MIKRO_CRON_COMPANY_ID: 'kiraci-b' })).toBe('kiraci-b');
    expect(ortamdanKiraci({ SERVER_TENANT_COMPANY_ID: '', MIKRO_CRON_COMPANY_ID: 'kiraci-b' })).toBe('kiraci-b');
  });

  it('ikisi de yoksa boş dizge döner (tanımsız değil)', () => {
    expect(ortamdanKiraci({})).toBe('');
  });

  it('parametresiz çağrı process.env okur', () => {
    vi.stubEnv('SERVER_TENANT_COMPANY_ID', 'kiraci-ortam');
    vi.stubEnv('MIKRO_CRON_COMPANY_ID', '');
    expect(ortamdanKiraci()).toBe('kiraci-ortam');
  });
});
