/**
 * govdeMuhasebe.ts — Mikro'ya YAZILAN muhasebe gövdeleri, TEK KAYNAK
 * (Faz 3 3/n, grup govdeMuhasebe, 2026-09-19). Test: govdeMuhasebe.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR: üç rota (`/api/mikro/yevmiye/kaydet`, `/tahsilat/kaydet`, `/cari-hareket/kaydet`)
 * gövdeyi handler'ın içinde kuruyordu ve her biri BİLİNMEYEN bir alanı sessizce bir
 * varsayılanla dolduruyordu. Dış sisteme yazan gövdede varsayılan, karşı tarafın
 * DEFTERİNE sahte kayıt düşürür (CLAUDE.md; 2026-09-05'te yedi üretici her kaydı
 * "depo 1 = HAVALİMANI" yazmıştı). Ölçülen siteler (mikroRoutes.ts, 2026-09-19):
 *
 *   yevmiye  ~2899  `Number(e.borc ?? e.alacak ?? 0) || 0`  → borç kutusu boş bırakılan
 *                    fiş Mikro'ya ₺0 olarak yazılıyordu (YevmiyeTab `Number('') === 0`).
 *   yevmiye  ~2900  `... .split(/\s|-/)[0] || '100'`        → hesap kodu boşsa kayıt
 *                    100 KASA'ya düşüyordu; mizanda hayalet kasa hareketi.
 *   yevmiye  ~2898  `toTrDate(String(e.date ?? ''))`        → tarihsiz fiş
 *                    "undefined.undefined." tarihiyle gidiyordu.
 *   tahsilat ~2954  `toTrDate(... ?? bugün)`                → geçmiş tarihli tahsilat
 *                    BUGÜNE yazılıp yanlış döneme (KDV/mutabakat) düşüyordu.
 *   tahsilat ~2955  `tip === 'tediye' ? 'tediye' : 'tahsilat'` → 'TEDIYE'/'odeme'/boş
 *                    gelen HER değer kasaya GİRİŞ sayılıyordu: para çıkışı giriş görünür.
 *   tahsilat ~2971  `cha_meblag: Number(t.tutar)`           → 'abc' → NaN → JSON'da null.
 *   cari-hrk ~2822  `satirlar: [hareket]`                   → hiçbir doğrulama yok;
 *                    cari kodsuz/tutarsız/yönsüz dekont Mikro'ya olduğu gibi gidiyordu.
 *
 * SÖZLEŞME: değer bilinmiyorsa `throw new MikroGovdeHatasi(alan, satirNo?)`. Rota bunu
 * yakalar, **400 `{ success:false, error }`** döner ve `mikroPost` HİÇ çağrılmaz — yarım
 * kayıt yerine hiç kayıt. İstemci (MikroPushButton / mikroEvrak.ts / mikroService.ts)
 * mesajı kullanıcıya zaten gösteriyor, bu yüzden mesaj Türkçe ve alan adlı.
 *
 * PARİTE: bilinen girdide üretilen gövde eski kodla BİREBİR aynıdır. `cha_cinsi: 19`,
 * `cha_evrak_tip: 34`, `cha_kasa_hizmet: 4`, `KSTAH`/`KSTED`, `fis_*` taban alanları
 * V17 örneğinden gelen SABİT Mikro kodlarıdır; "sadeleştirme" adına dokunulmaz.
 *
 * Saf modül: ağ, DB, express YOK. Mikro'ya gönderme ve loglama rotada kalır.
 */
import { bilinenSayi } from '../../utils/para.js';
import { MikroGovdeHatasi } from './govdeHatasi.js';

// ── Ortak kapılar ────────────────────────────────────────────────────────────

