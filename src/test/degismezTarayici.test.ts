/**
 * degismezTarayici.test.ts — paylaşılan SERT tarayıcısı ve ORTAK yorum süzgeci KENDİNİ sınar
 * (2026-09-24, Faz 3 6b; yorum süzgeci bölümleri 2026-10-08, şartname yorum-suzgeci-v2 K9).
 *
 * §0  SERT fikstürleri: 6a'nın yazdığı yedi mutasyon-ayırt-edici vaka (1–7) + 6b'nin ölçtüğü üç GERÇEK
 *     fikstür (8–10): yorum satırındaki anma, tek satırda iki sınıf, `?? 1) || 1`.
 * §0b desen METNİ PLAN-v2 §5 ile birebir kilitli: ölçüyü yeşile çevirmenin yolu deseni gevşetmek DEĞİLDİR.
 * §1  yorum süzgeci · korunan yedi belirteç türü (tür başına AYRI fikstür)
 * §2  yorum süzgeci · gerçek yorum biçimleri ve çıktı sözleşmesi
 * §3  yorum süzgeci · satır sonları ve shebang
 * §4  yorum süzgeci · eski süzgecin kör kaldığı dosyalardan BİREBİR satırlar
 * §5  ad denetimi ve tür seçimi
 * §6  katı (tam dosya) ↔ hoşgörülü (parça) giriş; tanı kaynağının paritesi
 * §7  önbellek
 * §8  bilinen sınırlar (SABİTLEME — onay değil)
 * §9  DEPO ÇİTİ: bütün kaynaklarda modül ≡ bağımsız kâhin
 * §10 ÇİT: dosya içeriği hoşgörülü girişe verilmez
 *
 * §0–§8 saf: dosya okumaz, fikstürler metindir. §9–§10 depoyu okur (`src` ağacı + kök `server.ts`).
 * SERT ölçüsünün dosya okuyan tarafı `rapor6b.degismez.test.ts`'tedir (§1 SERT = 0, §1b izin disiplini,
 * §2 K9); 6a'nın üç dosyası için `rapor6a.degismez.test.ts` §1 / §1b.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { SERT_DESENLERI, SINIFLAR, sertIhlalleri, yorumsuz, yorumsuzParca, type Sinif } from './degismezTarayici';
import { kahinSatirlari } from './yorumKahini';
import { SRC_KOK, gorece, oku } from './kaynakTarama';

// `typescript` paketinin dışa aktarımları yalnız-okunur alıcılardır: `vi.spyOn(ts, 'createSourceFile')`
// tek başına «Cannot redefine property» ile düşer (ölçüldü 2026-10-08, 5.9.3). Modül bu yüzden YAZILABİLİR
// bir kopyasıyla değiştirilir — işlevler AYNI işlevlerdir, yalnız kap değişir. `degismezTarayici.ts` ve
// `yorumKahini.ts` de aynı kopyayı görür; §6 ve §7 bu kopyanın `createSourceFile` özelliğini casuslar.
vi.mock('typescript', async importOriginal => {
  const gercek = await importOriginal<{ default: typeof ts }>();
  const kopya = { ...gercek.default };
  return { ...kopya, default: kopya };
});

// U+2028 / U+2029 / BOM kaynağa KODLA yazılır: kaçış dizisi ya da ham karakter yazılınca araç katmanı
// ham karaktere çeviriyor, derleme kırılıyor (şartname K1 — ölçüldü).
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const BOM = String.fromCharCode(0xFEFF);

const bosluksuz = (s: string): string => s.replace(/\s/g, '');

// Katı girişten geçen her fikstür ÜÇ ölçüye birden vurulur: dönen değer modülün çıktısıdır (çağıran onu
// bayt bayt bekler); burada ayrıca satır sayısının korunduğu ve bağımsız kâhinin (yorumKahini.ts — başka
// yöntem: belirteç kaplama maskesi) boşluk hariç AYNI kodu verdiği ölçülür. Depo çiti (§9) üretim kodunda
// içinde açıcı geçen JSX metni / şablon sonu örneği bulamaz; iki türetimin o türlerdeki uyumu buradan görülür.
function kati(dosyaAdi: string, girdi: string): string[] {
  const cikti = yorumsuz(dosyaAdi, girdi);
  expect(cikti, `satır sayısı korunmadı: ${JSON.stringify(girdi)}`).toHaveLength(girdi.split('\n').length);
  expect(cikti.map(bosluksuz), `modül ≠ kâhin: ${JSON.stringify(girdi)}`).toEqual(kahinSatirlari(dosyaAdi, girdi).map(bosluksuz));
  return cikti;
}

const hataIletisi = (f: () => unknown): string => {
  try { f(); } catch (e) { return e instanceof Error ? e.message : String(e); }
  return '';
};

describe('§0 · tarayıcı kendini sınar (mutasyon-ayırt-edici fikstürler)', () => {
  // `dosya` ayrıştırma türünü de seçer: JSX taşıyan fikstür `.tsx` adıyla verilir (katı giriş `.ts` adıyla fırlatır).
  const sinif = (metin: string, s: Sinif) => sertIhlalleri('f.ts', metin).filter(i => i.sinif === s).length;
  const sinifTsx = (metin: string, s: Sinif) => sertIhlalleri('f.tsx', metin).filter(i => i.sinif === s).length;

  // 1–7: 6a'nın yedi vakası. `rapor6a.degismez.test.ts` 2026-10-08'de bu modüle bağlandı (satır içi tarayıcı
  // kopyası ve oradaki eş testler kalktı); bu testlerin TEK evi burasıdır. Beklenen değerler değişmedi —
  // yalnız JSX fikstürleri `.tsx` adını aldı ve vaka 5'in çıplak özniteliği geçerli TSX'e tamamlandı.
  it('1 · kodda `|| 0` / `?? 0` / şablon içi `?? 0` → S1', () => {
    expect(sinif('const v = o.totalPrice || 0;', 'S1')).toBe(1);
    expect(sinif('const v = x ?? 0;', 'S1')).toBe(1);
    expect(sinif('const s = `${pct ?? 0}%`;', 'S1')).toBe(1);
  });

  it('2 · yorumdaki anma SAYILMAZ (satır başı, satır sonu, blok, JSX)', () => {
    expect(sinif('// eski hesap: const v = o.totalPrice || 0;', 'S1')).toBe(0);
    expect(sinif('const a = b; // eski || 0', 'S1')).toBe(0);
    expect(sinif(['/**', ' * eski payda: toplam ?? 1 idi', ' */'].join('\n'), 'S3')).toBe(0);
    expect(sinifTsx('        {/* || 0 */}', 'S1')).toBe(0);
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
    expect(sinifTsx('const e = <input onChange={e => setX(Number(e.target.value))} />;', 'S3')).toBe(1);
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
  // bu liste de onunla birlikte. (6a artık deseni bu modülden içe aktarır; satır içi kopya ve onu çitleyen
  // `rapor6b` §0c paritesi 2026-10-08'de kalktı — zincir: modül ≡ bu liste.)
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

