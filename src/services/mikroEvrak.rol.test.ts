/**
 * mikroEvrak.rol.test.ts — `pushMikroEvrak` rol süzgeci: rol yöntemin kapısından geçemiyorsa istek HİÇ ATILMAZ
 * (karar turu 2026-10-11 — şartname § 10: İ3 «sessiz 403 kalmaz», İ4 «tek kaynak», H7 «sessiz çağrılar tek yerde durur»).
 *
 * Üç çağıran sonucu YOK SAYAR (`.catch(() => {})`): sayım (MobileWMS), izin onayı (IKPage), ziyaret (CRM). Karar turu
 * yöntem kapılarını daraltınca bu çağrılar kilitli rolde sessiz 403'e dönerdi — kullanıcı hiçbir şey görmez, sunucu
 * günlüğü dolar. Koşul çağıranlara ayrı ayrı yazılmadı: süzgeç `pushMikroEvrak`'ın içinde, sunucu kapısının okuduğu AYNI
 * tablodan (`evrakKapisindanGecer`), rol depodan. Bu dosya şunları kilitler:
 *   1) TEK KAYNAK — tablodaki her yöntem × her rol: istek atılır ⇔ rol kapıdan geçer;
 *   2) sessiz çağıranlar ELLE (K3-d sayım, K3-f izin, ziyaret) + dekont penceresi (K3-a);
 *   3) durdurulan çağrının sonucu AYIRT EDİLEBİLİR (`istekAtilmadi`) ve kuyruğa GİRMEZ; sunucunun 403'ü ayrı kalır;
 *   4) gönderim ucunun istemcideki TEK çağıranı bu servis (kaynak çiti) — süzgecin yanından geçen yol yok.
 * Yeniden deneme kuyruğunun yürütücüsü bu dosyanın konusu DEĞİL (`mikroRetry.test.ts`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { UserRole } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { MIKRO_EVRAK_KAPILARI, evrakKapisindanGecer } from '../lib/mikroEvrakKapilari';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari, oku } from '../test/kaynakTarama';

const h = vi.hoisted(() => ({ authFetch: vi.fn(), kuyruk: vi.fn() }));
vi.mock('./authFetch', () => ({ authFetch: (...a: unknown[]) => h.authFetch(...a) }));
// Kuyruk gerçek veritabanı istemcisine gitmesin: içe aktarımlar zararsız sahte, `enqueueSyncJob` casus. Modülün geri kalanı
// (yürütücü, `IsiBirak`) GERÇEK — servis onları adıyla içe aktarıyor.
vi.mock('../lib/dbClient', () => ({
  collection: vi.fn(), doc: vi.fn(), query: vi.fn(), where: vi.fn(), limit: vi.fn(),
  setDoc: vi.fn(), getDocs: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), compareAndSet: vi.fn(),
}));
vi.mock('./syncRetryService', async importOriginal => ({
  ...(await importOriginal<typeof import('./syncRetryService')>()),
  enqueueSyncJob: (...a: unknown[]) => h.kuyruk(...a),
}));

import { pushMikroEvrak } from './mikroEvrak';
import { useAppStore } from '../store/appStore';

const ROLLER = Object.values(UserRole);
const rolKoy = (rol: unknown) => { useAppStore.setState({ userRole: rol as UserRole }); };
const yanit = (kod: number, govde: unknown) => ({ status: kod, ok: kod >= 200 && kod < 300, json: async () => govde });
const sirali = (a: readonly string[]): string[] => [...a].sort();
const DURDU = { success: false, yetkiYok: true, istekAtilmadi: true, error: 'Rolünüz bu işlemi Mikro\'ya gönderemez; istek atılmadı.' };
/** Bu rolle yöntem gönderilince sunucuya istek ATILDI MI? */
const istekAtanRoller = async (yontem: string): Promise<UserRole[]> => {
  const out: UserRole[] = [];
  for (const rol of ROLLER) {
    h.authFetch.mockClear();
    rolKoy(rol);
    await pushMikroEvrak(yontem, { a: 1 }, { entityType: 'deneme', entityId: 'k1' });
    if (h.authFetch.mock.calls.length > 0) out.push(rol);
  }
  return out;
};

