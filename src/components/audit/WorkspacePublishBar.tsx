import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../ui/select';
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
  const isViewerOnly = audit.status === 'viewer_only';
  const hasShareLink = Boolean(shareUrl) && (isPublished || isViewerOnly);
  const statusLabel = STATUS_OPTIONS.find(opt => opt.value === audit.status)?.label ?? audit.status;
  const shareUrlInputWidthCh = shareUrl
    ? Math.min(Math.max(shareUrl.length, 28), 44)
    : 28;

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusControl = (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-sm text-gray-600">Status</span>
      <Select value={audit.status} onValueChange={v => onStatusChange(v as Audit['status'])}>
        <SelectTrigger className="h-10 w-[10.5rem] text-sm">
          <SelectValue>{statusLabel}</SelectValue>
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
  );

  return (
    <div className="fixed bottom-0 left-[68px] right-0 z-40 border-t border-gray-200 bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">Shareable report</p>
          {hasShareLink ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              {isViewerOnly && (
                <p className="w-full text-xs text-blue-700">
                  Viewer Only — link works for signed-in viewer accounts (not public anonymous access).
                </p>
              )}
              <div className="inline-flex h-10 max-w-full items-stretch overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                <input
                  readOnly
                  value={shareUrl}
                  aria-label="Shareable report link"
                  style={{ width: `${shareUrlInputWidthCh}ch` }}
                  className="min-w-0 max-w-full truncate border-0 bg-transparent px-3 text-sm text-gray-700 focus:outline-none focus:ring-0"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex shrink-0 items-center gap-2 border-l border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-2 border-l border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open
                </a>
              </div>
              {statusControl}
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-500">
              {isViewerOnly || isPublished
                ? 'Generating share link…'
                : 'Publish or set Viewer Only to generate a client-facing link.'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {!(hasShareLink) && statusControl}

          {!isPublished && (
            <button
              type="button"
              onClick={onPublish}
              disabled={publishDisabled}
              title={publishDisabledReason}
              className="inline-flex h-10 items-center rounded-lg gradient-bg px-5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Publish report
            </button>
          )}
        </div>
      </div>
      {publishDisabled && publishDisabledReason && !isPublished && (
        <div className="border-t border-amber-100 bg-amber-50 px-5 py-2.5 text-center text-sm text-amber-800">
          {publishDisabledReason}
        </div>
      )}
    </div>
  );
}
