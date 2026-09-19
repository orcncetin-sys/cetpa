/**
 * raporKdvMizan.test.ts — Mikro'dan OKUYAN rapor eşlemeleri (Faz 3 3/n, grup "raporKdvMizan").
 * ÖNCE YAZILDI (kırmızı görüldü), sonra raporKdvMizan.ts.
 *
 * Kilitlenen sözleşme iki yönlü:
 *  (1) PARİTE — BİLİNEN girdide çıkan kırılım/satır bugünkü rotayla BİREBİR aynı
 *      (alan adları, sıra, değerler). Bu testler bozulursa canlı veri şekli değişmiş demektir.
 *  (2) BİLİNMEYEN 0 YAZILMAZ — Mikro okuması bozulduğunda (kolon adı değişti, şema keşfi
 *      boş döndü, SUM() tamamı NULL olduğu için NULL döndü) eski kod `?? 0` / `|| 0` ile
 *      ₺0 KDV, ₺0 matrah, ₺0 borç yazıyordu. Bu rakamlar KDV beyanına ve mizana giriyor:
 *      "okunamadı" ile "gerçekten sıfır" AYNI ŞEY DEĞİLDİR.
 */
import { describe, it, expect } from 'vitest';
import {
  kdvKirilimi, mizanSatiri, mizanSatirlari, mizanToplami, ARIZA_ESIGI,
} from './raporKdvMizan';

// ── Fikstürler (Türkçe; gerçek Mikro sorgu takma adları) ─────────────────────
// KDV sorgusu: SELECT sth_vergi_pntr AS oranPntr, sth_tip AS tip, SUM(sth_vergi) AS kdv, SUM(sth_tutar) AS matrah
// pntr → oran tablosu Mikro VergiListesiV2'den gelir (işaretçi YÜZDE DEĞİLDİR).
const VERGI = new Map<number, number>([[0, 0], [2, 1], [3, 10], [4, 20]]);
const KDV_SECENEK = { vergiTablosu: VERGI, oranKolonuVar: true };

/** ÇİMENTO 50KG satışı — %20, matrah 10.000 ₺, KDV 2.000 ₺ */
const SATIS_20 = { oranPntr: 4, tip: 1, kdv: 2000, matrah: 10000 };
/** İnşaat demiri satışı — %10 */
const SATIS_10 = { oranPntr: 3, tip: 1, kdv: 450, matrah: 4500 };
/** Şirin İnşaat'tan alış — %20 */
const ALIS_20 = { oranPntr: 4, tip: 0, kdv: 800, matrah: 4000 };

describe('kdvKirilimi — parite', () => {
  it('bilinen satırlar: kırılım ve toplamlar bugünkü rotayla BİREBİR aynı', () => {
    const r = kdvKirilimi([SATIS_20, SATIS_10, ALIS_20], KDV_SECENEK);
    expect(r.kirilim).toEqual([
      { yon: 'satis', oran: 20, kdv: 2000, matrah: 10000 },
      { yon: 'satis', oran: 10, kdv: 450, matrah: 4500 },
      { yon: 'alis', oran: 20, kdv: 800, matrah: 4000 },
    ]);
    expect(r.kdvHesaplanan).toBe(2450);
    expect(r.kdvIndirilecek).toBe(800);
    expect(r.kdvOdenmesi).toBe(1650);
    expect(r.devredenKdv).toBe(0);
    expect(r.matrahSatis).toBe(14500);     // yalnız satış satırları
    expect(r.ozet.not).toBe('');
    expect(r.ozet.okumaArizasi).toEqual([]);
    expect(r.atlananSatir).toBe(0);
  });

  it('devreden KDV: indirilecek > hesaplanan → ödenecek 0, devreden fark (Math.max parite)', () => {
    const r = kdvKirilimi([{ oranPntr: 4, tip: 0, kdv: 5000, matrah: 25000 }], KDV_SECENEK);
    expect(r.kdvOdenmesi).toBe(0);
    expect(r.devredenKdv).toBe(5000);
  });

  it('tip metin gelirse de çıkış = satış (Number("1") === 1 paritesi)', () => {
    const r = kdvKirilimi([{ oranPntr: 4, tip: '1', kdv: 100, matrah: 500 }], KDV_SECENEK);
    expect(r.kirilim[0].yon).toBe('satis');
    expect(r.kdvHesaplanan).toBe(100);
  });

  it('oran kolonu sorguya HİÇ girmediyse oran null — bu arıza DEĞİL, sayılmaz', () => {
    const r = kdvKirilimi([{ tip: 1, kdv: 100, matrah: 500 }], { vergiTablosu: VERGI, oranKolonuVar: false });
    expect(r.kirilim).toEqual([{ yon: 'satis', oran: null, kdv: 100, matrah: 500 }]);
    expect(r.ozet.sayac.oran ?? 0).toBe(0);
    expect(r.ozet.not).toBe('');
  });

  it('boş satır listesi: sıfır toplam, uyarı yok (dönemde hareket yok — rota zaten 502 verir)', () => {
    const r = kdvKirilimi([], KDV_SECENEK);
    expect(r.kirilim).toEqual([]);
    expect(r.kdvHesaplanan).toBe(0);
    expect(r.ozet.okumaArizasi).toEqual([]);
  });
});

