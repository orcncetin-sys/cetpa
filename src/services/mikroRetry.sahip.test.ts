/**
 * mikroRetry.sahip.test.ts — K10: yeniden deneme kuyruğunda iş SAHİBİNİNDİR (yürütücü + kuyruğa yazma + Yönetici çıkışı).
 * Şartname § 10.3 + § 10.4 H9; kapı bulguları K10-1 … K10-11.
 *
 * AÇIK: kuyruğa yazabilen her iç rol `{ type: 'mikro', payload: { method: 'DekontKaydetV2', … } }` yazıp işi yetkili bir rolün
 * açık oturumuna çalıştırtabiliyordu (yürütücü işi KENDİ kimliğiyle gönderir). Yöntem başına rol kapıları kuyruktan aşılıyordu.
 *
 * GERÇEK `/api/db` ZİNCİRİ NEDEN YOK (K10-5): rotalar `server.ts`'te `startServer` kapanışının içinde (`const docsDb = pgPool`),
 * içe aktarılamaz ve ham SQL koşar. Test planı üç katmandır:
 *   • SAF KURAL — sunucu: lib/tenantErisim.sahip.test (+ gerçek motorda SQL: tenantErisim.sahip.motor.test);
 *                 yürütücü: lib/kuyrukSahipligi.test;
 *   • KAYNAK ÇİTİ — rota satırları o saf işlevleri çağırıyor mu: server/satirSuzgeci.degismez.test; istemci bağlantıları: bu
 *                   dosyanın son bloğu;
 *   • YÜRÜTÜCÜ BİRİM TESTİ — bu dosya. Sahte sunucu (`kuyruk.testDuzenegi`) kararları rotaların çağırdığı AYNI saf işlevlerle
 *     verir: sahibi damgalar (istemci değeri ezilir), başkasının işine yazımı reddeder, listeyi role göre süzer.
 * Canlıda iki gerçek hesapla elle doğrulama yayın sonrası adımıdır.
 *
 * `suzgecsizListe`: sunucunun liste süzgeci düşmüş gibi davranır (en kötü durum). Yönetici oturumu zaten bütün kuyruğu görür;
 * bu anahtar aynı sınavı Yönetici DIŞINDAKİ rollere uygular — istemci süzgeci tek başına da tutmalı (iki katman).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { sunucu, dbClientSahtesi } from './kuyruk.testDuzenegi';
import type { AppRole } from '../lib/rbac';
import { UserRole } from '../types';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari } from '../test/kaynakTarama';

const h = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../firebase', async () => (await import('./kuyruk.testDuzenegi')).firebaseSahtesi);
vi.mock('../lib/dbClient', async () => (await import('./kuyruk.testDuzenegi')).dbClientSahtesi);
vi.mock('./authFetch', () => ({ authFetch: (...a: unknown[]) => h.authFetch(...a) }));

import { processMikroRetries, pushMikroEvrak } from './mikroEvrak';
import { enqueueSyncJob, getSyncQueueStats, takilanIsleriKapat, clearDeadJobs, KAPATILAN_IS_HATASI, OLU_IS_SAKLAMA_MS } from './syncRetryService';
import { useAppStore } from '../store/appStore';

const yanit = (kod: number, govde: unknown) => ({ status: kod, ok: kod >= 200 && kod < 300, json: async () => govde });
const TAMAM = yanit(200, { success: true, error: null, data: null });
const SAAT = 60 * 60 * 1000;
const T0 = new Date('2026-10-11T09:00:00Z').getTime();

/** `kim` oturumu (rolüyle) işi kuyruğa koyar; sunucu sahibi damgalar. Dönen: BELGE kimliği (`<taban>_<kim>`). */
const isEkle = async (kim: string, rol: AppRole, taban: string, method: string): Promise<string> => {
  sunucu.oturumAc(kim, rol);
  await enqueueSyncJob({ id: taban, type: 'mikro', payload: { method, payload: { kim }, meta: { entityId: taban } }, maxAttempts: 5 });
  return `${taban}_${kim}`;
};
/** K10 ÖNCESİNDEN kalan iş: doğrudan depoya (sahip damgası yok; kimlik soneksiz). */
const eskiIs = (id: string, method: string, ek: Record<string, unknown> = {}) =>
  sunucu.depo.set(id, { id, type: 'mikro', payload: { method, payload: { eski: true } }, status: 'queued', attempts: 0, maxAttempts: 5, nextRetryAt: 0, createdAt: T0, updatedAt: T0, companyId: 'A', ...ek });
