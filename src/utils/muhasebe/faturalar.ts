/**
 * faturalar.ts — Muhasebe › Faturalar sekmesinin HESAPLARI, tek kaynak (Faz 3 2/n, 2026-09-14).
 * Test: faturalar.test.ts (ÖNCE yazıldı).
 *
 *   • Mikro fatura satırları (yön / yıl / e-belge türü / çift-sayım süzgeçleri + sıralama)
 *       AccountingModule.tsx 1729-1776 `mikroFaturaSatirlari`  → FaturalarTab'a prop
 *   • Faturalar KPI kartları (adet, satış tutarı, alış tutarı, e-Fatura/e-Arşiv sayacı)
 *       FaturalarTab.tsx 140-165
 *   • Fatura kesme tutarları (KDV hariç / KDV)
 *       AccountingModule.tsx 397-420 `handleCreateInvoice`
 *
 * NEDEN VAR — sahte kesinlik siteleri (CLAUDE.md: sayısal alanda `|| 0` / `?? 0` YASAK):
 *   AccountingModule 400   totalPrice = src.totalPrice || 0      tutarı bilinmeyen sipariş ₺0 FATURA olarak kaydediliyordu
 *   AccountingModule 1764  a.tutar - b.tutar                      null tutar `null - x` ile 0 gibi ortaya diziliyordu
 *   AccountingModule 1766  (a.kdv ?? 0) - (b.kdv ?? 0)            KDV'si bilinmeyen satır 0 gibi sıralanıyordu
 *   FaturalarTab 155       invoices.reduce(totalPrice || 0)       tutarı bilinmeyen Cetpa faturası 0 sayılıyordu
 *   FaturalarTab 156-157   reduce(a + f.tutar)                    Mikro tutarı toplama girmeden önce bilinen mi bakılmıyordu
 *
 * Kural: bilinmeyen tutar toplama GİRMEZ, SAYILIR (`Tutar.bilinmeyen`); ekran `ekranTutari` ile '—' basar ve
 * "N kayıt tutarsız" notu düşer. Sıralamada bilinmeyen 0 sayılmaz, listenin SONUNA gider (`sayiSirala`).
 * Fatura keserken tutar ya da oran bilinmiyorsa null döner — sayfa kaydetmez (toast), `kdvOran || 20` yok.
 *
 * SAYFA PARİTESİ: bilinen girdiyle eski zincir/formülle AYNI sıra ve sayı (test: eski zincirin birebir kopyasıyla
 * 9 filtre×sıralama kombinasyonu + KPI formülü). Dışlamalar (yön, yıl, e-belge türü, Cetpa evrak no ile çift sayım)
 * aynen korunur. Bilinçli farklar: (1) sıralamada bilinmeyen her iki yönde de sonda — eskiden azalanda başa geliyordu;
 * (2) KPI toplamına bilinmeyen girmez, sayılır; (3) tutarı bilinmeyen fatura KAYDEDİLMEZ (eskiden ₺0/₺0/₺0 yazılıyordu).
 *
 * Girdi tipleri MİNİMAL ve yapısal (`MikroFatura`/`Order`/`Customer`'a bağlı DEĞİL) — hook `tutar: number` verse de
 * DB/Mikro'dan null gelebilir; `number` tipi dolu demek değildir.
 *
 * (Faz 3 2/n, 2026-09-18) Eski sınır KALKTI: `useMikroFaturalar.mapMikroFatura` bilinmeyen tutar/kdv/matrahı
 * artık NaN veriyor ve mikroRoutes'taki `ISNULL(…, 0)` son yedeği kaldırıldı — Mikro satırlarında `bilinmeyen`
 * sayacı gerçekten dolar. Bu modül zaten hazırdı (tutar/kdv `unknown` okunur).
 */
import { bilinenSayi, kdvAyristir, sayiSirala, toplaBilinen, tutarBirlestir, type Tutar } from '../para';

export type { Tutar };

// ── Mikro fatura satırları (AccountingModule 1729-1776) ────────────────────────────────────────

export type FaturaYonu = 'hepsi' | 'giden' | 'gelen';
export type EbelgeFiltresi = 'all' | 'e-fatura' | 'e-arsiv' | 'ihracat';
/** Satışlar sekmesinin sıralama anahtarı (`satisSortKey`); `faturali` Mikro satırında yok → tarihe düşer (eski davranış). */
export type FaturaSiralamaAnahtari = 'customerName' | 'totalPrice' | 'kdvOran' | 'date' | 'faturali';

