"use client";

import { useState } from "react";
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
        className="animate-in w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-foreground">API Keys</h2>
          <button onClick={onClose} className="text-2xl leading-none text-muted hover:text-foreground" aria-label="Close">
            ×
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

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full border border-border-strong bg-elevated px-4 py-2 text-sm font-bold text-secondary transition-colors hover:text-deep"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-full bg-deep px-4 py-2 text-sm font-bold text-accent transition-opacity hover:opacity-90"
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
          <button onClick={onClear} className="text-xs font-bold text-secondary hover:text-rose-700">
            Clear
          </button>
        )}
      </div>
      <input
        type="password"
        value={keyValue}
        onChange={(e) => onKeyChange(e.target.value)}
        placeholder={`${title} API key`}
        autoComplete="off"
        className="w-full rounded-lg border border-border-strong bg-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-deep/40"
      />
      <select
        value={modelValue}
        onChange={(e) => onModelChange(e.target.value)}
        className="w-full rounded-lg border border-border-strong bg-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-deep/40"
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