const kos = async (kim: string | null, rol: AppRole | null): Promise<void> => {
  sunucu.oturumAc(kim, rol);
  await processMikroRetries({ uid: kim, rol });
};
const is = (id: string) => sunucu.depo.get(id) as { status: string; attempts: number; sahipUid?: string; lastError?: string; payload: { payload: Record<string, unknown> } };
const gonderilenGovdeler = () => h.authFetch.mock.calls.map(c => JSON.parse(c[1].body as string) as { method: string; payload: Record<string, unknown> });
/** Sunucuya ULAŞAN sahiplenme / kapatma denemeleri (reddedilenler dâhil). Boşsa iş İSTEMCİ süzgecinde durmuştur — sunucu reddine kalmamıştır. */
const kosulluYazmaIstekleri = () => sunucu.istekler.filter(i => i.startsWith('CAS '));

beforeEach(() => {
  sunucu.sifirla();
  h.authFetch.mockReset();
  h.authFetch.mockResolvedValue(TAMAM);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); useAppStore.setState(useAppStore.getInitialState(), true); });

describe('AÇIK KAPANDI — başkasının kuyruğa koyduğu iş bu oturumda ÇALIŞMAZ', () => {
  it('İK\'nın yazdığı dekont işi: Yönetici oturumu (sunucu ona bütün kuyruğu listeler) sahiplenmez; Mikro\'ya istek gitmez', async () => {
    const id = await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    const once = { ...is(id) };
    sunucu.istekler.length = 0;
    await kos('yonetici', 'Admin');
    expect(sunucu.istekler).toEqual(['GET syncJobs']);          // liste okundu, iş GÖRÜLDÜ — yine de dokunulmadı
    expect(sunucu.kosulluYazma).toEqual([]);
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(is(id)).toEqual(once);
  });

  it('Muhasebe oturumu: sunucu başkasının işini listelemez; süzgeç düşse de (en kötü durum) istemci süzgeci tutar', async () => {
    const id = await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    await kos('muhasebe', 'Accounting');
    sunucu.suzgecsizListe = true;
    await kos('muhasebe', 'Accounting');
    await kos('mudur', 'Manager');
    expect(kosulluYazmaIstekleri()).toEqual([]);                // istemci süzgeci tuttu: sunucuya sahiplenme isteği GİTMEDİ
    expect(sunucu.kosulluYazma).toEqual([]);
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(is(id)).toMatchObject({ status: 'queued', attempts: 0, sahipUid: 'ik' });
  });

  it('istemcinin gönderdiği SAHTE sahip işe yaramaz: sunucu damgası oturumun kimliğidir (403 değil — sessizce ezilir)', async () => {
    sunucu.oturumAc('ik', 'HR');
    // Saldırgan servisi atlayıp doğrudan yazar: kurbanın kimlik biçimi + kurbanı sahip gösteren gövde.
    await dbClientSahtesi.setDoc({ ad: 'syncJobs', id: 'mikro_DekontKaydetV2_L1_muhasebe' }, {
      id: 'mikro_DekontKaydetV2_L1_muhasebe', type: 'mikro', payload: { method: 'DekontKaydetV2', payload: { sahte: true } },
      status: 'queued', attempts: 0, maxAttempts: 5, nextRetryAt: 0, createdAt: T0, updatedAt: T0, sahipUid: 'muhasebe',
    });
    expect(is('mikro_DekontKaydetV2_L1_muhasebe').sahipUid).toBe('ik');
    await kos('muhasebe', 'Accounting');
    sunucu.suzgecsizListe = true;
    await kos('muhasebe', 'Accounting');
    await kos('yonetici', 'Admin');
    expect(kosulluYazmaIstekleri()).toEqual([]);
    expect(h.authFetch).not.toHaveBeenCalled();
  });

  it('başkasının işine yazılamaz: gövdesi değiştirilemez (403), sahiplenilemez (404 — varlığı da sızmaz), silinemez (403)', async () => {
    const id = await isEkle('muhasebe', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    const once = { ...is(id) };
    const ref = { ad: 'syncJobs', id };
    sunucu.oturumAc('ik', 'HR');
    await expect(dbClientSahtesi.updateDoc(ref, { payload: { method: 'DekontKaydetV2', payload: { sahte: true } } })).rejects.toThrow('→ 403');
    await expect(dbClientSahtesi.setDoc(ref, { ...once, payload: { sahte: true } })).rejects.toThrow('→ 403');
    await expect(dbClientSahtesi.compareAndSet('syncJobs', id, 'status', 'queued', { status: 'in-progress' })).rejects.toThrow('→ 404');
    await expect(dbClientSahtesi.deleteDoc(ref)).rejects.toThrow('→ 403');                // rol silemez
    sunucu.oturumAc('mudur', 'Manager');
    await expect(dbClientSahtesi.deleteDoc(ref)).rejects.toThrow('başka bir firmaya ait');   // rol siler ama iş onun değil
    expect(is(id)).toEqual(once);
  });

  it('kendi işi: sahibi gönderir; rolü düşürülmüş sahip (kapıdan geçemez) almaz', async () => {
    const id = await isEkle('muhasebe', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    await kos('muhasebe', 'HR');
    expect(sunucu.kosulluYazma).toEqual([]);
    await kos('muhasebe', 'Accounting');
    expect(sunucu.kosulluYazma).toEqual([id]);
    expect(is(id)).toMatchObject({ status: 'success', sahipUid: 'muhasebe' });
    expect(gonderilenGovdeler()).toEqual([expect.objectContaining({ method: 'DekontKaydetV2', payload: { kim: 'muhasebe' } })]);
  });
});

describe('damgasız ESKİ iş — yalnız Yönetici oturumu çalıştırır', () => {
  it('Müdür / Muhasebe almaz (sunucu listelemez; süzgeç düşse de almaz); Yönetici alır, gönderir ve sunucu onu sahibi yapar', async () => {
    eskiIs('eski-1', 'DekontKaydetV2');
    await kos('mudur', 'Manager');
    await kos('muhasebe', 'Accounting');
    sunucu.suzgecsizListe = true;
    await kos('mudur', 'Manager');
    await kos('muhasebe', 'Accounting');
    expect(kosulluYazmaIstekleri()).toEqual([]);                // sunucu reddine kalmadı: istemci süzgeci tek başına tuttu
    expect(sunucu.kosulluYazma).toEqual([]);
    sunucu.suzgecsizListe = false;
    await kos('yonetici', 'Admin');
    expect(sunucu.kosulluYazma).toEqual(['eski-1']);
    expect(is('eski-1')).toMatchObject({ status: 'success', sahipUid: 'yonetici' });
  });

  it('Yönetici\'nin dokunduğu eski iş Mikro reddiyle kuyruğa dönerse sonraki turda YİNE onundur (soneksiz kimlik Yönetici\'de engel değil)', async () => {
    eskiIs('eski-1', 'DekontKaydetV2');
    h.authFetch.mockResolvedValue(yanit(200, { success: false, error: 'Cari bulunamadı' }));
    await kos('yonetici', 'Admin');
    expect(is('eski-1')).toMatchObject({ status: 'queued', attempts: 1, sahipUid: 'yonetici' });
    vi.setSystemTime(T0 + 2 * SAAT);
    h.authFetch.mockResolvedValue(TAMAM);
    await kos('yonetici-2', 'Admin');                // başka Yönetici almaz: iş artık damgalı
    expect(is('eski-1').status).toBe('queued');
    await kos('yonetici', 'Admin');
    expect(is('eski-1').status).toBe('success');
  });
});

describe('20\'lik tur tavanı sahiplik süzgecinden SONRA — başkasının işleri pencereyi doldurmaz (açlık yok)', () => {
  it('öndeki 25 iş başkasının, 26. iş kendi: Yönetici oturumu kendi işine ulaşır', async () => {
    for (let i = 1; i <= 25; i++) await isEkle('ik', 'HR', `etiket-${i}`, 'EtiketBasimKaydetV2');
    const kendi = await isEkle('yonetici', 'Admin', 'etiket-x', 'EtiketBasimKaydetV2');
    await kos('yonetici', 'Admin');
    expect(sunucu.kosulluYazma).toEqual([kendi]);
    expect(h.authFetch).toHaveBeenCalledTimes(1);
  });
});

describe('iş kimliği kullanıcıya özgü (K10-1) — iki kullanıcının aynı varlık için işi ÇAKIŞMAZ', () => {
  it('ağ hatası: iki kullanıcı aynı varlığı gönderirken düşer → İKİ ayrı iş, her biri sahibinin ve kendi gövdesiyle', async () => {
    h.authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    useAppStore.setState({ userRole: UserRole.Sales });
    sunucu.oturumAc('satis1', 'Sales');
    await pushMikroEvrak('ZiyaretKaydetV2', { n: 1 }, { entityType: 'leadVisit', entityId: 'L1' });
    await vi.waitFor(() => expect(sunucu.depo.size).toBe(1));
    sunucu.oturumAc('satis2', 'Sales');
    await pushMikroEvrak('ZiyaretKaydetV2', { n: 2 }, { entityType: 'leadVisit', entityId: 'L1' });
    await vi.waitFor(() => expect(sunucu.depo.size).toBe(2));
    expect(is('mikro_ZiyaretKaydetV2_L1_satis1')).toMatchObject({ sahipUid: 'satis1', status: 'queued', payload: { payload: { n: 1 } } });
    expect(is('mikro_ZiyaretKaydetV2_L1_satis2')).toMatchObject({ sahipUid: 'satis2', status: 'queued', payload: { payload: { n: 2 } } });
    // Ağ dönünce her iş KENDİ sahibinin oturumunda, kendi gövdesiyle gider.
    h.authFetch.mockReset(); h.authFetch.mockResolvedValue(TAMAM);
    await kos('satis2', 'Sales');
    expect(gonderilenGovdeler()).toEqual([expect.objectContaining({ payload: { n: 2 } })]);
    await kos('satis1', 'Sales');
    expect(gonderilenGovdeler().map(g => g.payload)).toEqual([{ n: 2 }, { n: 1 }]);
  });

  it('eskiden: aynı kimlik — ikinci kullanıcının yazımı reddedilir ve yeniden deneme sessizce kaybolurdu (çakışmanın kendisi)', async () => {
    const ilk = await isEkle('satis1', 'Sales', 'mikro_ZiyaretKaydetV2_L1', 'ZiyaretKaydetV2');
    sunucu.oturumAc('satis2', 'Sales');
    // Kimlik kullanıcıyı içermeseydi ikinci kullanıcı TAM bu belgeye yazardı:
    await expect(dbClientSahtesi.setDoc({ ad: 'syncJobs', id: ilk }, { status: 'queued' })).rejects.toThrow('→ 403');
  });

  it('aynı kullanıcı aynı varlığı yeniden kuyruğa koyarsa belge YENİLENİR (tek iş — aynı evrak iki kez gitmez); sahip aynı kalır', async () => {
    const id = await isEkle('satis1', 'Sales', 'ziyaret-L1', 'ZiyaretKaydetV2');
    await kos('satis1', 'Sales');
    expect(is(id).status).toBe('success');
    expect(await isEkle('satis1', 'Sales', 'ziyaret-L1', 'ZiyaretKaydetV2')).toBe(id);
    expect(sunucu.depo.size).toBe(1);
    expect(is(id)).toMatchObject({ status: 'queued', attempts: 0, sahipUid: 'satis1' });
  });

  it('oturum yoksa kuyruğa yazılmaz — istek de atılmaz', async () => {
    sunucu.oturumAc(null, null);
    await enqueueSyncJob({ id: 'x', type: 'mikro', payload: {}, maxAttempts: 5 });
    expect(sunucu.depo.size).toBe(0);
    expect(sunucu.istekler).toEqual([]);
  });
});

describe('sahiplenme yarışı — aynı kullanıcının iki sekmesi', () => {
  it('iki sekme aynı anda koşar: iş BİR kez sahiplenilir, Mikro\'ya BİR istek gider', async () => {
    const id = await isEkle('muhasebe', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    const k = { uid: 'muhasebe', rol: 'Accounting' as const };
    await Promise.all([processMikroRetries(k), processMikroRetries(k)]);
    expect(sunucu.kosulluYazma).toEqual([id]);
    expect(h.authFetch).toHaveBeenCalledTimes(1);
  });
});

describe('iş kimliği BELGEDEN okunur (K10-7) — gövdedeki `id` başka işi gösteremez', () => {
  it('damgasız tuzak iş gövdesinde KURBANIN iş kimliğini taşır: Yönetici yürütücüsü tuzak BELGEYİ sahiplenir, kurbanın işine dokunmaz', async () => {
    const kurban = await isEkle('muhasebe', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    eskiIs('tuzak', 'EtiketBasimKaydetV2', { id: kurban });
    await kos('yonetici', 'Admin');
    expect(sunucu.kosulluYazma).toEqual(['tuzak']);
    expect(is('tuzak').status).toBe('success');
    expect(is(kurban)).toMatchObject({ status: 'queued', attempts: 0, sahipUid: 'muhasebe' });
  });

  it('Yönetici çıkışı da belge kimliğiyle yazar: gövdesinde kurbanın kimliğini taşıyan takılı iş kapatılır, KURBANIN işi kapanmaz', async () => {
    const kurban = await isEkle('muhasebe', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    sunucu.depo.set('tuzak_ik', { ...sunucu.depo.get(kurban), id: kurban, sahipUid: 'ik', createdAt: 0 });
    sunucu.oturumAc('yonetici', 'Admin');
    expect(await takilanIsleriKapat({ uid: 'yonetici', rol: 'Admin' })).toBe(1);
    expect(is('tuzak_ik').status).toBe('dead');
    expect(is(kurban).status).toBe('queued');
  });
});

// K10-11 — geçiş artıkları. Kural: lib/kuyrukSahipligi (G1 / G2).
describe('geçiş artıkları (K10-11)', () => {
  it('G1 — yayından ÖNCE ekilmiş sahip alanı: sunucu işi o kullanıcıya listeler ama oturumu ÇALIŞTIRMAZ (kimlik onun sonekini taşımıyor)', async () => {
    // Eski sunucu istemcinin gönderdiği `sahipUid` değerini olduğu gibi bırakıyordu: K10 öncesi kimlik + ekilmiş sahip.
    eskiIs('mikro_DekontKaydetV2_L9', 'DekontKaydetV2', { sahipUid: 'muhasebe' });
    sunucu.istekler.length = 0;
    await kos('muhasebe', 'Accounting');
    expect(sunucu.istekler).toEqual(['GET syncJobs']);        // iş listelendi (alan onu gösteriyor) — sahiplenilmedi
    await kos('yonetici', 'Admin');                             // Yönetici de çalıştırmaz: damgalı, başkasının
    expect(kosulluYazmaIstekleri()).toEqual([]);
    expect(sunucu.kosulluYazma).toEqual([]);
    expect(h.authFetch).not.toHaveBeenCalled();
    // Çıkış: takılınca Yönetici kapatır.
    vi.setSystemTime(T0 + 25 * SAAT);
    sunucu.oturumAc('yonetici', 'Admin');
    expect(await takilanIsleriKapat({ uid: 'yonetici', rol: 'Admin' })).toBe(1);
    expect(is('mikro_DekontKaydetV2_L9')).toMatchObject({ status: 'dead', sahipUid: 'muhasebe' });
    expect(h.authFetch).not.toHaveBeenCalled();
  });

  it('G2 — kimlik kapma: saldırgan kurbanın kimliğini önceden açar → belge saldırganın; kimsenin oturumunda çalışmaz; kurbanın kaybı o TEK iştir', async () => {
    // İK, Satış'ın `L1` ziyareti için kullanacağı kimliği önceden açar (kendi gövdesiyle).
    sunucu.oturumAc('ik', 'HR');
    await dbClientSahtesi.setDoc({ ad: 'syncJobs', id: 'mikro_ZiyaretKaydetV2_L1_satis' }, {
      id: 'mikro_ZiyaretKaydetV2_L1_satis', type: 'mikro', payload: { method: 'ZiyaretKaydetV2', payload: { saldirgan: true } },
      status: 'queued', attempts: 0, maxAttempts: 5, nextRetryAt: 0, createdAt: T0, updatedAt: T0,
    });
    expect(is('mikro_ZiyaretKaydetV2_L1_satis').sahipUid).toBe('ik');
    // Kurban aynı varlığı gönderirken ağ düşer: kuyruğa yazımı reddedilir (sunucu 403, çağıran yutar) — saldırganın belgesi DEĞİŞMEZ.
    h.authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    useAppStore.setState({ userRole: UserRole.Sales });
    sunucu.oturumAc('satis', 'Sales');
    await pushMikroEvrak('ZiyaretKaydetV2', { n: 1 }, { entityType: 'leadVisit', entityId: 'L1' });
    await pushMikroEvrak('ZiyaretKaydetV2', { n: 2 }, { entityType: 'leadVisit', entityId: 'L2' });
    await vi.waitFor(() => expect(sunucu.depo.size).toBe(2));
    expect(is('mikro_ZiyaretKaydetV2_L1_satis')).toMatchObject({ sahipUid: 'ik', payload: { payload: { saldirgan: true } } });
    // Ağ döner: saldırganın gövdesi kurbanın oturumunda da, saldırganın kendi oturumunda da (kimlik onun sonekini taşımıyor),
    // Yönetici oturumunda da GİTMEZ. Kurbanın BAŞKA varlık için işi etkilenmez.
    h.authFetch.mockReset(); h.authFetch.mockResolvedValue(TAMAM);
    await kos('satis', 'Sales');
    await kos('ik', 'HR');
    await kos('ik', 'Sales');                                   // saldırganın rolü kapıdan geçse de
    await kos('yonetici', 'Admin');
    expect(gonderilenGovdeler().map(g => g.payload)).toEqual([{ n: 2 }]);
    expect(is('mikro_ZiyaretKaydetV2_L1_satis')).toMatchObject({ status: 'queued', attempts: 0 });
  });
});

describe('Yönetici çıkışı (K10-8) — sahibi gönder(e)meyen takılı iş ÇALIŞTIRILMADAN kapatılır; devralma yok', () => {
  it('başkasının 25 saatlik işi: ölü + açıklama, sahip AYNI, Mikro\'ya istek YOK; taze iş, Yönetici\'nin kendi eski işi ve damgasız eski iş kalır', async () => {
    const takili = await isEkle('ik', 'HR', 'dekont-eski', 'DekontKaydetV2');
    const kendi = await isEkle('yonetici', 'Admin', 'etiket-eski', 'EtiketBasimKaydetV2');
    eskiIs('eski-1', 'DekontKaydetV2');
    vi.setSystemTime(T0 + 25 * SAAT);
    const taze = await isEkle('ik', 'HR', 'dekont-yeni', 'DekontKaydetV2');
    sunucu.oturumAc('yonetici', 'Admin');
    expect(await takilanIsleriKapat({ uid: 'yonetici', rol: 'Admin' })).toBe(1);
    expect(is(takili)).toMatchObject({ status: 'dead', sahipUid: 'ik', attempts: 0, lastError: KAPATILAN_IS_HATASI });
    expect(KAPATILAN_IS_HATASI).toContain('GİTMEDİ');
    for (const id of [taze, kendi, 'eski-1']) expect(is(id).status, id).toBe('queued');
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(sunucu.kosulluYazma).toEqual([takili]);
  });

  it('Yönetici dışındaki hiçbir oturum kapatamaz: çağrı sunucuya HİÇ gitmez — Müdür ve diğer iç roller, dış rol, rolsüz, kimliksiz (süzgeç düşse de)', async () => {
    const takili = await isEkle('ik', 'HR', 'dekont-eski', 'DekontKaydetV2');
    vi.setSystemTime(T0 + 25 * SAAT);
    sunucu.suzgecsizListe = true;
    sunucu.istekler.length = 0;
    const KILITLI: Array<{ uid: string | null; rol: AppRole | null }> = [
      { uid: 'mudur', rol: 'Manager' }, { uid: 'muhasebe', rol: 'Accounting' }, { uid: 'ik', rol: 'HR' }, { uid: 'satis', rol: 'Sales' },
      { uid: 'bayi', rol: 'Dealer' }, { uid: 'x', rol: null }, { uid: null, rol: 'Admin' },
    ];
    for (const k of KILITLI) {
      sunucu.oturumAc(k.uid, k.rol);
      expect(await takilanIsleriKapat(k), `${k.uid} / ${k.rol}`).toBe(0);
    }
    expect(sunucu.istekler).toEqual([]);
    expect(is(takili).status).toBe('queued');
  });

  it('yarış: liste ile yazma arasında sahibinin oturumu işi aldıysa (artık `queued` değil) kapatılmaz', async () => {
    const takili = await isEkle('ik', 'Accounting', 'dekont-eski', 'DekontKaydetV2');
    vi.setSystemTime(T0 + 25 * SAAT);
    sunucu.oturumAc('yonetici', 'Admin');
    const asil = dbClientSahtesi.getDocs;
    vi.spyOn(dbClientSahtesi, 'getDocs').mockImplementationOnce(async (hedef) => {
      const sonuc = await asil(hedef);
      sunucu.depo.set(takili, { ...sunucu.depo.get(takili), status: 'in-progress' });   // sahibi tam o anda sahiplendi
      return sonuc;
    });
    expect(await takilanIsleriKapat({ uid: 'yonetici', rol: 'Admin' })).toBe(0);
    expect(is(takili).status).toBe('in-progress');
  });

  it('kapatılan iş kuyruk durumunda «ölü» görünür; 7 gün sonra «Ölüleri Temizle» siler', async () => {
    const takili = await isEkle('ik', 'HR', 'dekont-eski', 'DekontKaydetV2');
    vi.setSystemTime(T0 + 25 * SAAT);
    const yonetici = { uid: 'yonetici', rol: 'Admin' as AppRole };
    sunucu.oturumAc(yonetici.uid, yonetici.rol);
    expect(await getSyncQueueStats(yonetici)).toMatchObject({ gonderilebilir: 0, baskasinin: 1, kapatilabilir: 1, dead: 0, temizlenebilir: 0 });
    await takilanIsleriKapat(yonetici);
    expect(await getSyncQueueStats(yonetici)).toMatchObject({ baskasinin: 0, kapatilabilir: 0, dead: 1, temizlenebilir: 0 });
    await clearDeadJobs();
    expect(sunucu.depo.has(takili)).toBe(true);                 // 7 gün dolmadan silinmez
    vi.setSystemTime(Date.now() + OLU_IS_SAKLAMA_MS + 1);
    expect(await getSyncQueueStats(yonetici)).toMatchObject({ dead: 1, temizlenebilir: 1 });
    await clearDeadJobs();
    expect(sunucu.depo.has(takili)).toBe(false);
  });
});

describe('kuyruk durumu (kart) — sayılar OTURUMA göre', () => {
  it('Yönetici: kendi + damgasız eski = gönderilebilir; başkasınınki ayrı. Müdür / Muhasebe: yalnız kendi işi (sunucu başkasınınkini listelemez)', async () => {
    await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    await isEkle('muhasebe', 'Accounting', 'dekont-2', 'DekontKaydetV2');
    await isEkle('yonetici', 'Admin', 'etiket-1', 'EtiketBasimKaydetV2');
    eskiIs('eski-1', 'EtiketBasimKaydetV2');
    const sor = async (uid: string, rol: AppRole) => { sunucu.oturumAc(uid, rol); return getSyncQueueStats({ uid, rol }); };
    expect(await sor('yonetici', 'Admin')).toEqual({ gonderilebilir: 2, rolYetmiyor: 0, baskasinin: 2, kapatilabilir: 0, dead: 0, temizlenebilir: 0, lastSuccess: null });
    expect(await sor('muhasebe', 'Accounting')).toMatchObject({ gonderilebilir: 1, rolYetmiyor: 0, baskasinin: 0, kapatilabilir: 0 });
    expect(await sor('ik', 'HR')).toMatchObject({ gonderilebilir: 0, rolYetmiyor: 1, baskasinin: 0, kapatilabilir: 0 });   // İK dekontu gönderemez
    expect(await sor('mudur', 'Manager')).toMatchObject({ gonderilebilir: 0, rolYetmiyor: 0, baskasinin: 0, kapatilabilir: 0 });
  });

  it('«gönderilebilir» sayısı = «Şimdi Dene»nin gerçekten sahiplendiği iş sayısı (kart ile yürütücü AYNI kuraldan)', async () => {
    await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    await isEkle('yonetici', 'Admin', 'etiket-1', 'EtiketBasimKaydetV2');
    await isEkle('yonetici', 'Admin', 'dekont-9', 'DekontKaydetV2');
    eskiIs('eski-1', 'EtiketBasimKaydetV2');
    const yonetici = { uid: 'yonetici', rol: 'Admin' as AppRole };
    sunucu.oturumAc(yonetici.uid, yonetici.rol);
    const { gonderilebilir } = await getSyncQueueStats(yonetici);
    await processMikroRetries(yonetici);
    expect(gonderilebilir).toBe(3);
    expect(sunucu.kosulluYazma).toHaveLength(gonderilebilir);
  });

  it('son başarı EN YENİ başarılı işin zamanıdır; kuyruğu yürütemeyen oturumda istek atılmaz, boş durum döner', async () => {
    const a = await isEkle('satis', 'Sales', 'ziyaret-1', 'ZiyaretKaydetV2');
    await kos('satis', 'Sales');
    vi.setSystemTime(T0 + SAAT);
    await isEkle('satis', 'Sales', 'ziyaret-2', 'ZiyaretKaydetV2');
    await kos('satis', 'Sales');
    expect(is(a).status).toBe('success');
    expect((await getSyncQueueStats({ uid: 'satis', rol: 'Sales' })).lastSuccess).toBe(T0 + SAAT);
    sunucu.istekler.length = 0;
    const BOS = { gonderilebilir: 0, rolYetmiyor: 0, baskasinin: 0, kapatilabilir: 0, dead: 0, temizlenebilir: 0, lastSuccess: null };
    for (const k of [{ uid: 'bayi', rol: 'B2B' as AppRole }, { uid: 'x', rol: null }, { uid: null, rol: 'Admin' as AppRole }]) {
      sunucu.oturumAc(k.uid, k.rol);
      expect(await getSyncQueueStats(k)).toEqual(BOS);
    }
    expect(sunucu.istekler).toEqual([]);
  });
});

// «Yazıldı ama bağlanmadı» ve «süzgeçsiz çağrı yeri» çitleri — istemci bağlantıları kaynakta.
describe('kaynak çiti — yürütücü her çağrıda KİMLİKLE koşar; kuyruk tek yerden yazılır', () => {
  const ISTEMCI = kaynakDosyalari(SRC_KOK).filter(y => !gorece(y).startsWith('src/server/'));
  const kod = (ad: string): string[] => kodSatirlari(join(SRC_KOK, '..', ad)).map(s => s.kod);
  const gecen = (desen: RegExp): string[] => ISTEMCI.filter(y => kodSatirlari(y).some(s => desen.test(s.kod))).map(gorece).sort();

  it('`processMikroRetries` çağıranları: zamanlayıcı (App.tsx) ve kuyruk kartı — ikisi de kimlik nesnesiyle; ARGÜMANSIZ çağrı yok', () => {
    expect(gecen(/\bprocessMikroRetries\(/)).toEqual(['src/App.tsx', 'src/components/MikroKuyrukKarti.tsx', 'src/services/mikroEvrak.ts']);
    const cagrilar = ISTEMCI.flatMap(y => kodSatirlari(y).filter(s => /\bprocessMikroRetries\(/.test(s.kod) && !/export async function/.test(s.kod)).map(s => s.kod.trim()));
    expect(cagrilar).toHaveLength(2);
    for (const c of cagrilar) expect(c).toMatch(/processMikroRetries\(kimlik(\(\))?\)/);
    expect(kod('src/services/mikroEvrak.ts').join('\n')).toContain('export async function processMikroRetries(kimlik: YurutucuKimligi): Promise<void> {');
  });

  it('zamanlayıcı (K10-10): kimlik oturumdan kurulur, rolü atanmamış hesapta rol YOK sayılır; kuyruğu yürütemeyen oturumda ve 2FA beklerken kurulmaz', () => {
    const app = kod('src/App.tsx').map(s => s.trim());
    // 2026-10-17 (şartname «kayıt kapanışı ve kuruş» R1′): kimliğin oturumu veri kapısından (`veriOturumu`) gelir — rol çözülmeden
    // kimlik boştur, zamanlayıcı kurulmaz. Bu iki satır bilerek değişti.
    // 2026-10-17 (iç rol şartnamesi § 8, Rol Simülatörü): rol `kuyrukRolu` — simülasyonda oturumun GERÇEK rolü (davranış testi:
    // components/RolSimulatoru.uygulama.test.tsx). Kimlik satırı ve bağımlılık dizisi bilerek değişti.
    const i = app.indexOf('const kimlik = { uid: veriOturumu?.uid, rol: roleMissing ? null : kuyrukRolu };');
    expect(i).toBeGreaterThan(0);
    expect(app.slice(i + 1, i + 7)).toEqual([
      'if (mfaChallenge || !kuyrukYurutebilir(kimlik)) return;',
      'let cancelled = false;',
      'const tick = () => { if (!cancelled && !cikisSuruyorRef.current) void processMikroRetries(kimlik).catch(() => {}); };',
      'tick();',
      'const timer = setInterval(tick, 90_000);',
      'return () => { cancelled = true; clearInterval(timer); };',
    ]);
    expect(app[i + 7]).toBe('}, [veriOturumu, kuyrukRolu, roleMissing, mfaChallenge]);');
    // `kuyrukRolu` yalnız gerçek rol kaydından ya da `userRole`dan türer (başka kaynak yok).
    expect(app).toContain('const kuyrukRolu = gercekRolKaydi ?? userRole;');
    expect(app[i - 1]).toBe('useEffect(() => {');
  });

  it('kart panele BAĞLI: MikroSyncPanel kartı çizer ve kuyruğu kendi başına yürütmez / okumaz', () => {
    const panel = kod('src/components/MikroSyncPanel.tsx').join('\n');
    expect(panel).toContain('<MikroKuyrukKarti currentLanguage={currentLanguage} />');
    expect(panel).toContain("import MikroKuyrukKarti from './MikroKuyrukKarti';");
    for (const ad of ['processMikroRetries', 'getSyncQueueStats', 'clearDeadJobs', 'takilanIsleriKapat']) expect(panel.includes(ad), ad).toBe(false);
    expect(gecen(/\bgetSyncQueueStats\(|\btakilanIsleriKapat\(|\bclearDeadJobs\(/)).toEqual(['src/components/MikroKuyrukKarti.tsx', 'src/services/syncRetryService.ts']);
  });

  it('yürütücü ve durum okuyucu iş kimliğini BELGEDEN alır (K10-7): servisteki her belge → iş dönüşümü `id: d.id` yazar', () => {
    const servis = kod('src/services/syncRetryService.ts');
    const donusumler = servis.filter(s => /d\.data\(\) as SyncJob/.test(s));
    expect(donusumler.length).toBeGreaterThanOrEqual(2);
    for (const s of donusumler) expect(s).toContain('({ ...(d.data() as SyncJob), id: d.id })');
  });

  it('kuyruğa yazan TEK yer `enqueueSyncJob`: kimlik `isKimligi(job.id, uid)`, kullanıcı oturumdan; istemci sahip alanını HİÇBİR yerde yazmaz', () => {
    const servis = kod('src/services/syncRetryService.ts').join('\n');
    expect(servis).toContain('const uid = auth.currentUser?.uid;');
    expect(servis).toContain('const id = isKimligi(job.id, uid);');
    expect(servis).toContain('const ref = jobRef(id);');
    expect(gecen(/\benqueueSyncJob\(/)).toEqual(['src/services/mikroEvrak.ts', 'src/services/syncRetryService.ts']);
    // `sahipUid` istemcide yalnız OKUNUR (tip tanımı + saf kural); nesne alanı olarak YAZAN kod satırı yok
    // (`job.sahipUid : null` üçlü işleci ve tip tanımı `sahipUid?: …` desene girmez).
    const SAHIP_YAZIMI = /(?<![.\w])sahipUid\s*:(?!\s*(?:string|unknown)\b)/;
    expect(SAHIP_YAZIMI.test('const j = { id, sahipUid: uid };')).toBe(true);   // desen gerçek bir yazımı yakalıyor
    expect(gecen(SAHIP_YAZIMI)).toEqual([]);
    // Yürütücünün süzgeci tek işlev: kopya «rol / sahip» koşulu serviste yeniden yazılmadı.
    expect(servis).toContain('.filter((job) => isiGonderebilir(job, kimlik))');
    expect(servis.includes("'Admin'")).toBe(false);
  });
});
