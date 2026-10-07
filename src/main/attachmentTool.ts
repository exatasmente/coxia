import { ATTACHMENT_TOOL, ATTACHMENT_TOOL_DEF, type AttachmentRef, formatBytes, kindLabelKey } from '../shared/attachments';
import { t } from '../shared/i18n';
import { loadClaudeSdkModule } from './claudeSdk';
import { type AttachmentRead, attachmentStore } from './attachments';
import { type ToolImpl, ToolError, clip } from './engine/open/tools/types';
import type { Json } from './engine/open/types';

// The `ConversationAttachment` tool in the shapes the two engines take it: a ToolImpl for the open engine, an in-process MCP server for the Claude
// Agent SDK. Both resolve the ref inside one conversation's folder (main/attachments.ts), never a path on the computer, and both are read only.

export const ATTACHMENT_MCP_SERVER = 'coxia_attachment';
/** The name the Claude SDK knows the tool by, for allowedTools. */
export const ATTACHMENT_MCP_TOOL_NAME = `mcp__${ATTACHMENT_MCP_SERVER}__conversation_attachment`;

/** The media type of an image the tool hands back; the store accepts PNG/JPEG/GIF/WebP, and the bytes say which. */
function mediaType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  return 'image/png';
}

/** The text a text attachment gives the model: the numbered lines and the size, so the agent can quote them. */
function textResult(read: AttachmentRead): string {
  return t('main.attachment.tool.text', { name: read.ref.name, size: formatBytes(read.ref.bytes), text: read.text ?? '' });
}

/** The name and the kind a message lists for an id: the file on disk carries only the id and the extension. */
function refFor(refs: readonly AttachmentRef[], id: string): AttachmentRef | null {
  return refs.find((r) => r.id === id) ?? null;
}

/** The reason a PDF, JSON or CSV does not go to the model, in words, with name and kind. */
function refusedResult(ref: AttachmentRef, reason: string): string {
  return t('main.attachment.tool.refused', { name: ref.name, kind: t(kindLabelKey(ref.kind)) }) + `\n${reason}`;
}

const gone = (id: unknown): string => t('main.attachment.tool.gone', { id: String(id ?? '') });

/** What the tool answers with, for the engine that has no image blocks (the open engine carries the image beside the text result). */
export function attachmentTextAnswer(read: AttachmentRead | null, id: unknown): string {
  if (!read) return gone(id);
  if (read.ref.kind === 'image') return t('main.attachment.tool.image', { name: read.ref.name, size: formatBytes(read.ref.bytes) });
  if (read.reason) return refusedResult(read.ref, read.reason);
  return textResult(read);
}

/** The open engine's `ConversationAttachment`, scoped to one conversation. The image rides along the tool result (loop.ts), never the text. */
export function attachmentToolImpl(thread: string, refs: readonly AttachmentRef[] = []): ToolImpl {
  return {
    name: ATTACHMENT_TOOL,
    description: ATTACHMENT_TOOL_DEF.description,
    parameters: ATTACHMENT_TOOL_DEF.parameters as unknown as Json,
    async run(input, ctx) {
      const id = String(input.ref ?? '');
      const ref = refFor(refs, id);
      const got = ref ? attachmentStore().get(thread, id) : null;
      const read = ref ? attachmentStore().readForTool(thread, id, Number(input.offset) || undefined, Number(input.limit) || undefined) : null;
      if (!ref || !got || !read) throw new ToolError(gone(id));
      // The file on disk carries the id and the extension only: the name and the kind the message lists are the ones the agent reads.
      const named: AttachmentRead = { ...read, ref };
      const response = ref.kind === 'image' ? { type: 'attachment_image', name: ref.name, url: `data:${mediaType(got.bytes)};base64,${Buffer.from(got.bytes).toString('base64')}` } : attachmentTextAnswer(named, id);
      // The image rides as a ToolImage: the loop shows it to the model in the message it writes for every tool's pictures (the tool result stays text).
      const images = ref.kind === 'image' ? [{ path: ref.name, mediaType: mediaType(got.bytes), data: Buffer.from(got.bytes).toString('base64') }] : undefined;
      return { response, render: () => clip(attachmentTextAnswer(named, id), ctx.outputMax), ...(images ? { images } : {}) };
    },
  };
}

/**
 * The same tool as an in-process MCP server for the Claude Agent SDK. An image comes back as an image block (the SDK carries it to the model); a
 * text as a text block, capped; a PDF, JSON or CSV as the reason it does not go to the model. Null when the SDK or zod cannot be loaded.
 */
export async function attachmentMcpServer(thread: string, refs: readonly AttachmentRef[] = []): Promise<Record<string, unknown> | null> {
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const server = sdk.createSdkMcpServer({
      name: ATTACHMENT_MCP_SERVER,
      tools: [
        sdk.tool(
          'conversation_attachment',
          ATTACHMENT_TOOL_DEF.description,
          { ref: z.string(), offset: z.number().int().optional(), limit: z.number().int().optional() },
          async (args) => {
            const ref = refFor(refs, args.ref);
            const got = ref ? attachmentStore().get(thread, args.ref) : null;
            const read = ref ? attachmentStore().readForTool(thread, args.ref, args.offset, args.limit) : null;
            if (!ref || !got || !read) return { content: [{ type: 'text' as const, text: gone(args.ref) }], isError: true };
            const named: AttachmentRead = { ...read, ref };
            if (ref.kind === 'image') {
              return {
                content: [
                  // i18n-ignore: prompt text the engine sends the model: English by design
                  { type: 'text' as const, text: `Image "${ref.name}" (${formatBytes(ref.bytes)}), attached by the person in this conversation.` },
                  { type: 'image' as const, data: Buffer.from(got.bytes).toString('base64'), mimeType: mediaType(got.bytes) },
                ],
              };
            }
            return { content: [{ type: 'text' as const, text: attachmentTextAnswer(named, args.ref) }] };
          },
        ),
      ],
    });
    return { [ATTACHMENT_MCP_SERVER]: server };
  } catch (e) {
    console.error('[attachments] the ConversationAttachment tool is not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}
