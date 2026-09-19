/**
 * eBelge.ts — Mikro'dan çekilen e-belge satırlarının (`/api/mikro/ebelge/*`: gelen e-fatura, giden e-belge,
 * e-irsaliye) `eBelgeler` şemasına indirgenmesi + cari hareket importunun yön notu (Faz 3 3/n kapanış ölçüsü,
 * 2026-09-19). Test: eBelge.test.ts (önce yazıldı).
 *
 * NEDEN VAR — 9 grubun DIŞINDA kalan, kapanış ölçüsünün (`grep -nE "(\|\||\?\?)\s*[01]\b"`) bulduğu iki site:
 *   • mikroRoutes `eBelgeNormalize`: `Number(al(/tutar|meblag|toplam/i) ?? 0)` + `Number.isFinite(t) ? t : 0`.
 *     İKİ arıza birden: (1) GEVŞEK regex — satırın İLK eşleşen anahtarını alıyordu; `kdv_tutar`,
 *     `iskonto_toplam`, `tutar_Guid` de eşleşir (CLAUDE.md: `sfiyat_fiyati|fiyat` deseni `sfiyat_Guid`'i
 *     eşleştirip fiyatları sessizce sıfırlamıştı); (2) tutarı okunamayan belge ₺0 olarak yazılıyordu — işlevin
 *     kendi yorumu "bulunamayan alan BOŞ bırakılır, uydurulmaz" diyordu, tutar için yalandı.
 *   • cari hareket importu notu: `Number(r.cha_tip ?? 0) === 0` — yönü okunamayan hareket BORÇ sayılıyordu.
 *
 * KURAL: Mikro alan adları sürüme göre değiştiği için anahtar yine desenle aranır, AMA en-spesifikten-genele
 * sıralı ve yan tutarlar (KDV/iskonto/matrah/ara toplam/Guid/kur) DIŞLANARAK. Bulunamazsa / değer okunamıyorsa
 * `tutar` HİÇ yazılmaz (E-Belge Merkezi `paraYaz` ile '—' basar) ve sayılır; ≥ 5 belgenin TAMAMINDA
 * okunamıyorsa bu veri değil OKUMA ARIZASIDIR (kolon adı değişmiş) — not başına UYARI.
 * Metin alanları paritede (`''`); `durum` bilinmiyorsa 'Bekliyor' (eski davranış — ayrı karar, dokunulmadı).
 */
import { bilinenSayi } from '../../utils/para.js';

export type EBelgeTuru = 'e-fatura' | 'e-arsiv' | 'e-irsaliye';
export type EBelgeYonu = 'gelen' | 'giden';

/** Ödenecek tutar SAYILMAYACAK kolonlar: yan tutarlar, kimlik kolonları, kur. */
const YAN_TUTAR = /guid|kdv|vergi|iskonto|indirim|matrah|haric|ara_?toplam|tevkifat|stopaj|kur(u|_|$)|doviz/i;
/** En-spesifikten-genele: ödenecek > genel toplam > toplam > meblağ > tutar. */
const TUTAR_DESENLERI: readonly RegExp[] = [/odenecek/i, /genel_?toplam/i, /toplam/i, /meblag/i, /tutar/i];

/** "KDV dâhil toplam" yan tutar değil, ödenecek tutarın kendisidir — dışlamadan muaf. ("hariç" = matrah, muaf DEĞİL.) */
const VERGI_DAHIL = /dahil/i;

export function eBelgeTutarAnahtari(anahtarlar: readonly string[]): string | null {
  const adaylar = anahtarlar.filter(k => VERGI_DAHIL.test(k) || !YAN_TUTAR.test(k));
  for (const desen of TUTAR_DESENLERI) {
    const k = adaylar.find(a => desen.test(a));
    if (k) return k;
  }
  return null;
}

export interface EBelgeSonucu { kayit: Record<string, unknown>; bilinmeyen: string[] }

/** Tek satır → `eBelgeler` kaydı. `tutar` yalnız BİLİNİYORSA yazılır. */
export function eBelgeNormalize(row: Record<string, unknown>, tur: EBelgeTuru, yon: EBelgeYonu): EBelgeSonucu {
  const al = (re: RegExp): unknown => {
    const k = Object.keys(row).find(x => re.test(x));
    return k ? row[k] : undefined;
  };
  const bilinmeyen: string[] = [];
  const tutarK = eBelgeTutarAnahtari(Object.keys(row));
  const hamTutar = tutarK ? row[tutarK] : undefined;
  const kayit: Record<string, unknown> = {
    belgeNo:   String(al(/fatura_?no|belge_?no|gib_?no|evrak_?no|ettn/i) ?? ''),
    uuid:      String(al(/uuid|ettn/i) ?? ''),
    alici:     String(al(/unvan|alici|gonderen|cari_?isim/i) ?? ''),
    vergiNo:   String(al(/vkn|tckn|vergi/i) ?? ''),
    ...(bilinenSayi(hamTutar) ? { tutar: Number(hamTutar) } : {}),
    belgeDate: String(al(/tarih|date/i) ?? '').slice(0, 10),
    tur, yon,
    durum:     String(al(/durum|statu|status/i) ?? 'Bekliyor'),
    kaynak:    'mikro',
    raw:       row,
  };
  if (!('tutar' in kayit)) bilinmeyen.push('tutar');
  return { kayit, bilinmeyen };
}

export interface EBelgeTopluSonuc { kayitlar: Record<string, unknown>[]; tutarsiz: number; okumaArizasi: boolean; not: string | null }

/** Okuma arızası eşiği: bundan az satırda "tamamı bilinmiyor" tesadüf olabilir (diğer eşleme modülleriyle aynı). */
const ARIZA_ESIGI = 5;

export function eBelgeleriNormalize(rows: readonly Record<string, unknown>[], tur: EBelgeTuru, yon: EBelgeYonu): EBelgeTopluSonuc {
  const sonuclar = rows.map(r => eBelgeNormalize(r, tur, yon));
  const tutarsiz = sonuclar.filter(s => s.bilinmeyen.includes('tutar')).length;
  // e-İrsaliye SEVK belgesidir — ödenecek tutarı olmaz; tutarsızlığı arıza/not saymak her çekişte yanlış alarm
  // üretirdi (2026-09-19 kapanış incelemesi). Sayaç yine döner, yalnız uyarıya çevrilmez.
  const tutarKritik = tur !== 'e-irsaliye';
  const okumaArizasi = tutarKritik && rows.length >= ARIZA_ESIGI && tutarsiz === rows.length;
  const not = !tutarKritik ? null : okumaArizasi
    ? 'UYARI: tutar hiçbir belgede okunamadı — Mikro kolon adı/şema kontrol edin'
    : tutarsiz > 0 ? `${tutarsiz} belgenin tutarı okunamadı` : null;
  return { kayitlar: sonuclar.map(s => s.kayit), tutarsiz, okumaArizasi, not };
}

/** Cari hareket importunun özet notu. cha_tip 0 = borç, 1 = alacak; okunamayan yön hiçbirine SAYILMAZ. */
export function cariHareketYonOzeti(rows: readonly Record<string, unknown>[]): string {
  let borc = 0, alacak = 0, yonsuz = 0;
  for (const r of rows) {
    if (!bilinenSayi(r.cha_tip)) { yonsuz++; continue; }
    const tip = Number(r.cha_tip);
    if (tip === 0) borc++; else if (tip === 1) alacak++; else yonsuz++;
  }
  return `${borc} borç / ${alacak} alacak hareketi` + (yonsuz > 0 ? ` · ${yonsuz} hareketin yönü okunamadı` : '');
}
