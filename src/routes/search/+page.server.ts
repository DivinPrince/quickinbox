import type { PageServerLoad } from './$types';
import { searchFilters, searchMail } from '$lib/server/search';
export const load: PageServerLoad = async ({ platform, locals, url, setHeaders }) => {
  setHeaders({ 'Cache-Control': 'private, no-store' });
  const filters = searchFilters(url.searchParams);
  const matches = locals.user && platform?.env.DB ? await searchMail(platform.env.DB, locals.user.id, filters, Number(url.searchParams.get('page')) || 1, locals.activeDomainId) : { results: [], total: 0, page: 1, pages: 1 };
  return { filters, ...matches };
};
