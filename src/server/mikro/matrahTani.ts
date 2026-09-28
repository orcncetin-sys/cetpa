/**
 * matrahTani.ts — fatura MATRAHININ doğru tanımını ÖLÇMEK için (2026-09-28). Kural yazmaz, hüküm vermez, hiçbir yere yazmaz.
 *
 * NEDEN VAR — fatura-listesi importu `SUM(sth_tutar)` yazıyor; canlı ölçüm sth_tutar'ın BRÜT olduğunu gösterdi (iskontolu
 * faturada matrah iskonto kadar şişik → Mizan 600/153, KDV kırılımı, 617, Gelir/Gider, Faturalar). Tanımı düzeltmeden önce
 * açık üç soru (kapsam haritası 2026-09-28 §6) veriyle kapatılır:
 *   1. Başlık toplamı (cha_meblag) satırlardan hangi formülle çıkıyor — (tutar − Σiskonto + Σmasraf) + Σvergi mi, masraf KDV'si
 *      (sth_masraf_vergi) ayrıca mı ekleniyor, yoksa iskonto düşülmeden mi (sth_tutar zaten net)?
 *   2. cha_aratoplam ne — brüt (Σtutar), net (Σtutar − Σisk), net + masraf, meblağ − KDV?
 *   3. Kaç fatura satırsız (yedeğe düşüyor), kaçında başlık satırlardan AZ (satıra dağıtılmamış fatura altı iskonto / tevkifat)?
 * Ayırt edicilik: iskontosuz ve masrafsız faturada brüt = net = net+masraf — aratoplam ilişkisi yalnız iskontosu ya da
 * masrafı yuvarlama payının açıkça üstünde olan faturalarda sayılır (yoksa her ilişki "tutar" ve ölçüm hiçbir yönü
 * kanıtlamaz; 2026-09-18 tie-out dersi). İlişki sayaçları ÖRTÜŞÜR (bir fatura birden çok adaya uyabilir): sayısı
 * `ayirtEdiciFatura`'ya eşit olan aday tutarlı formüldür.
 *
 * İnceleme turu (2026-09-28): (a) pay yalnız YUVARLAMAYA bağlı (0,06 + satır başına 0,02) — oransal pay büyük faturada
 * yüzlerce lirayı bulup iskonto farkını yutuyordu; iki formül birden tutarsa 'ayirtEdilemez' (tutuyor ÖNCELİĞİ yok).
 * (b) 'tutuyor' = başlık satırlarla İÇ TUTARLI, e-faturayla doğruluk DEĞİL — iskonto brüte iki kez eklenmiş Mikro kaydı da
 * tutar (meblağ Mikro'nun kendi okumasından çıkar); iskontolu 'tutuyor' faturalar etkin KDV oranlarıyla ayrıca listelenir
 * (`iskontoluTutuyor`), kesin liste /api/mikro/iskonto-tutarsizlik. (c) İptal satırları AYRI sayılır: fatura-listesi importu
 * satır JOIN'inde iptal süzmüyor — tanı yalnız iptalsizleri toplar, iptalli grubu işaretler. (d) Aynı evrak anahtarına düşen
 * birden çok iptalsiz başlık ('ortakAnahtar') sınıflanmaz (stokFiyat.faturaToplamlari da belirsiz sayar).
 */

/** Fatura başına toplanmış iptalsiz satırlar (SQL satırı): sth_evraktip, sth_evrakno_seri, sth_evrakno_sira, n, tutar, isk,
 *  masraf, vergi, bilinmeyen (NULL tutar/vergili satır sayısı — bilinmeyen ≠ 0, o fatura sınıflanmaz), masrafVergi (kolon varsa). */
export type SatirToplami = Readonly<Record<string, unknown>>;
/** Fatura başlığı (SQL satırı): cha_tip, cha_evrakno_seri, cha_evrakno_sira, cha_tarihi, cha_kod, cha_meblag, aratoplam
 *  (cha_aratoplam varsa), ftIsk (Σ cha_ft_iskonto<N> varsa), iptal. */
export type BaslikSatiri = Readonly<Record<string, unknown>>;

