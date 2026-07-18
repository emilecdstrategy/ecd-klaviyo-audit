import type { LlmTool } from "../_shared/llm-adapter.ts";

export const AGENT_TOOLS: LlmTool[] = [
  {
    name: "fetch_google_doc",
    description:
      "Fetch the text of a link-shared Google Doc (docs.google.com/document/... link). Use whenever the user shares a Google Docs URL. Fails with doc_private if the doc is not shared as 'Anyone with the link can view'.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "The Google Docs URL the user shared" } },
      required: ["url"],
    },
  },
  {
    name: "fetch_fireflies_transcript",
    description:
      "Fetch the transcript and summary of a Fireflies meeting (app.fireflies.ai/view/... link). Use whenever the user shares a Fireflies link. Returns not_configured if no Fireflies API key is set.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "The Fireflies transcript URL the user shared" } },
      required: ["url"],
    },
  },
  {
    name: "get_templates",
    description:
      "List the saved document templates (name + body) to reuse existing wording and structure. Use before drafting when the user references a known document type.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "ask_user",
    description:
      "Ask the user one clarifying question with 2-4 concrete options rendered as clickable chips (plus an automatic free-text 'Other'). ALWAYS use this tool to ask a question, including yes/no (give Yes and No). This is the only way the user gets clickable answers. Never ask a question as plain chat text. This ends your turn.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "One clear question, a single sentence" },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short chip label, 1-6 words" },
              value: { type: "string", description: "The full answer text sent back when this chip is clicked" },
            },
            required: ["label", "value"],
          },
        },
        multi_select: { type: "boolean", description: "Allow selecting multiple options" },
      },
      required: ["question", "options"],
    },
  },
  {
    name: "propose_draft",
    description:
      "Propose a complete new document. The user sees a preview and applies it manually. Use when you have enough to write the full document. This ends your turn.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title" },
        content: { type: "string", description: "The full document body as Markdown (headings, paragraphs, lists, bold)" },
        summary: { type: "string", description: "1-2 sentences describing the document, shown on the preview card" },
      },
      required: ["title", "content", "summary"],
    },
  },
  {
    name: "propose_edits",
    description:
      "Propose a revised version of the CURRENTLY OPEN document. Return the full revised Markdown body (not a diff). The user sees a preview and applies it manually. This ends your turn.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The full revised document body as Markdown" },
        summary: { type: "string", description: "1-2 sentences describing what changed, shown on the preview card" },
      },
      required: ["content", "summary"],
    },
  },
];

export const TERMINAL_TOOLS = new Set(["ask_user", "propose_draft", "propose_edits"]);
