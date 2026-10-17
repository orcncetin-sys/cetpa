/**
 * mikroRetry.test.ts — yeniden deneme kuyruğu × `evrak/kaydet` rol kapısı (2026-10-10; K10 ile YENİDEN yazıldı 2026-10-11).
 *
 * İLK TURUN YANLIŞI (K10-6): bu dosya «işi kuyruğa KOYAN değil, o an uygulaması AÇIK olan yetkili kullanıcının tarayıcısı
 * sahiplenir ve KENDİ kimliğiyle gönderir» davranışını DOĞRU diye kilitliyordu. Açık tam oydu: kuyruğa yazabilen her iç rol
 * işini yetkili role çalıştırtabiliyordu. Kural artık: iş SAHİBİNİNDİR (şartname § 10.3, H9) — testler gevşetilmedi, yeni
 * kurala göre yeniden yazıldı: «başka oturum alır ve gönderir» iddiaları «başka oturum ALMAZ; sahibi yetkili rolle
 * gönderir»e döndü; «rol verilmezse süzgeç yok» vakası kalktı, yerine «kimliği / rolü bilinmeyen oturum hiçbir işi almaz».
 *
 * Değişmeyen iki arıza sınıfı (ilk tur) hâlâ burada sınanır:
 *   1) sahibinin oturumu 403 alırsa (2FA süresi doldu, rol istemcide bayat) deneme hakkı YANMAZ — iş bırakılır (`IsiBirak`);
 *   2) tur tavanı (20 iş) süzgeçten SONRA uygulanır — gönderilemeyen 20 iş pencereyi doldurup oturumu aç bırakmaz.
 * Sahiplik vakaları (başkasının işi, damgasız eski iş, kimlik çakışması, geçiş artıkları, Yönetici çıkışı): mikroRetry.sahip.test.
 *
 * GERÇEK `/api/db` ZİNCİRİ NEDEN YOK (K10-5): rotalar `server.ts`'te `startServer` kapanışının içinde — içe aktarılamaz.
 * Sahte sunucu (`kuyruk.testDuzenegi`) kararları rotaların çağırdığı AYNI saf işlevlerle verir (lib/tenantErisim + rbac):
 * sahibi damgalar, başkasının işine yazımı reddeder, listeyi role göre süzer. Rota ↔ işlev bağı kaynak çitinde
 * (server/satirSuzgeci.degismez.test). Canlıda iki gerçek hesapla elle doğrulama yayın sonrası adımıdır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sunucu } from './kuyruk.testDuzenegi';
import type { AppRole } from '../lib/rbac';
import { UserRole } from '../types';

const h = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../firebase', async () => (await import('./kuyruk.testDuzenegi')).firebaseSahtesi);
vi.mock('../lib/dbClient', async () => (await import('./kuyruk.testDuzenegi')).dbClientSahtesi);
vi.mock('./authFetch', () => ({ authFetch: (...a: unknown[]) => h.authFetch(...a) }));

import { processMikroRetries, pushMikroEvrak } from './mikroEvrak';
import { enqueueSyncJob } from './syncRetryService';
import { useAppStore } from '../store/appStore';

const yanit = (kod: number, govde: unknown) => ({ status: kod, ok: kod >= 200 && kod < 300, json: async () => govde });
const TAMAM = yanit(200, { success: true, error: null, data: null });
/** `kim` oturumu (rolüyle) işi kuyruğa koyar; sunucu sahibi damgalar. Dönen: BELGE kimliği (`<taban>_<kim>`). */
const isEkle = async (kim: string, rol: AppRole, taban: string, method: string, type: 'mikro' | 'luca' = 'mikro'): Promise<string> => {
  sunucu.oturumAc(kim, rol);
  await enqueueSyncJob({ id: taban, type, payload: { method, payload: { a: 1 }, meta: { entityId: taban } }, maxAttempts: 5 });
  return `${taban}_${kim}`;
};
/** `kim` oturumu açıkken yürütücü bir tur koşar (istemcinin beyanı = sunucunun gördüğü kimlik). */
const kos = async (kim: string | null, rol: AppRole | null): Promise<void> => {
  sunucu.oturumAc(kim, rol);
  await processMikroRetries({ uid: kim, rol });
};
const is = (id: string) => sunucu.depo.get(id) as { status: string; attempts: number; nextRetryAt: number; lastError?: string; sahipUid?: string };
const T0 = new Date('2026-10-10T09:00:00Z').getTime();

