export type KlaviyoFetchDiag = { ok?: boolean; status?: number | null; error?: string | null };

/** True when Klaviyo rejected the call for auth/scope reasons (not bad request, rate limit, etc.). */
export function isKlaviyoScopeFailure(diag: KlaviyoFetchDiag | undefined): boolean {
  if (!diag || diag.ok !== false) return false;
  const status = diag.status ?? null;
  return status === 401 || status === 403;
}

export function klaviyoFetchStatusLabel(diag: KlaviyoFetchDiag | undefined): string {
  if (!diag || diag.ok !== false) return '';
  return isKlaviyoScopeFailure(diag) ? 'No access' : 'Fetch failed';
}

/** Scope keys from klaviyo_connections.scopes where the failure looks like missing API permissions. */
export function klaviyoScopePermissionWarnings(scopes: Record<string, unknown> | null | undefined): string[] {
  if (!scopes) return [];
  return Object.entries(scopes)
    .filter(([, value]) => {
      if (value === true) return false;
      if (value && typeof value === 'object' && 'ok' in value) {
        return isKlaviyoScopeFailure(value as KlaviyoFetchDiag);
      }
      return value !== true;
    })
    .map(([key]) => key);
}
