'use client';
import { appFetch as fetch } from '../../lib/browser-api';
import { useState } from 'react';
import { Plus, Pencil, X, ArrowDownUp } from 'lucide-react';
import { newId } from '../../lib/ids';
import { money, today, validate, type Ledger, type Tx } from '../../lib/ledger';
import type { HKAccount, HKBook, HKEvent, HKQuote } from '../../lib/extensions';
import { emptyHK, hkSettlementAccounts, hkCode, hkEventNames, hkPortfolio, hkTradeAmount, hkUnits, isHKAccount, isStockEvent } from '../../lib/hk-securities';
import { accountRegion, hasHKDBalance } from '../../lib/account-currency';
import type { HKRates } from '../../lib/hk-rates';
import { bulkUpdate, ledgerRows } from '../../lib/transactions';
import { toCSV } from '../../lib/importer';
import { fileDownload, type PanelProps } from './FinancePanels';

type AccountDraft = HKAccount & { name: string; active: boolean };
const amount = (n: number) => `HK$${money(n)}`;
const price = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 4, minimumFractionDigits: 2 });
const upsert = <T extends { id: string }>(rows: T[], row: T) => rows.some(r => r.id === row.id) ? rows.map(r => r.id === row.id ? row : r) : [...rows, row];

export function HKSecuritiesPanel({ ledger: l, save, busy, onTransfer }: Pick<PanelProps, 'ledger' | 'save' | 'busy'> & { onTransfer: (account: string, transaction?: Tx) => void }) {
    const book = l.hkSecurities || emptyHK();
    const [selected, setSelected] = useState('');
    const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null);
    const [eventDraft, setEventDraft] = useState<HKEvent | null>(null);
    const [quoteDraft, setQuoteDraft] = useState<HKQuote | null>(null);
    const [showDeleted, setShowDeleted] = useState(false), [limit, setLimit] = useState(50), [error, setError] = useState('');
    const selectedId = book.accounts.some(a => a.id === selected) ? selected : book.accounts[0]?.id || '';
    const config = book.accounts.find(a => a.id === selectedId);
    const parent = l.accounts.find(a => a.id === selectedId);
    const portfolio = hkPortfolio(book, l.transactions), summary = portfolio.accounts.find(a => a.id === selectedId);
    const holdings = portfolio.holdings.filter(p => p.account === selectedId);
    const records = book.events.filter(e => e.account === selectedId && (showDeleted ? e.status === 'deleted' : e.status === 'posted')).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time) || b.created.localeCompare(a.created) || b.id.localeCompare(a.id));
    const transfers = l.transactions.filter(t => t.type === 'transfer' && (t.account === selectedId || t.to === selectedId) && t.status === (showDeleted ? 'deleted' : 'posted')).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
    const disabled = busy || !config || parent?.active === false;
    async function persist(next: HKBook, action: string, accounts = l.accounts) {
        const updated: Ledger = { ...l, accounts, hkSecurities: next };
        validate(updated);
        return await save(updated, action);
    }
    function newAccount() {
        setAccountDraft({ id: newId(), name: '', active: true, openingCashHKD: '0', hkdToCNY: '', hkdToUSD: '', ratesAt: new Date().toISOString() });
    }
    function newEvent(type: HKEvent['type'], symbol = '', name = '') {
        setEventDraft({ id: newId(), account: selectedId, type, symbol, name, quantity: 0, priceHKD: '', feesHKD: '0', amountHKD: '', date: today(), time: '', created: new Date().toISOString(), note: '', status: 'posted' });
    }
    async function toggleEvent(e: HKEvent) {
        if (busy) return;
        setError('');
        try { await persist({ ...book, events: upsert(book.events, { ...e, status: e.status === 'posted' ? 'deleted' : 'posted' }) }, e.status === 'posted' ? '已作废港股记录' : '已恢复港股记录'); }
        catch (err) { setError((err as Error).message); }
    }
    return <div className="hk-layout">
        <section className="panel">
            <div className="section-heading account-heading"><h2>港股证券账户</h2><button className="primary compact" disabled={busy} onClick={newAccount}><Plus size={16}/>新增港股账户</button></div>
            <p className="muted">按港币记录股票、现金与费用，人民币及美元按账户记录的汇率折算。成本采用移动平均法，买入费用计入成本，卖出费用扣减收益。</p>
            {book.accounts.length ? <div className="hk-account-picker"><label>选择证券账户<select value={selectedId} onChange={e => { setSelected(e.target.value); setLimit(50); setShowDeleted(false); setError(''); }}>{book.accounts.map(a => <option value={a.id} key={a.id}>{l.accounts.find(p => p.id === a.id)?.name}{l.accounts.find(p => p.id === a.id)?.active === false ? '（已停用）' : ''}</option>)}</select></label><button className="secondary" disabled={busy} onClick={() => config && parent && setAccountDraft({ ...config, name: parent.name, active: parent.active !== false })}><Pencil size={14}/>账户与汇率</button></div> : <div className="hk-empty"><h3>先添加你的港股券商账户</h3><p>已有股票可直接录入代码、成本单价和股数；以后逐笔记录买入、卖出和费用。</p><button className="secondary" disabled={busy} onClick={newAccount}>创建第一个港股账户</button></div>}
            {config && summary && <>
                <div className="hk-metrics"><div><span>账户总资产{summary.missing ? ' · 含成本暂估' : ''}</span><strong>{amount(summary.total)}</strong><small>人民币 ¥{money(summary.cny)} · 美元 ${money(summary.usd)}</small></div><div><span>港币现金</span><strong>{amount(summary.cash)}</strong><small>期初现金 + 出入金、股息与买卖净额</small></div><div><span>持仓市值{summary.missing ? ' / 暂估值' : ''}</span><strong>{amount(summary.value)}</strong><small>持仓成本 {amount(summary.cost)}</small></div><div><span>已实现买卖盈亏</span><strong>{amount(summary.realized)}</strong><small>未实现盈亏 {summary.missing ? '待补齐现价' : amount(summary.value - summary.cost)}</small></div></div>
                <p className="muted">记录汇率：1 HKD = {config.hkdToCNY} CNY / {config.hkdToUSD} USD · {new Date(config.ratesAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
                {summary.missing > 0 && <p className="status-note">{summary.missing} 只股票未录入现价，暂按持仓成本计入资产合计。点击“更新现价”后显示市值与浮动盈亏。</p>}
                {summary.cash < 0 && <p className="status-note">港币现金为负，请核对融资余额或补齐出入金记录。</p>}
                {parent?.active === false && <p className="status-note">此账户已停用，持仓和资产仍保留。可在“账户与汇率”重新启用。</p>}
            </>}
        </section>
        {config && <>
            <section className="panel"><div className="section-heading account-heading"><h2>股票持仓明细</h2><div className="button-row"><button className="secondary" disabled={disabled} onClick={() => newEvent('opening')}>录入已有持仓</button><button className="primary compact" disabled={disabled} onClick={() => newEvent('buy')}><Plus size={14}/>记录买入</button><button className="secondary" disabled={disabled} onClick={() => onTransfer(selectedId)}><ArrowDownUp size={14}/>银证转账</button><button className="secondary" disabled={disabled} onClick={() => newEvent('dividend')}>股息 / 费用</button></div></div>
                <p className="muted hk-help">“已有持仓”录入成本和股数，不扣现金；买入扣减证券账户港币现金，卖出款项回到该账户。银行入金或出金统一在“记一笔 → 内部转账”操作。现价为手动参考价，更新时间单独记录。</p>
                {holdings.length ? <div className="hk-holdings">{holdings.map(p => <article className="hk-position" key={p.symbol}>
                    <div className="section-heading"><h3>{p.name} <small>{p.symbol}.HK</small></h3><span>{p.quantity.toLocaleString('zh-CN')} 股</span></div>
                    <dl className="hk-position-values"><div><dt>平均成本 / 股（含费用）</dt><dd>HK${price(p.average)}</dd></div><div><dt>持仓成本</dt><dd>{amount(p.cost)}</dd></div><div><dt>参考现价 / 股</dt><dd>{p.quote ? `HK$${p.quote.priceHKD}` : '待录入'}</dd></div><div><dt>{p.quote ? '持仓市值' : '按成本暂估'}</dt><dd>{amount(p.value)}</dd></div><div><dt>未实现盈亏</dt><dd>{p.unrealized === null ? '待录入现价' : amount(p.unrealized)}</dd></div><div><dt>此股票已实现盈亏</dt><dd>{amount(p.realized)}</dd></div></dl>
                    {p.quote && <p className="muted">手动现价日期：{p.quote.date}</p>}
                    <div className="button-row import-actions"><button className="text-button" disabled={disabled} aria-label={`买入 ${p.symbol}`} onClick={() => newEvent('buy', p.symbol, p.name)}>买入</button><button className="text-button" disabled={disabled} aria-label={`卖出 ${p.symbol}`} onClick={() => newEvent('sell', p.symbol, p.name)}>卖出</button><button className="text-button" disabled={busy} aria-label={`更新现价 ${p.symbol}`} onClick={() => setQuoteDraft(p.quote || { id: p.symbol, priceHKD: '', date: today() })}>更新现价</button></div>
                </article>)}</div> : <div className="hk-empty">还没有持仓。可录入已有持仓，或记录第一笔买入。</div>}
            </section>
            <section className="panel"><div className="section-heading account-heading"><h2>买卖与现金明细 · {records.length} 笔</h2><div className="button-row"><button className="text-button" onClick={() => { setShowDeleted(!showDeleted); setLimit(50); }}>{showDeleted ? '返回有效记录' : '查看已作废'}</button><button className="text-button" onClick={() => fileDownload('轻记_港股明细.csv', toCSV([['日期', '时间', '类型', '股票代码', '名称', '股数', '单价HKD', '费用HKD', '现金金额HKD', '关联银行账户', '实际结算币种', '实际结算金额', '备注', '状态'], ...records.map(e => [e.date, e.time, hkEventNames[e.type], e.symbol, e.name, isStockEvent(e.type) ? e.quantity : '', e.priceHKD, e.feesHKD, e.amountHKD, l.accounts.find(a => a.id === e.fiatAccount)?.name || '', e.fiatAccount ? e.fiatCurrency || 'CNY' : '', (e.fiatCurrency === 'HKD' ? e.fiatHKD : e.fiatCNY) === undefined ? '' : ((e.fiatCurrency === 'HKD' ? e.fiatHKD! : e.fiatCNY!) / 100).toFixed(2), e.note, e.status])]), 'text/csv;charset=utf-8')}>导出明细</button></div></div>
                <p className="muted">同日记录按时间排序，未填写时间按 00:00 处理，再按录入顺序计算。编辑、作废和恢复会重新计算持仓与现金。</p>
                {error && <p role="alert" className="error">{error}</p>}
                <div className="hk-records">{records.slice(0, limit).map(e => <article className="hk-record" key={e.id}><div><b>{hkEventNames[e.type]}{isStockEvent(e.type) ? ` · ${e.symbol} ${e.name}` : ''}</b><p>{e.date} {e.time}{isStockEvent(e.type) ? ` · ${e.quantity} 股 × HK$${e.priceHKD} · 费用 HK$${e.feesHKD}` : ` · HK$${e.amountHKD}`}</p>{e.fiatAccount && <p>关联 {l.accounts.find(a => a.id === e.fiatAccount)?.name} · {e.fiatCurrency === 'HKD' ? 'HK$' : '¥'}{money(e.fiatCurrency === 'HKD' ? e.fiatHKD || 0 : e.fiatCNY || 0)} {e.fiatCurrency || 'CNY'}</p>}{e.note && <p>{e.note}</p>}</div><div className="button-row">{e.status === 'posted' && <button className="text-button" disabled={busy} aria-label={`编辑记录 ${e.id}`} onClick={() => setEventDraft(e)}>编辑</button>}<button className="text-button" disabled={busy} aria-label={`${e.status === 'posted' ? '作废' : '恢复'}记录 ${e.id}`} onClick={() => toggleEvent(e)}>{e.status === 'posted' ? '作废' : '恢复'}</button></div></article>)}</div>
                {!records.length && <p className="hk-empty">暂无{showDeleted ? '已作废' : ''}记录。</p>}{records.length > limit && <button className="secondary" onClick={() => setLimit(limit + 50)}>显示更多记录</button>}
                <div className="section-heading"><h3>银证转账 · {transfers.length} 笔</h3><button className="text-button" disabled={!transfers.length} onClick={() => fileDownload('轻记_银证转账.csv', toCSV(ledgerRows(l, transfers)), 'text/csv;charset=utf-8')}>导出转账</button></div>
                <div className="hk-records">{transfers.slice(0, limit).map(t => <article className="hk-record" key={t.id}><div><b>{t.to === selectedId ? '银行转入证券' : '证券转出至银行'}</b><p>{t.date} {t.time} · {l.accounts.find(a => a.id === t.account)?.name} → {l.accounts.find(a => a.id === t.to)?.name}</p><p>{t.currency === 'HKD' ? 'HK$' : '¥'}{money(t.amount)} → {t.toCurrency === 'HKD' ? 'HK$' : '¥'}{money(t.toAmount || 0)}</p>{t.note && <p>{t.note}</p>}</div><div className="button-row">{t.status === 'posted' && <button className="text-button" disabled={busy} onClick={() => onTransfer(selectedId, t)}>编辑转账</button>}<button className="text-button" disabled={busy} onClick={async () => { setError(''); try { await save(bulkUpdate(l, new Set([t.id]), { status: t.status === 'posted' ? 'deleted' : 'posted' }), t.status === 'posted' ? '已作废银证转账' : '已恢复银证转账'); } catch (err) { setError((err as Error).message); } }}>{t.status === 'posted' ? '作废转账' : '恢复转账'}</button></div></article>)}</div>
                {!transfers.length && <p className="muted">银证转账保存后在这里和全部流水中同步显示。</p>}{transfers.length > limit && <button className="secondary" onClick={() => setLimit(limit + 50)}>显示更多转账</button>}
            </section>
        </>}
        {accountDraft && <HKAccountEditor key={accountDraft.id} draft={accountDraft} busy={busy} onClose={() => setAccountDraft(null)} onSave={async draft => {
            const { name, active, ...settings } = draft;
            const existing = l.accounts.find(a => a.id === draft.id);
            const nextAccounts = upsert(l.accounts, { ...existing, id: draft.id, name: name.trim(), kind: 'asset' as const, subtype: 'securities' as const, opening: 0, active });
            if (await persist({ ...book, accounts: upsert(book.accounts, settings) }, '已保存港股账户与汇率', nextAccounts)) { setSelected(draft.id); setAccountDraft(null); return true; }
            return false;
        }}/>}
        {eventDraft && <HKEventEditor key={eventDraft.id} draft={eventDraft} ledger={l} busy={busy} onClose={() => setEventDraft(null)} onSave={async event => {
            const accounts = hkSettlementAccounts(l, event);
            if (await persist({ ...book, events: upsert(book.events, event) }, '已保存港股' + hkEventNames[event.type] + '记录', accounts)) { setEventDraft(null); return true; } return false;
        }}/>}
        {quoteDraft && <HKQuoteEditor key={quoteDraft.id} draft={quoteDraft} busy={busy} onClose={() => setQuoteDraft(null)} onSave={async quote => {
            if (await persist({ ...book, quotes: upsert(book.quotes, quote) }, '已更新港股参考现价')) { setQuoteDraft(null); return true; } return false;
        }}/>}
    </div>;
}

function Dialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
    return <div className="overlay"><section className="dialog hk-dialog" role="dialog" aria-modal="true" aria-label={title}><div className="section-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={20}/></button></div>{children}</section></div>;
}
function HKAccountEditor({ draft, busy, onClose, onSave }: { draft: AccountDraft; busy: boolean; onClose: () => void; onSave: (a: AccountDraft) => Promise<boolean> }) {
    const [form, setForm] = useState(draft), [loading, setLoading] = useState(false), [error, setError] = useState(''), [source, setSource] = useState('');
    async function fetchRates() {
        setLoading(true); setError('');
        try {
            const response = await fetch('/api/hk-rates');
            const data = await response.json() as HKRates & { error?: string };
            if (!response.ok) throw Error(data.error || '获取汇率失败');
            setForm(previous => ({ ...previous, hkdToCNY: data.hkdToCNY, hkdToUSD: data.hkdToUSD, ratesAt: data.at }));
            setSource(data.source + ' · 获取于 ' + new Date(data.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
        } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
    }
    return <Dialog title="港股账户与汇率" busy={busy || loading} onClose={onClose}><form onSubmit={async e => { e.preventDefault(); if (busy || loading) return; setError(''); try { await onSave(form); } catch (err) { setError((err as Error).message); } }}>
        <div className="form-grid"><label>券商 / 账户名称<input autoFocus required maxLength={100} value={form.name} disabled={busy} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如：我的港股账户"/></label><label>期初港币现金<input required type="number" min="0" step="0.01" value={form.openingCashHKD} disabled={busy} onChange={e => setForm({ ...form, openingCashHKD: e.target.value })}/></label></div>
        <p className="muted">期初现金只填账户内未买股票的港币；股票在持仓明细录入。后续资金变动使用“现金收支”。</p>
        <div className="section-heading import-actions"><h3>折算汇率</h3><button type="button" className="text-button" disabled={busy || loading} onClick={fetchRates}>{loading ? '正在获取…' : '获取参考汇率'}</button></div>
        <div className="form-grid"><label>1 港币 = 人民币<input required type="number" min="0.00000001" max="100" step="0.00000001" value={form.hkdToCNY} disabled={busy || loading} onChange={e => { setSource('手动填写'); setForm({ ...form, hkdToCNY: e.target.value, ratesAt: new Date().toISOString() }); }}/></label><label>1 港币 = 美元<input required type="number" min="0.00000001" max="100" step="0.00000001" value={form.hkdToUSD} disabled={busy || loading} onChange={e => { setSource('手动填写'); setForm({ ...form, hkdToUSD: e.target.value, ratesAt: new Date().toISOString() }); }}/></label></div>
        <p className="muted">可获取参考汇率或手动填写；保存后用于账户及首页折算，可随时更新。{source}</p>
        <label className="checkbox-label"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} disabled={busy}/>启用此账户</label>
        {error && <p role="alert" className="error">{error}</p>}<div className="dialog-bottom"><button type="button" className="secondary" disabled={busy || loading} onClick={onClose}>取消</button><button className="primary" disabled={busy || loading}>保存港股账户</button></div>
    </form></Dialog>;
}
function HKEventEditor({ draft, ledger, busy, onClose, onSave }: { draft: HKEvent; ledger: Ledger; busy: boolean; onClose: () => void; onSave: (e: HKEvent) => Promise<boolean> }) {
    const [form, setForm] = useState(draft), [quantity, setQuantity] = useState(draft.quantity ? String(draft.quantity) : ''), [fiat, setFiat] = useState((draft.fiatCurrency === 'HKD' ? draft.fiatHKD : draft.fiatCNY) ? ((draft.fiatCurrency === 'HKD' ? draft.fiatHKD! : draft.fiatCNY!) / 100).toFixed(2) : ''), [error, setError] = useState('');
    const stock = isStockEvent(form.type), linked = ['deposit', 'withdrawal'].includes(form.type);
    const legacyTrade = stock && !!draft.fiatAccount;
    const bank = ledger.accounts.find(a => a.id === form.fiatAccount), currency = form.fiatCurrency || 'CNY';
    const bankRate = bank?.hkdToCNY || ledger.hkSecurities?.accounts.find(a => a.id === form.account)?.hkdToCNY;
    const cash = hkPortfolio(ledger.hkSecurities || emptyHK(), ledger.transactions).accounts.find(a => a.id === form.account)?.cash || 0;
    let gross: number | null = null;
    try { if (stock && /^\d+$/.test(quantity) && Number(quantity) > 0 && Number(quantity) <= 1000000000 && form.priceHKD) gross = hkTradeAmount(form.priceHKD, Number(quantity)); } catch { /* Preview stays empty until the amount is valid. */ }
    return <Dialog title={stock ? '港股持仓 / 买卖记录' : '港股现金收支'} busy={busy} onClose={onClose}><form onSubmit={async e => {
        e.preventDefault(); if (busy) return; setError('');
        try {
            const event: HKEvent = { ...form, symbol: stock ? hkCode(form.symbol) : '', name: stock ? form.name.trim() : '', quantity: stock ? Number(quantity) : 0, priceHKD: stock ? form.priceHKD : '', feesHKD: stock ? form.feesHKD || '0' : '0', amountHKD: stock ? '' : form.amountHKD, fiatAccount: (linked || legacyTrade) && form.fiatAccount ? form.fiatAccount : undefined, fiatCurrency: (linked || legacyTrade) && form.fiatAccount ? currency : undefined, fiatCNY: (linked || legacyTrade) && form.fiatAccount && currency === 'CNY' ? Number(hkUnits(fiat)) : undefined, fiatHKD: (linked || legacyTrade) && form.fiatAccount && currency === 'HKD' ? Number(hkUnits(fiat)) : undefined };
            await onSave(event);
        } catch (err) { setError((err as Error).message); }
    }}>
        <div className="form-grid"><label>记录类型<select value={form.type} disabled={busy || legacyTrade} onChange={e => setForm({ ...form, type: e.target.value as HKEvent['type'] })}>{Object.entries(hkEventNames).filter(([type]) => isStockEvent(type as HKEvent['type']) === stock && (stock || linked || ['dividend', 'fee'].includes(type))).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label>证券账户<select value={form.account} disabled={busy} onChange={e => setForm({ ...form, account: e.target.value })}>{ledger.hkSecurities?.accounts.map(a => <option key={a.id} value={a.id}>{ledger.accounts.find(p => p.id === a.id)?.name}</option>)}</select></label>
        {stock ? <><label>港股代码<input autoFocus required maxLength={8} placeholder="如 00700 或 700" value={form.symbol} disabled={busy} onChange={e => setForm({ ...form, symbol: e.target.value })}/></label><label>股票名称<input required maxLength={100} placeholder="如 腾讯控股" value={form.name} disabled={busy} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label>{form.type === 'opening' ? '已有持仓股数' : '成交股数'}<input required type="number" step="1" min="1" max="1000000000" value={quantity} disabled={busy} onChange={e => setQuantity(e.target.value)}/></label><label>{form.type === 'opening' ? '成本单价（港币 / 股）' : form.type === 'buy' ? '买入单价（港币 / 股）' : '卖出单价（港币 / 股）'}<input required type="number" step="0.0001" min="0.0001" value={form.priceHKD} disabled={busy} onChange={e => setForm({ ...form, priceHKD: e.target.value })}/></label><label>手续费及税费合计（港币）<input type="number" step="0.01" min="0" value={form.feesHKD} disabled={busy} onChange={e => setForm({ ...form, feesHKD: e.target.value })}/></label></> : <label>港币金额<input autoFocus required type="number" min="0.01" step="0.01" value={form.amountHKD} disabled={busy} onChange={e => setForm({ ...form, amountHKD: e.target.value })}/></label>}
        <label>{form.type === 'opening' ? '持仓起始日期' : '发生日期'}<input required type="date" value={form.date} disabled={busy} onChange={e => setForm({ ...form, date: e.target.value })}/></label><label>时间（可留空）<input type="time" value={form.time} disabled={busy} onChange={e => setForm({ ...form, time: e.target.value })}/></label>
        {linked && <><label>结算银行 / 资金账户<select value={form.fiatAccount || ''} disabled={busy} onChange={e => { const selected = ledger.accounts.find(a => a.id === e.target.value); setForm({ ...form, fiatAccount: e.target.value || undefined, fiatCurrency: selected ? hasHKDBalance(selected) && accountRegion(selected) === 'hongkong' ? 'HKD' : 'CNY' : undefined }); setFiat(''); }}><option value="">{stock ? '使用证券账户内港币现金' : '只记录港币现金'}</option>{ledger.accounts.filter(a => a.kind === 'asset' && !isHKAccount(ledger, a.id) && (a.active !== false || a.id === form.fiatAccount)).map(a => <option value={a.id} key={a.id}>{a.name}{hasHKDBalance(a) ? '（人民币 / 港币）' : '（人民币）'}</option>)}</select></label>{form.fiatAccount && <><label>银行结算币种<select value={currency} disabled={busy || !bank || !hasHKDBalance(bank)} onChange={e => { setForm({ ...form, fiatCurrency: e.target.value as 'CNY' | 'HKD' }); setFiat(''); }}><option value="CNY">人民币 CNY</option>{bank && hasHKDBalance(bank) && <option value="HKD">港币 HKD</option>}</select></label><label>{['buy', 'deposit'].includes(form.type) ? `银行实际扣款（${currency === 'HKD' ? '港币' : '人民币'}，含费用）` : `银行实际到账（${currency === 'HKD' ? '港币' : '人民币'}，扣费后）`}<input required type="number" min="0.01" step="0.01" value={fiat} disabled={busy} onChange={e => setFiat(e.target.value)}/></label></>}</>}
        </div>
        {stock && <p className="status-note">{form.type === 'opening' ? '已有持仓只增加股数和成本，不扣减现金。成本单价如已含费用，下方费用填 0。' : form.fiatAccount ? '此历史记录保留原银行直接结算方式与金额。新买卖统一使用证券账户现金。' : '本笔只使用证券账户内的港币现金：买入扣现金，卖出回到现金；银行余额不变。'}{gross !== null && ` 成交 / 成本金额：${amount(gross)}（未计费用）。`}</p>}
        {stock && form.type !== 'opening' && !legacyTrade && <p className="muted">证券账户当前港币现金：{amount(cash)}。{form.type === 'buy' && gross !== null && cash < gross + (Number(form.feesHKD) || 0) * 100 ? '现金不足，请先在记账界面完成银证转账，或核对期初现金。' : '无需选择银行或填写银行扣款。'}</p>}
        {legacyTrade && <p className="muted">历史银行结算：{bank?.name} · {currency === 'HKD' ? 'HK$' : '¥'}{fiat}。保留原结算金额，不重复扣证券账户现金。</p>}
        {linked && form.fiatAccount && <p className="status-note">{bank && hasHKDBalance(bank) ? currency === 'HKD' ? `本笔按港币记入银行余额；估值参考 1 HKD = ${bankRate} CNY${bank?.hkdToCNY ? '（银行账户汇率）' : '（首次结算时采用证券账户汇率）'}。可在账户管理更新汇率。` : '本笔按人民币记入该银行的人民币余额。' : '请选择普通银行资金账户记录结算。'}银行已有的其他币种余额及历史保持原币种。</p>}
        {linked && <p className="muted">{stock ? '选择银行账户后，买入扣减银行余额、卖出增加银行余额，证券账户港币现金保持不变。金额按所选币种和银行实际结算填写，包含费用；不要再重复记录出入金或普通转账。' : '关联银行账户后，入金会扣减所选币种余额、出金会增加该币种余额；本次出入金不要再重复录入日常转账。'}</p>}
        <label>备注<textarea maxLength={2000} value={form.note} disabled={busy} onChange={e => setForm({ ...form, note: e.target.value })}/></label>
        {error && <p role="alert" className="error">{error}</p>}<div className="dialog-bottom"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy}>保存记录</button></div>
    </form></Dialog>;
}
function HKQuoteEditor({ draft, busy, onClose, onSave }: { draft: HKQuote; busy: boolean; onClose: () => void; onSave: (q: HKQuote) => Promise<boolean> }) {
    const [form, setForm] = useState(draft), [error, setError] = useState('');
    return <Dialog title={`更新 ${draft.id}.HK 参考现价`} busy={busy} onClose={onClose}><form onSubmit={async e => { e.preventDefault(); if (busy) return; setError(''); try { await onSave(form); } catch (err) { setError((err as Error).message); } }}><label>现价（港币 / 股）<input autoFocus required type="number" step="0.0001" min="0" value={form.priceHKD} disabled={busy} onChange={e => setForm({ ...form, priceHKD: e.target.value })}/></label><label>报价日期<input required type="date" value={form.date} disabled={busy} onChange={e => setForm({ ...form, date: e.target.value })}/></label><p className="muted">同一股票的手动参考现价用于所有港股账户。更新后重算持仓市值、未实现盈亏和净资产。</p>{error && <p role="alert" className="error">{error}</p>}<div className="dialog-bottom"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy}>保存现价</button></div></form></Dialog>;
}
