'use client';
import { appFetch as fetch } from '../../lib/browser-api';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { BookManager } from './BookSwitcher';
import { bookURL, DEFAULT_BOOK_ID, validBookId, type Book } from '../../lib/books';
import { emptyBookDrafts, type BookDrafts } from '../../lib/book-drafts';
export type WorkspaceProps = {
    book: Book; books: Book[]; owner: string; booksBusy: boolean; initialDrafts: BookDrafts;
    onExample: (drafts: BookDrafts) => void; onSwitch: (id: string, drafts: BookDrafts) => void; onManage: (drafts: BookDrafts) => void;
};
const preferenceKey = (owner: string) => 'qingji-active-book-v1:' + owner;
function remember(owner: string, id: string) { try { localStorage.setItem(preferenceKey(owner), id); } catch { /* Switching still works without storage. */ } }
function preferred(owner: string) { try { return localStorage.getItem(preferenceKey(owner)) || DEFAULT_BOOK_ID; } catch { return DEFAULT_BOOK_ID; } }
async function fetchCatalog() {
    const r = await fetch('/api/books');
    if (!r.ok) throw Object.assign(Error(r.status === 401 ? '无法打开本地账本' : '无法读取账本列表，请重试'), { auth: r.status === 401 || r.status === 403 });
    const data = await r.json() as { owner: string; books: Book[] };
    if (!data.owner || !Array.isArray(data.books) || !data.books.length || data.books.some(b => !validBookId(b.id) || typeof b.name !== 'string')) throw Error('账本列表无效，请刷新重试');
    return data;
}
function startingBook(data: {owner:string; books:Book[]}) {
    const wanted = preferred(data.owner);
    return data.books.some(b => b.id === wanted) ? wanted : data.books[0].id;
}
export function BooksApp({ Workspace }: { Workspace: ComponentType<WorkspaceProps> }) {
    const [catalog, setCatalog] = useState<{ owner: string; books: Book[] } | null>(null), [selected, setSelected] = useState('');
    const [manager, setManager] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [name, setName] = useState(''), [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
    const [drafts, setDrafts] = useState(() => new Map<string, BookDrafts>());
    const request = useRef(0), writing = useRef(false);
    const draftKey = (id: string) => catalog!.owner + '/' + id;
    async function refresh() {
        const current = ++request.current;
        try {
            const data = await fetchCatalog();
            if (current !== request.current) return;
            setCatalog(data);
            setSelected(previous => {
                const wanted = catalog?.owner === data.owner ? previous || preferred(data.owner) : preferred(data.owner);
                return data.books.some(b => b.id === wanted) ? wanted : data.books[0].id;
            });
            setError('');
        } catch (e) {
            if (current !== request.current) return;
            setError((e as Error).message);
        }
    }
    useEffect(() => {
        let active = true;
        fetchCatalog().then(data => {
            if (!active) return;
            setCatalog(data); setSelected(startingBook(data)); setError('');
        }).catch(e => { if (active) setError((e as Error).message); });
        return () => { active = false; };
    }, []);
    function storeDraft(id: string, state: BookDrafts) { setDrafts(previous => new Map(previous).set(draftKey(id), state)); }
    function choose(id: string) {
        if (!catalog?.books.some(b => b.id === id) || writing.current) return;
        remember(catalog.owner, id); setSelected(id); setManager(false); setEditing(null); setError('');
    }
    async function mutate(rename = false, example = false) {
        if (writing.current || !catalog) return;
        writing.current = true; request.current++; setBusy(true); setError('');
        try {
            let exampleName = '示例账本（虚构数据）';
            for (let n = 2; catalog.books.some(b => b.name === exampleName); n++) exampleName = '示例账本（虚构数据）' + n;
            const r = await fetch(rename ? bookURL('/api/books', editing!.id) : '/api/books', { method: rename ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: rename ? editing!.name : example ? exampleName : name, example }) });
            const data = await r.json() as { book?: Book; books: Book[]; error?: string };
            if (!r.ok) throw Error(data.error || '无法保存账本');
            setCatalog({ ...catalog, books: data.books });
            if (!rename && data.book) { remember(catalog.owner, data.book.id); setSelected(data.book.id); setName(''); setManager(false); }
            setEditing(null);
        } catch (e) { setError((e as Error).message); if (example) setManager(true); }
        finally { writing.current = false; setBusy(false); }
    }
    const book = catalog?.books.find(b => b.id === selected);
    if (!catalog || !book) return <div className="books-bootstrap"><h1>轻记 · 我的账本</h1><p role="status">{error || '正在读取账本…'}</p>{error && <div className="button-row"><button className="primary" onClick={() => { void refresh(); }}>重新读取</button><button className="secondary" onClick={() => window.location.reload()}>刷新页面</button></div>}</div>;
    return <><Workspace key={catalog.owner + '/' + book.id} owner={catalog.owner} book={book} books={catalog.books} booksBusy={busy} initialDrafts={drafts.get(draftKey(book.id)) || emptyBookDrafts()} onExample={state => { storeDraft(book.id, state); void mutate(false, true); }} onSwitch={(id, state) => { storeDraft(book.id, state); choose(id); }} onManage={state => { storeDraft(book.id, state); setError(''); setManager(true); }}/>
        {manager && <BookManager books={catalog.books} selected={book.id} busy={busy} error={error} name={name} setName={setName} editing={editing} setEditing={setEditing} onCreate={() => { void mutate(); }} onRename={() => { void mutate(true); }} onSwitch={choose} onClose={() => { setManager(false); setEditing(null); setError(''); }} onRefresh={() => { void refresh(); }}/>}</>;
}
