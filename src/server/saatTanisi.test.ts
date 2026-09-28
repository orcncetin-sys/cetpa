/** saatTanisi — üç saat ayrı raporlanır; bir parça okunamazsa diğerleri yine döner (2026-09-28, "tzutil yaptım, doğrula"). */
import { describe, it, expect, vi } from 'vitest';
import { saatTanisi } from './saatTanisi';

describe('saatTanisi', () => {
  it('node alanı sürecin kendi dilimi + ofseti; pg ve mikro sorgu sonuçları aynen', async () => {
    const t = await saatTanisi({
      pgSorgu: async sql => { expect(sql).toContain("current_setting('TimeZone')"); return { rows: [{ dilim: 'America/Los_Angeles', simdi: '2026-09-28 02:00:00-07' }] }; },
      mikroSorgu: async sql => { expect(sql).toContain('SYSDATETIMEOFFSET()'); return { rows: [{ simdi: '2026-09-28T12:00:00.0000000+03:00', yerel: '2026-09-28T12:00:00' }], hata: null }; },
      simdi: new Date('2026-09-28T09:00:00Z'),
    });
    expect(t.node.ofsetDakika).toBe(new Date('2026-09-28T09:00:00Z').getTimezoneOffset());
    expect(typeof t.node.yerel).toBe('string');
    expect(t.pg).toEqual({ dilim: 'America/Los_Angeles', simdi: '2026-09-28 02:00:00-07' });
    expect(t.mikro).toEqual({ simdi: '2026-09-28T12:00:00.0000000+03:00', yerel: '2026-09-28T12:00:00' });
  });

  it('parça okunamazsa HATA alanına yazılır, diğerleri döner; yapılandırılmamış parça null', async () => {
    const t = await saatTanisi({
      pgSorgu: async () => { throw new Error('bağlantı reddedildi'); },
      mikroSorgu: async () => ({ rows: [], hata: 'SqlVeriOkuV2 yanıt vermedi.' }),
    });
    expect(t.pg).toEqual({ hata: 'bağlantı reddedildi' });
    expect(t.mikro).toEqual({ hata: 'SqlVeriOkuV2 yanıt vermedi.' });
    const bos = await saatTanisi({});
    expect(bos.pg).toBeNull();
    expect(bos.mikro).toBeNull();
    expect(bos.node.dilim === null || typeof bos.node.dilim === 'string').toBe(true);
  });

  // İnceleme 2026-09-28: node.dilim hiçbir testte gerçek değere karşı sınanmıyordu — sabit 'Europe/Istanbul' yazan
  // mutant geçiyordu (geliştirme Mac'i zaten İstanbul'da). Intl taklit edilir: sonuç makinenin diliminden bağımsız.
  it('node.dilim Intl çözümlemesinden gelir (sabit/uydurma değer değil)', async () => {
    const gercek = Intl.DateTimeFormat;
    const casus = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((...a: ConstructorParameters<typeof Intl.DateTimeFormat>) => {
      const f = new gercek(...a);
      return Object.assign(Object.create(f), { resolvedOptions: () => ({ ...f.resolvedOptions(), timeZone: 'America/Los_Angeles' }) });
    }) as unknown as typeof Intl.DateTimeFormat);
    try { expect((await saatTanisi({})).node.dilim).toBe('America/Los_Angeles'); } finally { casus.mockRestore(); }
  });

  it('iki sorgu PARALEL: toplam bekleme ~tek zaman aşımı, 2× değil', async () => {
    const asili = () => new Promise<never>(() => {});
    const bas = Date.now();
    const t = await saatTanisi({ pgSorgu: asili, mikroSorgu: asili }, 150);
    expect(t.pg).toEqual({ hata: '150 ms zaman aşımı' });
    expect(t.mikro).toEqual({ hata: '150 ms zaman aşımı' });
    expect(Date.now() - bas).toBeLessThan(280);
  });

  it('asılı sorgu tanıyı kilitlemez: zaman aşımı hatası', async () => {
    const t = await saatTanisi({ mikroSorgu: () => new Promise(() => {}) }, 30);
    expect(t.mikro).toEqual({ hata: '30 ms zaman aşımı' });
  });

  it('Node süreci dilimi ortamdan okur (TZ=Europe/Istanbul alt süreçte → ofset -180)', async () => {
    const { execFileSync } = await import('child_process');
    const cikti = execFileSync(process.execPath, ['-e', 'console.log(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date("2026-09-28T09:00:00Z").getTimezoneOffset())'],
      { env: { ...process.env, TZ: 'Europe/Istanbul' } }).toString().trim();
    expect(cikti).toBe('Europe/Istanbul -180');
  });
});
