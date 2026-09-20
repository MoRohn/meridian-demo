"use client";

import { useState } from "react";
import { useDialog } from "@/lib/useDialog";
import { Icon } from "./Icon";
import {
  type ApiKeySettings,
  type JudgeChoice,
  type JudgeProvider,
  type ModelOption,
  TYPESAFE_MODELS,
  OPENAI_MODELS,
  DEFAULT_TYPESAFE_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_JUDGE_MODEL,
  JUDGE_LABELS,
  JUDGE_MODELS,
  JUDGE_OPTIONS,
  JUDGE_RECOMMENDATION,
} from "@/lib/settings";

/** A model id is a short name (mirrors eval-service/main.py): letters, digits and . _ : / - only. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const CUSTOM = "__custom__";

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
  const [customJudgeModel, setCustomJudgeModel] = useState(false);
  const [typedJudgeKeys, setTypedJudgeKeys] = useState<Partial<Record<JudgeProvider, string>>>({});
  const dialogRef = useDialog(open, onClose);

  // Re-seed the draft from the saved settings each time the modal opens —
  // done during render (React's documented pattern for this) rather than in
  // an effect, since the component stays mounted between opens/closes.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(settings);
      setCustomJudgeModel(false);
      setTypedJudgeKeys({});
    }
  }

  if (!open) return null;

  function update<K extends keyof ApiKeySettings>(key: K, value: ApiKeySettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  /**
   * Choosing a judge picks that provider's default model and shows that provider's own key. A key typed for one provider is
   * remembered while this dialog is open (so clicking around does not lose it) but only the chosen provider's key is ever
   * saved, so a Claude key can never be sent to Gemini's judge.
   */
  function chooseJudge(choice: JudgeChoice) {
    if (choice === draft.judgeProvider) return;
    setCustomJudgeModel(false);
    setTypedJudgeKeys((k) => (draft.judgeProvider === "saved" ? k : { ...k, [draft.judgeProvider]: draft.judgeApiKey }));
    setDraft((d) => ({
      ...d,
      judgeProvider: choice,
      judgeModel: choice === "saved" ? "" : DEFAULT_JUDGE_MODEL[choice],
      judgeApiKey: choice === "saved" ? "" : (typedJudgeKeys[choice] ?? ""),
    }));
  }

  const judgeIsChosen = draft.judgeProvider !== "saved";
  const judgeModelList = judgeIsChosen ? JUDGE_MODELS[draft.judgeProvider as JudgeProvider] : [];
  const judgeModelInList = judgeModelList.some((m) => m.id === draft.judgeModel);
  const showCustomJudgeModel = judgeIsChosen && (customJudgeModel || (draft.judgeModel !== "" && !judgeModelInList));
  const judgeModelError = judgeIsChosen && draft.judgeModel.trim() !== "" && !MODEL_ID.test(draft.judgeModel.trim()) ? "A model id uses letters, digits and . _ : / - only." : null;

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

        <fieldset className="space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wide text-muted">Judge model</legend>
          <p className="text-xs leading-relaxed text-muted">The judge scores every answer, independently of the models it scores.</p>
          <div role="radiogroup" aria-label="Judge model" className="space-y-1.5">
            {JUDGE_OPTIONS.map((o) => {
              const selected = draft.judgeProvider === o.id;
              const missingOpenAIKey = o.id === "saved" && !draft.openaiApiKey.trim();
              return (
                <label
                  key={o.id}
                  className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                    selected ? "border-deep bg-deep/[0.06]" : "border-border-strong bg-elevated hover:border-deep/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="judge-provider"
                    value={o.id}
                    checked={selected}
                    onChange={() => chooseJudge(o.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--deep)]"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-bold text-foreground">
                      {o.label}
                      {o.id === "saved" && <span className="rounded-full border border-border-strong px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-muted">Default</span>}
                      {o.independent && <span className="rounded-full border border-emerald-600/30 bg-emerald-600/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-800">Recommended</span>}
                    </span>
                    <span className="block text-xs leading-relaxed text-muted">{missingOpenAIKey ? "Save an OpenAI key above and this judge is ready." : o.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {judgeIsChosen && (
            <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
              <select
                value={showCustomJudgeModel ? CUSTOM : draft.judgeModel}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) {
                    setCustomJudgeModel(true);
                    update("judgeModel", "");
                  } else {
                    setCustomJudgeModel(false);
                    update("judgeModel", e.target.value);
                  }
                }}
                aria-label={`${JUDGE_LABELS[draft.judgeProvider as JudgeProvider]} judge model`}
                className="w-full rounded-lg border border-border-strong bg-elevated px-3 py-2.5 text-sm text-foreground outline-none focus:border-deep focus-visible:ring-2 focus-visible:ring-deep/50"
              >
                {judgeModelList.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value={CUSTOM}>Another model id&hellip;</option>
              </select>
              {showCustomJudgeModel && (
                <div>
                  <input
                    type="text"
                    value={draft.judgeModel}
                    onChange={(e) => update("judgeModel", e.target.value)}
                    placeholder={DEFAULT_JUDGE_MODEL[draft.judgeProvider as JudgeProvider]}
                    aria-label="Judge model id"
                    aria-invalid={judgeModelError ? true : undefined}
                    aria-describedby={judgeModelError ? "judge-model-error" : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-border-strong bg-elevated px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-deep focus-visible:ring-2 focus-visible:ring-deep/50"
                  />
                  {judgeModelError && (
                    <p id="judge-model-error" role="alert" className="mt-1 text-xs font-semibold text-rose-800">
                      {judgeModelError}
                    </p>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={draft.judgeApiKey}
                  onChange={(e) => update("judgeApiKey", e.target.value)}
                  placeholder={draft.judgeProvider === "openai" ? "Optional: leave blank to use the OpenAI key above" : `${JUDGE_LABELS[draft.judgeProvider as JudgeProvider]} API key`}
                  aria-label={`${JUDGE_LABELS[draft.judgeProvider as JudgeProvider]} judge API key`}
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-border-strong bg-elevated px-3 py-2.5 text-sm text-foreground outline-none focus:border-deep focus-visible:ring-2 focus-visible:ring-deep/50"
                />
                {draft.judgeApiKey && (
                  <button onClick={() => update("judgeApiKey", "")} className="flex min-h-9 min-w-9 shrink-0 items-center justify-center px-2 text-xs font-bold text-secondary hover:text-rose-800">
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          <p className="rounded-lg border border-emerald-600/25 bg-emerald-600/[0.06] px-3 py-2 text-xs leading-relaxed text-emerald-900">{JUDGE_RECOMMENDATION}</p>
        </fieldset>

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
              DeepEval G-Eval judges each backend&rsquo;s answer the first time you open an action. This makes paid judge calls with your
              judge key; turn it off to evaluate only when you click Evaluate.
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
            disabled={Boolean(judgeModelError)}
            className="rounded-full bg-fill px-4 py-2 text-sm font-bold text-on-fill transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
          <button onClick={onClear} className="-my-2 -mr-2 flex min-h-9 min-w-9 items-center justify-center px-2 text-xs font-bold text-secondary hover:text-rose-800">
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
