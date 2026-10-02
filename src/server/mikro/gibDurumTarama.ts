/**
 * gibDurumTarama.ts — satış e-belgelerinin GİB / alıcı durumunu Mikro'dan sorup `mikroFaturalar` dokümanına işleyen tarama (2026-10-02).
 * Kural ve gerekçe: lib/gibDurum.ts (fatura 389 → 2002 «Fatura red edildi»; Mikro'da iptal bayrağı yok, kolon yok).
 *
 * Bağımlılıklar AÇIK geçer (Mikro çağrısı, yazım, saat) — modül saf kalır, Mikro olmadan sınanır. Sıralı çalışır (Mikro aynı anda tek
 * istek kaldırıyor). Süre bütçesi çağırandan: gece koşusu geniş, HTTP yolu IIS/ARR sınırının altında. Bütçe dolunca DURUR ve kalanı
 * sayar — yarım tarama "hepsi soruldu" diye sunulmaz. Hata / zaman aşımı alan faturanın önceki durumu KORUNUR (hiçbir şey yazılmaz).
 * En yeni fatura önce: ret süresi içindeki faturalar bütçe dar olsa da sorulmuş olur.
 * DEVRE KESİCİ: art arda 3 çağrı FIRLATIRSA (zaman aşımı / bağlantı) tarama durur — Mikro asılıyken 400 × 15 sn boşa dönmesin ve
 * gece koşusu 04:00 stok cron'unun üstüne binmesin (şartname kapısı 2026-10-02). `IsError` yanıtı (ör. «İlgili e-belge
 * bulunamadı») kesiciyi TETİKLEMEZ: Mikro yanıt veriyor demektir.
 * Aynı ETTN'yi taşıyan iki doküman (aynı numaralı iki başlık) TEK kez sorulur, sonuç ikisine de yazılır.
 */
import { gibDurumCoz, gibRedMi, gibReddedildi, taramaKarari, type GibDurum, type TaramaAtlamaNedeni } from '../../lib/gibDurum.js';

export type TaramaFaturasi = Readonly<Record<string, unknown>> & { id: string };

export interface TaramaBagimliliklari {
  faturalar: readonly TaramaFaturasi[];
  /** EBelgeDurumSorgulamaV2 — yanıt zarfı aynen (`{ ok, status, data }`). Fırlatabilir (zaman aşımı). */
  sorgula: (ettn: string, eBelgeTipi: 0 | 1, zamanAsimiMs: number) => Promise<{ ok: boolean; status: number; data: unknown }>;
  /** Yalnız bu iki alanı yazar; var olmayan dokümanı DİRİLTMEZ. */
  yaz: (id: string, alanlar: { gibDurum: GibDurum & { sorguZamani: string }; gibRed: boolean }) => Promise<void>;
  simdi: () => number;
  butceMs: number;
  /** Çağrı başına üst sınır (varsayılan 15 sn) — kalan bütçeyle de sınırlanır. */
  cagriMs?: number;
}

export interface TaramaSonucu {
  aday: number;
  soruldu: number;
  /** Bu koşuda reddedilmiş görülen (yeni + zaten bilinen değil — yalnız SORULANLAR içinde). */
  red: number;
  /** Bu koşuda İLK KEZ reddedilmiş işaretlenen. */
  yeniRed: number;
  /** Önceden reddedilmişken artık reddedilmiş görünmeyen (beklenmez; görülürse yazılır). */
  redKalkti: number;
  /** Bütçe dolduğu ya da devre kesici attığı için sorulamayan aday. */
  kalan: number;
  /** Art arda fırlayan çağrı yüzünden tarama erken durdu (Mikro yanıt vermiyor). */
  kesildi: boolean;
  hata: number;
  ilkHata: string | null;
  kodlar: Record<string, number>;
  atlanan: Partial<Record<TaramaAtlamaNedeni, number>>;
  /** Yeni reddedilenlerin evrak numaraları (en çok 10) — özet metni için. */
  yeniRedEvraklar: string[];
}

const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const evrakNo = (f: Readonly<Record<string, unknown>>) => [f.cha_evrakno_seri, f.cha_evrakno_sira].map(v => String(v ?? '').trim()).filter(Boolean).join('-') || '?';

