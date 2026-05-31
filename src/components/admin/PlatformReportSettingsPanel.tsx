import { useCallback, useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../ui/select';
import { useToast } from '../ui/Toast';
import { getPlatformSettings, updatePlatformSettings } from '../../lib/db';
import {
  ENTITY_HIGHLIGHT_DESCRIPTIONS,
  ENTITY_HIGHLIGHT_LABELS,
  ENTITY_HIGHLIGHT_STYLES,
  ENTITY_HIGHLIGHT_SWATCHES,
  type EntityHighlightStyle,
} from '../../lib/entity-highlight-styles';
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext';
import BenchmarkSettingsPanel from './BenchmarkSettingsPanel';

export default function PlatformReportSettingsPanel() {
  const toast = useToast();
  const { refreshSettings } = usePlatformSettings();
  const [loaded, setLoaded] = useState(false);
  const [annotationSize, setAnnotationSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [annotationsExpanded, setAnnotationsExpanded] = useState(false);
  const [entityHighlightStyle, setEntityHighlightStyle] = useState<EntityHighlightStyle>('purple');

  const reload = useCallback(async () => {
    try {
      const settings = await getPlatformSettings();
      setAnnotationSize(settings.annotation_size);
      setAnnotationsExpanded(settings.annotations_expanded);
      setEntityHighlightStyle(settings.entity_highlight_style);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveAnnotationSize = async (v: 'sm' | 'md' | 'lg') => {
    setAnnotationSize(v);
    try {
      await updatePlatformSettings({ annotation_size: v });
      await refreshSettings();
      toast('Annotation size saved');
    } catch {
      toast('Could not save annotation size');
    }
  };

  const saveAnnotationsExpanded = async (v: boolean) => {
    setAnnotationsExpanded(v);
    try {
      await updatePlatformSettings({ annotations_expanded: v });
      await refreshSettings();
      toast(v ? 'Labels always visible' : 'Labels show on hover');
    } catch {
      toast('Could not save annotation setting');
    }
  };

  const saveEntityHighlightStyle = async (v: EntityHighlightStyle) => {
    setEntityHighlightStyle(v);
    try {
      await updatePlatformSettings({ entity_highlight_style: v });
      await refreshSettings();
      toast(v === 'disabled' ? 'Asset highlighting disabled' : `${ENTITY_HIGHLIGHT_LABELS[v]} highlight saved`);
    } catch {
      toast('Could not save highlight style');
    }
  };

  if (!loaded) {
    return (
      <div className="bg-white rounded-xl px-5 py-4 card-shadow">
        <div className="h-4 w-40 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="h-20 bg-gray-50 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl animate-slide-up">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Report display</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Platform-wide settings for published and backend audit reports.
        </p>
      </div>

      <div className="bg-white rounded-xl px-5 py-5 card-shadow space-y-6">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Email design annotations</p>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600 shrink-0">Marker size</label>
              <Select value={annotationSize} onValueChange={v => saveAnnotationSize(v as 'sm' | 'md' | 'lg')}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sm"><SelectItemText>Small</SelectItemText></SelectItem>
                  <SelectItem value="md"><SelectItemText>Medium</SelectItemText></SelectItem>
                  <SelectItem value="lg"><SelectItemText>Large</SelectItemText></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={annotationsExpanded}
                onClick={() => saveAnnotationsExpanded(!annotationsExpanded)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${annotationsExpanded ? 'bg-brand-primary' : 'bg-gray-200'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${annotationsExpanded ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <span className="text-xs font-medium text-gray-600">Always show annotation labels</span>
            </label>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Klaviyo asset highlight color</p>
          <p className="text-sm text-gray-500 mt-1 mb-4">
            How flow, segment, and campaign names are highlighted in audit copy across all reports.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ENTITY_HIGHLIGHT_STYLES.map(style => {
              const selected = entityHighlightStyle === style;
              const swatch = style === 'disabled' ? null : ENTITY_HIGHLIGHT_SWATCHES[style];
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => saveEntityHighlightStyle(style)}
                  className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    selected
                      ? 'border-brand-primary bg-brand-primary/5 ring-1 ring-brand-primary/20'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {swatch ? (
                    <span
                      className="inline-flex shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium mt-0.5"
                      style={{
                        backgroundColor: swatch.bg,
                        borderColor: swatch.border,
                        color: swatch.text,
                      }}
                    >
                      Abandoned Cart
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 rounded-md border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 mt-0.5">
                      Abandoned Cart
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">{ENTITY_HIGHLIGHT_LABELS[style]}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{ENTITY_HIGHLIGHT_DESCRIPTIONS[style]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <BenchmarkSettingsPanel />
    </div>
  );
}
