'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hasHKDSettings } from '../../lib/account-currency';
import { money, type Ledger } from '../../lib/ledger';
import { fundReport, type DateRange } from '../../lib/reports';
import { toCSV } from '../../lib/importer';
import { fileDownload } from './FinancePanels';

export function FundsFlowPanel({ ledger, range }: { ledger: Ledger; range: DateRange }) {
    const [currency, setCurrency] = useState('all'), [account, setAccount] = useState(''), [selected, setSelected] = useState(''), [limit, setLimit] = useState(50);
    const all = useMemo(() => fundReport(ledger, range), [ledger, range]);
    const rows = all.filter(r => (!account || r.account === account) && (currency === 'all' ? r.currency === 'CNY' || r.entries.length || r.opening || r.closing || hasHKDSettings(ledger.accounts.find(a => a.id === r.account)!) : r.currency === currency));
    const detail = rows.find(r => r.account + '/' + r.currency === selected);
    const detailRef = useRef<HTMLElement>(null);
    useEffect(() => { if (selected) { detailRef.current?.focus({ preventScroll: true }); detailRef.current?.scrollIntoView({ block: 'start' }); } }, [selected]);
    const symbol = (c: string) => c === 'HKD' ? 'HK$' : '¥';
    function exportSummary() {
        fileDownload(`轻记_账户资金流向_${range.start}_${range.end}.csv`, toCSV([['开始日期', '结束日期', '账户', '币种', '期初余额', '流入', '流出', '余额调整', '期末余额'], ...rows.map(r => [range.start, range.end, r.name, r.currency, ...[r.opening, r.inflow, r.outflow, r.adjustment, r.closing].map(n => (n / 100).toFixed(2))])]), 'text/csv;charset=utf-8');
    }
    return <>
        <section className="panel">
            <div className="section-heading"><h2>账户资金流向</h2><button className="secondary" onClick={exportSummary}>导出资金汇总</button></div>
            <p className="muted">按实际发生日期统计已入账记录，银行互转、银证转账和历史投资结算均计入资金流动。流入不等于收入，流出不等于消费。</p>
            <div className="fund-filters"><label>资金账户<select value={account} onChange={e => setAccount(e.target.value)}><option value="">全部资金账户</option>{ledger.accounts.filter(a => all.some(r => r.account === a.id)).map(a => <option key={a.id} value={a.id}>{a.name}{a.active === false ? '（已停用）' : ''}</option>)}</select></label><label>查看币种<select value={currency} onChange={e => setCurrency(e.target.value)}><option value="all">人民币和港币</option><option value="CNY">人民币 CNY</option><option value="HKD">港币 HKD</option></select></label></div>
            <p className="report-scope">{range.start} 至 {range.end} · 原币分别统计，人民币与港币不直接相加</p>
            <div className="fund-grid">{rows.map(r => <article className="fund-card" key={r.account + '/' + r.currency}>
                <h3>{r.name}<span>{r.currency === 'HKD' ? '港币 HKD' : '人民币 CNY'}</span></h3>
                <dl>{[['期初余额', r.opening], ['流入', r.inflow], ['流出', r.outflow], ['余额调整', r.adjustment], ['期末余额', r.closing]].map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{symbol(r.currency)}{money(amount as number)}</dd></div>)}</dl>
                <button className="secondary" aria-expanded={selected === r.account + '/' + r.currency} onClick={() => { setSelected(selected === r.account + '/' + r.currency ? '' : r.account + '/' + r.currency); setLimit(50); }}>查看{r.name}{r.currency}明细（{r.entries.length}笔）</button>
            </article>)}</div>
            {!rows.length && <p className="report-empty">当前没有符合条件的资金账户。</p>}
            <p className="muted report-footnote">期初余额按当前账户期初设置及此前流水回溯。期末 = 期初 + 流入 − 流出 + 余额调整；证券账户内的股票买卖不重复扣减银行余额。</p>
        </section>
        {detail && <section className="panel" aria-label="账户资金明细" ref={detailRef} tabIndex={-1}><div className="section-heading"><h2>{detail.name} · {detail.currency} 明细</h2><button className="secondary" onClick={() => fileDownload(`轻记_${detail.name}_${detail.currency}_资金明细.csv`, toCSV([['实际日期', '说明', '对方账户', '币种', '流入或流出', '余额调整'], ...detail.entries.map(e => [e.date, e.label, e.counterparty, e.currency, e.adjustment ? '' : (e.amount / 100).toFixed(2), e.adjustment ? (e.amount / 100).toFixed(2) : ''])]), 'text/csv;charset=utf-8')}>导出账户明细</button></div>
            <p className="report-scope">{range.start} 至 {range.end} · 共 {detail.entries.length} 笔 · 正数为流入，负数为流出，余额调整单列</p>
            {detail.entries.slice(0, limit).map(e => <div className="fund-entry" key={e.id}><div><b>{e.label}</b><small>{e.date}{e.counterparty ? ' · ' + e.counterparty : ''}{e.adjustment ? ' · 余额调整' : ''}</small></div><strong>{e.amount > 0 ? '+' : '−'}{symbol(e.currency)}{money(Math.abs(e.amount))}</strong></div>)}
            {!detail.entries.length && <p className="report-empty">本期没有资金变动。</p>}
            {limit < detail.entries.length && <button className="secondary report-footnote" onClick={() => setLimit(n => n + 50)}>再显示50笔</button>}
        </section>}
    </>;
}
