// Per-lane engine + model selector. Defaults stay Codex gpt-5.5 / Claude opus;
// switching engine resets the model to that engine's first suggestion.
import { ENGINE_MODELS, type CouncilEngine, type LaneConfig } from "@/lib/codex-council-types";

export function ModelPicker({
  lane,
  onChange,
  disabled,
}: {
  lane: LaneConfig;
  onChange: (lane: LaneConfig) => void;
  disabled?: boolean;
}) {
  const setEngine = (engine: CouncilEngine): void =>
    onChange({ ...lane, engine, model: ENGINE_MODELS[engine][0] });
  const setModel = (model: string): void => onChange({ ...lane, model });

  return (
    <span className="cx-picker">
      <select
        value={lane.engine}
        onChange={(e) => setEngine(e.target.value as CouncilEngine)}
        aria-label="Engine"
        disabled={disabled}
      >
        <option value="codex">Codex</option>
        <option value="claude">Claude</option>
      </select>
      <select
        value={lane.model}
        onChange={(e) => setModel(e.target.value)}
        aria-label="Model"
        disabled={disabled}
      >
        {ENGINE_MODELS[lane.engine].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </span>
  );
}
