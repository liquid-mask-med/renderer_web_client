import type { RendererSettings } from '../types'

interface Props {
  settings: RendererSettings
  onChange(settings: RendererSettings): void
}

export function SettingsPanel({ settings, onChange }: Props) {
  const update = (patch: Partial<RendererSettings>) => onChange({ ...settings, ...patch })
  return (
    <div className="settings">
      <label>
        渲染位置：
        <select value={settings.mode} onChange={(event) => update({ mode: event.target.value as RendererSettings['mode'] })}>
          <option value="Local">本地</option>
          <option value="Remote">远程</option>
        </select>
      </label>
      <label>
        后端：
        {settings.mode === 'Local' ? (
          <select value={settings.backend} onChange={(event) => update({ backend: event.target.value as RendererSettings['backend'] })}>
            <option value="WebGL">WebGL</option>
            <option value="WebGPU">WebGPU</option>
          </select>
        ) : (
          <select value={settings.remoteBackend} onChange={(event) => update({ remoteBackend: event.target.value as RendererSettings['remoteBackend'] })}>
            <option value="OpenGL">OpenGL</option>
            <option value="Vulkan">Vulkan</option>
          </select>
        )}
      </label>
      <label className="server-setting">
        服务器：
        <input
          value={settings.serverUrl}
          disabled={settings.mode !== 'Remote'}
          onChange={(event) => update({ serverUrl: event.target.value })}
        />
      </label>
    </div>
  )
}
