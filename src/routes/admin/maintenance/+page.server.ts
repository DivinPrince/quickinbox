import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { checkDomain, readMaintenance } from '$lib/server/maintenance';
import { hasProviderConfigured, safeEmailProviderKind } from '$lib/server/context';

export const load: PageServerLoad = async ({ locals, platform, url, setHeaders }) => {
  if (!locals.user?.is_admin) throw error(403, 'Forbidden');
  setHeaders({ 'Cache-Control': 'private, no-store' });
  if (!platform?.env.DB || !platform.env.ATTACHMENTS) throw error(503, 'Storage unavailable');
  const pages = Math.max(1, Math.ceil(locals.domains.length / 10));
  const domainPage = Math.max(1, Math.min(pages, Math.floor(Number(url.searchParams.get('domainPage')) || 1)));
  const [health, domains] = await Promise.all([
    readMaintenance(platform.env.DB, platform.env.ATTACHMENTS),
    Promise.all(locals.domains.slice((domainPage - 1) * 10, domainPage * 10).map(checkDomain))
  ]);
  return {
    health, domains, domainPage, pages, checkedAt: new Date().toISOString(),
    provider: safeEmailProviderKind(platform), providerConfigured: hasProviderConfigured(platform),
    webhookConfigured: Boolean(platform.env.RESEND_WEBHOOK_SECRET)
  };
};
