// ─────────────────────────────────────────────
//  Options Page Script
// ─────────────────────────────────────────────

import {
  loadGlobalConfig,
  saveGlobalConfig,
  loadAllSiteConfigs,
  saveSiteConfig,
  deleteSiteConfig,
} from "../storage/config";
import type { GlobalConfig, SiteConfig, UserPrompt } from "../storage/config";
import { BUILTIN_PROMPTS } from "../prompts/builtins";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "../utils/language";

// ── Section navigation ────────────────────────

function initNavigation(): void {
  const navItems = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll(".section");

  function showSection(id: string): void {
    sections.forEach((s) => s.classList.remove("section--active"));
    navItems.forEach((n) => n.classList.remove("nav-item--active"));

    const section = document.getElementById(id);
    section?.classList.add("section--active");

    navItems.forEach((n) => {
      if ((n as HTMLElement).dataset.section === id) {
        n.classList.add("nav-item--active");
      }
    });
  }

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const id = (item as HTMLElement).dataset.section ?? "";
      showSection(id);
    });
  });

  // Handle hash in URL
  const hash = location.hash.replace("#", "");
  if (hash) showSection(hash);
}

// ── Toast ─────────────────────────────────────

function showToast(message: string, type: "success" | "error" = "success"): void {
  const toast = document.getElementById("toast")!;
  toast.textContent = message;
  toast.className = `toast toast--show toast--${type}`;
  setTimeout(() => {
    toast.className = "toast";
  }, 2500);
}

// ── API Section ───────────────────────────────

async function initApiSection(config: GlobalConfig): Promise<void> {
  const apiBase = document.getElementById("api-base") as HTMLInputElement;
  const apiKey = document.getElementById("api-key") as HTMLInputElement;
  const apiModel = document.getElementById("api-model") as HTMLInputElement;
  const apiParallel = document.getElementById("api-parallel") as HTMLInputElement;
  const apiTimeout = document.getElementById("api-timeout") as HTMLInputElement;
  const apiTemperature = document.getElementById("api-temperature") as HTMLInputElement;
  const apiTopP = document.getElementById("api-top-p") as HTMLInputElement;
  const apiTopK = document.getElementById("api-top-k") as HTMLInputElement;
  const apiMinP = document.getElementById("api-min-p") as HTMLInputElement;
  const apiPresencePenalty = document.getElementById("api-presence-penalty") as HTMLInputElement;
  const apiChatTemplateKwargs = document.getElementById("api-chat-template-kwargs") as HTMLInputElement;
  const btnSaveApi = document.getElementById("btn-save-api")!;
  const btnTestApi = document.getElementById("btn-test-api")!;
  const testResult = document.getElementById("test-result")!;
  const btnToggleKey = document.getElementById("btn-toggle-key")!;

  // Fill values
  apiBase.value = config.api.base;
  apiKey.value = config.api.key;
  apiModel.value = config.api.model;
  apiParallel.value = String(config.api.parallelCalls);
  apiTimeout.value = String(config.api.timeout);
  if (config.api.temperature !== undefined) apiTemperature.value = String(config.api.temperature);
  if (config.api.top_p !== undefined) apiTopP.value = String(config.api.top_p);
  if (config.api.top_k !== undefined) apiTopK.value = String(config.api.top_k);
  if (config.api.min_p !== undefined) apiMinP.value = String(config.api.min_p);
  if (config.api.presence_penalty !== undefined) apiPresencePenalty.value = String(config.api.presence_penalty);
  if (config.api.chat_template_kwargs !== undefined) apiChatTemplateKwargs.value = JSON.stringify(config.api.chat_template_kwargs);

  // Show/hide key
  btnToggleKey.addEventListener("click", () => {
    apiKey.type = apiKey.type === "password" ? "text" : "password";
  });

  // Save
  btnSaveApi.addEventListener("click", async () => {
    const cfg = await loadGlobalConfig();
    cfg.api = {
      base: apiBase.value.trim(),
      key: apiKey.value.trim(),
      model: apiModel.value.trim(),
      parallelCalls: parseInt(apiParallel.value) || 32,
      timeout: parseInt(apiTimeout.value) || 60,
      temperature: apiTemperature.value ? parseFloat(apiTemperature.value) : undefined,
      top_p: apiTopP.value ? parseFloat(apiTopP.value) : undefined,
      top_k: apiTopK.value ? parseInt(apiTopK.value) : undefined,
      min_p: apiMinP.value ? parseFloat(apiMinP.value) : undefined,
      presence_penalty: apiPresencePenalty.value ? parseFloat(apiPresencePenalty.value) : undefined,
    };

    // Parse chat_template_kwargs JSON
    const kwargsRaw = apiChatTemplateKwargs.value.trim();
    if (kwargsRaw) {
      try {
        cfg.api.chat_template_kwargs = JSON.parse(kwargsRaw);
      } catch {
        showToast("Invalid JSON in Chat Template Kwargs", "error");
        return;
      }
    } else {
      cfg.api.chat_template_kwargs = undefined;
    }
    await saveGlobalConfig(cfg);
    showToast("API settings saved!");
  });

  // Test
  btnTestApi.addEventListener("click", async () => {
    testResult.className = "test-result";
    testResult.textContent = "Testing…";
    testResult.style.opacity = "1";

    const response = await sendToBackground({ type: "TEST_API" }) as {
      ok: boolean;
      data?: { ok: boolean; error?: string };
    };

    if (response.ok && response.data?.ok) {
      testResult.textContent = "✓ Connection successful";
      testResult.className = "test-result test-result--ok";
    } else {
      testResult.textContent = `✗ ${response.data?.error ?? "Connection failed"}`;
      testResult.className = "test-result test-result--error";
    }
  });
}

