/**
 * mikroMirror.ts - Mikro verisinin PostgreSQL AYNASI.
 *
 * server.ts'ten AYRILDI (2026-08-24) - D4 teknik borcunun 3. parcasi.
 * Onceki parcalar: opsWatchdog.ts, mikroClient.ts. Ayni desen.
 *
 * NE YAPAR: Mikro'dan cekilen ham satirlari `mikro_*` tablolarina yazar
 * (off-server yedek + raporlama icin). `mikroClient.ts`ten AYRI tutuluyor
 * cunku farkli bir sorumluluk: o Mikro ILE KONUSUR, bu gelen veriyi YEREL
 * OLARAK SAKLAR. Ayni modulde olsalardi "Mikro" adi altinda iki bagimsiz
 * degisim ekseni birlesirdi.
 *
 * DIS BAGIMLILIK (olculdu): yalnizca `pgPool` (11 kullanim) ve `createHash`.
 * `numOrNull` yardimcisi zaten bu blogun icinde tanimliydi ve disarida hic
 * kullanilmiyordu - birlikte tasindi.
 */
import { createHash } from 'crypto';

// -- Mikro ERP tablo aynası (PostgreSQL) --------------------------------------
// Mikro'nun gerçek veritabanı tabloları (STOKLAR, CARI_HESAPLAR,
// CARI_HESAP_HAREKETLERI, STOK_HAREKETLERI, SIPARISLER, DEPOLAR, BANKALAR,
// KASALAR, MUHASEBE_FISLERI, ODEME_PLANLARI, ODEME_EMIRLERI,
// CARI_HESAP_ADRESLERI, CARI_PERSONEL_TANIMLARI, STOK_SATIS_FIYAT_LISTELERI)
// otantik kolon adlarıyla cetpa_db'de aynalanır. Alan adları
// apidocs.mikro.com.tr/tablo-alan-adlari/<tablo> ile uyumludur.
// Her tabloda `veri jsonb` ham Mikro kaydının tamamını saklar; tipli kolonlar
// sık sorgulanan alanlardır. Tüm Mikro sync endpoint'leri yazma/okuma sırasında
// bu tablolara da yazar (mirrorMikro* fonksiyonları — ana akışı asla bozmaz).

export interface MirrorDeps {
  /** server.ts'te SONRADAN atanan bir `let` oldugundan deger degil GETTER. */
  getPgPool: () => { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> } | null;
}

let D: MirrorDeps;

/** Init edilmeden cagrilirsa NE YAPILMASI gerektigini soyleyen hata verir. */
function deps(): MirrorDeps {
  if (!D) throw new Error('mikroMirror: initMikroMirror() cagrilmadan kullanilamaz.');
  return D;
}

export function initMikroMirror(d: MirrorDeps): void { D = d; }

