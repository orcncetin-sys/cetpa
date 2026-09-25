/**
 * degismezTarayici.test.ts — paylaşılan SERT tarayıcısı KENDİNİ sınar (2026-09-24, Faz 3 6b).
 *
 * §0  `rapor6a.degismez.test.ts` §0'ın yedi mutasyon-ayırt-edici vakası AYNEN taşındı (1–7) + 6b'nin
 *     ölçtüğü üç GERÇEK fikstür (8–10): yorum satırındaki anma, tek satırda iki sınıf, `?? 1) || 1`.
 * §0b desen METNİ PLAN-v2 §5 ile birebir kilitli: ölçüyü yeşile çevirmenin yolu deseni gevşetmek DEĞİLDİR.
 *
 * Saf: dosya okumaz, fikstürler metindir. Dosya okuyan ölçü `rapor6b.degismez.test.ts`'tedir
 * (§0c geçici kopya çiti, §1 SERT = 0, §1b izin disiplini, §2 K9).
 */
import { describe, it, expect } from 'vitest';
import { SERT_DESENLERI, SINIFLAR, sertIhlalleri, type Sinif } from './degismezTarayici';

describe('§0 · tarayıcı kendini sınar (mutasyon-ayırt-edici fikstürler)', () => {
  const sinif = (metin: string, s: Sinif) => sertIhlalleri('f.ts', metin).filter(i => i.sinif === s).length;

  // 1–7: rapor6a.degismez.test.ts §0 ile BİREBİR (taşındı, değiştirilmedi).
  it('1 · kodda `|| 0` / `?? 0` / şablon içi `?? 0` → S1', () => {
    expect(sinif('const v = o.totalPrice || 0;', 'S1')).toBe(1);
    expect(sinif('const v = x ?? 0;', 'S1')).toBe(1);
    expect(sinif('const s = `${pct ?? 0}%`;', 'S1')).toBe(1);
  });

  it('2 · yorumdaki anma SAYILMAZ (satır başı, satır sonu, blok, JSX)', () => {
    expect(sinif('// eski hesap: const v = o.totalPrice || 0;', 'S1')).toBe(0);
    expect(sinif('const a = b; // eski || 0', 'S1')).toBe(0);
    expect(sinif(['/**', ' * eski payda: toplam ?? 1 idi', ' */'].join('\n'), 'S3')).toBe(0);
    expect(sinif('        {/* || 0 */}', 'S1')).toBe(0);
  });

  it('3 · blok yorumdan SONRAKİ ihlalin satır numarası kaymaz', () => {
    const fikstur = ['/* satır 1', '   satır 2', '   satır 3 */', 'const x = y || 0;'].join('\n');
    const bulgular = sertIhlalleri('f.ts', fikstur);
    expect(bulgular.map(i => `${i.satir}:${i.sinif}`)).toEqual(['4:S1']);
  });

  it('4 · URL içindeki `//` kodu yutmaz', () => {
    expect(sinif("const u = 'https://x.test' || 0;", 'S1')).toBe(1);
  });

  it('5 · S3 kelime sınırı: `?? 5`/`|| 1`/`?? 999`/`* 0.6`/`Number(e.target.value)` yakalanır, komşuları değil', () => {
    expect(sinif('const t = i.lowStockThreshold ?? 5;', 'S3')).toBe(1);
    expect(sinif('const p = payda || 1;', 'S3')).toBe(1);
    expect(sinif('const k = gun ?? 999;', 'S3')).toBe(1);
    expect(sinif('const c = li.price * 0.6;', 'S3')).toBe(1);
    expect(sinif('onChange={e => setX(Number(e.target.value))}', 'S3')).toBe(1);
    expect(sinif('const a = x || 10;', 'S3')).toBe(0);
    expect(sinif('const b = x ?? 15;', 'S3')).toBe(0);
    expect(sinif('const c = li.price * 0.65;', 'S3')).toBe(0);
  });

  it('6 · S2 yalnız hayalet çubuk tabanını yakalar', () => {
    expect(sinif('const o = Math.max(...xs, 1);', 'S2')).toBe(1);
    expect(sinif('const o = Math.max(2, p);', 'S2')).toBe(1);
    expect(sinif('const o = Math.max(h, 2);', 'S2')).toBe(1);
    expect(sinif('const o = Math.max(a, b);', 'S2')).toBe(0);
    expect(sinif('const o = Math.min(h, 100);', 'S2')).toBe(0);
  });

  it('7 · meşru başlatıcılar/karşılaştırmalar TAKILMAZ', () => {
    for (const metin of [
      'const acc = { count: 0, rev: 0 };',
      'const t = xs.reduce((s, x) => s + x, 0);',
      'const [n, setN] = useState(0);',
      'if (i === 0) return null;',
      'const bicim = { ondalik: kesirli ? 1 : 0 };',
    ]) expect(sertIhlalleri('f.ts', metin), metin).toEqual([]);
  });

  // 8–10: 6b'nin ÖLÇTÜĞÜ üç gerçek fikstür (baglama-degismez.md §0). Her biri bir mutasyonu ayırt eder.
  it('8 · GB1 gerçek yorum satırı (ölçümde :63, bağlama sonrası :153): satır sonu `//` süzgeci onu ELER', () => {
    // Mutasyon: `yorumsuz`'daki satır sonu `//` süzgeci kaldırılırsa S2 = 1 olur (hafıza dersi:
    // "assertion kendi yorumuna takıldı ×5"). Satır GenelBloklar1.tsx'ten AYNEN alınmıştır.
    const gercekSatir = '        // Eski satır `Math.max(...months166.map(m => m.rev), 1)` idi: `m.rev` artık `ekranTutari`';
    expect(sinif(gercekSatir, 'S2')).toBe(0);
    expect(sertIhlalleri('f.ts', gercekSatir)).toEqual([]);
  });

  it('9 · tek satırda İKİ sınıf (GB3 :213 fikstürü): İKİ kayıt, ikisi de satır 1', () => {
    // Mutasyon: sınıf döngüsü ilk eşleşmede `break`'lerse S2 kaydı düşer ve bir ihlal GÖRÜNMEZ olur.
    const bulgular = sertIhlalleri('f.ts', 'const maxCount = Math.max(...days.map(d => dayCounts[d] || 0), 1);');
    expect(bulgular.map(i => `${i.satir}:${i.sinif}`)).toEqual(['1:S1', '1:S2']);
  });

  it('10 · `Number(liR.quantity ?? 1) || 1` (UrunlerRapor :63 fikstürü): S3 = 1, S1 = 0', () => {
    // `?? 1` ve `|| 1` AYNI satırda → S3 TEK kayıt (satır × sınıf başına en çok bir); `?? 0` yok → S1'e takılmaz.
    const satir = 'const qty = Number(liR.quantity ?? 1) || 1;';
    expect(sinif(satir, 'S3')).toBe(1);
    expect(sinif(satir, 'S1')).toBe(0);
    expect(sinif(satir, 'S2')).toBe(0);
  });
});

