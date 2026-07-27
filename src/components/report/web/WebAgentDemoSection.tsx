import { useState } from 'react';
import { ExternalLink, MessageSquare, LifeBuoy, Sparkles } from 'lucide-react';
import { customerAgentDemoUrlOrDefault } from '../../../lib/customer-agent-demo';
import { websiteHostname } from '../../../lib/site-favicon';

export type AgentDemoKind = 'agent' | 'helpdesk' | 'both';

/** Copy per selection. "both" is not the two blurbs concatenated: the point of
 * taking both is that one deflects and one resolves, so it gets its own framing. */
const COPY: Record<AgentDemoKind, { title: string; lead: string; reasons: string[] }> = {
  agent: {
    title: 'Klaviyo Customer Agent',
    lead:
      'An AI shopping assistant that sits on the storefront and answers the questions this audit shows shoppers are asking themselves. It knows the catalog, so it can recommend a product, check what is in stock, and explain sizing, care, or shipping in the moment someone would otherwise leave.',
    reasons: [
      'Answers pre-purchase questions on the page instead of losing the shopper to a search tab.',
      'Recommends products from the real catalog, which lifts the average order value on browse-heavy sessions.',
      'Captures the email address in the conversation, so an unconverted visit still enters the lifecycle program.',
      'Every conversation becomes data on what shoppers actually ask, which feeds the next round of page and copy fixes.',
    ],
  },
  helpdesk: {
    title: 'Klaviyo Helpdesk',
    lead:
      'A support inbox that lives with the customer data rather than beside it. Order history, subscription state, and lifecycle activity sit next to the ticket, so replies go out with the full picture instead of a copy-paste from another tab.',
    reasons: [
      'One inbox for email, chat, and social, so nothing waits days in a channel nobody watches.',
      'Order and profile context on the ticket, which cuts the back and forth before an agent can actually help.',
      'Support conversations feed the same profiles the flows use, so messaging stops contradicting what a customer just told you.',
      'Response and resolution times become measurable, which is where most post-purchase churn quietly hides.',
    ],
  },
  both: {
    title: 'Klaviyo Customer Agent and Helpdesk',
    lead:
      'Taken together these cover the two halves of the same conversation. The Customer Agent handles the pre-purchase questions on the storefront automatically, and anything it cannot resolve lands in the Helpdesk with the full order and profile context already attached.',
    reasons: [
      'The agent deflects the repetitive pre-purchase questions, so the human team only sees what genuinely needs them.',
      'Escalations arrive with the conversation, the order, and the lifecycle history attached, so nobody asks the customer to repeat themselves.',
      'One record per customer across storefront chat, email, and support, instead of three partial views.',
      'Both feed the same profiles your flows already use, so the automated messaging stays consistent with what support just said.',
    ],
  },
};

/** Live demo embed plus the case for the tool, shown when the add-on is selected
 * on the audit. Both products share one demo app, so "both" embeds it once. */
export default function WebAgentDemoSection({
  kind,
  websiteUrl,
}: {
  kind: AgentDemoKind;
  websiteUrl?: string | null;
}) {
  const [loaded, setLoaded] = useState(false);
  const copy = COPY[kind];
  const demoUrl = customerAgentDemoUrlOrDefault(websiteUrl);
  const domain = websiteHostname(websiteUrl);
  const Icon = kind === 'helpdesk' ? LifeBuoy : kind === 'both' ? Sparkles : MessageSquare;

  return (
    <div className="overflow-hidden rounded-2xl bg-white card-shadow">
      <div className="border-b border-gray-100 p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
            <Icon className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900">{copy.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{copy.lead}</p>
          </div>
        </div>

        <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
          {copy.reasons.map(reason => (
            <li key={reason} className="flex gap-2.5 text-sm leading-relaxed text-gray-600">
              <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" aria-hidden />
              {reason}
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-gray-50/70 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-500">
            {domain ? `Live demo, running on ${domain}` : 'Live demo'}
          </p>
          <a
            href={demoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Open in a new tab
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
        <div className="relative h-[34rem] overflow-hidden rounded-xl border border-gray-200 bg-white">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
              Loading the live demo…
            </div>
          )}
          <iframe
            src={demoUrl}
            title={`Live demo: ${copy.title}`}
            onLoad={() => setLoaded(true)}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            allow="fullscreen"
            loading="lazy"
          />
        </div>
      </div>
    </div>
  );
}