export async function initMikroTables(): Promise<void> {
  // Yerel const: guard'dan sonra getter'i TEKRAR cagirmak daralmayi
  // kaybettiriyor (getter her cagrida null donebilir).
  const pool = deps().getPgPool();
  if (!pool) return;
  const ddl = `
  CREATE TABLE IF NOT EXISTS mikro_stoklar (
    sto_kod text PRIMARY KEY,
    sto_isim text, sto_kisa_ismi text, sto_birim1_ad text,
    sto_grup_kodu text, sto_grup_isim text, sto_yer_kod text,
    sto_perakende_vergi numeric, sto_toptan_vergi numeric,
    sto_satis_fiyat1 numeric, sto_satis_fiyat2 numeric,
    sto_satis_fiyat3 numeric, sto_satis_fiyat4 numeric,
    sto_mevcut_mik numeric,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_stok_satis_fiyat_listeleri (
    sfiyat_stokkod text NOT NULL,
    sfiyat_listesirano int NOT NULL,
    sfiyat_fiyati numeric, sfiyat_doviz int, sfiyat_birim_pntr int,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sfiyat_stokkod, sfiyat_listesirano)
  );
  CREATE TABLE IF NOT EXISTS mikro_cari_hesaplar (
    cari_kod text PRIMARY KEY,
    cari_unvan1 text, cari_unvan2 text,
    cari_vdaire_no text, cari_vdaire_adi text,
    cari_email text, cari_ceptel text, cari_efatura_fl int,
    cari_baglanti_tipi int, cari_hareket_tipi int,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_cari_hesap_adresleri (
    id bigserial PRIMARY KEY,
    adr_cari_kod text, adr_adres_no int,
    adr_cadde text, adr_ilce text, adr_il text, adr_ulke text,
    adr_tel_no1 text, adr_posta_kodu text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_cari_personel_tanimlari (
    id bigserial PRIMARY KEY,
    mye_cari_kod text, mye_isim text, mye_soyisim text,
    mye_email_adres text, mye_cep_telno text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_cari_hesap_hareketleri (
    id bigserial PRIMARY KEY,
    cha_guid text, cha_kod text, cha_evrak_tip int, cha_tip int, cha_cinsi int,
    cha_tarihi text, cha_meblag numeric, cha_aratoplam numeric, cha_vergi numeric,
    cha_aciklama text, cha_evrakno_seri text, cha_evrakno_sira text,
    cha_belge_no text, cha_ebelge_turu int,
    kaynak text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE mikro_cari_hesap_hareketleri ADD COLUMN IF NOT EXISTS cha_kasa_hizkod text;
  ALTER TABLE mikro_cari_hesap_hareketleri ADD COLUMN IF NOT EXISTS cha_kasa_hizmet int;
  CREATE INDEX IF NOT EXISTS idx_mikro_cha_kod ON mikro_cari_hesap_hareketleri (cha_kod);
  CREATE TABLE IF NOT EXISTS mikro_stok_hareketleri (
    id bigserial PRIMARY KEY,
    sth_stok_kod text, sth_cari_kodu text, sth_tarih text,
    sth_miktar numeric, sth_tutar numeric, sth_vergi numeric,
    sth_evraktip int, sth_evrakno_seri text, sth_evrakno_sira text,
    kaynak text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_mikro_sth_stok ON mikro_stok_hareketleri (sth_stok_kod);
  CREATE TABLE IF NOT EXISTS mikro_siparisler (
    id bigserial PRIMARY KEY,
    sip_tarih text, sip_tip text, sip_cins text, sip_evrakno_seri text,
    sip_musteri_kod text, sip_stok_kod text,
    sip_miktar numeric, sip_b_fiyat numeric, sip_tutar numeric,
    sip_vergi_pntr int, sip_depono int,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_irsaliyeler (
    id bigserial PRIMARY KEY,
    irs_tarih text, irs_tip int, irs_cins int, irs_evrakno_seri text,
    irs_musteri_kod text, irs_stok_kod text, irs_isim text,
    irs_miktar numeric, irs_birim_fiyat numeric, irs_tutar numeric,
    irs_kargo_firma text, irs_plaka text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_muhasebe_fisleri (
    id bigserial PRIMARY KEY,
    fis_tarih text, fis_hesap_kod text, fis_aciklama1 text,
    fis_meblag0 numeric, fis_tic_belgeno text,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_depolar (
    dep_no text PRIMARY KEY,
    dep_adi text, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_bankalar (
    ban_kod text PRIMARY KEY,
    ban_ismi text, ban_hesap_no text,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_kasalar (
    kas_kod text PRIMARY KEY,
    kas_isim text,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_odeme_planlari (
    odp_no text PRIMARY KEY,
    odp_adi text,
    veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_odeme_emirleri (
    id bigserial PRIMARY KEY,
    sck_no text, sck_vade text, sck_tutar numeric, sck_borclu text,
    sck_banka_adi text, sck_tip int,
    veri jsonb, veri_hash text UNIQUE, guncelleme timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS mikro_tablo_eslesme (
    mikro_tablo text PRIMARY KEY,
    pg_tablo text NOT NULL,
    app_karsiligi text NOT NULL,
    alan_eslesme jsonb NOT NULL,
    aciklama text
  );`;
  await pool.query(ddl);

  const eslesmeler: Array<[string, string, string, Record<string, string>, string]> = [
    ['STOKLAR', 'mikro_stoklar', 'inventory (docs)', {
      sto_kod: 'sku / mikroStoKod', sto_isim: 'name', sto_birim1_ad: 'unit',
      sto_grup_isim: 'category', sto_perakende_vergi: 'vatRate',
      sto_mevcut_mik: 'stockLevel', sto_satis_fiyat1: "prices['Retail']",
      sto_satis_fiyat2: "prices['B2B Standard']", sto_satis_fiyat3: "prices['B2B Premium']",
      sto_satis_fiyat4: "prices['Dealer']", sto_yer_kod: 'warehouses (mikro-depo-<kod>)',
    }, 'StokListesiV2 import + StokKaydetV2 push + saatlik cron'],
    ['STOK_SATIS_FIYAT_LISTELERI', 'mikro_stok_satis_fiyat_listeleri', 'inventory.prices', {
      sfiyat_stokkod: 'sku', sfiyat_listesirano: '1=Retail 2=B2B Standard 3=B2B Premium 4=Dealer', sfiyat_fiyati: 'prices[tier]',
    }, 'Stok kartı satis_fiyatlari dizisinden'],
    ['CARI_HESAPLAR', 'mikro_cari_hesaplar', 'leads (docs)', {
      cari_kod: 'mikroCariKod', cari_unvan1: 'company/name', cari_vdaire_no: 'taxId',
      cari_vdaire_adi: 'taxOffice', cari_EMail: 'email', cari_CepTel: 'phone',
      cari_efatura_fl: 'eFaturaKayitli', cari_hareket_tipi: 'type (1=Supplier)',
    }, 'CariListesiV2 import + CariKaydetV2 push + saatlik cron'],
    ['CARI_HESAP_ADRESLERI', 'mikro_cari_hesap_adresleri', 'leads.address/city/district', {
      adr_cari_kod: 'mikroCariKod', adr_cadde: 'address', adr_il: 'city', adr_ilce: 'district',
    }, 'CariKaydetV2 push payload adresler[]'],
    ['CARI_PERSONEL_TANIMLARI', 'mikro_cari_personel_tanimlari', 'leads.contactName/email/phone', {
      mye_isim: 'contactName (ad)', mye_soyisim: 'contactName (soyad)', mye_email_adres: 'email', mye_cep_telno: 'phone',
    }, 'CariKaydetV2 push payload yetkili[]'],
    ['CARI_HESAP_HAREKETLERI', 'mikro_cari_hesap_hareketleri', 'mikroFaturalar (docs) + payments', {
      cha_Guid: 'mikroFaturalar doc id', cha_evrak_tip: '63=fatura 34=tahsilat/tediye',
      cha_tip: '0=satış/borç 1=alış/alacak', cha_meblag: 'amount', cha_kod: 'mikroCariKod',
    }, 'SqlVeriOkuV2 fatura çekimi + TahsilatTediyeKaydetV2 + CariHareketKaydetV2 + FaturaKaydetV2'],
    ['STOK_HAREKETLERI', 'mikro_stok_hareketleri', 'inventoryMovements / orders.lineItems', {
      sth_stok_kod: 'sku', sth_miktar: 'quantity', sth_tutar: 'total', sth_cari_kodu: 'mikroCariKod',
    }, 'FaturaKaydetV2 satırları (kaynak=fatura)'],
    ['SIPARISLER', 'mikro_siparisler', 'orders.lineItems', {
      sip_stok_kod: 'sku', sip_miktar: 'quantity', sip_b_fiyat: 'unitPrice',
      sip_tutar: 'total', sip_musteri_kod: 'order.mikroCariKod', sip_tarih: 'order.createdAt',
    }, 'SiparisKaydetV2 push'],
    ['IRSALIYELER (API)', 'mikro_stok_hareketleri', 'shipments', {
      sth_cari_kodu: 'shipment.mikroCariKod', sth_stok_kod: 'items[].sku',
      sth_miktar: 'items[].quantity', sth_evraktip: '1=irsaliye (kaynak=irsaliye_push)',
      eir_tasiyici_firma_kodu: 'cargoFirm', eir_tasiyici_arac_plaka: 'trackingNo',
    }, 'IrsaliyeKaydetV2 push — V17 doğrulandı: satırlar sth_*, STOK_HAREKETLERI (mikro_irsaliyeler tablosu kullanım dışı)'],
    ['MUHASEBE_FISLERI', 'mikro_muhasebe_fisleri', 'journalEntries (docs)', {
      fis_hesap_kod: 'debitHesap/alacakHesap', fis_meblag0: '+borc / -alacak',
      fis_tarih: 'date', fis_aciklama1: 'aciklama', fis_tic_belgeno: 'fisNo',
    }, 'MuhasebeFisKaydetV2 yevmiye push (çift satır)'],
    ['DEPOLAR', 'mikro_depolar', 'warehouses (docs, mikro-depo-<kod>)', {
      dep_no: 'sto_yer_kod', dep_adi: 'warehouse.name',
    }, 'Mikro depo listesi endpointi yok — sto_yer_kod alanından türetilir'],
    ['BANKALAR', 'mikro_bankalar', 'bankAccounts (docs)', {
      ban_kod: 'bankAccount.id', ban_ismi: 'bankName', ban_hesap_no: 'accountNo',
    }, 'Liste endpointi yok — SqlVeriOkuV2 açılınca doldurulur'],
    ['KASALAR', 'mikro_kasalar', 'kasalar (docs)', {
      kas_kod: 'kasa.id', kas_isim: 'kasa.name',
    }, 'Liste endpointi yok — SqlVeriOkuV2 açılınca doldurulur'],
    ['ODEME_PLANLARI', 'mikro_odeme_planlari', 'leads.paymentTerms', {
      odp_no: 'paymentTerms kodu', odp_adi: 'paymentTerms adı',
    }, 'Liste endpointi yok — SqlVeriOkuV2 açılınca doldurulur'],
    ['ODEME_EMIRLERI', 'mikro_odeme_emirleri', 'checks (docs, çek/senet)', {
      sck_no: 'checkNo', sck_vade: 'dueDate', sck_tutar: 'amount', sck_borclu: 'drawer', sck_banka_adi: 'bankName',
    }, 'Liste endpointi yok — SqlVeriOkuV2 açılınca doldurulur'],
  ];
  for (const [mikro, pgt, app, alanlar, aciklama] of eslesmeler) {
    await pool.query(
      `INSERT INTO mikro_tablo_eslesme (mikro_tablo, pg_tablo, app_karsiligi, alan_eslesme, aciklama)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (mikro_tablo) DO UPDATE SET pg_tablo = $2, app_karsiligi = $3, alan_eslesme = $4, aciklama = $5`,
      [mikro, pgt, app, JSON.stringify(alanlar), aciklama],
    );
  }
  console.log('Mikro tablo aynası hazır ✓ (15 tablo + eşleşme kaydı)');
}

