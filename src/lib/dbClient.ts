/**
 * dbClient.ts — Firestore-compatible client over our own Express + PostgreSQL.
 *
 * Drop-in replacement for the 'firebase/firestore' client API surface this app
 * uses: collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
 * onSnapshot, query, where, orderBy, limit, serverTimestamp, Timestamp,
 * writeBatch, runTransaction.
 *
 * Realtime: a single multiplexed SSE connection to /api/db/stream carries every
 * subscribed collection (one connection total — avoids the 6-connection
 * HTTP/1.1 limit). The set of collections changes → debounced reconnect.
 *
 * Timestamps are stored as {_seconds,_nanoseconds} JSON (same shape the
 * firebase-admin backup script produces) and revived into Timestamp instances
 * with .toDate()/.toMillis() on read.
 *
 * Not supported (unused in this codebase): increment, arrayUnion/Remove,
 * deleteField, collectionGroup, startAfter, getCountFromServer.
 * runTransaction/writeBatch are emulated as sequential writes (NOT atomic).
 */
import { auth } from '../firebase';
import { PUBLIC_WRITE_COLLECTIONS } from './rbac';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Loose document payload — interfaces without index signatures must be accepted, like Firestore does. */
type DocData = Record<string, any>;

// ── Timestamp ───────────────────────────────────────────────────────────────

