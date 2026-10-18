// @vitest-environment node
/**
 * tenantErisim.sahip.test.ts — SAHİP satır süzgeci (K10, şartname § 10.3 + § 10.4 H9): yeniden deneme kuyruğu (`syncJobs`)
 * kaydı SAHİBİNİNDİR. Bu dosya SUNUCU kuralını sınar; yürütücü tarafı: lib/kuyrukSahipligi.test + services/mikroRetry*.test.
 *
 * NEDEN SAF KURAL TESTİ (K10-5): `/api/db` rotaları `server.ts`'te `startServer` kapanışının içindedir (içe aktarılamaz, ham
 * SQL koşar) — gerçek express + gerçek `/api/db` zinciri testi bugün yazılamıyor. Projenin bu yüzey için yerleşik kalıbı:
 * KURAL saf modülde ve davranış testiyle (burası), BAĞLANTI kaynak çitiyle (server/satirSuzgeci.degismez.test — altı yazma
 * yolu, liste, tek okuma, akış init'i ve akış olayı bu işlevleri çağırıyor mu). Liste SQL'i ve koşullu yazmanın birleştirmesi
 * ayrıca gerçek PostgreSQL motorunda koşar: tenantErisim.sahip.motor.test.
 *
 * Reddin biçimi yola göre değişir (K10-4) ve beklenen değerler ona göre yazıldı:
 *   • başkasının işine PUT / PATCH / DELETE → 403 (rota `dokumanSahibiMi` false ise 403 döner);
 *   • başkasının işine atomik artırma / koşullu yazma → 404 (`sahipsizDurumKodu` — varlık da sızmaz);
 *   • gövdede / yamada gelen SAHTE sahip → ret YOK: sunucu damgası üstüne yazar (sessizce ezilir).
 */
import { describe, it, expect, vi } from 'vitest';
import { SAHIP_SATIR_ALANI, DIS_ROL_SATIR_ALANI, TENANT_COLLECTIONS } from './collections';
import { APP_ROLES, STAFF_ROLES, EXTERNAL_ROLES, isAllowed, type AppRole } from './rbac';
import {
  kiraciWhere, kiraciDamgala, dokumanSahibiMi, sahiplikDenetimli, akisSatiriGorunur, akisKovalari, akisOlayKarari, satirAlani,
  satirSahibiAlani, sahipsizDurumKodu, sahipSuzgecindenMuaf, ayrilmisKimlikAdayi, ayrilmisKimlikMi, baskasininSahipKaydiMi,
} from './tenantErisim';

const kimlik = (uid: string, rol: AppRole | null) => ({ uid, cid: vi.fn(async () => 'A'), superAdmin: false, rol: vi.fn(async () => rol) });
const is = (ek: Record<string, unknown> = {}) => ({ type: 'mikro', status: 'queued', attempts: 0, payload: { method: 'DekontKaydetV2' }, companyId: 'A', ...ek });
/** Yönetici dışındaki HER kimlik: iç roller (Müdür dâhil), dış roller, rolü çözülemeyen. */
const YONETICI_DISI = [...STAFF_ROLES.filter(r => r !== 'Admin'), ...EXTERNAL_ROLES, null] as Array<AppRole | null>;

