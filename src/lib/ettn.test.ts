/**
 * ettn.test.ts — tek «geçerli ETTN» ölçütü (şartname «fatura gövde + gece MF» § 9.A A4, § 9.B B4 / B6; 2026-10-19).
 *
 * Kilitlenenler: (1) ortak vaka tablosunda `cetpaEttnAnahtari` (aynı tablo uçta da koşar — server/faturaCiftKesim.zincir.test);
 * (2) sıra «önce normalleştir, sonra sına» (tersi parantezli geçerli GUID'i reddeder); (3) `guidBicimli` tire yerini sınar
 * (`ettnGecerli` tek başına tire yeri bozuk değeri kabul eder); (4) TAŞIMA: eski modüllerin dışa aktarımı AYNI işlevdir (kopya yok),
 * `lib/ettn` yapraktır (içe aktarması yok); (5) GUID düzenli ifadesi `src/components`, `src/pages`, `src/utils` üretim kodunda
 * geçmez (istemci ölçütü buradan okur); `src/lib/gibDurum.ts`'teki katı yerel kopya bu işte DEĞİŞMEDİ (ayrı iş).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { cetpaEttnAnahtari, ettnGecerli, guidAnahtari, guidBicimli } from './ettn';
import * as faturaTani from '../server/mikro/faturaTani';
import * as ebelgeDurumTani from '../server/mikro/ebelgeDurumTani';
import { ETTN_VAKALARI } from '../test/ettnVakalari';
import { SRC_KOK, kaynakDosyalari, kodSatirlari, oku, gorece } from '../test/kaynakTarama';

describe('cetpaEttnAnahtari — ortak vaka tablosu (uç ve istemci düğmesi AYNI tabloyu koşar)', () => {
  for (const v of ETTN_VAKALARI) {
    it(`${v.ad}: ${JSON.stringify(v.girdi)} → ${v.anahtar === '' ? 'geçersiz' : v.anahtar}`, () => {
      expect(cetpaEttnAnahtari(v.girdi)).toBe(v.anahtar);
    });
  }
  it('metin dışı değer geçersiz (`null`, `undefined`, sayı, nesne)', () => {
    for (const v of [null, undefined, 0, 42, {}, []]) expect(cetpaEttnAnahtari(v), JSON.stringify(v)).toBe('');
  });
  it('SIRA: önce normalleştir, sonra sına — ham değeri sınayan ters sıra parantezli ve boşluklu geçerli GUID\'i reddederdi', () => {
    const tersSira = (v: unknown): string => (guidBicimli(v) && ettnGecerli(v) ? guidAnahtari(v) : '');
    expect(tersSira('{abcdef12-3456-7890-abcd-ef1234567890}')).toBe('');
    expect(cetpaEttnAnahtari('{abcdef12-3456-7890-abcd-ef1234567890}')).toBe('abcdef12-3456-7890-abcd-ef1234567890');
  });
  it('`guidBicimli` tire yerini sınar: `ettnGecerli` tek başına «tire yeri bozuk» değeri KABUL ederdi', () => {
    const bozuk = 'abcdef123-456-7890-abcd-ef1234567890';
    expect([ettnGecerli(bozuk), guidBicimli(bozuk), cetpaEttnAnahtari(bozuk)]).toEqual([true, false, '']);
  });
});

describe('TAŞIMA — gövdeler birebir, eski içe aktarma yolları AYNI işlevi verir (kopya yok)', () => {
  it('faturaTani `guidAnahtari` / `guidBicimli` ve ebelgeDurumTani `ettnGecerli` lib/ettn\'in kendisi', () => {
    expect(faturaTani.guidAnahtari).toBe(guidAnahtari);
    expect(faturaTani.guidBicimli).toBe(guidBicimli);
    expect(ebelgeDurumTani.ettnGecerli).toBe(ettnGecerli);
  });
  it('eski davranış: anahtar süslü parantez + boşluk + harf büyüklüğünü soyar; `ettnGecerli` kırpar ve sıfırı eler', () => {
    expect(guidAnahtari('  {ABC}  ')).toBe('abc');
    expect(guidAnahtari(null)).toBe('');
    expect(ettnGecerli(' abcdef12-3456-7890-abcd-ef1234567890 ')).toBe(true);
    expect(ettnGecerli('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
  it('lib/ettn YAPRAK modül (içe aktarması yok); faturaTani içe aktarıp yeniden dışa aktarır, tanım kopyası yok', () => {
    const ettnKod = kodSatirlari(join(SRC_KOK, 'lib', 'ettn.ts')).map(s => s.kod).join('\n');
    expect(ettnKod).not.toMatch(/^\s*import\b/m);
    const tani = kodSatirlari(join(SRC_KOK, 'server', 'mikro', 'faturaTani.ts')).map(s => s.kod).join('\n');
    expect(tani).toMatch(/import \{ guidAnahtari, guidBicimli \} from '\.\.\/\.\.\/lib\/ettn\.js';/);
    expect(tani).toMatch(/export \{ guidAnahtari, guidBicimli \};/);
    expect(tani).not.toMatch(/const guid(Anahtari|Bicimli)\s*=/);
    const durum = kodSatirlari(join(SRC_KOK, 'server', 'mikro', 'ebelgeDurumTani.ts')).map(s => s.kod).join('\n');
    expect(durum).toMatch(/export \{ ettnGecerli \} from '\.\.\/\.\.\/lib\/ettn\.js';/);
    expect(durum).not.toMatch(/const ettnGecerli\s*=/);
  });
  it('lib/gibDurum.ts\'teki katı yerel kopya bu işte DEĞİŞMEDİ (ayrı iş): kendi ETTN_BICIMI\'ni taşır, lib/ettn\'i içe aktarmaz', () => {
    const kod = oku(join(SRC_KOK, 'lib', 'gibDurum.ts'));
    expect(kod).toMatch(/const ETTN_BICIMI = \/\^\[0-9a-fA-F\]\{8\}\(-\[0-9a-fA-F\]\{4\}\)\{3\}-\[0-9a-fA-F\]\{12\}\$\/;/);
    expect(kod).not.toMatch(/from '\.\/ettn/);
  });
});

describe('ÇİT — GUID düzenli ifadesi istemci üretim kodunda geçmez (ölçüt lib/ettn\'den okunur)', () => {
  // GUID kalıbının ayırt edici parçaları: `]{8}(-`, `{4}){3}`, `[0-9a-fA-F-]{36}`, `]{12}$`. (8 onaltılık tek başına GUID değildir —
  // ör. utils/muhasebe/depoNo.ts kiracı önekli depo kimliği `mikro-<8 hex>-depo-<no>`.)
  it('src/components, src/pages, src/utils: GUID düzenli ifadesi YOK', () => {
    const ihlal: string[] = [];
    for (const dizin of ['components', 'pages', 'utils']) {
      for (const yol of kaynakDosyalari(join(SRC_KOK, dizin))) {
        for (const s of kodSatirlari(yol)) {
          if (/\]\{8\}\(-|\{4\}\)\{3\}|\[0-9a-fA-F-\]\{36\}|\]\{12\}\$/.test(s.kod)) ihlal.push(`${gorece(yol)}:${s.n}`);
        }
      }
    }
    expect(ihlal).toEqual([]);
  });
});
