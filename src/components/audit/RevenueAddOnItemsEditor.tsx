import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Star } from 'lucide-react';
import type { Audit, RevenueOpportunityAddOnItem, RevenueOpportunityTemplate } from '../../lib/types';
import { listRevenueOpportunityTemplates, updateAudit, uploadRevenueOpportunityImage } from '../../lib/db';
import { resolveRevenueOpportunityContent } from '../../lib/revenue-opportunity-content';
import { scheduleSavedToast, useToast } from '../ui/Toast';
import SimpleRichEditor from '../ui/SimpleRichEditor';
import ImageUploadZone from '../ui/ImageUploadZone';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../ui/select';

function normalizeItems(rawItems: unknown): RevenueOpportunityAddOnItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .filter((item): item is RevenueOpportunityAddOnItem => !!item && typeof item === 'object')
    .map((item, index) => ({
      template_slug: String(item.template_slug ?? ''),
      name: String(item.name ?? ''),
      description: item.description ? String(item.description) : undefined,
      content: resolveRevenueOpportunityContent(item),
      bullets: Array.isArray(item.bullets) ? item.bullets.map(v => String(v)) : [],
      revenue_monthly: Number(item.revenue_monthly ?? 0),
      one_time_price: item.one_time_price != null ? Number(item.one_time_price) : null,
      one_time_label: item.one_time_label ? String(item.one_time_label) : null,
      monthly_price: item.monthly_price != null ? Number(item.monthly_price) : null,
      monthly_label: item.monthly_label ? String(item.monthly_label) : null,
      image_url: item.image_url ?? null,
      details_url: item.details_url ?? null,
      is_hidden: Boolean(item.is_hidden),
      highlighted: Boolean(item.highlighted),
      related_section_keys: Array.isArray(item.related_section_keys)
        ? item.related_section_keys.map(v => String(v))
        : undefined,
      presenter_note: item.presenter_note ? String(item.presenter_note) : undefined,
      display_order: typeof item.display_order === 'number' ? item.display_order : (index + 1) * 10,
    }))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
}

