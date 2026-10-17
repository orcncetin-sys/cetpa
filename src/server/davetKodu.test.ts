// @vitest-environment node
/**
 * davetKodu.test.ts — davet kodu üreteci ve «daveti yazan HER uç bu üreteci kullanır» çiti (şartname «dış rol kapanışı» D11 / T10).
 *
 * NEDEN ÇİT: ilk düzeltme yalnız `POST /api/admin/invite`'a uygulanmıştı; süper yöneticinin kiracı daveti
 * (`POST /api/superadmin/tenants/:companyId/invite`) `Math.random().toString(36)` × 2 ile kalmıştı. Davet belgesini yazan
 * yeni bir uç eklenirse o da buraya düşer: kodu üreteçten almıyorsa kırmızı.
 * Gerçek zincirde iki ucun ürettiği kod: kucukKapanislar.zincir.test.ts (T10).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC_KOK, kaynakDosyalari, kodSatirlari, gorece, suclular } from '../test/kaynakTarama';
import { DAVET_KODU_DESENI, davetKoduUret } from './davetKodu';

describe('davetKoduUret — 32 bayt güvenli rastgele, 64 onaltılık hane', () => {
  it('biçim: tam 64 küçük onaltılık hane; bağlantıda kaçış gerektirmez', () => {
    for (let i = 0; i < 50; i++) {
      const kod = davetKoduUret();
      expect(kod).toMatch(DAVET_KODU_DESENI);
      expect(kod).toHaveLength(64);
      expect(encodeURIComponent(kod)).toBe(kod);
    }
  });

  it('her çağrıda farklı (1.000 kodda tekrar yok)', () => {
    const kodlar = new Set(Array.from({ length: 1000 }, () => davetKoduUret()));
    expect(kodlar.size).toBe(1000);
  });

  it('eski biçim desene UYMAZ (36\'lık tabanda iki `Math.random` parçası: kısa ve `g`–`z` harfli)', () => {
    expect('k3j9x0q1zr8m4p7w2v5tyb').not.toMatch(DAVET_KODU_DESENI);
    expect('0123456789abcdef'.repeat(4)).toMatch(DAVET_KODU_DESENI);
    expect('0123456789ABCDEF'.repeat(4)).not.toMatch(DAVET_KODU_DESENI);
    expect(`${'0123456789abcdef'.repeat(4)}0`).not.toMatch(DAVET_KODU_DESENI);
  });
});

describe('bağlantı çiti — `invites` belgesi YAZAN her modül kodu `davetKoduUret()` ile üretir', () => {
  const dosyalar = [join(SRC_KOK, '..', 'server.ts'), ...kaynakDosyalari(join(SRC_KOK, 'server'))];
  /** `invites` belgesine `.set(` ile yazan satır; 1. grup belge kimliği olan değişken. */
  const YAZIM = /collection\('invites'\)\.doc\((\w+)\)\.set\(/;
  interface Yazim { site: string; degisken: string; tur: 'yeni-davet' | 'kullanildi-isareti' | 'bilinmiyor'; atama: string }
  /**
   * Her `invites` yazımı ve türü. YENİ DAVET yazımı `used: false` taşır (kod = belge kimliği burada DOĞAR); kullanım ucu aynı
   * belgeyi `used: true` ile işaretler (kod istemciden gelir, burada üretilmez). İkisi de değilse «bilinmiyor» → çit kırılır.
   */
  function yazimlar(): Yazim[] {
    const out: Yazim[] = [];
    for (const yol of dosyalar) {
      const satirlar = kodSatirlari(yol);
      satirlar.forEach((s, i) => {
        const m = YAZIM.exec(s.kod);
        if (!m) return;
        const deyim = satirlar.slice(i, i + 8).map(x => x.kod).join('\n');
        const tur = /\bused: false\b/.test(deyim) ? 'yeni-davet' : /\bused: true\b/.test(deyim) ? 'kullanildi-isareti' : 'bilinmiyor';
        // Yazımdan geriye doğru, işleyicinin başına (`app.<yöntem>(`) kadar: değişkenin atandığı satır.
        let atama = '';
        for (let j = i; j >= 0; j--) {
          if (new RegExp(`\\bconst ${m[1]} = `).test(satirlar[j].kod)) { atama = satirlar[j].kod.trim(); break; }
          if (/^\s*app\.(get|post|put|patch|delete)\(/.test(satirlar[j].kod)) break;
        }
        out.push({ site: `${gorece(yol)}:${s.n}`, degisken: m[1], tur, atama });
      });
    }
    return out;
  }

  it('yazımlar biliniyor: iki uç YENİ davet yazar, kullanım ucu yalnız işaretler (yenisi eklenirse bu sayım bilerek güncellenir)', () => {
    const hepsi = yazimlar();
    expect(hepsi.filter(y => y.tur === 'bilinmiyor')).toEqual([]);
    expect(hepsi.filter(y => y.tur === 'yeni-davet').map(y => y.site.replace(/:\d+$/, '')).sort())
      .toEqual(['src/server/routes/epostaRoutes.ts', 'src/server/routes/superadminRoutes.ts']);
    expect(hepsi.filter(y => y.tur === 'kullanildi-isareti').map(y => y.site.replace(/:\d+$/, ''))).toEqual(['src/server/routes/epostaRoutes.ts']);
  });

  it('YENİ davet yazan her uçta belge kimliği AYNI işleyicide `davetKoduUret()` ile atanmış', () => {
    const yeni = yazimlar().filter(y => y.tur === 'yeni-davet');
    expect(yeni).toHaveLength(2);
    for (const y of yeni) expect(y.atama, `${y.site} — «${y.degisken}» nereden geliyor?`).toBe(`const ${y.degisken} = davetKoduUret();`);
  });

  it('sunucu kaynağında `Math.random` ile `token` üreten satır yok; `davetKoduUret` yalnız davetKodu.ts\'te tanımlı', () => {
    expect(suclular(dosyalar, /\btoken\b\s*=\s*.*Math\.random\(/)).toEqual([]);
    const tanimlar = suclular(dosyalar, /function davetKoduUret\(/).map(s => s.site.replace(/:\d+$/, ''));
    expect(tanimlar).toEqual(['src/server/davetKodu.ts']);
    // Üreteç gerçekten güvenli kaynağı çağırıyor (gövdesi değişirse biçim testi yetmeyebilir: `Math.random` da onaltılık yazılabilir).
    const govde = kodSatirlari(join(SRC_KOK, 'server', 'davetKodu.ts')).map(s => s.kod).join('\n');
    expect(govde).toMatch(/import \{ randomBytes \} from 'node:crypto';/);
    expect(govde).toMatch(/return randomBytes\(32\)\.toString\('hex'\);/);
    expect(govde).not.toMatch(/Math\.random/);
  });
});
