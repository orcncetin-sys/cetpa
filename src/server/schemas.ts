/**
 * schemas.ts - Paylasilan zod semalari.
 *
 * server.ts'ten AYRILDI (2026-08-24, D4 adim 8). Bu semalar hem server.ts'te
 * hem `routes/mikroRoutes.ts`'te gerekiyor. Alternatifler ve neden bu secildi:
 *   - mikroRoutes server.ts'ten IMPORT etseydi -> DONGUSEL bagimlilik.
 *   - Baglam nesnesiyle gecirilseydi -> tipi ELLE yazmak gerekirdi ve
 *     sema degisince tip sessizce bayatlardi (`any` verilince de z.infer
 *     calismiyor, dogrulanmis govdenin alanlari "does not exist" veriyor).
 * Semalari ortak bir modulde tutmak iki sorunu da cozer: tek kaynak, tip
 * z.infer ile SEMADAN turer, dongu yok. Bu dosya yalniz zod'a bagli.
 */
import { z } from 'zod';

/** `validate()`in kabul ettigi sema tipi.
 *  Baglamda `{ parse: ... }` diye YAKLASIK yazmak strictFunctionTypes
 *  altinda reddediliyor: gerceklestirim `safeParse` cagiriyor, yani
 *  yaklasik tip hem DAR hem YANLIS yontemi ilan ediyordu. */
export type Sema<T> = z.ZodSchema<T>;

// Fatura kaydetme şeması
export const FaturaKaydetSchema = z.object({
  firebaseId: z.string().optional(),
  order: z.object({
    mikroCariKod:  z.string().min(1, 'Cari kod zorunludur.'),
    lineItems:     z.array(z.object({
      sku:      z.string().optional(),
      name:     z.string().min(1),
      price:    z.number().nonnegative(),
      // KESİRLİ miktar geçerli (2,5 ton / 0,75 m³ — 2026-09-19 kullanıcı kararı); eski `.int()` bunları 400'lüyordu.
      quantity: z.number().positive().finite(),
      // Satır KDV tutarı (sipariş penceresinin kaleme yazdığı değer). zod bilinmeyen alanı SİLER — şemada yoksa gövdeye
      // hiç ulaşmaz ve KDV matrahtan yeniden hesaplanır (KDV dâhil yazılan 50,01 belgede 50,02 olurdu).
      kdv:      z.number().nonnegative().finite().optional(),
    })).min(1, 'En az bir satır gerekli.'),
    faturaTipi:   z.enum(['e-fatura', 'e-arsiv', 'ihracat']).optional(),
    kdvOran:      z.number().min(0).max(100).optional(),
    // Siparişte seçilmiş sevk deposu (AddOrderModal + OrdersPage sipariş düzenleme modalı).
    // zod bilinmeyen alanı SİLER — şemada yoksa
    // rotaya hiç ulaşmaz. Varsayılan YOK; yoksa gövde pariteye düşer (bkz. govdeFaturaIrsaliye başlığı).
    depoNo:       z.number().int().positive().optional(),
    createdAt:    z.string().optional(),
  }),
});

// İrsaliye kaydetme şeması
export const IrsaliyeKaydetSchema = z.object({
  firebaseId: z.string().optional(),
  shipment: z.object({
    mikroCariKod:   z.string().min(1, 'Cari kod zorunludur.'),
    customerName:   z.string().optional(),
    destination:    z.string().optional(),
    trackingNo:     z.string().optional(),
    cargoFirm:      z.string().optional(),
    items:          z.array(z.object({
      sku:      z.string().optional(),
      name:     z.string().min(1),
      // KESİRLİ miktar geçerli (2,5 ton / 0,75 m³ — 2026-09-19 kullanıcı kararı); eski `.int()` bunları 400'lüyordu.
      quantity: z.number().positive().finite(),
      price:    z.number().optional(),
    })).optional(),
    date:           z.string().optional(),
    // Mikro gövdesinde ZORUNLU iki alan: kdvOran (vergi işaretçisi ters araması) ve
    // depoNo (sth_giris/cikis_depo_no). Şemada optional — çünkü VARSAYILAN VERMEK
    // Mikro defterine sahte kayıt demek; eksikse gövde kurucusu 400 ile reddeder
    // (bkz. src/server/mikro/govdeFaturaIrsaliye.ts).
    kdvOran:        z.number().min(0).max(100).optional(),
    depoNo:         z.number().int().positive().optional(),
    // Faturasız (`false`) sevkiyat Mikro'ya yazılmaz — rota 400 döner. Alan yoksa (eski/kanal siparişi) karışılmaz.
    faturali:       z.boolean().optional(),
  }),
});