beforeEach(() => {
  h.authFetch.mockReset();
  h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null }));
  h.kuyruk.mockReset();
  h.kuyruk.mockResolvedValue(undefined);
});
afterEach(() => { useAppStore.setState(useAppStore.getInitialState(), true); });

describe('pushMikroEvrak — tek kaynak: istek ⇔ sunucunun yöntem kapısı', () => {
  it('denenen rol listesi sunucunun rol listesiyle AYNI', () => {
    expect(sirali(ROLLER)).toEqual(sirali(APP_ROLES));
  });

  it('tablodaki HER yöntem × HER rol: istek atılır ⇔ rol yöntemin kapısından geçer', async () => {
    const ayrisan: string[] = [];
    let atilan = 0, durdurulan = 0;
    for (const yontem of MIKRO_EVRAK_KAPILARI.keys()) {
      const atan = new Set(await istekAtanRoller(yontem));
      for (const rol of ROLLER) {
        const gecer = evrakKapisindanGecer(rol, yontem);
        if (atan.has(rol) !== gecer) ayrisan.push(`${yontem} × ${rol}: istek ${atan.has(rol) ? 'ATILDI' : 'atılmadı'}, kapı ${gecer ? 'geçirir' : 'geçirmez'}`);
        if (gecer) atilan++; else durdurulan++;
      }
    }
    expect(ayrisan).toEqual([]);
    expect(atilan).toBeGreaterThan(MIKRO_EVRAK_KAPILARI.size);       // iki durum da gerçekten görüldü (yanlış yeşil yok)
    expect(durdurulan).toBeGreaterThan(MIKRO_EVRAK_KAPILARI.size);
  });
});

describe('pushMikroEvrak — sessiz çağıranlar ve dekont penceresi (§ 10.1), ELLE', () => {
  /** Yöntemi düğmesiz çağıran yer + kapıdan geçen roller. Bu kümenin DIŞINDAKİ her rolde istek atılmaz. */
  const ELLE: [cagiran: string, yontem: string, gecen: UserRole[]][] = [
    ['K3-d — sayım kaydından sonra (MobileWMS)', 'SayimSonuclariKaydetV2', [UserRole.Admin, UserRole.Manager, UserRole.Logistics]],
    ['K3-f — izin onayından sonra (IKPage)', 'PersonelIzinTalepKaydetV2', [UserRole.Admin, UserRole.HR, UserRole.Manager]],
    ['ziyaret etkinliğinden sonra (CRM)', 'ZiyaretKaydetV2', [UserRole.Admin, UserRole.Manager, UserRole.Sales]],
    ['K3-a — dekont penceresi', 'DekontKaydetV2', [UserRole.Admin, UserRole.Manager, UserRole.Accounting]],
  ];

  it.each(ELLE)('%s: %s isteğini atan roller TAM OLARAK karardaki «geçen roller»', async (_cagiran, yontem, gecen) => {
    expect(sirali(await istekAtanRoller(yontem))).toEqual(sirali(gecen));
  });

  it.each([
    ['K3-a', 'DekontKaydetV2', UserRole.Sales],
    ['K3-a', 'DekontKaydetV2', UserRole.Purchasing],
    ['K3-d', 'SayimSonuclariKaydetV2', UserRole.Purchasing],
    ['K3-d', 'SayimSonuclariKaydetV2', UserRole.Accounting],
    ['K3-f', 'PersonelIzinTalepKaydetV2', UserRole.Accounting],
    ['ziyaret', 'ZiyaretKaydetV2', UserRole.Accounting],
    ['ziyaret', 'ZiyaretKaydetV2', UserRole.Purchasing],
  ])('%s — %s × %s (kilitli rol): istek ATILMAZ, kuyruğa GİRMEZ, sonuç ayırt edilir', async (_karar, yontem, rol) => {
    rolKoy(rol);
    await expect(pushMikroEvrak(yontem, { a: 1 }, { entityId: 'k1' })).resolves.toEqual(DURDU);
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(h.kuyruk).not.toHaveBeenCalled();
  });
});

