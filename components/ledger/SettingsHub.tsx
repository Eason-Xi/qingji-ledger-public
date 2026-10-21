'use client';
import { ChannelPanel } from './ChannelPanel';
import { useState } from 'react';
import { CreditCard, Shapes, ArrowLeftRight, ChartPie, CalendarDays, Sparkles, SlidersHorizontal, HardDrive } from 'lucide-react';
import { ImportPanel } from './ImportPanel';
import { AccountPanel, CategoryPanel, BudgetPanel, RecurringPanel, PreferencePanel, fileDownload, type PanelProps } from './FinancePanels';
import { AIPanel } from './AIPanel';
import { HistoryPanel } from './HistoryPanel';
import { transactionPostings } from '../../lib/transactions';
import { toCSV } from '../../lib/importer';
import { validate } from '../../lib/ledger';
import { type Book } from '../../lib/books';
const tabs: Record<string, string> = { accounts: '账户管理', categories: '分类管理', channels: '支付渠道', budgets: '分类预算', templates: '周期与模板', ai: 'AI 与隐私', preferences: '记账与首页', data: '迁移与备份' };
const tabIcons = { accounts: CreditCard, categories: Shapes, channels: ArrowLeftRight, budgets: ChartPie, templates: CalendarDays, ai: Sparkles, preferences: SlidersHorizontal, data: HardDrive };
export function SettingsHub(props: PanelProps & {
    book: Book;
    tab: string;
    setTab: (s: string) => void;
    ready: boolean;
    exportCSV: () => void;
    exportXLSX: () => void;
}) {
    const { ledger: l, tab, setTab, busy, save } = props;
    const [error, setError] = useState('');
    return <div className="settings-layout"><nav className="settings-tabs" aria-label="账本设置">{Object.entries(tabs).map(([v, n]) => { const Icon = tabIcons[v as keyof typeof tabIcons]; return <button className={tab === v ? 'active' : ''} aria-pressed={tab === v} onClick={() => setTab(v)} key={v}><Icon size={16}/><span>{n}</span></button>; })}</nav><div className="settings-content">{tab === 'accounts' && <AccountPanel {...props}/>} {tab === 'categories' && <CategoryPanel {...props}/>} {tab === 'channels' && <ChannelPanel {...props}/>} {tab === 'budgets' && <BudgetPanel {...props}/>} {tab === 'templates' && <RecurringPanel {...props}/>} {tab === 'ai' && <AIPanel/>} {tab === 'preferences' && <PreferencePanel {...props}/>} {tab === 'data' && <div className="data-panels"><section className="panel"><h2>导出与完整备份</h2><p className="muted">当前账本的 JSON 备份包含普通账户、证券账户、港股持仓与买卖明细、分类、流水、预算、周期模板及数字资产；不包含其他账本或 API 密钥。</p><div className="button-row"><button className="secondary" onClick={props.exportCSV}>导出日常 CSV</button><button className="secondary" onClick={props.exportXLSX}>导出日常 Excel</button><button className="secondary" onClick={() => fileDownload('轻记_账务分录.csv', toCSV([['交易ID', '日期', '账户', '借贷方向', '金额'], ...transactionPostings(l).map(p => [p.transaction, p.date, p.account, p.direction, (p.amount / 100).toFixed(2)])]), 'text/csv;charset=utf-8')}>导出账务分录</button><button className="secondary" onClick={() => fileDownload('轻记_' + props.book.name + '_完整备份.json', JSON.stringify({ version: 4, book: { id: props.book.id, name: props.book.name }, exported: new Date().toISOString(), ledger: l }, null, 2))}>下载当前账本备份</button><label className="secondary file-label">恢复备份<input type="file" accept=".json" disabled={busy} onChange={async (e) => {
                try {
                    const f = e.target.files?.[0];
                    if (!f)
                        return;
                    if (f.size > 8000000)
                        throw Error('备份文件超过 8 MB');
                    const b = JSON.parse(await f.text());
                    validate(b.ledger);
                    if (confirm(`备份含 ${b.ledger.transactions.length} 笔流水。确认恢复并替换当前账本“${props.book.name}”？其他账本不受影响。当前版本仍保留在本机历史。`))
                        await save(b.ledger, '从文件恢复完整账本');
                }
                catch (e) {
                    setError((e as Error).message);
                }
                finally {
                    e.target.value = '';
                }
            }}/></label></div>{error && <p className="error">{error}</p>}</section><section className="panel"><h2>本地存储与安装</h2><p className="muted">所有账本、流水和最近20个历史版本保存在当前浏览器的 IndexedDB 中。无需登录，也不会自动同步到其他设备。请定期下载完整备份；清理网站数据或使用无痕模式可能导致本机数据丢失。</p><p className="muted">首次联网加载后，支持缓存界面以便离线记账。手机浏览器可选择“添加到主屏幕”或“安装应用”。实时行情和浏览器语音识别仍可能需要网络。</p></section><ImportPanel {...props}/><HistoryPanel {...props}/></div>}</div></div>;
}