describe('kdvKirilimi — bilinmeyen 0 YAZILMAZ', () => {
  it('KDV toplamı NULL ise satır kırılıma ₺0 olarak GİRMEZ, sayılır', () => {
    // `Number(r.kdv ?? 0)` bu satırı 2.000 ₺lik gerçek satırlarla aynı listeye
    // ₺0 KDV'li bir oran kovası olarak yazıyordu; `Number.isFinite` kapısı da
    // 0 sonlu olduğu için devreye girmiyordu (kapı FİİLEN ÖLÜYDÜ).
    const r = kdvKirilimi([SATIS_20, { oranPntr: 3, tip: 1, kdv: null, matrah: 4500 }], KDV_SECENEK);
    expect(r.kirilim).toEqual([{ yon: 'satis', oran: 20, kdv: 2000, matrah: 10000 }]);
    expect(r.kdvHesaplanan).toBe(2000);
    expect(r.atlananSatir).toBe(1);
    expect(r.ozet.sayac.kdv).toBe(1);
    expect(r.ozet.not).toBe('1 satırın kdv alanı bilinmiyor');
  });

  it('KDV boş metin ("") ise de atlanır — Number("") === 0 tuzağı', () => {
    const r = kdvKirilimi([SATIS_20, { oranPntr: 3, tip: 1, kdv: '', matrah: 4500 }], KDV_SECENEK);
    expect(r.kdvHesaplanan).toBe(2000);
    expect(r.ozet.sayac.kdv).toBe(1);
  });

  it('KDV çöp metin ise atlanır (bugünkü `continue` paritesi)', () => {
    const r = kdvKirilimi([{ oranPntr: 4, tip: 1, kdv: 'abc', matrah: 500 }], KDV_SECENEK);
    expect(r.kirilim).toEqual([]);
    expect(r.kdvHesaplanan).toBe(0);
  });

  it('yön (sth_tip) okunamazsa satır ALIŞ sayılmaz — atlanır ve sayılır', () => {
    // En pahalı sessiz varsayım: `Number(r.tip) === 1` NaN'da false verip
    // yönü bilinmeyen her satırı İNDİRİLECEK KDV'ye yazıyordu → ödenecek KDV eksik.
    const r = kdvKirilimi([SATIS_20, { oranPntr: 4, tip: null, kdv: 999, matrah: 5000 }], KDV_SECENEK);
    expect(r.kdvIndirilecek).toBe(0);
    expect(r.kdvHesaplanan).toBe(2000);
    expect(r.kirilim).toHaveLength(1);
    expect(r.ozet.sayac.yon).toBe(1);
    expect(r.ozet.not).toContain('1 satırın yon alanı bilinmiyor');
  });

  it('matrah NULL ise ₺0 değil null yazılır ve matrah toplamına girmez', () => {
    const r = kdvKirilimi([SATIS_20, { oranPntr: 3, tip: 1, kdv: 450, matrah: null }], KDV_SECENEK);
    expect(r.kirilim).toEqual([
      { yon: 'satis', oran: 20, kdv: 2000, matrah: 10000 },
      { yon: 'satis', oran: 10, kdv: 450, matrah: null },
    ]);
    expect(r.matrahSatis).toBe(10000);            // kısmi toplam (ekran sözleşmesi)
    expect(r.ozet.sayac.matrah).toBe(1);
    expect(r.ozet.not).toContain('1 satırın matrah alanı bilinmiyor');
  });

  it('matrah kolonu sorguda yoksa (undefined) null — bugünkü davranış korunur, sayılır', () => {
    const r = kdvKirilimi([{ oranPntr: 4, tip: 1, kdv: 100 }], KDV_SECENEK);
    expect(r.kirilim[0].matrah).toBeNull();
    expect(r.ozet.sayac.matrah).toBe(1);
  });

  it('hiçbir satırın matrahı okunamazsa matrah toplamı NaN (ekranda "—") — ₺0 DEĞİL', () => {
    const r = kdvKirilimi(
      [{ oranPntr: 4, tip: 1, kdv: 100, matrah: null }, { oranPntr: 3, tip: 1, kdv: 50, matrah: null }],
      KDV_SECENEK,
    );
    expect(r.matrahSatis).toBeNaN();
    expect(r.kdvHesaplanan).toBe(150);            // KDV okunuyor, ona dokunulmaz
  });

  it('oran işaretçisi çözülemezse oran null ve sayılır (vergi tablosu boş döndü)', () => {
    const r = kdvKirilimi([{ oranPntr: 9, tip: 1, kdv: 100, matrah: 500 }], KDV_SECENEK);
    expect(r.kirilim[0].oran).toBeNull();
    expect(r.ozet.sayac.oran).toBe(1);
  });
});

