// @vitest-environment node
/**
 * kuyrukSahipligi.test.ts — yeniden deneme kuyruğunda «iş kimin, hangi oturum gönderir» kuralı (K10 — şartname § 10.3, H9).
 *
 * SAF kural testi. Bağlandığı yerler ayrı sınanır: yürütücü (services/mikroRetry.sahip.test), kuyruk kartı
 * (components/MikroKuyrukKarti.test), bekçi (server/opsWatchdog.kuyruk.test). Sunucu damgası: tenantErisim.sahip.test.
 * Beklenen değerler ELLE yazılıdır; ayrıca kuralın tabloya bağlı olduğu (kopya rol listesi olmadığı) çitlenir.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SAHIP_SATIR_ALANI } from './collections';
import { APP_ROLES, STAFF_ROLES, EXTERNAL_ROLES, type AppRole } from './rbac';
import { MIKRO_EVRAK_KAPILARI, evrakKapisindanGecer } from './mikroEvrakKapilari';
import { sahipSuzgecindenMuaf } from './tenantErisim';
import {
  KUYRUK_KOLEKSIYONU, TAKILI_IS_ESIGI_MS, bekleyenIsSinifi, isBuOturumun, isKimligi, isSahibi, isTakili, isYontemi,
  isiGonderebilir, kapatilabilir, kimlikSahibiniTasir, kuyrukOzeti, kuyrukYurutebilir, kuyruktaKapatabilir, rolGonderebilir, type KuyrukIsi,
} from './kuyrukSahipligi';
import { SRC_KOK, kodSatirlari } from '../test/kaynakTarama';

const SIMDI = new Date('2026-10-11T09:00:00Z').getTime();
const SAAT = 60 * 60 * 1000;
/** `kim`in kuyruğa koyduğu Mikro işi (kimlik sahibinin sonekini taşır, sunucu damgalamış). */
const is = (kim: string, yontem: string, ek: Partial<KuyrukIsi> = {}): KuyrukIsi =>
  ({ id: isKimligi(`mikro_${yontem}_L1`, kim), type: 'mikro', payload: { method: yontem, payload: {} }, sahipUid: kim, createdAt: SIMDI, ...ek });
/** K10 öncesinden kalan iş: sahip damgası yok, kimlik soneksiz. */
const eskiIs = (yontem: string, ek: Partial<KuyrukIsi> = {}): KuyrukIsi =>
  ({ id: `mikro_${yontem}_L1`, type: 'mikro', payload: { method: yontem, payload: {} }, createdAt: SIMDI, ...ek });
const YONETICI_DISI = APP_ROLES.filter(r => r !== 'Admin');

describe('tek kaynak — kural tablolara bağlı', () => {
  it('kuyruk koleksiyonu sahip haritasındadır; işin sahip alanı haritadaki alandır', () => {
    expect(KUYRUK_KOLEKSIYONU).toBe('syncJobs');
    expect(SAHIP_SATIR_ALANI.get(KUYRUK_KOLEKSIYONU)).toBe('sahipUid');
    expect(isSahibi({ sahipUid: 'ben' })).toBe('ben');
  });
  it('modülde rol ADI yazılmaz: «Yönetici muaf» sunucunun işlevinden (`sahipSuzgecindenMuaf`), yöntem kapısı sunucunun tablosundan sorulur', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'lib', 'kuyrukSahipligi.ts')).map(s => s.kod).join('\n');
    for (const r of APP_ROLES) expect(kod.includes(`'${r}'`), r).toBe(false);
    expect(kod).toContain('sahipSuzgecindenMuaf(');
    expect(kod).toContain('evrakKapisindanGecer(');
    expect(kod).toContain('isAllowed(');
  });
});

