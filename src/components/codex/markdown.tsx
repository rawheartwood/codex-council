// Markdown renderer for assistant messages: react-markdown + GFM + syntax
// highlighting, with code blocks rendered into the kitsune `.cx-code` shell
// (language label + copy button). Used for arbitrary model output, so parsing
// is delegated to react-markdown rather than hand-rolled.
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/** Flatten React children to plain text for the copy button. */
function flattenText(node: ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object" && "props" in (node as { props?: { children?: ReactNode } })) {
    return flattenText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "code";
  const copy = (): void => {
    const text = flattenText(children);
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };
  return (
    <div className="cx-code">
      <div className="cx-code-head">
        <span>{lang}</span>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="cx-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Unwrap the default <pre>; CodeBlock supplies its own.
          pre: ({ children }) => <>{children}</>,
          code({ className, children, ...props }) {
            if ((className ?? "").includes("language-")) {
              return <CodeBlock className={className}>{children}</CodeBlock>;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
