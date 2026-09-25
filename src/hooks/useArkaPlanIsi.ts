/**
 * useArkaPlanIsi.ts — Mikro arka plan işinin (`jobs/<isAdi>`) TEK okuma yeri + başlatma yanıtı
 * yorumlayıcısı + "Tümünü Çek" sıralayıcısı (mikro-import-arkaplan istemci şartnamesi §0/§B1, 2026-09-24).
 *
 * NEDEN: 14 import ucu (stok, cari, 12 SQL) + stok-miktar = 15 arka plan ucu işi HTTP isteğinin İÇİNDE
 * bitirmiyor — IIS/ARR ~120 sn'de kesip 502 döndüğü için (teşhis, CONFIRMED) yanıt anında `{ started, job }` gelir,
 * ilerleme/sonuç `jobs/<job>` dokümanında sürer. `MikroSyncPanel` eskiden yalnız `jobs/stokMiktarImport`ı
 * kendi içinde okuyordu; o desen buraya genelleştirildi. Panel `'jobs'` okumaz, kart `useArkaPlanIsi` çağırır.
 *
 * KARARLAR:
 *  • İş adı sözlüğü TEK: `src/lib/mikroIsAdi.ts` (sunucu da aynısını çağırır). Bu dosya adı ÜRETMEZ.
 *  • Yanıt yorumu TEK tablo (`baslatmaYanitiniYorumla`, §0 ÖNCELİK, ilk eşleşen kazanır): kart ve
 *    `isiBaslatVeBekle` aynı fonksiyonu çağırır; tablo ikinci kez yazılmaz (KOPYA YASAK).
 *  • Kilit GLOBAL tek iş (K-C): `alreadyRunning` + `job !== isAdi` = "başka bir iş çalışıyor" — HATA DEĞİL,
 *    bilgi; sıralayıcı bu durumda BEKLEMEZ (o doküman koşmuyor, 30 dk asılı kalırdı) hemen reddeder.
 *  • Bitiş sinyali: `running === false` VE `finishedAt` referanstan FARKLI. Referans = aboneliğin İLK anlık
 *    görüntüsünün `finishedAt`'ı (yalnız o; yanıt beklenirken gelen görüntüler referansı DEĞİŞTİRMEZ). Sunucu
 *    başlangıçta `finishedAt:null` yazar; eski koşunun T0'ı yeniden gelse de "bitti" sanılmaz.
 *    Yanıt gelmeden görülen görüntüler saklanır; yanıt 'bekle' olduğu anda SON görüntü de değerlendirilir —
 *    küçük tabloda iş, IIS/ARR'de gecikmiş HTTP yanıtından ÖNCE bitebilir (hakem bulgusu 2026-09-25: eskiden
 *    referans her görüntüde yeniden yazılıyor, bitiş hiç tanınmıyor, adım 30 dk sonra "hatalı" sayılıyordu).
 *    Kalan sınır: AYNI işin hemen önceki koşusunun bitiş olayı SSE gecikmesiyle abonelikten SONRA gelirse o
 *    bitiş bizimki sanılabilir — Tümünü Çek adımları farklı iş adları olduğundan sırada oluşmaz.
 *  • Sahte kesinlik yasağı: sayısal `?? 0` YOK; sayaçlar olduğu gibi geçer, kart `Number.isFinite` ile basar.
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from '../lib/dbClient';
import { db } from '../firebase';
import { zamanMs } from '../utils/zaman';
import type { MikroIsBaslatmaYaniti } from '../services/mikroService';

/** `jobs/<isAdi>` dokümanı — sunucunun yazdığı alanlar (src/server/mikro/arkaPlanIsi.ts + rota `jobAlanlari`).
 *  Hepsi isteğe bağlı (`running` hariç): bilinmeyen sayaç YAZILMAZ, istemci '—' basar. */
