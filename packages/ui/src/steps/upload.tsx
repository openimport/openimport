import { createTemplateCsv } from '@openimport/core'
import { useSession, useUpload } from '@openimport/react'
import { useState } from 'react'
import { Badge, Button } from '../components/primitives'
import { useUi } from '../context'
import { ClipboardPaste, Download, FileUp } from '../icons'
import { download, formatBytes } from '../utils'

export function UploadStep() {
  const session = useSession()
  const { m, t, maxFileSize, templateDownload } = useUi()
  const upload = useUpload()
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const fields = session.schema.fields
  const formatLabels = [...new Set(upload.formats.map((f) => f.label))]

  if (pasting) {
    return (
      <div className="oi-step oi-upload">
        <div className="oi-paste">
          <label className="oi-label" htmlFor="oi-paste">
            {m.upload.pasteHeading}
          </label>
          <textarea
            id="oi-paste"
            className="oi-textarea"
            placeholder={m.upload.pastePlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            spellCheck={false}
            rows={12}
          />
          <div className="oi-row oi-row--end">
            <Button variant="ghost" onClick={() => setPasting(false)}>
              {m.cancel}
            </Button>
            <Button variant="primary" disabled={!text.trim()} loading={upload.isLoading} onClick={() => upload.loadText(text)}>
              {m.upload.pasteSubmit}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="oi-step oi-upload">
      <div className="oi-dropzone" {...upload.getRootProps()}>
        <input {...upload.getInputProps()} aria-label={m.upload.browse} />
        <div className="oi-dropzone__icon" aria-hidden>
          <FileUp />
        </div>
        <p className="oi-dropzone__title">{upload.isDragging ? m.upload.dropNow : m.upload.drop}</p>
        <p className="oi-dropzone__or">{m.upload.or}</p>
        <Button variant="primary" onClick={upload.open} loading={upload.isLoading}>
          {m.upload.browse}
        </Button>
        <div className="oi-dropzone__formats">
          {formatLabels.map((label) => (
            <span key={label} className="oi-chip">
              {label}
            </span>
          ))}
          {maxFileSize ? <span className="oi-muted">· {t(m.upload.maxSize, { size: formatBytes(maxFileSize) })}</span> : null}
        </div>
      </div>

      <div className="oi-upload__aside">
        <div className="oi-upload__actions">
          <Button variant="ghost" size="sm" icon={<ClipboardPaste aria-hidden />} onClick={() => setPasting(true)}>
            {m.upload.paste}
          </Button>
          {templateDownload && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Download aria-hidden />}
              onClick={() => download(createTemplateCsv(session.schema), `${session.schema.id ?? 'template'}.csv`)}
              title={m.upload.templateHint}
            >
              {m.upload.template}
            </Button>
          )}
        </div>
        <details className="oi-expected">
          <summary>
            {m.upload.expected} <Badge>{fields.length}</Badge>
          </summary>
          <ul>
            {fields.map((f) => (
              <li key={f.key}>
                <span>{f.label}</span>
                {f.required && <span className="oi-required">{m.upload.required}</span>}
                {f.description && <span className="oi-muted"> — {f.description}</span>}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  )
}
