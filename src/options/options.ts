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
  const providerRadios = document.querySelectorAll<HTMLInputElement>('input[name="api-provider"]');
  const customApiFields = document.getElementById("custom-api-fields")!;
  const chromeAiPanel = document.getElementById("chrome-ai-panel")!;
  const chromeTranslatorPanel = document.getElementById("chrome-translator-panel")!;

  const chromeAiStatusCard = document.getElementById("chrome-ai-status-card")!;
  const chromeAiStatusTitle = document.getElementById("chrome-ai-status-title")!;
  const chromeAiStatusBody = document.getElementById("chrome-ai-status-body")!;
  const chromeAiDownloadBox = document.getElementById("chrome-ai-download-box")!;
  const chromeAiGuide = document.getElementById("chrome-ai-guide")!;
  const btnDownloadChromeAi = document.getElementById("btn-download-chrome-ai")!;
  const chromeAiDownloadProgress = document.getElementById("chrome-ai-download-progress")!;
  const chromeAiProgressFill = document.getElementById("chrome-ai-progress-fill")!;
  const chromeAiProgressText = document.getElementById("chrome-ai-progress-text")!;
  const btnRecheckChromeAi = document.getElementById("btn-recheck-chrome-ai")!;

  const chromeTranslatorStatusCard = document.getElementById("chrome-translator-status-card")!;
  const chromeTranslatorStatusTitle = document.getElementById("chrome-translator-status-title")!;
  const chromeTranslatorStatusBody = document.getElementById("chrome-translator-status-body")!;
  const chromeTranslatorGuide = document.getElementById("chrome-translator-guide")!;
  const btnRecheckChromeTranslator = document.getElementById("btn-recheck-chrome-translator")!;

  const apiBase = document.getElementById("api-base") as HTMLInputElement;
  const apiKey = document.getElementById("api-key") as HTMLInputElement;
  const apiModel = document.getElementById("api-model") as HTMLInputElement;
  const apiParallel = document.getElementById("api-parallel") as HTMLInputElement;
  const apiChunkSize = document.getElementById("api-chunk-size") as HTMLInputElement;
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
  const currentProvider = config.api.provider || "custom";
  providerRadios.forEach((r) => {
    r.checked = r.value === currentProvider;
  });

  apiBase.value = config.api.base;
  apiKey.value = config.api.key;
  apiModel.value = config.api.model;
  apiParallel.value = String(config.api.parallelCalls);
  apiChunkSize.value = String(config.api.chunkSize);
  apiTimeout.value = String(config.api.timeout);
  apiTemperature.value = config.api.temperature !== undefined ? String(config.api.temperature) : "0.3";
  apiTopP.value = config.api.top_p !== undefined ? String(config.api.top_p) : "0.95";
  apiTopK.value = config.api.top_k !== undefined ? String(config.api.top_k) : "64";
  if (config.api.min_p !== undefined) apiMinP.value = String(config.api.min_p);
  if (config.api.presence_penalty !== undefined) apiPresencePenalty.value = String(config.api.presence_penalty);
  apiChatTemplateKwargs.value = config.api.chat_template_kwargs !== undefined ? JSON.stringify(config.api.chat_template_kwargs) : '{"enable_thinking":false}';

  // Status check helper
  async function refreshBuiltinStatus(provider: string): Promise<void> {
    const res = await sendToBackground({ type: "CHECK_CHROME_AI_STATUS" }) as {
      ok: boolean;
      data?: {
        chromeAi: { enabled: boolean; availability: string; message: string };
        chromeTranslator: { enabled: boolean; availability: string; message: string };
      };
    };

    if (!res.ok || !res.data) return;

    if (provider === "chrome-ai") {
      const ai = res.data.chromeAi;
      chromeAiStatusCard.className = "status-card";

      const isReady = ai.enabled || ai.availability === "readily" || ai.availability === "available";
      const isDownloadable = ai.availability === "downloadable" || ai.availability === "after-download";

      if (isReady) {
        chromeAiStatusCard.classList.add("status-card--ok");
        chromeAiStatusTitle.textContent = "✓ Gemini Nano is Ready (On-Device)";
        chromeAiStatusBody.textContent = "Gemini Nano is active and verified running locally on your device with 0 cloud cost.";
        chromeAiDownloadBox.style.display = "none";
        chromeAiGuide.style.display = "none";
      } else if (isDownloadable) {
        chromeAiStatusCard.classList.add("status-card--download");
        chromeAiStatusTitle.textContent = "⬇️ Gemini Nano Ready to Download";
        chromeAiStatusBody.textContent = "Chrome flags are enabled! Click below to download the model (~1.7 GB) for offline translation.";
        chromeAiDownloadBox.style.display = "block";
        chromeAiGuide.style.display = "none";
      } else {
        chromeAiStatusCard.classList.add("status-card--error");
        chromeAiStatusTitle.textContent = "⚠️ Chrome Built-in AI Not Enabled";
        chromeAiStatusBody.textContent = ai.message || "Follow the quick one-time setup steps below:";
        chromeAiDownloadBox.style.display = "block";
        chromeAiGuide.style.display = "block";
      }
    } else if (provider === "chrome-translator") {
      const tr = res.data.chromeTranslator;
      chromeTranslatorStatusCard.className = "status-card";

      const isReady = tr.enabled || tr.availability === "readily" || tr.availability === "available" || tr.availability === "downloadable";

      if (isReady) {
        chromeTranslatorStatusCard.classList.add("status-card--ok");
        chromeTranslatorStatusTitle.textContent = "✓ Chrome Fast Translator is Active";
        chromeTranslatorStatusBody.textContent = "Zero setup required! Native on-device translator is ready. Language packs download automatically on demand.";
        chromeTranslatorGuide.style.display = "none";
      } else {
        chromeTranslatorStatusCard.classList.add("status-card--error");
        chromeTranslatorStatusTitle.textContent = "⚠️ Chrome Fast Translator Not Detected";
        chromeTranslatorStatusBody.textContent = tr.message || "Translator API is not supported in this browser version.";
        chromeTranslatorGuide.style.display = "block";
      }
    }
  }

  function updateProviderView(provider: string): void {
    if (provider === "chrome-ai") {
      customApiFields.style.display = "none";
      chromeAiPanel.style.display = "block";
      chromeTranslatorPanel.style.display = "none";
      refreshBuiltinStatus("chrome-ai");
    } else if (provider === "chrome-translator") {
      customApiFields.style.display = "none";
      chromeAiPanel.style.display = "none";
      chromeTranslatorPanel.style.display = "block";
      refreshBuiltinStatus("chrome-translator");
    } else {
      customApiFields.style.display = "block";
      chromeAiPanel.style.display = "none";
      chromeTranslatorPanel.style.display = "none";
    }
  }

  providerRadios.forEach((r) => {
    r.addEventListener("change", async () => {
      updateProviderView(r.value);
      // Auto-save provider selection immediately so it takes effect across all tabs
      try {
        const cfg = await loadGlobalConfig();
        cfg.api.provider = r.value as import("../storage/config").TranslationProvider;
        await saveGlobalConfig(cfg);
        const name = r.value === "chrome-ai" ? "Gemini Nano" : r.value === "chrome-translator" ? "Fast Translator" : "Custom API";
        showToast(`Switched provider to: ${name}`);
      } catch {
        // ignore
      }
    });
  });

  // Initial display
  updateProviderView(currentProvider);

  // Wire Copy Buttons in guides
  document.querySelectorAll<HTMLButtonElement>(".btn-copy-code").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const textToCopy = btn.dataset.copy || "";
      if (!textToCopy) return;
      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = btn.textContent;
        btn.textContent = "Copied!";
        btn.classList.add("btn-copy-code--copied");
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove("btn-copy-code--copied");
        }, 1800);
      } catch {
        showToast("Failed to copy to clipboard", "error");
      }
    });
  });

  // Wire Download button
  btnDownloadChromeAi.addEventListener("click", async () => {
    btnDownloadChromeAi.setAttribute("disabled", "true");
    chromeAiDownloadProgress.style.display = "block";
    chromeAiProgressFill.style.width = "5%";
    chromeAiProgressText.textContent = "Requesting model download from Chrome (~1.7 GB)...";

    let progressReceived = false;
    const slowTimer = setTimeout(() => {
      if (!progressReceived) {
        chromeAiProgressText.textContent = "Download queued in Chrome. If it hangs, open chrome://components and click 'Check for update' on Optimization Guide On Device Model, or check chrome://on-device-internals.";
      }
    }, 10000);

    const lm = (window as any).LanguageModel || (window as any).ai?.languageModel;

    if (lm && typeof lm.create === "function") {
      try {
        const session = await lm.create({
          systemPrompt: "You are a translator.",
          initialPrompts: [{ role: "system", content: "You are a translator." }],
          monitor(m: any) {
            m.addEventListener("downloadprogress", (e: any) => {
              progressReceived = true;
              clearTimeout(slowTimer);
              const loaded = e.loaded ?? 0;
              const total = e.total || 1;
              const percent = total > 1 ? Math.round((loaded / total) * 100) : Math.round(loaded * 100);
              chromeAiProgressFill.style.width = `${Math.min(100, Math.max(5, percent))}%`;
              chromeAiProgressText.textContent = `Downloading Gemini Nano... ${percent}%`;
            });
          },
        });
        clearTimeout(slowTimer);
        if (session && typeof session.destroy === "function") {
          session.destroy();
        }
        chromeAiProgressFill.style.width = "100%";
        chromeAiProgressText.textContent = "✓ Download complete! Gemini Nano is ready.";
        showToast("Gemini Nano downloaded successfully!");
        setTimeout(() => {
          refreshBuiltinStatus("chrome-ai");
        }, 1500);
        return;
      } catch (err: any) {
        clearTimeout(slowTimer);
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (rawMsg.toLowerCase().includes("feature flag gating model execution was disabled")) {
          chromeAiProgressFill.style.width = "0%";
          chromeAiProgressText.textContent = "⚠️ Chrome blocked download: Open 'chrome://settings/ai' and turn on 'On-device AI'.";
          showToast("On-device AI is disabled in Chrome settings", "error");
          chromeAiGuide.style.display = "block";
          btnDownloadChromeAi.removeAttribute("disabled");
          return;
        }
        // If create failed with other error, try background
      }
    }

    const res = await sendToBackground({ type: "DOWNLOAD_CHROME_AI" }) as {
      ok: boolean;
      error?: string;
    };

    if (res.ok) {
      chromeAiProgressFill.style.width = "100%";
      chromeAiProgressText.textContent = "✓ Model download initialized. Checking status...";
      setTimeout(() => {
        refreshBuiltinStatus("chrome-ai");
      }, 3000);
    } else {
      chromeAiProgressFill.style.width = "0%";
      const errorMsg = res.error ?? "Check chrome://flags";
      if (errorMsg.toLowerCase().includes("feature flag gating model execution was disabled")) {
        chromeAiProgressText.textContent = "⚠️ Chrome blocked download: Open 'chrome://settings/ai' and turn on 'On-device AI'.";
      } else {
        chromeAiProgressText.textContent = `Download note: ${errorMsg}`;
      }
      btnDownloadChromeAi.removeAttribute("disabled");
    }
  });

  // Wire Recheck buttons
  btnRecheckChromeAi.addEventListener("click", async () => {
    await refreshBuiltinStatus("chrome-ai");
    showToast("Status refreshed!");
  });

  btnRecheckChromeTranslator.addEventListener("click", async () => {
    await refreshBuiltinStatus("chrome-translator");
    showToast("Status refreshed!");
  });

  // Show/hide key
  btnToggleKey.addEventListener("click", () => {
    apiKey.type = apiKey.type === "password" ? "text" : "password";
  });

  // Save
  btnSaveApi.addEventListener("click", async () => {
    const selectedRadio = document.querySelector<HTMLInputElement>('input[name="api-provider"]:checked');
    const provider = (selectedRadio?.value as import("../storage/config").TranslationProvider) || "custom";

    const cfg = await loadGlobalConfig();
    cfg.api = {
      provider,
      base: apiBase.value.trim(),
      key: apiKey.value.trim(),
      model: apiModel.value.trim(),
      parallelCalls: parseInt(apiParallel.value) || 8,
      chunkSize: parseInt(apiChunkSize.value) || 8,
      timeout: parseInt(apiTimeout.value) || 60,
      temperature: apiTemperature.value ? parseFloat(apiTemperature.value) : 0.3,
      top_p: apiTopP.value ? parseFloat(apiTopP.value) : 0.95,
      top_k: apiTopK.value ? parseInt(apiTopK.value) : 64,
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
      cfg.api.chat_template_kwargs = { enable_thinking: false };
    }
    await saveGlobalConfig(cfg);
    showToast("API settings saved!");
  });

  // Test
  btnTestApi.addEventListener("click", async () => {
    testResult.className = "test-result";
    testResult.textContent = "Testing…";
    testResult.style.opacity = "1";

    const selectedRadio = document.querySelector<HTMLInputElement>('input[name="api-provider"]:checked');
    const provider = (selectedRadio?.value as import("../storage/config").TranslationProvider) || "custom";

    try {
      const responsePromise = sendToBackground({
        type: "TEST_API",
        config: {
          provider,
          base: apiBase.value.trim(),
          key: apiKey.value.trim(),
          model: apiModel.value.trim(),
        },
      }) as Promise<{
        ok: boolean;
        data?: { ok: boolean; error?: string; model?: string };
        error?: string;
      }>;

      const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: false,
              error: "Test timed out after 10s. The model may be downloading in the background.",
            }),
          10000
        )
      );

      const response = await Promise.race([responsePromise, timeoutPromise]);

      if (response.ok && response.data?.ok) {
        testResult.textContent = `✓ Active: ${response.data.model ?? "Success"}`;
        testResult.className = "test-result test-result--ok";
      } else {
        const errMsg = response.ok ? (response.data?.error ?? "Connection failed") : response.error;
        testResult.textContent = `✗ ${errMsg}`;
        testResult.className = "test-result test-result--error";
      }
    } catch (err) {
      testResult.textContent = `✗ Error: ${err instanceof Error ? err.message : String(err)}`;
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
      <div class="site-card-item__status ${site.mode === "off" ? "site-card-item__status--off" : "site-card-item__status--on"}"></div>
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
  const modeSel = document.getElementById("site-edit-mode") as HTMLSelectElement;
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
  modeSel.innerHTML = "";
  for (const m of ["off", "on", "auto"] as const) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m.toUpperCase();
    opt.selected = (site.mode || "off") === m;
    modeSel.appendChild(opt);
  }

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
      mode: (modeSel.value as "off" | "on" | "auto") || "off",
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

