import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Info, Loader2, RefreshCw, Store } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import HoverTooltip from '../ui/HoverTooltip';
import BrandedCheckbox from '../ui/BrandedCheckbox';

/**
 * Store access for a web audit.
 *
 * Checks the connection the moment the step opens, because the answer decides
 * what the audit can contain and finding out after the fact is too late. When
 * there is no connection it offers the two real routes rather than a dead end,
 * and lets the audit go ahead without one on an explicit decision.
 */

const PROMO_APP_URL = 'https://promo.ecdigitalstrategy.com';

/** The redirect Shopify sends the merchant back to. Registered on the app itself,
 *  so it has to be exactly this and it is the same for every client. */
function callbackUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  return `${base}/functions/v1/shopify_oauth_callback`;
}

const REQUIRED_SCOPES = 'read_orders, read_all_orders, read_products, read_customers, read_analytics';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'connected'; shopName: string; shopDomain: string; warnings: string[] }
  /** Reachable through the promo calendar app, but not linked to this client yet. */
  | { status: 'promo_found'; shopName: string }
  | { status: 'none'; message: string };

export type WebStoreAccessProps = {
  /** Empty until the client record exists; connecting creates it first. */
  clientId: string;
  companyName: string;
  websiteUrl: string;
  shopDomain: string;
  onShopDomainChange: (value: string) => void;
  /** Creates or finds the client record, returning its id. */
  ensureClient: () => Promise<string>;
  /** Whether a usable connection exists, so the wizard can gate on it. */
  onConnectedChange: (connected: boolean) => void;
  /** Set when the user decides to run without store data. */
  proceedWithoutStore: boolean;
  onProceedWithoutStoreChange: (value: boolean) => void;
};

