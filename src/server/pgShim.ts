/**
 * pgShim.ts - Firestore-sekilli PostgreSQL shim'i (veri katmani cekirdegi).
 *
 * server.ts'ten AYRILDI (2026-08-24) - D4 teknik borcunun 5. parcasi.
 *
 * NE YAPAR: server.ts'in 170+ `adminDb` cagri yerinin kod seklini KORUYARAK
 * arkadaki depoyu Firestore'dan PostgreSQL'e cevirir. Yazmalar SSE ile
 * yayinlanir, boylece bagli tarayicilar istemci kaynakli yazmalarda oldugu
 * gibi canli guncellenir.
 *
 * NEDEN AYRI: bu, uygulamanin EN MERKEZI soyutlamasi. server.ts icinde
 * dururken rota tanimlariyla ayni dosyada oldugu icin "veri katmani nerede
 * bitiyor, is mantigi nerede basliyor" siniri gorunmuyordu.
 *
 * `adminDb`'nin KENDISI server.ts'te KALDI (`new PgFirestore(pgPool)`
 * atamasi): 170+ cagri yeri oraya bagli ve tasimak bu adimi gereksiz yere
 * buyutup riskli hale getirirdi. Bu modul sinifi saglar, server.ts ornekler.
 */
import { EventEmitter } from 'events';
import pg from 'pg';
import { FieldValue } from 'firebase-admin/firestore';

export interface PgShimDeps {
  /** `pgServerTimestamp` PG modunda mi Firestore modunda mi oldugunu bilmeli. */
  getPgPool: () => pg.Pool | null;
}

let D: PgShimDeps;

function deps(): PgShimDeps {
  if (!D) throw new Error('pgShim: initPgShim() cagrilmadan kullanilamaz.');
  return D;
}

/**
 * INIT YERI: MODUL DUZEYI (bkz. CLAUDE.md "Modul init'i nereye konur").
 * `pgServerTimestamp` ve `new PgFirestore(...)` server.ts'te modul yuklenirken
 * kosuyor - init startServer'a konursa `deps()` korumasina carpar.
 */
export function initPgShim(d: PgShimDeps): void { D = d; }

function pgNowTimestamp(): { _seconds: number; _nanoseconds: number } {
  const ms = Date.now();
  return { _seconds: Math.floor(ms / 1000), _nanoseconds: (ms % 1000) * 1e6 };
}


/** Replace {__op:'serverTimestamp'} sentinels (deep) with a concrete timestamp. */
export function resolveSentinels(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(resolveSentinels);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.__op === 'serverTimestamp') return pgNowTimestamp();
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = resolveSentinels(val);
    return out;
  }
  return v;
}

/** Shallow merge with Firestore-style dot-path keys ('a.b.c': v sets data.a.b.c). */
export function mergeDocData(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes('.')) { out[key] = value; continue; }
    const parts = key.split('.');
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      const next = cursor[p];
      cursor[p] = (next && typeof next === 'object' && !Array.isArray(next)) ? { ...(next as Record<string, unknown>) } : {};
      cursor = cursor[p] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return out;
}

const DOC_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const dbEvents = new EventEmitter();
dbEvents.setMaxListeners(0);

export function genDocId(): string {
  let s = '';
  for (let i = 0; i < 20; i++) s += DOC_ID_CHARS[Math.floor(Math.random() * DOC_ID_CHARS.length)];
  return s;
}

export function broadcastDocChange(coll: string, type: 'set' | 'delete', id: string, data?: unknown): void {
  // Kiracı/kullanıcı filtreleme için companyId + userId'yi olaya iliştir.
  const d = (data ?? {}) as Record<string, unknown>;
  dbEvents.emit('change', {
    coll, type, id,
    cid: d.companyId as string | undefined,
    uid: d.userId as string | undefined,
    ...(data !== undefined ? { data } : {}),
  });
}

export type PgDocData = Record<string, any>;

/** SSE init'te koleksiyon başına gönderilecek azami satır. Emniyet supabı:
 *  tek bir koleksiyonun büyümesi tarayıcıyı kilitlemesin. Çarpıldığında SESSİZCE
 *  kırpılmaz — sunucuda uyarı loglanır ve init eventine `truncated`+`total`
 *  eklenir, böylece eksik veri "tam veri" gibi görünmez. */
export const STREAM_INIT_MAX_ROWS = Number(process.env.STREAM_INIT_MAX_ROWS || 20000);


