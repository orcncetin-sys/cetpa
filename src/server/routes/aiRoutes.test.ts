/**
 * aiRoutes.test.ts — `setAiHealthProbe` SÖZLEŞMESİ.
 *
 * NEDEN VAR: `aiRoutes` server.ts'teki modül düzeyi `let aiHealthProbe`
 * değişkenine bağlamdaki SETTER ile yazar. Operasyon Bekçisi o değişkeni
 * okuyup `ai_gemini` kontrolünü koşar. Setter hiç çağrılmazsa probe null
 * kalır — ve bu, çalışan bir uygulamada HİÇBİR belirti vermez: rotalar
 * cevap verir, tsc temizdir, boot testi geçer.
 *
 * Bu tam olarak projenin tekrar eden "sessiz ölü kod" sınıfı (ölü
 * useDataSync dinleyicileri aylarca fark edilmemişti). Test, sözleşmeyi
 * çalışma zamanında kanıtlıyor.
 */
import { describe, it, expect, vi } from 'vitest';
import { aiRoutes } from './aiRoutes';

/** Rota kaydını yutan sahte Express. */
function sahteApp() {
  const rotalar: string[] = [];
  const kaydet = (yol: string) => { rotalar.push(yol); };
  return {
    rotalar,
    get: (y: string) => kaydet(y), post: (y: string) => kaydet(y),
    put: (y: string) => kaydet(y), patch: (y: string) => kaydet(y),
    delete: (y: string) => kaydet(y),
  };
}

function sahteCtx(setAiHealthProbe: (fn: () => Promise<{ ok: boolean; detail: string }>) => void) {
  const gecir = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    requireAuth: gecir(), requireMfaVerified: gecir(), requireAdmin: gecir(),
    validate: <T,>() => null as T | null,
    resolveGeminiClient: async () => null,
    resolveGeminiModel: (r?: string) => r ?? 'gemini-flash-latest',
    safeAiError: (m: string) => m,
    geminiKeySource: () => 'none' as const,
    setAiHealthProbe,
  };
}

describe('aiRoutes', () => {
  it('kayıt sırasında AI sağlık sondasını KURAR (bekçi onu okuyor)', () => {
    const setici = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    aiRoutes(sahteApp() as any, sahteCtx(setici) as any);
    expect(setici, 'setAiHealthProbe hiç çağrılmadı — bekçinin ai_gemini kontrolü ölü kalırdı').toHaveBeenCalledTimes(1);
    expect(typeof setici.mock.calls[0][0]).toBe('function');
  });

  it('beş AI ucunu da kaydeder', () => {
    const app = sahteApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    aiRoutes(app as any, sahteCtx(() => {}) as any);
    const ai = app.rotalar.filter(y => y.startsWith('/api/ai'));
    expect(ai.length, `kaydedilen: ${app.rotalar.join(', ')}`).toBe(5);
  });
});
