'use client';
import { useState } from 'react';
import { mergeLedgers } from '../../lib/merge';
import type { Ledger } from '../../lib/ledger';
export type MergeState = {
    base: Ledger;
    local: Ledger;
    remote: Ledger;
    revision: number;
};
export function ConflictDialog({ state, busy, error, onApply, onExport }: {
    state: MergeState;
    busy: boolean;
    error: string;
    onApply: (l: Ledger, revision: number) => void;
    onExport: () => void;
}) { const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({}); const all = mergeLedgers(state.base, state.local, state.remote).conflicts; const result = mergeLedgers(state.base, state.local, state.remote, choices); return <div className="overlay"><section className="dialog conflict-dialog" role="dialog" aria-modal="true" aria-label="合并账本编辑"><h2>另一标签页与本机都有新编辑</h2><p className="muted">未冲突的修改已合并。请逐项选择冲突字段的版本，保存前会再次校验账务一致性。</p><div className="button-row"><button className="secondary" onClick={() => setChoices(Object.fromEntries(all.map(c => [c.path, 'local'])))}>冲突项全部用本机</button><button className="secondary" onClick={() => setChoices(Object.fromEntries(all.map(c => [c.path, 'remote'])))}>冲突项全部用另一标签页</button></div>{all.map(c => <div className="conflict-row" key={c.path}><b>{c.path}</b><label><input type="radio" name={c.path} checked={choices[c.path] === 'local'} onChange={() => setChoices({ ...choices, [c.path]: 'local' })}/>本机：<code>{JSON.stringify(c.local) ?? '已移除'}</code></label><label><input type="radio" name={c.path} checked={choices[c.path] === 'remote'} onChange={() => setChoices({ ...choices, [c.path]: 'remote' })}/>另一标签页：<code>{JSON.stringify(c.remote) ?? '已移除'}</code></label></div>)}{!all.length && <p className="success-note">两端修改互不冲突，可以合并。</p>}<details className="import-actions"><summary>无法合并时，选择整本恢复</summary><p className="muted">先下载本机副本。整本恢复会使用一端的全部数据，另一端的修改可从历史或本机副本找回。</p><button className="secondary" disabled={busy} onClick={() => { if (confirm('确认整本采用另一标签页账本？本机未同步修改不会合并，请先下载本机副本。'))
    onApply(state.remote, state.revision); }}>整本采用另一标签页</button><button className="secondary" disabled={busy} onClick={() => { if (confirm('确认整本采用本机账本？当前另一标签页版本仍保留在历史中。'))
    onApply(state.local, state.revision); }}>整本采用本机</button></details>{error && <p className="error">{error}</p>}<div className="dialog-bottom"><button className="secondary" onClick={onExport}>下载本机副本</button><button className="primary" disabled={busy || result.conflicts.length > 0} onClick={() => onApply(result.ledger, state.revision)}>保存合并结果</button></div></section></div>; }
