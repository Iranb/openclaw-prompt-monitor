/**
 * OpenClaw Prompt Monitor Plugin
 *
 * Records prompts at two stages:
 * - Before hooks: prompt from Reply layer (session hints, system events, etc.)
 * - After hooks: final prompt actually sent to the model (includes prependContext)
 *
 * Saves to a configurable cache directory. Use plugins.entries.prompt-monitor.config
 * to control which prompts to save.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type PluginConfig = {
  enabled?: boolean;
  cacheDir?: string;
  saveBeforeHook?: boolean;
  saveAfterHook?: boolean;
};

type PendingBefore = {
  prompt: string;
  timestamp: number;
};

const pendingBySession = new Map<string, PendingBefore>();

function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "unknown";
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      const b = block as { type?: string; text?: string };
      if (b?.type === "text" && typeof b?.text === "string") texts.push(b.text);
    }
    return texts.join("\n") || undefined;
  }
  return undefined;
}

function extractUserPrompts(messages: unknown[]): { last?: string; first?: string } {
  let first: string | undefined;
  let last: string | undefined;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const m = msg as { role?: string; content?: unknown };
    if (m.role !== "user") continue;
    const text = extractTextFromContent(m.content);
    if (text) {
      if (first === undefined) first = text;
      last = text;
    }
  }
  return { first, last };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writePromptFile(
  cacheDir: string,
  sessionKey: string,
  timestamp: number,
  kind: "before" | "after",
  prompt: string,
): Promise<string> {
  const sanitized = sanitizeSessionKey(sessionKey);
  const filename = `${sanitized}_${timestamp}_${kind}.txt`;
  const filePath = path.join(cacheDir, filename);
  await ensureDir(cacheDir);
  await fs.writeFile(filePath, prompt, "utf-8");
  return filePath;
}

export default function (api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as PluginConfig;
  const enabled = cfg.enabled !== false;
  const saveBeforeHook = cfg.saveBeforeHook !== false;
  const saveAfterHook = cfg.saveAfterHook !== false;
  const cacheDirRaw = cfg.cacheDir?.trim();
  const defaultCacheDir = "~/.openclaw/cache/prompt-monitor";
  let cacheDir: string;
  try {
    cacheDir = cacheDirRaw ? api.resolvePath(cacheDirRaw) : api.resolvePath(defaultCacheDir);
  } catch (err) {
    api.logger?.warn?.(`prompt-monitor: invalid cacheDir, using temp: ${String(err)}`);
    cacheDir = path.join(os.tmpdir(), "openclaw-prompt-monitor");
  }

  if (!enabled) {
    api.logger?.info?.("prompt-monitor: disabled via config");
    return;
  }

  api.logger?.info?.(`prompt-monitor: saving prompts to ${cacheDir}`);

  api.on("before_agent_start", async (event, ctx) => {
    try {
      if (!saveBeforeHook || !event.prompt) return;
      const sessionKey = ctx.sessionKey ?? "unknown";
      const timestamp = Date.now();
      pendingBySession.set(sessionKey, { prompt: event.prompt, timestamp });
      // Save immediately so we capture the prompt even if agent_end never runs
      writePromptFile(cacheDir, sessionKey, timestamp, "before", event.prompt).catch((err) =>
        api.logger?.warn?.(`prompt-monitor: failed to save before-hook prompt: ${String(err)}`),
      );
    } catch (err) {
      api.logger?.warn?.(`prompt-monitor: before_agent_start failed: ${String(err)}`);
    }
  });

  api.on("agent_end", async (event, ctx) => {
    if (!saveAfterHook) return;
    const sessionKey = ctx.sessionKey ?? "unknown";
    const pending = pendingBySession.get(sessionKey);
    pendingBySession.delete(sessionKey);
    const timestamp = pending?.timestamp ?? Date.now();

    try {
      // Prefer effectivePrompt (exact user prompt sent to model) over extracting from messages
      const evt = event as { effectivePrompt?: string; messages?: unknown[] };
      const { last, first } = extractUserPrompts(evt.messages ?? []);
      const fallback = last ?? first;
      const finalPrompt = evt.effectivePrompt?.trim() || fallback;
      if (finalPrompt !== undefined) {
        const filePath = await writePromptFile(
          cacheDir,
          sessionKey,
          timestamp,
          "after",
          finalPrompt,
        );
        api.logger?.debug?.(`prompt-monitor: saved after-hook prompt to ${filePath}`);
      }
    } catch (err) {
      api.logger?.warn?.(`prompt-monitor: failed to save prompt: ${String(err)}`);
    }
  });
}
