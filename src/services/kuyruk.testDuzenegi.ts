/**
 * kuyruk.testDuzenegi.ts — yeniden deneme kuyruğu testlerinin SAHTE SUNUCUSU: `lib/dbClient` ve `firebase` yerine geçer.
 *
 * NEDEN BÖYLE: `/api/db` rotaları `server.ts`'te `startServer` kapanışının içindedir — içe aktarılamaz, ham SQL koşar
 * (K10-5). Gerçek express + gerçek `/api/db` zinciri testi bugün YAZILAMIYOR. Bu sahte, o rotaların `syncJobs` için
 * verdiği KARARLARI, rotaların çağırdığı AYNI saf işlevlerle verir (lib/tenantErisim + lib/rbac — sahte kural yazılmaz):
 *   liste            → okuma kapısı (`isAllowed`) + `kiraciWhere`'in JS karşılığı (`akisSatiriGorunur`);
 *   PUT / PATCH      → yazma kapısı + başkasının kaydına 403 (`dokumanSahibiMi`) + damga (`kiraciDamgala`, önceki belgeyle);
 *   DELETE           → silme kapısı + başkasının kaydına 403;
 *   koşullu yazma    → yazma kapısı + yoksa 404 + başkasının kaydına `sahipsizDurumKodu` + damga + METİN karşılaştırma
 *                      (sunucu `data->>alan = $5` ile karşılaştırır).
 * Sunucudaki BAĞLANTININ kendisi (rota satırı o işlevi çağırıyor mu) kaynak çitindedir: server/satirSuzgeci.degismez.test.ts.
 *
 * İstek atan kimlik `sunucu.oturum`dur (sunucunun jetondan okuduğu); yürütücüye verilen `kimlik` İSTEMCİNİN beyanıdır —
 * testler ikisini bilerek ayırabilir (`suzgecsizListe`: sunucu süzgeci düşse de istemci süzgeci tutuyor mu).
 */
import { isAllowed, type AppRole } from '../lib/rbac';
import { akisSatiriGorunur, dokumanSahibiMi, kiraciDamgala, sahipsizDurumKodu, type KiraciKimligi } from '../lib/tenantErisim';
import { KUYRUK_KOLEKSIYONU } from '../lib/kuyrukSahipligi';

type Belge = Record<string, unknown>;
type Kisit = { kind: 'where'; field: string; op: string; value: unknown } | { kind: 'limit'; n: number };
interface Hedef { ad: string; k?: Kisit[] }
interface Ref { ad: string; id: string }

/** Testlerin kiracısı. */
export const KIRACI = 'A';

export const sunucu = {
  /** `syncJobs` belgeleri: kimlik → gövde. Testler eski (damgasız) belgeyi buraya doğrudan koyar. */
  depo: new Map<string, Belge>(),
  /** İsteği atan kullanıcı (jeton). `uid: null` = oturum yok. */
  oturum: { uid: null as string | null, rol: null as AppRole | null },
  /** true: liste sunucu süzgecinden GEÇMEZ — en kötü durum; istemci süzgeci tek başına sınanır. */
  suzgecsizListe: false,
  /** Sunucuya ulaşan her istek, sırayla (`GET syncJobs`, `PUT syncJobs/x`, `CAS syncJobs/x` …) — reddedilenler dâhil. */
  istekler: [] as string[],
  /** Başarılı koşullu yazmalar (belge kimliği) — yürütücünün sahiplenmeleri ve Yönetici'nin kapatmaları. */
  kosulluYazma: [] as string[],
  oturumAc(uid: string | null, rol: AppRole | null): void { sunucu.oturum = { uid, rol }; },
  sifirla(): void {
    sunucu.depo.clear();
    sunucu.oturum = { uid: null, rol: null };
    sunucu.suzgecsizListe = false;
    sunucu.istekler.length = 0;
    sunucu.kosulluYazma.length = 0;
  },
};

const kimlik = (): KiraciKimligi => ({
  uid: sunucu.oturum.uid ?? '', cid: async () => KIRACI, superAdmin: false, rol: async () => sunucu.oturum.rol,
});

/** Rotanın ilk iki kapısı: kimlik (401) ve rol (403 — `denied`). İstek, reddedilse de kayda geçer. */
function kapi(coll: string, islem: 'read' | 'write' | 'delete', istek: string): void {
  if (coll !== KUYRUK_KOLEKSIYONU) throw new Error(`sahte sunucu yalnız ${KUYRUK_KOLEKSIYONU} bilir: ${coll}`);
  sunucu.istekler.push(istek);
  if (!sunucu.oturum.uid) throw new Error(`dbClient ${istek} → 401 {"error":"Kimlik doğrulanamadı."}`);
  if (!isAllowed(sunucu.oturum.rol, coll, islem)) throw new Error(`dbClient ${istek} → 403 {"error":"Bu veri için yetkiniz yok."}`);
}