/** Hook'un `MikroFatura`sı uyar; yalnız süzgeç/sıralamanın okuduğu alanlar, sayısal olanlar `unknown`. */
export interface MikroFaturaGirdi {
  yon?: string;
  tarih?: unknown;
  faturaNo?: string;
  cariKod?: string;
  ebelgeTuru?: unknown;
  tutar?: unknown;
  kdv?: unknown;
}

export interface MikroFaturaSecim {
  /** Faturalar sekmesi yön filtresi (`faturaYon`). */
  yon: FaturaYonu;
  /** 'YYYY' ya da 'hepsi' (`faturaYil`). */
  yil: string;
  /** e-belge türü filtresi (`invoiceTypeFilter`). */
  ebelgeTuru: EbelgeFiltresi;
  /** Cetpa siparişlerinin Mikro'ya yazılmış evrak numaraları — çift sayım elemesi (`cetpayaAitEvrakNo`). */
  cetpaEvrakNolari: ReadonlySet<string>;
  /** Mikro cari kodu → Cetpa müşteri adı (`cariAdMap`). */
  cariAdMap: ReadonlyMap<string, string>;
  /** Verilmezse giriş sırası korunur. Kaynakta Satışlar sekmesinin `satisSortKey`/`satisSortDir`i kullanılıyordu. */
  sirala?: { anahtar: FaturaSiralamaAnahtari; yon: 'asc' | 'desc' };
}

/**
 * Mikro faturaları Faturalar sekmesi için süzer, müşteri adını bağlar, istenirse sıralar.
 *
 * MÜKERRER SAYIM ELEMESİ: Cetpa siparişi Mikro'ya gönderildiğinde evrak no `mikroEvrakNo` alanına geri
 * yazılıyor. Aynı satış iki kez görünmesin diye o evrak numaralarına sahip Mikro faturaları listelenmez.
 *
 * Faturalar sekmesi yön filtresine uyar; Satışlar sekmesi yalnız GİDEN fatura gösterir — satış tanımı gereği.
 *
 * ARAMA FİLTRESİ BURADA YOK (2026-08-28): `satisSearch` ile süzülüyordu ama bu liste yalnızca Faturalar
 * sekmesinde kullanılıyor; Satışlar'ın arama kutusu Faturalar listesini sessizce süzüyor, Faturalar'daki
 * arama ise Mikro satırlarına hiç değmiyordu. Filtre artık FaturalarTab'ın kendi tablosunda `invoiceSearch`
 * ile uygulanıyor — Cetpa faturalarıyla AYNI desende (KPI'lar tam listeyi, tablo süzülmüş listeyi gösterir).
 */
export function mikroFaturaSatirlari<F extends MikroFaturaGirdi>(
  faturalar: readonly F[], s: MikroFaturaSecim,
): Array<F & { musteri: string }> {
  const satirlar = faturalar
    .filter(f => s.yon === 'hepsi' || f.yon === s.yon)
    // Yıl filtresi: tarih 'YYYY-...' ile başlıyorsa o yıl. 'hepsi' → tüm yıllar.
    .filter(f => s.yil === 'hepsi' || (typeof f.tarih === 'string' && f.tarih.startsWith(s.yil)))
    .filter(f => !f.faturaNo || !s.cetpaEvrakNolari.has(f.faturaNo))
    // e-belge türü filtresi (eskiden yalnız Cetpa invoices'a uygulanıyordu):
    // 0=e-Fatura, 1=e-Arşiv, 2=e-İrsaliye. Tür BİLİNMİYORSA (-1: cha_ebelge_turu
    // Mikro'da dolu değil) filtreden GİZLEME — aksi halde alan boşsa e-Fatura/e-Arşiv
    // seçince liste bombos görünür. Yalnız KESİN karşıt türü ele; İhracat türü
    // cha_ebelge_turu'da YOK (ayrı kavram) → o filtrede Mikro faturası gösterilmez.
    .filter(f => {
      if (s.ebelgeTuru === 'all') return true;
      if (s.ebelgeTuru === 'e-fatura') return f.ebelgeTuru === 0 || f.ebelgeTuru === -1;
      if (s.ebelgeTuru === 'e-arsiv') return f.ebelgeTuru === 1 || f.ebelgeTuru === -1;
      return false; // ihracat
    })
    .map(f => { const kod = f.cariKod ?? ''; return { ...f, musteri: s.cariAdMap.get(kod) || kod || '—' }; });
  if (!s.sirala) return satirlar;
  const azalan = s.sirala.yon === 'desc';
  const isaret = azalan ? -1 : 1;
  const anahtar = s.sirala.anahtar;
  return satirlar.sort((a, b) =>
    anahtar === 'customerName' ? isaret * a.musteri.localeCompare(b.musteri, 'tr')
    : anahtar === 'totalPrice' ? sayiSirala(a.tutar, b.tutar, azalan)
    // "KDV%" kolonu Mikro satırlarında tutar+oranı birlikte gösteriyor
    // (₺13.333,34 (%20)) ama neredeyse her satır aynı %20 oranı taşıyor —
    // orana göre sıralamak görsel olarak "rastgele" görünüyordu (2026-08-17
    // bildirimi). Görünen ve değişkenlik gösteren asıl değer tutar (kdv).
    : anahtar === 'kdvOran' ? sayiSirala(a.kdv, b.kdv, azalan)
    : isaret * String(a.tarih ?? '').localeCompare(String(b.tarih ?? '')),
  );
}

