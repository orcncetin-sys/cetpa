/**
 * MikroKuyrukKarti.test.tsx — Ayarlar → Mikro «Retry Kuyruğu» kartı (K10: iş SAHİBİNİNDİR; İ3: ölü düğme yok).
 * Şartname § 10.3 + § 10.4 H9; kapı bulguları K10-2 («Şimdi Dene» süzgeçli koşar) ve K10-8 (Yönetici çıkışı).
 *
 * Kart GERÇEK servislerle çizilir (`syncRetryService`, `mikroEvrak`); altındaki sunucu sahtesi (`kuyruk.testDuzenegi`)
 * kararları sunucunun çağırdığı AYNI saf işlevlerle verir (sahibi damgalar, listeyi role göre süzer, başkasının işine yazımı
 * reddeder). Gerçek `/api/db` zinciri testinin neden yazılamadığı: services/mikroRetry.sahip.test başlığı (K10-5).
 *
 * Her düğme için iki yön: «geçen oturumda çizilir» ve «kilitli oturumda çizilmez»; her çağrı için «kilitli oturumda istek
 * atılmaz». Kartın panele bağlı olduğu (yazıldı ama bağlanmadı çiti): services/mikroRetry.sahip.test «kaynak çiti».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { sunucu } from '../services/kuyruk.testDuzenegi';
import { APP_ROLES, STAFF_ROLES, EXTERNAL_ROLES, isAllowed, type AppRole } from '../lib/rbac';
import { evrakKapisindanGecer } from '../lib/mikroEvrakKapilari';
import type { UserRole } from '../types';
import { SRC_KOK, kodSatirlari } from '../test/kaynakTarama';

const h = vi.hoisted(() => ({ authFetch: vi.fn(), onay: vi.fn() }));
vi.mock('../firebase', async () => (await import('../services/kuyruk.testDuzenegi')).firebaseSahtesi);
vi.mock('../lib/dbClient', async () => (await import('../services/kuyruk.testDuzenegi')).dbClientSahtesi);
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => h.authFetch(...a) }));
vi.mock('../lib/confirm', () => ({ confirmAction: (...a: unknown[]) => h.onay(...a) }));

import MikroKuyrukKarti from './MikroKuyrukKarti';
import { enqueueSyncJob, KAPATILAN_IS_HATASI, OLU_IS_SAKLAMA_MS } from '../services/syncRetryService';
import { useAppStore } from '../store/appStore';

const yanit = (kod: number, govde: unknown) => ({ status: kod, ok: kod >= 200 && kod < 300, json: async () => govde });
const SAAT = 60 * 60 * 1000;
const T0 = new Date('2026-10-11T09:00:00Z').getTime();

/** Oturum: sunucunun gördüğü kullanıcı (jeton) + depodaki rol (kart rolü depodan okur). */
const oturumAc = (uid: string | null, rol: AppRole): void => {
  sunucu.oturumAc(uid, rol);
  useAppStore.setState({ userRole: rol as UserRole });
};
/** `kim` işi kuyruğa koyar (sunucu sahibi damgalar); belge kimliğini döner. */
const isEkle = async (kim: string, rol: AppRole, taban: string, method: string): Promise<string> => {
  sunucu.oturumAc(kim, rol);
  await enqueueSyncJob({ id: taban, type: 'mikro', payload: { method, payload: { kim }, meta: { entityId: taban } }, maxAttempts: 5 });
  return `${taban}_${kim}`;
};
const is = (id: string) => sunucu.depo.get(id) as { status: string; sahipUid?: string; lastError?: string };
const bekle = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
async function ciz(dil: 'tr' | 'en' = 'tr') {
  const r = render(<MikroKuyrukKarti currentLanguage={dil} />);
  await bekle();
  return r;
}
const dugme = (ad: RegExp) => screen.queryByRole('button', { name: ad });
const SIMDI_DENE = /^Şimdi Dene$/;
const KAPAT = /^Takılanları Kapat \(\d+\)$/;
const TEMIZLE = /^Ölüleri Temizle$/;

