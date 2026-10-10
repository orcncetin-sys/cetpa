// @vitest-environment node
/**
 * magazaPanelBaglan.test.ts — onay sayfasının saf yardımcıları (şartname v6 § 5.3, § 7 «İstemci — onay sayfası»).
 * Desen çiti: istemcinin «biçim tutuyor mu» hükmü sunucu şemasıyla (`YetkiKoduGovdesi`) AYNI iki sabitten gelir.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';
import { YetkiKoduGovdesi } from '../server/schemas';
import { MAGAZA_PANEL_BAGLAN_YOLU, baglanDonusuGecerli, baglanParametreleri } from './magazaPanelBaglan';

const MEYDAN = 'A-b_9'.repeat(8) + 'xyz';
const TUR = 'T'.repeat(22);

describe('mağaza paneli bağlan parametreleri (§ 5.3)', () => {
  it('yol sabiti', () => { expect(MAGAZA_PANEL_BAGLAN_YOLU).toBe('/magaza-panel-baglan'); });

  it('geçerli çift: `#` ile ve `#`siz, iki sırada da; tanınmayan alan yok sayılır', () => {
    expect(MEYDAN).toHaveLength(43);
    expect(baglanParametreleri(`#meydan=${MEYDAN}&tur=${TUR}`)).toEqual({ meydan: MEYDAN, tur: TUR });
    expect(baglanParametreleri(`tur=${TUR}&meydan=${MEYDAN}`)).toEqual({ meydan: MEYDAN, tur: TUR });
    expect(baglanParametreleri(`#meydan=${MEYDAN}&tur=${TUR}&dil=tr`)).toEqual({ meydan: MEYDAN, tur: TUR });
  });

  it('bozuk biçim `null`: boş · eksik alan · uzunluk · küme dışı karakter · yinelenen alan · yüzde kaçışlı yazım', () => {
    expect(baglanParametreleri('')).toBeNull();
    expect(baglanParametreleri('#')).toBeNull();
    expect(baglanParametreleri(`#meydan=${MEYDAN}`)).toBeNull();
    expect(baglanParametreleri(`#tur=${TUR}`)).toBeNull();
    expect(baglanParametreleri(`#meydan=${MEYDAN.slice(1)}&tur=${TUR}`)).toBeNull();
    expect(baglanParametreleri(`#meydan=${MEYDAN}&tur=${TUR}T`)).toBeNull();
    expect(baglanParametreleri(`#meydan=${'+'.repeat(43)}&tur=${TUR}`)).toBeNull();
    expect(baglanParametreleri(`#meydan=${MEYDAN}&tur=${TUR}&tur=${TUR}`)).toBeNull();
    expect(baglanParametreleri(`#meydan=${MEYDAN}&meydan=${MEYDAN}&tur=${TUR}`)).toBeNull();
    // Kaçış ÇÖZÜLMEZ: çözülünce 43 karaktere inen yazım da reddedilir (değer adres parçasındaki ham metindir).
    expect(baglanParametreleri(`#meydan=${MEYDAN.slice(0, 42)}%41&tur=${TUR}`)).toBeNull();
    expect(baglanParametreleri(`#meydan&tur=${TUR}`)).toBeNull();
  });

  it('istemcinin hükmü sunucu şemasıyla AYNI: `baglanParametreleri` çift döndürüyorsa `YetkiKoduGovdesi` de geçirir, döndürmüyorsa geçirmez', () => {
    const adaylar: Array<[string, string]> = [
      [MEYDAN, TUR], ['A'.repeat(43), 'B'.repeat(22)], ['A'.repeat(42), TUR], ['A'.repeat(44), TUR], [MEYDAN, 'T'.repeat(21)],
      [MEYDAN, 'T'.repeat(23)], [`${'A'.repeat(42)}.`, TUR], [MEYDAN, `${'T'.repeat(21)}/`], [`${'A'.repeat(42)}=`, TUR], ['', ''],
      [`${'A'.repeat(42)}ş`, TUR], [MEYDAN, `${'T'.repeat(21)} `],
    ];
    for (const [meydan, tur] of adaylar) {
      const istemci = baglanParametreleri(`#meydan=${meydan}&tur=${tur}`) !== null;
      expect(istemci, `${meydan} / ${tur}`).toBe(YetkiKoduGovdesi.safeParse({ meydan, tur }).success);
    }
  });

  it('kaynak çiti: desen KOPYALANMAZ — dosyada düzenli ifade yazımı yok, iki sabit ortak sözleşmeden içe aktarılır', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'lib', 'magazaPanelBaglan.ts')).map(s => s.kod).join('\n');
    expect(kod).toContain("import { MAGAZA_PANEL_43_DESENI, MAGAZA_PANEL_TUR_DESENI } from './magazaTalep';");
    expect(kod).not.toMatch(/A-Za-z|new RegExp|\{43\}|\{22\}/);
    expect(kod.match(/^import /gm)).toHaveLength(1);   // yaprak modül: istemci ya da sunucu kodu içe aktarmaz
    // Sunucu şeması da AYNI iki sabiti okur.
    const sema = kodSatirlari(join(SRC_KOK, 'server', 'schemas.ts')).map(s => s.kod).join('\n');
    expect(sema).toMatch(/YetkiKoduGovdesi = z\.object\(\{\s*meydan: z\.string\(\)\.regex\(MAGAZA_PANEL_43_DESENI\),\s*tur:\s+z\.string\(\)\.regex\(MAGAZA_PANEL_TUR_DESENI\),/);
  });
});

describe('dönüş adresi kilidi (`baglanDonusuGecerli`)', () => {
  it('yalnız dolu, `http(s):` şemalı mutlak adres geçer', () => {
    expect(baglanDonusuGecerli(`https://www.cetpa.com.tr/panel.html#kod=K&tur=${TUR}`)).toBe(true);
    expect(baglanDonusuGecerli('http://localhost:5601/panel.html#kod=K')).toBe(true);
    for (const kotu of ['', 'javascript:alert(1)', 'data:text/html,x', '/panel.html#kod=K', 'panel.html', null, undefined, 7, { donus: 'https://x' }]) {
      expect(baglanDonusuGecerli(kotu), String(kotu)).toBe(false);
    }
  });
});