/** Gerçek takvim günü mü? (2026-02-30 gibi "biçimi doğru ama günü yok" tarihleri eler.) */
function gecerliGun(yil: number, ay: number, gun: number): boolean {
  if (ay < 1 || ay > 12 || gun < 1 || gun > 31) return false;
  const d = new Date(Date.UTC(yil, ay - 1, gun));
  return d.getUTCFullYear() === yil && d.getUTCMonth() === ay - 1 && d.getUTCDate() === gun;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TR_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/**
 * ISO (YYYY-MM-DD) → Mikro'nun beklediği DD.MM.YYYY. Bilinmiyorsa/geçersizse throw.
 * Eski `toTrDate` yalnız `split('-')` yapıyordu: boş girdide "undefined.undefined.",
 * TR biçiminde girdide "undefined.undefined.19.09.2026" üretip Mikro'ya yolluyordu.
 */
export function trTarihGerekli(v: unknown, alan: string, satirNo?: number): string {
  const s = String(v ?? '').trim();
  const m = ISO_RE.exec(s);
  if (!m || !gecerliGun(Number(m[1]), Number(m[2]), Number(m[3]))) {
    throw new MikroGovdeHatasi(alan, satirNo, s ? `geçersiz tarih: ${s} (YYYY-MM-DD bekleniyor)` : undefined);
  }
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * ISO ya da ZATEN DD.MM.YYYY olan tarihi DD.MM.YYYY'ye normalize eder.
 * Cari hareket satırları istemcideki `dekontPayload` (src/services/mikroEvrak.ts)
 * tarafından TR biçiminde kurulup gönderiliyor; ikisini de kabul etmek zorundayız.
 */
export function trTarihEsnekGerekli(v: unknown, alan: string, satirNo?: number): string {
  const s = String(v ?? '').trim();
  const tr = TR_RE.exec(s);
  if (tr && gecerliGun(Number(tr[3]), Number(tr[2]), Number(tr[1]))) return s;
  return trTarihGerekli(s, alan, satirNo);
}

/** Bilinen, sonlu ve POZİTİF tutar; değilse throw (0 ve negatif de bilinmeyen sayılır). */
function pozitifTutarGerekli(v: unknown, alan: string, satirNo?: number): number {
  if (!bilinenSayi(v)) throw new MikroGovdeHatasi(alan, satirNo);
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new MikroGovdeHatasi(alan, satirNo, `tutar ${n} — Mikro'ya sıfır/negatif meblağ yazılmaz`);
  }
  return n;
}

/** Boş olmayan metin; değilse throw. (Kod/kodlama alanları için — açıklama alanlarında DEĞİL.) */
function metinGerekli(v: unknown, alan: string, satirNo?: number): string {
  const s = String(v ?? '').trim();
  if (!s) throw new MikroGovdeHatasi(alan, satirNo);
  return s;
}

/**
 * Hesap kodunun baş parçası: "120 - Alıcılar" → "120", "320-01 Satıcılar" → "320".
 * Ayrıştırma eskisiyle AYNI; tek fark boş sonucun `|| '100'` ile KASA'ya düşmemesi.
 */
function hesapKoduGerekli(v: unknown, alan: string, satirNo?: number): string {
  const kod = (String(v ?? '').trim().split(/\s|-/)[0] ?? '').trim();
  if (!kod) throw new MikroGovdeHatasi(alan, satirNo);
  return kod;
}

// ── 1. Yevmiye fişi (MuhasebeFisKaydetV2) ────────────────────────────────────

/** Mikro muhasebe fişi satırı — alan adları V17 `MuhasebeFisKaydetV2` örneğinden. */
export type MuhasebeFisSatiri = {
  fis_firmano: number; fis_subeno: number; fis_tarih: string; fis_tur: number;
  fis_sorumluluk_kodu: string; fis_ticari_tip: number; fis_kurfarkifl: number;
  fis_ticari_evraktip: number; fis_tic_belgeno: string; fis_tic_belgetarihi: string;
  fis_katagori: number; fis_fmahsup_tipi: number; user_tablo: unknown[];
  fis_hesap_kod: string; fis_aciklama1: string; fis_meblag0: number;
};

export type YevmiyeGovde = {
  /** `mikroPost('MuhasebeFisKaydetV2', payload, true)` — inMikro: alanlar Mikro objesi İÇİNDE. */
  payload: { evraklar: Array<{ evrak_aciklamalari: Array<{ aciklama: string }>; satirlar: MuhasebeFisSatiri[] }> };
  /** Aynı iki satır — `mirrorMikroInsert('mikro_muhasebe_fisleri', satirlar, FIS_COLS)` için. */
  satirlar: MuhasebeFisSatiri[];
};

/**
 * Yevmiye kaydından çift taraflı (borç +meblag / alacak −meblag) Mikro fişi.
 *
 * MEBLAĞ SEÇİMİ: kayıt dengelidir (App.tsx ve YevmiyeTab borç = alacak yazar), meblağ
 * ikisinin ortak büyüklüğüdür. 0 "girilmedi" demektir — form boş kutuyu `Number('')`
 * ile 0 yapar — o yüzden yalnız POZİTİF olan taraf okunur; ikisi de pozitif ama FARKLI
 * ise meblağ belirsizdir (dengesiz fiş), sessizce borç seçilmez.
 *
 * @param satirNo toplu aktarımda kaçıncı fiş (hata mesajında "3. kalemin ...").
 */
export function yevmiyeGovdesi(e: Record<string, unknown>, satirNo?: number): YevmiyeGovde {
  const borc = bilinenSayi(e.borc) ? Number(e.borc) : NaN;
  const alacak = bilinenSayi(e.alacak) ? Number(e.alacak) : NaN;
  const borcVar = Number.isFinite(borc) && borc > 0;
  const alacakVar = Number.isFinite(alacak) && alacak > 0;
  if (borcVar && alacakVar && Math.abs(borc - alacak) > 0.005) {
    throw new MikroGovdeHatasi('fiş tutarı', satirNo, `borç ${borc} ile alacak ${alacak} eşit değil — dengesiz fiş`);
  }
  const meblag = borcVar ? borc : alacakVar ? alacak : pozitifTutarGerekli(undefined, 'fiş tutarı', satirNo);

  const tarih = trTarihGerekli(e.date, 'fiş tarihi', satirNo);
  const borcHesap = hesapKoduGerekli(e.debitHesap, 'borç hesap kodu', satirNo);
  const alacakHesap = hesapKoduGerekli(e.alacakHesap, 'alacak hesap kodu', satirNo);
  // Açıklama ve belge no METİN alanları: boş olmaları sahte bir SAYI üretmez, Mikro
  // bunları boş kabul eder — eski davranış (boş string) korunuyor. `fiş` anahtarı
  // JournalEntry tipinden gelir (Türkçe alan adı), `fisNo` eski içe aktarımların yedeği.
  const aciklama = String(e.aciklama ?? '');
  const belgeNo = String(e['fiş'] ?? e.fisNo ?? '');

  const taban = {
    fis_firmano: 0, fis_subeno: 0,
    fis_tarih: tarih,
    fis_tur: 0,
    fis_sorumluluk_kodu: '', fis_ticari_tip: 0, fis_kurfarkifl: 0,
    fis_ticari_evraktip: 0, fis_tic_belgeno: belgeNo,
    fis_tic_belgetarihi: tarih,
    fis_katagori: 0, fis_fmahsup_tipi: 0, user_tablo: [] as unknown[],
  };
  const satirlar: MuhasebeFisSatiri[] = [
    { ...taban, fis_hesap_kod: borcHesap, fis_aciklama1: aciklama, fis_meblag0: meblag },
    { ...taban, fis_hesap_kod: alacakHesap, fis_aciklama1: aciklama, fis_meblag0: -meblag },
  ];
  return {
    payload: { evraklar: [{ evrak_aciklamalari: [{ aciklama }], satirlar }] },
    satirlar,
  };
}

// ── 2. Kasa tahsilat / tediye (TahsilatTediyeKaydetV2) ───────────────────────

/**
 * Kasa hareketi satırı. **Alan eşlemesi V17 örneğinden — DENEYSEL: ilk gerçek kayıtla
 * doğrulanmalı.** (Rotadan taşınan canlı-doğrulama notu, 2026-07 · Açık İş.)
 */
export type TahsilatSatiri = {
  cha_tarihi: string; cha_tip: number; cha_cinsi: number; cha_normal_Iade: number;
  cha_evrak_tip: number; cha_evrakno_seri: string; cha_cari_cins: number; cha_kod: string;
  cha_d_cins: number; cha_d_kur: number; cha_d_kurtar: null;
  cha_srmrkkodu: string; cha_projekodu: string; cha_kasa_hizmet: number;
  cha_meblag: number; cha_aciklama: string;
};

export type TahsilatGovde = {
  /** `mikroPost('TahsilatTediyeKaydetV2', payload, true)`. */
  payload: { evraklar: Array<{ evrak_aciklamalari: Array<{ aciklama: string }>; satirlar: TahsilatSatiri[] }> };
  /** `mirrorMikroInsert('mikro_cari_hesap_hareketleri', [{ ...satir, __kaynak }], CHA_COLS)` için. */
  satir: TahsilatSatiri;
  /** syncLog entityId'si — doğrulanmış, `?? 'unknown'` gerekmez. */
  cariKod: string;
};

/** Gövde SABİT TRY kurar (`cha_d_cins: 0`, `cha_d_kur: 1`). Bu anahtarlardan biri TRY dışını söylüyorsa yaz-ma. */
const DOVIZ_ANAHTARLARI = ['paraBirimi', 'dovizCinsi', 'currency'] as const;

/**
 * Kasa tahsilat/tediye gövdesi.
 *
 * YÖN: `tip` YALNIZ 'tahsilat' | 'tediye'. Eskiden 'tediye' dışındaki her değer
 * (undefined, 'TEDIYE', 'odeme', yazım hatası) tahsilat sayılıyordu — kasadan çıkan
 * para kasaya giriş olarak defterlenirdi. Yön tahmin edilemez, throw eder.
 *
 * TARİH: bugün VARSAYILMAZ. Geçmiş tarihli bir tahsilat bugüne yazılınca kasa
 * mutabakatı ve KDV dönemi sessizce kayar; çağıran (TahsilatModule ödeme formu)
 * tarihi zaten gönderiyor.
 */
export function tahsilatGovdesi(t: Record<string, unknown>, satirNo?: number): TahsilatGovde {
  const cariKod = metinGerekli(t.cariKod, 'cari kodu', satirNo);
  const tutar = pozitifTutarGerekli(t.tutar, 'tahsilat tutarı', satirNo);
  const tarih = trTarihGerekli(t.tarih, 'tahsilat tarihi', satirNo);

  const tip = String(t.tip ?? '').trim();
  if (tip !== 'tahsilat' && tip !== 'tediye') {
    throw new MikroGovdeHatasi('tahsilat/tediye yönü', satirNo,
      tip ? `tanınmayan yön: ${tip} ('tahsilat' veya 'tediye' bekleniyor)` : undefined);
  }

  for (const anahtar of DOVIZ_ANAHTARLARI) {
    const birim = String(t[anahtar] ?? '').trim().toUpperCase();
    if (birim && birim !== 'TRY' && birim !== 'TL') {
      throw new MikroGovdeHatasi('döviz cinsi', satirNo, `${birim} — bu gövde yalnız TRY yazar (cha_d_kur: 1)`);
    }
  }

  const satir: TahsilatSatiri = {
    cha_tarihi: tarih,
    cha_tip: tip === 'tahsilat' ? 1 : 0,
    cha_cinsi: 19,
    cha_normal_Iade: 0,
    cha_evrak_tip: 34,
    cha_evrakno_seri: tip === 'tahsilat' ? 'KSTAH' : 'KSTED',
    cha_cari_cins: 0,
    cha_kod: cariKod,
    cha_d_cins: 0, cha_d_kur: 1, cha_d_kurtar: null,
    cha_srmrkkodu: '', cha_projekodu: '',
    cha_kasa_hizmet: 4,
    cha_meblag: tutar,
    cha_aciklama: String(t.aciklama ?? ''),
  };
  return {
    payload: { evraklar: [{ evrak_aciklamalari: [{ aciklama: satir.cha_aciklama }], satirlar: [satir] }] },
    satir,
    cariKod,
  };
}

// ── 3. Cari hareket / dekont (DekontKaydetV2) ────────────────────────────────

export type CariHareketGovde = {
  /** `mikroPost('DekontKaydetV2', payload, true)`. */
  payload: { evraklar: Array<{ satirlar: Record<string, unknown>[]; evrak_aciklamalari?: Array<{ aciklama: string }> }> };
  /** `mirrorMikroInsert('mikro_cari_hesap_hareketleri', [{ ...satir, __kaynak }], CHA_COLS)` için. */
  satir: Record<string, unknown>;
  /** syncLog entityId'si — doğrulanmış, `?? 'unknown'` gerekmez. */
  cariKod: string;
};

/** Denetlenen ZORUNLU BEŞLİ dışındaki `cha_*` alanları olduğu gibi geçer (beyaz liste DEĞİL). */
export type ZorunluBesli = 'cha_kod' | 'cha_meblag' | 'cha_tarihi' | 'cha_tip' | 'cha_evrak_tip';

/**
 * Cari hareket (dekont) gövdesi.
 *
 * 2026-07-30 (rotadan taşınan not): `CariHareketKaydetV2` çağrılıyordu, o metot V17'de
 * YOK. V17 karşılığı `DekontKaydetV2` — AYNI `cha_*` alanlarını alır, yalnız zarf
 * farklı: alanlar Mikro objesi İÇİNDE `evraklar[].satirlar[]` altına girer
 * (mikroPost'un inMikro=true kalıbı). Çağıranın gönderdiği `hareket` nesnesi olduğu
 * gibi tek satır olarak sarmalanır — alan eşlemesi değişmedi.
 *
 * DENETİM: gövde bir beyaz liste değildir (Mikro'nun onlarca `cha_*` alanı var ve
 * çağıran hangi alanı gerekiyorsa gönderir); ama defterin KİM / NE KADAR / NE ZAMAN /
 * HANGİ YÖN / HANGİ EVRAK beşlisi tahmin edilemez. Beşi de zorunlu, gerisi geçer.
 * `cha_tip` bir BAYRAKTIR (0 = borç, 1 = alacak): `Number(x ?? 0)` burada bile meşru
 * değil, çünkü eksik yön bakiyeyi ters çevirir — tam olarak 0 ya da 1 olmalı ve
 * `0` falsy diye reddedilmemeli.
 */
export function cariHareketGovdesi(
  hareket: Record<string, unknown>,
  aciklama?: unknown,
  satirNo?: number,
): CariHareketGovde {
  const cariKod = metinGerekli(hareket.cha_kod, 'cari kodu', satirNo);
  const meblag = pozitifTutarGerekli(hareket.cha_meblag, 'hareket tutarı', satirNo);
  const tarih = trTarihEsnekGerekli(hareket.cha_tarihi, 'hareket tarihi', satirNo);

  const tip = hareket.cha_tip;
  if (typeof tip !== 'number' || (tip !== 0 && tip !== 1)) {
    throw new MikroGovdeHatasi('borç/alacak yönü', satirNo, 'cha_tip 0 (borç) ya da 1 (alacak) olmalı');
  }
  const evrakTip = hareket.cha_evrak_tip;
  if (!bilinenSayi(evrakTip) || !Number.isFinite(Number(evrakTip)) || Number(evrakTip) <= 0) {
    throw new MikroGovdeHatasi('evrak tipi', satirNo, 'cha_evrak_tip verilmeli (ör. dekont 29) — tahmin edilmez');
  }

  const satir: Record<string, unknown> = {
    ...hareket,
    cha_kod: cariKod,
    cha_meblag: meblag,
    cha_tarihi: tarih,
    cha_tip: tip,
    cha_evrak_tip: Number(evrakTip),
  };
  const aciklamaMetni = String(aciklama ?? '').trim();
  return {
    payload: {
      evraklar: [{
        satirlar: [satir],
        ...(aciklamaMetni ? { evrak_aciklamalari: [{ aciklama: aciklamaMetni }] } : {}),
      }],
    },
    satir,
    cariKod,
  };
}
