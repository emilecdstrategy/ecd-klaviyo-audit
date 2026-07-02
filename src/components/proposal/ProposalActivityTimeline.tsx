import {
  FilePlus2,
  Send,
  Eye,
  PenLine,
  Trophy,
  XCircle,
  RotateCcw,
  PenSquare,
  type LucideIcon,
} from 'lucide-react';
import type { ProposalEvent, ProposalEventType } from '../../lib/types';

const EVENT_META: Record<ProposalEventType, { icon: LucideIcon; label: string; tone: string }> = {
  created: { icon: FilePlus2, label: 'Proposal created', tone: 'text-gray-400 bg-gray-50' },
  updated: { icon: PenSquare, label: 'Proposal updated', tone: 'text-gray-400 bg-gray-50' },
  sent: { icon: Send, label: 'Sent to client', tone: 'text-blue-600 bg-blue-50' },
  resent: { icon: Send, label: 'Resent to client', tone: 'text-blue-600 bg-blue-50' },
  viewed: { icon: Eye, label: 'Viewed by client', tone: 'text-purple-600 bg-purple-50' },
  signed: { icon: PenLine, label: 'Signed by client', tone: 'text-emerald-600 bg-emerald-50' },
  countersigned: { icon: PenLine, label: 'Countersigned by ECD', tone: 'text-emerald-600 bg-emerald-50' },
  won: { icon: Trophy, label: 'Marked won', tone: 'text-emerald-600 bg-emerald-50' },
  lost: { icon: XCircle, label: 'Marked lost', tone: 'text-red-600 bg-red-50' },
  reopened: { icon: RotateCcw, label: 'Reopened', tone: 'text-blue-600 bg-blue-50' },
};

function formatEventTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function ProposalActivityTimeline({ events }: { events: ProposalEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-gray-400">No activity yet.</p>;
  }

  return (
    <ol className="space-y-0">
      {events.map((event, index) => {
        const meta = EVENT_META[event.event_type] ?? EVENT_META.updated;
        const Icon = meta.icon;
        const reason = typeof event.metadata?.reason === 'string' ? event.metadata.reason : null;
        const ip = typeof event.metadata?.ip === 'string' && event.metadata.ip ? event.metadata.ip : null;
        const signerEmail =
          typeof event.metadata?.signer_email === 'string' && event.metadata.signer_email
            ? event.metadata.signer_email
            : null;
        return (
          <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < events.length - 1 && (
              <span className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-gray-100" aria-hidden />
            )}
            <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 pt-1">
              <p className="text-xs font-medium text-gray-800">{meta.label}</p>
              <p className="text-[11px] text-gray-400">{formatEventTime(event.created_at)}</p>
              {reason ? <p className="mt-0.5 text-[11px] italic text-gray-500">“{reason}”</p> : null}
              {(signerEmail || ip) && (
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {signerEmail ? signerEmail : null}
                  {signerEmail && ip ? ' · ' : null}
                  {ip ? `IP ${ip}` : null}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
