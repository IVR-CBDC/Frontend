

import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

function decodeKey(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function usePushNotifications(companyId?: string) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const available =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(available);
    if (available) setPermission(Notification.permission);
  }, []);

  const enable = useCallback(async () => {
    if (!supported || !companyId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setMessage("Разрешение на push-уведомления не предоставлено");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const { publicKey } = await api.getPushPublicKey();
        const vapidKey = decodeKey(publicKey);
        const applicationServerKey = new ArrayBuffer(vapidKey.byteLength);

        new Uint8Array(applicationServerKey).set(vapidKey);

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }
      await api.savePushSubscription(subscription.toJSON());
      setSubscribed(true);
      setMessage("Push-уведомления включены");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось включить push-уведомления",
      );
    } finally {
      setBusy(false);
    }
  }, [companyId, supported]);

  useEffect(() => {
    if (!supported || !companyId || permission !== "granted") return;
    let cancelled = false;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription && !cancelled) {
          await api.savePushSubscription(subscription.toJSON());
          setSubscribed(true);
        } else if (!cancelled) {
          setSubscribed(false);
        }
      } catch {
        if (!cancelled)
          setMessage("Не удалось обновить регистрацию push-уведомлений");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, permission, supported]);

  return { supported, permission, subscribed, busy, message, enable };
}
