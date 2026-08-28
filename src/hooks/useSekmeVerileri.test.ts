import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * useSekmeVerileri'nin DÖNDÜRDÜĞÜ her değer App.tsx'te GERÇEKTEN kullanılmalı.
 *
 * ## Bu test neden var
 *
 * Kancanın kendi başlığı "state'i döndürdüğü için 'yazdım ama bağlamadım'
 * imkânsız" diyordu. YANLIŞTI: kanca değişkenin App.tsx'te VAR OLMASINI
 * garanti eder, ALT BİLEŞENE GEÇİRİLMESİNİ etmez.
 *
 * 2026-08-28'de iki değer tam bu boşluktan düştü:
 *   - `p554Bins`    → <OrdersPage> çağrısına hiç geçirilmiyordu
 *                     (Lojistik → Bin/Lokasyon ekranı sayaçları 0, liste boş)
 *   - `p549Iadeler` → <CRMPage> çağrısına hiç geçirilmiyordu
 *                     (CRM → İade & Değişim / RMA ekranı aynı durumda)
 *
 * İkisinde de veri DB'ye yazılıyor, dinleyici okuyor, kanca döndürüyordu;
 * ekrana ulaşmıyordu. Derleyici sustu: `noUnusedLocals` kapalı ve eslint'te
 * `no-unused-vars` 'off'.
 *
 * ## Ölçüt
 *
 * App.tsx'te değer adı EN AZ 2 kez geçmeli: bir kez destructure satırında,
 * en az bir kez de kullanımda (JSX prop'u, hesap, vb.). Tam olarak 1 kez
 * geçiyorsa "alındı ama hiçbir yere verilmedi" demektir — asıl hata buydu.
 */

const oku = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Kancanın `return { ... }` bloğundaki değer adları (setter'lar hariç). */
function donenDegerler(kaynak: string): string[] {
  const i = kaynak.lastIndexOf('return {');
  expect(i, 'useSekmeVerileri içinde return bloğu bulunamadı').toBeGreaterThan(-1);
  const blok = kaynak.slice(i, kaynak.indexOf('};', i));
  return [...blok.matchAll(/^\s{4}([a-zA-Z][\w]*),$/gm)]
    .map(m => m[1])
    .filter(ad => !/^set[A-Z]/.test(ad));
}

describe('useSekmeVerileri — döndürülen her değer App.tsx’te kullanılmalı', () => {
  const hook = oku('./useSekmeVerileri.ts');
  const app = oku('../App.tsx');
  const degerler = donenDegerler(hook);

  it('kancadan makul sayıda değer dönüyor (regex bozulmadı)', () => {
    expect(degerler.length).toBeGreaterThan(10);
  });

  it.each(degerler.map(d => [d]))('%s — sadece destructure edilip bırakılmamış', (ad) => {
    const adet = (app.match(new RegExp(`\\b${ad}\\b`, 'g')) || []).length;
    expect(
      adet,
      `App.tsx'te '${ad}' yalnız ${adet} kez geçiyor. 1 = sadece destructure ` +
      `edilmiş, hiçbir yere verilmemiş — ekran bu veriyi ASLA görmez. ` +
      `İlgili <Page> çağrısına prop olarak geçirin.`,
    ).toBeGreaterThanOrEqual(2);
  });
});
