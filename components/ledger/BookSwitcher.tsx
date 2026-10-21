'use client';
import { BookOpen, Settings } from 'lucide-react';
import type { Book } from '../../lib/books';
export function BookSwitcher({ book, books, disabled, onSwitch, onManage }: { book: Book; books: Book[]; disabled: boolean; onSwitch: (id: string) => void; onManage: () => void }) {
    return <div className="book-toolbar"><label><BookOpen size={17}/><span>当前账本</span><select aria-label="切换账本" value={book.id} disabled={disabled} onChange={e => onSwitch(e.target.value)}>{books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="secondary" disabled={disabled} onClick={onManage}><Settings size={15}/>管理账本</button></div>;
}
export function BookManager({ books, selected, busy, error, name, setName, editing, setEditing, onCreate, onRename, onSwitch, onClose, onRefresh }: {
    books: Book[]; selected: string; busy: boolean; error: string; name: string; setName: (s: string) => void;
    editing: { id: string; name: string } | null; setEditing: (v: { id: string; name: string } | null) => void;
    onCreate: () => void; onRename: () => void; onSwitch: (id: string) => void; onClose: () => void; onRefresh: () => void;
}) {
    return <div className="overlay"><section className="dialog book-manager" role="dialog" aria-modal="true" aria-label="管理账本"><div className="section-heading"><h2>管理账本 · {books.length} 个</h2><button className="text-button" disabled={busy} onClick={onClose}>关闭</button></div><p className="muted">每个账本在此浏览器中单独保存账户、流水、预算、证券和数字资产。切换时，当前待审核记录会留在原账本。</p>
        <form className="book-create" onSubmit={e => { e.preventDefault(); onCreate(); }}><label>新账本名称<input autoFocus required maxLength={40} value={name} disabled={busy} placeholder="如：家庭账本、旅行账本" onChange={e => setName(e.target.value)}/></label><button className="primary" disabled={busy || !name.trim()}>新建空白账本</button></form>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="book-list">{books.map(b => <div className="book-row" key={b.id}>{editing?.id === b.id ? <form className="book-rename" onSubmit={e => { e.preventDefault(); onRename(); }}><label>账本名称<input required maxLength={40} value={editing.name} disabled={busy} onChange={e => setEditing({ id: b.id, name: e.target.value })}/></label><button className="secondary" disabled={busy}>保存名称</button><button type="button" className="text-button" disabled={busy} onClick={() => setEditing(null)}>取消</button></form> : <><div><b>{b.name}</b>{b.id === selected && <small>当前使用</small>}</div><div className="button-row"><button className="text-button" disabled={busy} onClick={() => setEditing({ id: b.id, name: b.name })}>重命名</button>{b.id !== selected && <button className="secondary" disabled={busy} aria-label={`切换到${b.name}`} onClick={() => onSwitch(b.id)}>切换</button>}</div></>}</div>)}</div>
        <div className="dialog-bottom"><button className="text-button" disabled={busy} onClick={onRefresh}>刷新账本列表</button><button className="secondary" disabled={busy} onClick={onClose}>完成</button></div>
    </section></div>;
}
