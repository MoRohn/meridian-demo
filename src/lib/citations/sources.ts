import { AUTHORITY_SECTIONS } from "@/lib/data/authorities";
import { getOrCreateSession } from "@/lib/memory/session";
import { documentAuthorities } from "./sections";

/**
 * Everything a quote can be located in: the playbook, plus the session's active document (as `Doc §N`), so a quote
 * taken from the document the user loaded is found, and judged against that clause, rather than reported fabricated.
 */
export function citationSources(sessionId: string | undefined): Record<string, string> {
  const doc = sessionId ? getOrCreateSession(sessionId).activeDocument : null;
  return { ...AUTHORITY_SECTIONS, ...documentAuthorities(doc?.text) };
}
