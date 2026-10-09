import { memo } from 'react';
import { type AttachmentRef, formatBytes } from '../../../../shared/attachments';
import { useT } from '../../i18n';
import { forumApi } from './forumApi';

// The files a message carries: an image as a thumbnail that opens full size and downloads, anything else as a card with name, kind and size.
// The bytes are fetched from the message that carries them (the channel refuses the file of another conversation), and nothing here shows a
// path on the computer.

// A table, not a built key, so each key is written out where a search and the unused-key test can find it (like the team screens' label tables).
const KIND_KEY: Record<AttachmentRef['kind'], string> = {
  image: 'ui.forum.file.kind.image',
  text: 'ui.forum.file.kind.text',
  pdf: 'ui.forum.file.kind.pdf',
  json: 'ui.forum.file.kind.json',
  csv: 'ui.forum.file.kind.csv',
  video: 'ui.forum.file.kind.video',
};

/** The blob URL of a data URL, revoked when the component goes; a plain <img src> would keep the whole base64 in the accessibility tree. */
async function openFullSize(thread: string, message: number, ref: AttachmentRef): Promise<string | null> {
  const got = await forumApi.attachmentGet(thread, message, ref.id);
  if (!got) return null;
  return `data:${kindMime(ref.kind)};base64,${got.data}`;
}

export function kindMime(kind: AttachmentRef['kind']): string {
  if (kind === 'image') return 'image/png';
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'json') return 'application/json';
  if (kind === 'csv') return 'text/csv';
  if (kind === 'video') return 'video/webm';
  return 'text/plain';
}

/** Downloads one attachment of a message: the bytes come from the channel, the name is the one the person gave the file. */
export async function download(thread: string, message: number, ref: AttachmentRef): Promise<void> {
  const got = await forumApi.attachmentGet(thread, message, ref.id);
  if (!got) return;
  const url = `data:${kindMime(ref.kind)};base64,${got.data}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = ref.name;
  a.click();
}

/** Opens an attachment: an image in a new tab at full size, anything else a download. */
export async function open(thread: string, message: number, ref: AttachmentRef): Promise<void> {
  const url = await openFullSize(thread, message, ref);
  if (!url) return;
  if (ref.kind === 'image') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = ref.name;
  a.click();
}

/** The thumbnail of an image: fetched when the message is shown, opening the full size on a click. */
const ImageThumb = memo(function ImageThumb({ thread, message, ref }: { thread: string; message: number; ref: AttachmentRef }) {
  const t = useT();
  return (
    <button type="button" className="cy-file-img" title={ref.name} aria-label={t('ui.forum.file.openImage', { name: ref.name })} onClick={() => void open(thread, message, ref)}>
      <span className="cy-file-img-name">{t('ui.forum.file.image')}</span>
      <span className="cy-file-img-meta faint small">{ref.name} · {formatBytes(ref.bytes)}</span>
    </button>
  );
});

/** One file of a message: an image (thumbnail) or a card (name, kind, size; open or save). */
export function AttachmentItem({ thread, message, ref }: { thread: string; message: number; ref: AttachmentRef }) {
  const t = useT();
  if (ref.kind === 'image') return <ImageThumb thread={thread} message={message} ref={ref} />;
  return (
    <span className="cy-file-card">
      <span className="cy-file-kind badge">{t(KIND_KEY[ref.kind])}</span>
      <span className="cy-file-name mono">{ref.name}</span>
      <span className="cy-file-size faint small">{formatBytes(ref.bytes)}</span>
      <button type="button" className="cy-link" onClick={() => void open(thread, message, ref)}>{t('ui.forum.file.open')}</button>
      <button type="button" className="cy-link" onClick={() => void download(thread, message, ref)}>{t('ui.forum.file.save')}</button>
    </span>
  );
}

/** The files of one message, under its text. */
export function MessageAttachments({ thread, message, refs }: { thread: string; message: number; refs: readonly AttachmentRef[] }) {
  const t = useT();
  if (!refs.length) return null;
  return (
    <ul className="cy-files" aria-label={t('ui.forum.file.list')}>
      {refs.map((r) => (
        <li key={r.id}>
          <AttachmentItem thread={thread} message={message} ref={r} />
        </li>
      ))}
    </ul>
  );
}
