/**
 * seriOzet.ts — «Q serisi» işinin ADIM 0'ı: evrak SERİSİ dağılımının ÖLÇÜMÜ (2026-10-11). Kural yazmaz, hüküm vermez, hiçbir
 * yere yazmaz. Uç: `GET /api/mikro/seri-ozet[?seri=S]` (routes/mikroRoutes.ts); şartname `.wf/SARTNAME-q-serisi-v2.md` Q1-7 + Y14.
 *
 * NEDEN ÖLÇÜM: Cetpa'da faturasız satış Mikro'da evrak serisi «Q» olan bir satış faturası kaydıdır (kullanıcı sözü). Tasarımın
 * geri kalanı (seri ayarı, yazım, raporlar) şu sorular CANLI veriyle kapanmadan yazılamaz:
 *   (1) hangi seri hangi evrak tipi / cinsi / yönüyle kullanılıyor (resmî seri 'F' mi, boş mu — Q2-6);
 *   (2) istenen serideki kayıtlar e-belge kodu / ETTN taşıyor mu (kullanıcı beyanı «GİB'e gitmez» ölçülmedi);
 *   (3) serinin son başlıkları KDV'li mi, satırları hangi depodan (Açık sorular 1);
 *   (4) Cetpa `mikroFaturalar`'da aynı serili kopya var mı; (5) o seriden türemiş MF siparişleri `faturali` ne taşıyor (Q6-4).
 *
 * Bu modül SAF: SQL metnini kurar ve Mikro / PG satırlarını yanıt biçimine çevirir; ağ ve veritabanı çağrısı rotadadır.
 *
 * KOLON ADI TAHMİN EDİLMEZ (projenin en pahalı tekrarlanan hatası). İki kapı birlikte:
 *   (a) aşağıdaki her ad bu depoda başka bir yerde ZATEN geçer — kanıtı yanında `dosya:satır` (2026-10-11 ölçümü; dosya
 *       düzeyi çit `seriOzet.test.ts` içinde, yeni ad kanıtsız eklenince kırılır);
 *   (b) ad çalışma anında `mikroKolonlar(tablo)` çıktısında YOKSA sorguya GİRMEZ: `eksik` listesine kodda geçen yazımıyla
 *       yazılır; o kolona bağlı bölüm `atlandi`, bağlı alan `atlananAlanlar` ile döner (sessiz sıfır / boş dizi DEĞİL).
 * Kolon SQL'e şemadaki GERÇEK yazımıyla girer (Türkçe harmanlamada 'cha_ebelge_Islemturu' ≠ küçük harfli yazım). Değer kolonu
 * için gevşek desen yok: tam ad eşleşmesi + tek katı aile deseni (`FT_ISKONTO_DESENI`, tek kaynak lib/faturaMatrahi).
 * Üretilen her SQL yalnız `SELECT` ile başlar, tek deyimdir, yalnız ASCII içerir.
 *
 * SAYILAR: Mikro'dan gelen değer sayı değilse `null` (bilinmeyen ≠ 0). SQL toplamı NULL satırı sessizce atlar — satır özetinde
 * NULL tutar / vergi satırı ayrıca sayılır ve o toplam `null` döner.
 */
import { FT_ISKONTO_DESENI } from '../../lib/faturaMatrahi.js';
import { MF_KAYNAGI } from '../../lib/mfKaynagi.js';
import { seriAnahtari } from '../../lib/faturasizSeri.js';
import { iptalMi } from './faturaTani.js';
import { kes } from './ebelgeDurumTani.js';
import { vergiIsaretcisiCoz } from './vergiIsaretci.js';
import { faturaEvrakiMi } from '../../lib/faturaEvrakKosulu.js';
import { mikroFaturaAnahtari } from '../../lib/mfKaynagi.js';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi.js';
import { bilinenSayi, kurusaYuvarla, satirTutari, toplaBilinen as paraToplaBilinen, tutarBirlestir, type Tutar } from '../../utils/para.js';
import { gunAnahtari } from '../../utils/zaman.js';

// ── Seri ─────────────────────────────────────────────────────────────────────
/** Seri biçimi (şartname Q1-7). Seri değeri SQL metnine YALNIZ bu desenden geçtikten sonra girer. */
export const SERI_BICIMI = /^[A-Za-z0-9]{1,20}$/;
export const seriGecerli = (v: unknown): v is string => typeof v === 'string' && SERI_BICIMI.test(v);
/** Seri karşılaştırma anahtarı TEK KAYNAKTA: lib/faturasizSeri.seriAnahtari (gerekçesi orada; 2026-11-05 taşındı — istemci de
 *  aynı anahtarla faturasız seriyi tanır). Buradan yeniden dışa aktarılır: rota ve testler eski yoldan içe aktarıyor. */
export { seriAnahtari };

// ── Kolon adları (kodda geçen yazımıyla) + kanıt ─────────────────────────────
/** CARI_HESAP_HAREKETLERI — evrak başlığı. */
export const CHA_ADLARI = {
  seri:      'cha_evrakno_seri',        // server/mikro/eslemeFatura.ts:352 · server/mikroMirror.ts:93 · birleştirme faturaListesiSorgusu.ts:53
  sira:      'cha_evrakno_sira',        // server/mikro/eslemeFatura.ts:72 · server/mikroMirror.ts:93 · faturaListesiSorgusu.ts:53
  evrakTip:  'cha_evrak_tip',           // server/mikroMirror.ts:91 · server/mikro/eslemeFatura.ts:40
  cinsi:     'cha_cinsi',               // server/mikroMirror.ts:91 · server/mikro/govdeFaturaIrsaliye.ts:131
  tip:       'cha_tip',                 // server/mikro/eslemeFatura.ts:72 · faturaListesiSorgusu.ts:55
  meblag:    'cha_meblag',              // server/mikro/eslemeFatura.ts:72 · server/mikroMirror.ts:92
  tarih:     'cha_tarihi',              // server/mikro/eslemeFatura.ts:72 · server/mikro/kdvOzetSorgusu.ts:50
  kod:       'cha_kod',                 // server/mikro/eslemeFatura.ts:72 · server/mikroMirror.ts:91
  iptal:     'cha_iptal',               // server/mikro/kdvOzetSorgusu.ts:50 · server/mikro/matrahOnizleme.ts:23
  aratoplam: 'cha_aratoplam',           // lib/faturaMatrahi.ts:65 · server/mikroMirror.ts:92
  // Başlık KDV'si için kodda geçen TEK ad; geçmişte körü körüne sorguya yazılınca importu üç kez öldürdü (lib/mikroKolon.ts:8),
  // yani bu kurulumun şemasında büyük olasılıkla YOK. Burada zararsız: şemada yoksa SQL'e girmez, `eksikKolonlar`'da adıyla
  // görünür (başlık KDV'si OKUNAMADI demektir; KDV satırlardan — Σ sth_vergi — ölçülür). Şemada varsa kendiliğinden gelir.
  vergi:     'cha_vergi',               // server/mikroMirror.ts:92
  uuid:      'cha_uuid',                // server/mikro/ebelgeDurumTani.ts:7 (ETTN; tipi ölçülmedi → metne çevrilerek karşılaştırılır)
  ebelgeTuru:       'cha_ebelge_turu',          // server/mikro/ebelgeDurumTani.ts:6 · server/mikroMirror.ts:94
  efaturaBelgeTipi: 'cha_efatura_belge_tipi',   // server/mikro/ebelgeDurumTani.ts:6
  ebelgeIslemTuru:  'cha_ebelge_Islemturu',     // server/mikro/ebelgeDurumTani.ts:6 · utils/muhasebe/ebelgeTuru.ts:4-15 (büyük 'I' ile)
} as const;
export type ChaAnahtari = keyof typeof CHA_ADLARI;
/** e-belge kod kolonları — (2) ve (3)'te bu sırayla. */
export const EBELGE_KOD_ANAHTARLARI = ['ebelgeTuru', 'efaturaBelgeTipi', 'ebelgeIslemTuru'] as const;
/** Fatura altı iskonto tutarları: kodda adıyla geçen altı kolon (server/routes/mikroRoutes.ts:2107 — sema-kesif sorgusu; aynı
 *  altı ad cari-hareket importunun `secimKolonlari` listesinde de üretilir) + şemada aynı aileden başka üye varsa o da (aile
 *  deseni lib/faturaMatrahi.ts:20). */
export const FT_ISKONTO_ADLARI: readonly string[] = Array.from({ length: 6 }, (_, i) => `cha_ft_iskonto${i + 1}`);

/** STOK_HAREKETLERI — evrak satırı. */
export const STH_ADLARI = {
  seri:      'sth_evrakno_seri',        // server/mikro/faturaListesiSorgusu.ts:47, :53
  sira:      'sth_evrakno_sira',        // server/mikro/faturaListesiSorgusu.ts:47, :53
  evraktip:  'sth_evraktip',            // server/mikro/faturaListesiSorgusu.ts:51, :55
  tutar:     'sth_tutar',               // lib/faturaMatrahi.ts:82 · server/mikro/iskontoTutarsizlik.ts:141
  vergi:     'sth_vergi',               // server/mikro/faturaListesiSorgusu.ts:48
  vergiPntr: 'sth_vergi_pntr',          // server/mikro/faturaListesiSorgusu.ts:48
  girisDepo: 'sth_giris_depo_no',       // server/mikro/govdeFaturaIrsaliye.ts:352 · services/mikroEvrak.ts:197
  cikisDepo: 'sth_cikis_depo_no',       // server/mikro/govdeFaturaIrsaliye.ts:353 · services/mikroEvrak.ts:198
  iptal:     'sth_iptal',               // server/mikro/faturaListesiSorgusu.ts:51
} as const;
export type SthAnahtari = keyof typeof STH_ADLARI;

/** Başlık ↔ satır bağı — depodaki MEVCUT birleştirme koşulu (server/mikro/faturaListesiSorgusu.ts:53-55; 2026-08-01'de canlıda
 *  doğrulandı, eslemeFatura.ts:41-42). Yeni bağ UYDURULMAZ. Yanıtta aynen döner: okuyan hangi kuralla eşlendiğini görsün. */
export const SATIR_BAGI = 'sth_evrakno_seri = cha_evrakno_seri VE sth_evrakno_sira = cha_evrakno_sira VE sth_evraktip = (cha_tip 0 ise 4, değilse 3)';
/** Mevcut koşulun yön eşlemesi: satış başlığı (cha_tip 0) → satır evrak tipi 4, alış → 3. */
export const bagEvrakTipi = (chaTip: number): 3 | 4 => (chaTip === 0 ? 4 : 3);

