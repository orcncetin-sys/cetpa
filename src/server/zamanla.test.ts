/**
 * zamanla / isGunu — cron ifadeleri ve gün anahtarları sunucu dilimi ne olursa
 * olsun İstanbul takvimiyle.
 *
 * İki kanıt katmanı:
 *  1) mock: node-cron'a ifade AYNEN ve `timezone: 'Europe/Istanbul'` geçiliyor mu
 *     (mutasyon: seçenek düşerse ya da ifade sabitlenirse kırılır — bu Mac
 *     İstanbul'da olduğu için davranış testi tek başına ayırt edemezdi).
 *  2) alt süreç: TZ=America/Los_Angeles (canlı sunucunun dilimi, 2026-09-24
 *     ölçümü) altında GERÇEK sarmalayıcı (tsx ile) — bir sonraki koşu İstanbul
 *     08:30 mu, isGunu Pasifik'te "dün" olan anı İstanbul günüyle mi yazıyor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';

const { schedule } = vi.hoisted(() => ({ schedule: vi.fn(() => ({ stop: () => {}, destroy: () => {} })) }));
vi.mock('node-cron', () => ({ default: { schedule } }));

import { zamanla, isGunu, IS_SAAT_DILIMI } from './zamanla';

describe('zamanla — İstanbul takvimi', () => {
  beforeEach(() => schedule.mockClear());

  it("node-cron'a timezone: Europe/Istanbul geçer", () => {
    const is = () => {};
    zamanla('13 5 2 * *', is);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith('13 5 2 * *', is, { timezone: 'Europe/Istanbul' });
    expect(IS_SAAT_DILIMI).toBe('Europe/Istanbul');
  });

  it('ifadeyi OLDUĞU GİBİ geçer ve görev nesnesini döndürür', () => {
    const is = () => {};
    const t = zamanla('7 * * * *', is);
    expect(schedule).toHaveBeenCalledWith('7 * * * *', is, { timezone: 'Europe/Istanbul' });
    expect(typeof t.stop).toBe('function');
  });

  it('isGunu: UTC anını İstanbul gününe yazar (YYYY-MM-DD)', () => {
    expect(isGunu(new Date('2026-09-25T05:30:00.000Z'))).toBe('2026-09-25');   // 08:30 İstanbul
    expect(isGunu(new Date('2026-09-24T21:30:00.000Z'))).toBe('2026-09-25');   // 00:30 İstanbul — UTC'de hâlâ 24'ü
    expect(isGunu(new Date('2026-09-24T20:59:59.000Z'))).toBe('2026-09-24');
  });

  it('Pasifik dilimli süreçte GERÇEK sarmalayıcı: dilimli 08:30 İstanbul, dilimsiz DEĞİL; isGunu dünü değil bugünü yazar', () => {
    const betik = [
      "import cron from 'node-cron';",
      "import { zamanla, isGunu } from './src/server/zamanla.ts';",
      "const f = d => new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);",
      "const t = zamanla('30 8 * * *', () => {});",
      "const u = cron.schedule('30 8 * * *', () => {});",
      "const an = new Date('2026-09-25T05:30:00.000Z');",   // 08:30 İstanbul = 22:30 PDT 24 Eylül
      "console.log(JSON.stringify({ dilimli: f(t.getNextRun()), dilimsiz: f(u.getNextRun()), ofset: new Date().getTimezoneOffset(), isGunu: isGunu(an), surecGunu: an.getDate() }));",
      't.destroy(); u.destroy();',
    ].join('\n');
    const cikti = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', betik], {
      cwd: join(__dirname, '..', '..'),
      env: { ...process.env, TZ: 'America/Los_Angeles' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    const r = JSON.parse(cikti.trim().split('\n').pop() ?? '') as { dilimli: string; dilimsiz: string; ofset: number; isGunu: string; surecGunu: number };
    expect(r.ofset).toBeGreaterThan(0);          // süreç gerçekten UTC'nin batısında (Pasifik)
    expect(r.dilimli).toBe('08:30');             // sarmalayıcı → İstanbul 08:30
    expect(r.dilimsiz).not.toBe('08:30');        // canlıdaki arıza: 18:30 (PDT) / 19:30 (PST)
    expect(r.isGunu).toBe('2026-09-25');         // gün anahtarı İstanbul günü
    expect(r.surecGunu).toBe(24);                // aynı an süreç-yerelde "dün" — getDate() ile yazılsaydı id bir gün geride kalırdı
  });
});
