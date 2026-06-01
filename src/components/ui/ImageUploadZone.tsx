import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

function pickImageFile(files: FileList | null | undefined): File | undefined {
  if (!files?.length) return undefined;
  const file = files[0];
  return file.type.startsWith('image/') ? file : undefined;
}

export type ImageUploadZoneProps = {
  onFile: (file: File) => void;
  uploading?: boolean;
  label?: string;
  hint?: string;
  className?: string;
  compact?: boolean;
  previewUrl?: string | null;
  previewAlt?: string;
  onRemove?: () => void;
  onPreviewClick?: () => void;
  disabled?: boolean;
  replaceLabel?: string;
  children?: ReactNode;
};

export default function ImageUploadZone({
  onFile,
  uploading = false,
  label = 'Add screenshot',
  hint = 'Click to upload, drag & drop, or paste (Ctrl+V)',
  className,
  compact = false,
  previewUrl,
  previewAlt = 'Screenshot preview',
  onRemove,
  onPreviewClick,
  disabled = false,
  replaceLabel = 'Replace image',
  children,
}: ImageUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteActive, setPasteActive] = useState(false);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file || disabled || uploading) return;
      onFile(file);
    },
    [disabled, onFile, uploading],
  );

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !uploading) setDragOver(true);
  };

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!zoneRef.current?.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    handleFile(pickImageFile(e.dataTransfer.files));
  };

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (!pasteActive || disabled || uploading) return;
      const file = pickImageFile(e.clipboardData?.files);
      if (file) {
        e.preventDefault();
        handleFile(file);
      }
    },
    [disabled, handleFile, pasteActive, uploading],
  );

  useEffect(() => {
    if (!pasteActive) return;
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste, pasteActive]);

  if (previewUrl) {
    return (
      <div className={cn('space-y-3', className)}>
        <button
          type="button"
          onClick={onPreviewClick}
          className="relative block w-full overflow-hidden rounded-xl border border-gray-100 bg-gray-50"
          aria-label={previewAlt}
        >
          <img src={previewUrl} alt={previewAlt} className="block w-full h-auto object-contain" />
        </button>
        {(onRemove || !disabled) && (
          <div className="flex flex-wrap items-center gap-3">
            {!disabled && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                {uploading ? 'Uploading…' : replaceLabel}
              </button>
            )}
            {onRemove && !disabled && (
              <button
                type="button"
                onClick={onRemove}
                disabled={uploading}
                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={disabled || uploading}
              onChange={e => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={zoneRef}
      tabIndex={disabled || uploading ? -1 : 0}
      role="button"
      aria-label={label}
      onFocus={() => setPasteActive(true)}
      onBlur={() => {
        window.setTimeout(() => {
          if (!zoneRef.current?.contains(document.activeElement)) {
            setPasteActive(false);
          }
        }, 0);
      }}
      onMouseEnter={() => setPasteActive(true)}
      onMouseLeave={() => {
        if (document.activeElement !== zoneRef.current) {
          setPasteActive(false);
        }
      }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onClick={() => {
        if (!disabled && !uploading) inputRef.current?.click();
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/30',
        compact ? 'gap-1 px-3 py-4' : 'gap-1.5 px-4 py-8',
        dragOver
          ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
          : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300 hover:bg-gray-100',
        (disabled || uploading) && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      {children ?? (
        <>
          <ImageIcon className={cn(compact ? 'h-4 w-4' : 'h-5 w-5')} />
          <span className={cn('font-medium text-center', compact ? 'text-[11px]' : 'text-xs')}>
            {uploading ? 'Uploading…' : label}
          </span>
          {!uploading && (
            <span className={cn('text-center text-gray-400', compact ? 'text-[10px]' : 'text-[11px]')}>
              {hint}
            </span>
          )}
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled || uploading}
        onChange={e => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
