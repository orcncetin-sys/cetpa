/**
 * belgeKilidi.ts — RESMÎ BELGE gönderiminin istemci uçuş kilidi (2026-10-17, şartname «e-Fatura çift kesim» § 7 D11). SAF: React yok.
 * Görsel durum için ince kanca: hooks/useBelgeKilidi. Test: belgeKilidi.test.ts (B6).
 *
 * NEDEN ORTAK MODÜL: e-İrsaliye kilidi App.tsx'te iki `useRef<Set>` + görsel `useState` olarak yazılıydı ve DAVRANIŞ testi yoktu;
 * e-Fatura'nın kilidi ise ÖLÜYDÜ (`faturaLoading` setter'sız yerel state — düğme yanıt beklerken etkin kalıyor, ikinci tıklama
 * Mikro'da ikinci resmî belge kesebiliyordu). İki belge AYNI modülü kullanır; App.tsx'te kopya Set ref kalmaz.
 *
 * Üç kapı (e-İrsaliyenin 2026-09-19 kalıbı):
 *   1. UÇUŞTA olan istek (`suren`): yanıt gelmeden ikinci tıklama. Küme SENKRON güncellenir — state güncellemesi bir sonraki
 *      çizime kadar görünmez, iki hızlı tıklama arasındaki pencereyi kapatmaz.
 *   2. Bu oturumda TAMAMLANMIŞ gönderim (`tamamlanan`): yerel kopya bayatlasa da (canlı dinleyici tazeleyene kadar) kapalı.
 *   3. Kalıcı işaret (`kesilmisMi`): çağıran CANLI listeden verir (e-İrsaliye: `irsaliyeNo` / `irsaliyeGonderildi`; e-Fatura:
 *      `mikroFaturasiKesilmisOlabilir`). Kesin koruma SUNUCUDADIR (e-Fatura: koşullu talep — D1); bu kilit ikinci isteği ağa
 *      hiç çıkarmaz ve kullanıcıyı yanıltmaz.
 *
 * Sıra (çağıranda): (a) salt-okur `durum` — `suruyor` / `kesilmis` ise onay penceresi AÇILMAZ; (b) onay; (c) `al` (yeniden
 * denetler — onay beklerken başka sekme / tıklama araya girebilir); (d) istek; (e) `finally` → `birak`; başarıda `tamamlandi`.
 */

export type KilitSonucu = 'alindi' | 'suruyor' | 'kesilmis';
export type KilitDurumu = 'serbest' | 'suruyor' | 'kesilmis';

export interface BelgeKilidi {
  /** Salt okur: kilit alınmaz. */
  durum(id: string, kesilmisMi?: boolean): KilitDurumu;
  /** Kilidi alır; sürüyorsa ya da belge kesilmişse nedenini döner (çağıran VAZGEÇER). */
  al(id: string, kesilmisMi?: boolean): KilitSonucu;
  /** Uçuş bitti (başarı ya da hata) — her yolda `finally` içinde çağrılır. */
  birak(id: string): void;
  /** Bu oturumda belge kesildi: sonraki `al` / `durum` `kesilmis` döner. */
  tamamlandi(id: string): void;
  /** Gönderimi süren kimlikler (görsel kilit: düğme pasif ve «Gönderiliyor…»). */
  suruyorlar(): Record<string, boolean>;
}

/** `bildir`: süren küme değişince yeni anlık görüntüyle çağrılır (kanca bunu `useState`'e bağlar). */
export function belgeKilidiOlustur(bildir?: (suruyorlar: Record<string, boolean>) => void): BelgeKilidi {
  const suren = new Set<string>();
  const tamamlanan = new Set<string>();
  const anlik = (): Record<string, boolean> => Object.fromEntries([...suren].map(id => [id, true]));
  const durum = (id: string, kesilmisMi = false): KilitDurumu => {
    if (suren.has(id)) return 'suruyor';
    if (tamamlanan.has(id) || kesilmisMi) return 'kesilmis';
    return 'serbest';
  };
  return {
    durum,
    al(id, kesilmisMi = false) {
      const d = durum(id, kesilmisMi);
      if (d !== 'serbest') return d;
      suren.add(id);
      bildir?.(anlik());
      return 'alindi';
    },
    birak(id) {
      if (!suren.delete(id)) return;
      bildir?.(anlik());
    },
    tamamlandi(id) { tamamlanan.add(id); },
    suruyorlar: anlik,
  };
}
