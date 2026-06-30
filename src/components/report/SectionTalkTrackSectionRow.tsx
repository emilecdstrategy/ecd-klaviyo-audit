import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { AuditSectionKey, SectionDemoMarker } from '../../lib/addon-highlight';
import { addOnItemKey, isAddOnOnSection } from '../../lib/addon-highlight';
import type { RevenueOpportunityAddOnItem } from '../../lib/types';
import { getAddOnCategoryStyles } from '../../lib/revenue-addon-categories';
import { cn } from '../../lib/utils';
import BrandedCheckbox from '../ui/BrandedCheckbox';
import HoverTooltip from '../ui/HoverTooltip';
import PresenterNoteText from './PresenterNoteText';
import { useReportEdit } from './edit/ReportEditContext';

function truncateName(name: string, max = 22): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function AddOnPicker({
  sectionKey,
  addOnItems,
  onClose,
}: {
  sectionKey: AuditSectionKey;
  addOnItems: RevenueOpportunityAddOnItem[];
  onClose: () => void;
}) {
  const { setAddOnTalkTrackForSection } = useReportEdit();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const candidates = addOnItems.filter(item => !item.is_hidden);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg"
      role="dialog"
      aria-label="Choose add-ons for this section"
    >
      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Add-ons for this section
      </p>
      {candidates.length === 0 ? (
        <p className="px-2 py-3 text-xs text-gray-500">
          Add revenue opportunities to this audit first, then assign them here.
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto">
          {candidates.map(item => {
            const key = addOnItemKey(item);
            const selected = isAddOnOnSection(item, sectionKey);
            const styles = getAddOnCategoryStyles(item.template_slug);
            return (
              <li key={key}>
                <div className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-gray-50">
                  <BrandedCheckbox
                    checked={selected}
                    onChange={checked => setAddOnTalkTrackForSection(key, sectionKey, checked)}
                    className="mt-0.5"
                    aria-label={`Discuss ${item.name} in this section`}
                  />
                  <button
                    type="button"
                    onClick={() => setAddOnTalkTrackForSection(key, sectionKey, !selected)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', styles.dotClassName)} />
                      <span className="text-xs font-medium text-gray-900">{item.name}</span>
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EditablePill({
  marker,
  sectionKey,
  onEdit,
}: {
  marker: SectionDemoMarker;
  sectionKey: AuditSectionKey;
  onEdit: () => void;
}) {
  const { setAddOnTalkTrackForSection } = useReportEdit();
  const styles = getAddOnCategoryStyles(marker.template_slug);
  const itemKey = marker.itemKey;

  return (
    <span
      className={cn(
        'inline-flex max-w-[11rem] items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 text-[11px] font-medium leading-tight',
        styles.pillClassName,
      )}
    >
      <HoverTooltip
        label={marker.name}
        description={
          marker.presenter_note?.trim() ? (
            <PresenterNoteText text={marker.presenter_note.trim()} />
          ) : undefined
        }
        align="end"
        className="min-w-0 flex-1"
      >
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5"
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', styles.dotClassName)} aria-hidden />
          <span className="truncate">{truncateName(marker.name)}</span>
        </button>
      </HoverTooltip>
      {itemKey ? (
        <button
          type="button"
          title="Remove from this section"
          onClick={() => setAddOnTalkTrackForSection(itemKey, sectionKey, false)}
          className="rounded-full p-0.5 text-current/70 hover:bg-black/5 hover:text-current"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}

function PresenterNoteEditor({
  marker,
  onClose,
}: {
  marker: SectionDemoMarker;
  onClose: () => void;
}) {
  const { updateAddOnPresenterNote } = useReportEdit();
  const [note, setNote] = useState(marker.presenter_note ?? '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  if (!marker.itemKey) return null;

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
      role="dialog"
      aria-label={`Edit note for ${marker.name}`}
    >
      <p className="text-xs font-semibold text-gray-900">{marker.name}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">Presenter note (shown on hover in the report)</p>
      <textarea
        rows={3}
        value={note}
        onChange={e => setNote(e.target.value)}
        className="mt-2 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-xs focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
        placeholder="What to mention when you reach this section…"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            updateAddOnPresenterNote(marker.itemKey!, note);
            onClose();
          }}
          className="rounded-lg bg-brand-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-primary/90"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export type SectionTalkTrackMarker = SectionDemoMarker & { itemKey?: string };

export default function SectionTalkTrackSectionRow({
  sectionKey,
  markers,
  addOnItems,
}: {
  sectionKey: AuditSectionKey;
  markers: SectionTalkTrackMarker[];
  addOnItems: RevenueOpportunityAddOnItem[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingMarker, setEditingMarker] = useState<SectionTalkTrackMarker | null>(null);

  return (
    <div className="relative mt-4 border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Discuss
        </span>
        {markers.map(marker => (
          <div key={marker.template_slug} className="relative">
            <EditablePill
              marker={marker}
              sectionKey={sectionKey}
              onEdit={() => {
                setEditingMarker(marker);
                setPickerOpen(false);
              }}
            />
            {editingMarker?.template_slug === marker.template_slug ? (
              <PresenterNoteEditor
                marker={marker}
                onClose={() => setEditingMarker(null)}
              />
            ) : null}
          </div>
        ))}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setPickerOpen(open => !open);
              setEditingMarker(null);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:border-brand-primary/40 hover:text-brand-primary"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
          {pickerOpen ? (
            <AddOnPicker
              sectionKey={sectionKey}
              addOnItems={addOnItems}
              onClose={() => setPickerOpen(false)}
            />
          ) : null}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Pick add-ons to mention in this section. Click a pill to edit the presenter note.
      </p>
    </div>
  );
}
