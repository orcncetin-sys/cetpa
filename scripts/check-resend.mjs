/**
 * check-resend.mjs — P0.4: uyari e-postasi GERCEKTEN gidiyor mu?
 *
 * NEDEN VAR: Operasyon Bekcisi bir ariza bulunca e-posta atiyor. Ama o
 * e-posta gitmiyorsa bekci de yok demektir — "izleme var saniyorsun ama yok"
 * durumu, bu projedeki sessiz basarisizlik sinifinin en pahali hali.
 *
 * Hafizadaki not: uyari postasi CALISIYOR ama Resend'in SANDBOX gondericisiyle
 * ve yalniz gmail adresine ulasiyor; cetpa.com.tr alan adi DOGRULANMAMIS.
 * Bu script bunu somut olarak sinar — tahminle birakmaz.
 *
 * CALISTIRMA:
 *   node --import tsx scripts/check-resend.mjs               (yalniz durum raporu)
 *   node --import tsx scripts/check-resend.mjs --send <eposta>  (gercek test postasi)
 */

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const arg = (a) => { const i = process.argv.indexOf(a); return i > -1 ? process.argv[i + 1] : null; };
const gonderHedef = arg('--send');

const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'davet@cetpa.com.tr';

let sorun = false;
const ok = (m) => console.log('  ✓ ' + m);
const no = (m) => { console.error('  ✗ ' + m); sorun = true; };

console.log('Resend durumu\n');

if (!KEY) {
  no('RESEND_API_KEY tanimli DEGIL — hicbir uyari e-postasi gonderilemez.');
  process.exit(1);
}
ok(`API anahtari var (${KEY.slice(0, 6)}…)`);
console.log(`  ℹ gonderici: ${FROM}`);

// ── Alan adi dogrulanmis mi? ────────────────────────────────────────────────
const alan = FROM.includes('@') ? FROM.split('@')[1] : '';
try {
  const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${KEY}` } });
  if (!r.ok) {
    no(`Resend API yanit vermedi (${r.status}) — anahtar gecersiz olabilir.`);
  } else {
    const d = await r.json();
    const alanlar = d?.data ?? [];
    if (!alanlar.length) {
      no('Resend hesabinda HIC dogrulanmis alan adi yok.');
      console.error(`     Bu durumda ${FROM} adresinden gonderim REDDEDILIR ya da yalniz`);
      console.error('     Resend sandbox adresine (kendi hesabiniza) ulasir. Musteriye giden');
      console.error('     hicbir uyari/davet e-postasi calismaz.');
    } else {
      for (const a of alanlar) {
        const durum = a.status === 'verified' ? ok : no;
        durum(`alan: ${a.name} — ${a.status}${a.region ? ' (' + a.region + ')' : ''}`);
      }
      const bizim = alanlar.find(a => a.name === alan);
      if (!bizim) no(`Gonderici alani "${alan}" Resend'de KAYITLI DEGIL — bu adresten gonderim calismaz.`);
      else if (bizim.status !== 'verified') no(`"${alan}" kayitli ama DOGRULANMAMIS (${bizim.status}) — DNS kayitlarini ekleyin.`);
      else ok(`gonderici alani "${alan}" dogrulanmis — gercek gonderim yapilabilir`);
    }
  }
} catch (e) {
  no('Resend API cagrilamadi: ' + (e?.message || e));
}

// ── Istege bagli: gercek test postasi ───────────────────────────────────────
if (gonderHedef) {
  console.log(`\nTest postasi gonderiliyor -> ${gonderHedef}`);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [gonderHedef],
        subject: 'CETPA — uyari hatti testi',
        html: '<p>Bu bir testtir. Bu postayi aldiysaniz Operasyon Bekcisi uyarilari size ULASIR.</p>',
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.id) ok(`gonderildi (id: ${d.id}) — GELEN KUTUSUNU ve SPAM'i kontrol edin`);
    else no(`gonderilemedi (${r.status}): ${d?.message || JSON.stringify(d).slice(0, 200)}`);
  } catch (e) {
    no('gonderim hatasi: ' + (e?.message || e));
  }
}

console.log(sorun
  ? '\nSONUC: uyari hatti GUVENILIR DEGIL — bir ariza olsa haberiniz olmayabilir.'
  : '\nSONUC: uyari hatti calisir durumda.');
process.exit(sorun ? 1 : 0);
