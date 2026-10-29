// API-key providers for Maestro (models that run through opencode with the user's own key).
// Maestro never reads or stores key values: opencode keeps them (`opencode auth login`, ~/.local/share/opencode/auth.json)
// and Maestro only looks at WHICH providers have a credential. Per provider the user can turn it on/off and set a daily
// budget; paid providers are opt-in (`--paid`) and are skipped once today's spend reaches the budget.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.MAESTRO_DATA || SKILL_DIR;
const SETTINGS_FILE = path.join(DATA_DIR, "providers.json");
const SPEND_FILE = path.join(DATA_DIR, "spend.json");

// id = opencode provider id (the prefix of its model ids). billing: "paid" (every call costs money) or
// "free-tier" (a free quota exists; enabling it does not spend money unless you upgrade the account yourself).
export const PROVIDERS = [
  { id: "openai", name: "OpenAI", env: "OPENAI_API_KEY", billing: "paid", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", name: "Anthropic (API)", env: "ANTHROPIC_API_KEY", billing: "paid", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "google", name: "Google AI Studio (Gemini API)", env: "GEMINI_API_KEY", billing: "free-tier", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY", billing: "paid", keyUrl: "https://openrouter.ai/keys", freeSuffix: ":free" },
  { id: "groq", name: "Groq", env: "GROQ_API_KEY", billing: "free-tier", keyUrl: "https://console.groq.com/keys" },
  { id: "cerebras", name: "Cerebras", env: "CEREBRAS_API_KEY", billing: "free-tier", keyUrl: "https://cloud.cerebras.ai" },
  { id: "deepseek", name: "DeepSeek", env: "DEEPSEEK_API_KEY", billing: "paid", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "mistral", name: "Mistral", env: "MISTRAL_API_KEY", billing: "paid", keyUrl: "https://console.mistral.ai/api-keys" },
  { id: "xai", name: "xAI (Grok)", env: "XAI_API_KEY", billing: "paid", keyUrl: "https://console.x.ai" },
  { id: "moonshotai", name: "Moonshot (Kimi)", env: "MOONSHOT_API_KEY", billing: "paid", keyUrl: "https://platform.moonshot.ai/console/api-keys" },
  { id: "zai", name: "Z.ai (GLM)", env: "ZHIPU_API_KEY", billing: "paid", keyUrl: "https://z.ai/manage-apikey/apikey-list" },
  { id: "alibaba", name: "Alibaba (Qwen)", env: "DASHSCOPE_API_KEY", billing: "paid", keyUrl: "https://bailian.console.alibabacloud.com" },
  { id: "togetherai", name: "Together AI", env: "TOGETHER_API_KEY", billing: "paid", keyUrl: "https://api.together.ai/settings/api-keys" },
  { id: "fireworks-ai", name: "Fireworks AI", env: "FIREWORKS_API_KEY", billing: "paid", keyUrl: "https://fireworks.ai/account/api-keys" },
];
const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export const providerInfo = (id) => BY_ID.get(id) || null;
// "openrouter/qwen/qwen3.5-72b:free" -> "openrouter"; only registry providers count (opencode/, ollama/, claude/... do not).
export function providerOf(model) {
  const id = String(model || "").split("/")[0];
  return BY_ID.has(id) ? id : null;
}

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

// Providers that have a credential: opencode's auth store (names only) or the provider's environment variable.
export function connectedProviders() {
  const authFile = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
  const stored = Object.keys(readJSON(authFile, {}) || {});
  const out = {};
  for (const p of PROVIDERS) {
    if (stored.includes(p.id)) out[p.id] = "opencode";
    else if (process.env[p.env]) out[p.id] = "env";
  }
  return out;
}

// { providers: { <id>: { enabled: bool, budgetUsd: number } } }. A provider is off until the user turns it on.
export function loadProviderSettings() {
  const s = readJSON(SETTINGS_FILE, {});
  return { providers: s.providers || {} };
}
export function saveProviderSetting(id, patch) {
  if (!BY_ID.has(id)) throw new Error(`unknown provider "${id}"`);
  const s = loadProviderSettings();
  const cur = s.providers[id] || { enabled: false, budgetUsd: 0 };
  const next = { ...cur };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (patch.budgetUsd !== undefined) {
    const b = Number(patch.budgetUsd);
    if (!Number.isFinite(b) || b < 0 || b > 1000) throw new Error("budget must be 0..1000 USD per day");
    next.budgetUsd = Math.round(b * 100) / 100;
  }
  s.providers[id] = next;
  writeJSON(SETTINGS_FILE, s);
  return next;
}
export const isProviderEnabled = (id) => !!loadProviderSettings().providers[id]?.enabled;

// Money is only spent by "paid" providers, and by paid models of OpenRouter (its ":free" models cost nothing).
export function isPaidModel(model) {
  const p = BY_ID.get(providerOf(model));
  if (!p) return false;
  if (p.freeSuffix && String(model).endsWith(p.freeSuffix)) return false;
  return p.billing === "paid";
}