/** Eksik/boş → null (0 DEĞİL). Sayısal olmayan metin de null — NaN DEĞİL: pg NaN'ı numeric
 *  kolona sessizce kabul eder ve rapor toplamları NaN'a döner (CLAUDE.md `Number.isFinite`). */
const numOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const strOrNull = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

/** Hash-dedupe'lu genel ekleme — aynı ham kayıt iki kez yazılmaz (idempotent). */
export async function mirrorMikroInsert(
  table: string,
  rows: Record<string, unknown>[],
  cols: Record<string, (r: Record<string, unknown>) => unknown>,
  client?: import('pg').PoolClient
): Promise<void> {
  const pool = deps().getPgPool();
  if (!pool || !rows?.length) return;
  const dbClient = client || pool;
  try {
    for (const r of rows) {
      const veri = JSON.stringify(r);
      const hash = createHash('md5').update(table + veri).digest('hex');
      const names = Object.keys(cols);
      const vals = names.map(n => cols[n](r));
      await dbClient.query(
        `INSERT INTO ${table} (${names.join(', ')}, veri, veri_hash)
         VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}, $${names.length + 1}, $${names.length + 2})
         ON CONFLICT (veri_hash) DO NOTHING`,
        [...vals, veri, hash],
      );
    }
  } catch (e) {
    console.warn(`[mikroMirror:${table}]`, (e as Error).message);
    if (client) throw e; // Reraise in transactions
  }
}

