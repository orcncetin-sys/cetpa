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
import { iptalMi } from './faturaTani.js';
import { kes } from './ebelgeDurumTani.js';

// ── Seri ─────────────────────────────────────────────────────────────────────
/** Seri biçimi (şartname Q1-7). Seri değeri SQL metnine YALNIZ bu desenden geçtikten sonra girer. */
export const SERI_BICIMI = /^[A-Za-z0-9]{1,20}$/;
export const seriGecerli = (v: unknown): v is string => typeof v === 'string' && SERI_BICIMI.test(v);
/** Cetpa (PG) tarafında seri karşılaştırma anahtarı: kırpılmış + ASCII büyük harfe katlanmış (şartname Q2: 'q' ile 'Q' aynı
 *  seridir). KOD KİMLİĞİ karşılaştırmasıdır, ekrana basılmaz — burada `toUpperCase()` doğru olandır (CLAUDE.md «karşılaştırmada
 *  tersi geçerli»); saklanan yazım `yazimlar` kırılımında AYNEN görünür. */
export const seriAnahtari = (v: unknown): string => String(v ?? '').trim().toUpperCase();

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

/** Fatura başlığı koşulu (takma ad `cha`) — `mikroRoutes.ts` `FATURA_EVRAK_KOSULU` ile AYNI küme (SATIŞ = evrak tipi 63,
 *  ALIŞ = evrak tipi 0 + cinsi 6). Kolon adları şemadan süzülmüş kümeden gelir; iki metnin eşitliği testte çitlidir. */
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
 *  aynen yazar: eslemeFatura.ts `faturaEsle`; fatura-tani de aynı alanı okur). Seri eşlemesi JS'te (`seriAnahtari`) — PG `upper()`
 *  veritabanı yereline bağlıdır. Yalnız SELECT; değer parametreyle. */
export const CETPA_FATURA_SORGUSU: { sql: string; params: string[] } = {
  sql: `SELECT data->>'companyId' AS "companyId", data->>'cha_evrakno_seri' AS seri, COUNT(*)::int AS adet FROM docs WHERE coll = $1 GROUP BY 1, 2`,
  params: ['mikroFaturalar'],
};
/** (5) Mikro faturasından türeyen siparişler (`source = 'mikro-fatura'`, eslemeFatura.ts:381): kiracı × `mikroEvrak.seri`
 *  (eslemeFatura.ts:382) × `faturali` değeri → adet. `jsonb_typeof` alanın YOKLUĞUNU (NULL) JSON null / boolean / başka tipten ayırır. */
export const CETPA_SIPARIS_SORGUSU: { sql: string; params: string[] } = {
  sql: `SELECT data->>'companyId' AS "companyId", data->'mikroEvrak'->>'seri' AS seri, jsonb_typeof(data->'faturali') AS tur, ` +
    `data->>'faturali' AS deger, COUNT(*)::int AS adet FROM docs WHERE coll = $1 AND data->>'source' = $2 GROUP BY 1, 2, 3, 4`,
  params: ['orders', 'mikro-fatura'],
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
}
export function cetpaSiparisOzeti(rows: readonly Satir[], seri: string): CetpaSiparisOzeti {
  const hedef = seriAnahtari(seri);
  const ozet: CetpaSiparisOzeti = { adet: 0, faturali: { true: 0, false: 0, yok: 0, diger: 0 }, kiracilar: {}, yazimlar: {}, toplamMikroFaturaSiparisi: 0 };
  for (const r of rows) {
    const n = pgAdet(r.adet);
    ozet.toplamMikroFaturaSiparisi += n;
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
