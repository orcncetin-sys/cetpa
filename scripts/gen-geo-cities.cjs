// Bir kerelik üretim script'i (2026-08-17) — Satış Bölgesi: dünya şehir verisi.
// `all-the-cities` (MIT, npm install --no-save ile GEÇİCİ kurulur) build-time
// kaynağıdır — runtime bundle'a asla girmez, yalnız bu script'te require edilir.
// GPL lisanslı `country-state-city` yerine bu paket seçildi (lisans uyumu).
// Çıktı: public/geo/cities/<ISO2>.json — [[isim, nüfus], ...] nüfusa göre azalan.
// Ülke ADLARI ayrı dosyada DEĞİL — istemci Intl.DisplayNames ile canlı çözer
// (tarayıcı yerleşik API'si, ek bağımlılık/statik veri gerekmez).
const fs = require('fs');
const path = require('path');
const cities = require('all-the-cities');

const OUT_DIR = path.join(__dirname, '..', 'public', 'geo', 'cities');
const MIN_POP = 1000; // iş kullanımı için makul eşik — köy/mahalle gürültüsünü eler

// GeoNames kaynağı bazı TR il isimlerinin Türkçe karakterini ASCII'ye
// katlıyor tutarsızca (İstanbul→Istanbul ama Çankaya doğru kalıyor).
// Yalnız 81 ilin RESMİ, tartışmasız listesiyle düzeltiyoruz — küçük ilçe/
// kasaba isimlerini TAHMİN ETMİYORUZ (kaynak kalitesi orada belirsiz).
const TR_ILLER = ['Adana','Adıyaman','Afyonkarahisar','Ağrı','Aksaray','Amasya','Ankara','Antalya',
  'Ardahan','Artvin','Aydın','Balıkesir','Bartın','Batman','Bayburt','Bilecik','Bingöl','Bitlis',
  'Bolu','Burdur','Bursa','Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Düzce','Edirne',
  'Elazığ','Erzincan','Erzurum','Eskişehir','Gaziantep','Giresun','Gümüşhane','Hakkari','Hatay',
  'Iğdır','Isparta','İstanbul','İzmir','Kahramanmaraş','Karabük','Karaman','Kars','Kastamonu',
  'Kayseri','Kırıkkale','Kırklareli','Kırşehir','Kilis','Kocaeli','Konya','Kütahya','Malatya',
  'Manisa','Mardin','Mersin','Muğla','Muş','Nevşehir','Niğde','Ordu','Osmaniye','Rize','Sakarya',
  'Samsun','Şanlıurfa','Siirt','Sinop','Sivas','Şırnak','Tekirdağ','Tokat','Trabzon','Tunceli',
  'Uşak','Van','Yalova','Yozgat','Zonguldak'];
const foldTR = s => s
  .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
  .replace(/Ü/g, 'U').replace(/ü/g, 'u').replace(/Ş/g, 'S').replace(/ş/g, 's')
  .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c').toUpperCase();
const trIlFoldMap = new Map(TR_ILLER.map(il => [foldTR(il), il]));

const byCountry = new Map();
for (const c of cities) {
  if (!c.country || !c.name) continue;
  if ((c.population || 0) < MIN_POP) continue;
  if (!byCountry.has(c.country)) byCountry.set(c.country, []);
  byCountry.get(c.country).push([c.name, c.population || 0]);
}

let totalBytes = 0;
const countryCodes = [];
for (const [code, list] of byCountry) {
  list.sort((a, b) => b[1] - a[1]);
  const normalized = code === 'TR'
    ? list.map(([name, pop]) => [trIlFoldMap.get(foldTR(name)) ?? name, pop])
    : list;
  // Aynı ülkede aynı isim tekrarlarını sil (farklı eyalet/il'de aynı ad olabilir).
  const seen = new Set();
  const deduped = normalized.filter(([name]) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  const json = JSON.stringify(deduped);
  fs.writeFileSync(path.join(OUT_DIR, `${code}.json`), json);
  totalBytes += Buffer.byteLength(json);
  countryCodes.push(code);
}

countryCodes.sort();
fs.writeFileSync(path.join(OUT_DIR, '_index.json'), JSON.stringify(countryCodes));

console.log(`${countryCodes.length} ülke, toplam ${(totalBytes / 1024 / 1024).toFixed(1)} MB (public/geo/cities/, lazy-fetch — bundle'a girmez)`);