export default function RevenueAddOnItemsEditor({
  audit,
  onAuditChange,
  onHighlightChanged,
}: {
  audit: Audit;
  onAuditChange: (next: Audit) => void;
  /** Fired after highlight toggle saves when audit already has AI content (post-run). */
  onHighlightChanged?: () => void;
}) {
  const [templates, setTemplates] = useState<RevenueOpportunityTemplate[]>([]);
  const [selectedTemplateSlug, setSelectedTemplateSlug] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const toast = useToast();

  const layout = useMemo(
    () => ((audit.layout as Record<string, unknown> | null | undefined) ?? {}),
    [audit.layout],
  );
  const addOnItems = useMemo(() => {
    const revenueSummary = layout.revenue_summary as Record<string, unknown> | undefined;
    const blocks = revenueSummary?.blocks as Record<string, unknown> | undefined;
    const addOns = blocks?.addOns as Record<string, unknown> | undefined;
    return normalizeItems(addOns?.items);
  }, [layout]);

  const availableTemplates = useMemo(
    () => templates.filter(template => !addOnItems.some(item => item.template_slug === template.slug)),
    [templates, addOnItems],
  );

  useEffect(() => {
    listRevenueOpportunityTemplates({ activeOnly: true })
      .then(data => {
        setTemplates(data);
        if (!selectedTemplateSlug && data.length > 0) {
          setSelectedTemplateSlug(data[0].slug);
        }
      })
      .catch(() => setTemplates([]));
  }, [selectedTemplateSlug]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  useEffect(() => {
    if (!availableTemplates.length) {
      setSelectedTemplateSlug('');
      return;
    }
    if (!availableTemplates.some(t => t.slug === selectedTemplateSlug)) {
      setSelectedTemplateSlug(availableTemplates[0].slug);
    }
  }, [availableTemplates, selectedTemplateSlug]);

  const toggleHighlighted = (index: number) => {
    const next = addOnItems.slice();
    const item = next[index];
    if (!item) return;
    next[index] = { ...item, highlighted: !item.highlighted };
    writeItems(next, { highlightChanged: true });
  };

  const writeItems = (
    nextItems: RevenueOpportunityAddOnItem[],
    opts?: { highlightChanged?: boolean },
  ) => {
    const withOrder = nextItems.map((item, index) => ({
      ...item,
      content: item.content?.trim() || resolveRevenueOpportunityContent(item),
      display_order: (index + 1) * 10,
    }));
    const revenueSummary = (layout.revenue_summary as Record<string, unknown> | undefined) ?? {};
    const blocks = (revenueSummary.blocks as Record<string, unknown> | undefined) ?? {};
    const addOns = (blocks.addOns as Record<string, unknown> | undefined) ?? {};
    const nextLayout: Record<string, unknown> = {
      ...layout,
      revenue_summary: {
        ...revenueSummary,
        blocks: {
          ...blocks,
          addOns: {
            ...addOns,
            items: withOrder,
          },
        },
      },
    };
    onAuditChange({ ...audit, layout: nextLayout });
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await updateAudit(audit.id, { layout: nextLayout });
        scheduleSavedToast(toast);
        if (
          opts?.highlightChanged &&
          onHighlightChanged &&
          audit.audit_method === 'api' &&
          String(audit.executive_summary ?? '').trim()
        ) {
          onHighlightChanged();
        }
      } catch {
        toast('Could not save');
      }
    }, 800) as unknown as number;
  };

  const handleImageUpload = async (index: number, file: File | undefined) => {
    if (!file) return;
    setUploadingIndex(index);
    try {
      const url = await uploadRevenueOpportunityImage(file);
      const next = addOnItems.slice();
      next[index] = { ...next[index], image_url: url };
      writeItems(next);
    } catch {
      toast('Image upload failed');
    } finally {
      setUploadingIndex(null);
    }
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= addOnItems.length) return;
    const next = addOnItems.slice();
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    writeItems(next);
  };

  return (
    <div className="bg-white rounded-xl p-6 card-shadow">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Add-On Opportunity Items</h3>
      <p className="text-xs text-gray-500 mb-4">
        Manage selected predefined opportunities in a dedicated section. These cards render in the report and count toward total opportunity.
      </p>

      {addOnItems.length === 0 ? (
        <div className="text-xs text-gray-500 rounded-lg border border-dashed border-gray-200 px-3 py-3">
          No add-ons selected for this audit yet.
        </div>
      ) : (
        <div className="space-y-3">
          {addOnItems.map((item, index) => (
            <div
              key={`${item.template_slug}-${index}`}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                if (dragIndex === null || dragIndex === index) return;
                const next = addOnItems.slice();
                const [moved] = next.splice(dragIndex, 1);
                next.splice(index, 0, moved);
                setDragIndex(null);
                writeItems(next);
              }}
              className={`rounded-xl border p-3.5 space-y-3 transition-colors ${dragIndex === index ? 'border-brand-primary/50 bg-brand-primary/[0.03]' : 'border-gray-100'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-gray-400">
                  <GripVertical className="w-4 h-4" />
                  <span className="text-[11px] uppercase tracking-wide font-semibold">Position {index + 1}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title={item.highlighted ? 'Remove highlight' : 'Highlight for report'}
                    aria-pressed={Boolean(item.highlighted)}
                    onClick={() => toggleHighlighted(index)}
                    className={`p-1.5 rounded border transition-colors ${
                      item.highlighted
                        ? 'border-amber-300 bg-amber-100 text-amber-700'
                        : 'border-gray-200 text-gray-400 hover:border-amber-200 hover:text-amber-600'
                    }`}
                  >
                    <Star className={`w-3.5 h-3.5 ${item.highlighted ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, -1)}
                    disabled={index === 0}
                    className="p-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Move up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, 1)}
                    disabled={index === addOnItems.length - 1}
                    className="p-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Move down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Name</label>
                  <input
                    type="text"
                    value={item.name}
                    onChange={e => {
                      const next = addOnItems.slice();
                      next[index] = { ...item, name: e.target.value };
                      writeItems(next);
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">One-time price ($)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={item.one_time_price != null && item.one_time_price > 0 ? String(item.one_time_price) : ''}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.]/g, '');
                      const next = addOnItems.slice();
                      next[index] = {
                        ...item,
                        one_time_price: raw === '' ? null : Number(raw),
                      };
                      writeItems(next);
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">One-time price note</label>
                  <input
                    type="text"
                    placeholder="e.g. Full $2,500 · Mini $500"
                    value={item.one_time_label ?? ''}
                    onChange={e => {
                      const next = addOnItems.slice();
                      next[index] = { ...item, one_time_label: e.target.value.trim() || null };
                      writeItems(next);
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Monthly retainer ($)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={item.monthly_price != null && item.monthly_price > 0 ? String(item.monthly_price) : ''}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.]/g, '');
                      const next = addOnItems.slice();
                      next[index] = {
                        ...item,
                        monthly_price: raw === '' ? null : Number(raw),
                      };
                      writeItems(next);
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Monthly price note</label>
                  <input
                    type="text"
                    placeholder="e.g. $12,000+/mo"
                    value={item.monthly_label ?? ''}
                    onChange={e => {
                      const next = addOnItems.slice();
                      next[index] = { ...item, monthly_label: e.target.value.trim() || null };
                      writeItems(next);
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Description</label>
                <input
                  type="text"
                  value={item.description ?? ''}
                  onChange={e => {
                    const next = addOnItems.slice();
                    next[index] = { ...item, description: e.target.value || undefined };
                    writeItems(next);
                  }}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Body</label>
                <SimpleRichEditor
                  value={item.content ?? ''}
                  onChange={(value) => {
                    const next = addOnItems.slice();
                    next[index] = { ...item, content: value };
                    writeItems(next);
                  }}
                  rows={4}
                  placeholder="Paragraphs or bullet lists — use the list button in the toolbar."
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Screenshot</label>
                <ImageUploadZone
                  compact
                  previewUrl={item.image_url}
                  previewAlt={`${item.name} screenshot`}
                  label={item.image_url ? 'Replace screenshot' : 'Upload screenshot'}
                  uploading={uploadingIndex === index}
                  onFile={file => handleImageUpload(index, file)}
                  onRemove={
                    item.image_url
                      ? () => {
                          const next = addOnItems.slice();
                          next[index] = { ...item, image_url: null };
                          writeItems(next);
                        }
                      : undefined
                  }
                  className="max-w-md"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Details doc URL</label>
                <input
                  type="url"
                  placeholder="https://…"
                  value={item.details_url ?? ''}
                  onChange={e => {
                    const next = addOnItems.slice();
                    next[index] = { ...item, details_url: e.target.value.trim() || null };
                    writeItems(next);
                  }}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 min-w-[220px]">
                  <div className="text-xs text-gray-700 font-medium">Show in report</div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!item.is_hidden}
                    onClick={() => {
                      const next = addOnItems.slice();
                      next[index] = { ...item, is_hidden: !item.is_hidden };
                      writeItems(next);
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${!item.is_hidden ? 'bg-brand-primary' : 'bg-gray-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${!item.is_hidden ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => writeItems(addOnItems.filter((_, rowIndex) => rowIndex !== index))}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Remove from this audit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[260px] flex-1">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Add from template</label>
          <Select value={selectedTemplateSlug || '__none__'} onValueChange={value => setSelectedTemplateSlug(value === '__none__' ? '' : value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={availableTemplates.length ? 'Pick an opportunity template' : 'All templates already added'} />
            </SelectTrigger>
            <SelectContent>
              {availableTemplates.length === 0 ? (
                <SelectItem value="__none__" disabled>
                  <SelectItemText>All templates already added</SelectItemText>
                </SelectItem>
              ) : (
                availableTemplates.map(template => (
                  <SelectItem key={template.id} value={template.slug}>
                    <SelectItemText>{template.name}</SelectItemText>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <button
          type="button"
          onClick={() => {
            const template = templates.find(t => t.slug === selectedTemplateSlug);
            if (!template) return;
            if (addOnItems.some(item => item.template_slug === template.slug)) return;
            writeItems([
              ...addOnItems,
              {
                template_slug: template.slug,
                name: template.name,
                description: template.description || undefined,
                content: template.content || resolveRevenueOpportunityContent(template),
                bullets: [],
                revenue_monthly: 0,
                one_time_price: template.one_time_price ?? null,
                one_time_label: template.one_time_label ?? null,
                monthly_price: template.monthly_price ?? null,
                monthly_label: template.monthly_label ?? null,
                image_url: template.image_url ?? null,
                details_url: template.details_url ?? null,
                is_hidden: false,
              },
            ]);
          }}
          disabled={!selectedTemplateSlug}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          Add opportunity
        </button>
      </div>
    </div>
  );
}