const today = () => new Date().toISOString().slice(0, 10);
// spend.json: { "<yyyy-mm-dd>": { "<provider>": { usd, jobs } } } - last 30 days kept.
export function addSpend(model, usd) {
  const id = providerOf(model);
  if (!id) return;
  const s = readJSON(SPEND_FILE, {});
  const d = (s[today()] ||= {});
  const e = (d[id] ||= { usd: 0, jobs: 0 });
  e.usd = Math.round((e.usd + (Number(usd) || 0)) * 10000) / 10000;
  e.jobs++;
  for (const k of Object.keys(s).sort().slice(0, -30)) delete s[k];
  writeJSON(SPEND_FILE, s);
}
export function spentToday(id) {
  const e = readJSON(SPEND_FILE, {})[today()]?.[id];
  return { usd: e?.usd || 0, jobs: e?.jobs || 0 };
}

// Why a model may not be used right now ("" = usable). Models of unknown providers are not governed here.
export function providerBlock(model) {
  const id = providerOf(model);
  if (!id) return "";
  const cfg = loadProviderSettings().providers[id];
  if (!cfg?.enabled) return `${BY_ID.get(id).name} đang tắt (bật trong Cài đặt > Nhà cung cấp)`;
  if (isPaidModel(model)) {
    const budget = cfg.budgetUsd || 0;
    if (budget <= 0) return `${BY_ID.get(id).name}: chưa đặt ngân sách/ngày`;
    const spent = spentToday(id).usd;
    if (spent >= budget) return `${BY_ID.get(id).name}: đã dùng $${spent.toFixed(2)}/$${budget.toFixed(2)} hôm nay`;
  }
  return "";
}

// Quality priors for popular model families, from public coding benchmarks (SWE-bench Verified/Pro, DeepSWE,
// Terminal-Bench; vendor numbers where no independent run exists), gathered 2026-10-29. Matched against the model
// id after the provider prefix; the first match wins, so specific patterns come first. Used when a model has no
// exact research entry in models.json, so a model added with a new key is ranked sensibly from its first job.
const FAMILY_PRIORS = [
  [/claude.*(opus|mythos|fable).*5|claude-(opus|mythos|fable)-5/, 0.95],
  [/claude.*sonnet.*5|claude-sonnet-5/, 0.9],
  [/claude.*haiku.*5|claude-haiku-5/, 0.75],
  [/claude.*opus.*4[.-]?[5-9]/, 0.85],
  [/claude.*sonnet.*4[.-]?[5-9]/, 0.8],
  [/claude.*(opus|sonnet)/, 0.72],
  [/claude.*haiku/, 0.6],
  [/gpt-6.*sol|gpt-5\.6.*sol/, 0.9],
  [/gpt-6.*luna|gpt-5\.6.*luna/, 0.72],
  [/gpt-6|gpt-5\.[4-9]/, 0.82],
  [/gpt-5.*(mini|nano)/, 0.62],
  [/gpt-5/, 0.78],
  [/gpt-oss-120b/, 0.45],
  [/gpt-oss/, 0.35],
  [/gpt-4/, 0.5],
  [/gemini-3[.-]?[1-9].*pro/, 0.8],
  [/gemini-3.*pro/, 0.76],
  [/gemini-3.*flash-lite/, 0.55],
  [/gemini-3.*flash/, 0.75],
  [/gemini-2\.5-pro/, 0.63],
  [/gemini/, 0.5],
  [/deepseek.*v4.*pro/, 0.9],
  [/deepseek.*v4/, 0.79],
  [/deepseek.*(v3|chat)/, 0.65],
  [/deepseek.*(r1|reasoner)/, 0.5],
  [/kimi.*k3/, 0.88],
  [/kimi.*k2[.-]?[5-9]/, 0.77],
  [/kimi/, 0.68],
  [/qwen3[.-]?[6-9]/, 0.77],
  [/qwen3[.-]?5/, 0.72],
  [/qwen.*coder/, 0.68],
  [/qwen/, 0.55],
  [/devstral.*2/, 0.72],
  [/devstral/, 0.6],
  [/codestral|mistral.*(large|medium)/, 0.55],
  [/mistral|mixtral/, 0.4],
  [/grok.*code/, 0.7],
  [/grok-?4/, 0.75],
  [/grok/, 0.6],
  [/glm-?5/, 0.75],
  [/glm-?4/, 0.62],
  [/mimo/, 0.74],
  [/nemotron.*super/, 0.65],
  [/nemotron/, 0.55],
  [/llama-?4/, 0.45],
  [/llama/, 0.35],
];
export function familyPrior(model) {
  const name = String(model || "").toLowerCase().split("/").slice(1).join("/") || String(model || "").toLowerCase();
  for (const [re, q] of FAMILY_PRIORS) if (re.test(name)) return q;
  return null;
}
// Capability level from a quality prior: hard work needs 4+, code/ui 3+, quick 2+.
export const levelFromQuality = (q) => (q >= 0.85 ? 5 : q >= 0.72 ? 4 : q >= 0.55 ? 3 : 2);
