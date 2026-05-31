import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Mail, ShoppingCart, ShieldCheck, RotateCcw, Info } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { getPlatformSettings, updatePlatformSettings } from '../../lib/db';
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext';
import {
  benchmarkConfigToForm,
  benchmarkFormToConfig,
  DEFAULT_BENCHMARK_CONFIG,
  formatBenchmarkRange,
  type BenchmarkFormValues,
} from '../../lib/benchmarks';

function CompactPctInput({
  value,
  onChange,
  step = '0.1',
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: string;
  label: string;
}) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      aria-label={label}
      value={Number.isFinite(value) ? value : ''}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="h-9 w-[4.5rem] rounded-lg border border-gray-200 px-2 text-sm tabular-nums text-right focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/30"
    />
  );
}

function UsageTags({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tags.map(tag => (
        <span
          key={tag}
          className="inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function RangeRow({
  label,
  hint,
  lowKey,
  highKey,
  lowValue,
  highValue,
  onChange,
  step,
  defaultLow,
  defaultHigh,
  usedIn,
}: {
  label: string;
  hint?: string;
  lowKey: keyof BenchmarkFormValues;
  highKey: keyof BenchmarkFormValues;
  lowValue: number;
  highValue: number;
  onChange: (key: keyof BenchmarkFormValues, value: number) => void;
  step?: string;
  defaultLow: number;
  defaultHigh: number;
  usedIn?: string[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 py-3.5 border-b border-gray-50 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint ? <p className="text-xs text-gray-400 mt-0.5">{hint}</p> : null}
        {usedIn?.length ? <UsageTags tags={usedIn} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <div className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5">
          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Low</span>
          <CompactPctInput
            label={`${label} low`}
            value={lowValue}
            step={step}
            onChange={v => onChange(lowKey, v)}
          />
          <span className="text-xs text-gray-400">%</span>
          <span className="text-gray-300 mx-0.5">–</span>
          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">High</span>
          <CompactPctInput
            label={`${label} high`}
            value={highValue}
            step={step}
            onChange={v => onChange(highKey, v)}
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
        <span className="text-[11px] text-gray-400 tabular-nums shrink-0">
          Default {defaultLow.toFixed(defaultLow < 1 ? 2 : 1)}–{defaultHigh.toFixed(defaultHigh < 1 ? 2 : 1)}%
        </span>
      </div>
    </div>
  );
}

function ThresholdRow({
  label,
  hint,
  healthyKey,
  warningKey,
  healthyValue,
  warningValue,
  onChange,
  step,
  defaultHealthy,
  defaultWarning,
  usedIn,
}: {
  label: string;
  hint?: string;
  healthyKey: keyof BenchmarkFormValues;
  warningKey: keyof BenchmarkFormValues;
  healthyValue: number;
  warningValue: number;
  onChange: (key: keyof BenchmarkFormValues, value: number) => void;
  step?: string;
  defaultHealthy: number;
  defaultWarning: number;
  usedIn?: string[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 py-3.5 border-b border-gray-50 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint ? <p className="text-xs text-gray-400 mt-0.5">{hint}</p> : null}
        {usedIn?.length ? <UsageTags tags={usedIn} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <div className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5">
          <span className="text-[11px] font-medium text-emerald-600 uppercase tracking-wide">Healthy</span>
          <CompactPctInput
            label={`${label} healthy max`}
            value={healthyValue}
            step={step}
            onChange={v => onChange(healthyKey, v)}
          />
          <span className="text-xs text-gray-400">%</span>
          <span className="text-gray-300 mx-0.5">·</span>
          <span className="text-[11px] font-medium text-amber-600 uppercase tracking-wide">Warning</span>
          <CompactPctInput
            label={`${label} warning max`}
            value={warningValue}
            step={step}
            onChange={v => onChange(warningKey, v)}
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
        <span className="text-[11px] text-gray-400 tabular-nums shrink-0">
          Default &lt;{defaultHealthy.toFixed(defaultHealthy < 1 ? 3 : 1)}% / &lt;{defaultWarning.toFixed(defaultWarning < 1 ? 3 : 1)}%
        </span>
      </div>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl card-shadow overflow-hidden">
      <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 bg-gray-50/60">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border border-gray-200 text-brand-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="px-5 py-1">{children}</div>
    </section>
  );
}

const DEFAULT_FORM = benchmarkConfigToForm(DEFAULT_BENCHMARK_CONFIG);

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
      <div className="space-y-4 max-w-3xl animate-slide-up">
        <div className="h-8 w-56 bg-gray-100 rounded animate-pulse" />
        <div className="h-48 bg-white rounded-xl card-shadow animate-pulse" />
        <div className="h-48 bg-white rounded-xl card-shadow animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 animate-slide-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-brand-primary" />
            <h2 className="text-base font-semibold text-gray-900">Klaviyo benchmarks</h2>
          </div>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            Platform-wide healthy ranges for audit reports, flow performance tables, account snapshot, and AI analysis.
            Enter values as percentages.
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
            {saving ? 'Saving…' : 'Save benchmarks'}
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-800">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
        <p>
          The <strong>Deliverability Snapshot</strong> section uses Klaviyo&apos;s published recommended thresholds
          (open, click, bounce, unsubscribe, spam) and is separate from these ECD benchmark bands.
          Bounce and spam settings here apply to the Account Snapshot hygiene callout.
        </p>
      </div>

      <SectionCard
        icon={Mail}
        title="Engagement rates"
        description="Higher is better. Used to color-code open and click rates in flow tables and health score."
      >
        <RangeRow
          label="Open rate"
          hint="Apple MPP often inflates opens — interpret with caution."
          lowKey="openRateLow"
          highKey="openRateHigh"
          lowValue={form.openRateLow}
          highValue={form.openRateHigh}
          onChange={updateField}
          step="0.1"
          defaultLow={DEFAULT_FORM.openRateLow}
          defaultHigh={DEFAULT_FORM.openRateHigh}
          usedIn={['Flow table', 'Health score', 'AI prompts']}
        />
        <RangeRow
          label="Click rate"
          lowKey="clickRateLow"
          highKey="clickRateHigh"
          lowValue={form.clickRateLow}
          highValue={form.clickRateHigh}
          onChange={updateField}
          step="0.01"
          defaultLow={DEFAULT_FORM.clickRateLow}
          defaultHigh={DEFAULT_FORM.clickRateHigh}
          usedIn={['Flow table', 'Health score', 'AI prompts']}
        />
      </SectionCard>

      <SectionCard
        icon={ShoppingCart}
        title="Conversion rates"
        description="Placed-order conversion bands by flow type. Non-revenue flows (e.g. order confirmation) skip conversion."
      >
        <RangeRow
          label="Recovery flows"
          hint="Abandoned cart, checkout, browse abandonment"
          lowKey="recoveryConvLow"
          highKey="recoveryConvHigh"
          lowValue={form.recoveryConvLow}
          highValue={form.recoveryConvHigh}
          onChange={updateField}
          step="0.01"
          defaultLow={DEFAULT_FORM.recoveryConvLow}
          defaultHigh={DEFAULT_FORM.recoveryConvHigh}
          usedIn={['Flow table', 'AI prompts']}
        />
        <RangeRow
          label="Standard revenue flows"
          hint="Welcome, post-purchase, winback, etc."
          lowKey="standardConvLow"
          highKey="standardConvHigh"
          lowValue={form.standardConvLow}
          highValue={form.standardConvHigh}
          onChange={updateField}
          step="0.01"
          defaultLow={DEFAULT_FORM.standardConvLow}
          defaultHigh={DEFAULT_FORM.standardConvHigh}
          usedIn={['Flow table', 'AI prompts']}
        />
        <RangeRow
          label="Account weighted average"
          hint="Weighted conversion across all revenue flows in Account Snapshot"
          lowKey="accountConvLow"
          highKey="accountConvHigh"
          lowValue={form.accountConvLow}
          highValue={form.accountConvHigh}
          onChange={updateField}
          step="0.01"
          defaultLow={DEFAULT_FORM.accountConvLow}
          defaultHigh={DEFAULT_FORM.accountConvHigh}
          usedIn={['Account snapshot', 'AI prompts']}
        />
      </SectionCard>

      <SectionCard
        icon={ShieldCheck}
        title="Bounce & spam"
        description="Lower is better. Healthy = green, warning = amber, above warning = needs attention."
      >
        <ThresholdRow
          label="Bounce rate"
          hint="Campaign / account-level bounce in Account Snapshot hygiene"
          healthyKey="bounceHealthyMax"
          warningKey="bounceWarningMax"
          healthyValue={form.bounceHealthyMax}
          warningValue={form.bounceWarningMax}
          onChange={updateField}
          step="0.01"
          defaultHealthy={DEFAULT_FORM.bounceHealthyMax}
          defaultWarning={DEFAULT_FORM.bounceWarningMax}
          usedIn={['Account snapshot', 'AI prompts']}
        />
        <ThresholdRow
          label="Spam / complaint rate"
          healthyKey="spamHealthyMax"
          warningKey="spamWarningMax"
          healthyValue={form.spamHealthyMax}
          warningValue={form.spamWarningMax}
          onChange={updateField}
          step="0.001"
          defaultHealthy={DEFAULT_FORM.spamHealthyMax}
          defaultWarning={DEFAULT_FORM.spamWarningMax}
          usedIn={['Account snapshot', 'AI prompts']}
        />
      </SectionCard>

      <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs text-gray-500">
        <span className="font-medium text-gray-700">Preview: </span>
        Open {formatBenchmarkRange(form.openRateLow / 100, form.openRateHigh / 100)} · Click{' '}
        {formatBenchmarkRange(form.clickRateLow / 100, form.clickRateHigh / 100)} · Recovery conv.{' '}
        {formatBenchmarkRange(form.recoveryConvLow / 100, form.recoveryConvHigh / 100)}
      </div>
    </div>
  );
}