describe('§1 · yorum süzgeci: korunan yedi belirteç türü (tür başına AYRI fikstür)', () => {
  // Her fikstürde yorum açıcıya BENZEYEN metin yalnız o türün içindedir; satırın sonunda bir de GERÇEK
  // yorum durur. Tür `KORUNAN` kümesinden çıkarılırsa tarama o metni yorum sayar ve o türün fikstürü
  // kırılır, öteki türlerinki yeşil kalır (mutasyon tablosu: yedi türün her biri ayrı ayrı kırmızı).
  it('StringLiteral · tek ve çift tırnaklı dize', () => {
    expect(kati('f.ts', `const a = 'x // y /* z'; const b = "p /* q"; // gerçek`))
      .toEqual([`const a = 'x // y /* z'; const b = "p /* q"; `]);
    // Dizedeki blok açıcı SONRAKİ satırları yutmaz (eski süzgecin asıl arızası).
    expect(kati('f.ts', ['const a = "x /* y";', 'const b = 2; // gerçek */'].join('\n')))
      .toEqual(['const a = "x /* y";', 'const b = 2; ']);
    // Kaçışlı tırnak dizeyi bitirmez.
    expect(kati('f.ts', String.raw`const a = 'it\'s // y'; /* gerçek */`)).toEqual([String.raw`const a = 'it\'s // y'; `]);
    // Yönerge, içe aktarım yolu, tür değişmezi ve nesne anahtarı da aynı belirteç türüdür.
    expect(kati('f.ts', ["'use // strict';", "import x from 'https://a.test/*.js'; // gerçek", "type T = 'a//b'; /* gerçek */", "const o = { 'c/*d': 1 }; // gerçek"].join('\n')))
      .toEqual(["'use // strict';", "import x from 'https://a.test/*.js'; ", "type T = 'a//b'; ", "const o = { 'c/*d': 1 }; "]);
  });

  it('StringLiteral · JSX özniteliği dizesi (`accept` tür jokeri)', () => {
    expect(kati('f.tsx', ['const e = <input type="file" accept="image/*" />;', 'const b = 1; /* gerçek */'].join('\n')))
      .toEqual(['const e = <input type="file" accept="image/*" />;', 'const b = 1; ']);
    expect(kati('f.tsx', `const e = <a href='https://x.test/*'>k</a>; // gerçek`))
      .toEqual([`const e = <a href='https://x.test/*'>k</a>; `]);
  });

  it('NoSubstitutionTemplateLiteral · yer tutucusuz şablon (çok satırlı gövde dâhil)', () => {
    expect(kati('f.ts', 'const a = `x // y /* z`; const b = 1; // gerçek')).toEqual(['const a = `x // y /* z`; const b = 1; ']);
    const stil = ['const stil = `', '  /* stil notu: yorum DEĞİL, dize içeriği */', '  a { b: c } // d', '`; // gerçek'];
    expect(kati('f.ts', stil.join('\n'))).toEqual([...stil.slice(0, 3), '`; ']);
  });

  it('TemplateHead · şablon başı', () => {
    expect(kati('f.ts', 'const a = `// baş /* ${x} orta ${y} son`; const b = 1; // gerçek'))
      .toEqual(['const a = `// baş /* ${x} orta ${y} son`; const b = 1; ']);
  });

  it('TemplateMiddle · şablon ortası', () => {
    expect(kati('f.ts', 'const a = `baş ${x} // orta /* ${y} son`; const b = 1; // gerçek'))
      .toEqual(['const a = `baş ${x} // orta /* ${y} son`; const b = 1; ']);
  });

  it('TemplateTail · şablon sonu (`${x} // kuyruk`)', () => {
    expect(kati('f.ts', 'const a = `${x} // kuyruk /*`; const b = 1; // gerçek'))
      .toEqual(['const a = `${x} // kuyruk /*`; const b = 1; ']);
  });

  it('RegularExpressionLiteral · düzenli ifade değişmezi', () => {
    expect(kati('f.ts', String.raw`const r = /^\//; const b = 1; // gerçek`)).toEqual([String.raw`const r = /^\//; const b = 1; `]);
    // Karakter sınıfındaki blok açıcı sonraki satırları yutmaz.
    expect(kati('f.ts', ['const r = /[/*]+/g;', 'const b = 1; // gerçek'].join('\n'))).toEqual(['const r = /[/*]+/g;', 'const b = 1; ']);
    // Bölme işleci düzenli ifade DEĞİLDİR: ardındaki yorum yorumdur.
    expect(kati('f.ts', 'const q = a / b; // gerçek')).toEqual(['const q = a / b; ']);
  });

  it("JsxText · JSX metni (kesme işareti dize AÇMAZ: «Mikro'ya»)", () => {
    expect(kati('f.tsx', "const e = <p>a // b /* c */ Mikro'ya</p>; // gerçek")).toEqual(["const e = <p>a // b /* c */ Mikro'ya</p>; "]);
    const cok = ['const e = (', '  <p>', '    bkz. http://x.test // not', "    /* yorum değil */ Mikro'ya", '    {/* gerçek */}', '  </p>', ');'];
    expect(kati('f.tsx', cok.join('\n'))).toEqual([...cok.slice(0, 4), '    {}', '  </p>', ');']);
    // JSX metni `pos`'tan korunur, `getStart`'tan DEĞİL: `getStart` satır başındaki `=======` ayracını
    // birleştirme çakışması imi sayıp metnin kalanını atlar; aralık boş kalır, ardındaki `//` yorum sanılırdı.
    // (Ayrıştırıcı bu metinde tanı vermez. Kâhin aynı tuzağa düşüyordu — bu fikstür buldu, düzeltildi.)
    const ayrac = ['const e = (', '  <pre>', '======= // ayraç', '  </pre>', ');'];
    expect(kati('f.tsx', ayrac.join('\n'))).toEqual(ayrac);
    // Korunan aralığın BAŞI: metin `>` / `}`'den hemen sonra açıcıyla başlasa da JSX metnidir.
    expect(kati('f.tsx', 'const e = <p>// x</p>; // gerçek')).toEqual(['const e = <p>// x</p>; ']);
    expect(kati('f.tsx', 'const e = <p>{a}/* x */ b</p>; // gerçek')).toEqual(['const e = <p>{a}/* x */ b</p>; ']);
  });

  it('korunan aralık belirtecin KENDİ başından başlar: değişmezden ÖNCEKİ yorum silinir', () => {
    // Mutasyon: aralık `getStart` yerine `pos`'tan başlarsa (pos önceki boşluğu ve yorumu da kapsar) bu
    // yorumlar korunan aralığa düşer ve çıktıda kalır. Tür başına bir satır: dize (blok + satır yorumu),
    // düzenli ifade, yer tutucusuz şablon + şablon başı, şablon ortası + sonu.
    expect(kati('f.ts', "const a = /* y */ 'x';")).toEqual(["const a =  'x';"]);
    expect(kati('f.ts', ['const l = [ // y', "  'k',", '];'].join('\n'))).toEqual(['const l = [ ', "  'k',", '];']);
    expect(kati('f.ts', 'const r = /* y */ /a/;')).toEqual(['const r =  /a/;']);
    expect(kati('f.ts', 'const t = /* y */ `a`; const u = /* z */ `a${x}b`;')).toEqual(['const t =  `a`; const u =  `a${x}b`;']);
    expect(kati('f.ts', 'const v = `a${ x /* y */ }b${ z /* w */ }c`;')).toEqual(['const v = `a${ x  }b${ z  }c`;']);
  });

  it('iç içe şablon: her düzeyin metni korunur, yer tutucudaki yorum silinir', () => {
    expect(kati('f.ts', 'const s = `a${ `b // c ${ d /* gerçek */ } // e` }f // g`; // gerçek'))
      .toEqual(['const s = `a${ `b // c ${ d  } // e` }f // g`; ']);
  });

  it('bitişik korunan aralıklar · aralık SONU · tür konumundaki şablon', () => {
    expect(kati('f.ts', "const s = `${'//'}`; const v = y || 0; // gerçek")).toEqual(["const s = `${'//'}`; const v = y || 0; "]);
    expect(kati('f.ts', 'const n = /a/*2; const v = y || 0; // gerçek */')).toEqual(['const n = /a/*2; const v = y || 0; ']);
    expect(kati('f.ts', 'type U = `https://${string}`; const v = y || 0; // gerçek')).toEqual(['type U = `https://${string}`; const v = y || 0; ']);
  });

  it('tür konumundaki JSDoc tür düğümü yorum DEĞİLDİR: modül ≡ kâhin, ikisi de korur', () => {
    // Kâhin eskiden `FirstJSDocNode..LastJSDocNode` aralığının tamamını yorum sayıp `string?` türünü siliyordu.
    expect(kati('f.ts', 'let z: string? = g(); kalmali(); // gerçek')).toEqual(['let z: string? = g(); kalmali(); ']);
  });
});

describe('§2 · yorum süzgeci: gerçek yorum biçimleri ve çıktı sözleşmesi', () => {
  it('satır yorumu: satır sonuna kadar silinir, öncesindeki metin (boşluk dâhil) aynen kalır', () => {
    expect(kati('f.ts', 'const a = 1; // y\nconst b = 2;')).toEqual(['const a = 1; ', 'const b = 2;']);
    expect(kati('f.ts', '  // y\nconst b = 2;')).toEqual(['  ', 'const b = 2;']);
    expect(kati('f.ts', 'const a = 1; //// y // z')).toEqual(['const a = 1; ']);
    expect(kati('f.ts', '/// <reference types="vite/client" />\nconst a = 1;')).toEqual(['', 'const a = 1;']);
  });

  it('blok yorum ve JSDoc: yalnız satır sonları kalır (satır numarası korunur)', () => {
    expect(kati('f.ts', 'const a = /* y */ 1;')).toEqual(['const a =  1;']);
    expect(kati('f.ts', 'const a = 1; /* y\n z\n w */ const b = 2;')).toEqual(['const a = 1; ', '', ' const b = 2;']);
    expect(kati('f.ts', '/**\n * a\n */\nconst b = 2;')).toEqual(['', '', '', 'const b = 2;']);
    // Etiketli JSDoc: ayrıştırıcı etiketleri düğüme çevirir (kâhin onları atlar); modül için düz blok yorumdur.
    expect(kati('f.ts', '/**\n * @param a açıklama // x\n * @returns {number} sonuç\n */\nfunction f(a: string): number { return 1; }'))
      .toEqual(['', '', '', '', 'function f(a: string): number { return 1; }']);
  });

  it('JSX süslü-yorumu ve şablon yer tutucusundaki yorum', () => {
    const jsx = ['const e = (', '  <div>', '    {/* y', '        z */}', '    <b>k</b>', '  </div>', ');'];
    expect(kati('f.tsx', jsx.join('\n'))).toEqual(['const e = (', '  <div>', '    {', '}', '    <b>k</b>', '  </div>', ');']);
    expect(kati('f.tsx', 'const e = <a href={u} /* y */ title="t">k</a>;')).toEqual(['const e = <a href={u}  title="t">k</a>;']);
    expect(kati('f.ts', 'const a = `a${ /* y */ x }b`;')).toEqual(['const a = `a${  x }b`;']);
  });

  it('`//` içindeki blok açıcı yorum AÇMAZ; blok içindeki `//` bloğu satır sonuna UZATMAZ', () => {
    // İlki eski süzgecin `kaynakTarama.ts`'te üç içe aktarım satırını yutan arızasıdır (§4'te birebir satırıyla).
    expect(kati('f.ts', 'const a = 1; // y /* z\nconst b = 2;\nconst c = 3; // */')).toEqual(['const a = 1; ', 'const b = 2;', 'const c = 3; ']);
    expect(kati('f.ts', 'const a = 1; /* y // z */ const b = 2;')).toEqual(['const a = 1;  const b = 2;']);
  });

  it('tek satırda birden çok yorum', () => {
    expect(kati('f.ts', 'const a /* 1 */ = /* 2 */ 1; // 3')).toEqual(['const a  =  1; ']);
  });

  it('en kısa blok yorumlar: `/**/` boş yorumdur; `/*/ x */` TEK yorumdur', () => {
    // Kapanış açılıştan 2 karakter SONRA aranır: açıcının yıldızı kapatıcının yıldızı sayılmaz.
    expect(kati('f.ts', 'const a = 1; /**/ const b = 2;')).toEqual(['const a = 1;  const b = 2;']);
    expect(kati('f.ts', 'const a = 1; /*/ x */ const b = 2;')).toEqual(['const a = 1;  const b = 2;']);
  });

  it('kapanmayan blok yorum dosya sonuna kadar sürer (yalnız parça girişinde görülür; katı giriş fırlatır)', () => {
    const acik = 'const a = 1; /* y\nz\nw';
    expect(yorumsuzParca('f.ts', acik)).toEqual(['const a = 1; ', '', '']);
    expect(() => yorumsuz('f.ts', acik)).toThrow(/TS1010/);
  });

  it('eski `://` kuralı KALKTI: iki noktadan hemen sonraki yorum da silinir; URL dizesi kesilmez', () => {
    // Eski süzgeç `//`'den önce iki nokta görünce yorumu BIRAKIYORDU (URL'yi korumak için); dizeyi artık
    // ayrıştırıcı koruyor, kural gereksizleşti ve `a ? b ://c` yorumunu sızdırmıyor.
    expect(kati('f.ts', 'const v = a ? b ://c\n  d;')).toEqual(['const v = a ? b :', '  d;']);
    expect(kati('f.ts', "const u = 'https://x.test'; // y")).toEqual(["const u = 'https://x.test'; "]);
  });

  it('çıktı sözleşmesi: dönüş satır dizisidir; yorumsuz girdi bayt bayt aynı döner', () => {
    const yorumYok = "import a from './a';\n\n\texport const b = `x${a}y`;\r\n  const c = 'd';  \n";
    expect(kati('f.ts', yorumYok).join('\n')).toBe(yorumYok);
    expect(yorumsuz('f.ts', '')).toEqual(['']);
    expect(yorumsuz('f.ts', '// y')).toEqual(['']);
    expect(yorumsuz('f.ts', '\n\n')).toEqual(['', '', '']);
  });
});