describe('SAHIP_SATIR_ALANI — tablo', () => {
  it('syncJobs → sahipUid; her anahtar TENANT; dış rol haritasıyla kesişmez; sahiplik denetimine tabi', () => {
    expect([...SAHIP_SATIR_ALANI.entries()]).toEqual([['syncJobs', 'sahipUid']]);
    for (const c of SAHIP_SATIR_ALANI.keys()) {
      expect(TENANT_COLLECTIONS, c).toContain(c);
      expect(DIS_ROL_SATIR_ALANI.has(c), c).toBe(false);
      expect(sahiplikDenetimli(c), c).toBe(true);
    }
    expect(satirSahibiAlani('syncJobs')).toBe('sahipUid');
    expect(satirSahibiAlani('orders')).toBe('assignedTo');
    expect(satirSahibiAlani('inventory')).toBeNull();
  });
  it('muaf TEK rol Yönetici: Müdür, diğer iç roller, dış roller ve rolü çözülemeyen muaf DEĞİL', () => {
    expect(APP_ROLES.filter(r => sahipSuzgecindenMuaf(r))).toEqual(['Admin']);
    expect(sahipSuzgecindenMuaf(null)).toBe(false);
    expect(sahipSuzgecindenMuaf(undefined)).toBe(false);
  });
  it('süzgeç Yönetici dışındaki HER role uygulanır (Müdür dâhil; rolü çözülemeyen dâhil)', () => {
    expect(satirAlani('syncJobs', 'Admin')).toBeNull();
    for (const r of YONETICI_DISI) expect(satirAlani('syncJobs', r), String(r)).toBe('sahipUid');
    expect(satirAlani('syncJobs', undefined)).toBe('sahipUid');
  });
  it('dış rol haritası DEĞİŞMEDİ: `orders`ta iç roller süzgeçsiz, dış rol süzgeçli', () => {
    for (const r of STAFF_ROLES) expect(satirAlani('orders', r), r).toBeNull();
    for (const r of EXTERNAL_ROLES) expect(satirAlani('orders', r), r).toBe('assignedTo');
  });
  it('`__` kimlik kapısı syncJobs\'a UYGULANMAZ (iş kimliği gönderilen varlığın kimliğinden türer: `…_mikrofat__A__CTP-1_<uid>`)', () => {
    const id = 'mikro_IrsaliyeKaydetV2_mikrofat__A__CTP-1_satis1';
    expect(ayrilmisKimlikAdayi('syncJobs', id, false)).toBe(false);
    for (const r of [...YONETICI_DISI, 'Admin' as AppRole]) expect(ayrilmisKimlikMi('syncJobs', id, r, false), String(r)).toBe(false);
  });
  it('`mikrofat__` önek dalı (K2, 2026-10-19) koleksiyon kapısından SONRA gelir: syncJobs ve leads için HİÇBİR rolde engel değil', () => {
    for (const coll of ['syncJobs', 'leads']) for (const id of ['mikrofat__A__CTP-1', 'mikrofat__A__CTP-1_satis1']) {
      expect(ayrilmisKimlikAdayi(coll, id, false), `${coll} / ${id}`).toBe(false);
      for (const r of [...YONETICI_DISI, 'Admin' as AppRole]) expect(ayrilmisKimlikMi(coll, id, r, false), `${coll} / ${id} / ${String(r)}`).toBe(false);
    }
  });
  it('rbac satırı DEĞİŞMEDİ: kuyruğu her iç rol okur / yazar, dış rol hiçbirini; silme Yönetici + Müdür', () => {
    for (const r of STAFF_ROLES) { expect(isAllowed(r, 'syncJobs', 'read'), r).toBe(true); expect(isAllowed(r, 'syncJobs', 'write'), r).toBe(true); }
    for (const r of EXTERNAL_ROLES) { expect(isAllowed(r, 'syncJobs', 'read'), r).toBe(false); expect(isAllowed(r, 'syncJobs', 'write'), r).toBe(false); }
    expect(APP_ROLES.filter(r => isAllowed(r, 'syncJobs', 'delete'))).toEqual(['Admin', 'Manager']);
  });
});

describe('damga — sahip sunucudan; istemci değeri yok sayılır; güncellemeyle değişmez', () => {
  it('oluşturma (POST: önceki yok · PUT / PATCH yeni kimlik: önceki = {}): sahip = oturum; SAHTE değer sessizce ezilir — Yönetici dâhil', async () => {
    for (const r of ['HR', 'Accounting', 'Manager', 'Admin'] as AppRole[]) {
      for (const onceki of [undefined, {}]) {
        expect(await kiraciDamgala('syncJobs', is({ sahipUid: 'kurban', companyId: 'B' }), kimlik('ben', r), onceki), r)
          .toEqual(is({ sahipUid: 'ben', companyId: 'A' }));
      }
    }
  });
  it('gövdede sahip alanı HİÇ yoksa da damgalanır (istemci alanı yazmaz)', async () => {
    expect(await kiraciDamgala('syncJobs', is(), kimlik('ben', 'Sales'))).toEqual(is({ sahipUid: 'ben' }));
  });
  it('güncelleme (PUT / PATCH / koşullu yazma: önceki = mevcut kayıt): sahip KORUNUR — yamada gelen değer atılır', async () => {
    expect(await kiraciDamgala('syncJobs', { status: 'in-progress', sahipUid: 'baskasi' }, kimlik('ben', 'Accounting'), is({ sahipUid: 'ben' })))
      .toEqual({ status: 'in-progress', companyId: 'A', sahipUid: 'ben' });
    // Yönetici başkasının işine yazabilir ama SAHİBİNİ değiştiremez (kendine de alamaz).
    expect(await kiraciDamgala('syncJobs', { status: 'dead', sahipUid: 'yonetici' }, kimlik('yonetici', 'Admin'), is({ sahipUid: 'ik' })))
      .toEqual({ status: 'dead', companyId: 'A', sahipUid: 'ik' });
  });
  it('tam değiştirme (PUT, gövdede sahip yok): önceki sahip geri konur — sahibi damgayı DÜŞÜREMEZ', async () => {
    expect(await kiraciDamgala('syncJobs', { type: 'mikro', status: 'queued' }, kimlik('ben', 'Sales'), is({ sahipUid: 'ben' })))
      .toEqual({ type: 'mikro', status: 'queued', companyId: 'A', sahipUid: 'ben' });
  });
  it('damgasız ESKİ iş (ya da bozuk damga: boş metin, sayı): dokunan Yönetici sahibi olur', async () => {
    for (const eski of [{}, { sahipUid: '' }, { sahipUid: 7 }, { sahipUid: null }]) {
      expect(await kiraciDamgala('syncJobs', { status: 'in-progress' }, kimlik('yonetici', 'Admin'), is(eski)), JSON.stringify(eski))
        .toEqual({ status: 'in-progress', companyId: 'A', sahipUid: 'yonetici' });
    }
  });
  it('sahip haritasında OLMAYAN koleksiyonda damga eskisi gibi: sahip alanı yazılmaz', async () => {
    expect(await kiraciDamgala('inventory', { ad: 'x', sahipUid: 'serbest-alan' }, kimlik('ben', 'Sales'))).toEqual({ ad: 'x', sahipUid: 'serbest-alan', companyId: 'A' });
  });
});

