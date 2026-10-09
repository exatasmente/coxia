/** How long a quit waits for the open screens to keep their recordings and let go of their profiles; the update's own hard exit comes later (8 s). */
export const QUIT_WAIT_MS = 5000;

/**
 * Waits for `work` for at most `ms`. A quit must not hang on a browser that does not answer: the browser's sandbox dies with the app (`--die-with-parent`), so what is left
 * after the wait costs nothing but the recording. Never rejects.
 */
export async function settleWithin(work: Promise<unknown>, ms: number): Promise<'done' | 'late'> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work.then(() => 'done' as const, () => 'done' as const), late]);
  } finally {
    clearTimeout(timer);
  }
}