export type MatrahSinifi =
  | 'tutuyor'               // meblağ ≈ (tutar − isk + masraf) + vergi (yalnız bu formül)
  | 'ayirtEdilemez'         // iskonto payın içinde: iskonto düşülerek de düşülmeden de tutuyor — hiçbir yönü kanıtlamaz
  | 'tutuyorMasrafVergili'  // meblağ ≈ yukarıdaki + masraf KDV'si (sth_masraf_vergi ayrı kolon)
  | 'iskontosuzTutuyor'     // iskontolu faturada meblağ ≈ tutar + masraf + vergi (→ sth_tutar zaten NET olabilir)
  | 'eksik'                 // meblağ satırlardan AZ (fatura altı iskonto satıra dağıtılmamış / tevkifat)
  | 'fazla'                 // meblağ satırlardan FAZLA
  | 'satirsiz'              // başlığın HİÇ fatura satırı yok (import yedeği cha_aratoplam'a düşer)
  | 'yalnizIptalSatirli'    // yalnız İPTAL satırı var (import JOIN'i iptal süzmediği için onları matrah sayar!)
  | 'ortakAnahtar'          // aynı yön|seri|sıra'da birden çok iptalsiz başlık — satırlar hangisine ait, belirsiz
  | 'satirBilinmiyor'       // satırlarda NULL tutar/vergi
  | 'meblagBilinmiyor';

export type AratoplamIliskisi = 'brut' | 'net' | 'netMasraf' | 'brutMasraf' | 'meblagEksiKdv';

export interface FaturaOlcumu {
  yon: 'gelen' | 'giden'; seri: string; sira: string; tarih: string | null; cariKod: string | null;
  sinif: MatrahSinifi;
  meblag: number | null; aratoplam: number | null; ftIsk: number | null;
  satirSayisi: number | null; tutar: number | null; isk: number | null; masraf: number | null; vergi: number | null; masrafVergi: number | null;
  /** (tutar − isk + masraf) + vergi — satırlardan beklenen genel toplam. */
  beklenen: number | null;
  /** meblağ − beklenen (eksi: başlık satırlardan az). */
  fark: number | null;
  /** İptal satır sayısı ve tutarı (iptalsiz satırların yanında) — importun matrahına KARIŞIR. */
  iptalSatir: number | null; iptalTutar: number | null;
  /** vergi / (tutar − isk + masraf) × 100 — Mikro okumasının etkin KDV oranı (yalnız iskontolu faturada). */
  etkinKdvOrani: number | null;
  /** vergi / (tutar − 2·isk + masraf) × 100 — iskonto brüte iki kez eklenmişse GERÇEK oran budur (karşılaştırma için). */
  ciftIskontoKdvOrani: number | null;
  aratoplamIliskileri: AratoplamIliskisi[];
}