describe('yazma / okuma kapısı — sahip + Yönetici (okuma = yazma kuralı)', () => {
  const baskasinin = is({ sahipUid: 'muhasebe' });
  it('başkasının işi: Yönetici dışındaki her rol REDDEDİLİR (PUT / PATCH / DELETE / atomik artırma / koşullu yazma / tek okuma aynı yüklem)', async () => {
    for (const r of YONETICI_DISI) expect(await dokumanSahibiMi('syncJobs', baskasinin, kimlik('ben', r), 'x'), String(r)).toBe(false);
    expect(await dokumanSahibiMi('syncJobs', baskasinin, kimlik('ben', 'Admin'), 'x')).toBe(true);
  });
  it('kendi işi: geçer', async () => {
    for (const r of STAFF_ROLES) expect(await dokumanSahibiMi('syncJobs', is({ sahipUid: 'ben' }), kimlik('ben', r), 'x'), r).toBe(true);
  });
  it('damgasız eski iş: yalnız Yönetici; başka kiracının işi: Yönetici de hayır (sahibi olsa da)', async () => {
    for (const r of YONETICI_DISI) expect(await dokumanSahibiMi('syncJobs', is(), kimlik('ben', r), 'x'), String(r)).toBe(false);
    expect(await dokumanSahibiMi('syncJobs', is(), kimlik('ben', 'Admin'), 'x')).toBe(true);
    expect(await dokumanSahibiMi('syncJobs', is({ companyId: 'B', sahipUid: 'ben' }), kimlik('ben', 'Admin'), 'x')).toBe(false);
    expect(await dokumanSahibiMi('syncJobs', is({ companyId: 'B', sahipUid: 'ben' }), kimlik('ben', 'Sales'), 'x')).toBe(false);
  });
  it('kiracı etiketi OLMAYAN iş: sahibi olsa da Yönetici dışına kapalı (katı süzgeç)', async () => {
    const { companyId: _atilan, ...etiketsiz } = is({ sahipUid: 'ben' });
    expect(await dokumanSahibiMi('syncJobs', etiketsiz, kimlik('ben', 'Sales'), 'x')).toBe(false);
  });
  it('yeni kayıt (belge yok): geçer', async () => {
    expect(await dokumanSahibiMi('syncJobs', undefined, kimlik('ben', 'HR'), 'x')).toBe(true);
  });
  it('reddin durum kodu — atomik artırma / koşullu yazma: 404 (varlık sızmaz); Yönetici süzgeçsiz (403 yalnız başka kiracıda)', () => {
    for (const r of YONETICI_DISI) expect(sahipsizDurumKodu('syncJobs', r), String(r)).toBe(404);
    expect(sahipsizDurumKodu('syncJobs', 'Admin')).toBe(403);
  });
  it('liste: Yönetici dışı KATI (kendi kiracısı VE sahip = uid; damgasız gelmez) — Müdür dâhil; Yönetici kiracının tümü', async () => {
    for (const r of YONETICI_DISI) {
      expect(await kiraciWhere('syncJobs', kimlik('ben', r)), String(r))
        .toEqual({ sql: " AND data->>'companyId' = $2 AND data->>$3 = $4", params: ['A', 'sahipUid', 'ben'] });
    }
    expect(await kiraciWhere('syncJobs', kimlik('ben', 'Admin'))).toEqual({ sql: " AND (data->>'companyId' = $2 OR NOT (data ? 'companyId'))", params: ['A'] });
  });
  it('rol yalnız süzgeçli koleksiyonda sorulur (tembel): süzgeçsiz koleksiyonda rol sorgusu yapılmaz', async () => {
    const k = kimlik('ben', 'Sales');
    await kiraciWhere('inventory', k);
    await dokumanSahibiMi('inventory', { companyId: 'A' }, k, 'x');
    expect(k.rol).not.toHaveBeenCalled();
    await kiraciWhere('syncJobs', k);
    expect(k.rol).toHaveBeenCalledTimes(1);
  });
});

