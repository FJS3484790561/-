import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, ArrowDown, ArrowUp, BarChart3, Check, CheckCircle2, Copy, Database, ImagePlus, KeyRound, LogOut, MessageSquare, Pencil, Plus, RefreshCw, ServerCog, ShieldCheck, Ticket, Trash2, Users, X, XCircle } from 'lucide-react'
import { adminApi, ApiError } from './admin-api'

const blank = { name: '', endpoint: '', model: '' }
const copy = {
  INVALID_CREDENTIALS: '邮箱或密码不正确。',
  VALIDATION_ERROR: '请检查表单中的必填项。',
  PROVIDER_ALREADY_EXISTS: '该 Provider 名称已存在。',
  NOT_FOUND: '该 Provider 已不存在，请刷新列表。',
  INTERNAL_ERROR: '服务暂时不可用，请稍后重试。',
  INVALID_RESPONSE: '服务返回了无法识别的响应。',
  OVERVIEW_UNAVAILABLE: '当前环境未连接统计数据库，暂时无法读取总体数据。',
  STORAGE_UNAVAILABLE: '当前环境未连接图片存储，暂时不能上传参考图。',
  UNAUTHORIZED: '登录状态已失效，请重新登录。',
  FORBIDDEN: '当前账号没有管理员权限。',
  PROVIDER_TEST_FAILED: 'Provider 测试失败，请检查接口、模型和 API Key。',
  INVALID_PROVIDER_RESPONSE: 'Provider 已响应，但没有返回有效图片。',
  PROVIDER_TEST_UNAVAILABLE: 'Provider 测试服务暂不可用。',
  INVALID_REDEMPTION_CODE: '兑换码无效。',
  REDEMPTION_CODE_ALREADY_USED: '该用户已经兑换过此码。',
  REDEMPTION_CODE_EXHAUSTED: '兑换人数已达到上限。',
  REDEMPTION_CODE_EMAIL_MISMATCH: '该兑换码绑定了其他邮箱。',
  FEEDBACK_ALREADY_ACCEPTED: '这条反馈已经采纳。',
  FEEDBACK_NOT_REJECTED: '只有标记为不采纳后才能删除反馈。',
  MAIL_UNAVAILABLE: '邮件发送失败，请检查发信配置后重试。',
  STYLE_ALREADY_EXISTS: '这个风格已经存在，请换一个名称。',
}
const messageFor = (error, fallback = '操作未完成，请稍后重试。') => error instanceof TypeError ? '无法连接本地服务，请确认 API 已启动。' : copy[error?.code] || fallback
const formatTime = (value) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const formatBytes = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
function readImagePayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('FILE_READ_FAILED'))
    reader.onload = () => resolve({ name: file.name, type: file.type, dataBase64: String(reader.result).split(',', 2)[1] ?? '' })
    reader.readAsDataURL(file)
  })
}
function Overview({ providers, redemptionCodes }) {
  const [state, setState] = useState({ data: null, error: '' })
  const [revision, setRevision] = useState(0)
  const loading = state.revision !== revision || state.providers !== providers || state.redemptionCodes !== redemptionCodes
  const load = () => setRevision((value) => value + 1)
  useEffect(() => {
    let active = true
    adminApi.getOverview()
      .then((result) => { if (active) setState({ revision, providers, redemptionCodes, data: result.overview, error: '' }) })
      .catch((error) => { if (active) setState({ revision, providers, redemptionCodes, data: null, error: messageFor(error, '总览读取失败，请重试。') }) })
    return () => { active = false }
  }, [revision, providers, redemptionCodes])
  const data = state.data
  return <section className="provider-section overview-section" aria-label="总体数据" aria-busy={loading}>
    <header className="section-heading">
      <div><h2><BarChart3 size={19} />总体数据</h2><p>只读统计，不包含密钥、密码、用户资料或图片内容。</p></div>
      <button className="icon-button" onClick={load} disabled={loading} aria-label="刷新总体数据" title="刷新">
        <RefreshCw className={loading ? 'spin' : ''} size={18} />
      </button>
    </header>
    {loading && <div className="loading-row" role="status">正在读取统计</div>}
    {!loading && state.error && <Alert kind="error" action={<button onClick={load}>重试</button>}>{state.error}</Alert>}
    {data && <>
      <div className="overview-grid">
        <Stat icon={<Users size={17} />} label="用户" value={data.users.total} note={`今日 +${data.users.today} · 近 7 日 +${data.users.last7Days}`} />
        <Stat label="生成任务" value={data.generations.total} note={`成功 ${data.generations.succeeded} · 失败 ${data.generations.failed} · 排队/运行 ${data.generations.running}`} />
        <Stat label="生成成功率" value={data.generations.successRate == null ? '—' : `${data.generations.successRate}%`} note={`今日 ${data.generations.today} · 近 7 日 ${data.generations.last7Days}`} />
        <Stat icon={<Database size={17} />} label="作品" value={data.works.total} note={`今日 ${data.works.today} · 近 7 日 ${data.works.last7Days}`} />
        <Stat label="可用点数" value={data.credits.available} note={`累计发放 ${data.credits.granted} · 预留 ${data.credits.reserved} · 已消耗 ${data.credits.consumed}`} />
        <Stat label="兑换码" value={data.redemptionCodes.total} note={`已兑换 ${data.redemptionCodes.redemptions} · 剩余名额 ${data.redemptionCodes.remaining}`} />
        <Stat label="Provider" value={data.providers.total} note={`启用 ${data.providers.enabled} · 停用 ${data.providers.disabled}`} />
        <Stat label="存储对象" value={data.storage.objects} note={`已记录大小 ${formatBytes(data.storage.bytes)}`} />
      </div>
      <p className="overview-note">北京时间 · 近 7 日含今天及前 6 个自然日 · 更新于 {formatTime(data.generatedAt)}</p>
      <p className="overview-note">用户数含管理员；成功率 = 成功 /（成功 + 失败），不计排队和运行中任务。可用点数不含过期和已预留额度。存储仅统计本站记录，不代表整个 COS 桶用量；支付收入未纳入。</p>
    </>}
  </section>
}
function Stat({ icon, label, value, note }) { return <div className="overview-stat">{icon || <Activity size={17} />}<small>{label}</small><strong>{value}</strong><span>{note}</span></div> }

