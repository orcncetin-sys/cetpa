/**
 * depoNo.test.ts — Muhasebe → Transfer sekmesi "Mikro'ya Gönder" depo numarası sözleşmesi
 * (Faz 3 2/n, grup "transferMikro", 2026-09-14). ÖNCE YAZILDI.
 *
 * Sahte kesinlik sitesi (src/components/accounting/TransferTab.tsx):
 *   114  const depoNo = (s: string) => parseInt((s.match(/\d+/) ?? ['1'])[0], 10);
 *        → Transfer.fromWarehouse/toWarehouse depo ADI taşır ("ESKİ SANAYİ"); adda rakam yoksa
 *          Mikro'ya DEPO 1 (HAVALİMANI) varsayılıyor, rakam varsa ilk rakam dizisi depo no
 *          sanılıyordu ("Şube 34 Depo" → 34). ESKİ SANAYİ → HAVALİMANI transferi Mikro'ya 1→1
 *          yazılıyor, hata da vermiyordu.
 * Kural (CLAUDE.md): dış sisteme giden payload'da VARSAYILAN YOK — depo bilinmiyorsa undefined,
 * payload üretilmez (TransferTab null döner, MikroPushButton "gönderilemez" sayar); tahmin yok.
 */
import { describe, it, expect } from 'vitest';
import { mikroDepoNo, transferDepoNolari, mikroDepoSecenekleri, type DepoKaydi } from './depoNo';

// ── Fikstür: Mikro DEPOLAR import'u + elle açılmış Cetpa deposu ─────────────────────────────
/** Sayfanın Warehouse'u daha geniş (location/manager/...); hesap yalnız id/name/depoNo okur. */
type Depo = DepoKaydi & { location?: string; source?: string };
const depolar: Depo[] = [
  { id: 'mikro-depo-1', name: 'HAVALİMANI', depoNo: 1, source: 'mikro' },
  { id: 'mikro-depo-2', name: 'ESKİ SANAYİ', depoNo: 2, source: 'mikro' },
  // Yeni (kiracı etiketli) id biçimi — mikroIdCozucu `mikro-<8hex>-depo-<no>` üretir
  { id: 'mikro-1a2b3c4d-depo-3', name: 'MERKEZ', depoNo: 3, source: 'mikro' },
  // dep_adi boş gelince import `Depo ${depoNo}` yazar — eski kodun DOĞRU çözdüğü tek ad biçimi
  { id: 'mikro-depo-5', name: 'Depo 5', depoNo: 5, source: 'mikro' },
  // Elle açılmış Cetpa deposu: Mikro karşılığı YOK (adda rakam var ama depo no DEĞİL)
  { id: 'q7Kd2pLm', name: 'Şube 34 Depo', location: 'Çelik Yapı Şantiyesi' },
  { id: 'aB3xY9zQ', name: 'Şirin İnşaat Saha Deposu' },
];

describe('mikroDepoNo — depo adı/id → Mikro dep_no', () => {
  it('ad tam eşleşir → kayıttaki depoNo (rakamsız ad artık 1 SAYILMAZ)', () => {
    // Eski kod: 'ESKİ SANAYİ'.match(/\d+/) === null → ['1'] → 1 (yanlış depo, sessiz)
    expect(mikroDepoNo(depolar, 'ESKİ SANAYİ')).toBe(2);
    expect(mikroDepoNo(depolar, 'HAVALİMANI')).toBe(1);
  });

  it('ad eşleşmesi tr-TR küçük harf: "eski sanayi" ↔ "ESKİ SANAYİ" (İ→i), boşluk kırpılır', () => {
    expect(mikroDepoNo(depolar, 'eski sanayi')).toBe(2);
    expect(mikroDepoNo(depolar, '  Eski Sanayi ')).toBe(2);
    expect(mikroDepoNo(depolar, 'havalimanı')).toBe(1);
  });

  it('sayfa paritesi: "Depo 5" → 5 (eski kod da 5 veriyordu; şimdi kayıttan, addaki rakamdan değil)', () => {
    expect(mikroDepoNo(depolar, 'Depo 5')).toBe(5);
  });

  it('id ile: eski biçim mikro-depo-N ve kiracı etiketli mikro-<8hex>-depo-N → N', () => {
    expect(mikroDepoNo(depolar, 'mikro-depo-2')).toBe(2);
    expect(mikroDepoNo(depolar, 'mikro-1a2b3c4d-depo-3')).toBe(3);
    // Kayıt listede yoksa bile id biçiminin kendisi numarayı taşır (id depoNo'dan üretilir)
    expect(mikroDepoNo([], 'mikro-depo-7')).toBe(7);
    expect(mikroDepoNo([], 'mikro-9f8e7d6c-depo-4')).toBe(4);
  });

  it('depoNo alanı yoksa id biçiminden çözer (eski import kayıtları)', () => {
    expect(mikroDepoNo([{ id: 'mikro-depo-2', name: 'ESKİ SANAYİ' }], 'ESKİ SANAYİ')).toBe(2);
  });

  it('depoNo sayısal string gelirse (DB) sayı olarak döner; NaN/0/negatif/ondalık → bilinmiyor', () => {
    expect(mikroDepoNo([{ id: 'x', name: 'A', depoNo: '2' }], 'A')).toBe(2);
    expect(mikroDepoNo([{ id: 'x', name: 'A', depoNo: NaN }], 'A')).toBeUndefined();
    expect(mikroDepoNo([{ id: 'x', name: 'A', depoNo: 0 }], 'A')).toBeUndefined();
    expect(mikroDepoNo([{ id: 'x', name: 'A', depoNo: -1 }], 'A')).toBeUndefined();
    expect(mikroDepoNo([{ id: 'x', name: 'A', depoNo: 2.5 }], 'A')).toBeUndefined();
    expect(mikroDepoNo([{ id: 'x', name: 'A', depoNo: null }], 'A')).toBeUndefined();
  });

  it('elle açılmış Cetpa deposu: Mikro karşılığı YOK → undefined (addaki rakam depo no DEĞİL)', () => {
    // Eski kod: 'Şube 34 Depo'.match(/\d+/) → 34 → Mikro'ya depo 34 gidiyordu
    expect(mikroDepoNo(depolar, 'Şube 34 Depo')).toBeUndefined();
    expect(mikroDepoNo(depolar, 'q7Kd2pLm')).toBeUndefined();
    expect(mikroDepoNo(depolar, 'Şirin İnşaat Saha Deposu')).toBeUndefined();
  });

  it('listede olmayan ad / boş / string dışı → undefined (1 varsayılmaz, regex tahmini yok)', () => {
    expect(mikroDepoNo(depolar, 'Bilinmeyen Depo')).toBeUndefined();
    expect(mikroDepoNo(depolar, '')).toBeUndefined();
    expect(mikroDepoNo(depolar, '   ')).toBeUndefined();
    expect(mikroDepoNo(depolar, undefined)).toBeUndefined();
    expect(mikroDepoNo(depolar, null)).toBeUndefined();
    expect(mikroDepoNo(depolar, 2)).toBeUndefined();
    expect(mikroDepoNo([], 'ESKİ SANAYİ')).toBeUndefined();
  });

  it('aynı adda iki Mikro deposu FARKLI numara veriyorsa belirsiz → undefined; aynı numara → o numara', () => {
    const cift: DepoKaydi[] = [
      { id: 'mikro-depo-2', name: 'MERKEZ', depoNo: 2 },
      { id: 'mikro-depo-4', name: 'Merkez', depoNo: 4 },
    ];
    expect(mikroDepoNo(cift, 'MERKEZ')).toBeUndefined();
    // Elle açılmış kopya + Mikro kaydı aynı adda: tek bilinen numara → o numara
    const kopya: DepoKaydi[] = [
      { id: 'elle-1', name: 'Eski Sanayi' },
      { id: 'mikro-depo-2', name: 'ESKİ SANAYİ', depoNo: 2 },
    ];
    expect(mikroDepoNo(kopya, 'ESKİ SANAYİ')).toBe(2);
  });

  it('kayıtta name string değilse (bozuk doküman) çökmez, atlanır', () => {
    const bozuk: DepoKaydi[] = [{ id: 'x' }, { id: 'y', name: 42 }, { id: 'mikro-depo-2', name: 'ESKİ SANAYİ', depoNo: 2 }];
    expect(mikroDepoNo(bozuk, 'ESKİ SANAYİ')).toBe(2);
  });
});

