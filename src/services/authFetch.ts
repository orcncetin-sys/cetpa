/**
 * authFetch.ts — drop-in fetch replacement that attaches the Firebase ID token.
 *
 * Use for every /api/* call that hits a requireAuth server route.
 * Falls back to a plain fetch when no user is signed in (server returns 401).
 */

import { getAuth } from 'firebase/auth';

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  let token: string | null = null;
  try {
    token = (await getAuth().currentUser?.getIdToken()) ?? null;
  } catch {
    token = null;
  }

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // ── GOVDESIZ POST/PUT/PATCH'e BOS GOVDE EKLE (2026-08-18) ──────────────────
  //
  // Uretimde uygulama IIS arkasinda duruyor ve IIS, govdesi olmayan bir
  // POST'u (yani Content-Length basligi bulunmayan istegi) Node'a HIC
  // iletmeden `411 Length Required` ile reddediyor. Istemci tarafinda bu,
  // dugmenin sessizce olmesi olarak goruluyor: yanit bir IIS HTML hata
  // sayfasi oldugu icin `res.json()` patliyor ve hata catch'e dusuyor.
  //
  // Canlida olculdu (2026-08-18):
  //   POST /api/mikro/import/stok-miktar  govdesiz -> 411 (IIS)
  //   ayni uc                             govdeli  -> 401 (Node'a ulasti)
  //   /api/mikro/pull/personel, /api/inventory/auto-reorder,
  //   /api/sku-mapping/auto-match, /api/luca/sync/stok -> ayni sonuc
  //
  // Duzeltme burada, cagri noktalarinda DEGIL: boylece ileride yazilacak
  // govdesiz POST'lar da ayni tuzaga dusmez. FormData/Blob gonderen cagrilar
  // etkilenmez (body zaten dolu).
  const method = (init.method ?? 'GET').toUpperCase();
  let body = init.body;
  if (body == null && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    body = '{}';
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }

  return fetch(input, { ...init, headers, body });
}
