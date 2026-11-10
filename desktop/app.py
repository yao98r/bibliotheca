import json
import os
import queue
import sys
import threading
import time
from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from engine import process_pdf, Cancelled

def main():
    root = tk.Tk()
    root.title('天河 PDF 畫質工坊 1.0')
    root.geometry('820x660')
    root.minsize(700, 620)
    root.configure(bg='#f3ead9')
    style = ttk.Style()
    style.theme_use('clam')
    style.configure('.', font=('Microsoft JhengHei', 11), background='#f3ead9', foreground='#302820')
    style.configure('TButton', padding=8)
    style.configure('TProgressbar', background='#805236')
    frame = ttk.Frame(root, padding=28)
    frame.pack(fill='both', expand=True)
    frame.columnconfigure(0, weight=1)
    ttk.Label(frame, text='天河 PDF 畫質工坊', font=('Microsoft JhengHei', 22, 'bold')).grid(row=0, column=0, sticky='w')
    ttk.Label(frame, text='本機處理 · 保留原檔 · 不需登入或上傳', foreground='#806d5a').grid(row=1, column=0, sticky='w', pady=(6,20))
    selected = tk.StringVar(value='尚未選擇 PDF')
    source = [None]
    outdir = [None]
    busy = [False]
    stop = threading.Event()
    events = queue.Queue()
    def choose():
        path = filedialog.askopenfilename(title='選擇 PDF', filetypes=[('PDF 文件', '*.pdf')])
        if path:
            source[0] = Path(path)
            selected.set(path)
    picker = ttk.Button(frame, text='選擇 PDF', command=choose)
    picker.grid(row=2, column=0, sticky='w')
    ttk.Label(frame, textvariable=selected, wraplength=730).grid(row=3, column=0, sticky='w', pady=10)
    controls = ttk.Frame(frame)
    controls.grid(row=4, column=0, sticky='ew', pady=8)
    ttk.Label(controls, text='目標解析度').pack(side='left')
    dpi = ttk.Combobox(controls, values=['300', '600', '800'], state='readonly', width=8)
    dpi.set('300')
    dpi.pack(side='left', padx=12)
    sharp = tk.BooleanVar(value=True)
    sharpbox = ttk.Checkbutton(controls, text='輕度銳化', variable=sharp)
    sharpbox.pack(side='left', padx=10)
    removal = tk.BooleanVar(value=False)
    removebox = ttk.Checkbutton(frame, text='移除指定的文字／註解浮水印', variable=removal)
    removebox.grid(row=5, column=0, sticky='w', pady=8)
    terms = ttk.Entry(frame)
    terms.insert(0, 'xyz66.ai, xyz88.com')
    terms.grid(row=6, column=0, sticky='ew')
    ttk.Label(frame, text='以逗號分隔。只移除符合的文字、註解與連結；圖片內的浮水印會保留。\n放大不會恢復原掃描已遺失的細節；高 DPI 會增加時間與檔案大小。', wraplength=730, foreground='#806d5a').grid(row=7, column=0, sticky='w', pady=10)
    status = tk.StringVar(value='選擇檔案後，按「開始處理」並選擇輸出資料夾。')
    timing = tk.StringVar(value='')
    bar = ttk.Progressbar(frame, maximum=100)
    bar.grid(row=9, column=0, sticky='ew', pady=(18,8))
    ttk.Label(frame, textvariable=status, wraplength=730).grid(row=10, column=0, sticky='w')
    ttk.Label(frame, textvariable=timing, foreground='#806d5a').grid(row=11, column=0, sticky='w', pady=8)
    buttons = ttk.Frame(frame)
    buttons.grid(row=8, column=0, sticky='w')
    def set_busy(value):
        busy[0] = value
        for widget in (picker, start, sharpbox, removebox, terms):
            widget.configure(state='disabled' if value else 'normal')
        dpi.configure(state='disabled' if value else 'readonly')
        cancel.configure(state='normal' if value else 'disabled')
    def start_work():
        if not source[0]:
            messagebox.showinfo('請先選擇 PDF', '請選擇要處理的 PDF 檔案。')
            return
        directory = filedialog.askdirectory(title='選擇輸出資料夾', initialdir=str(source[0].parent))
        if not directory:
            return
        outdir[0] = directory
        destination = Path(directory) / (source[0].stem + '_增強_' + dpi.get() + 'DPI_' + time.strftime('%Y%m%d_%H%M%S') + '.pdf')
        options = (source[0], destination, int(dpi.get()), [t.strip() for t in terms.get().replace('，', ',').split(',')] if removal.get() else [], sharp.get())
        stop.clear()
        set_busy(True)
        bar['value'] = 0
        status.set('正在檢查來源並建立工作副本…')
        timing.set('預估剩餘時間：估算中…')
        def worker():
            try:
                report = process_pdf(*options, progress=lambda *args: events.put(('progress', args)), cancelled=stop.is_set)
                events.put(('done', (destination, report)))
            except Exception as error:
                events.put(('error', str(error)))
        threading.Thread(target=worker, daemon=True).start()
    start = ttk.Button(buttons, text='開始處理', command=start_work)
    start.pack(side='left')
    cancel = ttk.Button(buttons, text='取消', state='disabled', command=lambda: (stop.set(), status.set('正在安全停止，完成目前影像操作後取消…')))
    cancel.pack(side='left', padx=10)
    ttk.Button(buttons, text='開啟輸出資料夾', command=lambda: os.startfile(outdir[0]) if outdir[0] else None).pack(side='left')
    def poll():
        while not events.empty():
            kind, value = events.get()
            if kind == 'progress':
                current, total, label, elapsed = value
                bar['value'] = current / total * 100
                if not stop.is_set():
                    status.set(label)
                remaining = ('約 %d 分鐘（後續壓縮及驗證另計）' % max(1, int(elapsed / current * (total-current) / 60 + .99))) if 0 < current < total else '估算中…'
                timing.set('已處理 %d 分 %02d 秒 · 剩餘時間：%s' % (elapsed//60, elapsed%60, remaining))
            elif kind == 'done':
                destination, report = value
                set_busy(False)
                status.set('完成：' + str(destination))
                timing.set('共 %d 頁 · %.1f 秒 · 增強 %d 張影像 · 提醒 %d 項（詳見同名 report.json）' % (len(report['pages']), report['seconds'], report['enhanced_images'], len(report['warnings'])))
                messagebox.showinfo('處理完成', 'PDF 已另存，原檔保持不變。\n' + str(destination))
            else:
                set_busy(False)
                status.set(value)
                timing.set('原檔保持不變；未完成的輸出已清理。')
        root.after(200, poll)
    def close():
        if busy[0]:
            stop.set()
            messagebox.showinfo('正在停止', '已送出取消要求，請等目前操作停止後再關閉。')
        else:
            root.destroy()
    root.protocol('WM_DELETE_WINDOW', close)
    poll()
    root.mainloop()

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--process':
        try:
            result = process_pdf(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv)>4 else 300)
            Path(sys.argv[3] + '.cli-result.json').write_text(json.dumps(result), encoding='utf-8')
        except Exception as error:
            Path(sys.argv[3] + '.error.txt').write_text(str(error), encoding='utf-8')
            sys.exit(1)
    else:
        main()
