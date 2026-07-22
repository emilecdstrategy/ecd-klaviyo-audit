import { Loader2 } from 'lucide-react';
import { auditListBadge } from '../../lib/audit-pipeline-status';
import type { Audit } from '../../lib/types';

/** Small list badge: a spinner "Generating" while a run is active, or a static
 * "Unfinished" for an api audit with no content yet (e.g. a parked draft). */
export default function AuditStatusBadge({ audit }: { audit: Audit }) {
  const kind = auditListBadge(audit);
  if (kind === 'generating') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
        <Loader2 className="h-3 w-3 animate-spin" />
        Generating
      </span>
    );
  }
  if (kind === 'unfinished') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        Unfinished
      </span>
    );
  }
  return null;
}
