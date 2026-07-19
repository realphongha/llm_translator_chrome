// ─────────────────────────────────────────────
//  Popup Script
// ─────────────────────────────────────────────

import {
  loadGlobalConfig,
  loadSiteConfig,
  saveSiteConfig,
} from "../storage/config";
import type { PriorityRule } from "../storage/config";
import { BUILTIN_PROMPTS } from "../prompts/builtins";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "../utils/language";

// ── DOM references ────────────────────────────

const statusBadge = document.getElementById("status-badge")!;
const siteHostname = document.getElementById("site-hostname")!;
const promptSelect = document.getElementById("prompt-select") as HTMLSelectElement;
const sourceLang = document.getElementById("source-lang") as HTMLSelectElement;
const targetLang = document.getElementById("target-lang") as HTMLSelectElement;
const queueCount = document.getElementById("queue-count")!;
const translationStatus = document.getElementById("translation-status")!;
const modeSegment = document.getElementById("mode-segment")!;
const btnSettings = document.getElementById("btn-settings")!;
const btnClearCache = document.getElementById("btn-clear-cache") as HTMLButtonElement;
const btnSave = document.getElementById("btn-save") as HTMLButtonElement;

// Advanced section
const btnToggleAdvanced = document.getElementById("btn-toggle-advanced")!;
const advancedContent = document.getElementById("advanced-content")!;
const advSelector = document.getElementById("adv-selector") as HTMLInputElement;
const advIgnore = document.getElementById("adv-ignore") as HTMLInputElement;
const priorityRulesList = document.getElementById("priority-rules-list")!;
const btnAddRule = document.getElementById("btn-add-rule")!;
const btnScan = document.getElementById("btn-scan") as HTMLButtonElement;
const scanResults = document.getElementById("scan-results")!;
const ruleCount = document.getElementById("rule-count")!;

// ── State ─────────────────────────────────────

let currentHostname = "";
let currentPriorityRules: PriorityRule[] = [];
let currentTabId = 0;

// ── Init ──────────────────────────────────────

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.id) return;

  currentTabId = tab.id;

  let hostname = "";
  try {
    hostname = new URL(tab.url).hostname;
  } catch {
    return;
  }

  currentHostname = hostname;
  siteHostname.textContent = hostname || "—";

  const [globalConfig, siteConfig] = await Promise.all([
    loadGlobalConfig(),
    sendToBackground({ type: "GET_SITE_CONFIG", hostname }) as Promise<{
      ok: boolean;
      data: import("../storage/config").SiteConfig;
    }>,
  ]);

  const site = siteConfig.data;

  populatePromptSelect(globalConfig.userPrompts, site.prompt);
  populateLanguageSelects(site.sourceLanguage, site.targetLanguage);

  setActiveMode(site.mode || "off");
  updateStatusBadge(site.mode || "off");

  const statusRes = await sendToBackground({ type: "GET_STATUS" }) as {
    ok: boolean;
    data: { queueCount: number; paused: boolean; running: boolean };
  };

  if (statusRes.ok) {
    updateQueueCount(statusRes.data.queueCount);

    translationStatus.textContent = statusRes.data.running ? "Running" : "Idle";
  }

  // Populate advanced fields
  advSelector.value = site.selector || "";
  advIgnore.value = (site.ignore || []).join(", ");
  currentPriorityRules = site.priorityRules || [];
  renderPriorityRules();

  attachEvents(site);
}

// ── Priority Rules UI ─────────────────────────

