import { useState } from 'react';
import { Copy, Check, ExternalLink, Link2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../ui/select';
import StatusBadge from '../ui/StatusBadge';
import type { Audit } from '../../lib/types';

const STATUS_OPTIONS: { value: Audit['status']; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In Review' },
  { value: 'viewer_only', label: 'Viewer Only' },
  { value: 'published', label: 'Published' },
];

export default function WorkspacePublishBar({
  audit,
  shareToken,
  onPublish,
  onStatusChange,
  publishDisabled,
  publishDisabledReason,
}: {
  audit: Audit;
  shareToken: string | null;
  onPublish: () => void;
  onStatusChange: (status: Audit['status']) => void;
  publishDisabled?: boolean;
  publishDisabledReason?: string;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = shareToken ? `${window.location.origin}/report/${shareToken}` : '';
  const isPublished = audit.status === 'published';

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.06)]">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link2 className="h-4 w-4 shrink-0 text-brand-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-700">Shareable report</p>
            {isPublished && shareUrl ? (
              <p className="truncate font-mono text-[11px] text-gray-500">{shareUrl}</p>
            ) : (
              <p className="text-[11px] text-gray-500">Publish to generate a client link</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs text-gray-500">Status</span>
            <Select value={audit.status} onValueChange={v => onStatusChange(v as Audit['status'])}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <SelectItemText>{opt.label}</SelectItemText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <StatusBadge status={audit.status} />

          {isPublished && shareUrl ? (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </>
          ) : (
            <button
              type="button"
              onClick={onPublish}
              disabled={publishDisabled}
              title={publishDisabledReason}
              className="inline-flex items-center rounded-lg gradient-bg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Publish report
            </button>
          )}
        </div>
      </div>
      {publishDisabled && publishDisabledReason && !isPublished && (
        <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800 sm:px-6">
          {publishDisabledReason}
        </div>
      )}
    </div>
  );
}