/** Kodun çağırdığı ama Mikro Jump V17'de BULUNMAYAN metotlar.
 *
 *  Kaynak: apidocs.mikro.com.tr/MikroAPI.postman_collection_V17.json — 215 istek,
 *  161 tekil metot. Kodda çağrılan metotlar bu listeyle karşılaştırıldı (2026-07-30).
 *  V17'nin liste yüzeyi çok dar: yalnız Stok/Cari listesi + SqlVeriOkuV2. Kalan
 *  veriler (fatura, sipariş, stok hareketi, mizan, KDV) SqlVeriOkuV2 ile ilgili
 *  tablodan SELECT edilerek çekilmeli.
 *
 *  Bunlar sessizce başarısız olduğunda ne oluyordu: yanıt gelmiyor, çağıran kod
 *  `Number(md?.alan ?? 0)` ile devam ediyor ve SIFIR yazıyor. Cari bakiyeleri ve
 *  taxSummary/accountingPeriods tam olarak böyle sıfırlanıyordu.
 *
 *  BU LİSTEYE EKLENMEDİ (Mikro desteği 2026-06-11'de VAR olduklarını teyit etti,
 *  koleksiyonda görünmüyorlar): GelenFaturalarKabulV2, GelenFaturalarRedV2.
 */

/** Drop-in for admin.firestore.FieldValue.serverTimestamp() — resolved by resolveSentinels. */
export function pgServerTimestamp(): any {
  return deps().getPgPool() ? { __op: 'serverTimestamp' } : FieldValue.serverTimestamp();
}

export class PgTimestampValue {
  constructor(public _seconds: number, public _nanoseconds: number) {}
  get seconds(): number { return this._seconds; }
  get nanoseconds(): number { return this._nanoseconds; }
  toDate(): Date { return new Date(this._seconds * 1000 + Math.floor(this._nanoseconds / 1e6)); }
  toMillis(): number { return this._seconds * 1000 + Math.floor(this._nanoseconds / 1e6); }
}

/** Revive stored {_seconds,_nanoseconds} JSON into objects with toDate()/toMillis(). */
export function pgReviveTimestamps(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(pgReviveTimestamps);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 2 && typeof o._seconds === 'number' && typeof o._nanoseconds === 'number') {
      return new PgTimestampValue(o._seconds as number, o._nanoseconds as number);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = pgReviveTimestamps(val);
    return out;
  }
  return v;
}

export interface PgWhereFilter { field: string; op: string; value: unknown }

export function pgFieldValueOf(data: PgDocData, field: string): unknown {
  if (!field.includes('.')) return data[field];
  let v: unknown = data;
  for (const part of field.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as PgDocData)[part];
  }
  return v;
}

export function pgCmp(a: unknown, b: unknown): number {
  const norm = (x: unknown): number | string => {
    if (x instanceof PgTimestampValue) return x.toMillis();
    if (x && typeof x === 'object' && typeof (x as PgDocData)._seconds === 'number') {
      return (x as PgDocData)._seconds * 1000;
    }
    if (typeof x === 'number') return x;
    if (typeof x === 'boolean') return x ? 1 : 0;
    return String(x ?? '');
  };
  const na = norm(a), nb = norm(b);
  if (typeof na === 'number' && typeof nb === 'number') return na - nb;
  return String(na) < String(nb) ? -1 : String(na) > String(nb) ? 1 : 0;
}

export class PgDocSnapshot {
  constructor(public id: string, private _data: PgDocData | undefined, public ref: PgDocRef) {}
  get exists(): boolean { return this._data !== undefined; }
  data(): PgDocData | undefined { return this._data; }
}

export class PgDocRef {
  constructor(private pool: pg.Pool, public coll: string, public id: string) {}
  get path(): string { return `${this.coll}/${this.id}`; }
  async get(): Promise<PgDocSnapshot> {
    const { rows } = await this.pool.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [this.coll, this.id]);
    const data = rows.length ? pgReviveTimestamps(rows[0].data) as PgDocData : undefined;
    return new PgDocSnapshot(this.id, data, this);
  }
  async set(data: PgDocData, opts?: { merge?: boolean }): Promise<void> {
    const incoming = resolveSentinels(data) as PgDocData;
    let final = incoming;
    if (opts?.merge) {
      const { rows } = await this.pool.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [this.coll, this.id]);
      final = mergeDocData((rows[0]?.data as PgDocData) ?? {}, incoming);
    }
    await this.pool.query(
      `INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [this.coll, this.id, JSON.stringify(final)],
    );
    broadcastDocChange(this.coll, 'set', this.id, final);
  }
  async update(data: PgDocData): Promise<void> {
    const patch = resolveSentinels(data) as PgDocData;
    const { rows } = await this.pool.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [this.coll, this.id]);
    const final = mergeDocData((rows[0]?.data as PgDocData) ?? {}, patch);
    await this.pool.query(
      `INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [this.coll, this.id, JSON.stringify(final)],
    );
    broadcastDocChange(this.coll, 'set', this.id, final);
  }
  async delete(): Promise<void> {
    await this.pool.query('DELETE FROM docs WHERE coll = $1 AND id = $2', [this.coll, this.id]);
    broadcastDocChange(this.coll, 'delete', this.id);
  }
}

