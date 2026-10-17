import { useImportState, useSession } from '@openimport/react'
import { Button } from '../components/primitives'
import { useUi } from '../context'
import { CheckCircle2, RotateCcw } from '../icons'

export function CompleteStep() {
  const session = useSession()
  const { m, t } = useUi()
  const result = useImportState((s) => s.result)
  if (!result) return null
  return (
    <div className="oi-step oi-complete">
      <div className="oi-complete__icon" aria-hidden>
        <CheckCircle2 />
      </div>
      <h2>{m.complete.heading}</h2>
      <p>{t(m.complete.description, { count: result.submitted })}</p>
      {result.skipped > 0 && <p className="oi-muted">{t(m.complete.skipped, { count: result.skipped })}</p>}
      {result.rejected.length > 0 && (
        <div className="oi-complete__rejected">
          <p className="oi-text-danger">{t(m.complete.rejected, { count: new Set(result.rejected.map((r) => r.rowId)).size })}</p>
          <Button onClick={() => session.reviewRejected()}>{m.complete.reviewRejected}</Button>
        </div>
      )}
      <Button variant="ghost" icon={<RotateCcw aria-hidden />} onClick={() => session.reset()}>
        {m.complete.again}
      </Button>
    </div>
  )
}
