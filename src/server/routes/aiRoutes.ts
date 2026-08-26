/**
 * aiRoutes.ts - Gemini destekli uclar (5 rota): lead skorlama, talep tahmini,
 * nakit akisi projeksiyonu, dogal dil sohbeti ve saglik sondasi.
 *
 * server.ts'ten AYRILDI (2026-08-26). Onceki rota gruplariyla AYNI desen:
 * bagimliliklar ACIK baglam nesnesiyle gecer, `import` DEGIL.
 *
 * `setAiHealthProbe` NEDEN VAR: bu blok server.ts'teki modul duzeyi
 * `let aiHealthProbe` degiskenine ATAMA yapiyor (Operasyon Bekcisi onu
 * `getAiHealthProbe: () => aiHealthProbe` ile okuyor, server.ts:1344).
 * Getter yetmez - modulun o degiskeni YAZMASI gerekiyor, bu yuzden baglamda
 * bir SETTER var. Aksi halde bekcinin `ai_gemini` kontrolu sessizce olurdu
 * (probe hep null kalirdi) - tam olarak bu projede daha once yasanan
 * "sessiz olu kod" sinifi.
 */
import type { Express, Request, Response } from 'express';
// ThinkingLevel/Type Google SDK'nin KENDI enum'lari; server.ts'e bagimlilik
// degil, dogrudan pakete import edilir (dongu yok).
import { ThinkingLevel, Type } from '@google/genai';
import { AiChatSchema } from '../schemas.js';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface AiRouteCtx {
  requireAuth: any;
  requireMfaVerified: any;
  requireAdmin: any;
  validate: <T>(sema: { parse: (d: unknown) => T }, veri: unknown, res: Response) => T | null;
  resolveGeminiClient: () => Promise<any>;
  resolveGeminiModel: (requested?: string) => string;
  safeAiError: (msg: string) => string;
  geminiKeySource: () => 'env' | 'vertex' | 'firestore' | 'none';
  /** server.ts'teki `let aiHealthProbe`a YAZAR - bkz. dosya basligi. */
  setAiHealthProbe: (fn: () => Promise<{ ok: boolean; detail: string }>) => void;
}

