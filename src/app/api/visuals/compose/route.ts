import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 90;

const VISUAL_INSTRUCTIONS = `
You are an expert information designer, technical illustrator, and classroom visual thinker.
Create one original SVG that makes the requested concept easier to understand on a whiteboard.

COMPOSITION
- Choose the visual grammar from the subject, not from a generic template.
- Begin with one visual thesis: the relationship, mechanism, transformation, or contrast the learner must see.
- Default to a clean, free-form ink drawing: confident charcoal strokes, slightly imperfect construction lines,
  handwritten-feeling annotations, and at most one warm accent. It should feel drawn directly on the board by an
  excellent professor—not laid out by presentation software.
- Prefer spatial explanation: annotated sketches, plotted relationships, cutaways, timelines, state traces,
  number lines, layered systems, realistic silhouettes, maps, visual metaphors, or worked transformations.
- Never output a dashboard, UI mockup, nested cards, repeated rounded boxes, or a generic flowchart unless the
  request inherently requires that exact structure.
- Never arrange an explanation as a workflow of labeled nodes and connector arrows. Put short labels beside the
  thing they explain and use sparse ink leader lines, braces, underlines, motion marks, or trajectories instead.
- Establish one focal point and a clear reading path. Use scale, overlap, proximity, and whitespace—not boxes—to group ideas.
- Keep labels short, useful, and at least 20px at a 1200px-wide viewBox. Use no more than 14 visible text labels.
- Use a restrained palette sampled from warm paper, charcoal ink, coral, moss, ochre, and slate. Avoid purple dominance.
- Keep the root background transparent so the result belongs to the shared board. Add local fills only where contrast needs them.
- Use a clear line-weight hierarchy: bold silhouette or main path, medium relationships, fine construction/detail lines.
- Draw primarily with open paths and purposeful groups. Vary line weight subtly and use rounded joins and caps.
  Gentle hand-drawn irregularity is required; wobble should feel human but never messy.
- Use gradients, patterns, masks, arrows, and subtle texture only when they carry meaning.
- For code or algorithms, visualize state and change rather than pasting source code into the SVG.
- For exercises, leave intentional blanks or prompts rather than revealing every answer.
- Do not use emoji, stock UI icons, clip-art symbols, fake controls, legends that can be labeled directly, or ornamental blobs.

VISUAL LANGUAGES
- technical-sketch: free-form charcoal ink, open construction lines, sparse leader notes, and one coral emphasis;
  no panels, node diagrams, or closed containers unless they depict a real physical boundary.
- scientific-illustration: recognizable form, cutaway or magnified detail, scale cues, and restrained labels.
- data-graphic: honest axes or encodings, direct labels, purposeful comparison, and no decorative chart furniture.
- spatial-map: position and distance carry meaning; use terrain, regions, routes, or topology rather than a node grid.
- chalkboard: energetic strokes and worked transformations, but retain warm-paper contrast instead of a dark rectangle.
- editorial-illustration: one strong metaphor or scene with a clear conceptual mapping and minimal text.

BOARD INTEGRATION
- Read the supplied board image as an existing composition. Continue its direction, density, and scale.
- Create a complementary drawing, not a poster, worksheet, card, or diagram component placed on top of the board.
- Leave breathing room near existing learner work and visually connect to it only when the brief calls for a relationship.
- If the concept changes over time, show a before/after, trajectory, or state sequence with an unmistakable direction.

SVG CONTRACT
- Return a complete root <svg> with xmlns, width, height, and matching viewBox.
- Include <title> and <desc> as the first children.
- Use only self-contained SVG. No scripts, event handlers, foreignObject, remote URLs, or external fonts/images.
- Use font-family="ui-sans-serif, system-ui, sans-serif" or monospace.
- The composition must remain legible when scaled down.

TEACHING BEATS
- Return 2-6 focal beats in the order a professor should discuss them.
- Each beat uses normalized x/y coordinates from 0 to 1 in the SVG viewBox.
- Choose circle for a localized object, underline for a label/equation, and point for a precise coordinate.

LEARNING TRACES
- When purpose is reflect, visualize a journey from goal through demonstrated evidence to the next challenge.
- Make observed evidence visually distinct from claims that remain to be tested.
- Preserve supplied source page numbers exactly. Never invent mastery, evidence, misconceptions, or citations.

MISCONCEPTION TRAILS
- Show original model → turning evidence → revised model as one readable spatial transformation.
- Keep the original idea visible but lighter. Emphasize the evidence as the pivot and the revised model as current.
- Never use shaming red X marks, failure badges, scores, or language that treats revision as failure.
`.trim();

