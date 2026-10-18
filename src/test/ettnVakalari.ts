// ettnVakalari.ts — «geçerli ETTN» VAKA TABLOSU (şartname «fatura gövde + gece MF» § 9.B B6, 2026-10-19).
//
// Neden ortak: aynı tablo AYNI anda `cetpaEttnAnahtari`'ya (lib/ettn.test), uca (`POST /api/mikro/fatura/sonuc`
// `ettnEkle` — server/faturaCiftKesim.zincir.test) ve ikinci turda istemci düğme yüklemine verilir; sonuçlar BİREBİR olmalı.
// Tek yerde durur ki bir yüzey kendi küçük tablosuyla «geçti» demesin. Uygulama kodu bu dosyayı içe aktarmaz.
//
// `anahtar`: `cetpaEttnAnahtari(girdi)` beklenen değeri; `''` = geçersiz (uç 400 döner). `bos`: şema boş / yalnız boşluk
// ETTN'yi «verilmedi» sayar — uç bu iki vakada `FATURA_ETTN_GECERSIZ` DEĞİL, şema iletisi döner (yine 400, yazım yok).
export interface EttnVakasi { ad: string; girdi: string; anahtar: string; bos?: true }

const GECERLI = 'abcdef12-3456-7890-abcd-ef1234567890';
const GECERLI_BUYUK = 'ABCDEF12-3456-7890-ABCD-EF1234567890';

export const ETTN_VAKALARI: readonly EttnVakasi[] = [
  { ad: 'boş', girdi: '', anahtar: '', bos: true },
  { ad: 'yalnız boşluk', girdi: '   ', anahtar: '', bos: true },
  { ad: 'sıfır GUID', girdi: '00000000-0000-0000-0000-000000000000', anahtar: '' },
  { ad: 'parantezli sıfır GUID', girdi: '{00000000-0000-0000-0000-000000000000}', anahtar: '' },
  { ad: '35 karakter', girdi: GECERLI.slice(0, 35), anahtar: '' },
  { ad: '37 karakter', girdi: `${GECERLI}0`, anahtar: '' },
  { ad: 'onaltılık dışı karakter', girdi: `${GECERLI.slice(0, 35)}g`, anahtar: '' },
  // 36 karakter, yalnız onaltılık + tire — `ettnGecerli` tek başına KABUL ederdi; `guidBicimli` tire yerini sınar (B4).
  { ad: 'tire yeri bozuk', girdi: 'abcdef123-456-7890-abcd-ef1234567890', anahtar: '' },
  { ad: 'geçerli', girdi: GECERLI, anahtar: GECERLI },
  { ad: 'parantezli geçerli', girdi: `{${GECERLI}}`, anahtar: GECERLI },
  { ad: 'büyük harfli geçerli', girdi: GECERLI_BUYUK, anahtar: GECERLI },
  { ad: 'boşluklu, parantezli, büyük harfli geçerli', girdi: `  {${GECERLI_BUYUK}}  `, anahtar: GECERLI },
];