/** PUT (tam değiştirme / `merge`) ve PATCH (birleştirme) ortak gövdesi — server.ts sırası: sahiplik → birleştirme → damga. */
async function yaz(ref: Ref, veri: Belge, birlestir: boolean, yontem: 'PUT' | 'PATCH'): Promise<void> {
  kapi(ref.ad, 'write', `${yontem} ${ref.ad}/${ref.id}`);
  const onceki = sunucu.depo.get(ref.id);
  if (onceki && !(await dokumanSahibiMi(ref.ad, onceki, kimlik(), ref.id))) {
    throw new Error(`dbClient ${yontem} /${ref.ad}/${ref.id} → 403 {"error":"Bu kayıt başka bir firmaya ait."}`);
  }
  const govde = birlestir ? { ...onceki, ...veri } : { ...veri };
  sunucu.depo.set(ref.id, await kiraciDamgala(ref.ad, govde, kimlik(), onceki ?? {}));
}

export const dbClientSahtesi = {
  collection: (_db: unknown, ad: string): Hedef => ({ ad }),
  doc: (c: Hedef, id: string): Ref => ({ ad: c.ad, id }),
  query: (c: Hedef, ...k: Kisit[]): Hedef => ({ ad: c.ad, k: [...(c.k ?? []), ...k] }),
  where: (field: string, op: string, value: unknown): Kisit => ({ kind: 'where', field, op, value }),
  limit: (n: number): Kisit => ({ kind: 'limit', n }),

  setDoc: (ref: Ref, veri: Belge, secenek?: { merge?: boolean }): Promise<void> => yaz(ref, veri, secenek?.merge === true, 'PUT'),
  updateDoc: (ref: Ref, yama: Belge): Promise<void> => yaz(ref, yama, true, 'PATCH'),

  deleteDoc: async (ref: Ref): Promise<void> => {
    kapi(ref.ad, 'delete', `DELETE ${ref.ad}/${ref.id}`);
    const onceki = sunucu.depo.get(ref.id);
    if (onceki && !(await dokumanSahibiMi(ref.ad, onceki, kimlik(), ref.id))) {
      throw new Error(`dbClient DELETE /${ref.ad}/${ref.id} → 403 {"error":"Bu kayıt başka bir firmaya ait."}`);
    }
    sunucu.depo.delete(ref.id);
  },

  // Kısıtlar gerçek istemcideki (`dbClient.applyConstraints`) SIRAYLA uygulanır: önce `where`, sonra `limit` = `slice`.
  getDocs: async (hedef: Hedef) => {
    kapi(hedef.ad, 'read', `GET ${hedef.ad}`);
    const goren = { uid: sunucu.oturum.uid ?? '', cid: KIRACI, rol: sunucu.oturum.rol };
    let satirlar = [...sunucu.depo.entries()].filter(([id, j]) => sunucu.suzgecsizListe || akisSatiriGorunur(hedef.ad, id, j, goren));
    for (const c of hedef.k ?? []) {
      if (c.kind !== 'where') continue;
      if (c.op !== '==' && c.op !== '<=') throw new Error(`sahte getDocs: tanınmayan işleç ${c.op}`);
      satirlar = satirlar.filter(([, j]) => (c.op === '==' ? j[c.field] === c.value : (j[c.field] as number) <= (c.value as number)));
    }
    for (const c of hedef.k ?? []) if (c.kind === 'limit') satirlar = satirlar.slice(0, c.n);
    const docs = satirlar.map(([id, j]) => ({ id, ref: { ad: hedef.ad, id }, data: () => ({ ...j }) }));
    return { empty: docs.length === 0, docs, size: docs.length };
  },

  compareAndSet: async (coll: string, id: string, alan: string, beklenen: unknown, yama: Belge): Promise<boolean> => {
    kapi(coll, 'write', `CAS ${coll}/${id}`);
    const j = sunucu.depo.get(id);
    if (!j) throw new Error(`compareAndSet ${coll}/${id} → 404`);
    if (!(await dokumanSahibiMi(coll, j, kimlik(), id))) throw new Error(`compareAndSet ${coll}/${id} → ${sahipsizDurumKodu(coll, sunucu.oturum.rol)}`);
    const damgali = await kiraciDamgala(coll, { ...yama }, kimlik(), j);
    // Sunucuda karşılaştırma + yazma TEK `UPDATE … WHERE data->>alan = $5`'tir (atomik): koşul YAZMA anındaki belgeye bakar —
    // yukarıdaki okumadan sonra başka bir istek belgeyi değiştirdiyse tutmaz. Burada da güncel belge yeniden okunur ve
    // karşılaştırma ile yazma arasında `await` yoktur.
    const guncel = sunucu.depo.get(id);
    if (!guncel || String(guncel[alan]) !== String(beklenen)) return false;
    sunucu.depo.set(id, { ...guncel, ...damgali });
    sunucu.kosulluYazma.push(id);
    return true;
  },
};

/** `../firebase` yerine: `auth.currentUser` sunucu oturumunu izler (istemcinin jetonu = sunucunun gördüğü kullanıcı). */
export const firebaseSahtesi = {
  db: {},
  auth: { get currentUser(): { uid: string } | null { return sunucu.oturum.uid ? { uid: sunucu.oturum.uid } : null; } },
};