export class PgQueryBuilder {
  constructor(
    protected pool: pg.Pool,
    public collName: string,
    protected filters: PgWhereFilter[] = [],
    protected orderField: { field: string; dir: 'asc' | 'desc' } | null = null,
    protected limitN: number | null = null,
  ) {}
  where(field: string, op: string, value: unknown): PgQueryBuilder {
    return new PgQueryBuilder(this.pool, this.collName, [...this.filters, { field, op, value }], this.orderField, this.limitN);
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): PgQueryBuilder {
    return new PgQueryBuilder(this.pool, this.collName, this.filters, { field, dir }, this.limitN);
  }
  limit(n: number): PgQueryBuilder {
    return new PgQueryBuilder(this.pool, this.collName, this.filters, this.orderField, n);
  }
  /** Aggregate count — note: ignores where() filters (no call site uses filters with count). */
  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return {
      get: async () => {
        const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM docs WHERE coll = $1', [this.collName]);
        return { data: () => ({ count: rows[0].n as number }) };
      },
    };
  }
  async get(): Promise<{ docs: PgDocSnapshot[]; empty: boolean; size: number; forEach: (cb: (d: PgDocSnapshot) => void) => void }> {
    const { rows } = await this.pool.query('SELECT id, data FROM docs WHERE coll = $1', [this.collName]);
    let items = rows.map((r: { id: string; data: unknown }) => ({ id: r.id, data: pgReviveTimestamps(r.data) as PgDocData }));
    for (const f of this.filters) {
      items = items.filter((it: { id: string; data: PgDocData }) => {
        const v = pgFieldValueOf(it.data, f.field);
        switch (f.op) {
          case '==': return v === f.value;
          case '!=': return v !== f.value;
          case '<': return pgCmp(v, f.value) < 0;
          case '<=': return pgCmp(v, f.value) <= 0;
          case '>': return pgCmp(v, f.value) > 0;
          case '>=': return pgCmp(v, f.value) >= 0;
          case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
          case 'array-contains': return Array.isArray(v) && (v as unknown[]).includes(f.value);
          default: return true;
        }
      });
    }
    if (this.orderField) {
      const { field, dir } = this.orderField;
      items = [...items].sort((a: { data: PgDocData }, b: { data: PgDocData }) => {
        const r = pgCmp(pgFieldValueOf(a.data, field), pgFieldValueOf(b.data, field));
        return dir === 'desc' ? -r : r;
      });
    }
    if (this.limitN != null) items = items.slice(0, this.limitN);
    const docs = items.map((it: { id: string; data: PgDocData }) => new PgDocSnapshot(it.id, it.data, new PgDocRef(this.pool, this.collName, it.id)));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (cb: (d: PgDocSnapshot) => void) => docs.forEach(cb) };
  }
}

export class PgCollectionRef extends PgQueryBuilder {
  doc(id?: string): PgDocRef { return new PgDocRef(this.pool, this.collName, id ?? genDocId()); }
  async add(data: PgDocData): Promise<PgDocRef> {
    const id = genDocId();
    const final = resolveSentinels(data) as PgDocData;
    await this.pool.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)', [this.collName, id, JSON.stringify(final)]);
    broadcastDocChange(this.collName, 'set', id, final);
    return new PgDocRef(this.pool, this.collName, id);
  }
}

interface PgBatchOp { kind: 'set' | 'update' | 'delete'; ref: PgDocRef; data?: PgDocData; opts?: { merge?: boolean } }

export class PgFirestore {
  constructor(private pool: pg.Pool) {}
  collection(name: string): PgCollectionRef { return new PgCollectionRef(this.pool, name); }
  /** Sequential, not atomic — acceptable for this app's sync flows. */
  batch(): { set: (ref: PgDocRef, data: PgDocData, opts?: { merge?: boolean }) => void; update: (ref: PgDocRef, data: PgDocData) => void; delete: (ref: PgDocRef) => void; commit: () => Promise<void> } {
    const ops: PgBatchOp[] = [];
    return {
      set: (ref, data, opts) => { ops.push({ kind: 'set', ref, data, opts }); },
      update: (ref, data) => { ops.push({ kind: 'update', ref, data }); },
      delete: (ref) => { ops.push({ kind: 'delete', ref }); },
      commit: async () => {
        for (const op of ops) {
          if (op.kind === 'set') await op.ref.set(op.data as PgDocData, op.opts);
          else if (op.kind === 'update') await op.ref.update(op.data as PgDocData);
          else await op.ref.delete();
        }
      },
    };
  }
  settings(_opts: unknown): void { /* no-op — kept for call-site compatibility */ }
}

