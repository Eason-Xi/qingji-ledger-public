const PREFIX='qingji-public:'+new URL(self.registration.scope).pathname+':';
const CACHE=PREFIX+'v1';
const root=new URL('./',self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(new URL('asset-manifest.json',root));
    if(!response.ok)throw Error('No production manifest');
    const manifest=await response.json();
    const assets=new Set([root,new URL('favicon.svg',root).href,new URL('manifest.webmanifest',root).href]);
    for(const entry of Object.values(manifest))for(const path of [entry.file,...(entry.css||[]),...(entry.assets||[])])assets.add(new URL(path,root).href);
    await cache.addAll([...assets]);
  }catch{/* Development and temporary network failures can retry on the next online visit. */}
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin||!url.href.startsWith(root)||url.pathname.endsWith('/sw.js'))return;
  if(event.request.mode==='navigate')event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{const response=await fetch(event.request);if(response.ok)await cache.put(root,response.clone());return response;}
    catch{return await cache.match(root)||new Response('首次使用需要联网加载界面；已有账本仍保存在当前浏览器。',{headers:{'Content-Type':'text/plain;charset=utf-8'}});}
  })());
  else if(/\.(js|css|svg|webmanifest)$/.test(url.pathname))event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(event.request);
    if(cached)return cached;
    const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;
  })());
});
