export const viewIds = ['home', 'chat', 'audit', 'context', 'atlas', 'models', 'how', 'evals', 'sources'] as const;
export type ViewId = typeof viewIds[number];

/** Maps a URL hash to a known view. Anything else (free text, skip-link targets) returns null. */
export function viewFromHash(hash: string): ViewId | null {
  const id = hash.replace(/^#\/?/, '');
  return (viewIds as readonly string[]).includes(id) ? id as ViewId : null;
}
