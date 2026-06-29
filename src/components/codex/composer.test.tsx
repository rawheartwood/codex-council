import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./composer";

describe("Composer", () => {
  it("fires onSend on ⌘↵", () => {
    const onSend = vi.fn();
    render(
      <Composer
        value="hi"
        onChange={() => {}}
        onSend={onSend}
        placeholder="ask"
        sendLabel="Send"
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("ask"), { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does not send on ⌘↵ when disabled", () => {
    const onSend = vi.fn();
    render(
      <Composer
        value="hi"
        onChange={() => {}}
        onSend={onSend}
        placeholder="ask"
        sendLabel="Send"
        disabled
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("ask"), { key: "Enter", metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
