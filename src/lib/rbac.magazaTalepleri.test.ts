/**
 * rbac.magazaTalepleri.test.ts — mağaza sipariş talebi koleksiyonunun YETKİ değişmezleri (dilim 1, 2026-10-08).
 *
 * Kullanıcı kararı K3: talepleri yalnız Yönetici (Admin), Müdür (Manager) ve Satış (Sales) GÖRÜR; başka iç rol ve hiçbir
 * dış rol göremez. Yazma ve silme Yönetici DÂHİL herkese kapalıdır (`SUNUCU_YAZAR_COLLECTIONS`): talep müşterinin
 * beyanıdır, mağazanın kimliksiz ucu ham SQL ile yazar.
 *
 * İKİ KATMAN:
 *   1. Saf kural — her rol × (read, write, delete) tablosu.
 *   2. Bağlantı çiti — kural ancak /api/db yolları ONA uğruyorsa 403 üretir. server.ts içe aktarılamadığı için
 *      (uygulama girişi) altı yazma yolunun ve akışın `isAllowed`'a hangi işlemle uğradığı KAYNAKTA çitlenir
 *      (yorumlar süzülür). Yeni bir /api/db yazma yolu kapısız eklenirse bu dosya kırılır. Çit, server.ts'in bellekte
 *      bozulmuş kopyalarıyla KENDİSİ de sınanır (server.ts'e dokunulmaz).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  isAllowed, hasExplicitRule, APP_ROLES, SUNUCU_YAZAR_COLLECTIONS,
  PUBLIC_WRITE_COLLECTIONS, APPEND_ONLY_COLLECTIONS, ADMIN_ONLY_COLLECTIONS,
  type AppRole, type DbOp,
} from './rbac';
import { TENANT_COLLECTIONS, USER_SCOPED_COLLECTIONS, SERVER_ONLY_COLLECTIONS } from './collections';
import { MAGAZA_TALEP_KOLEKSIYONU } from './magazaTalep';
import { SRC_KOK, oku } from '../test/kaynakTarama';
import { yorumsuz } from '../test/degismezTarayici';

const KOLEKSIYON = 'magazaTalepleri';
const GORENLER: readonly AppRole[] = ['Admin', 'Manager', 'Sales'];
const ISLEMLER: readonly DbOp[] = ['read', 'write', 'delete'];

describe('magazaTalepleri — rol × işlem tablosu', () => {
  it('koleksiyon adı ortak sözleşmedekiyle AYNI (kural başka bir ada yazılmış olmasın)', () => {
    expect(MAGAZA_TALEP_KOLEKSIYONU).toBe(KOLEKSIYON);
    expect(SUNUCU_YAZAR_COLLECTIONS.has(MAGAZA_TALEP_KOLEKSIYONU)).toBe(true);
    expect(hasExplicitRule(MAGAZA_TALEP_KOLEKSIYONU)).toBe(true);
  });

  it('tablo bütün rolleri kapsıyor (yeni rol eklenirse satırı eksik kalmasın)', () => {
    expect([...APP_ROLES].sort()).toEqual(
      ['Accounting', 'Admin', 'B2B', 'Corporate', 'Dealer', 'HR', 'Legal', 'Logistics', 'Manager', 'Purchasing', 'Quality', 'Sales'],
    );
  });

  // Beklenen değer ELLE yazılı tablodan (kuralın kendisinden türetilmez): K3'ün üç rolü okur, gerisi hiçbir şey yapamaz.
  const BEKLENEN: Record<AppRole, Record<DbOp, boolean>> = {
    Admin:      { read: true,  write: false, delete: false },
    Manager:    { read: true,  write: false, delete: false },
    Sales:      { read: true,  write: false, delete: false },
    Logistics:  { read: false, write: false, delete: false },
    Accounting: { read: false, write: false, delete: false },
    HR:         { read: false, write: false, delete: false },
    Purchasing: { read: false, write: false, delete: false },
    Legal:      { read: false, write: false, delete: false },
    Corporate:  { read: false, write: false, delete: false },
    Quality:    { read: false, write: false, delete: false },
    B2B:        { read: false, write: false, delete: false },
    Dealer:     { read: false, write: false, delete: false },
  };
  for (const rol of APP_ROLES) {
    for (const islem of ISLEMLER) {
      it(`${rol} × ${islem} → ${BEKLENEN[rol][islem] ? 'izinli' : 'kapalı'}`, () => {
        expect(isAllowed(rol, KOLEKSIYON, islem)).toBe(BEKLENEN[rol][islem]);
      });
    }
  }

  it('rolsüz (null) kullanıcı okuyamaz, yazamaz, silemez', () => {
    for (const islem of ISLEMLER) expect(isAllowed(null, KOLEKSIYON, islem), islem).toBe(false);
  });

  it('okuyabilenler TAM OLARAK K3\'ün üç rolü', () => {
    expect(APP_ROLES.filter(r => isAllowed(r, KOLEKSIYON, 'read')).sort()).toEqual([...GORENLER].sort());
  });

  it('yazabilen / silebilen HİÇBİR rol yok — Yönetici kısa yolu ve Müdür silmesi dâhil', () => {
    expect(APP_ROLES.filter(r => isAllowed(r, KOLEKSIYON, 'write'))).toEqual([]);
    expect(APP_ROLES.filter(r => isAllowed(r, KOLEKSIYON, 'delete'))).toEqual([]);
  });
});

describe('SUNUCU_YAZAR_COLLECTIONS — sınıf değişmezleri', () => {
  const sinif = [...SUNUCU_YAZAR_COLLECTIONS];

  it('her üyesi için: okuma dışındaki işlem her role kapalı, Yönetici okur', () => {
    for (const c of sinif) {
      for (const rol of APP_ROLES) {
        expect(isAllowed(rol, c, 'write'), `${rol} ${c} yazabiliyor`).toBe(false);
        expect(isAllowed(rol, c, 'delete'), `${rol} ${c} silebiliyor`).toBe(false);
      }
      expect(isAllowed('Admin', c, 'read'), `Yönetici ${c} okuyamıyor`).toBe(true);
    }
  });

  it('sınıf Yönetici kısa yolunu YALNIZ kendi üyelerinde keser (başka koleksiyonda Yönetici yazar / siler)', () => {
    for (const c of ['orders', 'users', 'settings', 'leads']) {
      expect(isAllowed('Admin', c, 'write'), c).toBe(true);
      expect(isAllowed('Admin', c, 'delete'), c).toBe(true);
    }
    expect(isAllowed('Manager', 'orders', 'delete')).toBe(true);
  });

  it('her üyesi kiracıya izole ve AÇIK okuma kuralı var (kuralsız üye zero-trust yedeğiyle bütün personele okunurdu)', () => {
    for (const c of sinif) {
      expect(TENANT_COLLECTIONS, `${c} TENANT değil`).toContain(c);
      expect(hasExplicitRule(c), `${c} için COLLECTION_PERMISSIONS kuralı yok`).toBe(true);
    }
  });

  it('başka hiçbir sınıfla kesişmez (kesişim kuralı sessizce değiştirirdi)', () => {
    for (const c of sinif) {
      // PUBLIC_WRITE `isAllowed`'ın İLK satırında kimliksiz yazmayı açar — kesişirse sunucu-yazar kapısı hiç çalışmaz.
      expect(PUBLIC_WRITE_COLLECTIONS.has(c), `${c} PUBLIC_WRITE`).toBe(false);
      // SERVER_ONLY okumaya da kapalıdır (/api/db + akış) — kesişirse ekran hiç veri göremez.
      expect(SERVER_ONLY_COLLECTIONS, `${c} SERVER_ONLY`).not.toContain(c);
      // USER_SCOPED / APPEND_ONLY / ADMIN_ONLY okuma kuralını COLLECTION_PERMISSIONS'tan ÖNCE verir ya da başka süzgeç uygular.
      expect(USER_SCOPED_COLLECTIONS, `${c} USER_SCOPED`).not.toContain(c);
      expect(APPEND_ONLY_COLLECTIONS.has(c), `${c} APPEND_ONLY`).toBe(false);
      expect(ADMIN_ONLY_COLLECTIONS.has(c), `${c} ADMIN_ONLY`).toBe(false);
    }
  });
});

// ── Bağlantı çiti: /api/db yazma yolları ve akış `isAllowed`'a uğruyor ───────────────────────────────────────────────
// Ölçüm 2026-10-08 (server.ts): POST / PUT / PATCH / DELETE / increment / cas — altısı da `denied()` → `canAccessCollection`
// → `isAllowed(rol, coll, op)`; toplu yazım ucu YOK (istemcinin `writeBatch` / `runTransaction`'ı aynı tekil uçları sırayla
// çağırır — lib/dbClient.ts). Akış abonelik listesini `canAccessCollection(…, 'read')` ile süzer.
//
// Denetimler METİN alan saf işlevlerdir: çitin kendisi, server.ts'e DOKUNMADAN bellekte bozulmuş kopyalarla sınanır
// (en alttaki «çit kendi mutantlarını yakalar» bölümü) — yeşil kalan bir çitin gerçekten bir şey ölçtüğünün kanıtı.
const YAZMA_YOLLARI = [
  'post /api/db/:coll',
  'put /api/db/:coll/:id',
  'patch /api/db/:coll/:id',
  'delete /api/db/:coll/:id',
  'patch /api/db/:coll/:id/increment',
  'patch /api/db/:coll/:id/cas',
];
const OKUMA_YOLLARI = ['get /api/db/:coll', 'get /api/db/:coll/:id'];

/** /api/db ↔ `isAllowed` bağlantısının İHLALLERİ; boş dizi = bağlantı sağlam. */
function apiDbIhlalleri(sunucuMetni: string): string[] {
  const satirlar = yorumsuz(sunucuMetni).map(kod => kod.trimEnd());
  const ROTA = /^\s*app\.(get|post|put|patch|delete)\('(\/api\/db\/:coll[^']*)'/;
  const HERHANGI_ROTA = /^\s*app\.(get|post|put|patch|delete|use|all)\(/;
  /** Rota satırından bir SONRAKİ `app.<yöntem>(` satırına kadarki gövde. */
  const govde = (bas: number): string[] => {
    const son = satirlar.findIndex((k, i) => i > bas && HERHANGI_ROTA.test(k));
    return satirlar.slice(bas + 1, son === -1 ? bas + 120 : son);
  };
  const rotalar = satirlar.flatMap((k, i) => { const e = ROTA.exec(k); return e ? [{ i, yontem: e[1], yol: e[2] }] : []; });
  const say = (desen: RegExp): number => satirlar.filter(k => desen.test(k)).length;
  const ihlal: string[] = [];

  // 1. Yol listesi: yeni bir yazma / okuma yolu eklenince bu liste BİLİNÇLİ güncellenir.
  const yazma = rotalar.filter(r => r.yontem !== 'get');
  const okuma = rotalar.filter(r => r.yontem === 'get');
  if (yazma.map(r => `${r.yontem} ${r.yol}`).join(' | ') !== YAZMA_YOLLARI.join(' | ')) ihlal.push(`yazma yolları değişti: ${yazma.map(r => `${r.yontem} ${r.yol}`).join(' | ')}`);
  if (okuma.map(r => `${r.yontem} ${r.yol}`).join(' | ') !== OKUMA_YOLLARI.join(' | ')) ihlal.push(`okuma yolları değişti: ${okuma.map(r => `${r.yontem} ${r.yol}`).join(' | ')}`);

  // 2. Her yazma yolu `denied()` kapısından OKUMA DIŞI işlemle geçer — ve ilk veritabanı sorgusundan ÖNCE.
  for (const r of yazma) {
    const ad = `${r.yontem} ${r.yol}`;
    const g = govde(r.i);
    // Silme yolu 'delete' ile, diğerleri 'write' ile sorar; hiçbiri 'read' ile sormaz.
    const beklenenIslem = r.yontem === 'delete' ? 'delete' : 'write';
    const kapi = g.findIndex(k => new RegExp(`if \\(await denied\\(req, res, coll, '${beklenenIslem}'(, id)?\\)\\) return;`).test(k));
    if (kapi === -1) ihlal.push(`${ad}: denied(…, '${beklenenIslem}') kapısı yok`);
    if (g.some(k => /denied\(req, res, coll, 'read'/.test(k))) ihlal.push(`${ad}: yazma yolu 'read' ile soruyor`);
    const sorgu = g.findIndex(k => /docsDb\.query\(/.test(k));
    if (sorgu === -1) ihlal.push(`${ad}: gövdede sorgu bulunamadı (çit gövdeyi yanlış kesmiş olabilir)`);
    else if (kapi !== -1 && kapi > sorgu) ihlal.push(`${ad}: yetki kapısı sorgudan SONRA`);
  }

  // 3. Okuma yolları da aynı kapıdan `read` ile geçer.
  for (const r of okuma) {
    if (!govde(r.i).some(k => /if \(await denied\(req, res, coll, 'read'(, id)?\)\) return;/.test(k))) ihlal.push(`get ${r.yol}: denied(…, 'read') kapısı yok`);
  }

  // 4. `denied()` kararı `isAllowed`'dan alır (araya rol listesi / Yönetici baypası girmemiş).
  if (say(/^\s*if \(await canAccessCollection\(uid, coll, op\)\) return false;$/) !== 1) ihlal.push('denied(): `canAccessCollection(uid, coll, op)` satırı tam 1 kez değil');
  if (say(/^\s*return isAllowed\(await getUserRole\(uid\), coll, op\);$/) !== 1) ihlal.push('canAccessCollection: kararı `isAllowed(rol, coll, op)` vermiyor');
  const kapiBas = satirlar.findIndex(k => /^\s*const denied = async \($/.test(k));
  if (kapiBas === -1) ihlal.push('denied() tanımı bulunamadı');
  else {
    const kapiSon = satirlar.findIndex((k, i) => i > kapiBas && /^\s*};$/.test(k));
    if (/isSuperAdmin|=== 'Admin'|ADMIN_ROLES/.test(satirlar.slice(kapiBas, kapiSon + 1).join('\n'))) ihlal.push('denied(): Yönetici / süper-yönetici baypası var');
  }

  // 5. Akış: yetkisiz rolün istediği koleksiyon abonelik listesinden DÜŞER (init de değişiklik olayı da gitmez).
  const AKIS: Array<[string, RegExp]> = [
    ['istenen koleksiyonlar `canAccessCollection(…, \'read\')` ile denetlenmiyor', /^\s*const collChecks = await Promise\.all\(requestedColls\.map\(c => canAccessCollection\(streamUid!, c, 'read'\)\)\);$/],
    ['abonelik listesi denetim sonucuyla süzülmüyor', /^\s*const colls = requestedColls\.filter\(\(_, i\) => collChecks\[i\]\);$/],
    // init listesi süzülmüş `colls`'tan türer; değişiklik olayı da ona bakar.
    ['init listesi süzülmüş `colls`\'tan türemiyor (hepsi dalı)', /^\s*\? colls$/],
    ['init listesi süzülmüş `colls`\'tan türemiyor (artımlı dal)', /^\s*: colls\.filter\(c => String\(req\.query\.init\)\.split\(','\)\.includes\(c\)\);$/],
    ['değişiklik olayı abonelik listesine bakmıyor', /^\s*if \(!colls\.includes\(ev\.coll\)\) return;$/],
    // İkinci kapı (derinlemesine savunma): satır görünürlüğü de rolün okuma yetkisine bakar.
    ['satır görünürlüğü rolün okuma yetkisine bakmıyor', /^\s*if \(!isAllowed\(streamRole, coll, 'read'\)\) return false;/],
  ];
  for (const [ad, desen] of AKIS) if (say(desen) !== 1) ihlal.push(`akış: ${ad}`);

  return ihlal;
}

describe('/api/db → isAllowed bağlantısı (server.ts kaynak çiti)', () => {
  const sunucu = oku(join(SRC_KOK, '..', 'server.ts'));

  it('server.ts okunuyor (çit boş metne bakmasın)', () => {
    expect(sunucu.length).toBeGreaterThan(100_000);
  });

  it('altı yazma yolu + iki okuma yolu `denied()` → `isAllowed` kapısından doğru işlemle geçer; akış yetkisiz koleksiyonu düşürür', () => {
    expect(apiDbIhlalleri(sunucu)).toEqual([]);
  });

  // server.ts'e DOKUNULMAZ: bozulma BELLEKTEKİ kopyada yapılır. Her mutant gerçekten uygulanmış olmalı (metin değişti) ve
  // çit onu ADIYLA yakalamalı — yakalamıyorsa yukarıdaki «ihlal yok» sonucu bir şey kanıtlamıyordur.
  describe('çit kendi mutantlarını yakalar', () => {
    const KAPI = (islem: string, kimlik: boolean) => `if (await denied(req, res, coll, '${islem}'${kimlik ? ', id' : ''})) return;`;
    /** `parca`nın `kacinci` (0 tabanlı) geçişini `yeni` ile değiştirir; o geçiş yoksa metni AYNEN döndürür (test «uygulanmadı» diye kırılır). */
    const degistir = (metin: string, parca: string, yeni: string, kacinci = 0): string => {
      let i = -1;
      for (let n = 0; n <= kacinci; n++) { i = metin.indexOf(parca, i + 1); if (i === -1) return metin; }
      return metin.slice(0, i) + yeni + metin.slice(i + parca.length);
    };
    const MUTANTLAR: Array<[string, (m: string) => string, RegExp]> = [
      ['POST kapısı silindi', m => degistir(m, KAPI('write', false), ''), /post \/api\/db\/:coll: denied\(…, 'write'\) kapısı yok/],
      ['PUT kapısı silindi', m => degistir(m, KAPI('write', true), '', 0), /put \/api\/db\/:coll\/:id: denied\(…, 'write'\) kapısı yok/],
      ["PATCH kapısı 'read' ile soruyor", m => degistir(m, KAPI('write', true), KAPI('read', true), 1), /patch \/api\/db\/:coll\/:id: (denied\(…, 'write'\) kapısı yok|yazma yolu 'read' ile soruyor)/],
      ['DELETE kapısı silindi', m => degistir(m, KAPI('delete', false), ''), /delete \/api\/db\/:coll\/:id: denied\(…, 'delete'\) kapısı yok/],
      ["DELETE kapısı 'write' ile soruyor (Yönetici olmayan yazar rol silebilirdi)", m => degistir(m, KAPI('delete', false), KAPI('write', false)), /delete \/api\/db\/:coll\/:id: denied\(…, 'delete'\) kapısı yok/],
      ['increment kapısı silindi', m => degistir(m, KAPI('write', true), '', 2), /patch \/api\/db\/:coll\/:id\/increment: denied\(…, 'write'\) kapısı yok/],
      ['cas kapısı silindi', m => degistir(m, KAPI('write', true), '', 3), /patch \/api\/db\/:coll\/:id\/cas: denied\(…, 'write'\) kapısı yok/],
      ['POST kapısı sorgudan SONRAYA taşındı',
        m => degistir(degistir(m, `      ${KAPI('write', false)}\n`, ''), '        const id = genDocId();\n', `        const id = genDocId();\n        await docsDb.query('SELECT 1');\n        ${KAPI('write', false)}\n`),
        /post \/api\/db\/:coll: yetki kapısı sorgudan SONRA/],
      ['kapısız yeni yazma yolu (toplu yazım) eklendi',
        m => degistir(m, "    app.delete('/api/db/:coll/:id',", "    app.post('/api/db/:coll/toplu', dbLimiter, requireAuth, dbJson, async (req: Request, res: Response) => { await docsDb.query('SELECT 1'); res.json({}); });\n    app.delete('/api/db/:coll/:id',"),
        /yazma yolları değişti/],
      ['GET (liste) kapısı silindi', m => degistir(m, KAPI('read', false), ''), /get \/api\/db\/:coll: denied\(…, 'read'\) kapısı yok/],
      ['denied() süper-yönetici baypası', m => degistir(m, 'if (await canAccessCollection(uid, coll, op)) return false;', 'if (isSuperAdmin(req) || await canAccessCollection(uid, coll, op)) return false;'), /denied\(\)/],
      ['canAccessCollection isAllowed\'a sormuyor', m => degistir(m, 'return isAllowed(await getUserRole(uid), coll, op);', 'return (await getUserRole(uid)) !== null;'), /canAccessCollection: kararı `isAllowed\(rol, coll, op\)` vermiyor/],
      ['akış: abonelik listesi süzülmüyor', m => degistir(m, 'const colls = requestedColls.filter((_, i) => collChecks[i]);', 'const colls = requestedColls;'), /akış: abonelik listesi denetim sonucuyla süzülmüyor/],
      ["akış: koleksiyonlar 'write' ile denetleniyor", m => degistir(m, "canAccessCollection(streamUid!, c, 'read')", "canAccessCollection(streamUid!, c, 'write')"), /akış: istenen koleksiyonlar/],
      ['akış: değişiklik olayı abonelik listesine bakmıyor', m => degistir(m, 'if (!colls.includes(ev.coll)) return;', ''), /akış: değişiklik olayı abonelik listesine bakmıyor/],
      ['akış: satır görünürlüğü role bakmıyor', m => degistir(m, "if (!isAllowed(streamRole, coll, 'read')) return false;", ''), /akış: satır görünürlüğü rolün okuma yetkisine bakmıyor/],
    ];
    for (const [ad, boz, beklenen] of MUTANTLAR) {
      it(ad, () => {
        const mutant = boz(sunucu);
        expect(mutant, 'mutasyon uygulanamadı — aranan parça server.ts\'te yok').not.toBe(sunucu);
        expect(apiDbIhlalleri(mutant).join('\n')).toMatch(beklenen);
      });
    }
  });
});

// ── Kural tablosu (derinlemesine savunma) ───────────────────────────────────────────────────────────────────────────
describe('rbac.ts — magazaTalepleri kuralının kendisi', () => {
  // Yorumlar süzülür; yorumdan kalan boş satırlar da atılır (aradaki açıklama satırları sırayı gizlemesin).
  const kaynak = yorumsuz(oku(join(SRC_KOK, 'lib', 'rbac.ts'))).map(k => k.trimEnd()).filter(k => k !== '').join('\n');

  it('kural tablosunda yazma listesi BOŞ: sınıf kapısı bir gün kalksa bile kural kimseye yazma vermez', () => {
    // Davranış testi bunu GÖREMEZ (kapı yazmayı kural tablosuna bakmadan kapatır) — o yüzden kaynakta kilitli.
    expect(kaynak).toContain("magazaTalepleri: { read: ['Admin', 'Manager', 'Sales'], write: [] },");
    expect(kaynak.split('magazaTalepleri:').length - 1).toBe(1);
  });

  it('sınıf kapısı `if (!role) return false;` satırından hemen SONRA, Yönetici kısa yolundan ÖNCE', () => {
    expect(kaynak).toContain("\n  if (!role) return false;\n  if (SUNUCU_YAZAR_COLLECTIONS.has(coll) && op !== 'read') return false;\n  if (role === 'Admin') return true;\n");
    expect(kaynak.split('SUNUCU_YAZAR_COLLECTIONS.has(').length - 1).toBe(1);   // kapı TEK yerde
  });

  it('koleksiyon kiracı listesinin İLK elemanı değil (tenantErisim testi ilk elemanı örnek alır)', () => {
    expect(TENANT_COLLECTIONS[0]).not.toBe(KOLEKSIYON);
    expect(TENANT_COLLECTIONS.filter(c => c === KOLEKSIYON)).toHaveLength(1);
  });
});
