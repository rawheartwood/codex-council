// First-run / empty-thread hero with example prompts. The fox + torii art is a
// CSS background on .cx-hero; each prompt card carries its own kitsune banner
// behind a left-dark legibility gradient (source-locked kitsune art).
import promptArchitecture from "@/assets/codex/prompt-architecture.webp";
import promptStacktrace from "@/assets/codex/prompt-stacktrace.webp";
import promptPlan from "@/assets/codex/prompt-plan.webp";
import promptTests from "@/assets/codex/prompt-tests.webp";
import promptCouncil from "@/assets/codex/prompt-council.webp";
import promptRefactor from "@/assets/codex/prompt-refactor.webp";

const PROMPTS: Array<{ title: string; blurb: string; prompt: string; art: string }> = [
  {
    title: "Review this architecture",
    blurb: "Find failure modes before implementation.",
    prompt: "Review this architecture and identify failure modes before implementation:\n\n",
    art: promptArchitecture,
  },
  {
    title: "Explain this stack trace",
    blurb: "Identify likely root cause and repair path.",
    prompt: "Explain this stack trace — likely root cause and the repair path:\n\n",
    art: promptStacktrace,
  },
  {
    title: "Plan this feature",
    blurb: "Break the work into reliable milestones.",
    prompt: "Plan this feature as reliable, testable milestones:\n\n",
    art: promptPlan,
  },
  {
    title: "Generate test cases",
    blurb: "Cover edge states, regressions, and timeouts.",
    prompt: "Generate thorough test cases (edge states, regressions, timeouts) for:\n\n",
    art: promptTests,
  },
  {
    title: "Council review",
    blurb: "Ask both lanes for conflicting analysis.",
    prompt: "Council review — give me conflicting analysis from both lanes on:\n\n",
    art: promptCouncil,
  },
  {
    title: "Refactor safely",
    blurb: "Preserve behavior while reducing risk.",
    prompt: "Propose a safe refactor that preserves behavior while reducing risk:\n\n",
    art: promptRefactor,
  },
];

// Dark-on-the-left gradient over the banner so the title/blurb stay legible
// while the fox/torii art reads on the right of each card.
const CARD_SCRIM =
  "linear-gradient(105deg, rgba(4,7,16,0.93) 0%, rgba(4,7,16,0.74) 48%, rgba(4,7,16,0.4) 100%)";

export function EmptyState({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  return (
    <section className="cx-empty cx-glass" aria-label="First-run state">
      <div
        className="cx-hero"
        role="img"
        aria-label="Codex kitsune with torii light and digital tails"
      />
      <div className="cx-empty-content">
        <h2>Codex Council</h2>
        <p>
          Read-only AI reasoning for code, architecture, logs, and implementation planning — Codex
          on your ChatGPT subscription, Claude on Max. Send to one lane, or convene the council and
          synthesize a verdict.
        </p>
        <div className="cx-prompt-grid">
          {PROMPTS.map((p) => (
            <button
              key={p.title}
              type="button"
              className="cx-prompt-card"
              style={{ backgroundImage: `${CARD_SCRIM}, url(${p.art})` }}
              onClick={() => onPrompt(p.prompt)}
            >
              <b>{p.title}</b>
              <span>{p.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
