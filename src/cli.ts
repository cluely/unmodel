#!/usr/bin/env node
/**
 * unmodel CLI — catalog queries (`unmodel models`) and request validation
 * (`unmodel validate <provider>.<endpoint>`).
 *
 * Provider modules and the full catalog are loaded via dynamic `import()` so
 * `unmodel models` never pays for validator code and `unmodel validate` never
 * pays for the ~3.5MB full registry (each validator imports only its own
 * provider's generated catalog).
 */
import { defineCommand, runMain } from "citty";
import { version } from "../package.json";
import { formatIssuePath, type Issue } from "./core/issues";
import type { ValidateOptions } from "./core/options";
import type { ModelInfo } from "./core/catalog-types";
import type { RequestMeta } from "./core/request";
// The hand-maintained validator registry. It lives in its own module so the
// drift test in cli.test.ts can import the maps without running the CLI (this
// file calls runMain() at module scope).
import { MULTIPART_ONLY, REGISTRY } from "./cli-registry";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fail(message: string): void {
  console.error(`unmodel: ${message}`);
  process.exitCode = 1;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** 128000 -> "128,000" without locale-dependent output. */
function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatTokens(n: number | undefined): string {
  return n === undefined || n === 0 ? "-" : groupDigits(n);
}

function formatUsd(n: number | undefined): string {
  if (n === undefined) return "-";
  // Enough precision for per-token rates without scientific notation noise.
  const text = n >= 1 ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${text}`;
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

/** T = tool calling, R = reasoning, V = vision (image input modality). */
function capabilityFlags(info: ModelInfo): string {
  const vision = info.modalities.input.includes("image");
  return `${info.toolCall ? "T" : "-"}${info.reasoning ? "R" : "-"}${vision ? "V" : "-"}`;
}

function formatModelDetail(providerId: string, info: ModelInfo): string {
  const lines: string[] = [];
  lines.push(`${providerId}/${info.id} — ${info.name}`);
  if (info.family) lines.push(`  family:        ${info.family}`);
  if (info.status) lines.push(`  status:        ${info.status}`);
  lines.push(`  modalities:    ${info.modalities.input.join(", ")} -> ${info.modalities.output.join(", ")}`);
  lines.push(`  capabilities:  tools=${info.toolCall} reasoning=${info.reasoning} attachment=${info.attachment}`);
  if (info.structuredOutput !== undefined)
    lines.push(`  structured:    ${info.structuredOutput}`);
  if (info.temperature !== undefined) lines.push(`  temperature:   ${info.temperature}`);
  lines.push(`  open weights:  ${info.openWeights}`);
  const limit = info.limit;
  lines.push(`  context limit: ${formatTokens(limit.context)} tokens`);
  if (limit.input !== undefined) lines.push(`  input limit:   ${formatTokens(limit.input)} tokens`);
  if (limit.output !== undefined)
    lines.push(`  output limit:  ${formatTokens(limit.output)} tokens`);
  if (limit.characters !== undefined)
    lines.push(`  char limit:    ${groupDigits(limit.characters)} characters`);
  const cost = info.cost;
  if (cost) {
    const costLines: Array<[string, number | undefined, string]> = [
      ["input", cost.input, "/M tokens"],
      ["output", cost.output, "/M tokens"],
      ["cache read", cost.cacheRead, "/M tokens"],
      ["cache write", cost.cacheWrite, "/M tokens"],
      ["reasoning", cost.reasoning, "/M tokens"],
      ["input audio", cost.inputAudio, "/M tokens"],
      ["output audio", cost.outputAudio, "/M tokens"],
      ["characters", cost.perMillionCharacters, "/M characters"],
      ["audio", cost.perAudioMinute, "/minute"],
      ["image", cost.perImage, "/image"],
      ["video", cost.perVideoSecond, "/second"],
    ];
    for (const [label, value, unit] of costLines) {
      if (value !== undefined) {
        lines.push(`  ${`cost ${label}:`.padEnd(18)}${formatUsd(value)}${unit}`);
      }
    }
  }
  if (info.releaseDate) lines.push(`  released:      ${info.releaseDate}`);
  if (info.lastUpdated) lines.push(`  last updated:  ${info.lastUpdated}`);
  if (info.knowledge) lines.push(`  knowledge:     ${info.knowledge}`);
  return lines.join("\n");
}

function formatIssueLine(issue: Issue): string {
  return `  ${issue.severity} [${issue.code}] ${formatIssuePath(issue.path)}: ${issue.message}`;
}

/** How the validated body reaches the provider, when it is not a JSON POST. */
interface TransportHint {
  transport: "multipart/form-data" | "websocket";
  note: string;
}

/**
 * A realtime session config: `.request` is a `SocketMeta`, whose url is the
 * socket to open. Its header map is empty for a real reason (browser
 * WebSocket clients cannot set handshake headers), which collides with the
 * multipart signal below — so scheme-check first and let the socket branch win.
 */
function isSocketRequest(request: RequestMeta): boolean {
  return request.url.startsWith("ws://") || request.url.startsWith("wss://");
}

/**
 * Endpoints in REGISTRY split three ways: JSON-bodied ones finalize with a
 * `content-type: application/json` header, multipart ones finalize with an
 * intentionally EMPTY header map (the boundary belongs to `FormData`, so the
 * finalizer cannot name a content type), and realtime session configs finalize
 * with a `ws(s)://` url. The validated params look identical in all three
 * cases, so without this note a CLI user has no way to know the body must be
 * posted as `multipart/form-data` — or sent over a socket the CLI never opens.
 * The endpoints that additionally *require* a Blob are the ones under
 * MULTIPART_ONLY, which the CLI refuses outright.
 */
function transportHint(target: string, request: RequestMeta | undefined): TransportHint | undefined {
  if (request === undefined) return undefined;
  if (isSocketRequest(request)) {
    return {
      transport: "websocket",
      note: `note: realtime session config, not an HTTP body — open ${request.url}; where the API configures by message rather than by query, send the params above as that message. unmodel validates the config only; the socket lifecycle is yours.`,
    };
  }
  if (Object.keys(request.headers).length > 0) return undefined;
  const provider = target.split(".")[0] ?? target;
  return {
    transport: "multipart/form-data",
    note: `note: post this body as multipart/form-data — build it with \`toFormData(validated)\` from "unmodel/${provider}", not JSON.stringify`,
  };
}

// ---------------------------------------------------------------------------
// stdin / file input
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of process.stdin) {
    text +=
      typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
  }
  return text + decoder.decode();
}

