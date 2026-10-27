# Physics

三個入口共用 `guide.js` 與 `guide.css` 提供使用教學。第一次登入會顯示可跳過的引導；頁面上方的「使用教學」可重看，登入畫面也可先看安裝說明。

- 秘書：請假／加班、紀錄、代理與通知、修改密碼。
- 管理員：審核、換人接手、統計、系統密碼與通知。
- 檢視者：今天與近期出勤、動態、受信任記帳人員的完整資料入口。
- iPhone／iPad、Android、電腦各有加入主畫面與通知說明，可自動選擇或手動切換。

教學完成狀態只記在本機瀏覽器；秘書依帳號、任期及帳號的 `guideEpoch` 區分。提高該帳號的 `guideEpoch`，可讓已看過的人在下次登入或重新整理時再次看到教學。教學不會自動申請通知權限；「測試這台裝置的通知」只透過本機 Service Worker 顯示，不向同事廣播，也不代表已驗證遠端推播送達。

一般檢查：執行 `node tests/*.test.js` 中各支測試。瀏覽器導覽測試為 `node tests/guide.browser.test.mjs`（需要 Playwright 與 Edge；可用 `TPS_PLAYWRIGHT_PATH` 指定模組位置、`TPS_BROWSER_CHANNEL` 指定瀏覽器）。測試以假資料代替 Firebase，會驗證三個入口、裝置切換、重看、任期、焦點、手機寬度與本機通知。
