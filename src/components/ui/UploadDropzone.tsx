import { Upload, X, Image } from 'lucide-react';
import { useCallback, useState } from 'react';

interface UploadDropzoneProps {
  label: string;
  description?: string;
  files: File[];
  onFilesChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
}

export default function UploadDropzone({
  label,
  description,
  files,
  onFilesChange,
  accept = 'image/*',
  multiple = true,
}: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      onFilesChange(multiple ? [...files, ...dropped] : dropped.slice(0, 1));
    },
    [files, multiple, onFilesChange],
  );

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    onFilesChange(multiple ? [...files, ...selected] : selected.slice(0, 1));
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        {files.length > 0 && (
          <span className="text-xs text-gray-400">{files.length} file{files.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
          isDragging
            ? 'border-brand-primary bg-brand-primary/5'
            : 'border-gray-200 hover:border-gray-300 bg-gray-50/50'
        }`}
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleSelect}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        <Upload className={`w-6 h-6 mx-auto mb-2 ${isDragging ? 'text-brand-primary' : 'text-gray-300'}`} />
        <p className="text-sm text-gray-600">
          <span className="font-medium text-brand-primary">Click to upload</span> or drag and drop
        </p>
        {description && <p className="text-xs text-gray-400 mt-1">{description}</p>}
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 bg-white rounded-lg border border-gray-100">
              <Image className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-700 truncate flex-1">{file.name}</span>
              <span className="text-xs text-gray-400 shrink-0">
                {(file.size / 1024).toFixed(0)}KB
              </span>
              <button onClick={() => removeFile(i)} className="p-1 hover:bg-gray-100 rounded transition-colors">
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
