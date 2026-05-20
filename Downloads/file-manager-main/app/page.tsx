'use client';
import { useState, useRef, DragEvent, ChangeEvent, useEffect } from 'react';

const API_BASE = 'https://2zhsad3hab.execute-api.us-east-1.amazonaws.com/prod';
const CHUNK_SIZE = 10 * 1024 * 1024;

interface S3File { key: string; filename: string; size: number; lastModified: string; }
interface Folder { key: string; name: string; }
interface UploadItem { file: File; progress: number; speed: string; status: 'queued' | 'uploading' | 'done' | 'error'; error?: string; }

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type ThumbConfig = { bg: string; iconColor: string; icon: React.ReactNode };

function FileThumbIcon({ filename, size = 48 }: { filename: string; size?: number }) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const s = size;

  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#d4a574" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"/></svg>;

  if (['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(ext))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;

  if (ext === 'pdf')
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15v-4"/><path d="M12 15v-6"/><path d="M15 15v-2"/></svg>;

  if (['xlsx', 'xls', 'csv'].includes(ext))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;

  if (['docx', 'doc'].includes(ext))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;

  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
}

function getThumbBg(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'bg-gray-900';
  if (['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(ext)) return 'bg-purple-950';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return 'bg-blue-50';
  if (ext === 'pdf') return 'bg-red-50';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'bg-green-50';
  if (['docx', 'doc'].includes(ext)) return 'bg-blue-50';
  return 'bg-gray-100';
}

function SmallFileIcon({ filename }: { filename: string }) {
  return <FileThumbIcon filename={filename} size={16} />;
}

const FOLDER_COLORS = ['text-blue-500', 'text-amber-700', 'text-green-700', 'text-red-600', 'text-purple-600'];
function isLargeFile(size: number) { return size > 10 * 1024 * 1024; }

export default function FileManager() {
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<S3File[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolder, setCurrentFolder] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async (folder = '') => {
    try {
      setLoadingFiles(true);
      const url = folder ? `${API_BASE}/list-files?folder=${encodeURIComponent(folder)}` : `${API_BASE}/list-files`;
      const res = await fetch(url);
      const data = await res.json();
      setFiles(data.files || []);
      setFolders(data.folders || []);
    } catch (err) { console.error(err); }
    finally { setLoadingFiles(false); }
  };

  useEffect(() => { fetchFiles(''); }, []);

  const navigateToFolder = (name: string) => { setCurrentFolder(name); fetchFiles(name); setUploadItems([]); };
  const handleFiles = (fl: FileList) => setUploadItems(Array.from(fl).map(f => ({ file: f, progress: 0, speed: '', status: 'queued' })));
  const handleDrop = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); };
  const updateItem = (i: number, u: Partial<UploadItem>) => setUploadItems(p => p.map((x, j) => j === i ? { ...x, ...u } : x));

  const uploadRegular = async (file: File, idx: number) => {
    const t0 = Date.now();
    const r = await fetch(`${API_BASE}/get-upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', folder: currentFolder }) });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const { uploadUrl } = await r.json();
    await new Promise<void>((res, rej) => {
      const x = new XMLHttpRequest(); x.open('PUT', uploadUrl); x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      x.upload.onprogress = e => { if (!e.lengthComputable) return; updateItem(idx, { progress: Math.round(e.loaded / e.total * 100), speed: formatBytes(e.loaded / ((Date.now() - t0) / 1000)) + '/s' }); };
      x.onload = () => x.status < 300 ? res() : rej(new Error(`S3 ${x.status}`)); x.onerror = () => rej(new Error('Network')); x.send(file);
    });
  };

  const uploadMultipart = async (file: File, idx: number) => {
    const t0 = Date.now();
    const cr = await fetch(`${API_BASE}/create-multipart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', folder: currentFolder }) });
    if (!cr.ok) throw new Error('create-multipart failed');
    const { uploadId, key } = await cr.json();
    const pc = Math.ceil(file.size / CHUNK_SIZE);
    const ur = await fetch(`${API_BASE}/get-part-urls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, uploadId, partCount: pc }) });
    if (!ur.ok) throw new Error('get-part-urls failed');
    const { urls } = await ur.json();
    const parts: { PartNumber: number; ETag: string }[] = [];
    let uploaded = 0;
    for (let i = 0; i < pc; i++) {
      const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
      const etag = await new Promise<string>((res, rej) => {
        const x = new XMLHttpRequest(); x.open('PUT', urls[i]);
        x.upload.onprogress = e => { if (!e.lengthComputable) return; const tot = uploaded + e.loaded; updateItem(idx, { progress: Math.round(tot / file.size * 100), speed: formatBytes(tot / ((Date.now() - t0) / 1000)) + '/s' }); };
        x.onload = () => { if (x.status < 300) { uploaded += chunk.size; res(x.getResponseHeader('ETag') || ''); } else rej(new Error(`Part ${i + 1}`)); };
        x.onerror = () => rej(new Error(`Net part ${i + 1}`)); x.send(chunk);
      });
      parts.push({ PartNumber: i + 1, ETag: etag });
    }
    const comp = await fetch(`${API_BASE}/complete-multipart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, uploadId, parts }) });
    if (!comp.ok) throw new Error('complete-multipart failed');
  };

  const startUpload = async () => {
    if (!uploadItems.length) return;
    setIsUploading(true);
    await Promise.all(uploadItems.map(async (item, i) => {
      try { updateItem(i, { status: 'uploading' }); if (isLargeFile(item.file.size)) await uploadMultipart(item.file, i); else await uploadRegular(item.file, i); updateItem(i, { status: 'done', progress: 100 }); }
      catch (e) { updateItem(i, { status: 'error', error: e instanceof Error ? e.message : 'Error' }); }
    }));
    setIsUploading(false);
    fetchFiles(currentFolder);
  };

  const handleDownload = async (key: string) => {
    try { setDownloadingKey(key); const w = window.open('', '_blank'); const r = await fetch(`${API_BASE}/get-download-url?key=${encodeURIComponent(key)}`); const d = await r.json(); if (w) w.location.href = d.downloadUrl; }
    catch (e) { console.error(e); } finally { setDownloadingKey(null); }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try { setCreatingFolder(true); const r = await fetch(`${API_BASE}/create-folder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderName: newFolderName.trim() }) }); if (!r.ok) throw new Error('Failed'); setNewFolderName(''); setShowNewFolder(false); fetchFiles(currentFolder); }
    catch (e) { console.error(e); } finally { setCreatingFolder(false); }
  };

  const allDone = uploadItems.length > 0 && uploadItems.every(i => i.status === 'done' || i.status === 'error');

  return (
    <main className="min-h-screen bg-white flex text-gray-800">

      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-100 flex flex-col fixed inset-y-0 left-0 py-5 px-3 z-20">
        <div className="flex items-center gap-2.5 px-3 mb-7">
          <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
          </svg>
          <span className="font-semibold text-base text-gray-900">Arun's drive</span>
        </div>

        <button onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 mx-2 mb-5 px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:shadow-sm transition-all">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New
        </button>

        <button onClick={() => navigateToFolder('')}
          className={`flex items-center gap-3 px-3 py-2 rounded-full text-sm w-full text-left mb-1 transition-colors ${currentFolder === '' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Home
        </button>

        <button onClick={() => navigateToFolder('')}
          className="flex items-center gap-3 px-3 py-2 rounded-full text-sm text-gray-600 hover:bg-gray-100 w-full text-left mb-4 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>
          My Drive
        </button>

        {folders.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {folders.map((f, i) => (
              <button key={f.key} onClick={() => navigateToFolder(f.name)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-full text-sm w-full text-left transition-colors ${currentFolder === f.name ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}>
                <svg className={`w-4 h-4 flex-shrink-0 ${FOLDER_COLORS[i % FOLDER_COLORS.length]}`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-auto">
          <button onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-full text-sm text-gray-400 hover:bg-gray-100 w-full text-left transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
            New folder
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 ml-56 flex flex-col min-h-screen">

        {/* Top bar */}
        <header className="flex items-center justify-end gap-3 px-8 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <button onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:bg-gray-100 px-3 py-2 rounded-full transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
            New folder
          </button>
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-700 select-none">A</div>
        </header>

        {/* Content */}
        <div className="flex-1 px-8 py-7">
          <h1 className="text-2xl font-semibold text-gray-900 mb-7">
            {currentFolder ? `📁 ${currentFolder}` : 'Welcome, Arun'}
          </h1>

          {/* New folder modal */}
          {showNewFolder && (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm mb-6 max-w-sm">
              <p className="font-semibold text-gray-900 mb-1">New folder</p>
              <p className="text-sm text-gray-400 mb-4">Give your folder a name</p>
              <input autoFocus type="text" placeholder="e.g. Vacation 2026" value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createFolder()}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl mb-4 outline-none focus:border-blue-400" />
              <div className="flex gap-3 justify-end">
                <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={createFolder} disabled={creatingFolder || !newFolderName.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors">
                  {creatingFolder ? 'Creating…' : 'Create folder'}
                </button>
              </div>
            </div>
          )}

          {/* Upload queue */}
          {uploadItems.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-6 shadow-sm">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">{uploadItems.length} file{uploadItems.length > 1 ? 's' : ''} selected</p>
                {allDone
                  ? <button onClick={() => setUploadItems([])} className="px-3 py-1.5 text-xs border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">Clear</button>
                  : <button onClick={startUpload} disabled={isUploading} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
                      {isUploading ? 'Uploading…' : `Upload ${uploadItems.length} file${uploadItems.length > 1 ? 's' : ''}`}
                    </button>
                }
              </div>
              <div className="divide-y divide-gray-50">
                {uploadItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 h-8 flex items-center justify-center"><FileThumbIcon filename={item.file.name} size={20} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.file.name}</p>
                      {(item.status === 'uploading' || item.status === 'done') && (
                        <div className="w-full bg-gray-100 rounded-full h-1 mt-1.5">
                          <div className={`h-1 rounded-full transition-all ${item.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${item.progress}%` }} />
                        </div>
                      )}
                    </div>
                    <span className="text-xs min-w-12 text-right">
                      {item.status === 'queued' && <span className="text-gray-400">Queued</span>}
                      {item.status === 'uploading' && <span className="text-blue-500">{item.progress}%</span>}
                      {item.status === 'done' && <span className="text-green-600 font-medium">✓ Done</span>}
                      {item.status === 'error' && <span className="text-red-500">Failed</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Folders */}
          {folders.length > 0 && (
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-700">Folders</p>
                <button onClick={() => setShowNewFolder(true)} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  New folder
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {folders.map((f, i) => (
                  <button key={f.key} onClick={() => navigateToFolder(f.name)}
                    className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-2xl hover:bg-gray-50 hover:shadow-sm transition-all text-left">
                    <svg className={`w-5 h-5 flex-shrink-0 ${FOLDER_COLORS[i % FOLDER_COLORS.length]}`} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                    <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Files */}
          <section>
            {(files.length > 0 || !loadingFiles) && (
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-700">Files</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => inputRef.current?.click()}
                    className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mr-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    Upload
                  </button>
                  <button onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                  </button>
                  <button onClick={() => setViewMode('grid')}
                    className={`p-1.5 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                  </button>
                </div>
              </div>
            )}

            {loadingFiles ? (
              <p className="text-sm text-gray-400 text-center py-16">Loading…</p>
            ) : files.length === 0 && folders.length === 0 ? (
              <div onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-16 flex flex-col items-center gap-3 cursor-pointer transition-colors ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}>
                <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                <p className="text-sm font-medium text-gray-500">Drop files here or click to upload</p>
                <p className="text-xs text-gray-400">Any file type up to 1 GB</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {files.map(f => (
                  <div key={f.key} className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md hover:border-gray-300 transition-all group cursor-pointer">
                    <div className={`h-36 flex items-center justify-center relative ${getThumbBg(f.filename)}`}>
                      <FileThumbIcon filename={f.filename} size={52} />
                      <div className="absolute bottom-2.5 right-2.5 bg-black/60 rounded-lg px-2 py-1">
                        <span className="text-white text-xs font-medium">{formatBytes(f.size)}</span>
                      </div>
                    </div>
                    <div className="px-3 py-2.5 flex items-start justify-between gap-1 border-t border-gray-100">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-800 truncate leading-snug">{f.filename}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(f.lastModified)}</p>
                      </div>
                      <button onClick={() => handleDownload(f.key)} disabled={downloadingKey === f.key}
                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-gray-100 rounded-xl transition-all flex-shrink-0">
                        <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
                {/* Upload drop card */}
                <div onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl min-h-48 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}>
                  <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  <p className="text-xs text-gray-400 text-center px-4">Drop files or<br/>click to upload</p>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="divide-y divide-gray-50">
                  {files.map(f => (
                    <div key={f.key} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors group">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${getThumbBg(f.filename)}`}>
                        <FileThumbIcon filename={f.filename} size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{f.filename}</p>
                        <p className="text-xs text-gray-400">{formatBytes(f.size)} · {formatDate(f.lastModified)}</p>
                      </div>
                      <button onClick={() => handleDownload(f.key)} disabled={downloadingKey === f.key}
                        className="opacity-0 group-hover:opacity-100 text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-100 transition-all disabled:opacity-40">
                        {downloadingKey === f.key ? 'Getting link…' : 'Download'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <input ref={inputRef} type="file" multiple className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) handleFiles(e.target.files); }} />
    </main>
  );
}