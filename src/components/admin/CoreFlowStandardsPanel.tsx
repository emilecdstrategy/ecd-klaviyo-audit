import { useCallback, useEffect, useState } from 'react';
import { Info, RotateCcw, Workflow } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { getPlatformSettings, updatePlatformSettings } from '../../lib/db';
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext';
import {
  DEFAULT_CORE_FLOW_RECOMMENDATIONS,
  getAllConfigurableCoreFlowNames,
  mergeCoreFlowRecommendations,
  type CoreFlowRecommendations,
} from '../../lib/core-flow-recommendations';

const FLOW_ORDER = getAllConfigurableCoreFlowNames();

export default function CoreFlowStandardsPanel() {
  const toast = useToast();
  const { refreshSettings } = usePlatformSettings();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CoreFlowRecommendations>(() => ({
    ...DEFAULT_CORE_FLOW_RECOMMENDATIONS,
  }));

  const reload = useCallback(async () => {
    try {
      const settings = await getPlatformSettings();
      setForm(mergeCoreFlowRecommendations(settings.core_flow_recommendations));
    } catch {
      setForm(mergeCoreFlowRecommendations());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const updateField = (flowName: string, value: string) => {
    setForm(prev => ({ ...prev, [flowName]: value }));
  };

  const resetDefaults = () => {
    setForm({ ...DEFAULT_CORE_FLOW_RECOMMENDATIONS });
  };

  const save = async () => {
    setSaving(true);
    try {
      const core_flow_recommendations = mergeCoreFlowRecommendations(form);
      await updatePlatformSettings({ core_flow_recommendations });
      await refreshSettings();
      toast('Core flow standards saved');
    } catch {
      toast('Could not save core flow standards');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="space-y-4 max-w-4xl animate-slide-up">
        <div className="h-8 w-56 bg-gray-100 rounded animate-pulse" />
        <div className="h-96 bg-white rounded-xl card-shadow animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6 animate-slide-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Workflow className="h-5 w-5 text-brand-primary" />
            <h2 className="text-base font-semibold text-gray-900">Core flow standards</h2>
          </div>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            Company-standard copy for the <strong>Recommended</strong> column in the Core Flows Matrix.
            Applied to new API audits at analysis time and stored on each report.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={resetDefaults}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset defaults
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save standards'}
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-800">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
        <p>
          AI still describes the client&apos;s <strong>current</strong> structure. These standards replace the
          recommended column automatically. Per-audit manual edits in the report editor still work.
        </p>
      </div>

      <section className="bg-white rounded-xl card-shadow overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60">
          <h3 className="text-sm font-semibold text-gray-900">Recommended structure by flow</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Subscription Lifecycle is included when a subscription business is detected during analysis.
          </p>
        </div>
        <div className="divide-y divide-gray-50 px-5">
          {FLOW_ORDER.map(flowName => (
            <label key={flowName} className="block py-4">
              <span className="text-sm font-medium text-gray-800">{flowName}</span>
              <textarea
                value={form[flowName] ?? ''}
                onChange={e => updateField(flowName, e.target.value)}
                rows={3}
                className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/30"
                placeholder={`Recommended structure for ${flowName}`}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