describe('isSahibi / kimlik', () => {
  it('damgalı iş → sahibi; damgasız ya da bozuk damga (boş metin, sayı, null) → null', () => {
    expect(isSahibi({ sahipUid: 'u1' })).toBe('u1');
    for (const bozuk of [undefined, '', 7, null, {}, true]) expect(isSahibi({ sahipUid: bozuk }), String(bozuk)).toBeNull();
  });
  it('belge kimliği = taban + kullanıcı; iki kullanıcının aynı varlık için kimliği FARKLIDIR', () => {
    expect(isKimligi('mikro_ZiyaretKaydetV2_L1', 'satis1')).toBe('mikro_ZiyaretKaydetV2_L1_satis1');
    expect(isKimligi('mikro_ZiyaretKaydetV2_L1', 'satis1')).not.toBe(isKimligi('mikro_ZiyaretKaydetV2_L1', 'satis2'));
  });
  it('kimlik sahibini taşır mı: yalnız TAM sonek; başka kullanıcının soneki, sonek benzeri ve boş kimlik taşımaz', () => {
    expect(kimlikSahibiniTasir('mikro_X_L1_satis1', 'satis1')).toBe(true);
    expect(kimlikSahibiniTasir('mikro_X_L1_satis1', 'satis2')).toBe(false);
    expect(kimlikSahibiniTasir('mikro_X_L1_satis1', 'is1')).toBe(false);       // `_` sınırı: `…_satis1` ≠ `…_is1`
    expect(kimlikSahibiniTasir('mikro_X_L1', 'L1')).toBe(true);                  // biçim kuralıdır: sahip = sonek ise taşır
    expect(kimlikSahibiniTasir('mikro_X_L1_satis1', '')).toBe(false);
  });
});

describe('kuyrukYurutebilir — kuyruğu okuyup yazabilen oturum', () => {
  it('her iç rol yürütür; dış rol, rolü olmayan ve kimliksiz oturum YÜRÜTMEZ', () => {
    for (const r of STAFF_ROLES) expect(kuyrukYurutebilir({ uid: 'u', rol: r }), r).toBe(true);
    for (const r of EXTERNAL_ROLES) expect(kuyrukYurutebilir({ uid: 'u', rol: r }), r).toBe(false);
    expect(kuyrukYurutebilir({ uid: 'u', rol: null })).toBe(false);
    expect(kuyrukYurutebilir({ uid: 'u', rol: undefined })).toBe(false);
    for (const uid of [null, undefined, '']) expect(kuyrukYurutebilir({ uid, rol: 'Admin' }), String(uid)).toBe(false);
  });
});

describe('isBuOturumun — iş SAHİBİNİNDİR', () => {
  it('kendi işi (kimlik soneki kendi): her rolde evet', () => {
    for (const r of APP_ROLES) expect(isBuOturumun(is('ben', 'DekontKaydetV2'), { uid: 'ben', rol: r }), r).toBe(true);
  });
  it('başkasının işi: HAYIR — Yönetici dâhil', () => {
    for (const r of APP_ROLES) expect(isBuOturumun(is('ik', 'DekontKaydetV2'), { uid: 'ben', rol: r }), r).toBe(false);
  });
  it('damgasız eski iş: yalnız Yönetici', () => {
    expect(isBuOturumun(eskiIs('DekontKaydetV2'), { uid: 'ben', rol: 'Admin' })).toBe(true);
    for (const r of YONETICI_DISI) expect(isBuOturumun(eskiIs('DekontKaydetV2'), { uid: 'ben', rol: r }), r).toBe(false);
    expect(isBuOturumun(eskiIs('DekontKaydetV2'), { uid: 'ben', rol: null })).toBe(false);
    expect(isBuOturumun(eskiIs('DekontKaydetV2', { sahipUid: '' }), { uid: 'ben', rol: 'Manager' })).toBe(false);
  });
  it('kimliği bilinmeyen oturum hiçbir işin sahibi değildir', () => {
    for (const uid of [null, undefined, '']) {
      expect(isBuOturumun(is('ben', 'DekontKaydetV2'), { uid, rol: 'Admin' }), String(uid)).toBe(false);
      expect(isBuOturumun(eskiIs('DekontKaydetV2'), { uid, rol: 'Admin' }), String(uid)).toBe(false);
    }
  });
});

