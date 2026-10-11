/**
 * mikroRetry.test.ts — yeniden deneme kuyruğu × `evrak/kaydet` rol kapısı (2026-10-10).
 *
 * Kuyruk (`syncJobs`) kiracı kapsamlıdır: işi kuyruğa KOYAN değil, o an uygulaması AÇIK olan kullanıcının tarayıcısı sahiplenir
 * ve KENDİ kimliğiyle gönderir. `evrak/kaydet` yönteme göre rol kapılı olunca iki arıza doğardı:
 *   1) yetkisiz rolün tarayıcısı işi alır → 403 → deneme hakkı yanar → meşru gönderim beş turda sessizce `dead` olur;
 *   2) yetkisiz tarayıcılar işi her turda alıp bıraktıkça yetkili oturum sıraya giremez.
 * Çözüm iki katman: sahiplenmeden ÖNCE rol süzgeci + yine de gelen 403'te işi BIRAKMA (`IsiBirak`, deneme sayılmaz).
 * Tur tavanı (20 iş) süzgeçten SONRA uygulanır: önce uygulansaydı gönderilemeyen 20 iş pencereyi doldurur, oturum kendi işine ulaşamazdı.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  depo: new Map<string, Record<string, unknown>>(),
  authFetch: vi.fn(),
  sahiplenme: [] as string[],
}));
/** Sahte sorgu kısıtı — gerçek `dbClient` ile AYNI biçim (`where` / `limit` nesneleri). */
type Kisit = { kind: 'where'; field: string; op: string; value: unknown } | { kind: 'limit'; n: number };

vi.mock('../firebase', () => ({ db: {} }));
vi.mock('./authFetch', () => ({ authFetch: (...a: unknown[]) => h.authFetch(...a) }));
vi.mock('../lib/dbClient', () => ({
  collection: (_db: unknown, ad: string) => ({ ad }),
  doc: (c: { ad: string }, id: string) => ({ ad: c.ad, id }),
  query: (_c: unknown, ...k: Kisit[]) => ({ k }),
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  limit: (n: number) => ({ kind: 'limit', n }),
  setDoc: async (ref: { id: string }, veri: Record<string, unknown>) => { h.depo.set(ref.id, { ...veri }); },
  updateDoc: async (ref: { id: string }, yama: Record<string, unknown>) => { h.depo.set(ref.id, { ...h.depo.get(ref.id), ...yama }); },
  deleteDoc: async (ref: { id: string }) => { h.depo.delete(ref.id); },
  // Kısıtlar gerçek istemcideki (`dbClient.applyConstraints`) SIRAYLA uygulanır: önce `where`, sonra `limit` = `slice`.
  // Sahte eskiden kısıtları yok sayıyordu; sorguya konan bir `limit` rol süzgecinden ÖNCE kestiği hâlde testler yeşil kalıyordu.
  getDocs: async (q: { k: Kisit[] }) => {
    let satirlar = [...h.depo.values()];
    for (const c of q.k) {
      if (c.kind !== 'where') continue;
      if (c.op !== '==' && c.op !== '<=') throw new Error(`sahte getDocs: tanınmayan işleç ${c.op}`);
      satirlar = satirlar.filter(j => (c.op === '==' ? j[c.field] === c.value : (j[c.field] as number) <= (c.value as number)));
    }
    for (const c of q.k) if (c.kind === 'limit') satirlar = satirlar.slice(0, c.n);
    const docs = satirlar.map(j => ({ data: () => ({ ...j }) }));
    return { empty: docs.length === 0, docs, size: docs.length };
  },
  compareAndSet: async (_coll: string, id: string, alan: string, beklenen: unknown, yama: Record<string, unknown>) => {
    const j = h.depo.get(id);
    if (!j || j[alan] !== beklenen) return false;
    h.sahiplenme.push(id);
    h.depo.set(id, { ...j, ...yama });
    return true;
  },
}));

import { processMikroRetries, pushMikroEvrak } from './mikroEvrak';
import { enqueueSyncJob } from './syncRetryService';

const yanit = (kod: number, govde: unknown) => ({ status: kod, ok: kod >= 200 && kod < 300, json: async () => govde });
const isEkle = (id: string, method: string, type: 'mikro' | 'luca' = 'mikro') =>
  enqueueSyncJob({ id, type, payload: { method, payload: { a: 1 }, meta: { entityId: id } }, maxAttempts: 5 });
