// @vitest-environment node
/**
 * magazaBayiBelirtec.test.ts — belirteç modülünün TÜRE açılması (2026-10-21, şartname `.wf/SARTNAME-musteri-siparislerim.md` H3):
 * panel (`mp1-`, `magaza-panel-v1`, panel.html) ve müşteri / bayi ekranı (`mb1-`, `magaza-bayi-v1`, bayi.html) AYRI türlerdir; panel
 * belirteci bayi kapısında ANAHTAR düzeyinde geçersizdir. Panel sarmalayıcıları DEĞİŞMEDİ (magazaPanel.test.ts aynen geçer).
 */
import { describe, it, expect } from 'vitest';
import {
  BAYI_BELIRTECI, MAGAZA_PANEL_ANAHTAR_ETIKETI, MAGAZA_PANEL_BELIRTEC_ONEKI, MAGAZA_PANEL_DONUS_VARSAYILAN, PANEL_BELIRTECI, anahtarTuret,
  bayiKimlikAnahtariTuret, belirtecCoz, belirtecUret, donusTabaniCoz, donusTabaniCozTur, panelAnahtariTuret, panelBelirteciCoz, panelBelirteciUret,
  type PanelBelirtecYuku,
} from './magazaPanelBelirtec';

const IZINLI = ['https://www.cetpa.com.tr'];
const ORTAK = { sirVar: true, oturumSirri: 'ayni-sir', appUrl: 'https://app.cetpa.com.tr' };
const DONUS = 'https://www.cetpa.com.tr/panel.html';
const YUK: PanelBelirtecYuku = { uid: 'b1', cid: 'CETPA', rol: 'Dealer', ad: 'Bayi', eposta: 'b@ornek.com', mfa: false, bas: 1, bitis: 2 };
const zorunlu = (b: Buffer | null): Buffer => { if (!b) throw new Error('anahtar türetilemedi'); return b; };

