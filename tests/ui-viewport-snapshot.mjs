const port = process.env.CDP_PORT || '9223';
const urlPart = process.env.TARGET_URL_PART || '';
const width = Number(process.env.VIEWPORT_WIDTH || 390);
const height = Number(process.env.VIEWPORT_HEIGHT || 844);
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
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:true });
const response = await send('Runtime.evaluate', { expression:`(() => ({
  body:document.body.innerText.replace(/\\s+/g,' ').slice(0,3000),
  viewport:[innerWidth,innerHeight], scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
  overflow:document.documentElement.scrollWidth>innerWidth,
  controls:[...document.querySelectorAll('button,input,select,textarea,a')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}).map(el=>{const r=el.getBoundingClientRect();return {id:el.id||'',text:(el.innerText||el.value||el.placeholder||'').trim().replace(/\\s+/g,' ').slice(0,60),rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]};})
}))()`, returnByValue:true });
console.log(JSON.stringify(response.result.value, null, 2));
ws.close();
setTimeout(() => process.exit(0), 100);
