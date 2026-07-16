import { Globe } from 'lucide-react';
import type { Audit, AuditSection, Client, ShopifyDataSnapshot, WebPageSnapshot, WebPageType } from '../../lib/types';
import { type OrdersRollup } from '../../lib/web-report-details';
import { useReportEdit } from './edit/ReportEditContext';
import EditablePlainText from './edit/EditablePlainText';
import WebPageSection from './web/WebPageSection';
import WebAnalyticsSection from './web/WebAnalyticsSection';
import WebRoadmapTable from './web/WebRoadmapTable';

export interface WebAuditReportViewData {
  audit: Audit;
  client: Client;
  sections: AuditSection[];
  pageSnapshots: WebPageSnapshot[];
  shopifySnapshots: ShopifyDataSnapshot[];
}

const PAGE_SECTIONS: Array<{ key: string; title: string; page_type: WebPageType }> = [
  { key: 'web_homepage', title: 'Homepage', page_type: 'homepage' },
  { key: 'web_product_page', title: 'Product Page', page_type: 'product' },
  { key: 'web_collection_page', title: 'Collection Page', page_type: 'collection' },
  { key: 'web_cart', title: 'Cart', page_type: 'cart' },
];

function isHidden(section: AuditSection | undefined): boolean {
  if (!section) return false;
  const cfg = section.section_config as Record<string, unknown> | null | undefined;
  const inner = cfg?.[section.section_key] as Record<string, unknown> | undefined;
  return inner?.hidden === true;
}

/** Intro block for the web_overview section (executive summary only; page-level
 * strengths live on each page's "What works"). */
function OverviewBlock({ section, companyName }: { section: AuditSection; companyName: string }) {
  const { editMode, updateSectionField } = useReportEdit();

  return (
    <section className="rounded-xl bg-white p-6 card-shadow">
      <h2 className="text-lg font-semibold text-gray-900">Overview</h2>
      {(editMode || section.summary_text) && (
        <div className="mt-1.5 text-sm leading-relaxed text-gray-600">
          <EditablePlainText
            value={section.summary_text ?? ''}
            onSave={(v) => updateSectionField(section.section_key, 'summary_text', v)}
            placeholder={`A short summary of ${companyName}'s storefront…`}
          />
        </div>
      )}
    </section>
  );
}

export default function WebAuditReportView({ data }: { data: WebAuditReportViewData }) {
  const { audit, client, sections, pageSnapshots, shopifySnapshots } = data;
  const byKey = new Map(sections.map((s) => [s.section_key, s]));

  const overview = byKey.get('web_overview');
  const performance = byKey.get('web_performance');
  const roadmap = byKey.get('web_revenue_summary');

  const rollup =
    (shopifySnapshots.find((s) => s.snapshot_kind === 'orders_rollup')?.computed as OrdersRollup | undefined) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      {/* Hero */}
      <div className="rounded-2xl gradient-bg px-8 py-10 text-white">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/70">
          <Globe className="h-4 w-4" />
          Website Audit
        </div>
        <h1 className="text-2xl font-bold sm:text-3xl">{client.company_name}</h1>
        {client.website_url && (
          <a href={client.website_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-white/80 hover:text-white hover:underline">
            {client.website_url}
          </a>
        )}
      </div>

      {overview && !isHidden(overview) && <OverviewBlock section={overview} companyName={client.company_name} />}

      {PAGE_SECTIONS.map(({ key, title, page_type }) => {
        const section = byKey.get(key);
        if (!section || isHidden(section)) return null;
        return (
          <WebPageSection
            key={key}
            section={section}
            title={title}
            snapshots={pageSnapshots.filter((s) => s.page_type === page_type)}
          />
        );
      })}

      {performance && !isHidden(performance) && <WebAnalyticsSection section={performance} rollup={rollup} />}

      {roadmap && !isHidden(roadmap) && <WebRoadmapTable section={roadmap} title="Prioritized Roadmap" />}

      <p className="text-center text-[11px] text-gray-400">
        {audit.title} · {new Date(audit.created_at).toLocaleDateString()}
      </p>
    </div>
  );
}
