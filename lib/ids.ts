// getRandomValues remains available in HTTP local previews; randomUUID needs HTTPS.
export function newId() {
    if (typeof crypto.randomUUID === 'function')
        return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const s = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export async function fileDigest(buffer: ArrayBuffer) {
    if (crypto.subtle) {
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    }
    // A trace identifier for local preview only; duplicate detection compares transaction fields.
    let h = 2166136261;
    for (const b of new Uint8Array(buffer))
        h = Math.imul(h ^ b, 16777619);
    return 'preview-fnv-' + (h >>> 0).toString(16) + '-' + buffer.byteLength;
}
