/**
 * adaptifSayfalama.ts — Mikro liste sayfalarını DARALTARAK toplama (mikro-import-arkaplan, 2026-09-24).
 *
 * Gövde `mikroRoutes.ts` import/stok'tan (eski `collectRange`, 709-727) çıkarıldı; cari import'u da
 * artık bunu kullanır (eskiden `!ok → break`: sayfalama SESSİZCE bitiyor, kısmi import "tamamlandı"
 * görünüyordu). Taşınan yorum AYNEN:
 *
 *   Mikro bazı sayfa aralıklarında düz metin "Api Server Error" döner (kayıt bazlı serileştirme
 *   hatası, sunucu tarafında). Bozuk aralık 100 → 20 → 5 → 1 şeklinde daraltılır; yalnızca gerçekten
 *   bozuk tekil kayıtlar atlanır. Index = offset / size (Mikro Index sayfa numarasıdır).
 *
 * YENİ: ZAMAN AŞIMI AYRI SAYILIR. `getir` `TimeoutError` fırlatırsa (mikroClient `zamanAsimiMs` →
 * `AbortSignal.timeout`, Node 24'te DOMException name=TimeoutError) aralık yine daraltılır ama tek
 * kayıtlık zaman aşımı `bozukKayit`'e KARIŞMAZ: bozuk kayıt Mikro tarafında kalıcıdır (tekrar denemek
 * boşuna), zaman aşımı geçicidir (yeniden çalıştırınca gelir) — özet metni ikisini ayrı söyler ve
 * çağıran zaman aşımı kaybını `success:false` sayar. Zaman aşımı OLMAYAN throw (ECONNREFUSED vb.)
 * yeniden fırlatılır: daraltma ölü ağı iyileştirmez, 100 "bozuk" sayardı.
 *
 * DEVRE KESİCİ (hakem 2026-09-25, kritik): daraltma TEK bir ağır kaydı yalıtmak içindir; Mikro
 * bağlantıyı kabul edip HİÇ yanıt vermiyorsa (2026-08-24 kesintisi: "TLS el sıkışıyor, TTFB gelmiyor")
 * her çağrı listeZamanAsimiMs()'te düşer, tek kayıtlık zaman aşımı `end:false` döndüğü için rota
 * döngüsü offset 50.000'e kadar sürerdi — ÖLÇÜLDÜ (hakem, sahte getir): stok CHUNK başına 126 çağrı
 * × 120 sn ≈ 4,2 saat, toplam ≈ 2.100 saat; süreç-geneli kilit o süre dolu, iptal yolu yok. HEAD'de
 * global 30 sn TimeoutError catch'e düşüp işi 30 sn'de bitiriyordu (regresyondu). Kural: ARDIŞIK
 * zaman aşımı (arada tek YANIT yok — boş liste/null da yanıttır) zincir derinliğini AŞARSA
 * `MikroYanitVermiyorHatasi` fırlar, iş `error` ile biter, kilit açılır. Neden derinlik: tek ağır
 * kaydı yalıtmak en kötü durumda (kayıt her alt aralığın BAŞINDAYSA) derinlik kadar ardışık zaman
 * aşımı üretir (stok 100→20→5→1 = 4, cari 500→…→1 = 5); bir fazlası = yalıtılan kayıttan sonraki
 * çağrı da yanıtsız → sorun kayıtta değil, serviste. Asılı Mikro'da iş stokta 5, caride 6 çağrıda
 * (× listeZamanAsimiMs()) biter. Durum çağrı başınadır (her CHUNK/sayfa sıfırdan başlar): kesici
 * yalnız o aralık içinde yanıtsızlığı sayar, iki CHUNK sınırına denk gelen iki ağır kayıt işi düşürmez.
 *
 * VERİSİZ ZİNCİR KESİCİSİ (delta hakem 2026-09-25, bulgu 6 kritik): zaman aşımı kesicisi `null` yanıtı
 * (IsError, HTTP 5xx, stub/kilit olayı, düz metin) "servis ayakta" sayıp sıfırlanıyordu; tek kayıtlık
 * `null` da `end:false` döndüğü için Mikro SÜREKLİ null dönerse rota döngüsü 50.000'e kadar sürüyordu —
 * ÖLÇÜLDÜ: cari 63.100 çağrı (HEAD `if (!ok) break;` → 1 çağrı), sonuç "50.000 bozuk atlandı" +
 * success:true = var olmayan kayıtları sayan sahte kesinlik; süreç-geneli kilit saatlerce dolu. Kural:
 * VERİ taşıyan yanıt (dizi — boş liste dâhil, "liste bitti" de veridir) gelmeden art arda çağrı sayısı
 * `(derinlik − 1) + yaprak grubu`nu AŞARSA `MikroVeriVermiyorHatasi`. Neden bu sınır: K bitişik bozuk
 * kayıt en kötü yerde (grup başında) `(derinlik − 1) + K` ardışık verisiz çağrı üretir; sınır bir yaprak
 * grubunun (ALT_* tablosunda tek kayda inilen boy = 5) TAMAMININ bozuk olmasını tolere eder, ötesi servis
 * sorunudur. Sürekli null'da iş stokta 9, caride 10 çağrıda biter. BİTİŞİK BOZUK KÜME VERİSİ ÖLÇÜLMEDİ —
 * 5'ten büyük gerçek bir bozuk küme bu kurala takılırsa iş "Mikro veri vermiyor" hatasıyla biter (sessiz
 * değil; HEAD stok sınırsız tolere ediyordu, cari hiç etmiyordu). Zaman aşımı da verisizdir (her iki sayaç
 * artar); zaman aşımı kesicisi daha dar (derinlik) olduğu için saf zaman aşımında o önce açılır.
 *
 * Saf: ağ yok, `getir` enjekte.
 */