type RequestBody = {
  brief?: unknown;
  purpose?: unknown;
  style?: unknown;
  aspect?: unknown;
  boardImage?: unknown;
  boardObjects?: unknown;
  sessionId?: unknown;
};

function extractOutputText(payload: {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
}) {
  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text")?.text;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Visual composition is not configured." }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief || brief.length > 4_000) {
    return Response.json({ error: "Visual brief must be between 1 and 4,000 characters." }, { status: 400 });
  }

  const purpose = typeof body.purpose === "string" ? body.purpose : "explain";
  const style = typeof body.style === "string" ? body.style : "technical-sketch";
  const aspect = typeof body.aspect === "string" ? body.aspect : "landscape";
  const boardObjects = typeof body.boardObjects === "string" ? body.boardObjects.slice(0, 24_000) : "[]";
  const boardImage =
    typeof body.boardImage === "string" &&
    body.boardImage.startsWith("data:image/") &&
    body.boardImage.length <= 4_000_000
      ? body.boardImage
      : null;
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.length <= 128 ? body.sessionId : "anonymous";

  const dimensions =
    aspect === "portrait"
      ? { width: 900, height: 1200 }
      : aspect === "square"
        ? { width: 1000, height: 1000 }
        : { width: 1200, height: 800 };
  const inputText = JSON.stringify({
    brief,
    purpose,
    style,
    dimensions,
    existingBoardObjects: JSON.parse(boardObjects),
    instruction:
      "Create a complementary visual. Do not duplicate existing board content unless comparison requires it.",
  });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        reasoning: { effort: "medium" },
        safety_identifier: createHash("sha256").update(sessionId).digest("hex"),
        instructions: VISUAL_INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: inputText },
              ...(boardImage ? [{ type: "input_image", image_url: boardImage }] : []),
            ],
          },
        ],
        max_output_tokens: 24_000,
        text: {
          format: {
            type: "json_schema",
            name: "whiteboard_visual",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                svg: { type: "string" },
                beats: {
                  type: "array",
                  minItems: 2,
                  maxItems: 6,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      label: { type: "string" },
                      x: { type: "number", minimum: 0, maximum: 1 },
                      y: { type: "number", minimum: 0, maximum: 1 },
                      gesture: { type: "string", enum: ["circle", "underline", "point"] },
                    },
                    required: ["label", "x", "y", "gesture"],
                  },
                },
              },
              required: ["title", "svg", "beats"],
            },
          },
        },
      }),
    });

    const payload = (await response.json()) as {
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string; refusal?: string }>;
      }>;
      error?: { message?: string };
    };
    const outputText = extractOutputText(payload);

    if (!response.ok || !outputText) {
      return Response.json(
        { error: payload.error?.message ?? "The visual composer did not return a result." },
        { status: response.status || 502 },
      );
    }

    const result = JSON.parse(outputText) as {
      title?: unknown;
      svg?: unknown;
      beats?: unknown;
    };
    if (typeof result.svg !== "string" || !result.svg.trim().startsWith("<svg")) {
      return Response.json({ error: "The visual composer returned invalid SVG." }, { status: 502 });
    }

    return Response.json(
      {
        title: typeof result.title === "string" ? result.title : "Visual explanation",
        svg: result.svg,
        beats: Array.isArray(result.beats) ? result.beats : [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Could not reach the visual composition model." }, { status: 502 });
  }
}
