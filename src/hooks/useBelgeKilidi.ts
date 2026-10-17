/**
 * useBelgeKilidi.ts — resmî belge uçuş kilidinin (utils/siparisler/belgeKilidi) İNCE kancası: kilit nesnesi bileşenin ömrü
 * boyunca TEK (kümeler senkron — iki hızlı tıklama arasındaki pencereyi kapatır), görsel durum (`suruyor`: düğme pasif ve
 * «Gönderiliyor…») kilidin kendi bildiriminden gelir. Karar mantığı burada YOK; tek kaynak saf modül (2026-10-17, şartname
 * «e-Fatura çift kesim» D11). App.tsx e-İrsaliye ve e-Fatura için ikişer kez çağırır.
 */
import { useState } from 'react';
import { belgeKilidiOlustur, type BelgeKilidi } from '../utils/siparisler/belgeKilidi';

export function useBelgeKilidi(): { kilit: BelgeKilidi; suruyor: Record<string, boolean> } {
  const [suruyor, setSuruyor] = useState<Record<string, boolean>>({});
  // Tembel ilk değer: kilit yalnız ilk çizimde kurulur ve sonraki çizimlerde AYNI nesne döner (state setter sabittir).
  const [kilit] = useState<BelgeKilidi>(() => belgeKilidiOlustur(setSuruyor));
  return { kilit, suruyor };
}
