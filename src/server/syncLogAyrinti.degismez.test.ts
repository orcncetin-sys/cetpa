/**
 * DEĞİŞMEZ — İkiz ölçümü (I2, 2026-09-25): `FaturaKaydetV2` rotası Mikro yanıtının ANAHTAR yollarını
 * `writeSyncLog`un 9. argümanıyla (`ayrinti`) geçer; rota testi (mikroRoutes.govdeFaturaIrsaliye) yalnız çağrıyı
 * görür. Asıl yazıcı server.ts'te ve test düzeneğinde yok — alanı DOKÜMANA koymazsa ölçüm sessizce kaybolur
 * ("yazıldı ama bağlanmadı"). Burada kaynakta çitlenir.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { SRC_KOK as SRC, kodSatirlari } from '../test/kaynakTarama';

describe('writeSyncLog ayrıntıyı dokümana yazar', () => {
  const kod = kodSatirlari(join(SRC, '..', 'server.ts')).map(s => s.kod).join('\n');
  it('imza 9. parametreyi alır ve syncLog dokümanına koyar', () => {
    const govde = kod.slice(kod.indexOf('async function writeSyncLog('), kod.indexOf('async function writeSyncLog(') + 1500);
    expect(govde).toMatch(/ayrinti\?:\s*Record<string, unknown>/);
    expect(govde).toMatch(/\.\.\.\(ayrinti \? \{ ayrinti \} : \{\}\)/);
  });
  it('FaturaKaydetV2: anahtar yolu hesabı try/catch içinde — tanı yardımcısı yasal belge yolunu düşürmez', () => {
    const rota = kodSatirlari(join(SRC, 'server', 'routes', 'mikroRoutes.ts')).map(s => s.kod).join('\n');
    expect(rota).toMatch(/try \{ yanitAnahtarlari = yanitAnahtarYollari\(data\); \} catch \{ yanitAnahtarlari = \['…\(yol çıkarılamadı\)'\]; \}/);
    expect(rota).not.toMatch(/\{ yanitAnahtarlari: yanitAnahtarYollari\(/);
  });
});
