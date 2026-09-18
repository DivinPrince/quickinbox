/** D1 accepts at most 100 bound parameters; reserve room for ownership and flags. */
export function chunkIds(ids: string[], size = 80): string[][] {
 const groups: string[][] = [];
 for (let i = 0; i < ids.length; i += size) groups.push(ids.slice(i, i + size));
 return groups;
}