export function aiRoutes(app: Express, C: AiRouteCtx): void {
  app.get('/api/ai/status', C.requireAuth, C.requireAdmin, async (_req: Request, res: Response) => {
    const client = await C.resolveGeminiClient(); // firestore önbelleğini doldurur
    res.json({ configured: !!client, source: client ? C.geminiKeySource() : 'none' });
  });

  /**
   * POST /api/ai/test — kaydedilen anahtarı UÇTAN UCA doğrular: gerçek (küçük) bir
   * generateContent çağrısı yapar, başarı/hata + kullanılan kaynağı döner.
   * Hata durumunda da 200 döner (ok:false) ki istemci gerçek hata mesajını görsün.
   * requireAdmin: hata mesajı env anahtarını sızdırabilir → yalnız yöneticiye.
   */
  app.post('/api/ai/test', C.requireAuth, C.requireMfaVerified, C.requireAdmin, async (_req: Request, res: Response) => {
    const client = await C.resolveGeminiClient();
    if (!client) return res.status(200).json({ ok: false, source: 'none', error: 'AI yapılandırılmamış — Ayarlar → AI bölümünden Gemini API anahtarını girin.' });
    const source = C.geminiKeySource();
    const model = C.resolveGeminiModel();
    try {
      const r = await client.models.generateContent({ model, contents: 'ping' });
      return res.json({ ok: true, source, model, sample: (r.text ?? '').slice(0, 40) });
    } catch (e) {
      return res.status(200).json({ ok: false, source, model, error: C.safeAiError(e instanceof Error ? e.message : String(e)) });
    }
  });

  // Watchdog'un günlük AI sağlık kontrolü (runOpsWatchdog check 7 buradan çağırır).
  C.setAiHealthProbe(async () => {
    const client = await C.resolveGeminiClient();
    if (!client) return { ok: true, detail: 'AI yapılandırılmamış, atlandı' };
    const model = C.resolveGeminiModel();
    try {
      await client.models.generateContent({ model, contents: 'ping' });
      return { ok: true, detail: `${model} yanıt veriyor (kaynak: ${C.geminiKeySource()})` };
    } catch (e) {
      return { ok: false, detail: `${model}: ` + C.safeAiError(e instanceof Error ? e.message : String(e)) };
    }
  });

  /**
   * POST /api/ai/generate
   * Body: { prompt, model?, systemInstruction?, thinkingLevel?, jsonSchema? }
   * Returns: { text: string }
   * Used by: geminiService.ts (lead scoring, dashboard analysis, FMEA, 8D)
   */
  app.post('/api/ai/generate', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const client = await C.resolveGeminiClient();
    if (!client) return res.status(503).json({ error: 'AI service not configured. Enter your Gemini API key in Settings → AI.' });
    const { prompt, model, systemInstruction, thinkingLevel, jsonSchema } = req.body as {
      prompt: string; model?: string; systemInstruction?: string;
      thinkingLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'; jsonSchema?: unknown;
    };
    if (!prompt) return res.status(400).json({ error: 'prompt is required.' });
    try {
      const response = await client.models.generateContent({
        model: C.resolveGeminiModel(model),
        contents: prompt,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(thinkingLevel && thinkingLevel !== 'NONE' ? { thinkingConfig: { thinkingLevel: ThinkingLevel[thinkingLevel] } } : {}),
          ...(jsonSchema ? { responseMimeType: 'application/json', responseSchema: jsonSchema } : {}),
        } as Record<string, unknown>,
      });
      return res.json({ text: response.text ?? '' });
    } catch (e) {
      console.error('[Gemini generate]', e);
      return res.status(500).json({ error: 'AI generation failed.' });
    }
  });

  /**
   * POST /api/ai/chat
   * Body: { message, history?, systemInstruction?, model?, highThinking? }
   * Returns: { text: string }
   * Used by: AIChat.tsx
   */
  app.post('/api/ai/chat', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const client = await C.resolveGeminiClient();
    if (!client) return res.status(503).json({ error: 'AI service not configured. Enter your Gemini API key in Settings → AI.' });
    const chatValidated = C.validate(AiChatSchema, { message: req.body?.message, context: req.body?.systemInstruction, language: req.body?.language }, res);
    if (!chatValidated) return;
    const { message, history = [], systemInstruction, model, highThinking = false } = req.body as {
      message: string;
      history?: { role: string; parts: { text: string }[] }[];
      systemInstruction?: string;
      model?: string;
      highThinking?: boolean;
    };
    if (!message) return res.status(400).json({ error: 'message is required.' });
    try {
      const chat = client.chats.create({
        model: C.resolveGeminiModel(model),
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(highThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {}),
        } as Record<string, unknown>,
        history: history as { role: 'user' | 'model'; parts: { text: string }[] }[],
      });
      const response = await chat.sendMessage({ message });
      return res.json({ text: response.text ?? '' });
    } catch (e) {
      console.error('[Gemini chat]', e);
      return res.status(500).json({ error: 'AI chat failed.' });
    }
  });

  /**
   * POST /api/ai/demand-forecast
   * Body: { ordersCount, monthlyArr, topProductsCtx, inventoryCtx, today, lang }
   * Calls Gemini server-side with structured JSON schema and returns ForecastData.
   * Protected by Firebase Auth (requireAuth).
   */
  app.post('/api/ai/demand-forecast', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const client = await C.resolveGeminiClient();
    if (!client) return res.status(503).json({ error: 'AI service not configured. Enter your Gemini API key in Settings → AI.' });
    const {
      ordersCount = 0,
      monthlyArr = [],
      topProductsCtx = [],
      inventoryCtx = '',
      today = new Date().toISOString().slice(0, 7),
      lang = 'tr',
    } = req.body as {
      ordersCount?: number;
      monthlyArr?: string[];
      topProductsCtx?: string[];
      inventoryCtx?: string;
      today?: string;
      lang?: string;
    };
    const language = lang === 'tr' ? 'Turkish' : 'English';
    const prompt = `You are a senior B2B sales analyst for Cetpa, a Turkish wholesale distributor.

Context (today: ${today}):
- Orders last 90 days: ${ordersCount}
- Monthly revenue: ${monthlyArr.join(', ')}
- Top products: ${topProductsCtx.join('; ')}
- Inventory: ${inventoryCtx || 'N/A'}

Based on these trends, respond in ${language} as valid JSON (no markdown fences).
Rules: topProducts ≤ 5; cashFlow = next 3 months projection; reorderAlerts only for products where stock < 30-day demand. All monetary values in TRY integers.`;
    try {
      const result = await client.models.generateContent({
        model: C.resolveGeminiModel(),
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary:         { type: Type.STRING },
              topProducts:     { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, units: { type: Type.NUMBER }, trend: { type: Type.STRING } }, required: ['name','units','trend'] } },
              cashFlow:        { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { month: { type: Type.STRING }, projected: { type: Type.NUMBER } }, required: ['month','projected'] } },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
              reorderAlerts:   { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { product: { type: Type.STRING }, currentStock: { type: Type.NUMBER }, recommendedReorder: { type: Type.NUMBER } }, required: ['product','currentStock','recommendedReorder'] } },
            },
            required: ['summary','topProducts','cashFlow','recommendations','reorderAlerts'],
          },
        } as Record<string, unknown>,
      });
      return res.json(JSON.parse(result.text ?? '{}'));
    } catch (e) {
      console.error('[demand-forecast]', e);
      return res.status(500).json({ error: 'Demand forecast failed.' });
    }
  });
}