describe('akış (SSE) — init kovası, ikinci kapı, olay: başkasının işi canlı da gitmez', () => {
  it('init: Yönetici dışında syncJobs SATIR kovasında (Müdür dâhil); Yönetici\'de kiracı kovasında', () => {
    for (const r of YONETICI_DISI) {
      expect(akisKovalari(['syncJobs', 'inventory'], r), String(r)).toMatchObject({ tenant: ['inventory'], satir: [{ coll: 'syncJobs', alan: 'sahipUid' }] });
    }
    expect(akisKovalari(['syncJobs'], 'Admin')).toMatchObject({ tenant: ['syncJobs'], satir: [] });
  });
  it('ikinci kapı: başkasının / damgasız işin gövdesi gitmez', () => {
    const k = { uid: 'ben', cid: 'A', rol: 'Manager' as AppRole };
    expect(akisSatiriGorunur('syncJobs', 'x', is({ sahipUid: 'muhasebe' }), k)).toBe(false);
    expect(akisSatiriGorunur('syncJobs', 'x', is(), k)).toBe(false);
    expect(akisSatiriGorunur('syncJobs', 'x', is({ sahipUid: 'ben' }), k)).toBe(true);
    expect(akisSatiriGorunur('syncJobs', 'x', is({ sahipUid: 'muhasebe' }), { ...k, rol: 'Admin' })).toBe(true);
    expect(akisSatiriGorunur('syncJobs', 'x', is(), { ...k, rol: 'Admin' })).toBe(true);
  });
  it('olay: etiket (`satirSahibi`) kendi uid\'i değilse yutulur; etiketsiz olay da yutulur; Yönetici\'ye gider', () => {
    const k = { uid: 'ben', cid: 'A', rol: 'HR' as AppRole };
    expect(akisOlayKarari({ coll: 'syncJobs', id: 'x', type: 'set', cid: 'A', satirSahibi: 'muhasebe' }, k, new Set())).toBe('yut');
    expect(akisOlayKarari({ coll: 'syncJobs', id: 'x', type: 'set', cid: 'A' }, k, new Set())).toBe('yut');
    expect(akisOlayKarari({ coll: 'syncJobs', id: 'x', type: 'set', cid: 'A', satirSahibi: 'ben' }, k, new Set())).toBe('gonder');
    expect(akisOlayKarari({ coll: 'syncJobs', id: 'x', type: 'set', cid: 'A', satirSahibi: 'muhasebe' }, { ...k, rol: 'Admin' }, new Set())).toBe('gonder');
  });
});

