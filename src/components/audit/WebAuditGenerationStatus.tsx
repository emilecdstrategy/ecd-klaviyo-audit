import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  fetchWebAuditPipelineStatus,
  startWebAnalysis,
  kickAfterGeneration,
  WEB_DISPLAY_STEP_LABELS,
  type WebPipelineStatus,
} from '../../lib/web-pipeline-status';

type Props = {
  auditId: string;
  onComplete?: () => void;
};

const STALE_NUDGE_TICKS = 6; // ~18s without progress before re-kicking the chain

export default function WebAuditGenerationStatus({ auditId, onComplete }: Props) {
  const [status, setStatus] = useState<WebPipelineStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const lastStepRef = useRef(-1);
  const staleTicksRef = useRef(0);

  const poll = useCallback(async () => {
    const next = await fetchWebAuditPipelineStatus(auditId);
    setStatus(next);
    return next;
  }, [auditId]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    const tick = async () => {
      try {
        const next = await poll();
        if (cancelled) return;
        if (next.complete) {
          onComplete?.();
          if (intervalId) window.clearInterval(intervalId);
          return;
        }
        // Nudge the chain if a step hasn't advanced for a while (dropped chain call).
        if (next.isGenerating) {
          if (next.stepIndex === lastStepRef.current) staleTicksRef.current += 1;
          else { staleTicksRef.current = 0; lastStepRef.current = next.stepIndex; }
          if (staleTicksRef.current >= STALE_NUDGE_TICKS) {
            staleTicksRef.current = 0;
            // In the afters phase re-kick the image chain; during analysis re-kick
            // the analysis chain. Each is idempotent and skips finished work.
            if (next.phase === 'afters') kickAfterGeneration(auditId).catch(() => {});
            else startWebAnalysis(auditId).catch(() => {});
          }
        }
      } catch {
        // keep polling
      }
    };

    tick();
    intervalId = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [auditId, onComplete, poll]);

  if (!status) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
      </div>
    );
  }

  if (status.failed) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 px-6 py-5 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Analysis paused</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
          The AI analysis stopped before finishing. You can pick up where it left off.
        </p>
        {status.error && <p className="mx-auto mt-3 max-w-md text-xs text-red-600">{status.error}</p>}
        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try { await startWebAnalysis(auditId); await poll(); } catch { /* poll shows state */ }
            finally { setRetrying(false); }
          }}
          className="mt-4 inline-flex items-center justify-center rounded-lg gradient-bg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {retrying ? 'Resuming…' : 'Resume analysis'}
        </button>
      </div>
    );
  }

  const progress = Math.min(status.progress, 95);

  return (
    <div className="mx-auto max-w-md rounded-xl bg-white p-8 text-center card-shadow animate-slide-up">
      <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-brand-primary" />
      <h2 className="mb-2 text-xl font-bold text-gray-900">Building your web audit</h2>
      <p className="mx-auto mb-6 max-w-md text-xs text-gray-400">
        The AI is reviewing each page and your store data. This runs on the server, so you can close this tab and reopen the audit anytime.
      </p>
      <div className="mx-auto max-w-xs">
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full gradient-bg rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs text-gray-400">{progress}% estimated</p>
      </div>
      <div className="mx-auto mt-5 max-w-md text-left">
        {WEB_DISPLAY_STEP_LABELS.map((label, index) => {
          const done = status.stepIndex > index;
          const active = status.stepIndex === index;
          return (
            <div
              key={label}
              className={[
                'flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors',
                done ? 'text-gray-900' : 'text-gray-600',
                active ? 'bg-gray-50' : '',
              ].join(' ')}
            >
              <CheckCircle2 className={done ? 'h-4 w-4 text-green-600' : active ? 'h-4 w-4 text-brand-primary' : 'h-4 w-4 text-gray-300'} />
              <span className={active ? 'font-medium text-brand-primary' : ''}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