/**
 * Evrak no kümesi (`orders[].mikroEvrakNo`, kırpılmış, boşlar atlanır) ve Mikro cari kodu → müşteri adı
 * haritası (`customers[].mikroCariKod`; kodsuz müşteri girmez).
 *
 * TEK EV `satislar.ts` — Satışlar sekmesi aynı iki yardımcıyı kullanıyor ve AccountingModule ikisini de
 * oradan bağlıyor (2026-09-18). Burada KOPYA durmuyor, yalnız yeniden dışa aktarılıyor: iki ayrı
 * gerçekleştirim "kırp + boşu atla" kuralında sessizce ayrışabilirdi.
 */
export { cetpaEvrakNolari, cariAdHaritasi } from './satislar';

// ── Tablo sıralaması (FaturalarTab 288-352) ────────────────────────────────────────────────────

/**
 * Faturalar TABLOSUNUN kendi sıralaması — yukarıdaki `mikroFaturaSatirlari` sıralamasından AYRI bir
 * yüzeydir ve EKRANDAKİ SON SIRAYI BU BELİRLER: sekme, listeyi kolon başlığına (`invoiceSort`) göre
 * yeniden sıralar (modüle giden `sirala` Satışlar sekmesinin state'ini taşıyor — bkz. AccountingModule
 * 1712 uyarısı). Cetpa `invoices` bloğu ve Mikro bloğu aynı başlıkları paylaşır, ikisi de buradan geçer.
 *
 * NEDEN BURADA (2026-09-18 hakem turu): sekmedeki karşılaştırıcı `av < bv / av > bv / return 0` idi.
 * NaN her iki karşılaştırmada da false döndürür, yani NaN "her şeye eşit" sayılır ve karşılaştırıcı
 * TUTARSIZ olur — tek bir bilinmeyen satır BİLİNEN satırların sırasını da bozar. `useMikroFaturalar`
 * bilinmeyen tutar/kdv/matrahı artık NaN verdiği için (aynı gün) bu ekranda gerçekleşebilir hâle geldi:
 * matrah [5000, NaN, 3000, 9000, NaN, 1000] girdisiyle artan sıra `5000, NaN, 3000, 9000, NaN, 1000`,
 * yani liste hiç sıralanmıyordu. Modüldeki `sayiSirala` düzeltmesi ekranda etkisiz kalıyordu.
 * Kural sekmede KOPYA durmuyor: modülü düzeltip ekrandaki kopyayı bırakmak tam bu arızayı üretti
 * (CLAUDE.md "yarım düzeltme sınıfı" — yardımcıyı paylaşılan modüle koy).
 *
 * Eski Cetpa faturalarında `kdvOran`/`kdvHaric` hiç yok (FaturalarTab 313 bu yüzden '%undefined' yerine
 * '—' basıyor) — orada da bilinmeyen 0 sayılıp başa dizilmemeli.
 *
 * SAYFA PARİTESİ: METİN kolonlarında eski ham `<`/`>` karşılaştırması AYNEN korunur (eksik alan `''`),
 * yani BİLİNEN değerlerin sırası değişmez. Tek fark sayısal kolonlarda: bilinmeyen 0 sayılmaz, her iki
 * yönde de SONA gider (`para.sayiSirala`).
 */
