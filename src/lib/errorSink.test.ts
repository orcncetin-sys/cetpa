import { describe, it, expect, vi, afterEach } from 'vitest';
import { setErrorReporter, reportSilentError } from './errorSink';

afterEach(() => setErrorReporter(null));

describe('errorSink', () => {
  it('kayıtlı raporlayıcıya iletir', () => {
    const gelen: unknown[][] = [];
    setErrorReporter((...a) => gelen.push(a));
    reportSilentError('firestore-listener', 'izin yok', 'stack', { coll: 'orders' });
    expect(gelen).toHaveLength(1);
    expect(gelen[0][0]).toBe('firestore-listener');
    expect(gelen[0][3]).toEqual({ coll: 'orders' });
  });

  it('raporlayıcı YOKKEN bile konsola düşer — tamamen sessiz kalmaz', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportSilentError('sse-stream-down', 'akış koptu');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('raporlayıcı patlarsa uygulamayı kırmaz', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setErrorReporter(() => { throw new Error('raporlayıcı bozuk'); });
    expect(() => reportSilentError('x', 'y')).not.toThrow();
    spy.mockRestore();
  });

  it('null ile kayıt silinebilir', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = vi.fn();
    setErrorReporter(fn);
    setErrorReporter(null);
    reportSilentError('x', 'y');
    expect(fn).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
