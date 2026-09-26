const port = process.env.CDP_PORT || '9223';
const urlPart = process.env.TARGET_URL_PART || '';
const selectors = (process.env.SELECTORS || '').split('|').filter(Boolean);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && item.url.includes(urlPart));
if (!target) throw new Error(`No page target matched ${urlPart}`);
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
const snapshot = () => evaluate(`(() => ({
  body:document.body.innerText.replace(/\\s+/g,' ').slice(0,5000),
  controls:[...document.querySelectorAll('button,input,select,textarea,a')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}).map(el=>({tag:el.tagName.toLowerCase(),id:el.id||'',type:el.type||'',text:(el.innerText||el.value||el.placeholder||'').trim().replace(/\\s+/g,' ').slice(0,100),disabled:!!el.disabled})),
  scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]
}))()`);
const result = {};
for (const selector of selectors) {
  const clicked = await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return false; el.click(); return true; })()`);
  await wait(3500);
  result[selector] = { clicked, snapshot:await snapshot() };
}
console.log(JSON.stringify(result, null, 2));
ws.close();
await wait(100);
process.exit(0);
