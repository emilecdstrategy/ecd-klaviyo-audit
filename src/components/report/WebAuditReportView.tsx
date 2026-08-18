import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Settings2 } from 'lucide-react';
import type { Audit, AuditSection, Client, ShopifyDataSnapshot, WebPageSnapshot, WebPageType } from '../../lib/types';
import { parseWebRoadmapDetail, type OrdersRollup } from '../../lib/web-report-details';
import { getAddOnItemsFromLayout } from '../../lib/addon-highlight';
import { addOnIsCustomerAgent, addOnIsHelpdesk } from '../../lib/customer-agent-demo';
import { useReportEdit } from './edit/ReportEditContext';
import EditablePlainText from './edit/EditablePlainText';
import WebPageSection from './web/WebPageSection';
import WebAnalyticsSection from './web/WebAnalyticsSection';
import WebRoadmapTable from './web/WebRoadmapTable';
import WebInvestmentSummary from './web/WebInvestmentSummary';
import WebAgentDemoSection, { type AgentDemoKind } from './web/WebAgentDemoSection';

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

/** Numbered section frame, matching the Klaviyo report's section language so a
 * client moving between the two reports sees one house style. */
function WebSectionShell({
  id,
  number,
  label,
  setRef,
  children,
}: {
  id: string;
  number: string;
  label: string;
  setRef: (id: string, el: HTMLElement | null) => void;
  children: React.ReactNode;
}) {
  return (
    <section id={id} ref={el => setRef(id, el)} className="scroll-mt-24">
      <div className="mb-6 flex min-w-0 items-center gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-sm font-bold text-white tabular-nums shadow-sm shadow-brand-primary/25">
          {number}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-primary/80">
            Section {number}
          </p>
          <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{label}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

/** Intro block for the web_overview section (executive summary only; page-level
 * strengths live on each page's "What works"). */
function OverviewBlock({ section, companyName }: { section: AuditSection; companyName: string }) {
  const { editMode, updateSectionField } = useReportEdit();

  return (
    <div className="rounded-2xl bg-white p-6 card-shadow sm:p-7">
      {(editMode || section.summary_text) && (
        <div className="text-[15px] leading-relaxed text-gray-600">
          <EditablePlainText
            value={section.summary_text ?? ''}
            onSave={(v) => updateSectionField(section.section_key, 'summary_text', v)}
            placeholder={`A short summary of ${companyName}'s storefront…`}
          />
        </div>
      )}
    </div>
  );
}

export default function WebAuditReportView({
  data,
  onManageAddOns,
}: {
  data: WebAuditReportViewData;
  /** Opens the shared add-ons editor, the same drawer the Klaviyo report uses. */
  onManageAddOns?: () => void;
}) {
  const { audit, client, sections, pageSnapshots, shopifySnapshots } = data;
  const { editMode } = useReportEdit();
  const byKey = new Map(sections.map((s) => [s.section_key, s]));

  // Customer Agent and Helpdesk share one demo app, so selecting both gets a
  // single combined section rather than the same embed twice.
  const addOnItems = useMemo(
    () => getAddOnItemsFromLayout(audit.layout).filter(item => !item.is_hidden),
    [audit.layout],
  );

  const demoKind = useMemo<AgentDemoKind | null>(() => {
    const items = addOnItems;
    const hasAgent = items.some(item => addOnIsCustomerAgent(item.template_slug, item.name));
    const hasHelpdesk = items.some(item => addOnIsHelpdesk(item.template_slug, item.name));
    if (hasAgent && hasHelpdesk) return 'both';
    if (hasAgent) return 'agent';
    if (hasHelpdesk) return 'helpdesk';
    return null;
    // audit.layout, not audit.report_layout: the latter does not exist on Audit,
    // so the memo never recomputed and toggling an add-on left the section stale.
  }, [audit.layout]);

  const demoLabel = demoKind === 'helpdesk' ? 'Helpdesk' : demoKind === 'both' ? 'Agent & Helpdesk' : 'Customer Agent';

  const overview = byKey.get('web_overview');
  const performance = byKey.get('web_performance');
  const roadmap = byKey.get('web_revenue_summary');

  const rollup =
    (shopifySnapshots.find((s) => s.snapshot_kind === 'orders_rollup')?.computed as OrdersRollup | undefined) ?? null;

  // Only sections that actually render get a nav entry, so the nav never points
  // at an anchor that is not on the page.
  const navItems = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [];
    if (overview && !isHidden(overview)) items.push({ id: 'web_overview', label: 'Overview' });
    for (const { key, title, page_type } of PAGE_SECTIONS) {
      const section = byKey.get(key);
      if (!section || isHidden(section)) continue;
      if (!pageSnapshots.some((s) => s.page_type === page_type)) continue;
      items.push({ id: key, label: title });
    }
    if (performance && !isHidden(performance)) items.push({ id: 'web_performance', label: 'Performance' });
    // Before the roadmap: the demo is context for what is being recommended,
    // and the roadmap reads as the closing summary.
    if (demoKind) items.push({ id: 'web_agent_demo', label: demoLabel });
    if (roadmap && !isHidden(roadmap)) items.push({ id: 'web_revenue_summary', label: 'Roadmap' });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, pageSnapshots, demoKind, demoLabel]);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const setRef = (id: string, el: HTMLElement | null) => { sectionRefs.current[id] = el; };
  const [activeSection, setActiveSection] = useState<string>(navItems[0]?.id ?? '');
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const pct = max > 0 ? (doc.scrollTop / max) * 100 : 0;
      setScrollProgress(Math.max(0, Math.min(100, pct)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    navItems.forEach(({ id }) => {
      const el = sectionRefs.current[id];
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
        { rootMargin: '-20% 0px -70% 0px' },
      );
      observer.observe(el);
      observers.push(observer);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [navItems]);

  let sectionNumber = 0;
  const nextNumber = () => String(++sectionNumber).padStart(2, '0');

  return (
    <div>
      {navItems.length > 1 && (
        <div className="sticky top-0 z-40 bg-white">
          <div className="border-b border-gray-100">
            <div className="mx-auto max-w-[77rem] px-6">
              <nav className="flex overflow-x-auto">
                {navItems.map(item => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setActiveSection(item.id);
                      const el = sectionRefs.current[item.id] ?? document.getElementById(item.id);
                      if (!el) return;
                      const top = el.getBoundingClientRect().top + window.scrollY - 72;
                      window.scrollTo({ top, behavior: 'smooth' });
                    }}
                    className={`whitespace-nowrap border-b-2 px-4 py-3.5 text-xs font-semibold transition-colors ${
                      activeSection === item.id
                        ? 'border-brand-primary text-brand-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </div>
          {/* Reading-progress line, below the nav's divider so it never overlaps
              the active tab's underline. */}
          <div
            className="h-0.5 bg-brand-primary transition-[width] duration-150 ease-out"
            style={{ width: `${scrollProgress}%` }}
            aria-hidden
          />
        </div>
      )}

      <div className="mx-auto max-w-[77rem] space-y-14 px-6 py-10">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl gradient-bg px-8 py-12 text-white sm:px-10 sm:py-14">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl"
            aria-hidden
          />
          <div className="relative">
            <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
              <Globe className="h-4 w-4" />
              Website Audit
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{client.company_name}</h1>
            {client.website_url && (
              <a
                href={client.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm text-white/80 transition-colors hover:text-white hover:underline"
              >
                {client.website_url}
              </a>
            )}
            <p className="mt-6 text-xs text-white/60">
              Prepared {new Date(audit.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>

        {overview && !isHidden(overview) && (
          <WebSectionShell id="web_overview" number={nextNumber()} label="Overview" setRef={setRef}>
            <OverviewBlock section={overview} companyName={client.company_name} />
          </WebSectionShell>
        )}

        {PAGE_SECTIONS.map(({ key, title, page_type }) => {
          const section = byKey.get(key);
          if (!section || isHidden(section)) return null;
          const snapshots = pageSnapshots.filter((s) => s.page_type === page_type);
          if (!snapshots.length) return null;
          return (
            <WebSectionShell key={key} id={key} number={nextNumber()} label={title} setRef={setRef}>
              <WebPageSection section={section} title={title} snapshots={snapshots} hideTitle />
            </WebSectionShell>
          );
        })}

        {performance && !isHidden(performance) && (
          <WebSectionShell id="web_performance" number={nextNumber()} label="Performance" setRef={setRef}>
            <WebAnalyticsSection section={performance} rollup={rollup} hideTitle />
          </WebSectionShell>
        )}

        {demoKind && (
          <WebSectionShell
            id="web_agent_demo"
            number={nextNumber()}
            label={demoKind === 'helpdesk' ? 'Helpdesk' : demoKind === 'both' ? 'Customer Agent and Helpdesk' : 'Customer Agent'}
            setRef={setRef}
          >
            <WebAgentDemoSection kind={demoKind} websiteUrl={client.website_url} />
          </WebSectionShell>
        )}

        {roadmap && !isHidden(roadmap) && (
          <WebSectionShell id="web_revenue_summary" number={nextNumber()} label="Prioritized Roadmap" setRef={setRef}>
            <WebRoadmapTable section={roadmap} title="Prioritized Roadmap" hideTitle />
          </WebSectionShell>
        )}

        {/* What the ticked roadmap rows add up to. Not its own numbered section:
            it is the bill for the section above, and numbering it would imply a
            separate piece of analysis. */}
        {roadmap && !isHidden(roadmap) && !parseWebRoadmapDetail(roadmap.section_details).investment_hidden && (
          <div id="web_investment_summary">
            <WebInvestmentSummary section={roadmap} addOns={addOnItems} />
          </div>
        )}

        {editMode && onManageAddOns && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onManageAddOns}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
              {demoKind ? 'Manage add-ons' : 'Add Customer Agent or Helpdesk'}
            </button>
          </div>
        )}

        <p className="text-center text-[11px] text-gray-400">
          {audit.title} · {new Date(audit.created_at).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}
