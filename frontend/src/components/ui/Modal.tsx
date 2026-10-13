import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

let openModalCount = 0;
let originalBodyOverflow = '';

function isTopModal(host: HTMLDivElement) {
  const roots = document.querySelectorAll<HTMLDivElement>('[data-modal-root]');
  return roots[roots.length - 1] === host;
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hasAttribute('hidden'));
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';

  /*
   * Optional:
   * Makes only selected modals more compact on mobile.
   *
   * Desktop remains unchanged.
   */
  compactMobile?: boolean;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  compactMobile = false,
}: ModalProps) {
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const host = document.createElement('div');
    host.dataset.modalRoot = '';
    document.body.appendChild(host);
    setPortalHost(host);

    if (openModalCount === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openModalCount += 1;

    return () => {
      host.remove();
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) document.body.style.overflow = originalBodyOverflow;
      requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus();
      });
    };
  }, [open]);

  useEffect(() => {
    if (!portalHost) return;
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [portalHost]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!portalHost || !isTopModal(portalHost)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open || !portalHost) {
    return null;
  }

  return createPortal(
    <div
      onKeyDown={handleKeyDown}
      className={`
        fixed
        inset-0
        z-50
        flex
        items-center
        justify-center

        ${
          compactMobile
            ? 'p-2 sm:p-4'
            : 'p-4'
        }
      `}
    >
      {/* Backdrop */}
      <div
        data-modal-backdrop
        className="
          absolute
          inset-0
          bg-slate-900/40
          backdrop-blur-sm
          animate-fade-in
        "
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`
          relative
          flex
          w-full
          flex-col
          bg-white
          shadow-pop
          animate-scale-in

          ${sizeClasses[size]}

          ${
            compactMobile
              ? `
      h-full
      max-h-full
      rounded-xl

      sm:h-auto
      sm:max-h-[90vh]
      sm:rounded-2xl
    `
              : `
                  max-h-[90vh]
                  rounded-2xl
                `
          }
        `}
      >
        {/* Header */}
        {(title || description) && (
          <div
            className={`
              flex
              shrink-0
              items-start
              justify-between
              gap-4
              border-b
              border-slate-100

              ${
                compactMobile
                  ? `
                      px-4
                      pb-3
                      pt-4

                      sm:px-6
                      sm:pb-4
                      sm:pt-5
                    `
                  : `
                      px-6
                      pb-4
                      pt-5
                    `
              }
            `}
          >
            <div className="min-w-0">
              {title && (
                <h2
                  id={titleId}
                  className={`
                    font-bold
                    text-slate-900

                    ${
                      compactMobile
                        ? 'text-base sm:text-lg'
                        : 'text-lg'
                    }
                  `}
                >
                  {title}
                </h2>
              )}

              {description && (
                <p
                  id={descriptionId}
                  className={`
                    mt-0.5
                    text-slate-500

                    ${
                      compactMobile
                        ? 'text-xs sm:text-sm'
                        : 'text-sm'
                    }
                  `}
                >
                  {description}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="
                shrink-0
                rounded-lg
                p-1.5
                text-slate-400
                transition-colors
                hover:bg-slate-100
                hover:text-slate-600
              "
              aria-label="Close modal"
            >
              <X
                className={
                  compactMobile
                    ? 'h-4 w-4 sm:h-5 sm:w-5'
                    : 'h-5 w-5'
                }
              />
            </button>
          </div>
        )}

        {/* Content */}
        <div
  className={`
    min-h-0
    flex-1
    overflow-y-auto
    overscroll-contain
    scrollbar-thin

    ${
      compactMobile
        ? `
            px-4
            py-3

            sm:px-6
            sm:py-5
          `
        : `
            px-6
            py-5
          `
    }
  `}
>
  {children}
</div>

        {/* Footer */}
        {/* Footer */}
{footer && (
  <div
    className={`
      z-10
      flex
      shrink-0
      items-center
      justify-end
      border-t
      border-slate-100
      bg-white

      ${
        compactMobile
          ? `
              gap-2
              px-4
              py-3

              sm:gap-3
              sm:px-6
              sm:py-4
            `
          : `
              gap-3
              px-6
              py-4
            `
      }
    `}
  >
    {footer}
  </div>
)}
      </div>
    </div>,
    portalHost
  );
}
