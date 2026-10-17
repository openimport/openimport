import { Popover as RPopover, Select as RSelect, Tooltip as RTooltip } from 'radix-ui'
import { type ButtonHTMLAttributes, forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { useUi } from '../context'
import { AlertCircle, Check, ChevronDown, Loader2, X } from '../icons'
import { cx } from '../utils'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('oi-btn', `oi-btn--${variant}`, size === 'sm' && 'oi-btn--sm', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="oi-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(function IconButton(
  { label, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={cx('oi-icon-btn', className)} {...props}>
      {children}
    </button>
  )
})

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  children: ReactNode
  className?: string
}) {
  return <span className={cx('oi-badge', `oi-badge--${tone}`, className)}>{children}</span>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="oi-spinner" role="status">
      <Loader2 className="oi-spin" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  )
}

export function Alert({
  tone = 'danger',
  title,
  children,
  onDismiss,
}: {
  tone?: 'danger' | 'info' | 'success'
  title?: ReactNode
  children?: ReactNode
  onDismiss?: () => void
}) {
  const { m } = useUi()
  return (
    <div className={cx('oi-alert', `oi-alert--${tone}`)} role={tone === 'danger' ? 'alert' : 'status'}>
      <AlertCircle aria-hidden className="oi-alert__icon" />
      <div className="oi-alert__body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {onDismiss && (
        <IconButton label={m.dismiss} onClick={onDismiss}>
          <X aria-hidden />
        </IconButton>
      )}
    </div>
  )
}

export function Progress({
  value,
  max = 1,
  label,
  tone = 'accent',
}: {
  value: number
  max?: number
  label?: string
  tone?: 'accent' | 'success'
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className={cx('oi-progress', `oi-progress--${tone}`)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className="oi-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(function Input(
  { className, icon, ...props },
  ref,
) {
  if (!icon) return <input ref={ref} className={cx('oi-input', className)} {...props} />
  return (
    <span className={cx('oi-input-wrap', className)}>
      {icon}
      <input ref={ref} className="oi-input" {...props} />
    </span>
  )
})

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

// Radix reserves '' for "nothing selected", but options like "Auto" or "—" use it.
const NONE = '__oi:none__'
const encode = (v: string) => (v === '' ? NONE : v)
const decode = (v: string) => (v === NONE ? '' : v)

/** A styled, portaled select menu. A value that isn't one of the options shows `placeholder`. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  defaultOpen,
  onOpenChange,
  onCloseAutoFocus,
  'aria-label': ariaLabel,
}: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: ReactNode
  className?: string
  disabled?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Runs when the menu closes; `event.preventDefault()` keeps focus off the trigger. */
  onCloseAutoFocus?: (event: Event) => void
  'aria-label'?: string
}) {
  const { themeProps } = useUi()
  const known = options.some((o) => o.value === value)
  return (
    <RSelect.Root
      value={known ? encode(value) : ''}
      onValueChange={(v) => onValueChange(decode(v))}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RSelect.Trigger className={cx('oi-select', className)} aria-label={ariaLabel}>
        <span className="oi-select__value">
          <RSelect.Value placeholder={placeholder} />
        </span>
        <RSelect.Icon className="oi-select__icon">
          <ChevronDown aria-hidden />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={12}
          {...themeProps}
          className={cx(themeProps.className, 'oi-menu')}
          {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        >
          <RSelect.Viewport className="oi-menu__list">
            {options.map((o) => (
              <RSelect.Item key={o.value} value={encode(o.value)} disabled={o.disabled} className="oi-menu__item">
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="oi-menu__check">
                  <Check aria-hidden />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; tone?: 'danger' | 'success' }[]
  label: string
}) {
  return (
    <div className="oi-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-tone={o.tone}
          className="oi-segmented__item"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  const { themeProps } = useUi()
  if (!content) return <>{children}</>
  return (
    <RTooltip.Root delayDuration={150}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          {...themeProps}
          className={cx(themeProps.className, 'oi-tooltip')}
        >
          {content}
          <RTooltip.Arrow className="oi-tooltip__arrow" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  className,
  width,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
  width?: number | 'trigger'
}) {
  const { themeProps } = useUi()
  return (
    <RPopover.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          {...themeProps}
          className={cx(themeProps.className, 'oi-popover', className)}
          style={{
            ...themeProps.style,
            ...(width === 'trigger' ? { width: 'var(--radix-popover-trigger-width)', minWidth: 280 } : width ? { width } : {}),
          }}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="oi-kbd">{children}</kbd>
}
