// Codex Council controller: owns sessions, per-lane threads, streaming,
// council synthesis, and the workspace-write approval flow. Components stay
// presentational; all orchestration lives here.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  streamChat,
  streamSynthesize,
  getStatus,
  getUsage,
  listSessions,
  getSession,
  saveSession,
  getSettings,
  saveSettings,
  applyDiff,
  extractDiff,
} from "@/lib/codex-council-client";
import {
  DEFAULT_LANES,
  DEFAULT_SETTINGS,
  type CouncilMode,
  type LaneConfig,
  type ChatMessage,
  type SessionMeta,
  type SessionRecord,
  type CodexStatus,
  type CodexUsage,
  type CodexSandbox,
  type CouncilSettings,
} from "@/lib/codex-council-types";

function uid(): string {
  const r = globalThis.crypto?.randomUUID?.();
  return r ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useCodex() {
  const [mode, setMode] = useState<CouncilMode>("council");
  const [lanes, setLanes] = useState<LaneConfig[]>(() => DEFAULT_LANES.map((l) => ({ ...l })));
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({
    primary: [],
    reviewer: [],
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [streamingLanes, setStreamingLanes] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [synthMsg, setSynthMsg] = useState<ChatMessage | null>(null);
  const [synthStreaming, setSynthStreaming] = useState(false);
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [usage, setUsage] = useState<CodexUsage | null>(null);
  const [cwd, setCwd] = useState("");
  const [sandbox, setSandbox] = useState<CodexSandbox>("read-only");
  const [grounded, setGrounded] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [settings, setSettingsState] = useState<CouncilSettings & { defaultBrief?: string }>(
    DEFAULT_SETTINGS,
  );

  // refs mirror state for async closures + native resume ids
  const nativeIds = useRef<Record<string, string>>({});
  const aborts = useRef<Record<string, AbortController>>({});
  const synthAbort = useRef<AbortController | null>(null);
  const lastPrompt = useRef<Record<string, string>>({});
  const lastSharedPrompt = useRef("");
  const createdAt = useRef<Record<string, number>>({});
  const snap = useRef({ mode, lanes, threads, activeId });
  const threadsRef = useRef(threads); // synchronous source of truth for persist()
  const cwdRef = useRef(cwd);
  const sandboxRef = useRef(sandbox);
  const groundRef = useRef(grounded);
  const synthesizeRef = useRef<() => void>(() => {});
  const autoSynthRef = useRef(DEFAULT_SETTINGS.autoSynth);
  const synthModelRef = useRef(DEFAULT_SETTINGS.synthModel);
  const settingsRef = useRef(settings);
  useEffect(() => {
    snap.current = { mode, lanes, threads, activeId };
  });
  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);
  useEffect(() => {
    sandboxRef.current = sandbox;
  }, [sandbox]);
  useEffect(() => {
    groundRef.current = grounded;
  }, [grounded]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  // Auto-expire the transient status note so a stale error/warning doesn't
  // permanently replace the live status strip.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 6000);
    return () => clearTimeout(t);
  }, [note]);

  const refreshSessions = useCallback(() => {
    void listSessions().then(setSessions);
  }, []);
  const refreshUsage = useCallback(() => {
    void getUsage().then((u) => u && setUsage(u));
  }, []);
  const updateSettings = useCallback(async (next: CouncilSettings) => {
    setSettingsState((prev) => ({ ...prev, ...next }));
    autoSynthRef.current = next.autoSynth;
    synthModelRef.current = next.synthModel;
    await saveSettings(next);
  }, []);

  useEffect(() => {
    refreshSessions();
    refreshUsage();
    void getStatus().then((s) => s && setStatus(s));
    void getSettings().then((s) => {
      if (!s) return;
      setSettingsState(s);
      autoSynthRef.current = s.autoSynth;
      synthModelRef.current = s.synthModel;
      // Seed the initial (fresh) session to the saved defaults.
      setLanes(s.defaultLanes.map((l) => ({ ...l })));
      setSandbox(s.defaultSandbox);
      setGrounded(s.defaultGrounded);
    });
  }, [refreshSessions, refreshUsage]);

  // Update threads through a ref-backed setter so persist() always reads the
  // latest messages synchronously, not the last committed render.
  const mutateThreads = useCallback(
    (updater: (prev: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>): void => {
      threadsRef.current = updater(threadsRef.current);
      setThreads(threadsRef.current);
    },
    [],
  );

  const updateAssistant = useCallback(
    (laneId: string, msgId: string, fn: (m: ChatMessage) => ChatMessage): void =>
      mutateThreads((prev) => ({
        ...prev,
        [laneId]: (prev[laneId] ?? []).map((m) => (m.id === msgId ? fn(m) : m)),
      })),
    [mutateThreads],
  );

  const persist = useCallback(
    async (sessionId?: string) => {
      const id = sessionId ?? snap.current.activeId;
      if (!id) return;
      // If the user switched sessions while this turn was finishing, the live
      // threadsRef now belongs to a different session — skip, so a late finalizer
      // can't clobber the loaded session with the wrong content.
      if (sessionId && snap.current.activeId !== sessionId) return;
      const threads = threadsRef.current; // current, never a stale snapshot
      const all = Object.values(threads).flat();
      const firstUser = all.find((m) => m.role === "user");
      const rec: SessionRecord = {
        id,
        title: (firstUser?.text ?? "New session").replace(/\s+/g, " ").slice(0, 60),
        mode: snap.current.mode,
        createdAt: createdAt.current[id] ?? Date.now(),
        updatedAt: Date.now(),
        lanes: snap.current.lanes,
        errored: all.some((m) => m.status === "error"),
        threads,
        nativeSessionIds: { ...nativeIds.current },
      };
      await saveSession(rec);
      refreshSessions();
    },
    [refreshSessions],
  );

  const ensureSession = (): string => {
    if (snap.current.activeId) return snap.current.activeId;
    const id = uid();
    createdAt.current[id] = Date.now();
    snap.current.activeId = id;
    setActiveId(id);
    return id;
  };

  const runTurn = useCallback(
    async (
      laneId: string,
      prompt: string,
      skipUser: boolean,
      sessionId: string,
      persistAfter: boolean,
    ): Promise<void> => {
      const lane = snap.current.lanes.find((l) => l.id === laneId);
      if (!lane) return;
      lastPrompt.current[laneId] = prompt;
      const assistantId = uid();
      mutateThreads((prev) => {
        const base = prev[laneId] ?? [];
        const userMsgs: ChatMessage[] = skipUser
          ? []
          : [{ id: uid(), role: "user", text: prompt, ts: Date.now() }];
        const assistant: ChatMessage = {
          id: assistantId,
          role: "assistant",
          engine: lane.engine,
          model: lane.model,
          text: "",
          ts: Date.now(),
          status: "streaming",
        };
        return { ...prev, [laneId]: [...base, ...userMsgs, assistant] };
      });
      setStreamingLanes((s) => ({ ...s, [laneId]: true }));

      const ac = new AbortController();
      aborts.current[laneId] = ac;
      let acc = "";
      let tokens: number | undefined;
      let sawError = false;

      await streamChat(
        {
          engine: lane.engine,
          model: lane.model,
          prompt,
          sessionId: nativeIds.current[laneId],
          cwd: cwdRef.current || undefined,
          sandbox: sandboxRef.current,
          ground: groundRef.current,
        },
        (ev) => {
          if (ev.type === "token") {
            acc += ev.text;
            updateAssistant(laneId, assistantId, (m) => ({ ...m, text: acc }));
          } else if (ev.type === "session") {
            nativeIds.current[laneId] = ev.sessionId;
          } else if (ev.type === "usage") {
            tokens = ev.tokens;
          } else if (ev.type === "error") {
            sawError = true;
            acc += (acc ? "\n\n" : "") + `⚠️ ${ev.message}`;
          }
        },
        ac.signal,
      );

      const finalStatus = sawError ? "error" : ac.signal.aborted ? "stopped" : "done";
      updateAssistant(laneId, assistantId, (m) => ({
        ...m,
        text: acc,
        status: finalStatus,
        tokens,
        diff: extractDiff(acc) ?? undefined,
      }));
      setStreamingLanes((s) => ({ ...s, [laneId]: false }));
      delete aborts.current[laneId];
      if (persistAfter) await persist(sessionId);
      refreshUsage();
    },
    [persist, refreshUsage, updateAssistant, mutateThreads],
  );

  const send = useCallback(
    (prompt: string, laneIds: string[]): void => {
      const text = prompt.trim();
      if (!text) return;
      const sessionId = ensureSession();
      if (laneIds.length > 1) {
        // Council: run both lanes, then persist ONCE after both finish so
        // neither save clobbers the other (the lost-update race).
        lastSharedPrompt.current = text;
        void Promise.all(laneIds.map((id) => runTurn(id, text, false, sessionId, false)))
          .then(() => persist(sessionId))
          // Auto-produce the differences verdict at the end of every council cycle
          // (when enabled in Settings). synthesize() self-guards on ≥2 completed
          // lane answers, so a stopped or errored lane simply skips synthesis.
          .then(() => {
            if (autoSynthRef.current) synthesizeRef.current();
          });
      } else {
        void runTurn(laneIds[0], text, false, sessionId, true);
      }
    },
    [runTurn, persist],
  );

  const sendShared = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const laneIds = mode === "single" ? [lanes[0].id] : lanes.map((l) => l.id);
    setDraft("");
    send(text, laneIds);
  }, [draft, lanes, mode, send]);

  const sendLane = useCallback(
    (laneId: string) => {
      const text = (drafts[laneId] ?? "").trim();
      if (!text) return;
      setDrafts((d) => ({ ...d, [laneId]: "" }));
      send(text, [laneId]);
    },
    [drafts, send],
  );

  const stop = useCallback((laneId: string) => aborts.current[laneId]?.abort(), []);
  const regenerate = useCallback(
    (laneId: string) => {
      const p = lastPrompt.current[laneId];
      if (p) void runTurn(laneId, p, true, ensureSession(), true);
    },
    [runTurn],
  );

  const synthesize = useCallback(async () => {
    const prompt = lastSharedPrompt.current.trim();
    if (!prompt) {
      setNote("Send a council prompt first — synthesis needs the shared question.");
      return;
    }
    const answers = snap.current.lanes
      .map((l) => {
        const last = [...(threadsRef.current[l.id] ?? [])]
          .reverse()
          .find((m) => m.role === "assistant" && m.status === "done" && m.text);
        return last ? { label: l.label, model: l.model, text: last.text } : null;
      })
      .filter((a): a is { label: string; model: string; text: string } => a !== null);
    if (answers.length < 2) {
      setNote("Need a completed answer from at least two lanes before synthesizing.");
      return;
    }
    const synthId = uid();
    setSynthMsg({
      id: synthId,
      role: "assistant",
      engine: "claude",
      model: synthModelRef.current,
      text: "",
      ts: Date.now(),
      status: "streaming",
    });
    setSynthStreaming(true);
    const ac = new AbortController();
    synthAbort.current = ac;
    let acc = "";
    let tokens: number | undefined;
    let sawError = false;
    await streamSynthesize(
      { prompt, answers, model: synthModelRef.current },
      (ev) => {
        if (ev.type === "token") {
          acc += ev.text;
          setSynthMsg((m) => (m ? { ...m, text: acc } : m));
        } else if (ev.type === "usage") tokens = ev.tokens;
        else if (ev.type === "error") {
          sawError = true;
          acc += (acc ? "\n\n" : "") + `⚠️ ${ev.message}`;
        }
      },
      ac.signal,
    );
    setSynthMsg((m) => (m ? { ...m, text: acc, tokens, status: sawError ? "error" : "done" } : m));
    setSynthStreaming(false);
    synthAbort.current = null;
    refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    synthesizeRef.current = synthesize;
  }, [synthesize]);

  const stopSynth = useCallback(() => synthAbort.current?.abort(), []);

  const applyProposed = useCallback(
    async (laneId: string, msgId: string, diff: string) => {
      setApplyingId(msgId);
      const res = await applyDiff(cwdRef.current, diff);
      setApplyingId(null);
      setNote(res.message);
      if (res.applied) {
        updateAssistant(laneId, msgId, (m) => ({ ...m, diffApplied: true }));
        void persist();
      }
    },
    [persist, updateAssistant],
  );

  const newSession = useCallback(() => {
    Object.values(aborts.current).forEach((a) => a.abort());
    aborts.current = {};
    nativeIds.current = {};
    lastPrompt.current = {};
    lastSharedPrompt.current = "";
    snap.current.activeId = null;
    setActiveId(null);
    const d = settingsRef.current;
    setLanes(d.defaultLanes.map((l) => ({ ...l })));
    setSandbox(d.defaultSandbox);
    setGrounded(d.defaultGrounded);
    const blank: Record<string, ChatMessage[]> = {};
    for (const l of d.defaultLanes) blank[l.id] = [];
    threadsRef.current = blank;
    setThreads(threadsRef.current);
    setSynthMsg(null);
    setDraft("");
    setDrafts({});
    setNote("");
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const rec = await getSession(id);
    if (!rec) return;
    // Tear down any in-flight streams before swapping content, so an old turn
    // can't write into the newly loaded session or leave a lane stuck streaming.
    Object.values(aborts.current).forEach((a) => a.abort());
    aborts.current = {};
    synthAbort.current?.abort();
    synthAbort.current = null;
    setStreamingLanes({});
    setSynthStreaming(false);
    setDrafts({});
    setDraft("");
    setNote("");
    createdAt.current[id] = rec.createdAt;
    nativeIds.current = { ...rec.nativeSessionIds };
    lastPrompt.current = {};
    lastSharedPrompt.current = "";
    setActiveId(id);
    snap.current.activeId = id;
    setMode(rec.mode);
    setLanes(rec.lanes.length ? rec.lanes : DEFAULT_LANES.map((l) => ({ ...l })));
    threadsRef.current = rec.threads ?? {};
    setThreads(threadsRef.current);
    setSynthMsg(null);
  }, []);

  const setLane = useCallback((index: number, lane: LaneConfig) => {
    setLanes((prev) => prev.map((l, i) => (i === index ? lane : l)));
  }, []);

  const refreshStatus = useCallback(() => {
    void getStatus().then((s) => s && setStatus(s));
  }, []);

  return {
    // state
    mode,
    lanes,
    threads,
    activeId,
    sessions,
    streamingLanes,
    draft,
    drafts,
    synthMsg,
    synthStreaming,
    status,
    usage,
    cwd,
    sandbox,
    grounded,
    settings,
    applyingId,
    note,
    // setters / actions
    setMode,
    setDraft,
    setDrafts,
    setCwd,
    setSandbox,
    setGrounded,
    setNote,
    updateSettings,
    setLane,
    sendShared,
    sendLane,
    stop,
    regenerate,
    synthesize,
    stopSynth,
    applyProposed,
    newSession,
    loadSession,
    refreshStatus,
    refreshUsage,
  };
}

export type CodexController = ReturnType<typeof useCodex>;