const SAYISAL_KOLONLAR: ReadonlySet<string> = new Set(['kdvOran', 'kdvHaric', 'totalPrice']);

/** Satır alanını adıyla oku — satır tipleri (MikroFatura arayüzü / `Record<string, unknown>`) ortak değil. */
const alanOku = (satir: unknown, alan: string): unknown => (satir as Record<string, unknown>)[alan];

/**
 * Kolon başlığının `sortKey`i için karşılaştırıcı üretir.
 * @param alanEslesme kolon `sortKey`i → satırdaki alan adı (Mikro satırı: `kdvHaric`→`matrah` gibi).
 *   Verilmezse alan adı kolon adının kendisidir (Cetpa `invoices` dokümanı). Eşlemede OLMAYAN kolon
 *   (ör. Mikro satırında `status`) sırayı bozmaz — eski `if (!key) return 0` davranışı.
 */
export function faturaSatirKarsilastir<R>(
  kolon: string, yon: 'asc' | 'desc', alanEslesme?: Readonly<Record<string, string>>,
): (a: R, b: R) => number {
  const alan = alanEslesme ? alanEslesme[kolon] : kolon;
  if (!alan) return () => 0;
  const azalan = yon === 'desc';
  if (SAYISAL_KOLONLAR.has(kolon)) return (a, b) => sayiSirala(alanOku(a, alan), alanOku(b, alan), azalan);
  const isaret = azalan ? -1 : 1;
  return (a, b) => {
    const av = (alanOku(a, alan) as string | number) ?? '';
    const bv = (alanOku(b, alan) as string | number) ?? '';
    return av < bv ? -isaret : av > bv ? isaret : 0;
  };
}

// ── KPI kartları (FaturalarTab 140-165) ────────────────────────────────────────────────────────

export type FaturaKaynagi = 'cetpa' | 'mikro' | 'hepsi';
/** Cetpa'da kesilen fatura (`invoices` dokümanı) — yalnız KPI'nın okuduğu alanlar. */
export interface CetpaFaturaGirdi { totalPrice?: unknown; faturaTipi?: unknown }
/** `mikroFaturaSatirlari` çıktısının KPI'ya giren alanları. */
export interface MikroKpiGirdi { yon?: string; tutar?: unknown }

export interface FaturaKpi {
  /** Toplam Fatura kartı: Cetpa + Mikro (kaynak filtresine göre). */
  adet: number;
  cetpaAdet: number;
  mikroAdet: number;
  mikroGidenAdet: number;
  mikroGelenAdet: number;
  /** Yalnız Cetpa (Mikro'da tür bilgisi bu karta girmez). */
  eFaturaAdet: number;
  eArsivAdet: number;
  /** Cetpa + Mikro-giden. Ekran: `paraYaz(ekranTutari(satis))`; `bilinmeyen > 0` ise "N kayıt tutarsız" notu. */
  satis: Tutar;
  /** Mikro-gelen. */
  alis: Tutar;
}

/**
 * KPI'lar KAYNAK FİLTRESİNE UYAR — 320 Mikro faturası varken "Toplam Fatura 0" göstermek yanlıştı (2026-08-01).
 * Cetpa sayıları invoices'tan, Mikro sayısı mikroFaturaSatirlari'ndan.
 *
 * YÖN KIRILIMI (2026-08-01): "Toplam Tutar" önce satış (giden) ve alış (gelen) faturalarının tutarlarını
 * TOPLUYORDU → "Her Yön"de 148M gibi anlamsız bir birleşik rakam çıkıyordu (kullanıcı haklı olarak reddetti).
 * Satış cirosu ile alış gideri toplanmaz. Cetpa + Mikro-giden = satış tarafı (doğrulanmış); Mikro-gelen = alış
 * tarafı. ⚠️ Alış toplamı cha_cinsi=6 filtresine dayanıyor, henüz portal raporuyla tie-out edilmedi — o yüzden
 * ayrı, satışa karıştırılmadan gösteriliyor.
 *
 * Boş liste GERÇEK 0 (hareketsiz dönem); tutarı bilinmeyen kayıt toplama girmez, `bilinmeyen` sayılır.
 */