function renderPriorityRules(): void {
  priorityRulesList.innerHTML = "";
  for (let i = 0; i < currentPriorityRules.length; i++) {
    const row = document.createElement("div");
    row.className = "priority-rule-row";

    const selInput = document.createElement("input");
    selInput.type = "text";
    selInput.className = "input-sm";
    selInput.placeholder = ".selector";
    selInput.value = currentPriorityRules[i].selector;
    selInput.addEventListener("change", () => {
      currentPriorityRules[i].selector = selInput.value;
      updateRuleCount();
      saveCurrentSettings();
    });

    const priInput = document.createElement("input");
    priInput.type = "number";
    priInput.className = "input-sm priority-input";
    priInput.placeholder = "1";
    priInput.min = "1";
    priInput.value = String(currentPriorityRules[i].priority);
    priInput.addEventListener("change", () => {
      currentPriorityRules[i].priority = parseInt(priInput.value) || 99;
      updateRuleCount();
      saveCurrentSettings();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-rule-btn";
    removeBtn.innerHTML = "&times;";
    removeBtn.title = "Remove rule";
    removeBtn.addEventListener("click", () => {
      currentPriorityRules.splice(i, 1);
      renderPriorityRules();
    });

    row.appendChild(selInput);
    row.appendChild(priInput);
    row.appendChild(removeBtn);
    priorityRulesList.appendChild(row);
  }
  updateRuleCount();
}

function updateRuleCount(): void {
  ruleCount.textContent = String(currentPriorityRules.length);
}

function addPriorityRule(): void {
  currentPriorityRules.push({ selector: "", priority: 99 });
  renderPriorityRules();
  // Focus the new rule's selector input
  const rows = priorityRulesList.querySelectorAll(".priority-rule-row");
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    const input = lastRow.querySelector(".input-sm") as HTMLInputElement;
    input?.focus();
  }
}

function getCurrentPriorityRules(): PriorityRule[] {
  return currentPriorityRules.filter(
    (r) => r.selector.trim().length > 0 && !isNaN(r.priority)
  );
}

// ── DOM Scan ──────────────────────────────────

async function scanPage(): Promise<void> {
  btnScan.disabled = true;
  btnScan.textContent = "Scanning...";
  scanResults.innerHTML = "";

  try {
    const selector = advSelector.value.trim();
    const ignore = advIgnore.value.split(",").map(s => s.trim()).filter(Boolean);
    const rules = getCurrentPriorityRules();

    const res = await chrome.tabs.sendMessage(currentTabId, {
      type: "SCAN_DOM",
      selector,
      ignore,
      priorityRules: rules,
    });

    if (!res?.ok) {
      scanResults.innerHTML = `<div class="scan-error">Could not scan page. Try refreshing the page.</div>`;
      return;
    }

    const groups: Array<{
      selector: string;
      count: number;
      avgLength: number;
      sampleText: string;
      isSelected: boolean;
      isIgnored: boolean;
      reason: string;
      suggestion: "content" | "ignore" | "priority" | "none";
      priority: number;
    }> = res.data;

    renderScanResults(groups);
  } catch (err) {
    scanResults.innerHTML = `<div class="scan-error">Could not reach the page. Open the site in a tab and try again.</div>`;
  } finally {
    btnScan.disabled = false;
    btnScan.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Scan this page`;
  }
}

function renderScanResults(
  groups: Array<{
    selector: string;
    count: number;
    sampleText: string;
    suggestion: string;
    reason: string;
    priority: number;
  }>
): void {
  if (groups.length === 0) {
    scanResults.innerHTML = `<div class="scan-empty">No elements found on this page.</div>`;
    return;
  }

  const container = document.createElement("div");
  container.className = "scan-results";

  for (const g of groups) {
    const card = document.createElement("div");
    card.className = "scan-card";

    const header = document.createElement("div");
    header.className = "scan-card__header";

    const selSpan = document.createElement("span");
    selSpan.className = "scan-card__selector";
    selSpan.textContent = g.selector;

    const countSpan = document.createElement("span");
    countSpan.className = "scan-card__count";
    countSpan.textContent = `${g.count} el${g.count !== 1 ? "s" : ""}`;

    header.appendChild(selSpan);
    header.appendChild(countSpan);

    const sample = document.createElement("div");
    sample.className = "scan-card__sample";
    if (g.sampleText) {
      sample.textContent = `"${g.sampleText}"`;
    } else {
      sample.textContent = "(not translated yet)";
      sample.style.color = "var(--text-muted)";
      sample.style.fontStyle = "italic";
    }

    const reason = document.createElement("div");
    reason.className = "scan-card__reason";
    reason.textContent = g.reason;

    const actions = document.createElement("div");
    actions.className = "scan-card__actions";

    if (g.suggestion === "none") {
      // Already handled — show green checkmark
      const badge = document.createElement("span");
      badge.style.cssText = "font-size:10px;color:var(--success);display:flex;align-items:center;gap:3px";
      badge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Done`;
      actions.appendChild(badge);
    } else {
      if (g.suggestion === "content") {
        const btn = document.createElement("button");
        btn.className = "btn btn--sm btn--primary";
        btn.textContent = "Use as Content";
        btn.addEventListener("click", () => {
          advSelector.value = g.selector;
          saveCurrentSettings();
          card.style.opacity = "0.5";
        });
        actions.appendChild(btn);
      }

      if (g.suggestion === "ignore") {
        const btn = document.createElement("button");
        btn.className = "btn btn--sm btn--secondary";
        btn.textContent = "Ignore";
        btn.addEventListener("click", () => {
          const existing = advIgnore.value.split(",").map(s => s.trim()).filter(Boolean);
          if (!existing.includes(g.selector)) {
            existing.push(g.selector);
            advIgnore.value = existing.join(", ");
          }
          saveCurrentSettings();
          card.style.opacity = "0.5";
        });
        actions.appendChild(btn);
      }

      {
        const btn = document.createElement("button");
        btn.className = "btn btn--sm btn--ghost";
        btn.textContent = `Priority ${g.priority}`;
        btn.addEventListener("click", () => {
          const shortSel = shortenSelector(g.selector);
          const existing = currentPriorityRules.findIndex(r => r.selector === g.selector || r.selector === shortSel);
          if (existing >= 0) {
            currentPriorityRules[existing].priority = g.priority;
          } else {
            currentPriorityRules.push({ selector: shortSel, priority: g.priority });
          }
          renderPriorityRules();
          saveCurrentSettings();
          card.style.opacity = "0.5";
        });
        actions.appendChild(btn);
      }
    }

    card.appendChild(header);
    card.appendChild(sample);
    card.appendChild(reason);
    card.appendChild(actions);
    container.appendChild(card);
  }

  scanResults.innerHTML = "";
  scanResults.appendChild(container);
}

