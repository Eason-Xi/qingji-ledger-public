import type { Ledger } from './ledger';
import { DEFAULT_BOOK_ID, DEFAULT_BOOK_NAME, validBookId, type Book } from './books.ts';
export type OfflineData = { owner: string; bookId?: string; bookName?: string; base: Ledger; ledger: Ledger; revision: number; pending: boolean; updated: string };
type Store = { owner: string; last: string; books: Record<string, OfflineData> };
const KEY = 'qingji-offline-v2', LEGACY = 'qingji-offline-v1';
function readStore(): Store | null {
    try {
        const value = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (typeof value?.owner === 'string' && value.owner && value.books && typeof value.books === 'object' && !Array.isArray(value.books)) {
            const books = Object.fromEntries(Object.entries(value.books).filter(([id, raw]) => {
                const d = raw as OfflineData | null;
                return validBookId(id) && d && d.owner === value.owner && d.ledger && d.base && Number.isSafeInteger(d.revision) && d.revision >= 0;
            }).map(([id, raw]) => [id, { ...(raw as OfflineData), bookId: id }]));
            if (Object.keys(books).length) return { owner: value.owner, last: Object.hasOwn(books, value.last) ? value.last : Object.keys(books)[0], books };
        }
        const old = JSON.parse(localStorage.getItem(LEGACY) || 'null');
        return old?.owner && old?.ledger ? { owner: old.owner, last: DEFAULT_BOOK_ID, books: { [DEFAULT_BOOK_ID]: { ...old, bookId: DEFAULT_BOOK_ID, bookName: DEFAULT_BOOK_NAME } } } : null;
    } catch { return null; }
}
export function readOffline(bookId?: string, owner?: string): OfflineData | null {
    const store = readStore();
    if (!store || owner && store.owner !== owner) return null;
    const id = bookId || store.last;
    return Object.hasOwn(store.books, id) ? store.books[id] : null;
}
export function offlineBooks(): Book[] {
    const store = readStore();
    return Object.entries(store?.books || {}).map(([id, d]) => ({ id, name: d.bookName || DEFAULT_BOOK_NAME, created: d.updated, updated: d.updated }));
}
export function writeOffline(d: OfflineData) {
    try {
        const previous = readStore(), id = d.bookId || DEFAULT_BOOK_ID;
        const books = { ...(previous?.owner === d.owner ? previous.books : {}), [id]: { ...d, bookId: id, bookName: d.bookName || DEFAULT_BOOK_NAME } };
        localStorage.setItem(KEY, JSON.stringify({ owner: d.owner, last: id, books }));
        localStorage.removeItem(LEGACY);
        return true;
    } catch { return false; }
}
export function clearOffline() { localStorage.removeItem(KEY); localStorage.removeItem(LEGACY); }
export function offlineConsent() {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('qingji-offline-consent') === 'yes'; }
    catch { return false; }
}
export function setOfflineConsent(enabled: boolean) {
    if (enabled) localStorage.setItem('qingji-offline-consent', 'yes');
    else localStorage.removeItem('qingji-offline-consent');
}