// K10-11 — geçiş artıkları.
describe('G1 — yayından ÖNCE ekilmiş sahip alanı işi kimsenin oturumuna çalıştırtamaz', () => {
  /** Eski sunucu istemcinin gönderdiği `sahipUid`'i olduğu gibi bırakıyordu: K10 öncesi kimlik biçimi (soneksiz) + ekilmiş sahip. */
  const ekilmis = eskiIs('DekontKaydetV2', { sahipUid: 'muhasebe' });
  it('alanın gösterdiği kullanıcı (Yönetici dışı her rol) o işi KENDİ işi saymaz: kimlik onun sonekini taşımıyor', () => {
    for (const r of YONETICI_DISI) expect(isBuOturumun(ekilmis, { uid: 'muhasebe', rol: r }), r).toBe(false);
    expect(isiGonderebilir(ekilmis, { uid: 'muhasebe', rol: 'Accounting' })).toBe(false);
  });
  it('başka bir Yönetici de çalıştırmaz (damgalı, başkasının) — kapatabilir', () => {
    expect(isBuOturumun(ekilmis, { uid: 'yonetici', rol: 'Admin' })).toBe(false);
    expect(kapatilabilir({ ...ekilmis, createdAt: SIMDI - 25 * SAAT }, { uid: 'yonetici', rol: 'Admin' }, SIMDI)).toBe(true);
  });
  it('Yönetici\'de sonek aranmaz: dokunduğu damgasız eski iş soneksiz kimlikle onun olur ve sonraki turda yine onundur', () => {
    const devralinmis = eskiIs('DekontKaydetV2', { sahipUid: 'yonetici' });
    expect(isBuOturumun(devralinmis, { uid: 'yonetici', rol: 'Admin' })).toBe(true);
    expect(isiGonderebilir(devralinmis, { uid: 'yonetici', rol: 'Admin' })).toBe(true);
  });
  it('bekçi böyle işi «sahibi gönderemeyen» sayar (sonsuza dek bekleyeceği için)', () => {
    expect(bekleyenIsSinifi(ekilmis, 'Accounting')).toBe('sahibiGonderemez');
  });
});

describe('G2 — kimlik kapma: belge saldırganın doğar, kimsenin oturumunda çalışmaz', () => {
  /** Saldırgan kurbanın kimlik biçimiyle iş açtı; sunucu SALDIRGANI sahip damgaladı. */
  const kapilan: KuyrukIsi = { ...is('kurban', 'DekontKaydetV2'), sahipUid: 'saldirgan' };
  it('kurbanın oturumu çalıştırmaz (süzgeç kimliğe değil SAHİBE bakar) — rolü yöntemin kapısından geçse de', () => {
    expect(evrakKapisindanGecer('Accounting', 'DekontKaydetV2')).toBe(true);
    expect(isiGonderebilir(kapilan, { uid: 'kurban', rol: 'Accounting' })).toBe(false);
    expect(isiGonderebilir(kapilan, { uid: 'kurban', rol: 'Admin' })).toBe(false);
  });
  it('saldırganın oturumu da çalıştırmaz: kimlik onun sonekini taşımıyor', () => {
    for (const r of YONETICI_DISI) expect(isBuOturumun(kapilan, { uid: 'saldirgan', rol: r }), r).toBe(false);
  });
});

