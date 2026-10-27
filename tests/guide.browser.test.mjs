// Browser-only UI regression. All Firebase calls use fixtures; no production writes.
// Set TPS_PLAYWRIGHT_PATH to a Playwright module URL if it is not installed locally.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.TPS_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if(!file.startsWith(root + path.sep)){res.writeHead(403);res.end();return;}
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json'}[path.extname(file)] || 'text/plain');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const fakeFirebase = `
(function(){
window.__writes = [];
const snap = {forEach(){},docs:[],empty:true,size:0};
const query = {where(){return this;},doc(){return this;},get(){return Promise.resolve(snap);},onSnapshot(cb){cb(snap);return function(){};},
set(){window.__writes.push('set');throw Error('Unexpected fixture write');},add(){window.__writes.push('add');throw Error('Unexpected fixture write');},delete(){window.__writes.push('delete');throw Error('Unexpected fixture write');}};
function firestore(){return {collection(){return query;}};}
firestore.FieldValue={serverTimestamp(){return new Date();}};
firestore.Timestamp={fromDate(d){return d;}};
window.firebase={apps:[{}],initializeApp(){},firestore};
}());
`;
const fixture = `
var person={name:'教學測試人員',email:'guide@example.invalid',term:1,hireDate:new Date(2024,2,1),active:true};
window.__person=person;
TPS.currentUser=function(){return person;};
TPS.login=function(){return Promise.resolve(person);}; TPS.restoreSession=function(){return Promise.resolve(null);};
TPS.logout=function(){return Promise.resolve();};
TPS.loadAdminPassword=function(){return Promise.resolve();}; TPS.adminLogin=function(){return true;};
TPS.getStatsPassword=function(){return Promise.resolve({pw:'guide-test',epoch:0,lv2Pw:'finance-test',lv2Epoch:0});};
TPS.loadCalendar=function(){return Promise.resolve({});}; TPS.listCalendar=function(){return Promise.resolve([]);};
TPS.listAccounts=function(){return Promise.resolve([person]);}; TPS.proxyCandidates=function(){return Promise.resolve([]);};
TPS.getBalance=function(){return Promise.resolve(TPS.normalizeBal({annualCurrent:21,compCurrent:5}));};
TPS.watchBalance=function(em,cb){cb(TPS.normalizeBal({annualCurrent:21,compCurrent:5}));return function(){};};
['watchMyLeaves','watchMyOvertime','watchMyNotices','watchTodayLeaves','watchProxyRequests','watchPendingLeaves','watchPendingOvertime','watchCancelRequests','watchOfficeLeaves'].forEach(function(k){TPS[k]=function(cb){cb([]);return function(){};};});
TPS.watchScopeNotices=function(scope,cb){cb([]);return function(){};};
['checkAllExpiry','autoGrantAll','listSettlements'].forEach(function(k){TPS[k]=function(){return Promise.resolve([]);};});
TPS.markAllNoticesRead=function(){};
`;
const shared = await fs.readFile(path.join(root,'shared.js'),'utf8');
const browser = await chromium.launch({channel:process.env.TPS_BROWSER_CHANNEL || 'msedge',headless:true});
const errors=[], results=[];
async function context(device='desktop', width=390, blockStorage=false) {
  const ua = device === 'ios' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
    : device === 'android' ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' : undefined;
  const c = await browser.newContext({viewport:{width,height:844},userAgent:ua,reducedMotion:'reduce'});
  await c.route('**/*', async route => {
    const url = route.request().url();
    if(url.includes('firebase-app-compat')) return route.fulfill({contentType:'text/javascript',body:fakeFirebase});
    if(url.includes('firebase-firestore-compat')) return route.fulfill({contentType:'text/javascript',body:''});
    if(new URL(url).pathname === '/shared.js') return route.fulfill({contentType:'text/javascript',body:shared + '\n' + fixture});
    if(!url.startsWith(base)) return route.abort();
    return route.continue();
  });
  if(blockStorage) await c.addInitScript(() => { Storage.prototype.setItem=function(){throw new Error('storage unavailable');};Storage.prototype.getItem=function(){throw new Error('storage unavailable');}; });
  return c;
}
async function login(page, role) {
  if(role === 'staff'){await page.fill('#gEmail','guide@example.invalid');await page.fill('#gPw','test');}
  else await page.fill('#gPw',role === 'stats' ? 'guide-test' : 'test');
  await page.click('#gBtn');
  await page.locator('#tpsGuide:not([hidden])').waitFor({timeout:8000}).catch(async e => {
    console.error(role, await page.locator('#gErr').innerText(), await page.locator('#app').getAttribute('class'), errors);throw e;
  });
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'Page must fit mobile width');
  assert.equal(await page.locator('.tg-panel').evaluate(n => n.scrollWidth > n.clientWidth),false,'Tutorial must fit panel width');
}
try {
  for(const role of ['staff','admin','stats']) {
    console.log('Testing '+role);
    const c=await context('android');const page=await c.newPage();page.on('pageerror',e=>errors.push(role+': '+e.message));
    const file={staff:'index.html',admin:'admin.html',stats:'stats.html'}[role];
    await page.goto(base+'/'+file);
    await page.click('#gate [data-tps-guide]');
    assert.match(await page.locator('#tgDesc').innerText(),/目前使用的入口/);
    assert.equal(await page.locator('[data-device="android"]').getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'iPhone／iPad',exact:true}).click();
    assert.match(await page.locator('.tg-instructions').innerText(),/Safari/);
    await noOverflow(page);await page.keyboard.press('Escape');
    await login(page,role);
    assert.match(await page.locator('#tgTitle').innerText(),/第一次使用/);
    await page.getByRole('button',{name:'開始功能導覽',exact:true}).click();
    const total=role==='stats'?5:6;
    for(let n=0;n<total-2;n++) {
      assert.equal(await page.locator('.tg-footer>span').innerText(),`${n+1} / ${total}`);
      await page.getByRole('button',{name:'看看這個功能的位置',exact:true}).click();
      assert.equal(await page.locator('.tg-target').count(),1);
      assert.equal(await page.locator('.tg-target').isVisible(),true);
      assert.equal(await page.locator('#tpsGuide').isVisible(),false);
      await page.locator('#tgResume button').first().click();
      await noOverflow(page);
      await page.getByRole('button',{name:'下一步',exact:true}).click();
    }
    assert.match(await page.locator('#tgTitle').innerText(),/手機主畫面/);
    await page.getByRole('button',{name:'下一步',exact:true}).click();
    // No permissions are requested merely by reading a tutorial.
    await page.getByRole('button',{name:'測試這台裝置的通知',exact:true}).click();
    assert.match(await page.locator('.tg-status').innerText(),/尚未允許通知|不支援通知/);
    await page.evaluate(() => {
      window.__localNotifications=[];
      Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'granted'}});
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:async()=>({pushManager:{getSubscription:async()=>({endpoint:'fixture-only'})},showNotification:async(title,data)=>window.__localNotifications.push({title,data})})}});
    });
    await page.getByRole('button',{name:'測試這台裝置的通知',exact:true}).click();
    await page.waitForFunction(()=>window.__localNotifications.length===1);
    assert.match(await page.locator('.tg-status').innerText(),/本機顯示/);
    await page.getByRole('button',{name:'前往通知設定',exact:true}).click();
    assert.equal(await page.locator('.tg-target').getAttribute('id'),role==='stats'?'notiBtn':'pushBtn');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'完成教學',exact:true}).click();
    assert.equal(await page.locator('#tpsGuide').isVisible(),false);
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('tps.guide.v1.') && localStorage.getItem(k)==='seen')),true);
    // Replaying remains available after completion and keyboard focus stays in the modal.
    await page.locator('.tg-help-row button').click();
    await page.locator('.tg-close').focus();await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'先跳過，以後再看');
    await page.keyboard.press('Tab');assert.equal(await page.locator('.tg-close').evaluate(n=>n===document.activeElement),true);
    await page.keyboard.press('Escape');
    // Same identity is not prompted again, but staff handover/new identity is.
    await page.evaluate(()=>{document.querySelector('#app').classList.add('hide');});
    await page.evaluate(()=>{document.querySelector('#app').classList.remove('hide');});
    assert.equal(await page.locator('#tpsGuide').isVisible(),false);
    if(role==='staff'){
      await page.evaluate(()=>{document.querySelector('#app').classList.add('hide');});
      await page.evaluate(()=>{window.__person.guideEpoch=1;document.querySelector('#app').classList.remove('hide');});
      await page.locator('#tpsGuide:not([hidden])').waitFor();
      await page.keyboard.press('Escape');
      await page.evaluate(()=>{document.querySelector('#app').classList.add('hide');});
      await page.evaluate(()=>{window.__person.term=2;document.querySelector('#app').classList.remove('hide');});
      await page.locator('#tpsGuide:not([hidden])').waitFor();
    }
    assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
    results.push(role+' full navigation, replay, focus, notification fixture passed');await c.close();
  }
  // Small-screen device instructions, iPad desktop UA, blocked storage, and scroll restore.
  for(const device of ['ios','android','desktop']) {
    const c=await context(device,320,true);const page=await c.newPage();page.on('pageerror',e=>errors.push(device+': '+e.message));
    await page.goto(base+'/index.html');await login(page,'staff');
    await page.getByRole('button',{name:'加入主畫面／通知教學',exact:true}).click();
    assert.equal(await page.locator(`[data-device="${device}"]`).getAttribute('aria-pressed'),'true');
    await noOverflow(page);await page.keyboard.press('Escape');
    await page.evaluate(()=>scrollTo(0,600));const y=await page.evaluate(()=>scrollY);
    await page.evaluate(()=>TPSGuide.open('welcome'));await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>scrollY),y);
    // A modal previously opened from the login screen must never open the app itself.
    assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
    if(process.env.TPS_GUIDE_SCREENSHOTS){
      await page.evaluate(()=>TPSGuide.open('install'));
      await page.screenshot({path:path.join(process.env.TPS_GUIDE_SCREENSHOTS,`guide-${device}.png`)});
    }
    results.push(device+' 320px layout and blocked-storage passed');await c.close();
  }
  const c=await context();const ipad=await c.newPage();
  await ipad.addInitScript(()=>{Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)'});Object.defineProperty(navigator,'maxTouchPoints',{value:5});});
  await ipad.goto(base+'/stats.html');await ipad.click('#gate [data-tps-guide]');
  assert.equal(await ipad.locator('[data-device="ios"]').getAttribute('aria-pressed'),'true');await c.close();
  assert.deepEqual(errors,[]);console.log(results.join('\n'));console.log('guide browser tests passed (fixtures; no real phone push delivery tested)');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
