"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileCode2, FileText, FileType2, LoaderCircle, Trash2, Upload, X } from "lucide-react";

export type IndexedFile = {
  file_path: string;
  raw_content: string;
  line_count: number;
  chunk_count: number;
};

type UploadProgress = { file_path: string; phase: "parsing" | "chunking" | "embedding" | "storing" | "indexed"; chunks?: number };

const accept = ".pdf,.docx,.txt,.md,.mdx,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.json,.csv,.yaml,.yml,.html,.css,.scss,.java,.go,.rs,.sql,.sh,.toml,.xml";
const extensions = "PDF · DOCX · TXT · Markdown · Code · JSON · CSV · YAML · HTML · XML";

function fileIcon(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return <FileType2 size={15} className="text-rose-300" />;
  if (extension === "docx") return <FileText size={15} className="text-sky-300" />;
  if (["md", "mdx", "txt"].includes(extension ?? "")) return <FileText size={15} className="text-emerald-300" />;
  return <FileCode2 size={15} className="text-indigo-300" />;
}

function phaseLabel(progress: UploadProgress) {
  if (progress.phase === "parsing") return "Parsing text…";
  if (progress.phase === "chunking") return "Chunking & indexing lines…";
  if (progress.phase === "embedding") return "Generating embeddings…";
  if (progress.phase === "storing") return "Saving to Supabase…";
  return `Indexed (${progress.chunks ?? 0} chunks)`;
}