function Login({ onAuthenticated }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      const result = await adminApi.login(data.get('email'), data.get('password'))
      form.reset()
      await onAuthenticated(result.user)
    } catch (error) {
      setMessage(messageFor(error, '登录失败，请重试。'))
    } finally {
      setBusy(false)
    }
  }
  return <main className="auth-shell"><section className="auth-panel" aria-labelledby="login-title">
    <Brand />
    <div className="auth-heading"><span className="kicker"><ShieldCheck size={15} />受限区域</span><h1 id="login-title">管理员登录</h1><p>使用服务器预置的管理员账号进入配置控制台。</p></div>
    <form className="auth-form" onSubmit={submit}>
      <label><span>管理员邮箱</span><input name="email" type="email" autoComplete="username" required placeholder="name@example.com" /></label>
      <label><span>密码</span><input name="password" type="password" autoComplete="current-password" minLength="8" required placeholder="输入密码" /></label>
      {message && <Alert kind="error">{message}</Alert>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? <RefreshCw className="spin" size={18} /> : <KeyRound size={18} />}{busy ? '正在验证' : '安全登录'}</button>
    </form>
    <p className="auth-footnote">管理员账号不可在网页注册，由服务器内部预置。</p>
  </section></main>
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><ServerCog size={21} /></span><span><strong>空间设计管理台</strong><small>Provider Operations</small></span></div>
}

