import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';

export type ConfirmDialogVariant = 'default' | 'warning' | 'danger';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const presentation = {
  default: {
    icon: 'bg-brand-50 text-brand-700',
    panel: 'border-slate-200 bg-slate-50',
    button: 'primary' as const,
  },
  warning: {
    icon: 'bg-warning-50 text-warning-700',
    panel: 'border-warning-200 bg-warning-50/50',
    button: 'primary' as const,
  },
  danger: {
    icon: 'bg-danger-50 text-danger-700',
    panel: 'border-danger-200 bg-danger-50/50',
    button: 'danger' as const,
  },
};

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmLockedRef = useRef(false);
  const busyRef = useRef(busy);
  const wasBusyRef = useRef(busy);
  const [confirming, setConfirming] = useState(false);
  const style = presentation[variant];
  const locked = busy || confirming;
  const destructive = variant === 'warning' || variant === 'danger';

  busyRef.current = busy;

  useEffect(() => {
    if (!open) {
      confirmLockedRef.current = false;
      setConfirming(false);
    }
  }, [open]);

  useEffect(() => {
    if (wasBusyRef.current && !busy) {
      confirmLockedRef.current = false;
      setConfirming(false);
    }
    wasBusyRef.current = busy;
  }, [busy]);

  const cancel = () => {
    if (!locked) onCancel();
  };

  const confirm = async () => {
    if (locked || confirmLockedRef.current) return;
    confirmLockedRef.current = true;
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      // Release on the next task only if the parent did not enter its own busy
      // state. This blocks rapid repeat events while still permitting a retry
      // when a rejected operation leaves the dialog open.
      window.setTimeout(() => {
        if (!busyRef.current) {
          confirmLockedRef.current = false;
          setConfirming(false);
        }
      }, 0);
    }
  };

  return (
    <Modal
      open={open}
      onClose={cancel}
      title={title}
      description={typeof description === 'string' ? description : undefined}
      size="sm"
      compactMobile
      dismissible={!locked}
      initialFocusRef={destructive ? cancelRef : undefined}
      footer={(
        <>
          <Button ref={cancelRef} variant="outline" disabled={locked} onClick={cancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={style.button}
            disabled={locked}
            loading={locked}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {(typeof description !== 'string' || children) && (
        <div className={`rounded-xl border p-4 text-sm leading-6 text-slate-700 ${style.panel}`}>
          {typeof description !== 'string' && description}
          {children}
        </div>
      )}
      {destructive && !children && typeof description === 'string' && (
        <div className={`flex items-start gap-3 rounded-xl border p-4 ${style.panel}`}>
          <span className={`rounded-full p-2 ${style.icon}`} aria-hidden="true">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <p className="text-sm leading-6 text-slate-700">
            Review this action carefully before continuing.
          </p>
        </div>
      )}
    </Modal>
  );
}
