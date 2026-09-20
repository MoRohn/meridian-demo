"use client";

import { useState } from "react";
import { useDialog } from "@/lib/useDialog";
import { Icon } from "./Icon";
import {
  type ApiKeySettings,
  type ModelOption,
  TYPESAFE_MODELS,
  OPENAI_MODELS,
  DEFAULT_TYPESAFE_MODEL,
  DEFAULT_OPENAI_MODEL,
} from "@/lib/settings";

/**
 * A user-supplied key here always wins over the server's environment
 * variable for every request this app makes (chat turns, citation checks,
 * excerpt analysis, and both OpenAI comparison calls) — see
 * src/lib/settings.ts and the `override` params threaded through
 * src/lib/typesafe/client.ts / src/lib/openai/client.ts. Keys live only in
 * localStorage; the native `type="password"` input is what gives the
 * "hidden, just dots after saved" behavior for free.
 */
export function SettingsModal({
  open,
  settings,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: ApiKeySettings;
  onClose: () => void;
  onSave: (next: ApiKeySettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const dialogRef = useDialog(open, onClose);

  // Re-seed the draft from the saved settings each time the modal opens —
  // done during render (React's documented pattern for this) rather than in
  // an effect, since the component stays mounted between opens/closes.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDraft(settings);
  }

  if (!open) return null;

  function update<K extends keyof ApiKeySettings>(key: K, value: ApiKeySettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  function handleClearProvider(prefix: "typesafe" | "openai") {
    const defaultModel = prefix === "typesafe" ? DEFAULT_TYPESAFE_MODEL : DEFAULT_OPENAI_MODEL;
    setDraft((d) => ({ ...d, [`${prefix}ApiKey`]: "", [`${prefix}Model`]: defaultModel }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        className="animate-in max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="settings-title" className="text-lg font-extrabold text-foreground">API Keys</h2>
          <button
            onClick={onClose}
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            aria-label="Close"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <ProviderSection
          title="TypeSafe"
          keyValue={draft.typesafeApiKey}
          modelValue={draft.typesafeModel}
          models={TYPESAFE_MODELS}
          onKeyChange={(v) => update("typesafeApiKey", v)}
          onModelChange={(v) => update("typesafeModel", v)}
          onClear={() => handleClearProvider("typesafe")}
        />

        <div className="my-4 border-t border-border" />

        <ProviderSection
          title="OpenAI"
          keyValue={draft.openaiApiKey}
          modelValue={draft.openaiModel}
          models={OPENAI_MODELS}
          onKeyChange={(v) => update("openaiApiKey", v)}
          onModelChange={(v) => update("openaiModel", v)}
          onClear={() => handleClearProvider("openai")}
        />

        <div className="my-4 border-t border-border" />

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={draft.autoEvaluate}
            onChange={(e) => update("autoEvaluate", e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--deep)]"
          />
          <span className="text-sm">
            <span className="block font-bold text-foreground">Evaluate the first result of each action automatically</span>
            <span className="block text-xs leading-relaxed text-muted">
              DeepEval G-Eval judges each backend&rsquo;s answer the first time you open an action. This makes paid judge calls with your OpenAI
              key; turn it off to evaluate only when you click Evaluate.
            </span>
          </span>
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full border border-border-strong bg-elevated px-4 py-2 text-sm font-bold text-secondary transition-colors hover:text-deep"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-full bg-fill px-4 py-2 text-sm font-bold text-on-fill transition-opacity hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderSection({
  title,
  keyValue,
  modelValue,
  models,
  onKeyChange,
  onModelChange,
  onClear,
}: {
  title: string;
  keyValue: string;
  modelValue: string;
  models: ModelOption[];
  onKeyChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">{title}</p>
        {keyValue && (
          <button onClick={onClear} className="-my-2 -mr-2 px-2 py-2 text-xs font-bold text-secondary hover:text-rose-800">
            Clear
          </button>
        )}
      </div>
      <input
        type="password"
        value={keyValue}
        onChange={(e) => onKeyChange(e.target.value)}
        placeholder={`${title} API key`}
        aria-label={`${title} API key`}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-border-strong bg-elevated px-3 py-2.5 text-sm text-foreground outline-none focus:border-deep focus-visible:ring-2 focus-visible:ring-deep/50"
      />
      <select
        value={modelValue}
        onChange={(e) => onModelChange(e.target.value)}
        aria-label={`${title} model`}
        className="w-full rounded-lg border border-border-strong bg-elevated px-3 py-2.5 text-sm text-foreground outline-none focus:border-deep focus-visible:ring-2 focus-visible:ring-deep/50"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
