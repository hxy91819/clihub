import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ToolManifestEntry {
  id: string;
  label: string;
  description: string;
  command: string;
  packageName?: string;
  installCommand?: string;
}

const FALLBACK_PUBLIC_TOOLS: ToolManifestEntry[] = [
  { id: 'claude', label: 'Claude Code', description: 'Anthropic Claude Code', command: 'claude', packageName: '@anthropic-ai/claude-code' },
  { id: 'codebuddy', label: 'Codebuddy', description: 'Tencent AI Codebuddy', command: 'codebuddy', packageName: '@tencent-ai/codebuddy-code' },
  { id: 'codex', label: 'Codex', description: 'OpenAI Codex', command: 'codex', packageName: '@openai/codex' },
  { id: 'copilot', label: 'Copilot', description: 'GitHub Copilot CLI', command: 'copilot', packageName: '@github/copilot' },
  { id: 'droid', label: 'Droid', description: 'Droid AI CLI', command: 'droid' },
  {
    id: 'cursor-agent',
    label: 'Cursor CLI',
    description: 'Cursor CLI (cursor-agent)',
    command: 'cursor-agent',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
  },
  { id: 'gemini', label: 'Gemini CLI', description: 'Google Gemini CLI', command: 'gemini', packageName: '@google/gemini-cli' },
  { id: 'kimi', label: 'Kimi CLI', description: 'Moonshot AI Kimi CLI', command: 'kimi', packageName: '@moonshot-ai/kimi-cli' },
  { id: 'opencode', label: 'OpenCode', description: 'Anomaly OpenCode', command: 'opencode', packageName: 'opencode-ai' },
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeEntry(entry: unknown, index: number, log?: vscode.LogOutputChannel): ToolManifestEntry | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    try { log?.warn(`[CLI Hub] Ignored invalid tool manifest entry at index ${index}`); } catch { /* ignore */ }
    return undefined;
  }

  const candidate = entry as Record<string, unknown>;
  const id = candidate.id;
  const label = candidate.label;
  const description = candidate.description;
  const command = candidate.command;

  if (!isNonEmptyString(id) || !isNonEmptyString(label) || !isNonEmptyString(description) || !isNonEmptyString(command)) {
    try { log?.warn(`[CLI Hub] Ignored incomplete tool manifest entry at index ${index}`); } catch { /* ignore */ }
    return undefined;
  }

  const normalized: ToolManifestEntry = {
    id: id.trim(),
    label: label.trim(),
    description: description.trim(),
    command: command.trim(),
  };

  if (isNonEmptyString(candidate.packageName)) {
    normalized.packageName = candidate.packageName.trim();
  }
  if (isNonEmptyString(candidate.installCommand)) {
    normalized.installCommand = candidate.installCommand.trim();
  }

  return normalized;
}

function validateManifest(entries: unknown, log?: vscode.LogOutputChannel): ToolManifestEntry[] {
  if (!Array.isArray(entries)) {
    try { log?.warn('[CLI Hub] Tool manifest is not an array; using fallback public tools'); } catch { /* ignore */ }
    return [...FALLBACK_PUBLIC_TOOLS];
  }

  const normalized = entries
    .map((entry, index) => normalizeEntry(entry, index, log))
    .filter((entry): entry is ToolManifestEntry => !!entry);

  const deduped: ToolManifestEntry[] = [];
  const seenIds = new Set<string>();
  for (const entry of normalized) {
    if (seenIds.has(entry.id)) {
      try { log?.warn(`[CLI Hub] Ignored duplicate tool id in manifest: ${entry.id}`); } catch { /* ignore */ }
      continue;
    }
    seenIds.add(entry.id);
    deduped.push(entry);
  }

  if (deduped.length === 0) {
    try { log?.warn('[CLI Hub] Tool manifest resolved to 0 valid entries; using fallback public tools'); } catch { /* ignore */ }
    return [...FALLBACK_PUBLIC_TOOLS];
  }

  return deduped;
}

function tryReadManifest(filePath: string, log?: vscode.LogOutputChannel): ToolManifestEntry[] | undefined {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return validateManifest(JSON.parse(raw), log);
  } catch (error) {
    try {
      log?.warn(`[CLI Hub] Failed to load tool manifest from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    } catch { /* ignore */ }
    return undefined;
  }
}

export function loadToolManifest(extensionPath: string, log?: vscode.LogOutputChannel): ToolManifestEntry[] {
  const preferredPath = path.join(extensionPath, 'config', 'tool-manifest.json');
  const fallbackPath = path.join(extensionPath, 'config', 'tool-manifest.public.json');

  const preferred = tryReadManifest(preferredPath, log);
  if (preferred) {
    return preferred;
  }

  const fallback = tryReadManifest(fallbackPath, log);
  if (fallback) {
    return fallback;
  }

  try { log?.warn('[CLI Hub] No tool manifest file found; using fallback public tools'); } catch { /* ignore */ }
  return [...FALLBACK_PUBLIC_TOOLS];
}
