/** Boundaries for a privately provisioned web-mail-only deployment. */
export function deploymentPolicyResponse(pathname: string, env: {
 DISABLE_PUBLIC_SETUP?: string;
 DISABLE_EXTERNAL_AUTH?: string;
}): Response | null {
 const path = decodeURIComponent(pathname).replace(/\/+/g, '/');
 const under = (prefix: string) => path === prefix || path.startsWith(prefix + '/');
 if (env.DISABLE_PUBLIC_SETUP === 'true' && (under('/setup') || under('/api/setup'))) {
  return new Response('Public setup is disabled. The administrator is provisioned privately.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
 }
 if (env.DISABLE_EXTERNAL_AUTH === 'true' && (under('/oauth') || under('/mcp') || under('/api/apikeys') ||
  under('/api/oauth') || under('/api/auth/pair') || under('/api/auth/pair-codes') || under('/install.sh') ||
  path.startsWith('/.well-known/oauth-'))) {
  return new Response('External client integrations are disabled for this installation.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
 }
 return null;
}