async function readParamsText(file: string | undefined): Promise<string> {
  if (file === undefined || file === "-") return readStdin();
  const { readFile } = await import("node:fs/promises");
  return readFile(file, "utf8");
}

// ---------------------------------------------------------------------------
// `unmodel models`
// ---------------------------------------------------------------------------

const modelsCommand = defineCommand({
  meta: {
    name: "models",
    description: "List providers, a provider's models, or one model's full catalog entry",
  },
  args: {
    provider: {
      type: "positional",
      description: "Provider id (omit to list all providers)",
      required: false,
    },
    modelId: {
      type: "positional",
      description: "Model id (omit to list the provider's models)",
      required: false,
    },
    json: { type: "boolean", description: "Emit machine-readable JSON", default: false },
  },
  async run({ args }) {
    // The full registry is a few MB of generated data — load it lazily so
    // `unmodel validate` and `--help` never pay for it.
    const { catalog, getProvider } = await import("./catalog");
    const providerId = args.provider as string | undefined;
    const modelId = args.modelId as string | undefined;

    if (!providerId) {
      const entries = Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b));
      if (args.json) {
        printJson(
          entries.map(([id, entry]) => ({
            id,
            name: entry.provider.name,
            models: Object.keys(entry.models).length,
          })),
        );
        return;
      }
      const rows = entries.map(([id, entry]) => [
        id,
        String(Object.keys(entry.models).length),
        entry.provider.name,
      ]);
      console.log(renderTable(["PROVIDER", "MODELS", "NAME"], rows));
      return;
    }

    const entry = getProvider(providerId);
    if (!entry) {
      fail(`unknown provider "${providerId}" — run \`unmodel models\` to list providers`);
      return;
    }

    if (modelId !== undefined) {
      // Object.hasOwn: ids like "constructor" must not resolve to inherited
      // Object.prototype members.
      const info = Object.hasOwn(entry.models, modelId) ? entry.models[modelId] : undefined;
      if (!info) {
        fail(
          `unknown model "${modelId}" for provider "${providerId}" — run \`unmodel models ${providerId}\` to list models`,
        );
        return;
      }
      if (args.json) printJson(info);
      else console.log(formatModelDetail(providerId, info));
      return;
    }

    if (args.json) {
      printJson({ provider: entry.provider, models: entry.models });
      return;
    }
    const rows = Object.values(entry.models)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((info) => [
        info.id,
        formatTokens(info.limit.context),
        formatTokens(info.limit.output),
        capabilityFlags(info),
        formatUsd(info.cost?.input),
        formatUsd(info.cost?.output),
      ]);
    console.log(`${entry.provider.name} (${providerId}) — ${rows.length} models`);
    console.log(renderTable(["MODEL", "CONTEXT", "OUTPUT", "CAPS", "IN/M", "OUT/M"], rows));
    console.log("CAPS: T = tool calling, R = reasoning, V = vision (image input)");
  },
});

