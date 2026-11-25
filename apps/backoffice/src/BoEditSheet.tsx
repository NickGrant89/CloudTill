import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type BoEditSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

function usePhoneLayout() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

/** Desktop: inline panel. Phone: bottom sheet over the list (no jump to page top). */
export function BoEditSheet({ open, onClose, title, children }: BoEditSheetProps) {
  const phone = usePhoneLayout();

  useEffect(() => {
    if (!open || !phone) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, phone]);

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

  if (phone) {
    return createPortal(
      <div className="bo-edit-layer" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="bo-edit-backdrop" tabIndex={-1} aria-label="Dismiss" onClick={onClose} />
        {sheet}
      </div>,
      document.body
    );
  }

  return sheet;
}