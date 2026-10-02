import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { adresYamasi } from './adresYamasi';
import { SRC_KOK as SRC, kodSatirlari } from '../test/kaynakTarama';

const V = 'https://api.luca.com.tr';

describe('adresYamasi — adres yalnız kullanıcı değiştirdiyse gövdeye girer', () => {
  it('dokunulmamış kutu gönderilmez (kayıt yokken varsayılan; kayıt varken kayıttaki)', () => {
    expect(adresYamasi('baseUrl', V, undefined, V)).toEqual({});
    expect(adresYamasi('baseUrl', V, '', V)).toEqual({});
    expect(adresYamasi('baseUrl', 'https://ozel.example', 'https://ozel.example', V)).toEqual({});
  });
  it('değişen adres gönderilir — özel adresten varsayılana DÖNÜŞ de (meşru değişiklik yutulmaz)', () => {
    expect(adresYamasi('baseUrl', 'https://ozel.example', undefined, V)).toEqual({ baseUrl: 'https://ozel.example' });
    expect(adresYamasi('baseUrl', V, 'https://ozel.example', V)).toEqual({ baseUrl: V });
    expect(adresYamasi('endpoint', '', 'https://ozel.example', V)).toEqual({ endpoint: '' });
  });
});

describe('ayar formları yardımcıyı ve kimlikli çağrıyı KULLANIR (kaynak çiti)', () => {
  const say = (dosya: string, desen: RegExp) => kodSatirlari(join(SRC, dosya)).filter(({ kod }) => desen.test(kod)).length;
  it('AccountingModule: Luca ve Mikro kaydı adresi adresYamasi ile kurar; çıplak `baseUrl: lucaBaseUrl` kalmadı', () => {
    expect(say('components/AccountingModule.tsx', /\.\.\.adresYamasi\('baseUrl', lucaBaseUrl, kayitliLucaBaseUrl\.current, LUCA_VARSAYILAN_ADRES\),/)).toBe(1);
    expect(say('components/AccountingModule.tsx', /\.\.\.adresYamasi\('endpoint', mikroEndpoint, kayitliMikroEndpoint\.current, MIKRO_VARSAYILAN_UC\),/)).toBe(1);
    expect(say('components/AccountingModule.tsx', /^\s*baseUrl: lucaBaseUrl,/)).toBe(0);
  });
  it('ERPHubPanel: durum çağrısı kimlik başlığıyla ve yanıt kodu denetlenerek; kayıt hatası yakalanır', () => {
    expect(say('components/ERPHubPanel.tsx', /authFetch\(erp\.statusPath\)/)).toBe(1);
    expect(say('components/ERPHubPanel.tsx', /(?<!auth)fetch\(erp\.statusPath\)/i)).toBe(0);
    expect(say('components/ERPHubPanel.tsx', /if \(!r\.ok\) throw new Error/)).toBe(1);
    expect(say('components/ERPHubPanel.tsx', /setKayitHatasi\(sunucuHataMetni\(err\)/)).toBe(1);
  });
  it('SettingsPage: iyzico taban adresi Yönetici dışındaki role salt okunur; boş yamada istek ve denetim kaydı yok', () => {
    expect(say('pages/SettingsPage.tsx', /readOnly=\{f\.key === 'baseUrl' && !adresDuzenler\}/)).toBe(1);
    for (const sayfa of ['pages/SettingsPage.tsx', 'pages/AdminPage.tsx']) {
      expect(say(sayfa, /if \(!Object\.keys\(yama\)\.length\) \{ toast\(.*'info'\); return; \}/), sayfa).toBe(1);
    }
  });
});
