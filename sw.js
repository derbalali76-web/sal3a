/* sw.js — Network-First مع Cache offline */
/* عزل الكاش لكل تطبيق على نفس النطاق (كان يحذف كاش التطبيقات الأخرى) */
const NS = (() => { try {
  let seg = self.location.pathname.replace(/\/[^/]*$/,'').split('/').filter(Boolean).pop() || 'root';
  try { seg = decodeURIComponent(seg); } catch(e){}
  /* ⚠️ المسار قد يكون عربياً — الحذف الأعمى لغير ASCII يجعل النطاق فارغاً ومشتركاً بين التطبيقات */
  const safe = String(seg).toLowerCase().replace(/[^\p{L}\p{N}_-]/gu,'-');
  let h = 0; for (let i=0;i<seg.length;i++){ h = ((h<<5)-h+seg.charCodeAt(i))|0; }
  return (safe || 'root') + '#' + (h>>>0).toString(36);
} catch(e){ return 'root'; } })();
const CACHE_PREFIX = 'goldpro@' + NS + '-';
const CACHE = CACHE_PREFIX + 'v110';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './firebase.js',
  './app.js',
  './assistant.js',
  './inventory.js',
  './invoice.js',
  './raffinage.js',
  './auth.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/icon-180.png',
];

/* تثبيت: حفظ الملفات الأساسية في الكاش */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* تفعيل: حذف كاشات قديمة */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* الطلبات: Network-First → إذا فشل الإنترنت يُقرأ من الكاش */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  /* فقط نفس النطاق (لا Firebase ولا CDN) */
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.open(CACHE).then(c => c.match(e.request)))
  );
});