describe('§0b · desen metni PLAN-v2 §5 SERT 1–3 ile BİREBİR', () => {
  // Ölçüyü yeşile çevirmenin yolu deseni gevşetmek DEĞİLDİR. Desen değişecekse önce PLAN-v2 §5 değişir,
  // bu liste de onunla birlikte. (6a'nın satır içi kopyasının bu modülle aynı kaldığını
  // `rapor6b.degismez.test.ts` §0c çitler; zincir: 6a metni ≡ modül ≡ bu liste.)
  const BEKLENEN_KAYNAK: Readonly<Record<Sinif, readonly string[]>> = {
    S1: ['(\\|\\||\\?\\?)\\s*0\\b'],
    S2: ['Math\\.max\\([^;]*,\\s*1\\)', 'Math\\.max\\(\\s*[234]\\s*,', 'Math\\.max\\([^;]*,\\s*[234]\\)'],
    S3: ['(\\?\\?|\\|\\|)\\s*(1|5|999)\\b', '\\*\\s*0\\.6\\b', 'Number\\(e\\.target\\.value\\)'],
  };

  it('SINIFLAR = S1, S2, S3 (sıra dâhil)', () => {
    expect([...SINIFLAR]).toEqual(['S1', 'S2', 'S3']);
  });

  for (const s of SINIFLAR) {
    it(`${s} desenlerinin .source'u sabit listeyle birebir`, () => {
      expect(SERT_DESENLERI[s].map(d => d.source)).toEqual(BEKLENEN_KAYNAK[s]);
    });
  }

  it('desenler BAYRAKSIZ (`g` olsaydı `.test` lastIndex taşır, aynı deseni bir sonraki satırda kaçırırdı)', () => {
    for (const s of SINIFLAR) for (const d of SERT_DESENLERI[s]) expect(d.flags, `${s} /${d.source}/`).toBe('');
  });
});