describe('rolGonderebilir / isiGonderebilir — sahibi olmak yetmez, rol yöntemin kapısından da geçmeli', () => {
  it('Mikro işinde karar `evrak/kaydet` kapısıyla BİREBİR aynı (26 yöntem × her rol + rolsüz)', () => {
    const yontemler = [...MIKRO_EVRAK_KAPILARI.keys()];
    expect(yontemler.length).toBeGreaterThanOrEqual(20);
    for (const y of yontemler) for (const r of [...APP_ROLES, null]) {
      expect(rolGonderebilir(is('ben', y), r), `${y} / ${r}`).toBe(evrakKapisindanGecer(r, y));
    }
  });
  it('elle: dekontu Muhasebe gönderir, İK göndermez; etiket basımını her iç rol gönderir, dış rol göndermez', () => {
    expect(rolGonderebilir(is('ben', 'DekontKaydetV2'), 'Accounting')).toBe(true);
    expect(rolGonderebilir(is('ben', 'DekontKaydetV2'), 'HR')).toBe(false);
    expect(rolGonderebilir(is('ben', 'DekontKaydetV2'), 'Sales')).toBe(false);
    for (const r of STAFF_ROLES) expect(rolGonderebilir(is('ben', 'EtiketBasimKaydetV2'), r), r).toBe(true);
    for (const r of EXTERNAL_ROLES) expect(rolGonderebilir(is('ben', 'EtiketBasimKaydetV2'), r), r).toBe(false);
  });
  it('yöntemi okunamayan / tabloda olmayan Mikro işi: kapı sunucudaki gibi «iç personel» sayar — iç rol gönderir (işleyici 400 döner, iş denemeyle ölür), dış rol ve rolsüz göndermez', () => {
    for (const govde of [undefined, null, 'DekontKaydetV2', {}, { method: 7 }, { method: 'OlmayanYontem' }, { method: 'constructor' }]) {
      const j = is('ben', 'x', { payload: govde });
      expect(MIKRO_EVRAK_KAPILARI.has(isYontemi(j)), JSON.stringify(govde)).toBe(false);
      for (const r of STAFF_ROLES) expect(rolGonderebilir(j, r), `${JSON.stringify(govde)} / ${r}`).toBe(true);
      for (const r of [...EXTERNAL_ROLES, null]) expect(rolGonderebilir(j, r), `${JSON.stringify(govde)} / ${r}`).toBe(false);
      for (const r of [...APP_ROLES, null]) expect(rolGonderebilir(j, r), `${JSON.stringify(govde)} / ${r}`).toBe(evrakKapisindanGecer(r, isYontemi(j)));
    }
    expect(isYontemi({ payload: { method: 7 } })).toBe('');
    expect(isYontemi({ payload: 'DekontKaydetV2' })).toBe('');
    expect(isYontemi({ payload: { method: 'DekontKaydetV2' } })).toBe('DekontKaydetV2');
  });
  it('Mikro dışı işte yöntem kapısı yok', () => {
    expect(rolGonderebilir({ type: 'luca', payload: { method: 'DekontKaydetV2' } }, 'HR')).toBe(true);
  });
  it('isiGonderebilir = yürütebilir VE kendi işi VE rol geçer', () => {
    expect(isiGonderebilir(is('ben', 'DekontKaydetV2'), { uid: 'ben', rol: 'Accounting' })).toBe(true);
    expect(isiGonderebilir(is('ben', 'DekontKaydetV2'), { uid: 'ben', rol: 'HR' })).toBe(false);            // rolü düşürülmüş sahip
    expect(isiGonderebilir(is('ik', 'DekontKaydetV2'), { uid: 'ben', rol: 'Accounting' })).toBe(false);      // başkasının işi
    expect(isiGonderebilir(is('ik', 'DekontKaydetV2'), { uid: 'ben', rol: 'Admin' })).toBe(false);           // Yönetici de almaz
    expect(isiGonderebilir(eskiIs('DekontKaydetV2'), { uid: 'ben', rol: 'Admin' })).toBe(true);              // damgasız eski iş
    expect(isiGonderebilir(eskiIs('DekontKaydetV2'), { uid: 'ben', rol: 'Manager' })).toBe(false);
    expect(isiGonderebilir(is('ben', 'EtiketBasimKaydetV2'), { uid: 'ben', rol: 'B2B' })).toBe(false);       // dış rol kuyruğu yürütemez
    expect(isiGonderebilir(is('ben', 'EtiketBasimKaydetV2'), { uid: 'ben', rol: null })).toBe(false);
    expect(isiGonderebilir({ ...is('ben', 'x'), type: 'luca' }, { uid: 'ben', rol: 'B2B' })).toBe(false);    // Mikro dışı işte de
  });
});

describe('isTakili — bekçinin eşiğiyle aynı süre', () => {
  it('eşik 24 saat; eşikten eski iş takılıdır, eşiğin içindeki değildir', () => {
    expect(TAKILI_IS_ESIGI_MS).toBe(24 * SAAT);
    expect(isTakili({ createdAt: SIMDI - 25 * SAAT }, SIMDI)).toBe(true);
    expect(isTakili({ createdAt: SIMDI - 24 * SAAT - 1 }, SIMDI)).toBe(true);
    expect(isTakili({ createdAt: SIMDI - 24 * SAAT }, SIMDI)).toBe(false);
    expect(isTakili({ createdAt: SIMDI }, SIMDI)).toBe(false);
  });
  it('yaşı okunamayan iş «taze» sayılmaz: sayı değil / sonsuz / saat farkıyla açıklanamayacak kadar ileride', () => {
    for (const t of [undefined, null, '2026-10-01', Number.NaN, Number.POSITIVE_INFINITY, SIMDI + 25 * SAAT]) {
      expect(isTakili({ createdAt: t }, SIMDI), String(t)).toBe(true);
    }
    expect(isTakili({ createdAt: SIMDI + 5 * 60 * 1000 }, SIMDI)).toBe(false);   // saati 5 dk ileri bir istemci
  });
});