describe('transferDepoNolari — TransferTab buildPayload kapısı (SKU\'suz gibi: bilinmiyorsa null)', () => {
  it('iki depo da biliniyor → { fromDepo, toDepo }', () => {
    expect(transferDepoNolari(depolar, 'ESKİ SANAYİ', 'HAVALİMANI')).toEqual({ fromDepo: 2, toDepo: 1 });
  });
  it('çıkış deposu bilinmiyor → null (eskiden 1 → HAVALİMANI\'ndan çıkmış gibi yazılıyordu)', () => {
    expect(transferDepoNolari(depolar, 'Şirin İnşaat Saha Deposu', 'HAVALİMANI')).toBeNull();
  });
  it('giriş deposu bilinmiyor → null', () => {
    expect(transferDepoNolari(depolar, 'ESKİ SANAYİ', 'Bilinmeyen Depo')).toBeNull();
  });
  it('mutasyon ayırt edici: eski kodun ürettiği 1→1 çifti asla dönmez', () => {
    // Eski: depoNo('ESKİ SANAYİ')=1, depoNo('HAVALİMANI')=1 → {1,1} "kendinden kendine" transfer
    expect(transferDepoNolari(depolar, 'ESKİ SANAYİ', 'HAVALİMANI')).not.toEqual({ fromDepo: 1, toDepo: 1 });
    expect(transferDepoNolari(depolar, 'Bilinmeyen A', 'Bilinmeyen B')).toBeNull();
  });
});

describe('mikroDepoSecenekleri — "Sevk Deposu (Mikro)" seçicisinin listesi (sipariş ekle + düzenle TEK KAYNAK)', () => {
  it('yalnız Mikro dep_no\'su ÇÖZÜLEBİLEN depolar, numaraya göre sıralı; aynı numara tek satır', () => {
    const depolar: DepoKaydi[] = [
      { id: 'mikro-depo-2', name: 'ESKİ SANAYİ' },
      { id: 'elle-acilmis', name: 'Şantiye Konteyner' },          // Mikro'da yok → listelenmez
      { id: 'mikro-depo-1', name: 'HAVALİMANI' },
      { id: 'mikro-depo-2', name: 'ESKİ SANAYİ (kopya)' },        // aynı numara → tek satır (ilk ad)
    ];
    expect(mikroDepoSecenekleri(depolar)).toEqual([{ no: 1, ad: 'HAVALİMANI' }, { no: 2, ad: 'ESKİ SANAYİ' }]);
  });
  it('adsız depo "Depo N" olarak görünür; çözülebilen depo yoksa liste BOŞ (seçici gizlenir, varsayılan UYDURULMAZ)', () => {
    expect(mikroDepoSecenekleri([{ id: 'mikro-depo-3', name: '  ' }])).toEqual([{ no: 3, ad: 'Depo 3' }]);
    expect(mikroDepoSecenekleri([{ id: 'x', name: 'Ana Depo' }])).toEqual([]);
    expect(mikroDepoSecenekleri([])).toEqual([]);
  });
});