describe('pushMikroEvrak — durdurulan çağrının sonucu', () => {
  it('fırlatmaz, çözülür: sessiz çağıranın `.catch`\'i tetiklenmez; `success` yanlış, metin dolu', async () => {
    rolKoy(UserRole.Purchasing);
    const yakalandi = vi.fn();
    const sonuc = await pushMikroEvrak('SayimSonuclariKaydetV2', { a: 1 }).catch(yakalandi);
    expect(yakalandi).not.toHaveBeenCalled();
    expect(sonuc).toEqual(DURDU);
  });

  it('AĞ KAPALI olsa da kilitli rolün işi kuyruğa girmez (istek hiç denenmedi — yetkili oturuma iş bırakılmaz)', async () => {
    h.authFetch.mockRejectedValue(new Error('Failed to fetch'));
    rolKoy(UserRole.Sales);
    expect(await pushMikroEvrak('DekontKaydetV2', { a: 1 }, { entityId: 'c1' })).toEqual(DURDU);
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(h.kuyruk).not.toHaveBeenCalled();
  });

  it('sunucunun 403\'ü AYRI kalır: istek atılmıştır, `yetkiYok` var, `istekAtilmadi` YOK (rol istemcide bayat / MFA)', async () => {
    h.authFetch.mockResolvedValue(yanit(403, { error: 'Bu veri için yetkiniz yok.' }));
    rolKoy(UserRole.Accounting);
    const sonuc = await pushMikroEvrak('DekontKaydetV2', { a: 1 });
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    expect(sonuc).toEqual({ error: 'Bu veri için yetkiniz yok.', yetkiYok: true });
    expect('istekAtilmadi' in sonuc).toBe(false);
  });
});

describe('pushMikroEvrak — geçen rolde davranış DEĞİŞMEDİ', () => {
  it('istek tek uca, yöntem + gövde + varlık bilgisiyle gider; yanıt gövdesi olduğu gibi döner', async () => {
    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: { no: 7 } }));
    rolKoy(UserRole.Accounting);
    expect(await pushMikroEvrak('DekontKaydetV2', { a: 1 }, { entityType: 'cariDekont', entityId: 'c1' }))
      .toEqual({ success: true, error: null, data: { no: 7 } });
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    const [yol, secenek] = h.authFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(yol).toBe('/api/mikro/evrak/kaydet');
    expect(secenek.method).toBe('POST');
    expect(JSON.parse(secenek.body)).toEqual({ method: 'DekontKaydetV2', payload: { a: 1 }, entityType: 'cariDekont', entityId: 'c1' });
    expect(h.kuyruk).not.toHaveBeenCalled();
  });

  it('ağ hatası: geçen rolün işi eskisi gibi yeniden deneme kuyruğuna girer (yöntem + gövde korunur)', async () => {
    h.authFetch.mockRejectedValue(new Error('Failed to fetch'));
    rolKoy(UserRole.Logistics);
    expect(await pushMikroEvrak('SayimSonuclariKaydetV2', { a: 1 }, { entityId: 'gun-1' })).toEqual({ success: false, error: 'Failed to fetch' });
    expect(h.kuyruk).toHaveBeenCalledTimes(1);
    expect(h.kuyruk.mock.calls[0][0]).toMatchObject({
      type: 'mikro', payload: { method: 'SayimSonuclariKaydetV2', payload: { a: 1 }, meta: { entityId: 'gun-1' } },
    });
  });
});

