'use client';
import { newId } from '../../lib/ids';
import { useState } from 'react';
import { Upload, Download, Check, ArrowRight, FileSpreadsheet, RotateCcw, AlertCircle } from 'lucide-react';
import { money, type Ledger, type Tx, type ImportBatch } from '../../lib/ledger';
import { buildImport, collectValues, fields, guessMapping, rollbackBatch, toCSV, type ImportOptions, type ImportResult, type Field } from '../../lib/importer';
import { readWorkbook, type WorkbookData } from '../../lib/workbooks';
const sendFile = (name: string, body: string, type = 'text/csv;charset=utf-8') => { const url = URL.createObjectURL(new Blob([body], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
type Props = {
    ledger: Ledger;
    busy: boolean;
    ready: boolean;
    save: (l: Ledger, action: string) => Promise<boolean>;
};
export function ImportPanel({ ledger, busy, ready, save }: Props) {
    const [book, setBook] = useState<WorkbookData | null>(null);
    const [sheet, setSheet] = useState(0);
    const [header, setHeader] = useState(0);
    const [options, setOptions] = useState<ImportOptions | null>(null);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [snapshot, setSnapshot] = useState<Ledger | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [tab, setTab] = useState<'all' | 'ready' | 'duplicate' | 'error'>('all');
    const [newCategories, setNewCategories] = useState<Ledger['categories']>([]);
    const [done, setDone] = useState('');
    const [ack, setAck] = useState(false);
    const [paste, setPaste] = useState('');
    const rows = book?.sheets[sheet]?.rows || [];
    const headers = rows[header] || [];
    const effective = { ...ledger, categories: [...ledger.categories, ...newCategories] };
    function configure(b: WorkbookData, s: number, h: number) {
        const data = b.sheets[s].rows;
        const mapping = guessMapping(data[h] || []);
        const accounts: Record<string, string> = {}, categories: Record<string, string> = {};
        for (const value of [...collectValues(data, h, mapping.account), ...collectValues(data, h, mapping.to)])
            accounts[value] = ledger.accounts.find(a => a.name === value || a.id === value)?.id || '';
        for (const value of collectValues(data, h, mapping.category))
            categories[value] = ledger.categories.find(c => c.name === value || c.id === value)?.id || '';
        setOptions({ mapping, accounts, categories, fallbackType: '', duplicate: 'skip', dateOrder: 'ymd', batch: newId(), fileHash: b.hash, sheet: b.sheets[s].name, headerRow: h });
        setResult(null);
        setSnapshot(null);
        setError('');
        setNewCategories([]);
        setAck(false);
    }
    function update(patch: Partial<ImportOptions>) {
        if (options) {
            setOptions({ ...options, ...patch });
            setResult(null);
            setSnapshot(null);
            setAck(false);
        }
    }
    async function openFile(file: File) {
        setLoading(true);
        setError('');
        setDone('');
        try {
            const b = await readWorkbook(file);
            if (!b.sheets.some(s => s.rows.length > 1))
                throw Error('文件至少需要一行表头和一行数据');
            setBook(b);
            setSheet(0);
            setHeader(0);
            configure(b, 0, 0);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setLoading(false);
        }
    }
    function preview() {
        if (!options)
            return;
        setError('');
        try {
            const r = buildImport(rows, effective, options);
            setResult(r);
            setSnapshot(ledger);
            setTab('all');
            setAck(false);
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    async function commit() {
        if (!options || !result || !book || snapshot !== ledger)
            return;
        setError('');
        try {
            const current = buildImport(rows, effective, options);
            if (!current.transactions.length)
                throw Error('暂无可导入的流水');
            const batch: ImportBatch = { id: options.batch, name: book.name, fileHash: book.hash, sheet: book.sheets[sheet].name, created: new Date().toISOString(), count: current.counts.ready, duplicates: current.counts.duplicate, errors: current.counts.error, income: current.income, expense: current.expense, previousTransactions: ledger.transactions.filter(t => current.transactions.some(x => x.id === t.id)), appliedTransactions: current.transactions.filter(t => ledger.transactions.some(x => x.id === t.id)) };
            const next = { ...effective, transactions: [...ledger.transactions.filter(t => !current.transactions.some(x => x.id === t.id)), ...current.transactions], importBatches: [...(ledger.importBatches || []), batch] };
            if (await save(next, `已导入 ${batch.count} 笔历史流水`)) {
                setDone(`已完成：新增 ${batch.count} 笔，跳过 ${batch.duplicates} 笔重复，${batch.errors} 笔需要修正。`);
                setBook(null);
                setOptions(null);
                setResult(null);
                setNewCategories([]);
            }
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    const accountValues = options ? [...new Set([...collectValues(rows, header, options.mapping.account), ...(options.mapping.to >= 0 ? collectValues(rows, header, options.mapping.to) : [])])] : [];
    const categoryValues = options ? collectValues(rows, header, options.mapping.category) : [];
    const batches = [...new Set(ledger.transactions.filter(t => t.batch).map(t => t.batch!))].reverse();
    const template = () => sendFile('轻记_导入模板.csv', toCSV([['日期', '收支类型', '金额', '资金账户', '转入账户', '分类', '商户', '支付渠道', '备注', '外部流水号', '币种'], ['2026-10-01', '支出', '30.00', '招商银行信用卡', '', '餐饮', '麦当劳', '支付宝', '示例消费，请删除或替换', 'sample-001', 'CNY'], ['2026-10-02', '内部转账', '100.00', '银行卡（借记卡）', '微信零钱', '其他', '钱包充值', '银行转账', '示例转账，请删除或替换', 'sample-002', 'CNY']]));
    return <section className="panel import-panel"><div className="section-heading"><h2><FileSpreadsheet size={18}/> 迁移历史账单</h2><button className="text-button" onClick={template}><Download size={13}/>下载示例模板</button></div><p className="muted">支持随手记等账单的 CSV、XLS、XLSX。文件在浏览器中解析，确认后才将结构化流水保存到账本。</p>
 <div className="import-steps"><span className={book ? 'complete' : 'current'}>1 选择文件</span><ArrowRight size={13}/><span className={book && !result ? 'current' : ''}>2 对应字段与账户</span><ArrowRight size={13}/><span className={result ? 'current' : ''}>3 核对并导入</span></div>
 <label className="upload-zone"><Upload size={24}/><b>{loading ? '正在读取文件…' : book?.name || '选择历史账单文件'}</b><span>CSV / XLS / XLSX · 单文件最大 10 MB</span><input disabled={loading || busy} type="file" accept=".csv,.tsv,.xls,.xlsx" onChange={e => {
            const f = e.target.files?.[0];
            if (f)
                openFile(f);
            e.target.value = '';
        }}/></label>
 <details className="paste-import"><summary>也可以直接粘贴 CSV / 表格文本</summary><textarea aria-label="粘贴账单数据" value={paste} onChange={e => setPaste(e.target.value)} placeholder="粘贴包含表头的 CSV 或用制表符分隔的表格"/><button className="secondary" disabled={!paste.trim() || loading || busy} onClick={() => openFile(new File([paste], '粘贴的账单.csv', { type: 'text/csv' }))}>读取粘贴内容</button></details>
 {error && <div role="alert" className="error">{error}</div>}{done && <div className="success-note" role="status"><Check size={17}/>{done}</div>}
 {book && options && <><div className="form-grid"><label>工作表<select value={sheet} onChange={e => { const i = Number(e.target.value); setSheet(i); setHeader(0); configure(book, i, 0); }}>{book.sheets.map((s, i) => <option value={i} key={i}>{s.name}</option>)}</select></label><label>表头所在行<select value={header} onChange={e => { const i = Number(e.target.value); setHeader(i); configure(book, sheet, i); }}>{rows.slice(0, 50).map((r, i) => <option value={i} key={i}>第 {i + 1} 行 · {r.slice(0, 4).join(' / ').slice(0, 70)}</option>)}</select></label></div>
 <details className="source-preview"><summary>查看原始数据（前 5 行）</summary><div className="table-scroll"><table><tbody>{rows.slice(header, header + 6).map((r, i) => <tr key={i}>{r.slice(0, 15).map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div></details>
 <h3>字段对应</h3><div className="mapping">{Object.entries(fields).map(([key, label]) => <label key={key}>{label}{key === 'date' ? ' *' : ''}<select value={options.mapping[key as Field]} onChange={e => {
                    const mapping = { ...options.mapping, [key]: Number(e.target.value) };
                    const patch: Partial<ImportOptions> = { mapping };
                    if (key === 'account' || key === 'to') {
                        patch.accounts = { ...options.accounts };
                        for (const value of collectValues(rows, header, Number(e.target.value)))
                            patch.accounts[value] = ledger.accounts.find(a => a.id === value || a.name === value)?.id || '';
                    }
                    if (key === 'category') {
                        patch.categories = {};
                        for (const value of collectValues(rows, header, Number(e.target.value)))
                            patch.categories[value] = ledger.categories.find(c => c.id === value || c.name === value)?.id || '';
                    }
                    update(patch);
                }}><option value={-1}>不映射</option>{headers.map((h, i) => <option value={i} key={i}>{i + 1}. {h || '空白表头'}</option>)}</select></label>)}</div>
 <div className="form-grid"><label>无类型列时统一记为<select value={options.fallbackType} onChange={e => update({ fallbackType: e.target.value as Tx['type'] | '' })}><option value="">逐行确认，不自动推测</option><option value="expense">支出</option><option value="income">收入</option><option value="transfer">内部转账</option><option value="repayment">信用卡还款</option></select></label><label>日期格式<select value={options.dateOrder} onChange={e => update({ dateOrder: e.target.value as 'ymd' | 'dmy' })}><option value="ymd">年/月/日（也支持 Excel 日期）</option><option value="dmy">日/月/年 或 年/月/日</option></select></label></div>
 <div className="mapping-sections"><div><h3>资金账户对应</h3><p className="muted">将旧账本账户对应到实际资金账户。支付宝 / 微信渠道不会代替实际账户。</p>{accountValues.slice(0, 100).map(v => <label className="value-map" key={v}><span>{v || '（原始账户为空）'}</span><ArrowRight size={12}/><select value={options.accounts[v] || ''} onChange={e => update({ accounts: { ...options.accounts, [v]: e.target.value } })}><option value="">请选择实际账户</option>{ledger.accounts.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>)}{accountValues.length > 100 && <p className="warning">账户名称超过 100 个，请拆分文件后处理。</p>}</div><div><h3>分类对应</h3><p className="muted">可合并到现有分类，或保留原名称创建分类。</p>{categoryValues.slice(0, 200).map(v => <div className="value-map" key={v}><span>{v || '（原始分类为空）'}</span><select aria-label={`${v || '空白'}对应分类`} value={options.categories[v] || ''} onChange={e => update({ categories: { ...options.categories, [v]: e.target.value } })}><option value="">请选择分类</option>{effective.categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select>{v && !effective.categories.some(c => c.name === v) && <button className="text-button" onClick={() => { const c = { id: newId(), name: v }; setNewCategories([...newCategories, c]); update({ categories: { ...options.categories, [v]: c.id } }); }}>新建</button>}</div>)}</div></div>
 <label>重复流水处理<select value={options.duplicate} onChange={e => update({ duplicate: e.target.value as 'skip' | 'keep' | 'replace' })}><option value="skip">跳过重复（推荐）</option><option value="keep">作为新记录导入（可能重复计账）</option><option value="replace">覆盖已匹配记录（保留回滚快照）</option></select></label><div className="button-row import-actions"><button className="secondary" onClick={preview} disabled={busy || loading}>生成预览与查重</button><button className="text-button" onClick={() => { setBook(null); setResult(null); setOptions(null); setNewCategories([]); }}>取消导入</button></div>
 {result && <><div className="import-counts"><div><b>{result.counts.ready}</b><span>可以导入</span></div><div><b>{result.counts.duplicate}</b><span>重复已跳过</span></div><div><b>{result.counts.error}</b><span>需要修正</span></div><div><b>¥{money(result.expense)}</b><span>本次支出合计</span></div><div><b>¥{money(result.income)}</b><span>本次收入合计</span></div></div>
 <div className="import-tabs">{(['all', 'ready', 'duplicate', 'error'] as const).map(k => <button className={tab === k ? 'active' : ''} onClick={() => setTab(k)} key={k}>{{ all: '全部', ready: '可导入', duplicate: '重复', error: '需修正' }[k]}</button>)}{result.counts.error > 0 && <button className="text-button" onClick={() => sendFile('轻记_需修正账单.csv', toCSV([['原始行号', '原因', ...headers], ...result.rows.filter(r => r.status === 'error').map(r => [r.line, r.reason, ...r.raw])]))}><Download size={13}/>下载异常清单</button>}</div>
 <div className="table-scroll import-result"><table><thead><tr><th>行号</th><th>日期</th><th>说明</th><th>类型</th><th>实际账户 / 转入</th><th>分类</th><th>金额</th><th>状态 / 原因</th></tr></thead><tbody>{result.rows.filter(r => tab === 'all' || r.status === tab).slice(0, 50).map(r => <tr key={r.line}><td>{r.line}</td><td>{r.tx?.date || r.raw[options.mapping.date]}</td><td>{r.tx?.merchant || '—'}</td><td>{r.tx ? { expense: '支出', income: '收入', transfer: '转账', repayment: '还款', refund: '退款', adjustment: '余额调整' }[r.tx.type] : '—'}</td><td>{r.tx ? (effective.accounts.find(a => a.id === r.tx!.account)?.name || '—') + (r.tx.to ? ' → ' + effective.accounts.find(a => a.id === r.tx!.to)?.name : '') : '—'}</td><td>{r.tx ? effective.categories.find(c => c.id === r.tx!.category)?.name : '—'}</td><td>{r.tx ? '¥' + money(r.tx.amount) : r.raw[options.mapping.amount] || '—'}</td><td className={'status-' + r.status}>{r.reason}</td></tr>)}</tbody></table></div><p className="muted">预览显示所选状态前 50 行，共 {result.rows.length} 行。转账与还款不包含在收支合计中。</p>
 {snapshot !== ledger && <div className="warning"><AlertCircle size={13}/>账本已变更，请重新生成预览，避免重复导入。</div>}{result.counts.error > 0 && <label className="checkbox-label"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>我已核对异常清单，同意只导入可用行，其余行暂不导入</label>}{options.duplicate === 'replace' && <p className="warning">将覆盖匹配的旧记录，请核对金额和账户。导入历史保留覆盖前的记录，可撤销本批次。</p>}{options.duplicate === 'keep' && <p className="warning">已选择“作为新记录”，相同流水也会新增，请确认不会重复计支。</p>}
 <div className="button-row import-actions"><button className="secondary" onClick={() => sendFile('轻记_导入前完整备份.json', JSON.stringify({ version: 1, exported: new Date().toISOString(), ledger }, null, 2), 'application/json')}><Download size={14}/>下载导入前备份</button><button className="primary" disabled={!ready || busy || !result.counts.ready || snapshot !== ledger || (result.counts.error > 0 && !ack)} onClick={commit}><Check size={15}/>确认导入 {result.counts.ready} 笔</button></div></>}
 </>}
 {batches.length > 0 && <div className="batch-history"><h3>导入历史</h3>{batches.map(id => {
                const b = ledger.importBatches?.find(x => x.id === id);
                const active = ledger.transactions.filter(t => t.batch === id && t.status !== 'deleted').length;
                return <div className="batch" key={id}><div><b>{b?.name || '历史导入批次 ' + id.slice(0, 8)}</b><small>{b?.sheet ? b.sheet + ' · ' : ''}{active} 笔有效流水{b?.created ? ' · ' + new Date(b.created).toLocaleDateString('zh-CN') : ''}{!active ? ' · 已撤销或删除' : ''}</small></div><button className="text-button" disabled={busy || !active} onClick={async () => {
                        if (!confirm('撤销该批次的所有有效流水？记录会移入回收站，后续可恢复。'))
                            return;
                        try {
                            await save(rollbackBatch(ledger, id), '已撤销导入批次');
                        }
                        catch (e) {
                            setError((e as Error).message);
                        }
                    }}><RotateCcw size={13}/>撤销批次</button></div>;
            })}</div>}
 </section>;
}
