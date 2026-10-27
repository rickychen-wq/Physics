/* TPS 使用教學：只導覽介面，不送出申請、不變更帳號、不自動索取通知權限。 */
(function () {
  'use strict';
  var config, root, panel, content, previousFocus, originalScroll, peekTarget;
  var steps = [], index = 0, device = detectDevice(), seenInSession = {}, busy = false;
  var roleNames = { staff:'秘書', admin:'管理員', stats:'檢視者' };

  function detectDevice() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    return /Android/i.test(ua) ? 'android' : 'desktop';
  }
  function standalone() {
    return navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function loggedIn() { var app = document.querySelector('#app'); return app && !app.classList.contains('hide'); }
  function key() { return 'tps.guide.v1.' + config.role + '.' + (config.identity ? config.identity() : 'shared'); }
  function seen() {
    if (seenInSession[key()]) return true;
    try { return localStorage.getItem(key()) === 'seen'; } catch (e) { return false; }
  }
  function remember() {
    if (!loggedIn()) return;
    seenInSession[key()] = true;
    try { localStorage.setItem(key(), 'seen'); } catch (e) { /* 私密瀏覽仍可使用教學。 */ }
  }
  function escape(s) { return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function button(text, action, style) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tg-button ' + (style || '');
    b.textContent = text; b.onclick = action; return b;
  }
  function build() {
    root = document.createElement('div'); root.id = 'tpsGuide'; root.hidden = true;
    root.innerHTML = '<section class="tg-panel" role="dialog" aria-modal="true" aria-labelledby="tgTitle" aria-describedby="tgDesc" tabindex="-1">' +
      '<div class="tg-top"><span>TPS · 使用教學</span><button class="tg-close" type="button" aria-label="關閉教學">×</button></div>' +
      '<div class="tg-content"></div></section>';
    document.body.appendChild(root); panel = root.querySelector('.tg-panel'); content = root.querySelector('.tg-content');
    root.querySelector('.tg-close').onclick = close;
    root.addEventListener('click', function(e){ if(e.target === root) close(); });
    root.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){ e.preventDefault(); close(); return; }
      if(e.key !== 'Tab') return;
      var all = Array.prototype.filter.call(panel.querySelectorAll('button,a[href]'), function(b){ return !b.disabled && b.getClientRects().length; });
      if(!all.length){ e.preventDefault(); panel.focus(); return; }
      var first = all[0], last = all[all.length - 1];
      if(e.shiftKey && (document.activeElement === first || document.activeElement === panel)){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && peekTarget) resume(); });
    document.addEventListener('click', function(e){
      var b = e.target.closest('[data-tps-guide]');
      if(b) open(b.dataset.tpsGuide || 'welcome');
    });
  }
  function clearPeek() {
    if(peekTarget) peekTarget.classList.remove('tg-target');
    peekTarget = null;
    var bar = document.querySelector('#tgResume'); if(bar) bar.remove();
  }
  function present() {
    clearPeek(); root.hidden = false;
    originalScroll = window.scrollY;
    document.body.classList.add('tg-open');
    document.body.style.setProperty('--tg-scroll', '-' + originalScroll + 'px');
    // inert keeps keyboard and assistive-technology focus inside the tutorial.
    ['app','gate'].forEach(function(id){ var n = document.getElementById(id); if(n) n.inert = true; });
    panel.focus({preventScroll:true});
  }
  function hide() {
    root.hidden = true;
    document.body.classList.remove('tg-open'); document.body.style.removeProperty('--tg-scroll');
    ['app','gate'].forEach(function(id){ var n = document.getElementById(id); if(n) n.inert = false; });
    window.scrollTo(0, originalScroll || 0);
  }
  function close() {
    remember(); clearPeek();
    if(!root.hidden) hide();
    if(previousFocus && previousFocus.isConnected && previousFocus.getClientRects().length) previousFocus.focus({preventScroll:true});
  }
  function heading(title, text, badge) {
    var footer = panel.querySelector('.tg-footer'); if(footer) footer.remove();
    content.innerHTML = '<div class="tg-badge">' + escape(badge || roleNames[config.role] + '教學') + '</div>' +
      '<h2 id="tgTitle">' + escape(title) + '</h2><p id="tgDesc">' + escape(text) + '</p>';
    content.scrollTop = 0;
  }
  function actions() { var d = document.createElement('div'); d.className = 'tg-actions'; content.appendChild(d); return d; }
  function open(mode) {
    previousFocus = document.activeElement;
    if(!root.hidden) return;
    present();
    if(mode === 'install' || !loggedIn()) { steps = [{kind:'install'}, {kind:'notify'}]; index = 0; render(); }
    else welcome();
  }
  function welcome() {
    heading('第一次使用？一起看一下', '每次只介紹一個功能。可以跳過，之後按「使用教學」隨時重看。');
    var preview = document.createElement('div'); preview.className = 'tg-preview';
    preview.innerHTML = '<span class="tg-orb" aria-hidden="true">?</span><strong>' +
      ({staff:'請假、查紀錄、收通知',admin:'審核、管理人員、查統計',stats:'今天誰請假，一眼就知道'})[config.role] +
      '</strong><span>大字說明 · 一步一步操作</span>';
    content.appendChild(preview);
    var a = actions();
    a.appendChild(button('開始功能導覽', start));
    a.appendChild(button('加入主畫面／通知教學', function(){ steps = [{kind:'install'}, {kind:'notify'}]; index = 0; render(); }, 'tg-secondary'));
    a.appendChild(button('先跳過，以後再看', close, 'tg-text'));
  }
  function start() {
    steps = {
      staff:[
        {title:'從主頁申請請假與加班', text:'先看剩餘時數，再按「我要請假」或「我要加班」。填好日期、時間與必要欄位，確認時數後才送出。', page:'Home', target:'.acts', labels:['看剩餘時數','選請假／加班','填寫並確認時數']},
        {title:'審核進度與撤銷，在「紀錄」', text:'送出後可查看待審核、已核准或駁回的紀錄。待審核可以撤銷；已核准要提出撤銷申請，等秘書長同意。', page:'Rec', target:'#pRec .card', labels:['待審核','已核准／駁回','查看明細與撤銷']},
        {title:'審核結果與代理請求，在「通知」', text:'有人指定你當職務代理人時，要在這裡確認或拒絕。自己的審核結果及同事出勤動態，也會出現在這裡。', page:'Noti', target:'#notiList', labels:['代理請求','審核結果','同事出勤動態']},
        {title:'第一次登入，記得修改密碼', text:'在「設定」可查看自己的資料、修改登入密碼。若姓名或到職日有誤，請聯絡秘書長。', page:'Set', target:'#pBtn', labels:['確認個人資料','修改預設密碼','隨時重看教學']}
      ],
      admin:[
        {title:'進入後先看「審核」', text:'請假、加班和撤銷申請分開列出。核對人員、日期、時數後，再同意或駁回；需要代理人的假單，要等代理人先確認。', page:'Rev', target:'#lList', labels:['請假申請','加班申請','撤銷申請']},
        {title:'右上角選單，找到所有管理功能', text:'「帳號與時數」用來管理人員及餘額。固定信箱換人時請使用「換人接手」，讓新人的時數與前任紀錄分開。', page:'Acc', target:'#pAcc', labels:['右上角選單','帳號與時數','換人接手']},
        {title:'查明細與每月統計', text:'「完整紀錄」可篩選人員與狀態；「本月統計」可核對每月請假和加班時數。系統列出時數，薪資金額仍由記帳人員核算。', page:'Pay', target:'#pPay', labels:['完整紀錄','本月統計','核對請假與加班']},
        {title:'密碼與通知，在「系統設定」', text:'後台、檢視第一層、完整資料第二層是三組不同密碼。這裡也能設定這台裝置的手機通知。', page:'Sys', target:'#credentialCenter', labels:['後台密碼','檢視第一層','完整資料第二層']}
      ],
      stats:[
        {title:'先看今天誰請假', text:'「出勤總覽」最上面就是今天行政室。下方的近期請假會列出未來 30 天安排；注意「待審核」與「已核准」的差別。', page:'Cal', target:'#todayBoard', labels:['今天行政室','未來 30 天','待審核／已核准']},
        {title:'從「通知」追蹤最新動態', text:'有人提出申請、或秘書長同意與駁回時，可在這裡查看動態與設定手機通知。檢視系統用來查閱，審核由管理員後台處理。', page:'Noti', target:'#statsNotiList', labels:['提出申請','同意／駁回','手機通知']}
      ]
    }[config.role].slice();
    if(config.role === 'stats') {
      steps.push({title:'記帳人員可解鎖完整資料', text:'右上角「完整資料」提供受信任的記帳人員使用。輸入第二層密碼後，可查年度總表、目前時數、每月統計和明細，並匯出 Excel。一般檢視者看出勤總覽即可。',
        page:'Cal', target:'#lockBtn', labels:['完整資料','第二層密碼','統計與 Excel 匯出']});
    }
    steps.push({kind:'install'}, {kind:'notify'}); index = 0; render();
  }
  function render() {
    var s = steps[index]; busy = false;
    if(s.kind === 'install') install();
    else if(s.kind === 'notify') notify();
    else {
      heading(s.title, s.text);
      var list = document.createElement('ol'); list.className = 'tg-checklist';
      s.labels.forEach(function(text){ var li = document.createElement('li'); li.textContent = text; list.appendChild(li); });
      content.appendChild(list);
      content.appendChild(button('看看這個功能的位置', peek, 'tg-secondary tg-wide'));
    }
    var footer = document.createElement('div'); footer.className = 'tg-footer';
    var back = button('上一步', function(){ index--; render(); panel.focus({preventScroll:true}); }, 'tg-secondary'); back.disabled = index === 0;
    footer.appendChild(back);
    var progress = document.createElement('span'); progress.textContent = (index + 1) + ' / ' + steps.length; progress.setAttribute('aria-label','教學進度'); footer.appendChild(progress);
    footer.appendChild(button(index === steps.length - 1 ? '完成教學' : '下一步', function(){
      if(index === steps.length - 1) close(); else { index++; render(); panel.focus({preventScroll:true}); }
    })); panel.appendChild(footer);
  }
  function peek() {
    var s = steps[index];
    if(!loggedIn()) return;
    hide(); config.navigate(s.page);
    peekTarget = document.querySelector(s.target);
    if(peekTarget) { peekTarget.classList.add('tg-target'); peekTarget.scrollIntoView({block:'center',behavior:'instant'}); }
    var bar = document.createElement('div'); bar.id = 'tgResume';
    bar.appendChild(button('繼續教學 · 第 ' + (index + 1) + ' 步', resume));
    bar.appendChild(button('結束', close, 'tg-secondary')); document.body.appendChild(bar);
    bar.querySelector('button').focus({preventScroll:true});
  }
  function resume() { present(); render(); }
  function deviceTabs() {
    var tabs = document.createElement('div'); tabs.className = 'tg-devices'; tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','選擇裝置');
    [['ios','iPhone／iPad'],['android','Android'],['desktop','電腦']].forEach(function(d){
      var b = button(d[1], function(){ device = d[0]; render(); content.querySelector('[data-device="' + device + '"]').focus({preventScroll:true}); }, 'tg-secondary');
      b.dataset.device = d[0]; b.setAttribute('aria-pressed',device === d[0] ? 'true' : 'false'); tabs.appendChild(b);
    }); content.appendChild(tabs);
  }
  function instructions(items) {
    var ol = document.createElement('ol'); ol.className = 'tg-instructions';
    items.forEach(function(item){ var li = document.createElement('li'); li.textContent = item; ol.appendChild(li); }); content.appendChild(ol);
  }
  function note(text, cls) { var p = document.createElement('p'); p.className = cls || 'tg-note'; p.textContent = text; content.appendChild(p); return p; }
  function install() {
    heading('把系統放到手機主畫面', '請為目前使用的入口加入圖示，之後從圖示打開即可。已有圖示可直接到下一步。', '加入主畫面');
    deviceTabs();
    if(standalone()) note('目前已從 App 模式開啟，可以直接看通知設定。', 'tg-status');
    var names = {staff:'請假系統',admin:'管理員後台',stats:'加班休假檢視'};
    var preview = document.createElement('div'); preview.className = 'tg-app-preview';
    var img = document.createElement('img'); img.src = {staff:'icon-192.png',admin:'icon-admin.png',stats:'icon-stats.png'}[config.role]; img.alt = '';
    var label = document.createElement('span'); label.textContent = names[config.role] + ' · 目前入口'; preview.appendChild(img); preview.appendChild(label); content.appendChild(preview);
    if(device === 'ios') {
      instructions(['用 Safari 開啟這個網站。若從 LINE 開啟，先選擇用外部瀏覽器開啟。',
        '按「分享」（方框向上箭頭；有些版本要先打開更多選單）。',
        '選「加入主畫面」。若有「作為網頁 App 打開」選項，請保持開啟，再按「加入」。',
        '回到手機主畫面，點剛加入的圖示，登入後再開啟通知。']);
      note('找不到「加入主畫面」時，往下捲動分享選單，或到「編輯動作」加入。');
      source('Apple 官方說明','https://support.apple.com/zh-tw/guide/iphone/iphea86e5236/ios');
    } else if(device === 'android') {
      instructions(['用 Chrome 開啟這個網站。若從 LINE 開啟，先選擇用外部瀏覽器開啟。',
        '點網址列旁的「⋮」選單。',
        '選「新增至主畫面」或「安裝應用程式」；部分版本會放在「安裝及建立捷徑」裡。依畫面按「新增」或「安裝」。',
        '從主畫面或應用程式清單打開圖示，登入後設定通知。']);
      note('Android 品牌與 Chrome 版本不同，選單名稱可能略有不同。');
      source('Google 官方說明','https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=zh-Hant');
    } else {
      instructions(['可以直接用瀏覽器登入，不必安裝。', '若 Chrome 或 Edge 網址列出現安裝圖示，也可依提示安裝。', '要接收通知，請在系統內開啟通知並允許瀏覽器權限。']);
    }
    if(config.role === 'admin') note('這個圖示是管理員後台。若也需要檢視系統，請另外開啟該入口再加入主畫面。');
  }
  function source(text, url) { var a = document.createElement('a'); a.className = 'tg-source'; a.textContent = text; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; content.appendChild(a); }
  function notify() {
    heading('最後，開啟這台裝置的通知', '加入主畫面與允許通知是兩個步驟。請先在系統內按「開啟通知」，再同意手機或瀏覽器的權限詢問。', '手機通知');
    deviceTabs();
    var where = config.role === 'admin' ? '右上角選單 → 系統設定 → 手機通知' : '通知 → ' + (config.role === 'stats' ? '通知設定' : '手機通知');
    instructions((device === 'ios' ? ['iPhone／iPad 需 iOS／iPadOS 16.4 以上，並先從主畫面圖示開啟。'] : [])
      .concat([where + '，按「開啟通知」。', config.role === 'stats' ? '依提示輸入目前的檢視密碼，再允許通知。' : '出現權限詢問時，選擇「允許」。',
        '開啟後，可回來按下方「測試這台裝置的通知」。']));
    if(device === 'ios') note('若曾拒絕通知，到 iPhone「設定 → 通知」找這個 App 開啟；若被專注模式靜音，也請確認專注模式設定。');
    if(device === 'android') note('若曾拒絕通知，檢查 Android「設定 → 應用程式 → 此 App 或 Chrome → 通知」，以及 Chrome 的網站通知權限。');
    var a = actions();
    if(loggedIn()) a.appendChild(button('前往通知設定', function(){ steps[index].page = config.role === 'admin' ? 'Sys' : 'Noti'; steps[index].target = config.role === 'stats' ? '#notiBtn' : '#pushBtn'; peek(); }, 'tg-secondary'));
    else note('請先關閉教學並登入，再到通知設定操作。');
    var result = note('', 'tg-status'); result.setAttribute('role','status'); result.setAttribute('aria-live','polite');
    var test = button('測試這台裝置的通知', function(){ testNotification(test, result); }); a.appendChild(test);
    if(device === 'ios') source('Apple 通知支援說明','https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/');
  }
  function testNotification(b, result) {
    if(busy) return;
    if(!loggedIn()){ result.textContent = '請先登入並開啟通知，再測試。'; return; }
    if(detectDevice() === 'ios' && !standalone()){ result.textContent = '請先加入主畫面，並從主畫面圖示打開後再測試。'; return; }
    if(!('Notification' in window) || !('serviceWorker' in navigator)){ result.textContent = '此瀏覽器不支援通知，請用手機上的 Safari 或 Chrome 依教學設定。'; return; }
    if(Notification.permission !== 'granted'){ result.textContent = '尚未允許通知，請先到系統內的通知設定開啟。'; return; }
    busy = true; b.disabled = true; var currentIndex = index;
    navigator.serviceWorker.getRegistration().then(function(reg){
      if(!reg || !reg.pushManager) throw new Error('請先到通知設定開啟手機通知。');
      return reg.pushManager.getSubscription().then(function(sub){
        if(!sub) throw new Error('尚未訂閱手機通知，請先到通知設定開啟。');
        return reg.showNotification('通知測試 · 台灣物理學會', {body:'這是這台裝置的測試通知。之後請假與加班動態會依設定通知你。', icon:{staff:'icon-192.png',admin:'icon-admin.png',stats:'icon-stats.png'}[config.role], tag:'tps-device-test', data:{url:{staff:'index.html',admin:'admin.html',stats:'stats.html'}[config.role]}});
      });
    }).then(function(){ result.textContent = '已請這台裝置顯示測試通知，請查看通知中心。這是本機顯示測試；之後有申請或審核時，仍請確認實際通知能否收到。'; })
      .catch(function(e){ result.textContent = e.message || '測試失敗，請檢查通知權限後重試。'; })
      .then(function(){ if(index === currentIndex) busy = false; b.disabled = false; });
  }
  function init(options) {
    if(config) return;
    config = options; build();
    var app = document.getElementById('app');
    function firstVisit() {
      if(!loggedIn()){ close(); return; }
      if(root.hidden && !peekTarget && !seen()) open('welcome');
    }
    new MutationObserver(firstVisit).observe(app, {attributes:true,attributeFilter:['class']});
    firstVisit();
  }
  window.TPSGuide = {init:init, open:open};
}());
