import type { Ledger, Tx } from './ledger.ts';
import { newId } from './ids.ts';
export type PaymentChannel = {
    id: string;
    name: string;
    active: boolean;
    aliases: string[];
};
const builtins: Record<string, string[]> = { '支付宝': ['花呗'], '微信': [], '线下刷卡': ['刷卡'], '现金': [], '银行转账': [] };
const key = (s: string) => s.normalize('NFKC').trim().toLowerCase();
const validName = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && s === s.trim() && s.length <= 100 && !/[\p{Cc}\p{Cf}]/u.test(s) && !['__proto__', 'prototype', 'constructor'].includes(key(s));
export function paymentChannels(l: Ledger): PaymentChannel[] {
    const configured = l.paymentChannels || [...new Set([...Object.keys(l.channels), '银行转账'])].map(name => ({ id: 'legacy:' + name, name, active: true, aliases: builtins[name] || [] }));
    const names = new Set(configured.flatMap(c => [c.name, ...c.aliases].map(key)));
    const references = [...l.transactions.map(t => t.channel), ...(l.recurring || []).map(r => r.channel), ...(l.merchantRules || []).map(r => r.channel || '')];
    return [...configured, ...[...new Set(references)].filter(name => { if (!name || names.has(key(name)))
            return false; names.add(key(name)); return true; }).map(name => ({ id: 'legacy:' + name, name, active: false, aliases: [] }))];
}
export function channelOptions(l: Ledger, current = '') {
    const all = paymentChannels(l);
    if (current && !all.some(c => c.name === current))
        all.push({ id: 'current:' + current, name: current, active: false, aliases: [] });
    return all.filter(c => c.active || c.name === current);
}
export function channelDefault(l: Ledger, name: string) { return Object.hasOwn(l.channels, name) ? l.channels[name] : l.defaultAccount; }
export function resolveChannel(l: Ledger, name: string) { const k = key(name); return paymentChannels(l).find(c => [c.name, ...c.aliases].some(s => key(s) === k)); }
export function detectChannel(l: Ledger, input: string) {
    const text = input.toLowerCase();
    const found = paymentChannels(l).flatMap(channel => [channel.name, ...channel.aliases].flatMap(name => { const index = text.indexOf(name.toLowerCase()); return index < 0 ? [] : [{ channel, token: input.slice(index, index + name.length), index }]; })).sort((a, b) => b.token.length - a.token.length || a.index - b.index);
    const matches: typeof found = [];
    for (const candidate of found)
        if (!matches.some(m => candidate.index < m.index + m.token.length && m.index < candidate.index + candidate.token.length))
            matches.push(candidate);
    const ids = new Set(matches.map(m => m.channel.id));
    return { channel: ids.size === 1 ? matches[0].channel : undefined, ambiguous: ids.size > 1, tokens: matches.map(m => m.token), matches };
}
export function channelUsage(l: Ledger, name: string) {
    const channel = resolveChannel(l, name), labels = new Set([name, ...(channel?.aliases || [])].map(key));
    const uses = (row: {
        channel?: string;
    }) => !!row.channel && labels.has(key(row.channel));
    const transactions = l.transactions.filter(uses).length;
    const templates = (l.recurring || []).filter(uses).length;
    const rules = (l.merchantRules || []).filter(uses).length;
    const imports = (l.importBatches || []).reduce((n, b) => n + [...(b.previousTransactions || []), ...(b.appliedTransactions || [])].filter(uses).length, 0);
    return { transactions, templates, rules, imports, total: transactions + templates + rules + imports };
}
export function normalizeChannelReferences(l: Ledger): Ledger {
    const names = new Map(paymentChannels(l).flatMap(c => [c.name, ...c.aliases].map(name => [key(name), c.name] as const)));
    const remap = <T extends {
        channel?: string;
    }>(row: T): T => { const name = row.channel && names.get(key(row.channel)); return name && name !== row.channel ? { ...row, channel: name } : row; };
    return { ...l, transactions: l.transactions.map(remap), recurring: l.recurring?.map(remap), merchantRules: l.merchantRules?.map(remap), importBatches: l.importBatches?.map(b => ({ ...b, ...(b.previousTransactions ? { previousTransactions: b.previousTransactions.map(remap) } : {}), ...(b.appliedTransactions ? { appliedTransactions: b.appliedTransactions.map(remap) } : {}) })) };
}
function materialize(l: Ledger, definitions: PaymentChannel[]): Ledger { return { ...l, paymentChannels: definitions, channels: Object.fromEntries(definitions.map(c => [c.name, channelDefault(l, c.name)])) }; }
export function savePaymentChannel(l: Ledger, edit: PaymentChannel, defaultAccount: string): Ledger {
    l = normalizeChannelReferences(l);
    const all = paymentChannels(l), old = all.find(c => c.id === edit.id);
    const nextChannel = { ...edit, name: edit.name.trim(), aliases: [...new Set(edit.aliases.map(a => a.trim()).filter(Boolean))] };
    if (old && old.name !== nextChannel.name)
        nextChannel.aliases = [...new Set([...nextChannel.aliases, old.name])];
    nextChannel.aliases = nextChannel.aliases.filter(a => key(a) !== key(nextChannel.name));
    const definitions = old ? all.map(c => c.id === edit.id ? nextChannel : c) : [...all, { ...nextChannel, id: edit.id || newId() }];
    let next = materialize(l, definitions);
    next.channels = { ...next.channels, [nextChannel.name]: defaultAccount };
    if (old && old.name !== nextChannel.name) {
        const remap = (t: Tx): Tx => t.channel === old.name ? { ...t, channel: nextChannel.name } : t;
        next = { ...next, transactions: l.transactions.map(remap), recurring: l.recurring?.map(r => r.channel === old.name ? { ...r, channel: nextChannel.name } : r), merchantRules: l.merchantRules?.map(r => r.channel === old.name ? { ...r, channel: nextChannel.name } : r), importBatches: l.importBatches?.map(b => ({ ...b, ...(b.previousTransactions ? { previousTransactions: b.previousTransactions.map(remap) } : {}), ...(b.appliedTransactions ? { appliedTransactions: b.appliedTransactions.map(remap) } : {}) })) };
    }
    validatePaymentChannels(next);
    return next;
}
export function removePaymentChannel(l: Ledger, id: string): Ledger {
    const all = paymentChannels(l), channel = all.find(c => c.id === id);
    if (!channel)
        throw Error('支付渠道不存在');
    if (channelUsage(l, channel.name).total)
        throw Error('此渠道仍被流水、模板、商户规则或导入回滚记录引用，请停用以保留历史');
    const next = materialize(l, all.filter(c => c.id !== id));
    validatePaymentChannels(next);
    return next;
}
export function validatePaymentChannels(l: Ledger) {
    if (Object.keys(l.channels).length > 200 || Object.keys(l.channels).some(n => !validName(n)))
        throw Error('支付渠道名称需为 1 至 100 字，最多 200 个渠道');
    if (l.paymentChannels === undefined)
        return;
    if (!Array.isArray(l.paymentChannels) || l.paymentChannels.length > 200)
        throw Error('支付渠道最多 200 个');
    const ids = new Set<string>(), labels = new Set<string>();
    for (const c of l.paymentChannels) {
        if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 200 || ids.has(c.id) || !validName(c.name) || typeof c.active !== 'boolean' || !Array.isArray(c.aliases) || c.aliases.length > 10 || c.aliases.some(a => !validName(a)))
            throw Error('渠道名称、状态或识别别名无效；别名最多 10 个');
        ids.add(c.id);
        for (const label of [c.name, ...c.aliases]) {
            const k = key(label);
            if (labels.has(k))
                throw Error('渠道名称或识别别名重复，请使用不同名称');
            labels.add(k);
        }
        if (!Object.hasOwn(l.channels, c.name) || !l.accounts.some(a => a.id === l.channels[c.name]))
            throw Error('请选择渠道对应的默认资金账户');
    }
    if (Object.keys(l.channels).length !== l.paymentChannels.length)
        throw Error('渠道设置不一致，请核对多设备合并结果');
}
