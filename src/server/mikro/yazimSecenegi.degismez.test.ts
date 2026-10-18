// @vitest-environment node
/**
 * yazimSecenegi.degismez.test.ts — KAYNAK ÇİTİ (şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md` K0a, § 8.2 commit 0-A; T0, H4).
 *
 * Mikro'ya YAZAN her `mikroPost` çağrısı 4. argüman olarak `MIKRO_YAZIM_SECENEGI`'ni geçer: stub yanıtında aynı gövde İKİNCİ kez
 * gönderilmez (S2). Yazan çağrı = 1. argümanı uç adı `/(Kaydet|Iptal|Kabul|Red|Olustur)V2$/` olan dize sabiti, ya da yöntem adı
 * değişken olan genel evrak ucu. 1. argümanı değişken olan HER çağrı aşağıdaki adlı listede olmalı — listede olmayan yeni
 * değişkenli çağrı kırmızıdır (yazan mı okuyan mı, kararı yazan verir ve buraya ekler).
 * Tarama: `src/server/**`, `server.ts`, `scripts/**` (test ve düzenek dosyaları hariç), yorumsuz kod (`src/test/kaynakTarama.ts`).
 * Çağrı argümanları parantez / dize dengesiyle ayrılır (çok satırlı çağrılar: e-Arşiv iptali, gelen fatura reddi).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari } from '../../test/kaynakTarama';

const KOK = join(SRC_KOK, '..');
const YAZAN_UC = /(Kaydet|Iptal|Kabul|Red|Olustur)V2$/;

/** `scripts/` altındaki `.ts` dosyaları (alt dizinler dâhil; test / düzenek hariç — `kaynakDosyalari` ile aynı süzgeç). */
function betikDosyalari(dizin: string): string[] {
  if (!existsSync(dizin)) return [];
  return readdirSync(dizin).flatMap(ad => {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) return betikDosyalari(yol);
    return /\.ts$/.test(ad) && !/\.(test|spec|testDuzenegi)\.ts$/.test(ad) ? [yol] : [];
  });
}

const DOSYALAR = [
  ...kaynakDosyalari(join(SRC_KOK, 'server')),
  join(KOK, 'server.ts'),
  ...betikDosyalari(join(KOK, 'scripts')),
];

interface Cagri { dosya: string; satir: number; argumanlar: string[] }

/** `metin[ac]` = '(' → eşleşen ')' konumuna kadar üst düzey argümanlar (dize, şablon ve iç içe parantez dengeli). */
function argumanlariAyir(metin: string, ac: number): { argumanlar: string[]; son: number } {
  const argumanlar: string[] = [];
  let derinlik = 0;
  let parca = '';
  // Şablon dizesi içindeki `${ … }` ifadeleri için yığın: her öğe o ifadenin açıldığı süslü derinliği.
  const sablonYigini: number[] = [];
  let i = ac;
  for (; i < metin.length; i++) {
    const c = metin[i];
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < metin.length && metin[j] !== c) { if (metin[j] === '\\') j++; j++; }
      parca += metin.slice(i, j + 1); i = j; continue;
    }
    if (c === '`') {
      // Şablonu `${`'a ya da kapanış tırnağına kadar oku.
      let j = i + 1;
      while (j < metin.length && metin[j] !== '`' && !(metin[j] === '$' && metin[j + 1] === '{')) { if (metin[j] === '\\') j++; j++; }
      parca += metin.slice(i, metin[j] === '`' ? j + 1 : j + 2);
      if (metin[j] === '$') { sablonYigini.push(derinlik); derinlik++; i = j + 1; } else i = j;
      continue;
    }
    if (c === '}' && sablonYigini.length && sablonYigini[sablonYigini.length - 1] === derinlik - 1) {
      // `${ … }` kapandı → şablonun kalanını oku.
      sablonYigini.pop(); derinlik--;
      let j = i + 1;
      while (j < metin.length && metin[j] !== '`' && !(metin[j] === '$' && metin[j + 1] === '{')) { if (metin[j] === '\\') j++; j++; }
      parca += metin.slice(i, metin[j] === '`' ? j + 1 : j + 2);
      if (metin[j] === '$') { sablonYigini.push(derinlik); derinlik++; i = j + 1; } else i = j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      derinlik++;
      if (derinlik === 1 && c === '(') continue;   // çağrının kendi açılışı
    } else if (c === ')' || c === ']' || c === '}') {
      derinlik--;
      if (derinlik === 0 && c === ')') { if (parca.trim() !== '') argumanlar.push(parca.trim()); return { argumanlar, son: i }; }
    } else if (c === ',' && derinlik === 1) {
      argumanlar.push(parca.trim()); parca = ''; continue;
    }
    parca += c;
  }
  throw new Error(`kapanmayan çağrı (konum ${ac})`);
}

