'use client';
import type { ReactNode } from 'react';
import { ChevronRight, ShieldCheck, CalendarDays } from 'lucide-react';
import { money, balances, nativeBalances, totals, accountType, type Ledger } from '../../lib/ledger';
import { budgetFor, prefs, reportTransactions, creditStatement, dueOccurrences } from '../../lib/features';
import { digitalPositions, emptyDigital } from '../../lib/digital';
import { hasHKDSettings } from '../../lib/account-currency';
import { withMarketPrices } from '../../lib/market-prices';
import { marketWatchlist } from '../../lib/market-watchlist';
import { hkPortfolio, emptyHK } from '../../lib/hk-securities';
import { useMarketPrices } from '../../hooks/use-market-prices';
export function HomeDashboard({ ledger: l, month, summary, composer, recent, onNavigate }: {
    ledger: Ledger;
    month: string;
    summary: ReactNode;
    composer: ReactNode;
    recent: ReactNode;
    onNavigate: (tab: string) => void;
}) {
    const p = prefs(l), tx = reportTransactions(l).filter(t => t.date.startsWith(month)), sum = totals(tx), budget = budgetFor(l, month), bal = balances(l);
    const groups = l.categories.map(c => ({ ...c, value: totals(tx.filter(t => t.category === c.id)).expense })).filter(c => c.value > 0).sort((a, b) => b.value - a.value);
    const due = dueOccurrences(l);
    const cards = l.accounts.map(a => ({ a, s: creditStatement(l, a) })).filter(x => x.s && x.s.outstanding > 0);
    const book = l.digital || emptyDigital();
    const { market, priceNow } = useMarketPrices(marketWatchlist(book).filter(c => book.assets.some(a => a.symbol.trim().toUpperCase() === c.symbol)));
    const digital = digitalPositions(withMarketPrices(book, market, priceNow), p.costMethod);
    const hkMissing = hkPortfolio(l.hkSecurities || emptyHK(), l.transactions).accounts.reduce((sum, a) => sum + a.missing, 0);
    const securities = l.accounts.filter(a => accountType(a) === 'securities');
    const native = nativeBalances(l);
    const net = l.accounts.reduce((s, a) => s + (a.kind === 'asset' ? bal[a.id] : -bal[a.id]), 0) + digital.value;
    const panels: Record<string, ReactNode> = { summary, compose: composer, recent: <section className="panel"><div className="section-heading"><h2>最近流水</h2><button className="text-button" onClick={() => onNavigate('transactions')}>查看全部 <ChevronRight size={14}/></button></div>{recent}</section>, budget: <section className="panel"><div className="section-heading"><h2>本月预算</h2><button className="text-button" onClick={() => onNavigate('budgets')}>设置</button></div><div className="budget-head"><span>已用 <b>{budget ? Math.max(0, Math.round(sum.expense / budget * 100)) : 0}%</b></span><small>{budget ? '预算 ¥' + money(budget) : '尚未设置预算'}</small></div><div className="progress"><span style={{ width: Math.min(100, Math.max(0, sum.expense / (budget || 1) * 100)) + '%' }}/></div><p className="muted">{budget ? sum.expense > budget ? '已超支 ¥' + money(sum.expense - budget) : '还可花 ¥' + money(budget - sum.expense) : '设置一个小目标，消费更从容。'}</p></section>, categories: <section className="panel"><div className="section-heading"><h2>支出分类</h2><button className="text-button" onClick={() => onNavigate('reports')}>查看报表</button></div>{groups.length ? groups.slice(0, 5).map((g, i) => <div className="category-row" key={g.id}><span style={{ background: ['#0071e3', '#ef8a32', '#36a2a0', '#ab75c8', '#ec7591'][i] }}/><b>{g.name}</b><strong>¥{money(g.value)}</strong></div>) : <div className="category-empty"><div className="empty-ring"><span>¥0.00<small>本月支出</small></span></div><p>记一笔，让花费一目了然</p></div>}</section>, accounts: <section className="panel"><div className="section-heading"><h2>账户概览</h2><button className="text-button" onClick={() => onNavigate('accounts')}>管理</button></div><p className="muted">账本净资产{digital.missing ? '（数字资产估值不完整）' : ''}{hkMissing ? '（港股含成本暂估）' : ''}</p><h2 className="report-big">¥{money(net)}</h2>{securities.length > 0 && <p className="muted">其中证券账户 ¥{money(securities.reduce((sum, a) => sum + bal[a.id], 0))} <button className="text-button" onClick={() => onNavigate('securities')}>港股持仓</button></p>}{l.accounts.filter(a => a.active !== false).slice(0, 4).map(a => <div className="account-row" key={a.id}><span className={'account-logo ' + a.id}>{accountType(a) === 'securities' ? '证' : a.kind === 'debt' ? '卡' : '账'}</span><div><b>{a.name}</b><small>{accountType(a) === 'securities' ? '证券账户' : a.kind === 'debt' ? '负债' : '资产'}</small></div><strong>{hasHKDSettings(a) ? <>HK${money(native.HKD[a.id])}<small>人民币 ¥{money(native.CNY[a.id])}</small></> : <>¥{money(bal[a.id])}</>}</strong></div>)}</section>, reminders: <section className="panel"><div className="section-heading"><h2><CalendarDays size={16}/> 账单提醒</h2><button className="text-button" onClick={() => onNavigate('templates')}>管理</button></div>{cards.length || due.length ? <>{cards.slice(0, 3).map(({ a, s }) => <button className="reminder" key={a.id} onClick={() => onNavigate('accounts')}><b>{a.name} · {s!.overdue ? '已逾期' : '还款日'} {s!.due}</b><span>账本应还 ¥{money(s!.outstanding)}</span></button>)}{due.slice(0, 3).map(d => <button className="reminder" key={d.key} onClick={() => onNavigate('templates')}><b>{d.rule.name} · {d.date}</b><span>¥{money(d.rule.amount)} · 待生成草稿</span></button>)}</> : <p className="muted">暂时没有到期账单。可添加会员费、房租等周期模板。</p>}</section> };
    return <><div className="home-card-grid">{p.cards.map(id => <div className={id === 'summary' ? 'summary-card' : id === 'compose' || id === 'recent' ? 'wide-card' : id === 'categories' || id === 'accounts' ? 'half-card' : ''} key={id} data-card={id}>{panels[id]}</div>)}</div><div className="tip import-actions"><ShieldCheck size={16}/>支付渠道与实际资金账户独立记录，内部转账和还款不计消费。</div></>;
}