/** STOKLAR + STOK_SATIS_FIYAT_LISTELERI + DEPOLAR aynası (sto_kod upsert). */
export async function mirrorMikroStoklar(rows: Record<string, unknown>[]): Promise<void> {
  const pool = deps().getPgPool();
  if (!pool || !rows?.length) return;
  try {
    for (const s of rows) {
      const kod = strOrNull(s.sto_kod)?.trim();
      if (!kod) continue;
      await pool.query(
        `INSERT INTO mikro_stoklar (sto_kod, sto_isim, sto_kisa_ismi, sto_birim1_ad, sto_grup_kodu, sto_grup_isim,
           sto_yer_kod, sto_perakende_vergi, sto_toptan_vergi, sto_satis_fiyat1, sto_satis_fiyat2, sto_satis_fiyat3,
           sto_satis_fiyat4, sto_mevcut_mik, veri)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (sto_kod) DO UPDATE SET
           sto_isim = EXCLUDED.sto_isim, sto_kisa_ismi = EXCLUDED.sto_kisa_ismi,
           sto_birim1_ad = EXCLUDED.sto_birim1_ad, sto_grup_kodu = EXCLUDED.sto_grup_kodu,
           sto_grup_isim = EXCLUDED.sto_grup_isim, sto_yer_kod = EXCLUDED.sto_yer_kod,
           sto_perakende_vergi = EXCLUDED.sto_perakende_vergi, sto_toptan_vergi = EXCLUDED.sto_toptan_vergi,
           sto_satis_fiyat1 = COALESCE(EXCLUDED.sto_satis_fiyat1, mikro_stoklar.sto_satis_fiyat1),
           sto_satis_fiyat2 = COALESCE(EXCLUDED.sto_satis_fiyat2, mikro_stoklar.sto_satis_fiyat2),
           sto_satis_fiyat3 = COALESCE(EXCLUDED.sto_satis_fiyat3, mikro_stoklar.sto_satis_fiyat3),
           sto_satis_fiyat4 = COALESCE(EXCLUDED.sto_satis_fiyat4, mikro_stoklar.sto_satis_fiyat4),
           sto_mevcut_mik = COALESCE(EXCLUDED.sto_mevcut_mik, mikro_stoklar.sto_mevcut_mik),
           veri = EXCLUDED.veri, guncelleme = now()`,
        [kod, strOrNull(s.sto_isim), strOrNull(s.sto_kisa_ismi), strOrNull(s.sto_birim1_ad),
         strOrNull(s.sto_grup_kodu), strOrNull(s.sto_grup_isim), strOrNull(s.sto_yer_kod),
         numOrNull(s.sto_perakende_vergi), numOrNull(s.sto_toptan_vergi),
         numOrNull(s.sto_satis_fiyat1), numOrNull(s.sto_satis_fiyat2),
         numOrNull(s.sto_satis_fiyat3), numOrNull(s.sto_satis_fiyat4),
         numOrNull(s.sto_mevcut_mik ?? s.toplam_miktar), JSON.stringify(s)],
      );
      const fiyatlar = (s.satis_fiyatlari as Record<string, unknown>[]) || [];
      for (const f of fiyatlar) {
        const sira = numOrNull(f.sfiyat_listesirano);
        if (sira === null) continue;
        await pool.query(
          `INSERT INTO mikro_stok_satis_fiyat_listeleri (sfiyat_stokkod, sfiyat_listesirano, sfiyat_fiyati, sfiyat_doviz, sfiyat_birim_pntr, veri)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (sfiyat_stokkod, sfiyat_listesirano) DO UPDATE SET
             sfiyat_fiyati = EXCLUDED.sfiyat_fiyati, sfiyat_doviz = EXCLUDED.sfiyat_doviz,
             sfiyat_birim_pntr = EXCLUDED.sfiyat_birim_pntr, veri = EXCLUDED.veri, guncelleme = now()`,
          [kod, sira, numOrNull(f.sfiyat_fiyati), numOrNull(f.sfiyat_doviz), numOrNull(f.sfiyat_birim_pntr), JSON.stringify(f)],
        );
      }
      const yerKod = strOrNull(s.sto_yer_kod)?.trim();
      if (yerKod) {
        await pool.query(
          `INSERT INTO mikro_depolar (dep_no, dep_adi) VALUES ($1, $2) ON CONFLICT (dep_no) DO NOTHING`,
          [yerKod, `Depo ${yerKod}`],
        );
      }
    }
  } catch (e) { console.warn('[mikroMirror:stoklar]', (e as Error).message); }
}

