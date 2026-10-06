import { useEffect, useState } from "react";
import { DEFAULT_OPENAI_MODEL, MODEL_STORAGE_KEY, isKnownModel } from "@/lib/openai/models";

export function useAiModel() {
  const [model, setModel] = useState<string>(DEFAULT_OPENAI_MODEL);

  useEffect(() => {
    const stored = globalThis.localStorage?.getItem(MODEL_STORAGE_KEY);
    if (stored && isKnownModel(stored)) setModel(stored);
  }, []);

  const update = (next: string) => {
    setModel(next);
    globalThis.localStorage?.setItem(MODEL_STORAGE_KEY, next);
  };

  return { model, setModel: update };
}