describe('pushMikroEvrak — rol kaynağı DEPO: bilinen sınırlar', () => {
  it.each([
    ['null', null], ['undefined', undefined], ['boş dize', ''], ['küçük harfli rol', 'admin'], ['tanınmayan rol', 'Depocu'],
  ])('rolsüz / bozuk rol değeri (%s): HİÇBİR yöntemde istek atılmaz — iç personel kapılı ve tabloda olmayan yöntem dâhil', async (_ad, rol) => {
    rolKoy(rol);
    for (const yontem of [...MIKRO_EVRAK_KAPILARI.keys(), 'TablodaOlmayanYontemV2']) {
      expect(await pushMikroEvrak(yontem, { a: 1 }), yontem).toEqual(DURDU);
    }
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(h.kuyruk).not.toHaveBeenCalled();
  });

  it('yüklenmemiş rol: depo ilk durumundayken (profil gelmedi) cari borç / alacak yazan dekont GİTMEZ', async () => {
    expect(await pushMikroEvrak('DekontKaydetV2', { a: 1 })).toEqual(DURDU);   // depoya hiç dokunulmadı
    expect(h.authFetch).not.toHaveBeenCalled();
  });

  it('rol çağrı ANINDA okunur (depo değişince sonraki çağrı yeni role göre)', async () => {
    rolKoy(UserRole.Purchasing);
    expect((await pushMikroEvrak('DekontKaydetV2', { a: 1 })).istekAtilmadi).toBe(true);
    rolKoy(UserRole.Accounting);
    expect((await pushMikroEvrak('DekontKaydetV2', { a: 1 })).success).toBe(true);
    expect(h.authFetch).toHaveBeenCalledTimes(1);
  });

  it('tabloda OLMAYAN yöntem sunucudaki kapıyla AYNI: iç rolde istek gider (sunucu 400 der — yüksek sesle), dış rolde gitmez', async () => {
    h.authFetch.mockResolvedValue(yanit(400, { success: false, error: 'Desteklenmeyen yöntem.' }));
    rolKoy(UserRole.Logistics);
    expect(await pushMikroEvrak('TablodaOlmayanYontemV2', { a: 1 })).toEqual({ success: false, error: 'Desteklenmeyen yöntem.' });
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    rolKoy(UserRole.Dealer);
    expect(await pushMikroEvrak('TablodaOlmayanYontemV2', { a: 1 })).toEqual(DURDU);
    expect(h.authFetch).toHaveBeenCalledTimes(1);
  });
});

// ── Kaynak çitleri ──────────────────────────────────────────────────────────
describe('ÇİT: gönderim ucunun istemcideki TEK çağıranı bu servis', () => {
  const SERVIS = join(SRC_KOK, 'services', 'mikroEvrak.ts');
  const UC = '/api/mikro/evrak/kaydet';

  it('uç adresi (yorumlar hariç) sunucu dışında YALNIZ `services/mikroEvrak.ts`\'te geçer — süzgecin yanından geçen yol yok', () => {
    const geciren = kaynakDosyalari(SRC_KOK)
      .filter(yol => !gorece(yol).startsWith('src/server/') && oku(yol).includes(UC))
      .filter(yol => kodSatirlari(yol).some(s => s.kod.includes(UC)))
      .map(gorece);
    expect(geciren).toEqual(['src/services/mikroEvrak.ts']);
  });

  it('serviste uç TEK yerde (ham gönderim); doğrudan gönderim süzgeçten SONRA oraya iner', () => {
    const kod = kodSatirlari(SERVIS).map(s => s.kod).join('\n');
    const adet = (parca: string) => kod.split(parca).length - 1;
    expect(adet(`'${UC}'`)).toBe(1);
    const bas = kod.indexOf('export async function pushMikroEvrak(');
    expect(bas).toBeGreaterThan(-1);
    const govde = kod.slice(bas, kod.indexOf('\nexport ', bas + 1));
    const suzgec = govde.indexOf('if (!evrakKapisindanGecer(useAppStore.getState().userRole, method)) {');
    expect(suzgec).toBeGreaterThan(-1);
    expect(govde.split('rawMikroPush(').length - 1).toBe(1);
    expect(govde.indexOf('rawMikroPush(')).toBeGreaterThan(suzgec);
    expect(govde.indexOf('enqueueSyncJob(')).toBeGreaterThan(suzgec);
    // Serviste rol adı YAZILMAZ (yorumlar hariç): koşul ortak tablodan.
    expect(APP_ROLES.filter(r => new RegExp(`['"\`]${r}['"\`]`).test(kod))).toEqual([]);
  });

  it('`pushMikroEvrak` çağıranları bulundu (düğme + dekont penceresi + üç sessiz çağıran) — süzgeç ölü koda yazılmadı', () => {
    const cagiran = kaynakDosyalari(SRC_KOK)
      .filter(yol => yol !== SERVIS && oku(yol).includes('pushMikroEvrak('))
      .filter(yol => kodSatirlari(yol).some(s => s.kod.includes('pushMikroEvrak(')))
      .map(gorece);
    // Yeni çağıran eklenebilir (süzgeç onu da kapsar); bu beşi ise süzgecin var olma nedenidir.
    expect(cagiran).toEqual(expect.arrayContaining([
      'src/components/DekontModal.tsx', 'src/components/MikroPushButton.tsx', 'src/components/MobileWMSModule.tsx',
      'src/pages/CRMPage.tsx', 'src/pages/IKPage.tsx',
    ]));
  });
});