describe('§3 · yorum süzgeci: satır sonları ve shebang', () => {
  it('CRLF: satır yorumu `\\r`\'yi YUTMAZ (çıktıda kalır); blok yorumun içindeki `\\r` yorumla birlikte gider', () => {
    expect(kati('f.ts', 'const a = 1; // y\r\nconst b = 2; /* z\r\n w */ const c = 3;\r\n'))
      .toEqual(['const a = 1; \r', 'const b = 2; ', ' const c = 3;\r', '']);
  });

  it('satır yorumu TypeScript\'in satır sonu kümesinin HER üyesinde biter: tek başına CR, U+2028, U+2029', () => {
    // Üçünde de sonraki kod aynı «\n satırında» kalır ve silinmemelidir; satır sonu karakteri çıktıda durur.
    expect(kati('f.ts', 'const a = 1; // y\rconst b = 2;')).toEqual(['const a = 1; \rconst b = 2;']);
    expect(kati('f.ts', `const a = 1; // y${LS}const b = 2;`)).toEqual([`const a = 1; ${LS}const b = 2;`]);
    expect(kati('f.ts', `const a = 1; // y${PS}const b = 2;`)).toEqual([`const a = 1; ${PS}const b = 2;`]);
  });

  it('dosya sonunda satır sonu OLMADAN biten satır yorumu', () => {
    expect(kati('f.ts', 'const a = 1; // y')).toEqual(['const a = 1; ']);
    expect(kati('f.ts', 'const a = 1;\n// y')).toEqual(['const a = 1;', '']);
  });

  it('shebang satırı koddur: içindeki `//` yorum sayılmaz, sonraki satırlar olağan süzülür', () => {
    // Kâhin de shebang'i kod sayar (§8); karşılaştırma orada.
    expect(yorumsuz('betik.mjs', '#!/usr/bin/env -S node --import file:///x/kanca.mjs // yorum değil\nconst a = 1; // y'))
      .toEqual(['#!/usr/bin/env -S node --import file:///x/kanca.mjs // yorum değil', 'const a = 1; ']);
    expect(yorumsuz('betik.ts', '#!/usr/bin/env tsx\n// y\nconst a = 1;')).toEqual(['#!/usr/bin/env tsx', '', 'const a = 1;']);
  });
});

describe('§4 · yorum süzgeci: eski süzgecin kör kaldığı dosyalardan BİREBİR satırlar', () => {
  // Ölçüm 2026-10-08: eski gövde (iki düzenli ifade) 9 üretim dosyasında 98 kod satırını çitlerden
  // saklıyordu. Aşağıdaki satırlar o dosyalardan AYNEN alındı (yalnız çevresi geçerli dosyaya tamamlandı);
  // her birinde eski süzgecin kestiği yer ve yuttuğu sonraki satırlar beklentide yerindedir.
  it('TahsilatModule.tsx:1243 `accept="image/*,application/pdf"` — eski süzgeçte 26 satır kördü', () => {
    const satirlar = [
      'const e = (',
      '  <>',
      '    <label>',
      `                        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { void handleMakbuzUpload(e.target.files?.[0]); e.target.value = ''; }} />`,
      '                      </label>',
      '      {/* ── Delete Confirm Modal ─────────────────────────────────────────────── */}',
      '  </>',
      ');',
    ];
    expect(kati('TahsilatModule.tsx', satirlar.join('\n'))).toEqual([...satirlar.slice(0, 5), '      {}', '  </>', ');']);
  });

  it('CRMPage.tsx:3666 `accept="audio/*"` — tek satırlık öğe', () => {
    const satir = `                      <input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && handleUploadVoiceNote(e.target.files[0])} className="text-sm" />`;
    expect(kati('CRMPage.tsx', `const e = (\n${satir}\n); /* gerçek */`)).toEqual(['const e = (', satir, '); ']);
  });

  it('server.ts:1406–1411 CSP `connectSrc` (joker alt alan) — eski süzgeçte 25 satır kördü', () => {
    const satirlar = [
      'const csp = {',
      `        connectSrc: ["'self'", 'https://*.googleapis.com', 'https://*.firebaseio.com',`,
      `          'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com',`,
      `          'wss://*.firebaseio.com', 'https://api.tcmb.gov.tr', 'https://accounts.google.com',`,
      `          // apis.google.com != *.googleapis.com (different domain) - GAPI's own script`,
      `          // (loaded for Google Sign-In) makes its own fetch/XHR calls here.`,
      `          'https://apis.google.com', 'https://www.gstatic.com'],`,
      '};',
      '  /** General API — 300 req / 15 min per IP */',
    ];
    expect(kati('server.ts', satirlar.join('\n')))
      .toEqual([...satirlar.slice(0, 4), '          ', '          ', satirlar[6], '};', '  ']);
  });

  it('App.tsx:721 ve useRouteSync.ts:31 yolu kırpan düzenli ifade `/^\\//` — satırın kalanı kesiliyordu', () => {
    const app = String.raw`    const path = window.location.pathname.replace(/^\//, '').split('/')[0];`;
    const kanca = String.raw`  const seg = pathname.replace(/^\//, '').split('/')[0];`;
    expect(kati('App.tsx', `${app} // gerçek\n${kanca}`)).toEqual([`${app} `, kanca]);
  });

  it('kaynakTarama.ts:10 satır yorumu içindeki blok açıcı — 16–18. satırlardaki içe aktarımlar yutuluyordu', () => {
    const satirlar = [
      "// yalnız başındaki `*`/`/*`/`//` ile yorum sayar: `*`'sız blok-yorum satırını KOD sayar, `https://`",
      "import { readFileSync, readdirSync, statSync } from 'fs';",
      "import { join, relative } from 'path';",
      "import { yorumsuz } from './degismezTarayici';",
      "/** `src/` kökü (bu dosya `src/test/`'te). */",
      "export const SRC_KOK = join(__dirname, '..');",
    ];
    expect(kati('kaynakTarama.ts', satirlar.join('\n'))).toEqual(['', satirlar[1], satirlar[2], satirlar[3], '', satirlar[5]]);
  });
});

describe('§5 · ad denetimi ve tür seçimi', () => {
  const TEMIZ = 'const a = 1; // y';

  it('kabul edilen adlar: TypeScript / JavaScript kaynak uzantıları (yol, boşluk, Türkçe karakter serbest)', () => {
    for (const ad of ['f.ts', 'f.tsx', 'f.js', 'f.jsx', 'f.mjs', 'f.cjs', 'f.mts', 'f.cts', 'f.d.ts', 'src/a b/çğıöşü.test.tsx', 'C:\\x\\y.ts']) {
      expect(yorumsuz(ad, TEMIZ), ad).toEqual(['const a = 1; ']);
      expect(yorumsuzParca(ad, TEMIZ), ad).toEqual(['const a = 1; ']);
    }
  });

  it('reddedilen adlar İKİ girişte de fırlatır: uzantısız, yabancı uzantı, satır sonu içeren ad', () => {
    for (const ad of ['', 'f', 'ts', 'f.css', 'f.json', 'f.md', 'f.ts.bak', 'f.tsxx', 'f.TS', 'f.ts\n', 'a\nb.ts', 'f\r.ts']) {
      expect(() => yorumsuz(ad, TEMIZ), JSON.stringify(ad)).toThrow(/DOSYA ADI olmalı/);
      expect(() => yorumsuzParca(ad, TEMIZ), JSON.stringify(ad)).toThrow(/DOSYA ADI olmalı/);
    }
  });

  it('yer değiştirmiş bağımsız değişkenler (içerik, ad) fırlatır; ileti geleni KISALTARAK ve sırayı söyleyerek taşır', () => {
    expect(() => yorumsuz(TEMIZ, 'f.ts')).toThrow(/DOSYA ADI olmalı/);
    expect(() => yorumsuzParca(TEMIZ, 'f.ts')).toThrow(/DOSYA ADI olmalı/);
    expect(() => yorumsuz('const a = 1;\nconst b = 2;\n', 'f.ts')).toThrow(/DOSYA ADI olmalı/);
    const uzun = `const a = 1; ${'x'.repeat(5000)}`;
    const ileti = hataIletisi(() => yorumsuz(uzun, 'f.ts'));
    expect(ileti).toContain('gelen "const a = 1; xxx');
    expect(ileti).toContain('sıra: ad, içerik');
    expect(ileti.length).toBeLessThan(400);
  });

  it('dize olmayan ad / içerik çalışma anında fırlatır', () => {
    // Tür sistemi bunu derlemede zaten reddeder; denetim JS çağıranı ve `unknown` sızıntısı içindir.
    // `Reflect.apply` bağımsız değişkenleri tür denetiminden geçirmeden verir (dönüşüm yazmadan). `['f.ts']`
    // dizeye çevrilince geçerli ad gibi görünür — `typeof` denetimi olmasa geçerdi.
    for (const ad of [undefined, null, 42, ['f.ts'], { toString: () => 'f.ts' }]) {
      expect(() => Reflect.apply(yorumsuz, undefined, [ad, TEMIZ]), String(ad)).toThrow(/DOSYA ADI olmalı/);
    }
    for (const govde of [undefined, null, 42, ['const a = 1;']]) {
      expect(() => Reflect.apply(yorumsuz, undefined, ['f.ts', govde]), String(govde)).toThrow(/içerik dize olmalı \(f\.ts\)/);
    }
  });

  it('tür seçimi: uzantı `x` ile bitiyorsa TSX, değilse TS — `.js` / `.mjs` de TS olarak (JS türü kullanılmaz)', () => {
    const JSX = 'const e = <p className="k">a // b</p>; // gerçek';
    expect(kati('f.tsx', JSX)).toEqual(['const e = <p className="k">a // b</p>; ']);
    expect(kati('f.jsx', JSX)).toEqual(['const e = <p className="k">a // b</p>; ']);
    // Aynı fikstür TS olarak ayrıştırılamaz → katı giriş fırlatır (yanlış uzantı yüksek sesle düşer).
    // `.js` / `.mjs` JS türüyle ayrışsaydı JSX geçerli olur, fırlatmazdı.
    for (const ad of ['f.ts', 'f.js', 'f.mjs', 'f.cts']) {
      expect(() => yorumsuz(ad, JSX), ad).toThrow(new RegExp(`${ad.replace('.', '\\.')} ayrıştırılamadı`));
    }
    // `<T>x` tür dönüşümü yalnız TS'te dönüşümdür: ardındaki yorum yorumdur.
    const DONUSUM = 'const a = <T>x; // </T>';
    for (const ad of ['f.ts', 'f.js', 'f.mjs', 'f.cts']) expect(kati(ad, DONUSUM), ad).toEqual(['const a = <T>x; ']);
  });

  it('`sertIhlalleri` KATI girişi kullanır ve `dosya` ayrıştırma türünü seçer', () => {
    const jsx = 'const e = <p className="k">bkz. http://x.test</p>; const v = y || 0;';
    expect(sertIhlalleri('f.tsx', jsx).map(i => `${i.dosya}:${i.satir}:${i.sinif}`)).toEqual(['f.tsx:1:S1']);
    expect(() => sertIhlalleri('f.ts', jsx)).toThrow(/f\.ts ayrıştırılamadı/);
    expect(() => sertIhlalleri('f', jsx)).toThrow(/DOSYA ADI olmalı/);
    // Parça (çıplak öznitelik) katı girişten GEÇMEZ: sessizce «ihlal yok» demek yerine fırlatır.
    expect(() => sertIhlalleri('f.tsx', 'onChange={e => setX(Number(e.target.value))}')).toThrow(/ayrıştırılamadı/);
  });
});

