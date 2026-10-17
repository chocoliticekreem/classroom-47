"use client";
// Renders the AST from markdown.ts as React elements. No HTML strings are ever injected:
// every piece of text goes through React's escaping.
import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "./markdown";

function renderInline(nodes: Inline[], key = ""): ReactNode {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.type) {
      case "text":
        return <Fragment key={k}>{n.text}</Fragment>;
      case "code":
        return (
          <code key={k} className="rounded bg-black/30 px-1 py-px font-mono text-[0.9em] text-[#ffb68a]">
            {n.text}
          </code>
        );
      case "strong":
        return (
          <strong key={k} className="font-semibold text-white">
            {renderInline(n.children, k + ".")}
          </strong>
        );
      case "em":
        return <em key={k}>{renderInline(n.children, k + ".")}</em>;
      case "link":
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" className="text-[#ff8a4c] underline underline-offset-2">
            {renderInline(n.children, k + ".")}
          </a>
        );
    }
  });
}

const H = ["text-lg", "text-base", "text-sm", "text-sm", "text-xs", "text-xs"];

function renderBlocks(blocks: Block[]): ReactNode {
  return blocks.map((b, i) => {
    switch (b.type) {
      case "heading": {
        const Tag = `h${b.level}` as "h1";
        return (
          <Tag key={i} className={`${H[b.level - 1]} mb-2 mt-5 font-semibold text-white first:mt-0 ${b.level <= 2 ? "border-b border-white/10 pb-1" : ""}`}>
            {renderInline(b.children)}
          </Tag>
        );
      }
      case "paragraph":
        return (
          <p key={i} className="my-2 leading-relaxed">
            {renderInline(b.children)}
          </p>
        );
      case "list": {
        const items = b.items.map((it, j) => (
          <li key={j} className="my-0.5 pl-1">
            {renderInline(it)}
          </li>
        ));
        return b.ordered ? (
          <ol key={i} start={b.start} className="my-2 list-decimal pl-6 marker:text-white/40">
            {items}
          </ol>
        ) : (
          <ul key={i} className="my-2 list-disc pl-6 marker:text-white/40">
            {items}
          </ul>
        );
      }
      case "table":
        return (
          <div key={i} className="my-3 overflow-x-auto rounded-md ring-1 ring-white/10">
            <table className="w-full border-collapse text-xs tabular-nums">
              <thead className="bg-white/5">
                <tr>
                  {b.header.map((h, j) => (
                    <th key={j} className="border-b border-white/10 px-2.5 py-1.5 font-semibold text-white/80" style={{ textAlign: b.align[j] ?? "left" }}>
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-b border-white/5 last:border-0 odd:bg-white/[0.015]">
                    {r.map((c, k) => (
                      <td key={k} className="px-2.5 py-1.5 align-top" style={{ textAlign: b.align[k] ?? "left" }}>
                        {renderInline(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "code":
        return (
          <pre key={i} className="my-3 overflow-x-auto rounded-md bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/80 ring-1 ring-white/10">
            <code>{b.text}</code>
          </pre>
        );
      case "blockquote":
        return (
          <blockquote key={i} className="my-2 border-l-2 border-[#ff6a1a]/60 pl-3 text-white/70">
            {renderBlocks(b.children)}
          </blockquote>
        );
      case "hr":
        return <hr key={i} className="my-4 border-white/10" />;
    }
  });
}

export default function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className="text-[13px] text-white/75">{renderBlocks(blocks)}</div>;
}