beforeEach(() => {
  sunucu.sifirla();
  h.authFetch.mockReset();
  h.authFetch.mockResolvedValue(yanit(200, { success: true, error: null, data: null }));
  h.onay.mockReset();
  h.onay.mockResolvedValue(true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => { vi.useRealTimers(); useAppStore.setState(useAppStore.getInitialState(), true); });

describe('«Şimdi Dene» — SÜZGEÇLİ koşar; yalnız bu oturumun göndereceği iş varken çizilir', () => {
  it('kendi işi olan sahip: «1 bekliyor» + düğme; tıklayınca iş KENDİ kimliğiyle gider, kart kapanır', async () => {
    const id = await isEkle('muhasebe', 'Accounting', 'dekont-1', 'DekontKaydetV2');
    oturumAc('muhasebe', 'Accounting');
    await ciz();
    expect(screen.getByRole('region', { name: 'Retry Kuyruğu' }).textContent).toContain('1 bekliyor');
    fireEvent.click(screen.getByRole('button', { name: SIMDI_DENE }));
    await waitFor(() => expect(is(id).status).toBe('success'));
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.authFetch.mock.calls[0][1].body as string)).toMatchObject({ method: 'DekontKaydetV2', payload: { kim: 'muhasebe' } });
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());   // bekleyen de ölü de kalmadı
  });

  it('Yönetici oturumu, kuyrukta YALNIZ başkasının işi: «0 bekliyor · 1 iş başka kullanıcının» yazar, «Şimdi Dene» ÇİZİLMEZ; hiçbir istek Mikro\'ya gitmez', async () => {
    const id = await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    oturumAc('yonetici', 'Admin');
    await ciz();
    const kart = screen.getByRole('region', { name: 'Retry Kuyruğu' });
    expect(kart.textContent).toContain('0 bekliyor');
    expect(kart.textContent).toContain('1 iş başka kullanıcının (sahibi oturum açınca gönderilir)');
    expect(dugme(SIMDI_DENE)).toBeNull();
    expect(dugme(KAPAT)).toBeNull();                            // taze iş: sahibi birazdan gönderebilir
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(is(id)).toMatchObject({ status: 'queued', sahipUid: 'ik' });
  });

  it('Yönetici oturumu, kendi işi + başkasının işi: düğme yalnız KENDİ işini gönderir (eskiden argümansız çağrı hepsini gönderiyordu)', async () => {
    const baskasinin = await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    const kendi = await isEkle('yonetici', 'Admin', 'etiket-1', 'EtiketBasimKaydetV2');
    oturumAc('yonetici', 'Admin');
    await ciz();
    fireEvent.click(screen.getByRole('button', { name: SIMDI_DENE }));
    await waitFor(() => expect(is(kendi).status).toBe('success'));
    await bekle();
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.authFetch.mock.calls[0][1].body as string)).toMatchObject({ method: 'EtiketBasimKaydetV2' });
    expect(is(baskasinin)).toMatchObject({ status: 'queued', sahipUid: 'ik' });
    expect(dugme(SIMDI_DENE)).toBeNull();                       // gönderilecek iş kalmadı → düğme de kalmadı
    expect(screen.getByRole('region').textContent).toContain('1 iş başka kullanıcının');
  });

  it('rolü yöntemin kapısından geçmeyen sahip: «rolünüzle gönderilemiyor» yazar, düğme ÇİZİLMEZ', async () => {
    await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    oturumAc('ik', 'HR');
    await ciz();
    const kart = screen.getByRole('region', { name: 'Retry Kuyruğu' });
    expect(kart.textContent).toContain('0 bekliyor');
    expect(kart.textContent).toContain('1 iş rolünüzle gönderilemiyor');
    expect(dugme(SIMDI_DENE)).toBeNull();
    expect(h.authFetch).not.toHaveBeenCalled();
  });

  it('tek kaynak: her iç rol × (dekont, etiket) — düğme çizilir ⇔ rol yöntemin sunucudaki kapısından geçer', async () => {
    const ayrisan: string[] = [];
    let cizilen = 0, cizilmeyen = 0;
    for (const yontem of ['DekontKaydetV2', 'EtiketBasimKaydetV2']) {
      for (const rol of STAFF_ROLES) {
        sunucu.sifirla();
        await isEkle('ben', rol, 'is-1', yontem);
        oturumAc('ben', rol);
        const { unmount } = await ciz();
        const var_ = dugme(SIMDI_DENE) !== null;
        if (var_ !== evrakKapisindanGecer(rol, yontem)) ayrisan.push(`${yontem} × ${rol}: düğme ${var_ ? 'VAR' : 'yok'}`);
        if (var_) cizilen++; else cizilmeyen++;
        unmount();
      }
    }
    expect(ayrisan).toEqual([]);
    expect(cizilen).toBeGreaterThan(0);
    expect(cizilmeyen).toBeGreaterThan(0);                      // iki yön de gerçekten görüldü
  });
});