function cagrilar(): Cagri[] {
  const out: Cagri[] = [];
  for (const yol of DOSYALAR) {
    const satirlar = kodSatirlari(yol).map(s => s.kod);
    const metin = satirlar.join('\n');
    const desen = /\bmikroPost\s*\(/g;
    for (let m = desen.exec(metin); m; m = desen.exec(metin)) {
      // Tanımın kendisi (`async function mikroPost(`) çağrı değildir.
      if (/function\s+$/.test(metin.slice(Math.max(0, m.index - 20), m.index))) continue;
      const ac = m.index + m[0].length - 1;
      const { argumanlar } = argumanlariAyir(metin, ac);
      out.push({ dosya: gorece(yol), satir: metin.slice(0, m.index).split('\n').length, argumanlar });
    }
  }
  return out;
}

/** 1. argümanı DEĞİŞKEN olan çağrıların adlı listesi: dosya + ilk argüman → yazan mı (sabit zorunlu) okuyan mı. */
const DEGISKENLI: ReadonlyArray<{ dosya: string; ilk: string; tur: 'yazan' | 'okuyan'; neden: string }> = [
  { dosya: 'src/server/routes/mikroRoutes.ts', ilk: 'method', tur: 'yazan', neden: 'genel evrak ucu (POST /api/mikro/evrak/kaydet; yöntem beyaz listeden)' },
  { dosya: 'src/server/crons.ts', ilk: 'method', tur: 'okuyan', neden: 'cronPullAll — StokListesiV2 / CariListesiV2' },
  { dosya: 'src/server/routes/mikroRoutes.ts', ilk: 'opts.method', tur: 'okuyan', neden: 'makeMikroListImport — liste importu' },
];

const dizeSabiti = (a: string): string | null => {
  const m = /^(['"])(.*)\1$/.exec(a);
  return m ? m[2] : null;
};

describe('K0a kaynak çiti — yazan her mikroPost çağrısı MIKRO_YAZIM_SECENEGI geçer', () => {
  const hepsi = cagrilar();

  it('tarama çalışıyor (çağrılar bulundu; genel evrak ve LUCA betiği taramada)', () => {
    expect(hepsi.length).toBeGreaterThan(20);
    expect(hepsi.some(c => c.dosya === 'scripts/luca-dekont-aktar.ts')).toBe(true);
    expect(hepsi.some(c => c.dosya === 'src/server/routes/mikroRoutes.ts' && c.argumanlar[0] === 'method')).toBe(true);
  });

  it('uç adı yazan bir dize sabiti olan her çağrı 4. argüman olarak MIKRO_YAZIM_SECENEGI geçer', () => {
    const eksik = hepsi
      .filter(c => { const ad = dizeSabiti(c.argumanlar[0] ?? ''); return ad !== null && YAZAN_UC.test(ad); })
      .filter(c => c.argumanlar[3] !== 'MIKRO_YAZIM_SECENEGI')
      .map(c => `${c.dosya}:${c.satir} ${c.argumanlar[0]} → 4. argüman: ${c.argumanlar[3] ?? '(yok)'}`);
    expect(eksik).toEqual([]);
  });

  it('1. argümanı değişken olan her çağrı adlı listede; listedeki «yazan» çağrı sabiti geçer, her liste satırı tam bir kez', () => {
    const degiskenli = hepsi.filter(c => dizeSabiti(c.argumanlar[0] ?? '') === null);
    const listeDisi = degiskenli
      .filter(c => !DEGISKENLI.some(d => d.dosya === c.dosya && d.ilk === c.argumanlar[0]))
      .map(c => `${c.dosya}:${c.satir} mikroPost(${c.argumanlar[0]}, …) — adlı listede yok: yazan mı okuyan mı karar verip listeye ekle`);
    expect(listeDisi).toEqual([]);
    for (const d of DEGISKENLI) {
      const eslesen = degiskenli.filter(c => c.dosya === d.dosya && c.argumanlar[0] === d.ilk);
      expect(eslesen.length, `${d.dosya} mikroPost(${d.ilk}, …) — ${d.neden}`).toBe(1);
      if (d.tur === 'yazan') expect(eslesen[0].argumanlar[3], `${d.dosya}:${eslesen[0].satir}`).toBe('MIKRO_YAZIM_SECENEGI');
    }
  });

  it('sabitli çağrı sayısı 13 (mikroRoutes 11 yazan uç + genel evrak; LUCA betiği)', () => {
    const sabitli = hepsi.filter(c => c.argumanlar[3] === 'MIKRO_YAZIM_SECENEGI').map(c => `${c.dosya} ${c.argumanlar[0]}`);
    expect(sabitli.sort()).toEqual([
      'scripts/luca-dekont-aktar.ts \'DekontKaydetV2\'',
      'src/server/routes/mikroRoutes.ts \'CariKaydetV2\'',
      'src/server/routes/mikroRoutes.ts \'DekontKaydetV2\'',
      'src/server/routes/mikroRoutes.ts \'EArsivIptalV2\'',
      'src/server/routes/mikroRoutes.ts \'FaturaKaydetV2\'',
      'src/server/routes/mikroRoutes.ts \'GelenFaturalarKabulV2\'',
      'src/server/routes/mikroRoutes.ts \'GelenFaturalarRedV2\'',
      'src/server/routes/mikroRoutes.ts \'IrsaliyeKaydetV2\'',
      'src/server/routes/mikroRoutes.ts \'MuhasebeFisKaydetV2\'',
      'src/server/routes/mikroRoutes.ts \'SiparisKaydetV2\'',
      'src/server/routes/mikroRoutes.ts \'StokKaydetV2\'',
      'src/server/routes/mikroRoutes.ts \'TahsilatTediyeKaydetV2\'',
      'src/server/routes/mikroRoutes.ts method',
    ]);
  });

  it("stub deseni (`'result' in`) yalnız yazimSecenegi.ts'te — ikinci bir stub tanımı yazılmaz", () => {
    const yerler = DOSYALAR.flatMap(yol => kodSatirlari(yol)
      .filter(s => /['"]result['"]\s+in\b/.test(s.kod))
      .map(s => `${gorece(yol)}:${s.n}`));
    expect(yerler.map(y => y.replace(/:\d+$/, ''))).toEqual(['src/server/mikro/yazimSecenegi.ts']);
  });

  // LUCA betiğinin davranış sınaması yok (operatör betiği; Mikro'ya yazar): hata metni de yalnız bu çitle tutulur (H4 «hata
  // metni `yazimHataMetni(httpOk, status, data)` ile üretilir»). Eski ifadeye dönülürse stub yine «HTTP 200» diye günlüğe düşer.
  it('LUCA betiği hata metnini `yazimHataMetni(httpOk, status, data)` ile üretir; eski `ErrorMessage || HTTP <durum>` ifadesi yok (H4)', () => {
    const kod = kodSatirlari(join(KOK, 'scripts', 'luca-dekont-aktar.ts')).map(s => s.kod);
    expect(kod.filter(s => /\byazimHataMetni\(\s*httpOk\s*,\s*status\s*,\s*data\s*\)/.test(s))).toHaveLength(1);
    expect(kod.filter(s => /ErrorMessage/.test(s) && /HTTP \$\{status\}/.test(s))).toEqual([]);
  });
});
