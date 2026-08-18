/**
 * storageBucket.ts — Firebase Storage bucket adını ÇALIŞMA ANINDA çözer.
 *
 * NEDEN VAR (2026-08-18): Operasyon Bekçisi'nde iki yedek kontrolü de
 * "The specified bucket does not exist" veriyordu — yani off-site yedek HİÇ
 * alınmıyordu. Kod tarafında tutarsızlık yoktu; hem bekçi hem yedek scripti
 * aynı SABİT adı kullanıyordu: `<proje>.firebasestorage.app`.
 *
 * Firebase projelerinde bucket adı İKİ biçimde olabilir:
 *   • eski projeler : <proje>.appspot.com
 *   • yeni projeler : <proje>.firebasestorage.app
 * Sabit yanlış biçimi taşıyorsa hem yedek görevi hem bekçi sessizce ölür ve
 * bu ancak aylar sonra, veri lazım olduğunda fark edilir.
 *
 * Sabit bir ada bağlı kalmak yerine adayları SIRAYLA sınayıp var olanı
 * kullanıyoruz. Böylece hangi biçimin doğru olduğunu bilmeye gerek kalmıyor
 * ve proje ileride taşınsa da kod kendi kendini düzeltiyor.
 */

/** Aday bucket adları — env ile ezilebilir (özel bir bucket kullanılıyorsa). */
export function bucketAdaylari(projectId: string, envDeger?: string): string[] {
  const adaylar = [
    envDeger,
    `${projectId}.firebasestorage.app`,
    `${projectId}.appspot.com`,
  ].filter((v): v is string => !!v && !!v.trim());
  return adaylar.filter((v, i, a) => a.indexOf(v) === i);
}

export interface BucketBenzeri {
  exists(): Promise<[boolean]>;
  name?: string;
}

/**
 * Adayları sırayla dener, GERÇEKTEN var olan ilkini döndürür.
 * Hiçbiri yoksa null döner — çağıran taraf bunu YÜKSEK SESLE bildirmeli,
 * sessizce devam etmemeli (yedek alınmıyor demektir).
 */
export async function bucketCoz(
  adaylar: string[],
  al: (ad: string) => BucketBenzeri,
): Promise<{ ad: string; denenen: string[] } | { ad: null; denenen: string[] }> {
  for (const ad of adaylar) {
    try {
      const [varMi] = await al(ad).exists();
      if (varMi) return { ad, denenen: adaylar };
    } catch { /* bu aday sınanamadı, sıradakine geç */ }
  }
  return { ad: null, denenen: adaylar };
}