describe('«Takılanları Kapat» — Yönetici çıkışı: sahibi gönder(e)meyen takılı iş çalıştırılmadan kapatılır', () => {
  it('Yönetici + başkasının 25 saatlik işi: düğme çizilir; onaydan sonra iş ÖLÜ, sahip aynı, Mikro\'ya istek YOK; düğme kaybolur', async () => {
    const id = await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    vi.setSystemTime(T0 + 25 * SAAT);
    oturumAc('yonetici', 'Admin');
    await ciz();
    fireEvent.click(screen.getByRole('button', { name: /^Takılanları Kapat \(1\)$/ }));
    await waitFor(() => expect(is(id).status).toBe('dead'));
    await bekle();
    expect(h.onay).toHaveBeenCalledTimes(1);
    expect(h.onay.mock.calls[0][0]).toMatchObject({ title: 'Takılan işler kapatılsın mı?', confirmLabel: 'Kapat', variant: 'warning' });
    expect(String((h.onay.mock.calls[0][0] as { message: string }).message)).toContain('Mikro\'ya GÖNDERİLMEZ');
    expect(is(id)).toMatchObject({ sahipUid: 'ik', lastError: KAPATILAN_IS_HATASI });
    expect(h.authFetch).not.toHaveBeenCalled();
    expect(dugme(KAPAT)).toBeNull();
    expect(screen.getByRole('region').textContent).toContain('1 ölü');
  });

  it('onay verilmezse hiçbir şey yazılmaz', async () => {
    const id = await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    vi.setSystemTime(T0 + 25 * SAAT);
    oturumAc('yonetici', 'Admin');
    h.onay.mockResolvedValue(false);
    await ciz();
    fireEvent.click(screen.getByRole('button', { name: KAPAT }));
    await bekle();
    expect(sunucu.kosulluYazma).toEqual([]);
    expect(is(id).status).toBe('queued');
  });

  it('Yönetici dışındaki HER iç rolde çizilmez — Müdür dâhil; sunucu süzgeci düşüp başkasının takılı işi listelense de', async () => {
    await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    vi.setSystemTime(T0 + 25 * SAAT);
    for (const rol of STAFF_ROLES) {
      sunucu.suzgecsizListe = true;
      oturumAc('ben', rol);
      const { unmount } = await ciz();
      const beklenen = rol === 'Admin';
      expect(dugme(KAPAT) !== null, rol).toBe(beklenen);
      if (!beklenen) expect(screen.getByRole('region').textContent, rol).toContain('1 iş başka kullanıcının');
      unmount();
    }
    expect(sunucu.kosulluYazma).toEqual([]);
  });

  it('damgasız eski iş Yönetici\'de «bekliyor»dur (kendi gönderir) — kapatılacak iş sayılmaz', async () => {
    sunucu.depo.set('eski-1', { id: 'eski-1', type: 'mikro', payload: { method: 'DekontKaydetV2', payload: {} }, status: 'queued', attempts: 0, maxAttempts: 5, nextRetryAt: 0, createdAt: T0 - 30 * SAAT, updatedAt: T0, companyId: 'A' });
    oturumAc('yonetici', 'Admin');
    await ciz();
    expect(screen.getByRole('region').textContent).toContain('1 bekliyor');
    expect(dugme(SIMDI_DENE)).not.toBeNull();
    expect(dugme(KAPAT)).toBeNull();
  });
});