export interface MatrahTaniRaporu {
  ozet: {
    baslik: number; iptalBaslik: number;
    sinif: Record<MatrahSinifi, { gelen: number; giden: number }>;
    iskontoluFatura: number; masrafliFatura: number; masrafVergiliFatura: number; faturaAltiIskontoluBaslik: number;
    /** İptalsiz satırlarının YANINDA iptal satırı da olan fatura (evrak anahtarı başına bir kez) — importun matrahı bunları da
     *  toplar; iptalTutarToplami importun bu faturalarda matrahı en az ne kadar şişirdiğidir. */
    iptalSatirliFatura: number; iptalTutarToplami: number;
    /** iskontoluTutuyor listesinin KESİLMEDEN önceki sayısı (sessiz kesme yok). */
    iskontoluTutuyorSayisi: number;
    /** Negatif iskonto tutarı taşıyan iptalsiz satır (stokFiyat mutlak değer topluyor — varsayımı sınar; beklenen 0). */
    negatifIskSatir: number;
    /** Bir notla: 'tutuyor' iç tutarlılıktır, e-fatura doğruluğu değil. */
    not: string;
    /** cha_aratoplam ilişkisi — YALNIZ ayırt edici faturalarda (iskonto > 0 ya da masraf > 0) ve aratoplam biliniyorsa. */
    aratoplam: { ayirtEdiciFatura: number; iliski: Record<AratoplamIliskisi, number>; hicbiri: number };
  };
  /** 'tutuyor' dışındaki faturalar SINIF BAŞINA, |fark| büyükten küçüğe (sınıf başına en çok `sinir` — satırsızlar eksik/fazla
   *  listesini itip taşırmasın). */
  tutmayanlar: Partial<Record<MatrahSinifi, FaturaOlcumu[]>>;
  /** Ayırt edici faturalardan aratoplam ilişkisi örnekleri (en çok 20). */
  aratoplamOrnekleri: FaturaOlcumu[];
  /** İskontosu payın üstünde ve 'tutuyor' olan faturalar, etkin KDV oranlarıyla (en çok `sinir`) — çift iskonto kaydı burada
   *  "tutuyor" görünür: etkinKdvOrani geçersiz (ör. 11,9) + ciftIskontoKdvOrani geçerli (20) ise iskonto-tutarsizlik listesine bak. */
  iskontoluTutuyor: FaturaOlcumu[];
  /** İptalsiz satırlarının yanında iptal satırı da olan faturalar, iptal tutarı büyükten küçüğe (en çok `sinir`). */
  iptalSatirliFaturalar: FaturaOlcumu[];
  /** Sınıf başına listeye SIĞMAYAN fatura sayısı (sessiz kesme yok). */
  kesildi: Partial<Record<MatrahSinifi, number>>;
}

const sayi = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const metin = (v: unknown) => String(v ?? '').trim();
const tarihMetni = (t: unknown): string | null =>
  typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10)
    : t instanceof Date && Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : null;
const anahtar = (yon: string, seri: unknown, sira: unknown) => `${yon}|${metin(seri)}|${metin(sira)}`;
/** Yuvarlama payı — YALNIZ yuvarlamaya bağlı: 0,06 taban + satır başına 2 kuruş (tutar ve KDV her satırda ayrı yuvarlanır).
 *  Oransal pay YOK (inceleme 2026-09-28: binde yarım, 600.000 ₺'lik faturada 300 ₺ ediyor ve iskonto farkını yutuyordu). */
const pay = (satir: number) => 0.06 + 0.02 * Math.max(1, satir);
const oran = (vergi: number, matrah: number) => (matrah > 0 ? Math.round((vergi / matrah) * 10000) / 100 : null);
const iptalMi = (v: unknown) => v === true || sayi(v) === 1;

