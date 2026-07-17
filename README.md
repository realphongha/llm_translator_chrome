# LLM Page Translator

Chrome extension for translating webpages using any OpenAI-compatible API (local models, OpenAI, or any provider).

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm (ships with Node.js)

## Setup

```bash
npm install
```

## Build

```bash
npm run build
```

Output goes to `dist/`. The build bundles TypeScript via esbuild, copies HTML/CSS/manifest, and includes icons.

## Development (watch mode)

```bash
npm run dev
```

Rebuilds automatically on file changes.

## Load into Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `dist/` directory

## Clean

```bash
npm run clean
```

Removes the `dist/` directory.

## Project structure

```
├── src/
│   ├── background/    Service worker (translation queue, API calls)
│   ├── content/       Content script (DOM extraction, rendering)
│   ├── options/       Settings page
│   ├── popup/         Toolbar popup
│   ├── prompts/       System prompt builder
│   ├── sites/         Per-site default configs
│   ├── storage/       Config/cache persistence
│   └── utils/         Batching, parsing, language helpers
├── icons/             Extension icons (16, 32, 48, 128)
├── dist/              Build output (gitignored)
├── manifest.json
├── esbuild.config.mjs
└── tsconfig.json
```
