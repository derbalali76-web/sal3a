/* Service Worker لبوابة الزبون — يجعلها قابلة للتثبيت وتعمل دون اتصال جزئياً */
const C='gp-portal-v1';
self.addEventListener('install',e=>{ self.skipWaiting(); e.waitUntil(caches.open(C).then(c=>c.addAll(['portal.html']).catch(()=>{}))); });
self.addEventListener('activate',e=>{ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch',e=>{
  const u=e.request.url;
  if(u.includes('/portal.html')||e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put('portal.html',cp)).catch(()=>{});return r;}).catch(()=>caches.match('portal.html')));
    return;
  }
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