/** CARI_HESAPLAR (+adresler, +yetkili) aynası (cari_kod upsert). */
export async function mirrorMikroCariler(rows: Record<string, unknown>[]): Promise<void> {
  const pool = deps().getPgPool();
  if (!pool || !rows?.length) return;
  try {
    for (const c of rows) {
      const kod = strOrNull(c.cari_kod)?.trim();
      if (!kod) continue;
      await pool.query(
        `INSERT INTO mikro_cari_hesaplar (cari_kod, cari_unvan1, cari_unvan2, cari_vdaire_no, cari_vdaire_adi,
           cari_email, cari_ceptel, cari_efatura_fl, cari_baglanti_tipi, cari_hareket_tipi, veri)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (cari_kod) DO UPDATE SET
           cari_unvan1 = EXCLUDED.cari_unvan1, cari_unvan2 = EXCLUDED.cari_unvan2,
           cari_vdaire_no = EXCLUDED.cari_vdaire_no, cari_vdaire_adi = EXCLUDED.cari_vdaire_adi,
           cari_email = COALESCE(NULLIF(EXCLUDED.cari_email, ''), mikro_cari_hesaplar.cari_email),
           cari_ceptel = COALESCE(NULLIF(EXCLUDED.cari_ceptel, ''), mikro_cari_hesaplar.cari_ceptel),
           cari_efatura_fl = EXCLUDED.cari_efatura_fl,
           cari_baglanti_tipi = COALESCE(EXCLUDED.cari_baglanti_tipi, mikro_cari_hesaplar.cari_baglanti_tipi),
           cari_hareket_tipi = COALESCE(EXCLUDED.cari_hareket_tipi, mikro_cari_hesaplar.cari_hareket_tipi),
           veri = EXCLUDED.veri, guncelleme = now()`,
        [kod, strOrNull(c.cari_unvan1), strOrNull(c.cari_unvan2), strOrNull(c.cari_vdaire_no),
         strOrNull(c.cari_vdaire_adi), strOrNull(c.cari_EMail ?? c.cari_email),
         strOrNull(c.cari_CepTel ?? c.cari_ceptel), numOrNull(c.cari_efatura_fl),
         numOrNull(c.cari_baglanti_tipi), numOrNull(c.cari_hareket_tipi), JSON.stringify(c)],
      );
      const adresler = (c.adresler as Record<string, unknown>[]) || [];
      await mirrorMikroInsert('mikro_cari_hesap_adresleri', adresler.map(a => ({ ...a, adr_cari_kod: kod })), {
        adr_cari_kod: r => r.adr_cari_kod,
        adr_adres_no: r => numOrNull(r.adr_adres_no),
        adr_cadde: r => strOrNull(r.adr_cadde),
        adr_ilce: r => strOrNull(r.adr_ilce),
        adr_il: r => strOrNull(r.adr_il),
        adr_ulke: r => strOrNull(r.adr_ulke),
        adr_tel_no1: r => strOrNull(r.adr_tel_no1),
        adr_posta_kodu: r => strOrNull(r.adr_posta_kodu),
      });
      const yetkili = (c.yetkili as Record<string, unknown>[]) || [];
      await mirrorMikroInsert('mikro_cari_personel_tanimlari', yetkili.map(y => ({ ...y, mye_cari_kod: kod })), {
        mye_cari_kod: r => r.mye_cari_kod,
        mye_isim: r => strOrNull(r.mye_isim),
        mye_soyisim: r => strOrNull(r.mye_soyisim),
        mye_email_adres: r => strOrNull(r.mye_email_adres),
        mye_cep_telno: r => strOrNull(r.mye_cep_telno),
      });
    }
  } catch (e) { console.warn('[mikroMirror:cariler]', (e as Error).message); }
}