describe('kapatilabilir — Yönetici çıkışı: çalıştırmadan kapatır, DEVRALMAZ', () => {
  const yonetici = { uid: 'yonetici', rol: 'Admin' as AppRole };
  const eski = { createdAt: SIMDI - 25 * SAAT };
  it('kuyrukta kapatabilen TEK oturum: kimliği bilinen Yönetici', () => {
    expect(APP_ROLES.filter(r => kuyruktaKapatabilir({ uid: 'u', rol: r }))).toEqual(['Admin']);
    expect(kuyruktaKapatabilir({ uid: 'u', rol: null })).toBe(false);
    expect(kuyruktaKapatabilir({ uid: null, rol: 'Admin' })).toBe(false);
    expect(kuyruktaKapatabilir({ uid: '', rol: 'Admin' })).toBe(false);
  });
  it('başkasının takılı işi: Yönetici kapatabilir; taze olanı kapatamaz (sahibi birazdan gönderebilir)', () => {
    expect(kapatilabilir(is('ik', 'DekontKaydetV2', eski), yonetici, SIMDI)).toBe(true);
    expect(kapatilabilir(is('ik', 'DekontKaydetV2'), yonetici, SIMDI)).toBe(false);
  });
  it('Yönetici dışındaki HİÇBİR rol kapatamaz — Müdür dâhil, kendi takılı işini de', () => {
    for (const r of YONETICI_DISI) {
      expect(kapatilabilir(is('ik', 'DekontKaydetV2', eski), { uid: 'ben', rol: r }, SIMDI), r).toBe(false);
      expect(kapatilabilir(is('ben', 'DekontKaydetV2', eski), { uid: 'ben', rol: r }, SIMDI), r).toBe(false);
    }
    expect(kapatilabilir(is('ik', 'DekontKaydetV2', eski), { uid: 'ben', rol: null }, SIMDI)).toBe(false);
    expect(kapatilabilir(is('ik', 'DekontKaydetV2', eski), { uid: null, rol: 'Admin' }, SIMDI)).toBe(false);
  });
  it('Yönetici\'nin KENDİ gönderebileceği iş kapatılmaz (kendi işi; damgasız eski iş) — o iş «Şimdi Dene» ile gider', () => {
    expect(kapatilabilir(is('yonetici', 'DekontKaydetV2', eski), yonetici, SIMDI)).toBe(false);
    expect(kapatilabilir(eskiIs('DekontKaydetV2', eski), yonetici, SIMDI)).toBe(false);
  });
  it('yöntemi tabloda olmayan kendi işi de kapatılmaz: Yönetici onu gönderir, sunucu 400 döner, iş denemeyle ölür (takılı kalmaz)', () => {
    expect(kapatilabilir(eskiIs('OlmayanYontem', eski), yonetici, SIMDI)).toBe(false);
    expect(kapatilabilir(is('yonetici', 'OlmayanYontem', eski), yonetici, SIMDI)).toBe(false);
  });
  it('kimliği sahibini taşımayan iş (G1 — ekilmiş sahip / eski sekmenin işi) takılıysa kapatılabilir: sahibi dâhil kimse çalıştırmaz', () => {
    expect(kapatilabilir(eskiIs('DekontKaydetV2', { ...eski, sahipUid: 'muhasebe' }), yonetici, SIMDI)).toBe(true);
  });
});

