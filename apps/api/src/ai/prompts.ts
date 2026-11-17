import data from "./prompt-data.json" with { type: "json" };
import type { LLMMessage } from "./providers.js";
export const DEFAULT_SYSTEM_VERSION = "system-v2",
  DEFAULT_CLASSIFIER_VERSION = "classify-v2";
export const systemPrompts: Record<string, string> = data._SYSTEM_PROMPTS;
export const classifierPrompts: Record<string, string> =
  data._CLASSIFIER_PROMPTS;
export function systemPrompt(version = DEFAULT_SYSTEM_VERSION) {
  return systemPrompts[version] ?? systemPrompts[DEFAULT_SYSTEM_VERSION]!;
}
export function classificationMessages(
  text: string,
  version = DEFAULT_CLASSIFIER_VERSION,
): LLMMessage[] {
  const template =
    classifierPrompts[version] ??
    classifierPrompts[DEFAULT_CLASSIFIER_VERSION]!;
  const content = template
    .replace(
      "{definitions}",
      Object.entries(data.definitions)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n"),
    )
    .replaceAll("{{", "{")
    .replaceAll("}}", "}");
  const messages: LLMMessage[] = [{ role: "system", content }];
  for (const [input, intent] of data._CLASSIFIER_FEWSHOT)
    messages.push(
      { role: "user", content: input! },
      {
        role: "assistant",
        content: JSON.stringify({
          intent,
          needs_clarification: false,
          rationale: "example",
          confidence: 0.95,
        }),
      },
    );
  messages.push({ role: "user", content: text });
  return messages;
}