export const CHA_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  cha_guid: r => strOrNull(r.cha_Guid ?? r.cha_guid),
  cha_kod: r => strOrNull(r.cha_kod),
  cha_evrak_tip: r => numOrNull(r.cha_evrak_tip),
  cha_tip: r => numOrNull(r.cha_tip),
  cha_cinsi: r => numOrNull(r.cha_cinsi),
  cha_tarihi: r => strOrNull(r.cha_tarihi),
  cha_meblag: r => numOrNull(r.cha_meblag),
  cha_aratoplam: r => numOrNull(r.cha_aratoplam),
  cha_aciklama: r => strOrNull(r.cha_aciklama),
  cha_evrakno_seri: r => strOrNull(r.cha_evrakno_seri),
  cha_evrakno_sira: r => strOrNull(r.cha_evrakno_sira),
  cha_belge_no: r => strOrNull(r.cha_belge_no),
  cha_ebelge_turu: r => numOrNull(r.cha_ebelge_turu),
  cha_kasa_hizkod: r => strOrNull(r.cha_kasa_hizkod),
  cha_kasa_hizmet: r => numOrNull(r.cha_kasa_hizmet),
  kaynak: r => strOrNull(r.__kaynak ?? 'mikro'),
};

export const SIP_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  sip_tarih: r => strOrNull(r.sip_tarih),
  sip_tip: r => strOrNull(r.sip_tip),
  sip_cins: r => strOrNull(r.sip_cins),
  sip_evrakno_seri: r => strOrNull(r.sip_evrakno_seri),
  sip_musteri_kod: r => strOrNull(r.sip_musteri_kod),
  sip_stok_kod: r => strOrNull(r.sip_stok_kod),
  sip_miktar: r => numOrNull(r.sip_miktar),
  sip_b_fiyat: r => numOrNull(r.sip_b_fiyat),
  sip_tutar: r => numOrNull(r.sip_tutar),
  sip_vergi_pntr: r => numOrNull(r.sip_vergi_pntr),
  sip_depono: r => numOrNull(r.sip_depono),
};

