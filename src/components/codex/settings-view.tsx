// Settings — persisted, cross-device console preferences. Presentational: owns a
// local draft and commits via onSave (which persists to the server settings store).
import { useEffect, useRef, useState } from "react";
import {
  ENGINE_MODELS,
  CODEX_THEMES,
  DEFAULT_SETTINGS,
  type CouncilSettings,
} from "@/lib/codex-council-types";

type Settings = CouncilSettings & { defaultBrief?: string };

export function SettingsView({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (next: CouncilSettings) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [saved, setSaved] = useState(false);
  const edited = useRef(false);

  // Re-sync when the server settings arrive, unless the user has started editing.
  // Without this, opening Settings before the async load resolves freezes the
  // draft on defaults and Save writes those defaults over the real settings.
  useEffect(() => {
    if (!edited.current) setDraft(settings);
  }, [settings]);

  const patch = (p: Partial<CouncilSettings>): void => {
    edited.current = true;
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
  };
  const setLaneModel = (i: number, model: string): void =>
    patch({ defaultLanes: draft.defaultLanes.map((l, j) => (j === i ? { ...l, model } : l)) });

  // onSave takes CouncilSettings; draft's extra defaultBrief is harmless (the
  // server ignores unknown fields), so no strip needed.
  const save = async (): Promise<void> => {
    await onSave(draft);
    edited.current = false;
    setSaved(true);
  };

  return (
    <div className="cx-settings-view">
      <h2>Settings</h2>
      <p className="cx-set-sub">
        Saved to the server — they follow you across desktop & the iPhone PWA.
      </p>

      <section className="cx-set-group">
        <h3>Default models</h3>
        {draft.defaultLanes.map((lane, i) => (
          <label key={lane.id} className="cx-set-row">
            <span>
              {lane.label} <em>({lane.engine})</em>
            </span>
            <select value={lane.model} onChange={(e) => setLaneModel(i, e.target.value)}>
              {ENGINE_MODELS[lane.engine].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p className="cx-set-hint">Codex always runs at xhigh reasoning · priority tier.</p>
      </section>

      <section className="cx-set-group">
        <h3>New-session defaults</h3>
        <label className="cx-set-row">
          <span>Sandbox</span>
          <select
            value={draft.defaultSandbox}
            onChange={(e) =>
              patch({ defaultSandbox: e.target.value as CouncilSettings["defaultSandbox"] })
            }
          >
            <option value="read-only">read-only</option>
            <option value="workspace-write">workspace-write</option>
          </select>
        </label>
        <label className="cx-set-row">
          <span>Brief grounding on by default</span>
          <input
            type="checkbox"
            checked={draft.defaultGrounded}
            onChange={(e) => patch({ defaultGrounded: e.target.checked })}
          />
        </label>
      </section>

      <section className="cx-set-group">
        <h3>Council</h3>
        <label className="cx-set-row">
          <span>Auto-synthesize differences each cycle</span>
          <input
            type="checkbox"
            checked={draft.autoSynth}
            onChange={(e) => patch({ autoSynth: e.target.checked })}
          />
        </label>
        <label className="cx-set-row">
          <span>Synthesizer model</span>
          <select value={draft.synthModel} onChange={(e) => patch({ synthModel: e.target.value })}>
            {ENGINE_MODELS.claude.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="cx-set-group">
        <h3>Theme</h3>
        <label className="cx-set-row">
          <span>Tab skin</span>
          <select value={draft.theme} onChange={(e) => patch({ theme: e.target.value })}>
            {CODEX_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="cx-set-group">
        <h3>Grounding brief</h3>
        <p className="cx-set-hint">
          Injected identically into both lanes when grounding is on. Blank = the built-in brief.
        </p>
        <textarea
          className="cx-set-brief"
          rows={10}
          value={draft.brief}
          placeholder={draft.defaultBrief || "Blank = the built-in example brief"}
          onChange={(e) => patch({ brief: e.target.value })}
        />
        <div className="cx-set-actions">
          <button
            type="button"
            className="cx-chip"
            onClick={() => patch({ brief: draft.defaultBrief ?? "" })}
          >
            Load built-in to edit
          </button>
          <button type="button" className="cx-chip" onClick={() => patch({ brief: "" })}>
            Reset brief to built-in
          </button>
        </div>
      </section>

      <div className="cx-set-footer">
        <button type="button" className="cx-chip" onClick={() => patch({ ...DEFAULT_SETTINGS })}>
          Reset all to defaults
        </button>
        <button
          type="button"
          className="cx-chip"
          style={{ borderColor: "var(--cx-cyan)", color: "var(--cx-cyan)", fontWeight: 700 }}
          onClick={() => void save()}
        >
          {saved ? "Saved ✓" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
