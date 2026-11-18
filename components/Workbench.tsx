"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Braces, Check, ChevronDown, ChevronRight,
  CircleAlert, Code2, Command, FileCode2, FileText, FileType2, LoaderCircle, LogOut, MessageSquare, Play, Plus,
  Search, Sparkles, Upload, X,
} from "lucide-react";
import { SAMPLE_QUESTION } from "@/lib/sample-files";
import { UploadDrawer, type IndexedFile } from "@/components/UploadDrawer";

type Citation = { file_path: string; start_line: number; end_line: number; label: string };
type SourceRef = { file_path: string; start_line: number; end_line: number };
type TraceStep = { iteration: number; tool: string; input: unknown; summary: string; source_refs: SourceRef[] };
type AgentResult = {
  answer: string;
  abstained: boolean;
  citations: Citation[];
  trace: TraceStep[];
  context_tokens: number;
  context_token_limit: number;
  relevant_snippets: number;
  relevance_pruned_snippets: number;
  budget_pruned_snippets: number;
  pruned_snippets: number;
  used_chunk_indices: number[];
  groq_input_tokens: number;
  groq_output_tokens: number;
  groq_model: string;
};

const starters = [
  "Cross-file: How do webhook retries interact with 429 rate limits?",
  "Where is the project API request limit defined?",
  "Which delivery failures are retried, and when do retries stop?",
];
const thinkingStages = ["Planning query", "Hop 1 · hybrid_search", "Hop 2 · inspect source", "Packing context"];

function iconForFile(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileType2 size={14} className="text-rose-300" />;
  if (ext === "docx") return <FileText size={14} className="text-sky-300" />;
  if (["md", "mdx", "txt"].includes(ext ?? "")) return <FileText size={14} className="text-emerald-300" />;
  return <FileCode2 size={14} className="text-indigo-300" />;
}

function extensionBadge(path: string) {
  return path.split(".").pop()?.toUpperCase() ?? "FILE";
}

