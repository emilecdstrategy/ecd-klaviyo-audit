import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { getPlatformSettings, updatePlatformSettings } from '../../lib/db';
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext';
import {
  benchmarkConfigToForm,
  benchmarkFormToConfig,
  DEFAULT_BENCHMARK_CONFIG,
  type BenchmarkFormValues,
} from '../../lib/benchmarks';

type FieldDef = {
  key: keyof BenchmarkFormValues;
  label: string;
  hint?: string;
  step?: string;
};

const FIELD_GROUPS: { title: string; description: string; fields: FieldDef[] }[] = [
  {
    title: 'Engagement rates',
    description: 'Open and click rate healthy ranges for flow and campaign performance.',
    fields: [
      { key: 'openRateLow', label: 'Open rate low', step: '0.1' },
      { key: 'openRateHigh', label: 'Open rate high', step: '0.1' },
      { key: 'clickRateLow', label: 'Click rate low', step: '0.01' },
      { key: 'clickRateHigh', label: 'Click rate high', step: '0.01' },
    ],
  },
  {
    title: 'Conversion rates',
    description: 'Placed-order conversion bands by flow type and account-level weighted average.',
    fields: [
      { key: 'recoveryConvLow', label: 'Recovery conv. low', hint: 'Cart/checkout/browse abandon', step: '0.01' },
      { key: 'recoveryConvHigh', label: 'Recovery conv. high', step: '0.01' },
      { key: 'standardConvLow', label: 'Standard conv. low', hint: 'Welcome, winback, etc.', step: '0.01' },
      { key: 'standardConvHigh', label: 'Standard conv. high', step: '0.01' },
      { key: 'accountConvLow', label: 'Account weighted conv. low', step: '0.01' },
      { key: 'accountConvHigh', label: 'Account weighted conv. high', step: '0.01' },
    ],
  },
  {
    title: 'Deliverability',
    description: 'Lower is better. Healthy max is the green threshold; warning max is amber before concerning.',
    fields: [
      { key: 'bounceHealthyMax', label: 'Bounce healthy max', step: '0.01' },
      { key: 'bounceWarningMax', label: 'Bounce warning max', step: '0.01' },
      { key: 'spamHealthyMax', label: 'Spam healthy max', step: '0.001' },
      { key: 'spamWarningMax', label: 'Spam warning max', step: '0.001' },
    ],
  },
];

function BenchmarkField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: number;
  onChange: (key: keyof BenchmarkFormValues, value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{field.label}</span>
      {field.hint ? <span className="block text-[11px] text-gray-400 mt-0.5">{field.hint}</span> : null}
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          step={field.step ?? '0.01'}
          value={Number.isFinite(value) ? value : ''}
          onChange={e => onChange(field.key, parseFloat(e.target.value) || 0)}
          className="h-8 w-full rounded-lg border border-gray-200 px-2.5 text-sm tabular-nums focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/30"
        />
        <span className="text-xs text-gray-400 shrink-0">%</span>
      </div>
    </label>
  );
}

export default function BenchmarkSettingsPanel() {
  const toast = useToast();
  const { refreshSettings } = usePlatformSettings();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BenchmarkFormValues>(() => benchmarkConfigToForm());

  const reload = useCallback(async () => {
    try {
      const settings = await getPlatformSettings();
      setForm(benchmarkConfigToForm(settings.benchmarks));
    } catch {
      setForm(benchmarkConfigToForm());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const updateField = (key: keyof BenchmarkFormValues, value: number) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const resetDefaults = () => {
    setForm(benchmarkConfigToForm(DEFAULT_BENCHMARK_CONFIG));
  };

  const save = async () => {
    setSaving(true);
    try {
      const benchmarks = benchmarkFormToConfig(form);
      await updatePlatformSettings({ benchmarks });
      await refreshSettings();
      toast('Benchmark settings saved');
    } catch {
      toast('Could not save benchmark settings');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="bg-white rounded-xl px-5 py-4 card-shadow">
        <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="h-32 bg-gray-50 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl px-5 py-5 card-shadow space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Klaviyo benchmarks</p>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Platform-wide healthy ranges used in audit reports, flow tables, account snapshot cards, and AI analysis.
            Values are percentages.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetDefaults}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset defaults
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save benchmarks'}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {FIELD_GROUPS.map(group => (
          <div key={group.title} className="border-t border-gray-100 pt-6 first:border-t-0 first:pt-0">
            <p className="text-sm font-semibold text-gray-900">{group.title}</p>
            <p className="text-xs text-gray-500 mt-0.5 mb-4">{group.description}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {group.fields.map(field => (
                <BenchmarkField
                  key={field.key}
                  field={field}
                  value={form[field.key]}
                  onChange={updateField}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
