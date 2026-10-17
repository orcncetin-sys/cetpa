/**
 * belgeKilidi.test.ts — resmî belge uçuş kilidi (2026-10-17, şartname «e-Fatura çift kesim» § 7.4 B6; D11). Davranış: saf modül.
 * Çit: App.tsx e-İrsaliye ve e-Fatura için AYNI modülü (kanca) kullanır; kopya Set ref kalmadı. Kilidin sayfadaki davranışı
 * (onay penceresi, `finally`, düğme pasifliği) gerçek App'te: components/MikroFatura.uygulama.test.tsx (B7).
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { belgeKilidiOlustur } from './belgeKilidi';
import { SRC_KOK, kodSatirlari } from '../../test/kaynakTarama';

describe('B6 — ortak kilit modülü', () => {
  it('aynı id\'ye iki `al` → ikincisi `suruyor`; `birak` → yeniden `alindi`; `tamamlandi` → `kesilmis`', () => {
    const k = belgeKilidiOlustur();
    expect(k.al('s1')).toBe('alindi');
    expect(k.al('s1')).toBe('suruyor');
    expect(k.durum('s1')).toBe('suruyor');
    k.birak('s1');
    expect(k.durum('s1')).toBe('serbest');
    expect(k.al('s1')).toBe('alindi');
    k.tamamlandi('s1');
    k.birak('s1');
    expect(k.al('s1')).toBe('kesilmis');
    expect(k.durum('s1')).toBe('kesilmis');
  });

  it('farklı id\'ler birbirini kilitlemez; canlı listeden gelen `kesilmisMi` kilidi almaz', () => {
    const k = belgeKilidiOlustur();
    expect(k.al('a')).toBe('alindi');
    expect(k.al('b')).toBe('alindi');
    expect(k.al('c', true)).toBe('kesilmis');
    expect(k.suruyorlar()).toEqual({ a: true, b: true });
  });

  it('görsel durum bildirimi: al / birak anlık görüntüyle; boşa `birak` bildirmez', () => {
    const bildir = vi.fn();
    const k = belgeKilidiOlustur(bildir);
    k.al('x');
    expect(bildir).toHaveBeenLastCalledWith({ x: true });
    k.birak('x');
    expect(bildir).toHaveBeenLastCalledWith({});
    k.birak('x');
    expect(bildir).toHaveBeenCalledTimes(2);
  });
});

describe('B6 çit — App.tsx: e-İrsaliye ve e-Fatura AYNI kilit modülünü kullanır, kopya Set ref yok', () => {
  const kod = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod);
  it('iki kanca çağrısı (e-İrsaliye + e-Fatura); `useRef<Set<string>>` ile belge kilidi yok; ölü `faturaLoading` yok', () => {
    expect(kod.filter(k => /= useBelgeKilidi\(\);$/.test(k.trim())).map(k => k.trim())).toEqual([
      'const eIrsaliyeKilidi = useBelgeKilidi();',
      'const mikroFaturaKilidi = useBelgeKilidi();',
    ]);
    expect(kod.filter(k => /eIrsaliyeSurenRef|eIrsaliyeTamamlananRef|faturaSurenRef|faturaTamamlananRef/.test(k))).toEqual([]);
    expect(kod.filter(k => /useRef<Set<string>>/.test(k))).toEqual([]);
    const sayfa = kodSatirlari(join(SRC_KOK, 'pages', 'OrdersPage.tsx')).map(s => s.kod);
    expect(sayfa.filter(k => /\bfaturaLoading\b/.test(k))).toEqual([]);
  });

  it('e-Fatura işleyicisi sırası: salt-okur `durum` → onay → `al` → istek → `finally` `birak`', () => {
    const metin = kod.join('\n');
    const bas = metin.indexOf('const handleMikroFatura = async (order: Order) => {');
    const son = metin.indexOf('\n  };', bas);
    const g = metin.slice(bas, son);
    const sira = [
      'mikroFaturaKilidi.kilit.durum(order.id, mikroFaturaKesilmis(order.id))',
      'await confirmAction(',
      'mikroFaturaKilidi.kilit.al(order.id, mikroFaturaKesilmis(order.id))',
      "await authFetch('/api/mikro/fatura/kaydet'",
      'mikroFaturaKilidi.kilit.birak(order.id)',
    ].map(p => g.indexOf(p));
    expect(sira.every(i => i > -1), JSON.stringify(sira)).toBe(true);
    expect([...sira].sort((a, b) => a - b)).toEqual(sira);
    expect(g).toMatch(/\} finally \{\n\s+mikroFaturaKilidi\.kilit\.birak\(order\.id\);/);
  });
});
