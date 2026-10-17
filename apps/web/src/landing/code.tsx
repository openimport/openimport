import { highlight } from '@/lib/highlight'
import { cn } from '@/lib/utils'

export function Code({ code, title, meta, className }: { code: string; title?: string; meta?: string; className?: string }) {
  const lines = code.replace(/\n$/, '').split('\n')
  return (
    <figure className={cn('min-w-0 border border-zinc-800 bg-zinc-950', className)}>
      {title && (
        <figcaption className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 font-mono text-[11px]">
          <span className="text-zinc-300">{title}</span>
          {meta && <span className="text-zinc-500">{meta}</span>}
        </figcaption>
      )}
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-[1.7] text-zinc-400">
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
          <div key={i} className="flex gap-4">
            <span className="w-4 shrink-0 text-right text-zinc-700 select-none">{i + 1}</span>
            <span>
              {highlight(line).map((t, j) =>
                typeof t === 'string' ? (
                  t
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
                  <span key={j} className={t.cls}>
                    {t.text}
                  </span>
                ),
              )}
            </span>
          </div>
        ))}
      </pre>
    </figure>
  )
}
