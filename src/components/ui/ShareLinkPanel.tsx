import { Link2, Copy, Check, ExternalLink } from 'lucide-react';
import { useState } from 'react';

interface ShareLinkPanelProps {
  shareToken: string | null;
  onPublish?: () => void;
  isPublished?: boolean;
  publishDisabled?: boolean;
  publishDisabledReason?: string;
}

export default function ShareLinkPanel({
  shareToken,
  onPublish,
  isPublished,
  publishDisabled,
  publishDisabledReason,
}: ShareLinkPanelProps) {
  const [copied, setCopied] = useState(false);
  const shareUrl = shareToken ? `${window.location.origin}/report/${shareToken}` : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isPublished) {
    return (
      <div className="bg-white rounded-xl p-5 card-shadow">
        <div className="flex items-center gap-2 mb-3">
          <Link2 className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Share Report</span>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Publish this audit to generate a shareable client-facing report link.
        </p>
        {publishDisabled && publishDisabledReason && (
          <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
            {publishDisabledReason}
          </div>
        )}
        <button
          onClick={onPublish}
          disabled={publishDisabled}
          className="w-full px-4 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Publish Report
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-5 card-shadow">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-4 h-4 text-brand-primary" />
        <span className="text-sm font-medium text-gray-700">Shareable Report Link</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={shareUrl}
          readOnly
          className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 font-mono"
        />
        <button
          onClick={handleCopy}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-gray-500" />}
        </button>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <ExternalLink className="w-4 h-4 text-gray-500" />
        </a>
      </div>
    </div>
  );
}
