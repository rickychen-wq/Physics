import fs from 'node:fs';
import path from 'node:path';

const port = process.env.CDP_PORT || '9223';
const url = process.env.PAGE_URL;
const email = process.env.PAGE_EMAIL || '';
const password = process.env.PAGE_PASSWORD || '';
const secondLevel = process.env.SECOND_LEVEL === '1';
const clearSession = process.env.CLEAR_SESSION === '1';
const width = Number(process.env.VIEWPORT_WIDTH || 390);
const height = Number(process.env.VIEWPORT_HEIGHT || 844);
const output = process.env.OUTPUT_FILE || path.resolve('tests', 'screenshots', 'capture.png');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!url) throw new Error('PAGE_URL is required');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && !item.url.startsWith('edge://'));
if (!target) throw new Error('No browser target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once:true });
  ws.addEventListener('error', reject, { once:true });
});
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const task = pending.get(message.id);
  pending.delete(message.id);
  message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime.evaluate failed');
  return response.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor:1, mobile:width < 760,
  screenWidth:width, screenHeight:height
});
await send('Page.navigate', { url });
await wait(5000);
if (clearSession) {
  await evaluate(`sessionStorage.clear()`);
}
if (password) {
  await evaluate(`(() => {
    const emailInput=document.querySelector('#gEmail');
    const passwordInput=document.querySelector('#gPw');
    const button=document.querySelector('#gBtn');
    if(emailInput) emailInput.value=${JSON.stringify(email)};
    if(passwordInput) passwordInput.value=${JSON.stringify(password)};
    if(emailInput) emailInput.dispatchEvent(new Event('input',{bubbles:true}));
    if(passwordInput) passwordInput.dispatchEvent(new Event('input',{bubbles:true}));
    if(button) button.click();
  })()`);
  await wait(6500);
}
if (secondLevel) {
  await evaluate(`(() => {
    const button=document.querySelector('#lockBtn');
    if(button && !button.classList.contains('on')) button.click();
  })()`);
  await wait(500);
}
const audit = await evaluate(`(() => ({
  title:document.title,
  viewport:[innerWidth,innerHeight],
  scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
  overflow:document.documentElement.scrollWidth>innerWidth,
  theme:{
    gold:getComputedStyle(document.documentElement).getPropertyValue('--gold').trim(),
    card:getComputedStyle(document.documentElement).getPropertyValue('--card').trim(),
    styles:[...document.styleSheets].map(sheet=>sheet.href||'inline')
  },
  visibleNav:[...document.querySelectorAll('button[data-p]')]
    .filter(el=>{const s=getComputedStyle(el);return s.display!=='none'})
    .map(el=>el.innerText.trim()),
  body:document.body.innerText.replace(/\\s+/g,' ').slice(0,1000)
}))()`);
const capture = await send('Page.captureScreenshot', {
  format:'png',
  fromSurface:true,
  captureBeyondViewport:false
});
fs.mkdirSync(path.dirname(output), { recursive:true });
fs.writeFileSync(output, Buffer.from(capture.data, 'base64'));
console.log(JSON.stringify({ output, audit }, null, 2));
ws.close();
setTimeout(() => process.exit(0), 100);
