'use client';
import { useMemo, useState } from 'react';
import { money, today, type Ledger, type Tx } from '../../lib/ledger';
import { prefs } from '../../lib/features';
import { cashSummary, fixedReportRows, originalReportRows, reportGroups, reportPoints, reportRanges, reportRows, shiftReport, validReportDate, type ReportView } from '../../lib/reports';
import { toCSV } from '../../lib/importer';
import { ledgerRows } from '../../lib/transactions';
import { fileDownload } from './FinancePanels';
import { FundsFlowPanel } from './FundsFlowPanel';
import './reports.css';

const dimensions = { category: '分类', merchant: '商户', account: '资金账户', channel: '支付渠道', tags: '标签' };
const periods = { day: '日', week: '周', month: '月', year: '年' };
export function ReportsPanel({ ledger: l, view, onView, onDrill }: {
    ledger: Ledger; view: ReportView; onView: (next: ReportView) => void; onDrill: (rows: Tx[], label: string) => void;
}) {
    const [selected, setSelected] = useState('');
    const { period, anchor, dimension, series, elapsed, tab } = view;
    const patch = (v: Partial<ReportView>) => onView({ ...view, ...v });
    const asOf = today();
    const ranges = useMemo(() => reportRanges(period, anchor, elapsed, asOf), [period, anchor, elapsed, asOf]), { range } = ranges;
    const rows = useMemo(() => reportRows(l, range), [l, range]);
    const sum = cashSummary(rows), lastRows = reportRows(l, ranges.previous), yearRows = reportRows(l, ranges.yearAgo);
    const last = cashSummary(lastRows), lastYear = cashSummary(yearRows);
    const groups = useMemo(() => reportGroups(l, rows, dimension), [l, rows, dimension]);
    const points = useMemo(() => reportPoints(rows, range, period), [rows, range, period]);
    const chosen = points.find(p => p.key === selected);
    const values = points.flatMap(p => series === 'both' ? [p.summary.netExpense, p.summary.income] : [series === 'income' ? p.summary.income : p.summary.netExpense]);
    const positive = Math.max(0, ...values), negative = Math.max(0, ...values.map(n => -n));
    const unit = 140 / Math.max(1, positive + negative), zero = 16 + positive * unit;
    const rankMax = Math.max(1, ...groups.map(g => Math.abs(g.amount)));
    const delta = (a: number, b: number, history: Tx[]) => !history.length ? '暂无记录可比' : b === 0 ? a === 0 ? '持平' : '基数为0' : `${a > b ? '+' : ''}${((a - b) / Math.abs(b) * 100).toFixed(1)}%`;
    function setDate(value: string) {
        const date = period === 'month' ? value + '-01' : period === 'year' ? value + '-01-01' : value;
        if (validReportDate(date)) patch({ anchor: date });
    }
    function shift(n: number) { const date = shiftReport(period, anchor, n); if (validReportDate(date)) patch({ anchor: date }); }
    return <div className="reports-expanded report-v2">
        <section className="panel report-toolbar">
            <div className="report-switch" role="group" aria-label="报表类型">{([['spending', '日常收支'], ['flow', '资金流向']] as const).map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} aria-pressed={tab === value} onClick={() => patch({ tab: value })}>{label}</button>)}</div>
            <div className="report-controls">
                <div className="type-tabs" role="group" aria-label="统计周期">{(Object.keys(periods) as Array<keyof typeof periods>).map(value => <button key={value} className={period === value ? 'active' : ''} aria-pressed={period === value} onClick={() => patch({ period: value })}>{periods[value]}</button>)}</div>
                <div className="report-date-controls"><button className="secondary" aria-label="上一期" onClick={() => shift(-1)}>‹</button><label>{period === 'month' ? '统计月份' : period === 'year' ? '统计年份' : '统计日期'}<input type={period === 'year' ? 'number' : period === 'month' ? 'month' : 'date'} min={period === 'year' ? '1900' : undefined} max={period === 'year' ? '9998' : undefined} value={period === 'year' ? anchor.slice(0, 4) : period === 'month' ? anchor.slice(0, 7) : anchor} onChange={e => setDate(e.target.value)}/></label><button className="secondary" aria-label="下一期" onClick={() => shift(1)}>›</button><button className="secondary" onClick={() => patch({ anchor: today() })}>回到本期</button></div>
                <label className="report-comparison">统计方式<select value={elapsed ? 'elapsed' : 'full'} onChange={e => patch({ elapsed: e.target.value === 'elapsed' })}><option value="elapsed">本期截至今天，同进度比较</option><option value="full">完整周期比较</option></select></label>
            </div>
            <p className="report-scope" aria-live="polite">{range.start} 至 {range.end}{ranges.partial ? ' · 本期尚未结束，统计至今天' : ' · 完整周期'}</p>
        </section>
        {tab === 'flow' ? <FundsFlowPanel ledger={l} range={range}/> : <>
            <section className="panel"><div className="section-heading"><h2>收支概览 <small>{rows.length}笔已入账收支</small></h2><button className="secondary" onClick={() => fileDownload(`轻记_收支流水_${range.start}_${range.end}.csv`, toCSV(ledgerRows(l, originalReportRows(l, rows))), 'text/csv;charset=utf-8')}>导出本期收支</button></div>
                <p className="muted">人民币统计，转账、还款、余额调整和投资交易不计入日常收支。退款按{prefs(l).refundMode === 'original' ? '原消费日期追溯' : '实际发生日期'}冲减，导出保留实际发生日期。</p>
                <div className="report-summary">{([['净支出', 'netExpense'], ['收入', 'income'], ['结余', 'balance']] as const).map(([name, key]) => <div key={key}><span>{name}</span><strong>¥{money(sum[key])}</strong><small>较上期 {delta(sum[key], last[key], lastRows)}<br/>同比 {delta(sum[key], lastYear[key], yearRows)}</small></div>)}</div>
                <div className="report-breakdown"><span>消费支出 <b>¥{money(sum.spending)}</b></span><span>退款 <b>¥{money(sum.refunds)}</b></span><span>净支出 = 消费 − 退款</span></div>
                <p className="report-footnote muted">上期：{ranges.previous.start} 至 {ranges.previous.end} · 同比：{ranges.yearAgo.start} 至 {ranges.yearAgo.end}{ranges.partial ? '（按相同已过天数，较短周期以期末为限）' : ''}</p>
            </section>
            <section className="panel"><div className="section-heading"><h2>收支趋势</h2><label className="report-inline-label">显示<select className="small-input" value={series} onChange={e => patch({ series: e.target.value as ReportView['series'] })}><option value="expense">净支出</option><option value="income">收入</option><option value="both">收支对比</option></select></label></div>
                <div className="report-legend">{series !== 'income' && <span><i className="expense"/>净支出</span>}{series !== 'expense' && <span><i className="income"/>收入</span>}<span><i className="refund"/>退款净额（零轴下方）</span></div>
                <p className="muted">横向滑动查看日期，点击柱子查看金额。净支出为负表示本期退款多于消费。</p>
                <div className="report-chart-scroll" tabIndex={0} role="region" aria-label="可横向滚动的收支趋势"><div className="report-chart-track">{points.map(p => <button key={p.key} className={'report-point' + (selected === p.key ? ' selected' : '')} aria-pressed={selected === p.key} aria-label={`${p.label}，消费${money(p.summary.spending)}元，退款${money(p.summary.refunds)}元，净支出${money(p.summary.netExpense)}元，收入${money(p.summary.income)}元`} onClick={() => setSelected(p.key)}><div className="report-plot"><span className="report-zero" style={{ top: zero }}/>{(series === 'both' ? ['netExpense', 'income'] as const : [series === 'income' ? 'income' : 'netExpense'] as const).map((key, i) => <span key={key} className={`report-bar ${p.summary[key] < 0 ? 'refund' : key === 'income' ? 'income' : 'expense'}`} style={{ height: Math.abs(p.summary[key]) * unit, top: p.summary[key] < 0 ? zero : zero - p.summary[key] * unit, left: series === 'both' ? 8 + i * 17 : 14, width: series === 'both' ? 14 : 24 }}/>)}</div><small>{p.label}</small></button>)}</div></div>
                {chosen ? <div className="report-point-detail" aria-live="polite"><b>{chosen.key}</b><span>消费 ¥{money(chosen.summary.spending)} · 退款 ¥{money(chosen.summary.refunds)}</span><span>净支出 ¥{money(chosen.summary.netExpense)} · 收入 ¥{money(chosen.summary.income)}</span><button className="secondary" disabled={!chosen.rows.length} onClick={() => onDrill(chosen.rows, chosen.key + '收支明细')}>查看{chosen.rows.length}笔收支明细</button></div> : <p className="report-footnote muted">每个日期均可点选；没有记录的日期按0显示。</p>}
            </section>
            <section className="panel"><div className="section-heading"><h2>净支出构成与排行</h2><label className="report-inline-label">排行维度<select className="small-input" value={dimension} onChange={e => patch({ dimension: e.target.value as ReportView['dimension'] })}>{Object.entries(dimensions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
                {groups.length ? groups.slice(0, 30).map(g => <button className={'report-category' + (g.amount < 0 ? ' report-negative' : '')} key={g.key} onClick={() => onDrill(g.rows, `${g.label} · 净支出 ¥${money(g.amount)}`)}><div><b>{g.label}<small>{g.amount < 0 ? '退款多于消费' : g.rows.length + '笔'}</small></b><span>¥{money(g.amount)}</span></div><div className="progress"><span style={{ width: Math.abs(g.amount) / rankMax * 100 + '%' }}/></div></button>) : <p className="report-empty">本期没有已入账的消费或退款。</p>}
                <p className="muted report-footnote">点击排行，仅展示构成该金额的消费与退款。{dimension === 'tags' ? '一笔记录可有多个标签，各标签合计可能重复。' : '按净支出排序，负数表示退款净额。'}{groups.length > 30 ? '当前展示前30项，可导出本期收支查看全部。' : ''}</p>
            </section>
            <section className="panel"><h2>固定支出</h2><p className="report-big">¥{money(cashSummary(fixedReportRows(l, rows)).netExpense)}</p><p className="muted">包含周期模板生成和标有“固定支出”的记录，已扣除对应退款。</p></section>
        </>}
    </div>;
}
