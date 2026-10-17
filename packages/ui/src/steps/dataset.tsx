import { useImportState, useSession } from '@openimport/react'
import { useUi } from '../context'
import { ChevronRight, Table2 } from '../icons'

export function DatasetStep() {
  const session = useSession()
  const { m, t } = useUi()
  const datasets = useImportState((s) => s.datasets)
  const file = useImportState((s) => s.file)
  const busy = useImportState((s) => s.busy)
  return (
    <div className="oi-step">
      <div className="oi-step__intro">
        <h2>{m.dataset.heading}</h2>
        <p>{t(m.dataset.description, { file: file?.name ?? '', count: datasets.length })}</p>
      </div>
      <ul className="oi-datasets">
        {datasets.map((d) => (
          <li key={d.id}>
            <button type="button" className="oi-dataset" disabled={!!busy} onClick={() => session.selectDataset(d.id)}>
              <span className="oi-dataset__icon" aria-hidden>
                <Table2 />
              </span>
              <span className="oi-dataset__main">
                <span className="oi-dataset__label">{d.label}</span>
                {d.path && d.path !== d.label && <code className="oi-dataset__path">{d.path}</code>}
              </span>
              {d.rowCount !== undefined && <span className="oi-muted">{t(m.dataset.rows, { count: d.rowCount })}</span>}
              <ChevronRight aria-hidden className="oi-dataset__chevron" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
