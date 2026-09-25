/**
 * HTTP byte ranges for the static server (DESIGN §8.3): the music is the one thing that
 * asks for them. Only the single-range forms browsers send for media are honoured; a
 * multi-range request is answered with the whole file, which RFC 9110 allows.
 */

/**
 * The one `bytes=a-b` / `bytes=a-` / `bytes=-n` range of a `Range` header, clamped to
 * the file, or null when there is no range to honour (absent, several of them, another
 * unit, garbage). `'unsatisfiable'` is a well-formed range that starts past the end.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, from = '', to = ''] = m;
  if (from === '' && to === '') return null;
  if (from === '') {
    // A suffix: the last n bytes.
    const n = Number(to);
    if (n === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return { start, end };
}
