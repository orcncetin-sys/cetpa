import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mikroSiparisFisiMi, mikroBosDurumu } from './mikroSiparisFisi';
import { op } from '../../i18n/orders';
import { SRC_KOK, kodSatirlari } from '../../test/kaynakTarama';

// Şartname «Mikro bağlantı A» A7 / AH9 (2026-11-05): «Mikro Siparişleri» sekmesinin süzgeci TEK kural.
describe('mikroSiparisFisiMi · Mikro alınan (satış) sipariş fişi', () => {
  it('tip 0 → sekmede; tip 1 (verilen / alış) ve öteki tipler → sekmede DEĞİL', () => {
    expect(mikroSiparisFisiMi({ tip: 0 })).toBe(true);
    expect(mikroSiparisFisiMi({ tip: 1 })).toBe(false);
    expect(mikroSiparisFisiMi({ tip: 2 })).toBe(false);
    expect(mikroSiparisFisiMi({ tip: Number.NaN })).toBe(false);
  });
  it('liste süzgeci olarak doğrudan kullanılır (OrdersPage çağrı yeri)', () => {
    expect([{ tip: 1 }, { tip: 0 }, { tip: 0 }].filter(mikroSiparisFisiMi)).toHaveLength(2);
  });
});

// «Yazıldı ama bağlanmadı» çiti: sekmenin listesi yüklemi ÇAĞIRIR; satır içi kopya süzgeç kalmaz (yorumlar sayılmaz).
describe('ÇİT: OrdersPage «Mikro Siparişleri» listesi yüklemden geçer', () => {
  it('`mikroSiparisler.filter(mikroSiparisFisiMi)` var; `ms.tip === 0` satır içi kopyası YOK', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'pages', 'OrdersPage.tsx')).map(x => x.kod).join('\n');
    expect(kod).toContain('mikroSiparisler.filter(mikroSiparisFisiMi)');
    expect(kod).not.toMatch(/\.tip\s*===\s*0/);
  });
});

// AH9 (2026-11-05): boş durum yardımcısı HAM listeyi alır, süzgeci kendisi uygular (sayı alsaydı süzgeç mutasyonu görünmezdi).
describe('mikroBosDurumu · «Mikro Siparişleri» sekmesi boşken metin seçimi', () => {
  it('(mikro, yalnız tip 1, 0) → sekmeye özel açıklama', () => {
    expect(mikroBosDurumu('mikro', [{ tip: 1 }], 0)).toBe('mikroFisYok');
  });
  it('(mikro, tip 0 var, 0) → genel «sipariş bulunamadı» (süzgeç / arama boşalttı)', () => {
    expect(mikroBosDurumu('mikro', [{ tip: 0 }], 0)).toBe('genel');
  });
  it('(mikro, [], 0) → özel açıklama; (cetpa, [], 0) ve (magaza, [], 0) → genel', () => {
    expect(mikroBosDurumu('mikro', [], 0)).toBe('mikroFisYok');
    expect(mikroBosDurumu('cetpa', [], 0)).toBe('genel');
    expect(mikroBosDurumu('magaza', [], 0)).toBe('genel');
  });
  it('liste doluysa boş durum yok (null)', () => {
    expect(mikroBosDurumu('mikro', [], 3)).toBeNull();
    expect(mikroBosDurumu('cetpa', [{ tip: 0 }], 1)).toBeNull();
  });
});

describe('ÇİT: OrdersPage boş durumu yardımcıdan geçer; metin sözlükte (tr + en)', () => {
  it('`mikroBosDurumu(orderSourceTab, mikroSiparisler, sorted.length)` çağrılır; ham `mikroSiparisler` verilir', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'pages', 'OrdersPage.tsx')).map(x => x.kod).join('\n');
    expect(kod).toContain('mikroBosDurumu(orderSourceTab, mikroSiparisler, sorted.length)');
    expect(kod).toContain('op(currentLanguage).mikro_dan_siparis_fisi_gelmedi');
  });
  it('metin tr / en: «Cetpa Siparişleri» sekmesine ve senkron günlüğüne yönlendirir; «başarılı» iddiası YOK', () => {
    expect(op('tr').mikro_dan_siparis_fisi_gelmedi).toContain("Mikro'dan sipariş fişi gelmedi.");
    expect(op('tr').mikro_dan_siparis_fisi_gelmedi).toContain('«Cetpa Siparişleri»');
    expect(op('tr').mikro_dan_siparis_fisi_gelmedi).toContain('SQL:SIPARISLER');
    expect(op('en').mikro_dan_siparis_fisi_gelmedi).toContain('«Cetpa Orders»');
    expect(op('tr').mikro_dan_siparis_fisi_gelmedi).not.toMatch(/başarılı/);
  });
});
