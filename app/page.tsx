'use client';
import { appFetch as fetch } from '../lib/browser-api';
import { BooksApp, type WorkspaceProps } from '../components/ledger/BooksApp';
import { BookSwitcher } from '../components/ledger/BookSwitcher';
import { bookURL } from '../lib/books';
import { channelOptions, normalizeChannelReferences } from '../lib/channels';
import { newId } from '../lib/ids';
import { useEffect, useState, useRef } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ChevronLeft, ChevronRight, Plus, LayoutDashboard, List, ChartNoAxesCombined, Wallet, Settings, Search, Sparkles, Mic, ArrowUp, Download, Upload, Check, X, Trash2, Pencil, RotateCcw, ShieldCheck, Leaf, Utensils, Coffee, Car, ShoppingBag, BookOpen, HardDrive, LoaderCircle, UserRound, Coins, TrendingUp } from 'lucide-react';
import { initial, today, cents, money, balances, totals, parseText, types, validate, type Tx, type Ledger } from '../lib/ledger';
import { appendDraftBatch, appendSpokenText, remainingUnparsedText } from '../lib/draft-queue';
import { DraftReviewQueue } from '../components/ledger/DraftReviewQueue';
import { SettingsHub } from '../components/ledger/SettingsHub';
import { DigitalPanel } from '../components/ledger/DigitalPanel';
import { HKSecuritiesPanel } from '../components/ledger/HKSecuritiesPanel';
import { TransferFields } from '../components/ledger/TransferFields';
import { isHKTransfer, isCurrencyTransfer } from '../lib/hk-transfers';
import { isHKAccount } from '../lib/hk-securities';
import { HomeDashboard } from '../components/ledger/HomeDashboard';
import { ReportsPanel } from '../components/ledger/ReportsPanel';
import { initialReportView, reportAnchorForMonth, type ReportView } from '../lib/reports';
import { ConflictDialog, type MergeState } from '../components/ledger/ConflictDialog';
import { prefs, reportTransactions, generateRecurring } from '../lib/features';
import { moduleEnabled, modulePageEnabled } from '../lib/optional-modules';
import { parseCommand } from '../lib/commands';
import { toCSV } from '../lib/importer';
import { approvePending, approveDrafts, bulkUpdate, splitExpense, ledgerRows, upsertTransaction } from '../lib/transactions';
import { exportExcel } from '../lib/workbooks';
const icons = [LayoutDashboard, List, Sparkles, ChartNoAxesCombined, Coins, TrendingUp, Settings];
const nav = ['总览', '全部流水', '一句话记账', '统计报表', '数字资产', '港股证券', '我的账本'];
const color = ['#0071e3', '#ef8a32', '#36a2a0', '#ab75c8', '#ec7591', '#5c85ce', '#c0a34e', '#75a87b', '#8b8bd1', '#95959d', '#5ca6be'];
const blank = (): Tx => ({ id: newId(), type: 'expense', amount: 0, date: today(), account: 'cmb', to: '', channel: '', category: 'c0', merchant: '', note: '', status: 'posted' });
function download(name: string, body: string, type = 'application/json') { const a = document.createElement('a'); const u = URL.createObjectURL(new Blob([body], { type })); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
export default function Page() { return <BooksApp Workspace={LedgerWorkspace}/>; }
function LedgerWorkspace({ book, books, owner: expectedOwner, booksBusy, initialDrafts, onSwitch, onManage, onExample }: WorkspaceProps) {
    const [ledger, setLedger] = useState<Ledger>(() => structuredClone(initial));
    const [rev, setRev] = useState(0);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [selectedPage, setPage] = useState(0);
    const page = modulePageEnabled(ledger, selectedPage) ? selectedPage : 6;
    const optionalPageHidden = page !== selectedPage;
    const visibleNav = nav.map((name, index) => ({ name, index })).filter(({ index }) => modulePageEnabled(ledger, index));
    const [month, setMonth] = useState('');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [text, setText] = useState(initialDrafts.text);
    const [drafts, setDrafts] = useState<Tx[]>(initialDrafts.rows);
    const [warnings, setWarnings] = useState<string[]>(initialDrafts.warnings);
    const [reviewedDrafts, setReviewedDrafts] = useState<Set<string>>(() => new Set(initialDrafts.reviewed));
    const [draftTransferRates, setDraftTransferRates] = useState<Record<string, string>>(initialDrafts.transferRates || {});
    const parsingRef = useRef(false);
    const [modal, setModal] = useState<Tx | null>(null);
    const [amount, setAmount] = useState('');
    const [feeAmount, setFeeAmount] = useState('');
    const [toAmount, setToAmount] = useState('');
    const [transferRate, setTransferRate] = useState('');
    const [undo, setUndo] = useState<Ledger | null>(null);
    const [listening, setListening] = useState(false);
    const [showTrash, setShowTrash] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkCategory, setBulkCategory] = useState('');
    const [bulkTags, setBulkTags] = useState('');
    const [tagFilter, setTagFilter] = useState('');
    const [accountFilter, setAccountFilter] = useState('');
    const [allMonths, setAllMonths] = useState(false);
    const [listPage, setListPage] = useState(0);
    const [failedSave, setFailedSave] = useState<Ledger | null>(null);
    const savingRef = useRef(false);
    const composerInputRef = useRef<HTMLTextAreaElement>(null);
    const [splitTarget, setSplitTarget] = useState<Tx | null>(null);
    const [splitParts, setSplitParts] = useState<{
        amount: string;
        category: string;
        merchant: string;
    }[]>([]);
    const [splitError, setSplitError] = useState('');
    const [settingsTab, setSettingsTab] = useState('accounts');
    const ownerRef = useRef('');
    const baseRef = useRef<Ledger>(structuredClone(initial));
    const [mergeState, setMergeState] = useState<MergeState | null>(null);
    const [aiLoading, setAILoading] = useState(false);
    const [drillIds, setDrillIds] = useState<string[] | null>(null);
    const [drillTitle, setDrillTitle] = useState('');
    const [reportView, setReportView] = useState<ReportView>(initialReportView);
    const [command, setCommand] = useState<ReturnType<typeof parseCommand>>(null);
    const autoRun = useRef(false);
    const [draftEditing, setDraftEditing] = useState<string | null>(null);
    useEffect(() => { setMonth(today().slice(0, 7)); load(); }, []);
    useEffect(() => { if (optionalPageHidden) { setSettingsTab('modules'); setPage(6); } }, [optionalPageHidden]);
    useEffect(() => { setSelected(new Set()); setListPage(0); }, [month, filter, categoryFilter, query, tagFilter, accountFilter, showTrash, allMonths, page]);
    useEffect(() => {
        if (toast) {
            const t = setTimeout(() => setToast(''), 6000);
            return () => clearTimeout(t);
        }
    }, [toast]);
    async function serverWrite(next: Ledger, revision: number, base: Ledger, action: string) {
        next = normalizeChannelReferences(next);
        const r = await fetch(bookURL('/api/ledger', book.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ledger: next, revision, action }) });
        const d = await r.json() as {
            error: string;
            revision: number;
            ledger: Ledger;
            conflict?: boolean;
            bookId?: string;
        };
        if (d.bookId && d.bookId !== book.id) throw Error('保存响应的账本不匹配，请刷新重试');
        if (r.status === 409 && d.ledger) {
            setMergeState({ base, local: next, remote: d.ledger, revision: d.revision });
            setFailedSave(next);
            throw Error('存在其他标签页的新编辑，请完成冲突合并');
        }
        if (!r.ok)
            throw Error(d.error || '本机保存失败');
        setUndo(baseRef.current);
        setLedger(next);
        const committed = new Set(next.transactions.filter(t => t.status === 'posted').map(t => t.id));
        setDrafts(previous => previous.filter(t => !committed.has(t.id)));
        setReviewedDrafts(previous => new Set([...previous].filter(id => !committed.has(id))));
        setRev(d.revision);
        baseRef.current = structuredClone(next);
        setFailedSave(null);
        setMergeState(null);
        setSelected(new Set());
        setToast(action + ' · 已保存到本机');
        return true;
    }
    async function load() {
        try {
            const r = await fetch(bookURL('/api/ledger', book.id));
            const d = await r.json() as { ledger: Ledger; revision: number; owner: string; bookId: string; error?: string };
            if (!r.ok) throw Error(d.error || '无法读取浏览器账本');
            if (d.owner !== expectedOwner || d.bookId !== book.id) throw Error('账本已变化，请刷新页面');
            validate(d.ledger);
            ownerRef.current = d.owner;
            setReady(true); setError(''); setLedger(d.ledger); setRev(d.revision);
            baseRef.current = structuredClone(d.ledger);
        } catch (e) { setReady(false); setError((e as Error).message); }
    }
    async function save(next: Ledger, action: string, keepUndo = true) {
        if (savingRef.current || !ready)
            return false;
        if (mergeState) {
            setError('请先完成多个标签页编辑的合并');
            return false;
        }
        savingRef.current = true;
        setBusy(true);
        setError('');
        try {
            next = { ...next, preferences: { ...prefs(next), cloudAI: false } };
            validate(next);
            const result = await serverWrite(next, rev, baseRef.current, action);
            if (!keepUndo)
                setUndo(null);
            return result;
        }
        catch (e) {
            setFailedSave(next);
            setError((e as Error).message);
            return false;
        }
        finally {
            savingRef.current = false;
            setBusy(false);
        }
    }
    useEffect(() => {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
    }, []);
    useEffect(() => {
        if (!ready || busy || mergeState || autoRun.current)
            return;
        autoRun.current = true;
        const next = generateRecurring(ledger);
        if (next.transactions.length > ledger.transactions.length)
            save(next, '自动生成周期账单草稿');
    }, [ready, ledger]);
    useEffect(() => {
        if (!ready || busy || modal || drafts.length || text.trim() || mergeState || page >= 4 || selected.size)
            return;
        let active = true;
        const check = async () => {
            if (document.visibilityState !== 'visible')
                return;
            try {
                const r = await fetch(bookURL('/api/ledger?revisionOnly=1', book.id));
                if (!r.ok)
                    return;
                const d = await r.json() as {
                    revision: number;
                    owner: string;
                    bookId: string;
                };
                if (active && d.owner === ownerRef.current && d.bookId === book.id && d.revision !== rev)
                    load();
            }
            catch { }
        };
        window.addEventListener('focus', check);
        const timer = setInterval(check, 30000);
        return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); };
    }, [ready, busy, modal, drafts.length, text, mergeState, page, selected.size, rev]);
    const currentDrafts = () => ({ text, rows: drafts, warnings, reviewed: [...reviewedDrafts], transferRates: draftTransferRates });
    const switchingBlocked = busy || booksBusy || aiLoading || listening || !!modal || !!splitTarget || !!mergeState || !!failedSave;
    const account = (id: string) => ledger.accounts.find(a => a.id === id)?.name || '未指定';
    const cat = (id: string) => ledger.categories.find(c => c.id === id)?.name || '未分类';
    const tx = reportTransactions(ledger).filter(t => t.date.startsWith(month) && t.status !== 'deleted');
    const sum = totals(tx);
    const bal = balances(ledger);
    const assets = ledger.accounts.filter(a => a.kind === 'asset').reduce((s, a) => s + bal[a.id], 0);
    const debt = ledger.accounts.filter(a => a.kind === 'debt').reduce((s, a) => s + bal[a.id], 0);
    const groups = ledger.categories.map((c, i) => ({ ...c, value: tx.filter(t => t.status === 'posted' && t.category === c.id).reduce((s, t) => s + (t.type === 'expense' ? t.amount : t.type === 'refund' ? -t.amount : 0), 0), color: color[i % color.length] })).filter(c => c.value > 0).sort((a, b) => b.value - a.value);
    const visible = ledger.transactions.filter(t => (page === 1 && allMonths || t.date.startsWith(month)) && (!drillIds || drillIds.includes(t.id)) && (showTrash ? t.status === 'deleted' : t.status !== 'deleted') && (filter === 'all' || filter === 'pending' && t.status === 'pending' || t.type === filter) && (!categoryFilter || t.category === categoryFilter) && (!accountFilter || t.account === accountFilter || t.to === accountFilter) && (!tagFilter || t.tags?.includes(tagFilter)) && [t.merchant, t.note, account(t.account), cat(t.category), ...(t.tags || [])].join(' ').toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date));
    const pendingInScope = visible.filter(t => t.status === 'pending' && (!selected.size || selected.has(t.id)));
    function shift(n: number) { const d = new Date(month + '-15T12:00:00'); d.setMonth(d.getMonth() + n); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    function openQuickEntry() {
        if (page === 2)
            composerInputRef.current?.focus();
        else
            setPage(2);
    }
    function open(t?: Tx) {
        setDraftEditing(null);
        const v = t ? { ...t } : blank();
        if (!t)
            v.account = ledger.defaultAccount;
        setModal(v);
        setAmount(t?.amount ? (t.amount / 100).toFixed(2) : '');
        setFeeAmount(t?.fee ? String(t.fee / 100) : '');
        setToAmount(t?.toAmount ? (t.toAmount / 100).toFixed(2) : '');
        setTransferRate(t ? draftTransferRates[t.id] || '' : '');
        setError('');
    }
    async function submit() {
        if (!modal)
            return;
        try {
            const t = { ...modal, createdAt: modal.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [...new Set((modal.tags || []).map(t => t.trim()).filter(Boolean))], amount: cents(amount), merchant: modal.merchant.trim() || types[modal.type] };
            if (isCurrencyTransfer(ledger, t)) {
                t.currency ||= isHKAccount(ledger, t.account) ? 'HKD' : 'CNY';
                t.toCurrency ||= isHKAccount(ledger, t.to) ? 'HKD' : 'CNY';
                t.toAmount = cents(toAmount);
                t.channel = '';
                t.merchant = modal.merchant.trim() || (isHKTransfer(ledger, t) ? '银证转账' : '账户转账');
            } else { t.currency = undefined; t.toCurrency = undefined; t.toAmount = undefined; }
            const fee = isCurrencyTransfer(ledger, t) ? 0 : ['transfer', 'repayment'].includes(t.type) ? (feeAmount && feeAmount !== '0' ? cents(feeAmount) : 0) : undefined;
            t.fee = fee;
            const next = upsertTransaction(ledger, t, fee, transferRate.trim() || undefined);
            if (draftEditing) {
                setDrafts(previous => previous.map(x => x.id === draftEditing ? t : x));
                setDraftTransferRates(previous => ({ ...previous, [draftEditing]: transferRate.trim() }));
                setReviewedDrafts(previous => new Set([...previous, draftEditing]));
                setDraftEditing(null);
                setModal(null);
                return;
            }
            if (await save(next, '已保存这笔' + types[t.type]))
                setModal(null);
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    async function deleteOne(id: string, status: Tx['status'], action: string, note?: string) {
        try {
            let next = bulkUpdate(ledger, new Set([id]), { status });
            if (note && prefs(ledger).retainInput)
                next = { ...next, transactions: next.transactions.map(t => t.id === id ? { ...t, note: [t.note, note].filter(Boolean).join('\n'), updatedAt: new Date().toISOString() } : t) };
            return await save(next, action);
        }
        catch (e) {
            setError((e as Error).message);
            return false;
        }
    }
    async function parse() {
        if (parsingRef.current || savingRef.current || busy || !ready || !text.trim()) return;
        parsingRef.current = true;
        setAILoading(true);
        const input = text;
        setError('');
        setCommand(null);
        try {
            const cmd = parseCommand(input, ledger);
            if (cmd) {
                setCommand(cmd);
                if (!cmd.candidates.length)
                    throw Error('没有找到对应流水，请在流水页搜索后修改');
                return;
            }
            const result = parseText(input, { ...ledger, transactions: [...ledger.transactions, ...drafts] });
            if (!result.rows.length)
                throw Error(result.warnings[0] || '没有识别到有效流水，请补充金额或改用手动记账');
            setWarnings(previous => [...new Set([...previous, ...result.warnings])]);
            setDrafts(previous => appendDraftBatch(previous, result.rows));
            setText(previous => remainingUnparsedText(previous, input));

        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            parsingRef.current = false;
            setAILoading(false);
        }
    }
    async function postDrafts() {
        if (busy || savingRef.current || parsingRef.current || !ready) return;
        setError('');
        try {
            const submitted = new Set(drafts.map(t => t.id));
            const result = approveDrafts(ledger, drafts, draftTransferRates);
            if (await save(result.ledger, `已统一审核通过并保存 ${result.count} 笔`)) {
                setDrafts(previous => previous.filter(t => !submitted.has(t.id)));
                setReviewedDrafts(previous => new Set([...previous].filter(id => !submitted.has(id))));
                setDraftTransferRates(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !submitted.has(id))));
                setWarnings([]);
            }
        } catch (e) { setError((e as Error).message); }
    }
    function removeDraft(id: string) {
        if (drafts.length === 1) setWarnings([]);
        setDrafts(previous => previous.filter(t => t.id !== id));
        setDraftTransferRates(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)));
        setReviewedDrafts(previous => new Set([...previous].filter(value => value !== id)));
        setError('');
    }
    function clearDrafts() {
        if (!confirm(`清空全部 ${drafts.length} 笔未入账记录？`)) return;
        setDrafts([]); setDraftTransferRates({}); setReviewedDrafts(new Set()); setWarnings([]); setError('');
    }
    function voice() {
        const w = window as unknown as {
            SpeechRecognition?: new () => any;
            webkitSpeechRecognition?: new () => any;
        };
        const Speech = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (!Speech) {
            setToast('此浏览器不支持语音识别，可使用键盘的语音输入');
            return;
        }
        if (!confirm('语音由浏览器的语音服务处理，可能上传至其服务商。是否开始？'))
            return;
        const r = new Speech();
        r.lang = 'zh-CN';
        r.onresult = (e: any) => {
            const transcript = Array.from(e.results as ArrayLike<{ isFinal?: boolean; 0: { transcript: string } }>).slice(e.resultIndex || 0).filter(result => result.isFinal !== false).map(result => result[0].transcript).join('；');
            setText(previous => appendSpokenText(previous, transcript)); setListening(false);
        };
        r.onerror = () => { setListening(false); setToast('语音识别未完成，请检查麦克风权限或使用文字'); };
        r.onend = () => setListening(false);
        setListening(true);
        r.start();
    }
    function exportCSV() { download('轻记_' + book.name + '_流水_' + today() + '.csv', toCSV(ledgerRows(ledger, ledger.transactions)), 'text/csv;charset=utf-8'); }
    function exportVisible() { download('轻记_' + book.name + '_筛选流水_' + today() + '.csv', toCSV(ledgerRows(ledger, visible)), 'text/csv;charset=utf-8'); }
    async function exportXLSX() {
        try {
            await exportExcel(ledgerRows(ledger, ledger.transactions), '轻记_' + book.name + '_流水_' + today() + '.xlsx');
        }
        catch (e) {
            setError('Excel 导出失败：' + (e as Error).message);
        }
    }
    async function applyBulk(patch: Parameters<typeof bulkUpdate>[2], action: string) {
        try {
            await save(bulkUpdate(ledger, selected, patch), action);
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    async function approveScope() {
        if (busy || !ready) return;
        setError('');
        try {
            const result = approvePending(ledger, new Set(pendingInScope.map(t => t.id)));
            await save(result.ledger, `已一键审核通过 ${result.count} 笔`);
        } catch (e) { setError((e as Error).message); }
    }
    function startSplit(t: Tx) { setSplitTarget(t); setSplitParts([{ amount: '', category: t.category, merchant: t.merchant }, { amount: '', category: t.category, merchant: t.merchant }]); setSplitError(''); }
    const transactionList = (items: Tx[], editable = true) => items.length ? <div className="transactions">{items.map(t => {
            const i = ledger.categories.findIndex(c => c.id === t.category);
            const Icon = t.type === 'transfer' || t.type === 'repayment' ? ArrowLeftRight : t.category === 'c0' ? Utensils : t.category === 'c2' ? Car : t.category === 'c1' ? ShoppingBag : Wallet;
            return <div className="tx" key={t.id}>{page === 1 && editable && <input className="tx-checkbox" type="checkbox" aria-label={"选择 " + t.merchant} checked={selected.has(t.id)} onChange={e => {
                        const next = new Set(selected);
                        if (e.target.checked)
                            next.add(t.id);
                        else
                            next.delete(t.id);
                        setSelected(next);
                    }}/>}<span className="tx-icon" style={{ background: color[(i + 11) % 11] + '18', color: color[(i + 11) % 11] }}><Icon size={18}/></span><button className="tx-main" onClick={() => editable && open(t)}><b>{t.merchant}</b><small>{cat(t.category)}<i>·</i>{t.channel ? t.channel + ' / ' : ''}{account(t.account)}{t.to ? ' → ' + account(t.to) : ''}</small>{!!t.tags?.length && <span className="tx-tags">{t.tags.map(tag => <em key={tag}>#{tag}</em>)}</span>}</button><div className="tx-value"><b className={t.type === 'income' || t.type === 'refund' ? 'green' : ''}>{t.type === 'expense' ? '−' : t.type === 'income' || t.type === 'refund' ? '+' : ''} {t.currency === 'HKD' ? 'HK$' : '¥'}{money(t.amount)}</b>{t.toAmount !== undefined && <small>→ {t.toCurrency === 'HKD' ? 'HK$' : '¥'}{money(t.toAmount)}</small>}<small>{t.status === 'pending' ? '待确认' : t.date.slice(5).replace('-', '月') + '日'}{t.batch ? ' · 导入' : ''}</small></div>{editable && <button className="icon-button tx-edit" title="编辑流水" onClick={() => open(t)}><Pencil size={15}/></button>}</div>;
        })}</div> : <div className="empty"><BookOpen size={30}/><b>{query || filter !== 'all' ? '没有匹配的流水' : '让第一笔记录，从这里开始'}</b><span>记下今天的一杯咖啡，慢慢看清生活的全貌。</span><button className="text-button" onClick={() => open()}>＋ 记第一笔</button></div>;
    const summaryCard = <><div className="metrics"><section className="metric featured"><div>本月结余 <span>收支差额</span></div><h2><small>¥</small>{money(sum.income - sum.expense)}</h2><p>一分一厘，都是生活的底气。<Wallet size={44} aria-hidden="true"/></p></section><section className="metric"><div><span className="metric-icon expense"><ArrowUpRight size={17}/></span>本月支出</div><h2><small>¥</small>{money(sum.expense)}</h2><p>已扣除退款，不含转账及还款</p></section><section className="metric"><div><span className="metric-icon income"><ArrowDownLeft size={17}/></span>本月收入</div><h2><small>¥</small>{money(sum.income)}</h2><p>每一份收入，都值得被记录</p></section></div></>;
    const composer = <section className="composer" aria-label="一句话记账"><div className="section-heading"><h2><Sparkles size={18}/> 一句话，轻松记账</h2><span className="badge">规则解析 · 本地处理</span></div><textarea id="quick-entry-input" ref={composerInputRef} autoFocus={page === 2} aria-label="一句话记账" value={text} onChange={e => setText(e.target.value)} placeholder="可以连续说多笔，如：早餐 18；午饭 35。每次识别会追加到待审核列表。"/><div className="composer-bottom"><span><span className="small-dot"/> 默认使用 {account(ledger.defaultAccount)}</span><div><button className={'icon-button ' + (listening ? 'listening' : '')} title="语音输入" disabled={busy || aiLoading || !ready} onClick={voice}><Mic size={19}/></button><button disabled={!text.trim() || busy || !ready || aiLoading} className="primary compact" onClick={() => parse()}>规则识别 <ArrowUp size={16}/></button></div></div>{drafts.length > 0 && <DraftReviewQueue rows={drafts} warnings={warnings} reviewed={reviewedDrafts} busy={busy || aiLoading || !ready} account={account} category={cat} onEdit={t => { open(t); setDraftEditing(t.id); }} onReviewed={(id, checked) => setReviewedDrafts(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; })} onRemove={removeDraft} onClear={clearDrafts} onApprove={postDrafts}/>}{command && <div className="command-candidates"><h3>{command.action === 'delete' ? '选择要删除的流水' : '选择要修改的流水'}</h3>{command.candidates.map(t => <button key={t.id} className="draft" onClick={async () => {
                    if (command.action === 'delete') {
                        if (confirm(`将 ${t.date} ${t.merchant} ¥${money(t.amount)} 移入回收站？`) && await deleteOne(t.id, 'deleted', '按语句删除流水', '删除语句：' + text))
                            setCommand(null);
                    }
                    else {
                        setDraftEditing(null);
                        open({ ...t, ...command.patch, note: [t.note, command.patch.note, prefs(ledger).retainInput ? '纠错语句：' + text : ''].filter(Boolean).join('\n') });
                        setCommand(null);
                    }
                }}><span>{t.date} · {t.merchant} · {account(t.account)}</span><b>¥{money(t.amount)}</b></button>)}<button className="text-button" onClick={() => setCommand(null)}>取消</button></div>}<div className="examples">试试看 <button onClick={() => setText('今天麦当劳花了 30')}>麦当劳 30 元</button><button onClick={() => setText('昨天打车 26')}>昨天打车 26 元</button><button onClick={() => setText('借记卡转 100 到微信钱包')}>账户间转账</button></div></section>;
    return <div className="app"><aside className="sidebar"><a className="brand" href={import.meta.env.BASE_URL}><span><Wallet size={22}/></span>轻记<b>QINGJI</b></a><div className="book-label">{book.name} <span>CNY</span></div><nav aria-label="主导航">{visibleNav.map(({ name: n, index: i }) => { const Icon = icons[i]; return <button key={n} className={page === i ? 'active' : ''} aria-current={page === i ? 'page' : undefined} onClick={() => i === 2 ? openQuickEntry() : setPage(i)}><Icon size={19}/><span>{n}</span></button>; })}</nav><div className="sidebar-bottom"><div className="quiet-card"><ShieldCheck size={18}/><b>记录生活，自有节奏。</b><p>让每一份收支，<br />都清晰有序。</p></div><div className="profile"><span><UserRound size={17}/></span><div><b>浏览器本地</b><small><ShieldCheck size={11}/> 数据不上传</small></div><Settings size={17}/></div></div></aside><main><header className="topbar"><span>轻记 <ChevronRight size={12}/> <b>{nav[page]}</b></span><button title="重新读取浏览器账本" onClick={load} disabled={busy} className="sync"><HardDrive size={15}/>{busy ? '保存中…' : ready ? '已保存在本机' : '等待本地存储'}<span className={ready ? 'online' : 'offline'}/></button></header><div className="content"><div className="public-notice"><div><b>无需登录 · 账本保存在当前浏览器</b><span>清理浏览器或更换设备前，请导出备份。行情和语音功能可能需要网络。</span></div><button className="secondary" disabled={switchingBlocked || !ready} onClick={() => onExample(currentDrafts())}>创建示例账本</button><button className="secondary" onClick={() => { setPage(6); setSettingsTab("data"); }}>备份与恢复</button><a href="https://github.com/Eason-Xi/qingji-ledger-public" target="_blank" rel="noopener noreferrer">查看源码</a></div><BookSwitcher book={book} books={books} disabled={switchingBlocked} onSwitch={id => onSwitch(id, currentDrafts())} onManage={() => onManage(currentDrafts())}/><div className="page-title"><div><div className="eyebrow">QINGJI · PERSONAL FINANCE</div><h1>{page === 0 ? '财务总览' : page === 1 ? '全部流水' : page === 2 ? '一句话记账' : page === 3 ? '统计报表' : page === 4 ? '数字资产' : page === 5 ? '港股证券' : '我的账本'}</h1><p>{page === 0 ? '每一笔，都让生活更清晰。' : page === 1 ? '日常收支，井然有序。' : page === 2 ? '用一句话，记下每一笔收支。' : page === 3 ? '看见变化，了解每一份花费。' : page === 4 ? '自定义币种和余额，清晰掌握每一项资产。' : page === 5 ? '港币记录持仓与买卖，清楚掌握成本和盈亏。' : '用熟悉的方式，管理你的财务。'}</p></div>{page !== 4 && page !== 5 && <button className={"primary" + (page === 2 ? " entry-action" : "")} onClick={() => open()} disabled={!ready}><Plus size={18}/> {page === 2 ? '手动记账' : '记一笔'}</button>}</div>{error && <div role="alert" className="error">{error}<button onClick={load}>重新加载</button>{failedSave && <button onClick={() => download('轻记_尚未保存的编辑.json', JSON.stringify({ version: 1, exported: new Date().toISOString(), ledger: failedSave }, null, 2))}>下载未保存编辑</button>}</div>}{page !== 2 && page !== 3 && page !== 4 && page !== 5 && <div className="period"><div className="month"><button className="icon-button" title="上个月" onClick={() => shift(-1)}><ChevronLeft size={16}/></button><input type="month" aria-label="账本月份" value={month} onChange={e => setMonth(e.target.value)}/><button className="icon-button" title="下个月" onClick={() => shift(1)}><ChevronRight size={16}/></button></div><span>人民币收支 · 转账保留原币 <i>·</i> {tx.filter(t => t.status === 'posted').length} 笔记录</span></div>}

    {page === 0 && <HomeDashboard ledger={ledger} month={month} summary={summaryCard} composer={composer} recent={transactionList(ledger.transactions.filter(t => t.status !== 'deleted' && t.date.startsWith(month)).slice(-5).reverse())} onNavigate={tab => {
                if (tab === 'transactions')
                    setPage(1);
                else if (tab === 'reports')
                    setPage(3);
                else if (tab === 'digital' || tab === 'securities') {
                    if (moduleEnabled(ledger, tab)) setPage(tab === 'digital' ? 4 : 5);
                    else { setSettingsTab('modules'); setPage(6); }
                }
                else {
                    setSettingsTab(tab);
                    setPage(6);
                }
            }}/>}
    {page === 2 && <div className="quick-entry-page">{composer}</div>}
    {page === 1 && <section className="panel">{drillIds && <div className="report-drillbar"><button className="secondary" onClick={() => setPage(3)}>返回统计报表</button><div><b>{drillTitle}</b><small>当前筛选 {visible.length} 笔 · 收入 ¥{money(totals(visible).income)} · 净支出 ¥{money(totals(visible).expense)}</small></div></div>}<div className="filters">{drillIds && <button className="secondary" onClick={() => setDrillIds(null)}>清除报表下钻范围</button>}<div className="search"><Search size={17}/><input aria-label="搜索流水" placeholder="搜索商户、备注、标签…" value={query} onChange={e => { setQuery(e.target.value); setListPage(0); }}/></div><select aria-label="流水类型" value={filter} onChange={e => { setFilter(e.target.value); setListPage(0); }}><option value="all">全部类型</option>{Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="pending">待确认</option></select><select aria-label="流水分类" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setListPage(0); }}><option value="">全部分类</option>{ledger.categories.filter(c => c.active !== false || c.id === modal?.category).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="secondary" onClick={() => { setShowTrash(!showTrash); setSelected(new Set()); setListPage(0); }}>{showTrash ? '返回流水' : '回收站'}</button></div>
 <div className="filters extra-filters"><select aria-label="资金账户筛选" value={accountFilter} onChange={e => { setAccountFilter(e.target.value); setListPage(0); }}><option value="">全部账户</option>{ledger.accounts.filter(a => a.active !== false || a.id === accountFilter).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select aria-label="标签筛选" value={tagFilter} onChange={e => { setTagFilter(e.target.value); setListPage(0); }}><option value="">全部标签</option>{[...new Set(ledger.transactions.flatMap(t => t.tags || []))].map(t => <option key={t}>{t}</option>)}</select><label className="checkbox-label"><input type="checkbox" checked={allMonths} onChange={e => { setAllMonths(e.target.checked); setListPage(0); }}/>跨月份查看</label><button className="secondary" onClick={exportVisible}><Download size={14}/>导出筛选结果</button></div>
 <div className="selection-bar"><label className="checkbox-label"><input type="checkbox" aria-label="选择筛选出的全部流水" checked={visible.length > 0 && visible.every(t => selected.has(t.id))} onChange={e => setSelected(e.target.checked ? new Set(visible.map(t => t.id)) : new Set())}/>选择筛选结果</label><span>已选 {selected.size} 笔</span>{selected.size > 0 && <button className="text-button" onClick={() => setSelected(new Set())}>清空选择</button>}</div>
 {!showTrash && <div className="approval-bar"><div><b>待确认审核</b><p>{selected.size ? '仅审核所选记录中的待确认流水' : '审核当前筛选范围内的全部待确认流水（包含其他分页）'}；必要信息需完整，审核后计入余额和报表。</p></div><button className="primary compact" disabled={busy || !ready || !pendingInScope.length} onClick={approveScope}><Check size={16}/>一键审核通过（{pendingInScope.length} 笔）</button></div>}
 {selected.size > 0 && <div className="bulk-toolbar"><div><select aria-label="批量修改分类" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}><option value="">选择新分类</option>{ledger.categories.filter(c => c.active !== false || c.id === modal?.category).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="secondary" disabled={!bulkCategory || busy} onClick={() => applyBulk({ category: bulkCategory }, '已批量修改分类')}>应用分类</button></div><div><input aria-label="批量设置标签" value={bulkTags} placeholder="标签用逗号分开" onChange={e => setBulkTags(e.target.value)}/><button className="secondary" disabled={busy} onClick={() => applyBulk({ tags: [...new Set(bulkTags.split(/[,，、]/).map(t => t.trim()).filter(Boolean))] }, '已批量设置标签')}>替换标签</button></div><button className="secondary" disabled={busy} onClick={() => {
                    if (confirm(showTrash ? '恢复所选流水？' : '将所选流水移入回收站？'))
                        applyBulk({ status: showTrash ? 'posted' : 'deleted' }, showTrash ? '已批量恢复流水' : '已批量移入回收站');
                }}>{showTrash ? '恢复所选' : '删除所选'}</button></div>}
 {transactionList(visible.slice(Math.min(listPage, Math.max(0, Math.ceil(visible.length / 50) - 1)) * 50, (Math.min(listPage, Math.max(0, Math.ceil(visible.length / 50) - 1)) + 1) * 50))}<div className="table-footer pagination"><span>共 {visible.length} 笔 · 每页 50 笔</span><div><button className="icon-button" disabled={listPage <= 0} aria-label="上一页" onClick={() => setListPage(Math.max(0, listPage - 1))}><ChevronLeft size={16}/></button><span>{Math.min(listPage + 1, Math.max(1, Math.ceil(visible.length / 50)))} / {Math.max(1, Math.ceil(visible.length / 50))}</span><button className="icon-button" disabled={(listPage + 1) * 50 >= visible.length} aria-label="下一页" onClick={() => setListPage(listPage + 1)}><ChevronRight size={16}/></button></div></div></section>}
    {page === 3 && <ReportsPanel ledger={ledger} view={{ ...reportView, anchor: reportAnchorForMonth(reportView, month) }} onView={next => { setReportView(next); setMonth(next.anchor.slice(0, 7)); }} onDrill={(rows, label) => { setDrillIds(rows.map(t => t.id)); setDrillTitle(label); setAllMonths(true); setQuery(''); setFilter('all'); setCategoryFilter(''); setTagFilter(''); setAccountFilter(''); setShowTrash(false); setSelected(new Set()); setListPage(0); setPage(1); }}/>}
    {page === 4 && <DigitalPanel ledger={ledger} save={save} busy={busy} month={month} open={open}/>}
    {page === 5 && <HKSecuritiesPanel ledger={ledger} save={save} busy={busy || !ready} onTransfer={(accountId, transaction) => { setPage(2); open(transaction || { ...blank(), type: 'transfer', merchant: '银证转账', category: ledger.categories.find(c => c.id === 'c9')?.id || ledger.categories[0].id, account: ledger.accounts.find(a => a.kind === 'asset' && a.active !== false && !isHKAccount(ledger, a.id))?.id || '', to: accountId, toCurrency: 'HKD' }); }}/>}
    {page === 6 && <SettingsHub book={book} onSecurities={() => { if (moduleEnabled(ledger, 'securities')) setPage(5); else { setSettingsTab('modules'); setPage(6); } }} ledger={ledger} save={save} busy={busy} month={month} open={open} tab={optionalPageHidden ? 'modules' : settingsTab} setTab={setSettingsTab} ready={ready} exportCSV={exportCSV} exportXLSX={exportXLSX}/>}
    <footer>轻记 QINGJI <span>把日子过明白，把账记简单。</span><span>浏览器本地版 v1.0</span></footer></div></main>
    {modal && <div className="overlay" onClick={() => setModal(null)}><section role="dialog" aria-modal="true" aria-label={draftEditing ? '核对待审核记录' : '记一笔'} className="dialog" onClick={e => e.stopPropagation()}><div className="section-heading"><h2>{draftEditing ? '核对待审核记录' : ledger.transactions.some(t => t.id === modal.id) ? '编辑流水' : '记一笔'}</h2><button className="icon-button" aria-label="关闭" onClick={() => setModal(null)}><X size={20}/></button></div><div className="type-tabs">{Object.entries(types).map(([k, v]) => <button key={k} className={modal.type === k ? 'active' : ''} onClick={() => { const switching = modal.type !== k; setModal({ ...modal, type: k as Tx['type'], account: k !== 'transfer' && isHKAccount(ledger, modal.account) ? ledger.defaultAccount : modal.account, to: switching ? '' : modal.to, currency: switching ? undefined : modal.currency, toCurrency: switching ? undefined : modal.toCurrency, toAmount: switching ? undefined : modal.toAmount, adjustmentSide: 'increase' }); if (switching) { setAmount(''); setToAmount(''); setTransferRate(''); setFeeAmount(''); } }}>{v}</button>)}</div>{modal.type === 'transfer' ? <TransferFields ledger={ledger} tx={modal} amount={amount} toAmount={toAmount} valuationRate={transferRate} onValuationRate={setTransferRate} onChange={setModal} onAmount={setAmount} onToAmount={setToAmount}/> : <label className="amount-input">金额（CNY）<div>¥ <input autoFocus type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}/></div></label>}<div className="form-grid"><label>发生日期（UTC+8）<input type="date" value={modal.date} onChange={e => setModal({ ...modal, date: e.target.value })}/></label><label>发生时间（可留空）<input type="time" value={modal.time || ''} onChange={e => setModal({ ...modal, time: e.target.value || undefined, timezone: 'Asia/Shanghai' })}/></label>{!isCurrencyTransfer(ledger, modal) && <label>分类<select value={modal.category} onChange={e => setModal({ ...modal, category: e.target.value })}>{ledger.categories.filter(c => c.active !== false || c.id === modal?.category).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}{modal.type !== 'transfer' && <><label>{['transfer', 'repayment'].includes(modal.type) ? '转出账户' : '实际资金账户'}<select value={modal.account} onChange={e => setModal({ ...modal, account: e.target.value })}>{ledger.accounts.filter(a => !isHKAccount(ledger, a.id) && (a.active !== false || a.id === modal?.account || a.id === modal?.to)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>{['transfer', 'repayment'].includes(modal.type) ? <label>转入账户<select value={modal.to} onChange={e => setModal({ ...modal, to: e.target.value })}><option value="">请选择</option>{ledger.accounts.filter(a => !isHKAccount(ledger, a.id) && (a.active !== false || a.id === modal?.account || a.id === modal?.to)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label> : <label>支付渠道<select value={modal.channel} onChange={e => setModal({ ...modal, channel: e.target.value })}><option value="">未指定</option>{channelOptions(ledger, modal.channel).map(c => <option key={c.id} value={c.name}>{c.name}{c.active ? '' : '（已停用）'}</option>)}</select></label>}</>}</div>{modal.type === 'refund' && <label>关联原支出<select value={modal.original || ''} onChange={e => { const t = ledger.transactions.find(t => t.id === e.target.value); setModal({ ...modal, original: e.target.value, account: t?.account || modal.account, category: t?.category || modal.category }); }}><option value="">选择原始消费</option>{ledger.transactions.filter(t => t.type === 'expense' && t.status === 'posted').map(t => <option key={t.id} value={t.id}>{t.date} {t.merchant} ¥{money(t.amount)}</option>)}</select></label>}{['transfer', 'repayment'].includes(modal.type) && !isCurrencyTransfer(ledger, modal) && <label>手续费（元，单列为支出）<input type="number" step="0.01" min="0" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="无手续费可留空"/></label>}{modal.type === 'adjustment' && <label>调整方向<select value={modal.adjustmentSide || 'increase'} onChange={e => setModal({ ...modal, adjustmentSide: e.target.value as 'increase' | 'decrease' })}><option value="increase">增加账户余额 / 负债</option><option value="decrease">减少账户余额 / 负债</option></select></label>}<label>商户 / 交易说明<input value={modal.merchant} onChange={e => setModal({ ...modal, merchant: e.target.value })} placeholder="如：麦当劳、工资、信用卡还款"/></label><label>标签（用逗号分隔）<input value={(modal.tags || []).join('，')} onChange={e => setModal({ ...modal, tags: e.target.value.split(/[,，、]/) })} placeholder="如：旅行、工作、固定支出"/></label><label>备注<textarea value={modal.note} onChange={e => setModal({ ...modal, note: e.target.value })} placeholder="留一点值得记住的细节"/></label>{draftEditing ? <p className="status-note">保存核对结果只更新待审核列表，全部核对完再统一入账。</p> : <label>入账状态<select value={modal.status} onChange={e => setModal({ ...modal, status: e.target.value as Tx['status'] })}><option value="posted">确认入账</option><option value="pending">待确认（不影响统计）</option>{modal.status === 'deleted' && <option value="deleted">已删除</option>}</select></label>}{error && <div className="error">{error}</div>}<div className="dialog-bottom">{ledger.transactions.some(t => t.id === modal.id) && <button className="text-button" onClick={() => { setDraftEditing(null); open({ ...modal, id: newId(), batch: undefined, externalId: undefined, splitGroup: undefined, feeParent: undefined, recurrenceKey: undefined, date: today(), status: 'pending', createdAt: new Date().toISOString() }); }}>复制</button>}{modal.type === 'expense' && modal.status === 'posted' && ledger.transactions.some(t => t.id === modal.id) && <button className="text-button" disabled={busy} onClick={() => { startSplit(modal); setModal(null); }}>拆分消费</button>}{ledger.transactions.some(t => t.id === modal.id) && <button className="danger" disabled={busy} onClick={async () => {
                    const status = modal.status === 'deleted' ? 'posted' : 'deleted';
                    if (await deleteOne(modal.id, status, status === 'deleted' ? '已移入回收站' : '已恢复流水'))
                        setModal(null);
                }}>{modal.status === 'deleted' ? <RotateCcw size={16}/> : <Trash2 size={16}/>} {modal.status === 'deleted' ? '恢复' : '删除'}</button>}<button className="primary" disabled={busy || !ready} onClick={submit}>{busy ? <LoaderCircle size={16}/> : <Check size={16}/>}{draftEditing ? '保存核对结果' : '保存流水'}</button></div></section></div>}
    {splitTarget && <div className="overlay"><section role="dialog" aria-modal="true" aria-label="拆分消费" className="dialog"><div className="section-heading"><h2>拆分消费</h2><button className="icon-button" aria-label="关闭拆分" onClick={() => setSplitTarget(null)}><X size={20}/></button></div><p className="muted">{splitTarget.merchant} · 原金额 ¥{money(splitTarget.amount)}。拆分后原记录移入回收站，子记录保持同一账户。</p>{splitParts.map((p, i) => <div className="split-row" key={i}><label>金额<input aria-label={"第 " + (i + 1) + " 笔金额"} type="number" min="0.01" step="0.01" value={p.amount} onChange={e => setSplitParts(splitParts.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}/></label><label>分类<select value={p.category} onChange={e => setSplitParts(splitParts.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}>{ledger.categories.filter(c => c.active !== false || c.id === modal?.category).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>说明<input value={p.merchant} onChange={e => setSplitParts(splitParts.map((x, j) => j === i ? { ...x, merchant: e.target.value } : x))}/></label>{splitParts.length > 2 && <button className="icon-button" aria-label="移除此拆分项" onClick={() => setSplitParts(splitParts.filter((_, j) => j !== i))}><X size={14}/></button>}</div>)}<div className="button-row import-actions"><button className="secondary" disabled={splitParts.length >= 20} onClick={() => setSplitParts([...splitParts, { amount: '', category: splitTarget.category, merchant: splitTarget.merchant }])}>＋ 添加拆分项</button></div>{splitError && <div className="error">{splitError}</div>}<div className="dialog-bottom"><button className="primary" disabled={busy} onClick={async () => {
                try {
                    const next = splitExpense(ledger, splitTarget.id, splitParts);
                    if (await save(next, '已拆分消费'))
                        setSplitTarget(null);
                }
                catch (e) {
                    setSplitError((e as Error).message);
                }
            }}>确认拆分</button></div></section></div>}
    {mergeState && <ConflictDialog state={mergeState} busy={busy} error={error} onExport={() => download('轻记_本机待合并编辑.json', JSON.stringify({ version: 3, ledger: mergeState.local }, null, 2))} onApply={async (next, revision) => {
                if (savingRef.current)
                    return;
                savingRef.current = true;
                setBusy(true);
                try {
                    validate(next);
                    if (await serverWrite(next, revision, mergeState.remote, '合并标签页编辑')) {
                        setModal(null);
                        setDraftEditing(null);
                    }
                }
                catch (e) {
                    setError((e as Error).message);
                }
                finally {
                    savingRef.current = false;
                    setBusy(false);
                }
            }}/>}
        {toast && <div className="toast" role="status"><Check size={17}/>{toast}{undo && <button onClick={async () => {
                    if (await save(undo, '已撤销上次操作', false))
                        setUndo(null);
                }}>撤销</button>}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={14}/></button></div>}<nav className="mobile-nav" aria-label="底部导航">{visibleNav.map(({ index: i }) => { const Icon = icons[i]; return <button key={i} className={i === 2 ? 'add' + (page === 2 ? ' active' : '') : page === i ? 'active' : ''} aria-current={page === i ? 'page' : undefined} onClick={() => i === 2 ? openQuickEntry() : setPage(i)}><Icon size={21}/><span>{i === 0 ? '首页' : i === 1 ? '流水' : i === 2 ? '记账' : i === 3 ? '报表' : i === 4 ? '数字资产' : i === 5 ? '港股' : '我的'}</span></button>; })}</nav></div>;
}
