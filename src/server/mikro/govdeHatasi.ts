/**
 * govdeHatasi.ts — Mikro'ya YAZILACAK gövde kurulurken "bu alanı bilmiyorum" hatası
 * (Faz 3 3/n, 2026-09-19).
 *
 * NEDEN: Dış sisteme yazan gövdede VARSAYILAN YOKTUR (CLAUDE.md). `depoNo ?? 1`,
 * `price ?? 0`, `quantity ?? 1`, `vergi_pntr: 4`, hatta varsayılan parametre
 * (`depoNo = 1`) karşı tarafın DEFTERİNE sahte kayıt düşürür. 2026-09-05'te yedi
 * ayrı gövde üreticisi her kaydı "depo 1" yazıyordu; gerçek stok depo 2'deydi ve
 * her onaylanan çıkış YILLIK olarak yanlış depoya gitti. Hata SESSİZ oldu, çünkü
 * varsayılan değer geçerli bir Mikro kaydı üretir.
 *
 * KURAL: gövde kurucusu bir alanı bilmiyorsa `throw new MikroGovdeHatasi(alan, satirNo?)`.
 * Rota bunu yakalar ve **400 `{ success: false, error }`** döner; `mikroPost` HİÇ
 * çağrılmaz. İstemci tarafı (MikroPushButton, src/services/mikroEvrak.ts,
 * mikroService.ts) hata mesajını zaten kullanıcıya gösterir — bu yüzden mesaj
 * TÜRKÇE ve hangi kalemin hangi alanı olduğunu söyler.
 *
 * Bu dosya BİLEREK küçük ve bağımsız: Faz 3 3/n'de dört gövde grubu paralel
 * yazılıyor, hepsi bu sınıfı import edecek — aynı dosyayı yarışarak yazmasınlar.
 */

/** Mikro gövdesinde bilinmeyen alan. Rota: 400 + `error: e.message`, mikroPost çağrılmaz. */
export class MikroGovdeHatasi extends Error {
  /** İnsan okunur alan adı — mesaja aynen girer ("birim fiyatı", "depo numarası"). */
  readonly alan: string;
  /** 1'den başlayan kalem sırası (varsa). Kullanıcı ekranda satırı böyle sayar. */
  readonly satirNo?: number;
  /** İsteğe bağlı ek bağlam ("sto_yer_kod boş geldi") — mesajın sonuna parantezle eklenir. */
  readonly aciklama?: string;

  constructor(alan: string, satirNo?: number, aciklama?: string) {
    super(govdeHatasiMesaji(alan, satirNo, aciklama));
    this.alan = alan;
    // Number.isFinite — global isFinite DEĞİL: isFinite(null) === true olduğu için
    // null bir satır numarası "1." kalem gibi görünürdü (CLAUDE.md).
    if (Number.isFinite(satirNo)) this.satirNo = satirNo;
    if (aciklama) this.aciklama = aciklama;
    this.name = 'MikroGovdeHatasi';
    // ES2022 hedefinde Error alt sınıfı prototip zinciri kurulur, ama tsx/esbuild'in
    // downlevel çıktısında kurulmaz ve `instanceof` SESSİZCE false döner. Rota
    // catch'i buna güvendiği için elle bağlıyoruz.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Mesaj biçimi tek yerde: sınıf ve (varsa) log/test aynı cümleyi üretsin. */
export function govdeHatasiMesaji(alan: string, satirNo?: number, aciklama?: string): string {
  const govde = Number.isFinite(satirNo)
    ? `${satirNo}. kalemin ${alan} bilinmiyor`
    : `${alan} bilinmiyor`;
  return `Mikro'ya gönderilemedi: ${govde}${aciklama ? ` (${aciklama})` : ''}`;
}

/**
 * Rota catch'i için tip daraltıcı. `instanceof` yeterlidir; `name` yedeği yalnız
 * modülün iki kez yüklendiği (tsx + vitest karışımı) hâl için — sessiz 500 yerine
 * doğru 400 dönsün.
 */
export function mikroGovdeHatasiMi(e: unknown): e is MikroGovdeHatasi {
  return e instanceof MikroGovdeHatasi || (e instanceof Error && e.name === 'MikroGovdeHatasi');
}