// ── Event binding ─────────────────────────────

function attachEvents(
  site: import("../storage/config").SiteConfig
): void {
  modeSegment.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const newMode = btn.dataset.mode as "off" | "on" | "auto";
      setActiveMode(newMode);
      updateStatusBadge(newMode);
      saveCurrentSettings().catch(console.error);
    });
  });

  promptSelect.addEventListener("change", saveCurrentSettings);
  sourceLang.addEventListener("change", saveCurrentSettings);
  targetLang.addEventListener("change", saveCurrentSettings);

  btnSettings.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  btnSave.addEventListener("click", () => {
    onSave().catch(console.error);
  });

  btnClearCache.addEventListener("click", async () => {
    if (!confirm("Clear all cached translations?")) return;

    const originalHtml = btnClearCache.innerHTML;
    btnClearCache.disabled = true;
    btnClearCache.textContent = "Clearing...";

    const response = await sendToBackground({ type: "CLEAR_CACHE" }) as { ok: boolean };

    if (response?.ok) {
      btnClearCache.style.color = "var(--success)";
      btnClearCache.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Cleared!`;

      // Trigger automatic re-translation of the page after cache is cleared
      try {
        await sendToBackground({ type: "RETRANSLATE" });
      } catch {}
    } else {
      btnClearCache.style.color = "var(--error)";
      btnClearCache.textContent = "Error!";
    }

    setTimeout(() => {
      btnClearCache.disabled = false;
      btnClearCache.style.color = "";
      btnClearCache.innerHTML = originalHtml;
    }, 1500);
  });

  // Advanced section toggle
  btnToggleAdvanced.addEventListener("click", () => {
    const isOpen = advancedContent.style.display !== "none";
    advancedContent.style.display = isOpen ? "none" : "block";
    const arrow = btnToggleAdvanced.querySelector(".advanced-toggle__arrow")!;
    arrow.classList.toggle("advanced-toggle__arrow--open", !isOpen);
  });

  // Priority rules
  btnAddRule.addEventListener("click", addPriorityRule);

  // Scan
  btnScan.addEventListener("click", scanPage);

  // Auto-save on advanced field changes
  advSelector.addEventListener("change", saveCurrentSettings);
  advIgnore.addEventListener("change", saveCurrentSettings);
}

// ── Helpers ───────────────────────────────────

async function onSave(): Promise<void> {
  const original = btnSave.innerHTML;
  btnSave.disabled = true;
  btnSave.textContent = "Saving...";
  try {
    await saveCurrentSettings();
    btnSave.style.color = "var(--success)";
    btnSave.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Saved`;
  } catch {
    btnSave.style.color = "var(--error)";
    btnSave.textContent = "Error";
  } finally {
    setTimeout(() => {
      btnSave.disabled = false;
      btnSave.style.color = "";
      btnSave.innerHTML = original;
    }, 1200);
  }
}

async function saveCurrentSettings(): Promise<void> {
  const existing = await loadSiteConfig(currentHostname);
  const activeModeBtn = modeSegment.querySelector<HTMLButtonElement>(".mode-btn--active");
  const mode = (activeModeBtn?.dataset.mode as "off" | "on" | "auto") || existing.mode || "off";
  await saveSiteConfig({
    ...existing,
    hostname: currentHostname,
    mode,
    prompt: promptSelect.value,
    sourceLanguage: sourceLang.value,
    targetLanguage: targetLang.value,
    selector: advSelector.value.trim(),
    ignore: advIgnore.value.split(",").map(s => s.trim()).filter(Boolean),
    priorityRules: getCurrentPriorityRules(),
  });

  // Trigger a full retranslate so mode/priority changes take effect immediately.
  // Fire-and-forget: persistence is what the button confirms; the re-translation
  // runs in the background and must not block the popup UI.
  sendToBackground({ type: "RETRANSLATE" }).catch(() => {});
}

function updateStatusBadge(mode: string): void {
  const labels: Record<string, string> = { off: "OFF", on: "ON", auto: "AUTO" };
  statusBadge.textContent = labels[mode] ?? mode.toUpperCase();
  statusBadge.className =
    mode === "off" ? "badge badge--off" : "badge badge--on";
}

function setActiveMode(mode: string): void {
  modeSegment.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("mode-btn--active", active);
  });
}

