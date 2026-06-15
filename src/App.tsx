import { useCallback, useRef, useState } from 'react'
import { ViewerCanvas } from './components/ViewerCanvas'
import { RemoteViewerCanvas } from './components/RemoteViewerCanvas'
import { SettingsPanel } from './components/SettingsPanel'
import { loadDicomFolder } from './dicom/loadDicomFolder'
import type { RendererSettings, VolumeData } from './types'
import './styles.css'

const defaultSettings: RendererSettings = {
  mode: 'Local',
  backend: 'WebGL',
  remoteBackend: 'OpenGL',
  serverUrl: 'http://localhost:8080',
}

function readSettings(): RendererSettings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem('renderer-settings') ?? '{}') }
  } catch {
    return defaultSettings
  }
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const volumeRef = useRef<VolumeData | undefined>(undefined)
  const [settings] = useState(readSettings)
  const [volumeVersion, setVolumeVersion] = useState(0)
  const [volumeInfo, setVolumeInfo] = useState<Omit<VolumeData, 'pixels'>>()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(`${settings.mode} / ${settings.mode === 'Local' ? settings.backend : settings.remoteBackend}`)
  const reportError = useCallback((error: string) => setMessage(error), [])

  const saveSettings = (next: RendererSettings) => {
    localStorage.setItem('renderer-settings', JSON.stringify(next))
    setMessage('设置已保存，刷新页面后生效')
    window.alert('设置已保存，刷新页面后生效')
  }

  const openFolder = async (files: FileList | null) => {
    if (!files?.length) return
    setLoading(true)
    setMessage('正在读取 DICOM 序列...')
    try {
      const loaded = await loadDicomFolder(files, setMessage)
      const { pixels: _pixels, ...info } = loaded
      volumeRef.current = loaded
      setVolumeInfo(info)
      setVolumeVersion((current) => current + 1)
      setMessage(`已加载 ${loaded.depth} 张切片`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main>
      <header>
        <h1>DICOM Viewer</h1>
        <button className="primary" disabled={loading} onClick={() => inputRef.current?.click()}>
          {loading ? '正在加载...' : '打开文件夹'}
        </button>
        <input
          ref={inputRef}
          className="hidden-input"
          type="file"
          multiple
          // @ts-expect-error Chromium directory picker extension
          webkitdirectory=""
          onChange={(event) => openFolder(event.target.files)}
        />
        <SettingsPanel settings={settings} onSave={saveSettings} />
        <span className="study-info">
          {volumeInfo ? `${volumeInfo.width} x ${volumeInfo.height} x ${volumeInfo.depth}` : ''}
        </span>
        <span className="status-text">当前：{settings.mode} / {settings.mode === 'Local' ? settings.backend : settings.remoteBackend}</span>
      </header>

      {settings.mode === 'Local'
        ? <ViewerCanvas backend={settings.backend} volumeRef={volumeRef} volumeVersion={volumeVersion} onError={reportError} />
        : <RemoteViewerCanvas volumeRef={volumeRef} volumeVersion={volumeVersion} settings={settings} onStatus={setMessage} onError={reportError} />}
    </main>
  )
}