export interface ArkaPlanIsi {
  running: boolean;
  /** Son koşunun sunucu hatası (bitişte); yeni koşu başlangıçta null'lar. */
  error?: string | null;
  /** Sunucunun eşleme notu — `UYARI:` ile başlıyorsa amber. */
  note?: string | null;
  processed?: number;
  /** Koşarken SQL işlerinde BİLİNMİYOR (yazılmaz) → belirsiz çubuk; bitişte `s.total`. */
  total?: number;
  /** cari: sayfa başına; SQL: `sayfa` + `satir` (= processed). */
  sayfa?: number;
  satir?: number;
  /** stok: CHUNK offset'i. */
  offset?: number;
  /** K-A: son Mikro sayfasının süresi (ms) — MIKRO_LISTE_ZAMAN_ASIMI_MS ayarı bunu okur (mikroClient listeZamanAsimiMs); eski koşularda yok. */
  sonSayfaMs?: number;
  /** Timestamp | ham zarf | null — `zamanMs` okur. Başarı VE hata dalında damgalanır (bitiş sinyali). */
  finishedAt?: unknown;
  startedAt?: unknown;
  durationMs?: number;
  created?: number;
  updated?: number;
  errors?: number;
  /** Stok import'u: Mikro'dan en az bir satış fiyatı gelen ürün sayısı. 0 ise sorun Cetpa'da değil —
   *  Mikro stok kartlarında fiyat tanımlı değildir (fiyatlar "Satış Fiyatları" kartından gelir). */
  fiyatliUrun?: number;
  /** stok+cari (sunucu SayfaSayaclari) — eski `skippedRecords` adı YOK. */
  bozukKayit?: number;
  zamanAsimiSayfa?: number;
  /** >0 → import EKSİK (sunucu `error` de doldurur, success:false). */
  zamanAsimiKayit?: number;
  /** SQL: MAKS_SAYFA tavanına çarpıldı — veri eksik. */
  truncated?: boolean;
  guidsizSatir?: number | null;
  tablo?: string;
  /** İş-özel alanlar (stok-miktar: failed, depoUyusmazlik, depoDagilimliUrun, depoDevirli, uyusmazlikOrnek…)
   *  — kart `ekOzet` ile okur, `Number.isFinite`/`Array.isArray` ile daraltır. */
  [ek: string]: unknown;
}

/** `jobs/<isAdi>` canlı okuma. `is === null` = hiç koşmadı / doküman yok; `okumaHatasi` = okuyamadım —
 *  ikisi AYRI gösterilir (hata geri çağrısı BOŞ DEĞİL; eski panel `() => {}` ile yutuyordu). */
export function useArkaPlanIsi(isAdi: string | null): { is: ArkaPlanIsi | null; okumaHatasi: string | null } {
  const [is, setIs] = useState<ArkaPlanIsi | null>(null);
  const [okumaHatasi, setOkumaHatasi] = useState<string | null>(null);
  useEffect(() => {
    setIs(null);
    setOkumaHatasi(null);
    // `null` = abone OLMA (kart: 'başka iş' notu yokken ikinci abonelik açılmaz).
    if (isAdi === null) return;
    const unsub = onSnapshot(
      doc(db, 'jobs', isAdi),
      snap => { setOkumaHatasi(null); setIs(snap.exists() ? (snap.data() as ArkaPlanIsi) : null); },
      err => setOkumaHatasi(err instanceof Error ? err.message : String(err)),
    );
    return () => unsub();
  }, [isAdi]);
  return { is, okumaHatasi };
}

export interface BaslatmaYorumu {
  /** hata → kırmızı kutu / reject; bilgi → gri not / reject (beklemez); bekle → ilerlemeye abone / bitişi bekle. */
  tur: 'hata' | 'bilgi' | 'bekle';
  metin: string | null;
}

/**
 * §0 ÖNCELİK tablosu — TEK yorumlayıcı; İLK eşleşen kazanır. Kart (`ArkaPlanIsiKarti`) ve
 * `isiBaslatVeBekle` bunu çağırır, tabloyu yeniden yazmaz.
 *  0 notConfigured                    → hata 'Mikro yapılandırılmamış.'
 *  1 !success                         → hata error
 *  2 started && job !== isAdi         → hata 'İş adı uyuşmadı' (sözleşme ihlali; başka dokümana ABONE OLUNMAZ)
 *  3 alreadyRunning && job === isAdi  → bekle 'Zaten çalışıyor — ilerleme aşağıda.'
 *  4 alreadyRunning && job !== isAdi  → bilgi (başka bir iş koşuyor: <job>; K-C — normal durum, hata değil)
 *  5 started && job === isAdi         → bekle (metin yok; ilerleme kancadan gelir)
 *  6 hiçbiri                          → hata 'Beklenmeyen başlatma yanıtı'
 */
