// ─────────────────────────────────────────────
//  Popup Script
// ─────────────────────────────────────────────

import {
  loadGlobalConfig,
  loadSiteConfig,
  saveSiteConfig,
} from "../storage/config";
import { BUILTIN_PROMPTS } from "../prompts/builtins";
import { LANGUAGES, SOURCE_LANGUAGES, TARGET_LANGUAGES } from "../utils/language";

// ── DOM references ────────────────────────────

const statusBadge = document.getElementById("status-badge")!;
const siteHostname = document.getElementById("site-hostname")!;
const promptSelect = document.getElementById("prompt-select") as HTMLSelectElement;
const sourceLang = document.getElementById("source-lang") as HTMLSelectElement;
const targetLang = document.getElementById("target-lang") as HTMLSelectElement;
const queueCount = document.getElementById("queue-count")!;
const translationStatus = document.getElementById("translation-status")!;
const btnTranslate = document.getElementById("btn-translate") as HTMLButtonElement;
const btnRetranslate = document.getElementById("btn-retranslate") as HTMLButtonElement;
const btnToggle = document.getElementById("btn-toggle") as HTMLButtonElement;
const toggleLabel = document.getElementById("toggle-label")!;
const pauseIcon = document.getElementById("pause-icon")!;
const resumeIcon = document.getElementById("resume-icon")!;
const siteEnabled = document.getElementById("site-enabled") as HTMLInputElement;
const btnSettings = document.getElementById("btn-settings")!;

// ── State ─────────────────────────────────────

let currentHostname = "";
let isPaused = false;

// ── Init ──────────────────────────────────────

async function init(): Promise<void> {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.id) return;

  let hostname = "";
  try {
    hostname = new URL(tab.url).hostname;
  } catch {
    return;
  }

  currentHostname = hostname;
  siteHostname.textContent = hostname || "—";

  // Load configs
  const [globalConfig, siteConfig] = await Promise.all([
    loadGlobalConfig(),
    sendToBackground({ type: "GET_SITE_CONFIG", hostname }) as Promise<{
      ok: boolean;
      data: import("../storage/config").SiteConfig;
    }>,
  ]);

  const site = siteConfig.data;

  // Populate prompt selector
  populatePromptSelect(globalConfig.userPrompts, site.prompt);

  // Populate language selectors
  populateLanguageSelects(site.sourceLanguage, site.targetLanguage);

  // Site enable toggle
  siteEnabled.checked = site.enabled;
  updateStatusBadge(site.enabled);

  // Get translation status from background
  const statusRes = await sendToBackground({ type: "GET_STATUS" }) as {
    ok: boolean;
    data: { queueCount: number; paused: boolean; running: boolean };
  };

  if (statusRes.ok) {
    updateQueueCount(statusRes.data.queueCount);
    isPaused = statusRes.data.paused;
    updatePauseButton();
    translationStatus.textContent = statusRes.data.running ? "Running" : "Idle";
  }

  // Attach event listeners
  attachEvents(site);
}

function populatePromptSelect(
  userPrompts: Record<string, { systemPrompt: string }>,
  currentPromptId: string
): void {
  promptSelect.innerHTML = "";

  // Built-in prompts
  const builtinGroup = document.createElement("optgroup");
  builtinGroup.label = "Built-in";
  for (const p of BUILTIN_PROMPTS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    opt.selected = p.id === currentPromptId;
    builtinGroup.appendChild(opt);
  }
  promptSelect.appendChild(builtinGroup);

  // User prompts
  const userIds = Object.keys(userPrompts);
  if (userIds.length > 0) {
    const userGroup = document.createElement("optgroup");
    userGroup.label = "Custom";
    for (const id of userIds) {
      const p = userPrompts[id] as { name?: string; systemPrompt: string };
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = (p as { name?: string }).name ?? id;
      opt.selected = id === currentPromptId;
      userGroup.appendChild(opt);
    }
    promptSelect.appendChild(userGroup);
  }
}

function populateLanguageSelects(
  currentSource: string,
  currentTarget: string
): void {
  // Source languages
  sourceLang.innerHTML = "";
  for (const lang of SOURCE_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang.name;
    opt.textContent = lang.name === "Auto Detect" ? "Auto" : lang.name;
    opt.selected = lang.name === currentSource || lang.code === currentSource;
    sourceLang.appendChild(opt);
  }

  // Target languages
  targetLang.innerHTML = "";
  for (const lang of TARGET_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang.name;
    opt.textContent = lang.name;
    opt.selected = lang.name === currentTarget || lang.code === currentTarget;
    targetLang.appendChild(opt);
  }
}

function attachEvents(
  site: import("../storage/config").SiteConfig
): void {
  // Translate button
  btnTranslate.addEventListener("click", async () => {
    await saveCurrentSettings();
    await sendToBackground({ type: "TRANSLATE_NOW" });
    window.close();
  });

  // Retranslate button
  btnRetranslate.addEventListener("click", async () => {
    await saveCurrentSettings();
    await sendToBackground({ type: "RETRANSLATE" });
    window.close();
  });

  // Pause/Resume toggle
  btnToggle.addEventListener("click", async () => {
    if (isPaused) {
      await sendToBackground({ type: "RESUME" });
      isPaused = false;
    } else {
      await sendToBackground({ type: "PAUSE" });
      isPaused = true;
    }
    updatePauseButton();
  });

  // Enable toggle
  siteEnabled.addEventListener("change", async () => {
    const enabled = siteEnabled.checked;
    updateStatusBadge(enabled);
    await saveSiteConfig({
      ...site,
      hostname: currentHostname,
      enabled,
    });
  });

  // Prompt/language change → auto-save
  promptSelect.addEventListener("change", saveCurrentSettings);
  sourceLang.addEventListener("change", saveCurrentSettings);
  targetLang.addEventListener("change", saveCurrentSettings);

  // Settings button
  btnSettings.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

// ── Helpers ───────────────────────────────────

async function saveCurrentSettings(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const existing = await loadSiteConfig(currentHostname);
  await saveSiteConfig({
    ...existing,
    hostname: currentHostname,
    prompt: promptSelect.value,
    sourceLanguage: sourceLang.value,
    targetLanguage: targetLang.value,
    enabled: siteEnabled.checked,
  });
}

function updateStatusBadge(enabled: boolean): void {
  statusBadge.textContent = enabled ? "ON" : "OFF";
  statusBadge.className = enabled ? "badge badge--on" : "badge badge--off";
}

function updateQueueCount(count: number): void {
  queueCount.textContent = String(count);
  if (count > 0) {
    queueCount.classList.add("stat__value--animating");
  } else {
    queueCount.classList.remove("stat__value--animating");
  }
}

function updatePauseButton(): void {
  if (isPaused) {
    pauseIcon.style.display = "none";
    resumeIcon.style.display = "block";
    toggleLabel.textContent = "Resume";
  } else {
    pauseIcon.style.display = "block";
    resumeIcon.style.display = "none";
    toggleLabel.textContent = "Pause";
  }
}

async function sendToBackground(message: object): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return { ok: false, error: "Background unavailable" };
  }
}

// ── Bootstrap ─────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  init().catch(console.error);
});
