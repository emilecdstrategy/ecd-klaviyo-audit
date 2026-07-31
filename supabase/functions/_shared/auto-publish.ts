import { type SupabaseClient } from "npm:@supabase/supabase-js@2";

// Publishes an audit the moment its pipeline finishes, so nobody has to click
// Publish by hand. Called from the completion points of both pipelines: for
// Klaviyo audits that is the end of the analysis, for web audits it is the end
// of the "after" image generation, which is the last thing to finish.
//
// This runs with the service role, so it deliberately refuses to act on an
// audit that has been published before: published_at being set means a human
// has already made a publish decision, and if they later moved it back to draft
// or viewer_only, a regenerate must not silently flip it public again. First
// completion publishes; every later completion leaves the status alone.

/** Same shape the app mints client-side, so public links look identical. */
function newShareToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export async function autoPublishAudit(
  sb: SupabaseClient,
  auditId: string,
): Promise<{ published: boolean; reason?: string }> {
  try {
    const { data: audit, error } = await sb
      .from("audits")
      .select("id, status, published_at, public_share_token, executive_summary")
      .eq("id", auditId)
      .maybeSingle();
    if (error) throw error;
    if (!audit) return { published: false, reason: "not_found" };
    if (audit.published_at) return { published: false, reason: "already_decided" };
    if (audit.status !== "draft" && audit.status !== "in_review") {
      return { published: false, reason: `status_${audit.status}` };
    }

    // Sections exist from creation, so their presence proves nothing. Require
    // real generated content, mirroring publishAudit on the client: a
    // published-but-empty audit serves a blank public report.
    const { data: sections } = await sb
      .from("audit_sections")
      .select("section_key, summary_text, human_edited_findings, key_findings")
      .eq("audit_id", auditId);
    if ((sections ?? []).length === 0) return { published: false, reason: "no_sections" };

    const hasContent = Boolean((audit.executive_summary ?? "").trim()) ||
      (sections ?? []).some((s) => {
        const row = s as {
          section_key?: string;
          summary_text?: string | null;
          human_edited_findings?: string | null;
          key_findings?: { items?: unknown[] } | null;
        };
        // revenue_summary is computed, not generated, so it never counts as content.
        if (row.section_key === "revenue_summary") return false;
        const items = row.key_findings?.items ?? [];
        if (items.some((i) => String(i ?? "").trim())) return true;
        return Boolean((row.summary_text ?? "").trim() || (row.human_edited_findings ?? "").trim());
      });
    if (!hasContent) return { published: false, reason: "no_content" };

    const { error: upErr } = await sb
      .from("audits")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        public_share_token: audit.public_share_token || newShareToken(),
      })
      .eq("id", auditId);
    if (upErr) throw upErr;

    // actor_user_id is null: the pipeline published this, not a person. The
    // timeline entry is best effort, never a reason to fail the publish.
    try {
      await sb.from("audit_events").insert({
        audit_id: auditId,
        event_type: "published",
        actor_user_id: null,
        metadata: { auto: true },
      });
    } catch { /* non-fatal */ }

    return { published: true };
  } catch (e) {
    console.error("autoPublishAudit failed", auditId, e);
    return { published: false, reason: "error" };
  }
}