/** Bir aralığın satırları; `null` = Mikro o aralığı veremedi ("Api Server Error" / IsError). */
export type Getir = (offset: number, size: number) => Promise<Record<string, unknown>[] | null>;

export interface SayfaSayaclari {
  /** Tek kayıta inildiğinde bile `null` dönen (Mikro tarafında bozuk) kayıt sayısı. */
  bozukKayit: number;
  /** Zaman aşımına uğrayan Mikro çağrısı sayısı (her boyut; daraltma alt çağrıları dâhil). */
  zamanAsimiSayfa: number;
  /** Tek kayıta inildiğinde bile zaman aşan → ATLANAN kayıt sayısı. Import EKSİK demektir. */
  zamanAsimiKayit: number;
}

/** StokListesiV2: CHUNK 100 → 20 → 5 → 1 (709 AYNEN). */
export const ALT_STOK: Record<number, number> = { 100: 20, 20: 5, 5: 1 };
/** CariListesiV2: PAGE_SIZE 500'den iner. */
export const ALT_CARI: Record<number, number> = { 500: 100, 100: 20, 20: 5, 5: 1 };

/** Node 24'te ÖLÇÜLDÜ: `AbortSignal.timeout` iptali `DOMException` name='TimeoutError', code=23. */
export function zamanAsimiMi(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'TimeoutError';
}

/** Devre kesici hatası: Mikro yanıt vermiyor. `name` KASITLI olarak 'TimeoutError' DEĞİL — `zamanAsimiMi`
 *  onu zaman aşımı sanıp dış aralıkta yeniden daraltmasın; son zaman aşımı `cause`da. Mesaj
 *  `jobs/<isAdi>.error` ve syncLog'a olduğu gibi düşer (kullanıcı metni). */
export class MikroYanitVermiyorHatasi extends Error {
  constructor(ardisikZamanAsimi: number, offset: number, cause: unknown) {
    super(`Mikro yanıt vermiyor: art arda ${ardisikZamanAsimi} çağrı zaman aşımına uğradı (kayıt #${offset}) — ` +
      'iş durduruldu; Mikro servisini kontrol edip yeniden çalıştırın.', { cause });
    this.name = 'MikroYanitVermiyorHatasi';
  }
}

/** Verisiz zincir kesicisi hatası: Mikro yanıt veriyor ama VERİ vermiyor (IsError / 5xx / stub). `name`
 *  'TimeoutError' DEĞİL (aynı gerekçe); mesaj `jobs/<isAdi>.error` ve syncLog'a olduğu gibi düşer. */
export class MikroVeriVermiyorHatasi extends Error {
  constructor(ardisikVerisiz: number, offset: number) {
    super(`Mikro veri vermiyor: art arda ${ardisikVerisiz} çağrı veri döndürmedi (kayıt #${offset}) — ` +
      'hata/boş yanıt (IsError, HTTP 5xx, kilit olayı) sürüyor; iş durduruldu, Mikro servisini kontrol edip yeniden çalıştırın.');
    this.name = 'MikroVeriVermiyorHatasi';
  }
}

