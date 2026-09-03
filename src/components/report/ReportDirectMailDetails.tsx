import { ShieldAlert, ExternalLink, ChevronDown } from 'lucide-react';
import { formatCurrency } from '../../lib/revenue-calculator';
import { formatBenchmark, type DirectMailPlan, type DirectMailRange } from '../../lib/direct-mail';
import type { DirectMailSectionConfig } from '../../lib/report-config/types';
import { isDirectMailBlockVisible } from '../../lib/report-config/resolve';
import { useReportEdit } from './edit/ReportEditContext';

// The numbers of the direct mail section, kept short on purpose: four tiles
// for the gap, one compact table for the pairings, a volume strip, two short
// lists, three one-line proof cards, and the fine print folded away. Everything
// is read straight off the plan the edge function computed; nothing is derived
// in the browser, and there is no PostPilot pricing to show.

const n = (v: number) => v.toLocaleString('en-US');
const rangeText = (r: DirectMailRange) => `${n(r.low)} to ${n(r.high)}`;

function Block({ title, subtitle, children }: { title?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      {(title || subtitle) && (
        <div className="mb-3 flex items-baseline gap-3">
          {title && <h4 className="text-sm font-bold text-gray-900">{title}</h4>}
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${accent ? 'border-violet-200 bg-violet-50/60' : 'border-gray-100 bg-white'}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${accent ? 'text-violet-900' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-500">{sub}</p>}
    </div>
  );
}

export default function ReportDirectMailDetails({ plan, cfg }: { plan: DirectMailPlan; cfg: DirectMailSectionConfig }) {
  const { editMode } = useReportEdit();
  const show = (block: Parameters<typeof isDirectMailBlockVisible>[1]) => isDirectMailBlockVisible(cfg, block);

  // Not qualified: the gate hides the section from the client, so this is
  // either edit mode or a deliberate un-hide. Show the verdict, nothing else.
  if (!plan.gate.qualified) {
    return (
      <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Direct mail was not recommended for this account</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-900/90">
              {plan.gate.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            {editMode && (
              <p className="mt-3 text-xs text-amber-800/80">
                Hidden from the client by the gate. Un-hiding this section shows this verdict, not a recommendation.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const g = plan.gap;
  const b = cfg.blocks;
  const fees = plan.ecd_fees;
  const feeText = [
    fees.setup != null ? `${formatCurrency(fees.setup)} setup` : null,
    fees.monthly != null ? `${formatCurrency(fees.monthly)}/mo management` : null,
  ].filter(Boolean).join(', ');

  return (
    <div className="mb-6 space-y-7">
      {show('gap') && g && (
        <Block title={b.gap?.title} subtitle={b.gap?.subtitle}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Klaviyo profiles" value={n(g.total_profiles)} sub={g.counts_partial ? 'Lower bound' : undefined} />
            <Tile label="Suppressed or unsubscribed" value={n(g.suppressed)} sub={`${g.suppressed_pct}%, unreachable by email`} />
            <Tile label="Unengaged 90+ days" value={n(g.unengaged)} sub={`${g.unengaged_pct}%, excluded by good hygiene`} />
            <Tile label="Reachable by post" value={rangeText(g.mailable)} sub="60 to 70% match to an address" accent />
          </div>
          {g.sitematch && g.monthly_sessions != null && (
            <p className="mt-2 text-xs text-gray-600">
              Plus about <span className="font-semibold text-gray-900">{rangeText(g.sitematch)}</span> anonymous visitors a month
              who never gave an email, from {n(g.monthly_sessions)} monthly sessions.
            </p>
          )}
        </Block>
      )}

      {show('pairings') && (
        <Block title={b.pairings?.title} subtitle={b.pairings?.subtitle}>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Klaviyo flow</th>
                  <th className="px-4 py-2 text-left font-semibold">Postcard</th>
                  <th className="px-4 py-2 text-right font-semibold whitespace-nowrap">Median iROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plan.pairings.map(p => (
                  <tr key={p.n} className="align-top">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-semibold text-gray-900">{p.klaviyo_flow}</span>
                      {!p.flow_live && <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">not live</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {p.companion}
                      <span className="block text-xs text-gray-500">{p.timing}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">{formatBenchmark(p.benchmark)}</td>
                  </tr>
                ))}
                {plan.cannot_run.map(c => (
                  <tr key={c.program} className="align-top bg-violet-50/50">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-semibold text-violet-900">{c.program}</span>
                      <span className="block text-[9px] font-semibold uppercase text-violet-600">Klaviyo cannot run this</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {c.audience}
                      {c.audience_count && <span className="block text-xs text-gray-500">{rangeText(c.audience_count)} people. {c.why}.</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">{formatBenchmark(c.benchmark)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      {show('volume') && plan.volume && (
        <Block title={b.volume?.title} subtitle={b.volume?.subtitle}>
          <div className={`grid grid-cols-1 gap-3 ${plan.volume.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            {plan.volume.map(v => (
              <div key={v.label} className={`rounded-xl border px-4 py-3 ${v.label === 'Recommended' ? 'border-violet-200 bg-violet-50/60' : 'border-gray-100 bg-white'}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{v.label}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{n(v.pieces_per_month)} <span className="text-xs font-medium text-gray-500">postcards / mo</span></p>
                <p className="mt-0.5 text-[11px] text-gray-500">{v.cadence}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-600">
            {plan.pricing_note}{feeText ? ` ECD's ${feeText} are separate line items in the proposal.` : ''}
          </p>
        </Block>
      )}

      {show('plan') && (
        <Block title={b.plan?.title}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[['How it connects', plan.integration], ['How it is measured', plan.measurement]].map(([title, items]) => (
              <div key={title as string} className="rounded-xl border border-gray-100 p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{title as string}</p>
                <ul className="space-y-1.5 text-sm text-gray-700">
                  {(items as string[]).map((t, i) => (
                    <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gray-400" />{t}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Block>
      )}

      {show('proof') && plan.proof.length > 0 && (
        <Block title={b.proof?.title} subtitle={b.proof?.subtitle}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {plan.proof.map(c => (
              <a key={c.brand} href={c.url} target="_blank" rel="noreferrer"
                className="group flex items-start justify-between gap-2 rounded-xl border border-gray-100 bg-white px-4 py-3 transition-colors hover:border-gray-300">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{c.brand} <span className="font-normal text-gray-500">· {c.model}</span></p>
                  <p className="mt-0.5 text-xs text-gray-700">{c.result}</p>
                </div>
                <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-300 group-hover:text-gray-500" />
              </a>
            ))}
          </div>
        </Block>
      )}

      <details className="group rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-gray-600">
          Assumptions, compliance and caveats
          <ChevronDown className="h-3.5 w-3.5 text-gray-400 transition-transform group-open:rotate-180" />
        </summary>
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-relaxed text-gray-600">
          {plan.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          {plan.compliance && <li>{plan.compliance}</li>}
        </ul>
        {plan.caveat && <p className="mt-3 text-xs leading-relaxed text-gray-500">{plan.caveat}</p>}
      </details>
    </div>
  );
}
