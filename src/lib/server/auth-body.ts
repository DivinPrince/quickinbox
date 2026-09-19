/** Bound unauthenticated authentication requests before decoding JSON. */
export async function readAuthBody(request: Request): Promise<Record<string, unknown> | null> {
 if (!request.body) return null;
 const reader = request.body.getReader();
 const chunks: Uint8Array[] = [];
 let size = 0;
 try {
  while (true) {
   const { value, done } = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > 8192) { await reader.cancel(); return null; }
   chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
 } catch { return null; } finally { reader.releaseLock(); }
}