describe('kdvKirilimi — okuma arızası (alan TÜM satırlarda okunamıyor)', () => {
  const bes = Array.from({ length: ARIZA_ESIGI }, (_, i) => ({ oranPntr: 99, tip: 1, kdv: 100 + i, matrah: 500 }));

  it(`${ARIZA_ESIGI} satırın tamamında oran çözülemezse UYARI notun BAŞINA yazılır`, () => {
    const r = kdvKirilimi(bes, { vergiTablosu: new Map(), oranKolonuVar: true });
    expect(r.ozet.okumaArizasi).toEqual(['oran']);
    expect(r.ozet.not).toBe('UYARI: oran alanı hiçbir satırda okunamadı — kolon adı/şema kontrol edin');
  });

  it('eşiğin altında (4 satır) arıza İDDİA EDİLMEZ — yalnız sayaç', () => {
    const r = kdvKirilimi(bes.slice(0, ARIZA_ESIGI - 1), { vergiTablosu: new Map(), oranKolonuVar: true });
    expect(r.ozet.okumaArizasi).toEqual([]);
    expect(r.ozet.not).toBe(`${ARIZA_ESIGI - 1} satırın oran alanı bilinmiyor`);
  });
});

// ── Mizan ────────────────────────────────────────────────────────────────────
// SELECT hesap_kodu AS hesapKodu, SUM(CASE WHEN meblag>0 ...) AS borc, SUM(...) AS alacak
const KASA = { hesapKodu: '100.01', borc: 15000, alacak: 5000 };
const BANKA = { hesapKodu: '102.01', borc: 5000, alacak: 15000 };

describe('mizanSatiri — parite', () => {
  it('bilinen satır: bugünkü rotayla BİREBİR aynı', () => {
    expect(mizanSatiri(KASA)).toEqual({ hesapKodu: '100.01', borc: 15000, alacak: 5000, bakiye: 10000 });
  });

  it('alacak > borç: bakiye EKSİ kalır (Math.abs YOK)', () => {
    expect(mizanSatiri(BANKA)!.bakiye).toBe(-10000);
  });

  it('sayısal hesap kodu metne çevrilir (String(...) paritesi)', () => {
    expect(mizanSatiri({ hesapKodu: 320, borc: 0, alacak: 100 })!.hesapKodu).toBe('320');
  });

  it('hesap kodu yoksa satır YOK (rota bugün de filtreliyor)', () => {
    expect(mizanSatiri({ borc: 100, alacak: 0 })).toBeNull();
    expect(mizanSatiri({ hesapKodu: '   ', borc: 100, alacak: 0 })).toBeNull();
  });

  it('gerçek ₺0 borç/alacak yazılır — sıfır bir cevaptır, sayaca girmez', () => {
    const s = mizanSatiri({ hesapKodu: '600.01', borc: 0, alacak: 42000 });
    expect(s).toEqual({ hesapKodu: '600.01', borc: 0, alacak: 42000, bakiye: -42000 });
    expect(mizanSatirlari([{ hesapKodu: '600.01', borc: 0, alacak: 42000 }]).ozet.not).toBe('');
  });
});

