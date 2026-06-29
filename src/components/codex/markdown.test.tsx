import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders prose and a code block with a copy button", () => {
    render(<Markdown text={"Hello **world**\n\n```ts\nconst x = 1;\n```"} />);
    expect(screen.getByText(/Hello/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("renders a bullet list", () => {
    render(<Markdown text={"- one\n- two"} />);
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });
});
