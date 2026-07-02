import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, LayoutTemplate, ChevronDown, FileText } from 'lucide-react';
import Modal from '../ui/Modal';
import EmptyState from '../ui/EmptyState';
import SimpleRichEditor from '../ui/SimpleRichEditor';
import BrandedCheckbox from '../ui/BrandedCheckbox';
import { useToast } from '../ui/Toast';
import {
  createProposalTemplate,
  deleteProposalTemplate,
  listContractDocuments,
  listProposalTemplates,
  updateProposalTemplate,
} from '../../lib/proposals-db';
import { listRevenueOpportunityTemplates } from '../../lib/db';
import { formatCurrency } from '../../lib/revenue-calculator';
import type {
  ContractDocument,
  ProposalBlock,
  ProposalTemplate,
  ProposalTemplateLineItem,
  RevenueOpportunityTemplate,
} from '../../lib/types';

type DraftTemplate = Omit<ProposalTemplate, 'id' | 'created_at' | 'updated_at'> & { id?: string };

const EMPTY_DRAFT: DraftTemplate = {
  name: '',
  content_blocks: [
    { key: 'intro', title: 'Introduction', content: '' },
  ],
  default_line_items: [],
  default_contracts: [],
  is_active: true,
  display_order: 0,
};

function blockKey(): string {
  return `block_${Math.random().toString(36).slice(2, 9)}`;
}

function lineItemFromCatalog(t: RevenueOpportunityTemplate, order: number): ProposalTemplateLineItem {
  return {
    template_slug: t.slug,
    name: t.name,
    description: t.description,
    content: t.content ?? '',
    one_time_price: t.one_time_price ?? null,
    one_time_label: t.one_time_label ?? null,
    monthly_price: t.monthly_price ?? null,
    monthly_label: t.monthly_label ?? null,
    image_url: t.image_url ?? null,
    display_order: order,
  };
}

function lineItemPriceSummary(item: ProposalTemplateLineItem): string {
  const parts: string[] = [];
  if (item.one_time_price) parts.push(formatCurrency(Number(item.one_time_price)));
  else if (item.one_time_label) parts.push(item.one_time_label);
  if (item.monthly_price) parts.push(`${formatCurrency(Number(item.monthly_price))}/mo`);
  else if (item.monthly_label) parts.push(`${item.monthly_label}/mo`);
  return parts.length ? parts.join(' + ') : 'No pricing';
}

