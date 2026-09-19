/**
 * depoNo.ts — Muhasebe → Transfer sekmesinin "Mikro'ya Gönder" (DepolarArasiSiparisKaydetV2)
 * DEPO NUMARASI çözümü (Faz 3 2/n, grup "transferMikro", 2026-09-14).
 * Test: depoNo.test.ts (önce yazıldı).
 *
 * NEDEN VAR — src/components/accounting/TransferTab.tsx:114 (2026-09-14 ölçümü):
 *     const depoNo = (s: string) => parseInt((s.match(/\d+/) ?? ['1'])[0], 10);
 *   `Transfer.fromWarehouse` / `toWarehouse` depo ADI taşır ("ESKİ SANAYİ"), numara değil.
 *   Bu satır iki ayrı uydurma yapıyordu:
 *     1) Adda rakam YOKSA → `['1']` → Mikro'ya DEPO 1 (HAVALİMANI) yazılıyordu. "ESKİ SANAYİ →
 *        HAVALİMANI" transferi Mikro'ya 1 → 1, yani kendinden kendine, HATA VERMEDEN gidiyordu.
 *     2) Adda rakam VARSA → ilk rakam dizisi depo no sanılıyordu ("Şube 34 Depo" → depo 34;
 *        elle açılmış, Mikro'da karşılığı olmayan bir depo için var olmayan bir numara).
 *   Bu, mikroEvrak.ts:80-96'daki `depoNo ?? 1` ailesinin (sayım / stok hareketi / bakım / servis /
 *   üretim / etiket) TransferTab'e sızmış son kopyasıydı: o altı üretici 2026-09-04'te `depoGerekli`
 *   ile kapatılmış, transferin kendi yerel regex'i atlanmıştı — "yarım düzeltme" sınıfının tekrarı.
 *
 * KURAL (CLAUDE.md): dış sisteme (Mikro) giden payload'da VARSAYILAN YOK. Depo bilinmiyorsa
 * `undefined` döner; çağıran payload üretmez (TransferTab `buildPayload` null döndürür, SKU'suz
 * transferde olduğu gibi — MikroPushButton null'u "Eksik veri — gönderilemedi" sayar). TAHMİN YOK:
 * numara yalnız KAYITTAN gelir (warehouses.depoNo ya da `mikro[-<kiracı>]-depo-<no>` doküman id'si),
 * depo ADINDAKİ rakamlardan ASLA türetilmez.
 *
 * DEPO NO NEREDEN GELİR — Mikro "Depo Tanımları" import'u (server/routes/mikroRoutes.ts:2031-2038)
 * her DEPOLAR satırı için `warehouses` dokümanını `depo-<dep_no>` anahtarıyla yazar ve gövdeye
 * `depoNo` alanını koyar. Doküman id'si iki biçimde olabilir: eski `mikro-depo-<no>` ve kiracı
 * etiketli `mikro-<8 hex>-depo-<no>` (server.ts:849-870 mikroIdCozucuIds / tenantTag). İkisini de
 * çözeriz; `depoNo` alanı olmayan eski import kayıtları id'den kurtarılır.
 *
 * SAYFA PARİTESİ: eski kodun DOĞRU çözdüğü tek ad biçimi olan "Depo 5" → 5 aynen korunur (artık
 * addaki rakamdan değil, kayıttaki `depoNo`dan). Bilinçli fark: rakamsız ad artık 1 değil
 * "bilinmiyor"; ada gömülü alakasız rakam ("Şube 34 Depo") artık depo no sayılmaz.
 */

/**
 * Hesabın okuduğu MİNİMAL depo kaydı. Sayfanın `Warehouse` tipi daha geniştir
 * (location/manager/notes) ve `depoNo`yu HİÇ tanımlamaz (types.ts:478) — alan DB'den gelir.
 * Bu yüzden alanlar `unknown`: "tipte number yazıyor" dolu geldiği anlamına gelmez.
 */
export interface DepoKaydi {
  id?: unknown;
  name?: unknown;
  depoNo?: unknown;
}

/** Mikro depo dokümanı id biçimleri: `mikro-depo-<no>` (eski) ve `mikro-<8 hex>-depo-<no>` (kiracı etiketli). */
const MIKRO_DEPO_ID = /^mikro-(?:[0-9a-f]{8}-)?depo-(\d+)$/;

/**
 * Geçerli bir Mikro depo numarası mı? Mikro dep_no pozitif tamsayıdır.
 * DB'den sayısal string gelebilir ('2'); NaN / 0 / negatif / ondalık "bilinmiyor" sayılır
 * (`Number.isFinite`, global isFinite DEĞİL — CLAUDE.md).
 */