export class Timestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  toDate(): Date { return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6)); }
  toMillis(): number { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  isEqual(other: Timestamp): boolean { return this.seconds === other.seconds && this.nanoseconds === other.nanoseconds; }
  toJSON(): { _seconds: number; _nanoseconds: number } { return { _seconds: this.seconds, _nanoseconds: this.nanoseconds }; }
  static now(): Timestamp { const ms = Date.now(); return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromDate(d: Date): Timestamp { const ms = d.getTime(); return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromMillis(ms: number): Timestamp { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
}

/** Revive {_seconds,_nanoseconds} (admin SDK) or {seconds,nanoseconds} (client SDK) into Timestamp. */
function reviveTimestamps(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reviveTimestamps);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 2 && typeof o._seconds === 'number' && typeof o._nanoseconds === 'number') {
      return new Timestamp(o._seconds as number, o._nanoseconds as number);
    }
    if (keys.length === 2 && typeof o.seconds === 'number' && typeof o.nanoseconds === 'number') {
      return new Timestamp(o.seconds as number, o.nanoseconds as number);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = reviveTimestamps(val);
    return out;
  }
  return v;
}

// ── Sentinels ───────────────────────────────────────────────────────────────

export function serverTimestamp(): unknown { return { __op: 'serverTimestamp' }; }

// ── Refs & queries ──────────────────────────────────────────────────────────

export interface CollectionReference { type: 'collection'; path: string; id: string }
export interface DocumentReference { type: 'doc'; coll: string; id: string; path: string }
interface QueryConstraintWhere { kind: 'where'; field: string; op: string; value: unknown }
interface QueryConstraintOrderBy { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' }
interface QueryConstraintLimit { kind: 'limit'; n: number }
export type QueryConstraint = QueryConstraintWhere | QueryConstraintOrderBy | QueryConstraintLimit;
export interface Query { type: 'query'; coll: string; constraints: QueryConstraint[] }

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function genId(): string {
  let s = '';
  const a = new Uint8Array(20);
  crypto.getRandomValues(a);
  for (let i = 0; i < 20; i++) s += ID_CHARS[a[i] % ID_CHARS.length];
  return s;
}

export function collection(_db: unknown, path: string): CollectionReference {
  return { type: 'collection', path, id: path };
}

export function doc(dbOrColl: unknown, pathOrId?: string, id?: string): DocumentReference {
  const asColl = dbOrColl as CollectionReference;
  if (asColl && asColl.type === 'collection') {
    const docId = pathOrId ?? genId();
    return { type: 'doc', coll: asColl.path, id: docId, path: `${asColl.path}/${docId}` };
  }
  // doc(db, 'coll', 'id') or doc(db, 'coll/id')
  if (id !== undefined) return { type: 'doc', coll: pathOrId as string, id, path: `${pathOrId}/${id}` };
  const parts = (pathOrId as string).split('/');
  const docId = parts.length > 1 ? parts.pop() as string : genId();
  const coll = parts.join('/');
  return { type: 'doc', coll, id: docId, path: `${coll}/${docId}` };
}

export function query(target: CollectionReference | Query, ...constraints: QueryConstraint[]): Query {
  if ((target as Query).type === 'query') {
    const q = target as Query;
    return { type: 'query', coll: q.coll, constraints: [...q.constraints, ...constraints] };
  }
  return { type: 'query', coll: (target as CollectionReference).path, constraints };
}

export function where(field: string, op: string, value: unknown): QueryConstraintWhere {
  return { kind: 'where', field, op, value };
}
export function orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): QueryConstraintOrderBy {
  return { kind: 'orderBy', field, dir };
}
export function limit(n: number): QueryConstraintLimit { return { kind: 'limit', n }; }

// ── Snapshots ───────────────────────────────────────────────────────────────

export interface DocumentSnapshot {
  id: string;
  ref: DocumentReference;
  exists: () => boolean;
  data: () => DocData | undefined;
}
export interface QueryDocumentSnapshot extends DocumentSnapshot {
  data: () => DocData;
}
export interface QuerySnapshot {
  docs: QueryDocumentSnapshot[];
  size: number;
  empty: boolean;
  forEach: (cb: (d: QueryDocumentSnapshot) => void) => void;
}

function makeDocSnap(coll: string, id: string, data: DocData | undefined): DocumentSnapshot {
  return {
    id,
    ref: { type: 'doc', coll, id, path: `${coll}/${id}` },
    exists: () => data !== undefined,
    data: () => data,
  };
}

function fieldValue(data: Record<string, unknown>, field: string): unknown {
  if (!field.includes('.')) return data[field];
  let v: unknown = data;
  for (const part of field.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

function cmpValues(a: unknown, b: unknown): number {
  const norm = (x: unknown): number | string => {
    if (x instanceof Timestamp) return x.toMillis();
    if (x instanceof Date) return x.getTime();
    if (typeof x === 'number') return x;
    if (typeof x === 'boolean') return x ? 1 : 0;
    return String(x ?? '');
  };
  const na = norm(a), nb = norm(b);
  if (typeof na === 'number' && typeof nb === 'number') return na - nb;
  return String(na) < String(nb) ? -1 : String(na) > String(nb) ? 1 : 0;
}

function applyConstraints(
  docs: Array<{ id: string; data: Record<string, unknown> }>,
  constraints: QueryConstraint[],
): Array<{ id: string; data: Record<string, unknown> }> {
  let out = docs;
  for (const c of constraints) {
    if (c.kind === 'where') {
      out = out.filter(d => {
        const v = fieldValue(d.data, c.field);
        switch (c.op) {
          case '==': return v === c.value || cmpValues(v, c.value) === 0 && typeof v === typeof c.value;
          case '!=': return v !== c.value;
          case '<': return cmpValues(v, c.value) < 0;
          case '<=': return cmpValues(v, c.value) <= 0;
          case '>': return cmpValues(v, c.value) > 0;
          case '>=': return cmpValues(v, c.value) >= 0;
          case 'in': return Array.isArray(c.value) && (c.value as unknown[]).includes(v);
          case 'not-in': return Array.isArray(c.value) && !(c.value as unknown[]).includes(v);
          case 'array-contains': return Array.isArray(v) && (v as unknown[]).includes(c.value);
          case 'array-contains-any': return Array.isArray(v) && Array.isArray(c.value) && (v as unknown[]).some(x => (c.value as unknown[]).includes(x));
          default: return true;
        }
      });
    }
  }
  for (const c of constraints) {
    if (c.kind === 'orderBy') {
      out = [...out].sort((a, b) => {
        const r = cmpValues(fieldValue(a.data, c.field), fieldValue(b.data, c.field));
        return c.dir === 'desc' ? -r : r;
      });
    }
  }
  for (const c of constraints) {
    if (c.kind === 'limit') out = out.slice(0, c.n);
  }
  return out;
}

function makeQuerySnap(coll: string, docs: Array<{ id: string; data: Record<string, unknown> }>): QuerySnapshot {
  const snaps = docs.map(d => makeDocSnap(coll, d.id, d.data) as QueryDocumentSnapshot);
  return { docs: snaps, size: snaps.length, empty: snaps.length === 0, forEach: cb => snaps.forEach(cb) };
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

// IIS/WebDAV: öndeki reverse-proxy PUT/PATCH/DELETE fiillerini uygulamaya
// ulaşmadan 403 ile kesiyor (POST/GET geçiyor). Bu metotları POST +
// X-HTTP-Method-Override başlığıyla tünelliyoruz; sunucu (server.ts erken
// middleware) gerçek metoda geri yazıyor. GET/POST olduğu gibi geçer.
function methodTunnel(method: string): { method: string; header?: Record<string, string> } {
  if (method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    return { method: 'POST', header: { 'X-HTTP-Method-Override': method } };
  }
  return { method };
}

async function getToken(): Promise<string> {
  let u = auth.currentUser;
  if (!u) {
    u = await new Promise(resolve => {
      const off = auth.onAuthStateChanged(usr => { off(); resolve(usr); });
    });
  }
  if (!u) throw new Error('dbClient: not authenticated');
  return u.getIdToken();
}

/** Kimlik doğrulamalı genel fetch — /api/* uç noktaları için (Bearer token ekler). */
export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken();
  return fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
}

/** Atomik sayısal artırma — stok hareketlerinde yarış koşulunu önler.
 *  data[field] = max(min ?? -∞, (data[field] ?? 0) + delta), tek SQL UPDATE. */
export async function incrementField(
  coll: string, id: string, field: string, delta: number, min?: number,
): Promise<void> {
  const token = await getToken();
  const res = await fetch(`/api/db/${coll}/${encodeURIComponent(id)}/increment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-HTTP-Method-Override': 'PATCH' },
    body: JSON.stringify({ field, delta, ...(min !== undefined ? { min } : {}) }),
  });
  if (!res.ok) throw new Error(`incrementField ${coll}/${id} → ${res.status}`);
}

/** Atomik compare-and-set — yarış koşulsuz "claim". data[field] === expect ise set
 *  uygulanır. true (claim alındı) / false (başkası aldı) döner. Tek SQL UPDATE. */
export async function compareAndSet(
  coll: string, id: string, field: string, expect: unknown, set: Record<string, unknown>,
): Promise<boolean> {
  const token = await getToken();
  const res = await fetch(`/api/db/${coll}/${encodeURIComponent(id)}/cas`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-HTTP-Method-Override': 'PATCH' },
    body: JSON.stringify({ field, expect, set }),
  });
  if (!res.ok) throw new Error(`compareAndSet ${coll}/${id} → ${res.status}`);
  const json = await res.json().catch(() => ({ claimed: false }));
  return !!(json as { claimed?: boolean }).claimed;
}

async function api(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const isPublicWrite = method === 'POST' && PUBLIC_WRITE_COLLECTIONS.has(decodeURIComponent(path));
  const token = isPublicWrite ? '' : await getToken();
  const t = methodTunnel(method);
  const res = await fetch(`/api/db/${path}`, {
    method: t.method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(t.header || {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`dbClient ${method} /${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

// ── Realtime: single multiplexed SSE connection ─────────────────────────────

type CollListener = () => void;

class StreamManager {
  private cache = new Map<string, Map<string, Record<string, unknown>>>();
  private ready = new Set<string>();
  private listeners = new Map<string, Set<CollListener>>();
  private es: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
  private connectedColls = '';

  getDocs(coll: string): Array<{ id: string; data: Record<string, unknown> }> {
    const m = this.cache.get(coll);
    if (!m) return [];
    return Array.from(m.entries()).map(([id, data]) => ({ id, data }));
  }

  isReady(coll: string): boolean { return this.ready.has(coll); }

  subscribe(coll: string, listener: CollListener): () => void {
    let set = this.listeners.get(coll);
    if (!set) { set = new Set(); this.listeners.set(coll, set); }
    set.add(listener);
    if (this.ready.has(coll)) queueMicrotask(listener);
    this.scheduleReconnect(false);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.listeners.delete(coll);
      // Keep cache; lazily reconnect with the smaller set later.
      this.scheduleReconnect(false);
    };
  }

  /** Reconnect the SSE channel when the subscribed-collection set changed. */
  private scheduleReconnect(force: boolean): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // 400ms debounce: uygulama açılışında ~33 koleksiyon dinleyicisi kademeli
    // kaydoluyor; kısa debounce SSE'yi 2-3 kez açıp kapatıp geçici 503'lere
    // yol açıyordu. Daha uzun debounce ilk patlamayı TEK bağlantıda toplar.
    this.reconnectTimer = setTimeout(() => void this.connect(force), 400);
  }

  private sessionReady = false;

  /** SSE öncesi httpOnly oturum çerezini kur — token URL'de taşınmaz (#8). */
  private async ensureSession(): Promise<boolean> {
    if (this.sessionReady) return true;
    try {
      const token = await getToken();
      const res = await fetch('/api/db/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
        credentials: 'same-origin',
      });
      this.sessionReady = res.ok;
      return res.ok;
    } catch { return false; }
  }

  private async connect(force: boolean): Promise<void> {
    const colls = Array.from(this.listeners.keys()).sort().join(',');
    if (!colls) { this.es?.close(); this.es = null; this.connectedColls = ''; return; }
    if (!force && colls === this.connectedColls && this.es && this.es.readyState !== EventSource.CLOSED) return;
    // Önce oturum çerezini kur; başarısızsa eski token-query yoluna düş.
    const haveSession = await this.ensureSession();
    this.es?.close();
    this.connectedColls = colls;
    let url = `/api/db/stream?colls=${encodeURIComponent(colls)}`;
    if (!haveSession) {
      let token: string;
      try { token = await getToken(); } catch { this.retryLater(); return; }
      url += `&token=${encodeURIComponent(token)}`;
    }
    const es = new EventSource(url, { withCredentials: true });
    this.es = es;
    es.addEventListener('init', ev => {
      this.retryDelay = 1000;
      const { coll, docs } = JSON.parse((ev as MessageEvent).data) as { coll: string; docs: Array<{ id: string; data: unknown }> };
      const m = new Map<string, Record<string, unknown>>();
      for (const d of docs) m.set(d.id, reviveTimestamps(d.data) as Record<string, unknown>);
      this.cache.set(coll, m);
      this.ready.add(coll);
      this.notify(coll);
    });
    es.addEventListener('change', ev => {
      const { coll, type, id, data } = JSON.parse((ev as MessageEvent).data) as { coll: string; type: string; id: string; data?: unknown };
      let m = this.cache.get(coll);
      if (!m) { m = new Map(); this.cache.set(coll, m); }
      if (type === 'delete') m.delete(id);
      else m.set(id, reviveTimestamps(data) as Record<string, unknown>);
      this.notify(coll);
    });
    es.onerror = () => {
      es.close();
      // Oturum çerezi süresi dolmuş olabilir — yeniden bağlanmadan önce tazele.
      this.sessionReady = false;
      if (this.es === es) { this.es = null; this.connectedColls = ''; this.retryLater(); }
    };
  }

  private retryLater(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connect(true), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30000);
  }

  /** Apply a local write immediately so UI updates without waiting for SSE. */
  applyLocal(coll: string, type: 'set' | 'merge' | 'delete', id: string, data?: Record<string, unknown>): void {
    const m = this.cache.get(coll);
    if (!m) return; // nobody is listening to this collection
    if (type === 'delete') m.delete(id);
    else if (type === 'merge') m.set(id, { ...(m.get(id) ?? {}), ...(reviveTimestamps(data) as Record<string, unknown>) });
    else m.set(id, reviveTimestamps(data) as Record<string, unknown>);
    this.notify(coll);
  }

  private notify(coll: string): void {
    this.listeners.get(coll)?.forEach(l => { try { l(); } catch (e) { console.error('[dbClient listener]', e); } });
  }

  /** Logout/kullanıcı değişiminde belleği temizle — önceki kiracının verisi kalmasın. */
  reset(): void {
    try { this.es?.close(); } catch { /* ignore */ }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.es = null;
    this.connectedColls = '';
    this.sessionReady = false;
    this.cache.clear();
    this.ready.clear();
    // Dinleyicileri uyandır ki boş cache'i yansıtsınlar.
    for (const coll of this.listeners.keys()) this.notify(coll);
  }
}

const stream = new StreamManager();

/** Oturum kapanışında SSE bağlantısını kapatır ve önbelleği temizler. */
export function resetStream(): void { stream.reset(); }

// ── Public read/subscribe API ───────────────────────────────────────────────

type Unsubscribe = () => void;

export function onSnapshot(target: CollectionReference | Query, next: (snap: QuerySnapshot) => void, error?: (e: Error) => void): Unsubscribe;
export function onSnapshot(target: DocumentReference, next: (snap: DocumentSnapshot) => void, error?: (e: Error) => void): Unsubscribe;
export function onSnapshot(
  target: CollectionReference | Query | DocumentReference,
  next: ((snap: DocumentSnapshot) => void) | ((snap: QuerySnapshot) => void),
  error?: (e: Error) => void,
): Unsubscribe {
  try {
    if ((target as DocumentReference).type === 'doc') {
      const ref = target as DocumentReference;
      return stream.subscribe(ref.coll, () => {
        const found = stream.getDocs(ref.coll).find(d => d.id === ref.id);
        (next as (s: DocumentSnapshot) => void)(makeDocSnap(ref.coll, ref.id, found?.data));
      });
    }
    const coll = (target as Query).type === 'query' ? (target as Query).coll : (target as CollectionReference).path;
    const constraints = (target as Query).type === 'query' ? (target as Query).constraints : [];
    return stream.subscribe(coll, () => {
      const docs = applyConstraints(stream.getDocs(coll), constraints);
      (next as (s: QuerySnapshot) => void)(makeQuerySnap(coll, docs));
    });
  } catch (e) {
    error?.(e as Error);
    return () => {};
  }
}

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  try {
    const res = await api('GET', `${encodeURIComponent(ref.coll)}/${encodeURIComponent(ref.id)}`);
    return makeDocSnap(ref.coll, ref.id, reviveTimestamps(res.data) as Record<string, unknown>);
  } catch (e) {
    if (String(e).includes('404')) return makeDocSnap(ref.coll, ref.id, undefined);
    throw e;
  }
}

export async function getDocs(target: CollectionReference | Query): Promise<QuerySnapshot> {
  const coll = (target as Query).type === 'query' ? (target as Query).coll : (target as CollectionReference).path;
  const constraints = (target as Query).type === 'query' ? (target as Query).constraints : [];
  const res = await api('GET', encodeURIComponent(coll));
  const docs = ((res.docs as Array<{ id: string; data: unknown }>) ?? [])
    .map(d => ({ id: d.id, data: reviveTimestamps(d.data) as Record<string, unknown> }));
  return makeQuerySnap(coll, applyConstraints(docs, constraints));
}

// ── Public write API ────────────────────────────────────────────────────────

export async function addDoc(coll: CollectionReference, data: DocData): Promise<DocumentReference> {
  const res = await api('POST', encodeURIComponent(coll.path), data);
  const id = res.id as string;
  stream.applyLocal(coll.path, 'set', id, (res.data as Record<string, unknown>) ?? data);
  return { type: 'doc', coll: coll.path, id, path: `${coll.path}/${id}` };
}

export async function setDoc(ref: DocumentReference, data: DocData, opts?: { merge?: boolean }): Promise<void> {
  stream.applyLocal(ref.coll, opts?.merge ? 'merge' : 'set', ref.id, data);
  const res = await api('PUT', `${encodeURIComponent(ref.coll)}/${encodeURIComponent(ref.id)}?merge=${opts?.merge ? '1' : '0'}`, data);
  stream.applyLocal(ref.coll, opts?.merge ? 'merge' : 'set', ref.id, (res.data as Record<string, unknown>) ?? data);
}

export async function updateDoc(ref: DocumentReference, data: DocData): Promise<void> {
  // Optimistic: UI sunucu yanıtını beklemeden güncellenir (toggle'lar anında
  // tepki verir); yanıt gelince sunucunun birleştirdiği nihai veri yazılır.
  stream.applyLocal(ref.coll, 'merge', ref.id, data);
  const res = await api('PATCH', `${encodeURIComponent(ref.coll)}/${encodeURIComponent(ref.id)}`, data);
  stream.applyLocal(ref.coll, 'set', ref.id, (res.data as Record<string, unknown>) ?? data);
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  await api('DELETE', `${encodeURIComponent(ref.coll)}/${encodeURIComponent(ref.id)}`);
  stream.applyLocal(ref.coll, 'delete', ref.id);
}

// ── Batch & transaction (emulated, sequential — NOT atomic) ─────────────────

interface BatchOp { kind: 'set' | 'update' | 'delete'; ref: DocumentReference; data?: DocData; opts?: { merge?: boolean } }

export function writeBatch(_db: unknown): {
  set: (ref: DocumentReference, data: DocData, opts?: { merge?: boolean }) => void;
  update: (ref: DocumentReference, data: DocData) => void;
  delete: (ref: DocumentReference) => void;
  commit: () => Promise<void>;
} {
  const ops: BatchOp[] = [];
  return {
    set: (ref, data, opts) => ops.push({ kind: 'set', ref, data, opts }),
    update: (ref, data) => ops.push({ kind: 'update', ref, data }),
    delete: ref => ops.push({ kind: 'delete', ref }),
    commit: async () => {
      for (const op of ops) {
        if (op.kind === 'set') await setDoc(op.ref, op.data as DocData, op.opts);
        else if (op.kind === 'update') await updateDoc(op.ref, op.data as DocData);
        else await deleteDoc(op.ref);
      }
    },
  };
}

export async function runTransaction<T>(
  _db: unknown,
  fn: (tx: {
    get: (ref: DocumentReference) => Promise<DocumentSnapshot>;
    set: (ref: DocumentReference, data: DocData, opts?: { merge?: boolean }) => void;
    update: (ref: DocumentReference, data: DocData) => void;
    delete: (ref: DocumentReference) => void;
  }) => Promise<T>,
): Promise<T> {
  const ops: BatchOp[] = [];
  const tx = {
    get: (ref: DocumentReference) => getDoc(ref),
    set: (ref: DocumentReference, data: DocData, opts?: { merge?: boolean }) => { ops.push({ kind: 'set', ref, data, opts }); },
    update: (ref: DocumentReference, data: DocData) => { ops.push({ kind: 'update', ref, data }); },
    delete: (ref: DocumentReference) => { ops.push({ kind: 'delete', ref }); },
  };
  const result = await fn(tx);
  for (const op of ops) {
    if (op.kind === 'set') await setDoc(op.ref, op.data as DocData, op.opts);
    else if (op.kind === 'update') await updateDoc(op.ref, op.data as DocData);
    else await deleteDoc(op.ref);
  }
  return result;
}
