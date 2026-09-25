import { describe, it, expect } from 'vitest';
import { methodTunnel, applyConstraints, cmpValues, reviveTimestamps, Timestamp, orderBy, limit } from './dbClient';

// IIS WebDAV, öndeki proxy'de PUT/PATCH/DELETE'i 403'lüyor; bu metotlar POST +
// ÖZEL X-Cetpa-Method başlığıyla tünellenmeli. Standart X-HTTP-Method-Override
// KULLANILMAMALI (IIS onu da tanıyıp 403'ler). Bu regresyonu kilitler.
describe('methodTunnel — IIS WebDAV metod tünelleme', () => {
  it('PATCH/PUT/DELETE -> POST + X-Cetpa-Method başlığı', () => {
    for (const m of ['PATCH', 'PUT', 'DELETE']) {
      const t = methodTunnel(m);
      expect(t.method).toBe('POST');
      expect(t.header).toEqual({ 'X-Cetpa-Method': m });
    }
  });

  it('GET/POST olduğu gibi geçer, override başlığı yok', () => {
    expect(methodTunnel('GET')).toEqual({ method: 'GET' });
    expect(methodTunnel('POST')).toEqual({ method: 'POST' });
  });

  it('IIS-tanınan standart başlığı ASLA kullanmaz (X-HTTP-Method-Override)', () => {
    const t = methodTunnel('PATCH');
    expect(t.header && 'X-HTTP-Method-Override' in t.header).toBe(false);
  });
});

// orderBy zinciri TESTSİZDİ (hakem CONFIRMED, 2026-09-24): syncLog `orderBy('timestamp','desc')` düzeltmesi
// istemcide sıralanır (applyConstraints → cmpValues → Timestamp.toMillis). SSE zarfı {_seconds,_nanoseconds}
// önce reviveTimestamps ile Timestamp'e döner; bu zincir kopuksa "en yeni 30" yerine rastgele 30 gelir.
describe('orderBy zinciri — Timestamp sıralaması (reviveTimestamps → cmpValues → applyConstraints)', () => {
  const d = (id: string, data: Record<string, unknown>) => ({ id, data });

  it('(1) Timestamp alanında desc: en yeni önce; ham SSE zarfı revive edilip aynı sıraya girer; limit sonda', () => {
    const docs = [
      d('eski', reviveTimestamps({ timestamp: { _seconds: 1_700_000_000, _nanoseconds: 0 } }) as Record<string, unknown>),
      d('yeni', { timestamp: Timestamp.fromMillis(1_700_000_500_000) }),
      d('orta', { timestamp: new Timestamp(1_700_000_200, 0) }),
    ];
    expect(applyConstraints(docs, [orderBy('timestamp', 'desc'), limit(2)]).map(x => x.id)).toEqual(['yeni', 'orta']);
    // String(obj) ile karşılaştırılsaydı hepsi "[object Object]" = eşit kalır, sıra girdi sırası olurdu
    expect(cmpValues(new Timestamp(2, 0), new Timestamp(1, 999_999_999))).toBeGreaterThan(0);
  });

  it('(2) null/undefined karışık alanda ÇÖKMEZ; desc sırada bilinmeyen SONDA', () => {
    const docs = [
      d('yok', {}),
      d('null', { timestamp: null }),
      d('var1', { timestamp: Timestamp.fromMillis(1000) }),
      d('var2', { timestamp: Timestamp.fromMillis(2000) }),
    ];
    expect(applyConstraints(docs, [orderBy('timestamp', 'desc')]).map(x => x.id)).toEqual(['var2', 'var1', 'yok', 'null']);
  });

  it('(3) eşit değerlerde sıra KARARLI (girdi sırası korunur, iki yönde de)', () => {
    const docs = [d('a', { timestamp: Timestamp.fromMillis(5000) }), d('b', { timestamp: new Timestamp(5, 0) }), d('c', { timestamp: Timestamp.fromMillis(5000) })];
    expect(applyConstraints(docs, [orderBy('timestamp', 'desc')]).map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(applyConstraints(docs, [orderBy('timestamp', 'asc')]).map(x => x.id)).toEqual(['a', 'b', 'c']);
  });
});