// ---------------------------------------------------------------------------
// `unmodel validate`
// ---------------------------------------------------------------------------

const validateCommand = defineCommand({
  meta: {
    name: "validate",
    description:
      "Validate request params (JSON from a file or stdin) against a provider endpoint",
  },
  args: {
    target: {
      type: "positional",
      description: `Endpoint, e.g. ${Object.keys(REGISTRY).slice(0, 3).join(", ")}, ...`,
      required: true,
    },
    file: {
      type: "positional",
      description: "Path to a JSON params file (omit or use - for stdin)",
      required: false,
    },
    json: { type: "boolean", description: "Emit the ValidateResult as JSON", default: false },
    "max-cost": {
      type: "string",
      description: "Fail (over_budget) when the estimated worst-case cost exceeds this many USD",
    },
  },
  async run({ args }) {
    const target = args.target as string;
    const load = REGISTRY[target];
    if (!load) {
      // Object.hasOwn: a target like "constructor" must not hit Object.prototype.
      if (Object.hasOwn(MULTIPART_ONLY, target)) {
        fail(
          `"${target}" takes a file upload (Blob), which JSON params cannot express — ` +
            `use it from the library instead: import { ... } from "${MULTIPART_ONLY[target]}"`,
        );
        return;
      }
      fail(
        `unknown endpoint "${target}" — available endpoints:\n  ${Object.keys(REGISTRY)
          .sort()
          .join("\n  ")}`,
      );
      return;
    }

    const options: ValidateOptions = {};
    const maxCostRaw = args["max-cost"] as string | undefined;
    if (maxCostRaw !== undefined) {
      const maxCost = Number(maxCostRaw);
      if (!Number.isFinite(maxCost) || maxCost < 0) {
        fail(`--max-cost must be a non-negative number, got "${maxCostRaw}"`);
        return;
      }
      options.maxCostUSD = maxCost;
    }

    let params: unknown;
    try {
      const text = await readParamsText(args.file as string | undefined);
      params = JSON.parse(text);
    } catch (error) {
      fail(`could not read params JSON: ${error instanceof Error ? error.message : error}`);
      return;
    }

    const validator = await load();
    const result = validator.safe(params, options);
    const request = result.ok ? (result.params as { request?: RequestMeta }).request : undefined;
    const hint = result.ok ? transportHint(target, request) : undefined;

    if (args.json) {
      // Validated params carry non-enumerable toSdk/request; JSON.stringify
      // keeps only the enumerable wire body, so surface .request explicitly.
      printJson(
        result.ok
          ? {
              ok: true,
              target,
              params: result.params,
              request,
              ...(hint !== undefined && { transport: hint.transport, note: hint.note }),
              warnings: result.warnings,
              estimate: result.estimate,
            }
          : { ok: false, target, errors: result.errors, warnings: result.warnings },
      );
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (result.ok) {
      console.log(`ok: ${target} params are valid`);
      if (hint !== undefined) console.log(hint.note);
      const { inputTokens, costUSD } = result.estimate;
      const parts: string[] = [];
      if (inputTokens !== undefined) parts.push(`~${groupDigits(inputTokens)} input tokens`);
      if (costUSD !== undefined) parts.push(`max cost ~${formatUsd(costUSD)}`);
      if (parts.length > 0) console.log(`estimate: ${parts.join(", ")}`);
      if (result.warnings.length > 0) {
        console.log(`${result.warnings.length} warning(s):`);
        for (const warning of result.warnings) console.log(formatIssueLine(warning));
      }
      return;
    }

    console.error(`invalid: ${target} params have ${result.errors.length} error(s)`);
    for (const error of result.errors) console.error(formatIssueLine(error));
    if (result.warnings.length > 0) {
      console.error(`${result.warnings.length} warning(s):`);
      for (const warning of result.warnings) console.error(formatIssueLine(warning));
    }
    process.exitCode = 1;
  },
});

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const main = defineCommand({
  meta: {
    name: "unmodel",
    version,
    description: "Catalog-aware validation for LLM and media API requests",
  },
  subCommands: {
    models: modelsCommand,
    validate: validateCommand,
  },
});

runMain(main);
