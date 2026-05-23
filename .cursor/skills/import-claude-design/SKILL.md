---
name: import-claude-design
description: Consume a Claude Design handoff bundle (.zip exported from claude.ai/design) and implement it against this project's frontend. Use when the user provides a Claude Design export, paste link, or asks to "build this design" with a bundle path.
---

# Import Claude Design — Skill

This skill is for **any agent**, regardless of model. Do not assume prior
knowledge of Anthropic's products. Read the Background section below before
acting.

## Background — what you are working with

- **Claude Design** is a web app at `https://claude.ai/design` published by
  Anthropic that generates UI mockups from text prompts. It exports
  bundles in two formats:
  - **"Handoff to Claude Code…"** — structured bundle with `manifest.json`,
    `spec.json`, `design-tokens.json`, `README.md`, `components/`, `assets/`.
    This is the format this skill is optimized for.
  - **"Download project as .zip"** — raw React code only: a few `.html`
    and `.jsx` files, no `spec.json`. Treat as code reference, not as a
    spec. Section "Fallback for raw-code bundles" below covers this case.
- The `cdc ingest` script and the `ingest_bundle` MCP tool both validate
  the structured layout. If validation fails, fall back to manual extract.
- "Send to Cursor" does not exist. The supported entry points are:
  1. A `.zip` export from `claude.ai/design`.
  2. The companion `claude-design-browser` skill, which automates the
     browser flow.

## Project conventions for this install

The bridge installer (`cdc init`) detected the following layout. Honor these
paths during implementation. If a path no longer exists, stop and ask the user
to re-run `cdc init` or pass overrides.

| Aspect              | Path / command                |
|---------------------|-------------------------------|
| Framework           | `vite-react`               |
| Components dir      | `src/components`          |
| Pages / routes      | `src/pages`               |
| Services / API      | `src/services`            |
| i18n                | `src/i18n`                |
| Tokens / global CSS | `src/index.css`             |
| Lint                | `npm run lint`                |
| Build               | `npm run build`               |
| Dev server          | `npm run dev`                 |

## Inputs the agent expects

A bundle directory under `.design/handoff/<slug>/` containing:

```
.design/handoff/<slug>/
  README.md                  # written by Claude Design, instructions for the coding agent
  spec.json                  # component tree, layout hierarchy, interaction notes
  design-tokens.json         # colors, typography, spacing, radii, shadows
  components/                # per-component spec files (one .json per node)
  assets/                    # images, svgs, fonts referenced by spec.json
  preview/                   # standalone HTML preview (optional)
  manifest.json              # bundle metadata: source project, version, target route
```

Field names follow Anthropic's bundle layout (Apr 2026). If a key is missing,
treat `README.md` as source of truth and adapt.

## When to use

- User says: "import this Claude Design bundle", "build the design from
  `.design/handoff/...`", or invokes `/import-claude-design`.
- A new `.zip` lands in `.design/handoff/`.
- The `claude-design-browser` skill just finished and called you in.

## Workflow

### Step 1 — Ingest

If the user gave a `.zip` path, prefer the **MCP tool** (registered under
`claude-design-bridge` in `.cursor/mcp.json`):

```
ingest_bundle({ zip_path: "<absolute path>", slug: "<optional>" })
```

Returns structured `{ ok, slug, destination, source_project, claude_design_version, target_route, component_count, token_groups, asset_count }`.

Fallback if the MCP server is not loaded in the session, run the script:

```bash
node scripts/ingest-claude-design.mjs <path-to-zip> [--slug <slug>]
```

Either path:
- unpacks into `.design/handoff/<slug>/`,
- validates `spec.json`, `design-tokens.json`, `README.md` are present,
- returns / prints a summary.

If the user only gave a share URL, ask them to use "Export → .zip" in
Claude Design (or run `/claude-design`), then drop the file in.

#### Fallback for raw-code bundles ("Download project as .zip")

If `ingest_bundle` returns `bundle missing required files` and inspecting
the zip shows only `*.html` + `*.jsx` files, the user picked the wrong
export option. Two recovery paths:

A. **Re-export with the right option.** Ask the user to re-run
   `/claude-design` and pick "Handoff to Claude Code…" instead.

B. **Treat the raw code as reference.** If the user accepts:
   ```bash
   slug="<derived-from-zip-name>"
   dest=".design/handoff/${slug}"
   mkdir -p "$dest"
   cp <path-to-zip> "$dest/source.zip"
   (cd "$dest" && unzip -o source.zip)
   ```
   Then proceed with Step 4 directly using the `.jsx` files as the
   component source. Skip Step 2 (spec/tokens) and Step 3
   (token reconciliation) — there is no `design-tokens.json` to
   reconcile. You must derive intent from the JSX itself.