describe('«Ölüleri Temizle» — yalnız silinecek iş varken ve rol silebiliyorken', () => {
  const oluIs = (id: string, sahip: string, guncelleme: number) =>
    sunucu.depo.set(id, { id, type: 'mikro', payload: { method: 'DekontKaydetV2', payload: {} }, status: 'dead', attempts: 5, maxAttempts: 5, nextRetryAt: 0, createdAt: 0, updatedAt: guncelleme, companyId: 'A', sahipUid: sahip });

  it('7 günden eski ölü iş + silebilen rol: düğme çizilir, tıklayınca silinir', async () => {
    oluIs('olu_yonetici', 'yonetici', T0 - OLU_IS_SAKLAMA_MS - 1);
    oturumAc('yonetici', 'Admin');
    await ciz();
    expect(screen.getByRole('region').textContent).toContain('1 ölü');
    fireEvent.click(screen.getByRole('button', { name: TEMIZLE }));
    await waitFor(() => expect(sunucu.depo.size).toBe(0));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('ölü iş 7 günden YENİ: «1 ölü» yazar ama düğme ÇİZİLMEZ (tıklansa hiçbir şey silmezdi — ölü düğme)', async () => {
    oluIs('olu_yonetici', 'yonetici', T0 - SAAT);
    oturumAc('yonetici', 'Admin');
    await ciz();
    expect(screen.getByRole('region').textContent).toContain('1 ölü');
    expect(dugme(TEMIZLE)).toBeNull();
  });

  it('her iç rol kendi eski ölü işiyle: düğme çizilir ⇔ rol kuyruktan SİLEBİLİR (`isAllowed`); silemeyen rolde silme isteği atılmaz', async () => {
    for (const rol of STAFF_ROLES) {
      sunucu.sifirla();
      oluIs('olu_ben', 'ben', T0 - OLU_IS_SAKLAMA_MS - 1);
      oturumAc('ben', rol);
      const { unmount } = await ciz();
      expect(dugme(TEMIZLE) !== null, rol).toBe(isAllowed(rol, 'syncJobs', 'delete'));
      expect(sunucu.istekler.filter(i => i.startsWith('DELETE')), rol).toEqual([]);
      unmount();
    }
    expect(STAFF_ROLES.filter(r => isAllowed(r, 'syncJobs', 'delete'))).toEqual(['Admin', 'Manager']);
  });
});

describe('kilitli oturum — kart çizilmez, sunucuya istek ATILMAZ', () => {
  it('dış rol (B2B / Bayi): kuyrukta iş olsa da istek yok, kart yok', async () => {
    await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    for (const rol of EXTERNAL_ROLES) {
      sunucu.suzgecsizListe = true;
      sunucu.istekler.length = 0;
      oturumAc('bayi', rol);
      const { container, unmount } = await ciz();
      expect(container.innerHTML, rol).toBe('');
      expect(sunucu.istekler, rol).toEqual([]);
      unmount();
    }
  });

  it('oturum yok (kimlik bilinmiyor): istek yok, kart yok', async () => {
    await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    sunucu.istekler.length = 0;
    oturumAc(null, 'Admin');
    const { container } = await ciz();
    expect(container.innerHTML).toBe('');
    expect(sunucu.istekler).toEqual([]);
  });

  it('boş kuyruk: kart çizilmez (bir okuma atılır, başka istek atılmaz)', async () => {
    oturumAc('yonetici', 'Admin');
    const { container } = await ciz();
    expect(container.innerHTML).toBe('');
    expect(sunucu.istekler).toEqual(['GET syncJobs']);
  });
});

describe('dil ve tek kaynak', () => {
  it('İngilizce: aynı sayılar, İngilizce metin', async () => {
    await isEkle('ik', 'HR', 'dekont-1', 'DekontKaydetV2');
    await isEkle('yonetici', 'Admin', 'etiket-1', 'EtiketBasimKaydetV2');
    vi.setSystemTime(T0 + 25 * SAAT);
    oturumAc('yonetici', 'Admin');
    await ciz('en');
    const kart = screen.getByRole('region', { name: 'Retry Queue' });
    expect(kart.textContent).toContain('1 queued');
    expect(kart.textContent).toContain('1 owned by other users');
    expect(screen.getByRole('button', { name: 'Retry Now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Stuck (1)' })).toBeInTheDocument();
  });

  it('bileşende rol ADI yazılmaz: sayılar servisten (saf kuraldan), silme hakkı `isAllowed` tablosundan', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'components', 'MikroKuyrukKarti.tsx')).map(s => s.kod).join('\n');
    for (const r of APP_ROLES) expect(kod.includes(`'${r}'`), r).toBe(false);
    expect(kod).toContain("isAllowed(userRole, KUYRUK_KOLEKSIYONU, 'delete')");
    // Her servis çağrısı bu oturumun kimliğiyle: argümansız çağrı yok.
    expect(kod).toContain('getSyncQueueStats(kimlik())');
    expect(kod).toContain('processMikroRetries(kimlik())');
    expect(kod).toContain('takilanIsleriKapat(kimlik())');
    expect(kod).toContain('({ uid: auth.currentUser?.uid, rol: userRole })');
  });
});
