import { fileDigest } from './ids.ts';
import { parseCSV } from './importer.ts';
export type WorkbookData = {
    name: string;
    hash: string;
    sheets: {
        name: string;
        rows: string[][];
    }[];
};
export async function readWorkbook(file: File): Promise<WorkbookData> {
    if (file.size > 10 * 1024 * 1024)
        throw Error('文件超过 10 MB，请拆分后导入');
    const buffer = await file.arrayBuffer();
    const hash = await fileDigest(buffer);
    if (/\.(csv|tsv)$/i.test(file.name)) {
        let s = new TextDecoder('utf-8').decode(buffer);
        if (s.includes('\uFFFD'))
            s = new TextDecoder('gb18030').decode(buffer);
        return { name: file.name, hash, sheets: [{ name: '账单', rows: parseCSV(s.replace(/^\uFEFF/, '')) }] };
    }
    if (!/\.xlsx?$/i.test(file.name))
        throw Error('请选择 CSV、XLS 或 XLSX 文件');
    const XLSX = await import('xlsx');
    const book = XLSX.read(buffer, { type: 'array', cellDates: false, cellFormula: false, cellNF: true, sheetRows: 10052 });
    if (!book.SheetNames.length)
        throw Error('工作簿没有可读取的工作表');
    const sheets = book.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: true, defval: '', blankrows: true }).map((r, i) => r.map((value, j) => {
            const cell = book.Sheets[name][XLSX.utils.encode_cell({ r: i, c: j })];
            const format = String(cell?.z || '');
            const hasTime = /[hHsS]/.test(format), timeOnly = hasTime && !/[yYdD]/.test(format);
            const pad = (n: number) => String(n).padStart(2, '0');
            if (value instanceof Date) {
                const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`, time = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
                return timeOnly ? time : date + (hasTime ? ' ' + time : '');
            }
            if (typeof value === 'number' && cell?.z && XLSX.SSF.is_date(cell.z)) {
                const d = XLSX.SSF.parse_date_code(value, { date1904: book.Workbook?.WBProps?.date1904 });
                if (d) {
                    const date = `${d.y}-${pad(d.m)}-${pad(d.d)}`, time = `${pad(d.H)}:${pad(d.M)}`;
                    return timeOnly ? time : date + (hasTime ? ' ' + time : '');
                }
            }
            return String(value);
        })) }));
    return { name: file.name, hash, sheets };
}
export async function exportExcel(rows: unknown[][], name: string) {
    const XLSX = await import('xlsx');
    const book = XLSX.utils.book_new();
    const amountColumn = rows[0]?.findIndex(v => v === '金额') ?? -1;
    const normalized = rows.map((r, i) => r.map((v, j) => i > 0 && j === amountColumn && typeof v === 'string' && /^\d+(\.\d{1,2})?$/.test(v) ? Number(v) : v));
    const ws = XLSX.utils.aoa_to_sheet(normalized);
    if (amountColumn >= 0)
        for (let i = 1; i < rows.length; i++) {
            const cell = ws[XLSX.utils.encode_cell({ r: i, c: amountColumn })];
            if (cell)
                cell.z = '0.00';
        }
    XLSX.utils.book_append_sheet(book, ws, '流水');
    XLSX.writeFile(book, name, { compression: true });
}
