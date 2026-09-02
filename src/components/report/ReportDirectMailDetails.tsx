import { Mail, ShieldAlert, ExternalLink } from 'lucide-react';
import { formatCurrency } from '../../lib/revenue-calculator';
import { formatBenchmark, formatPct, type DirectMailPlan, type DirectMailRange } from '../../lib/direct-mail';
import type { DirectMailSectionConfig } from '../../lib/report-config/types';
import { isDirectMailBlockVisible } from '../../lib/report-config/resolve';
import { useReportEdit } from './edit/ReportEditContext';

// The numbers of the direct mail section: the gap, the flow pairings, the
// programs Klaviyo cannot run, the investment table, the integration and
// measurement plan, and the proof. Everything here is read straight off the
// plan the edge function computed; nothing is derived in the browser, so the
// report and the proposal can never disagree about a figure.

const n = (v: number) => v.toLocaleString('en-US');
const rangeText = (r: DirectMailRange) => `${n(r.low)} to ${n(r.high)}`;

function BlockTitle({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) return null;
  return (
    <div className="mb-3">
      {title && <h4 className="text-sm font-bold text-gray-900">{title}</h4>}
      {subtitle && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ReportDirectMailDetails({ plan, cfg }: { plan: DirectMailPlan; cfg: DirectMailSectionConfig }) {
  const { editMode } = useReportEdit();
  const show = (block: Parameters<typeof isDirectMailBlockVisible>[1]) => isDirectMailBlockVisible(cfg, block);

  // Not qualified: only the strategist sees this, and only the verdict. The
  // section is hidden from the client by the gate, so if it is on screen it is
  // edit mode or someone un-hid it deliberately.
  if (!plan.gate.qualified) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 mb-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Direct mail was not recommended for this account</p>
            <ul className="mt-2 space-y-1 text-sm text-amber-900/90 list-disc pl-4">
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
  const gapCfg = cfg.blocks.gap;
  const pairCfg = cfg.blocks.pairings;
  const invCfg = cfg.blocks.investment;
  const planCfg = cfg.blocks.plan;
  const proofCfg = cfg.blocks.proof;

  return (
    <div className="space-y-8 mb-6">
      {show('gap') && g && (
        <section>
          <BlockTitle title={gapCfg?.title} subtitle={gapCfg?.subtitle} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Klaviyo profiles" value={n(g.total_profiles)} sub={g.counts_partial ? 'Lower bound, scan stopped early' : undefined} />
            <Stat label="Suppressed or unsubscribed" value={n(g.suppressed)} sub={`${g.suppressed_pct}% of profiles, unreachable by email`} />
            <Stat label="Unengaged 90+ days" value={n(g.unengaged)} sub={`${g.unengaged_pct}%, excluded by good hygiene`} />
            <Stat label="Mailable after matching" value={rangeText(g.mailable)} sub="60 to 70% resolve to an address" />
          </div>
          {g.sitematch && g.monthly_sessions != null && (
            <p className="mt-3 text-sm text-gray-600">
              On top of that, about <span className="font-semibold text-gray-900">{rangeText(g.sitematch)}</span> anonymous visitors a month
              (20 to 40% of {n(g.monthly_sessions)} sessions) never gave an email and could be reached through SiteMatch.
            </p>
          )}
          {plan.aov.value != null && (
            <p className="mt-2 text-xs text-gray-500">
              AOV {formatCurrency(plan.aov.value)} from Placed Order over the last {plan.aov.window_days} days
              {plan.aov.orders ? ` (${n(plan.aov.orders)} orders)` : ''}.
            </p>
          )}
        </section>
      )}

      {show('pairings') && (
        <section>
          <BlockTitle title={pairCfg?.title} subtitle={pairCfg?.subtitle} />
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">Klaviyo flow</th>
                  <th className="text-left font-semibold px-4 py-2.5">Direct mail companion</th>
                  <th className="text-left font-semibold px-4 py-2.5">Timing</th>
                  <th className="text-left font-semibold px-4 py-2.5">Benchmark iROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plan.pairings.map(p => (
                  <tr key={p.n} className="align-top">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-900">{p.klaviyo_flow}</span>
                      {!p.flow_live && <span className="ml-2 text-[10px] font-semibold uppercase text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">flow not live</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{p.companion}</td>
                    <td className="px-4 py-3 text-gray-600">{p.timing}</td>
                    <td className="px-4 py-3 text-gray-700 tabular-nums">{formatBenchmark(p.benchmark)}</td>
                  </tr>
                ))}
                {plan.cannot_run.map(c => (
                  <tr key={c.program} className="align-top bg-violet-50/40">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-900">{c.program}</span>
                      <span className="ml-2 text-[10px] font-semibold uppercase text-violet-700 bg-violet-100 rounded-full px-2 py-0.5">Klaviyo cannot run this</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {c.audience}
                      {c.audience_count && <span className="text-gray-500"> ({rangeText(c.audience_count)})</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.why}</td>
                    <td className="px-4 py-3 text-gray-700 tabular-nums">{formatBenchmark(c.benchmark)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            The postcard goes at the end of the email sequence, not in parallel: everyone who was going to convert digitally already has.
          </p>
        </section>
      )}

      {show('investment') && plan.investment && (
        <section>
          <BlockTitle title={invCfg?.title} subtitle={invCfg?.subtitle} />
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5"></th>
                  {plan.investment.map(c => <th key={c.label} className="text-right font-semibold px-4 py-2.5">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">
                <tr>
                  <td className="px-4 py-2.5 text-gray-600">Pieces per month</td>
                  {plan.investment.map(c => <td key={c.label} className="px-4 py-2.5 text-right text-gray-900">{n(c.pieces_per_month)}</td>)}
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-gray-600">Format and plan</td>
                  {plan.investment.map(c => <td key={c.label} className="px-4 py-2.5 text-right text-gray-700">{c.format}, {c.plan_name}</td>)}
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-gray-600">Per piece (print, postage, data)</td>
                  {plan.investment.map(c => <td key={c.label} className="px-4 py-2.5 text-right text-gray-700">${c.blended_cpp.toFixed(2)}</td>)}
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-gray-600">PostPilot subscription</td>
                  {plan.investment.map(c => <td key={c.label} className="px-4 py-2.5 text-right text-gray-700">{formatCurrency(c.postpilot_subscription)}/mo</td>)}
                </tr>
                <tr className="bg-gray-50/60">
                  <td className="px-4 py-2.5 font-semibold text-gray-900">PostPilot monthly total</td>
                  {plan.investment.map(c => (
                    <td key={c.label} className="px-4 py-2.5 text-right font-semibold text-gray-900">
                      {c.enterprise_quote ? 'Enterprise quote' : `${formatCurrency(c.postpilot_monthly_total)}/mo`}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-gray-600">Break-even order rate</td>
                  {plan.investment.map(c => (
                    <td key={c.label} className="px-4 py-2.5 text-right text-gray-700">
                      {c.break_even_rate == null ? 'AOV unknown' : `${formatPct(c.break_even_rate)} of recipients`}
                    </td>
                  ))}
                </tr>
                {(plan.investment.some(c => c.ecd_setup != null) || plan.investment.some(c => c.ecd_monthly != null)) && (
                  <tr className="border-t-2 border-gray-200">
                    <td className="px-4 py-2.5 text-gray-600">ECD setup and management</td>
                    {plan.investment.map(c => (
                      <td key={c.label} className="px-4 py-2.5 text-right text-gray-700">
                        {c.ecd_setup != null ? `${formatCurrency(c.ecd_setup)} setup` : ''}
                        {c.ecd_setup != null && c.ecd_monthly != null ? ', ' : ''}
                        {c.ecd_monthly != null ? `${formatCurrency(c.ecd_monthly)}/mo` : ''}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Break-even is cost per piece divided by AOV: the share of recipients who must order for a card to pay for itself.
            Volumes above 50,000 pieces a month are priced by PostPilot directly.
          </p>
        </section>
      )}

      {show('plan') && (
        <section>
          <BlockTitle title={planCfg?.title} subtitle={planCfg?.subtitle} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-100 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Integration</p>
              <ul className="space-y-2 text-sm text-gray-700 leading-relaxed">
                <li>{plan.integration.connection}</li>
                <li>{plan.integration.audience_path}</li>
                <li>{plan.integration.shopify_prerequisite}</li>
                <li>{plan.integration.event_sync}</li>
              </ul>
            </div>
            <div className="rounded-xl border border-gray-100 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Measurement</p>
              <p className="text-sm text-gray-700 leading-relaxed">{plan.measurement.holdout}</p>
              <p className="text-sm text-gray-700 leading-relaxed mt-2">{plan.measurement.readout}</p>
              <ol className="mt-3 space-y-1.5 text-sm text-gray-700 list-decimal pl-4">
                {plan.measurement.phases.map((p, i) => <li key={i}>{p.replace(/^Phase \d+:\s*/, '')}</li>)}
              </ol>
            </div>
          </div>
        </section>
      )}

      {show('proof') && plan.proof.length > 0 && (
        <section>
          <BlockTitle title={proofCfg?.title} subtitle={proofCfg?.subtitle} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {plan.proof.map(c => (
              <a
                key={c.brand}
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="group rounded-xl border border-gray-100 bg-white p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-gray-400" />{c.brand}</p>
                  <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
                </div>
                <p className="text-xs text-gray-500 mt-1">{c.model}</p>
                <p className="text-sm text-gray-700 mt-2 leading-relaxed">{c.result}</p>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl bg-gray-50 border border-gray-100 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Assumptions and caveats</p>
        <ul className="space-y-1 text-xs text-gray-600 list-disc pl-4 leading-relaxed">
          {plan.assumptions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
        {plan.caveat && <p className="mt-3 text-xs text-gray-500 leading-relaxed">{plan.caveat}</p>}
      </section>
    </div>
  );
}
