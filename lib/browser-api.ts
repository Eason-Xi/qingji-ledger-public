import { bookName, DEFAULT_BOOK_ID, DEFAULT_BOOK_NAME, validBookId, type Book } from './books.ts';
import { initial, validate, type Ledger } from './ledger.ts';
import { createMarketPriceService } from './market-prices.ts';
import { createHKRateService } from './hk-rates.ts';
import { sampleLedger } from './sample-ledger.ts';
import { newId } from './ids.ts';
import { emptyDigital } from './digital.ts';
import { addDefaultMarketCoins, MARKET_DEFAULTS_VERSION } from './market-watchlist.ts';

type StoredLedger = { bookId: string; ledger: Ledger; revision: number; updated: string };
type Snapshot = StoredLedger & { id: string; action: string; created: string };
class LocalError extends Error { readonly status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const freshLedger = (source: Ledger = initial): Ledger => {
    const ledger = structuredClone(source);
    return { ...ledger, digital: addDefaultMarketCoins(ledger.digital || emptyDigital()) };
};

async function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, operation: (store: (name: string) => IDBObjectStore) => Promise<T>) {
    const tx = db.transaction(['books', 'ledgers', 'history', 'meta'], mode);
    const completed = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || Error('保存已取消，原有账本保持不变')); tx.onerror = () => reject(tx.error); });
    try { const value = await operation(name => tx.objectStore(name)); await completed; return value; }
    catch (error) { try { tx.abort(); } catch { /* Already finished. */ } await completed.catch(() => {}); throw error; }
}

