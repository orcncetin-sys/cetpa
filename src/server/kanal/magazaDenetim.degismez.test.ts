// @vitest-environment node
/**
 * magazaDenetim.degismez.test.ts — mağaza dilim 2a'nın denetim günlüğü EYLEM ADLARI (şartname § 6) kapalı kümedir.
 *
 * Denetim günlüğü eylem adına göre okunur / süzülür; ad iki yerde iki biçimde yazılırsa (ASCII'leşmiş «Magaza», farklı
 * ek, yeni bir ad) kayıt bulunamaz ve kimse fark etmez. Ortak bir yardımcı modül YOKTUR (yazma işlevleri ve rotalar adı
 * yerinde yazar); kümenin tek kaynağı bu çittir. Kurallar:
 *  • dört eylem adı, harfi harfine: panel oturumu · talep durumu · kalem teslimi · elle bildirim;
 *  • «etiket basıldı» denetime GİRMEZ (panel işlemi; sayaç yeter — V23);
 *  • panel oturumu ayrıntısı yalnız `açıldı` / `kapandı` + e-posta: kod, doğrulayıcı, belirteç, `meydan` YAZILMAZ.
 * Çağrıların GERÇEKTEN yapıldığı ve ayrıntının ne taşıdığı davranış testlerinde sınanır (magazaDurum.pglite.test.ts,
 * rota testleri); burada yalnız adların kümesi ve yazımı kilitlenir.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';

const DOSYALAR = ['kanal/magazaDurum.ts', 'routes/magazaPanelZinciri.ts', 'routes/magazaErpRoutes.ts'] as const;
const kodu = (goreli: string): string => kodSatirlari(join(SRC_KOK, 'server', goreli)).map(s => s.kod).join('\n');
/** Denetim çağrısının eylem adı: çağrıdan sonraki, aynı deyimdeki (`;`'den önceki) ilk tek tırnaklı dizge. */
const eylemAdlari = (kod: string): string[] => [...kod.matchAll(/(?:\bdenetle|\.writeAuditLog)\([^;']{0,300}'([^']*)'/g)].map(e => e[1]);

const BEKLENEN = ['Mağaza paneli oturumu', 'Mağaza talebi bildirimi elle kuyruğa alındı', 'Mağaza talebi durumu', 'Mağaza talebi kalem teslimi'];

describe('mağaza denetim eylem adları — kapalı küme (§ 6)', () => {
  const dosyaBasina = Object.fromEntries(DOSYALAR.map(d => [d, eylemAdlari(kodu(d))]));
  const hepsi = Object.values(dosyaBasina).flat();

  it('dört eylem adı, harfi harfine; başka ad yok', () => {
    expect([...new Set(hepsi)].sort((a, b) => a.localeCompare(b, 'tr'))).toEqual(BEKLENEN);
  });

  it('her ad Türkçe tam karakterle («Mağaza …»); ASCII\'leşmiş yazım yok', () => {
    for (const ad of hepsi) {
      expect(ad, ad).toMatch(/^Mağaza /);
      expect(ad, ad).not.toMatch(/Magaza|kuyruga|alindi|bildirimi elle kuyruga/);
    }
  });

  it('yazma işlevleri üç adı yazar (durum iki çağrıda: yalnız açıklama + geçiş); panel zinciri yalnız oturumu (açıldı + kapandı)', () => {
    expect(dosyaBasina['kanal/magazaDurum.ts']).toEqual([
      'Mağaza talebi durumu', 'Mağaza talebi durumu', 'Mağaza talebi kalem teslimi', 'Mağaza talebi bildirimi elle kuyruğa alındı',
    ]);
    expect(dosyaBasina['routes/magazaPanelZinciri.ts']).toEqual(['Mağaza paneli oturumu', 'Mağaza paneli oturumu']);
    // ERP rota modülü denetimi KENDİSİ yazmaz: üç ucu da yazma işlevine devreder (ad tek yerde kalır).
    expect(dosyaBasina['routes/magazaErpRoutes.ts']).toEqual([]);
  });

  it('«etiket basıldı» denetime girmez: hiçbir eylem adı etiketi anmaz', () => {
    for (const ad of hepsi) expect(ad).not.toMatch(/tiket/i);
  });

  it('panel oturumu denetim çağrıları kod / doğrulayıcı / belirteç / meydan taşımaz; ayrıntı `açıldı` ve `kapandı` ile başlar', () => {
    const cagrilar = [...kodu('routes/magazaPanelZinciri.ts').matchAll(/\.writeAuditLog\(([^;]*)\);/g)].map(e => e[1]);
    expect(cagrilar).toHaveLength(2);
    for (const c of cagrilar) {
      expect(c, c).not.toMatch(/\b(kod|kodOzeti|dogrulayici|meydan|token|belirtec|govde|body)\b/);
      expect(c, c).toContain("'Mağaza paneli oturumu'");
    }
    expect(cagrilar.filter(c => /`açıldı · /.test(c))).toHaveLength(1);
    expect(cagrilar.filter(c => /[`']kapandı/.test(c))).toHaveLength(1);
  });
});