// K10-11 — geçiş artıkları: SUNUCU tarafında ne olduğu burada sabitlenir; işi ÇALIŞTIRMAMA kuralı yürütücüdedir
// (lib/kuyrukSahipligi `isBuOturumun` — G1 / G2; testleri kuyrukSahipligi.test ve services/mikroRetry.sahip.test).
// İnceleme düzeltmesi (2026-10-17): sahip devredilemediği için Yönetici'nin başkasının damgalı kaydına PUT ile yazdığı gövde
// önceki sahibin okumasına düşerdi. Bağlantı (server.ts PUT işleyicisi) çitte: server/satirSuzgeci.degismez.test.
describe('tam değiştirme (PUT) — başkasının SAHİP damgalı kaydına yazım reddedilir, Yönetici dâhil', () => {
  const baskasinin = is({ sahipUid: 'muhasebe' });
  it('başkasının damgalı kaydı: her oturum için engel (yüklem rol sormaz — Yönetici de reddedilir)', () => {
    for (const uid of ['yonetici', 'mudur', 'satis']) expect(baskasininSahipKaydiMi('syncJobs', baskasinin, uid), uid).toBe(true);
  });
  it('kendi damgalı kaydı: engel yok (iç rol de Yönetici de kendi işini yeniden kuyruğa koyar)', () => {
    expect(baskasininSahipKaydiMi('syncJobs', baskasinin, 'muhasebe')).toBe(false);
    expect(baskasininSahipKaydiMi('syncJobs', is({ sahipUid: 'yonetici' }), 'yonetici')).toBe(false);
  });
  it('yeni kayıt (önceki yok ya da `{}`): engel yok', () => {
    expect(baskasininSahipKaydiMi('syncJobs', undefined, 'yonetici')).toBe(false);
    expect(baskasininSahipKaydiMi('syncJobs', {}, 'yonetici')).toBe(false);
  });
  it('damgasız ya da bozuk damgalı ESKİ kayıt: engel yok ve damgayı yazan Yönetici alır', async () => {
    for (const onceki of [is(), is({ sahipUid: '' }), is({ sahipUid: 7 }), is({ sahipUid: null })] as Array<Record<string, unknown>>) {
      expect(baskasininSahipKaydiMi('syncJobs', onceki, 'yonetici'), JSON.stringify(onceki.sahipUid ?? 'yok')).toBe(false);
      expect((await kiraciDamgala('syncJobs', is(), kimlik('yonetici', 'Admin'), onceki)).sahipUid).toBe('yonetici');
    }
  });
  it('sahip haritasında OLMAYAN koleksiyon: engel yok (alan adı aynı olsa bile)', () => {
    for (const coll of ['orders', 'inventory', 'notifications']) {
      expect(SAHIP_SATIR_ALANI.has(coll)).toBe(false);
      expect(baskasininSahipKaydiMi(coll, { companyId: 'A', sahipUid: 'muhasebe', userId: 'muhasebe' }, 'yonetici'), coll).toBe(false);
    }
  });
});

describe('geçiş artıkları (K10-11) — sunucunun gördüğü', () => {
  it('kimlik kapma: saldırgan kurbanın kimlik biçimiyle iş açar → belge SALDIRGANIN doğar; kurbanın aynı kimliğe yazımı reddedilir, sahiplik kurbana GEÇMEZ', async () => {
    const kapilan = await kiraciDamgala('syncJobs', is({ sahipUid: 'kurban' }), kimlik('saldirgan', 'HR'), {});
    expect(kapilan.sahipUid).toBe('saldirgan');
    expect(await dokumanSahibiMi('syncJobs', kapilan, kimlik('kurban', 'Accounting'), 'mikro_DekontKaydetV2_L1_kurban')).toBe(false);
    // Yönetici kurbansa sahiplik kapısından GEÇER (kuyruğun tümünü görür) ama damga sahibi değiştirmez — bu yüzden TAM
    // DEĞİŞTİRME (PUT; yeniden deneme kuyruğa `setDoc` ile girer) ayrıca reddedilir: gövdesi saldırganın okumasına düşmez.
    expect(await dokumanSahibiMi('syncJobs', kapilan, kimlik('kurban', 'Admin'), 'mikro_DekontKaydetV2_L1_kurban')).toBe(true);
    expect((await kiraciDamgala('syncJobs', is(), kimlik('kurban', 'Admin'), kapilan)).sahipUid).toBe('saldirgan');
    expect(baskasininSahipKaydiMi('syncJobs', kapilan, 'kurban')).toBe(true);
  });
  it('yayından ÖNCE ekilmiş sahip alanı: sunucu o belgeyi alanın gösterdiği kullanıcıya listeler — bu yüzden yürütücü kimlik sonekini de arar (G1)', async () => {
    const ekilmis = is({ sahipUid: 'muhasebe' });   // eski sunucu istemcinin gönderdiği değeri olduğu gibi bırakıyordu
    expect(await dokumanSahibiMi('syncJobs', ekilmis, kimlik('muhasebe', 'Accounting'), 'mikro_DekontKaydetV2_L1')).toBe(true);
    expect(akisSatiriGorunur('syncJobs', 'mikro_DekontKaydetV2_L1', ekilmis, { uid: 'muhasebe', cid: 'A', rol: 'Accounting' })).toBe(true);
  });
});
