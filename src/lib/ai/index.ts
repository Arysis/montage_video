import { env } from "@/lib/env";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import { AiNotConfiguredError, type AiProvider } from "./types";

let instance: AiProvider | undefined;

export function ai(): AiProvider {
  if (instance) return instance;
  const e = env();
  if (e.AI_PROVIDER === "anthropic") {
    if (!e.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();
    instance = new AnthropicProvider(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL);
  } else {
    if (e.NODE_ENV === "production" && process.env.ALLOW_MOCK_IN_PRODUCTION !== "1")
      throw new AiNotConfiguredError();
    instance = new MockProvider();
  }
  return instance;
}

export function setAiProvider(p: AiProvider | undefined) {
  instance = p;
}

export * from "./types";
