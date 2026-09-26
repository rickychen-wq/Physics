const port = process.env.CDP_PORT || '9223';
const urlPart = process.env.TARGET_URL_PART || 'stats.html';
const secondPassword = process.env.SECOND_PASSWORD || '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && item.url.includes(urlPart));
if (!target) throw new Error('No stats page target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once:true });
  ws.addEventListener('error', reject, { once:true });
});
let nextId = 0;
const pending = new Map();
let send;
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const task = pending.get(message.id);
  pending.delete(message.id);
  message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
});
send = (method, params = {}) => new Promise((resolve, reject) => {
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
if (secondPassword) {
  await evaluate(`(() => {
    const lock=document.querySelector('#lockBtn');
    if(lock && !lock.classList.contains('on')) lock.click();
    const input=document.querySelector('#lv2Pw');
    const submit=document.querySelector('#lv2Submit');
    if(!input || !submit) return false;
    input.value=${JSON.stringify(secondPassword)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    submit.click();
    return true;
  })()`);
  await wait(700);
}
await evaluate(`document.querySelector('button[data-p="Noti"]').click()`);
await wait(1000);
const result = await evaluate(`(() => ({
  nav:[...document.querySelectorAll('button[data-p]')].filter(el=>!el.classList.contains('hide')).map(el=>el.innerText.trim()),
  hasFinanceUnlock:!!document.querySelector('#lockBtn'),
  financeUnlocked:document.querySelector('#lockBtn')?.classList.contains('on')||false,
  hasNoticeFeed:!!document.querySelector('#statsNotiList'),
  hasTodayBoard:!!document.querySelector('#todayBoard'),
  xlsxReady:typeof XLSX!=='undefined',
  overflow:document.documentElement.scrollWidth>innerWidth,
  body:document.body.innerText.replace(/\\s+/g,' ').slice(0,3000)
}))()`);
console.log(JSON.stringify(result, null, 2));
ws.close();
await wait(100);
process.exit(0);
