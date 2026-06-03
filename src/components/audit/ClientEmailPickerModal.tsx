import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Mail } from 'lucide-react';
import Modal from '../ui/Modal';
import AnnotationLayer from './AnnotationLayer';
import type { AuditEmailDesign, KlaviyoCampaignSnapshot } from '../../lib/types';
import {
  fetchClientCampaignEmail,
  getAuditEmailDesign,
  listCampaignSnapshots,
} from '../../lib/db';

const PICKER_LIMIT = 10;

function formatSendDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function sortSentCampaigns(snapshots: KlaviyoCampaignSnapshot[]): KlaviyoCampaignSnapshot[] {
  return snapshots
    .filter(s => (s.status ?? '').toLowerCase() === 'sent')
    .sort((a, b) => {
      const da = a.updated_at_klaviyo || a.created_at_klaviyo || '';
      const db = b.updated_at_klaviyo || b.created_at_klaviyo || '';
      return db.localeCompare(da);
    })
    .slice(0, PICKER_LIMIT);
}

type ClientEmailPickerModalProps = {
  open: boolean;
  auditId: string;
  currentCampaignId: string | null;
  onClose: () => void;
  onSelected: (emailDesign: AuditEmailDesign) => void;
};

export default function ClientEmailPickerModal({
  open,
  auditId,
  currentCampaignId,
  onClose,
  onSelected,
}: ClientEmailPickerModalProps) {
  const [snapshots, setSnapshots] = useState<KlaviyoCampaignSnapshot[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, { html: string; name: string | null }>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const sentCampaigns = useMemo(() => sortSentCampaigns(snapshots), [snapshots]);

  useEffect(() => {
    if (!open) return;
    setListLoading(true);
    setListError(null);
    setCommitError(null);
    setPreviewError(null);
    listCampaignSnapshots(auditId)
      .then(rows => {
        setSnapshots(rows);
        const sorted = sortSentCampaigns(rows);
        const initial =
          (currentCampaignId && sorted.find(s => s.campaign_id === currentCampaignId)?.campaign_id) ||
          sorted[0]?.campaign_id ||
          null;
        setHighlightedId(initial);
      })
      .catch(e => {
        setListError(e instanceof Error ? e.message : 'Failed to load campaigns');
        setSnapshots([]);
      })
      .finally(() => setListLoading(false));
  }, [open, auditId, currentCampaignId]);

  useEffect(() => {
    if (!open || !highlightedId) return;
    if (previewCache[highlightedId]) {
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    fetchClientCampaignEmail(auditId, highlightedId, { persist: false })
      .then(result => {
        if (cancelled) return;
        setPreviewCache(prev => ({
          ...prev,
          [highlightedId]: { html: result.html, name: result.name },
        }));
      })
      .catch(e => {
        if (cancelled) return;
        setPreviewError(e instanceof Error ? e.message : 'Failed to load email preview');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, highlightedId, auditId, previewCache]);

  const highlightedSnapshot = sentCampaigns.find(s => s.campaign_id === highlightedId);
  const cachedPreview = highlightedId ? previewCache[highlightedId] : undefined;
  const isCurrent = Boolean(highlightedId && highlightedId === currentCampaignId);

  const handleSetClientEmail = async () => {
    if (!highlightedId || !cachedPreview) return;

    setCommitting(true);
    setCommitError(null);
    try {
      await fetchClientCampaignEmail(auditId, highlightedId, { persist: true });
      const updated = await getAuditEmailDesign(auditId);
      if (!updated) throw new Error('Email design record not found after save');
      onSelected(updated);
      onClose();
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'Failed to set client email');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Modal open={open} title="Choose client email" onClose={onClose} className="max-w-6xl">
      <div className="flex min-h-[28rem] flex-col lg:flex-row">
        <div className="w-full shrink-0 border-b border-gray-100 lg:w-72 lg:border-b-0 lg:border-r">
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500">
              Latest sent campaigns from this audit snapshot. Default is the most recent send.
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto lg:max-h-[calc(100vh-14rem)]">
            {listLoading && (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading campaigns…
              </div>
            )}
            {!listLoading && listError && (
              <div className="mx-4 mb-4 flex gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {listError}
              </div>
            )}
            {!listLoading && !listError && sentCampaigns.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-gray-500">
                <Mail className="mx-auto mb-2 h-8 w-8 text-gray-200" />
                No sent email campaigns in the snapshot. Re-run the Klaviyo fetch for this audit.
              </div>
            )}
            {!listLoading &&
              sentCampaigns.map(c => {
                const active = c.campaign_id === highlightedId;
                const isRowCurrent = c.campaign_id === currentCampaignId;
                return (
                  <button
                    key={c.campaign_id}
                    type="button"
                    onClick={() => setHighlightedId(c.campaign_id)}
                    className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${
                      active
                        ? 'border-brand-primary bg-brand-primary/5'
                        : 'border-transparent hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 line-clamp-2">{c.name}</span>
                      {isRowCurrent && (
                        <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">
                      Sent {formatSendDate(c.updated_at_klaviyo || c.created_at_klaviyo)}
                    </p>
                  </button>
                );
              })}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-4">
            {!highlightedId && !listLoading && (
              <div className="flex h-full min-h-[16rem] items-center justify-center text-sm text-gray-400">
                Select a campaign to preview
              </div>
            )}
            {highlightedId && (
              <>
                <h3 className="mb-3 text-sm font-semibold text-gray-900">
                  {highlightedSnapshot?.name || cachedPreview?.name || 'Preview'}
                </h3>
                {previewLoading && !cachedPreview && (
                  <div className="flex min-h-[16rem] items-center justify-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading preview…
                  </div>
                )}
                {previewError && !cachedPreview && (
                  <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-gray-500">
                    <AlertCircle className="h-8 w-8 text-amber-400" />
                    <p>{previewError}</p>
                  </div>
                )}
                {cachedPreview && (
                  <AnnotationLayer
                    htmlContent={cachedPreview.html}
                    annotations={[]}
                    editable={false}
                    side="current"
                    maxHeight={480}
                  />
                )}
              </>
            )}
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            {commitError && (
              <p className="mb-2 text-sm text-red-600">{commitError}</p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !highlightedId ||
                  !cachedPreview ||
                  previewLoading ||
                  committing ||
                  isCurrent
                }
                onClick={() => void handleSetClientEmail()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {committing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Set as client email
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