// ---------------------------------------------------------------------------
// Bellekten TEK dosya sunan Program (disk yok, kitaplık yok, içe aktarım çözülmez). §6 tanı paritesi ve
// §10 çiti ortak kullanır. Kaynak dosyayı Program KENDİ üretir: tür seçimi de (ad → .ts / .tsx) onundur.
// ---------------------------------------------------------------------------
function bellekProgrami(dosyaAdi: string, metin: string): { program: ts.Program; sf: ts.SourceFile } {
  const sunucu: ts.CompilerHost = {
    getSourceFile: (ad, surum) => (ad === dosyaAdi ? ts.createSourceFile(ad, metin, surum, true) : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: ad => ad,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: ad => ad === dosyaAdi,
    readFile: ad => (ad === dosyaAdi ? metin : undefined),
  };
  const program = ts.createProgram([dosyaAdi], { noResolve: true, noLib: true, types: [] }, sunucu);
  const sf = program.getSourceFile(dosyaAdi);
  if (!sf) throw new Error(`bellek programı: ${dosyaAdi} kaynak dosyası oluşmadı`);
  return { program, sf };
}

describe('§6 · katı (tam dosya) ↔ hoşgörülü (parça) giriş', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const BOZUK = 'const a = 1;\nconst b = ; // y\n';

  it('bozuk girdi: `yorumsuz` FIRLATIR — ileti ad + satır + TS kodu + tanı sayısı + ipucu taşır', () => {
    const ileti = hataIletisi(() => yorumsuz('src/bozuk.ts', BOZUK));
    expect(ileti).toContain('src/bozuk.ts ayrıştırılamadı');
    expect(ileti).toContain('satır 2');
    expect(ileti).toContain('TS1109');
    expect(ileti).toContain('toplam 1 tanı');
    expect(ileti).toContain('`yorumsuzParca` kullan');
    expect(ileti).toContain('uzantı doğru mu');
  });

  it('aynı bozuk girdi: `yorumsuzParca` FIRLATMAZ, yorumları yine süzer', () => {
    expect(yorumsuzParca('src/bozuk.ts', BOZUK)).toEqual(['const a = 1;', 'const b = ; ', '']);
  });

  it('kendi başına geçerli olmayan parçalar: hoşgörülü girişte beklenen çıktı, katı girişte fırlatma', () => {
    // Şartname K4 ölçümü: 111 fikstürün 27'si iki türde de geçerli değil (SQL parçası, açık blok, nesne
    // özelliği satırı, çıplak JSX özniteliği); hepsi hoşgörülü ayrıştırmada beklentisiyle geçiyor.
    const PARCALAR: ReadonlyArray<{ ne: string; ad: string; parca: string; beklenen: string[] }> = [
      { ne: 'nesne özelliği satırı', ad: 'f.ts', parca: '  depoNo: s.depo ?? 1, // varsayılan', beklenen: ['  depoNo: s.depo ?? 1, '] },
      { ne: 'açık blok', ad: 'f.ts', parca: 'if (a) { // y\n  b(); /* z */', beklenen: ['if (a) { ', '  b(); '] },
      {
        ne: 'SQL parçası', ad: 'f.ts',
        parca: "SELECT cha_kod /* a */ FROM CARI_HESAP_HAREKETLERI WHERE cha_cins = 'x//y' // b",
        beklenen: ["SELECT cha_kod  FROM CARI_HESAP_HAREKETLERI WHERE cha_cins = 'x//y' "],
      },
      { ne: 'çıplak JSX özniteliği', ad: 'f.tsx', parca: 'onChange={e => setX(Number(e.target.value))} // y', beklenen: ['onChange={e => setX(Number(e.target.value))} '] },
      { ne: 'fazla kapanış', ad: 'f.ts', parca: 'const a = 1; }\n// y\nconst b = 2;', beklenen: ['const a = 1; }', '', 'const b = 2;'] },
      // Hata kurtarmanın ağaçtan ATTIĞI dize de korunur (içindeki açıcı yorum sayılmaz; satırın kalanı ve sonraki satır silinmez).
      { ne: 'parametre konumuna düşen dize', ad: 'f.ts', parca: 'function f("a//b", x) { kalmali(); }', beklenen: ['function f("a//b", x) { kalmali(); }'] },
      { ne: 'çıplak JSX özniteliğinde adres', ad: 'f.tsx', parca: "href={tamYol('https://cetpa.com.tr/x')} hedef={a ?? 0}", beklenen: ["href={tamYol('https://cetpa.com.tr/x')} hedef={a ?? 0}"] },
      {
        ne: 'çıplak JSX özniteliğinde blok açıcı', ad: 'f.tsx',
        parca: "accept={tur('image/*')} onChange={e => setX(Number(e.target.value))}\nconst ikinci = y || 0;",
        beklenen: ["accept={tur('image/*')} onChange={e => setX(Number(e.target.value))}", 'const ikinci = y || 0;'],
      },
    ];
    for (const p of PARCALAR) {
      expect(yorumsuzParca(p.ad, p.parca), p.ne).toEqual(p.beklenen);
      expect(() => yorumsuz(p.ad, p.parca), p.ne).toThrow(/ayrıştırılamadı/);
    }
  });

  // Tanı kaynağı `SourceFile.parseDiagnostics` İÇ alanıdır (genel API değil). Bu iki test onu çitler:
  // (1) alanın içeriği genel API'nin (`createProgram` + `getSyntacticDiagnostics`) verdiğiyle aynıdır —
  // TypeScript yükseltmesi alanı boşaltır / kaydırırsa burada görülür; (2) alan yoksa ya da biçimi
  // değiştiyse katı giriş sessizce hoşgörülüye DÖNMEZ, her çağrıda fırlatır.
  interface TaniOzeti { kod: number; bas: number }

  function icAlanTanilari(dosyaAdi: string, girdi: string): TaniOzeti[] {
    const sf = ts.createSourceFile(dosyaAdi, girdi, ts.ScriptTarget.Latest, false, /x$/.test(dosyaAdi) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (!('parseDiagnostics' in sf)) throw new Error('parite düzeneği: SourceFile.parseDiagnostics alanı yok');
    const ham: unknown = sf.parseDiagnostics;
    if (!Array.isArray(ham)) throw new Error('parite düzeneği: SourceFile.parseDiagnostics dizi değil');
    const liste: unknown[] = ham;
    return liste.map((d): TaniOzeti => {
      if (typeof d !== 'object' || d === null || !('code' in d) || typeof d.code !== 'number' || !('start' in d) || typeof d.start !== 'number') {
        throw new Error('parite düzeneği: tanı biçimi tanınmadı');
      }
      return { kod: d.code, bas: d.start };
    });
  }

  const PARITE: ReadonlyArray<{ ad: string; girdi: string; temiz: boolean }> = [
    { ad: '/p.ts', girdi: 'const a = 1; // y', temiz: true },
    { ad: '/p.ts', girdi: 'const a = <T>x; /* y */ const s = `a${b}c`;', temiz: true },
    { ad: '/p.tsx', girdi: "const e = <p>a // b /* c */ Mikro'ya</p>;", temiz: true },
    { ad: '/p.d.ts', girdi: 'declare const a: number;', temiz: true },
    { ad: '/p.ts', girdi: BOZUK, temiz: false },
    { ad: '/p.ts', girdi: 'const a = 1; /* y\nz', temiz: false },
    { ad: '/p.ts', girdi: 'if (a) {', temiz: false },
    { ad: '/p.ts', girdi: 'function f( { return 1; }\nclass A { x = ; }', temiz: false },
    { ad: '/p.ts', girdi: "SELECT cha_kod FROM CARI_HESAP_HAREKETLERI WHERE cha_cins = 'x'", temiz: false },
    { ad: '/p.ts', girdi: 'const e = <div className="a">a // b</div>;', temiz: false },   // yanlış uzantı
    { ad: '/p.tsx', girdi: 'const e = <p>a > b</p>;', temiz: false },
    { ad: '/p.tsx', girdi: 'onChange={e => setX(Number(e.target.value))}', temiz: false },
    // Tek tanılı üç kapanmayan belirteç: tanıya kod bazında muafiyet tanıyan (`tanilar[0]` / `.some` / `.every`) mutantı öldürür.
    { ad: '/p.ts', girdi: "const a = 'x // y\nconst b = y || 0; // z", temiz: false },   // TS1002 kapanmayan dize
    { ad: '/p.ts', girdi: 'const a = `x // y\nconst b = y || 0; // z', temiz: false },   // TS1160 kapanmayan şablon
    { ad: '/p.ts', girdi: 'const a = /[x // y\nconst b = y || 0; // z', temiz: false },  // TS1161 kapanmayan düzenli ifade (`[` şart: `/x /` kapanırdı)
  ];

  it('tanı paritesi: iç alan ≡ `createProgram` + `getSyntacticDiagnostics` (kod + başlangıç), hatalı ve temiz girdide', () => {
    for (const { ad, girdi, temiz } of PARITE) {
      const { program, sf } = bellekProgrami(ad, girdi);
      const genel: TaniOzeti[] = program.getSyntacticDiagnostics(sf).map(d => ({ kod: d.code, bas: d.start }));
      expect(icAlanTanilari(ad, girdi), `${ad} ${JSON.stringify(girdi)}`).toEqual(genel);
      expect(genel.length === 0, `${ad} ${JSON.stringify(girdi)} · tanı ${genel.length}`).toBe(temiz);

      // Modülün GÖRDÜĞÜ de aynıdır: katı giriş temizde geçer; hatalıda ilk tanının kodunu, satırını ve
      // toplam sayıyı iletide taşır.
      const ileti = hataIletisi(() => yorumsuz(ad, girdi));
      if (temiz) {
        expect(ileti, `${ad} ${JSON.stringify(girdi)}`).toBe('');
      } else {
        const ilk = genel[0];
        expect(ileti).toContain(`satır ${sf.getLineAndCharacterOfPosition(ilk.bas).line + 1}: TS${ilk.kod} `);
        expect(ileti).toContain(`(toplam ${genel.length} tanı)`);
      }
    }
  });

  it('iç alan yoksa / biçimi tanınmıyorsa katı giriş HER çağrıda fırlatır (sessizce «tanı yok» saymaz)', () => {
    const asil = ts.createSourceFile;
    const TUZAKLAR: ReadonlyArray<{ ne: string; tuzak: ProxyHandler<ts.SourceFile>; ileti: RegExp }> = [
      { ne: 'alan yok', tuzak: { has: (hedef, ad) => ad !== 'parseDiagnostics' && Reflect.has(hedef, ad) }, ileti: /parseDiagnostics alanı yok/ },
      { ne: 'dizi değil', tuzak: { get: (hedef, ad, alici) => (ad === 'parseDiagnostics' ? 'dizi değil' : Reflect.get(hedef, ad, alici)) }, ileti: /parseDiagnostics dizi değil/ },
      { ne: 'öğe biçimi', tuzak: { get: (hedef, ad, alici) => (ad === 'parseDiagnostics' ? [{ start: 0 }] : Reflect.get(hedef, ad, alici)) }, ileti: /biçimi tanınmadı/ },
    ];
    TUZAKLAR.forEach(({ ne, tuzak, ileti }, i) => {
      const casus = vi.spyOn(ts, 'createSourceFile').mockImplementation((...a) => new Proxy(asil(...a), tuzak));
      // Girdi TEMİZ ve bu teste özgü (önbellekte yok): fırlatmanın tek nedeni okunamayan iç alandır.
      const girdi = `const icAlanTuzagi${i} = 1; // yalnız bu testte`;
      expect(() => yorumsuz('f.ts', girdi), ne).toThrow(ileti);
      expect(() => yorumsuz('f.ts', girdi), `${ne} · ikinci çağrı`).toThrow(ileti);
      expect(casus, `${ne} · fırlatma önbelleğe alınmaz`).toHaveBeenCalledTimes(2);
      // Hoşgörülü giriş tanıya HİÇ bakmaz: aynı sahte kaynak dosyayla çalışır.
      if (ne === 'alan yok') expect(yorumsuzParca('f.ts', girdi)).toEqual([`const icAlanTuzagi${i} = 1; `]);
      casus.mockRestore();
    });
  });
});

describe('§7 · önbellek', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  // Fikstür metinleri bu testlere ÖZGÜDÜR: modül düzeyi önbellek dosyadaki bütün testlerce paylaşılır,
  // başka bir testin süzdüğü metin ilk çağrıyı isabete çevirir ve sayımı bozardı.
  it('aynı girdi ikinci kez AYRIŞTIRILMAZ; anahtar = kip + tür + içerik (ad anahtarda yok)', () => {
    const casus = vi.spyOn(ts, 'createSourceFile');
    const girdi = 'const onbellekSayimi = 1; // yalnız bu testte';
    const beklenen = ['const onbellekSayimi = 1; '];
    expect(yorumsuz('a.ts', girdi)).toEqual(beklenen);
    expect(casus, 'ilk çağrı ayrıştırır').toHaveBeenCalledTimes(1);
    expect(yorumsuz('a.ts', girdi)).toEqual(beklenen);
    expect(casus, 'aynı girdi').toHaveBeenCalledTimes(1);
    expect(yorumsuz('baska/yol/b.ts', girdi)).toEqual(beklenen);
    expect(casus, 'ad farklı, tür aynı').toHaveBeenCalledTimes(1);
    expect(yorumsuzParca('a.ts', girdi)).toEqual(beklenen);
    expect(casus, 'kip farklı').toHaveBeenCalledTimes(2);
    expect(yorumsuz('a.tsx', girdi)).toEqual(beklenen);
    expect(casus, 'tür farklı').toHaveBeenCalledTimes(3);
    expect(yorumsuz('a.ts', `${girdi} `)).toEqual(beklenen);
    expect(casus, 'içerik farklı').toHaveBeenCalledTimes(4);
  });

  it('kip anahtardadır: parça girişinin önbelleği katı girişi YUMUŞATMAZ', () => {
    const bozuk = 'const onbellekKipi = ; // yalnız bu testte';
    expect(yorumsuzParca('a.ts', bozuk)).toEqual(['const onbellekKipi = ; ']);
    expect(() => yorumsuz('a.ts', bozuk)).toThrow(/TS1109/);
    expect(() => yorumsuz('a.ts', bozuk), 'fırlatma önbelleğe alınmaz').toThrow(/TS1109/);
    expect(yorumsuzParca('a.ts', bozuk)).toEqual(['const onbellekKipi = ; ']);
  });

  it('tür anahtardadır: aynı içerik `.ts` ve `.tsx` adıyla AYRI süzülür', () => {
    const girdi = 'const onbellekTuru = <T>x; // </T>';
    expect(yorumsuz('a.ts', girdi)).toEqual(['const onbellekTuru = <T>x; ']);
    expect(yorumsuz('a.tsx', girdi)).toEqual([girdi]);   // TSX'te öğe sayılır, yorum JSX metnidir (§8 bilinen sınır)
    expect(yorumsuz('a.ts', girdi)).toEqual(['const onbellekTuru = <T>x; ']);
  });

  it('dönen dizi KOPYADIR: çağıran değiştirirse önbellek bozulmaz (ıskalama ve isabet yolu ayrı ayrı)', () => {
    const girdi = 'const onbellekKopyasi = 1; // yalnız bu testte\nconst b = 2;';
    const beklenen = ['const onbellekKopyasi = 1; ', 'const b = 2;'];
    const ilk = yorumsuz('a.ts', girdi);       // ıskalama yolu: az önce üretilen dizi
    ilk[0] = 'BOZULDU';
    ilk.push('fazla satır');
    const ikinci = yorumsuz('a.ts', girdi);    // isabet yolu: önbellekten
    expect(ikinci).toEqual(beklenen);
    ikinci.length = 0;
    const ucuncu = yorumsuz('a.ts', girdi);
    expect(ucuncu).toEqual(beklenen);
    expect(ucuncu).not.toBe(ikinci);
  });
});

