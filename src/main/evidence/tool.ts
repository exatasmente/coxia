// i18n-lint: allow-file what the evidence tools tell a model: English by design, like the other tool texts of the engines
import { EVIDENCE_MAX_BYTES, MARK_COLORS, MARK_KINDS, MARK_MAX_WIDTH, type EvidenceKind } from '../../shared/evidence';

// The two tools a stage with a sandbox gets for its evidence: keeping a file and marking an image. Looking at the result is the sandbox's `ViewImage`, which takes an
// evidence id too and calls `EvidenceTools.view`. The text each tool is described with is English by design (the engines' tool texts are); every refusal a model reads
// comes back from the handler, worded by the app.

export const SAVE_EVIDENCE_TOOL = 'SaveEvidence';
export const ANNOTATE_IMAGE_TOOL = 'AnnotateImage';

export const EVIDENCE_MCP_SERVER = 'coxia_evidence';
export const evidenceMcpToolName = (name: string): string => `mcp__${EVIDENCE_MCP_SERVER}__${name}`;

export const SAVE_EVIDENCE_DESCRIPTION =
  'Keeps a file your stage made in its output folder as evidence of the stage: the person sees it in the run and it can go to the code host. Give the path as you see it inside your sandbox ' +
  '(for example /coxia/out/shot.png), a short title and an optional description. Nothing outside the output folder is accepted: not an absolute path elsewhere, not a path that walks with "..", ' +
  `not a path through a link. The kind is read from the bytes, never from the name; images (PNG, JPEG, GIF, WebP), plain text and PDF are kept, and a file over ${Math.round(EVIDENCE_MAX_BYTES / (1024 * 1024))} MiB is refused. It answers with the evidence id ("ev-3"), which is what a QA scenario or a stage output cites.`;

export const ANNOTATE_IMAGE_DESCRIPTION =
  'Draws marks on an image and keeps the result as a new piece of evidence; the original is left as it is. Give the source (an evidence id, or a path in your output folder) and a list of marks. ' +
  `Each mark has a kind (${MARK_KINDS.join(', ')}), a colour of ${MARK_COLORS.join(', ')}, a line width up to ${MARK_MAX_WIDTH} and coordinates in pixels of the image: rectangle and blur take x, y, w, h; ` +
  'arrow takes x, y and x2, y2; ellipse takes x, y and rx, ry; label takes x, y and text; marker takes x, y and n (1..99). The blur box hides what should not be seen. It answers with the id of the new evidence, linked to the one it came from.';

export const SAVE_EVIDENCE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'The file in your output folder, as you see it inside the sandbox (/coxia/out/...).' },
    title: { type: 'string', description: 'A short title the person reads (at most 200 characters).' },
    description: { type: 'string', description: 'An optional short text under the title (at most 1000 characters).' },
  },
  required: ['path', 'title'],
  additionalProperties: false,
} as const;

export const ANNOTATE_IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string', description: 'The evidence id to mark (like "ev-3"), or an image path in your output folder.' },
    marks: {
      type: 'array',
      description: 'What to draw, in order.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...MARK_KINDS] },
          color: { type: 'string', enum: [...MARK_COLORS] },
          width: { type: 'number', description: `Line width in pixels (1..${MARK_MAX_WIDTH}).` },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number', description: 'Rectangle and blur.' },
          h: { type: 'number', description: 'Rectangle and blur.' },
          x2: { type: 'number', description: 'Arrow.' },
          y2: { type: 'number', description: 'Arrow.' },
          rx: { type: 'number', description: 'Ellipse.' },
          ry: { type: 'number', description: 'Ellipse.' },
          text: { type: 'string', description: 'Label.' },
          n: { type: 'number', description: 'Numbered marker, 1..99.' },
        },
        required: ['kind'],
        additionalProperties: false,
      },
    },
    title: { type: 'string', description: 'A short title for the new evidence.' },
    description: { type: 'string', description: 'An optional short text under the title.' },
  },
  required: ['source', 'marks'],
  additionalProperties: false,
} as const;

/** What a tool handler returns: the text the model reads, and, for looking at an image, the image itself. */
export interface ToolAnswer {
  text: string;
  /** Only `view` fills it: the image as bytes and its media type. */
  image?: { data: Uint8Array; media: string };
}

/** The handlers of the evidence tools and of looking at an image, given by the executor: they know the stage, the run and the output folder. */
export interface EvidenceTools {
  save(input: unknown): Promise<ToolAnswer>;
  annotate(input: unknown): Promise<ToolAnswer>;
  view(input: unknown): Promise<ToolAnswer>;
}

/** The evidence kinds a model may be told about, for a message. */
export const evidenceKindWord = (kind: EvidenceKind): string => kind;