// ── Translation Section ───────────────────────

async function initTranslationSection(config: GlobalConfig): Promise<void> {
  const maxChars = document.getElementById("max-chars") as HTMLInputElement;
  const retryCount = document.getElementById("retry-count") as HTMLInputElement;
  const btnSave = document.getElementById("btn-save-translation")!;

  maxChars.value = String(config.translation.maxChars);
  retryCount.value = String(config.translation.retryCount);

  btnSave.addEventListener("click", async () => {
    const cfg = await loadGlobalConfig();
    cfg.translation = {
      maxChars: parseInt(maxChars.value) || 4000,
      retryCount: parseInt(retryCount.value) || 3,
    };
    await saveGlobalConfig(cfg);
    showToast("Translation settings saved!");
  });
}

// ── Prompts Section ───────────────────────────

async function initPromptsSection(config: GlobalConfig): Promise<void> {
  renderBuiltinPrompts();
  renderUserPrompts(config.userPrompts);
  initPromptEditor(config);
}

function renderBuiltinPrompts(): void {
  const list = document.getElementById("builtin-prompts-list")!;
  list.innerHTML = "";

  for (const p of BUILTIN_PROMPTS) {
    const card = document.createElement("div");
    card.className = "prompt-card";
    card.innerHTML = `
      <div class="prompt-card__info">
        <div class="prompt-card__name">${escHtml(p.name)}</div>
        <div class="prompt-card__desc">${escHtml(p.description)}</div>
        <div class="prompt-card__preview">${escHtml(p.systemPrompt.slice(0, 150))}…</div>
      </div>
      <div class="prompt-card__actions">
        <button class="btn btn--sm btn--secondary" data-action="duplicate" data-id="${escHtml(p.id)}">Duplicate</button>
      </div>
    `;
    list.appendChild(card);
  }

  // Duplicate buttons
  list.querySelectorAll("[data-action='duplicate']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = (btn as HTMLElement).dataset.id!;
      const source = BUILTIN_PROMPTS.find((p) => p.id === id)!;
      const newId = `user-${Date.now()}`;
      const cfg = await loadGlobalConfig();
      cfg.userPrompts[newId] = {
        id: newId,
        name: `${source.name} (Copy)`,
        systemPrompt: source.systemPrompt,
        userPrompt: null,
      };
      await saveGlobalConfig(cfg);
      renderUserPrompts(cfg.userPrompts);
      showToast("Prompt duplicated!");
    });
  });
}

