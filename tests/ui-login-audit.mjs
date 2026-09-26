const port = process.env.CDP_PORT || '9223';
const url = process.env.PAGE_URL;
const password = process.env.PAGE_PASSWORD || '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
  .find(item => item.type === 'page' && !item.url.startsWith('edge://'));
if (!target || !url) throw new Error('Missing browser target or PAGE_URL');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const task = pending.get(message.id);
  pending.delete(message.id);
  message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  pending.set(requestId, { resolve, reject });
  ws.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime.evaluate failed');
  return response.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await wait(5000);
const before = await evaluate(`({ title:document.title, body:document.body.innerText.replace(/\\s+/g,' ').slice(0,1000) })`);
const submitted = await evaluate(`(() => {
  const input = document.querySelector('#gPw, input[type=password]');
  const button = document.querySelector('#gBtn, button[type=submit]');
  if (!input || !button) return false;
  input.value = ${JSON.stringify(password)};
  input.dispatchEvent(new Event('input', { bubbles:true }));
  button.click();
  return true;
})()`);
await wait(6000);
const after = await evaluate(`(() => {
  const visible = el => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden'; };
  return {
    title: document.title,
    body: document.body.innerText.replace(/\\s+/g,' ').slice(0,5000),
    controls: [...document.querySelectorAll('button,input,select,textarea,a')].filter(visible).map(el => ({ tag:el.tagName.toLowerCase(), id:el.id||'', text:(el.innerText||el.value||el.placeholder||'').trim().replace(/\\s+/g,' ').slice(0,80), type:el.type||'', disabled:!!el.disabled })),
    viewport: [innerWidth,innerHeight], scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]
  };
})()`);
console.log(JSON.stringify({ submitted, before, after }, null, 2));
ws.close();
await wait(100);
process.exit(0);