describe('§8 · bilinen sınırlar (SABİTLEME — onay değil)', () => {
  // Buradaki testler bir davranışı ONAYLAMAZ; bugünkü sınırı kayda geçirir. Biri kırmızıya dönerse sınır
  // yer değiştirmiştir: beklenti güncellenir ve o sınıra güvenen yer (testin yorumunda anılan) yeniden düşünülür.
  it('yanlış uzantı SESSİZ geçebilir (1): `.ts` adıyla verilen JSX tanısız ayrışır ve satırı keser', () => {
    // `<div>a` tür dönüşümü, kalanı satır yorumu sayılır. Katı giriş bunu YAKALAMAZ; koruma dosya adının
    // doğru verilmesidir (`kodSatirlari(yol)` adı kendisi geçirir). Öznitelik taşıyan öğe ise fırlatır (§5).
    const jsx = 'const e = <div>a // b</div>; const v = x || 0;';
    expect(yorumsuz('f.ts', jsx)).toEqual(['const e = <div>a ']);
    expect(yorumsuz('f.tsx', jsx)).toEqual([jsx]);
    // Sonucu: aynı satırdaki SERT ihlali `.ts` adıyla GÖRÜNMEZ.
    expect(sertIhlalleri('f.ts', jsx)).toEqual([]);
    expect(sertIhlalleri('f.tsx', jsx).map(i => i.sinif)).toEqual(['S1']);
  });

  it('yanlış uzantı SESSİZ geçebilir (2): `.tsx` adıyla verilen `<T>x` dönüşümü tanısız, yorum yerinde kalır', () => {
    const donusum = 'const a = <T>x; // </T>';
    expect(yorumsuz('f.tsx', donusum)).toEqual([donusum]);
    expect(yorumsuz('f.ts', donusum)).toEqual(['const a = <T>x; ']);
  });
  it('kâhin önbelleği ayrıştırma türünü ayırır: aynı içerik iki adla sorulunca iki ayrı hüküm', () => {
    const donusum = 'const a = <T>x; // </T>';
    expect(kahinSatirlari('f.ts', donusum).map(bosluksuz)).toEqual(['consta=<T>x;']);
    expect(kahinSatirlari('f.tsx', donusum).map(bosluksuz)).toEqual(['consta=<T>x;//</T>']);
  });

  it('ad denetimi: tek satırlık, uzantıyla biten İÇERİK ad sanılmaz — kod imi taşıyan «ad» reddedilir', () => {
    // Çok satırlı içerik satır sonu denetimine takılır; tek satırlık girdide ayırt eden kod imleridir (yorum açıcı, tırnak, ayraç …).
    // Son yedi örnek yalnız BİR kod imi taşır: desenden tek bir im silinirse o örnek kırılır.
    for (const icerik of ['// bkz. a.ts', '/* a.ts', "import x from './a.ts", 'const a = b.ts', 'f(a.ts', '<p>a.tsx', 'a ? b : `c.ts',
      'a; b.ts', 'f) a.ts', '{ a.ts', '} a.ts', 'a < b.ts', 'a > b.ts', 'import "./a.ts'])
      expect(() => Reflect.apply(yorumsuz, undefined, [icerik, 'f.ts']), icerik).toThrow(/DOSYA ADI olmalı/);
    // Gerçek yollar geçer: boşluk, tire, nokta, `&`, köşeli ayraç (dinamik rota dosyası) serbest.
    for (const ad of ['/Users/x/Cetpa B2B SaaS/cetpa-sales-&-logistics/src/App.tsx', 'src/pages/[id].tsx', 'a.b-c_d.test.ts', 'C:\\proje\\src\\x.ts'])
      expect(yorumsuz(ad, 'const a = 1;'), ad).toEqual(['const a = 1;']);
  });
  it('ad denetimi: MUTLAK yolda kod imi yalnız SON parçada aranır (dizin adı kullanıcının klasöründen gelir)', () => {
    // Depo «proje (1)» gibi bir dizine kopyalanınca çitlerin tamamı «DOSYA ADI olmalı» diye kırılıyordu (kaynakTarama mutlak yol verir).
    for (const ad of ['/Users/x/Cetpa (kopya)/cetpa/src/a.ts', 'C:\\Users\\Administrator\\cetpa-sales-&-logistics (2)\\src\\a.ts',
      "/Volumes/Orçun'un Diski/cetpa/src/a.tsx", '/tmp/a=b/c.ts', 'c:\\Users\\x\\proje (1)\\src\\a.ts', 'C:/Users/x/proje (1)/src/a.ts']) {
      expect(yorumsuz(ad, 'const a = 1; // y'), ad).toEqual(['const a = 1; ']);
      expect(yorumsuzParca(ad, 'const a = 1; // y'), ad).toEqual(['const a = 1; ']);
    }
    // Hâlâ RED: imi son parçada taşıyan mutlak yol; göreli adda imin yeri fark etmez (depo içi adlandırma, herkeste aynı sonuç).
    for (const ad of ['/a/.test(f(x.ts', '/Users/x/f(a).ts', 'app/(auth)/page.tsx', 'src/a=b/c.ts'])
      expect(() => yorumsuz(ad, 'const a = 1;'), ad).toThrow(/DOSYA ADI olmalı/);
    // Dizin kısmında da RED: düzenli ifadeyle başlayan İÇERİK mutlak yol sanılmaz (ad ile içerik yer değiştirmiş çağrı).
    for (const icerik of ['/x(y)/.test(s) || 0; // bkz. src/a.ts', '/> {/* bkz. src/a.tsx', '/[;(){}]/.test(k) ? 1 : yol/a.ts', 'a:/x(y)/.test(s) || 0, // b/c.ts'])
      expect(() => sertIhlalleri(icerik, 'f.ts'), icerik).toThrow(/DOSYA ADI olmalı/);
    // Her im TEK başına: desenden bir im silinirse o örnek kırılır.
    for (const ad of ['/a;b/c.ts', '/a{b/c.ts', '/a}b/c.ts', '/a<b/c.ts', '/a>b/c.ts', '/a"b/c.ts', '/a`b/c.ts', '/a//b/c.ts', '/a/*b/c.ts', 'C:\\a;b\\c.ts'])
      expect(() => yorumsuz(ad, 'const a = 1;'), ad).toThrow(/DOSYA ADI olmalı/);
  });
  it('BİLİNEN SINIR (sabitlenir, onaylanmaz): kod imi taşımayan tek sözcüklük içerik hâlâ ad sanılır', () => {
    expect(yorumsuz('a.ts', 'f.ts')).toEqual(['f.ts']);   // «a.ts» içerik de olabilir, ad da — metinden ayırt edilemez
    // Mutlak yol gevşemesinin bedeli: `/` ile başlayan, dizin kısmında yalnız ( ) ' = taşıyan, son parçası imsiz içerik de ad sanılır.
    expect(sertIhlalleri('/^(?:a|b)\\.ts', 'f.ts')).toEqual([]);
    expect(sertIhlalleri('/x(y)/.test(s) ? 1 : src/a.ts', 'f.ts')).toEqual([]);
  });

  it('katı girişin fırlattığı geçerli-görünen iki sınıf (depoda yok): JSX metninde ham `>` / `}`; BOM + shebang', () => {
    expect(() => yorumsuz('f.tsx', 'const e = <p>a > b</p>;')).toThrow(/TS1382/);
    expect(() => yorumsuz('f.tsx', 'const e = <p>a } b</p>;')).toThrow(/TS1381/);
    expect(() => yorumsuz('f.ts', `${BOM}#!/usr/bin/env node\nconst a = 1;`)).toThrow(/TS18026/);
    // BOM tek başına sorun değildir: çıktıda yerinde kalır.
    expect(yorumsuz('f.ts', `${BOM}const a = 1; // y`)).toEqual([`${BOM}const a = 1; `]);
  });

  it('BİLİNEN SINIR (sabitlenir, onaylanmaz): parça kipinde hata kurtarmanın attığı İKAMELİ şablonun kuyruğu kurtarılamaz', () => {
    // Atılan belirteç yalnız şablon BAŞIDIR; kuyruğu ayrıştırıcı hiç şablon olarak okumaz, `getChildren` de veremez.
    // (1) kuyrukta çift eğik çizgi: satırın kalanı silinir; (2) kuyruktaki kapanış imi kapanmayan yeni bir şablon açar: dosya sonuna dek yorumlar kalır.
    expect(yorumsuzParca('f.ts', 'function f(`a${b}//c`, x) { kalmali(); }')).toEqual(['function f(`a${b}']);
    expect(yorumsuzParca('f.tsx', 'href={birlestir(`${location.protocol}//${location.host}/x`)} adet={n || 0}')).toEqual(['href={birlestir(`${location.protocol}']);
    expect(yorumsuzParca('f.tsx', 'href={tamYol(`https://cetpa.com.tr/${id}`)} hedef={a ?? 0} // y\nconst b = 1; // z'))
      .toEqual(['href={tamYol(`https://cetpa.com.tr/${id}`)} hedef={a ?? 0} // y', 'const b = 1; // z']);
    // Karşılaştırma: aynı şablon GEÇERLİ ifadede ve ikamesiz şablon aynı konumda doğru süzülür.
    expect(yorumsuzParca('f.tsx', 'const h = tamYol(`https://cetpa.com.tr/${id}`); const k = a ?? 0; // y')).toEqual(['const h = tamYol(`https://cetpa.com.tr/${id}`); const k = a ?? 0; ']);
    expect(yorumsuzParca('f.tsx', 'href={tamYol(`https://cetpa.com.tr/x`)} hedef={a ?? 0} // y')).toEqual(['href={tamYol(`https://cetpa.com.tr/x`)} hedef={a ?? 0} ']);
  });

  it('shebang satırı iki türetimde de KOD sayılır (içindeki çift eğik çizgi yorum açmaz)', () => {
    // Kâhin eskiden shebang'i belirteç saymayıp boşluğa çeviriyordu; shebang'li betikler taranınca depo çiti ayrışırdı.
    const betik = '#!/usr/bin/env -S node //x\nconst a = 1; // y';
    expect(yorumsuz('betik.mjs', betik)).toEqual(['#!/usr/bin/env -S node //x', 'const a = 1; ']);
    expect(kahinSatirlari('betik.mjs', betik).map(bosluksuz)).toEqual(['#!/usr/bin/env-Snode//x', 'consta=1;']);
  });
});