export function faturaKpi(
  invoices: readonly CetpaFaturaGirdi[], mikroSatirlari: readonly MikroKpiGirdi[], s: { kaynak: FaturaKaynagi },
): FaturaKpi {
  const cetpa = s.kaynak !== 'mikro' ? invoices : [];
  const mikro = s.kaynak !== 'cetpa' ? mikroSatirlari : [];
  const mikroGiden = mikro.filter(f => f.yon === 'giden');
  const mikroGelen = mikro.filter(f => f.yon === 'gelen');
  return {
    adet: cetpa.length + mikro.length,
    cetpaAdet: cetpa.length,
    mikroAdet: mikro.length,
    mikroGidenAdet: mikroGiden.length,
    mikroGelenAdet: mikroGelen.length,
    eFaturaAdet: cetpa.filter(i => i.faturaTipi === 'e-fatura').length,
    eArsivAdet: cetpa.filter(i => i.faturaTipi === 'e-arsiv').length,
    satis: tutarBirlestir(toplaBilinen(cetpa, i => i.totalPrice), toplaBilinen(mikroGiden, f => f.tutar)),
    alis: toplaBilinen(mikroGelen, f => f.tutar),
  };
}

// ── Fatura kesme tutarları (AccountingModule 397-420) ──────────────────────────────────────────

export interface FaturaTutarlari { toplam: number; kdvHaric: number; kdvTutari: number }

/**
 * Kesilecek faturanın toplam / KDV hariç / KDV tutarı — `invoices` dokümanına yazılan üç alan.
 * Brüt ya da oran bilinmiyorsa (ya da ikisinden biri negatifse) null: sayfa toast basar ve KAYDETMEZ.
 *
 * EKSİ BRÜT (2026-09-18 hakem turu): modaldaki "Toplam (KDV Dahil)" alanı `min="0"` diyor ama modalda
 * `<form>` YOK — buton doğrudan `handleCreateInvoice`'u çağırıyor, yani tarayıcı `min`'i hiç zorlamıyor
 * ve `-100` eksi tutarlı bir e-fatura olarak kaydedilip "başarıyla kesildi" toast'ı basılıyordu.
 * Oran zaten negatifken eleniyordu (`kdvAyristir`), brüt elenmiyordu. 0 ELENMEZ: `min="0"` 0'a izin
 * veriyor ve açık 0 BİLİNEN bir sayıdır (bedelsiz/numune faturası) — bilinmeyenle karıştırma. İade/eksi
 * fatura gerçekten gerekirse bu ayrı bir ürün kararıdır (o zaman `min` özniteliği de kalkmalı).
 *
 * BRÜT NEREDEN GELİR (bağlama kararı, 2026-09-18): sipariş bağlıysa `invoiceSource.totalPrice`,
 * değilse modaldaki "Toplam (KDV Dahil)" alanı (`invoiceForm.tutar`, metin — `bilinenSayi` sayısal
 * string kabul eder). `setInvoiceSource` kod tabanında hiçbir yerden dolu çağrılmıyordu, yani tek
 * kaynak eski hâliyle `undefined`dı ve her fatura ₺0/₺0/₺0 kaydediliyordu; alan o boşluğu kapatıyor.
 * Siparişten "Fatura Kes" akışının bağlanması ayrı iş (Açık İşler).
 * Yuvarlama eski kodla birebir: KDV hariç 2 haneye yuvarlanır, KDV = toplam − yuvarlı KDV hariç (yine 2 hane)
 * — böylece kdvHaric + kdvTutari her zaman toplam eder.
 */
export function faturaTutarlari(totalPrice: unknown, kdvOran: unknown): FaturaTutarlari | null {
  const ayrim = kdvAyristir(totalPrice, kdvOran);
  if (!ayrim || !bilinenSayi(totalPrice)) return null;
  const toplam = Number(totalPrice);
  if (toplam < 0) return null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const kdvHaric = round2(ayrim.net);
  return { toplam, kdvHaric, kdvTutari: round2(toplam - kdvHaric) };
}
