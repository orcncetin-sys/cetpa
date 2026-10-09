/**
 * baglanti.degismez.test.ts — Faz 3 5/n son incelemesinin bulduğu İKİ "bağlantı" arızası geri gelmesin
 * diye KAYNAĞI tarayan değişmez testleri (2026-09-19). İkisi de tsc'nin göremediği sınıftan: prop
 * isteğe bağlı olduğu için eksikliği, girdi tipi bir string olduğu için yanlışlığı derlenir.
 * İki tarama da YORUMSUZ kodda yapılır (ortak süzgeç: `src/test/kaynakTarama`): yorumdaki etiket
 * çağrı yeri ya da kutu sayılmaz.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { kodSatirlari } from '../../test/kaynakTarama';

const SRC = join(__dirname, '..', '..');

/** Yorumsuz kod, tek metin: etiket desenleri satır atlar (`<input` … `>` çok satırlıdır). */
const kodMetni = (yol: string): string => kodSatirlari(yol).map(s => s.kod).join('\n');

function kaynakDosyalari(dizin: string): string[] {
  return readdirSync(dizin).flatMap(ad => {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) return kaynakDosyalari(yol);
    return /\.tsx$/.test(ad) && !/\.test\.tsx$/.test(ad) ? [yol] : [];
  });
}

describe('DEĞİŞMEZ: SabitKiymetModule her çağrı yerinde kurları alır', () => {
  // AccountingModule sekmesi (menünün yönlendirdiği CANLI yüzey) `exchangeRates` geçirmiyordu:
  // her dövizli varlık "kur bulunamadı — toplam bu kayıtları İÇERMEZ" notuna düşüyor, aynı varlık
  // seti iki ekranda iki farklı ₺ toplamı üretiyordu. Kur arşivinde sorun yoktu; eksik olan prop'tu.
  it('`<SabitKiymetModule` geçen her etikette `exchangeRates=` var', () => {
    const eksikler: string[] = [];
    let cagri = 0;
    for (const yol of kaynakDosyalari(SRC)) {
      for (const e of kodMetni(yol).matchAll(/<SabitKiymetModule\b[^>]*>/g)) {
        cagri++;
        if (!/\bexchangeRates=/.test(e[0])) eksikler.push(`${yol.replace(SRC, 'src')}: ${e[0].replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    expect(cagri).toBeGreaterThan(0);        // tarama gerçekten bir şey buldu (desen bayatlamadı)
    expect(eksikler).toEqual([]);
  }, 60_000);                                // src altındaki bütün .tsx tek testte ayrıştırılır
});

describe('DEĞİŞMEZ: aylık hedef kutuları `type="number"` DEĞİLDİR', () => {
  // `type="number"` çözemediği metinde (`2.500.000`) `e.target.value` olarak '' verir; '' ise
  // `hedefGirdisi` için "hedefi sil" demektir → kullanıcı 2,5M yazdığını sanırken hedef sessizce
  // siliniyordu. Ham metin kapıya ulaşmalı: `type="text" inputMode="numeric"`.
  const HEDEF_TASLAKLARI = /value=\{(targetDraft|editingMonthDraft)\}/;
  it('hedef taslağına bağlı her <input> düz metindir', () => {
    const suclular: string[] = [];
    let kutu = 0;
    for (const dosya of ['pages/DashboardPage.tsx', 'pages/CRMPage.tsx']) {
      // Yorumlar atılır: etiketin içindeki açıklama `type="number"` sözcüğünü anabilir.
      for (const e of kodMetni(join(SRC, dosya)).matchAll(/<input\b[^>]*>/g)) {
        if (!HEDEF_TASLAKLARI.test(e[0])) continue;
        kutu++;
        if (/type="number"/.test(e[0]) || !/inputMode="numeric"/.test(e[0])) suclular.push(`${dosya}: ${e[0].replace(/\s+/g, ' ').slice(0, 140)}`);
      }
    }
    expect(kutu).toBe(3);                    // Pano 1 + CRM 2 (bu ay + 12 aylık tablo satırı)
    expect(suclular).toEqual([]);
  });
});
