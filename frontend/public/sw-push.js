self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "Статус сделки обновлён" };
  }
  const title = data.title || "Alfa Global CBDC Hub";
  const options = {
    body: data.body || "Статус сделки обновлён",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.dealId ? `/deals/${data.dealId}/tracking` : "/" },
    tag: data.dealId ? `deal-${data.dealId}` : "cbdc-notification"
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
