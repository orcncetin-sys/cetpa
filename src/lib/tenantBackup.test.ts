import { describe, it, expect } from 'vitest';
import { yedekPlani, remoteGecerliMi, VARSAYILAN_SAKLAMA_GUN } from './tenantBackup';

const TS = '2026-08-21T09-00-00';

describe('remoteGecerliMi', () => {
  it('geçerli biçimleri kabul eder', () => {
    expect(remoteGecerliMi('gdrive:cetpa')).toBe(true);
    expect(remoteGecerliMi('musteri-a:')).toBe(true); // kök dizin
  });
  it('geçersizleri reddeder', () => {
    for (const v of [undefined, '', '   ', 'gdrive', ':yol']) {
      expect(remoteGecerliMi(v as string)).toBe(false);
    }
  });
});

describe('yedekPlani', () => {
  it('kurulum yapılmamış kiracıyı SEBEBİYLE atlar', () => {
    const r = yedekPlani({ companyId: 'firma-1' }, TS);
    expect(r).toEqual({ atla: 'kurulum-yok' });
  });

  it('devre dışı kiracıyı ayrı sebeple atlar', () => {
    const r = yedekPlani({ companyId: 'f', rcloneRemote: 'g:y', enabled: false }, TS);
    expect(r).toEqual({ atla: 'devre-disi' });
  });

  it('geçerli ayardan plan üretir', () => {
    const r = yedekPlani({ companyId: 'firma-1', rcloneRemote: 'gdrive:yedek' }, TS);
    expect('plan' in r).toBe(true);
    if (!('plan' in r)) return;
    expect(r.plan.remote).toBe('gdrive:yedek');
    expect(r.plan.retentionDays).toBe(VARSAYILAN_SAKLAMA_GUN);
    expect(r.plan.dbDosyaAdi).toBe(`cetpa_firma-1_${TS}.ndjson.gz`);
  });

  it('companyId dosya adında GÜVENLİ hale getirilir (yol kaçışı olmasın)', () => {
    const r = yedekPlani({ companyId: '../../etc/passwd', rcloneRemote: 'g:y' }, TS);
    if (!('plan' in r)) throw new Error('plan bekleniyordu');
    expect(r.plan.dbDosyaAdi).not.toContain('/');
    expect(r.plan.dbDosyaAdi).not.toContain('..');
    expect(r.plan.uploadsDosyaAdi).not.toContain('/');
  });

  it('özel saklama süresi geçerliyse kullanılır, geçersizse varsayılana düşer', () => {
    const a = yedekPlani({ companyId: 'f', rcloneRemote: 'g:y', retentionDays: 7 }, TS);
    const b = yedekPlani({ companyId: 'f', rcloneRemote: 'g:y', retentionDays: 0 }, TS);
    if (!('plan' in a) || !('plan' in b)) throw new Error('plan bekleniyordu');
    expect(a.plan.retentionDays).toBe(7);
    expect(b.plan.retentionDays).toBe(VARSAYILAN_SAKLAMA_GUN);
  });

  it('iki farklı kiracı ASLA aynı dosya adını üretmez', () => {
    const a = yedekPlani({ companyId: 'firma-a', rcloneRemote: 'g:y' }, TS);
    const b = yedekPlani({ companyId: 'firma-b', rcloneRemote: 'g:y' }, TS);
    if (!('plan' in a) || !('plan' in b)) throw new Error('plan bekleniyordu');
    expect(a.plan.dbDosyaAdi).not.toBe(b.plan.dbDosyaAdi);
  });
});
