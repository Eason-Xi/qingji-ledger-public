export const DEFAULT_BOOK_ID = 'default';
export const DEFAULT_BOOK_NAME = '个人账本';
export type Book = { id: string; name: string; created: string; updated: string };
export function validBookId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id); }
export function bookName(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(value)) throw Error('账本名称需为 1 至 40 个字，不能包含换行');
    return value.trim();
}
export function bookURL(path: string, id = DEFAULT_BOOK_ID) {
    const [pathname, query] = path.split('?');
    const params = new URLSearchParams(query);
    params.set('book', id);
    return pathname + '?' + params;
}
