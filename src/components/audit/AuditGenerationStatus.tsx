import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  fetchAuditPipelineStatus,
  nudgeProfileScan,
  startServerAuditAnalysis,
  type AuditPipelineStatus,
} from '../../lib/audit-pipeline-status';
import { isAuditAiResumeInFlight, resumeAuditAnalysis } from '../../lib/resume-audit-analysis';

type AuditGenerationStatusProps = {
  auditId: string;
  onComplete?: () => void;
  compact?: boolean;
};

const STEP_ITEMS = [
  { key: 'klaviyo_config', label: 'Fetch Klaviyo snapshot', minProgress: 10 },
  { key: 'klaviyo_reporting', label: 'Pull reporting metrics', minProgress: 30 },
  { key: 'profile_scan', label: 'Scan audience profiles', minProgress: 45 },
  { key: 'ai_analysis', label: 'Run AI analysis', minProgress: 60 },
  { key: 'complete', label: 'Save results', minProgress: 100 },
] as const;

function stepState(progress: number, minProgress: number, nextMin?: number) {
  const done = progress >= (nextMin ?? 100);
  const active = !done && progress >= minProgress;
  return { done, active };
}

const PROFILE_NUDGE_INTERVAL_MS = 90_000;

export default function AuditGenerationStatus({ auditId, onComplete, compact = false }: AuditGenerationStatusProps) {
  const [status, setStatus] = useState<AuditPipelineStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [resumeLabel, setResumeLabel] = useState('');
  const [resumeProgress, setResumeProgress] = useState<number | null>(null);
  const [manualResumePending, setManualResumePending] = useState(false);
  const [resumeKickedOff, setResumeKickedOff] = useState(false);
  const resumeStartedRef = useRef(false);
  const lastProfileNudgeRef = useRef(0);

  const pollStatus = useCallback(async () => {
    const next = await fetchAuditPipelineStatus(auditId);
    setStatus(next);
    setLoadError('');
    return next;
  }, [auditId]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    const poll = async () => {
      try {
        const next = await pollStatus();
        if (cancelled) return;
        if (!next.showPipelineUi) {
          onComplete?.();
          if (intervalId) window.clearInterval(intervalId);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Failed to check analysis status');
      }
    };

    poll();
    intervalId = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [auditId, onComplete, pollStatus]);

  useEffect(() => {
    if (!status?.needsProfileResume || status.isStalled) return;

    const maybeNudge = async () => {
      if (Date.now() - lastProfileNudgeRef.current < PROFILE_NUDGE_INTERVAL_MS) return;
      lastProfileNudgeRef.current = Date.now();
      try {
        await nudgeProfileScan(auditId);
      } catch {
        // polling will retry
      }
    };

    maybeNudge();
    const intervalId = window.setInterval(maybeNudge, PROFILE_NUDGE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [auditId, status?.isStalled, status?.needsProfileResume]);

  useEffect(() => {
    if (!status?.isStalled || resumeKickedOff) return;
    setManualResumePending(true);
    setResumeError('');
    const resume = status.aiStalled
      ? startServerAuditAnalysis(auditId)
      : nudgeProfileScan(auditId);
    resume
      .then(() => {
        setResumeKickedOff(true);
        return pollStatus();
      })
      .catch((e: unknown) => {
        setResumeError(
          e instanceof Error
            ? e.message
            : status.aiStalled
              ? 'Failed to resume AI analysis'
              : 'Failed to resume profile scan',
        );
      })
      .finally(() => setManualResumePending(false));
  }, [auditId, pollStatus, resumeKickedOff, status?.aiStalled, status?.isStalled]);

  useEffect(() => {
    if (!status?.needsAiResume) return;
    if (resumeStartedRef.current || isAuditAiResumeInFlight(auditId)) return;

    resumeStartedRef.current = true;
    setResumeError('');

    resumeAuditAnalysis(auditId, update => {
      setResumeLabel(update.label);
      setResumeProgress(update.progress);
      setStatus(prev => (prev ? { ...prev, label: update.label, progress: update.progress } : prev));
    })
      .then(() => pollStatus())
      .catch((e: unknown) => {
        resumeStartedRef.current = false;
        setResumeError(e instanceof Error ? e.message : 'Failed to resume AI analysis');
      });
  }, [auditId, pollStatus, status?.needsAiResume]);

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {loadError}
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
      </div>
    );
  }

  if (status.isStalled && !resumeKickedOff) {
    const isAi = status.aiStalled;
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5 text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          {isAi ? 'AI analysis paused' : 'Profile scan paused'}
        </h2>
        <p className="mt-2 text-sm text-gray-600 max-w-lg mx-auto">
          {isAi
            ? 'Klaviyo data is ready but the AI step stopped before saving results. A server watchdog will retry automatically every few minutes — or click resume now.'
            : `Klaviyo config and reporting finished, but the full audience scan stopped before completing${status.profileScanTotal ? ` (${status.profileScanTotal.toLocaleString()} profiles scanned so far)` : ''}. A server watchdog will retry automatically every few minutes — or click resume now.`}
        </p>
        {resumeError && (
          <p className="mt-3 text-sm text-red-600 max-w-lg mx-auto">{resumeError}</p>
        )}
        <button
          type="button"
          disabled={manualResumePending}
          onClick={() => {
            setManualResumePending(true);
            setResumeError('');
            const resume = isAi ? startServerAuditAnalysis(auditId) : nudgeProfileScan(auditId);
            resume
              .then(() => {
                setResumeKickedOff(true);
                return pollStatus();
              })
              .catch((e: unknown) => {
                setResumeError(
                  e instanceof Error
                    ? e.message
                    : isAi
                      ? 'Failed to resume AI analysis'
                      : 'Failed to resume profile scan',
                );
              })
              .finally(() => setManualResumePending(false));
          }}
          className="mt-4 inline-flex items-center justify-center rounded-lg gradient-bg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {manualResumePending
            ? 'Starting on server…'
            : isAi
              ? 'Resume AI analysis'
              : 'Resume profile scan'}
        </button>
      </div>
    );
  }

  const progress = resumeProgress ?? status.progress;
  const label = resumeLabel || status.label;
  const klaviyoStillRunning = status.phase !== 'ai_analysis' && status.phase !== 'complete';

  return (
    <div className={`bg-white rounded-xl card-shadow text-center animate-slide-up ${compact ? 'p-6' : 'p-8'}`}>
      <Loader2 className="w-12 h-12 text-brand-primary animate-spin mx-auto mb-4" />
      <h2 className="text-xl font-bold text-gray-900 mb-2">Analysis in progress</h2>
      <p className="text-sm text-gray-500 mb-2 max-w-md mx-auto">
        {label}
      </p>
      <p className="text-xs text-gray-400 mb-6 max-w-md mx-auto">
        {klaviyoStillRunning
          ? 'You can close this page — a server watchdog keeps the profile scan moving automatically. Reopen anytime to check progress.'
          : 'Klaviyo data is ready. AI analysis runs on the server — a watchdog retries if it stalls. You can close this page and reopen anytime.'}
      </p>
      {resumeError && (
        <p className="text-sm text-red-600 mb-4 max-w-md mx-auto">{resumeError}</p>
      )}
      <div className="max-w-xs mx-auto">
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full gradient-bg rounded-full transition-all duration-500"
            style={{ width: `${Math.min(progress, 95)}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-2">{Math.min(progress, 95)}% estimated</p>
      </div>
      <div className="max-w-md mx-auto mt-5 text-left">
        {STEP_ITEMS.map((step, index) => {
          const next = STEP_ITEMS[index + 1];
          const { done, active } = stepState(progress, step.minProgress, next?.minProgress);
          return (
            <div
              key={step.key}
              className={[
                'flex items-center gap-2 text-sm rounded-md px-2 py-1 transition-colors',
                done ? 'text-gray-900' : 'text-gray-600',
                active ? 'bg-gray-50' : '',
              ].join(' ')}
            >
              <CheckCircle2 className={done ? 'w-4 h-4 text-green-600' : active ? 'w-4 h-4 text-brand-primary' : 'w-4 h-4 text-gray-300'} />
              <span className={active ? 'font-medium text-brand-primary' : ''}>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