describe('mizanSatiri — bilinmeyen 0 YAZILMAZ', () => {
  it('borç okunamazsa 0 değil null; bakiye de null (NaN yazılmaz)', () => {
    expect(mizanSatiri({ hesapKodu: '120.01', borc: null, alacak: 5000 }))
      .toEqual({ hesapKodu: '120.01', borc: null, alacak: 5000, bakiye: null });
  });

  it('alacak çöp metinse null — eski kod bakiyeye NaN yazıyordu', () => {
    expect(mizanSatiri({ hesapKodu: '320.01', borc: 1000, alacak: 'abc' }))
      .toEqual({ hesapKodu: '320.01', borc: 1000, alacak: null, bakiye: null });
  });

  it('boş metin ("") geçerli sıfır SAYILMAZ — Number("") === 0 tuzağı', () => {
    expect(mizanSatiri({ hesapKodu: '153.01', borc: '', alacak: 100 })!.borc).toBeNull();
  });

  it('sayısal metin bakiye hesabına girer (SQL sürücüsü decimal’i string döndürebilir)', () => {
    expect(mizanSatiri({ hesapKodu: '191.01', borc: '1500.50', alacak: '500.50' })!.bakiye).toBe(1000);
  });
});

describe('mizanSatirlari — sayaç ve okuma arızası', () => {
  it('bilinen satırlar: not boş', () => {
    const r = mizanSatirlari([KASA, BANKA]);
    expect(r.satirlar).toHaveLength(2);
    expect(r.ozet.not).toBe('');
  });

  it('kodsuz satır düşer ve sayılır', () => {
    const r = mizanSatirlari([KASA, { borc: 1, alacak: 1 }]);
    expect(r.satirlar).toHaveLength(1);
    expect(r.ozet.sayac.hesapKodu).toBe(1);
    expect(r.ozet.not).toBe('1 satırın hesapKodu alanı bilinmiyor');
  });

  it(`${ARIZA_ESIGI} satırın tamamında borç okunamazsa OKUMA ARIZASI ilan edilir`, () => {
    const rows = Array.from({ length: ARIZA_ESIGI }, (_, i) => ({ hesapKodu: `600.0${i}`, borc: null, alacak: 100 }));
    const r = mizanSatirlari(rows);
    expect(r.ozet.okumaArizasi).toEqual(['borc']);
    expect(r.ozet.not).toBe('UYARI: borc alanı hiçbir satırda okunamadı — kolon adı/şema kontrol edin');
  });
});

describe('mizanToplami — denge denetimi', () => {
  it('dengeli mizan: hata yok, toplamlar birebir', () => {
    const { satirlar } = mizanSatirlari([KASA, BANKA]);
    const t = mizanToplami(satirlar);
    expect(t).toEqual({ borc: 20000, alacak: 20000, fark: 0, dengeli: true, bilinmeyenSatir: 0, hata: null });
  });

  it('kuruş farkı tolere edilir (eşik Math.max(1, toplam*0,0001) paritesi)', () => {
    const { satirlar } = mizanSatirlari([{ hesapKodu: '100', borc: 1_000_000, alacak: 0 }, { hesapKodu: '600', borc: 0, alacak: 999_999.5 }]);
    expect(mizanToplami(satirlar).dengeli).toBe(true);
  });

  it('dengesiz mizan: bugünkü 502 mesajı birebir korunur', () => {
    const { satirlar } = mizanSatirlari([{ hesapKodu: '100', borc: 15000, alacak: 0 }, { hesapKodu: '600', borc: 0, alacak: 5000 }]);
    const t = mizanToplami(satirlar);
    expect(t.dengeli).toBe(false);
    expect(t.hata).toBe(
      'Mizan dengesiz: borç 15000.00 ≠ alacak 5000.00 (fark 10000.00). ' +
      'Borç/alacak işaret kuralı bu kurulumda farklı olabilir — hiçbir şey yazılmadı.',
    );
  });

  it('bir satırın tutarı bile okunamıyorsa DENGE DOĞRULANAMAZ — yazma durur', () => {
    // Eski kod okunamayan tutarı 0 sayıyordu: mizan "dengeli" görünüp EKSİK yazılıyordu.
    const { satirlar } = mizanSatirlari([KASA, BANKA, { hesapKodu: '320.01', borc: null, alacak: null }]);
    const t = mizanToplami(satirlar);
    expect(t.bilinmeyenSatir).toBe(1);
    expect(t.dengeli).toBe(false);
    expect(t.hata).toBe(
      'Mizan okunamadı: 1 hesabın borç/alacak tutarı Mikro’dan alınamadı — ' +
      'denge doğrulanamaz, hiçbir şey yazılmadı. Kolon adı/şema kontrol edin.',
    );
  });

  it('boş liste: sıfır toplam, hata yok (rota "hiç satır yok" kapısını kendi verir)', () => {
    expect(mizanToplami([])).toEqual({ borc: 0, alacak: 0, fark: 0, dengeli: true, bilinmeyenSatir: 0, hata: null });
  });
});
