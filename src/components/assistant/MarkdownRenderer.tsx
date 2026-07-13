"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export function isSafeExternalUrl(value: string | undefined): value is string {
  if (!value || value.startsWith("//")) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function removeUnsafeMarkdownLinks(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, label: string, href: string) => (
    isSafeExternalUrl(href) ? whole : label
  ));
}

export function MarkdownRenderer({ content }: Readonly<{ content: string }>) {
  return (
    <div className="assistant-markdown text-[0.9375rem] leading-7 text-slate-700">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        urlTransform={(url) => isSafeExternalUrl(url) ? url : ""}
        components={{
          img: () => null,
          a: ({ href, children }) => isSafeExternalUrl(href)
            ? <a className="font-semibold text-primary underline decoration-blue-300 underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">{children}</a>
            : <>{children}</>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-bold text-ink first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-bold text-ink">{children}</h3>,
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 ps-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 ps-5">{children}</ol>,
          code: ({ children }) => <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>,
        }}
      >
        {removeUnsafeMarkdownLinks(content)}
      </ReactMarkdown>
    </div>
  );
}