/** `size`'dan tek kayda inen zincir: `derinlik` = çağrı sayısı (stok 100→20→5→1 = 4); `yaprakGrubu` = tek
 *  kayda inilen boy (alt[boy] === 1 → 5). Tanımsız/ilerlemeyen adımda durur — o boyut `topla`da zaten
 *  "daraltma adımı tanımlı değil" diye patlar. */
function zincir(size: number, alt: Record<number, number>): { derinlik: number; yaprakGrubu: number } {
  let derinlik = 1;
  let yaprakGrubu = 1;
  let s = size;
  while (s > 1) {
    const sonraki = alt[s];
    if (sonraki === undefined || sonraki >= s) break;
    if (sonraki === 1) yaprakGrubu = s;
    s = sonraki;
    derinlik++;
  }
  return { derinlik, yaprakGrubu };
}

/** Kesici iç durumu (çağrı başına; rapor sayacı `SayfaSayaclari`na karışmaz). */
interface Kesici {
  /** Art arda ZAMAN AŞIMI (herhangi bir yanıt — null dâhil — sıfırlar). */
  ardisik: number;
  sinir: number;
  /** Art arda VERİSİZ çağrı: null ya da zaman aşımı (yalnız dizi yanıtı sıfırlar). */
  ardisikVerisiz: number;
  verisizSinir: number;
}

export async function araligiTopla(
  getir: Getir,
  offset: number,
  size: number,
  alt: Record<number, number>,
  sayac: SayfaSayaclari,
): Promise<{ rows: Record<string, unknown>[]; end: boolean }> {
  // Devre kesici durumu ÇAĞRI BAŞINA (dosya başlığı): `SayfaSayaclari` rapor sayacıdır, jobs'a yazılır;
  // bu ise iç durum — oraya karışmaz.
  const { derinlik, yaprakGrubu } = zincir(size, alt);
  return topla(getir, offset, size, alt, sayac,
    { ardisik: 0, sinir: derinlik, ardisikVerisiz: 0, verisizSinir: derinlik - 1 + yaprakGrubu });
}

async function topla(
  getir: Getir,
  offset: number,
  size: number,
  alt: Record<number, number>,
  sayac: SayfaSayaclari,
  kesici: Kesici,
): Promise<{ rows: Record<string, unknown>[]; end: boolean }> {
  let direct: Record<string, unknown>[] | null;
  let zamanAsimi = false;
  try {
    direct = await getir(offset, size);
    kesici.ardisik = 0;              // YANIT geldi (boş liste / null dâhil): servis ayakta
  } catch (e) {
    if (!zamanAsimiMi(e)) throw e;   // ağ/kimlik hatası: daraltma çare değil, çağıran işi düşürsün
    sayac.zamanAsimiSayfa++;
    if (++kesici.ardisik > kesici.sinir) throw new MikroYanitVermiyorHatasi(kesici.ardisik, offset, e);
    zamanAsimi = true;
    direct = null;                   // zaman aşan aralık da daraltılır — belki tek bir ağır kayıttır
  }
  if (direct !== null) {
    kesici.ardisikVerisiz = 0;       // VERİ geldi (boş liste = "liste bitti" dâhil)
    return { rows: direct, end: direct.length < size };
  }
  // Verisiz yanıt (null ya da zaman aşımı): bitişik bozuk küme yaprak grubunu aşıyorsa sorun serviste.
  if (++kesici.ardisikVerisiz > kesici.verisizSinir) throw new MikroVeriVermiyorHatasi(kesici.ardisikVerisiz, offset);
  if (size === 1) {
    if (zamanAsimi) {
      sayac.zamanAsimiKayit++;
      console.warn(`Mikro sayfalama: kayıt #${offset} zaman aşımıyla ATLANDI (import eksik, yeniden çalıştırın)`);
    } else {
      sayac.bozukKayit++;
      console.warn(`Mikro sayfalama: kayıt #${offset} atlandı (Mikro Api Server Error)`);
    }
    return { rows: [], end: false };
  }
  const sub = alt[size];
  // Tanınmayan boyutta eski kod `o += undefined` ile NaN'a düşerdi; açıkça patla.
  if (sub === undefined) throw new Error(`araligiTopla: ${size} boyutu için daraltma adımı tanımlı değil`);
  const out: Record<string, unknown>[] = [];
  let end = false;
  for (let o = offset; o < offset + size; o += sub) {
    const r = await topla(getir, o, sub, alt, sayac, kesici);
    out.push(...r.rows);
    end = r.end; // son alt-aralığın end durumu belirleyicidir
  }
  return { rows: out, end };
}
