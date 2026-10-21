'use client';
import { Check, X } from 'lucide-react';
import { money, types, type Tx } from '../../lib/ledger';

type Props = {
    rows: Tx[]; warnings: string[]; reviewed: Set<string>; busy: boolean;
    account: (id: string) => string; category: (id: string) => string;
    onEdit: (row: Tx) => void; onReviewed: (id: string, checked: boolean) => void;
    onRemove: (id: string) => void; onClear: () => void; onApprove: () => void;
};
export function DraftReviewQueue({ rows, warnings, reviewed, busy, account, category, onEdit, onReviewed, onRemove, onClear, onApprove }: Props) {
    const checked = rows.filter(t => reviewed.has(t.id)).length;
    return <section className="drafts draft-review" aria-label="累积待审核列表">
        <div className="section-heading"><h3>待审核列表 · {rows.length} 笔</h3><span role="status">已核对 {checked} / {rows.length} 笔</span></div>
        <p className="muted">继续说或输入下一笔，识别后会追加到这里。点击每笔可修改，勾选可记录核对进度；最后统一审核入账列表内全部记录。</p>
        {warnings.map(w => <p key={w} className="warning">{w}</p>)}
        <ol className="draft-review-list">{rows.map((t, i) => <li className={reviewed.has(t.id) ? 'reviewed' : ''} key={t.id}>
            <label className="draft-review-check"><input type="checkbox" aria-label={`已核对第 ${i + 1} 笔 ${t.merchant}`} checked={reviewed.has(t.id)} disabled={busy} onChange={e => onReviewed(t.id, e.target.checked)}/><span>{i + 1}</span></label>
            <button className="draft" disabled={busy} aria-label={`核对第 ${i + 1} 笔 ${t.merchant}`} onClick={() => onEdit(t)}><span>{types[t.type]} · {t.merchant}<small>{t.date} · {account(t.account)}{t.to ? ' → ' + account(t.to) : ''} · {category(t.category)}</small></span><b>{t.currency === 'HKD' ? 'HK$' : '¥'}{money(t.amount)}{t.toAmount !== undefined && <small>→ {t.toCurrency === 'HKD' ? 'HK$' : '¥'}{money(t.toAmount)}</small>}<small>{reviewed.has(t.id) ? '已核对' : '待核对'}</small></b></button>
            <button className="icon-button" disabled={busy} aria-label={`移除第 ${i + 1} 笔 ${t.merchant}`} onClick={() => onRemove(t.id)}><X size={16}/></button>
        </li>)}</ol>
        <div className="draft-review-actions"><button className="primary" disabled={busy} onClick={onApprove}><Check size={16}/>一键审核通过并保存 {rows.length} 笔</button><button className="text-button" disabled={busy} onClick={onClear}>清空待审核列表</button></div>
    </section>;
}
