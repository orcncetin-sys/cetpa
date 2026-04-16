import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { Lead } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export const scoreLead = async (lead: Lead | Record<string, unknown>) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: `Aşağıdaki potansiyel müşteriyi (lead) 0-100 arası puanla ve nedenini açıkla. Yanıtı JSON formatında ver: { "score": number, "reasoning": "string" }
      
      Müşteri Bilgileri:
      ${JSON.stringify(lead, null, 2)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            reasoning: { type: Type.STRING }
          },
          required: ["score", "reasoning"]
        }
      }
    });
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Lead scoring error:", error);
    return { score: 0, reasoning: 'Analiz yapılamadı.' };
  }
};

export const analyzeDashboard = async (data: unknown) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: `Sen bir kurumsal veri analistisin. Aşağıdaki dashboard verilerini analiz et ve stratejik öneriler sun. 
      Analizinde şu konulara değin:
      1. Satış trendleri ve büyüme fırsatları.
      2. Envanter yönetimi ve stok riskleri.
      3. Finansal sağlık ve nakit akışı.
      4. İnsan kaynakları ve departman verimliliği.
      
      Veriler:
      ${JSON.stringify(data, null, 2)}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
      }
    });
    return response.text;
  } catch (error) {
    console.error("Dashboard analysis error:", error);
    return "Analiz sırasında bir hata oluştu.";
  }
};

export const suggestFMEAMitigation = async (failureMode: string, process: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: `FMEA Analizi için öneri sun. 
      Süreç: ${process}
      Hata Modu: ${failureMode}
      
      Bu hata modu için olası kök nedenleri ve önleyici faaliyetleri (mitigation) maddeler halinde öner.`,
    });
    return response.text;
  } catch (error) {
    console.error("FMEA suggestion error:", error);
    return "Öneri alınamadı.";
  }
};

export const suggest8DRootCause = async (problem: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: `8D Problem Çözme Metodu için kök neden analizi önerisi sun.
      Problem: ${problem}
      
      Bu problem için 5 Neden (5 Why) analizi taslağı ve olası kök nedenleri öner.`,
    });
    return response.text;
  } catch (error) {
    console.error("8D suggestion error:", error);
    return "Öneri alınamadı.";
  }
};
