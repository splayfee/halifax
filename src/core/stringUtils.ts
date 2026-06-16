/** Tokenizes a route prefix by splitting on `-`, `_`, `/`, or whitespace. */
function tokenizeRoutePrefix(prefix: string): string[] {
  return prefix.split(/[-_/\s]+/).filter(Boolean)
}

/** Converts a route prefix (`'blog-posts'`) to PascalCase (`'BlogPosts'`). */
export function toPascalCase(prefix: string): string {
  return tokenizeRoutePrefix(prefix)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

/** Converts a route prefix (`'blog-posts'`) to Title Case (`'Blog Posts'`). */
export function toTitleCase(prefix: string): string {
  return (
    tokenizeRoutePrefix(prefix)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || prefix
  )
}
