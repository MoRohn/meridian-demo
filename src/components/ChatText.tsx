import { parseChatText, parseInline } from "@/lib/chatText";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((run, i) => (run.bold ? <strong key={i}>{run.text}</strong> : <span key={i}>{run.text}</span>))}
    </>
  );
}

/** An assistant reply with its structure shown: paragraphs, bullet and numbered lists, and quoted clauses. */
export function ChatText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseChatText(text).map((block, i) => {
        if (block.type === "bullets")
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j}><Inline text={item} /></li>
              ))}
            </ul>
          );
        if (block.type === "steps")
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j}><Inline text={item} /></li>
              ))}
            </ol>
          );
        if (block.type === "quote")
          return (
            <blockquote key={i} className="border-l-[3px] border-deep/50 bg-elevated/70 py-1 pl-3 pr-2 text-[0.94em] italic text-secondary">
              <Inline text={block.text} />
            </blockquote>
          );
        return (
          <p key={i}>
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
