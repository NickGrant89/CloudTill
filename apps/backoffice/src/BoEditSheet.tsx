import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type BoEditSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Wider centred modal on desktop (e.g. item modifiers). */
  wide?: boolean;
};

function usePhoneLayout() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

/** Always modal: phone = bottom sheet, desktop = centred dialog — list stays put. */
export function BoEditSheet({ open, onClose, title, children, wide }: BoEditSheetProps) {
  const phone = usePhoneLayout();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sheet = (
    <div className="bo-edit-sheet panel-box">
      <div className="bo-edit-sheet-head">
        <h3>{title}</h3>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="bo-edit-sheet-body">{children}</div>
    </div>
  );

  return createPortal(
    <div
      className={`bo-edit-layer${phone ? "" : " bo-edit-layer--desktop"}${wide && !phone ? " bo-edit-layer--wide" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button type="button" className="bo-edit-backdrop" tabIndex={-1} aria-label="Dismiss" onClick={onClose} />
      {sheet}
    </div>,
    document.body
  );
}