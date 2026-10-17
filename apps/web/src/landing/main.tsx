import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './landing.css'
import { Landing } from './landing'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
)
