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
      quantity: z.number().int().positive(),
    })).min(1, 'En az bir satır gerekli.'),
    faturaTipi:   z.enum(['e-fatura', 'e-arsiv', 'ihracat']).optional(),
    kdvOran:      z.number().min(0).max(100).optional(),
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
      quantity: z.number().int().positive(),
      price:    z.number().optional(),
    })).optional(),
    date:           z.string().optional(),
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