const is = (id: string) => h.depo.get(id) as { status: string; attempts: number; nextRetryAt: number; lastError?: string };
const T0 = new Date('2026-10-10T09:00:00Z').getTime();

beforeEach(() => {
  h.depo.clear();
  h.sahiplenme.length = 0;
  h.authFetch.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => { vi.useRealTimers(); });

describe('403 = oturumun yetkisi yetmedi → iş BIRAKILIR, deneme hakkı yanmaz', () => {
  it('rol kapısı 403 döndü: durum queued, attempts AYNI, 90 sn sonra yeniden uygun; lastError yazılmaz', async () => {
    await isEkle('dekont-1', 'DekontKaydetV2');
    h.authFetch.mockResolvedValue(yanit(403, { error: 'Bu veri için yetkiniz yok.' }));
    await processMikroRetries();
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    expect(is('dekont-1')).toMatchObject({ status: 'queued', attempts: 0, nextRetryAt: T0 + 90_000 });
    expect(is('dekont-1').lastError).toBeUndefined();
  });

  it('yetkisiz oturum ON kez denese de iş ölmez (eskiden 5. denemede dead); yetkili oturum sonunda gönderir', async () => {
    await isEkle('dekont-1', 'DekontKaydetV2');
    h.authFetch.mockResolvedValue(yanit(403, { error: 'Bu veri için yetkiniz yok.' }));
    for (let tur = 1; tur <= 10; tur++) {
      await processMikroRetries();
      expect(is('dekont-1')).toMatchObject({ status: 'queued', attempts: 0 });
      vi.setSystemTime(T0 + tur * 90_000);
    }
    expect(h.authFetch).toHaveBeenCalledTimes(10);
    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: null }));
    await processMikroRetries('Accounting');
    expect(is('dekont-1')).toMatchObject({ status: 'success', attempts: 0 });
  });

  it('MFA 403\'ü de (mfaRequired) deneme saymaz', async () => {
    await isEkle('ziyaret-1', 'ZiyaretKaydetV2');
    h.authFetch.mockResolvedValue(yanit(403, { error: 'MFA doğrulaması gerekli.', mfaRequired: true }));
    await processMikroRetries('Sales');
    expect(is('ziyaret-1')).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('GERÇEK hata (Mikro reddi, 200 + success:false) eskisi gibi deneme YAKAR ve tavanda dead olur', async () => {
    await isEkle('teklif-1', 'VerilenTeklifKaydetV2');
    h.authFetch.mockResolvedValue(yanit(200, { success: false, error: 'Cari bulunamadı' }));
    await processMikroRetries('Sales');
    expect(is('teklif-1')).toMatchObject({ status: 'queued', attempts: 1, lastError: 'Cari bulunamadı' });
    for (let n = 2; n <= 5; n++) {
      vi.setSystemTime(is('teklif-1').nextRetryAt);
      await processMikroRetries('Sales');
    }
    expect(is('teklif-1')).toMatchObject({ status: 'dead', attempts: 5 });
  });
});

describe('sahiplenmeden ÖNCE rol süzgeci — bu oturumun gönderemeyeceği iş HİÇ alınmaz', () => {
  it('İK oturumu dekont işini sahiplenmez: istek atılmaz, iş dokunulmadan kalır; Muhasebe oturumu alır ve gönderir', async () => {
    await isEkle('dekont-1', 'DekontKaydetV2');
    const once = { ...is('dekont-1') };
    await processMikroRetries('HR');
    expect(h.sahiplenme).toEqual([]);
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(is('dekont-1')).toEqual(once);

    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: null }));
    await processMikroRetries('Accounting');
    expect(h.sahiplenme).toEqual(['dekont-1']);
    expect(JSON.parse(h.authFetch.mock.calls[0][1].body as string)).toMatchObject({ method: 'DekontKaydetV2', payload: { a: 1 } });
    expect(is('dekont-1').status).toBe('success');
  });

  it('süzgeç yöntem başına: İK oturumu iç personel kapılı işi alır, dekontu ve ziyareti bırakır; dış rol hiçbirini almaz', async () => {
    await isEkle('dekont-1', 'DekontKaydetV2');
    await isEkle('ziyaret-1', 'ZiyaretKaydetV2');
    await isEkle('etiket-1', 'EtiketBasimKaydetV2');
    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: null }));
    await processMikroRetries('B2B');
    await processMikroRetries(null);
    expect(h.sahiplenme).toEqual([]);
    await processMikroRetries('HR');
    expect(h.sahiplenme).toEqual(['etiket-1']);
    await processMikroRetries('Sales');
    expect(h.sahiplenme.sort()).toEqual(['dekont-1', 'etiket-1', 'ziyaret-1'].sort());
  });

  it('rol verilmezse süzgeç yok (eski çağrı biçimi); Mikro dışı iş süzgece takılmaz', async () => {
    await isEkle('dekont-1', 'DekontKaydetV2');
    await isEkle('luca-1', 'DekontKaydetV2', 'luca');
    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: null }));
    await processMikroRetries('HR');
    expect(h.sahiplenme).toEqual(['luca-1']);
    await processMikroRetries();
    expect(h.sahiplenme).toEqual(['luca-1', 'dekont-1']);
  });
});

