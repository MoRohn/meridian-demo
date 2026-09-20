import { Icon, type IconName } from "./Icon";

export type MobileView = "document" | "assistant" | "analysis";

const ITEMS: { id: MobileView; label: string; icon: IconName }[] = [
  { id: "document", label: "Document", icon: "book" },
  { id: "assistant", label: "Assistant", icon: "chat" },
  { id: "analysis", label: "Analysis", icon: "chart" },
];

/**
 * Bottom navigation for screens too narrow for the two-column workspace: the
 * three panes (document, assistant, analysis) each get the full screen, and a
 * dot marks a pane that has something new while another is in view.
 */
export function MobileNav({
  active,
  onChange,
  badges,
}: {
  active: MobileView;
  onChange: (view: MobileView) => void;
  badges: Partial<Record<MobileView, boolean>>;
}) {
  return (
    <nav
      aria-label="Workspace sections"
      className="flex shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-bold transition-colors short:flex-row short:gap-2 short:py-1.5 ${
              isActive ? "text-deep" : "text-muted hover:text-deep"
            }`}
          >
            <span className={`flex h-7 w-14 items-center justify-center rounded-full transition-colors short:h-6 short:w-auto short:bg-transparent ${isActive ? "bg-accent text-accent-ink" : ""}`}>
              <Icon name={item.icon} size={20} />
            </span>
            {item.label}
            {badges[item.id] && !isActive && (
              <span className="absolute right-[calc(50%-1.6rem)] top-1.5 h-2 w-2 rounded-full bg-rose-600 ring-2 ring-surface" aria-label="New" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