async function initCacheSection(config: GlobalConfig): Promise<void> {
  const cacheCount = document.getElementById("cache-count")!;
  const cacheBytes = document.getElementById("cache-bytes")!;
  const cacheMaxMb = document.getElementById("cache-max-mb") as HTMLInputElement;
  const btnSave = document.getElementById("btn-save-cache")!;
  const btnClear = document.getElementById("btn-clear-cache")!;
  const result = document.getElementById("cache-action-result")!;

  cacheMaxMb.value = String(config.cache.maxMb);

  async function loadStats(): Promise<void> {
    const res = await sendToBackground({ type: "GET_CACHE_STATS" }) as {
      ok: boolean;
      data?: { count: number; bytes: number };
    };
    if (res.ok && res.data) {
      cacheCount.textContent = String(res.data.count);
      cacheBytes.textContent = formatBytes(res.data.bytes);
    } else {
      cacheCount.textContent = "—";
      cacheBytes.textContent = "—";
    }
  }

  await loadStats();

  btnSave.addEventListener("click", async () => {
    const cfg = await loadGlobalConfig();
    cfg.cache = {
      maxMb: parseInt(cacheMaxMb.value) || 7,
    };
    await saveGlobalConfig(cfg);
    showToast("Cache settings saved!");
  });

  btnClear.addEventListener("click", async () => {
    if (!confirm("Clear all cached translations?")) return;
    await sendToBackground({ type: "CLEAR_CACHE" });
    await loadStats();
    result.textContent = "Cache cleared.";
    setTimeout(() => result.textContent = "", 2000);
    showToast("Cache cleared.");
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
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
    initCacheSection(config),
  ]);
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch(console.error);
});
