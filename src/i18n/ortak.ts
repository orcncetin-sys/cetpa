/**
 * ortak.ts — TEKRARLAYAN arayüz ifadelerinin ORTAK SÖZLÜĞÜ (Faz 2 4/n, 2026-09-13). ÜRETİLMİŞ + elle bakılır.
 *
 * Neden: 156 dosyada 6.928 satır içi `currentLanguage === 'tr' ? 'A' : 'B'` vardı; 686 ifade çifti tekrarlıyordu
 * ('İptal'/'Cancel' 70 yerde, 'Kaydet'/'Save' 63 yerde). Aynı Türkçe metin için farklı İngilizce çeviriler de
 * dolaşıyordu ('Sipariş' → 'Orders' / 'Order'). Bu sözlük tekrarlayanların tek kaynağı: anahtar Türkçe metnin
 * slug'ı, değer her iki dilde metin. Aynı TR metnin en sık EN karşılığı alındı; azınlık çeviriler bağlama özel
 * sayılıp YERİNDE bırakıldı (kodmod dokunmadı). Tek geçen ~4.150 ifade de yerinde — Faz 3 modül kapatmada
 * modül sözlüğüne alınır.
 *
 * Kullanım: `oc(currentLanguage).kaydet` ya da eski bayrakla `oc(tr63).kaydet` (boolean: true = Türkçe).
 * Kodmod: scripts/ceviri-kodmod.py — sözlükteki çiftleri satır içinden buraya taşır. Değişmez: ortak.degismez.test.ts.
 * Yeni anahtar eklerken: iki dile de yaz, anahtar Türkçe metnin slug'ı (ç→c, ş→s, İ→i…).
 */
