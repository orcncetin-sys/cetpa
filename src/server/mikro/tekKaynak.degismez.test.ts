/**
 * tekKaynak.degismez.test.ts — Mikro eşleme/gövde TEK KAYNAK değişmezleri (2026-09-19).
 *
 * Kaynak-tarayan test. Bu projenin en pahalı tekrar eden arıza sınıfı "YARIM DÜZELTME":
 * bir sözleşme tek yüzeyde düzeltilir, AYNI koleksiyona yazan ikinci yüzey eski
 * varsayılanlarla çalışmaya devam eder ve düzeltmeyi sessizce geri alır. Delta turunda
 * üç kez birden görüldü:
 *
 *   • `App.tsx` irsaliye çağrısından `?? 20` kaldırılmış, FATURA çağrısında kalmıştı →
 *     aynı sipariş bir yüzeyde 400 alırken diğerinde %20 KDV ile Mikro defterine yazılıyordu.
 *   • `crons.ts` cari eşlemesinin KENDİ kopyasını taşıyordu (`|| ''`) → rotada korunan
 *     e-posta/telefon/VKN saat başı `''` ile siliniyordu.
 *   • `crons.ts` stok eşlemesi `|| sku` / `|| 'ADET'` ile elle düzeltilmiş ad/birimi eziyordu.
 *
 * Yorum satırları sayılmaz (kod-hariç süzgeç) — düzeltmenin GEREKÇESİ yorumda eski
 * kalıbı alıntılayabilmeli, yoksa taşınan bilgi silinir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const KOK = join(__dirname, '..', '..');            // → src/
const oku = (gore: string) => join(KOK, gore);

/** Kod satırları: tam yorum satırı ve satır sonu `// …` çıkarılır. */
function kodSatirlari(p: string): Array<{ n: number; kod: string }> {
  return readFileSync(p, 'utf-8').split('\n')
    .map((s, i) => ({ n: i + 1, kod: /^\s*(\*|\/\*|\/\/)/.test(s) ? '' : s.replace(/\/\/.*$/, '') }));
}
const suclu = (dosyalar: string[], desen: RegExp): string[] => {
  const out: string[] = [];
  for (const p of dosyalar) for (const { n, kod } of kodSatirlari(p)) if (desen.test(kod)) out.push(`${p.split('/src/')[1]}:${n}`);
  return out;
};

// ── 1) Mikro'ya YAZAN istemci gövdelerinde sayısal varsayılan YOK ────────────
describe("DEĞİŞMEZ: /api/mikro/* gövdesinde `kdvOran`/`depoNo` varsayılanı YOK", () => {
  const ISTEMCI = [oku('App.tsx'), oku('pages/OrdersPage.tsx'), oku('services/mikroService.ts'), oku('services/mikroEvrak.ts')];

  it('tarama gerçekten oldu (dosyalar okunabildi)', () => {
    for (const p of ISTEMCI) expect(readFileSync(p, 'utf-8').length, p).toBeGreaterThan(100);
  });

  it('`kdvOran: … ?? 20` / `|| 20` biçiminde gövde alanı KALMADI', () => {
    // Sunucu `sayiGerekli(fatura.kdvOran, 'KDV oranı')` ile throw ediyor; istemci
    // varsayılan koyarsa o kapı boşa düşer ve YANLIŞ KDV Mikro'ya yazılır.
    expect(suclu(ISTEMCI, /\bkdvOran:\s*[^,;}]*(\?\?|\|\|)\s*\d/)).toEqual([]);
  });

  it('`depoNo: … ?? 1` biçiminde gövde alanı KALMADI (depo 1 = HAVALİMANI)', () => {
    expect(suclu(ISTEMCI, /\bdepoNo:\s*[^,;}]*(\?\?|\|\|)\s*\d/)).toEqual([]);
  });

  it('desen gerçekten yakalıyor (pozitif kontrol)', () => {
    expect(/\bkdvOran:\s*[^,;}]*(\?\?|\|\|)\s*\d/.test('kdvOran: order.kdvOran ?? 20,')).toBe(true);
    expect(/\bkdvOran:\s*[^,;}]*(\?\?|\|\|)\s*\d/.test('kdvOran: order.kdvOran,')).toBe(false);
    expect(/\bdepoNo:\s*[^,;}]*(\?\?|\|\|)\s*\d/.test('depoNo: shipment.depoNo ?? 1,')).toBe(true);
  });
});

// ── 2) Saatlik cron, eşlemenin KOPYASINI taşımaz ─────────────────────────────
describe('DEĞİŞMEZ: crons.ts cari eşlemesi tek kaynaktan (eslemeCari)', () => {
  const CRONS = oku('server/crons.ts');

  it('`cariEsle` GERÇEKTEN import ediliyor (yalnız yorumda geçmesi yetmez)', () => {
    const kod = kodSatirlari(CRONS).map(x => x.kod).join('\n');
    expect(/import\s*\{[^}]*\bcariEsle\b[^}]*\}\s*from\s*'\.\/mikro\/eslemeCari\.js'/.test(kod)).toBe(true);
  });

  it("Mikro cari kolonlarında `|| ''` / `?? ''` sahte-varsayılanı KALMADI", () => {
    // `email: (c.cari_EMail as string) || ''` → `batch.update` ile elle girilmiş
    // e-postayı SİLİYORDU (pgShim.mergeDocData boş metni doğrudan yazar).
    expect(suclu([CRONS], /cari_(EMail|CepTel|vdaire_no|vdaire_adi|unvan1)[^\n]*(\|\||\?\?)\s*''/)).toEqual([]);
  });

  it('`Number(c.cari_hareket_tipi ?? 0)` sahte tip varsayımı KALMADI (Tedarikçi → Customer)', () => {
    expect(suclu([CRONS], /cari_(hareket_tipi|efatura_fl)[^\n]*\?\?\s*0/)).toEqual([]);
  });
});

// ── 3) Saatlik cron, stok ad/birimini EZMEZ ──────────────────────────────────
describe('DEĞİŞMEZ: crons.ts stok güncellemesi elle düzeltilmiş ad/birimi ezmez', () => {
  const CRONS = oku('server/crons.ts');

  it("`sto_isim … || sku` ve `sto_birim1_ad … || 'ADET'` KALMADI", () => {
    expect(suclu([CRONS], /sto_isim[^\n]*(\|\||\?\?)\s*sku/)).toEqual([]);
    expect(suclu([CRONS], /sto_birim1_ad[^\n]*(\|\||\?\?)\s*'ADET'/)).toEqual([]);
  });

  it('desen gerçekten yakalıyor (pozitif kontrol)', () => {
    expect(/sto_isim[^\n]*(\|\||\?\?)\s*sku/.test("  name: (s.sto_isim as string) || sku,")).toBe(true);
    expect(/sto_isim[^\n]*(\|\||\?\?)\s*sku/.test("  const mikroAd = (s.sto_isim as string | undefined)?.trim() || '';")).toBe(false);
  });
});
