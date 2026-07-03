import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Plus, Code, Pencil, Trash2, X } from 'lucide-react';
import { IndustrySelectWithCustom } from '../ui/IndustrySelect';
import AnnotationLayer from '../audit/AnnotationLayer';
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext';
import {
  listIndustryEmailLibrary,
  createIndustryEmail,
  updateIndustryEmail,
  deleteIndustryEmail,
} from '../../lib/db';
import { supabase } from '../../lib/supabase';
import type { IndustryEmailLibrary } from '../../lib/types';

export default function EmailLibraryPanel() {
  const { settings: platformSettings } = usePlatformSettings();
  const [entries, setEntries] = useState<IndustryEmailLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingEntry, setEditingEntry] = useState<IndustryEmailLibrary | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [formIndustry, setFormIndustry] = useState('');
  const [formName, setFormName] = useState('');
  const [formContentType, setFormContentType] = useState<'image' | 'html'>('image');
  const [formHtml, setFormHtml] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formAnnotations, setFormAnnotations] = useState<Array<{ x: number; y: number; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listIndustryEmailLibrary();
      setEntries(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const resetForm = () => {
    setFormIndustry('');
    setFormName('');
    setFormContentType('html');
    setFormHtml('');
    setFormImageUrl('');
    setFormAnnotations([]);
    setEditingEntry(null);
    setShowForm(false);
  };

  const openEditForm = (entry: IndustryEmailLibrary) => {
    setEditingEntry(entry);
    setFormIndustry(entry.industry);
    setFormName(entry.name);
    setFormContentType(entry.content_type);
    setFormHtml(entry.html_content || '');
    setFormImageUrl(entry.image_url || '');
    setFormAnnotations(entry.default_annotations || []);
    setShowForm(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `email-library/${crypto.randomUUID()}_${safeName}`;
      const { error } = await supabase.storage.from('audit-assets').upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('audit-assets').getPublicUrl(path);
      setFormImageUrl(data.publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    setError('');
    if (!formIndustry.trim()) { setError('Industry is required'); return; }
    if (formContentType === 'image' && !formImageUrl.trim()) { setError('Please upload an image'); return; }
    if (formContentType === 'html' && !formHtml.trim()) { setError('Please paste the HTML'); return; }
    try {
      setSaving(true);
      const payload = {
        industry: formIndustry.trim(),
        name: formName.trim() || formIndustry.trim(),
        content_type: formContentType,
        html_content: formContentType === 'html' ? formHtml : null,
        image_url: formContentType === 'image' ? formImageUrl : null,
        default_annotations: formAnnotations,
      };
      if (editingEntry) {
        await updateIndustryEmail(editingEntry.id, payload);
      } else {
        await createIndustryEmail(payload as any);
      }
      resetForm();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteIndustryEmail(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const fakeAnnotations = formAnnotations.map((a, i) => ({
    id: `temp-${i}`,
    audit_section_id: '',
    asset_id: '',
    x_position: a.x,
    y_position: a.y,
    label: a.label,
    side: 'optimized' as const,
    created_at: '',
  }));

  const handleAddAnnotation = (_x: number, _y: number, label: string) => {
    setFormAnnotations(prev => [...prev, { x: _x, y: _y, label }]);
  };

  const handleRemoveAnnotation = (id: string) => {
    const idx = parseInt(id.replace('temp-', ''), 10);
    setFormAnnotations(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Industry Email Library</h2>
          <p className="text-sm text-gray-500 mt-0.5">Upload ECD benchmark emails for each industry. These are shown on audit reports next to the client's actual email.</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
          Add Example
        </button>
        )}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-xl p-6 card-shadow space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">{editingEntry ? 'Edit Example' : 'New Industry Example'}</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              <IndustrySelectWithCustom value={formIndustry} onValueChange={setFormIndustry} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="e.g. Welcome Series Best Practice"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormContentType('html')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${formContentType === 'html' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              >
                <Code className="w-4 h-4" /> HTML Paste
              </button>
              <button
                type="button"
                onClick={() => setFormContentType('image')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${formContentType === 'image' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              >
                <ImageIcon className="w-4 h-4" /> Image Upload
              </button>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs text-gray-500 leading-relaxed">
            {formContentType === 'html' ? (
              <>
                <p className="font-medium text-gray-700 mb-1">How to get the email HTML:</p>
                <ol className="list-decimal ml-4 space-y-0.5">
                  <li>Install the <a href="https://chromewebstore.google.com/detail/save-email-template-by-se/abokklkondgpdlcajcjiobegghjfccih" target="_blank" rel="noreferrer" className="text-brand-primary underline">Save Email Template</a> Chrome extension</li>
                  <li>Send a test email to yourself and open it in Gmail</li>
                  <li>In Gmail, click the three dots (<strong>⋮</strong>) and select <strong>Show original</strong></li>
                  <li>Click the extension icon, then <strong>Capture from Gmail</strong>, then <strong>Download HTML</strong></li>
                  <li>Open the downloaded HTML file in a text editor, select all the code, and paste it below</li>
                </ol>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-700 mb-1">How to get the email screenshot:</p>
                <ol className="list-decimal ml-4 space-y-0.5">
                  <li>Install the <a href="https://chromewebstore.google.com/detail/save-email-template-by-se/abokklkondgpdlcajcjiobegghjfccih" target="_blank" rel="noreferrer" className="text-brand-primary underline">Save Email Template</a> Chrome extension</li>
                  <li>Send a test email to yourself and open it in Gmail</li>
                  <li>In Gmail, click the three dots (<strong>⋮</strong>) and select <strong>Show original</strong></li>
                  <li>Click the extension icon, then <strong>Capture from Gmail</strong>, then <strong>Download Image</strong></li>
                  <li>Upload the downloaded image below</li>
                </ol>
              </>
            )}
          </div>

          {formContentType === 'image' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Screenshot</label>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              {formImageUrl ? (
                <div className="space-y-2">
                  <img src={formImageUrl} alt="Preview" className="max-h-64 rounded-lg border border-gray-100" />
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs text-brand-primary font-medium hover:underline">
                    {uploading ? 'Uploading...' : 'Replace image'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full py-8 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-400 hover:border-brand-primary hover:text-brand-primary transition-colors"
                >
                  {uploading ? 'Uploading...' : 'Click to upload image'}
                </button>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email HTML</label>
              <textarea
                value={formHtml}
                onChange={e => setFormHtml(e.target.value)}
                rows={8}
                placeholder="Paste the full email HTML here..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-y"
              />
            </div>
          )}

          {((formContentType === 'image' && formImageUrl) || (formContentType === 'html' && formHtml)) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Annotations ({formAnnotations.length}). Click on the preview to place pins.
              </label>

              <div className="max-w-md mx-auto">
                <AnnotationLayer
                  imageUrl={formContentType === 'image' ? formImageUrl : undefined}
                  htmlContent={formContentType === 'html' ? formHtml : undefined}
                  annotations={fakeAnnotations}
                  onAddAnnotation={handleAddAnnotation}
                  onRemoveAnnotation={handleRemoveAnnotation}
                  editable
                  side="optimized"
                  markerSize={platformSettings.annotation_size}
                  alwaysShowLabels={platformSettings.annotations_expanded}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingEntry ? 'Update' : 'Save'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl p-8 card-shadow text-center text-sm text-gray-400">Loading...</div>
      ) : entries.length === 0 && !showForm ? (
        <div className="bg-white rounded-xl p-8 card-shadow text-center">
          <ImageIcon className="w-10 h-10 text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No benchmark emails yet. Add your first industry example above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map(entry => (
            <div key={entry.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden card-shadow group">
              <div
                className="h-48 bg-gray-50 overflow-y-auto relative cursor-pointer hover:ring-2 hover:ring-brand-primary/30 transition-shadow"
                onClick={() => openEditForm(entry)}
              >
                {entry.content_type === 'image' && entry.image_url ? (
                  <img src={entry.image_url} alt={entry.name} className="w-full object-cover object-top" />
                ) : entry.content_type === 'html' && entry.html_content ? (
                  <iframe srcDoc={entry.html_content} sandbox="allow-same-origin" className="w-full border-0 pointer-events-none" scrolling="no" style={{ height: 1200, overflow: 'hidden' }} title={entry.name} />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-gray-300">No preview</div>
                )}
              </div>
              <div className="px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">{entry.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{entry.industry} · {entry.content_type === 'html' ? 'HTML' : 'Image'} · {entry.default_annotations?.length || 0} annotations</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => openEditForm(entry)} className="text-xs text-brand-primary font-medium hover:underline inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit</button>
                  <button onClick={() => handleDelete(entry.id)} className="text-xs text-red-500 font-medium hover:underline inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>
      </div>
    </div>
      </div>
          ))}
      </div>
      )}
    </div>
  );
}