export default function ProposalTemplatesPanel() {
  const toast = useToast();
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [contractDocs, setContractDocs] = useState<ContractDocument[]>([]);
  const [catalog, setCatalog] = useState<RevenueOpportunityTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProposalTemplate | null>(null);
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);

  const reload = useCallback(async () => {
    setError('');
    try {
      setLoading(true);
      const [t, docs, cat] = await Promise.all([
        listProposalTemplates(),
        listContractDocuments(),
        listRevenueOpportunityTemplates({ activeOnly: true }),
      ]);
      setTemplates(t);
      setContractDocs(docs);
      setCatalog(cat);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openNew = () => {
    const nextOrder = templates.reduce((max, t) => Math.max(max, t.display_order), 0) + 10;
    setDraft({ ...EMPTY_DRAFT, display_order: nextOrder });
  };

  const openEdit = (template: ProposalTemplate) => {
    setDraft({
      id: template.id,
      name: template.name,
      content_blocks: template.content_blocks.map(b => ({ ...b })),
      default_line_items: template.default_line_items.map(i => ({ ...i })),
      default_contracts: [...template.default_contracts],
      is_active: template.is_active,
      display_order: template.display_order,
    });
  };

  const updateDraftBlock = (index: number, patch: Partial<ProposalBlock>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const blocks = prev.content_blocks.map((b, i) => (i === index ? { ...b, ...patch } : b));
      return { ...prev, content_blocks: blocks };
    });
  };

  const moveDraftBlock = (index: number, dir: -1 | 1) => {
    setDraft(prev => {
      if (!prev) return prev;
      const target = index + dir;
      if (target < 0 || target >= prev.content_blocks.length) return prev;
      const blocks = [...prev.content_blocks];
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return { ...prev, content_blocks: blocks };
    });
  };

  const updateDraftItem = (index: number, patch: Partial<ProposalTemplateLineItem>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const items = prev.default_line_items.map((it, i) => (i === index ? { ...it, ...patch } : it));
      return { ...prev, default_line_items: items };
    });
  };

  const moveDraftItem = (index: number, dir: -1 | 1) => {
    setDraft(prev => {
      if (!prev) return prev;
      const target = index + dir;
      if (target < 0 || target >= prev.default_line_items.length) return prev;
      const items = [...prev.default_line_items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...prev, default_line_items: items.map((it, i) => ({ ...it, display_order: (i + 1) * 10 })) };
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setError('Template name is required');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const payload = {
        name,
        content_blocks: draft.content_blocks.filter(b => b.title.trim() || b.content.trim()),
        default_line_items: draft.default_line_items.map((it, i) => ({ ...it, display_order: (i + 1) * 10 })),
        default_contracts: draft.default_contracts,
        is_active: draft.is_active,
        display_order: draft.display_order,
      };
      if (draft.id) {
        await updateProposalTemplate(draft.id, payload);
      } else {
        await createProposalTemplate(payload);
      }
      setDraft(null);
      toast('Template saved');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (template: ProposalTemplate) => {
    setDeletingId(template.id);
    try {
      await deleteProposalTemplate(template.id);
      setConfirmDelete(null);
      toast('Template deleted');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-slide-up">
        <div className="h-20 bg-white rounded-xl card-shadow animate-pulse" />
        <div className="h-20 bg-white rounded-xl card-shadow animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Proposal Templates</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Starting points for new proposals: default text sections, pre-selected line items, and contract toggles.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex shrink-0 items-center gap-1.5 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          New template
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>}

      {templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No proposal templates"
          description="Create a template so new proposals start with your standard intro, terms, and services."
        />
      ) : (
        <div className="space-y-3">
          {templates.map(template => (
            <div key={template.id} className="bg-white rounded-xl card-shadow px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                  <LayoutTemplate className="h-4 w-4" />
                </div>
                <button type="button" onClick={() => openEdit(template)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{template.name}</p>
                    {!template.is_active && (
                      <span className="shrink-0 inline-flex rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {template.content_blocks.length} text section{template.content_blocks.length === 1 ? '' : 's'}
                    {' · '}
                    {template.default_line_items.length} line item{template.default_line_items.length === 1 ? '' : 's'}
                    {template.default_contracts.length > 0 && (
                      <span className="text-gray-400"> · {template.default_contracts.length} contract{template.default_contracts.length === 1 ? '' : 's'}</span>
                    )}
                  </p>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(template)}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(template)}
                    disabled={deletingId === template.id}
                    className="p-1.5 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                    title="Delete template"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-600" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      <Modal
        open={Boolean(confirmDelete)}
        title="Delete template?"
        onClose={() => setConfirmDelete(null)}
        className="max-w-lg"
      >
        <div className="p-5">
          <p className="text-sm text-gray-700">
            Delete “{confirmDelete?.name}”? Existing proposals are not affected.
          </p>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!confirmDelete || deletingId === confirmDelete?.id}
              onClick={() => confirmDelete && removeTemplate(confirmDelete)}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {deletingId ? 'Deleting…' : 'Delete template'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Template editor modal */}
      <Modal
        open={Boolean(draft)}
        title={draft?.id ? 'Edit Template' : 'New Template'}
        onClose={() => (saving ? undefined : setDraft(null))}
        className="max-w-3xl"
      >
        {draft && (
          <div className="p-5 space-y-5">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">Template name</label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={e => setDraft(prev => (prev ? { ...prev, name: e.target.value } : prev))}
                  placeholder="Standard Proposal"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm text-gray-700 cursor-pointer select-none">
                <BrandedCheckbox
                  checked={draft.is_active}
                  onChange={checked => setDraft(prev => (prev ? { ...prev, is_active: checked } : prev))}
                />
                Active
              </label>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-medium text-gray-500">Text sections</label>
                <button
                  type="button"
                  onClick={() =>
                    setDraft(prev =>
                      prev
                        ? {
                            ...prev,
                            content_blocks: [
                              ...prev.content_blocks,
                              { key: blockKey(), title: '', content: '' },
                            ],
                          }
                        : prev,
                    )
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline"
                >
                  <Plus className="w-3 h-3" /> Add section
                </button>
              </div>
              <div className="space-y-3">
                {draft.content_blocks.map((block, index) => (
                  <div key={block.key} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={block.title}
                        onChange={e => updateDraftBlock(index, { title: e.target.value })}
                        placeholder="Section title (e.g. Introduction)"
                        className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                      />
                      <button
                        type="button"
                        onClick={() => moveDraftBlock(index, -1)}
                        disabled={index === 0}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-40"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDraftBlock(index, 1)}
                        disabled={index === draft.content_blocks.length - 1}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-40"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft(prev =>
                            prev
                              ? { ...prev, content_blocks: prev.content_blocks.filter((_, i) => i !== index) }
                              : prev,
                          )
                        }
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <SimpleRichEditor
                      value={block.content}
                      onChange={value => updateDraftBlock(index, { content: value })}
                      rows={3}
                      placeholder="Section content shown on every proposal created from this template."
                      entityTags={false}
                      autoTagEntities={false}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-medium text-gray-500">Default line items</label>
                <button
                  type="button"
                  onClick={() => setCatalogPickerOpen(v => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline"
                >
                  <Plus className="w-3 h-3" /> Add from catalog
                  <ChevronDown className={`w-3 h-3 transition-transform ${catalogPickerOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {catalogPickerOpen && (
                <div className="mb-3 rounded-lg border border-gray-200 bg-white p-2 max-h-52 overflow-y-auto space-y-1">
                  {catalog.length === 0 ? (
                    <p className="text-xs text-gray-400 px-2 py-1.5">
                      No services in the catalog yet — add them under Settings → Revenue Opportunities.
                    </p>
                  ) : (
                    catalog.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setDraft(prev =>
                            prev
                              ? {
                                  ...prev,
                                  default_line_items: [
                                    ...prev.default_line_items,
                                    lineItemFromCatalog(t, (prev.default_line_items.length + 1) * 10),
                                  ],
                                }
                              : prev,
                          );
                          setCatalogPickerOpen(false);
                        }}
                        className="w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left hover:bg-gray-50"
                      >
                        <span className="text-sm text-gray-800 truncate">{t.name}</span>
                        <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                          {lineItemPriceSummary(lineItemFromCatalog(t, 0))}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {draft.default_line_items.length === 0 ? (
                <p className="text-xs text-gray-400 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center">
                  No default line items. Proposals from this template start with an empty pricing table.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {draft.default_line_items.map((item, index) => (
                    <div
                      key={`${item.template_slug ?? 'custom'}-${index}`}
                      className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2"
                    >
                      <FileText className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      <input
                        type="text"
                        value={item.name}
                        onChange={e => updateDraftItem(index, { name: e.target.value })}
                        className="flex-1 min-w-0 bg-transparent text-sm text-gray-800 focus:outline-none"
                      />
                      <span className="text-xs text-gray-400 shrink-0 tabular-nums">{lineItemPriceSummary(item)}</span>
                      <button
                        type="button"
                        onClick={() => moveDraftItem(index, -1)}
                        disabled={index === 0}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-400 hover:bg-white disabled:opacity-30"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDraftItem(index, 1)}
                        disabled={index === draft.default_line_items.length - 1}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-400 hover:bg-white disabled:opacity-30"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft(prev =>
                            prev
                              ? {
                                  ...prev,
                                  default_line_items: prev.default_line_items.filter((_, i) => i !== index),
                                }
                              : prev,
                          )
                        }
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-gray-400">
                Prices come from the Revenue Opportunities catalog and can be adjusted per proposal.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Contracts included by default</label>
              <div className="flex flex-wrap gap-2">
                {contractDocs.map(doc => {
                  const included = draft.default_contracts.includes(doc.slug);
                  return (
                    <button
                      key={doc.slug}
                      type="button"
                      onClick={() =>
                        setDraft(prev =>
                          prev
                            ? {
                                ...prev,
                                default_contracts: included
                                  ? prev.default_contracts.filter(s => s !== doc.slug)
                                  : [...prev.default_contracts, doc.slug],
                              }
                            : prev,
                        )
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        included
                          ? 'border-brand-primary/30 bg-brand-primary/10 text-brand-primary'
                          : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {doc.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                disabled={saving}
                onClick={() => setDraft(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveDraft}
                className="px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
