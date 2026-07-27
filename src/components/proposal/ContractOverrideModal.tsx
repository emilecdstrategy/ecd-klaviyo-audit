import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import Modal from '../ui/Modal';
import SimpleRichEditor from '../ui/SimpleRichEditor';

type Props = {
  open: boolean;
  /** Contract being tailored. */
  name: string;
  /** The shared catalog text, used as the starting point and for "reset". */
  defaultContent: string;
  /** Existing per-proposal override, if this contract already has one. */
  overrideContent: string | null;
  onClose: () => void;
  /** Pass null to drop the override and go back to the catalog text. */
  onSave: (content: string | null) => void;
};

/**
 * Rewrite one contract's wording for a single proposal. The shared catalog copy
 * in Settings is untouched: only this proposal sees the edit, and clearing it
 * falls straight back to the catalog text.
 */
export default function ContractOverrideModal({
  open,
  name,
  defaultContent,
  overrideContent,
  onClose,
  onSave,
}: Props) {
  const [value, setValue] = useState(overrideContent ?? defaultContent);

  // Reload whenever a different contract (or a fresh override) is opened.
  useEffect(() => {
    if (open) setValue(overrideContent ?? defaultContent);
  }, [open, overrideContent, defaultContent]);

  const isOverridden = Boolean(overrideContent);
  const unchanged = value.trim() === (overrideContent ?? defaultContent).trim();

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${name} for this proposal`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          This changes the wording for this proposal only. The shared version in Settings stays as it is, and every
          other proposal keeps using it.
          {isOverridden && ' This contract is currently using a custom version.'}
        </p>

        <SimpleRichEditor
          value={value}
          onChange={setValue}
          rows={18}
          placeholder={`Contract text for this proposal…`}
          entityTags={false}
          autoTagEntities={false}
        />

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            disabled={!isOverridden}
            onClick={() => {
              onSave(null);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to the shared version
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={unchanged}
              onClick={() => {
                // Saving text identical to the catalog copy is really a reset, so
                // do not leave a redundant override behind.
                onSave(value.trim() === defaultContent.trim() ? null : value);
                onClose();
              }}
              className="rounded-lg gradient-bg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Save for this proposal
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
