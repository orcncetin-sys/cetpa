/**
 * DEĞİŞMEZ — silme olayı kiracı ETİKETİ taşır (inceleme 2026-09-25, PLAUSIBLE → düzeltildi).
 *
 * SSE süzgeci `TENANT_COLLECTIONS.has(coll) && ev.cid && ev.cid !== streamCid` — etiketsiz olay BÜTÜN kiracılara
 * gider. `broadcastDocChange(coll, 'delete', id)` eskiden hep etiketsizdi; MF kimliği kiracı kimliği + fatura
 * seri-sırası taşır. Kural: 'delete' yayını silinen dokümanı 4. argüman olarak verir (pgShim yalnız etiketi okur,
 * içeriği olaya iliştirmez — pgShim.test). Davranış testi pgShim.test.ts'te; burası yeni bir etiketsiz çağrıyı çitler.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { SRC_KOK as SRC, kaynakDosyalari, kodSatirlari, gorece } from '../test/kaynakTarama';

// Bilinçli istisna: /api/ops/yayinla — bakım scripti SQL ile ZATEN silmiştir, doküman yok (yalnız kimlik gelir).
// Uç token'lı (OPS_SUMMARY_TOKEN), kullanıcı yolu değil.
const ISTISNA = new Set(['src/server/routes/opsRoutes.ts']);

describe("broadcastDocChange(…, 'delete', …) etiketsiz çağrılmaz", () => {
  it('server.ts + src/server: her silme yayını 4 argümanlı', () => {
    const dosyalar = [join(SRC, '..', 'server.ts'), ...kaynakDosyalari(join(SRC, 'server'))];
    const suclu: string[] = [];
    let silmeYayini = 0;
    for (const yol of dosyalar) {
      for (const { n, kod } of kodSatirlari(yol)) {
        if (!/(?<!function )broadcastDocChange\([^;]*'delete'/.test(kod)) continue;   // tanım satırı sayılmaz
        silmeYayini++;
        const etiketsiz = /broadcastDocChange\([^;]*?'delete'\s*,\s*[^,)]+\)/.test(kod);
        if (etiketsiz && !ISTISNA.has(gorece(yol))) suclu.push(`${gorece(yol)}:${n} ${kod.trim()}`);
      }
    }
    expect(suclu).toEqual([]);
    // Kahin: tarayıcı gerçekten silme yayınlarını görüyor (pgShim.delete + server.ts DELETE + ops istisnası).
    expect(silmeYayini).toBe(3);
  });
});