beforeEach(() => {
  sunucu.sifirla();
  h.authFetch.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => { vi.useRealTimers(); useAppStore.setState(useAppStore.getInitialState(), true); });

describe('403 = oturumun yetkisi o an yetmedi → iş BIRAKILIR, deneme hakkı yanmaz', () => {
  it('rol kapısı 403 döndü: durum queued, attempts AYNI, 90 sn sonra yeniden uygun; lastError yazılmaz; sahip değişmez', async () => {
    const id = await isEkle('muhasebe', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    h.authFetch.mockResolvedValue(yanit(403, { error: 'Bu veri için yetkiniz yok.' }));
    await kos('muhasebe', 'Accounting');
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    expect(is(id)).toMatchObject({ status: 'queued', attempts: 0, nextRetryAt: T0 + 90_000, sahipUid: 'muhasebe' });
    expect(is(id).lastError).toBeUndefined();
  });

  it('sahibinin oturumu ON kez 403 alsa da iş ölmez (eskiden 5. denemede dead); bırakılan işi BAŞKA oturum almaz; aynı sahip düzelince gönderir', async () => {
    const id = await isEkle('muhasebe', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    h.authFetch.mockResolvedValue(yanit(403, { error: 'Bu veri için yetkiniz yok.' }));
    for (let tur = 1; tur <= 10; tur++) {
      await kos('muhasebe', 'Accounting');
      expect(is(id)).toMatchObject({ status: 'queued', attempts: 0 });
      vi.setSystemTime(T0 + tur * 90_000);
    }
    expect(h.authFetch).toHaveBeenCalledTimes(10);
    // Yetkili BAŞKA oturumlar (aynı rolde başka kullanıcı; Müdür; Yönetici) bırakılan işi ALMAZ — eskiden «yetkili oturum alır» idi.
    h.authFetch.mockResolvedValue(TAMAM);
    await kos('muhasebe-2', 'Accounting');
    await kos('mudur', 'Manager');
    await kos('yonetici', 'Admin');
    expect(h.authFetch).toHaveBeenCalledTimes(10);
    expect(is(id)).toMatchObject({ status: 'queued', attempts: 0 });
    // Aynı sahip (2FA yeniden doğrulandı) gönderir.
    await kos('muhasebe', 'Accounting');
    expect(h.authFetch).toHaveBeenCalledTimes(11);
    expect(is(id)).toMatchObject({ status: 'success', attempts: 0, sahipUid: 'muhasebe' });
  });

  it('MFA 403\'ü de (mfaRequired) deneme saymaz', async () => {
    const id = await isEkle('satis', 'Sales', 'ziyaret-1', 'ZiyaretKaydetV2');
    h.authFetch.mockResolvedValue(yanit(403, { error: 'MFA doğrulaması gerekli.', mfaRequired: true }));
    await kos('satis', 'Sales');
    expect(is(id)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('GERÇEK hata (Mikro reddi, 200 + success:false) eskisi gibi deneme YAKAR ve tavanda dead olur', async () => {
    const id = await isEkle('satis', 'Sales', 'teklif-1', 'VerilenTeklifKaydetV2');
    h.authFetch.mockResolvedValue(yanit(200, { success: false, error: 'Cari bulunamadı' }));
    await kos('satis', 'Sales');
    expect(is(id)).toMatchObject({ status: 'queued', attempts: 1, lastError: 'Cari bulunamadı' });
    for (let n = 2; n <= 5; n++) {
      vi.setSystemTime(is(id).nextRetryAt);
      await kos('satis', 'Sales');
    }
    expect(is(id)).toMatchObject({ status: 'dead', attempts: 5, sahipUid: 'satis' });
  });
});

describe('sahiplenmeden ÖNCE rol süzgeci — sahibi de olsa rolünün gönderemeyeceği iş HİÇ alınmaz', () => {
  it('İK\'nın kuyruğa yazdığı dekont işi: İK oturumu sahiplenmez (rolü kapıdan geçmez), istek atılmaz; Muhasebe ve Yönetici oturumu da ALMAZ', async () => {
    const id = await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    const once = { ...is(id) };
    h.authFetch.mockResolvedValue(TAMAM);
    await kos('ik', 'HR');
    // Eskiden: «Muhasebe oturumu alır ve gönderir» — açığın kendisi (İK işi yazar, Muhasebe'nin kimliğiyle Mikro'ya gider).
    await kos('muhasebe', 'Accounting');
    await kos('yonetici', 'Admin');
    expect(sunucu.kosulluYazma).toEqual([]);
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(is(id)).toEqual(once);
  });

  it('rolü yöntemin kapısından geçen sahip: alır ve KENDİ gövdesiyle gönderir', async () => {
    const id = await isEkle('muhasebe', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    h.authFetch.mockResolvedValue(TAMAM);
    await kos('muhasebe', 'Accounting');
    expect(sunucu.kosulluYazma).toEqual([id]);
    expect(JSON.parse(h.authFetch.mock.calls[0][1].body as string)).toMatchObject({ method: 'DekontKaydetV2', payload: { a: 1 } });
    expect(is(id).status).toBe('success');
  });

  it('süzgeç yöntem başına: aynı sahibin üç işi — İK rolünde yalnız etiket, Satış rolünde ziyaret de, dekont ancak Muhasebe rolünde', async () => {
    const dekont = await isEkle('ortak', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    const ziyaret = await isEkle('ortak', 'Accounting', 'ziyaret-1', 'ZiyaretKaydetV2');
    const etiket = await isEkle('ortak', 'Accounting', 'etiket-1', 'EtiketBasimKaydetV2');
    h.authFetch.mockResolvedValue(TAMAM);
    await kos('ortak', 'HR');                                    // rolü İK'ya çevrilmiş sahip
    expect(sunucu.kosulluYazma).toEqual([etiket]);
    await kos('ortak', 'Sales');
    expect([...sunucu.kosulluYazma].sort()).toEqual([etiket, ziyaret].sort());
    expect(is(dekont)).toMatchObject({ status: 'queued', attempts: 0 });   // K3-a: Satış dekont gönderemez
    await kos('ortak', 'Accounting');
    expect([...sunucu.kosulluYazma].sort()).toEqual([dekont, etiket, ziyaret].sort());
  });

  it('kimliği / rolü bilinmeyen ve dış rollü oturum hiçbir işi almaz — sunucuya SORGU da atmaz (eskiden rolsüz çağrı süzgeçsizdi)', async () => {
    await isEkle('ortak', 'Accounting', 'etiket-1', 'EtiketBasimKaydetV2');
    await isEkle('ortak', 'Accounting', 'luca-1', 'DekontKaydetV2', 'luca');
    h.authFetch.mockResolvedValue(TAMAM);
    sunucu.istekler.length = 0;
    await kos('ortak', null);
    await kos('ortak', 'B2B');
    await kos('ortak', 'Dealer');
    await kos(null, 'Admin');
    expect(sunucu.istekler).toEqual([]);
    expect(sunucu.kosulluYazma).toEqual([]);
    expect(h.authFetch).not.toHaveBeenCalled();
  });

  it('Mikro dışı iş yöntem kapısına takılmaz ama SAHİPLİĞE takılır: sahibi alır, başkası (Yönetici dâhil) almaz', async () => {
    const luca = await isEkle('ik', 'HR', 'luca-1', 'DekontKaydetV2', 'luca');
    await kos('yonetici', 'Admin');
    await kos('muhasebe', 'Accounting');
    expect(sunucu.kosulluYazma).toEqual([]);
    await kos('ik', 'HR');
    expect(sunucu.kosulluYazma).toEqual([luca]);
    expect(h.authFetch).not.toHaveBeenCalled();   // bu işleyici yalnız Mikro işini gönderir
  });
});

// 2026-10-10 inceleme bulgusu: süzgeç sorgudaki `limit(20)`'den SONRA koşuyordu — bu oturumun gönderemeyeceği 20 iş
// pencereyi doldurunca oturum kendi işine hiç ulaşamıyordu (dokunulmayan satırın sırası sabit, pencere hiç kaymaz).
describe('süzgeç × 20\'lik tur tavanı — tavan süzgeçten SONRA uygulanır', () => {
  it('A — öndeki 20 iş bu role kapalı (dekont), 21. iş açık (etiket): Lojistik oturumu 21. işe ulaşır ve gönderir; dekontlar dokunulmadan kalır', async () => {
    const dekontlar: string[] = [];
    for (let i = 1; i <= 20; i++) dekontlar.push(await isEkle('lojistik', 'Logistics', `dekont-${i}`, 'DekontKaydetV2'));
    const etiket = await isEkle('lojistik', 'Logistics', 'etiket-1', 'EtiketBasimKaydetV2');
    h.authFetch.mockResolvedValue(TAMAM);
    await kos('lojistik', 'Logistics');
    expect(sunucu.kosulluYazma).toEqual([etiket]);
    expect(is(etiket).status).toBe('success');
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    for (const id of dekontlar) expect(is(id), id).toMatchObject({ status: 'queued', attempts: 0, nextRetryAt: T0 });
  });

  it('B — tur tavanı KORUNUR: gönderilebilir 25 işten ilk turda tam 20 sahiplenilir, kalan 5 ikinci turda', async () => {
    for (let i = 1; i <= 25; i++) await isEkle('lojistik', 'Logistics', `etiket-${i}`, 'EtiketBasimKaydetV2');
    h.authFetch.mockResolvedValue(TAMAM);
    await kos('lojistik', 'Logistics');
    expect(sunucu.kosulluYazma).toHaveLength(20);
    await kos('lojistik', 'Logistics');
    expect(sunucu.kosulluYazma).toHaveLength(25);
    expect(new Set(sunucu.kosulluYazma).size, 'aynı iş iki kez sahiplenilmez').toBe(25);
  });
});

describe('pushMikroEvrak — 403 düğmede metniyle görünür, yanıt biçimi başka durumda DEĞİŞMEZ', () => {
  beforeEach(() => { sunucu.oturumAc('satis', 'Sales'); useAppStore.setState({ userRole: UserRole.Sales }); });

  it('403: sunucu metni + yetkiYok işareti (kuyruğa GİRMEZ — mantıksal ret)', async () => {
    h.authFetch.mockResolvedValue(yanit(403, { error: 'Bu işlem için personel yetkisi gerekir.' }));
    expect(await pushMikroEvrak('VerilenTeklifKaydetV2', { a: 1 })).toEqual({ error: 'Bu işlem için personel yetkisi gerekir.', yetkiYok: true });
    expect(sunucu.depo.size).toBe(0);
  });

  it('200 ve 400: gövde olduğu gibi (yetkiYok anahtarı eklenmez)', async () => {
    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: { no: 7 } }));
    expect(await pushMikroEvrak('ZiyaretKaydetV2', {})).toEqual({ success: true, error: null, data: { no: 7 } });
    h.authFetch.mockResolvedValue(yanit(400, { success: false, error: 'payload zorunlu.' }));
    expect(await pushMikroEvrak('ZiyaretKaydetV2', {})).toEqual({ success: false, error: 'payload zorunlu.' });
    expect(sunucu.depo.size).toBe(0);
  });
});