function Alert({ kind, children, action }) {
  return <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{kind === 'error' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<span>{children}</span>{action}</div>
}

function Forbidden({ email, onLogout }) {
  return <main className="auth-shell"><section className="auth-panel permission-panel">
    <span className="permission-icon"><ShieldCheck size={34} /></span><span className="kicker">HTTP 403</span>
    <h1>没有管理员权限</h1><p>账号 <strong>{email}</strong> 已登录，但不能读取或修改 Provider 配置。</p>
    <button className="secondary-button" type="button" onClick={onLogout}><LogOut size={17} />退出并更换账号</button>
  </section></main>
}

function ProviderForm({ provider, onClose, onSaved }) {
  const [values, setValues] = useState(provider ? { name: provider.name, endpoint: provider.endpoint, model: provider.model, kind: provider.kind ?? 'image' } : { ...blank, kind: 'image' })
  const [fields, setFields] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const editing = Boolean(provider)
  function validate(form) {
    const errors = {}
    if (!values.name.trim()) errors.name = '请输入名称。'
    if (!values.endpoint.trim()) errors.endpoint = '请输入端点。'
    else try {
      const url = new URL(values.endpoint)
      if (!['http:', 'https:'].includes(url.protocol)) errors.endpoint = '请输入有效的 HTTP(S) 地址。'
    } catch { errors.endpoint = '请输入完整地址，例如 https://example.com/v1。' }
    if (!values.model.trim()) errors.model = '请输入模型名称。'
    if (!editing && !form.elements.apiKey.value.trim()) errors.apiKey = '新建 Provider 时必须输入密钥。'
    setFields(errors)
    return !Object.keys(errors).length
  }
  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    if (!validate(form)) return
    setBusy(true); setMessage(''); setFields({})
    const key = form.elements.apiKey.value
    const payload = { name: values.name.trim(), endpoint: values.endpoint.trim(), model: values.model.trim(), kind: values.kind, ...(key ? { apiKey: key } : {}) }
    try {
      console.info('[Provider Test] started', { provider: payload.name, model: payload.model })
      const result = await adminApi.testAndSaveProvider(editing ? { ...payload, providerId: provider.id } : payload)
      console.info('[Provider Test] completed', { traceId: result.traceId, stage: result.stage, httpStatus: result.httpStatus, ok: true })
      form.elements.apiKey.value = ''
      onSaved(result.provider, editing ? 'Provider 配置已更新。' : 'Provider 已创建，默认处于停用状态。')
    } catch (error) {
      form.elements.apiKey.value = ''
      setFields(error instanceof ApiError ? error.fields : {})
      console.error('[Provider Test] failed', { code: error?.code, traceId: error?.traceId, stage: error?.stage, httpStatus: error?.httpStatus })
      setMessage(`${messageFor(error)}${error?.traceId ? `（追踪编号：${error.traceId}）` : ''}`)
    } finally { setBusy(false) }
  }
  const field = (name, label, placeholder) => <label><span>{label}</span><input value={values[name]} onChange={(event) => setValues({ ...values, [name]: event.target.value })} placeholder={placeholder} aria-invalid={Boolean(fields[name])} aria-describedby={fields[name] ? `${name}-error` : undefined} /><small id={`${name}-error`}>{fields[name]}</small></label>
  return <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="form-title">
    <header className="dialog-header"><div><span className="kicker">{editing ? '配置维护' : '接入配置'}</span><h2 id="form-title">{editing ? '编辑 Provider' : '新建 Provider'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭表单"><X size={19} /></button></header>
    <form className="provider-form" onSubmit={submit}>
      {field('name', '名称', 'render-api')}
      <label><span>Provider 类型</span><select value={values.kind} onChange={(event) => setValues({ ...values, kind: event.target.value })}><option value="image">图像生成</option><option value="conversation">对话分析</option></select></label>
      {field('endpoint', values.kind === 'conversation' ? '对话 API 端点' : '图片编辑 API 端点', values.kind === 'conversation' ? 'https://provider.example/v1/chat/completions' : 'https://provider.example/v1/images/edits')}{field('model', values.kind === 'conversation' ? '对话模型' : '图片编辑模型', values.kind === 'conversation' ? 'gpt-4o' : 'image-edit-v1')}
      <p className="form-help">对话 Provider 必须兼容 Chat Completions，并能读取图片；图像 Provider 只接收原始房间图和对话阶段生成的提示词。</p>
      <label><span>{editing ? '轮换密钥（可选）' : 'API 密钥'}</span><input name="apiKey" type="password" autoComplete="new-password" placeholder={editing ? '留空则保持现有密钥' : '仅用于本次保存'} aria-invalid={Boolean(fields.apiKey)} aria-describedby="key-help" /><small id="key-help">{fields.apiKey || (editing ? '现有密钥不会回填；输入新值即完成轮换。' : '保存后页面不会显示或回填密钥。')}</small></label>
      {message && <Alert kind="error">{message}</Alert>}
      <div className="dialog-actions"><button className="text-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact" type="submit" disabled={busy}>{busy && <RefreshCw className="spin" size={17} />}{busy ? '正在测试并保存' : '测试并保存'}</button></div>
    </form>
  </section></div>
}

function Audit({ provider, onClose }) {
  const [state, setState] = useState({ loading: true, entries: [], error: '' })
  useEffect(() => {
    let active = true
    adminApi.listAudit(provider.id).then((result) => active && setState({ loading: false, entries: result.audit, error: '' })).catch((error) => active && setState({ loading: false, entries: [], error: messageFor(error) }))
    return () => { active = false }
  }, [provider.id])
  const names = { created: '创建配置', updated: '更新配置', enabled: '启用服务', disabled: '停用服务' }
  return <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog audit-panel" role="dialog" aria-modal="true" aria-labelledby="audit-title">
    <header className="dialog-header"><div><span className="kicker">脱敏操作记录</span><h2 id="audit-title">{provider.name} · 审计</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭审计记录"><X size={19} /></button></header>
    {state.loading && <div className="loading-row" role="status"><RefreshCw className="spin" size={18} />正在读取审计记录</div>}
    {state.error && <Alert kind="error">{state.error}</Alert>}
    {!state.loading && !state.error && !state.entries.length && <div className="empty-mini">暂无审计记录</div>}
    <ol className="audit-list">{state.entries.map((entry) => <li key={entry.id}><span className="audit-dot" /><div><strong>{names[entry.action] || entry.action}</strong><small>{formatTime(entry.occurredAt)}</small></div></li>)}</ol>
    <p className="security-note"><ShieldCheck size={16} />审计记录不包含 API 密钥。</p>
  </section></div>
}

function StyleReferenceLibrary({ initialReferences }) {
  const [items, setItems] = useState(initialReferences)
  const [values, setValues] = useState({ name: '', theme: '', description: '' })
  const [image, setImage] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault(); setError('')
    const form = event.currentTarget
    if (!values.name.trim() || !values.theme.trim() || !image) { setError('请填写名称、风格和参考图片。'); return }
    if (!['image/jpeg', 'image/png'].includes(image.type) || image.size > 10 * 1024 * 1024) { setError('请选择 10MB 以内的 JPEG 或 PNG 图片。'); return }
    setBusy(true)
    try {
      const result = await adminApi.createStyleReference({ ...values, name: values.name.trim(), theme: values.theme.trim(), description: values.description.trim(), image: await readImagePayload(image) })
      setItems((current) => [result.styleReference, ...current]); setValues({ name: '', theme: '', description: '' }); setImage(null); form.reset()
    } catch (reason) { setError(messageFor(reason, '风格参考图上传失败，请重试。')) } finally { setBusy(false) }
  }
  async function toggle(item) {
    try { const result = await adminApi.setStyleReferenceEnabled(item.id, !item.enabled); setItems((current) => current.map((entry) => entry.id === item.id ? result.styleReference : entry)) } catch (reason) { setError(messageFor(reason, '状态更新失败，请重试。')) }
  }
  async function remove(item) {
    if (!window.confirm('确定删除这张风格参考图吗？')) return
    try { await adminApi.removeStyleReference(item.id); setItems((current) => current.filter((entry) => entry.id !== item.id)) } catch (reason) { setError(messageFor(reason, '删除失败，请重试。')) }
  }
  async function move(item, direction) {
    const index = items.findIndex((entry) => entry.id === item.id); const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= items.length) return
    const previous = items; const next = [...items]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    setItems(next)
    try { const result = await adminApi.reorderStyleReferences(next.map((entry) => entry.id)); setItems(result.styleReferences) } catch (reason) { setItems(previous); setError(messageFor(reason, '排序保存失败，请重试。')) }
  }
  async function saveEdit(event) {
    event.preventDefault(); setError(''); setBusy(true)
    try { const result = await adminApi.updateStyleReference(editing.id, { name: editing.name.trim(), theme: editing.theme.trim(), description: editing.description.trim(), ...(editing.image ? { image: await readImagePayload(editing.image) } : {}) }); setItems((current) => current.map((entry) => entry.id === editing.id ? result.styleReference : entry)); setEditing(null) } catch (reason) { setError(messageFor(reason, '风格保存失败，请重试。')) } finally { setBusy(false) }
  }
  return <section className="provider-section style-reference-section">
    <header className="section-heading"><div><h2><ImagePlus size={19} />设计风格参考图</h2><p>仅供用户浏览，不会进入对话分析或图像生成请求。</p></div></header>
    <form className="style-reference-form" onSubmit={submit}>
      <label><span>名称</span><input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="例如：暖木客厅" maxLength="80" /></label>
      <label><span>对应风格</span><input value={values.theme} onChange={(event) => setValues({ ...values, theme: event.target.value })} placeholder="例如：现代简约" maxLength="40" /></label>
      <label><span>说明（可选）</span><input value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} placeholder="给用户看的简短说明" maxLength="300" /></label>
      <label className="file-input"><span>参考图片</span><input type="file" accept="image/jpeg,image/png" onChange={(event) => setImage(event.target.files?.[0] ?? null)} /><small>{image ? `${image.name} · ${formatBytes(image.size)}` : 'JPEG / PNG，最大 10MB'}</small></label>
      {error && <Alert kind="error">{error}</Alert>}
      <button className="primary-button compact" type="submit" disabled={busy}>{busy ? <RefreshCw className="spin" size={17} /> : <Plus size={17} />}{busy ? '上传中' : '上传参考图'}</button>
    </form>
    {!items.length ? <div className="empty-mini">还没有上传风格参考图</div> : <div className="style-reference-list">{items.map((item, index) => <article className={item.enabled ? 'style-reference-row' : 'style-reference-row is-disabled'} key={item.id}><img src={item.image.url} alt="" /><div className="style-reference-copy"><strong>{item.name}</strong><small>{item.theme}{item.description ? ` · ${item.description}` : ''}</small></div><div className="style-reference-actions"><button className="icon-button" type="button" onClick={() => move(item, -1)} disabled={index === 0} aria-label="上移"><ArrowUp size={16} /></button><button className="icon-button" type="button" onClick={() => move(item, 1)} disabled={index === items.length - 1} aria-label="下移"><ArrowDown size={16} /></button><button className="text-button" type="button" onClick={() => setEditing({ ...item, image: null })}><Pencil size={15} />编辑</button><button className="text-button" type="button" onClick={() => toggle(item)}>{item.enabled ? '停用' : '启用'}</button><button className="text-button danger-text" type="button" onClick={() => remove(item)}><Trash2 size={15} />删除</button></div></article>)}</div>}
    {editing && <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setEditing(null)}><section className="dialog" role="dialog" aria-modal="true"><header className="dialog-header"><div><span className="kicker">风格管理</span><h2>编辑风格</h2></div><button className="icon-button" type="button" onClick={() => setEditing(null)} aria-label="关闭"><X size={18} /></button></header><form className="auth-form" onSubmit={saveEdit}><label><span>名称</span><input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label><span>对应风格</span><input value={editing.theme} onChange={(event) => setEditing({ ...editing, theme: event.target.value })} /></label><label><span>说明</span><input value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><label className="file-input"><span>替换参考图（可选）</span><input type="file" accept="image/jpeg,image/png" onChange={(event) => setEditing({ ...editing, image: event.target.files?.[0] ?? null })} /></label><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? '保存中' : '保存修改'}</button></div></form></section></div>}
  </section>
}

