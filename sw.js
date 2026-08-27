self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((key) => key.startsWith("blur-service-")).map((key) => caches.delete(key)));
    try { await (await self.registration.pushManager.getSubscription())?.unsubscribe(); } catch {}
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const retirementURL = new URL("./", self.registration.scope).href;
    await Promise.all(windows.filter((client) => client.url.startsWith(self.registration.scope)).map((client) => client.navigate(retirementURL)));
    await self.registration.unregister();
  })());
});
