export function chineseNumber(s: string): string | null { const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }; if (/[百千万亿][一二两三四五六七八九]$/.test(s))
    return null; const [whole, fraction] = s.split('点'); let total = 0, section = 0, n = 0; const scale: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 }; for (const c of whole) {
    if (c in digits)
        n = digits[c];
    else if (c in scale) {
        const u = scale[c];
        if (u < 10000) {
            section += (n || 1) * u;
            n = 0;
        }
        else {
            section += n;
            total += (section || 1) * u;
            section = 0;
            n = 0;
        }
    }
    else
        return null;
} const value = total + section + n; if (!Number.isSafeInteger(value))
    return null; if (fraction) {
    if (fraction.length > 2 || [...fraction].some(c => !(c in digits)))
        return null;
    return value + '.' + [...fraction].map(c => digits[c]).join('');
} return String(value); }
