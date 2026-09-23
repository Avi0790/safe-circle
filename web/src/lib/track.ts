// Guest tracking links look like /track/<token> — the token is 48 hex
// characters (192 bits, see create_share_link in migration
// ...000043_share_links.sql). Anything else falls through to the normal
// signed-in dashboard.
export function parseTrackToken(pathname: string): string | null {
  const match = /^\/track\/([a-f0-9]{32,96})\/?$/i.exec(pathname)
  return match ? match[1] : null
}