describe('belirteç türleri — tek nesneden önek / etiket / dönüş varsayılanı', () => {
  it('iki tür dondurulmuş ve AYRIŞIK; eski panel sabitleri PANEL_BELIRTECI\'ne bağlı', () => {
    expect(PANEL_BELIRTECI).toEqual({ onek: 'mp1-', etiket: 'magaza-panel-v1', donusVarsayilan: 'https://www.cetpa.com.tr/panel.html' });
    expect(BAYI_BELIRTECI).toEqual({ onek: 'mb1-', etiket: 'magaza-bayi-v1', donusVarsayilan: 'https://www.cetpa.com.tr/bayi.html' });
    expect(Object.isFrozen(PANEL_BELIRTECI) && Object.isFrozen(BAYI_BELIRTECI)).toBe(true);
    expect([MAGAZA_PANEL_BELIRTEC_ONEKI, MAGAZA_PANEL_ANAHTAR_ETIKETI, MAGAZA_PANEL_DONUS_VARSAYILAN]).toEqual(['mp1-', 'magaza-panel-v1', 'https://www.cetpa.com.tr/panel.html']);
  });

  it('AYNI sır, APP_URL ve dönüş tabanıyla bayi ve panel anahtarı EŞİT DEĞİL (etiket ayrı)', () => {
    const panel = zorunlu(anahtarTuret(PANEL_BELIRTECI, { ...ORTAK, donusTabani: DONUS }));
    const bayi = zorunlu(anahtarTuret(BAYI_BELIRTECI, { ...ORTAK, donusTabani: DONUS }));
    expect(panel.equals(bayi)).toBe(false);
    expect(zorunlu(panelAnahtariTuret({ ...ORTAK, donusTabani: DONUS })).equals(panel)).toBe(true);   // sarmalayıcı aynı anahtar
    expect(anahtarTuret(BAYI_BELIRTECI, { ...ORTAK, sirVar: false, donusTabani: DONUS })).toBeNull();
    expect(anahtarTuret(BAYI_BELIRTECI, { ...ORTAK, donusTabani: null })).toBeNull();
  });

  it('panel belirteci ve panel anahtarıyla üretilen `mb1-` belirteci bayi çözücüsünde `null`; bayi belirteci panel çözücüsünde `null`', () => {
    const panelAnahtari = zorunlu(anahtarTuret(PANEL_BELIRTECI, { ...ORTAK, donusTabani: DONUS }));
    const bayiAnahtari = zorunlu(anahtarTuret(BAYI_BELIRTECI, { ...ORTAK, donusTabani: 'https://www.cetpa.com.tr/bayi.html' }));
    const panelBelirteci = panelBelirteciUret(panelAnahtari, YUK);
    expect(panelBelirteci.startsWith('mp1-')).toBe(true);
    expect(belirtecCoz(BAYI_BELIRTECI, bayiAnahtari, panelBelirteci)).toBeNull();
    // Önek düzeltilse de (`mb1-` + panel anahtarıyla imza) bayi anahtarı reddeder.
    const sahte = belirtecUret(BAYI_BELIRTECI, panelAnahtari, YUK);
    expect(sahte.startsWith('mb1-')).toBe(true);
    expect(belirtecCoz(BAYI_BELIRTECI, bayiAnahtari, sahte)).toBeNull();
    // Gerçek bayi belirteci bayide çözülür, panelde çözülmez.
    const gercek = belirtecUret(BAYI_BELIRTECI, bayiAnahtari, YUK);
    expect(belirtecCoz(BAYI_BELIRTECI, bayiAnahtari, gercek)).toEqual(YUK);
    expect(panelBelirteciCoz(panelAnahtari, gercek)).toBeNull();
    expect(panelBelirteciCoz(bayiAnahtari, gercek)).toBeNull();
  });

  it('boş ya da boşluklu `MAGAZA_BAYI_DONUS` → bayi.html (panel.html DEĞİL); geçersiz ayar → null; panel çözücüsü değişmedi', () => {
    for (const ham of [undefined, '', '   ']) {
      expect(donusTabaniCozTur(BAYI_BELIRTECI, ham, { uretim: true, izinliKokenler: IZINLI }), JSON.stringify(ham)).toBe('https://www.cetpa.com.tr/bayi.html');
      expect(donusTabaniCoz(ham, { uretim: true, izinliKokenler: IZINLI })).toBe('https://www.cetpa.com.tr/panel.html');
    }
    for (const bozuk of ['http://www.cetpa.com.tr/bayi.html', 'https://www.cetpa.com.tr/bayi.html?x=1', 'https://evil.example/bayi.html', 'https://u:p@www.cetpa.com.tr/bayi.html', 'bozuk']) {
      expect(donusTabaniCozTur(BAYI_BELIRTECI, bozuk, { uretim: true, izinliKokenler: IZINLI }), bozuk).toBeNull();
    }
    expect(donusTabaniCozTur(BAYI_BELIRTECI, 'https://www.cetpa.com.tr/bayi.html#', { uretim: true, izinliKokenler: IZINLI })).toBe('https://www.cetpa.com.tr/bayi.html');
  });

  it('sipariş kimliği anahtarı imza anahtarından AYRI; sır yoksa null', () => {
    const imza = zorunlu(anahtarTuret(BAYI_BELIRTECI, { ...ORTAK, donusTabani: 'https://www.cetpa.com.tr/bayi.html' }));
    const kimlik = zorunlu(bayiKimlikAnahtariTuret(ORTAK));
    expect(kimlik.equals(imza)).toBe(false);
    expect(kimlik.equals(zorunlu(anahtarTuret(PANEL_BELIRTECI, { ...ORTAK, donusTabani: DONUS })))).toBe(false);
    expect(bayiKimlikAnahtariTuret({ ...ORTAK, sirVar: false })).toBeNull();
    expect(zorunlu(bayiKimlikAnahtariTuret({ ...ORTAK, appUrl: 'https://hazirlik.cetpa.com.tr' })).equals(kimlik)).toBe(false);
  });
});
