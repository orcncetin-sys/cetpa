/**
 * geminiService.ts
 * All Gemini calls go through the server-side proxy (/api/ai/generate).
 * The API key never appears in the browser bundle.
 */
import { auth } from '../firebase';

async function getToken(): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

async function aiGenerate(payload: {
  prompt: string;
  model?: string;
  systemInstruction?: string;
  thinkingLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  jsonSchema?: unknown;
}): Promise<string> {
  const token = await getToken();
  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`AI proxy ${res.status}`);
  const data = await res.json() as { text: string };
  return data.text;
}

// ── Lead Scoring ────────────────────────────────────────────────────────────

export const scoreLead = async (lead: Record<string, unknown>): Promise<{ score: number; reasoning: string }> => {
  try {
    const text = await aiGenerate({
      prompt: `Aşağıdaki potansiyel müşteriyi (lead) 0-100 arası puanla ve nedenini açıkla. Yanıtı JSON formatında ver: { "score": number, "reasoning": "string" }\n\nMüşteri Bilgileri:\n${JSON.stringify(lead, null, 2)}`,
      jsonSchema: {
        type: 'object',
        properties: { score: { type: 'number' }, reasoning: { type: 'string' } },
        required: ['score', 'reasoning'],
      },
    });
    return JSON.parse(text) as { score: number; reasoning: string };
  } catch (e) {
    console.error('Lead scoring error:', e);
    return { score: 0, reasoning: 'Analiz yapılamadı.' };
  }
};

// ── Dashboard Analysis ──────────────────────────────────────────────────────

export const analyzeDashboard = async (data: unknown): Promise<string> => {
  try {
    return await aiGenerate({
      thinkingLevel: 'HIGH',
      prompt: `Sen bir kurumsal veri analistisin. Aşağıdaki dashboard verilerini analiz et ve stratejik öneriler sun.\nAnalizinde şu konulara değin:\n1. Satış trendleri ve büyüme fırsatları.\n2. Envanter yönetimi ve stok riskleri.\n3. Finansal sağlık ve nakit akışı.\n4. İnsan kaynakları ve departman verimliliği.\n\nVeriler:\n${JSON.stringify(data, null, 2)}`,
    });
  } catch (e) {
    console.error('Dashboard analysis error:', e);
    return 'Analiz sırasında bir hata oluştu.';
  }
};

// ── FMEA Mitigation ─────────────────────────────────────────────────────────

export const suggestFMEAMitigation = async (failureMode: string, process: string): Promise<string> => {
  try {
    return await aiGenerate({
      prompt: `FMEA Analizi için öneri sun.\nSüreç: ${process}\nHata Modu: ${failureMode}\n\nBu hata modu için olası kök nedenleri ve önleyici faaliyetleri (mitigation) maddeler halinde öner.`,
    });
  } catch (e) {
    console.error('FMEA suggestion error:', e);
    return 'Öneri alınamadı.';
  }
};

// ── 8D Root Cause ────────────────────────────────────────────────────────────

export const suggest8DRootCause = async (problem: string): Promise<string> => {
  try {
    return await aiGenerate({
      prompt: `8D Problem Çözme Metodu için kök neden analizi önerisi sun.\nProblem: ${problem}\n\nBu problem için 5 Neden (5 Why) analizi taslağı ve olası kök nedenleri öner.`,
    });
  } catch (e) {
    console.error('8D suggestion error:', e);
    return 'Öneri alınamadı.';
  }
};
