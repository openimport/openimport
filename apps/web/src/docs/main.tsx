import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './docs.css'
import { Docs } from './docs'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Docs />
  </StrictMode>,
)