function PromptDebug({ initialItems = [] }) {
  const [items, setItems] = useState(initialItems); const [loading, setLoading] = useState(false)
  async function refresh() { setLoading(true); try { const result = await adminApi.listGenerationDebug(); setItems(result.promptDebugs) } finally { setLoading(false) } }
  return <section className="provider-section prompt-debug-section"><header className="section-heading"><div><h2><MessageSquare size={19} />图生图提示词调试</h2><p>查看最近一次对话 Provider 生成并交给图像 Provider 的完整提示词。</p></div><button className="icon-button" type="button" onClick={refresh} disabled={loading} aria-label="刷新提示词"><RefreshCw className={loading ? 'spin' : ''} size={18} /></button></header>{!items.length ? <div className="empty-mini">还没有生成提示词</div> : <div className="prompt-debug-list">{items.map((item) => <article key={item.id}><div><strong>{item.room} · {item.theme}</strong><small>{formatTime(item.createdAt)} · {item.traceId}</small></div><pre>{item.prompt}</pre></article>)}</div>}</section>
}

function RedemptionCodes({ codes, onCreated, onDeleted }) {
  const [credits, setCredits] = useState(5)
  const [maxRedemptions, setMaxRedemptions] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newCode, setNewCode] = useState('')
  async function create(event) {
    event.preventDefault()
    setBusy(true); setError(''); setNewCode('')
    try {
      const result = await adminApi.createRedemptionCode({ credits: Number(credits), maxRedemptions: Number(maxRedemptions) })
      setNewCode(result.code)
      onCreated(result.redemptionCode)
    } catch (reason) {
      setError(messageFor(reason, '兑换码生成失败，请重试。'))
    } finally { setBusy(false) }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(newCode) } catch { setError('复制失败，请手动选择兑换码。') }
  }
  return <section className="provider-section redemption-section">
    <header className="section-heading"><div><h2>兑换码管理</h2><p>设置到账点数和最多可兑换人数；每位用户只能兑换一次。</p></div><Ticket size={21} /></header>
    <form className="redemption-form" onSubmit={create}>
      <label><span>每人增加点数</span><input type="number" min="1" max="100000" step="1" value={credits} onChange={(event) => setCredits(event.target.value)} required /></label>
      <label><span>最多兑换人数</span><input type="number" min="1" max="100000" step="1" value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} required /></label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? <RefreshCw className="spin" size={17} /> : <Plus size={17} />}{busy ? '生成中' : '生成兑换码'}</button>
    </form>
    {error && <Alert kind="error">{error}</Alert>}
    {newCode && <div className="new-code" role="status"><div><small>新兑换码</small><code>{newCode}</code></div><button className="secondary-button" type="button" onClick={copyCode}><Copy size={16} />复制</button></div>}
    {!codes.length ? <div className="empty-mini">还没有生成兑换码</div> : <div className="redemption-list">{codes.map((code) => <RedemptionCodeRow key={code.id} code={code} onDeleted={onDeleted} />)}</div>}
    <p className="security-note"><ShieldCheck size={16} />兑换码由服务器加密保存，仅管理员可查看；已兑换记录删除后仍保留审计痕迹。</p>
  </section>
}

