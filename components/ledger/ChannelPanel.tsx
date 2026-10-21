'use client';
import { isHKAccount } from '../../lib/hk-securities';
import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { newId } from '../../lib/ids';
import { channelDefault, channelUsage, paymentChannels, removePaymentChannel, savePaymentChannel, type PaymentChannel } from '../../lib/channels';
import type { PanelProps } from './FinancePanels';
export function ChannelPanel({ ledger, save, busy }: PanelProps) {
    const [edit, setEdit] = useState<PaymentChannel | null>(null), [account, setAccount] = useState(''), [error, setError] = useState('');
    const channels = paymentChannels(ledger);
    function start(channel: PaymentChannel) { setEdit({ ...channel, aliases: [...channel.aliases] }); setAccount(channelDefault(ledger, channel.name)); setError(''); }
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!edit)
            return;
        setError('');
        try {
            const old = channels.find(c => c.id === edit.id);
            if (old && old.name !== edit.name.trim() && !confirm('改名会同步更新历史流水、模板、商户规则及导入回滚记录中的渠道名称，金额和资金账户保持原值。旧名称保留为识别别名。确认改名？'))
                return;
            if (await save(savePaymentChannel(ledger, edit, account), '已保存支付渠道“' + edit.name.trim() + '”'))
                setEdit(null);
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    return <section className="panel"><div className="section-heading"><h2>支付渠道管理</h2><button className="text-button" disabled={busy} onClick={() => start({ id: newId(), name: '', active: true, aliases: [] })}><Plus size={14}/>新增渠道</button></div><p className="muted">渠道记录付款方式，资金账户记录实际扣款位置。默认账户用于文字识别，手动记账可另行选择。停用渠道保留历史，新增流水不再提供此选项。</p><div className="channel-list">{channels.map(c => {
            const usage = channelUsage(ledger, c.name);
            const a = ledger.accounts.find(a => a.id === channelDefault(ledger, c.name));
            return <article className={'channel-row ' + (c.active ? '' : 'disabled-card')} key={c.id}><div><b>{c.name}<span className="channel-state">{c.active ? '启用中' : '已停用'}</span></b><small>默认：{a?.name || '未指定'}{a?.active === false ? '（账户已停用，请调整）' : ''} · {usage.transactions} 笔流水 · {usage.templates} 个模板</small>{!!c.aliases.length && <small>识别别名：{c.aliases.join('、')}</small>}</div><div className="button-row"><button className="text-button" disabled={busy} aria-label={'编辑渠道 ' + c.name} onClick={() => start(c)}><Pencil size={14}/>编辑</button><button className="text-button" disabled={busy} onClick={async () => {
                    try {
                        setError('');
                        await save(savePaymentChannel(ledger, { ...c, active: !c.active }, channelDefault(ledger, c.name)), (c.active ? '已停用' : '已启用') + '支付渠道“' + c.name + '”');
                    }
                    catch (e) {
                        setError((e as Error).message);
                    }
                }}>{c.active ? '停用' : '启用'}</button><button className="text-button channel-delete" disabled={busy || usage.total > 0} title={usage.total ? '已有引用，请停用以保留历史' : '删除未使用的渠道'} onClick={async () => {
                    if (!confirm('删除未使用的渠道“' + c.name + '”？可通过操作历史恢复。'))
                        return;
                    try {
                        if (await save(removePaymentChannel(ledger, c.id), '已删除未使用的支付渠道“' + c.name + '”')) {
                            if (edit?.id === c.id)
                                setEdit(null);
                        }
                    }
                    catch (e) {
                        setError((e as Error).message);
                    }
                }}>删除</button></div></article>;
        })}</div>{!channels.length && <p className="muted">尚无支付渠道，可点击“新增渠道”。</p>}{edit && <form className="inline-editor" onSubmit={submit}><h3>{channels.some(c => c.id === edit.id) ? '编辑支付渠道' : '新增支付渠道'}</h3><div className="form-grid"><label>渠道名称<input required maxLength={100} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="如：云闪付、Apple Pay"/></label><label>默认资金账户<select required value={account} onChange={e => setAccount(e.target.value)}>{ledger.accounts.filter(a => !isHKAccount(ledger, a.id) && (a.active !== false || a.id === account)).map(a => <option key={a.id} value={a.id}>{a.name}{a.active === false ? '（已停用）' : ''}</option>)}</select></label></div><label>识别别名（可选，最多 10 个）<input value={edit.aliases.join('，')} onChange={e => setEdit({ ...edit, aliases: e.target.value.split(/[,，、]/) })} placeholder="例如：银联闪付、UnionPay"/></label><label className="checkbox-label"><input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })}/>启用此渠道</label><p className="muted">改名同步更新历史记录中的渠道标签；默认账户的修改只用于以后识别，不会改变历史扣款账户。已有引用的渠道可停用，不能直接删除。</p><div className="button-row"><button className="primary" disabled={busy}>保存渠道</button><button type="button" className="secondary" onClick={() => { setEdit(null); setError(''); }}>取消</button></div></form>}{error && <div className="error" role="alert">{error}</div>}</section>;
}
