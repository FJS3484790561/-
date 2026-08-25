import { useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronDown,
  Download,
  FolderHeart,
  ImagePlus,
  Info,
  Sparkles,
  WandSparkles,
} from 'lucide-react'

const themes = ['现代简约', '北欧', '日式', '奶油风', '原木风', '轻奢']
const rooms = ['客厅', '卧室', '餐厅', '厨房', '书房']
const scales = ['保真', '均衡', '创意', '大胆']

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="select-wrap">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => <option key={option}>{option}</option>)}
        </select>
        <ChevronDown size={17} aria-hidden="true" />
      </span>
    </label>
  )
}

function App() {
  const [theme, setTheme] = useState(themes[0])
  const [room, setRoom] = useState(rooms[0])
  const [scale, setScale] = useState(scales[1])
  const [preferences, setPreferences] = useState({ layout: true, storage: true, light: false })
  const [fileName, setFileName] = useState('')
  const [status, setStatus] = useState('empty')
  const [comparePosition, setComparePosition] = useState(50)
  const inputRef = useRef(null)

  const togglePreference = (key) => {
    setPreferences((current) => ({ ...current, [key]: !current[key] }))
  }

  const handleFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setStatus('ready')
  }

  const generate = () => {
    if (!fileName) {
      setStatus('missing')
      return
    }
    setStatus('generating')
    window.setTimeout(() => setStatus('success'), 900)
  }

  const statusCopy = {
    empty: '上传一张房间照片，开始你的空间设计',
    ready: '照片已准备好，可以生成设计',
    missing: '请先上传一张 JPEG 或 PNG 房间照片',
    generating: '正在为你的空间构思方案…',
    success: '设计方案已生成，可以查看对比',
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AI 室内设计师首页">
          <span className="brand-mark"><Sparkles size={20} /></span>
          <span><strong>AI 室内设计师</strong><small>让空间更像你</small></span>
        </a>
        <nav className="topnav" aria-label="主导航">
          <a className="active" href="#studio">设计工作台</a>
          <a href="#works"><FolderHeart size={16} />我的作品</a>
          <a href="#credits"><span className="credit-dot">3</span>剩余次数</a>
        </nav>
        <button className="account-button" type="button"><span className="avatar">林</span><span>林小姐</span><ChevronDown size={16} /></button>
      </header>

      <section className="intro" id="top">
        <div>
          <p className="eyebrow"><WandSparkles size={16} /> DESIGN STUDIO</p>
          <h1>把房间变成<br /><em>喜欢的样子。</em></h1>
          <p className="intro-copy">上传一张真实房间照片，选择你的偏好，得到一个可以反复比较的设计方案。</p>
        </div>
        <div className="usage-note"><Info size={18} /><span>新用户赠送 3 次设计<br /><small>生成失败不会扣除次数</small></span></div>
      </section>

      <section className="studio-grid" id="studio">
        <aside className="control-panel clay-surface">
          <div className="panel-heading"><div><span className="section-kicker">01 / 设计参数</span><h2>告诉我你的想法</h2></div><BookOpen size={21} /></div>
          <div className="fields">
            <SelectField label="空间类型" value={room} options={rooms} onChange={setRoom} />
            <SelectField label="设计风格" value={theme} options={themes} onChange={setTheme} />
            <div className="field"><span>改造强度</span><div className="scale-options">{scales.map((option) => <button key={option} className={scale === option ? 'selected' : ''} type="button" aria-pressed={scale === option} onClick={() => setScale(option)}>{option}</button>)}</div></div>
            <div className="field"><span>固定偏好 <small>可选</small></span><div className="preference-list">
              <button className={preferences.layout ? 'preference checked' : 'preference'} type="button" aria-pressed={preferences.layout} onClick={() => togglePreference('layout')}><span>{preferences.layout && <Check size={14} />}</span>尽量保留原有布局</button>
              <button className={preferences.storage ? 'preference checked' : 'preference'} type="button" aria-pressed={preferences.storage} onClick={() => togglePreference('storage')}><span>{preferences.storage && <Check size={14} />}</span>增加实用收纳</button>
              <button className={preferences.light ? 'preference checked' : 'preference'} type="button" aria-pressed={preferences.light} onClick={() => togglePreference('light')}><span>{preferences.light && <Check size={14} />}</span>让空间更明亮</button>
            </div></div>
          </div>
          <button className="primary-button" type="button" onClick={generate}><WandSparkles size={18} />生成设计 <span>· 1 次</span></button>
          <p className="panel-footnote">每次生成只消耗 1 次额度，设计失败不会扣除。</p>
        </aside>

        <section className="workspace-panel" aria-live="polite">
          <div className="workspace-heading"><div><span className="section-kicker">02 / 设计结果</span><h2>{room} · {theme}</h2></div><span className="state-label">{statusCopy[status]}</span></div>
          <div className="image-grid">
            <div className="image-stage original-stage">
              <span className="image-label">原始照片</span>
              {fileName ? <div className="uploaded-scene"><ImagePlus size={34} /><strong>{fileName}</strong><small>已上传，等待生成</small></div> : <button className="upload-prompt" type="button" onClick={() => inputRef.current?.click()}><span className="upload-icon"><ImagePlus size={25} /></span><strong>上传房间照片</strong><small>支持 JPEG、PNG，建议小于 10MB</small><span className="upload-action">点击选择文件</span></button>}
            </div>
            <div className={status === 'success' ? 'image-stage result-stage has-result' : 'image-stage result-stage'}>
              <span className="image-label">AI 设计效果</span>
              {status === 'success' ? <div className="result-scene"><div className="result-room"><span>AI 设计预览</span><div className="result-sofa" /><div className="result-table" /><div className="result-plant" /></div><small>现代简约 · 均衡改造</small></div> : <div className="result-empty"><Sparkles size={30} /><span>{status === 'generating' ? '正在生成…' : '生成后将在这里展示'}</span></div>}
            </div>
          </div>
          <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png" onChange={handleFile} />
          {status === 'success' && <div className="compare-bar"><span>原图</span><div className="compare-track"><span /></div><span>效果图</span></div>}
          {status === 'success' && <div className="comparison-block">
            <div className="comparison-heading"><div><span className="section-kicker">03 / 效果对比</span><h3>左右拖动，看看空间的变化</h3></div><span>{comparePosition}% 效果图</span></div>
            <div className="comparison-stage">
              <div className="comparison-before"><span className="comparison-label">生成之前</span><div className="comparison-room before-room"><div className="comparison-window" /><div className="comparison-chair" /><div className="comparison-box" /></div></div>
              <div className="comparison-after" style={{ width: `${comparePosition}%` }}><span className="comparison-label">生成之后</span><div className="comparison-room after-room"><div className="comparison-window" /><div className="comparison-sofa" /><div className="comparison-plant" /></div></div>
              <div className="comparison-divider" style={{ left: `${comparePosition}%` }} aria-hidden="true"><span /></div>
              <label className="visually-hidden" htmlFor="comparison-range">调整原图和效果图的分界位置</label>
              <input id="comparison-range" className="comparison-range" type="range" min="0" max="100" value={comparePosition} aria-valuetext={`${comparePosition}% 效果图`} onChange={(event) => setComparePosition(Number(event.target.value))} />
            </div>
          </div>}
          <div className="workspace-actions"><button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}><ImagePlus size={17} />{fileName ? '更换照片' : '选择照片'}</button><button className="secondary-button" type="button" disabled={status !== 'success'}><Download size={17} />下载结果</button><button className="secondary-button" type="button" disabled={status !== 'success'}><FolderHeart size={17} />保存作品</button></div>
        </section>
      </section>

      <footer className="page-footer"><span>AI 生成结果仅供设计灵感参考</span><span>隐私说明 · 帮助中心</span></footer>
    </main>
  )
}

export default App