describe('kuyrukOzeti — kartın sayıları oturuma göre', () => {
  const bekleyen = [
    is('yonetici', 'DekontKaydetV2'),                                  // Yönetici'nin kendi işi
    eskiIs('DekontKaydetV2'),                                          // damgasız eski iş
    is('ik', 'DekontKaydetV2', { createdAt: SIMDI - 30 * SAAT }),      // İK'nın takılı işi (rolü gönderemez)
    is('muhasebe', 'DekontKaydetV2'),                                  // Muhasebe'nin taze işi
    eskiIs('EtiketBasimKaydetV2', { createdAt: SIMDI - 30 * SAAT, sahipUid: 'satis' }),   // kimliği sahibini taşımayan iş (G1)
  ];
  it('Yönetici (sunucu bütün kuyruğu listeler): kendi + damgasız = gönderilebilir; başkasınınkiler ayrı; takılılar kapatılabilir', () => {
    expect(kuyrukOzeti(bekleyen, { uid: 'yonetici', rol: 'Admin' }, SIMDI)).toEqual({ gonderilebilir: 2, rolYetmiyor: 0, baskasinin: 3, kapatilabilir: 2 });
  });
  it('Muhasebe (sunucu yalnız kendi işini listeler): gönderilebilir 1; kapatılabilir HER ZAMAN 0', () => {
    expect(kuyrukOzeti([is('muhasebe', 'DekontKaydetV2')], { uid: 'muhasebe', rol: 'Accounting' }, SIMDI))
      .toEqual({ gonderilebilir: 1, rolYetmiyor: 0, baskasinin: 0, kapatilabilir: 0 });
  });
  it('sunucu süzgeci düşse de (bütün kuyruk gelse de) Yönetici dışındaki rol başkasının işini «gönderilebilir» SAYMAZ ve kapatamaz', () => {
    expect(kuyrukOzeti(bekleyen, { uid: 'muhasebe', rol: 'Accounting' }, SIMDI)).toEqual({ gonderilebilir: 1, rolYetmiyor: 0, baskasinin: 4, kapatilabilir: 0 });
  });
  it('rolü düşürülmüş sahip: kendi işi «rolünüzle gönderilemiyor»', () => {
    expect(kuyrukOzeti([is('ik', 'DekontKaydetV2')], { uid: 'ik', rol: 'HR' }, SIMDI)).toEqual({ gonderilebilir: 0, rolYetmiyor: 1, baskasinin: 0, kapatilabilir: 0 });
  });
  it('kimliği sahibini taşımayan kendi işi (G1): Yönetici dışındaki sahibine «başkasının» gibi görünür — gönderilmez', () => {
    expect(kuyrukOzeti([eskiIs('EtiketBasimKaydetV2', { sahipUid: 'satis' })], { uid: 'satis', rol: 'Sales' }, SIMDI))
      .toEqual({ gonderilebilir: 0, rolYetmiyor: 0, baskasinin: 1, kapatilabilir: 0 });
  });
  it('kuyruğu yürütemeyen oturum (dış rol / kimliksiz): hiçbir iş gönderilebilir değildir', () => {
    expect(kuyrukOzeti(bekleyen, { uid: 'bayi', rol: 'Dealer' }, SIMDI).gonderilebilir).toBe(0);
    expect(kuyrukOzeti(bekleyen, { uid: null, rol: 'Admin' }, SIMDI).gonderilebilir).toBe(0);
  });
  it('sayılar ayrıktır: ilk üçünün toplamı bekleyen iş sayısıdır (her rolde)', () => {
    for (const r of [...APP_ROLES, null]) {
      const o = kuyrukOzeti(bekleyen, { uid: 'yonetici', rol: r }, SIMDI);
      expect(o.gonderilebilir + o.rolYetmiyor + o.baskasinin, String(r)).toBe(bekleyen.length);
      expect(o.kapatilabilir, String(r)).toBeLessThanOrEqual(o.rolYetmiyor + o.baskasinin);
      if (!sahipSuzgecindenMuaf(r)) expect(o.kapatilabilir, String(r)).toBe(0);
    }
  });
});

describe('bekleyenIsSinifi — bekçinin sınıfı: sahibinin BUGÜNKÜ rolüyle', () => {
  it('damgasız eski iş → sahipsiz (rol sorulmaz)', () => {
    expect(bekleyenIsSinifi(eskiIs('DekontKaydetV2'), null)).toBe('sahipsiz');
    expect(bekleyenIsSinifi(eskiIs('DekontKaydetV2', { sahipUid: '' }), 'Admin')).toBe('sahipsiz');
  });
  it('sahibinin rolü yöntemin kapısından geçiyor → sahibi gönderir', () => {
    expect(bekleyenIsSinifi(is('muhasebe', 'DekontKaydetV2'), 'Accounting')).toBe('sahibiGonderir');
    expect(bekleyenIsSinifi(is('satis', 'ZiyaretKaydetV2'), 'Sales')).toBe('sahibiGonderir');
  });
  it('sahibinin rolü geçmiyor / hesabı ya da rolü yok / dış role düşürülmüş → sahibi gönderemez', () => {
    expect(bekleyenIsSinifi(is('ik', 'DekontKaydetV2'), 'HR')).toBe('sahibiGonderemez');           // açığın biçimi: İK dekont işi yazdı
    expect(bekleyenIsSinifi(is('ayrilan', 'ZiyaretKaydetV2'), null)).toBe('sahibiGonderemez');     // kullanıcı kaydı yok
    expect(bekleyenIsSinifi(is('ayrilan', 'ZiyaretKaydetV2'), undefined)).toBe('sahibiGonderemez');
    expect(bekleyenIsSinifi(is('bayi', 'EtiketBasimKaydetV2'), 'Dealer')).toBe('sahibiGonderemez');
  });
});
