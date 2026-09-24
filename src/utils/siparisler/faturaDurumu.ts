/**
 * faturaDurumu — "bu siparişin faturası VAR mı" ile "faturalı satış mı" AYRI sorulardır.
 *
 * Neden var (2026-09-24, kullanıcı kuralı: "faturası olan bir şeye tekrar fatura kestiremeyiz"):
 * OrdersPage:1449 'Fatura Kes' düğmesi `!hasInvoice && faturali !== false` ile açılıyordu.
 * Mikro'dan gelen fatura satırları (`source: 'mikro-fatura'`, sunucu `faturali: true` yazar,
 * `mikroFaturaNo` dolu) bu koşulu GEÇİYOR ve MF-383 gibi zaten-fatura olan satırda
 * 'Fatura Kes' görünüyordu. Kök neden: `faturali` bayrağı "faturalı satış / faturasız satış"
 * ayrımıdır (App.tsx:3121 form alanı, kdvAylik sayacı), "fatura kesildi" anlamına gelmez.
 *
 * Sözleşme:
 *  - `siparisFaturaVar`: Cetpa faturası (`hasInvoice`) YA DA Mikro faturası (`mikroFaturaNo`)
 *    YA DA satırın kendisi bir Mikro faturası (`source === 'mikro-fatura'`). Yalnız GERÇEK
 *    boolean/string kabul edilir — `'true'`/`1` gibi değerler fatura kanıtı sayılmaz.
 *  - `faturaKesilebilir`: faturasız satış (`faturali === false`) DEĞİL ve faturası YOK.
 *  - `mikroyaFaturaGonderilebilir`: Mikro'da faturası yok ve satır Mikro faturası değil;
 *    Cetpa-iç faturanın (`hasInvoice`) olması Mikro'ya e-Fatura göndermeyi ENGELLEMEZ
 *    (yerel kayıt → Mikro e-Fatura akışı meşru). `faturali === false` yine kapatır.
 *
 * Parite: eşleşen bilinen girdilerde (native sipariş, hasInvoice yok, faturali undefined/true)
 * eski davranışla BİREBİR; tek fark Mikro faturası olan satırlarda düğmenin KAPANMASI.
 */
export interface FaturaDurumuGirdisi {
  source?: string;
  hasInvoice?: boolean;
  mikroFaturaNo?: string;
  faturali?: boolean;
}

export function siparisFaturaVar(o: FaturaDurumuGirdisi | null | undefined): boolean {
  if (!o) return false;
  if (o.source === 'mikro-fatura') return true;
  if (typeof o.mikroFaturaNo === 'string' && o.mikroFaturaNo.trim() !== '') return true;
  return o.hasInvoice === true;
}

export function faturaKesilebilir(o: FaturaDurumuGirdisi | null | undefined): boolean {
  if (!o) return false;
  if (o.faturali === false) return false;
  return !siparisFaturaVar(o);
}

export function mikroyaFaturaGonderilebilir(o: FaturaDurumuGirdisi | null | undefined): boolean {
  if (!o) return false;
  if (o.faturali === false) return false;
  if (o.source === 'mikro-fatura') return false;
  return !(typeof o.mikroFaturaNo === 'string' && o.mikroFaturaNo.trim() !== '');
}