function RedemptionCodeRow({ code, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function remove() {
    if (!window.confirm('确定删除这条兑换码记录吗？')) return
    setBusy(true); setError('')
    try { const result = await adminApi.removeRedemptionCode(code.id); onDeleted(result.redemptionCode ?? code) } catch (reason) { setError(messageFor(reason, '兑换码删除失败，请重试。')) } finally { setBusy(false) }
  }
  async function copy() { try { await navigator.clipboard.writeText(code.code ?? '') } catch { setError('复制失败，请手动选择兑换码。') } }
  return <article className={code.deletedAt ? 'redemption-row is-deleted' : 'redemption-row'}><div className="redemption-code-main"><strong>{code.code ?? code.preview}</strong><small>{formatTime(code.createdAt)}{code.boundEmail ? ` · ${code.boundEmail}` : ''}</small></div><dl><div><dt>每人点数</dt><dd>{code.credits}</dd></div><div><dt>已兑换</dt><dd>{code.redeemedCount} / {code.maxRedemptions}</dd></div><div><dt>剩余名额</dt><dd>{code.remainingRedemptions}</dd></div></dl><div className="redemption-row-actions">{code.deletedAt ? <span className="badge">已删除</span> : <><button className="text-button" type="button" onClick={copy} disabled={!code.code}><Copy size={15} />复制</button><button className="text-button danger-text" type="button" onClick={remove} disabled={busy}><Trash2 size={15} />{busy ? '删除中' : '删除'}</button></>}{error && <small className="inline-error">{error}</small>}</div></article>
}

function FeedbackList({ initialFeedback }) {
  const [items, setItems] = useState(initialFeedback)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const update = (item) => setItems((current) => current.map((entry) => entry.id === item.id ? item : entry))
  async function decide(item, decision) {
    const credits = decision === 'accept' ? Number(window.prompt('请输入奖励点数', '10')) : undefined
    if (decision === 'accept' && (!Number.isSafeInteger(credits) || credits < 1)) return
    setBusyId(item.id); setError('')
    try { const result = await adminApi.decideFeedback(item.id, decision, credits); update(result.feedback) } catch (reason) { setError(messageFor(reason, '反馈处理失败，请重试。')) } finally { setBusyId('') }
  }
  async function remove(item) {
    setBusyId(item.id); setError('')
    try { await adminApi.removeFeedback(item.id); setItems((current) => current.filter((entry) => entry.id !== item.id)) } catch (reason) { setError(messageFor(reason, '反馈删除失败，请重试。')) } finally { setBusyId('') }
  }
  return <section className="provider-section feedback-section"><header className="section-heading"><div><h2><MessageSquare size={19} />用户反馈</h2><p>采纳后按你输入的点数发送一次性兑换码；邮件失败可安全重试。</p></div></header>{error && <Alert kind="error">{error}</Alert>}{!items.length ? <div className="empty-mini">暂无用户反馈</div> : <div className="feedback-list">{items.map((item) => <article className={`feedback-row status-${item.status}`} key={item.id}><div className="feedback-content"><div className="feedback-meta"><strong>{item.email}</strong><span className="badge">{item.status === 'pending' ? '待处理' : item.status === 'accepted' ? '已采纳' : '不采纳'}</span><small>{formatTime(item.createdAt)}</small></div><p>{item.message}</p>{item.mailStatus === 'failed' && <small className="inline-error">上次发信失败，可再次点击采纳重试</small>}</div><div className="feedback-actions">{item.status !== 'accepted' && <button className="text-button accept-text" type="button" disabled={busyId === item.id} onClick={() => decide(item, 'accept')}><Check size={16} />采纳</button>}{item.status === 'pending' && <button className="text-button danger-text" type="button" disabled={busyId === item.id} onClick={() => decide(item, 'reject')}><XCircle size={16} />不采纳</button>}{item.status === 'rejected' && <button className="text-button danger-text" type="button" disabled={busyId === item.id} onClick={() => remove(item)}><Trash2 size={16} />删除</button>}</div></article>)}</div>}</section>
}

function Console({ user, initialProviders, initialRedemptionCodes, initialFeedback, initialStyleReferences, initialPromptDebugs, onLogout }) {
  const [providers, setProviders] = useState(initialProviders)
  const [redemptionCodes, setRedemptionCodes] = useState(initialRedemptionCodes)
  const [dialog, setDialog] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  async function refresh() {
    setError('')
    try { setProviders((await adminApi.listProviders()).providers) } catch (errorValue) { setError(messageFor(errorValue)) }
  }
  function saved(provider, text) {
    setProviders((current) => current.some((item) => item.id === provider.id) ? current.map((item) => item.id === provider.id ? provider : item) : [provider, ...current])
    setDialog(null); setNotice(text)
  }
  async function toggle(provider) {
    setBusyId(provider.id); setError('')
    try {
      const result = await adminApi.setProviderEnabled(provider.id, !provider.enabled)
      setProviders((current) => current.map((item) => item.id === provider.id ? result.provider : item))
      setNotice(`${provider.name} 已${result.provider.enabled ? '启用' : '停用'}。`)
    } catch (errorValue) { setError(messageFor(errorValue)) } finally { setBusyId('') }
  }
  return <main className="admin-shell">
    <header className="topbar"><Brand /><div className="account"><span><ShieldCheck size={15} />{user.email}</span><button className="icon-button" onClick={onLogout} aria-label="退出管理员账号" title="退出"><LogOut size={18} /></button></div></header>
    <section className="console-heading"><div><span className="kicker"><Activity size={15} />系统配置</span><h1>运营管理</h1><p>维护图片 Provider、兑换码和用户额度发放。</p></div><button className="primary-button add-button" onClick={() => setDialog({ type: 'form' })}><Plus size={18} />新建 Provider</button></section>
    <section className="summary" aria-label="Provider 概览"><div><small>全部配置</small><strong>{providers.length}</strong></div><div><small>已启用</small><strong>{providers.filter((item) => item.enabled).length}</strong></div><div><small>密钥已配置</small><strong>{providers.filter((item) => item.apiKeyConfigured).length}</strong></div></section>
    <div className="status-region" aria-live="polite">{notice && <Alert kind="success" action={<button onClick={() => setNotice('')} aria-label="关闭成功消息"><X size={15} /></button>}>{notice}</Alert>}{error && <Alert kind="error" action={<button onClick={refresh}>重试</button>}>{error}</Alert>}</div>
    <Overview providers={providers} redemptionCodes={redemptionCodes} />
    <section className="provider-section">
      <header className="section-heading"><div><h2>连接配置</h2><p>密钥始终以脱敏状态呈现。</p></div><button className="icon-button" onClick={refresh} aria-label="刷新 Provider 列表" title="刷新"><RefreshCw size={18} /></button></header>
      {!providers.length ? <div className="empty-state"><span><ServerCog size={28} /></span><h3>尚未配置 Provider</h3><p>创建第一条连接配置。新配置默认停用。</p><button className="secondary-button" onClick={() => setDialog({ type: 'form' })}><Plus size={17} />新建 Provider</button></div> :
      <div className="provider-list">{providers.map((provider) => <article className="provider-row" key={provider.id}>
        <div className="provider-main"><span className={provider.enabled ? 'status-dot enabled' : 'status-dot'} /><div><div className="provider-title"><h3>{provider.name}</h3><span className="badge">{provider.kind === 'conversation' ? '对话 Provider' : '图像 Provider'}</span><span className={provider.enabled ? 'badge enabled' : 'badge'}>{provider.enabled ? '已启用' : '已停用'}</span></div><p>{provider.endpoint}</p></div></div>
        <dl><div><dt>模型</dt><dd>{provider.model}</dd></div><div><dt>密钥</dt><dd>{provider.apiKeyConfigured ? provider.apiKeyMasked : '未配置'}</dd></div><div><dt>更新时间</dt><dd>{formatTime(provider.updatedAt)}</dd></div></dl>
        <div className="actions"><button className="text-button" onClick={() => setDialog({ type: 'audit', provider })}><Activity size={16} />审计</button><button className="text-button" onClick={() => setDialog({ type: 'form', provider })}><Pencil size={16} />编辑</button><button className={provider.enabled ? 'toggle enabled' : 'toggle'} aria-pressed={provider.enabled} disabled={busyId === provider.id} onClick={() => toggle(provider)}><span />{busyId === provider.id ? '处理中' : provider.enabled ? '停用' : '启用'}</button></div>
      </article>)}</div>}
    </section>
    <RedemptionCodes codes={redemptionCodes} onCreated={(code) => setRedemptionCodes((current) => [code, ...current])} onDeleted={(deleted) => setRedemptionCodes((current) => deleted.deletedAt ? current.map((item) => item.id === deleted.id ? deleted : item) : current.filter((item) => item.id !== deleted.id))} />
    <FeedbackList initialFeedback={initialFeedback} />
    <StyleReferenceLibrary initialReferences={initialStyleReferences} />
    <PromptDebug initialItems={initialPromptDebugs} />
    <footer><span><ShieldCheck size={15} />权限、密钥与兑换码由服务器端保护</span><span>敏感值不会回填到页面</span></footer>
    {dialog?.type === 'form' && <ProviderForm provider={dialog.provider} onClose={() => setDialog(null)} onSaved={saved} />}
    {dialog?.type === 'audit' && <Audit provider={dialog.provider} onClose={() => setDialog(null)} />}
  </main>
}

function App() {
  const [state, setState] = useState({ view: 'loading' })
  async function establish(user) {
    try {
      const [providers, redemptionCodes, feedback, styleReferences, promptDebug] = await Promise.all([adminApi.listProviders(), adminApi.listRedemptionCodes(), adminApi.listFeedback(), adminApi.listStyleReferences(), adminApi.listGenerationDebug()])
      setState({ view: 'console', user, providers: providers.providers, redemptionCodes: redemptionCodes.redemptionCodes, feedback: feedback.feedback, styleReferences: styleReferences.styleReferences, promptDebugs: promptDebug.promptDebugs })
    } catch (error) {
      setState(error.status === 403 ? { view: 'forbidden', user } : { view: 'login' })
    }
  }
  useEffect(() => {
    let active = true
    adminApi.session().then((result) => active && establish(result.user)).catch(() => active && setState({ view: 'login' }))
    return () => { active = false }
  }, [])
  async function logout() {
    try { await adminApi.logout() } finally { setState({ view: 'login' }) }
  }
  if (state.view === 'loading') return <main className="loading-screen" role="status"><RefreshCw className="spin" size={22} />正在恢复管理员会话</main>
  if (state.view === 'forbidden') return <Forbidden email={state.user.email} onLogout={logout} />
  if (state.view === 'console') return <Console user={state.user} initialProviders={state.providers} initialRedemptionCodes={state.redemptionCodes} initialFeedback={state.feedback} initialStyleReferences={state.styleReferences} initialPromptDebugs={state.promptDebugs} onLogout={logout} />
  return <Login onAuthenticated={establish} />
}

export default App