// 2026-10-10 inceleme bulgusu: süzgeç sorgudaki `limit(20)`'den SONRA koşuyordu — bu oturumun gönderemeyeceği 20 iş
// pencereyi doldurunca oturum kendi işine hiç ulaşamıyordu (dokunulmayan satırın sırası sabit, pencere hiç kaymaz).
describe('rol süzgeci × 20\'lik tur tavanı — tavan süzgeçten SONRA uygulanır', () => {
  it('A — öndeki 20 iş bu role kapalı (dekont), 21. iş açık (etiket): Lojistik oturumu 21. işe ulaşır ve gönderir; dekontlar dokunulmadan kalır', async () => {
    for (let i = 1; i <= 20; i++) await isEkle(`dekont-${i}`, 'DekontKaydetV2');
    await isEkle('etiket-1', 'EtiketBasimKaydetV2');
    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: null }));
    await processMikroRetries('Logistics');
    expect(h.sahiplenme).toEqual(['etiket-1']);
    expect(is('etiket-1').status).toBe('success');
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 20; i++) expect(is(`dekont-${i}`), `dekont-${i}`).toMatchObject({ status: 'queued', attempts: 0, nextRetryAt: T0 });
  });

  it('B — tur tavanı KORUNUR: gönderilebilir 25 işten ilk turda tam 20 sahiplenilir, kalan 5 ikinci turda', async () => {
    for (let i = 1; i <= 25; i++) await isEkle(`etiket-${i}`, 'EtiketBasimKaydetV2');
    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: null }));
    await processMikroRetries('Logistics');
    expect(h.sahiplenme).toHaveLength(20);
    await processMikroRetries('Logistics');
    expect(h.sahiplenme).toHaveLength(25);
    expect(new Set(h.sahiplenme).size, 'aynı iş iki kez sahiplenilmez').toBe(25);
  });

  it('C — rolsüz çağrı (süzgeç yok, Ayarlar panelindeki düğme) eskisi gibi: 21 işten ilk turda 20, ikinci turda 21.', async () => {
    for (let i = 1; i <= 20; i++) await isEkle(`dekont-${i}`, 'DekontKaydetV2');
    await isEkle('etiket-1', 'EtiketBasimKaydetV2');
    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: null }));
    await processMikroRetries();
    expect(h.sahiplenme).toHaveLength(20);
    expect(is('etiket-1').status).toBe('queued');
    await processMikroRetries();
    expect(h.sahiplenme).toHaveLength(21);
    expect(is('etiket-1').status).toBe('success');
  });
});

describe('pushMikroEvrak — 403 düğmede metniyle görünür, yanıt biçimi başka durumda DEĞİŞMEZ', () => {
  it('403: sunucu metni + yetkiYok işareti (kuyruğa GİRMEZ — mantıksal ret)', async () => {
    h.authFetch.mockResolvedValue(yanit(403, { error: 'Bu işlem için personel yetkisi gerekir.' }));
    expect(await pushMikroEvrak('VerilenTeklifKaydetV2', { a: 1 })).toEqual({ error: 'Bu işlem için personel yetkisi gerekir.', yetkiYok: true });
    expect(h.depo.size).toBe(0);
  });

  it('200 ve 400: gövde olduğu gibi (yetkiYok anahtarı eklenmez)', async () => {
    h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: { no: 7 } }));
    expect(await pushMikroEvrak('ZiyaretKaydetV2', {})).toEqual({ success: true, error: null, data: { no: 7 } });
    h.authFetch.mockResolvedValue(yanit(400, { success: false, error: 'payload zorunlu.' }));
    expect(await pushMikroEvrak('ZiyaretKaydetV2', {})).toEqual({ success: false, error: 'payload zorunlu.' });
  });
});
