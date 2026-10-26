/* 缓存名带版本号：改这个数字即可强制所有客户端丢弃旧缓存 */
const CACHE = 'novel-draw-v17';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './prompts.js',
  './confirm.js', './cast.js', './history.js', './shelf.js', './prompts-edit.js', './draft.js', './plot.js',
  './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* 网络优先：拿得到新的就用新的，拿不到才回退缓存。
   这样每次部署后刷新一次就能看到最新版本，不必等缓存过期。 */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // 只处理本站资源

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(hit => hit || caches.match('./index.html'))
      )
  );
});

/* 页面主动要求更新时，立刻接管 */
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