// Gelen fatura kabul/ret şeması
export const GelenFaturaActionSchema = z.object({
  faturaGuid:  z.string().min(1, 'faturaGuid zorunludur.'),
  firebaseId:  z.string().optional(),
  aciklama:    z.string().optional(),
});

// AI chat şeması
export const AiChatSchema = z.object({
  message:    z.string().min(1).max(4000),
  context:    z.string().max(8000).optional(),
  language:   z.enum(['tr', 'en']).optional(),
});

// server.ts'ten TASINDI (2026-08-26): epostaRoutes de kullaniyor.
// E-posta gönderim şeması
export const EmailSendSchema = z.object({
  to:      z.string().email('Geçerli bir e-posta adresi girin.'),
  subject: z.string().min(1, 'Konu boş olamaz.').max(200),
  html:    z.string().min(1, 'İçerik boş olamaz.'),
  from:    z.string().email().optional(),
  replyTo: z.string().email().optional(),
});

// Mağaza sipariş talebi şeması — KİMLİKSİZ uç `POST /api/magaza/siparis-talebi` (routes/magazaRoutes.ts).
// Rota ortak `validate()` yardımcısını KULLANMAZ (400'de zod ayrıntısı döndürür); kendi `safeParse` + sabit 400.
//  • Metinlerde `.max()` YOK: aşım ret değil KIRPMA (üst sınırı 64 KB gövde koyar; mağaza yanıtı okumuyor — ret
//    sessiz kayıp olurdu). Temizlik, kırpma ve «temizlikten sonra boş mu / telefonda 10 rakam var mı» denetimi
//    şemanın ardındaki saf eşleyicide: kanal/magazaTalep.ts `talepEsle` (bağlam ister — şema dönüşümü DEĞİL).
//  • `adet` üst sınırı YOK (kullanıcı kararı K4 — «sınır koyma»); `.int()` güvenli tam sayı dışını zaten reddeder.
//  • `birimFiyat` yok ya da null = «fiyat sorulacak»; varsayılan YOK, 0'a ÇEVRİLMEZ. Toplamlar da isteğe bağlı:
//    gönderilmediyse eşleyici `null` yazar (0 DEĞİL).
//  • `fiyatiSorulacakVar` şemada BİLEREK yok: zod bilinmeyen alanı SİLER — istemciden alınmaz, sunucuda kalemlerden türetilir.
//  • `no` deseni src/lib/magazaTalep.ts `MAGAZA_TALEP_NO_DESENI` ile AYNI olmalı (bu dosya yalnız zod'a bağlı kalsın
//    diye kopya; ayrışmayı kanal/magazaTalep.test.ts kilitler).
export const MagazaSiparisTalebiSchema = z.object({
  no:      z.string().regex(/^T\d{6}-[A-Z0-9]{4}$/),
  tarih:   z.string().optional(),
  musteri: z.object({
    ad:      z.string(),
    telefon: z.string(),
    firma:   z.string().optional(),
    eposta:  z.string().optional(),
    il:      z.string().optional(),
    adres:   z.string().optional(),
    vergi:   z.string().optional(),
  }),
  not:     z.string().optional(),
  kalemler: z.array(z.object({
    ad:         z.string(),
    adet:       z.number().int().positive(),
    id:         z.string().optional(),
    sku:        z.string().optional(),
    marka:      z.string().optional(),
    birimFiyat: z.number().nonnegative().nullable().optional(),
    tedarik:    z.boolean().optional(),
  })).min(1),
  araToplam: z.number().nonnegative().optional(),
  kdv:       z.number().nonnegative().optional(),
  toplam:    z.number().nonnegative().optional(),
});
