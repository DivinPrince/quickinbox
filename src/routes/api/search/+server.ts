import { json, type RequestHandler } from '@sveltejs/kit';
import { searchFilters, searchMail } from '$lib/server/search';
export const GET: RequestHandler = async ({ platform, locals, url }) => {
  if (!locals.user || !platform?.env.DB) return json({ error: 'Unauthorized' }, { status: 401 });
  return json(await searchMail(platform.env.DB, locals.user.id, searchFilters(url.searchParams), Number(url.searchParams.get('page')) || 1, locals.activeDomainId), { headers: { 'Cache-Control': 'private, no-store' } });
};
