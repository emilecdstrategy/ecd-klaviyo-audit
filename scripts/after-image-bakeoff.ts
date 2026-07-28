// After-image model bake-off orchestrator.
//
// Runs every page-section case of a real web audit through each candidate
// image model, has the PRODUCTION verifier grade every output identically, and
// writes an HTML gallery for side-by-side judging. Generation and grading run
// in the after_image_bakeoff edge function because the provider keys only
// decrypt server-side; this script just drives the matrix and collects results.
//
// Usage:
//   npx deno run --allow-read --allow-write --allow-net scripts/after-image-bakeoff.ts <audit_id> [out_dir]
//
// Costs real money (one image generation per case x candidate). Nothing here
// touches production tables or canonical after_* storage paths.

const AUDIT_ID = Deno.args[0] ?? "a315ef33-0a9f-447a-873f-41856de3f115";
const OUT_DIR = Deno.args[1] ?? `C:/Users/Emil/Desktop/after-image-bakeoff-${new Date().toISOString().slice(0, 10)}`;
const CONCURRENCY = 2;

// ---------------------------------------------------------------- env
const env: Record<string, string> = {};
for (const f of [".env", ".env.supabase"]) {
  try {
    for (const line of (await Deno.readTextFile(f)).split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0 && !line.trim().startsWith("#")) {
        const k = line.slice(0, i).trim();
        if (!(k in env)) env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* optional file */ }
}
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env/.env.supabase");
  Deno.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  authorization: `Bearer ${SERVICE_KEY}`,
  "content-type": "application/json",
};

async function rest<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers });
  if (!res.ok) throw new Error(`PostgREST ${res.status} for ${pathAndQuery}`);
  return await res.json() as T;
}

