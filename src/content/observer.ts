// ─────────────────────────────────────────────
//  DOM Observer
//  Detects new content and SPA navigation
// ─────────────────────────────────────────────

type ObserverCallback = (newNodes: Element[]) => void;

interface ObserverOptions {
  target: string; // CSS selector for observation root
  selector: string; // CSS selector for translatable elements
  ignoreSelectors: string[];
}

export class DOMObserver {
  private observer: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNodes: Element[] = [];
  private lastUrl: string = location.href;
  private readonly DEBOUNCE_MS = 400;

  constructor(
    private readonly callback: ObserverCallback,
    private options: ObserverOptions
  ) {}

  start(): void {
    this.stop();
    this.lastUrl = location.href;

    const root = this.getObserveRoot();

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.pendingNodes.push(node as Element);
          }
        }
      }

      if (this.pendingNodes.length > 0) {
        this.scheduleFlush();
      }
    });

    this.observer.observe(root, {
      childList: true,
      subtree: true,
    });

    // SPA navigation detection
    window.addEventListener("popstate", this.handleUrlChange);
    window.addEventListener("hashchange", this.handleUrlChange);
    this.patchHistoryApi();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    window.removeEventListener("popstate", this.handleUrlChange);
    window.removeEventListener("hashchange", this.handleUrlChange);
  }

  updateOptions(options: Partial<ObserverOptions>): void {
    this.options = { ...this.options, ...options };
    this.stop();
    this.start();
  }

  private getObserveRoot(): Element | Document {
    if (this.options.target && this.options.target !== "body") {
      const el = document.querySelector(this.options.target);
      if (el) return el;
    }
    return document;
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const nodes = this.pendingNodes.splice(0);
      if (nodes.length > 0) {
        this.callback(nodes);
      }
    }, this.DEBOUNCE_MS);
  }

  private handleUrlChange = (): void => {
    if (location.href !== this.lastUrl) {
      this.lastUrl = location.href;
      // Delay to let the new page render
      setTimeout(() => {
        // Treat entire document as new content on navigation
        this.callback([document.body]);
      }, 800);
    }
  };

  private patchHistoryApi(): void {
    // Patch pushState / replaceState to detect programmatic navigation
    const original = {
      pushState: history.pushState.bind(history),
      replaceState: history.replaceState.bind(history),
    };

    history.pushState = (...args) => {
      original.pushState(...args);
      this.handleUrlChange();
    };

    history.replaceState = (...args) => {
      original.replaceState(...args);
      this.handleUrlChange();
    };
  }
}
