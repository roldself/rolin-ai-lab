# Rolin AI Lab

A personal AI lab for skills, agents, products, videos, and build logs.

Astro, CSS, and a small TypeScript interaction layer. No Framer runtime or additional animation framework.

## Development

For visual editing, open **Start Studio.command** on macOS, or run `npm run studio`. See **STUDIO-GUIDE.md** for the local-first workflow. Saving and previewing never upload anything. GitHub upload and public release each require explicit confirmation.

```sh
npm ci
npm run dev
```

Build with `npm run build`. Static output is in `dist`.
For GitHub-connected Cloudflare Pages, use that build command and output directory. This version has not been deployed.

## Editing

- `src/data/content.json`: project content maintained by the visual Studio; no hand editing needed.
- `src/data/works.ts`: shared types and category definitions.
- `src/pages/index.astro`: page structure and project dialogs.
- `src/components/ProjectVisual.astro`: explicitly labeled temporary IP covers.
- `src/styles/global.css`: shared styling, responsive layout and motion tokens.
- `src/scripts/lab.ts`: pointer distortion, scrolling, search, filtering and dialogs.

Read `DESIGN-SYSTEM.md`, `ASSETS.md`, `PREVIEW.md` and `UI-REVIEW.md` before continuing.
