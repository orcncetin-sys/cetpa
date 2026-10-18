/**
 * ettnGirdisi.ts — kullanıcının girdiği ETTN'nin İSTEMCİ ön sınaması (şartname «fatura gövde + gece MF» § 9.B B4 / B5, 2026-10-19).
 * SAF: React, DB, ağ yok. Test: ettnGirdisi.test.ts (ortak vaka tablosu `test/ettnVakalari` — uçla birebir).
 *
 * «Mikro'da var» seçeneğindeki isteğe bağlı ETTN girdisi (`FaturaSonucuSecenekleri`), «ETTN ekle» bileşeni (`FaturaEttnEkle`) ve
 * App.tsx işleyicileri AYNI işlevi okur — kopya ön sınama yok. Ölçüt `cetpaEttnAnahtari` (lib/ettn): sunucunun `fatura/sonuc`
 * rotasında ve gece faturadan-sipariş işinde okuduğu AYNI işlev. GUID düzenli ifadesi burada YAZILMAZ (B4 çiti — lib/ettn.test).
 *
 * Gönderilen değer ham girdi DEĞİL anahtardır (küçük harf, parantezsiz): sunucu da anahtarı yazar; yerel yama yanıttaki `ettn`'den.
 */
import { cetpaEttnAnahtari } from '../../lib/ettn';
import type { ArayuzDili } from '../zaman';

/** Girdinin `maxLength`'i: 36 karakterlik GUID + süslü parantez çifti (Mikro ekranından kopyalanan biçim). */
export const ETTN_GIRDI_UZUNLUGU = 38;

export interface EttnGirdisi {
  /** Kırpılmış girdi boş değil. */
  dolu: boolean;
  /** Geçerliyse `cetpaEttnAnahtari` anahtarı; geçersiz ya da boşsa `''`. */
  anahtar: string;
  /** Dolu AMA geçersiz — satır içi hata gösterilir, düğme pasif. */
  gecersiz: boolean;
}

export function ettnGirdisi(ham: string): EttnGirdisi {
  const dolu = ham.trim() !== '';
  const anahtar = dolu ? cetpaEttnAnahtari(ham) : '';
  return { dolu, anahtar, gecersiz: dolu && anahtar === '' };
}

/** Satır içi hata metni (sunucunun `FATURA_ETTN_GECERSIZ` iletisiyle aynı içerik). */
export function ettnGecersizMetni(dil: ArayuzDili): string {
  return dil === 'tr'
    ? 'ETTN geçersiz: Mikro\'da e-Fatura ekranındaki 36 karakterlik ETTN\'yi girin (sıfır ETTN kabul edilmez).'
    : 'Invalid ETTN: enter the 36-character ETTN from the e-Invoice screen in Mikro (an all-zero ETTN is not accepted).';
}

/** Girdinin yardım metni (B5). */
export function ettnYardimMetni(dil: ArayuzDili): string {
  return dil === 'tr' ? 'Mikro\'da faturanın ETTN\'si (e-Fatura ekranında)' : 'The invoice ETTN in Mikro (on the e-Invoice screen)';
}
