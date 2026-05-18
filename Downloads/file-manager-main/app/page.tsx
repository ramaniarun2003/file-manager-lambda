'use client';
import { useState, useRef, DragEvent, ChangeEvent, useEffect } from 'react';

const API_BASE = 'https://2zhsad3hab.execute-api.us-east-1.amazonaws.com/prod';
const CHUNK_SIZE = 10 * 1024 * 1024;

interface S3File {
  key: string;
  filename: string;
  size: number;
  lastModified: string;
}

interface Folder {
  key: string;
  name: string;
}

interface UploadItem {
  file: File;
  progress: number;
  speed: string;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext))
    return <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-xs">VID</div>;
  if (['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(ext))
    return <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-xs">AUD</div>;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext))
    return <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">IMG</div>;
  if (ext === 'pdf')
    return <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center text-red-600 font-bold text-xs">PDF</div>;
  if (['xlsx', 'xls', 'csv'].includes(ext))
    return <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-green-600 font-bold text-xs">XLS</div>;
  if (['docx', 'doc'].includes(ext))
    return <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">DOC</div>;
  return <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-xs">FILE</div>;
}

function getFileBadge(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext))
    return <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-600 text-xs font-medium">Video</span>;
  if (['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(ext))
    return <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-600 text-xs font-medium">Audio</span>;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext))
    return <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-600 text-xs font-medium">Image</span>;
  if (ext === 'pdf')
    return <span className="px-3 py-1 rounded-full bg-red-100 text-red-600 text-xs font-medium">PDF</span>;
  if (['xlsx', 'xls', 'csv'].includes(ext))
    return <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium">Sheet</span>;
  if (['docx', 'doc'].includes(ext))
    return <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-600 text-xs font-medium">Doc</span>;
  return null;
}

function isLargeFile(size: number) {
  return size > 10 * 1024 * 1024;
}

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
  const inputRef = useRef<HTMLInputElement>(null);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const fetchFiles = async (folder = '') => {
    try {
      setLoadingFiles(true);
      const url = folder
        ? `${API_BASE}/list-files?folder=${encodeURIComponent(folder)}`
        : `${API_BASE}/list-files`;
      const res = await fetch(url);
      const data = await res.json();
      setFiles(data.files || []);
      setFolders(data.folders || []);
    } catch (err) {
      console.error('Failed to fetch files', err);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => { fetchFiles(''); }, []);

  const navigateToFolder = (folderName: string) => {
    setCurrentFolder(folderName);
    fetchFiles(folderName);
    setUploadItems([]);
  };

  const handleFiles = (newFiles: FileList) => {
    const items: UploadItem[] = Array.from(newFiles).map(file => ({
      file,
      progress: 0,
      speed: '',
      status: 'queued'
    }));
    setUploadItems(items);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const updateItem = (index: number, updates: Partial<UploadItem>) => {
    setUploadItems(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  };

  const uploadRegular = async (file: File, index: number) => {
    const startTime = Date.now();
    const res = await fetch(`${API_BASE}/get-upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        folder: currentFolder
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const { uploadUrl } = await res.json();
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        updateItem(index, {
          progress: pct,
          speed: formatBytes(e.loaded / elapsed) + '/s'
        });
      };
      xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`S3 error ${xhr.status}`));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(file);
    });
  };

  const uploadMultipart = async (file: File, index: number) => {
    const startTime = Date.now();
    const createRes = await fetch(`${API_BASE}/create-multipart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        folder: currentFolder
      }),
    });
    if (!createRes.ok) throw new Error('Failed to create multipart upload');
    const { uploadId, key } = await createRes.json();
    const partCount = Math.ceil(file.size / CHUNK_SIZE);
    const urlRes = await fetch(`${API_BASE}/get-part-urls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId, partCount }),
    });
    if (!urlRes.ok) throw new Error('Failed to get part URLs');
    const { urls } = await urlRes.json();
    const parts: { PartNumber: number; ETag: string }[] = [];
    let uploadedBytes = 0;
    for (let i = 0; i < partCount; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      const etag = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', urls[i]);
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const totalUploaded = uploadedBytes + e.loaded;
          const elapsed = (Date.now() - startTime) / 1000;
          updateItem(index, {
            progress: Math.round((totalUploaded / file.size) * 100),
            speed: formatBytes(totalUploaded / elapsed) + '/s'
          });
        };
        xhr.onload = () => {
          if (xhr.status < 300) { uploadedBytes += chunk.size; resolve(xhr.getResponseHeader('ETag') || ''); }
          else reject(new Error(`Part ${i + 1} failed`));
        };
        xhr.onerror = () => reject(new Error(`Network error on part ${i + 1}`));
        xhr.send(chunk);
      });
      parts.push({ PartNumber: i + 1, ETag: etag });
    }
    const completeRes = await fetch(`${API_BASE}/complete-multipart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId, parts }),
    });
    if (!completeRes.ok) throw new Error('Failed to complete multipart upload');
  };

  const startUpload = async () => {
    if (!uploadItems.length) return;
    setIsUploading(true);

    await Promise.all(uploadItems.map(async (item, index) => {
      try {
        updateItem(index, { status: 'uploading' });
        if (isLargeFile(item.file.size)) {
          await uploadMultipart(item.file, index);
        } else {
          await uploadRegular(item.file, index);
        }
        updateItem(index, { status: 'done', progress: 100 });
      } catch (err) {
        updateItem(index, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    }));

    setIsUploading(false);
    fetchFiles(currentFolder);
  };

  const handleDownload = async (key: string) => {
    try {
      setDownloadingKey(key);
      const newWindow = window.open('', '_blank');
      const res = await fetch(`${API_BASE}/get-download-url?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (newWindow) newWindow.location.href = data.downloadUrl;
    } catch (err) {
      console.error('Download failed', err);
    } finally {
      setDownloadingKey(null);
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      setCreatingFolder(true);
      const res = await fetch(`${API_BASE}/create-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: newFolderName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to create folder');
      setNewFolderName('');
      setShowNewFolder(false);
      fetchFiles(currentFolder);
    } catch (err) {
      console.error('Create folder failed', err);
    } finally {
      setCreatingFolder(false);
    }
  };

  const allDone = uploadItems.length > 0 && uploadItems.every(i => i.status === 'done' || i.status === 'error');

  return (
    <main className="min-h-screen bg-gray-50 flex">

      {/* Sidebar */}
      <div className="w-56 bg-white border-r border-gray-100 p-5 flex flex-col gap-1 min-h-screen fixed top-0 left-0">
        <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold px-2 mb-3">Folders</p>
        <button
          onClick={() => navigateToFolder('')}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left w-full transition-colors
            ${currentFolder === '' ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          All files
        </button>
        {folders.map(f => (
          <button
            key={f.key}
            onClick={() => navigateToFolder(f.name)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left w-full transition-colors
              ${currentFolder === f.name ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            {f.name}
          </button>
        ))}
        <div className="mt-auto">
          <button
            onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:bg-gray-50 w-full text-left transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            New folder
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 ml-56 p-8">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                {currentFolder || 'All files'}
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                {files.length + folders.length} items · {formatBytes(totalSize)} used
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowNewFolder(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
                New folder
              </button>
              <button
                onClick={() => inputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-700 transition-colors font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload
              </button>
            </div>
          </div>

          {/* New folder modal */}
          {showNewFolder && (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <p className="text-base font-semibold text-gray-900 mb-1">New folder</p>
              <p className="text-sm text-gray-400 mb-4">Give your folder a name</p>
              <input
                type="text"
                placeholder="e.g. Vacation 2026"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createFolder()}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl mb-4 outline-none focus:border-gray-400"
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createFolder}
                  disabled={creatingFolder || !newFolderName.trim()}
                  className="px-4 py-2 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  {creatingFolder ? 'Creating…' : 'Create folder'}
                </button>
              </div>
            </div>
          )}

          {/* Upload zone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors
              ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                if (e.target.files?.length) handleFiles(e.target.files);
              }}
            />
            <svg className="w-8 h-8 mx-auto mb-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-base font-semibold text-gray-800">Drop files here to upload</p>
            <p className="text-sm text-gray-400 mt-1">Select multiple files at once · Uploading into: <span className="font-medium">{currentFolder || 'root'}</span></p>
          </div>

          {/* Upload queue */}
          {uploadItems.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">
                  {uploadItems.length} file{uploadItems.length > 1 ? 's' : ''} selected
                </p>
                <div className="flex gap-2">
                  {allDone ? (
                    <button
                      onClick={() => setUploadItems([])}
                      className="px-4 py-1.5 text-sm border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50"
                    >
                      Clear
                    </button>
                  ) : (
                    <button
                      onClick={startUpload}
                      disabled={isUploading}
                      className="px-4 py-1.5 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
                    >
                      {isUploading ? 'Uploading…' : `Upload ${uploadItems.length} file${uploadItems.length > 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {uploadItems.map((item, index) => (
                  <div key={index} className="flex items-center gap-4 px-5 py-3">
                    {getFileIcon(item.file.name)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.file.name}</p>
                      <p className="text-xs text-gray-400">{formatBytes(item.file.size)}</p>
                      {(item.status === 'uploading' || item.status === 'done') && (
                        <div className="mt-1.5">
                          <div className="w-full bg-gray-100 rounded-full h-1">
                            <div
                              className={`h-1 rounded-full transition-all ${item.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {item.status === 'error' && (
                        <p className="text-xs text-red-500 mt-0.5">✗ {item.error}</p>
                      )}
                    </div>
                    <div className="text-right min-w-16">
                      {item.status === 'queued' && <span className="text-xs text-gray-400">Queued</span>}
                      {item.status === 'uploading' && <span className="text-xs text-blue-500">{item.progress}%{item.speed ? ` · ${item.speed}` : ''}</span>}
                      {item.status === 'done' && <span className="text-xs text-green-600 font-medium">✓ Done</span>}
                      {item.status === 'error' && <span className="text-xs text-red-500">Failed</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Folders grid */}
          {folders.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-3">Folders</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {folders.map(f => (
                  <button
                    key={f.key}
                    onClick={() => navigateToFolder(f.name)}
                    className="flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-2xl hover:border-gray-300 hover:shadow-sm transition-all text-left"
                  >
                    <svg className="w-6 h-6 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-800 truncate">{f.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Files list */}
          <div>
            {files.length > 0 && (
              <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-3">Files</p>
            )}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              {loadingFiles ? (
                <p className="text-sm text-gray-400 text-center py-12">Loading…</p>
              ) : files.length === 0 && folders.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12">No files here yet. Upload something!</p>
              ) : files.length === 0 ? null : (
                <div className="divide-y divide-gray-50">
                  {files.map(f => (
                    <div key={f.key} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group">
                      {getFileIcon(f.filename)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{f.filename}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatBytes(f.size)} · {formatDate(f.lastModified)}</p>
                      </div>
                      {getFileBadge(f.filename)}
                      <button
                        onClick={() => handleDownload(f.key)}
                        disabled={downloadingKey === f.key}
                        className="opacity-0 group-hover:opacity-100 text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100 transition-all disabled:opacity-40 ml-2"
                      >
                        {downloadingKey === f.key ? 'Getting link…' : 'Download'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}