export function matrahTaniRaporu(satirlar: readonly SatirToplami[], basliklar: readonly BaslikSatiri[], sinir = 60): MatrahTaniRaporu {
  const satirHaritasi = new Map<string, SatirToplami>();
  for (const s of satirlar) {
    const tip = sayi(s.sth_evraktip);
    const yon = tip === 3 ? 'gelen' : tip === 4 ? 'giden' : null;
    if (!yon || metin(s.sth_evrakno_sira) === '') continue;
    satirHaritasi.set(anahtar(yon, s.sth_evrakno_seri, s.sth_evrakno_sira), s);
  }
  const SINIFLAR: MatrahSinifi[] = ['tutuyor', 'ayirtEdilemez', 'tutuyorMasrafVergili', 'iskontosuzTutuyor', 'eksik', 'fazla', 'satirsiz',
    'yalnizIptalSatirli', 'ortakAnahtar', 'satirBilinmiyor', 'meblagBilinmiyor'];
  const sinif = Object.fromEntries(SINIFLAR.map(k => [k, { gelen: 0, giden: 0 }])) as Record<MatrahSinifi, { gelen: number; giden: number }>;
  const iliskiSay: Record<AratoplamIliskisi, number> = { brut: 0, net: 0, netMasraf: 0, brutMasraf: 0, meblagEksiKdv: 0 };
  let baslik = 0, iptalBaslik = 0, iskontolu = 0, masrafli = 0, masrafVergili = 0, ftIskontolu = 0, ayirtEdici = 0, hicbiri = 0;
  let negatifIsk = 0, iptalTutarToplami = 0;
  const iptalSatirliAnahtar = new Set<string>();
  const iptalSatirliFaturalar: FaturaOlcumu[] = [];
  const olcumler: FaturaOlcumu[] = [];
  const aratoplamOrnekleri: FaturaOlcumu[] = [];
  const iskontoluTutuyor: FaturaOlcumu[] = [];
  for (const s of satirHaritasi.values()) negatifIsk += sayi(s.negatifIsk) ?? 0;

  // Aynı anahtara düşen iptalsiz başlık sayısı (stokFiyat.faturaToplamlari: >1 → belirsiz).
  const yonOf = (b: BaslikSatiri): 'gelen' | 'giden' => (sayi(b.cha_tip) === 1 ? 'gelen' : 'giden');
  const baslikSayisi = new Map<string, number>();
  for (const b of basliklar) {
    if (iptalMi(b.iptal)) continue;
    const k = anahtar(yonOf(b), b.cha_evrakno_seri, b.cha_evrakno_sira);
    baslikSayisi.set(k, (baslikSayisi.get(k) ?? 0) + 1);
  }

  for (const b of basliklar) {
    if (iptalMi(b.iptal)) { iptalBaslik++; continue; }
    baslik++;
    const yon = yonOf(b);
    const k = anahtar(yon, b.cha_evrakno_seri, b.cha_evrakno_sira);
    const s = satirHaritasi.get(k);
    const meblag = sayi(b.cha_meblag), aratoplam = sayi(b.aratoplam), ftIsk = sayi(b.ftIsk);
    if (ftIsk !== null && ftIsk !== 0) ftIskontolu++;
    const n = s ? sayi(s.n) : null, tutar = s ? sayi(s.tutar) : null, isk = s ? sayi(s.isk) : null;
    const masraf = s ? sayi(s.masraf) : null, vergi = s ? sayi(s.vergi) : null, mv = s ? sayi(s.masrafVergi) : null;
    const iptalSatir = s ? sayi(s.iptalSatir) : null, iptalTutar = s ? sayi(s.iptalTutar) : null;
    const o: FaturaOlcumu = {
      yon, seri: metin(b.cha_evrakno_seri), sira: metin(b.cha_evrakno_sira), tarih: tarihMetni(b.cha_tarihi), cariKod: metin(b.cha_kod) || null,
      sinif: 'tutuyor', meblag, aratoplam, ftIsk, satirSayisi: n, tutar, isk, masraf, vergi, masrafVergi: mv,
      beklenen: null, fark: null, aratoplamIliskileri: [], iptalSatir, iptalTutar, etkinKdvOrani: null, ciftIskontoKdvOrani: null,
    };
    if ((iptalSatir ?? 0) > 0 && (n ?? 0) > 0 && !iptalSatirliAnahtar.has(k)) {
      iptalSatirliAnahtar.add(k);                                    // ortakAnahtar'da aynı satır grubu iki kez sayılmasın
      iptalTutarToplami += iptalTutar ?? 0;
      iptalSatirliFaturalar.push(o);
    }
    if ((baslikSayisi.get(k) ?? 0) > 1) o.sinif = 'ortakAnahtar';
    else if (meblag === null) o.sinif = 'meblagBilinmiyor';
    else if (!s) o.sinif = 'satirsiz';
    else if ((n ?? 0) === 0) o.sinif = 'yalnizIptalSatirli';
    else if ((sayi(s.bilinmeyen) ?? 0) > 0 || tutar === null || vergi === null || isk === null || masraf === null) o.sinif = 'satirBilinmiyor';
    else {
      const p = pay(n ?? 1);
      const iskAyirt = Math.abs(isk) > 2 * p, masrafAyirt = Math.abs(masraf) > 2 * p;
      if (isk !== 0) iskontolu++;
      if (masraf !== 0) masrafli++;
      if (mv !== null && mv !== 0) masrafVergili++;
      const net = tutar - isk;
      const beklenen = net + masraf + vergi;
      o.beklenen = beklenen;
      o.fark = meblag - beklenen;
      const netTutuyor = Math.abs(meblag - beklenen) <= p;
      const brutTutuyor = isk !== 0 && Math.abs(meblag - (tutar + masraf + vergi)) <= p;
      if (netTutuyor && brutTutuyor) o.sinif = 'ayirtEdilemez';
      else if (netTutuyor) o.sinif = 'tutuyor';
      else if (mv !== null && mv !== 0 && Math.abs(meblag - beklenen - mv) <= p) o.sinif = 'tutuyorMasrafVergili';
      else if (brutTutuyor) o.sinif = 'iskontosuzTutuyor';
      else o.sinif = meblag < beklenen ? 'eksik' : 'fazla';
      if (isk !== 0) {
        o.etkinKdvOrani = oran(vergi, net + masraf);
        o.ciftIskontoKdvOrani = oran(vergi, tutar - 2 * isk + masraf);
      }
      if (o.sinif === 'tutuyor' && iskAyirt) iskontoluTutuyor.push(o);

      if (aratoplam !== null && (iskAyirt || masrafAyirt)) {
        ayirtEdici++;
        const pa = pay(n ?? 1);
        const adaylar: Record<AratoplamIliskisi, number> = {
          brut: tutar, net, netMasraf: net + masraf, brutMasraf: tutar + masraf, meblagEksiKdv: meblag - vergi - (mv ?? 0),
        };
        o.aratoplamIliskileri = (Object.keys(adaylar) as AratoplamIliskisi[]).filter(a => Math.abs(aratoplam - adaylar[a]) <= pa);
        for (const a of o.aratoplamIliskileri) iliskiSay[a]++;
        if (!o.aratoplamIliskileri.length) hicbiri++;
        if (aratoplamOrnekleri.length < 20) aratoplamOrnekleri.push(o);
      }
    }
    sinif[o.sinif][yon]++;
    if (o.sinif !== 'tutuyor') olcumler.push(o);
  }
  const buyukluk = (o: FaturaOlcumu) => (o.fark === null ? Math.abs(o.meblag ?? 0) : Math.abs(o.fark));
  const tutmayanlar: Partial<Record<MatrahSinifi, FaturaOlcumu[]>> = {};
  const kesildi: Partial<Record<MatrahSinifi, number>> = {};
  for (const o of olcumler) (tutmayanlar[o.sinif] ??= []).push(o);
  for (const k of Object.keys(tutmayanlar) as MatrahSinifi[]) {
    const liste = (tutmayanlar[k] ?? []).sort((a, b) => buyukluk(b) - buyukluk(a));
    if (liste.length > sinir) kesildi[k] = liste.length - sinir;
    tutmayanlar[k] = liste.slice(0, sinir);
  }
  return {
    ozet: {
      baslik, iptalBaslik, sinif, iskontoluFatura: iskontolu, masrafliFatura: masrafli, masrafVergiliFatura: masrafVergili,
      faturaAltiIskontoluBaslik: ftIskontolu, iptalSatirliFatura: iptalSatirliAnahtar.size,
      iptalTutarToplami: Math.round(iptalTutarToplami * 100) / 100, iskontoluTutuyorSayisi: iskontoluTutuyor.length, negatifIskSatir: negatifIsk,
      not: "'tutuyor' = başlık satırlarla İÇ TUTARLI; e-faturayla doğruluk DEĞİL (iskonto brüte iki kez eklenmiş kayıt da tutar — bkz. iskontoluTutuyor ve /api/mikro/iskonto-tutarsizlik).",
      aratoplam: { ayirtEdiciFatura: ayirtEdici, iliski: iliskiSay, hicbiri },
    },
    tutmayanlar,
    aratoplamOrnekleri,
    iskontoluTutuyor: [...iskontoluTutuyor].sort((a, b) => Math.abs(b.isk ?? 0) - Math.abs(a.isk ?? 0)).slice(0, sinir),
    iptalSatirliFaturalar: [...iptalSatirliFaturalar].sort((a, b) => Math.abs(b.iptalTutar ?? 0) - Math.abs(a.iptalTutar ?? 0)).slice(0, sinir),
    kesildi,
  };
}
