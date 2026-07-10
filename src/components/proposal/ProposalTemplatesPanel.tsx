import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, LayoutTemplate } from 'lucide-react';
import Modal from '../ui/Modal';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../contexts/AuthContext';
import {
  createProposalTemplate,
  deleteProposalTemplate,
  listProposalTemplates,
} from '../../lib/proposals-db';
import type { ProposalTemplate } from '../../lib/types';

/** A brand-new template starts empty; the full-page editor fills it in. */
function blankTemplateInput(displayOrder: number): Omit<ProposalTemplate, 'id' | 'created_at' | 'updated_at'> {
  return {
    name: 'Untitled template',
    content_blocks: [{ key: 'intro', title: 'Introduction', content: '' }],
    default_line_items: [],
    default_contracts: [],
    discount_type: 'none',
    discount_value: 0,
    discount_applies_to: 'one_time',
    discount_label: null,
    is_active: true,
    display_order: displayOrder,
  };
}

export default function ProposalTemplatesPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin');
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProposalTemplate | null>(null);

  const reload = useCallback(async () => {
    setError('');
    try {
      setLoading(true);
      setTemplates(await listProposalTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openEditor = (id: string) => navigate(`/proposals/templates/${id}/edit`);

  const createNew = async () => {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const nextOrder = templates.reduce((max, t) => Math.max(max, t.display_order), 0) + 10;
      const template = await createProposalTemplate(blankTemplateInput(nextOrder));
      openEditor(template.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create template');
      setCreating(false);
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
            Starting points for new proposals: default text sections, pre-selected line items, discount, and contract toggles.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={createNew}
            disabled={creating}
            className="inline-flex shrink-0 items-center gap-1.5 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {creating ? 'Creating…' : 'New template'}
          </button>
        )}
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
                <button
                  type="button"
                  onClick={() => canEdit && openEditor(template.id)}
                  disabled={!canEdit}
                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                >
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
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditor(template.id)}
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
                )}
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
    </div>
  );
}
