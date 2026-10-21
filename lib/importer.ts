import { newId } from './ids.ts';
import { resolveChannel } from './channels.ts';
import { cents, types, validate, type Ledger, type Tx } from './ledger.ts';
export type Field = 'date' | 'amount' | 'income' | 'expense' | 'type' | 'account' | 'to' | 'category' | 'merchant' | 'note' | 'channel' | 'externalId' | 'currency' | 'original' | 'adjustmentSide' | 'tags' | 'time' | 'toAmount' | 'toCurrency';
export const fields: Record<Field, string> = { date: '日期', amount: '金额', income: '收入金额（分列）', expense: '支出金额（分列）', type: '收支类型', account: '资金账户', to: '转入账户', category: '分类', merchant: '商户 / 项目', note: '备注', channel: '支付渠道', externalId: '外部流水号', currency: '币种', original: '原消费流水号', adjustmentSide: '余额调整方向', tags: '标签', time: '发生时间', toAmount: '到账金额', toCurrency: '到账币种' };
export type Mapping = Record<Field, number>;
export type ImportOptions = {
    mapping: Mapping;
    accounts: Record<string, string>;
    categories: Record<string, string>;
    fallbackType: Tx['type'] | '';
    duplicate: 'skip' | 'keep' | 'replace';
    dateOrder: 'ymd' | 'dmy';
    batch: string;
    fileHash: string;
    sheet: string;
    headerRow: number;
};
export type ImportRow = {
    line: number;
    raw: string[];
    status: 'ready' | 'duplicate' | 'error';
    reason: string;
    tx?: Tx;
};
export type ImportResult = {
    rows: ImportRow[];
    transactions: Tx[];
    counts: {
        ready: number;
        duplicate: number;
        error: number;
    };
    income: number;
    expense: number;
};
export function guessMapping(headers: string[]): Mapping {
    const patterns: Record<Field, RegExp> = { date: /^(日期|时间|交易时间|交易日期|发生日期|date|occurred_at)$/i, amount: /^(金额|交易金额|金额[（(]元[)）]|amount)$/i, income: /^(收入金额|收入[（(]元[)）]|income)$/i, expense: /^(支出金额|支出[（(]元[)）]|expense)$/i, type: /^(类型|收支|收支类型|交易类型|收入[／/]支出|收[／/]支|type)$/i, account: /^(账户|账户名称|资金账户|付款账户|转出账户|account)$/i, to: /^(转入账户|收款账户|to_account)$/i, category: /^(分类|类别|一级分类|支出分类|category)$/i, merchant: /^(商户|交易对方|项目|商家|merchant)$/i, note: /^(备注|说明|note)$/i, channel: /^(渠道|支付渠道|支付方式|channel)$/i, externalId: /^(流水号|交易单号|订单号|外部流水号|external_id)$/i, currency: /^(币种|货币|currency)$/i, original: /^(原消费流水号|原流水号|退款关联号|original_id)$/i, adjustmentSide: /^(余额调整方向|调整方向|adjustment_side)$/i, tags: /^(标签|tags)$/i, time: /^(发生时间|时分|time)$/i, toAmount: /^(到账金额|to_amount)$/i, toCurrency: /^(到账币种|to_currency)$/i };
    return Object.fromEntries(Object.entries(patterns).map(([k, re]) => [k, headers.findIndex(h => re.test(h.trim()))])) as Mapping;
}
export function parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], field = '', quote = false;
    const first = text.split(/\r?\n/)[0];
    const separator = first.includes('\t') && !first.includes(',') ? '\t' : ',';
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quote && text[i + 1] === '"') {
                field += '"';
                i++;
            }
            else
                quote = !quote;
        }
        else if (c === separator && !quote) {
            row.push(field);
            field = '';
        }
        else if ((c === '\n' || c === '\r') && !quote) {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else
            field += c;
    }
    if (quote)
        throw Error('CSV 引号未闭合，请检查文件');
    row.push(field);
    if (row.some(x => x.trim()))
        rows.push(row);
    return rows;
}
export function toCSV(rows: unknown[][]) {
    return '\uFEFF' + rows.map(r => r.map(v => {
        let s = String(v ?? '');
        if (/^[\s]*[=+@-]/.test(s))
            s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
}
export function parseImportDate(value: string, order: 'ymd' | 'dmy' = 'ymd') {
    const s = value.trim();
    let date = '';
    if (/^\d{5}(\.\d+)?$/.test(s)) {
        const n = Number(s);
        if (n < 20000 || n > 100000)
            throw Error('Excel 日期序号超出范围');
        date = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
    }
    else {
        const ymd = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:[ T].*)?$/);
        const dmy = order === 'dmy' ? s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T].*)?$/) : null;
        if (ymd)
            date = `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
        else if (dmy)
            date = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        else
            throw Error('日期无法识别，请使用年/月/日或指定日/月/年');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
        throw Error('日期不存在');
    return date;
}
function cleanAmount(v: string) { return v.trim().replace(/[¥￥,，\s]/g, '').replace(/元$/, ''); }
function signedAmount(v: string) {
    const s = cleanAmount(v);
    if (!/^[+-]?\d+(\.\d{1,2})?$/.test(s))
        throw Error('金额格式错误，最多两位小数');
    return { value: cents(s.replace(/^[+-]/, '')), negative: s.startsWith('-') };
}
export const fingerprint = (t: Tx) => JSON.stringify([t.date, t.type, t.amount, t.account, t.to, t.merchant.trim(), ...(t.toAmount !== undefined || t.currency === 'HKD' ? [t.currency || 'CNY', t.toAmount, t.toCurrency] : [])]);
function kind(v: string): Tx['type'] | undefined { const names: Record<string, Tx['type']> = { '支出': 'expense', '消费': 'expense', '付款': 'expense', 'expense': 'expense', '收入': 'income', '收款': 'income', 'income': 'income', '内部转账': 'transfer', '转账': 'transfer', 'transfer': 'transfer', '信用卡还款': 'repayment', '还款': 'repayment', 'repayment': 'repayment', '余额调整': 'adjustment', 'adjustment': 'adjustment', '退款': 'refund', '退回': 'refund', 'refund': 'refund' }; return names[v.toLowerCase()]; }
export function collectValues(rows: string[][], headerRow: number, index: number) { return [...new Set(rows.slice(headerRow + 1).filter(r => r.some(x => x.trim())).map(r => index >= 0 ? r[index]?.trim() || '' : ''))]; }
export function buildImport(raw: string[][], l: Ledger, o: ImportOptions): ImportResult {
    const m = o.mapping;
    const hasSingle = m.amount >= 0;
    const hasSplit = m.income >= 0 || m.expense >= 0;
    if (m.date < 0 || (!hasSingle && !hasSplit))
        throw Error('请映射日期和金额，或收入 / 支出金额列');
    if (hasSingle && hasSplit)
        throw Error('金额列与收入 / 支出分列请二选一');
    const indexes = Object.values(m).filter(i => i >= 0);
    if (new Set(indexes).size !== indexes.length)
        throw Error('同一原始列不能同时映射到多个字段');
    const source = raw.slice(o.headerRow + 1);
    if (source.length > 10000)
        throw Error('单次最多导入 10000 行，请分批处理');
    const result: ImportResult = { rows: [], transactions: [], counts: { ready: 0, duplicate: 0, error: 0 }, income: 0, expense: 0 };
    const existing = l.transactions.filter(t => t.status !== 'deleted');
    const keys = new Set(existing.map(fingerprint));
    const ext = new Map(existing.filter(t => t.externalId).map(t => [t.externalId!, t]));
    for (let i = 0; i < source.length; i++) {
        const r = source[i];
        if (!r.some(x => x.trim()))
            continue;
        const line = o.headerRow + i + 2;
        const out: ImportRow = { line, raw: r, status: 'error', reason: '' };
        try {
            const get = (k: Field) => m[k] >= 0 ? (r[m[k]] || '').trim() : '';
            const currency = get('currency');
            if (currency && !/^(CNY|RMB|人民币|元|￥|¥|HKD)$/i.test(currency))
                throw Error('只支持人民币，银证转账可使用港币');
            let type = kind(get('type'));
            if (get('type') && !type)
                throw Error('未知收支类型：' + get('type'));
            let amount: number;
            if (hasSingle) {
                const a = signedAmount(get('amount'));
                type = type || o.fallbackType || undefined;
                if (!type)
                    throw Error('缺少收支类型，请映射类型列或明确统一类型');
                if (a.negative && type !== 'expense')
                    throw Error('负金额与收支类型矛盾，请核对');
                amount = a.value;
            }
            else {
                const inc = cleanAmount(get('income'));
                const exp = cleanAmount(get('expense'));
                const isZero = (s: string) => !s || /^0+(\.0+)?$/.test(s);
                const hasIn = !isZero(inc), hasOut = !isZero(exp);
                if (hasIn === hasOut)
                    throw Error('收入和支出须恰有一列为非零金额');
                const derived = hasIn ? 'income' : 'expense';
                if (type && type !== derived)
                    throw Error('金额分列与收支类型矛盾');
                type = derived;
                amount = signedAmount(hasIn ? inc : exp).value;
                if ((hasIn ? inc : exp).startsWith('-'))
                    throw Error('分列金额请填写正数');
            }
            const original = type === 'refund' ? [...l.transactions, ...result.transactions].find(t => t.type === 'expense' && t.status === 'posted' && (t.externalId === get('original') || t.id === get('original'))) : undefined;
            if (type === 'refund' && !original)
                throw Error('退款需映射原消费流水号，且原消费需先存在于账本或本文件前面的行');
            const account = o.accounts[get('account')];
            if (!account || !l.accounts.some(a => a.id === account))
                throw Error('资金账户未映射：' + (get('account') || '空白'));
            const to = ['transfer', 'repayment'].includes(type) ? o.accounts[get('to')] || '' : '';
            const category = o.categories[get('category')];
            if (!category || !l.categories.some(c => c.id === category))
                throw Error('分类未映射：' + (get('category') || '空白'));
            const date = parseImportDate(get('date'), o.dateOrder);
            const t: Tx = { id: newId(), type, amount, date, account, to, category, merchant: get('merchant') || get('note') || types[type], note: get('note'), channel: resolveChannel(l, get('channel'))?.name || get('channel'), status: 'posted', batch: o.batch, externalId: get('externalId') || undefined, source: 'import', sourceRow: line, time: (get('time') || get('date').match(/[ T]([0-2]\d:[0-5]\d)/)?.[1] || '') || undefined, timezone: 'Asia/Shanghai', original: original?.id, tags: get('tags').split(/[,，、]/).map(t => t.trim()).filter(Boolean), adjustmentSide: type === 'adjustment' ? (/^(increase|增加)$/.test(get('adjustmentSide')) ? 'increase' : /^(decrease|减少)$/.test(get('adjustmentSide')) ? 'decrease' : undefined) : undefined };
            if (currency.toUpperCase() === 'HKD' || get('toAmount') || get('toCurrency')) {
                t.currency = currency.toUpperCase() === 'HKD' ? 'HKD' : 'CNY';
                t.toAmount = get('toAmount') ? cents(cleanAmount(get('toAmount'))) : undefined;
                const toCurrency = get('toCurrency').toUpperCase();
                if (!['CNY', 'HKD'].includes(toCurrency)) throw Error('请填写到账币种 CNY 或 HKD');
                t.toCurrency = toCurrency as 'CNY' | 'HKD';
            }
            validate({ ...l, transactions: type === 'refund' ? [...l.transactions, ...result.transactions, t] : [t] });
            const key = fingerprint(t);
            const old = (t.externalId ? ext.get(t.externalId) : undefined) || (o.duplicate === 'replace' ? existing.find(x => fingerprint(x) === key) : undefined);
            if (old && fingerprint(old) !== key && o.duplicate !== 'replace')
                throw Error('同一外部流水号内容不同，请核对原记录');
            if ((old || keys.has(key)) && o.duplicate === 'skip') {
                out.status = 'duplicate';
                out.reason = old ? '外部流水号已存在' : '日期、金额、账户、商户等相同';
                out.tx = t;
                result.counts.duplicate++;
            }
            else {
                out.status = 'ready';
                out.reason = old && o.duplicate === 'replace' ? '将覆盖已匹配的原记录' : old || keys.has(key) ? '按你的选择作为新记录' : '可以导入';
                if (old && o.duplicate === 'replace') {
                    if (result.transactions.some(x => x.id === old.id))
                        throw Error('文件内多行将覆盖同一记录，请先核对');
                    t.id = old.id;
                }
                out.tx = t;
                result.transactions.push(t);
                result.counts.ready++;
                keys.add(key);
                if (t.externalId)
                    ext.set(t.externalId, t);
                if (type === 'expense')
                    result.expense += amount;
                if (type === 'income')
                    result.income += amount;
            }
        }
        catch (e) {
            out.reason = (e as Error).message;
            result.counts.error++;
        }
        result.rows.push(out);
    }
    if (l.transactions.length + result.transactions.filter(t => !existing.some(x => x.id === t.id)).length > 50000)
        throw Error('导入后超过 50000 笔上限，请先整理账本或缩小导入范围');
    return result;
}
export function rollbackBatch(l: Ledger, id: string): Ledger {
    const batch = l.importBatches?.find(b => b.id === id);
    const previous = new Map((batch?.previousTransactions || []).map(t => [t.id, t]));
    for (const expected of batch?.appliedTransactions || []) {
        const current = l.transactions.find(t => t.id === expected.id);
        if (current && JSON.stringify(current) !== JSON.stringify(expected))
            throw Error('此批次的覆盖记录在导入后又被修改，请从操作历史核对恢复，避免丢失后续编辑');
    }
    const ids = new Set(l.transactions.filter(t => t.batch === id).map(t => t.id));
    if (l.transactions.some(t => t.status === 'posted' && t.type === 'refund' && t.original && ids.has(t.original) && !ids.has(t.id) && !previous.has(t.original)))
        throw Error('此批次有后续退款，请先处理关联退款');
    const next = { ...l, transactions: l.transactions.map(t => previous.get(t.id) || (t.batch === id ? { ...t, status: 'deleted' as const } : t)), importBatches: l.importBatches?.map(b => b.id === id ? { ...b, rolledBack: true } : b) };
    validate(next);
    return next;
}
