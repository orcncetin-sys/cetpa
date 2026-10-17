// @vitest-environment jsdom
/**
 * DisRolEkrani.test.tsx — dış rol (B2B / Bayi) sayfası ve kapının SAF koşulları (şartname
 * `.wf/SARTNAME-dis-rol-kapanisi.md` D5, T4). Gerçek `App.tsx` ile uygulama düzeyi ölçüm (kabuk çizilmez, istek /
 * dinleyici / akış / zamanlayıcı 0) ve App bağ çitleri: `DisRolEkrani.uygulama.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DisRolEkrani, { disRolEkraniGosterilir, disRolMu, veriSekmesi } from './DisRolEkrani';
import { DIS_ROL, disRolMetni } from '../i18n/disRol';
import { APP_ROLES, EXTERNAL_ROLES, STAFF_ROLES } from '../lib/rbac';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';

afterEach(cleanup);

describe('disRolMu — üyelik rbac.ts `EXTERNAL_ROLES` kümesini İZLER (rol adı burada yazılmaz)', () => {
  it('küme boş değil; her dış rol EVET, her iç rol HAYIR; iki küme birlikte bütün rolleri kaplar', () => {
    expect(EXTERNAL_ROLES.length).toBeGreaterThan(0);
    expect(STAFF_ROLES.length).toBeGreaterThan(0);
    for (const rol of EXTERNAL_ROLES) expect(disRolMu(rol), rol).toBe(true);
    for (const rol of STAFF_ROLES) expect(disRolMu(rol), rol).toBe(false);
    expect(APP_ROLES.filter(r => disRolMu(r)).sort()).toEqual([...EXTERNAL_ROLES].sort());
    expect(APP_ROLES.filter(r => !disRolMu(r)).sort()).toEqual([...STAFF_ROLES].sort());
  });

  it('rol bilinmiyorsa HAYIR: rolsüz hesap bu kapının konusu değil; yazım farkı dış rol saymaz', () => {
    for (const rol of [null, undefined, '', ' ', 'bilinmeyen']) expect(disRolMu(rol), String(rol)).toBe(false);
    for (const rol of EXTERNAL_ROLES) {
      expect(disRolMu(rol.toLowerCase()), rol).toBe(false);
      expect(disRolMu(` ${rol}`), rol).toBe(false);
    }
  });
});

describe('disRolEkraniGosterilir — kabuk YERİNE sayfa', () => {
  const dis = EXTERNAL_ROLES[0];
  const ic = STAFF_ROLES[0];
  it.each([
    ['dış rol + oturum', { oturumVar: true, rol: dis, ikiAdimBekliyor: false }, true],
    ['dış rol, oturum yok (giriş sayfası çizilir)', { oturumVar: false, rol: dis, ikiAdimBekliyor: false }, false],
    ['dış rol görünüyor ama iki adımlı doğrulama bekliyor (rol bu oturumda okunmadı)', { oturumVar: true, rol: dis, ikiAdimBekliyor: true }, false],
    ['iç rol', { oturumVar: true, rol: ic, ikiAdimBekliyor: false }, false],
    ['rolsüz', { oturumVar: true, rol: undefined, ikiAdimBekliyor: false }, false],
  ] as const)('%s → %s', (_ad, girdi, beklenen) => {
    expect(disRolEkraniGosterilir(girdi)).toBe(beklenen);
  });

  it('her dış rol için aynı; hiçbir iç rol için değil', () => {
    for (const rol of EXTERNAL_ROLES) expect(disRolEkraniGosterilir({ oturumVar: true, rol, ikiAdimBekliyor: false }), rol).toBe(true);
    for (const rol of STAFF_ROLES) expect(disRolEkraniGosterilir({ oturumVar: true, rol, ikiAdimBekliyor: false }), rol).toBe(false);
  });
});

describe('veriSekmesi — sekme kapılı dinleyicilere giden sekme', () => {
  it('iç rol + oturum: sekme AYNEN geçer (bugünkü davranış)', () => {
    for (const rol of STAFF_ROLES) {
      for (const sekme of ['dashboard', 'inventory', 'satin-alma', 'online-siparisler']) {
        expect(veriSekmesi({ oturumVar: true, rol, sekme }), `${rol} ${sekme}`).toBe(sekme);
      }
    }
  });
  it('dış rol: her sekmede BOŞ (hiçbir sekme kapısı açılmaz)', () => {
    for (const rol of EXTERNAL_ROLES) {
      for (const sekme of ['dashboard', 'inventory', 'b2b', 'muhasebe']) {
        expect(veriSekmesi({ oturumVar: true, rol, sekme }), `${rol} ${sekme}`).toBe('');
      }
    }
  });
  it('oturum yokken BOŞ: rol henüz okunmadı, dinleyici oturumu bekler', () => {
    expect(veriSekmesi({ oturumVar: false, rol: STAFF_ROLES[0], sekme: 'dashboard' })).toBe('');
    expect(veriSekmesi({ oturumVar: false, rol: EXTERNAL_ROLES[0], sekme: 'dashboard' })).toBe('');
  });
  it('rolsüz oturum: bu kapı karışmaz (sekme geçer; rolsüz hesabı sunucu ve «rol atanmamış» uyarısı durdurur)', () => {
    expect(veriSekmesi({ oturumVar: true, rol: undefined, sekme: 'crm' })).toBe('crm');
  });
});

describe('DisRolEkrani — tek sayfa', () => {
  it('başlık, açıklama ve «Çıkış» — şartnamedeki metinlerle, tam Türkçe karakterle', () => {
    const { container } = render(<DisRolEkrani dil="tr" onCikis={() => {}} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bu hesap bayi hesabıdır');
    expect(container.querySelector('p')?.textContent).toBe('ERP ekranı bayi hesaplarına kapalıdır. Sipariş ve bilgi için CETPA ile iletişime geçin.');
    expect(screen.getByRole('button').textContent).toBe('Çıkış');
  });

  it('başlık hiyerarşisi ve yer imleri: tek `main`, tek başlık (h1), tek düğme; `lang` dile uyar', () => {
    const { container } = render(<DisRolEkrani dil="tr" onCikis={() => {}} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
    expect(screen.getByRole('main').getAttribute('lang')).toBe('tr');
    expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();   // simge süs: okuyucuya okunmaz
  });

  it('odak: sayfa açılınca başlıkta (ekran okuyucu değişikliği duyurur); başlık sekme sırasına girmez', () => {
    render(<DisRolEkrani dil="tr" onCikis={() => {}} />);
    const baslik = screen.getByRole('heading', { level: 1 });
    expect(document.activeElement).toBe(baslik);
    expect(baslik.getAttribute('tabindex')).toBe('-1');
  });

  it('bayi ekranı BAĞLANTISI yok (o ekran yayında değil): sayfada hiç bağlantı çizilmez', () => {
    const { container } = render(<DisRolEkrani dil="tr" onCikis={() => {}} />);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/href=|bayi\.html/);
  });

  it('«Çıkış» verilen işleyiciyi tam 1 kez çağırır; yanıt beklenirken düğme kapalıdır ve ikinci tıklama ikinci çağrı üretmez', async () => {
    let bitir: () => void = () => {};
    const onCikis = vi.fn(() => new Promise<void>(coz => { bitir = coz; }));
    render(<DisRolEkrani dil="tr" onCikis={onCikis} />);
    const dugme = screen.getByRole('button') as HTMLButtonElement;
    fireEvent.click(dugme);
    expect(onCikis).toHaveBeenCalledTimes(1);
    expect(dugme.disabled).toBe(true);
    expect(dugme.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(dugme);
    expect(onCikis).toHaveBeenCalledTimes(1);
    await act(async () => { bitir(); });
    expect(dugme.disabled).toBe(false);   // çıkış sürmediyse (sayfa hâlâ açıksa) yeniden denenebilir
  });

  it('koyu temada okunur: başlık ve metin rengi tema belirteçlerinden gelir (`text-gray-*` koyu temada yeniden eşlenmiyor)', () => {
    const { container } = render(<DisRolEkrani dil="tr" onCikis={() => {}} />);
    const baslik = screen.getByRole('heading', { level: 1 });
    const metin = container.querySelector('p');
    expect(baslik.getAttribute('style')).toContain('var(--text-primary)');
    expect(metin?.getAttribute('style')).toContain('var(--text-secondary)');
    expect(`${baslik.className} ${metin?.className}`).not.toMatch(/text-gray-|text-black|text-white/);
    expect(screen.getByRole('main').getAttribute('style')).toContain('var(--bg-base)');
  });

  it('İngilizce arayüz: metinler ve `lang` İngilizce', () => {
    render(<DisRolEkrani dil="en" onCikis={() => {}} />);
    expect(screen.getByRole('main').getAttribute('lang')).toBe('en');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This is a dealer account');
    expect(screen.getByRole('button').textContent).toBe('Log out');
  });
});

describe('sözlük (src/i18n/disRol.ts)', () => {
  it('iki dilde aynı anahtarlar, boş metin yok', () => {
    expect(Object.keys(DIS_ROL.en).sort()).toEqual(Object.keys(DIS_ROL.tr).sort());
    for (const dil of ['tr', 'en'] as const) {
      for (const [anahtar, metin] of Object.entries(DIS_ROL[dil])) expect(metin.trim().length, `${dil}.${anahtar}`).toBeGreaterThan(0);
    }
  });
  it('dil seçimi: `tr` / tanımsız / eski boolean bayrak → Türkçe; diğer → İngilizce', () => {
    expect(disRolMetni('tr')).toBe(DIS_ROL.tr);
    expect(disRolMetni(undefined)).toBe(DIS_ROL.tr);
    expect(disRolMetni(true)).toBe(DIS_ROL.tr);
    expect(disRolMetni('en')).toBe(DIS_ROL.en);
    expect(disRolMetni(false)).toBe(DIS_ROL.en);
  });
  it('Türkçe metinler tam karakterle yazılı (ç ğ ı ş); birleşik nokta (U+0307) yok', () => {
    const tr = Object.values(DIS_ROL.tr).join(' ');
    expect(tr.includes(String.fromCharCode(0x0307)), 'birleşik nokta').toBe(false);   // karakterin kendisi bu dosyaya yazılmaz (tarama temiz kalsın)
    for (const sozcuk of ['hesabıdır', 'kapalıdır', 'Sipariş', 'iletişime', 'geçin', 'Çıkış']) expect(tr, sozcuk).toContain(sozcuk);
  });
});

describe('DisRolEkrani.tsx kaynağı — bileşende rol adı yazılmaz, metin sözlükten gelir', () => {
  const kod = kodSatirlari(join(SRC_KOK, 'components', 'DisRolEkrani.tsx')).map(s => s.kod).join('\n');
  it('rol adı / rol enum\'u yok; üyelik `EXTERNAL_ROLES`tan', () => {
    for (const rol of APP_ROLES) expect(kod, rol).not.toMatch(new RegExp(`['"\`]${rol}['"\`]`));
    expect(kod).not.toMatch(/UserRole\./);
    expect(kod).toMatch(/import \{ EXTERNAL_ROLES \} from '\.\.\/lib\/rbac';/);
    expect(kod.match(/EXTERNAL_ROLES/g)).toHaveLength(2);   // içe aktarma + tek kullanım (disRolMu)
  });
  it('ekrana basılan metin satır içinde yazılmamış; Türkçe büyük harf dönüşümü yok', () => {
    expect(kod).toMatch(/import \{ disRolMetni \} from '\.\.\/i18n\/disRol';/);
    for (const metin of [...Object.values(DIS_ROL.tr), ...Object.values(DIS_ROL.en)]) expect(kod.includes(metin), metin).toBe(false);
    expect(kod).not.toMatch(/toUpperCase\(|toLocaleUpperCase\(|\buppercase\b/);
  });
});