export function baslatmaYanitiniYorumla(y: MikroIsBaslatmaYaniti, isAdi: string, tr: boolean): BaslatmaYorumu {
  if (y.notConfigured) return { tur: 'hata', metin: tr ? 'Mikro yapılandırılmamış.' : 'Mikro not configured.' };
  if (!y.success) return { tur: 'hata', metin: y.error || (tr ? 'Bilinmeyen hata' : 'Unknown error') };
  if (y.started && y.job !== isAdi) {
    const job = y.job ?? (tr ? '(yok)' : '(none)');
    return { tur: 'hata', metin: `${tr ? 'İş adı uyuşmadı' : 'Job name mismatch'}: ${job} ≠ ${isAdi}` };
  }
  if (y.alreadyRunning && y.job === isAdi) return { tur: 'bekle', metin: tr ? 'Zaten çalışıyor — ilerleme aşağıda.' : 'Already running — progress below.' };
  if (y.alreadyRunning) {
    const ad = y.job ? `: ${y.job}` : '';
    return { tur: 'bilgi', metin: tr ? `Başka bir iş çalışıyor${ad} — bitince deneyin.` : `Another job is running${ad} — try again when it finishes.` };
  }
  if (y.started) return { tur: 'bekle', metin: null };
  return { tur: 'hata', metin: tr ? 'Beklenmeyen başlatma yanıtı' : 'Unexpected start response' };
}

/** "Tümünü Çek" adımı başına bekleme tavanı — politika, ölçülmüş süre DEĞİL (gerçek import süreleri
 *  ÖLÇÜLMEDİ; miktar işi "3-6 dk", stok 2384 ürün × 4 PG turu). Aşılırsa adım hata sayılır ve Tümünü Çek
 *  sırası DURUR (iş hâlâ sürüyor, kilidi tutuyor; sonraki adım Mikro'yu paralel yüklemesin). */
export const TUMUNU_CEK_ADIM_ZAMAN_ASIMI_MS = 30 * 60_000;

/** `isiBaslatVeBekle` bekleme tavanı doldu — iş sunucuda HÂLÂ sürüyor olabilir (kilit tutuluyor). Ayrı sınıf:
 *  Tümünü Çek bunu görünce sırayı durdurur (inceleme bulgusu 2026-09-25), diğer hatalarda sürer. */
export class IsZamanAsimiHatasi extends Error {
  constructor(metin: string) { super(metin); this.name = 'IsZamanAsimiHatasi'; }
}

/** Sunucu 'başka bir iş çalışıyor' dedi (global kilit BAŞKA işte). Ayrı sınıf (delta hakem 2026-09-25, orta):
 *  zaman aşımıyla aynı durum — kilidi tutan bir iş koşuyor; Tümünü Çek sırası durur, yoksa senkron adımlar
 *  (bakiye/mizan/kdv/personel/reçete/adres) o işle EŞZAMANLI Mikro'ya giderdi. Sunucu bitiş dokümanını
 *  yazıp kilidi araya G/Ç koymadan bırakır (arkaPlanIsi finally) — sıranın KENDİ önceki işi için bu yanıt gelmez. */
export class BaskaIsKosuyorHatasi extends Error {
  constructor(metin: string, readonly job: string | null) { super(metin); this.name = 'BaskaIsKosuyorHatasi'; }
}

/**
 * İşi başlatır ve `jobs/<isAdi>` bitişini bekler ("Tümünü Çek" sıralaması). Adımlar SIRAYLA koşmalı:
 * Mikro tek servis, eşzamanlı yükte çöküyor; arka plan uçları anında döndüğü için beklemeyen döngü 15 işi
 * üst üste bindirir ve global kilit yüzünden 2.'den itibaren hepsi `alreadyRunning` alırdı.
 *  (1) tek seferlik abone ol → İLK görüntünün `finishedAt`'ı referans (sonrakiler referansı değiştirmez);
 *  (2) `baslat()` → `baslatmaYanitiniYorumla`: hata/bilgi → reject (bilgi = başka iş koşuyor, BEKLENMEZ);
 *  (3) bekle → önce yanıttan ÖNCE görülen son görüntü, sonra gelenler: `running === false && finishedAt !==
 *      referans` olan ilk görüntüde çöz; `error` doluysa reject;
 *  (4) `zamanAsimiMs` dolarsa `IsZamanAsimiHatasi` ile reject.
 * `tr` zorunlu (panelin `t`'si) — mesaj dili için varsayılan YOK.
 */
