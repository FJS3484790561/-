import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, KeyRound, LogOut, Pencil, Plus, RefreshCw, ServerCog, ShieldCheck, X } from 'lucide-react'
import { adminApi, ApiError } from './admin-api'

const blank = { name: '', endpoint: '', model: '' }
const copy = {
  INVALID_CREDENTIALS: '邮箱或密码不正确。',
  VALIDATION_ERROR: '请检查表单中的必填项。',
  PROVIDER_ALREADY_EXISTS: '该 Provider 名称已存在。',
  NOT_FOUND: '该 Provider 已不存在，请刷新列表。',
  INTERNAL_ERROR: '服务暂时不可用，请稍后重试。',
  INVALID_RESPONSE: '服务返回了无法识别的响应。',
}
const messageFor = (error, fallback = '操作未完成，请稍后重试。') => error instanceof TypeError ? '无法连接本地服务，请确认 API 已启动。' : copy[error?.code] || fallback
const formatTime = (value) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

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
  const [values, setValues] = useState(provider ? { name: provider.name, endpoint: provider.endpoint, model: provider.model } : blank)
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
    const payload = { name: values.name.trim(), endpoint: values.endpoint.trim(), model: values.model.trim(), ...(key ? { apiKey: key } : {}) }
    try {
      const result = editing ? await adminApi.updateProvider(provider.id, payload) : await adminApi.createProvider(payload)
      form.elements.apiKey.value = ''
      onSaved(result.provider, editing ? 'Provider 配置已更新。' : 'Provider 已创建，默认处于停用状态。')
    } catch (error) {
      form.elements.apiKey.value = ''
      setFields(error instanceof ApiError ? error.fields : {})
      setMessage(messageFor(error))
    } finally { setBusy(false) }
  }
  const field = (name, label, placeholder) => <label><span>{label}</span><input value={values[name]} onChange={(event) => setValues({ ...values, [name]: event.target.value })} placeholder={placeholder} aria-invalid={Boolean(fields[name])} aria-describedby={fields[name] ? `${name}-error` : undefined} /><small id={`${name}-error`}>{fields[name]}</small></label>
  return <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="form-title">
    <header className="dialog-header"><div><span className="kicker">{editing ? '配置维护' : '接入配置'}</span><h2 id="form-title">{editing ? '编辑 Provider' : '新建 Provider'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭表单"><X size={19} /></button></header>
    <form className="provider-form" onSubmit={submit}>
      {field('name', '名称', 'render-api')}{field('endpoint', 'API 端点', 'https://provider.example/v1')}{field('model', '模型', 'interior-v1')}
      <label><span>{editing ? '轮换密钥（可选）' : 'API 密钥'}</span><input name="apiKey" type="password" autoComplete="new-password" placeholder={editing ? '留空则保持现有密钥' : '仅用于本次保存'} aria-invalid={Boolean(fields.apiKey)} aria-describedby="key-help" /><small id="key-help">{fields.apiKey || (editing ? '现有密钥不会回填；输入新值即完成轮换。' : '保存后页面不会显示或回填密钥。')}</small></label>
      {message && <Alert kind="error">{message}</Alert>}
      <div className="dialog-actions"><button className="text-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact" type="submit" disabled={busy}>{busy && <RefreshCw className="spin" size={17} />}{busy ? '保存中' : '保存配置'}</button></div>
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

function Console({ user, initialProviders, onLogout }) {
  const [providers, setProviders] = useState(initialProviders)
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
    <section className="console-heading"><div><span className="kicker"><Activity size={15} />系统配置</span><h1>Provider 管理</h1><p>维护生成服务的连接配置与运行状态。</p></div><button className="primary-button add-button" onClick={() => setDialog({ type: 'form' })}><Plus size={18} />新建 Provider</button></section>
    <section className="summary" aria-label="Provider 概览"><div><small>全部配置</small><strong>{providers.length}</strong></div><div><small>已启用</small><strong>{providers.filter((item) => item.enabled).length}</strong></div><div><small>密钥已配置</small><strong>{providers.filter((item) => item.apiKeyConfigured).length}</strong></div></section>
    <div className="status-region" aria-live="polite">{notice && <Alert kind="success" action={<button onClick={() => setNotice('')} aria-label="关闭成功消息"><X size={15} /></button>}>{notice}</Alert>}{error && <Alert kind="error" action={<button onClick={refresh}>重试</button>}>{error}</Alert>}</div>
    <section className="provider-section">
      <header className="section-heading"><div><h2>连接配置</h2><p>密钥始终以脱敏状态呈现。</p></div><button className="icon-button" onClick={refresh} aria-label="刷新 Provider 列表" title="刷新"><RefreshCw size={18} /></button></header>
      {!providers.length ? <div className="empty-state"><span><ServerCog size={28} /></span><h3>尚未配置 Provider</h3><p>创建第一条连接配置。新配置默认停用。</p><button className="secondary-button" onClick={() => setDialog({ type: 'form' })}><Plus size={17} />新建 Provider</button></div> :
      <div className="provider-list">{providers.map((provider) => <article className="provider-row" key={provider.id}>
        <div className="provider-main"><span className={provider.enabled ? 'status-dot enabled' : 'status-dot'} /><div><div className="provider-title"><h3>{provider.name}</h3><span className={provider.enabled ? 'badge enabled' : 'badge'}>{provider.enabled ? '已启用' : '已停用'}</span></div><p>{provider.endpoint}</p></div></div>
        <dl><div><dt>模型</dt><dd>{provider.model}</dd></div><div><dt>密钥</dt><dd>{provider.apiKeyConfigured ? provider.apiKeyMasked : '未配置'}</dd></div><div><dt>更新时间</dt><dd>{formatTime(provider.updatedAt)}</dd></div></dl>
        <div className="actions"><button className="text-button" onClick={() => setDialog({ type: 'audit', provider })}><Activity size={16} />审计</button><button className="text-button" onClick={() => setDialog({ type: 'form', provider })}><Pencil size={16} />编辑</button><button className={provider.enabled ? 'toggle enabled' : 'toggle'} aria-pressed={provider.enabled} disabled={busyId === provider.id} onClick={() => toggle(provider)}><span />{busyId === provider.id ? '处理中' : provider.enabled ? '停用' : '启用'}</button></div>
      </article>)}</div>}
    </section>
    <footer><span><ShieldCheck size={15} />权限与密钥由服务器端保护</span><span>当前为本地内存环境</span></footer>
    {dialog?.type === 'form' && <ProviderForm provider={dialog.provider} onClose={() => setDialog(null)} onSaved={saved} />}
    {dialog?.type === 'audit' && <Audit provider={dialog.provider} onClose={() => setDialog(null)} />}
  </main>
}

function App() {
  const [state, setState] = useState({ view: 'loading' })
  async function establish(user) {
    try {
      const result = await adminApi.listProviders()
      setState({ view: 'console', user, providers: result.providers })
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
  if (state.view === 'console') return <Console user={state.user} initialProviders={state.providers} onLogout={logout} />
  return <Login onAuthenticated={establish} />
}

export default App
