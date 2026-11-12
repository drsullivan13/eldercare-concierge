"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Modal({
  children,
  title,
  close,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-label={title}
    >
      <div className="modal-controls">
        <button
          className="icon-button modal-close"
          onClick={close}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
      </div>
      <div className="modal-inner">{children}</div>
    </dialog>
  );
}
