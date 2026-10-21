import { channelDefault, detectChannel, resolveChannel, validatePaymentChannels, type PaymentChannel } from './channels.ts';
import { chineseNumber } from './chinese-number.ts';
import { validateExtensions } from './validate-extensions.ts';
import { type Category, type LedgerExtensions } from './extensions.ts';
import { newId } from './ids.ts';
import { hasHKDBalance, validateAccountCurrencies } from './account-currency.ts';
import { hkConvert, hkPortfolio } from './hk-securities.ts';
import { isCurrencyTransfer, validateCurrencyTransfer } from './hk-transfers.ts';
export type Account = {
    id: string;
    name: string;
    kind: 'asset' | 'debt';
    subtype?: 'securities';
    opening: number;
    region?: 'mainland' | 'hongkong';
    openingHKD?: number;
    hkdToCNY?: string;
    hkdRateAt?: string;
    active?: boolean;
    billDay?: number;
    payDay?: number;
    creditLimit?: number;
};
export const accountTypeNames = { asset: '资产账户', debt: '信用卡 / 负债', securities: '证券账户（人民币汇总）' };
export const accountType = (a: Account): keyof typeof accountTypeNames => a.kind === 'asset' && a.subtype === 'securities' ? 'securities' : a.kind;
export type Tx = {
    id: string;
    type: 'expense' | 'income' | 'transfer' | 'repayment' | 'refund' | 'adjustment';
    amount: number;
    currency?: 'CNY' | 'HKD';
    toAmount?: number;
    toCurrency?: 'CNY' | 'HKD';
    date: string;
    time?: string;
    timezone?: string;
    account: string;
    to: string;
    channel: string;
    category: string;
    merchant: string;
    note: string;
    status: 'posted' | 'pending' | 'deleted';
    batch?: string;
    original?: string;
    tags?: string[];
    splitGroup?: string;
    externalId?: string;
    source?: 'manual' | 'import' | 'text';
    sourceRow?: number;
    adjustmentSide?: 'increase' | 'decrease';
    recurrenceKey?: string;
    createdAt?: string;
    updatedAt?: string;
    fee?: number;
    feeParent?: string;
};
export type ImportBatch = {
    id: string;
    name: string;
    fileHash: string;
    sheet: string;
    created: string;
    count: number;
    duplicates: number;
    errors: number;
    income: number;
    expense: number;
    rolledBack?: boolean;
    previousTransactions?: Tx[];
    appliedTransactions?: Tx[];
};
export type Ledger = LedgerExtensions & {
    accounts: Account[];
    categories: Category[];
    transactions: Tx[];
    budget: number;
    defaultAccount: string;
    channels: Record<string, string>;
    paymentChannels?: PaymentChannel[];
    importBatches?: ImportBatch[];
};
export const types: Record<Tx['type'], string> = { expense: '支出', income: '收入', transfer: '内部转账', repayment: '信用卡还款', refund: '退款', adjustment: '余额调整' };
export const initial: Ledger = { accounts: [{ id: 'cmb', name: '招商银行信用卡', kind: 'debt', opening: 0 }, { id: 'bank', name: '银行卡（借记卡）', kind: 'asset', opening: 0 }, { id: 'wechat', name: '微信零钱', kind: 'asset', opening: 0 }, { id: 'alipay', name: '支付宝余额', kind: 'asset', opening: 0 }, { id: 'huabei', name: '花呗', kind: 'debt', opening: 0 }, { id: 'cash', name: '现金', kind: 'asset', opening: 0 }], categories: ['餐饮', '日用购物', '交通出行', '居住账单', '娱乐旅行', '通讯数码', '医疗健康', '教育学习', '人情往来', '其他', '工资收入'].map((name, i) => ({ id: 'c' + i, name })), transactions: [], budget: 0, defaultAccount: 'cmb', channels: { '支付宝': 'cmb', '微信': 'cmb', '线下刷卡': 'cmb', '现金': 'cash' } };
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const cents = (s: string) => {
    s = s.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s.trim()))
        throw Error('金额应为正数，最多两位小数');
    const [a, b = ''] = s.split('.');
    const n = Number(a) * 100 + Number(b.padEnd(2, '0'));
    if (!Number.isSafeInteger(n) || n <= 0 || n > 100000000000)
        throw Error('金额超出范围');
    return n;
};
export const money = (n: number) => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n / 100);
export function nativeBalances(l: Ledger) {
    const b = Object.fromEntries(l.accounts.map(a => [a.id, a.opening]));
    const hkd = Object.fromEntries(l.accounts.map(a => [a.id, a.openingHKD || 0]));
    const delta = (id: string, n: number) => {
        const a = l.accounts.find(a => a.id === id);
        if (a)
            b[id] += a.kind === 'debt' ? -n : n;
    };
    for (const t of l.transactions.filter(t => t.status === 'posted')) {
        if (isCurrencyTransfer(l, t)) {
            const hk = l.hkSecurities?.accounts || [];
            if (!hk.some(a => a.id === t.account)) (t.currency === 'HKD' ? hkd : b)[t.account] -= t.amount;
            if (!hk.some(a => a.id === t.to)) (t.toCurrency === 'HKD' ? hkd : b)[t.to] += t.toAmount!;
            continue;
        }
        if (t.type === 'adjustment')
            b[t.account] += (t.adjustmentSide === 'decrease' ? -1 : 1) * t.amount;
        if (t.type === 'expense')
            delta(t.account, -t.amount);
        if (t.type === 'income' || t.type === 'refund')
            delta(t.account, t.amount);
        if (t.type === 'transfer' || t.type === 'repayment') {
            delta(t.account, -t.amount);
            delta(t.to, t.amount);
        }
    }
    for (const e of l.digital?.events || [])
        if (e.status === 'posted' && e.fiatAccount && ['buy', 'sell'].includes(e.type))
            b[e.fiatAccount] += (e.type === 'buy' ? -1 : 1) * e.fiatCNY;
    if (l.hkSecurities) {
        for (const e of l.hkSecurities.events) {
            if (e.status !== 'posted' || !e.fiatAccount) continue;
            const sign = ['deposit', 'buy'].includes(e.type) ? -1 : 1;
            if (e.fiatCurrency === 'HKD' && e.fiatHKD !== undefined) hkd[e.fiatAccount] += sign * e.fiatHKD;
            else if (e.fiatCNY !== undefined) b[e.fiatAccount] += sign * e.fiatCNY;
        }
        for (const account of hkPortfolio(l.hkSecurities, l.transactions).accounts) b[account.id] = account.cny;
    }
    return { CNY: b, HKD: hkd };
}
export function balances(l: Ledger) {
    const native = nativeBalances(l);
    return Object.fromEntries(l.accounts.map(a => [a.id, native.CNY[a.id] + (hasHKDBalance(a) && native.HKD[a.id] ? hkConvert(native.HKD[a.id], a.hkdToCNY || '') : 0)]));
}
export function totals(tx: Tx[]) { return tx.filter(t => t.status === 'posted').reduce((s, t) => ({ income: s.income + (t.type === 'income' ? t.amount : 0), expense: s.expense + (t.type === 'expense' ? t.amount : t.type === 'refund' ? -t.amount : 0) }), { income: 0, expense: 0 }); }
export function validate(l: Ledger) {
    if (!l || !Array.isArray(l.accounts) || !Array.isArray(l.transactions) || !Array.isArray(l.categories))
        throw Error('账本格式无效');
    if (l.transactions.length > 50000)
        throw Error('当前版本最多支持 50000 笔流水');
    if (!l.accounts.length || l.accounts.length > 100 || !l.categories.length || l.categories.length > 200)
        throw Error('账户需 1 至 100 个，分类需 1 至 200 个');
    const str = (v: unknown, max = 200) => typeof v === 'string' && v.length <= max;
    if (l.categories.some(c => !c || !str(c.id) || !c.id || !str(c.name, 100) || !c.name.trim()) || new Set(l.categories.map(c => c.id)).size !== l.categories.length)
        throw Error('分类无效');
    validateExtensions(l);
    const accounts = new Map(l.accounts.map(a => [a.id, a]));
    const categories = new Set(l.categories.map(c => c.id));
    if (accounts.size !== l.accounts.length || new Set(l.transactions.map(t => t.id)).size !== l.transactions.length)
        throw Error('重复 ID');
    if (!accounts.has(l.defaultAccount) || !l.channels || typeof l.channels !== 'object' || Array.isArray(l.channels) || Object.values(l.channels).some(id => !accounts.has(id)))
        throw Error('默认账户无效');
    validatePaymentChannels(l);
    if (!Number.isSafeInteger(l.budget) || l.budget < 0)
        throw Error('预算无效');
    for (const a of l.accounts) {
        if (!a || !str(a.id) || !a.id || !str(a.name, 100) || !a.name.trim() || !['asset', 'debt'].includes(a.kind) || (!Number.isSafeInteger(a.opening) || Math.abs(a.opening) > 1000000000000))
            throw Error('账户格式无效');
    }
    validateAccountCurrencies(l);
    const txs = new Map(l.transactions.map(t => [t.id, t]));
    const refunds = new Map<string, number>();
    for (const t of l.transactions) {
        if (!t || !str(t.id) || !t.id || !str(t.merchant, 500) || !str(t.note, 4000) || !str(t.channel, 100) || !categories.has(t.category) || !Object.keys(types).includes(t.type) || !['posted', 'pending', 'deleted'].includes(t.status) || !Number.isSafeInteger(t.amount) || t.amount <= 0 || t.amount > 100000000000 || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || isNaN(Date.parse(t.date)) || new Date(t.date).toISOString().slice(0, 10) !== t.date)
            throw Error('流水金额、日期、说明或类型无效');
        if (isCurrencyTransfer(l, t)) validateCurrencyTransfer(l, t);
        else if ((t.currency !== undefined && t.currency !== 'CNY') || t.toAmount !== undefined || t.toCurrency !== undefined) throw Error('独立币种及到账金额仅用于资金转账');
        if (t.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time))
            throw Error('发生时间无效');
        if (t.timezone && t.timezone !== 'Asia/Shanghai')
            throw Error('当前账本使用 UTC+8 时区');
        if (t.fee !== undefined && (!Number.isSafeInteger(t.fee) || t.fee < 0 || t.fee > 100000000000))
            throw Error('手续费金额无效');
        if (t.feeParent && (!txs.has(t.feeParent) || t.type !== 'expense'))
            throw Error('手续费关联无效');
        if (t.type === 'adjustment' && !['increase', 'decrease'].includes(t.adjustmentSide || ''))
            throw Error('请选择余额增加或减少');
        if (!accounts.has(t.account))
            throw Error('请选择实际资金账户');
        if (t.tags !== undefined && (!Array.isArray(t.tags) || t.tags.length > 20 || t.tags.some(tag => !str(tag, 40) || !tag.trim())))
            throw Error('标签最多 20 个，每个需 1 至 40 字');
        if (t.externalId !== undefined && !str(t.externalId))
            throw Error('外部流水号无效');
        if (t.splitGroup !== undefined && (!str(t.splitGroup) || t.splitGroup === t.id))
            throw Error('拆分关联无效');
        if (t.splitGroup && t.status === 'posted' && txs.get(t.splitGroup)?.status === 'posted')
            throw Error('原消费已有拆分流水，不能同时恢复原记录；请先删除拆分项');
        if (['transfer', 'repayment'].includes(t.type) && t.status === 'posted') {
            if (!accounts.has(t.to) || t.to === t.account)
                throw Error('转出和转入账户必须不同');
            if (t.type === 'repayment' && (accounts.get(t.account)?.kind !== 'asset' || accounts.get(t.to)?.kind !== 'debt'))
                throw Error('还款须从资产账户转入负债账户');
        }
        if (t.type === 'refund' && t.status === 'posted') {
            const orig = t.original ? txs.get(t.original) : undefined;
            if (!orig || orig.type !== 'expense' || orig.status !== 'posted' || orig.account !== t.account)
                throw Error('退款须关联同一账户的原支出');
            refunds.set(orig.id, (refunds.get(orig.id) || 0) + t.amount);
        }
    }
    for (const [id, amount] of refunds)
        if (amount > txs.get(id)!.amount)
            throw Error('累计退款不能超过原支出');
    if (l.importBatches !== undefined) {
        if (!Array.isArray(l.importBatches) || l.importBatches.length > 10000)
            throw Error('导入批次无效');
        for (const b of l.importBatches) {
            if (!b || !str(b.id) || !str(b.name, 500) || !str(b.sheet) || !str(b.fileHash) || !str(b.created) || isNaN(Date.parse(b.created)) || ![b.count, b.duplicates, b.errors, b.income, b.expense].every(v => Number.isSafeInteger(v) && v >= 0))
                throw Error('导入批次格式无效');
        }
    }
    if (l.hkSecurities) hkPortfolio(l.hkSecurities, l.transactions);
    if (l.accounts.some(hasHKDBalance) && Object.values(balances(l)).some(n => !Number.isSafeInteger(n))) throw Error('账户合计金额超出范围');
    return l;
}
export function parseText(input: string, l: Ledger): {
    rows: Tx[];
    warnings: string[];
} {
    const warnings: string[] = [];
    const parts = input.split(/[、;；\n]+|[，,](?=[^，,]*\d)/).filter(Boolean);
    const rows: Tx[] = [];
    for (const raw of parts) {
        let s = raw.replace(/([零〇一二两三四五六七八九十百千万亿点]+)(?=元|块)/g, (match) => chineseNumber(match) || match);
        let explicitTime = '';
        const tm = s.match(/(?:[01]?\d|2[0-3]):[0-5]\d/);
        if (tm) {
            explicitTime = tm[0].padStart(5, '0');
            s = s.replace(tm[0], '');
        }
        let explicitDate = '';
        const dm = s.match(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/);
        if (dm) {
            explicitDate = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
            s = s.replace(dm[0], '');
        }
        if (/USDT|USD|HKD|JPY|美元|港币|港元|日元|比特币|BTC/i.test(s)) {
            warnings.push('日常收支支持人民币；港币银证转账请用“手动记账 → 内部转账”填写两边实际金额。');
            continue;
        }
        const detected = detectChannel(l, s);
        let amountText = s;
        for (const token of detected.tokens)
            amountText = amountText.replaceAll(token, '');
        const nums = amountText.match(/\d+(?:\.\d{1,2})?/g);
        if (!nums || nums.length !== 1) {
            warnings.push('请每笔仅填写一个金额；日期可写“昨天”。');
            continue;
        }
        const type: Tx['type'] = /还款|还信用卡/.test(amountText) ? 'repayment' : /退款|退回/.test(amountText) ? 'refund' : /转给|转到|转入|充值|转.*到/.test(amountText) ? 'transfer' : /工资|收入|收到|到账/.test(amountText) ? 'income' : 'expense';
        let channel = detected.channel?.name || '';
        const explicitChannel = !!channel;
        let account = type === 'expense' ? channelDefault(l, channel) : '';
        const aliases = [['招商信用卡', 'cmb'], ['信用卡', 'cmb'], ['花呗', 'huabei'], ['微信零钱', 'wechat'], ['微信钱包', 'wechat'], ['支付宝余额', 'alipay'], ['借记卡', 'bank'], ['银行卡', 'bank'], ['现金', 'cash']];
        const tokens = [...l.accounts.filter(a => a.active !== false).map(a => [a.name, a.id]), ...aliases.filter(([, id]) => l.accounts.some(a => a.id === id))];
        const found = tokens.flatMap(([name, id]) => { const i = s.indexOf(name); return i < 0 || type === 'expense' && name !== '花呗' && detected.matches.some(m => i >= m.index && i + name.length <= m.index + m.token.length) ? [] : [{ id, index: i, length: name.length }]; }).sort((a, b) => a.index - b.index || b.length - a.length);
        const matches: typeof found = [];
        for (const token of found)
            if (!matches.some(t => token.index >= t.index && token.index < t.index + t.length))
                matches.push(token);
        if (matches.length)
            account = matches[0].id;
        let to = '';
        let pending = detected.ambiguous || detected.channel?.active === false;
        if (detected.ambiguous)
            warnings.push('识别到多个支付渠道，请选择本笔使用的渠道');
        if (detected.channel?.active === false)
            warnings.push('此支付渠道已停用，请确认或选择其他渠道');
        if (type === 'transfer' || type === 'repayment') {
            if (type === 'repayment') {
                to = matches.find(a => l.accounts.find(x => x.id === a.id)?.kind === 'debt')?.id || 'cmb';
                account = matches.find(a => l.accounts.find(x => x.id === a.id)?.kind === 'asset')?.id || '';
            }
            else {
                to = matches[1]?.id || '';
            }
            if (!account || !to || /朋友|转给/.test(s)) {
                pending = true;
                warnings.push('转账或还款需要确认用途及两个账户，请补充后保存。');
            }
        }
        if (type === 'income' && !account) {
            pending = true;
            warnings.push('请确认收入到账账户。');
        }
        if (type === 'refund') {
            pending = true;
            warnings.push('退款需要关联原支出，请在手动记账中选择。');
        }
        if (!account)
            account = l.accounts.find(a => a.kind === 'asset')?.id || l.defaultAccount;
        let cat = /饭|餐|咖啡|麦当劳|奶茶|外卖|吃/.test(s) ? 'c0' : /地铁|打车|停车|加油|公交/.test(s) ? 'c2' : /房租|水电/.test(s) ? 'c3' : /电影|旅行|演出/.test(s) ? 'c4' : /会员|订阅|话费/.test(s) ? 'c5' : /药|医院/.test(s) ? 'c6' : /书|课程/.test(s) ? 'c7' : /购物|买东西|超市/.test(s) ? 'c1' : type === 'income' ? 'c10' : 'c9';
        const namedCategory = l.categories.find(c => c.active !== false && s.includes(c.name));
        const merchantRule = l.merchantRules?.find(r => s.includes(r.match));
        if (namedCategory)
            cat = namedCategory.id;
        else if (merchantRule)
            cat = merchantRule.category;
        const merged = l.categories.find(c => c.id === cat);
        if (merged?.mergedInto)
            cat = merged.mergedInto;
        if (!l.categories.some(c => c.id === cat && c.active !== false))
            cat = l.categories.find(c => c.active !== false)?.id || cat;
        if (type === 'expense' && !matches.length && !explicitChannel && merchantRule?.account)
            account = merchantRule.account;
        if (!channel && !detected.ambiguous && merchantRule?.channel) {
            const configured = resolveChannel(l, merchantRule.channel);
            channel = configured?.name || merchantRule.channel;
            if (!configured?.active) {
                pending = true;
                warnings.push('商户规则使用了停用或未配置的渠道，请核对');
            }
            if (type === 'expense' && !matches.length && !merchantRule.account)
                account = channelDefault(l, channel);
        }
        if (l.accounts.find(a => a.id === account)?.active === false) {
            pending = true;
            warnings.push('默认资金账户已停用，请选择其他账户');
        }
        let date = explicitDate || today();
        if (/昨天/.test(s)) {
            const d = new Date(date + 'T12:00:00+08:00');
            d.setUTCDate(d.getUTCDate() - 1);
            date = d.toISOString().slice(0, 10);
        }
        if (/前天/.test(s)) {
            const d = new Date(today() + 'T12:00:00Z');
            d.setUTCDate(d.getUTCDate() - 2);
            date = d.toISOString().slice(0, 10);
        }
        const amount = cents(nums[0]);
        if (amount > 1000000) {
            pending = true;
            warnings.push('金额较大，请核对后保存');
        }
        if ([...l.transactions, ...rows].some(t => t.status !== 'deleted' && t.amount === amount && t.date === date && t.account === account)) {
            pending = true;
            warnings.push('存在同日、同金额、同账户流水，请检查是否重复。');
        }
        rows.push({ id: newId(), type, amount, date, time: explicitTime || undefined, timezone: 'Asia/Shanghai', account, to, channel, category: cat, merchant: s.replace(/\d+(\.\d+)?\s*(元|块钱|块)?/g, '').replace(/今天|昨天|刚才|花了|花|付了|付的|用了/g, '').trim() || '日常消费', note: l.preferences?.retainInput === false ? '' : raw, createdAt: new Date().toISOString(), source: 'text', tags: [...s.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map(m => m[1]), status: pending ? 'pending' : 'posted' });
    }
    return { rows, warnings: [...new Set(warnings)] };
}