export function isiBaslatVeBekle(
  isAdi: string,
  baslat: () => Promise<MikroIsBaslatmaYaniti>,
  { zamanAsimiMs = TUMUNU_CEK_ADIM_ZAMAN_ASIMI_MS, tr }: { zamanAsimiMs?: number; tr: boolean },
): Promise<ArkaPlanIsi> {
  return new Promise<ArkaPlanIsi>((resolve, reject) => {
    let kapandi = false;
    /** İlk görüntü geldi → referans alındı (bir kez; sonraki görüntüler referansı DEĞİŞTİRMEZ). */
    let referansAlindi = false;
    /** baslat() yanıtı 'bekle' oldu → artık bitiş aranıyor. */
    let basladi = false;
    /** Referans bitiş damgası: bundan FARKLI bir finishedAt = yeni bitiş. */
    let oncekiBitis: number | null = null;
    /** Yanıt beklenirken görülen SON görüntü (referanstan sonraki); `undefined` = yok. Yanıt 'bekle'
     *  olunca değerlendirilir — iş HTTP yanıtından önce bitmiş olabilir. */
    let yanitOncesiSon: ArkaPlanIsi | null | undefined;
    let zamanlayici: ReturnType<typeof setTimeout> | undefined;
    let birak: () => void = () => {};
    const kapat = () => {
      kapandi = true;
      birak();
      if (zamanlayici !== undefined) clearTimeout(zamanlayici);
    };
    const coz = (is: ArkaPlanIsi) => { if (kapandi) return; kapat(); resolve(is); };
    const reddet = (e: unknown) => { if (kapandi) return; kapat(); reject(e instanceof Error ? e : new Error(String(e))); };
    /** Bitiş mi? `running === false` VE `finishedAt` referanstan farklı → çöz (error doluysa reddet). */
    const degerlendir = (is: ArkaPlanIsi | null) => {
      if (!is || is.running !== false || zamanMs(is.finishedAt) === oncekiBitis) return;
      if (is.error) reddet(new Error(is.error));
      else coz(is);
    };

    birak = onSnapshot(
      doc(db, 'jobs', isAdi),
      snap => {
        if (kapandi) return;
        const is = snap.exists() ? (snap.data() as ArkaPlanIsi) : null;
        // İLK görüntü referanstır, bitiş değil (yanıt sonrası gelse bile): eski koşunun T0'ını taşır.
        if (!referansAlindi) { referansAlindi = true; oncekiBitis = zamanMs(is?.finishedAt); return; }
        // Yanıt gelmeden karar verilmez (hata/bilgi yanıtı da gelebilir); görüntü saklanır, referans DEĞİŞMEZ.
        if (!basladi) { yanitOncesiSon = is; return; }
        degerlendir(is);
      },
      err => reddet(err),
    );

    baslat().then(y => {
      if (kapandi) return;
      const yorum = baslatmaYanitiniYorumla(y, isAdi, tr);
      // hata VE bilgi reject: 'bilgi' = başka bir iş koşuyor, jobs/<isAdi> KOŞMUYOR → beklemek 30 dk asılı
      // kalmak olurdu. 'bilgi' ayrı sınıfla: Tümünü Çek sırayı durdurur (BaskaIsKosuyorHatasi).
      if (yorum.tur === 'bilgi') { reddet(new BaskaIsKosuyorHatasi(yorum.metin ?? yorum.tur, y.job ?? null)); return; }
      if (yorum.tur !== 'bekle') { reddet(new Error(yorum.metin ?? yorum.tur)); return; }
      basladi = true;
      // İş yanıttan ÖNCE bitmiş olabilir (gecikmiş yanıt): o arada görülen son görüntü şimdi değerlendirilir.
      if (yanitOncesiSon !== undefined) degerlendir(yanitOncesiSon);
      if (kapandi) return;   // çözüldü/reddedildi → zamanlayıcı KURULMAZ
      const dk = Math.round(zamanAsimiMs / 60_000);
      zamanlayici = setTimeout(
        () => reddet(new IsZamanAsimiHatasi(tr ? `İş ${dk} dk içinde bitmedi` : `Job did not finish within ${dk} min`)),
        zamanAsimiMs,
      );
    }, reddet);
  });
}
