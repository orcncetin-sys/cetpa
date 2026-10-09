/**
 * onayDegismez.test.ts — onay penceresi sınıfının iki değişmezi (2026-09-19, e-İrsaliye uçtan uca incelemesi).
 *
 * 1. KAYNAK TARAMA: `onConfirm` gövdesinde `e.target.value` OKUNAMAZ. Kontrollü `<select value={x}>`'te React
 *    onChange biter bitmez DOM değerini eski hâline döndürür; onay penceresi açıkken geçen sürede `e.target.value`
 *    ESKİ değeri verir ve o yazılır. Sipariş listesindeki durum seçicisi 2026-06-12'den beri bu yüzden durumu HİÇ
 *    değiştirmiyordu (CRMPage'de de aynısı vardı) — kimse fark etmedi çünkü hata vermiyor, yalnız hiçbir şey yapmıyor.
 *    Doğrusu: değeri onChange'in başında bir sabite al, mesajda ve `onConfirm`'de o sabiti kullan.
 * 2. `onayAcikMi()`: kendiliğinden açılan onaylar (await zincirinin sonunda) başka bir onayın yerine geçmemeli.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { kodSatirlari } from '../test/kaynakTarama';
import { confirmAction, onayAcikMi, _registerConfirmListener, _resolveConfirm } from './confirm';

const KOK = resolve(__dirname, '..');
function tsxDosyalari(dizin: string): string[] {
  return readdirSync(dizin).flatMap(ad => {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) return tsxDosyalari(yol);
    return /\.tsx$/.test(ad) ? [yol] : [];
  });
}

describe('DEĞİŞMEZ: onConfirm gövdesi olay nesnesinden değer OKUMAZ', () => {
  it('src altında `onConfirm: … e.target.value` kalıbı yok (yorumlar hariç)', () => {
    const suclular: string[] = [];
    for (const dosya of tsxDosyalari(KOK)) {
      for (const { n, kod } of kodSatirlari(dosya)) {                             // yorumsuz: kuralı ANLATAN satırlar serbest
        if (/onConfirm\s*:/.test(kod) && /\be(v|vent)?\.target\.value\b/.test(kod)) suclular.push(`${dosya.replace(KOK + '/', '')}:${n}`);
      }
    }
    expect(suclular).toEqual([]);
  }, 60_000);   // src altındaki bütün .tsx (testler dâhil) tek testte ayrıştırılır
});

describe('onayAcikMi — açık onay penceresi var mı', () => {
  it('pencere açıkken true, çözülünce false; host bağlı değilken hiç açılmaz', async () => {
    expect(onayAcikMi()).toBe(false);
    const ayir = _registerConfirmListener(() => {});
    try {
      const soz = confirmAction({ title: 'Toplu güncelleme', message: '3 sipariş güncellensin mi?' });
      expect(onayAcikMi()).toBe(true);
      _resolveConfirm(true);
      expect(await soz).toBe(true);
      expect(onayAcikMi()).toBe(false);
    } finally { ayir(); }
  });
});
