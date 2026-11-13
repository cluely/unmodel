import { expect, test } from "bun:test";
import { chat } from "../../src/chat";
import { chat as revanaChat } from "../../src/providers/revana/chat";
import { chatProfiles } from "../../src/catalog/chat-profiles.gen";
import { CHAT_MODEL_REFS } from "../../src/catalog/chat-refs-values.gen";

test("Revana shared chat compiles to the wire validator's request", () => {
  const messages = [{ role: "user" as const, content: "Hello" }];
  const result = chat({ model: "revana/claude-fable-5", messages });
  const wire = revanaChat({ model: "claude-fable-5", messages });
  expect(JSON.parse(JSON.stringify(result))).toEqual(JSON.parse(JSON.stringify(wire)));
  expect(result.request).toEqual(wire.request);
  expect(result.target).toBe("revana");
  expect(CHAT_MODEL_REFS).toContain("revana/claude-fable-5");
  expect(chatProfiles.revana?.["claude-fable-5"]).toBeDefined();
});

test("Revana shared chat retains endpoint-specific refusals", () => {
  const result = chat.safe({
    model: "revana/claude-fable-5",
    messages: [{ role: "user", content: "Hello" }],
    providerOptions: { revana: { web_search_options: {} } },
  });
  expect(result.ok).toBe(false);
});