const IRS_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  irs_tarih: r => strOrNull(r.irs_tarih),
  irs_tip: r => numOrNull(r.irs_tip),
  irs_cins: r => numOrNull(r.irs_cins),
  irs_evrakno_seri: r => strOrNull(r.irs_evrakno_seri),
  irs_musteri_kod: r => strOrNull(r.irs_musteri_kod),
  irs_stok_kod: r => strOrNull(r.irs_stok_kod),
  irs_isim: r => strOrNull(r.irs_isim),
  irs_miktar: r => numOrNull(r.irs_miktar),
  irs_birim_fiyat: r => numOrNull(r.irs_birim_fiyat),
  irs_tutar: r => numOrNull(r.irs_tutar),
  irs_kargo_firma: r => strOrNull(r.irs_kargo_firma),
  irs_plaka: r => strOrNull(r.irs_plaka),
};

export const STH_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  sth_stok_kod: r => strOrNull(r.sth_stok_kod ?? r.fat_stok_kod),
  sth_cari_kodu: r => strOrNull(r.sth_cari_kodu ?? r.fat_musteri_kod),
  sth_tarih: r => strOrNull(r.sth_tarih ?? r.fat_tarih),
  sth_miktar: r => numOrNull(r.sth_miktar ?? r.fat_miktar),
  sth_tutar: r => numOrNull(r.sth_tutar ?? r.fat_tutar),
  sth_vergi: r => numOrNull(r.sth_vergi),
  sth_evraktip: r => numOrNull(r.sth_evraktip),
  sth_evrakno_seri: r => strOrNull(r.sth_evrakno_seri ?? r.fat_evrakno_seri),
  sth_evrakno_sira: r => strOrNull(r.sth_evrakno_sira),
  kaynak: r => strOrNull(r.__kaynak ?? 'mikro'),
};

export const FIS_COLS: Record<string, (r: Record<string, unknown>) => unknown> = {
  fis_tarih: r => strOrNull(r.fis_tarih),
  fis_hesap_kod: r => strOrNull(r.fis_hesap_kod),
  fis_aciklama1: r => strOrNull(r.fis_aciklama1),
  fis_meblag0: r => numOrNull(r.fis_meblag0),
  fis_tic_belgeno: r => strOrNull(r.fis_tic_belgeno),
};


// ── Luca API helpers ────────────────────────────────────────────────────────
