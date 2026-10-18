// @vitest-environment node
/**
 * gonderimOzeti.degismez.test.ts — KAYNAK ÇİTİ (şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md` K22, `gonderimOzeti.ts`
 * satırının çit sütunu: «`sha256` + kanonik JSON yalnız burada»).
 *
 * NEDEN: ölçüm kaydı (Dilim 0), gönderim defteri (Dilim 1) ve eski kuyruk taşıması (Dilim 3) AYNI içerik / varlık özetini
 * üretmeli. İkinci bir özet yazılırsa (başka anahtar sırası, başka ayraç) aynı içerik iki ayrı özet verir: tekrar ölçümü (C10)
 * sessizce sıfırlanır, Dilim 1'de içerik kapısı (K13) aynı gövdeyi «farklı» sayar. Bu çit o kopyayı yazıldığı anda kırar.
 * Tarama: `src/server/**` ve `server.ts` üretim kodu (test / düzenek hariç), yorumsuz (`src/test/kaynakTarama.ts`).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari } from '../../test/kaynakTarama';

const DOSYALAR = [...kaynakDosyalari(join(SRC_KOK, 'server')), join(SRC_KOK, '..', 'server.ts')];
const OZET_DOSYASI = 'src/server/mikro/gonderimOzeti.ts';

/** Desene uyan kod satırlarının dosyaları (tekilleştirilmiş, sıralı). */
const dosyalari = (desen: RegExp, dosyalar: readonly string[] = DOSYALAR): string[] =>
  [...new Set(dosyalar.filter(yol => kodSatirlari(yol).some(s => desen.test(s.kod))).map(gorece))].sort();

describe('K22 çiti — gönderim özetleri (sha256 + kanonik JSON) YALNIZ gonderimOzeti.ts\'te', () => {
  it('`kanonikJson`, `govdeOzeti`, `varlikOzeti` tanımı yalnız gonderimOzeti.ts\'te (ikinci özet yazılmaz)', () => {
    const tanim = /\b(?:function\s+(?:kanonikJson|govdeOzeti|varlikOzeti)\b|(?:const|let|var)\s+(?:kanonikJson|govdeOzeti|varlikOzeti)\s*[=:])/;
    expect(dosyalari(tanim)).toEqual([OZET_DOSYASI]);
  });

  it('Mikro gönderim modüllerinde (`src/server/mikro/**`) ve evrak işleyicisinde (`mikroRoutes.ts`) `createHash` yalnız gonderimOzeti.ts\'te', () => {
    const mikroDosyalari = [
      ...kaynakDosyalari(join(SRC_KOK, 'server', 'mikro')),
      join(SRC_KOK, 'server', 'routes', 'mikroRoutes.ts'),
    ];
    expect(dosyalari(/\bcreateHash\s*\(/, mikroDosyalari)).toEqual([OZET_DOSYASI]);
  });
});