export default function WebStoreAccess({
  clientId,
  companyName,
  websiteUrl,
  shopDomain,
  onShopDomainChange,
  ensureClient,
  onConnectedChange,
  proceedWithoutStore,
  onProceedWithoutStoreChange,
}: WebStoreAccessProps) {
  const [check, setCheck] = useState<CheckState>({ status: 'idle' });
  const [mode, setMode] = useState<'none' | 'here'>('none');
  const [appClientId, setAppClientId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [copied, setCopied] = useState(false);
  const [installOutcome, setInstallOutcome] = useState<{ ok: boolean; reason?: string } | null>(null);

  /** Is this store connected in the promo calendar? Returns the shop name if so.
   *  Needs no client record, so it is safe to run on a bare check. */
  const probePromo = useCallback(async (): Promise<string | null> => {
    const domain = shopDomain.trim();
    if (!domain) return null;
    try {
      const { data } = await supabase.functions.invoke<{
        ok?: boolean;
        shop?: { name?: string | null; domain?: string | null } | null;
      }>('shopify_test_connection', {
        body: { shopDomain: domain, useInstalledApp: true, websiteUrl },
      });
      return data?.ok ? (data.shop?.name || data.shop?.domain || domain) : null;
    } catch {
      return null;
    }
  }, [shopDomain, websiteUrl]);

  const runCheck = useCallback(async (id: string) => {
    if (!id) {
      // No client record yet, so nothing can be saved against one. The promo
      // calendar is still worth asking: a prospect may already be connected there
      // from other work, and answering "no store" without checking would send
      // someone off to set up an app they do not need.
      onConnectedChange(false);
      setCheck({ status: 'checking' });
      const promo = await probePromo();
      setCheck(promo
        ? { status: 'promo_found', shopName: promo }
        : { status: 'none', message: 'No store connected for this client yet.' });
      return;
    }
    setCheck({ status: 'checking' });
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        shop?: { name?: string | null; domain?: string | null } | null;
        warnings?: string[];
        error?: { message?: string } | null;
      }>('shopify_test_connection', { body: { auditClientId: id } });

      if (error || !data?.ok) {
        onConnectedChange(false);
        // Before calling it a dead end: is this store already connected in the
        // promo calendar? If so it only needs linking, not setting up.
        const promo = await probePromo();
        if (promo) {
          setCheck({ status: 'promo_found', shopName: promo });
          return;
        }
        setCheck({ status: 'none', message: data?.error?.message || 'No store connected for this client yet.' });
        return;
      }
      setCheck({
        status: 'connected',
        shopName: data.shop?.name || data.shop?.domain || 'the store',
        shopDomain: data.shop?.domain || '',
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      });
      onConnectedChange(true);
    } catch {
      setCheck({ status: 'none', message: 'Could not reach Shopify to check the connection.' });
      onConnectedChange(false);
    }
  }, [onConnectedChange, probePromo]);

  // Check on open, and again whenever the client changes. The ref stops a second
  // run for the same client when the parent re-renders.
  const checkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (checkedFor.current === clientId) return;
    checkedFor.current = clientId;
    void runCheck(clientId);
  }, [clientId, runCheck]);

  // Shopify sends the merchant back here after the consent screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('shopify_install');
    if (!outcome) return;
    setInstallOutcome({ ok: outcome === 'ok', reason: params.get('reason') ?? undefined });
    // Clear it so a refresh does not replay the banner.
    params.delete('shopify_install');
    params.delete('reason');
    params.delete('shop');
    params.delete('shop_name');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    if (outcome === 'ok') {
      checkedFor.current = null; // force a re-check with the new connection
    }
  }, []);

  const [linking, setLinking] = useState(false);

  const linkPromoConnection = async () => {
    setLinking(true);
    setStartError('');
    try {
      const id = clientId || (await ensureClient());
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: { message?: string } | null }>(
        'shopify_connect_client',
        { body: { client_id: id, shop_domain: shopDomain.trim(), use_installed_app: true, website_url: websiteUrl } },
      );
      if (error || !data?.ok) {
        setStartError(data?.error?.message || 'Could not link the promo calendar connection.');
        return;
      }
      checkedFor.current = null;
      await runCheck(id);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Could not link the connection.');
    } finally {
      setLinking(false);
    }
  };

  const startInstall = async () => {
    setStartError('');
    if (!appClientId.trim() || !appSecret.trim()) {
      setStartError('Enter the app Client ID and Client secret from the Dev Dashboard.');
      return;
    }
    if (!shopDomain.trim()) {
      setStartError('Enter the store\'s .myshopify.com domain.');
      return;
    }
    setStarting(true);
    try {
      // The token has to belong to a client record, so make sure one exists
      // before handing control to Shopify. Coming back to nothing to attach the
      // token to would waste the merchant's approval.
      const id = clientId || (await ensureClient());
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        authorize_url?: string;
        error?: { message?: string } | null;
      }>('shopify_oauth_start', {
        body: {
          client_id: id,
          shop_domain: shopDomain.trim(),
          app_client_id: appClientId.trim(),
          app_client_secret: appSecret.trim(),
          return_path: window.location.pathname,
        },
      });
      if (error || !data?.ok || !data.authorize_url) {
        setStartError(data?.error?.message || 'Could not start the install.');
        setStarting(false);
        return;
      }
      // Full navigation, not a popup: Shopify's consent screen refuses to be
      // framed and popup blockers are unhelpful about it.
      window.location.href = data.authorize_url;
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Could not start the install.');
      setStarting(false);
    }
  };

  const copyCallback = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard denied; the field is selectable */ }
  };

  const appName = `${companyName || 'Client Name'} - ECD Web Audit`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Shopify store access</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Powers the performance section: revenue, orders, AOV, repeat rate and best sellers.
          </p>
        </div>
        {check.status !== 'checking' && (
          <button
            type="button"
            onClick={() => runCheck(clientId)}
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand-primary hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Re-check
          </button>
        )}
      </div>

      {installOutcome && (
        <div
          className={
            installOutcome.ok
              ? 'rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800'
              : 'rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700'
          }
        >
          {installOutcome.ok
            ? 'Store connected. The install came back successfully.'
            : `The install did not complete${installOutcome.reason ? ` (${installOutcome.reason.replace(/_/g, ' ')})` : ''}. Nothing was saved, so you can try again.`}
        </div>
      )}

      {check.status === 'checking' && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />
          Checking the store connection…
        </div>
      )}

      {check.status === 'connected' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0 text-sm text-emerald-800">
              <span className="font-medium">Connected to {check.shopName}.</span>{' '}
              The performance section will be included.
            </div>
          </div>
          {check.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <p className="font-semibold">Connected, but some data is out of reach:</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {check.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <p className="mt-2">
                Add the missing scopes to the app and reinstall it on the store to fill these in. The audit runs either way.
              </p>
            </div>
          )}
        </div>
      )}

      {check.status === 'promo_found' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2.5 rounded-lg border border-brand-primary/20 bg-brand-primary/[0.04] px-4 py-3">
            <Store className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" />
            <div className="min-w-0 text-sm text-gray-700">
              <span className="font-medium text-gray-900">{check.shopName} is already connected in the promo calendar.</span>{' '}
              Link it to this client and the audit can read the store.
            </div>
          </div>
          {startError && <p className="text-sm text-red-600">{startError}</p>}
          <button
            type="button"
            onClick={linkPromoConnection}
            disabled={linking}
            className="inline-flex items-center gap-2 rounded-lg gradient-bg px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {linking ? 'Linking…' : 'Use this connection'}
          </button>
        </div>
      )}

      {check.status === 'none' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 text-sm text-amber-800">
              <span className="font-medium">No store connected.</span> Without it the audit still reviews the
              storefront, but the performance section is left out entirely.
            </div>
          </div>

          {/* Two real routes, in the order you would normally take them. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Option 1</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">Connect in the promo calendar</p>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                Best for an existing client. Connect the store there once and every ECD tool can read it, including this
                one. Come back and hit Re-check.
              </p>
              <a
                href={PROMO_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-primary hover:underline"
              >
                Open the promo calendar
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Option 2</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">Connect here</p>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                Best for a prospect you do not want in the promo calendar yet. Installs its own app on their store,
                just for the audit.
              </p>
              <button
                type="button"
                onClick={() => setMode(mode === 'here' ? 'none' : 'here')}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-primary hover:underline"
              >
                {mode === 'here' ? 'Hide the steps' : 'Set it up here'}
              </button>
            </div>
          </div>

          {mode === 'here' && (
            <div className="space-y-4 rounded-xl border border-brand-primary/20 bg-brand-primary/[0.03] p-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Create the app, then install it</p>
                <p className="mt-1 text-xs text-gray-600">
                  Shopify retired pasteable tokens, and the credentials shortcut only works on stores inside our own
                  Shopify organization. For a prospect the app has to be installed on their store, which is what this does.
                </p>
              </div>

              <ol className="list-decimal space-y-3 pl-5 text-sm text-gray-700 marker:font-semibold marker:text-brand-primary">
                <li>
                  In the Shopify <span className="font-medium text-gray-900">Dev Dashboard</span>, create an app named{' '}
                  <span className="font-mono text-xs text-gray-900">{appName}</span>.
                </li>
                <li>
                  Set its Admin API scopes to:
                  <span className="mt-1 block font-mono text-xs text-gray-900">{REQUIRED_SCOPES}</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    Read-only. The audit never writes to a store.
                  </span>
                </li>
                <li>
                  Add this exact redirect URL to the app:
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-700">
                      {callbackUrl()}
                    </code>
                    <button
                      type="button"
                      onClick={copyCallback}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </li>
                <li>Copy the app's Client ID and Client secret from its credentials page, and paste them below.</li>
              </ol>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Store domain</label>
                  <input
                    type="text"
                    value={shopDomain}
                    onChange={e => onShopDomainChange(e.target.value)}
                    placeholder="their-store.myshopify.com"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Client ID</label>
                  <input
                    type="text"
                    value={appClientId}
                    onChange={e => setAppClientId(e.target.value)}
                    placeholder="e.g. 97291692e4cd7addba0f…"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-700">Client secret</label>
                  <input
                    type="password"
                    value={appSecret}
                    onChange={e => setAppSecret(e.target.value)}
                    placeholder="shpss_…"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    Stored encrypted, and only used to complete the install and read the store.
                  </p>
                </div>
              </div>

              {startError && <p className="text-sm text-red-600">{startError}</p>}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={startInstall}
                  disabled={starting}
                  className="inline-flex items-center gap-2 rounded-lg gradient-bg px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
                  {starting ? 'Opening Shopify…' : 'Install on store'}
                </button>
                <p className="text-xs text-gray-500">
                  Takes you to Shopify to approve, then straight back here.
                </p>
              </div>
            </div>
          )}

          {/* The way past, on purpose rather than by accident. */}
          <div className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-4 py-3">
            <label className="flex cursor-pointer items-center gap-2.5">
              <BrandedCheckbox
                checked={proceedWithoutStore}
                onChange={onProceedWithoutStoreChange}
                aria-label="Run the audit without store data"
              />
              <span className="text-sm text-gray-700">Run the audit without store data.</span>
            </label>
            {/* The consequence sits behind an icon rather than a second sentence:
                it matters at the moment of ticking and nowhere else. */}
            <HoverTooltip
              label="What this leaves out"
              description="The storefront review, findings and roadmap all run as normal. The performance section is dropped entirely: no revenue, orders, AOV, repeat rate, best sellers or basket analysis, and no pricing evidence from the store's own numbers."
            >
              <Info className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-colors hover:text-brand-primary" />
            </HoverTooltip>
          </div>
        </div>
      )}

      {websiteUrl.trim() === '' && (
        <p className="text-xs text-gray-400">Enter the website above and the store domain will be guessed for you.</p>
      )}
    </div>
  );
}
