import type { ButtonHTMLAttributes } from "react";

/** The lime-pill + dark-arrow-disc button style used throughout the reference design's CTAs. */
export function PillButton({
  variant = "accent",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "accent" | "deep" }) {
  const base = "group inline-flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 text-base font-medium transition-all disabled:opacity-40";
  const variants = {
    accent: "bg-accent text-accent-ink hover:bg-accent-strong",
    deep: "bg-deep text-accent hover:bg-deep-alt",
  };
  const discVariants = {
    accent: "bg-deep text-accent",
    deep: "bg-accent text-accent-ink",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      <span>{children}</span>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm transition-transform group-hover:translate-x-0.5 ${discVariants[variant]}`}>
        →
      </span>
    </button>
  );
}
