// Shared composer: multiline input + send, ⌘↵ / Ctrl↵ to send. Used by the
// single panel, the council shared composer, and each independent lane.
import type { ReactNode } from "react";

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  sendLabel: string;
  /** Green "individual" send styling for independent lanes. */
  individual?: boolean;
  disabled?: boolean;
  hint?: string;
  /** Extra control rendered beside Send (e.g. the council Synthesize button). */
  extra?: ReactNode;
}

export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  sendLabel,
  individual,
  disabled,
  hint,
  extra,
}: ComposerProps) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!disabled) onSend();
    }
  };
  return (
    <form
      className="cx-composer cx-glass"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSend();
      }}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <div className="cx-compose-side">
        <button
          type="submit"
          className={`cx-send${individual ? " individual" : ""}`}
          disabled={disabled}
        >
          {sendLabel}
        </button>
        {extra}
        <div className="cx-shortcut">{hint ?? "⌘↵ send"}</div>
      </div>
    </form>
  );
}