/** All financial records stay inside this browser's IndexedDB, including version snapshots. */
export function createBrowserAPI(factory: IDBFactory | undefined = globalThis.indexedDB, databaseName = 'qingji-public-ledger-v1', fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
    let opening: Promise<IDBDatabase> | undefined;
    async function database() {
        if (!factory) throw new LocalError('浏览器未提供本地数据库，请换用正常浏览模式并允许网站存储', 503);
        opening ??= new Promise<IDBDatabase>((resolve, reject) => {
            const request = factory.open(databaseName, 2);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('ledgers')) db.createObjectStore('ledgers', { keyPath: 'bookId' });
                if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
                const history = db.objectStoreNames.contains('history') ? request.transaction!.objectStore('history') : db.createObjectStore('history', { keyPath: ['bookId', 'id'] });
                if (!history.indexNames.contains('book')) history.createIndex('book', 'bookId');
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new LocalError('请关闭其他旧版账本标签页后重试', 503));
            request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
        }).then(async db => {
            await transaction(db, 'readwrite', async store => {
                const now = new Date().toISOString();
                if (!await requestValue(store('meta').get('owner'))) store('meta').put({ id: 'owner', value: 'browser-' + newId() });
                if (!await requestValue(store('books').get(DEFAULT_BOOK_ID))) {
                    store('books').put({ id: DEFAULT_BOOK_ID, name: DEFAULT_BOOK_NAME, created: now, updated: now });
                    store('ledgers').put({ bookId: DEFAULT_BOOK_ID, ledger: freshLedger(), revision: 0, updated: now });
                }
                // One atomic migration per book; a later user removal or backup restore stays intact.
                const ledgers = await requestValue(store('ledgers').getAll()) as StoredLedger[];
                for (const current of ledgers) {
                    if (current.ledger.digital?.marketDefaultsVersion === MARKET_DEFAULTS_VERSION) continue;
                    const ledger = { ...current.ledger, digital: addDefaultMarketCoins(current.ledger.digital || emptyDigital()) };
                    validate(ledger);
                    const history = await requestValue(store('history').index('book').getAll(current.bookId)) as Snapshot[];
                    if (!history.some(row => row.revision === current.revision)) store('history').put({ ...current, id: newId(), created: current.updated, action: '添加默认行情前的账本' });
                    const next: StoredLedger = { ...current, ledger, revision: current.revision + 1, updated: now };
                    store('ledgers').put(next);
                    store('history').put({ ...next, id: newId(), created: now, action: '已补齐主流币行情' });
                    const snapshots = await requestValue(store('history').index('book').getAll(current.bookId)) as Snapshot[];
                    for (const old of snapshots.sort((a, b) => b.revision - a.revision).slice(20)) store('history').delete([current.bookId, old.id]);
                }
            });
            return db;
        });
        return opening;
    }
    // Only fixed public price URLs are requested; account names, balances and transactions are never sent.
    const publicFetch: typeof fetch = (input, init) => {
        const headers = new Headers(init?.headers); headers.delete('User-Agent');
        return fetcher(input, { ...init, headers, credentials: 'omit', referrerPolicy: 'no-referrer' });
    };
    const prices = createMarketPriceService(publicFetch), rates = createHKRateService(publicFetch);
    async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'https://qingji.invalid');
        const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        try {
            if (url.pathname === '/api/prices' && method === 'GET') return reply(await prices(JSON.parse(url.searchParams.get('coins') || '[]')));
            if (url.pathname === '/api/hk-rates' && method === 'GET') return reply(await rates());
            if (url.pathname.startsWith('/api/ai/')) return reply({ error: '公开版使用本地规则解析，不接收或保存服务商密钥', config: null, storageReady: false, localOnly: true }, method === 'GET' ? 200 : 405);
            if (!['/api/books', '/api/ledger', '/api/history'].includes(url.pathname)) return reply({ error: '此操作不属于本地账本' }, 404);
            const bookId = url.searchParams.get('book') || DEFAULT_BOOK_ID;
            if (!validBookId(bookId)) throw new LocalError('账本标识无效');
            const raw = typeof init?.body === 'string' ? init.body : '';
            if (new TextEncoder().encode(raw).byteLength > 8100000) throw new LocalError('单个账本超过8 MB，请先备份并拆分历史数据', 413);
            const body = raw ? JSON.parse(raw) : {};
            const db = await database();
            return await transaction(db, method === 'GET' ? 'readonly' : 'readwrite', async store => {
                const owner = (await requestValue(store('meta').get('owner'))).value as string;
                const list = async () => (await requestValue(store('books').getAll()) as Book[]).sort((a, b) => a.id === DEFAULT_BOOK_ID ? -1 : b.id === DEFAULT_BOOK_ID ? 1 : a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
                if (url.pathname === '/api/books') {
                    if (method === 'GET') return reply({ books: await list(), owner });
                    if (method !== 'POST' && method !== 'PATCH') return reply({ error: '不支持此操作' }, 405);
                    const name = bookName(body.name), books = await list();
                    if (books.some(b => b.name === name && (method === 'POST' || b.id !== bookId))) throw new LocalError('已有同名账本，请换一个名称', 409);
                    const now = new Date().toISOString();
                    let book: Book;
                    if (method === 'POST') {
                        if (books.length >= 50) throw new LocalError('最多可创建50个账本');
                        book = { id: newId(), name, created: now, updated: now };
                        store('ledgers').put({ bookId: book.id, ledger: freshLedger(body.example === true ? sampleLedger() : initial), revision: 0, updated: now });
                    } else {
                        const previous = books.find(b => b.id === bookId);
                        if (!previous) throw new LocalError('账本不存在', 404);
                        book = { ...previous, name, updated: now };
                    }
                    store('books').put(book);
                    return reply({ book, books: await list() }, method === 'POST' ? 201 : 200);
                }
                if (!await requestValue(store('books').get(bookId))) throw new LocalError('账本不存在', 404);
                const current = await requestValue(store('ledgers').get(bookId)) as StoredLedger;
                if (url.pathname === '/api/ledger') {
                    if (method === 'GET') return reply(url.searchParams.get('revisionOnly') === '1' ? { revision: current.revision, owner, bookId } : { ...current, owner });
                    if (method !== 'PUT') return reply({ error: '不支持此操作' }, 405);
                    if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new LocalError('版本无效');
                    validate(body.ledger);
                    if (body.revision !== current.revision) return reply({ ...current, owner, conflict: true, error: '另一个标签页已更新账本，请核对合并后重试' }, 409);
                    const ledger: Ledger = structuredClone(body.ledger);
                    // Older backups have no initialization marker; restoring their choices must not reseed them.
                    ledger.digital = { ...(ledger.digital || emptyDigital()), marketDefaultsVersion: MARKET_DEFAULTS_VERSION };
                    ledger.preferences = { ...ledger.preferences, cloudAI: false };
                    const next: StoredLedger = { bookId, ledger, revision: current.revision + 1, updated: new Date().toISOString() };
                    store('ledgers').put(next);
                    store('history').put({ ...next, id: newId(), created: next.updated, action: String(body.action || '更新账本').slice(0, 200) });
                    const history = await requestValue(store('history').index('book').getAll(bookId)) as Snapshot[];
                    for (const old of history.sort((a, b) => b.revision - a.revision).slice(20)) store('history').delete([bookId, old.id]);
                    return reply({ bookId, revision: next.revision });
                }
                if (method !== 'GET') return reply({ error: '不支持此操作' }, 405);
                const id = url.searchParams.get('id');
                if (id) {
                    const snapshot = await requestValue(store('history').get([bookId, id]));
                    return snapshot ? reply(snapshot) : reply({ error: '找不到此版本' }, 404);
                }
                const snapshots = await requestValue(store('history').index('book').getAll(bookId)) as Snapshot[];
                return reply({ bookId, history: snapshots.sort((a, b) => b.revision - a.revision).map(({ id, revision, action, created }) => ({ id, revision, action, created })) });
            });
        } catch (error) {
            const storage = error instanceof Error && ['QuotaExceededError', 'SecurityError', 'InvalidStateError', 'UnknownError'].includes(error.name);
            return reply({ error: storage ? '浏览器存储不可用或空间不足，保存未完成，请立即导出备份' : error instanceof Error ? error.message : '本地账本操作失败' }, error instanceof LocalError ? error.status : storage || url.pathname === '/api/prices' || url.pathname === '/api/hk-rates' ? 503 : 400);
        }
    }
    return { request: handle, close: async () => { (await opening)?.close(); opening = undefined; } };
}
const localAPI = createBrowserAPI();
export const appFetch: typeof fetch = (input, init) => localAPI.request(input, init);