function depoNoOku(x: unknown): number | undefined {
  if (typeof x !== 'number' && typeof x !== 'string') return undefined;
  if (typeof x === 'string' && x.trim() === '') return undefined;
  const n = Number(x);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

/** Doküman id'sinden depo numarası (yalnız Mikro biçimli id'ler; elle açılmış depo id'si numara taşımaz). */
function idDenDepoNo(id: unknown): number | undefined {
  if (typeof id !== 'string') return undefined;
  const m = MIKRO_DEPO_ID.exec(id.trim());
  return m ? depoNoOku(m[1]) : undefined;
}

/** Tek kaydın bilinen depo numarası: önce gövdedeki `depoNo`, yoksa id biçimi. */
function kayittanDepoNo(kayit: DepoKaydi): number | undefined {
  return depoNoOku(kayit.depoNo) ?? idDenDepoNo(kayit.id);
}

/**
 * Ad eşleştirme anahtarı. Türkçe: `toLocaleLowerCase('tr-TR')` — 'ESKİ SANAYİ' ↔ 'eski sanayi'
 * (İ→i, I→ı). Ekrana basılan metinde `toUpperCase()` YOK; bu yalnız eşleştirme anahtarıdır.
 */
function adAnahtari(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const s = x.trim().replace(/\s+/g, ' ');
  return s === '' ? undefined : s.toLocaleLowerCase('tr-TR');
}

/**
 * Depo ADI ya da doküman id'sinden Mikro `dep_no`.
 * Bulunamazsa / belirsizse `undefined` — ÇAĞIRAN payload üretmemelidir (varsayılan yok).
 *
 * Sıra: (1) listede birebir id eşleşmesi, (2) listede olmasa da Mikro biçimli id'nin kendisi,
 * (3) ad eşleşmesi. Aynı ada sahip iki depo FARKLI numara veriyorsa belirsizdir → `undefined`
 * (yanlış depoya yazmaktansa göndermemek).
 */
export function mikroDepoNo(depolar: readonly DepoKaydi[], adVeyaId: unknown): number | undefined {
  if (typeof adVeyaId !== 'string') return undefined;
  const ham = adVeyaId.trim();
  if (ham === '') return undefined;

  // (1) Birebir id eşleşmesi — id benzersizdir, sonucu kesindir (numarası yoksa da "bilinmiyor" kesindir).
  for (const kayit of depolar) {
    if (typeof kayit.id === 'string' && kayit.id.trim() === ham) return kayittanDepoNo(kayit);
  }

  // (2) Kayıt listede yoksa bile Mikro biçimli id numarayı kendi içinde taşır (id depoNo'dan türetilir).
  const idNo = idDenDepoNo(ham);
  if (idNo !== undefined) return idNo;

  // (3) Ad eşleşmesi. Birden çok kayıt eşleşirse yalnız TEK bir bilinen numara varsa kabul edilir.
  const aranan = adAnahtari(ham);
  if (aranan === undefined) return undefined;
  const bulunan = new Set<number>();
  for (const kayit of depolar) {
    if (adAnahtari(kayit.name) !== aranan) continue;
    const no = kayittanDepoNo(kayit);
    if (no !== undefined) bulunan.add(no);
  }
  return bulunan.size === 1 ? [...bulunan][0] : undefined;
}

/**
 * "Sevk Deposu (Mikro)" seçicisinin seçenekleri — sipariş EKLE ve DÜZENLE formlarının TEK KAYNAĞI.
 * Yalnız Mikro `dep_no`su ÇÖZÜLEBİLEN depolar (elle açılmış depo Mikro'da yoktur); aynı numarayı veren kayıtlar
 * tek satıra iner (ilk ad), numaraya göre sıralı. Çözülebilen depo yoksa liste BOŞTUR — çağıran seçiciyi gizler;
 * "tek depo varsa onu varsay" gibi bir varsayılan burada ÜRETİLMEZ.
 */
export function mikroDepoSecenekleri(depolar: readonly DepoKaydi[]): Array<{ no: number; ad: string }> {
  const gorulen = new Map<number, string>();
  for (const w of depolar) {
    const no = mikroDepoNo(depolar, w.id);
    if (no === undefined || gorulen.has(no)) continue;
    const ad = typeof w.name === 'string' ? w.name.trim() : '';
    gorulen.set(no, ad || `Depo ${no}`);
  }
  return [...gorulen].sort((a, b) => a[0] - b[0]).map(([no, ad]) => ({ no, ad }));
}

/** Depolar arası sipariş için çözülmüş depo çifti. */
export interface TransferDepolari {
  fromDepo: number;
  toDepo: number;
}

/**
 * TransferTab `buildPayload` kapısı: iki depodan biri bile bilinmiyorsa `null`.
 * SKU'suz transferle aynı davranış — payload üretilmez, MikroPushButton "gönderilemez" der.
 */
export function transferDepoNolari(
  depolar: readonly DepoKaydi[],
  cikisDeposu: unknown,
  girisDeposu: unknown,
): TransferDepolari | null {
  const fromDepo = mikroDepoNo(depolar, cikisDeposu);
  const toDepo = mikroDepoNo(depolar, girisDeposu);
  if (fromDepo === undefined || toDepo === undefined) return null;
  return { fromDepo, toDepo };
}