async function callBakeoff(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/after_image_bakeoff`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return await res.json() as Record<string, unknown>;
}

// ---------------------------------------------------------------- cases
// Mirrors the production section list and recommendation selection
// (hidden filter, viewport filter, floating-widget filter, MAX_FIXES cap).
const PAGE_SECTIONS = [
  { key: "web_homepage", page_type: "homepage", kind: "homepage", label: "homepage" },
  { key: "web_product_page", page_type: "product", kind: "product", label: "product page" },
  { key: "web_collection_page", page_type: "collection", kind: "collection", label: "collection page" },
  { key: "web_cart", page_type: "cart", kind: "cart", label: "cart / slide-out cart drawer" },
] as const;

const FLOATING_WIDGET_FIX_RE =
  /(chat (bubble|widget|launcher|icon|button)|loyalty badge|rewards badge|floating (badge|icon|widget|button)|back to top)/i;
const REPOSITION_RE = /\b(move|relocate|reposition|shift|tuck|stack|space|separate|collapse)\b/i;

type Finding = { hidden?: boolean; viewport?: string; recommendation?: string; text?: string };

function recommendationsFor(findings: Finding[], viewport: "desktop" | "mobile"): string[] {
  const all = findings
    .filter((f) => f?.hidden !== true)
    .filter((f) => {
      const vp = String(f?.viewport ?? "both");
      return vp === "both" || vp === viewport;
    })
    .map((f) => (f?.recommendation?.trim() || f?.text?.trim() || ""))
    .filter(Boolean);
  const applicable = all.filter((r) => !(FLOATING_WIDGET_FIX_RE.test(r) && REPOSITION_RE.test(r)));
  const MAX_FIXES = viewport === "mobile" ? 4 : 5;
  return applicable.slice(0, MAX_FIXES);
}

type SnapshotRow = {
  page_type: string;
  viewport: "desktop" | "mobile";
  variant: string | null;
  status: string;
  screenshot_url: string | null;
  raw: Record<string, unknown> | null;
  elements: Array<{ label?: string; w?: number; h?: number }> | null;
};
type SectionRow = { section_key: string; section_details: { web?: { findings?: Finding[] } } | null };

const sections = await rest<SectionRow[]>(
  `audit_sections?audit_id=eq.${AUDIT_ID}&select=section_key,section_details`,
);
const snapshots = await rest<SnapshotRow[]>(
  `web_page_snapshots?audit_id=eq.${AUDIT_ID}&status=eq.success&select=page_type,viewport,variant,status,screenshot_url,raw,elements`,
);

type Case = {
  id: string;
  label: string;
  kind: string;
  viewport: "desktop" | "mobile";
  sourceUrl: string;
  belowFoldUrl: string | null;
  elements: Array<{ label?: string; w?: number; h?: number }>;
  recommendations: string[];
};

const cases: Case[] = [];
for (const meta of PAGE_SECTIONS) {
  const section = sections.find((s) => s.section_key === meta.key);
  const findings = section?.section_details?.web?.findings ?? [];
  if (!findings.length) continue;
  for (const vp of ["desktop", "mobile"] as const) {
    const rows = snapshots.filter((r) => r.page_type === meta.page_type && r.viewport === vp && r.screenshot_url);
    if (!rows.length) continue;
    const chosen = rows.find((r) => r.variant === "viewport") ?? rows[0];
    const recs = recommendationsFor(findings, vp);
    if (!recs.length) continue;
    const f2 = chosen.raw?.fold2_url;
    cases.push({
      id: `${meta.page_type}_${vp}`,
      label: meta.label,
      kind: meta.kind,
      viewport: vp,
      sourceUrl: chosen.screenshot_url!,
      belowFoldUrl: typeof f2 === "string" && f2.length > 0 ? f2 : null,
      elements: Array.isArray(chosen.elements) ? chosen.elements : [],
      recommendations: recs,
    });
  }
}
if (!cases.length) {
  console.error(`No usable cases for audit ${AUDIT_ID} (need findings + successful screenshots).`);
  Deno.exit(1);
}
console.log(`Cases: ${cases.map((c) => c.id).join(", ")}`);

// ---------------------------------------------------------------- candidates
const models = await callBakeoff({ action: "list_models" });
const candidates: string[] = ["gemini-flash", "gemini-flash-bestof2"];
if (models.ok && models.pro) {
  candidates.push("gemini-pro");
  console.log(`Gemini pro tier available: ${models.pro}`);
} else {
  console.log("No Gemini pro-tier image model on this key; skipping that candidate.");
}
candidates.push("gpt-image-1");

// ---------------------------------------------------------------- run matrix
const RUN_ID = `run_${Date.now()}`;
type UnitResult = {
  caseId: string;
  candidate: string;
  ok: boolean;
  model?: string;
  generationMs?: number;
  skipped?: string;
  error?: string;
  best?: {
    url: string;
    score: number;
    photoDefects: number;
    shapeOk: boolean;
    missing: string[];
    defects: string[];
    width: number | null;
    height: number | null;
  };
  allCandidates?: number;
};

const units: Array<{ c: Case; candidate: string }> = [];
for (const c of cases) for (const candidate of candidates) units.push({ c, candidate });
console.log(`${units.length} generations queued (${cases.length} cases x ${candidates.length} candidates)`);

const results: UnitResult[] = [];
let cursor = 0;
async function worker(id: number) {
  while (cursor < units.length) {
    const unit = units[cursor++];
    const { c, candidate } = unit;
    const t0 = Date.now();
    console.log(`[w${id}] ${c.id} x ${candidate} ...`);
    try {
      const out = await callBakeoff({
        action: "generate",
        candidate,
        source_url: c.sourceUrl,
        below_fold_url: c.belowFoldUrl,
        elements: c.elements,
        recommendations: c.recommendations,
        viewport: c.viewport,
        page_kind: c.kind,
        label: c.label,
        out_path: `bakeoff/${RUN_ID}/${c.id}_${candidate}.png`,
      });
      if (out.ok && Array.isArray(out.results) && out.results.length) {
        const best = out.results[0] as Record<string, unknown>;
        const verdict = (best.verdict ?? {}) as { missing?: string[]; defects?: string[] };
        results.push({
          caseId: c.id,
          candidate,
          ok: true,
          model: String(out.model ?? ""),
          generationMs: Number(out.generation_ms ?? Date.now() - t0),
          best: {
            url: String(best.url ?? ""),
            score: Number(best.score ?? 0),
            photoDefects: Number(best.photoDefects ?? 0),
            shapeOk: Boolean(best.shapeOk),
            missing: verdict.missing ?? [],
            defects: verdict.defects ?? [],
            width: (best.width as number | null) ?? null,
            height: (best.height as number | null) ?? null,
          },
          allCandidates: (out.results as unknown[]).length,
        });
        console.log(`[w${id}] ${c.id} x ${candidate} -> score ${best.score} in ${out.generation_ms}ms`);
      } else if (out.ok && out.skipped) {
        results.push({ caseId: c.id, candidate, ok: false, skipped: String(out.skipped) });
        console.log(`[w${id}] ${c.id} x ${candidate} -> skipped: ${out.skipped}`);
      } else {
        const err = (out.error as { message?: string } | undefined)?.message ?? JSON.stringify(out).slice(0, 160);
        results.push({ caseId: c.id, candidate, ok: false, error: err });
        console.log(`[w${id}] ${c.id} x ${candidate} -> ERROR ${err}`);
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      results.push({ caseId: c.id, candidate, ok: false, error: err });
      console.log(`[w${id}] ${c.id} x ${candidate} -> THREW ${err}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

// ---------------------------------------------------------------- gallery
await Deno.mkdir(`${OUT_DIR}/img`, { recursive: true });

async function download(url: string, file: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    await Deno.writeFile(`${OUT_DIR}/img/${file}`, new Uint8Array(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

for (const c of cases) await download(c.sourceUrl, `${c.id}_before.png`);
for (const r of results) {
  if (r.ok && r.best?.url) await download(r.best.url, `${r.caseId}_${r.candidate}.png`);
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Summary: mean score, photo-defect rate, missing-fix rate, mean latency.
const summaryRows = candidates.map((cand) => {
  const rs = results.filter((r) => r.candidate === cand && r.ok && r.best);
  const n = rs.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return {
    cand,
    n,
    model: rs[0]?.model ?? "-",
    meanScore: mean(rs.map((r) => r.best!.score)),
    photoDefectRate: n ? rs.filter((r) => r.best!.photoDefects > 0).length / n : NaN,
    missRate: n ? rs.filter((r) => r.best!.missing.length > 0).length / n : NaN,
    cleanRate: n ? rs.filter((r) => r.best!.score === 0).length / n : NaN,
    shapeOkRate: n ? rs.filter((r) => r.best!.shapeOk).length / n : NaN,
    meanMs: mean(rs.map((r) => r.generationMs ?? 0)),
    failures: results.filter((r) => r.candidate === cand && !r.ok).length,
  };
});

const pct = (x: number) => Number.isFinite(x) ? `${Math.round(x * 100)}%` : "-";
const num = (x: number, d = 1) => Number.isFinite(x) ? x.toFixed(d) : "-";

const caseBlocks = cases.map((c) => {
  const cols = candidates.map((cand) => {
    const r = results.find((x) => x.caseId === c.id && x.candidate === cand);
    if (!r || !r.ok || !r.best) {
      return `<figure><div class="missing">${esc(r?.skipped ?? r?.error ?? "not run")}</div><figcaption><strong>${esc(cand)}</strong></figcaption></figure>`;
    }
    const v = r.best;
    const verdictBits = [
      `score <strong>${v.score}</strong>`,
      v.shapeOk ? "shape ok" : "<strong>WRONG SHAPE</strong>",
      `${v.width ?? "?"}x${v.height ?? "?"}`,
      `${Math.round((r.generationMs ?? 0) / 1000)}s`,
    ].join(" &middot; ");
    const lists = [
      v.missing.length ? `<details><summary>${v.missing.length} missing fix(es)</summary><ul>${v.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></details>` : "",
      v.defects.length ? `<details><summary>${v.defects.length} defect(s)${v.photoDefects ? `, ${v.photoDefects} photo` : ""}</summary><ul>${v.defects.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></details>` : "",
      !v.missing.length && !v.defects.length ? `<p class="clean">verifier: clean</p>` : "",
    ].join("");
    return `<figure><a href="img/${c.id}_${cand}.png" target="_blank"><img loading="lazy" src="img/${c.id}_${cand}.png"></a><figcaption><strong>${esc(cand)}</strong> <span class="model">${esc(r.model ?? "")}</span><br>${verdictBits}${lists}</figcaption></figure>`;
  }).join("\n");
  return `<section>
  <h2>${esc(c.id)} <span class="model">${esc(c.label)}</span></h2>
  <details class="fixes"><summary>${c.recommendations.length} fixes requested</summary><ol>${c.recommendations.map((r) => `<li>${esc(r)}</li>`).join("")}</ol></details>
  <div class="row">
    <figure><a href="img/${c.id}_before.png" target="_blank"><img loading="lazy" src="img/${c.id}_before.png"></a><figcaption><strong>BEFORE</strong></figcaption></figure>
${cols}
  </div>
</section>`;
}).join("\n");

const summaryTable = `<table>
<tr><th>candidate</th><th>model</th><th>runs</th><th>mean score (lower=better)</th><th>clean rate</th><th>photo-defect rate</th><th>missing-fix rate</th><th>shape ok</th><th>mean gen time</th><th>failures</th></tr>
${summaryRows.map((s) => `<tr><td><strong>${esc(s.cand)}</strong></td><td>${esc(s.model)}</td><td>${s.n}</td><td>${num(s.meanScore)}</td><td>${pct(s.cleanRate)}</td><td>${pct(s.photoDefectRate)}</td><td>${pct(s.missRate)}</td><td>${pct(s.shapeOkRate)}</td><td>${num(s.meanMs / 1000, 0)}s</td><td>${s.failures}</td></tr>`).join("\n")}
</table>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>After-image model bake-off</title>
<style>
  body { font: 14px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; margin: 0; padding: 24px; background: #f5f5f7; color: #17171c; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .lede { opacity: .7; max-width: 75ch; }
  table { border-collapse: collapse; margin: 16px 0 30px; background: #fff; }
  th, td { border: 1px solid #ddd; padding: 6px 12px; text-align: left; font-size: 13px; }
  section { margin-bottom: 40px; }
  h2 { font-size: 17px; margin: 0 0 6px; }
  .model { font-weight: 400; opacity: .55; font-size: 12px; }
  .fixes { margin-bottom: 10px; font-size: 13px; }
  .row { display: flex; gap: 12px; overflow-x: auto; align-items: flex-start; }
  figure { margin: 0; flex: 0 0 300px; background: #fff; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
  img { display: block; width: 100%; height: auto; }
  figcaption { padding: 8px 10px; font-size: 12px; }
  .clean { color: #0a7d38; margin: 4px 0 0; }
  .missing { padding: 40px 10px; text-align: center; color: #a33; font-size: 12px; }
  details ul, details ol { margin: 4px 0; padding-left: 18px; }
</style></head><body>
<h1>After-image model bake-off</h1>
<p class="lede">Audit ${esc(AUDIT_ID)} &middot; run ${esc(RUN_ID)} &middot; every candidate got the exact production prompt and was graded by the exact production verifier (Claude Sonnet vision + deterministic shape check). Score: photo defect = 100, other defect = 10, missing fix = 1; lower is better; 0 = clean. gpt-image-1 accepts one input image, so its runs have no below-fold context (noted disadvantage). All candidates ran standalone (no sibling-viewport mirroring) so every model faced the identical task.</p>
${summaryTable}
${caseBlocks}
</body></html>`;

await Deno.writeTextFile(`${OUT_DIR}/index.html`, html);
await Deno.writeTextFile(`${OUT_DIR}/results.json`, JSON.stringify({ auditId: AUDIT_ID, runId: RUN_ID, candidates, results }, null, 2));

console.log("\n=== SUMMARY (lower score is better; 0 = clean) ===");
for (const s of summaryRows) {
  console.log(`${s.cand.padEnd(22)} model=${s.model.padEnd(28)} runs=${s.n} meanScore=${num(s.meanScore)} clean=${pct(s.cleanRate)} photoDefects=${pct(s.photoDefectRate)} missingFixes=${pct(s.missRate)} avg=${num(s.meanMs / 1000, 0)}s failures=${s.failures}`);
}
console.log(`\nGallery: ${OUT_DIR}/index.html`);
