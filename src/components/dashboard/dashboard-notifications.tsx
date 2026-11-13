"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createToaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
} from "@ui-sdk/react/toast";
import "./dashboard-notifications.css";

const shortScreen = "(max-height: 480px)";
function subscribeHeight(listener: () => void) {
  const query = window.matchMedia(shortScreen);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
function compactStack() {
  return window.matchMedia(shortScreen).matches;
}

export type DashboardNotification = {
  id: string;
  title: string;
  description?: string;
  action?: { label: string; onAction: () => boolean };
};

export default function DashboardNotifications({
  pending,
  onDelivered,
  comparisonActive,
}: {
  pending: readonly DashboardNotification[];
  onDelivered: (ids: readonly string[]) => void;
  comparisonActive: boolean;
}) {
  const compact = useSyncExternalStore(
    subscribeHeight,
    compactStack,
    () => false,
  );
  const [toaster] = useState(() => createToaster({ duration: 5000 }));
  const [container] = useState(() => document.createElement("div"));
  const delivered = useRef(new Set<string>());

  useLayoutEffect(() => {
    const announcers = new Map<HTMLElement, Node>();
    function sync() {
      const dialogs =
        document.querySelectorAll<HTMLDialogElement>("dialog:modal");
      const dialog = dialogs.item(dialogs.length - 1);
      const target = dialog ?? document.body;
      container.toggleAttribute("data-native-dialog", !!dialog);
      const focused = container.contains(document.activeElement)
        ? document.activeElement
        : null;
      if (container.parentNode !== target) {
        target.append(container);
        // Reparenting a popover closes it. Keep the portal target itself stable.
        const region = container.querySelector<HTMLElement>(
          '[data-slot="toast-region"]',
        );
        if (region?.popover && !region.matches(":popover-open"))
          region.showPopover();
        if (focused instanceof HTMLElement)
          focused.focus({ preventScroll: true });
      }
      for (const announcer of document.querySelectorAll<HTMLElement>(
        "[data-ui-sdk-announcer]",
      )) {
        if (!announcers.has(announcer))
          announcers.set(announcer, announcer.parentNode ?? document.body);
      }
      for (const [announcer, original] of announcers) {
        const parent =
          dialog ?? (original.isConnected ? original : document.body);
        if (announcer.parentNode !== parent) parent.appendChild(announcer);
      }
    }
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => {
      observer.disconnect();
      for (const [announcer, original] of announcers) {
        const parent = original.isConnected ? original : document.body;
        if (announcer.parentNode !== parent) parent.appendChild(announcer);
      }
      container.remove();
    };
  }, [container]);

  useEffect(() => {
    const pendingIds = new Set(pending.map(({ id }) => id));
    for (const id of delivered.current) {
      if (!pendingIds.has(id)) delivered.current.delete(id);
    }
    for (const notification of pending) {
      if (delivered.current.has(notification.id)) continue;
      delivered.current.add(notification.id);
      const { action, id, title, description } = notification;
      toaster.info(title, {
        id,
        description,
        duration: action ? Infinity : 5000,
        action: action
          ? {
              label: action.label,
              dismiss: false,
              onAction: () => {
                if (action.onAction()) toaster.dismiss(id);
                else
                  toaster.update(id, {
                    type: "error",
                    duration: Infinity,
                    description: [
                      description,
                      "Could not restore this item. Try Undo again.",
                    ]
                      .filter(Boolean)
                      .join(" "),
                  });
              },
            }
          : undefined,
      });
    }
    if (pending.length) onDelivered(pending.map(({ id }) => id));
  }, [pending, onDelivered, toaster]);

  return (
    <ToastRegion
      toaster={toaster}
      container={container}
      maxVisible={compact ? 1 : 3}
      expanded
      side="bottom"
      align="end"
      aria-label="Workspace notifications"
      className="dashboard-notifications"
      data-comparison-active={comparisonActive || undefined}
    >
      {() => (
        <Toast className="dashboard-notification">
          <div className="dashboard-notification-copy">
            <ToastTitle className="dashboard-notification-title" />
            <ToastDescription className="dashboard-notification-description" />
          </div>
          <div className="dashboard-notification-actions">
            <ToastAction
              dismiss={false}
              className="dashboard-notification-undo"
            />
            <ToastClose className="dashboard-notification-dismiss">
              Dismiss
            </ToastClose>
          </div>
        </Toast>
      )}
    </ToastRegion>
  );
}
