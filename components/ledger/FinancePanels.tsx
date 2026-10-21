'use client';
import { appFetch as fetch } from '../../lib/browser-api';
import { channelDefault, channelOptions } from '../../lib/channels';
import { useState } from 'react';
import { Plus, Pencil, ArrowUp, ArrowDown, CalendarDays } from 'lucide-react';
import { newId } from '../../lib/ids';
import { accountRegion, hasHKDBalance, hasHKDSettings } from '../../lib/account-currency';
import { isHKAccount } from '../../lib/hk-securities';
import { moduleEnabled } from '../../lib/optional-modules';
import { updateSecuritiesValue } from '../../lib/securities';
import { cents, money, balances, nativeBalances, today, validate, accountType, accountTypeNames, type Ledger, type Account, type Tx } from '../../lib/ledger';
import { budgetFor, categorySpend, categoryDescendants, creditStatement, dueOccurrences, generateRecurring, mergeCategory, calendarText, prefs } from '../../lib/features';
import { cardNames, type RecurringRule, type Category, type MerchantRule } from '../../lib/extensions';
export type PanelProps = {
    ledger: Ledger;
    save: (l: Ledger, action: string) => Promise<boolean>;
    busy: boolean;
    month: string;
    open: (t?: Tx) => void;
    onSecurities?: () => void;
};
export const fileDownload = (name: string, body: string, type = 'application/json') => { const a = document.createElement('a'); const u = URL.createObjectURL(new Blob([body], { type })); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
export function AccountPanel({ ledger: l, save, busy, onSecurities }: PanelProps) {
    const [edit, setEdit] = useState<Account | null>(null), [error, setError] = useState('');
    const [rateLoading, setRateLoading] = useState(false);
    const native = nativeBalances(l);
    const [valuation, setValuation] = useState<string | null>(null);
    const bal = balances(l);
    const securities = l.accounts.filter(a => accountType(a) === 'securities');
    const securitiesEnabled = moduleEnabled(l, 'securities');
    function begin(account: Account) {
        if (isHKAccount(l, account.id)) { if (securitiesEnabled) onSecurities?.(); return; }
        setEdit({ ...account, region: accountRegion(account) });
        setValuation(null);
        setError('');
    }
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!edit || busy || rateLoading) return;
        setError('');
        try {
            const f = new FormData(e.currentTarget);
            const amount = String(f.get('opening') || '0');
            if (!/^-?\d+(\.\d{1,2})?$/.test(amount))
                throw Error('期初金额最多两位小数');
            const hkBank = hasHKDBalance(edit);
            const openingHKD = String(f.get('openingHKD') || '0');
            if (hkBank && !/^-?\d+(\.\d{1,2})?$/.test(openingHKD)) throw Error('港币期初金额最多两位小数');
            const a: Account = {
                ...edit, name: String(f.get('name')).trim(),
                opening: Math.round(Number(amount) * 100),
                region: edit.kind === 'asset' && !edit.subtype ? edit.region : undefined,
                openingHKD: hkBank ? Math.round(Number(openingHKD) * 100) : undefined,
                hkdToCNY: hkBank ? edit.hkdToCNY || undefined : undefined,
                hkdRateAt: hkBank && edit.hkdToCNY ? edit.hkdRateAt || new Date().toISOString() : undefined,
                creditLimit: edit.kind === 'debt' && f.get('limit') ? cents(String(f.get('limit'))) : undefined,
                billDay: edit.kind === 'debt' && f.get('bill') ? Number(f.get('bill')) : undefined,
                payDay: edit.kind === 'debt' && f.get('pay') ? Number(f.get('pay')) : undefined,
                active: f.get('active') === 'on',
            };
            const next = { ...l, accounts: l.accounts.some(x => x.id === a.id) ? l.accounts.map(x => x.id === a.id ? a : x) : [...l.accounts, a] };
            validate(next);
            if (await save(next, '已保存账户设置')) setEdit(null);
        } catch (e) { setError((e as Error).message); }
    }
    async function submitValuation(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!valuation || busy) return;
        setError('');
        try {
            const f = new FormData(e.currentTarget);
            const next = updateSecuritiesValue(l, valuation, String(f.get('value')), String(f.get('date')));
            if (next === l || await save(next, '已更新证券账户市值')) setValuation(null);
        } catch (e) { setError((e as Error).message); }
    }
    return <section className="panel">
        <div className="section-heading account-heading">
            <h2>账户管理</h2>
            <div className="button-row">
                {securitiesEnabled && <button className="text-button" disabled={busy} onClick={() => onSecurities ? onSecurities() : begin({ id: newId(), name: '', kind: 'asset', subtype: 'securities', opening: 0, active: true })}><Plus size={14}/>港股账户与明细</button>}
                <button className="text-button" disabled={busy} onClick={() => begin({ id: newId(), name: '', kind: 'asset', opening: 0, active: true })}><Plus size={14}/>新增账户</button>
            </div>
        </div>
        <p className="muted account-help">{securitiesEnabled && '港股账户在“港股证券”录入股票，银证转账统一在“记一笔 → 内部转账”操作。'}所有银行资金账户均可分别记录人民币和港币余额，转账币种不受账户地区限制；旧记录的人民币余额保持原样。</p>
        {securities.length > 0 && <p className="status-note">证券账户合计（含停用账户） <b>¥{money(securities.reduce((sum, a) => sum + bal[a.id], 0))}</b></p>}
        <div className="account-cards">{l.accounts.map(a => {
            const s = creditStatement(l, a), isSecurities = accountType(a) === 'securities';
            return <article className={'credit-card ' + (a.active === false ? 'disabled-card' : '')} key={a.id}>
                <div><b>{a.name}</b>{(!isHKAccount(l, a.id) || securitiesEnabled) && <button className="icon-button" disabled={busy} aria-label={'编辑 ' + a.name} onClick={() => begin(a)}><Pencil size={14}/></button>}</div>
                <span>{isHKAccount(l, a.id) ? '港股账户 · 折合人民币（CNY）' : isSecurities ? '证券账户 · 总资产（CNY）' : a.kind === 'debt' ? '账本应还' : hasHKDSettings(a) ? '资金账户 · 港币余额' : '账户余额'}{a.active === false ? ' · 已停用' : ''}</span>
                <strong>{hasHKDSettings(a) ? 'HK$' + money(native.HKD[a.id]) : '¥' + money(bal[a.id])}</strong>
                {hasHKDSettings(a) && <p className="muted">人民币余额 ¥{money(native.CNY[a.id])} · 折合人民币合计 ¥{money(bal[a.id])}{a.hkdToCNY ? ` · 1 HKD = ${a.hkdToCNY} CNY` : ' · 尚未设置港币折算汇率'}</p>}
                {isHKAccount(l, a.id) ? securitiesEnabled && <div className="import-actions"><button className="text-button" onClick={onSecurities}>管理港股持仓</button></div> : isSecurities && <div className="import-actions"><button className="text-button" aria-label={"更新市值 · " + a.name} disabled={busy || a.active === false} onClick={() => { setValuation(a.id); setEdit(null); setError(''); }}>更新市值</button></div>}
                {a.kind === 'debt' && a.creditLimit ? <p className="muted">额度 ¥{money(a.creditLimit)} · 可用估算 ¥{money(Math.max(0, a.creditLimit - Math.max(0, bal[a.id])))}</p> : null}
                {s ? <><div className="statement-row"><span>账期 {s.start} 至 {s.close}</span><b>账本本期应还 ¥{money(s.outstanding)}</b><span>未出账 ¥{money(s.unbilled)} · {s.overdue ? '已逾期' : '还款日'} {s.due}</span></div><p className="muted">按账本流水估算，请核对银行实际账单。</p></> : a.kind === 'debt' ? <p className="muted">编辑账户，填写账单日与还款日。</p> : null}
            </article>;
        })}</div>
        {edit && <form key={edit.id} className="inline-editor account-editor" onSubmit={submit}>
            <h3>{l.accounts.some(a => a.id === edit.id) ? '编辑账户' : accountType(edit) === 'securities' ? '新增证券账户' : '新账户'}</h3>
            <div className="form-grid">
                <label>名称<input name="name" autoFocus required defaultValue={edit.name} placeholder={accountType(edit) === 'securities' ? '如：我的证券账户、券商名称' : ''} maxLength={100} disabled={busy}/></label>
                <label>类型<select name="kind" value={accountType(edit)} disabled={busy} onChange={e => { const type = e.target.value; setEdit({ ...edit, kind: type === 'debt' ? 'debt' : 'asset', subtype: type === 'securities' ? 'securities' : undefined }); }}>{Object.entries(accountTypeNames).filter(([value]) => value !== 'securities' || securitiesEnabled || accountType(edit) === 'securities').map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
                <label>{accountType(edit) === 'securities' ? '期初总资产（人民币元）' : hasHKDBalance(edit) ? '期初人民币余额（保留原有人民币）' : '期初余额 / 期初负债'}<input name="opening" required type="number" step="0.01" defaultValue={edit.opening / 100} disabled={busy}/></label>
                {edit.kind === 'asset' && !edit.subtype && <label>账户地区<select value={accountRegion(edit)} disabled={busy} onChange={e => setEdit({ ...edit, region: e.target.value as 'mainland' | 'hongkong' })}><option value="mainland">内地</option><option value="hongkong">香港</option></select></label>}
                {hasHKDBalance(edit) && <><label>期初港币余额（HKD）<input name="openingHKD" type="number" step="0.01" required defaultValue={(edit.openingHKD || 0) / 100} disabled={busy}/></label><label>银行折算汇率：1 港币 = 人民币<input type="number" min="0.00000001" max="100" step="0.00000001" value={edit.hkdToCNY || ''} disabled={busy || rateLoading} onChange={e => setEdit({ ...edit, hkdToCNY: e.target.value, hkdRateAt: new Date().toISOString() })}/></label><div className="import-actions"><button type="button" className="secondary" disabled={busy || rateLoading} onClick={async () => { const id = edit.id; setRateLoading(true); setError(''); try { const r = await fetch('/api/hk-rates'); const data = await r.json() as { error?: string; hkdToCNY: string; at: string }; if (!r.ok) throw Error(data.error || '获取汇率失败'); setEdit(previous => previous?.id === id ? { ...previous, hkdToCNY: data.hkdToCNY, hkdRateAt: data.at } : previous); } catch (e) { setError((e as Error).message); } finally { setRateLoading(false); } }}>{rateLoading ? '获取中…' : '获取港币参考汇率'}</button></div></>}
                {edit.kind === 'debt' && <>
                    <label>信用额度（元）<input name="limit" type="number" step="0.01" min="0.01" defaultValue={edit.creditLimit ? edit.creditLimit / 100 : ''} disabled={busy}/></label>
                    <label>账单日（每月几号）<input name="bill" type="number" min="1" max="31" defaultValue={edit.billDay} disabled={busy}/></label>
                    <label>还款日（每月几号）<input name="pay" type="number" min="1" max="31" defaultValue={edit.payDay} disabled={busy}/></label>
                </>}
            </div>
            {accountType(edit) === 'securities' && <p className="muted">填写现金与股票、基金等持仓市值的合计；外币资产先折算成人民币。后续估值变化可点“更新市值”。</p>}
            <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={edit.active !== false} disabled={busy}/>启用此账户（停用仍保留历史）</label>
            {error && <p role="alert" className="error">{error}</p>}
            <div className="button-row import-actions"><button className="primary" disabled={busy || rateLoading}>保存账户</button><button type="button" className="secondary" disabled={busy} onClick={() => setEdit(null)}>取消</button></div>
        </form>}
        {valuation && <form key={valuation} className="inline-editor account-editor" onSubmit={submitValuation}>
            <h3>更新市值 · {l.accounts.find(a => a.id === valuation)?.name}</h3>
            <p className="muted">填写当前现金加持仓市值的合计。差额记为余额调整，可在流水中查看，不计入日常收支。</p>
            <div className="form-grid">
                <label>账户总资产（人民币元）<input name="value" autoFocus type="number" min="0" step="0.01" required defaultValue={(bal[valuation] / 100).toFixed(2)} disabled={busy}/></label>
                <label>估值日期<input name="date" type="date" required defaultValue={today()} disabled={busy}/></label>
            </div>
            {error && <p role="alert" className="error">{error}</p>}
            <div className="button-row import-actions"><button className="primary" disabled={busy}>保存市值</button><button type="button" className="secondary" disabled={busy} onClick={() => setValuation(null)}>取消</button></div>
        </form>}
    </section>;
}
export function CategoryPanel({ ledger: l, save, busy }: PanelProps) {
    const [edit, setEdit] = useState<Category | null>(null), [mergeFrom, setMergeFrom] = useState(''), [mergeTo, setMergeTo] = useState(''), [error, setError] = useState('');
    const sorted = [...l.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!edit)
            return;
        try {
            const f = new FormData(e.currentTarget);
            const c = { ...edit, name: String(f.get('name')).trim(), parent: String(f.get('parent') || '') || undefined, active: f.get('active') === 'on' };
            const next = { ...l, categories: l.categories.some(x => x.id === c.id) ? l.categories.map(x => x.id === c.id ? c : x) : [...l.categories, c] };
            validate(next);
            if (await save(next, '已更新分类'))
                setEdit(null);
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    function move(id: string, step: number) {
        const i = sorted.findIndex(c => c.id === id), j = i + step;
        if (j < 0 || j >= sorted.length)
            return;
        const arr = [...sorted];
        [arr[i], arr[j]] = [arr[j], arr[i]];
        save({ ...l, categories: arr.map((c, k) => ({ ...c, order: k })) }, '已调整分类排序');
    }
    return <section className="panel"><div className="section-heading"><h2>分类、层级与合并</h2><button className="text-button" onClick={() => { setEdit({ id: newId(), name: '', active: true, order: l.categories.length }); setError(''); }}>＋ 新分类</button></div>{sorted.map(c => <div className="manage-row" key={c.id}><div><b>{c.parent ? (l.categories.find(x => x.id === c.parent)?.name + ' / ') : ''}{c.name}</b><small>{c.active === false ? '已停用' : '已启用'}{c.mergedInto ? ' · 已合并' : ''}</small></div><button className="icon-button" aria-label={'上移 ' + c.name} onClick={() => move(c.id, -1)} disabled={busy}><ArrowUp size={13}/></button><button className="icon-button" aria-label={'下移 ' + c.name} onClick={() => move(c.id, 1)} disabled={busy}><ArrowDown size={13}/></button><button className="text-button" onClick={() => setEdit(c)}>编辑</button></div>)}{edit && <form className="inline-editor" onSubmit={submit}><label>分类名称<input name="name" defaultValue={edit.name} required maxLength={100}/></label><label>上级分类<select name="parent" defaultValue={edit.parent || ''}><option value="">一级分类</option>{l.categories.filter(c => c.id !== edit.id && !categoryDescendants(l, edit.id).has(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={edit.active !== false}/>启用</label><div className="button-row import-actions"><button className="primary" disabled={busy}>保存分类</button><button type="button" className="secondary" onClick={() => setEdit(null)}>取消</button></div></form>}<div className="inline-editor"><h3>合并分类</h3><div className="form-grid"><label>原分类<select value={mergeFrom} onChange={e => setMergeFrom(e.target.value)}><option value="">请选择</option>{l.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>合并到<select value={mergeTo} onChange={e => setMergeTo(e.target.value)}><option value="">请选择</option>{l.categories.filter(c => c.id !== mergeFrom && c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div><p className="muted">原分类停用，关联流水、模板及预算转入目标分类，可通过操作历史恢复。</p><button className="secondary" disabled={busy || !mergeFrom || !mergeTo} onClick={async () => {
            try {
                if (confirm('确认合并？将更新关联历史流水。'))
                    await save(mergeCategory(l, mergeFrom, mergeTo), '已合并分类');
            }
            catch (e) {
                setError((e as Error).message);
            }
        }}>确认合并</button></div>{error && <p className="error">{error}</p>}</section>;
}
export function BudgetPanel({ ledger: l, save, busy, month }: PanelProps) {
    const [period, setPeriod] = useState(month || today().slice(0, 7)), [error, setError] = useState('');
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        try {
            const f = new FormData(e.currentTarget);
            const amount = (v: FormDataEntryValue | null) => !v || String(v) === '0' ? 0 : cents(String(v));
            const budgets = Object.fromEntries(l.categories.map(c => [c.id, amount(f.get(c.id))]));
            await save({ ...l, monthlyBudgets: { ...l.monthlyBudgets, [period]: amount(f.get('total')) }, categoryBudgets: { ...l.categoryBudgets, [period]: budgets } }, '已保存 ' + period + ' 预算');
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    return <section className="panel"><div className="section-heading"><h2>月度与分类预算</h2><input className="small-input" type="month" value={period} onChange={e => setPeriod(e.target.value)}/></div><form key={period + ':' + JSON.stringify(l.categoryBudgets?.[period])} onSubmit={submit}><label>本月总预算（元，0 为不设置）<input name="total" type="number" min="0" step="0.01" defaultValue={budgetFor(l, period) / 100}/></label>{l.categories.filter(c => c.active !== false).map(c => { const b = l.categoryBudgets?.[period]?.[c.id] || 0, spent = categorySpend(l, c.id, period); return <div className="budget-setting" key={c.id}><label>{c.name}<input name={c.id} type="number" min="0" step="0.01" defaultValue={b / 100}/></label><div><span>已用 ¥{money(spent)}{b ? ' / ¥' + money(b) : ''}</span><div className="progress"><span style={{ width: Math.min(100, Math.max(0, spent / (b || 1) * 100)) + '%', background: b && spent > b ? '#bd8e71' : undefined }}/></div>{b && spent > b ? <small>已超支 ¥{money(spent - b)}</small> : null}</div></div>; })}<p className="muted">父分类预算包含子分类支出。每月预算独立保存，未单独设置的月份沿用默认预算。</p>{error && <div className="error">{error}</div>}<button className="primary" disabled={busy}>保存该月预算</button></form></section>;
}
export function RecurringPanel({ ledger: l, save, busy, open }: PanelProps) {
    const [rule, setRule] = useState<RecurringRule | null>(null), [error, setError] = useState('');
    const due = dueOccurrences(l);
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!rule)
            return;
        try {
            const f = new FormData(e.currentTarget);
            const r: RecurringRule = { ...rule, name: String(f.get('name')).trim(), amount: cents(String(f.get('amount'))), type: f.get('type') as 'expense' | 'income', account: String(f.get('account')), category: String(f.get('category')), channel: String(f.get('channel')), start: String(f.get('start')), frequency: f.get('frequency') as RecurringRule['frequency'], active: f.get('active') === 'on', autoDraft: f.get('autoDraft') === 'on', tags: String(f.get('tags')).split(/[,，、]/).map(t => t.trim()).filter(Boolean) };
            if (await save({ ...l, recurring: l.recurring?.some(x => x.id === r.id) ? l.recurring.map(x => x.id === r.id ? r : x) : [...(l.recurring || []), r] }, '已保存周期账单'))
                setRule(null);
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    return <section className="panel"><div className="section-heading"><h2>模板与周期账单</h2><button className="text-button" onClick={() => setRule({ id: newId(), name: '', amount: 0, type: 'expense', account: l.defaultAccount, category: l.categories.find(c => c.active !== false)?.id || 'c9', channel: '', start: today(), frequency: 'monthly', active: true, autoDraft: false, tags: ['固定支出'] })}>＋ 新模板</button></div><p className="muted">周期账单生成待确认草稿，核对后才入账。关闭应用时的提醒可导入手机日历（未来 12 次周期提醒及未来约一年还款日）。</p>{(l.recurring || []).map(r => <div className="manage-row" key={r.id}><div><b>{r.name} · ¥{money(r.amount)}</b><small>{r.active ? '启用' : '停用'} · {{ daily: '每日', weekly: '每周', monthly: '每月', yearly: '每年' }[r.frequency]} · {r.start} 起</small></div><button className="text-button" onClick={() => open({ id: newId(), type: r.type, amount: r.amount, date: today(), account: r.account, to: '', channel: r.channel, category: r.category, merchant: r.name, note: '使用记账模板', tags: r.tags, status: 'pending' })}>用此模板</button><button className="text-button" onClick={() => setRule(r)}>编辑</button></div>)}{rule && <form className="inline-editor" onSubmit={submit}><div className="form-grid"><label>名称<input name="name" required defaultValue={rule.name}/></label><label>金额（元）<input name="amount" type="number" step="0.01" min="0.01" required defaultValue={rule.amount ? rule.amount / 100 : ''}/></label><label>类型<select name="type" defaultValue={rule.type}><option value="expense">支出</option><option value="income">收入</option></select></label><label>重复频率<select name="frequency" defaultValue={rule.frequency}>{Object.entries({ daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label><label>开始日期<input name="start" type="date" required defaultValue={rule.start}/></label><label>账户<select name="account" defaultValue={rule.account}>{l.accounts.filter(a => !isHKAccount(l, a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>分类<select name="category" defaultValue={rule.category}>{l.categories.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>渠道<select name="channel" defaultValue={rule.channel}><option value="">未指定</option>{channelOptions(l, rule.channel).map(c => <option key={c.id} value={c.name}>{c.name}{c.active ? '' : '（已停用）'}</option>)}</select></label></div><label>标签<input name="tags" defaultValue={rule.tags.join('，')}/></label><label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={rule.active}/>启用</label><label className="checkbox-label"><input name="autoDraft" type="checkbox" defaultChecked={rule.autoDraft}/>打开账本时自动生成到期草稿（不会自动记支出）</label><div className="button-row import-actions"><button className="primary" disabled={busy}>保存模板</button><button type="button" className="secondary" onClick={() => setRule(null)}>取消</button></div></form>}{due.length > 0 && <div className="inline-editor"><h3>到期待处理 {due.length} 项</h3>{due.slice(0, 24).map(d => <div className="manage-row" key={d.key}><span>{d.date} · {d.rule.name} · ¥{money(d.rule.amount)}</span><button className="text-button" disabled={busy} onClick={() => save(generateRecurring(l, [d.key]), '已生成到期草稿')}>生成草稿</button></div>)}<button className="secondary" disabled={busy} onClick={() => save(generateRecurring(l, due.map(d => d.key)), '已生成全部到期草稿')}>全部生成草稿</button></div>}<button className="secondary import-actions" onClick={() => fileDownload('轻记_账单提醒.ics', calendarText(l), 'text/calendar;charset=utf-8')}><CalendarDays size={15}/>导出日历提醒</button>{error && <div className="error">{error}</div>}</section>;
}
export function PreferencePanel({ ledger: l, save, busy }: PanelProps) {
    const p = prefs(l);
    const [rule, setRule] = useState<MerchantRule | null>(null);
    function patch(v: Partial<typeof p>) { save({ ...l, preferences: { ...p, ...v } }, '已更新记账偏好'); }
    return <section className="panel"><h2>记账规则与首页定制</h2><label>默认支出账户<select value={l.defaultAccount} onChange={e => save({ ...l, defaultAccount: e.target.value }, '已更新默认账户')}>{l.accounts.filter(a => a.active !== false && !isHKAccount(l, a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><p className="muted">新增、改名和停用渠道，请打开上方“支付渠道”。</p>{channelOptions(l).map(c => { const ch = c.name; return <label key={c.id}>{ch}默认资金账户<select value={channelDefault(l, ch)} onChange={e => save({ ...l, channels: { ...l.channels, [ch]: e.target.value } }, '已更新渠道默认账户')} disabled={busy}>{l.accounts.filter(a => !isHKAccount(l, a.id) && (a.active !== false || a.id === channelDefault(l, ch))).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>; })}<label>退款统计口径<select value={p.refundMode} onChange={e => patch({ refundMode: e.target.value as typeof p.refundMode })}><option value="occurrence">退款发生月冲减支出</option><option value="original">追溯原消费日期冲减支出</option></select></label><p className="status-note">识别结果会持续追加到待审核列表；逐笔核对后，再统一审核入账。</p><label className="checkbox-label"><input type="checkbox" checked={p.retainInput} onChange={e => patch({ retainInput: e.target.checked })}/>此后保留原始记账语句用于纠错与核对</label><h3>首页卡片</h3>{Object.keys(cardNames).map(id => <div className="manage-row" key={id}><label className="checkbox-label"><input type="checkbox" checked={p.cards.includes(id)} onChange={e => patch({ cards: e.target.checked ? [...p.cards, id] : p.cards.filter(c => c !== id) })}/>{cardNames[id]}</label>{p.cards.includes(id) && <div><button className="icon-button" title="前移" disabled={busy} onClick={() => {
                    const arr = [...p.cards], i = arr.indexOf(id);
                    if (i > 0) {
                        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                        patch({ cards: arr });
                    }
                }}><ArrowUp size={13}/></button><button className="icon-button" title="后移" disabled={busy} onClick={() => {
                    const arr = [...p.cards], i = arr.indexOf(id);
                    if (i < arr.length - 1) {
                        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
                        patch({ cards: arr });
                    }
                }}><ArrowDown size={13}/></button></div>}</div>)}<p className="muted">显示顺序：{p.cards.map(id => cardNames[id]).join(' → ')}</p><h3>常用商户规则</h3>{(l.merchantRules || []).map(r => <div className="manage-row" key={r.id}><span>包含“{r.match}” → {l.categories.find(c => c.id === r.category)?.name}</span><button className="text-button" onClick={() => setRule(r)}>编辑</button><button className="text-button" onClick={() => save({ ...l, merchantRules: l.merchantRules?.filter(x => x.id !== r.id) }, '已移除商户规则')}>移除</button></div>)}<button className="text-button" onClick={() => setRule({ id: newId(), match: '', category: l.categories[0].id })}>＋ 新商户规则</button>{rule && <form className="inline-editor" onSubmit={async (e) => {
                e.preventDefault();
                if (await save({ ...l, merchantRules: l.merchantRules?.some(r => r.id === rule.id) ? l.merchantRules.map(r => r.id === rule.id ? rule : r) : [...(l.merchantRules || []), rule] }, '已保存商户规则'))
                    setRule(null);
            }}><label>包含关键词<input required value={rule.match} onChange={e => setRule({ ...rule, match: e.target.value })}/></label><label>分类<select value={rule.category} onChange={e => setRule({ ...rule, category: e.target.value })}>{l.categories.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>支付渠道（可选）<select value={rule.channel || ''} onChange={e => setRule({ ...rule, channel: e.target.value || undefined })}><option value="">不指定渠道</option>{channelOptions(l, rule.channel).map(c => <option key={c.id} value={c.name}>{c.name}{c.active ? '' : '（已停用）'}</option>)}</select></label><div className="button-row import-actions"><button className="primary" disabled={busy}>保存规则</button><button type="button" className="secondary" onClick={() => setRule(null)}>取消</button></div></form>}</section>;
}