// ── Şema planı ───────────────────────────────────────────────────────────────
const TANIMLAYICI = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Şema listesinden ad → GERÇEK yazım. Tanımlayıcı biçimine uymayan şema adı yok sayılır (SQL'e hiçbir koşulda girmez). */
const gercekYazim = (sema: readonly string[]): ((ad: string) => string | undefined) => {
  const harita = new Map<string, string>();
  for (const k of sema) if (TANIMLAYICI.test(k)) harita.set(k.toLowerCase(), k);
  return ad => harita.get(ad.toLowerCase());
};

export interface ChaPlani {
  /** Anahtar → şemadaki GERÇEK yazım. Şemada olmayan anahtar bu nesnede YOKTUR. */
  kolon: Partial<Record<ChaAnahtari, string>>;
  /** Şemada bulunan fatura altı iskonto kolonları (gerçek yazımıyla, ada göre sıralı). */
  ftIskonto: string[];
  /** Şemada bulunmayan adlar — kodda geçen yazımıyla. */
  eksik: string[];
}
export interface SthPlani {
  kolon: Partial<Record<SthAnahtari, string>>;
  eksik: string[];
}

export function chaPlani(sema: readonly string[]): ChaPlani {
  const bul = gercekYazim(sema);
  const kolon: Partial<Record<ChaAnahtari, string>> = {};
  const eksik: string[] = [];
  for (const anahtar of Object.keys(CHA_ADLARI) as ChaAnahtari[]) {
    const gercek = bul(CHA_ADLARI[anahtar]);
    if (gercek) kolon[anahtar] = gercek; else eksik.push(CHA_ADLARI[anahtar]);
  }
  for (const ad of FT_ISKONTO_ADLARI) if (!bul(ad)) eksik.push(ad);
  const ftIskonto = sema.filter(k => TANIMLAYICI.test(k) && FT_ISKONTO_DESENI.test(k)).sort((a, b) => a.localeCompare(b, 'en'));
  return { kolon, ftIskonto, eksik };
}

export function sthPlani(sema: readonly string[]): SthPlani {
  const bul = gercekYazim(sema);
  const kolon: Partial<Record<SthAnahtari, string>> = {};
  const eksik: string[] = [];
  for (const anahtar of Object.keys(STH_ADLARI) as SthAnahtari[]) {
    const gercek = bul(STH_ADLARI[anahtar]);
    if (gercek) kolon[anahtar] = gercek; else eksik.push(STH_ADLARI[anahtar]);
  }
  return { kolon, eksik };
}

// ── Sorgu kurucuları ─────────────────────────────────────────────────────────
/** Kurulan sorgu ya da KURULAMAMA nedeni. `atlananAlanlar`: yanıt alanı → neden (o alanın kolonu şemada yok). */
export type SorguPlani = { sql: string; atlananAlanlar: Record<string, string>; siralama?: string } | { atlandi: string };

const yok = (...adlar: string[]) => `şemada yok: ${adlar.join(', ')}`;
const SERI_BOZUK = 'seri biçimi geçersiz — SQL üretilmedi';
/** ETTN var / yok ifadesi — tip ne olursa olsun metne çevirerek; NULL, boş metin VE sıfır GUID «yok» sayılır (depo aynı
 *  değeri iki yerde geçersiz ETTN kabul eder: `ebelgeDurumTani.ts`, `lib/gibDurum.ts`). `NCHAR(48)` = «0», `NCHAR(45)` = «-»:
 *  tırnaklı sabit YAZILMAZ — rota testindeki çit «SQL'deki tek metin sabiti seridir» der.
 *  FARK (bilerek): `/api/mikro/ebelge-durum-tani` dağılımındaki `ettnVar` ESKİ ölçüttedir — yalnız NULL / boş «yok», sıfır
 *  GUID orada «var» sayılır; iki ucun sayıları sıfır GUID'li kayıt kadar ayrışabilir. O uç canlıda koşmuş biçimini korur:
 *  `REPLACE` / `NCHAR` SqlVeriOkuV2'de İLK kez bu uçta koşacak; ilk canlı çıktı geçmeden oraya taşınmaz. */
const ettnVarIfadesi = (uuid: string) => `CASE WHEN REPLACE(REPLACE(ISNULL(CAST(cha.${uuid} AS nvarchar(40)), ''), NCHAR(48), ''), NCHAR(45), '') = '' THEN 0 ELSE 1 END`;

/** Fatura başlığı koşulu (takma ad `cha`): SATIŞ = evrak tipi 63, ALIŞ = evrak tipi 0 + cinsi 6. TEK SQL kaynağı: `mikroRoutes.ts`
 *  `FATURA_EVRAK_KOSULU` bu işlevden türetilir (`faturaKosuluIfadesi('cha_evrak_tip', 'cha_cinsi')`; «Mikro bağlantı A» AH10, çit
 *  `seriOzet.test.ts`). Kolon adları şemadan süzülmüş kümeden gelir. JS yüklemi (dekont kapısı, dekont penceresi, Cari Ekstre) aynı
 *  kümeyi lib/faturaEvrakKosulu.faturaEvrakiMi'de taşır; bayt eşitliği ve örnek tablosu `lib/faturaEvrakKosulu.test.ts`'te. */
export const faturaKosuluIfadesi = (evrakTip: string, cinsi: string) => `(cha.${evrakTip} = 63 OR (cha.${evrakTip} = 0 AND cha.${cinsi} = 6))`;

/** (1) TÜM seriler: seri × evrak tipi × cinsi × yön → adet, toplam meblağ, en eski / en yeni tarih, iptal adedi ve toplamı.
 *  Fatura koşulu ÖNCEDEN uygulanmaz; iptal kayıtları da sayılır (ayrıca `iptalAdet`). Seri SAKLANDIĞI yazımla gruplanır: boş
 *  seri ('' ve NULL) kendi satırıdır. Sınır: harmanlama büyük / küçük harfe duyarsızsa 'q' ile 'Q' tek satırda birleşir. */
export function serilerSorgusu(p: ChaPlani): SorguPlani {
  const { seri, evrakTip, cinsi, tip, meblag, tarih, iptal } = p.kolon;
  if (!seri || !evrakTip || !cinsi || !tip) {
    return { atlandi: yok(...(['seri', 'evrakTip', 'cinsi', 'tip'] as const).filter(a => !p.kolon[a]).map(a => CHA_ADLARI[a])) };
  }
  const atlananAlanlar: Record<string, string> = {};
  const grup = [seri, evrakTip, cinsi, tip].map(k => `cha.${k}`).join(', ');
  const secim = [`cha.${seri} AS seri`, `cha.${evrakTip} AS evrakTip`, `cha.${cinsi} AS cinsi`, `cha.${tip} AS tip`, 'COUNT(*) AS adet'];
  if (meblag) secim.push(`SUM(cha.${meblag}) AS toplam`); else atlananAlanlar.toplam = yok(CHA_ADLARI.meblag);
  if (tarih) secim.push(`MIN(cha.${tarih}) AS enEski`, `MAX(cha.${tarih}) AS enYeni`);
  else atlananAlanlar.enEski = atlananAlanlar.enYeni = yok(CHA_ADLARI.tarih);
  if (iptal) secim.push(`SUM(CASE WHEN ISNULL(cha.${iptal}, 0) <> 0 THEN 1 ELSE 0 END) AS iptalAdet`);
  else atlananAlanlar.iptalAdet = yok(CHA_ADLARI.iptal);
  if (iptal && meblag) secim.push(`SUM(CASE WHEN ISNULL(cha.${iptal}, 0) <> 0 THEN cha.${meblag} END) AS iptalToplam`);
  else atlananAlanlar.iptalToplam = yok(...(['iptal', 'meblag'] as const).filter(a => !p.kolon[a]).map(a => CHA_ADLARI[a]));
  return { sql: `SELECT ${secim.join(', ')} FROM CARI_HESAP_HAREKETLERI cha GROUP BY ${grup} ORDER BY ${grup}`, atlananAlanlar };
}

/** (2) İstenen seride e-belge kod kolon(lar)ı × ETTN var / yok × iptal → adet. */
export function eBelgeSorgusu(p: ChaPlani, seri: unknown): SorguPlani {
  if (!seriGecerli(seri)) return { atlandi: SERI_BOZUK };
  const { seri: seriK, uuid, iptal } = p.kolon;
  if (!seriK) return { atlandi: yok(CHA_ADLARI.seri) };
  const kodlar = EBELGE_KOD_ANAHTARLARI.filter(a => p.kolon[a]);
  if (!kodlar.length && !uuid) return { atlandi: yok(...EBELGE_KOD_ANAHTARLARI.map(a => CHA_ADLARI[a]), CHA_ADLARI.uuid) };
  const atlananAlanlar: Record<string, string> = {};
  for (const a of EBELGE_KOD_ANAHTARLARI) if (!p.kolon[a]) atlananAlanlar[CHA_ADLARI[a]] = yok(CHA_ADLARI[a]);
  const ettnVar = uuid ? ettnVarIfadesi(uuid) : null;
  if (!ettnVar) atlananAlanlar.ettnVar = yok(CHA_ADLARI.uuid);
  if (!iptal) atlananAlanlar.iptal = yok(CHA_ADLARI.iptal);
  // Sabit ifade GROUP BY'a giremez (SQL Server) — olmayan kırılım gruba da seçime de girmez.
  const grup = [...kodlar.map(a => `cha.${p.kolon[a]}`), ...(ettnVar ? [ettnVar] : []), ...(iptal ? [`ISNULL(cha.${iptal}, 0)`] : [])].join(', ');
  const secim = [
    ...kodlar.map(a => `cha.${p.kolon[a]} AS ${CHA_ADLARI[a]}`),
    ...(ettnVar ? [`${ettnVar} AS ettnVar`] : []),
    ...(iptal ? [`ISNULL(cha.${iptal}, 0) AS iptal`] : []),
    'COUNT(*) AS adet',
  ].join(', ');
  return { sql: `SELECT ${secim} FROM CARI_HESAP_HAREKETLERI cha WHERE cha.${seriK} = '${seri}' GROUP BY ${grup} ORDER BY ${grup}`, atlananAlanlar };
}

/** (3a) İstenen serinin `adet` başlığı — «son `adet` kayıt» DEĞİL: fatura koşuluna uyanlar ÖNCE, sonra tarih, sonra sıra
 *  (yeniden eskiye); koşul kolonlarından biri şemada yoksa öne alma yok. Uygulanan kural plana `siralama` metniyle yazılır
 *  (rota yanıta taşır). İptal kayıtları da gelir (bayrağıyla). */
export function sonBasliklarSorgusu(p: ChaPlani, seri: unknown, adet = 20): SorguPlani {
  if (!seriGecerli(seri)) return { atlandi: SERI_BOZUK };
  const { seri: seriK, sira, tarih, uuid, iptal, evrakTip, cinsi } = p.kolon;
  if (!seriK || !sira) return { atlandi: yok(...(['seri', 'sira'] as const).filter(a => !p.kolon[a]).map(a => CHA_ADLARI[a])) };
  const sinir = Number.isInteger(adet) && adet >= 1 && adet <= 100 ? adet : 20;
  const atlananAlanlar: Record<string, string> = {};
  const secim = [`cha.${sira} AS sira`, `cha.${seriK} AS seri`];
  const alan = (anahtar: ChaAnahtari, takmaAd: string) => {
    const k = p.kolon[anahtar];
    if (k) secim.push(`cha.${k} AS ${takmaAd}`); else atlananAlanlar[takmaAd] = yok(CHA_ADLARI[anahtar]);
  };
  alan('tarih', 'tarih'); alan('kod', 'cariKod'); alan('evrakTip', 'evrakTip'); alan('cinsi', 'cinsi'); alan('tip', 'tip');
  alan('meblag', 'meblag'); alan('aratoplam', 'araToplam'); alan('vergi', 'vergi');
  // Fatura altı iskonto kolonları HAM seçilir, toplam JS'te alınır: SQL'de ISNULL(…, 0) ile toplamak NULL'u sıfır sayardı.
  if (p.ftIskonto.length) secim.push(...p.ftIskonto.map(k => `cha.${k} AS ${k}`)); else atlananAlanlar.ftIskonto = yok(...FT_ISKONTO_ADLARI);
  for (const a of EBELGE_KOD_ANAHTARLARI) alan(a, CHA_ADLARI[a]);
  if (uuid) secim.push(`${ettnVarIfadesi(uuid)} AS ettnVar`); else atlananAlanlar.ettnVar = yok(CHA_ADLARI.uuid);
  if (iptal) secim.push(`ISNULL(cha.${iptal}, 0) AS iptal`); else atlananAlanlar.iptal = yok(CHA_ADLARI.iptal);
  // Seri fatura DIŞI kayıt da taşıyabilir (aynı seriyle dekont, irsaliye…). Kayıt SÜZÜLMEZ ve gizlenmez: fatura koşuluna
  // uyanlar `faturaKosulu` ile etiketlenir ve TOP penceresinde ÖNE alınır (satır bağı yalnız fatura başlığında doğrulanmış
  // bir bağdır — koşul dışı başlığa satır özeti YAZILMAZ: `sonBasliklarBicimle` o başlıkta `satirOzeti`'ni `atlandi` ile
  // döner, aynı seri + sıradaki satırlar `bagDisiSatirlar`'da kalır).
  const kosul = evrakTip && cinsi ? faturaKosuluIfadesi(evrakTip, cinsi) : null;
  if (kosul) secim.push(`CASE WHEN ${kosul} THEN 1 ELSE 0 END AS faturaKosulu`);
  else atlananAlanlar.faturaKosulu = yok(...(['evrakTip', 'cinsi'] as const).filter(a => !p.kolon[a]).map(a => CHA_ADLARI[a]));
  const sirala = (kosul ? `CASE WHEN ${kosul} THEN 0 ELSE 1 END, ` : '') + (tarih ? `cha.${tarih} DESC, cha.${sira} DESC` : `cha.${sira} DESC`);
  return {
    sql: `SELECT TOP ${sinir} ${secim.join(', ')} FROM CARI_HESAP_HAREKETLERI cha WHERE cha.${seriK} = '${seri}' ORDER BY ${sirala}`,
    atlananAlanlar,
    siralama: (kosul ? 'fatura koşuluna uyanlar önce; sonra ' : '') + (tarih ? 'tarih, sonra evrak sırası' : 'evrak sırası') + ' — yeniden eskiye',
  };
}

/** Evrak sırası SQL'e yalnız rakam olarak girer (değer Mikro'dan gelir; yine de biçim denetlenir). Sayı değilse null. */
export const siraSayisi = (v: unknown): number | null => {
  const m = typeof v === 'number' || typeof v === 'string' ? String(v).trim() : '';
  return /^\d{1,9}$/.test(m) ? Number(m) : null;
};

/** (3b) Başlıkların stok hareket satırları: sıra × satır evrak tipi × vergi işaretçisi × giriş / çıkış deposu × iptal → satır
 *  adedi, Σ tutar, Σ vergi, NULL tutar / vergi satırı sayısı. Seri + sıra ile süzülür; yön (evrak tipi) eşlemesi JS'te MEVCUT
 *  koşulla yapılır (`bagEvrakTipi`) — aynı seri + sırada başka evrak tipli satır varsa (ör. irsaliye) gizlenmez, ayrı sayılır. */
export function satirOzetiSorgusu(p: SthPlani, seri: unknown, siralar: readonly unknown[]): SorguPlani {
  if (!seriGecerli(seri)) return { atlandi: SERI_BOZUK };
  const { seri: seriK, sira, evraktip, tutar, vergi, vergiPntr, girisDepo, cikisDepo, iptal } = p.kolon;
  if (!seriK || !sira || !evraktip) {
    return { atlandi: yok(...(['seri', 'sira', 'evraktip'] as const).filter(a => !p.kolon[a]).map(a => STH_ADLARI[a])) };
  }
  const sayilar = [...new Set(siralar.map(siraSayisi).filter((n): n is number => n !== null))].sort((a, b) => a - b);
  if (!sayilar.length) return { atlandi: 'sayısal evrak sırası olan başlık yok' };
  const atlananAlanlar: Record<string, string> = {};
  const secim = [`${sira} AS sira`, `${evraktip} AS evraktip`];
  const grup = [sira, evraktip];
  const kirilim = (k: string | undefined, takmaAd: string, alanAdi: string, kodAdi: string) => {
    if (k) { secim.push(`${k} AS ${takmaAd}`); grup.push(k); } else atlananAlanlar[alanAdi] = yok(kodAdi);
  };
  kirilim(vergiPntr, 'vergiPntr', 'vergiIsaretcisi', STH_ADLARI.vergiPntr);
  kirilim(girisDepo, 'girisDepo', 'girisDeposu', STH_ADLARI.girisDepo);
  kirilim(cikisDepo, 'cikisDepo', 'cikisDeposu', STH_ADLARI.cikisDepo);
  if (iptal) { secim.push(`ISNULL(${iptal}, 0) AS iptal`); grup.push(`ISNULL(${iptal}, 0)`); } else atlananAlanlar.iptalSatirAdedi = yok(STH_ADLARI.iptal);
  secim.push('COUNT(*) AS adet');
  if (tutar) secim.push(`SUM(${tutar}) AS tutar`, `SUM(CASE WHEN ${tutar} IS NULL THEN 1 ELSE 0 END) AS tutarBos`); else atlananAlanlar.tutar = yok(STH_ADLARI.tutar);
  if (vergi) secim.push(`SUM(${vergi}) AS vergi`, `SUM(CASE WHEN ${vergi} IS NULL THEN 1 ELSE 0 END) AS vergiBos`); else atlananAlanlar.vergi = yok(STH_ADLARI.vergi);
  return {
    sql: `SELECT ${secim.join(', ')} FROM STOK_HAREKETLERI WHERE ${seriK} = '${seri}' AND ${sira} IN (${sayilar.join(', ')}) ` +
      `GROUP BY ${grup.join(', ')} ORDER BY ${sira}, ${evraktip}`,
    atlananAlanlar,
  };
}

/** (4) Cetpa `mikroFaturalar` kopyaları: kiracı × SAKLANAN seri → adet. Kopyada seri `cha_evrakno_seri` alanındadır (import satırı
 *  aynen yazar: eslemeFatura.ts `faturaEsle`; fatura-tani de aynı alanı okur). Seri eşlemesi JS'te (`seriAnahtari`, tek kaynak lib/faturasizSeri) — PG `upper()`
 *  veritabanı yereline bağlıdır. Yalnız SELECT; değer parametreyle. */
export const CETPA_FATURA_SORGUSU: { sql: string; params: string[] } = {
  sql: `SELECT data->>'companyId' AS "companyId", data->>'cha_evrakno_seri' AS seri, COUNT(*)::int AS adet FROM docs WHERE coll = $1 GROUP BY 1, 2`,
  params: ['mikroFaturalar'],
};
/** (5) Mikro faturasından türeyen siparişler (`source = MF_KAYNAGI` — lib/mfKaynagi, eslemeFatura.faturadanSiparis): kiracı × `mikroEvrak.seri`
 *  (eslemeFatura.ts:382) × `faturali` değeri → adet. `jsonb_typeof` alanın YOKLUĞUNU (NULL) JSON null / boolean / başka tipten ayırır. */
export const CETPA_SIPARIS_SORGUSU: { sql: string; params: string[] } = {
  sql: `SELECT data->>'companyId' AS "companyId", data->'mikroEvrak'->>'seri' AS seri, jsonb_typeof(data->'faturali') AS tur, ` +
    `data->>'faturali' AS deger, COUNT(*)::int AS adet FROM docs WHERE coll = $1 AND data->>'source' = $2 GROUP BY 1, 2, 3, 4`,
  params: ['orders', MF_KAYNAGI],
};

// ── Yanıt biçimleyiciler ─────────────────────────────────────────────────────
type Satir = Readonly<Record<string, unknown>>;

/** Sayı ya da null. Boş / boşluk / boolean / sayıya çevrilemeyen değer BİLİNMİYOR'dur (0 değil). */
export const sayi = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const metin = (v: unknown, sinir = 80): string | null => (v === null || v === undefined ? null : kes(String(v), sinir));
const bayrak = (v: unknown): boolean | null => (v === null || v === undefined || v === '' ? null : iptalMi(v));
/** Hepsi biliniyorsa toplam; biri bile bilinmiyorsa null. Boş liste 0'dır (toplanacak şey yok — çağıran ayırır). */
const toplaBilinen = (degerler: readonly (number | null)[]): number | null => {
  let t = 0;
  for (const d of degerler) { if (d === null) return null; t += d; }
  return t;
};
/** Sayaç: anahtar ilk kez görülüyorsa `adet`, değilse üstüne ekler (`in` DEĞİL — 'constructor' gibi anahtar prototipe düşmesin). */
const say = (hedef: Record<string, number>, anahtar: string, adet: number) => {
  hedef[anahtar] = Object.prototype.hasOwnProperty.call(hedef, anahtar) ? hedef[anahtar] + adet : adet;
};
const etiket = (v: unknown, bos = '(boş)'): string => (v === null || v === undefined || String(v).trim() === '' ? bos : kes(String(v).trim(), 40));

export interface SeriSatiri {
  /** SAKLANDIĞI yazımla; NULL ise null, boş metin ise ''. */
  seri: string | null;
  /** `cha_evrak_tip`, `cha_cinsi`, `cha_tip` (0 = borç / satış yönü, 1 = alacak / alış yönü) — kodlar AYNEN, yorumlanmadan. */
  evrakTip: number | null; cinsi: number | null; tip: number | null;
  /** İptal kayıtları DÂHİL. */
  adet: number | null;
  toplam?: number | null;
  enEski?: string | null; enYeni?: string | null;
  iptalAdet?: number | null;
  /** İptal kaydı yoksa null (toplanacak satır yok). */
  iptalToplam?: number | null;
}
export function serilerBicimle(rows: readonly Satir[]): SeriSatiri[] {
  return rows.map(r => ({
    seri: metin(r.seri), evrakTip: sayi(r.evrakTip), cinsi: sayi(r.cinsi), tip: sayi(r.tip), adet: sayi(r.adet),
    ...('toplam' in r ? { toplam: sayi(r.toplam) } : {}),
    ...('enEski' in r ? { enEski: metin(r.enEski, 30), enYeni: metin(r.enYeni, 30) } : {}),
    ...('iptalAdet' in r ? { iptalAdet: sayi(r.iptalAdet) } : {}),
    ...('iptalToplam' in r ? { iptalToplam: sayi(r.iptalToplam) } : {}),
  }));
}

export type EBelgeSatiri = { ettnVar?: boolean | null; iptal?: boolean | null; adet: number | null } & Record<string, number | boolean | null | undefined>;
export function eBelgeBicimle(rows: readonly Satir[]): EBelgeSatiri[] {
  return rows.map(r => {
    const s: EBelgeSatiri = { adet: sayi(r.adet) };
    for (const a of EBELGE_KOD_ANAHTARLARI) if (CHA_ADLARI[a] in r) s[CHA_ADLARI[a]] = sayi(r[CHA_ADLARI[a]]);
    if ('ettnVar' in r) { const n = sayi(r.ettnVar); s.ettnVar = n === null ? null : n !== 0; }
    if ('iptal' in r) s.iptal = bayrak(r.iptal);
    return s;
  });
}

export interface SatirOzeti {
  /** Bağ koşulundaki satır evrak tipi (başlığın yönünden: satış 4, alış 3). */
  evraktip: 3 | 4;
  /** İptalsiz satır adedi. Satır yoksa 0 — o zaman tutar / vergi null'dır (toplanacak satır yok, «0 TL» değil). */
  satirAdedi: number | null;
  tutar?: number | null;
  vergi?: number | null;
  iptalSatirAdedi?: number | null;
  /** Değer → iptalsiz satır adedi. */
  vergiIsaretcisi?: Record<string, number>;
  girisDeposu?: Record<string, number>;
  cikisDeposu?: Record<string, number>;
}
export interface BaslikOzeti {
  sira: number | null;
  seri: string | null;
  tarih?: string | null; cariKod?: string | null;
  evrakTip?: number | null; cinsi?: number | null; tip?: number | null;
  meblag?: number | null; araToplam?: number | null; vergi?: number | null;
  /** Σ fatura altı iskonto kolonları; biri bile okunamadıysa null. */
  ftIskonto?: number | null;
  ettnVar?: boolean | null; iptal?: boolean | null;
  /** Başlık fatura koşuluna uyuyor mu (SATIŞ 63 / ALIŞ 0 + cinsi 6). false: seride fatura DIŞI kayıt — satır özeti bağı o kayıt için doğrulanmış değildir. */
  faturaKosulu?: boolean | null;
  /** null: satırlar okunmadı (neden bölümün `satirOzeti` alanında). */
  satirOzeti: SatirOzeti | { atlandi: string } | null;
  /** Aynı seri + sıra + bağ evrak tipinde AYNI satır özetini taşıyan başlık adedi (kendisi dâhil) — yalnız 1'den büyükse yazılır.
   *  İkiz başlıkta (aynı evrak numarasıyla iki fatura başlığı) satırlar iki başlıkta da görünür; toplarken ÇİFT sayılmasın diye.
   *  Sayım yalnız dönen pencere (TOP n) içindedir: ikizi pencerenin dışında kalan başlık işaretlenmez. */
  satirOzetiPaylasanBaslik?: number;
  /** Aynı seri + sırada, bağ koşulunun DIŞINDA kalan satırlar (başka evrak tipi) — gizlenmez. Başlık fatura koşulu dışındaysa
   *  (`faturaKosulu === false`) o sıradaki TÜM satırlar buradadır (bağ evrak tipindekiler dâhil): evrak tipi + adet. */
  bagDisiSatirlar?: Array<{ evraktip: number | null; satirAdedi: number | null; iptalSatirAdedi?: number | null }>;
  [eBelgeKodu: string]: unknown;
}

function satirOzeti(gruplar: readonly Satir[], evraktip: 3 | 4, p: SthPlani): SatirOzeti {
  const iptalli = p.kolon.iptal ? gruplar.filter(g => iptalMi(g.iptal)) : [];
  const aktif = p.kolon.iptal ? gruplar.filter(g => !iptalMi(g.iptal)) : gruplar;
  const ozet: SatirOzeti = { evraktip, satirAdedi: toplaBilinen(aktif.map(g => sayi(g.adet))) };
  // NULL tutar / vergi taşıyan satır varsa SQL toplamı onu atlamıştır → toplam BİLİNMİYOR.
  const toplam = (alan: 'tutar' | 'vergi', bosAlani: 'tutarBos' | 'vergiBos'): number | null => {
    if (!aktif.length) return null;
    if (aktif.some(g => sayi(g[bosAlani]) !== 0)) return null;
    return toplaBilinen(aktif.map(g => sayi(g[alan])));
  };
  if (p.kolon.tutar) ozet.tutar = toplam('tutar', 'tutarBos');
  if (p.kolon.vergi) ozet.vergi = toplam('vergi', 'vergiBos');
  if (p.kolon.iptal) ozet.iptalSatirAdedi = toplaBilinen(iptalli.map(g => sayi(g.adet)));
  const dagilim = (alan: string): Record<string, number> => {
    const d: Record<string, number> = {};
    for (const g of aktif) { const n = sayi(g.adet); if (n !== null) say(d, etiket(g[alan]), n); }
    return d;
  };
  if (p.kolon.vergiPntr) ozet.vergiIsaretcisi = dagilim('vergiPntr');
  if (p.kolon.girisDepo) ozet.girisDeposu = dagilim('girisDepo');
  if (p.kolon.cikisDepo) ozet.cikisDeposu = dagilim('cikisDepo');
  return ozet;
}

/** (3) Başlık satırlarını ve (okunduysa) stok hareket gruplarını birleştirir. `satirlar === null`: satırlar OKUNMADI. */
export function sonBasliklarBicimle(
  basliklar: readonly Satir[], p: ChaPlani, satirlar: { gruplar: readonly Satir[]; plan: SthPlani } | null,
): BaslikOzeti[] {
  const sirayaGore = new Map<number, Satir[]>();
  for (const g of satirlar ? satirlar.gruplar : []) {
    const n = siraSayisi(g.sira);
    if (n === null) continue;
    const liste = sirayaGore.get(n);
    if (liste) liste.push(g); else sirayaGore.set(n, [g]);
  }
  const cikti = basliklar.map(r => {
    const b: BaslikOzeti = { sira: sayi(r.sira), seri: metin(r.seri), satirOzeti: null };
    if ('tarih' in r) b.tarih = metin(r.tarih, 30);
    if ('cariKod' in r) b.cariKod = metin(r.cariKod);
    for (const alan of ['evrakTip', 'cinsi', 'tip', 'meblag', 'araToplam', 'vergi'] as const) if (alan in r) b[alan] = sayi(r[alan]);
    if (p.ftIskonto.length) b.ftIskonto = toplaBilinen(p.ftIskonto.map(k => sayi(r[k])));
    for (const a of EBELGE_KOD_ANAHTARLARI) if (CHA_ADLARI[a] in r) b[CHA_ADLARI[a]] = sayi(r[CHA_ADLARI[a]]);
    if ('ettnVar' in r) { const n = sayi(r.ettnVar); b.ettnVar = n === null ? null : n !== 0; }
    if ('iptal' in r) b.iptal = bayrak(r.iptal);
    if ('faturaKosulu' in r) { const n = sayi(r.faturaKosulu); b.faturaKosulu = n === null ? null : n !== 0; }
    if (!satirlar) return b;
    const sira = siraSayisi(r.sira);
    const tip = 'tip' in r ? sayi(r.tip) : null;
    if (sira === null) { b.satirOzeti = { atlandi: 'evrak sırası sayı değil — satırlar sorulmadı' }; return b; }
    if (tip === null) { b.satirOzeti = { atlandi: `başlığın ${CHA_ADLARI.tip} değeri okunamadı — satır bağı kurulamadı` }; return b; }
    const beklenen = bagEvrakTipi(tip);
    const gruplar = sirayaGore.get(sira) ?? [];
    // Bağ yalnız FATURA başlığında doğrulanmıştır: koşul dışı başlığa aynı seri + sıradaki satırların özeti YAZILMAZ (aynı satırlar iki
    // başlıkta sayılırdı). Satırlar gizlenmez: evrak tipi + adet olarak `bagDisiSatirlar`da kalır.
    const kosulDisi = b.faturaKosulu === false;
    b.satirOzeti = kosulDisi
      ? { atlandi: 'başlık fatura koşulu dışında — satır bağı yalnız fatura başlığında doğrulanmış (aynı seri + sıradaki satırlar: bagDisiSatirlar)' }
      : satirOzeti(gruplar.filter(g => sayi(g.evraktip) === beklenen), beklenen, satirlar.plan);
    // İptal ayrımı `satirOzeti` ile AYNI anlamda: `satirAdedi` iptalsiz, `iptalSatirAdedi` ayrı (iptal kolonu şemada yoksa ayrım yapılamaz).
    const iptalVar = Boolean(satirlar.plan.kolon.iptal);
    const disi = new Map<string, { evraktip: number | null; adetler: (number | null)[]; iptalAdetler: (number | null)[] }>();
    for (const g of gruplar) {
      const et = sayi(g.evraktip);
      if (!kosulDisi && et === beklenen) continue;
      let kayit = disi.get(String(et));
      if (!kayit) { kayit = { evraktip: et, adetler: [], iptalAdetler: [] }; disi.set(String(et), kayit); }
      (iptalVar && iptalMi(g.iptal) ? kayit.iptalAdetler : kayit.adetler).push(sayi(g.adet));
    }
    // Koşul dışı başlıkta alan HER ZAMAN yazılır (satır yoksa boş dizi): `atlandi` metni okuyanı buraya yollar.
    if (disi.size || kosulDisi) b.bagDisiSatirlar = [...disi.values()].map(k => ({
      evraktip: k.evraktip, satirAdedi: toplaBilinen(k.adetler), ...(iptalVar ? { iptalSatirAdedi: toplaBilinen(k.iptalAdetler) } : {}),
    }));
    return b;
  });
  const ozetAnahtari = (b: BaslikOzeti) => (b.satirOzeti && 'evraktip' in b.satirOzeti ? `${b.sira}|${b.satirOzeti.evraktip}` : null);
  const paylasan = new Map<string, number>();
  for (const b of cikti) { const a = ozetAnahtari(b); if (a) paylasan.set(a, (paylasan.get(a) ?? 0) + 1); }
  for (const b of cikti) {
    const a = ozetAnahtari(b);
    const n = a ? paylasan.get(a) : undefined;
    if (n !== undefined && n > 1) b.satirOzetiPaylasanBaslik = n;
  }
  return cikti;
}

const kiraciEtiketi = (v: unknown) => etiket(v, '(etiketsiz)');
/** PG `COUNT(*)::int` her zaman sayıdır; değilse okuma bozuktur — sıfır sayılmaz, bölüm hata ile döner. */
const pgAdet = (v: unknown): number => {
  const n = sayi(v);
  if (n === null) throw new Error('PG adet değeri sayı değil');
  return n;
};

export interface CetpaFaturaOzeti {
  /** İstenen serideki kopya adedi (tüm kiracılar). */
  adet: number;
  kiracilar: Record<string, number>;
  /** SAKLANAN yazım → adet ('Q' / 'q' ayrışırsa burada görünür). */
  yazimlar: Record<string, number>;
  /** Koleksiyondaki TÜM kopyalar (her seri) — «0 kopya» ile «koleksiyon boş»u ayırmak için. */
  toplamKopya: number;
}
export function cetpaFaturaOzeti(rows: readonly Satir[], seri: string): CetpaFaturaOzeti {
  const hedef = seriAnahtari(seri);
  const ozet: CetpaFaturaOzeti = { adet: 0, kiracilar: {}, yazimlar: {}, toplamKopya: 0 };
  for (const r of rows) {
    const n = pgAdet(r.adet);
    ozet.toplamKopya += n;
    if (seriAnahtari(r.seri) !== hedef) continue;
    ozet.adet += n;
    say(ozet.kiracilar, kiraciEtiketi(r.companyId), n);
    say(ozet.yazimlar, String(r.seri), n);
  }
  return ozet;
}

export interface CetpaSiparisOzeti {
  /** `source === 'mikro-fatura'` VE `mikroEvrak.seri` istenen seri olan sipariş adedi. */
  adet: number;
  /** `faturali` değer dağılımı: boolean true / false, alan yok ya da null (`yok`), başka tip (`diger` — ör. metin "true"). */
  faturali: { true: number; false: number; yok: number; diger: number };
  kiracilar: Record<string, number>;
  yazimlar: Record<string, number>;
  /** Her seriden MF siparişi toplamı. */
  toplamMikroFaturaSiparisi: number;
  /** `mikroEvrak.seri` alanı OLMAYAN (NULL) MF siparişi adedi — her seriden. Gece geri doldurmasının hedefi bunlarda bugünkü gibi
   *  `true` (şartname q-serisi v3 QH5-5, 2026-11-05: yayından ÖNCE okunur, yayın notuna yazılır). Boş metin seri ('') SAYILMAZ. */
  seriYok: number;
}
export function cetpaSiparisOzeti(rows: readonly Satir[], seri: string): CetpaSiparisOzeti {
  const hedef = seriAnahtari(seri);
  const ozet: CetpaSiparisOzeti = { adet: 0, faturali: { true: 0, false: 0, yok: 0, diger: 0 }, kiracilar: {}, yazimlar: {}, toplamMikroFaturaSiparisi: 0, seriYok: 0 };
  for (const r of rows) {
    const n = pgAdet(r.adet);
    ozet.toplamMikroFaturaSiparisi += n;
    if (r.seri === null || r.seri === undefined) ozet.seriYok += n;
    if (seriAnahtari(r.seri) !== hedef) continue;
    ozet.adet += n;
    const kova = r.tur === null || r.tur === undefined || r.tur === 'null' ? 'yok'
      : r.tur === 'boolean' && r.deger === 'true' ? 'true'
        : r.tur === 'boolean' && r.deger === 'false' ? 'false' : 'diger';
    ozet.faturali[kova] += n;
    say(ozet.kiracilar, kiraciEtiketi(r.companyId), n);
    say(ozet.yazimlar, String(r.seri), n);
  }
  return ozet;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// (6)–(14) — Dilim 1 yayınından SONRA, Dilim 2 kodlanmadan ÖNCE okunacak ölçümler (şartname q-serisi v3 § 4.3 + «Kapı sonrası
// hükümler» QH8-4 / QH8-5, 2026-11-05). Kural YAZMAZ: Q gövdesinin KDV ifadesi (Q3-3), satır / başlık sabitleri (a1-8(1)), %0
// işaretçisinin canlı sırası, faturasız sipariş havuzunun ön koşul kapsamı, Satışlar çift sayımının kesin boyutu buradan okunur.
// Mikro'ya yalnız SELECT (+ VergiListesiV2 okuması), Cetpa'ya yalnız SELECT. Müşteri kimliği / sipariş kimliği DÖKÜLMEZ: kiracı
// başına sayılar ve toplamlar.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** (6)(7) için EK satır kolonları — her ad depoda ZATEN geçer (kanıt yanında; dosya düzeyi çit `seriOzetOlcum.test.ts`). */
export const STH_EK_ADLARI = {
  tip:        'sth_tip',                // server/mikro/govdeFaturaIrsaliye.ts:342 · server/mikro/iskontoTutarsizlik.ts:140
  cins:       'sth_cins',               // server/mikro/govdeFaturaIrsaliye.ts:343
  normalIade: 'sth_normal_iade',        // server/mikro/govdeFaturaIrsaliye.ts:344
  vergisizFl: 'sth_vergisiz_fl',        // server/mikro/govdeFaturaIrsaliye.ts:356
} as const;
export type SthEkAnahtari = keyof typeof STH_EK_ADLARI;
/** (7)(14) için EK başlık kolonları. */
export const CHA_EK_ADLARI = {
  normalIade: 'cha_normal_Iade',        // server/mikro/govdeFaturaIrsaliye.ts:381 (büyük 'I' ile)
  cariCins:   'cha_cari_cins',          // server/mikro/govdeFaturaIrsaliye.ts:383
  dCins:      'cha_d_cins',             // server/mikro/govdeFaturaIrsaliye.ts:415
  guid:       'cha_Guid',               // server/mikro/eslemeFatura.ts:74 · server/mikroMirror.ts:378
} as const;
export type ChaEkAnahtari = keyof typeof CHA_EK_ADLARI;

/** Gövde sabitleri (server/mikro/govdeFaturaIrsaliye.faturaGovdesi) — (7) bunlardan FARKLI deseni işaretler (fark → DUR, a1-8(1)). */
export const GOVDE_SATIR_SABITLERI = { tip: 1, cins: 0, normalIade: 0, vergisizFl: false } as const;
export const GOVDE_BASLIK_SABITLERI = { normalIade: 0, cariCins: 0, dCins: 0 } as const;

export interface EkPlan<K extends string> {
  kolon: Partial<Record<K, string>>;
  /** Şemada bulunmayan EK adlar — kodda geçen yazımıyla (`eksikKolonlar`'a girer). */
  eksik: string[];
}
function ekPlan<K extends string>(sema: readonly string[], adlar: Readonly<Record<K, string>>): EkPlan<K> {
  const bul = gercekYazim(sema);
  const kolon: Partial<Record<K, string>> = {};
  const eksik: string[] = [];
  for (const anahtar of Object.keys(adlar) as K[]) {
    const gercek = bul(adlar[anahtar]);
    if (gercek) kolon[anahtar] = gercek; else eksik.push(adlar[anahtar]);
  }
  return { kolon, eksik };
}
export const sthEkPlani = (sema: readonly string[]): EkPlan<SthEkAnahtari> => ekPlan(sema, STH_EK_ADLARI);
export const chaEkPlani = (sema: readonly string[]): EkPlan<ChaEkAnahtari> => ekPlan(sema, CHA_EK_ADLARI);

/** (6) Giden satış satırlarında (`sth_evraktip = 4`, iptal dışı) vergi işaretçisi × `sth_vergisiz_fl` × (`sth_vergi = 0`) → adet.
 *  Q3-3 karar kuralının girdisi: KDV'siz satış satırı TEK desende mi. `sth_vergi` NULL ise «sıfır mı» BİLİNMİYOR (null kovası). */
export function vergiDeseniSorgusu(p: SthPlani, ek: EkPlan<SthEkAnahtari>): SorguPlani {
  const { evraktip, vergi, vergiPntr, iptal } = p.kolon;
  if (!evraktip || !vergi) return { atlandi: yok(...(['evraktip', 'vergi'] as const).filter(a => !p.kolon[a]).map(a => STH_ADLARI[a])) };
  const atlananAlanlar: Record<string, string> = {};
  const sifir = `CASE WHEN ${vergi} IS NULL THEN NULL WHEN ${vergi} = 0 THEN 1 ELSE 0 END`;
  const secim: string[] = [], grup: string[] = [];
  if (vergiPntr) { secim.push(`${vergiPntr} AS vergiPntr`); grup.push(vergiPntr); } else atlananAlanlar.vergiIsaretcisi = yok(STH_ADLARI.vergiPntr);
  const fl = ek.kolon.vergisizFl;
  if (fl) { secim.push(`${fl} AS vergisizFl`); grup.push(fl); } else atlananAlanlar.vergisizFl = yok(STH_EK_ADLARI.vergisizFl);
  secim.push(`${sifir} AS vergiSifir`, 'COUNT(*) AS adet');
  grup.push(sifir);
  if (!iptal) atlananAlanlar.iptalDisi = yok(STH_ADLARI.iptal);
  return {
    sql: `SELECT ${secim.join(', ')} FROM STOK_HAREKETLERI WHERE ${evraktip} = 4${iptal ? ` AND ISNULL(${iptal}, 0) = 0` : ''} ` +
      `GROUP BY ${grup.join(', ')} ORDER BY ${grup.join(', ')}`,
    atlananAlanlar,
  };
}

export interface VergiDeseniSatiri { vergiIsaretcisi?: string | null; vergisizFl?: boolean | null; vergiSifir: boolean | null; adet: number | null }
export interface VergiDeseniOzeti {
  satirlar: VergiDeseniSatiri[];
  /** KDV'siz (`sth_vergi = 0`) satış satırlarının desenleri — Q3-3: `tek` → Q gövdesi o deseni yazar; `karisik` → DUR;
   *  `yok` → bugünkü %0 yolu; `olculemedi` → işaretçi ya da bayrak kolonu şemada yok (karar verilemez). */
  kdvsiz: { durum: 'tek' | 'karisik' | 'yok' | 'olculemedi'; desenler: Array<{ vergiIsaretcisi: string | null; vergisizFl: boolean | null; adet: number | null }> };
}
export function vergiDeseniBicimle(rows: readonly Satir[], p: SthPlani, ek: EkPlan<SthEkAnahtari>): VergiDeseniOzeti {
  const satirlar: VergiDeseniSatiri[] = rows.map(r => {
    const n = sayi(r.vergiSifir);
    return {
      ...(p.kolon.vergiPntr ? { vergiIsaretcisi: metin(r.vergiPntr, 20) } : {}),
      ...(ek.kolon.vergisizFl ? { vergisizFl: bayrak(r.vergisizFl) } : {}),
      vergiSifir: n === null ? null : n !== 0,
      adet: sayi(r.adet),
    };
  });
  const desenler = satirlar.filter(r => r.vergiSifir === true)
    .map(r => ({ vergiIsaretcisi: r.vergiIsaretcisi ?? null, vergisizFl: r.vergisizFl ?? null, adet: r.adet }));
  const durum = !p.kolon.vergiPntr || !ek.kolon.vergisizFl ? 'olculemedi' : desenler.length === 0 ? 'yok' : desenler.length === 1 ? 'tek' : 'karisik';
  return { satirlar, kdvsiz: { durum, desenler } };
}

/** (7a) İstenen serinin stok satırları: evrak tipi × `sth_tip` × `sth_cins` × `sth_normal_iade` × `sth_vergisiz_fl` × iptal → adet. */
export function qSatirDeseniSorgusu(p: SthPlani, ek: EkPlan<SthEkAnahtari>, seri: unknown): SorguPlani {
  if (!seriGecerli(seri)) return { atlandi: SERI_BOZUK };
  const { seri: seriK, evraktip, iptal } = p.kolon;
  if (!seriK || !evraktip) return { atlandi: yok(...(['seri', 'evraktip'] as const).filter(a => !p.kolon[a]).map(a => STH_ADLARI[a])) };
  const atlananAlanlar: Record<string, string> = {};
  const secim = [`${evraktip} AS evraktip`], grup = [evraktip];
  for (const a of ['tip', 'cins', 'normalIade', 'vergisizFl'] as const) {
    const k = ek.kolon[a];
    if (k) { secim.push(`${k} AS ${a}`); grup.push(k); } else atlananAlanlar[a] = yok(STH_EK_ADLARI[a]);
  }
  if (iptal) { secim.push(`ISNULL(${iptal}, 0) AS iptal`); grup.push(`ISNULL(${iptal}, 0)`); } else atlananAlanlar.iptal = yok(STH_ADLARI.iptal);
  secim.push('COUNT(*) AS adet');
  return { sql: `SELECT ${secim.join(', ')} FROM STOK_HAREKETLERI WHERE ${seriK} = '${seri}' GROUP BY ${grup.join(', ')} ORDER BY ${grup.join(', ')}`, atlananAlanlar };
}

export interface QSatirDeseni {
  evraktip: number | null; tip?: number | null; cins?: number | null; normalIade?: number | null; vergisizFl?: boolean | null; iptal?: boolean | null;
  adet: number | null;
  /** Yalnız satış satırında (evrak tipi 4): gövde sabitlerinden (1 / 0 / 0 / false) farklı mı; bir kolon okunamadıysa null. */
  sabittenFarkli: boolean | null;
}
export function qSatirDeseniBicimle(rows: readonly Satir[]): QSatirDeseni[] {
  return rows.map(r => {
    const d: QSatirDeseni = { evraktip: sayi(r.evraktip), adet: sayi(r.adet), sabittenFarkli: null };
    for (const a of ['tip', 'cins', 'normalIade'] as const) if (a in r) d[a] = sayi(r[a]);
    if ('vergisizFl' in r) d.vergisizFl = bayrak(r.vergisizFl);
    if ('iptal' in r) d.iptal = bayrak(r.iptal);
    if (d.evraktip === 4 && 'tip' in d && 'cins' in d && 'normalIade' in d && 'vergisizFl' in d
      && d.tip !== null && d.cins !== null && d.normalIade !== null && d.vergisizFl !== null) {
      const s = GOVDE_SATIR_SABITLERI;
      d.sabittenFarkli = d.tip !== s.tip || d.cins !== s.cins || d.normalIade !== s.normalIade || d.vergisizFl !== s.vergisizFl;
    }
    return d;
  });
}

/** (7b) İstenen serinin başlıkları: evrak tipi × cinsi × yön × `cha_normal_Iade` × `cha_cari_cins` × `cha_d_cins` → adet. */
export function qBaslikDeseniSorgusu(p: ChaPlani, ek: EkPlan<ChaEkAnahtari>, seri: unknown): SorguPlani {
  if (!seriGecerli(seri)) return { atlandi: SERI_BOZUK };
  const { seri: seriK, evrakTip, cinsi, tip } = p.kolon;
  if (!seriK || !evrakTip || !cinsi || !tip) {
    return { atlandi: yok(...(['seri', 'evrakTip', 'cinsi', 'tip'] as const).filter(a => !p.kolon[a]).map(a => CHA_ADLARI[a])) };
  }
  const atlananAlanlar: Record<string, string> = {};
  const secim = [`cha.${evrakTip} AS evrakTip`, `cha.${cinsi} AS cinsi`, `cha.${tip} AS tip`];
  const grup = [evrakTip, cinsi, tip].map(k => `cha.${k}`);
  for (const a of ['normalIade', 'cariCins', 'dCins'] as const) {
    const k = ek.kolon[a];
    if (k) { secim.push(`cha.${k} AS ${a}`); grup.push(`cha.${k}`); } else atlananAlanlar[a] = yok(CHA_EK_ADLARI[a]);
  }
  secim.push('COUNT(*) AS adet');
  return { sql: `SELECT ${secim.join(', ')} FROM CARI_HESAP_HAREKETLERI cha WHERE cha.${seriK} = '${seri}' GROUP BY ${grup.join(', ')} ORDER BY ${grup.join(', ')}`, atlananAlanlar };
}

export interface QBaslikDeseni {
  evrakTip: number | null; cinsi: number | null; tip: number | null; normalIade?: number | null; cariCins?: number | null; dCins?: number | null;
  adet: number | null;
  /** Yalnız satış faturası başlığında (fatura koşulu ∧ yön 0): gövde sabitlerinden (0 / 0 / 0) farklı mı; okunamadıysa null. */
  sabittenFarkli: boolean | null;
}
export function qBaslikDeseniBicimle(rows: readonly Satir[]): QBaslikDeseni[] {
  return rows.map(r => {
    const d: QBaslikDeseni = { evrakTip: sayi(r.evrakTip), cinsi: sayi(r.cinsi), tip: sayi(r.tip), adet: sayi(r.adet), sabittenFarkli: null };
    for (const a of ['normalIade', 'cariCins', 'dCins'] as const) if (a in r) d[a] = sayi(r[a]);
    const satis = faturaEvrakiMi(d.evrakTip, d.cinsi) && d.tip === 0;
    const s = GOVDE_BASLIK_SABITLERI;
    if (satis && d.normalIade != null && d.cariCins != null && d.dCins != null) {
      d.sabittenFarkli = d.normalIade !== s.normalIade || d.cariCins !== s.cariCins || d.dCins !== s.dCins;
    }
    return d;
  });
}

/** (8) Şemada adı `vergi` / `kdv` / `istisna` içeren kolonların ADLARI (INFORMATION_SCHEMA — `mikroKolonlar` çıktısı). Değer
 *  kolonu SEÇİLMEZ, yalnız ad listesi: Q3-3'ün «Mikro KDV'siz satırı hangi alanla ifade ediyor» sorusuna aday ad kümesi. */
export const VERGI_KOLON_DESENI = /vergi|kdv|istisna/i;
export function vergiKolonAdlari(sema: readonly string[]): string[] {
  return sema.filter(k => TANIMLAYICI.test(k) && VERGI_KOLON_DESENI.test(k)).sort((a, b) => a.localeCompare(b, 'en'));
}

/** (9) `mikroVergiOranlari()` tablosu + %0'ın işaretçisi (`vergiIsaretcisiCoz(0, tablo)`; tabloda %0 yoksa null). */
export interface VergiTablosuOzeti { tablo: Record<string, number>; sifirIsaretcisi: number | null }
export function vergiTablosuOzeti(tablo: ReadonlyMap<number, number>): VergiTablosuOzeti {
  const t: Record<string, number> = {};
  for (const [sira, oran] of [...tablo.entries()].sort((a, b) => a[0] - b[0])) t[String(sira)] = oran;
  return { tablo: t, sifirIsaretcisi: vergiIsaretcisiCoz(0, tablo) };
}

/** (14) EBELGE_GONDERIM_KUYRUK_LOG'da istenen serinin FATURA başlıklarının ETTN'i (`cha_uuid`, geçerliyse) ya da GUID'i
 *  (`cha_Guid`) geçen satır adedi. Kuyruk tablosunun hangi kolonu evrağı tuttuğu ÖLÇÜLMEDİ → kolon adı TAHMİN EDİLMEZ: şemadaki
 *  HER kolon metne çevrilip (süslü parantez soyulur) karşılaştırılır. Bilinen sınır: bir kolonun tipi metne çevrilemiyorsa (ör.
 *  `image`) Mikro sorguyu reddeder → bölüm `hata` ile döner, diğer bölümler etkilenmez. Tırnaklı sabit YALNIZ seridir. */
export function kuyrukEttnSorgusu(p: ChaPlani, ek: EkPlan<ChaEkAnahtari>, kuyrukSema: readonly string[], seri: unknown): SorguPlani {
  if (!seriGecerli(seri)) return { atlandi: SERI_BOZUK };
  const { seri: seriK, evrakTip, cinsi, uuid } = p.kolon;
  const guid = ek.kolon.guid;
  if (!seriK || !evrakTip || !cinsi) return { atlandi: yok(...(['seri', 'evrakTip', 'cinsi'] as const).filter(a => !p.kolon[a]).map(a => CHA_ADLARI[a])) };
  if (!uuid && !guid) return { atlandi: yok(CHA_ADLARI.uuid, CHA_EK_ADLARI.guid) };
  const kolonlar = kuyrukSema.filter(k => TANIMLAYICI.test(k));
  if (!kolonlar.length) return { atlandi: 'kuyruk tablosunun kolonu yok' };
  const atlananAlanlar: Record<string, string> = {};
  if (!uuid) atlananAlanlar.ettn = yok(CHA_ADLARI.uuid);
  if (!guid) atlananAlanlar.guid = yok(CHA_EK_ADLARI.guid);
  // Süslü parantez soyulur (Mikro uniqueidentifier'ı `{…}` ile döndürebiliyor — lib/gibDurum.faturaEttn notu). NCHAR(123) '{',
  // NCHAR(125) '}' — tırnaklı sabit yazılmaz.
  const metne = (ifade: string) => `REPLACE(REPLACE(CAST(${ifade} AS nvarchar(100)), NCHAR(123), ''), NCHAR(125), '')`;
  const anahtarlar = [
    ...(uuid ? [{ ifade: metne(`cha.${uuid}`), gecerli: `${ettnVarIfadesi(uuid)} = 1` }] : []),
    ...(guid ? [{ ifade: metne(`cha.${guid}`), gecerli: null }] : []),
  ];
  const eslesme = kolonlar.flatMap(k => anahtarlar.map(a => `(${a.gecerli ? `${a.gecerli} AND ` : ''}${metne(`k.${k}`)} = ${a.ifade})`)).join(' OR ');
  return {
    sql: `SELECT COUNT(*) AS adet FROM EBELGE_GONDERIM_KUYRUK_LOG k WHERE EXISTS (SELECT 1 FROM CARI_HESAP_HAREKETLERI cha ` +
      `WHERE cha.${seriK} = '${seri}' AND ${faturaKosuluIfadesi(evrakTip, cinsi)} AND (${eslesme}))`,
    atlananAlanlar,
  };
}
export const kuyrukEttnBicimle = (rows: readonly Satir[]): { adet: number | null } => ({ adet: rows.length ? sayi(rows[0].adet) : null });

// ── Cetpa (PG) ölçümleri (10)(11)(13) — yalnız SELECT, değerler parametreyle ─────────────────────────────────────────────
export type PgSorgu = { sql: string; params: unknown[] };

/** (10) Faturasız Cetpa siparişleri (`faturali === false`): ön koşul kapsamının ham alanları (kimlik okunur ama YANITA GİRMEZ).
 *  MF (`source = MF_KAYNAGI`) DIŞI: QH5 gece geri doldurması MF-Q1'e `faturali: false` yazar; MF kendi Mikro faturasının türevidir,
 *  Cetpa siparişi değildir — (10) havuzuna ve (12) ikiz adayına girerse Q-1 kendi aynasıyla eşleşir, sonuç 03:20 öncesi / sonrası
 *  değişir. `IS DISTINCT FROM`: `source` alanı olmayan (NULL) yerel sipariş dışlanmaz. */
export const FATURASIZ_SIPARIS_SORGUSU: PgSorgu = {
  sql: `SELECT data->>'companyId' AS "companyId", data->'kdvOran' AS "kdvOran", data->'kdvTutari' AS "kdvTutari", ` +
    `data->'totalPrice' AS "totalPrice", data->'lineItems' AS "lineItems", data->'depoNo' AS "depoNo", data->>'leadId' AS "leadId", ` +
    `data->'paid' AS paid, data->'createdAt' AS "createdAt", data->>'status' AS status, data->>'source' AS source, ` +
    `data->>'mikroCariKod' AS "siparisCari" FROM docs WHERE coll = $1 AND data->'faturali' = 'false'::jsonb ` +
    `AND data->>'source' IS DISTINCT FROM $2`,
  params: ['orders', MF_KAYNAGI],
};
/** (10) Faturasız siparişlerin müşteri kayıtları — yalnız cari kodu alanları (Q4-2: `mikroCariKod || cariKod`). */
export const leadCariSorgusu = (idler: readonly string[]): PgSorgu => ({
  sql: `SELECT id, data->>'companyId' AS "companyId", data->>'mikroCariKod' AS "mikroCariKod", data->>'cariKod' AS "cariKod" ` +
    `FROM docs WHERE coll = $1 AND id = ANY($2::text[])`,
  params: ['leads', [...idler]],
});
/** (11) Şubeler: `subeKodu` (SubeModule — Mikro `cha_subeno` ile SAYISAL eşleşir; Cetpa'nın Q'su `cha_subeno 0` taşır). */
export const SUBE_SORGUSU: PgSorgu = {
  sql: `SELECT data->>'companyId' AS "companyId", data->'subeKodu' AS "subeKodu" FROM docs WHERE coll = $1`,
  params: ['subeler'],
};
/** (13) MF siparişleri: ikiz anahtarı (`mikroEvrak`), tutar, yıl (`orderDate`). */
export const MF_IKIZ_SIPARIS_SORGUSU: PgSorgu = {
  sql: `SELECT data->>'companyId' AS "companyId", data->'mikroEvrak'->>'seri' AS seri, data->'mikroEvrak'->>'sira' AS sira, ` +
    `data->'totalPrice' AS "totalPrice", data->>'orderDate' AS "orderDate", data->'mfKaynaksiz' AS "mfKaynaksiz" FROM docs WHERE coll = $1 AND data->>'source' = $2`,
  params: ['orders', MF_KAYNAGI],
};
/** (13) Cetpa `mikroFaturalar` kopyaları — Satışlar'ın gördüğü küme: iptal (`cha_iptal`) ve GİB reddi (`gibRed`) DIŞI
 *  (useMikroFaturalar ile aynı kural), yön `cha_tip` (1 gelen, diğer giden — hook paritesi). */
export const MF_IKIZ_FATURA_SORGUSU: PgSorgu = {
  sql: `SELECT data->>'companyId' AS "companyId", data->>'cha_evrakno_seri' AS seri, data->>'cha_evrakno_sira' AS sira, ` +
    `data->>'cha_tip' AS tip, data->'cha_meblag' AS meblag, data->'cha_iptal' AS iptal, data->'gibRed' AS "gibRed" FROM docs WHERE coll = $1`,
  params: ['mikroFaturalar'],
};
/** (13) Cetpa siparişlerinin Mikro evrak numaraları (`cetpaEvrakNolari` — Satışlar'ın çift sayım elemesi). */
export const CETPA_EVRAK_SORGUSU: PgSorgu = {
  sql: `SELECT data->>'companyId' AS "companyId", data->>'mikroEvrakNo' AS "mikroEvrakNo" FROM docs WHERE coll = $1 ` +
    `AND COALESCE(data->>'mikroEvrakNo', '') <> ''`,
  params: ['orders'],
};

/** createdAt biçimi: sunucu nöbetçisi `{ _seconds, _nanoseconds }`, ISO metni, yok / başka. Ara dönem kapısı (Q5-3) bunu okur. */
export function createdAtBicimi(v: unknown): 'seconds' | 'iso' | 'metin' | 'yok' | 'diger' {
  if (v === null || v === undefined) return 'yok';
  if (typeof v === 'string') return Number.isFinite(Date.parse(v)) ? 'iso' : 'metin';
  if (typeof v === 'object' && v !== null && typeof (v as { _seconds?: unknown })._seconds === 'number') return 'seconds';
  return 'diger';
}
const kalemListesi = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
const doluMetin = (v: unknown): string => String(v ?? '').trim();

export interface LeadCarisi { companyId: string; cari: string }
/** (10) yardımcı: lead kimliği → { kiracı, cari kodu } (`mikroCariKod || cariKod`, kırpılmış). */
export function leadCariHaritasi(rows: readonly Satir[]): Map<string, LeadCarisi> {
  const m = new Map<string, LeadCarisi>();
  for (const r of rows) m.set(String(r.id ?? ''), { companyId: doluMetin(r.companyId), cari: doluMetin(r.mikroCariKod) || doluMetin(r.cariKod) });
  return m;
}

export interface FaturasizHavuzKiracisi {
  adet: number;
  iptal: number;
  /** Mağaza / 'mikro…' kaynaklı (Q'ya yazılmaz — Q1-2). */
  kaynakUygunDegil: number;
  /** `kdvOran` bilinen ve 0 değil · `kdvOran` sayı değil (Q4-3 `kdvVar`'ın iki kolu ayrı). */
  kdvOranSifirDegil: number; kdvOranBilinmiyor: number;
  kdvTutariSifirDegil: number;
  /** Kalem yok ya da bir kalemin fiyat / miktarı okunamıyor · tutar okunamıyor · Σ kuruş(fiyat × miktar) ≠ kuruş(totalPrice). */
  kalemOkunamadi: number; tutarBilinmiyor: number; kalemTutarUyusmuyor: number;
  depoYok: number;
  leadYok: number;
  /** `leadId` var ama kayıt bulunamadı / başka kiracının · lead var ama cari kodu boş. */
  leadBulunamadi: number; leadCarisiz: number;
  odenmis: number;
  createdAt: Record<string, number>;
}
/** Faturasız sipariş satırını ikiz adayı ölçümü (12) için de taşı: çözülen cari + yerel ay + tutar (kimlik YOK). */
export interface FaturasizAday { kiraci: string; cari: string; ay: string | null; tutar: number | null }

export function faturasizHavuzOzeti(rows: readonly Satir[], leadler: ReadonlyMap<string, LeadCarisi>): { kiracilar: Record<string, FaturasizHavuzKiracisi>; adaylar: FaturasizAday[] } {
  const kiracilar: Record<string, FaturasizHavuzKiracisi> = {};
  const adaylar: FaturasizAday[] = [];
  for (const r of rows) {
    const kiraci = kiraciEtiketi(r.companyId);
    let k = Object.prototype.hasOwnProperty.call(kiracilar, kiraci) ? kiracilar[kiraci] : undefined;
    if (!k) {
      k = { adet: 0, iptal: 0, kaynakUygunDegil: 0, kdvOranSifirDegil: 0, kdvOranBilinmiyor: 0, kdvTutariSifirDegil: 0, kalemOkunamadi: 0,
        tutarBilinmiyor: 0, kalemTutarUyusmuyor: 0, depoYok: 0, leadYok: 0, leadBulunamadi: 0, leadCarisiz: 0, odenmis: 0, createdAt: {} };
      kiracilar[kiraci] = k;
    }
    k.adet++;
    if (r.status === 'Cancelled') k.iptal++;
    const kaynak = doluMetin(r.source);
    if (kaynak.startsWith('mikro') || kaynak === MAGAZA_KAYNAGI) k.kaynakUygunDegil++;
    if (!bilinenSayi(r.kdvOran)) k.kdvOranBilinmiyor++; else if (Number(r.kdvOran) !== 0) k.kdvOranSifirDegil++;
    if (bilinenSayi(r.kdvTutari) && Number(r.kdvTutari) !== 0) k.kdvTutariSifirDegil++;
    const kalemler = kalemListesi(r.lineItems);
    const satirlar = kalemler.map(x => satirTutari(x.price, x.quantity));
    const kalemToplami = satirlar.length && satirlar.every(Number.isFinite) ? kurusaYuvarla(satirlar.reduce((a, b) => a + b, 0)) : NaN;
    const tutar = bilinenSayi(r.totalPrice) ? kurusaYuvarla(Number(r.totalPrice)) : NaN;
    if (!Number.isFinite(kalemToplami)) k.kalemOkunamadi++;
    if (!Number.isFinite(tutar)) k.tutarBilinmiyor++;
    if (Number.isFinite(kalemToplami) && Number.isFinite(tutar) && kalemToplami !== tutar) k.kalemTutarUyusmuyor++;
    if (doluMetin(r.depoNo) === '') k.depoYok++;
    const leadId = doluMetin(r.leadId);
    let cari = '';
    if (!leadId) k.leadYok++;
    else {
      const l = leadler.get(leadId);
      // Kiracı süzgeci (tenant deseni): başka kiracının kaydı «bulunamadı» sayılır; etiketsiz eski kayıt eşleşir.
      if (!l || (l.companyId && l.companyId !== doluMetin(r.companyId))) k.leadBulunamadi++;
      else if (!l.cari) k.leadCarisiz++;
      else cari = l.cari;
    }
    if (r.paid === true) k.odenmis++;
    say(k.createdAt, createdAtBicimi(r.createdAt), 1);
    const gun = gunAnahtari(r.createdAt);
    // (12) Ek güvence (SQL süzgecinin yanında): 'mikro…' kaynaklı satır (MF) kendi Mikro faturasının türevidir, ikiz adayı DEĞİLDİR —
    // kendi başlığıyla eşleşir. Sayaç (`kaynakUygunDegil`) yukarıda aynen sayılır; mağaza satırı aday listesinde kalır.
    if (!kaynak.startsWith('mikro')) adaylar.push({ kiraci, cari: cari || doluMetin(r.siparisCari), ay: gun ? gun.slice(0, 7) : null, tutar: Number.isFinite(tutar) ? tutar : null });
  }
  return { kiracilar, adaylar };
}

/** (11) Kiracı × { şube adedi, `subeKodu` SAYISAL 0 olan şube adedi } — SubeModule eşleşmesi sayısal. */
export function subeOzeti(rows: readonly Satir[]): Record<string, { toplam: number; kodSifir: number }> {
  const o: Record<string, { toplam: number; kodSifir: number }> = {};
  for (const r of rows) {
    const kiraci = kiraciEtiketi(r.companyId);
    const k = Object.prototype.hasOwnProperty.call(o, kiraci) ? o[kiraci] : (o[kiraci] = { toplam: 0, kodSifir: 0 });
    k.toplam++;
    if (bilinenSayi(r.subeKodu) && Number(r.subeKodu) === 0) k.kodSifir++;
  }
  return o;
}

/** (12) Mikro'daki istenen seri FATURA başlıklarının (3) Cetpa'da faturasız ikiz ADAYI: aynı cari + aynı ay. Kimlik dökülmez —
 *  başlık sırası, ay, aday adedi ve tutarlar. Bulunursa kullanıcıya örnekle sorulur «aynı satış mı?». */
export interface QIkizAdayi { sira: number | null; ay: string | null; adayAdet: number; adayTutarlari: Array<number | null> }
export function qIkizAdaylari(basliklar: readonly BaslikOzeti[], adaylar: readonly FaturasizAday[]): QIkizAdayi[] {
  return basliklar.filter(b => b.faturaKosulu === true && b.tip === 0).map(b => {
    const ay = typeof b.tarih === 'string' && /^\d{4}-\d{2}/.test(b.tarih) ? b.tarih.slice(0, 7) : null;
    const cari = doluMetin(b.cariKod);
    const eslesen = ay && cari ? adaylar.filter(a => a.cari === cari && a.ay === ay) : [];
    return { sira: b.sira, ay, adayAdet: eslesen.length, adayTutarlari: eslesen.map(a => a.tutar).sort((x, y) => (x ?? -Infinity) - (y ?? -Infinity)) };
  });
}

export interface SatisCiftSayimKiracisi {
  /** MF siparişi adedi ve `totalPrice` toplamı (bilinmeyen 0 sayılmaz). */
  mfAdet: number; mfTutar: Tutar;
  /** `seri|yıl` (yıl `orderDate`'ten; okunamazsa '(tarihsiz)') → adet + tutar. */
  seriYil: Record<string, { adet: number; tutar: Tutar }>;
  /** İkizi Satışlar'ın gördüğü Mikro giden kümesinde OLAN MF (QH2 anahtarı): adet, MF tutarı, aynı faturaların Mikro meblağı. */
  ikizliMfAdet: number; ikizliMfTutar: Tutar; ikizliMikroTutar: Tutar;
  /** İkizi OLMAYAN ve kaynaksız işareti TAŞIMAYAN MF — Satışlar'da listede kalır, bir kez sayılır (QH2-1). */
  ikizsizMfAdet: number;
  /** İkizi OLMAYAN, kaynaksız işaretli MF (şartname «Mikro bağlantı B» BH8; istemci `satisCiftSayimOzeti.kaynaksiz*` ile AYNI ayrık
   *  sayaç): Satışlar'da listeden düşer. Önce / sonra ölçüsü (§ 4.5) bununla okunur. */
  kaynaksizMfAdet: number; kaynaksizMfTutar: Tutar;
  /** `cetpaEvrakNolari` ile Satışlar'dan elenen Mikro giden satırı (sipariş evrak no ↔ fatura no karşılaştırması; değişmez — QH8-4). */
  cetpaEvrakIleElenen: number;
  /** Kiracının gördüğü (kendi + etiketsiz) iptal / red dışı Mikro giden fatura adedi. */
  mikroGidenAdet: number;
}
/** (13) Satışlar «Tümü» çift sayımının KESİN boyutu — istemcideki `satisIkizAnahtarlari` + `mfIkiziListede` ile AYNI kural (anahtar
 *  lib/mfKaynagi.mikroFaturaAnahtari; yıl / arama süzgeci öncesi). Kiracı kümesi: kendi etiketli + etiketsiz Mikro faturası
 *  (`/api/db` kiracı süzgeci paritesi). QH4-8 çapraz ölçüsü: «Tüm yıllar × Tümü» ekran notu ≈ `ikizliMfTutar`. */
export function satisCiftSayimOlcumu(mfRows: readonly Satir[], faturaRows: readonly Satir[], evrakRows: readonly Satir[]): Record<string, SatisCiftSayimKiracisi> {
  const giden = faturaRows.filter(f => !(f.iptal === true || Number(f.iptal ?? 0) === 1) && f.gibRed !== true && Number(f.tip ?? 0) !== 1)
    .map(f => ({ kiraci: doluMetin(f.companyId), no: mikroFaturaAnahtari(f.seri, f.sira), meblag: f.meblag }));
  const sonuc: Record<string, SatisCiftSayimKiracisi> = {};
  const kiracilarMf = new Map<string, Satir[]>();
  for (const r of mfRows) {
    const k = doluMetin(r.companyId);
    const l = kiracilarMf.get(k);
    if (l) l.push(r); else kiracilarMf.set(k, [r]);
  }
  for (const [kiraci, mfler] of kiracilarMf) {
    const evrak = new Set(evrakRows.filter(e => !doluMetin(e.companyId) || doluMetin(e.companyId) === kiraci).map(e => doluMetin(e.mikroEvrakNo)).filter(Boolean));
    const gorunen = giden.filter(f => !f.kiraci || f.kiraci === kiraci);
    // Anahtar → o faturanın TÜM giden başlıklarının meblağı: içe aktarım her başlığı ayrı doküman (cha_Guid) yazar, iki başlıklı
    // fatura (canlıda giden 246: 12.000 + 3.000) aynı anahtarda iki satırdır; Satışlar ikisini de sayar. Sorguda ORDER BY yok —
    // «ilk başlık» belirsizdi.
    const ikizler = new Map<string, unknown[]>();
    let elenen = 0;
    for (const f of gorunen) {
      if (!f.no) continue;
      if (evrak.has(f.no)) { elenen++; continue; }
      const l = ikizler.get(f.no);
      if (l) l.push(f.meblag); else ikizler.set(f.no, [f.meblag]);
    }
    const ikizliMi = (r: Satir) => { const a = mikroFaturaAnahtari(r.seri, r.sira); return a !== '' && ikizler.has(a); };
    const ikizli = mfler.filter(ikizliMi);
    // Kaynaksız işareti (B2): `mfKaynaksizMi` ile AYNI ölçüt (satır zaten MF kaynağından; işaret `true` olmalı).
    const kaynaksiz = mfler.filter(r => r.mfKaynaksiz === true && !ikizliMi(r));
    const seriYil: Record<string, { adet: number; tutar: Tutar }> = {};
    for (const r of mfler) {
      const yil = /^\d{4}/.test(doluMetin(r.orderDate)) ? doluMetin(r.orderDate).slice(0, 4) : '(tarihsiz)';
      const anahtar = `${etiket(r.seri)}|${yil}`;
      const onceki = Object.prototype.hasOwnProperty.call(seriYil, anahtar) ? seriYil[anahtar] : { adet: 0, tutar: paraToplaBilinen([], x => x) };
      seriYil[anahtar] = { adet: onceki.adet + 1, tutar: tutarBirlestir(onceki.tutar, paraToplaBilinen([r], x => x.totalPrice)) };
    }
    sonuc[kiraciEtiketi(kiraci)] = {
      mfAdet: mfler.length, mfTutar: paraToplaBilinen(mfler, r => r.totalPrice), seriYil,
      ikizliMfAdet: ikizli.length, ikizliMfTutar: paraToplaBilinen(ikizli, r => r.totalPrice),
      ikizliMikroTutar: paraToplaBilinen(ikizli.flatMap(r => ikizler.get(mikroFaturaAnahtari(r.seri, r.sira)) ?? []), x => x),
      ikizsizMfAdet: mfler.length - ikizli.length - kaynaksiz.length,
      kaynaksizMfAdet: kaynaksiz.length, kaynaksizMfTutar: paraToplaBilinen(kaynaksiz, r => r.totalPrice),
      cetpaEvrakIleElenen: elenen, mikroGidenAdet: gorunen.length,
    };
  }
  return sonuc;
}
