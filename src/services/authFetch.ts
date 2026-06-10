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

  return fetch(input, { ...init, headers });
}
