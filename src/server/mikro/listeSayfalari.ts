/**
 * listeSayfalari.ts: Mikro `…ListesiV2` uçlarının TAM sayfalaması (salt okuma). Saatlik cron'un `cronPullAll` gövdesi buraya TAŞINDI
 * (şartname «Mikro bağlantı B» BH19.4, 05.11.2026): `GET /api/ops/cari-kod-tani`'nin kuru koşusu cron'la AYNI okumayı yapsın diye
 * (kopya sayfalayıcı yok). Davranış taşıma öncesiyle aynı: 500'lük sayfa, en çok 100 sayfa; `!ok` / metin yanıt / boş ya da kısa
 * sayfa koşuyu bitirir. Ek bilgi `tamam`: koşu boş ya da kısa sayfayla bittiyse `true`; yanıt hatası ya da sayfa tavanıyla bittiyse
 * `false` (kuru koşu eksik girdiyle karar ÜRETMESİN; cron bugünkü gibi yalnız satırları kullanır).
 */
import { mikroPost, mikroData } from '../mikroClient.js';

const SAYFA = 500;
const SAYFA_TAVANI = 100;

export async function mikroListeTumu(
  method: string, listKey: string, body: Record<string, unknown>,
): Promise<{ satirlar: Record<string, unknown>[]; tamam: boolean }> {
  const satirlar: Record<string, unknown>[] = [];
  for (let index = 0; index < SAYFA_TAVANI; index++) {
    const { ok, data } = await mikroPost(method, { ...body, Size: String(SAYFA), Index: index });
    if (!ok || typeof data === 'string') return { satirlar, tamam: false };
    const rows = (mikroData(data)[listKey] ?? []) as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) return { satirlar, tamam: true };
    satirlar.push(...rows);
    if (rows.length < SAYFA) return { satirlar, tamam: true };
  }
  return { satirlar, tamam: false };
}
