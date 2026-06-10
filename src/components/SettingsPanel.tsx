import { useState } from 'react'
import type { RendererSettings } from '../types'

interface Props {
  settings: RendererSettings
  onSave(settings: RendererSettings): void
}

export function SettingsPanel({ settings, onSave }: Props) {
  const [draft, setDraft] = useState(settings)
  const update = (patch: Partial<RendererSettings>) => setDraft((current) => ({ ...current, ...patch }))

  return (
    <div className="settings">
      <label>
        渲染位置：
        <select value={draft.mode} onChange={(event) => update({ mode: event.target.value as RendererSettings['mode'] })}>
          <option value="Local">本地</option>
          <option value="Remote">远程</option>
        </select>
      </label>
      <label>
        后端：
        {draft.mode === 'Local' ? (
          <select value={draft.backend} onChange={(event) => update({ backend: event.target.value as RendererSettings['backend'] })}>
            <option value="WebGL">WebGL</option>
            <option value="WebGPU">WebGPU</option>
          </select>
        ) : (
          <select value={draft.remoteBackend} onChange={(event) => update({ remoteBackend: event.target.value as RendererSettings['remoteBackend'] })}>
            <option value="OpenGL">OpenGL</option>
            <option value="Vulkan">Vulkan</option>
          </select>
        )}
      </label>
      <label className="server-setting">
        服务器：
        <input
          value={draft.serverUrl}
          disabled={draft.mode !== 'Remote'}
          onChange={(event) => update({ serverUrl: event.target.value })}
        />
      </label>
      <button className="settings-save" onClick={() => onSave(draft)}>保存设置</button>
    </div>
  )
}
