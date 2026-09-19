import { describe, it, expect } from 'vitest';
import { musteriBelgeTipi, siparisBelgeTipi, belgeTipiCelisiyor } from './belgeTipi';

describe('musteriBelgeTipi — belge tipi MÜŞTERİNİN e-Fatura kaydından türer (CETPA e-Fatura mükellefi)', () => {
  it('e-Fatura\'ya kayıtlı müşteri → e-fatura; kayıtlı OLMAYAN → e-arsiv (Mikro cari_efatura_fl aynası)', () => {
    expect(musteriBelgeTipi({ eFaturaKayitli: true })).toBe('e-fatura');
    expect(musteriBelgeTipi({ eFaturaKayitli: false })).toBe('e-arsiv');
  });
  it('kayıt durumu BİLİNMİYORSA tip UYDURULMAZ — eski sezgi (B2B / VKN ≥ 10 hane → e-fatura) ve `|| \'e-arsiv\'` kalktı (mutasyon-ayırt-edici)', () => {
    expect(musteriBelgeTipi({})).toBeNull();
    expect(musteriBelgeTipi({ eFaturaKayitli: undefined })).toBeNull();
    expect(musteriBelgeTipi({ eFaturaKayitli: null })).toBeNull();
    expect(musteriBelgeTipi(null)).toBeNull();
    expect(musteriBelgeTipi(undefined)).toBeNull();
    // VKN'si olan B2B müşteri e-Fatura'ya kayıtlı OLMAYABİLİR: sezgi yanlış belge kestirirdi.
    expect(musteriBelgeTipi({ customerType: 'B2B', taxId: '1234567890' } as never)).toBeNull();
  });
  it('yalnız gerçek boolean kabul edilir (1 / "true" gibi değerler tip yalanıdır)', () => {
    expect(musteriBelgeTipi({ eFaturaKayitli: 1 as never })).toBeNull();
    expect(musteriBelgeTipi({ eFaturaKayitli: 'true' as never })).toBeNull();
  });
});

describe('siparisBelgeTipi — sipariş üzerindeki AÇIK seçim önce gelir', () => {
  it('siparişte tip seçilmişse o kullanılır (ihracat dâhil)', () => {
    expect(siparisBelgeTipi({ faturaTipi: 'ihracat' }, { eFaturaKayitli: true })).toBe('ihracat');
    expect(siparisBelgeTipi({ faturaTipi: 'e-arsiv' }, { eFaturaKayitli: true })).toBe('e-arsiv');
  });
  it('siparişte yoksa müşteriden türer; o da bilinmiyorsa null — çağıran kullanıcıya SORAR, e-Arşiv varsaymaz', () => {
    expect(siparisBelgeTipi({}, { eFaturaKayitli: true })).toBe('e-fatura');
    expect(siparisBelgeTipi({ faturaTipi: null }, { eFaturaKayitli: false })).toBe('e-arsiv');
    expect(siparisBelgeTipi({}, {})).toBeNull();
    expect(siparisBelgeTipi({}, undefined)).toBeNull();
  });
  it('tanınmayan tip metni yok sayılır (DB\'de bozuk değer sahte belge tipine dönüşmez)', () => {
    expect(siparisBelgeTipi({ faturaTipi: 'E-FATURA' as never }, { eFaturaKayitli: false })).toBe('e-arsiv');
    expect(siparisBelgeTipi({ faturaTipi: '' as never }, {})).toBeNull();
  });
});

// 2026-09-19 uçtan uca inceleme: Cetpa'da AÇILIP Mikro'ya gönderilen carinin e-Fatura kaydı bilinmiyorsa gövdeye
// `cari_efatura_fl: 0` gidiyor; saatlik cron o 0'ı `eFaturaKayitli: false` = "kayıtlı DEĞİL, biliniyor" diye geri
// yazıyor. Bu SAHTE kesinlik artık belge tipini belirlediği için: o carilerde `false` TEYİTSİZDİR (rota işaretler).
describe('musteriBelgeTipi — Cetpa kaynaklı TEYİTSİZ "kayıtsız" bilgisine güvenilmez', () => {
  it('teyitsiz + false → null (e-Arşiv VARSAYILMAZ) — mutasyon-ayırt-edici', () => {
    expect(musteriBelgeTipi({ eFaturaKayitli: false, eFaturaKaydiTeyitsiz: true })).toBeNull();
  });
  it('teyitsiz olsa da `true` güvenilirdir (1 yalnız Mikro\'nun gerçek kaydından gelebilir); teyitsiz değilse false → e-arsiv', () => {
    expect(musteriBelgeTipi({ eFaturaKayitli: true, eFaturaKaydiTeyitsiz: true })).toBe('e-fatura');
    expect(musteriBelgeTipi({ eFaturaKayitli: false, eFaturaKaydiTeyitsiz: false })).toBe('e-arsiv');
  });
});