export function UploadDrawer({
  open,
  onClose,
  files,
  onFilesChanged,
  onFileSelect,
  incomingFiles = [],
  onIncomingFilesConsumed,
}: {
  open: boolean;
  onClose: () => void;
  files: IndexedFile[];
  onFilesChanged: () => Promise<unknown>;
  onFileSelect: (path: string) => void;
  incomingFiles?: File[];
  onIncomingFilesConsumed?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [progress, setProgress] = useState<UploadProgress[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && incomingFiles.length) {
      setSelected((previous) => {
        const unique = new Map(previous.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]));
        incomingFiles.forEach((file) => unique.set(`${file.name}:${file.size}:${file.lastModified}`, file));
        return [...unique.values()];
      });
      setProgress([]);
      setError("");
      onIncomingFilesConsumed?.();
    }
  }, [incomingFiles, onIncomingFilesConsumed, open]);

  if (!open) return null;

  const addFiles = (incoming: FileList | File[]) => {
    const next = Array.from(incoming);
    setSelected((previous) => {
      const unique = new Map(previous.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]));
      next.forEach((file) => unique.set(`${file.name}:${file.size}:${file.lastModified}`, file));
      return [...unique.values()];
    });
    setProgress([]);
    setError("");
  };

  const upload = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    setError("");
    setProgress(selected.map((file) => ({ file_path: file.name, phase: "parsing" })));
    try {
      const body = new FormData();
      selected.forEach((file) => body.append("files", file));
      const response = await fetch("/api/ingest", { method: "POST", body });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Upload failed.");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("The server did not return upload progress.");
      const decoder = new TextDecoder();
      let buffer = "";
      let complete = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const records = buffer.split("\n");
        buffer = records.pop() ?? "";
        for (const record of records) {
          if (!record.trim()) continue;
          const event = JSON.parse(record) as UploadProgress & { type: string; error?: string; files?: number; chunks?: number };
          if (event.type === "progress") {
            setProgress((current) => current.map((item) => item.file_path === event.file_path ? { ...item, phase: event.phase, chunks: event.chunks } : item));
          } else if (event.type === "error") {
            throw new Error(event.error || "Indexing failed.");
          } else if (event.type === "complete") {
            complete = true;
          }
        }
        if (done) break;
      }
      if (!complete) throw new Error("The upload ended before indexing completed.");
      setProgress((current) => current.map((item) => item.phase === "indexed" ? item : { ...item, phase: "indexed" }));
      setSelected([]);
      await onFilesChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const deleteFile = async (path: string) => {
    setError("");
    try {
      const response = await fetch(`/api/files?file_path=${encodeURIComponent(path)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not delete file.");
      await onFilesChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete file.");
    }
  };

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside className="flex h-full w-full max-w-[500px] flex-col border-l border-zinc-800 bg-[#101012] shadow-2xl animate-in slide-in-from-right duration-200">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div><p className="text-sm font-semibold tracking-tight text-zinc-100">Knowledge base</p><p className="mt-0.5 text-[11px] text-zinc-500">Upload, inspect, and manage indexed sources</p></div>
        <button onClick={onClose} disabled={busy} className="rounded-md p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40" aria-label="Close upload drawer"><X size={17} /></button>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }} onClick={() => inputRef.current?.click()} className={`group flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center transition ${dragging ? "border-emerald-400 bg-emerald-400/10" : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-500 hover:bg-zinc-900"}`}>
          <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl border transition ${dragging ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-zinc-700 bg-zinc-800 text-zinc-400 group-hover:text-zinc-200"}`}><Upload size={18} /></div>
          <p className="text-sm font-medium text-zinc-200">Drop files to index</p>
          <p className="mt-1 text-xs text-zinc-500">or <span className="text-emerald-300">browse from your device</span></p>
          <p className="mt-3 max-w-xs text-[10px] leading-4 text-zinc-600">{extensions} · 10 MB per file</p>
          <input ref={inputRef} type="file" multiple accept={accept} className="hidden" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
        </div>

        {selected.length > 0 && <section className="space-y-2">
          <div className="flex items-center justify-between"><h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Upload queue <span className="text-zinc-600">· {selected.length}</span></h3><button onClick={() => setSelected([])} disabled={busy} className="text-[11px] text-zinc-500 hover:text-zinc-200">Clear</button></div>
          <div className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800 bg-zinc-900/50">
            {selected.map((file) => {
              const state = progress.find((item) => item.file_path === file.name);
              return <div key={`${file.name}-${file.size}`} className="flex items-center gap-3 px-3 py-2.5">
                {fileIcon(file.name)}<span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{file.name}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-zinc-500">{busy && <LoaderCircle size={11} className="animate-spin text-emerald-300" />}{state ? phaseLabel(state) : `${Math.max(1, Math.round(file.size / 1024))} KB`}</span>
              </div>;
            })}
          </div>
          <button onClick={upload} disabled={busy || !selected.length} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-[#07120f] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />} {busy ? "Indexing files…" : `Index ${selected.length} file${selected.length === 1 ? "" : "s"}`}</button>
        </section>}

        {progress.some((item) => item.phase === "indexed") && !busy && <div className="flex items-center gap-2 rounded-md border border-emerald-900/80 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300"><Check size={14} /> Files indexed and ready for retrieval.</div>}
        {error && <div className="rounded-md border border-amber-900/70 bg-amber-950/30 px-3 py-2.5 text-xs leading-5 text-amber-200">{error}</div>}

        <section>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Indexed knowledge base</h3><span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] tabular-nums text-zinc-500">{files.length} files</span></div>
          {files.length ? <div className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800 bg-zinc-900/40">
            {files.map((file) => <div key={file.file_path} className="group flex items-center gap-3 px-3 py-3 transition hover:bg-zinc-800/40">
              <button onClick={() => { onFileSelect(file.file_path); onClose(); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                {fileIcon(file.file_path)}
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-zinc-300">{file.file_path}</span><span className="mt-1 block text-[10px] text-zinc-600">{file.line_count.toLocaleString()} lines <span className="px-1">·</span> {file.chunk_count} chunks</span></span>
              </button>
              <button onClick={() => void deleteFile(file.file_path)} disabled={busy} aria-label={`Delete ${file.file_path}`} className="rounded-md p-1.5 text-zinc-600 opacity-0 transition hover:bg-rose-950/60 hover:text-rose-300 group-hover:opacity-100 focus:opacity-100 disabled:pointer-events-none disabled:opacity-30"><Trash2 size={14} /></button>
            </div>)}
          </div> : <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-7 text-center text-xs text-zinc-600">No indexed files yet. Seed the sample repo or upload documents above.</div>}
        </section>
      </div>
      <footer className="border-t border-zinc-800 px-5 py-3 text-[10px] text-zinc-600">PDFs with no selectable text need OCR before indexing.</footer>
    </aside>
  </div>;
}