export function Workbench() {
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [authStatus, setAuthStatus] = useState<"loading" | "required" | "unconfigured" | "authenticated">("loading");
  const [accessKey, setAccessKey] = useState("");
  const [authError, setAuthError] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [activeRange, setActiveRange] = useState<SourceRef | null>(null);
  const [activeCitation, setActiveCitation] = useState(0);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AgentResult | null>(null);
  const [latency, setLatency] = useState(0);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [incomingFiles, setIncomingFiles] = useState<File[]>([]);
  const [mobilePane, setMobilePane] = useState<"chat" | "source">("chat");
  const [split, setSplit] = useState(48);
  const splitRoot = useRef<HTMLDivElement>(null);
  const lineRefs = useRef(new Map<number, HTMLDivElement>());

  const refreshFiles = useCallback(async () => {
    const response = await fetch("/api/files");
    const payload = await response.json();
    if (response.status === 401) setAuthStatus("required");
    if (!response.ok) throw new Error(payload.error || "Could not load indexed files.");
    setFiles(payload.files);
    setSelectedFile((current: string) => {
      if (payload.files.some((file: IndexedFile) => file.file_path === current)) return current;
      return payload.files[0]?.file_path ?? "";
    });
    return payload.files as IndexedFile[];
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session")
      .then((response) => response.json())
      .then(async (session) => {
        if (!active) return;
        if (!session.configured) {
          setAuthStatus("unconfigured");
          return;
        }
        if (!session.authenticated) {
          setAuthStatus("required");
          return;
        }
        setAuthStatus("authenticated");
        try {
          await refreshFiles();
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : "Could not load indexed files.");
        }
      })
      .catch(() => {
        if (active) {
          setAuthStatus("unconfigured");
          setAuthError("Could not check the server session.");
        }
      });
    return () => { active = false; };
  }, [refreshFiles]);

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_key: accessKey }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not sign in.");
      setAccessKey("");
      setAuthStatus("authenticated");
      await refreshFiles();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Could not sign in.");
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setFiles([]);
    setAnswer(null);
    setQuestion("");
    setActiveRange(null);
    setAuthStatus("required");
  };

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => setThinkingStep((step) => (step + 1) % thinkingStages.length), 1500);
    return () => window.clearInterval(timer);
  }, [loading]);

  const currentFile = files.find((file) => file.file_path === selectedFile);
  const lines = useMemo(() => currentFile?.raw_content.replace(/\r\n/g, "\n").split("\n") ?? [], [currentFile]);
  const chunkTotal = files.reduce((total, file) => total + file.chunk_count, 0);

  useEffect(() => {
    if (!activeRange || activeRange.file_path !== selectedFile) return;
    lineRefs.current.get(activeRange.start_line)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeRange, selectedFile, files]);

  const openSource = (reference: SourceRef, citationIndex?: number) => {
    setSelectedFile(reference.file_path);
    setActiveRange(reference);
    if (citationIndex !== undefined) setActiveCitation(citationIndex);
    setMobilePane("source");
  };

  const ask = async (value = question) => {
    if (!value.trim() || loading) return;
    setQuestion(value);
    setLoading(true);
    setThinkingStep(0);
    setError("");
    setAnswer(null);
    setActiveCitation(0);
    setActiveRange(null);
    const started = performance.now();
    try {
      const response = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value }),
      });
      const payload = await response.json();
      if (response.status === 401) setAuthStatus("required");
      if (!response.ok) throw new Error(payload.error || "Agent request failed.");
      setLatency(Math.round(performance.now() - started));
      setAnswer(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent request failed.");
    } finally {
      setLoading(false);
    }
  };

  const seed = async () => {
    setSeeding(true);
    setError("");
    try {
      const response = await fetch("/api/seed", { method: "POST" });
      const payload = await response.json();
      if (response.status === 401) setAuthStatus("required");
      if (!response.ok) throw new Error(payload.error || "Could not seed sample repository.");
      await refreshFiles();
      setQuestion(payload.sample_question || SAMPLE_QUESTION);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not seed sample repository.");
    } finally {
      setSeeding(false);
    }
  };

  const clearChat = () => {
    setQuestion("");
    setAnswer(null);
    setActiveCitation(0);
    setActiveRange(null);
    setLatency(0);
    setError("");
  };

  const resizeSplit = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!(event.buttons & 1) || !splitRoot.current) return;
    const rect = splitRoot.current.getBoundingClientRect();
    setSplit(Math.min(68, Math.max(32, ((event.clientX - rect.left) / rect.width) * 100)));
  };

  const jumpCitation = (direction: -1 | 1) => {
    if (!answer?.citations.length) return;
    const next = (activeCitation + direction + answer.citations.length) % answer.citations.length;
    const citation = answer.citations[next];
    setActiveCitation(next);
    openSource(citation, next);
  };

  if (authStatus !== "authenticated") {
    return <main className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] px-5 text-zinc-200">
      <section className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#101014] p-6 shadow-2xl shadow-black/30">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-900/80 bg-emerald-950/30 text-emerald-300"><Braces size={17} /></div>
          <div><h1 className="text-sm font-semibold text-zinc-100">ContextEngine</h1><p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-600">Private research workspace</p></div>
        </div>
        {authStatus === "loading" ? <p className="flex items-center gap-2 py-4 text-xs text-zinc-500"><LoaderCircle size={14} className="animate-spin text-emerald-400" /> Checking secure session…</p> :
          authStatus === "unconfigured" ? <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100/80">{authError || "Server access is not configured. Set CONTEXT_ENGINE_ACCESS_KEY to a random secret of at least 32 characters and restart the app."}</div> :
            <form onSubmit={signIn} className="space-y-3">
              <p className="text-xs leading-5 text-zinc-500">Enter the workspace access key to open indexed sources and agent tools.</p>
              <input type="password" autoComplete="current-password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} required maxLength={512} placeholder="Workspace access key" className="h-10 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-xs text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-zinc-600 focus:ring-1 focus:ring-emerald-500/20" />
              {authError && <p role="alert" className="text-[11px] leading-5 text-rose-300">{authError}</p>}
              <button type="submit" className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 text-xs font-semibold text-[#06100d] transition hover:bg-emerald-400"><Check size={14} /> Sign in</button>
            </form>}
      </section>
    </main>;
  }

  return <main className="flex h-[100dvh] min-h-[620px] flex-col overflow-hidden bg-[#09090b] text-zinc-200 selection:bg-emerald-400/25">
    <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-zinc-800/90 bg-[#0b0b0d] px-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-900/80 bg-emerald-950/30 text-emerald-300"><Braces size={16} /><span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[#0b0b0d] animate-pulse" /></div>
        <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-[13px] font-semibold tracking-tight text-zinc-100">ContextEngine <span className="ml-1 font-mono text-[10px] font-normal text-zinc-600">v1</span></h1><span className="hidden rounded border border-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-zinc-500 sm:inline">Precision workbench</span></div></div>
        <div className="hidden rounded-md border border-zinc-800/80 bg-zinc-900/70 px-2 py-1 font-mono text-[10px] text-zinc-500 sm:block"><span className="text-zinc-300">{files.length}</span> files <span className="px-1 text-zinc-700">·</span><span className="text-zinc-300">{chunkTotal}</span> chunks</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button onClick={seed} disabled={seeding} className="hidden h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 sm:flex disabled:opacity-50">{seeding ? <LoaderCircle size={13} className="animate-spin" /> : <Sparkles size={13} className="text-amber-300" />} Seed Sample Repo</button>
        <button onClick={() => setDrawerOpen(true)} className="flex h-8 items-center gap-1.5 rounded-md border border-emerald-800/70 bg-emerald-950/35 px-2.5 text-[11px] font-semibold text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-900/40"><Upload size={13} /> <span className="hidden sm:inline">Upload Docs</span><span className="sm:hidden">Upload</span></button>
        <button onClick={clearChat} title="Clear chat" aria-label="Clear chat" className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"><Plus size={16} className="rotate-45" /></button>
        <button onClick={() => void signOut()} title="Sign out" aria-label="Sign out" className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"><LogOut size={14} /></button>
      </div>
    </header>

    <div className="flex h-10 shrink-0 items-center justify-center border-b border-zinc-800/70 bg-[#0b0b0d] px-3 lg:hidden">
      <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
        <button onClick={() => setMobilePane("chat")} className={`flex items-center gap-1.5 rounded-md px-4 py-1 text-[11px] ${mobilePane === "chat" ? "bg-zinc-700/70 text-zinc-100" : "text-zinc-500"}`}><MessageSquare size={12} /> Chat</button>
        <button onClick={() => setMobilePane("source")} className={`flex items-center gap-1.5 rounded-md px-4 py-1 text-[11px] ${mobilePane === "source" ? "bg-zinc-700/70 text-zinc-100" : "text-zinc-500"}`}><Code2 size={12} /> Source</button>
      </div>
    </div>

    <div ref={splitRoot} className="grid min-h-0 flex-1 lg:grid" style={{ gridTemplateColumns: `minmax(350px, ${split}fr) 5px minmax(0, ${100 - split}fr)` }}>
      <section className={`${mobilePane === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col border-r border-zinc-800/80 lg:flex`}>
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800/80 px-4">
          <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-300"><Activity size={13} className="text-emerald-400" /> Research console <span className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-600">AGENT</span></div>
          <span className="font-mono text-[10px] text-zinc-600">MAX 3 HOPS</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!answer && !loading && <div className="mx-auto max-w-[680px] px-5 pb-8 pt-8 sm:px-8 sm:pt-12">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-900/50 bg-emerald-950/20 px-2.5 py-1 font-mono text-[10px] text-emerald-300/80"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> INDEX READY <span className="text-emerald-900">/</span> GROUNDED RETRIEVAL</div>
            <h2 className="max-w-lg text-2xl font-semibold leading-[1.2] tracking-[-0.04em] text-zinc-100 sm:text-[30px]">Answers you can trace.<br /><span className="text-zinc-500">Evidence you can inspect.</span></h2>
            <p className="mt-4 max-w-md text-[13px] leading-6 text-zinc-500">Ask across docs and source. Follow every retrieval hop back to the exact lines that support the answer.</p>
            <div className="mt-8 rounded-xl border border-zinc-800 bg-[#101012] p-4">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600"><Command size={12} /> Try a multi-hop query</div>
              <div className="space-y-1.5">{starters.map((prompt, index) => <button key={prompt} onClick={() => void ask(prompt)} className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left text-xs leading-5 text-zinc-400 transition hover:border-zinc-800 hover:bg-zinc-900 hover:text-zinc-200"><span className="font-mono text-[10px] text-zinc-700">0{index + 1}</span><span className="flex-1">{prompt}</span><ArrowUpRight size={13} className="text-zinc-700 opacity-0 transition group-hover:opacity-100" /></button>)}</div>
            </div>
            <button onClick={() => setDrawerOpen(true)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setIncomingFiles(Array.from(event.dataTransfer.files)); setDrawerOpen(true); }} className="mt-3 flex w-full items-center gap-3 rounded-lg border border-dashed border-zinc-800 px-4 py-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/50">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 text-zinc-500"><Upload size={14} /></div><span className="flex-1"><span className="block text-xs text-zinc-400">Bring your own knowledge</span><span className="mt-0.5 block text-[10px] text-zinc-600">PDF, Word, Markdown, code, and more</span></span><ChevronRight size={14} className="text-zinc-700" />
            </button>
            {files.length === 0 && <p className="mt-4 text-center text-[10px] text-zinc-700">Start with the seeded repo or add your own indexed sources.</p>}
          </div>}

          {question && (loading || answer) && <div className="mx-auto max-w-[760px] px-5 pt-6 sm:px-8">
            <div className="ml-auto max-w-[90%] rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-3 text-[13px] leading-6 text-zinc-200">{question}</div>
          </div>}

          {loading && <div className="mx-auto max-w-[760px] px-5 pt-5 sm:px-8">
            <div className="rounded-xl border border-zinc-800 bg-[#101012] p-4">
              <div className="mb-4 flex items-center gap-2 text-xs font-medium text-zinc-300"><LoaderCircle size={14} className="animate-spin text-emerald-400" /> Tracing evidence</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{thinkingStages.map((stage, index) => <div key={stage} className={`flex items-center gap-2 rounded-md border px-2 py-2 text-[10px] transition ${index === thinkingStep ? "border-emerald-900/70 bg-emerald-950/20 text-emerald-200" : index < thinkingStep ? "border-zinc-800 text-zinc-500" : "border-zinc-900 text-zinc-700"}`}>{index < thinkingStep ? <Check size={11} /> : <span className={`h-1.5 w-1.5 rounded-full ${index === thinkingStep ? "bg-emerald-400 animate-pulse" : "bg-zinc-800"}`} />}{stage}</div>)}</div>
            </div>
          </div>}

          {answer && <div className="mx-auto max-w-[760px] px-5 pb-8 pt-5 sm:px-8">
            <details className="group mb-4 overflow-hidden rounded-xl border border-zinc-800 bg-[#101012]">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 marker:hidden">
                <span className="flex items-center gap-2 text-[11px] font-semibold text-zinc-300"><Activity size={13} className="text-emerald-400" /> Agentic Retrieval Trace</span>
                <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">{answer.trace.length} HOPS</span>
                <span className="font-mono text-[10px] text-zinc-600">{latency}ms</span>
                <span className="ml-auto flex items-center gap-2 font-mono text-[10px] text-zinc-500">{answer.context_tokens.toLocaleString()} / {answer.context_token_limit.toLocaleString()} tokens <ChevronDown size={12} className="transition group-open:rotate-180" /></span>
                <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800"><div className="flex h-full"><div className="bg-emerald-400 transition-all" style={{ width: `${Math.min(100, answer.context_tokens / answer.context_token_limit * 100)}%` }} /><div className="bg-amber-500/60" style={{ width: `${Math.min(100 - answer.context_tokens / answer.context_token_limit * 100, answer.pruned_snippets * 1.25)}%` }} /></div></div>
              </summary>
              <div className="border-t border-zinc-800">
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 font-mono text-[9px] text-zinc-600"><span><b className="text-emerald-300">{answer.relevant_snippets}</b> relevant</span><span><b className="text-amber-300">{answer.relevance_pruned_snippets}</b> relevance-pruned</span><span><b className="text-zinc-400">{answer.budget_pruned_snippets}</b> budget-pruned</span><span className="ml-auto">4,000 cap</span></div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/70 px-4 py-2 font-mono text-[9px] text-zinc-600">
                  <span>{answer.used_chunk_indices.length} evidence chunks used</span>
                  <span>Groq · {answer.groq_model} · {answer.groq_input_tokens.toLocaleString()} in / {answer.groq_output_tokens.toLocaleString()} out</span>
                </div>
                {answer.trace.length ? <div className="divide-y divide-zinc-800/70">{answer.trace.map((step, index) => {
                  const input = typeof step.input === "object" && step.input !== null ? JSON.stringify(step.input) : String(step.input);
                  return <div key={`${step.iteration}-${index}`} className="px-4 py-3 transition hover:bg-zinc-900/50">
                    <div className="flex min-w-0 items-center gap-2"><span className="font-mono text-[9px] text-emerald-500/70">HOP {step.iteration}</span><code className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-zinc-300">{step.tool}</code><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-600">{input}</span><span className="shrink-0 text-[9px] text-zinc-600">{step.source_refs.length} chunks</span></div>
                    <p className="mt-2 pl-12 text-[11px] leading-5 text-zinc-500">{step.summary}</p>
                    {step.source_refs.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5 pl-12">{step.source_refs.map((reference, refIndex) => <button key={`${reference.file_path}-${reference.start_line}-${refIndex}`} onClick={() => openSource(reference)} className="rounded border border-zinc-800 px-2 py-1 font-mono text-[9px] text-zinc-500 transition hover:border-emerald-800 hover:text-emerald-200">{reference.file_path}:{reference.start_line}-{reference.end_line}</button>)}</div>}
                  </div>;
                })}</div> : <div className="px-4 py-3 text-[11px] text-zinc-600">No retrieval steps were recorded.</div>}
              </div>
            </details>

            {answer.abstained ? <div className="rounded-xl border border-amber-900/70 bg-amber-950/20 p-4">
              <div className="flex items-start gap-3"><div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-800/60 bg-amber-900/30 text-amber-300"><CircleAlert size={14} /></div><div><h3 className="text-xs font-semibold text-amber-200">Insufficient indexed evidence</h3><p className="mt-1 text-[11px] leading-5 text-amber-100/60">The agent could not verify every part of this question from the indexed sources. It abstained rather than infer an unsupported answer.</p></div></div>
              <div className="mt-3 border-t border-amber-900/50 pt-3"><p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.13em] text-amber-200/50">Searched during this run</p><div className="flex flex-wrap gap-1.5">{answer.trace.length ? answer.trace.map((step, index) => <span key={index} className="rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1 font-mono text-[9px] text-amber-100/70">{step.tool}</span>) : <span className="text-[10px] text-amber-100/50">No indexed passages matched.</span>}</div></div>
              <p className="mt-3 font-mono text-[11px] leading-5 text-amber-100">{answer.answer}</p>
            </div> : <article className="rounded-xl border border-zinc-800 bg-[#101012] p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600"><BookOpen size={13} className="text-emerald-400" /> Grounded answer</div>
              <div className="answer-prose text-[13px] leading-7 text-zinc-300"><ReactMarkdown rehypePlugins={[rehypeHighlight]} skipHtml>{answer.answer}</ReactMarkdown></div>
              {answer.citations.length > 0 && <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3"><span className="mr-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Sources</span>{answer.citations.map((citation, index) => {
                const active = activeCitation === index && activeRange?.file_path === citation.file_path && activeRange.start_line === citation.start_line;
                return <button key={`${citation.file_path}-${citation.start_line}-${index}`} onClick={() => openSource(citation, index)} className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] transition ${active ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-emerald-800/80 hover:text-emerald-200"}`}><FileCode2 size={11} />{citation.file_path}:{citation.start_line}-{citation.end_line}<ArrowUpRight size={10} /></button>;
              })}</div>}
            </article>}
          </div>}

          {error && <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/20 p-3 text-xs leading-5 text-rose-200 sm:mx-8"><CircleAlert size={14} className="mt-0.5 shrink-0" />{error}</div>}
        </div>

        <div className="shrink-0 border-t border-zinc-800 bg-[#0b0b0d] p-3 sm:p-4">
          <div className="relative mx-auto max-w-[760px]">
            <textarea value={question} maxLength={4000} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Ask across your indexed knowledge base…" rows={2} className="max-h-36 min-h-[72px] w-full resize-y rounded-xl border border-zinc-800 bg-[#111113] px-3.5 py-3 pr-12 text-[13px] leading-6 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-emerald-500/15" />
            <button onClick={() => void ask()} disabled={loading || !question.trim()} aria-label="Run research query" className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-[#06100d] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"><Play size={14} fill="currentColor" /></button>
          </div>
          <div className="mx-auto mt-2 flex max-w-[760px] items-center justify-between px-1 text-[9px] text-zinc-700"><span><kbd className="rounded border border-zinc-800 px-1 py-0.5 font-mono">↵</kbd> run <span className="px-1">·</span><kbd className="rounded border border-zinc-800 px-1 py-0.5 font-mono">⇧ ↵</kbd> newline</span><button onClick={() => void ask(SAMPLE_QUESTION)} className="font-mono transition hover:text-zinc-400">RUN SAMPLE QUERY <ArrowRight size={10} className="ml-1 inline" /></button></div>
        </div>
      </section>

      <div className="hidden cursor-col-resize touch-none bg-zinc-900 transition hover:bg-emerald-500/40 lg:block" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resizeSplit(event); }} onPointerMove={resizeSplit} aria-label="Resize panes" />

      <section className={`${mobilePane === "source" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col bg-[#0c0c0e] lg:flex`}>
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800/80 px-4">
          <div className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-zinc-300"><Search size={13} className="text-zinc-500" /> Source explorer <span className="hidden font-mono text-[9px] text-zinc-600 sm:inline">/ INDEXED FILES</span></div>
          <button onClick={() => setDrawerOpen(true)} className="flex items-center gap-1 text-[10px] text-zinc-500 transition hover:text-emerald-200"><Upload size={12} /> Manage</button>
        </div>
        <div className="flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-zinc-800/80 bg-[#0b0b0d]">
          {files.length ? files.map((file) => <button key={file.file_path} onClick={() => { setSelectedFile(file.file_path); setActiveRange(null); }} title={file.file_path} className={`relative flex max-w-[210px] shrink-0 items-center gap-2 border-r border-zinc-800/70 px-3 text-[10px] transition ${selectedFile === file.file_path ? "bg-[#111113] text-zinc-200" : "text-zinc-600 hover:bg-zinc-900/60 hover:text-zinc-400"}`}>{iconForFile(file.file_path)}<span className="max-w-[125px] truncate">{file.file_path}</span><span className="rounded border border-zinc-800 px-1 py-0.5 font-mono text-[8px] text-zinc-600">{extensionBadge(file.file_path)}</span>{selectedFile === file.file_path && <span className="absolute inset-x-0 bottom-0 h-px bg-emerald-400" />}</button>) : <span className="flex items-center px-4 text-[10px] text-zinc-700">No indexed sources</span>}
        </div>
        {currentFile ? <>
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-zinc-800/70 px-4">
            <div className="flex min-w-0 items-center gap-2"><span className="shrink-0">{iconForFile(currentFile.file_path)}</span><span className="truncate font-mono text-[10px] text-zinc-400">{currentFile.file_path}</span><span className="hidden shrink-0 font-mono text-[9px] text-zinc-700 sm:inline">{lines.length} lines</span></div>
            {answer?.citations.length ? <div className="flex shrink-0 items-center gap-1 rounded-md border border-amber-900/50 bg-amber-950/15 px-1.5 py-1 font-mono text-[9px] text-amber-200/80"><button onClick={() => jumpCitation(-1)} aria-label="Previous citation" className="rounded p-0.5 transition hover:bg-amber-900/40"><ArrowLeft size={11} /></button><span>Cited {answer.citations[activeCitation]?.start_line ?? "—"}–{answer.citations[activeCitation]?.end_line ?? "—"}</span><button onClick={() => jumpCitation(1)} aria-label="Next citation" className="rounded p-0.5 transition hover:bg-amber-900/40"><ArrowRight size={11} /></button><span className="ml-1 text-amber-100/40">{activeCitation + 1}/{answer.citations.length}</span></div> : <span className="shrink-0 font-mono text-[9px] text-zinc-700">{currentFile.chunk_count} chunks</span>}
          </div>
          <div className="flex min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-[23px]">
            <div className="min-w-max flex-1 py-3">
              {lines.map((line, index) => {
                const number = index + 1;
                const highlighted = activeRange?.file_path === selectedFile && number >= activeRange.start_line && number <= activeRange.end_line;
                return <div key={number} ref={(element) => { if (element) lineRefs.current.set(number, element); else lineRefs.current.delete(number); }} className={`flex min-h-[23px] border-l-2 pr-7 transition-colors ${highlighted ? "border-amber-400 bg-amber-500/15 text-amber-100" : "border-transparent text-zinc-400 hover:bg-white/[0.015]"}`}>
                  <span className={`sticky left-0 z-[1] inline-block w-14 shrink-0 select-none border-r border-zinc-800/70 bg-[#0c0c0e] pr-3 text-right ${highlighted ? "text-amber-400" : "text-zinc-700"}`}>{number}</span><span className="whitespace-pre px-4">{line || " "}</span>
                </div>;
              })}
            </div>
          </div>
          <footer className="flex h-8 shrink-0 items-center justify-between border-t border-zinc-800/70 px-4 font-mono text-[9px] text-zinc-700"><span>UTF-8 <span className="px-1">·</span> 1-indexed inclusive ranges</span><span>{currentFile.line_count.toLocaleString()} lines</span></footer>
        </> : <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-600"><Code2 size={21} /></div><p className="mt-4 text-xs font-medium text-zinc-400">Your source workspace is clear</p><p className="mt-1 max-w-xs text-[11px] leading-5 text-zinc-600">Seed the sample repo or upload a file to inspect its complete, line-indexed content here.</p><button onClick={() => setDrawerOpen(true)} className="mt-4 flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-2 text-[10px] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"><Upload size={12} /> Add source docs</button>
        </div>}
      </section>
    </div>

    <footer className="hidden h-6 shrink-0 items-center justify-between border-t border-zinc-800/80 bg-[#0b0b0d] px-4 font-mono text-[9px] text-zinc-700 sm:flex"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> SUPABASE INDEX {files.length ? "CONNECTED" : "READY"}</span><span>GROQ AGENT <span className="px-1">·</span> GEMINI EMBEDDINGS <span className="px-1">·</span> LINE GROUNDED</span></footer>
    <UploadDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} files={files} onFilesChanged={refreshFiles} onFileSelect={(path) => { setSelectedFile(path); setMobilePane("source"); }} incomingFiles={incomingFiles} onIncomingFilesConsumed={() => setIncomingFiles([])} />
  </main>;
}