export async function gibDurumTara(b: TaramaBagimliliklari): Promise<TaramaSonucu> {
  const t0 = b.simdi();
  const kalanMs = () => b.butceMs - (b.simdi() - t0);
  const cagriMs = b.cagriMs ?? 15000;
  const s: TaramaSonucu = { aday: 0, soruldu: 0, red: 0, yeniRed: 0, redKalkti: 0, kalan: 0, kesildi: false, hata: 0, ilkHata: null, kodlar: {}, atlanan: {}, yeniRedEvraklar: [] };
  const bugun = new Date(t0);
  const adaylar: Array<{ f: TaramaFaturasi; ettn: string; eBelgeTipi: 0 | 1 }> = [];
  for (const f of b.faturalar) {
    const k = taramaKarari(f, bugun);
    if ('atla' in k) { s.atlanan[k.atla] = (s.atlanan[k.atla] ?? 0) + 1; continue; }
    adaylar.push({ f, ...k.aday });
  }
  adaylar.sort((x, y) => String(y.f.cha_tarihi ?? '').localeCompare(String(x.f.cha_tarihi ?? '')));
  s.aday = adaylar.length;
  const hataYaz = (m: string) => { s.hata++; if (s.ilkHata === null) s.ilkHata = m.slice(0, 200); };

  const ARDISIK_SINIR = 3;
  let ardisikFirlatma = 0;
  const onbellek = new Map<string, { ok: boolean; status: number; data: unknown }>();
  for (let i = 0; i < adaylar.length; i++) {
    // Son çağrıya yetecek süre yoksa dur: kalanlar bir sonraki koşuda (durumu yazılmamış fatura her koşuda adaydır).
    if (kalanMs() < Math.min(cagriMs, 5000)) { s.kalan = adaylar.length - i; break; }
    if (ardisikFirlatma >= ARDISIK_SINIR) { s.kalan = adaylar.length - i; s.kesildi = true; break; }
    const { f, ettn, eBelgeTipi } = adaylar[i];
    const anahtar = `${eBelgeTipi}|${ettn.toLowerCase()}`;
    let yanit = onbellek.get(anahtar);
    if (!yanit) {
      try { yanit = await b.sorgula(ettn, eBelgeTipi, Math.min(cagriMs, kalanMs())); ardisikFirlatma = 0; }
      catch (e) { ardisikFirlatma++; hataYaz(`${evrakNo(f)}: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`); continue; }
      onbellek.set(anahtar, yanit);
    }
    const r0 = nesneMi(yanit.data) && Array.isArray(yanit.data.result) && nesneMi(yanit.data.result[0]) ? yanit.data.result[0] : null;
    if (!yanit.ok || !r0 || r0.IsError) { hataYaz(`${evrakNo(f)}: ${String(r0?.ErrorMessage ?? `HTTP ${yanit.status}`)}`); continue; }
    const durum = gibDurumCoz(r0.Data, eBelgeTipi);
    if (!durum) { hataYaz(`${evrakNo(f)}: yanıtta BelgeDurumKodu yok`); continue; }
    s.soruldu++;
    s.kodlar[durum.belgeKodu] = (s.kodlar[durum.belgeKodu] ?? 0) + 1;
    const red = gibRedMi(durum), onceRed = gibReddedildi(f);
    if (red) { s.red++; if (!onceRed) { s.yeniRed++; if (s.yeniRedEvraklar.length < 10) s.yeniRedEvraklar.push(evrakNo(f)); } }
    else if (onceRed) s.redKalkti++;
    try { await b.yaz(f.id, { gibDurum: { ...durum, ettn: ettn.toLowerCase(), sorguZamani: new Date(b.simdi()).toISOString() }, gibRed: red }); }
    catch (e) { hataYaz(`${evrakNo(f)}: yazılamadı — ${e instanceof Error ? e.message : String(e)}`); }
  }
  return s;
}

/** syncLog / düğme özeti. Sıfır olan parça yazılmaz; kod dağılımı HER ZAMAN yazılır (yeni kod görünür olsun). */
export function taramaNotu(s: TaramaSonucu): string {
  const kodlar = Object.entries(s.kodlar).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k}×${n}`).join(', ');
  const atlanan = Object.entries(s.atlanan).filter(([k]) => k === 'tur-bilinmiyor' || k === 'ettn-yok').map(([k, n]) => `${n} ${k === 'ettn-yok' ? 'ETTN\'siz' : 'türü bilinmeyen'}`);
  return [
    `${s.soruldu} belge soruldu`,
    s.red ? `${s.red} reddedilmiş${s.yeniRed ? ` (${s.yeniRed} yeni: ${s.yeniRedEvraklar.join(', ')}${s.yeniRed > s.yeniRedEvraklar.length ? ' …' : ''})` : ''}` : null,
    s.redKalkti ? `⚠ ${s.redKalkti} belgenin reddi kalktı` : null,
    s.kalan ? (s.kesildi ? `⚠ Mikro art arda yanıt vermedi, tarama durduruldu — ${s.kalan} belge sorulamadı` : `${s.kalan} belge süre dolduğu için sorulamadı — yeniden çalıştırın`) : null,
    s.hata ? `⚠ ${s.hata} sorgu başarısız${s.ilkHata ? ` (ilki: ${s.ilkHata})` : ''}` : null,
    atlanan.length ? `${atlanan.join(', ')} satış faturası sorulmadı` : null,
    kodlar ? `kodlar: ${kodlar}` : null,
  ].filter(Boolean).join(' · ');
}
