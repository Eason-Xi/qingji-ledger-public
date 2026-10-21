'use client';
import { appFetch as fetch } from '../../lib/browser-api';
import { useEffect, useState } from 'react';
import { validate, type Ledger } from '../../lib/ledger';
import { bookURL, type Book } from '../../lib/books';
import { fileDownload, type PanelProps } from './FinancePanels';
export function HistoryPanel({ ledger: l, save, busy, book }: PanelProps & { book: Book }) {
    const [history, setHistory] = useState<{
        id: string;
        revision: number;
        action: string;
        created: string;
    }[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false), [restore, setRestore] = useState<{
        ledger: Ledger;
        action: string;
        revision: number;
    } | null>(null);
    async function load() { setLoading(true); try {
        const r = await fetch(bookURL('/api/history', book.id));
        const d = await r.json() as {
            history: typeof history;
            error: string;
        };
        if (!r.ok)
            throw Error(d.error);
        setHistory(d.history);
        setError('');
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setLoading(false);
    } }
    useEffect(() => { load(); }, []);
    async function version(id: string, download = false) { try {
        const r = await fetch(bookURL('/api/history?id=' + encodeURIComponent(id), book.id));
        const d = await r.json() as {
            ledger: Ledger;
            action: string;
            revision: number;
            error: string;
        };
        if (!r.ok)
            throw Error(d.error);
        validate(d.ledger);
        if (download)
            fileDownload('轻记_' + book.name + '_版本_' + d.revision + '.json', JSON.stringify({ version: 4, book: { id: book.id, name: book.name }, exported: new Date().toISOString(), ledger: d.ledger }, null, 2));
        else
            setRestore(d);
    }
    catch (e) {
        setError((e as Error).message);
    } }
    return <section className="panel"><div className="section-heading"><h2>操作历史与自动备份</h2><button className="text-button" disabled={loading} onClick={load}>{loading ? '读取中…' : '刷新历史'}</button></div><p className="muted">仅展示当前账本的历史。每次成功保存都会生成本机版本快照。恢复会新建一个版本，并保留当前版本，便于再次回退。此处展示最近 20 次保存。</p>{error && <p className="error">{error}</p>}{history.map(h => <div className="manage-row" key={h.id}><div><b>v{h.revision} · {h.action}</b><small>{new Date(h.created).toLocaleString('zh-CN')}</small></div><button className="text-button" onClick={() => version(h.id, true)}>下载</button><button className="text-button" disabled={busy} onClick={() => version(h.id)}>恢复</button></div>)}{!history.length && !loading && <p className="muted">首次保存后显示历史版本。</p>}{restore && <div className="inline-editor"><h3>恢复版本 v{restore.revision}</h3><p className="muted">{restore.action} · {restore.ledger.transactions.length} 笔流水 · {restore.ledger.accounts.length} 个账户</p><div className="button-row"><button className="secondary" onClick={() => fileDownload('轻记_' + book.name + '_恢复前备份.json', JSON.stringify({ version: 4, book: { id: book.id, name: book.name }, exported: new Date().toISOString(), ledger: l }, null, 2))}>下载恢复前备份</button><button className="primary" disabled={busy} onClick={async () => { if (confirm('确认将当前账本恢复到所选版本？当前版本会保留在历史中，其他账本不受影响。') && await save(restore.ledger, '恢复到历史版本 v' + restore.revision)) {
        setRestore(null);
        load();
    } }}>确认恢复</button><button className="secondary" onClick={() => setRestore(null)}>取消</button></div></div>}</section>;
}