function updateQueueCount(count: number): void {
  queueCount.textContent = String(count);
  if (count > 0) {
    queueCount.classList.add("stat__value--animating");
  } else {
    queueCount.classList.remove("stat__value--animating");
  }
}

function populatePromptSelect(
  userPrompts: Record<string, { systemPrompt: string }>,
  currentPromptId: string
): void {
  promptSelect.innerHTML = "";

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
  sourceLang.innerHTML = "";
  for (const lang of SOURCE_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang.name;
    opt.textContent = lang.name === "Auto Detect" ? "Auto" : lang.name;
    opt.selected = lang.name === currentSource || lang.code === currentSource;
    sourceLang.appendChild(opt);
  }

  targetLang.innerHTML = "";
  for (const lang of TARGET_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang.name;
    opt.textContent = lang.name;
    opt.selected = lang.name === currentTarget || lang.code === currentTarget;
    targetLang.appendChild(opt);
  }
}

/** Extract a short CSS selector from a full path (tag + meaningful classes only) */
function shortenSelector(path: string): string {
  const segments = path.split(" > ");
  const last = segments[segments.length - 1];
  const parts = last.split(".");
  const tag = parts[0];
  const meaningful = parts.slice(1).filter(c => {
    if (/[[\]:]/.test(c)) return false;
    if (c.startsWith("sm:") || c.startsWith("md:") || c.startsWith("lg:") || c.startsWith("xl:")) return false;
    if (c.startsWith("hover:") || c.startsWith("focus:") || c.startsWith("active:")) return false;
    return true;
  });
  if (meaningful.length > 0) return tag + "." + meaningful.join(".");
  return tag;
}

async function sendToBackground(message: object): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return { ok: false, error: "Background unavailable" };
  }
}

async function queryStatus(): Promise<void> {
  const statusRes = await sendToBackground({ type: "GET_STATUS" }) as {
    ok: boolean;
    data: { queueCount: number; paused: boolean; running: boolean };
  };

  if (statusRes.ok) {
    updateQueueCount(statusRes.data.queueCount);

    translationStatus.textContent = statusRes.data.running ? "Running" : "Idle";
  }
}

// ── Listen to real-time events from background ──

chrome.runtime.onMessage.addListener((message) => {
  if (message.tabId === currentTabId) {
    queryStatus().catch(console.error);
  }
});

// ── Bootstrap ─────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  init().catch(console.error);
});