// Mevcut siparişlerdeki `faturaTipi` kullanıcı seçimi DEĞİL, kaldırılan sezgilerle (B2B / VKN ≥ 10 → e-fatura;
// faturalı → e-fatura) yazıldı. Müşterinin GERÇEK kaydıyla çelişiyorsa sessizce gönderilmez — kullanıcıya sorulur.
describe('belgeTipiCelisiyor — siparişteki tip ile müşterinin kaydı', () => {
  it('ikisi de biliniyor ve farklıysa çelişki', () => {
    expect(belgeTipiCelisiyor({ faturaTipi: 'e-arsiv' }, { eFaturaKayitli: true })).toBe(true);
    expect(belgeTipiCelisiyor({ faturaTipi: 'e-fatura' }, { eFaturaKayitli: false })).toBe(true);
  });
  it('aynıysa, müşteri kaydı bilinmiyorsa, siparişte tip yoksa ya da tip ihracatsa çelişki YOK', () => {
    expect(belgeTipiCelisiyor({ faturaTipi: 'e-fatura' }, { eFaturaKayitli: true })).toBe(false);
    expect(belgeTipiCelisiyor({ faturaTipi: 'e-arsiv' }, {})).toBe(false);
    expect(belgeTipiCelisiyor({}, { eFaturaKayitli: true })).toBe(false);
    expect(belgeTipiCelisiyor({ faturaTipi: 'ihracat' }, { eFaturaKayitli: true })).toBe(false);
    expect(belgeTipiCelisiyor({ faturaTipi: 'e-fatura' }, { eFaturaKayitli: false, eFaturaKaydiTeyitsiz: true })).toBe(false);
  });
});

// İşaret (`eFaturaKaydiTeyitsiz`) yalnız bu sürümden SONRA gönderilen cariye düşer. Daha önce Cetpa'dan Mikro'ya
// gönderilmiş carilerde cron'un yazdığı sahte `false` işaretsizdir. Onlar KODLARINDAN tanınır: rota, Mikro cari kodu
// olmayan lead'e `CAR` + doküman id'sinin ilk 6 karakteri (BÜYÜK) kodunu üretir (server/mikro/govdeStokCari).
describe('musteriBelgeTipi — Cetpa\'nın ürettiği cari kodu (CAR+id) taşıyan eski kayıtlar da teyitsizdir', () => {
  it('kod CAR+id kalıbındaysa `false` güvenilmez → null (geri doldurma betiği gerekmez) — mutasyon-ayırt-edici', () => {
    expect(musteriBelgeTipi({ id: 'abc123xyz789', mikroCariKod: 'CARABC123', eFaturaKayitli: false })).toBeNull();
  });
  it('Mikro\'nun kendi cari kodunu taşıyan kayıtta `false` güvenilirdir; CAR+id kalıbında `true` yine güvenilir', () => {
    expect(musteriBelgeTipi({ id: 'abc123xyz789', mikroCariKod: '120.01.0042', eFaturaKayitli: false })).toBe('e-arsiv');
    expect(musteriBelgeTipi({ id: 'abc123xyz789', mikroCariKod: 'CARABC123', eFaturaKayitli: true })).toBe('e-fatura');
    expect(musteriBelgeTipi({ id: 'zzz999', mikroCariKod: 'CARABC123', eFaturaKayitli: false })).toBe('e-arsiv'); // kod başka id'den — Mikro'da elle açılmış 'CAR…' olabilir
  });
});

