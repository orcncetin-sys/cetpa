import type React from 'react';
/**
 * recharts.ts — Recharts `Tooltip formatter`'ı için tip köprüsü.
 *
 * ## Neden var
 *
 * Recharts'ın `Formatter` tipi çağrıya `ValueType` (`string | number |
 * Array<string|number>`) geçiriyor. Kod tabanındaki 6 çağrı yeri ise
 * `(v: number) => ...` yazıyordu. `strictFunctionTypes` KAPALIYKEN bu sessizce
 * geçiyordu; açılınca hepsi hata verdi — çünkü söz verilenden DAR bir parametre
 * kabul etmek gerçekten güvensiz: recharts bir dizi ya da dize geçirdiğinde
 * `v.toLocaleString(...)` beklenmedik çıktı üretir (dizide "1,2" gibi).
 *
 * Çözüm: değeri sayıya ÇEVİRİP çağırana veren tek bir sarmalayıcı. Her çağrı
 * yerine `as never` / `as any` serpiştirmek hatayı kapatırdı ama asıl riski
 * (sayı olmayan değer) olduğu gibi bırakırdı.
 *
 * Sayıya çevrilemeyen değer için çağıran fonksiyon HİÇ çağrılmaz; recharts'a
 * ham değer aynen geri verilir — uydurma bir sayı (0 gibi) ÜRETİLMEZ.
 * (Projede "sessiz sıfır" yasak; bkz. hafıza: kur-yoksa-uydurma.)
 */

// Recharts'ın KENDİ tiplerini kullanıyoruz — elle yaklaşık bir tip yazmak
// `strictFunctionTypes` altında parametre karşıtlığı (contravariance) yüzünden
// kabul edilmiyordu ve ilk denememde tam bu hataya düştüm.
import type { Formatter, ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';

type RechartsDeger = ValueType | undefined;

/** Sayıya çevrilebiliyorsa sayı, değilse `null`. Dizi/boş değer sayıya çevrilmez. */
function sayiya(v: RechartsDeger): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  return null;
}

/**
 * `(sayı) => çıktı` biçimindeki bir biçimleyiciyi recharts'ın beklediği
 * imzaya çevirir.
 *
 * Kullanım:
 *   <Tooltip formatter={sayiBicimleyici(v => [`₺${v.toLocaleString('tr-TR')}`, 'Değer'])} />
 */
export function sayiBicimleyici(
  fn: (n: number, ad: string) => [React.ReactNode, NameType] | React.ReactNode,
): Formatter<ValueType, NameType> {
  return (deger, ad) => {
    const n = sayiya(deger);
    // Çevrilemedi → ham değeri aynen geri ver. Uydurma bir sayı (0) ÜRETİLMEZ.
    if (n === null) return deger as React.ReactNode;
    return fn(n, typeof ad === 'string' ? ad : String(ad ?? ''));
  };
}
