// ─────────────────────────────────────────────
//  Early Content Script — runs at document_start
//  Injects <meta name="google" content="notranslate"> into <head> as soon as
//  it exists, for on/auto sites only, so Chrome's built-in Google translator
//  does not offer to translate / translate the page before our extension does.
// ─────────────────────────────────────────────

function sendToBackground(message: object): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => ({ ok: false }));
}

async function tryInject(): Promise<void> {
  const res = await sendToBackground({ type: "GET_SITE_CONFIG", hostname: location.hostname });
  const mode = (res as { ok: boolean; data?: { mode?: string } })?.data?.mode || "off";
  if (mode === "off") return;
  if (document.querySelector('meta[name="google"][content="notranslate"]')) return;
  const meta = document.createElement("meta");
  meta.name = "google";
  meta.content = "notranslate";
  (document.head || document.documentElement).appendChild(meta);
}

function start(): void {
  if (document.head) {
    tryInject().catch(() => {});
    return;
  }
  const observer = new MutationObserver(() => {
    if (document.head) {
      observer.disconnect();
      tryInject().catch(() => {});
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

start();
