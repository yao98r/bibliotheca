天河 PDF 畫質工坊 1.0.0
Windows 10 / 11，64 位元。本機處理，不需要 Python、網站登入或網路。

使用方式
1. 執行 TianhePDF-Setup-1.0.0.exe，安裝到自己的使用者目錄。
2. 開啟「天河 PDF 畫質工坊」，選擇 PDF。
3. 選擇 300、600 或 800 DPI；一般閱讀建議先用 300。
4. 如需移除文字或註解浮水印，勾選選項並輸入完整辨識文字，以逗號分隔。
5. 按「開始處理」，選擇輸出資料夾。原始 PDF 不會被覆寫。
6. 完成後取得新的 PDF 與同名 .report.json，包含雜湊、處理項目、逐頁尺寸及渲染檢查。

功能與界線
- 增強嵌入的掃描影像，保留文字層、向量圖、頁面尺寸與旋轉方向。
- Lanczos4 放大與輕度銳化，不是生成式 AI；無法恢復掃描時已遺失的細節。
- 只移除使用者指定的文字、註解內容及相關連結；不擦除已燒錄在圖片中的水印。
- 含透明遮罩或超過 8,500 萬像素的影像會保留原樣並列在報告，不會靜默降畫質。
- 大檔逐頁保存工作副本以降低累積記憶體；單張 800 DPI 彩色圖仍需要數百 MB 以上記憶體。
- 高 DPI 會增加時間與檔案大小；處理時請保持足夠可用磁碟空間。
- 取消會在目前影像／儲存操作結束後安全停止。未完成輸出會清理，原檔保留。
- 加密 PDF 請先使用已解鎖副本。數位簽章文件被修改後，原簽章不再代表新檔內容。
- 尚未以 361 頁、800 DPI 整本進行桌面壓力測試。

安裝與解除安裝
安裝不要求管理員權限，可選擇建立桌面捷徑。
在 Windows「已安裝的應用程式」中可解除安裝；不刪除使用者輸出的 PDF。
這是自行建置的未簽章程式，沒有商業程式碼簽章憑證。

原始碼與建置
Source 目錄包含 app.py、engine.py、測試及 requirements.txt。
使用 Python 3.11，pip install -r requirements.txt。
python -m unittest -v test_engine.py
python -m PyInstaller --noconfirm --clean --windowed --onedir --name TianhePDF --collect-all pymupdf app.py
使用 Inno Setup 7 編譯 installer.iss。
原始碼以 GNU AGPL v3 或更新版本提供；第三方元件各自保留原授權，見 Licenses。
PyMuPDF: https://github.com/pymupdf/PyMuPDF/tree/1.26.7
OpenCV: https://github.com/opencv/opencv/tree/4.12.0
NumPy: https://github.com/numpy/numpy/tree/v2.2.6
PyInstaller: https://github.com/pyinstaller/pyinstaller