function renderUserPrompts(userPrompts: Record<string, UserPrompt>): void {
  const list = document.getElementById("user-prompts-list")!;
  list.innerHTML = "";

  const ids = Object.keys(userPrompts);
  if (ids.length === 0) {
    list.innerHTML = '<div class="empty-state">No custom prompts yet. Create one above.</div>';
    return;
  }

  for (const id of ids) {
    const p = userPrompts[id];
    const card = document.createElement("div");
    card.className = "prompt-card";
    card.innerHTML = `
      <div class="prompt-card__info">
        <div class="prompt-card__name">${escHtml(p.name)}</div>
        <div class="prompt-card__preview">${escHtml(p.systemPrompt.slice(0, 150))}…</div>
      </div>
      <div class="prompt-card__actions">
        <button class="btn btn--sm btn--secondary" data-action="edit" data-id="${escHtml(id)}">Edit</button>
        <button class="btn btn--sm btn--danger" data-action="delete" data-id="${escHtml(id)}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  }

  list.querySelectorAll("[data-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id!;
      openPromptEditor(id, userPrompts[id]);
    });
  });

  list.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = (btn as HTMLElement).dataset.id!;
      if (!confirm(`Delete prompt "${userPrompts[id]?.name}"?`)) return;
      const cfg = await loadGlobalConfig();
      delete cfg.userPrompts[id];
      await saveGlobalConfig(cfg);
      renderUserPrompts(cfg.userPrompts);
      showToast("Prompt deleted.");
    });
  });
}

function initPromptEditor(config: GlobalConfig): void {
  const editor = document.getElementById("prompt-editor")!;
  const nameInput = document.getElementById("prompt-name") as HTMLInputElement;
  const bodyInput = document.getElementById("prompt-body") as HTMLTextAreaElement;
  const editingId = document.getElementById("prompt-editing-id") as HTMLInputElement;
  const btnSave = document.getElementById("btn-save-prompt")!;
  const btnCancel = document.getElementById("btn-cancel-prompt")!;
  const btnNew = document.getElementById("btn-new-prompt")!;

  btnNew.addEventListener("click", () => {
    openPromptEditor(null, null);
  });

  btnCancel.addEventListener("click", () => {
    editor.style.display = "none";
  });

  btnSave.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const body = bodyInput.value.trim();
    if (!name || !body) {
      showToast("Name and prompt body are required.", "error");
      return;
    }

    const id = editingId.value || `user-${Date.now()}`;
    const cfg = await loadGlobalConfig();
    cfg.userPrompts[id] = { id, name, systemPrompt: body, userPrompt: null };
    await saveGlobalConfig(cfg);
    renderUserPrompts(cfg.userPrompts);
    editor.style.display = "none";
    showToast("Prompt saved!");
  });

  function openPromptEditor(id: string | null, prompt: UserPrompt | null): void {
    nameInput.value = prompt?.name ?? "";
    bodyInput.value = prompt?.systemPrompt ?? "";
    editingId.value = id ?? "";
    editor.style.display = "flex";
    editor.style.flexDirection = "column";
    nameInput.focus();
  }

  // Expose for use in renderUserPrompts
  (window as unknown as Record<string, unknown>).__openPromptEditor = openPromptEditor;
}

function openPromptEditor(id: string, prompt: UserPrompt): void {
  const fn = (window as unknown as Record<string, unknown>).__openPromptEditor as
    ((id: string, prompt: UserPrompt) => void) | undefined;
  fn?.(id, prompt);
}

// ── Site Profiles Section ─────────────────────

async function initSitesSection(globalConfig: GlobalConfig): Promise<void> {
  const siteConfigs = await loadAllSiteConfigs();
  renderSiteList(siteConfigs, globalConfig);
}

function renderSiteList(sites: SiteConfig[], globalConfig: GlobalConfig): void {
  const list = document.getElementById("sites-list")!;
  list.innerHTML = "";

  if (sites.length === 0) {
    list.innerHTML = '<div class="empty-state">No site profiles yet. Visit any webpage to auto-create one.</div>';
    return;
  }

  for (const site of sites) {
    const card = document.createElement("div");
    card.className = "site-card-item";
    card.innerHTML = `
      <div class="site-card-item__status ${site.enabled ? "site-card-item__status--on" : "site-card-item__status--off"}"></div>
      <div class="site-card-item__info">
        <div class="site-card-item__hostname">${escHtml(site.hostname)}</div>
        <div class="site-card-item__details">
          <span>${escHtml(site.prompt)}</span>
          <span>${escHtml(site.sourceLanguage)} → ${escHtml(site.targetLanguage)}</span>
          ${site.selector ? `<span>${escHtml(site.selector)}</span>` : ""}
        </div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
    `;
    card.addEventListener("click", () => openSiteEditor(site, globalConfig));
    list.appendChild(card);
  }
}

function openSiteEditor(site: SiteConfig, globalConfig: GlobalConfig): void {
  const editor = document.getElementById("site-editor")!;
  const hostnameLabel = document.getElementById("editing-hostname")!;
  const enabledCheck = document.getElementById("site-edit-enabled") as HTMLInputElement;
  const promptSel = document.getElementById("site-edit-prompt") as HTMLSelectElement;
  const sourceSel = document.getElementById("site-edit-source") as HTMLSelectElement;
  const targetSel = document.getElementById("site-edit-target") as HTMLSelectElement;
  const observeInput = document.getElementById("site-edit-observe") as HTMLInputElement;
  const selectorInput = document.getElementById("site-edit-selector") as HTMLInputElement;
  const ignoreInput = document.getElementById("site-edit-ignore") as HTMLInputElement;
  const btnSave = document.getElementById("btn-save-site")!;
  const btnCancel = document.getElementById("btn-cancel-site")!;
  const btnDelete = document.getElementById("btn-delete-site")!;

  hostnameLabel.textContent = site.hostname;
  enabledCheck.checked = site.enabled;

  // Populate prompt select
  promptSel.innerHTML = "";
  for (const p of BUILTIN_PROMPTS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    opt.selected = site.prompt === p.id;
    promptSel.appendChild(opt);
  }
  for (const [id, p] of Object.entries(globalConfig.userPrompts)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = p.name;
    opt.selected = site.prompt === id;
    promptSel.appendChild(opt);
  }

  // Populate language selects
  populateSelectFromList(sourceSel, SOURCE_LANGUAGES.map(l => l.name), site.sourceLanguage);
  populateSelectFromList(targetSel, TARGET_LANGUAGES.map(l => l.name), site.targetLanguage);

  observeInput.value = site.observe || "";
  selectorInput.value = site.selector || "";
  ignoreInput.value = (site.ignore || []).join(", ");

  editor.style.display = "block";
  editor.scrollIntoView({ behavior: "smooth", block: "start" });

  // Remove old listeners
  const newSave = btnSave.cloneNode(true) as HTMLElement;
  const newCancel = btnCancel.cloneNode(true) as HTMLElement;
  const newDelete = btnDelete.cloneNode(true) as HTMLElement;
  btnSave.replaceWith(newSave);
  btnCancel.replaceWith(newCancel);
  btnDelete.replaceWith(newDelete);

  newSave.addEventListener("click", async () => {
    const updated: SiteConfig = {
      hostname: site.hostname,
      enabled: enabledCheck.checked,
      prompt: promptSel.value,
      sourceLanguage: sourceSel.value,
      targetLanguage: targetSel.value,
      observe: observeInput.value.trim() || "body",
      selector: selectorInput.value.trim(),
      ignore: ignoreInput.value.split(",").map(s => s.trim()).filter(Boolean),
      priorityRules: site.priorityRules || [],
    };
    await saveSiteConfig(updated);
    editor.style.display = "none";
    const allSites = await loadAllSiteConfigs();
    renderSiteList(allSites, globalConfig);
    showToast("Site profile saved!");
  });

  newCancel.addEventListener("click", () => {
    editor.style.display = "none";
  });

  newDelete.addEventListener("click", async () => {
    if (!confirm(`Delete profile for ${site.hostname}?`)) return;
    await deleteSiteConfig(site.hostname);
    editor.style.display = "none";
    const allSites = await loadAllSiteConfigs();
    renderSiteList(allSites, globalConfig);
    showToast("Site profile deleted.");
  });
}

function populateSelectFromList(sel: HTMLSelectElement, options: string[], current: string): void {
  sel.innerHTML = "";
  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt;
    el.textContent = opt;
    el.selected = opt === current;
    sel.appendChild(el);
  }
}

// ── Cache Section ─────────────────────────────

async function initCacheSection(): Promise<void> {
  const cacheCount = document.getElementById("cache-count")!;
  const btnClear = document.getElementById("btn-clear-cache")!;
  const result = document.getElementById("cache-action-result")!;

  // Load stats
  const res = await sendToBackground({ type: "GET_CACHE_STATS" }) as {
    ok: boolean;
    data?: { count: number };
  };
  cacheCount.textContent = res.ok ? String(res.data?.count ?? 0) : "—";

  btnClear.addEventListener("click", async () => {
    if (!confirm("Clear all cached translations?")) return;
    await sendToBackground({ type: "CLEAR_CACHE" });
    cacheCount.textContent = "0";
    result.textContent = "Cache cleared.";
    setTimeout(() => result.textContent = "", 2000);
    showToast("Cache cleared.");
  });
}

// ── Utilities ─────────────────────────────────

async function sendToBackground(message: object): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return { ok: false, error: "Background unavailable" };
  }
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Bootstrap ─────────────────────────────────

async function init(): Promise<void> {
  initNavigation();

  const config = await loadGlobalConfig();

  await Promise.all([
    initApiSection(config),
    initTranslationSection(config),
    initPromptsSection(config),
    initSitesSection(config),
    initCacheSection(),
  ]);
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch(console.error);
});