// ---------------------------------------------------------------------------
// §9–§10 depoyu okur: `src` ağacındaki BÜTÜN `.ts` / `.tsx` (test, düzenek ve `.d.ts` dâhil) + kök `server.ts`.
// (`kaynakTarama.kaynakDosyalari` test dosyalarını dışarıda bırakır; burada onlar da taranır.)
// ---------------------------------------------------------------------------
interface DepoDosyasi { yol: string; icerik: string }

function tsDosyalari(dizin: string): string[] {
  return readdirSync(dizin).flatMap(ad => {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) return tsDosyalari(yol);
    return /\.tsx?$/.test(ad) ? [yol] : [];
  });
}

let depoBellegi: DepoDosyasi[] | undefined;
function depoKaynaklari(): DepoDosyasi[] {
  depoBellegi ??= [...tsDosyalari(SRC_KOK), join(SRC_KOK, '..', 'server.ts')].map(yol => ({ yol, icerik: oku(yol) }));
  return depoBellegi;
}

describe('§9 · DEPO ÇİTİ: bütün kaynaklarda modül ≡ bağımsız kâhin', () => {
  // İki türetim (modül: korunan değişmez aralıkları + doğrusal açıcı taraması; kâhin: belirteç kaplama
  // maskesi) depodaki HER dosyada satır satır aynı kodu vermelidir. Katı giriş kullanılır: bir dosya
  // uzantısına göre ayrıştırılamıyorsa da burada düşer.
  //
  // BU ÇİTİN YAKALAMADIKLARI (mutasyonla ölçüldü 2026-10-08): JsxText'in korunan kümeden çıkarılması, satır
  // sonu kümesinin daraltılması (CR / U+2028 / U+2029), kapanış aramasının bir karakter erken başlaması,
  // kapanmayan blok, shebang'in atlanmaması — depoda bunları ayırt eden örnek YOK. TemplateTail'i yalnız BU
  // dosyanın kendi şablon dizeleri sayesinde yakalar (üretim kodunda içinde açıcı geçen şablon sonu yok);
  // ona da güvenilmez. Bu ayrıntılar §1–§3 fikstürleriyle korunur; buradaki yeşil onlar için kanıt değildir.
  it('`src` ağacı + `server.ts`: satır sayısı korunur, satır satır aynı kod (boşluk hariç)', () => {
    const dosyalar = depoKaynaklari();
    // Alt sınır: yol kırılır / süzgeç daralırsa çit boş kümede yeşil kalmasın (ölçüm 2026-10-08: 654).
    expect(dosyalar.length, 'taranan dosya sayısı').toBeGreaterThan(600);

    const farklar: string[] = [];
    for (const { yol, icerik } of dosyalar) {
      const site = gorece(yol);
      let modul: string[];
      try {
        modul = yorumsuz(yol, icerik);
      } catch (e) {
        farklar.push(`${site}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const kahin = kahinSatirlari(yol, icerik);
      const ham = icerik.split('\n').length;
      if (modul.length !== ham || kahin.length !== ham) farklar.push(`${site}: satır sayısı ham ${ham} · modül ${modul.length} · kâhin ${kahin.length}`);
      for (let i = 0; i < modul.length; i++) {
        const k = kahin[i] ?? '';
        if (bosluksuz(modul[i]) !== bosluksuz(k)) farklar.push(`${site}:${i + 1}\n    modül: ${modul[i].trim().slice(0, 160)}\n    kâhin: ${k.trim().slice(0, 160)}`);
      }
    }
    expect(farklar.length, `${farklar.length} fark — ilk 25:\n${farklar.slice(0, 25).join('\n')}`).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// §10 · `yorumsuzParca` tanıya bakmaz: ona DOSYA içeriği verilirse sözdizimi hatası ya da yanlış uzantı
// sessiz kör bölge olur (şartname K4). Çit kaynak METNİNDE desen aramaz — çağrıyı ayrıştırır ve ikinci
// bağımsız değişkenin bir dosya okumasına ULAŞIP ulaşmadığına bakar (aynı dosya içinde, kapsam kurallarıyla):
//   • doğrudan okuyan çağrı (`oku(` / `readFileSync(` / `readFile(`),
//   • adı dosya içeriği diyen kimlik (`icerik` / `kaynak` — büyük-küçük harf ayrımsız, özellik adı dâhil),
//   • değeri okumadan gelen değişken / yardımcı işlev (bildirimi izlenir, geçişli; nesne ve yapı bozumu dâhil),
//   • parametre: işlev bu dosyada nerede çağrılıyorsa o sıradaki bağımsız değişken izlenir.
// Ayrıca `yorumsuzParca` yalnız DOĞRUDAN çağrılabilir: takma ad / değer olarak geçiş çağrıyı gizlerdi.
// Bu dosyanın kendi fikstürleri dize olduğu için çite takılmaz (dize ayrıştırılmış çağrı değildir).
// Sonradan ATAMA (`let m = ''; m = oku(yol)`; `beforeAll` / `try` içi dâhil), varsayılan parametre ve yapı bozumu
// öğesinin varsayılanı (`{ f = oku(yol) }`) da izlenir. İzleme AKIŞA bakmaz: değişkene dosyanın herhangi bir yerinde
// dosya içeriği atanıyorsa o değişkenle yapılan HER çağrı ihlal sayılır (fikstür ile dosya içeriği ayrı değişkende durur).
// SINIR: başka dosyadan içe aktarılan değer, adsız geri çağrının parametresi, kap üzerinden doldurma (`Map.set` / `push`),
// özellik ataması (`this.m = …`), yapı bozumlu atama (`({ m } = …)` / `[m] = …`), önceden bildirilmiş değişkene for-of /
// for-in ile yazma (`for (m of …)`), yöntem parametresi ve eleman erişimiyle çağrı (`t['yorumsuzParca']`) izlenmez.
// ---------------------------------------------------------------------------
const OKUYAN_CAGRI: ReadonlySet<string> = new Set(['oku', 'readFileSync', 'readFile']);
const ICERIK_ADI = /^(?:icerik|kaynak)$/i;

function parcaTaramasi(dosyaAdi: string, metin: string): { cagri: number; ihlaller: string[] } {
  const { program, sf } = bellekProgrami(dosyaAdi, metin);
  const denetci = program.getTypeChecker();
  const satir = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const cagrilar: ts.CallExpression[] = [];
  const anmalar: ts.Identifier[] = [];   // `yorumsuzParca` adının kodda geçtiği her yer
  const atamalar: ts.BinaryExpression[] = [];   // `kimlik = …` (bileşik atamalar dâhil)
  const topla = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) cagrilar.push(n);
    if (ts.isBinaryExpression(n) && ts.isIdentifier(n.left)
      && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) atamalar.push(n);
    if (ts.isIdentifier(n) && n.text === 'yorumsuzParca') anmalar.push(n);
    ts.forEachChild(n, topla);
  };
  topla(sf);

  // Parametrenin değeri çağıranlardadır: işlevin ADI bu dosyada nerede çağrılıyorsa o sıradaki bağımsız değişken.
  const parametreyeGelenler = (p: ts.ParameterDeclaration): ts.Node[] => {
    const islev = p.parent;
    const sira = islev.parameters.indexOf(p);
    const adDugumu = ts.isFunctionDeclaration(islev) ? islev.name
      : (ts.isArrowFunction(islev) || ts.isFunctionExpression(islev)) && ts.isVariableDeclaration(islev.parent) && ts.isIdentifier(islev.parent.name) ? islev.parent.name
      : undefined;
    const simge = adDugumu ? denetci.getSymbolAtLocation(adDugumu) : undefined;
    if (!simge) return [];
    return cagrilar.flatMap(c => {
      if (!ts.isIdentifier(c.expression) || denetci.getSymbolAtLocation(c.expression) !== simge) return [];
      const gelen: ts.Expression | undefined = c.arguments[sira];
      return gelen ? [gelen] : [];
    });
  };

  // Bir kimliğin DEĞERİNİ veren düğümler: başlatıcı, işlev gövdesi, yapı bozumunda bozulan ifade (for-of'ta
  // dolaşılan ifade), parametrede çağıranların verdiği bağımsız değişkenler. Nesne özelliği ayrıca izlenmez:
  // nesnenin başlatıcısı baştan sona gezildiği için özelliğin değeri zaten görülür.
  const degerDugumleri = (kimlik: ts.Identifier): ts.Node[] => {
    const bildirimler = (denetci.getSymbolAtLocation(kimlik)?.declarations ?? []).flatMap(b =>
      ts.isShorthandPropertyAssignment(b) ? (denetci.getShorthandAssignmentValueSymbol(b)?.declarations ?? []) : [b]);
    // Bildirimden SONRA atanan değerler: aynı simgeye yapılan her atamanın sağ tarafı.
    const atananlar = atamalar.filter(a => (denetci.getSymbolAtLocation(a.left)?.declarations ?? []).some(b => bildirimler.includes(b))).map(a => a.right);
    return [...atananlar, ...bildirimler.flatMap((b): ts.Node[] => {
      if (ts.isFunctionDeclaration(b)) return b.body ? [b.body] : [];
      let d: ts.Node = b;
      const varsayilanlar: ts.Node[] = [];   // yapı bozumu öğesinin KENDİ varsayılanı: `{ f = oku(yol) }`
      while (ts.isBindingElement(d) || ts.isObjectBindingPattern(d) || ts.isArrayBindingPattern(d)) {
        if (ts.isBindingElement(d) && d.initializer) varsayilanlar.push(d.initializer);
        d = d.parent;
      }
      if (ts.isParameter(d)) return [...varsayilanlar, ...(d.initializer ? [d.initializer] : []), ...parametreyeGelenler(d)];
      if (!ts.isVariableDeclaration(d)) return varsayilanlar;
      if (d.initializer) return [...varsayilanlar, d.initializer];
      const dongu = d.parent.parent;
      return [...varsayilanlar, ...(ts.isForOfStatement(dongu) || ts.isForInStatement(dongu) ? [dongu.expression] : [])];
    })];
  };

  const okumaNedeni = (n: ts.Node, gorulen: Set<ts.Node>): string | undefined => {
    if (ts.isCallExpression(n)) {
      const cagrilan = n.expression;
      const ad = ts.isIdentifier(cagrilan) ? cagrilan.text : ts.isPropertyAccessExpression(cagrilan) ? cagrilan.name.text : '';
      if (OKUYAN_CAGRI.has(ad)) return `dosya okuyan çağrı \`${ad}(\``;
    }
    if (ts.isIdentifier(n)) {
      if (ICERIK_ADI.test(n.text)) return `dosya içeriği adı \`${n.text}\``;
      for (const deger of degerDugumleri(n)) {
        if (gorulen.has(deger)) continue;
        gorulen.add(deger);
        const alt = okumaNedeni(deger, gorulen);
        if (alt) return `\`${n.text}\` ← ${alt}`;
      }
    }
    return ts.forEachChild(n, alt => okumaNedeni(alt, gorulen));
  };

  const ihlaller: string[] = [];
  let cagri = 0;
  for (const anma of anmalar) {
    const ust = anma.parent;
    if (ts.isFunctionDeclaration(ust) && ust.name === anma) continue;                 // tanımın kendisi
    if (ts.isImportSpecifier(ust) && !ust.propertyName) continue;                      // yeniden adlandırmasız içe aktarım
    const cagrilan: ts.Node = ts.isPropertyAccessExpression(ust) && ust.name === anma ? ust : anma;   // `t.yorumsuzParca(…)` de çağrıdır
    const cagriDugumu = cagrilan.parent;
    if (!ts.isCallExpression(cagriDugumu) || cagriDugumu.expression !== cagrilan) {
      ihlaller.push(`${satir(anma)}: \`yorumsuzParca\` doğrudan çağrılmıyor (takma ad / değer olarak geçiş çağrıyı gizler)`);
      continue;
    }
    cagri++;
    const kod = cagriDugumu.getText(sf).replace(/\s+/g, ' ').slice(0, 120);
    const ikinci = cagriDugumu.arguments.length === 2 && !cagriDugumu.arguments.some(ts.isSpreadElement) ? cagriDugumu.arguments[1] : undefined;
    if (!ikinci) {
      ihlaller.push(`${satir(cagriDugumu)}: iki AÇIK bağımsız değişken (ad, parça) bekleniyor — ${kod}`);
      continue;
    }
    const neden = okumaNedeni(ikinci, new Set());
    if (neden) ihlaller.push(`${satir(cagriDugumu)}: ${neden} — ${kod}`);
  }
  return { cagri, ihlaller };
}

describe('§10 · ÇİT: dosya içeriği hoşgörülü girişe (`yorumsuzParca`) verilmez', () => {
  const tara = (...satirlar: string[]) => parcaTaramasi('/fikstur.test.ts', satirlar.join('\n'));

  it('tarayıcı kendini sınar: ikinci bağımsız değişken bir dosya okumasına ULAŞIYORSA yakalar', () => {
    const SUCLU: ReadonlyArray<{ ne: string; satirlar: string[]; neden: RegExp }> = [
      { ne: 'doğrudan `oku(`', satirlar: ['yorumsuzParca(yol, oku(yol));'], neden: /^1: dosya okuyan çağrı `oku\(`/ },
      { ne: 'doğrudan `readFileSync(`', satirlar: ["yorumsuzParca('a.ts', readFileSync(yol, 'utf-8'));"], neden: /`readFileSync\(`/ },
      { ne: 'üye çağrısı + zincir', satirlar: ["yorumsuzParca('a.ts', fs.readFileSync(yol, 'utf-8').trim());"], neden: /`readFileSync\(`/ },
      { ne: 'ara değişken', satirlar: ['const metin = oku(yol);', 'yorumsuzParca(yol, metin);'], neden: /^2: `metin` ← dosya okuyan çağrı `oku\(`/ },
      { ne: 'içerik adlı parametre', satirlar: ["function say(icerik: string) { return yorumsuzParca('f.ts', icerik).length; }"], neden: /dosya içeriği adı `icerik`/ },
      { ne: 'içerik adlı özellik', satirlar: ['yorumsuzParca(m.yol, m.icerik);'], neden: /dosya içeriği adı `icerik`/ },
      { ne: 'büyük harfli sabit', satirlar: ["yorumsuzParca('f.ts', KAYNAK);"], neden: /dosya içeriği adı `KAYNAK`/ },
      { ne: 'ok işlevli yardımcı', satirlar: ["const getir = (y: string) => readFileSync(y, 'utf8');", 'yorumsuzParca(yol, getir(yol));'], neden: /`getir` ← .*`readFileSync\(`/ },
      { ne: 'işlev bildirimli yardımcı', satirlar: ["function getir(y: string) { return readFileSync(y, 'utf8'); }", 'yorumsuzParca(yol, getir(yol));'], neden: /`getir` ← .*`readFileSync\(`/ },
      {
        ne: 'for-of yapı bozumu',
        satirlar: ['const D = yollar.map(yol => ({ yol, govde: oku(yol) }));', 'for (const { yol, govde } of D) yorumsuzParca(yol, govde);'],
        neden: /^2: `govde` ← `D` ← .*dosya okuyan çağrı `oku\(`/,
      },
      {
        ne: 'kısa yazımlı özellik',
        satirlar: ['const govde = oku(yol);', 'const kayit = { yol, govde };', 'yorumsuzParca(yol, kayit.govde);'],
        neden: /^3: `kayit` ← `govde` ← dosya okuyan çağrı `oku\(`/,
      },
      {
        ne: 'yardımcının parametresi (ok işlevi): çağıranlardan BİRİ dosya veriyor',
        satirlar: ["const say = (fikstur: string) => yorumsuzParca('f.ts', fikstur).length;", "say('const a = 1;');", 'say(oku(yol));'],
        neden: /^1: `fikstur` ← dosya okuyan çağrı `oku\(`/,
      },
      {
        ne: 'yardımcının parametresi (işlev bildirimi, ikinci sıra)',
        satirlar: ['function say(ad: string, fikstur: string) { return yorumsuzParca(ad, fikstur).length; }', "say('f.ts', oku(yol));"],
        neden: /`fikstur` ← dosya okuyan çağrı `oku\(`/,
      },
      { ne: 'let + sonradan atama', satirlar: ["let metin = '';", 'metin = oku(yol);', 'yorumsuzParca(yol, metin);'], neden: /^3: `metin` ← dosya okuyan çağrı `oku\(`/ },
      { ne: '`beforeAll` içinde atama', satirlar: ['let metin: string;', 'beforeAll(() => { metin = oku(yol); });', "it('x', () => { yorumsuzParca(yol, metin); });"], neden: /^3: `metin` ← dosya okuyan çağrı `oku\(`/ },
      { ne: '`try` içinde atama', satirlar: ["let metin = '';", "try { metin = readFileSync(yol, 'utf8'); } catch { /* yok */ }", 'yorumsuzParca(yol, metin);'], neden: /^3: `metin` ← dosya okuyan çağrı `readFileSync\(`/ },
      { ne: 'bileşik atama `+=`', satirlar: ["let metin = '';", 'metin += oku(yol);', 'yorumsuzParca(yol, metin);'], neden: /^3: `metin` ← dosya okuyan çağrı `oku\(`/ },
      { ne: 'bileşik atama `??=`', satirlar: ['let metin: string | undefined;', 'metin ??= oku(yol);', 'yorumsuzParca(yol, metin);'], neden: /^3: `metin` ← dosya okuyan çağrı `oku\(`/ },
      { ne: 'yapı bozumu öğesinin varsayılanı (bildirim)', satirlar: ['const { f = oku(yol) } = secenek;', "yorumsuzParca('f.ts', f);"], neden: /^2: `f` ← dosya okuyan çağrı `oku\(`/ },
      { ne: 'yapı bozumu öğesinin varsayılanı (parametre)', satirlar: ["function say({ f = oku(yol) } = {}) { return yorumsuzParca('f.ts', f).length; }"], neden: /^1: `f` ← dosya okuyan çağrı `oku\(`/ },
      { ne: 'varsayılan parametre', satirlar: ["function say(fikstur = oku(yol)) { return yorumsuzParca('f.ts', fikstur).length; }", 'say();'], neden: /^1: `fikstur` ← dosya okuyan çağrı `oku\(`/ },
      { ne: 'takma ad', satirlar: ['const suz = yorumsuzParca;', "suz(yol, oku(yol));"], neden: /^1: `yorumsuzParca` doğrudan çağrılmıyor/ },
      { ne: 'yeniden adlandırılmış içe aktarım', satirlar: ["import { yorumsuzParca as p } from './degismezTarayici';"], neden: /doğrudan çağrılmıyor/ },
      { ne: 'yayılmış bağımsız değişken', satirlar: ['yorumsuzParca(...a);'], neden: /iki AÇIK bağımsız değişken/ },
      { ne: 'ikinci sırada yayılmış bağımsız değişken', satirlar: ["yorumsuzParca('f.ts', ...a);"], neden: /iki AÇIK bağımsız değişken/ },
      { ne: 'ad alanı üstünden çağrı', satirlar: ['t.yorumsuzParca(yol, oku(yol));'], neden: /`oku\(`/ },
    ];
    for (const { ne, satirlar, neden } of SUCLU) {
      const { ihlaller } = tara(...satirlar);
      expect(ihlaller, ne).toHaveLength(1);
      expect(ihlaller[0], ne).toMatch(neden);
    }
  });

  it('tarayıcı kendini sınar: meşru biçimler TAKILMAZ (fikstür adı + fikstür / satır içi dize)', () => {
    const MESRU: ReadonlyArray<{ ne: string; satirlar: string[]; cagri: number }> = [
      { ne: 'fikstür değişkeni', satirlar: ["yorumsuzParca('fikstur.ts', fikstur);"], cagri: 1 },
      { ne: 'satır içi dize', satirlar: [`yorumsuzParca("fikstur.tsx", 'const a = 1; // y');`], cagri: 1 },
      { ne: 'şablon dizesi', satirlar: ["yorumsuzParca('fikstur.ts', `a\\n${b}`);"], cagri: 1 },
      { ne: 'birleştirilen satırlar', satirlar: ["yorumsuzParca('fikstur.ts', ['a', 'b'].join('\\n'));"], cagri: 1 },
      { ne: 'yardımcı + fikstür çağıranları', satirlar: ["const say = (fikstur: string) => yorumsuzParca('f.ts', fikstur).length;", "say('const a = 1;');", 'say(SABIT);'], cagri: 1 },
      { ne: 'ad alanı üstünden fikstür', satirlar: ["t.yorumsuzParca('f.ts', fikstur);"], cagri: 1 },
      { ne: 'let fikstür + yeniden atama (ikisi de dize)', satirlar: ["let f = 'a';", "f = 'b // y';", "yorumsuzParca('f.ts', f);"], cagri: 1 },
      { ne: 'katı giriş dosya okur (serbest)', satirlar: ['yorumsuz(yol, oku(yol));', 'const y = kodSatirlari(yol);'], cagri: 0 },
      { ne: 'dize içindeki anma çağrı değildir', satirlar: ['const s = "yorumsuzParca(yol, oku(yol))";'], cagri: 0 },
      { ne: 'yorumdaki anma çağrı değildir', satirlar: ['// yorumsuzParca(yol, oku(yol))', 'const a = 1;'], cagri: 0 },
      { ne: 'içe aktarım', satirlar: ["import { yorumsuz, yorumsuzParca } from './degismezTarayici';"], cagri: 0 },
      { ne: 'tanımın kendisi', satirlar: ["export function yorumsuzParca(dosyaAdi: string, icerik: string): string[] { return suz('parca', dosyaAdi, icerik); }"], cagri: 0 },
      {
        ne: 'aynı ad BAŞKA kapsamda dosya içeriği (kapsam kuralı: bu çağrıya ulaşmaz)',
        satirlar: [
          'function dosyaTesti() { const kod = oku(yol); return yorumsuz(yol, kod); }',
          "function fiksturTesti() { const kod = 'x || 0'; return yorumsuzParca('f.ts', kod); }",
        ],
        cagri: 1,
      },
      {
        ne: 'aynı ad BAŞKA kapsamda ATAMAYLA dosya içeriği (simge eşleşmesi: bu çağrıya ulaşmaz)',
        satirlar: [
          "function dosyaTesti() { let kod = ''; kod = oku(yol); return yorumsuz(yol, kod); }",
          "function fiksturTesti() { let kod = ''; kod = 'x || 0'; return yorumsuzParca('f.ts', kod); }",
        ],
        cagri: 1,
      },
      { ne: 'yapı bozumu öğesinde dize varsayılanı', satirlar: ["const { f = 'x // y' } = secenek;", "yorumsuzParca('f.ts', f);"], cagri: 1 },
      { ne: 'KARDEŞ öğenin varsayılanı bu öğeye ulaşmaz', satirlar: ['const { a = oku(yol), b } = secenek;', "yorumsuzParca('f.ts', b);"], cagri: 1 },
    ];
    for (const { ne, satirlar, cagri } of MESRU) expect(tara(...satirlar), ne).toEqual({ cagri, ihlaller: [] });
  });

  it('depodaki her `yorumsuzParca` çağrısı fikstür alır (`src` ağacı + `server.ts`)', () => {
    // Ön süzgeç: adı hiç geçmeyen dosya ayrıştırılmaz (çağrı da takma ad da adı yazmak zorundadır).
    const adaylar = depoKaynaklari().filter(d => d.icerik.includes('yorumsuzParca'));
    const ihlaller: string[] = [];
    let cagri = 0;
    for (const { yol, icerik } of adaylar) {
      const sonuc = parcaTaramasi(yol, icerik);
      cagri += sonuc.cagri;
      ihlaller.push(...sonuc.ihlaller.map(i => `${gorece(yol)}:${i}`));
    }
    expect(ihlaller, ihlaller.join('\n')).toEqual([]);
    // Boşa yeşil koruması: en azından BU dosyanın kendi çağrıları görülmüş olmalı (§2, §5–§7).
    expect(cagri, 'görülen `yorumsuzParca` çağrısı').toBeGreaterThan(0);
  }, 60_000);
});
