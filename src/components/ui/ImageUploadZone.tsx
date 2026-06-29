import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import ResizableReportImage from './ResizableReportImage';

function pickImageFile(files: FileList | null | undefined): File | undefined {
  if (!files?.length) return undefined;
  const file = files[0];
  return file.type.startsWith('image/') ? file : undefined;
}

function pickImageFromClipboard(data: DataTransfer | ClipboardEvent['clipboardData']): File | undefined {
  const fromFiles = pickImageFile(data?.files);
  if (fromFiles) return fromFiles;

  if (data && 'items' in data && data.items) {
    for (const item of data.items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) return blob;
      }
    }
  }

  return undefined;
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
  imageScale?: number | null;
  onImageScaleChange?: (scale: number) => void;
  resizable?: boolean;
};

export default function ImageUploadZone({
  onFile,
  uploading = false,
  label = 'Add screenshot',
  hint = 'Drag & drop, paste with Ctrl+V, or browse',
  className,
  compact = false,
  previewUrl,
  previewAlt = 'Screenshot preview',
  onRemove,
  onPreviewClick,
  disabled = false,
  replaceLabel = 'Replace image',
  children,
  imageScale,
  onImageScaleChange,
  resizable = false,
}: ImageUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const pasteReady = focused || hovered;

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file || disabled || uploading) return;
      onFile(file);
    },
    [disabled, onFile, uploading],
  );

  const openFilePicker = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!disabled && !uploading) inputRef.current?.click();
    },
    [disabled, uploading],
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
    handleFile(pickImageFromClipboard(e.dataTransfer));
  };

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (!pasteReady || disabled || uploading) return;
      const file = pickImageFromClipboard(e.clipboardData);
      if (file) {
        e.preventDefault();
        handleFile(file);
      }
    },
    [disabled, handleFile, pasteReady, uploading],
  );

  useEffect(() => {
    if (!pasteReady) return;
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste, pasteReady]);

  if (previewUrl) {
    const canResize = resizable && !disabled && Boolean(onImageScaleChange);
    return (
      <div className={cn('space-y-3', className)}>
        <ResizableReportImage
          src={previewUrl}
          alt={previewAlt}
          scale={imageScale}
          onScaleChange={canResize ? onImageScaleChange : undefined}
          resizable={canResize}
          onClick={canResize ? undefined : onPreviewClick}
        />
        {canResize ? (
          <p className="text-[11px] text-gray-500">
            Drag the highlighted left or right edge to resize. The image stays centered in the report.
          </p>
        ) : null}
        {(onRemove || !disabled) && (
          <div className="flex flex-wrap items-center gap-3">
            {canResize && onPreviewClick ? (
              <button
                type="button"
                onClick={onPreviewClick}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-primary hover:underline"
              >
                View full size
              </button>
            ) : null}
            {!disabled && (
              <button
                type="button"
                onClick={openFilePicker}
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
    <div className={cn('space-y-2', className)}>
      <div
        ref={zoneRef}
        tabIndex={disabled || uploading ? -1 : 0}
        role="region"
        aria-label={label}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          window.setTimeout(() => {
            if (!zoneRef.current?.contains(document.activeElement)) {
              setFocused(false);
            }
          }, 0);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
          if (document.activeElement !== zoneRef.current) {
            setFocused(false);
          }
        }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => zoneRef.current?.focus()}
        className={cn(
          'flex cursor-default flex-col items-center justify-center rounded-xl border border-dashed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/30',
          compact ? 'gap-1 px-3 py-4' : 'gap-1.5 px-4 py-8',
          dragOver
            ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
            : focused
              ? 'border-brand-primary/40 bg-brand-primary/[0.03] text-gray-500'
              : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300 hover:bg-gray-100',
          (disabled || uploading) && 'cursor-not-allowed opacity-60',
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
            {!uploading && pasteReady && (
              <span className="text-center text-[10px] font-medium text-brand-primary/80">
                Ready — press Ctrl+V to paste
              </span>
            )}
          </>
        )}
      </div>

      {!uploading && !disabled && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={openFilePicker}
            className={cn(
              'inline-flex items-center gap-1.5 font-medium text-brand-primary hover:underline',
              compact ? 'text-[11px]' : 'text-xs',
            )}
          >
            <ImageIcon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
            Browse files
          </button>
        </div>
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
