import { useState } from 'react';
import { Globe, ImageOff, Monitor, Smartphone } from 'lucide-react';
import type { Audit, AuditSection, Client, ShopifyDataSnapshot, WebPageSnapshot, WebPageType, WebViewport } from '../../lib/types';
import { WEB_SECTION_TITLES } from '../../lib/audit-sections';
import ImageLightbox from '../ui/ImageLightbox';

export interface WebAuditReportViewData {
  audit: Audit;
  client: Client;
  sections: AuditSection[];
  pageSnapshots: WebPageSnapshot[];
  shopifySnapshots: ShopifyDataSnapshot[];
}

const PAGE_LABELS: Record<WebPageType, string> = {
  homepage: 'Homepage',
  product: 'Product Page',
  collection: 'Collection Page',
  cart: 'Cart',
};

const PAGE_ORDER: WebPageType[] = ['homepage', 'product', 'collection', 'cart'];

function formatMoney(amount: unknown, currency: unknown): string | null {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const cur = typeof currency === 'string' && currency ? currency : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }
}

function ScreenshotTile({ snapshot }: { snapshot: WebPageSnapshot | undefined }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (!snapshot) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-xs text-gray-400">
        Not captured
      </div>
    );
  }
  if (snapshot.status === 'pending') {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-xs text-gray-400">
        Capture in progress…
      </div>
    );
  }
  if (snapshot.status === 'error' || !snapshot.screenshot_url) {
    return (
      <div className="flex aspect-[16/10] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-amber-200 bg-amber-50/50 px-3 text-center">
        <ImageOff className="h-4 w-4 text-amber-500" />
        <p className="text-xs font-medium text-amber-700">Capture failed</p>
        {snapshot.error_message && (
          <p className="text-[10px] text-amber-600 line-clamp-2">{snapshot.error_message}</p>
        )}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="block w-full overflow-hidden rounded-lg border border-gray-200 bg-white transition-shadow hover:shadow-md"
      >
        <img
          src={snapshot.screenshot_url}
          alt={`${PAGE_LABELS[snapshot.page_type]} (${snapshot.viewport})`}
          className="aspect-[16/10] w-full object-cover object-top"
          loading="lazy"
        />
      </button>
      {lightboxOpen && (
        <ImageLightbox
          src={snapshot.screenshot_url}
          alt={`${PAGE_LABELS[snapshot.page_type]} (${snapshot.viewport})`}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

export default function WebAuditReportView({ data }: { data: WebAuditReportViewData }) {
  const { audit, client, sections, pageSnapshots, shopifySnapshots } = data;
  const [viewport, setViewport] = useState<WebViewport>('desktop');

  const byPage = new Map<WebPageType, Partial<Record<WebViewport, WebPageSnapshot>>>();
  for (const snap of pageSnapshots) {
    const entry = byPage.get(snap.page_type) ?? {};
    entry[snap.viewport] = snap;
    byPage.set(snap.page_type, entry);
  }
  const capturedPages = PAGE_ORDER.filter(p => byPage.has(p));

  const ordersRollup = shopifySnapshots.find(s => s.snapshot_kind === 'orders_rollup')?.computed as
    | { order_count?: number; gross_revenue?: number; aov?: number; currency?: string; timeframe_days?: number }
    | undefined;
  const shopInfo = shopifySnapshots.find(s => s.snapshot_kind === 'shop')?.computed as
    | { name?: string; plan?: string; domain?: string }
    | undefined;

  const orderedSections = [...sections].sort((a, b) => {
    const keys = Object.keys(WEB_SECTION_TITLES);
    return keys.indexOf(a.section_key) - keys.indexOf(b.section_key);
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-10">
      {/* Header */}
      <div className="rounded-2xl gradient-bg px-8 py-10 text-white">
        <div className="flex items-center gap-2 text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">
          <Globe className="h-4 w-4" />
          Web Audit
        </div>
        <h1 className="text-2xl font-bold sm:text-3xl">{client.company_name}</h1>
        {client.website_url && (
          <a
            href={client.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-sm text-white/80 hover:text-white hover:underline"
          >
            {client.website_url}
          </a>
        )}
      </div>

      {/* Shopify metrics */}
      {(ordersRollup || shopInfo) && (
        <div className="rounded-xl bg-white p-6 card-shadow">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">
            Store Metrics
            {ordersRollup?.timeframe_days ? (
              <span className="ml-2 text-xs font-normal text-gray-400">last {ordersRollup.timeframe_days} days</span>
            ) : null}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">Orders</p>
              <p className="text-lg font-semibold text-gray-900">
                {ordersRollup?.order_count != null ? Number(ordersRollup.order_count).toLocaleString('en-US') : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Revenue</p>
              <p className="text-lg font-semibold text-gray-900">
                {formatMoney(ordersRollup?.gross_revenue, ordersRollup?.currency) ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">AOV</p>
              <p className="text-lg font-semibold text-gray-900">
                {formatMoney(ordersRollup?.aov, ordersRollup?.currency) ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Plan</p>
              <p className="text-lg font-semibold text-gray-900">{shopInfo?.plan ?? '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Screenshots */}
      {capturedPages.length > 0 && (
        <div className="rounded-xl bg-white p-6 card-shadow space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900">Page Screenshots</h2>
            <div className="flex items-center rounded-lg border border-gray-200 p-0.5">
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewport === 'desktop' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewport === 'mobile' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
                Mobile
              </button>
            </div>
          </div>
          <div className={viewport === 'mobile' ? 'grid grid-cols-2 gap-4 sm:grid-cols-4' : 'grid grid-cols-1 gap-4 sm:grid-cols-2'}>
            {capturedPages.map(pageType => (
              <div key={pageType} className="space-y-1.5">
                <p className="text-xs font-medium text-gray-600">{PAGE_LABELS[pageType]}</p>
                <ScreenshotTile snapshot={byPage.get(pageType)?.[viewport]} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sections (placeholder cards until the web report design lands) */}
      <div className="space-y-4">
        {orderedSections.map(section => (
          <div key={section.id} className="rounded-xl bg-white p-6 card-shadow">
            <h3 className="text-sm font-semibold text-gray-900">
              {WEB_SECTION_TITLES[section.section_key] ?? section.section_key}
            </h3>
            {section.summary_text?.trim() ? (
              <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">{section.summary_text}</p>
            ) : (
              <p className="mt-2 text-sm text-gray-400 italic">
                Findings for this section will be added in a later phase.
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] text-gray-400">
        {audit.title} · Created {new Date(audit.created_at).toLocaleDateString()}
      </p>
    </div>
  );
}