export const ORTAK = {
  tr: {
  iptal: 'İptal',   // ×70
  durum: 'Durum',   // ×65
  kaydet: 'Kaydet',   // ×63
  sil: 'Sil',   // ×47
  duzenle: 'Düzenle',   // ×37
  urun: 'Ürün',   // ×36
  tarih: 'Tarih',   // ×34
  musteri: 'Müşteri',   // ×32
  tutar: 'Tutar',   // ×30
  toplam: 'Toplam',   // ×28
  aktif: 'Aktif',   // ×26
  siparis: 'sipariş',   // ×22
  diger: 'Diğer',   // ×21
  aciklama: 'Açıklama',   // ×19
  tur: 'Tür',   // ×18
  adet: 'adet',   // ×17
  kapat: 'Kapat',   // ×16
  miktar: 'Miktar',   // ×16
  kaydedilemedi: 'Kaydedilemedi: ',   // ×15
  incele: 'İncele',   // ×14
  tumu: 'Tümü',   // ×14
  hata_olustu: 'Hata oluştu',   // ×13
  siparis_2: 'Sipariş',   // ×13
  ciro: 'Ciro',   // ×13
  silinemedi: 'Silinemedi: ',   // ×13
  tedarikci: 'Tedarikçi',   // ×12
  islemler: 'İşlemler',   // ×12
  bekliyor: 'Bekliyor',   // ×12
  notlar: 'Notlar',   // ×11
  kategori: 'Kategori',   // ×11
  onayla: 'Onayla',   // ×11
  aylik: 'Aylık',   // ×11
  bakiye: 'Bakiye',   // ×11
  hata_olustu_2: 'Hata oluştu.',   // ×11
  stok: 'Stok',   // ×10
  yuksek: 'Yüksek',   // ×10
  dusuk: 'Düşük',   // ×10
  ekle: 'Ekle',   // ×10
  kritik: 'Kritik',   // ×10
  g: 'g',   // ×10
  gerceklesen: 'Gerçekleşen',   // ×10
  telefon: 'Telefon',   // ×9
  crm_satis: 'CRM & Satış',   // ×9
  depo: 'Depo',   // ×9
  reddet: 'Reddet',   // ×9
  gun: 'gün',   // ×9
  donem: 'Dönem',   // ×9
  guncellenemedi: 'Güncellenemedi: ',   // ×9
  adres: 'Adres',   // ×8
  calisan: 'Çalışan',   // ×8
  urun_adi: 'Ürün Adı',   // ×7
  ay: 'Ay',   // ×7
  olustur: 'Oluştur',   // ×7
  yeni_ekle: 'Yeni Ekle',   // ×7
  baslik: 'Başlık',   // ×7
  deger: 'Değer',   // ×7
  yenile: 'Yenile',   // ×7
  bekleyen: 'Bekleyen',   // ×7
  marj: 'Marj',   // ×7
  bakim_onarim: 'Bakım-Onarım',   // ×6
  siparisler: 'Siparişler',   // ×6
  hukuk_uyum: 'Hukuk & Uyum',   // ×6
  geri: '← Geri',   // ×6
  yukleniyor: 'Yükleniyor...',   // ×6
  envanter: 'Envanter',   // ×6
  orta: 'Orta',   // ×6
  tamamlanan: 'Tamamlanan',   // ×6
  baslangic: 'Başlangıç',   // ×6
  vergi_dairesi: 'Vergi Dairesi',   // ×6
  kaydediliyor: 'Kaydediliyor...',   // ×6
  islem: 'İşlem',   // ×6
  toplam_deger: 'Toplam Değer',   // ×6
  sorumlu: 'Sorumlu',   // ×6
  kaydediliyor_2: 'Kaydediliyor…',   // ×6
  fatura_no: 'Fatura No',   // ×6
  geri_2: 'Geri',   // ×6
  tum_haklari_saklidir: 'Tüm hakları saklıdır.',   // ×6
  acik: 'Açık',   // ×6
  lutfen_giris_yapin: 'Lütfen giriş yapın.',   // ×6
  filtreyi_temizle: 'Filtreyi Temizle',   // ×6
  satis: 'Satış',   // ×6
  gelir: 'Gelir',   // ×6
  kullanim_kosullari: 'Kullanım Koşulları',   // ×5
  satin_alma: 'Satın Alma',   // ×5
  vergi_takvimi: 'Vergi Takvimi',   // ×5
  ithalat_ihracat: 'İthalat/İhracat',   // ×5
  lot_seri_takip: 'Lot/Seri Takip',   // ×5
  subeler: 'Şubeler',   // ×5
  muhasebe_finans: 'Muhasebe & Finans',   // ×5
  insan_kaynaklari: 'İnsan Kaynakları',   // ×5
  sozlesmeler: 'Sözleşmeler',   // ×5
  komisyon: 'Komisyon',   // ×5
  odendi: 'Ödendi',   // ×5
  teslim_edildi: 'Teslim Edildi',   // ×5
  toplam_2: 'TOPLAM',   // ×5
  genel: 'Genel',   // ×5
  toplam_siparis: 'Toplam Sipariş',   // ×5
  oncelik: 'Öncelik',   // ×5
  butce: 'Bütçe',   // ×5
  tamamlandi: 'Tamamlandı',   // ×5
  rol: 'Rol',   // ×5
  bitis: 'Bitiş',   // ×5
  taslak: 'Taslak',   // ×5
  brut: 'Brüt',   // ×5
  musteri_adi: 'Müşteri Adı',   // ×5
  donem_2: 'Dönem:',   // ×5
  guncelle: 'Güncelle',   // ×5
  musteri_adi_2: 'Müşteri adı',   // ×5
  surec: 'Süreç',   // ×5
  karma: 'Karma',   // ×5
  brut_kar: 'Brüt Kâr',   // ×5
  musteri_2: 'müşteri',   // ×5
  sirket: 'Şirket',   // ×4
  onaylar: 'Onaylar',   // ×4
  e_belge_merkezi: 'E-Belge Merkezi',   // ×4
  analitik: 'Analitik',   // ×4
  lojistik_depo: 'Lojistik & Depo',   // ×4
  proje_yonetimi: 'Proje Yönetimi',   // ×4
  genel_bakis: 'Genel Bakış',   // ×4
  kullanicilar: 'Kullanıcılar',   // ×4
  toplam_ciro: 'Toplam Ciro',   // ×4
  ara: 'Ara...',   // ×4
  ice_aktar: 'İçe Aktar',   // ×4
  reddedildi: 'Reddedildi',   // ×4
  yeni_talep: 'Yeni Talep',   // ×4
  sozlesme: 'Sözleşme',   // ×4
  guncelleme_basarisiz: 'Güncelleme başarısız.',   // ×4
  kaydedilemedi_2: 'Kaydedilemedi.',   // ×4
  firma: 'Firma',   // ×4
  yillik: 'Yıllık',   // ×4
  vazgec: 'Vazgeç',   // ×4
  birim: 'Birim',   // ×4
  tahsil_edilen: 'Tahsil Edilen',   // ×4
  tutar_2: 'Tutar (₺)',   // ×4
  veri_yok: 'Veri yok.',   // ×4
  urunler: 'Ürünler',   // ×4
  nasil_calisir: 'Nasıl Çalışır',   // ×4
  sektorler: 'Sektörler',   // ×4
  kariyer: 'Kariyer',   // ×4
  gizlilik_politikasi: 'Gizlilik Politikası',   // ×4
  lutfen_calisan_secin: 'Lütfen çalışan seçin.',   // ×4
  calisan_secin: 'Çalışan Seçin',   // ×4
  bilinmiyor: 'Bilinmiyor',   // ×4
  maliyet: 'Maliyet',   // ×4
  konu: 'Konu',   // ×4
  surucu: 'Sürücü',   // ×4
  siparis_durumu: 'Sipariş Durumu',   // ×4
  cozuldu: 'Çözüldü',   // ×4
  hata_modu: 'Hata Modu',   // ×4
  bayi: 'Bayi',   // ×4
  hedef: 'Hedef',   // ×4
  odendi_2: '✓ Ödendi',   // ×4
  yeni_sozlesme: 'Yeni Sözleşme',   // ×4
  silindi: 'Silindi',   // ×4
  urun_adi_2: 'Ürün adı',   // ×4
  teslim: 'Teslim',   // ×4
  siparis_adedi: 'Sipariş Adedi',   // ×4
  silinemedi_yetki: 'Silinemedi (yetki?).',   // ×4
  yapilandirildi: 'Yapılandırıldı',   // ×4
  brut_marj: 'Brüt Marj',   // ×4
  _3_aylik: '3 Aylık',   // ×4
  sevkiyat: 'Sevkiyat',   // ×3
  siparis_iptal_edildi: 'Sipariş İptal Edildi',   // ×3
  projeler: 'Projeler',   // ×3
  ayarlar: 'Ayarlar',   // ×3
  kalite_yonetimi: 'Kalite Yönetimi',   // ×3
  kurumsal_yonetim: 'Kurumsal Yönetim',   // ×3
  kopyala: 'Kopyala',   // ×3
  uretim_yonetimi: 'Üretim Yönetimi',   // ×3
  servis: 'Servis',   // ×3
  raporlar: 'Raporlar',   // ×3
  lojistik: 'Lojistik',   // ×3
  siparis_no: 'Sipariş No',   // ×3
  e_posta: 'E-posta',   // ×3
  kredi_limiti: 'Kredi Limiti (₺)',   // ×3
  giris: 'Giriş',   // ×3
  cikis: 'Çıkış',   // ×3
  kredi_limiti_2: 'Kredi Limiti',   // ×3
  barkod_qr_tara: 'Barkod / QR Tara',   // ×3
  toplam_maliyet: 'Toplam Maliyet',   // ×3
  saglikli: 'Sağlıklı',   // ×3
  kar_marji: 'Kâr Marjı',   // ×3
  kayit_basariyla_silindi: 'Kayıt başarıyla silindi.',   // ×3
  gorevler: 'Görevler',   // ×3
  harcanan: 'Harcanan',   // ×3
  toplam_butce: 'Toplam Bütçe',   // ×3
  proje_adi: 'Proje Adı',   // ×3
  proje_ekle: 'Proje Ekle',   // ×3
  bugun: 'Bugün',   // ×3
  isim: 'İsim',   // ×3
  vergi_no: 'Vergi No',   // ×3
  urun_2: 'ürün',   // ×3
  urun_barkodu_tara: 'Ürün Barkodu Tara',   // ×3
  indir: 'İndir',   // ×3
  gonderiliyor: 'Gönderiliyor...',   // ×3
  uyumlu: 'Uyumlu',   // ×3
  uyumsuz: 'Uyumsuz',   // ×3
  mesaj: 'Mesaj',   // ×3
  kaldir: 'Kaldır',   // ×3
  askida: 'Askıda',   // ×3
  toplam_brut: 'Toplam Brüt',   // ×3
  departman: 'Departman',   // ×3
  sgk_matrahi: 'SGK Matrahı',   // ×3
  pasif: 'Pasif',   // ×3
  ad_soyad: 'Ad Soyad',   // ×3
  ay_2: 'ay',   // ×3
  kismi: 'Kısmi',   // ×3
  ozellikler: 'Özellikler',   // ×3
  fiyatlar: 'Fiyatlar',   // ×3
  ay_3: '/ay',   // ×3
  kayit: 'kayıt',   // ×3
  skt: 'SKT',   // ×3
  seri_no: 'Seri No',   // ×3
  garanti_bitis: 'Garanti Bitiş',   // ×3
  ulke: 'Ülke',   // ×3
  alici: 'Alıcı',   // ×3
  toplam_3: 'toplam',   // ×3
  kayit_bulunamadi: 'Kayıt bulunamadı.',   // ×3
  kdv: 'KDV',   // ×3
  marj_2: 'marj',   // ×3
  yolda: 'Yolda',   // ×3
  birim_fiyat: 'Birim Fiyat',   // ×3
  devam: 'Devam',   // ×3
  hata_orani: 'Hata Oranı',   // ×3
  onemli: 'Önemli',   // ×3
  kapali: 'Kapalı',   // ×3
  puan: 'Puan',   // ×3
  dusuk_risk: 'Düşük Risk',   // ×3
  denetci: 'Denetçi',   // ×3
  perakende: 'Perakende',   // ×3
  temizle: 'Temizle',   // ×3
  siparis_id: 'Sipariş ID',   // ×3
  api_ve_entegrasyonlar: 'API ve Entegrasyonlar',   // ×3
  odeme: 'Ödeme',   // ×3
  topla: 'Topla',   // ×3
  kalem: 'kalem',   // ×3
  fatura_turu: 'Fatura Türü',   // ×3
  ihracat: 'İhracat',   // ×3
  sozlesme_ekle: 'Sözleşme Ekle',   // ×3
  taninan: 'Tanınan',   // ×3
  renk: 'Renk',   // ×3
  detay: 'Detay',   // ×3
  kayit_ekle: 'Kayıt Ekle',   // ×3
  nakit: 'Nakit',   // ×3
  kullanici: 'kullanıcı',   // ×3
  cari_ekstre: 'Cari Ekstre',   // ×3
  not: 'Not',   // ×3
  mikro_dahil: ' (Mikro dahil)',   // ×3
  donen_varliklar: 'Dönen Varlıklar',   // ×3
  banka: 'Banka',   // ×3
  adet_2: 'Adet',   // ×3
  pay: 'Pay',   // ×3
  aktif_calisan: 'Aktif Çalışan',   // ×3
  departmana_gore_calisan_sayisi: 'Departmana Göre Çalışan Sayısı',   // ×3
  suresi_doldu: 'Süresi Doldu',   // ×3
  kargoda: 'Kargoda',   // ×3
  detaya_git: 'Detaya git',   // ×3
  aktif_musteri: 'Aktif Müşteri',   // ×3
  yeni: 'Yeni',   // ×3
  sip: 'sip.',   // ×3
  birim_2: 'birim',   // ×3
  kullanici_2: 'Kullanıcı',   // ×3
  bagli: 'Bağlı',   // ×3
  yapilandirilmamis: 'Yapılandırılmamış',   // ×3
  onayli: 'Onaylı',   // ×3
  bu_ay: 'Bu Ay',   // ×3
  odenmedi: '⏳ Ödenmedi',   // ×3
  kopyalanamadi_tarayici_pano_iznini_engelledi: 'Kopyalanamadı — tarayıcı pano iznini engelledi.',   // ×3
  siparis_iptali: 'Sipariş iptali',   // ×2
  ad_soyad_2: 'Ad Soyad *',   // ×2
  giris_yap: '← Giriş Yap',   // ×2
  ornek_cetpa_com: 'örnek@cetpa.com',   // ×2
  muhasebe: 'Muhasebe',   // ×2
  uretim: 'Üretim',   // ×2
  iade_degisim: 'İade & Değişim',   // ×2
  mesai_devam: 'Mesai & Devam',   // ×2
  mobil_wms: 'Mobil WMS',   // ×2
  performans: 'Performans',   // ×2
  satis_bolgeleri: 'Satış Bölgeleri',   // ×2
  fiyat_istihbarati: 'Fiyat İstihbaratı',   // ×2
  sube_yonetimi: 'Şube Yönetimi',   // ×2
  panel: 'Panel',   // ×2
  musteri_adaylari: 'Müşteri Adayları',   // ×2
  musteriler: 'Müşteriler',   // ×2
  kampanyalar: 'Kampanyalar',   // ×2
  hedefler: 'Hedefler',   // ×2
  tedarik_zinciri_kpi: 'Tedarik Zinciri KPI',   // ×2
  canli_sevkiyat: 'Canlı Sevkiyat',   // ×2
  satin_alma_siparisleri: 'Satın Alma Siparişleri',   // ×2
  tedarikciler: 'Tedarikçiler',   // ×2
  odeme_takvimi: 'Ödeme Takvimi',   // ×2
  tedarikci_portali: 'Tedarikçi Portalı',   // ×2
  satin_alma_butcesi: 'Satın Alma Bütçesi',   // ×2
  tedarik_zinciri_riski: 'Tedarik Zinciri Riski',   // ×2
  fiyat_karsilastirma: 'Fiyat Karşılaştırma',   // ×2
  performans_degerlendirme: 'Performans Değerlendirme',   // ×2
  musteri_yonetimi: 'Müşteri Yönetimi',   // ×2
  musteri_tipi: 'Müşteri Tipi',   // ×2
  fatura_tipi: 'Fatura Tipi',   // ×2
  teslimat_adresi: 'Teslimat Adresi',   // ×2
  olusturulma: 'Oluşturulma',   // ×2
  sebep: 'Sebep',   // ×2
  teslim_edilen: 'Teslim Edilen',   // ×2
  tedarikci_2: 'TEDARİKÇİ',   // ×2
  beklenen: 'Beklenen',   // ×2
  genel_toplam: 'GENEL TOPLAM',   // ×2
  manuel: 'Manuel',   // ×2
  net_kar: 'Net Kâr',   // ×2
  bu_hafta: 'Bu hafta',   // ×2
  henuz_siparis_verisi_yok: 'Henüz sipariş verisi yok.',   // ×2
  yonetici: 'Yönetici',   // ×2
  tum_projeler: 'Tüm Projeler',   // ×2
  beklemede: 'Beklemede',   // ×2
  planlama: 'Planlama',   // ×2
  yapilacak: 'Yapılacak',   // ×2
  devam_ediyor: 'Devam Ediyor',   // ×2
  inceleme: 'İnceleme',   // ×2
  proje_zaman_cizelgesi: 'Proje Zaman Çizelgesi',   // ×2
  planlanan: 'Planlanan',   // ×2
  son_tarih: 'Son Tarih',   // ×2
  sablonu_kaydet: 'Şablonu Kaydet',   // ×2
  konsinye_gonder: 'Konsinye Gönder',   // ×2
  seciniz: 'Seçiniz',   // ×2
  stok_2: 'stok',   // ×2
  not_opsiyonel: 'Not (opsiyonel)',   // ×2
  gonder: 'Gönder',   // ×2
  sistem: 'sistem',   // ×2
  sayilan: 'sayılan',   // ×2
  taraf: 'Taraf',   // ×2
  kazanilan: 'Kazanılan',   // ×2
  goruntule: 'Görüntüle',   // ×2
  onaylandi: 'Onaylandı',   // ×2
  incelemede: 'İncelemede',   // ×2
  para_birimi: 'Para Birimi',   // ×2
  sonraki_tarih: 'Sonraki Tarih',   // ×2
  kaydedildi: '✓ Kaydedildi',   // ×2
  ara_2: 'Ara',   // ×2
  detay_yuklenemedi: 'Detay yüklenemedi.',   // ×2
  detay_tazelenemedi_gorunen_veriler_eski_olabilir: 'Detay tazelenemedi — görünen veriler eski olabilir.',   // ×2
  rol_guncellenemedi: 'Rol güncellenemedi.',   // ×2
  kaldirilamadi: 'Kaldırılamadı.',   // ×2
  davet_gonderilemedi: 'Davet gönderilemedi.',   // ×2
  askiya_al: 'Askıya Al',   // ×2
  aktiflestir: 'Aktifleştir',   // ×2
  islem_basarisiz: 'İşlem başarısız.',   // ×2
  gecerli_bir_tutar_girin: 'Geçerli bir tutar girin.',   // ×2
  link_olusturulamadi: 'Link oluşturulamadı.',   // ×2
  sonraki_odeme: 'Sonraki Ödeme',   // ×2
  odeme_gecmisi: 'Ödeme Geçmişi',   // ×2
  odeme_linki: 'Ödeme Linki',   // ×2
  bordro: 'Bordro',   // ×2
  calisanlar: 'Çalışanlar',   // ×2
  bordro_hesapla: 'Bordro Hesapla',   // ×2
  toplam_net: 'Toplam Net',   // ×2
  gelir_vergisi: 'Gelir Vergisi',   // ×2
  isveren_sgk: 'İşveren SGK',   // ×2
  net_maas: 'Net Maaş',   // ×2
  tam_zamanli: 'Tam Zamanlı',   // ×2
  yeni_calisan: 'Yeni Çalışan',   // ×2
  oneri_uretilemedi: 'Öneri üretilemedi.',   // ×2
  bilesen: 'Bileşen',   // ×2
  fatura_ekle: 'Fatura Ekle',   // ×2
  seviyeyi_sil: 'Seviyeyi sil',   // ×2
  yontem: 'Yöntem',   // ×2
  mektup: 'Mektup',   // ×2
  gecikmis: 'gecikmiş',   // ×2
  veri_alinamadi: 'Veri alınamadı.',   // ×2
  kontrol_ediliyor: 'Kontrol ediliyor…',   // ×2
  bugun_2: 'Bugün!',   // ×2
  geciken: 'Geciken',   // ×2
  toplam_tutar: 'Toplam Tutar',   // ×2
  toplam_kayit: 'Toplam Kayıt',   // ×2
  tamam: 'Tamam',   // ×2
  son_guncelleme: 'Son Güncelleme',   // ×2
  agustos: 'Ağustos',   // ×2
  devam_et: 'Devam Et',   // ×2
  dosya_sec: 'Dosya Seç',   // ×2
  _14_gun_ucretsiz_dene: '14 Gün Ücretsiz Dene',   // ×2
  oynat: 'Oynat',   // ×2
  duraklat: 'Duraklat',   // ×2
  basvur: 'Başvur',   // ×2
  lojistik_kargo: 'Lojistik & Kargo',   // ×2
  finans_muhasebe: 'Finans & Muhasebe',   // ×2
  teklif_al: 'Teklif Al',   // ×2
  ortaklar: 'Ortaklar',   // ×2
  ucretsiz_basla: 'Ücretsiz Başla',   // ×2
  demo_talep_et: 'Demo Talep Et',   // ×2
  aktif_siparis: 'Aktif Sipariş',   // ×2
  kalite_kontrol: 'Kalite Kontrol',   // ×2
  eslesen: 'Eşleşen',   // ×2
  eslesmedi: 'Eşleşmedi',   // ×2
  lot_ekle: 'Lot Ekle',   // ×2
  seri_no_ekle: 'Seri No Ekle',   // ×2
  tip: 'Tip',   // ×2
  islem_ekle: 'İşlem Ekle',   // ×2
  sahiplik: 'Sahiplik %',   // ×2
  kod: 'Kod',   // ×2
  elimine_edildi: 'Elimine Edildi',   // ×2
  gonderen: 'Gönderen',   // ×2
  ozkaynak: 'Özkaynak',   // ×2
  toplam_gelir: 'Toplam Gelir',   // ×2
  tutar_3: 'Tutar *',   // ×2
  toplam_alacak: 'Toplam Alacak',   // ×2
  seciniz_2: '— Seçiniz —',   // ×2
  pozisyon: 'Pozisyon',   // ×2
  hesapla: 'Hesapla',   // ×2
  yeni_izin_talebi: 'Yeni İzin Talebi',   // ×2
  gun_2: 'Gün',   // ×2
  yeni_egitim: 'Yeni Eğitim',   // ×2
  egitim_adi: 'Eğitim Adı',   // ×2
  saglayici: 'Sağlayıcı',   // ×2
  varis_noktasi: 'Varış Noktası',   // ×2
  gelen: 'GELEN',   // ×2
  giden: 'GİDEN',   // ×2
  kalemler: 'Kalemler',   // ×2
  araniyor: 'Aranıyor...',   // ×2
  tahmini_teslimat: 'Tahmini Teslimat',   // ×2
  sablon_adi: 'Şablon adı',   // ×2
  hizli_sevkiyat: 'Hızlı Sevkiyat',   // ×2
  takip_no: 'Takip No',   // ×2
  bu_islem_icin_giris_gerekli: 'Bu işlem için giriş gerekli.',   // ×2
  uygun: 'Uygun',   // ×2
  hatali: 'Hatalı',   // ×2
  sartli_kabul: 'Şartlı Kabul',   // ×2
  toplam_denetim: 'Toplam Denetim',   // ×2
  parti_no: 'Parti No',   // ×2
  kok_neden: 'Kök Neden',   // ×2
  duzeltici_faaliyet: 'Düzeltici Faaliyet',   // ×2
  inceleniyor: 'İnceleniyor',   // ×2
  denetim_uyumluluk: 'Denetim Uyumluluk',   // ×2
  aksiyon_bekleyen: 'Aksiyon Bekleyen',   // ×2
  gemini_onerisi: 'Gemini Önerisi',   // ×2
  kontrol_noktasi: 'Kontrol Noktası',   // ×2
  devam_eden: 'Devam Eden',   // ×2
  saglanan_tasarruf: 'Sağlanan Tasarruf',   // ×2
  alan: 'Alan',   // ×2
  asama: 'Aşama',   // ×2
  yetki_hatasi_lutfen_giris_yapin: 'Yetki hatası — lütfen giriş yapın.',   // ×2
  ceyreklik: 'Çeyreklik',   // ×2
  kural_ekle: 'Kural Ekle',   // ×2
  hesap: 'Hesap',   // ×2
  calisan_adi: 'Çalışan adı',   // ×2
  skor: 'Skor',   // ×2
  gecikmis_2: 'Gecikmiş',   // ×2
  bekliyor_2: '⏳ Bekliyor',   // ×2
  tara: 'Tara',   // ×2
  mal_kabul: 'Mal Kabul',   // ×2
  sayim_baslat: 'Sayım Başlat',   // ×2
  tamamla: 'Tamamla',   // ×2
  koridor: 'Koridor',   // ×2
  seviye: 'Seviye',   // ×2
  depo_secin: 'Depo seçin',   // ×2
  sube: 'Şube',   // ×2
  kayitli_mukellef: 'Kayıtlı mükellef',   // ×2
  matrah_kdv_haric: 'Matrah (KDV hariç)',   // ×2
  mikro_jumpbulut_api_sinde_banka_hareketi_servisi: 'Mikro JumpBulut API\\\'sinde banka hareketi servisi bulunmuyor. Banka hesap tanımları Ayarlar > Mikro > "Bankalar" ile çekilebilir.',   // ×2
  depo_tanimlari: 'Depo Tanımları',   // ×2
  qr_etiketi: 'QR Etiketi',   // ×2
  yeni_bayi: 'Yeni Bayi',   // ×2
  arama_sonucu_bulunamadi: 'Arama sonucu bulunamadı.',   // ×2
  ertelenmis_gelir: 'Ertelenmiş Gelir',   // ×2
  tanindi: 'tanındı',   // ×2
  ertelenen: 'Ertelenen',   // ×2
  sorumlu_temsilci: 'Sorumlu Temsilci',   // ×2
  yillik_kota: 'Yıllık Kota',   // ×2
  lead: 'Lead',   // ×2
  daha: 'daha',   // ×2
  yeni_recete: 'Yeni Reçete',   // ×2
  planlandi: 'Planlandı',   // ×2
  kararlar: 'Kararlar',   // ×2
  ad_soyad_unvan: 'Ad Soyad / Ünvan',   // ×2
  pay_adedi: 'Pay Adedi',   // ×2
  gercek_kisi: 'Gerçek Kişi',   // ×2
  tuzel_kisi: 'Tüzel Kişi',   // ×2
  olaganustu: 'Olağanüstü',   // ×2
  olagan: 'Olağan',   // ×2
  sozlesme_yonetimi: 'Sözleşme Yönetimi',   // ×2
  karsi_taraf: 'Karşı Taraf',   // ×2
  hizmet: 'Hizmet',   // ×2
  kira: 'Kira',   // ×2
  dosya_indiriliyor: 'Dosya indiriliyor...',   // ×2
  goruntule_indir: 'Görüntüle / İndir',   // ×2
  toplanti_basligi: 'Toplantı Başlığı',   // ×2
  alinan_kararlar: 'Alınan Kararlar',   // ×2
  kredi_karti: 'Kredi Kartı',   // ×2
  entegrasyon_kurulum: 'Entegrasyon & Kurulum',   // ×2
  sirket_adi: 'Şirket Adı',   // ×2
  kullanim: 'Kullanım',   // ×2
  planlanan_2: 'Planlanan:',   // ×2
  lutfen_tedarikci_adi_girin: 'Lütfen tedarikçi adı girin.',   // ×2
  lutfen_en_az_bir_urun_secin: 'Lütfen en az bir ürün seçin.',   // ×2
  onaya_gonder: 'Onaya Gönder',   // ×2
  siparisi_duzenle: 'Siparişi Düzenle',   // ×2
  genel_toplam_2: 'Genel Toplam',   // ×2
  iade_nedeni: 'İade Nedeni',   // ×2
  cari_ekstre_hareketleri: 'Cari ekstre / hareketleri',   // ×2
  finansal_risk: 'Finansal & Risk',   // ×2
  acik_bakiye: 'Açık Bakiye (₺)',   // ×2
  risk_grubu: 'Risk Grubu',   // ×2
  toplam_adet: 'Toplam Adet',   // ×2
  stok_degeri: 'Stok Değeri',   // ×2
  detay_icin_tikla: 'Detay için tıkla',   // ×2
  alacak: 'Alacak',   // ×2
  borc: 'Borç',   // ×2
  doviz: 'Döviz',   // ×2
  tum_siparisler: 'Tüm Siparişler',   // ×2
  borc_toplami_hesap_detayi: 'Borç Toplamı — Hesap Detayı',   // ×2
  alacak_toplami_hesap_detayi: 'Alacak Toplamı — Hesap Detayı',   // ×2
  borc_bakiyesi_hesap_detayi: 'Borç Bakiyesi — Hesap Detayı',   // ×2
  alacak_bakiyesi_hesap_detayi: 'Alacak Bakiyesi — Hesap Detayı',   // ×2
  kur_bekleniyor: 'Kur bekleniyor',   // ×2
  para_birimi_2: 'Para Birimi:',   // ×2
  kaydedildi_2: 'Kaydedildi',   // ×2
  kisa_vadeli_yukumlulukler: 'Kısa Vadeli Yükümlülükler',   // ×2
  ticari_borclar: 'Ticari Borçlar',   // ×2
  cari_oran: 'Cari Oran',   // ×2
  fatura_kes: 'Fatura Kes',   // ×2
  yeni_2: 'yeni',   // ×2
  gelir_carpani: 'Gelir Çarpanı',   // ×2
  calisan_basi_ciro: 'Çalışan Başı Ciro',   // ×2
  kisi: 'kişi',   // ×2
  ayrilan: 'Ayrılan',   // ×2
  veri_yok_2: 'Veri yok',   // ×2
  performans_degerlendirmeleri: 'Performans Değerlendirmeleri',   // ×2
  dusuk_stok: 'Düşük Stok',   // ×2
  toplam_stok_degeri: 'Toplam Stok Değeri',   // ×2
  envanter_ozeti: 'Envanter Özeti',   // ×2
  uyari: 'Uyarı',   // ×2
  yuksek_risk: 'Yüksek Risk',   // ×2
  orta_risk: 'Orta Risk',   // ×2
  stok_deger_dusuklugu_riski: 'Stok Değer Düşüklüğü Riski',   // ×2
  stoksuz_kalma_sikligi_izleyici: 'Stoksuz Kalma Sıklığı İzleyici',   // ×2
  dusuk_marjli_urunler: 'Düşük Marjlı Ürünler',   // ×2
  teslimat_performansi: 'Teslimat Performansı',   // ×2
  ortalama: 'Ortalama',   // ×2
  belirtilmemis: 'Belirtilmemiş',   // ×2
  gecikmeli: 'Gecikmeli',   // ×2
  acik_siparis_oncelik_sirasi: 'Açık Sipariş Öncelik Sırası',   // ×2
  siparis_durumu_dagilimi: 'Sipariş Durumu Dağılımı',   // ×2
  en_hizli: 'En hızlı',   // ×2
  en_yavas: 'En yavaş',   // ×2
  musteri_sayisi: 'Müşteri Sayısı',   // ×2
  aylik_ciro: 'Aylık Ciro',   // ×2
  toplam_musteri: 'Toplam Müşteri',   // ×2
  teslim_2: 'teslim',   // ×2
  ort: 'ort.',   // ×2
  musteri_segmentine_gore_ciro: 'Müşteri Segmentine Göre Ciro',   // ×2
  bu_ay_2: 'Bu ay',   // ×2
  donusum_orani: 'Dönüşüm Oranı',   // ×2
  siparisler_arasi_ortalama_gun: 'Siparişler Arası Ortalama Gün',   // ×2
  genel_hat: 'Genel Hat',   // ×2
  is_merkezi: 'İş Merkezi',   // ×2
  durum_guncellenemedi_yetki: 'Durum güncellenemedi (yetki?).',   // ×2
  gizle: 'Gizle',   // ×2
  bekleniyor: 'Bekleniyor',   // ×2
  ayarlar_kaydedildi: 'Ayarlar kaydedildi!',   // ×2
  e_ticaret_entegrasyonu: 'E-ticaret entegrasyonu',   // ×2
  bagli_degil: 'Bağlı Değil',   // ×2
  yeni_tedarikci: 'Yeni Tedarikçi',   // ×2
  bekliyor_3: 'bekliyor',   // ×2
  acik_po: 'açık PO',   // ×2
  butce_2: 'Bütçe (₺)',   // ×2
  harcanan_2: 'Harcanan (₺)',   // ×2
  api_anahtari: 'API Anahtarı',   // ×2
  toplam_sku: 'Toplam SKU',   // ×2
  talep: 'Talep',   // ×2
  lot_no: 'Lot No',   // ×2
  lokasyon: 'Lokasyon',   // ×2
  fark: 'Fark',   // ×2
  stok_devir_hizi: 'Stok Devir Hızı',   // ×2
  islemde: 'İşlemde',   // ×2
  reddedilen: 'Reddedilen',   // ×2
  onaylandi_2: 'Onaylandı.',   // ×2
  hedef_yok: 'Hedef yok',   // ×2
  _12_ay_ciro: '12 Ay Ciro',   // ×2
  a: 'a',   // ×2
  yeniden_ac: 'Yeniden Aç',   // ×2
  odenen: 'Ödenen',   // ×2
  donusum: 'Dönüşüm',   // ×2
  temsilci: 'Temsilci',   // ×2
  sampiyon: 'Şampiyon',   // ×2
  cek: 'Çek',   // ×2
  hasarli_urun: 'Hasarlı Ürün',   // ×2
  onaylanan: 'Onaylanan',   // ×2
  neden: 'Neden',   // ×2
  siparis_3: 'Sipariş:',   // ×2
  talep_ekle: 'Talep Ekle',   // ×2
  hastalik: 'Hastalık',   // ×2
  ucretsiz: 'Ücretsiz',   // ×2
  damga: 'Damga',   // ×2
  stok_uyarisi: 'Stok Uyarısı',   // ×2
  acik_2: 'açık',   // ×2
  haftalik: 'Haftalık',   // ×2
  tarih_yok: 'Tarih yok',   // ×2
  odendi_tikla_odenmedi_yap: 'Ödendi — tıkla: ödenmedi yap',   // ×2
  tahsilat_durumu_mikro_cari_hesapta_izlenir_sipar: 'Tahsilat durumu Mikro cari hesapta izlenir — sipariş türevi bilmez',   // ×2
  iade_olustur: 'İade Oluştur',   // ×2
  bin_kodu: 'Bin Kodu',   // ×2
  sonraki_bakim: 'Sonraki Bakım',   // ×2
  destinasyon: 'Destinasyon',   // ×2
  en_yuksek_cirolu_musteriler: 'En Yüksek Cirolu Müşteriler',   // ×2
  calisan_adi_2: 'Çalışan Adı',   // ×2
  toplam_kdv: 'Toplam KDV',   // ×2
  lehtar: 'Lehtar',   // ×2
  ozkaynaklar: 'Özkaynaklar',   // ×2
  tahsil: 'Tahsil',   // ×2
  ulasim: 'Ulaşım',   // ×2
  oran_yok: 'Oran yok',   // ×2
  karma_oran: 'Karma oran',   // ×2
  erp_durumu: 'ERP Durumu',   // ×2
  fatura_yok: 'Fatura Yok',   // ×2
  kural_adi: 'Kural Adı',   // ×2
  sapma: 'Sapma',   // ×2
  gecen_ay: 'Geçen Ay',   // ×2
  yeni_abonelik: 'Yeni Abonelik',   // ×2
  kaydedilemedi_yetki: 'Kaydedilemedi (yetki?).',   // ×2
  madde_eklenemedi_yetki: 'Madde eklenemedi (yetki?).',   // ×2
  hat: 'Hat',   // ×2
  yeniden_islem: 'Yeniden İşlem',   // ×2
  },
  en: {
  iptal: 'Cancel',
  durum: 'Status',
  kaydet: 'Save',
  sil: 'Delete',
  duzenle: 'Edit',
  urun: 'Product',
  tarih: 'Date',
  musteri: 'Customer',
  tutar: 'Amount',
  toplam: 'Total',
  aktif: 'Active',
  siparis: 'orders',
  diger: 'Other',
  aciklama: 'Description',
  tur: 'Type',
  adet: 'units',
  kapat: 'Close',
  miktar: 'Qty',
  kaydedilemedi: 'Save failed: ',
  incele: 'View',
  tumu: 'All',
  hata_olustu: 'Error occurred',
  siparis_2: 'Orders',
  ciro: 'Revenue',
  silinemedi: 'Delete failed: ',
  tedarikci: 'Supplier',
  islemler: 'Actions',
  bekliyor: 'Pending',
  notlar: 'Notes',
  kategori: 'Category',
  onayla: 'Approve',
  aylik: 'Monthly',
  bakiye: 'Balance',
  hata_olustu_2: 'Error occurred.',
  stok: 'Stock',
  yuksek: 'High',
  dusuk: 'Low',
  ekle: 'Add',
  kritik: 'Critical',
  g: 'd',
  gerceklesen: 'Actual',
  telefon: 'Phone',
  crm_satis: 'CRM & Sales',
  depo: 'Warehouse',
  reddet: 'Reject',
  gun: 'd',
  donem: 'Period',
  guncellenemedi: 'Update failed: ',
  adres: 'Address',
  calisan: 'Employee',
  urun_adi: 'Product Name',
  ay: 'Month',
  olustur: 'Create',
  yeni_ekle: 'Add New',
  baslik: 'Title',
  deger: 'Value',
  yenile: 'Refresh',
  bekleyen: 'Pending',
  marj: 'Margin',
  bakim_onarim: 'Maintenance',
  siparisler: 'Orders',
  hukuk_uyum: 'Legal & Compliance',
  geri: '← Back',
  yukleniyor: 'Loading...',
  envanter: 'Inventory',
  orta: 'Medium',
  tamamlanan: 'Completed',
  baslangic: 'Start Date',
  vergi_dairesi: 'Tax Office',
  kaydediliyor: 'Saving...',
  islem: 'Action',
  toplam_deger: 'Total Value',
  sorumlu: 'Responsible',
  kaydediliyor_2: 'Saving…',
  fatura_no: 'Invoice No',
  geri_2: 'Back',
  tum_haklari_saklidir: 'All rights reserved.',
  acik: 'Open',
  lutfen_giris_yapin: 'Please login.',
  filtreyi_temizle: 'Clear Filter',
  satis: 'Sales',
  gelir: 'Revenue',
  kullanim_kosullari: 'Terms of Service',
  satin_alma: 'Purchasing',
  vergi_takvimi: 'Tax Calendar',
  ithalat_ihracat: 'Import/Export',
  lot_seri_takip: 'Lot/Serial',
  subeler: 'Branches',
  muhasebe_finans: 'Accounting & Finance',
  insan_kaynaklari: 'Human Resources',
  sozlesmeler: 'Contracts',
  komisyon: 'Commission',
  odendi: 'Paid',
  teslim_edildi: 'Delivered',
  toplam_2: 'TOTAL',
  genel: 'General',
  toplam_siparis: 'Total Orders',
  oncelik: 'Priority',
  butce: 'Budget',
  tamamlandi: 'Completed',
  rol: 'Role',
  bitis: 'End Date',
  taslak: 'Draft',
  brut: 'Gross',
  musteri_adi: 'Customer Name',
  donem_2: 'Period:',
  guncelle: 'Update',
  musteri_adi_2: 'Customer name',
  surec: 'Process',
  karma: 'Mixed',
  brut_kar: 'Gross Profit',
  musteri_2: 'customers',
  sirket: 'Company',
  onaylar: 'Approvals',
  e_belge_merkezi: 'E-Document Hub',
  analitik: 'Analytics',
  lojistik_depo: 'Logistics & Warehouse',
  proje_yonetimi: 'Project Management',
  genel_bakis: 'Overview',
  kullanicilar: 'Users',
  toplam_ciro: 'Total Revenue',
  ara: 'Search...',
  ice_aktar: 'Import',
  reddedildi: 'Rejected',
  yeni_talep: 'New Request',
  sozlesme: 'Contract',
  guncelleme_basarisiz: 'Update failed.',
  kaydedilemedi_2: 'Save failed.',
  firma: 'Company',
  yillik: 'Yearly',
  vazgec: 'Cancel',
  birim: 'Unit',
  tahsil_edilen: 'Collected',
  tutar_2: 'Amount (₺)',
  veri_yok: 'No data.',
  urunler: 'Products',
  nasil_calisir: 'How It Works',
  sektorler: 'Industries',
  kariyer: 'Careers',
  gizlilik_politikasi: 'Privacy Policy',
  lutfen_calisan_secin: 'Please select an employee.',
  calisan_secin: 'Select Employee',
  bilinmiyor: 'Unknown',
  maliyet: 'Cost',
  konu: 'Subject',
  surucu: 'Driver',
  siparis_durumu: 'Order Status',
  cozuldu: 'Resolved',
  hata_modu: 'Failure Mode',
  bayi: 'Dealer',
  hedef: 'Target',
  odendi_2: '✓ Paid',
  yeni_sozlesme: 'New Contract',
  silindi: 'Deleted',
  urun_adi_2: 'Product name',
  teslim: 'Delivered',
  siparis_adedi: 'Order Count',
  silinemedi_yetki: 'Delete failed.',
  yapilandirildi: 'Configured',
  brut_marj: 'Gross Margin',
  _3_aylik: 'Quarterly',
  sevkiyat: 'Shipment',
  siparis_iptal_edildi: 'Order Cancelled',
  projeler: 'Projects',
  ayarlar: 'Settings',
  kalite_yonetimi: 'Quality Management',
  kurumsal_yonetim: 'Corporate Governance',
  kopyala: 'Copy',
  uretim_yonetimi: 'Production',
  servis: 'Service',
  raporlar: 'Reports',
  lojistik: 'Logistics',
  siparis_no: 'Order No',
  e_posta: 'Email',
  kredi_limiti: 'Credit Limit (₺)',
  giris: 'In',
  cikis: 'Out',
  kredi_limiti_2: 'Credit Limit',
  barkod_qr_tara: 'Scan Barcode / QR',
  toplam_maliyet: 'Total Cost',
  saglikli: 'Healthy',
  kar_marji: 'Margin',
  kayit_basariyla_silindi: 'Record deleted successfully.',
  gorevler: 'Tasks',
  harcanan: 'Spent',
  toplam_butce: 'Total Budget',
  proje_adi: 'Project Name',
  proje_ekle: 'Add Project',
  bugun: 'Today',
  isim: 'Name',
  vergi_no: 'Tax No',
  urun_2: 'items',
  urun_barkodu_tara: 'Scan Product Barcode',
  indir: 'Download',
  gonderiliyor: 'Sending...',
  uyumlu: 'Compliant',
  uyumsuz: 'Non-Compliant',
  mesaj: 'Message',
  kaldir: 'Remove',
  askida: 'Suspended',
  toplam_brut: 'Total Gross',
  departman: 'Department',
  sgk_matrahi: 'SGK Base',
  pasif: 'Inactive',
  ad_soyad: 'Full Name',
  ay_2: 'mo',
  kismi: 'Partial',
  ozellikler: 'Features',
  fiyatlar: 'Pricing',
  ay_3: '/mo',
  kayit: 'records',
  skt: 'Expiry',
  seri_no: 'Serial No',
  garanti_bitis: 'Warranty End',
  ulke: 'Country',
  alici: 'To',
  toplam_3: 'total',
  kayit_bulunamadi: 'No records found.',
  kdv: 'VAT',
  marj_2: 'margin',
  yolda: 'In Transit',
  birim_fiyat: 'Unit Price',
  devam: 'Continue',
  hata_orani: 'Defect Rate',
  onemli: 'Major',
  kapali: 'Closed',
  puan: 'Score',
  dusuk_risk: 'Low Risk',
  denetci: 'Inspector',
  perakende: 'Retail',
  temizle: 'Clear',
  siparis_id: 'Order ID',
  api_ve_entegrasyonlar: 'API & Integrations',
  odeme: 'Payment',
  topla: 'Pick',
  kalem: 'lines',
  fatura_turu: 'Invoice Type',
  ihracat: 'Export',
  sozlesme_ekle: 'Add Contract',
  taninan: 'Recognized',
  renk: 'Color',
  detay: 'Detail',
  kayit_ekle: 'Add Record',
  nakit: 'Cash',
  kullanici: 'users',
  cari_ekstre: 'Account Statement',
  not: 'Notes',
  mikro_dahil: ' (incl. Mikro)',
  donen_varliklar: 'Current Assets',
  banka: 'Bank',
  adet_2: 'Qty',
  pay: 'Share',
  aktif_calisan: 'Active Employees',
  departmana_gore_calisan_sayisi: 'Headcount by Department',
  suresi_doldu: 'Expired',
  kargoda: 'In Transit',
  detaya_git: 'View details',
  aktif_musteri: 'Active Customers',
  yeni: 'New',
  sip: 'ord.',
  birim_2: 'units',
  kullanici_2: 'User',
  bagli: 'Connected',
  yapilandirilmamis: 'Not Configured',
  onayli: 'Approved',
  bu_ay: 'This Month',
  odenmedi: '⏳ Unpaid',
  kopyalanamadi_tarayici_pano_iznini_engelledi: 'Copy failed — clipboard blocked.',
  siparis_iptali: 'Order cancelled',
  ad_soyad_2: 'Full Name *',
  giris_yap: '← Back to Sign In',
  ornek_cetpa_com: 'example@cetpa.com',
  muhasebe: 'Accounting',
  uretim: 'Production',
  iade_degisim: 'Returns (RMA)',
  mesai_devam: 'Time & Attendance',
  mobil_wms: 'Mobile WMS',
  performans: 'Performance',
  satis_bolgeleri: 'Territories',
  fiyat_istihbarati: 'Price Intel',
  sube_yonetimi: 'Branch Management',
  panel: 'Dashboard',
  musteri_adaylari: 'Leads',
  musteriler: 'Customers',
  kampanyalar: 'Campaigns',
  hedefler: 'Targets',
  tedarik_zinciri_kpi: 'Supply Chain KPI',
  canli_sevkiyat: 'Live Delivery',
  satin_alma_siparisleri: 'Purchase Orders',
  tedarikciler: 'Suppliers',
  odeme_takvimi: 'Payment Schedule',
  tedarikci_portali: 'Supplier Portal',
  satin_alma_butcesi: 'Purchase Budget',
  tedarik_zinciri_riski: 'Supply Chain Risk',
  fiyat_karsilastirma: 'Price Comparison',
  performans_degerlendirme: 'Performance Reviews',
  musteri_yonetimi: 'Customer Mgmt',
  musteri_tipi: 'Customer Type',
  fatura_tipi: 'Invoice Type',
  teslimat_adresi: 'Shipping Address',
  olusturulma: 'Created',
  sebep: 'Reason',
  teslim_edilen: 'Delivered',
  tedarikci_2: 'SUPPLIER',
  beklenen: 'Expected',
  genel_toplam: 'GRAND TOTAL',
  manuel: 'Manual',
  net_kar: 'Net Profit',
  bu_hafta: 'This week',
  henuz_siparis_verisi_yok: 'No order data yet.',
  yonetici: 'Manager',
  tum_projeler: 'All Projects',
  beklemede: 'On-Hold',
  planlama: 'Planning',
  yapilacak: 'Todo',
  devam_ediyor: 'In-Progress',
  inceleme: 'Review',
  proje_zaman_cizelgesi: 'Project Timeline',
  planlanan: 'Planned',
  son_tarih: 'Due Date',
  sablonu_kaydet: 'Save Template',
  konsinye_gonder: 'Send Consignment',
  seciniz: 'Select',
  stok_2: 'stock',
  not_opsiyonel: 'Note (optional)',
  gonder: 'Send',
  sistem: 'system',
  sayilan: 'counted',
  taraf: 'Party',
  kazanilan: 'Won',
  goruntule: 'View',
  onaylandi: 'Approved',
  incelemede: 'Under Review',
  para_birimi: 'Currency',
  sonraki_tarih: 'Next Date',
  kaydedildi: '✓ Saved',
  ara_2: 'Call',
  detay_yuklenemedi: 'Failed to load detail.',
  detay_tazelenemedi_gorunen_veriler_eski_olabilir: 'Refresh failed — data may be stale.',
  rol_guncellenemedi: 'Role update failed.',
  kaldirilamadi: 'Removal failed.',
  davet_gonderilemedi: 'Invite failed.',
  askiya_al: 'Suspend',
  aktiflestir: 'Activate',
  islem_basarisiz: 'Operation failed.',
  gecerli_bir_tutar_girin: 'Enter a valid amount.',
  link_olusturulamadi: 'Failed to create link.',
  sonraki_odeme: 'Next Payment',
  odeme_gecmisi: 'Payment History',
  odeme_linki: 'Payment Link',
  bordro: 'Payroll',
  calisanlar: 'Employees',
  bordro_hesapla: 'Calculate Payroll',
  toplam_net: 'Total Net',
  gelir_vergisi: 'Income Tax',
  isveren_sgk: 'Employer SGK',
  net_maas: 'Net Salary',
  tam_zamanli: 'Full-time',
  yeni_calisan: 'New Employee',
  oneri_uretilemedi: 'Failed.',
  bilesen: 'Component',
  fatura_ekle: 'Add Invoice',
  seviyeyi_sil: 'Delete level',
  yontem: 'Method',
  mektup: 'Letter',
  gecikmis: 'overdue',
  veri_alinamadi: 'Failed to load.',
  kontrol_ediliyor: 'Checking…',
  bugun_2: 'Today!',
  geciken: 'Overdue',
  toplam_tutar: 'Total Amount',
  toplam_kayit: 'Total Records',
  tamam: 'Done',
  son_guncelleme: 'Last Updated',
  agustos: 'August',
  devam_et: 'Continue',
  dosya_sec: 'Choose File',
  _14_gun_ucretsiz_dene: 'Start 14-Day Free Trial',
  oynat: 'Play',
  duraklat: 'Pause',
  basvur: 'Apply',
  lojistik_kargo: 'Logistics & Cargo',
  finans_muhasebe: 'Finance & Accounting',
  teklif_al: 'Get Quote',
  ortaklar: 'Partners',
  ucretsiz_basla: 'Start for Free',
  demo_talep_et: 'Request Demo',
  aktif_siparis: 'Active Orders',
  kalite_kontrol: 'Quality Control',
  eslesen: 'Matched',
  eslesmedi: 'Unmatched',
  lot_ekle: 'Add Lot',
  seri_no_ekle: 'Add Serial No',
  tip: 'Type',
  islem_ekle: 'Add Transaction',
  sahiplik: 'Ownership %',
  kod: 'Code',
  elimine_edildi: 'Eliminated',
  gonderen: 'From',
  ozkaynak: 'Equity',
  toplam_gelir: 'Total Revenue',
  tutar_3: 'Amount *',
  toplam_alacak: 'Total Receivable',
  seciniz_2: '— Select —',
  pozisyon: 'Position',
  hesapla: 'Calculate',
  yeni_izin_talebi: 'New Leave Request',
  gun_2: 'Days',
  yeni_egitim: 'New Training',
  egitim_adi: 'Training Title',
  saglayici: 'Provider',
  varis_noktasi: 'Destination',
  gelen: 'IN',
  giden: 'OUT',
  kalemler: 'Line items',
  araniyor: 'Searching...',
  tahmini_teslimat: 'Est. Delivery',
  sablon_adi: 'Template name',
  hizli_sevkiyat: 'Quick Shipment',
  takip_no: 'Tracking No',
  bu_islem_icin_giris_gerekli: 'Login required.',
  uygun: 'Pass',
  hatali: 'Fail',
  sartli_kabul: 'Conditional',
  toplam_denetim: 'Total Audits',
  parti_no: 'Batch No',
  kok_neden: 'Root Cause',
  duzeltici_faaliyet: 'Corrective Action',
  inceleniyor: 'Investigating',
  denetim_uyumluluk: 'Audit Compliance',
  aksiyon_bekleyen: 'Pending Actions',
  gemini_onerisi: 'Gemini Suggestion',
  kontrol_noktasi: 'Control Point',
  devam_eden: 'In Progress',
  saglanan_tasarruf: 'Savings',
  alan: 'Area',
  asama: 'Stage',
  yetki_hatasi_lutfen_giris_yapin: 'Permission denied — please sign in.',
  ceyreklik: 'Quarterly',
  kural_ekle: 'Add Rule',
  hesap: 'Account',
  calisan_adi: 'Employee name',
  skor: 'Score',
  gecikmis_2: 'Overdue',
  bekliyor_2: '⏳ Pending',
  tara: 'Scan',
  mal_kabul: 'Receive Goods',
  sayim_baslat: 'Start Count',
  tamamla: 'Complete',
  koridor: 'Aisle',
  seviye: 'Level',
  depo_secin: 'Select warehouse',
  sube: 'Branch',
  kayitli_mukellef: 'Registered taxpayer',
  matrah_kdv_haric: 'Net (excl. VAT)',
  mikro_jumpbulut_api_sinde_banka_hareketi_servisi: 'Mikro JumpBulut API has no bank movement service. Bank account definitions can be pulled via Settings > Mikro > Banks.',
  depo_tanimlari: 'Warehouse Definitions',
  qr_etiketi: 'QR Label',
  yeni_bayi: 'New Dealer',
  arama_sonucu_bulunamadi: 'No results found.',
  ertelenmis_gelir: 'Deferred Revenue',
  tanindi: 'recognized',
  ertelenen: 'Deferred',
  sorumlu_temsilci: 'Assigned Rep',
  yillik_kota: 'Annual Quota',
  lead: 'Leads',
  daha: 'more',
  yeni_recete: 'New BOM',
  planlandi: 'Planned',
  kararlar: 'Decisions',
  ad_soyad_unvan: 'Name / Title',
  pay_adedi: 'Share Count',
  gercek_kisi: 'Natural Person',
  tuzel_kisi: 'Legal Entity',
  olaganustu: 'Extraordinary',
  olagan: 'Ordinary',
  sozlesme_yonetimi: 'Contract Management',
  karsi_taraf: 'Counterparty',
  hizmet: 'Service',
  kira: 'Lease',
  dosya_indiriliyor: 'Downloading file...',
  goruntule_indir: 'View / Download',
  toplanti_basligi: 'Meeting Title',
  alinan_kararlar: 'Decisions',
  kredi_karti: 'Credit Card',
  entegrasyon_kurulum: 'Integration & Setup',
  sirket_adi: 'Company Name',
  kullanim: 'Utilization',
  planlanan_2: 'Planned:',
  lutfen_tedarikci_adi_girin: 'Please enter a supplier name.',
  lutfen_en_az_bir_urun_secin: 'Please select at least one item.',
  onaya_gonder: 'Submit for Approval',
  siparisi_duzenle: 'Edit Order',
  genel_toplam_2: 'Grand Total',
  iade_nedeni: 'Return Reason',
  cari_ekstre_hareketleri: 'Account statement',
  finansal_risk: 'Financial & Risk',
  acik_bakiye: 'Open Balance (₺)',
  risk_grubu: 'Risk Group',
  toplam_adet: 'Total Units',
  stok_degeri: 'Stock Value',
  detay_icin_tikla: 'Click for details',
  alacak: 'Credit',
  borc: 'Debit',
  doviz: 'Currency',
  tum_siparisler: 'All Orders',
  borc_toplami_hesap_detayi: 'Total Debit — Account Detail',
  alacak_toplami_hesap_detayi: 'Total Credit — Account Detail',
  borc_bakiyesi_hesap_detayi: 'Debit Balance — Account Detail',
  alacak_bakiyesi_hesap_detayi: 'Credit Balance — Account Detail',
  kur_bekleniyor: 'Rate pending',
  para_birimi_2: 'Currency:',
  kaydedildi_2: 'Saved',
  kisa_vadeli_yukumlulukler: 'Current Liabilities',
  ticari_borclar: 'Trade Payables',
  cari_oran: 'Current Ratio',
  fatura_kes: 'Create Invoice',
  yeni_2: 'new',
  gelir_carpani: 'Revenue Multiplier',
  calisan_basi_ciro: 'Revenue / Employee',
  kisi: 'staff',
  ayrilan: 'Left',
  veri_yok_2: 'No data',
  performans_degerlendirmeleri: 'Performance Ratings',
  dusuk_stok: 'Low Stock',
  toplam_stok_degeri: 'Total Stock Value',
  envanter_ozeti: 'Inventory Summary',
  uyari: 'Warning',
  yuksek_risk: 'High Risk',
  orta_risk: 'Med Risk',
  stok_deger_dusuklugu_riski: 'Inventory Write-Down Risk',
  stoksuz_kalma_sikligi_izleyici: 'Stockout Frequency Monitor',
  dusuk_marjli_urunler: 'Low Margin Products',
  teslimat_performansi: 'Delivery Performance',
  ortalama: 'Average',
  belirtilmemis: 'Not specified',
  gecikmeli: 'Late',
  acik_siparis_oncelik_sirasi: 'Open Order Priority Queue',
  siparis_durumu_dagilimi: 'Order Status Distribution',
  en_hizli: 'Fastest',
  en_yavas: 'Slowest',
  musteri_sayisi: 'Customers',
  aylik_ciro: 'Monthly Revenue',
  toplam_musteri: 'Total Customers',
  teslim_2: 'delivered',
  ort: 'avg',
  musteri_segmentine_gore_ciro: 'Revenue by Customer Segment',
  bu_ay_2: 'This month',
  donusum_orani: 'Conversion Rate',
  siparisler_arasi_ortalama_gun: 'Avg Days Between Orders',
  genel_hat: 'General Line',
  is_merkezi: 'Work Center',
  durum_guncellenemedi_yetki: 'Status update failed.',
  gizle: 'Hide',
  bekleniyor: 'Pending',
  ayarlar_kaydedildi: 'Settings saved!',
  e_ticaret_entegrasyonu: 'E-commerce integration',
  bagli_degil: 'Not Connected',
  yeni_tedarikci: 'New Supplier',
  bekliyor_3: 'pending',
  acik_po: 'open PO',
  butce_2: 'Budget (₺)',
  harcanan_2: 'Spent (₺)',
  api_anahtari: 'API Key',
  toplam_sku: 'Total SKUs',
  talep: 'Demand',
  lot_no: 'Batch No',
  lokasyon: 'Location',
  fark: 'Variance',
  stok_devir_hizi: 'Inventory Turnover',
  islemde: 'In Progress',
  reddedilen: 'Rejected',
  onaylandi_2: 'Approved.',
  hedef_yok: 'No target',
  _12_ay_ciro: '12-Mo Revenue',
  a: 'm',
  yeniden_ac: 'Reopen',
  odenen: 'Paid',
  donusum: 'Conv.',
  temsilci: 'Rep',
  sampiyon: 'Champion',
  cek: 'Check',
  hasarli_urun: 'Damaged Product',
  onaylanan: 'Approved',
  neden: 'Reason',
  siparis_3: 'Order:',
  talep_ekle: 'Add Request',
  hastalik: 'Sick',
  ucretsiz: 'Unpaid',
  damga: 'Stamp',
  stok_uyarisi: 'Stock Warning',
  acik_2: 'open',
  haftalik: 'Weekly',
  tarih_yok: 'Unknown Date',
  odendi_tikla_odenmedi_yap: 'Paid — click to mark unpaid',
  tahsilat_durumu_mikro_cari_hesapta_izlenir_sipar: 'Collection tracked in Mikro AR ledger',
  iade_olustur: 'Create Return',
  bin_kodu: 'Bin Code',
  sonraki_bakim: 'Next Service',
  destinasyon: 'Destination',
  en_yuksek_cirolu_musteriler: 'Top Customers by Revenue',
  calisan_adi_2: 'Employee Name',
  toplam_kdv: 'Total VAT',
  lehtar: 'Beneficiary',
  ozkaynaklar: 'Equity',
  tahsil: 'Collected',
  ulasim: 'Transportation',
  oran_yok: 'No rate',
  karma_oran: 'Mixed rate',
  erp_durumu: 'ERP Status',
  fatura_yok: 'No Invoice',
  kural_adi: 'Rule Name',
  sapma: 'Variance',
  gecen_ay: 'Last Month',
  yeni_abonelik: 'New Subscription',
  kaydedilemedi_yetki: 'Save failed.',
  madde_eklenemedi_yetki: 'Add failed.',
  hat: 'Line',
  yeniden_islem: 'Rework',
  },
} as const;

export type OrtakAnahtar = keyof typeof ORTAK.tr;
export type OrtakDil = 'tr' | 'en';
type OrtakSozluk = { readonly [K in OrtakAnahtar]: string };

/** Ortak sözlük: dil kodu ('tr'|'en') ya da eski Türkçe bayrağı (true = tr) alır. */
export function oc(dil: OrtakDil | boolean | string | undefined): OrtakSozluk {
  const tr = dil === true || dil === 'tr' || dil === undefined;
  return (tr ? ORTAK.tr : ORTAK.en) as OrtakSozluk;
}
