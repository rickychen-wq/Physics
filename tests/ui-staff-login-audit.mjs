const port = process.env.CDP_PORT || '9223';
const url = process.env.PAGE_URL;
const email = process.env.PAGE_EMAIL || '';
const password = process.env.PAGE_PASSWORD || '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
  .find(item => item.type === 'page' && !item.url.startsWith('edge://'));
if (!target || !url) throw new Error('Missing browser target or PAGE_URL');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once:true });
  ws.addEventListener('error', reject, { once:true });
});
let id = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const task = pending.get(message.id); pending.delete(message.id);
  message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id; pending.set(requestId, { resolve, reject });
  ws.send(JSON.stringify({ id:requestId, method, params }));
});
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime.evaluate failed');
  return response.result.value;
};
await send('Page.navigate', { url });
await wait(5000);
const submitted = await evaluate(`(() => {
  const email=document.querySelector('#gEmail');
  const password=document.querySelector('#gPw');
  const button=document.querySelector('#gBtn');
  if(!email || !password || !button) return false;
  email.value=${JSON.stringify(email)};
  password.value=${JSON.stringify(password)};
  email.dispatchEvent(new Event('input',{bubbles:true}));
  password.dispatchEvent(new Event('input',{bubbles:true}));
  button.click(); return true;
})()`);
await wait(7000);
const result = await evaluate(`(() => ({
  title:document.title,
  body:document.body.innerText.replace(/\\s+/g,' ').slice(0,5000),
  error:document.querySelector('#gErr')?.innerText||'',
  viewport:[innerWidth,innerHeight],
  scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
  overflow:document.documentElement.scrollWidth>innerWidth,
  office:document.querySelector('#officeToday')?.innerText||'',
  tabbar:document.querySelector('.tabbar') ? (()=>{const r=document.querySelector('.tabbar').getBoundingClientRect();return [Math.round(r.x),Math.round(r.width)];})() : null
}))()`);
console.log(JSON.stringify({ submitted, result }, null, 2));
ws.close();
setTimeout(() => process.exit(0), 100);
