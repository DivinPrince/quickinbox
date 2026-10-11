/** D1 caps bound parameters at 100; leave room for user_id and SET values. */
export const D1_IN_CHUNK = 80;

/** Splits ids for `IN (...)` lists so no statement passes D1's parameter limit. */
export function chunkIds<T>(ids: T[], size = D1_IN_CHUNK): T[][] {
	const groups: T[][] = [];
	for (let i = 0; i < ids.length; i += size) {
		groups.push(ids.slice(i, i + size));
	}
	return groups;
}