### Step 2 — Read the bundle in this exact order

Prefer MCP tools over raw file reads where available (they validate and
return structured JSON):

1. `inspect_bundle({slug})` — manifest + counts. Get `target_route`,
   `entrypoint`, `source_project`, `claude_design_version`. If
   `claude_design_version` is newer than this skill anticipates, stop
   and ask the user to update the skill. Bundle format changes between
   versions.
2. `read_readme({slug})` — Anthropic-generated per-project notes.
   Honor any "do/do not" rules there before falling back to defaults.
3. `read_tokens({slug})` — diff against existing tokens (Step 3).
4. `read_spec({slug})` — component tree, layout, interactions.
5. `components/` — only open the ones referenced in the route you build
   (raw file read; not exposed as MCP tool to keep surface small).
6. `assets/` — only copy assets actually referenced by `spec.json`.

If the `claude-design-bridge` MCP server is not in this session, fall
back to reading the same files directly with the standard file tools.

### Step 3 — Reconcile design tokens against the existing system

The frontend already has tokens. Do not blindly overwrite them.

1. Locate existing tokens: `src/index.css` (and any
   Tailwind / theme config at the project root).
2. For each token in `design-tokens.json`:
   - If a semantically equivalent token exists (same role, e.g.
     `--color-primary`), reuse it; map the bundle name to the existing
     name in your implementation.
   - If genuinely new, add it under the existing convention, not
     Anthropic's naming.
   - If it conflicts (same name, different value), surface the conflict
     to the user and stop. Do not silently change brand colors.
3. Never copy raw hex values into components. Always go through the
   token layer.

### Step 4 — Generate components against the existing library

1. Identify reusable components in `src/components`. Match by role
   (Button, Modal, Card, FormField), not by bundle node name.
2. For each leaf in `spec.json` that maps to an existing component,
   instantiate the existing component. Do not duplicate.
3. New components go in `src/components/` following the existing
   patterns (functional components, hooks, file/function size limits as
   documented in the project's own rules).
4. Page-level composition goes in `src/pages/`. Honor
   `manifest.target_route`.
5. i18n: any user-visible string goes through `src/i18n/`. Never
   hardcode strings into components.

### Step 5 — Assets

1. Copy referenced files from `.design/handoff/<slug>/assets/` to the
   project's existing public/static path.
2. SVGs that act as icons go through the existing icon component
   pattern, not raw `<img>`.
3. Skip unreferenced assets.

### Step 6 — Interactions and state

`spec.json` may include interaction notes (`onClick → openModal`,
`onSubmit → POST /api/...`). Treat as design intent, not implementation
contract. Wire to existing services in `src/services/`. Never invent
new endpoints; if the spec references an endpoint that does not exist,
stop and surface the gap.

### Step 7 — Verify

1. `npm run lint` — must pass.
2. `npm run build` — must pass.
3. If the bundle ships a `preview/` HTML, open it side by side with
   `npm run dev` and confirm parity. Spacing < 4 px and color drift
   inside a single token are acceptable.

### Step 8 — Bundle hygiene

- Tracked in git: `manifest.json`, `spec.json`, `design-tokens.json`,
  `README.md`, `components/**` (specs).
- Ignored in git: `*.zip`, `assets/`, `preview/`. The bridge installer
  added these patterns to `.gitignore`.

## Reverse direction (project → Claude Design)

There is no native push from Cursor into Claude Design. Two bridges:

- **Live UI capture (preferred):** run `npm run dev`, then in
  claude.ai/design use "Web capture" against the local URL or a staging
  deploy.
- **Figma MCP (designer in the loop):** the Figma MCP server is the only
  writable bridge between an IDE and a design canvas. Use when the
  artifact must end up in Figma.

Do not build a custom uploader to Claude Design. The endpoints behind
"Send to Claude Code" are not public.

## Failure modes — stop, do not improvise

- Bundle missing `spec.json` or `manifest.json` → stop, ask user to
  re-export.
- `claude_design_version` newer than this skill anticipates → stop, ask
  user to update the skill.
- Token conflict against existing brand tokens → stop, surface conflict.
- Spec references a backend endpoint that does not exist → stop, surface
  gap (do not scaffold a stub endpoint here).
- `frontier: true` in `spec.json` (voice / video / shaders / 3D / in-bundle
  AI) → hand back to the user for manual review before touching code.
