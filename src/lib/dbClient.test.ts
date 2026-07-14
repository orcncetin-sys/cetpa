import { describe, it, expect } from 'vitest';
import { methodTunnel } from './dbClient';

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
