import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Coins,
  Download,
  FolderHeart,
  ImagePlus,
  Info,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import { ApiError, api, fileToImage, pollGeneration } from "./api";
import uploadGoodPhoto from "./assets/upload-good.jpg";
import uploadBadPhoto from "./assets/upload-bad.jpg";

const themes = [
  { name: "现代简约", description: "克制、明亮、线条利落" },
  { name: "北欧", description: "自然、轻盈、舒适" },
  { name: "日式", description: "留白、木质、宁静" },
  { name: "奶油风", description: "柔和、圆润、温暖" },
  { name: "原木风", description: "自然、质朴、有温度" },
  { name: "轻奢", description: "精致、沉稳、有层次" },
  { name: "中古风", description: "复古、温润、有质感" },
  { name: "侘寂风", description: "自然、克制、松弛" },
];
const rooms = ["客厅", "卧室", "餐厅", "厨房", "书房"];
const packs = [
  { amount: 10, credits: 12, badge: "常用" },
  { amount: 30, credits: 45, badge: "更划算" },
  { amount: 100, credits: 200, badge: "最多次数" },
];

const errorCopy = {
  INVALID_EMAIL: "请输入有效的邮箱地址。",
  INVALID_PASSWORD: "密码至少需要 8 个字符。",
  EMAIL_ALREADY_REGISTERED: "该邮箱已注册，请直接登录。",
  INVALID_CREDENTIALS: "邮箱或密码不正确。",
  INVALID_OR_EXPIRED_RESET: "重置凭证无效或已过期，请重新申请。",
  INSUFFICIENT_CREDITS: "当前额度不足，请先充值。",
  VALIDATION_ERROR: "图片或设计参数无效，请检查后重试。",
  PAYLOAD_TOO_LARGE: "图片过大，请选择 10MB 以内的图片。",
  PAYMENT_PROVIDER_UNAVAILABLE: "暂时无法创建订单，请稍后重试。",
  UNAUTHORIZED: "登录状态已失效，请重新登录。",
  FILE_READ_FAILED: "无法读取这张图片，请重新选择。",
  INVALID_RESPONSE: "服务响应异常，请稍后重试。",
  INVALID_VERIFICATION_CODE: "验证码错误或已过期，请重新获取。",
  CODE_RATE_LIMITED: "验证码发送太频繁，请稍后再试。",
  MAIL_UNAVAILABLE: "邮件服务暂时不可用，请稍后重试。",
  NETWORK_ERROR: "无法连接本地服务，请确认服务已启动。",
  INVALID_REDEMPTION_CODE: "兑换码无效，请检查后重试。",
  REDEMPTION_CODE_ALREADY_USED: "这个兑换码你已经使用过了。",
  REDEMPTION_CODE_EXHAUSTED: "这个兑换码的可兑换人数已用完。",
  REDEMPTION_CODE_EMAIL_MISMATCH: "这个兑换码只能由指定邮箱兑换。",
};

function messageFor(error, fallback = "操作未完成，请稍后重试。") {
  if (error instanceof ApiError) return errorCopy[error.code] ?? fallback;
  return errorCopy.NETWORK_ERROR;
}

function Notice({ tone = "info", children }) {
  if (!children) return null;
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Info size={17} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  useEffect(() => {
    if (!codeCooldown) return undefined;
    const timer = window.setTimeout(() => setCodeCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const switchMode = (next) => {
    setMode(next);
    setPassword("");
    setToken("");
    setVerificationCode("");
    setNotice(null);
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "register") {
        await api.register(email, password, verificationCode);
        await api.login(email, password);
        onAuthenticated((await api.session()).user);
      } else if (mode === "login")
        onAuthenticated((await api.login(email, password)).user);
      else if (mode === "forgot") {
        await api.requestPasswordReset(email);
        setNotice({
          tone: "success",
          text: "如该邮箱已注册，重置说明将发送到邮箱。",
        });
      } else {
        await api.resetPassword(token.trim(), password);
        setNotice({ tone: "success", text: "密码已更新，请使用新密码登录。" });
        window.setTimeout(() => switchMode("login"), 900);
      }
    } catch (error) {
      setNotice({ tone: "error", text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  };
  const titles = {
    login: ["欢迎回来", "登录后继续设计你的空间"],
    register: ["创建账户", "新用户可获得 3 次设计额度"],
    forgot: ["找回密码", "我们不会透露邮箱是否已注册"],
    reset: ["设置新密码", "输入邮件中的重置凭证"],
  };
  return (
    <main className="auth-shell">
      <section className="auth-brand" aria-label="产品介绍">
        <span className="brand-mark large">
          <Sparkles />
        </span>
        <p className="eyebrow">AI INTERIOR STUDIO</p>
        <h1>
          把真实房间，
          <br />
          <em>变成喜欢的样子。</em>
        </h1>
        <p>上传照片、选择偏好、比较生成前后，把满意的方案收进作品库。</p>
        <div className="auth-assurance">
          <ShieldCheck size={20} />
          <span>
            会话只使用安全 Cookie
            <br />
            <small>浏览器不会保存登录令牌</small>
          </span>
        </div>
      </section>
      <section className="auth-panel clay-surface">
        <div className="auth-tabs" role="tablist" aria-label="账户操作">
          <button
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            role="tab"
            aria-selected={mode === "register"}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </div>
        {!["login", "register"].includes(mode) && (
          <button
            className="text-button back-button"
            type="button"
            onClick={() => switchMode("login")}
          >
            <ArrowLeft size={17} />
            返回登录
          </button>
        )}
        <div className="auth-heading">
          <h2>{titles[mode][0]}</h2>
          <p>{titles[mode][1]}</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode !== "reset" && (
            <label className="input-field">
              <span>邮箱</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => { setEmail(event.target.value); setVerificationCode('') }}
                required
                placeholder="name@example.com"
              />
            </label>
          )}
          {mode === "register" && <div className="verification-row"><label className="input-field"><span>邮箱验证码</span><input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/gu, ''))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required placeholder="6 位验证码" /></label><button className="secondary-button" type="button" disabled={codeBusy || codeCooldown > 0 || !email} onClick={async () => { setCodeBusy(true); setNotice(null); try { await api.requestRegistrationCode(email); setCodeCooldown(60); setNotice({ tone: "success", text: "若此邮箱可注册，验证码已发送，10 分钟内有效。请检查收件箱和垃圾邮件。" }) } catch (error) { setNotice({ tone: "error", text: messageFor(error) }) } finally { setCodeBusy(false) } }}>{codeBusy ? "发送中" : codeCooldown > 0 ? `${codeCooldown} 秒后重发` : "获取验证码"}</button></div>}
          {["login", "register", "reset"].includes(mode) && (
            <label className="input-field">
              <span>{mode === "reset" ? "新密码" : "密码"}</span>
              <input
                type="password"
                minLength="8"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                placeholder="至少 8 个字符"
              />
            </label>
          )}
          {mode === "reset" && (
            <label className="input-field">
              <span>重置凭证</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
                autoComplete="one-time-code"
                placeholder="粘贴邮件中的凭证"
              />
            </label>
          )}
          <Notice tone={notice?.tone}>{notice?.text}</Notice>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" /> : <UserRound size={18} />}
            {mode === "login"
              ? "登录"
              : mode === "register"
                ? "创建账户"
                : mode === "forgot"
                  ? "发送重置说明"
                  : "更新密码"}
          </button>
        </form>
        {mode === "login" && (
          <button
            className="text-button"
            type="button"
            onClick={() => switchMode("forgot")}
          >
            忘记密码？
          </button>
        )}
        {mode === "forgot" && (
          <button
            className="text-button"
            type="button"
            onClick={() => switchMode("reset")}
          >
            已有重置凭证
          </button>
        )}
      </section>
    </main>
  );
}

function SelectField({ label, value, options, onChange, placeholder }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="select-wrap">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map((option) => (
            <option key={option}>{typeof option === "string" ? option : option.name}</option>
          ))}
        </select>
        <ChevronDown size={17} aria-hidden="true" />
      </span>
    </label>
  );
}

function Comparison({ before, after }) {
  const [position, setPosition] = useState(50);
  return (
    <section className="comparison-block" aria-labelledby="comparison-title">
      <div className="comparison-heading">
        <div>
          <span className="section-kicker">03 / 效果对比</span>
          <h3 id="comparison-title">拖动滑块，对比空间变化</h3>
        </div>
        <span>完整画面，自适应图片比例</span>
      </div>
      <figure className="comparison-slider" style={{ "--comparison-position": `${position}%` }}>
        <img className="comparison-base" src={before} alt="改造之前的房间" />
        <div className="comparison-after-layer" aria-hidden="true"><img src={after} alt="" /></div>
        <span className="comparison-side-label comparison-left-label">改造之前</span>
        <span className="comparison-side-label comparison-right-label">改造之后</span>
        <span className="comparison-divider" aria-hidden="true"><span>↔</span></span>
        <label className="visually-hidden" htmlFor="comparison-range">调整改造前后图片的分界位置</label>
        <input id="comparison-range" className="comparison-range" type="range" min="0" max="100" value={position} onChange={(event) => setPosition(Number(event.target.value))} />
      </figure>
    </section>
  );
}

function GenerationProgress({ elapsedMs }) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const progress = Math.min(92, Math.round(18 + seconds * 0.62));
  const stage = seconds < 15
    ? "正在上传照片并创建任务"
    : seconds < 45
      ? "AI 正在理解空间与参考风格"
      : seconds < 90
        ? "AI 正在生成并细化设计效果"
        : "正在完成图片处理和安全保存";
  return (
    <div className="generation-progress" aria-live="polite">
      <div className="generation-orbit" aria-hidden="true">
        <Sparkles size={23} />
        <span />
        <span />
        <span />
      </div>
      <strong>{stage}</strong>
      <p>生成通常需要 1–2 分钟，请保持页面打开。</p>
      <div
        className="generation-progress-track"
        role="progressbar"
        aria-label="图片生成进度"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <small>已等待 {seconds} 秒 · 进度为阶段提示，实际速度取决于图片服务</small>
    </div>
  );
}

function ThemePicker({ value, onChange, styleReferences = [] }) {
  const availableThemes = styleReferences.length ? styleReferences.map((reference) => ({ name: reference.theme, description: reference.description || reference.name })).filter((theme, index, list) => list.findIndex((entry) => entry.name === theme.name) === index) : themes
  return <div className="field"><span>设计风格 · 仅作文字方向</span><div className="theme-picker" role="radiogroup" aria-label="设计风格">
    {availableThemes.map((theme) => <button key={theme.name} type="button" className={`theme-card ${value === theme.name ? "selected" : ""}`} aria-pressed={value === theme.name} onClick={() => onChange(theme.name)}>
      {styleReferences.find((reference) => reference.theme === theme.name)?.image?.url ? <span className="theme-art"><img src={styleReferences.find((reference) => reference.theme === theme.name).image.url} alt="" /></span> : <span className="theme-art theme-art-empty" aria-hidden="true" />} <strong>{theme.name}</strong><small>{theme.description}</small>
    </button>)}
  </div></div>
}

function UploadGuidance({ expanded, onToggle }) {
  return (
    <section className={`upload-guidance ${expanded ? "is-expanded" : "is-collapsed"}`} aria-labelledby="upload-guidance-title">
      <div className="upload-guidance-heading">
        <div>
          <span className="section-kicker">拍摄小提示</span>
          <h3 id="upload-guidance-title">照片拍得好，改造更准确</h3>
        </div>
        <button className="text-button" type="button" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? "收起" : "查看拍摄要求"}
        </button>
      </div>
      {expanded && (
        <div className="upload-guidance-cards">
          <article className="upload-guidance-card is-good">
            <img src={uploadGoodPhoto} alt="适合：完整明亮且角度端正的房间照片" />
            <div><strong>适合</strong><p>空间完整 · 光线清楚 · 角度端正</p></div>
          </article>
          <article className="upload-guidance-card is-bad">
            <img src={uploadBadPhoto} alt="不适合：局部昏暗且角度倾斜的房间照片" />
            <div><strong>不适合</strong><p>只拍局部 · 画面昏暗 · 明显倾斜</p></div>
          </article>
        </div>
      )}
    </section>
  );
}

function Workbench({ credits, refreshCredits, onSaved, styleReferences }) {
  const [theme, setTheme] = useState(themes[0].name);
  const [room, setRoom] = useState("");
  const [userPrompt, setUserPrompt] = useState('');
  const [history, setHistory] = useState([]);
  const [designParams, setDesignParams] = useState(null);
  const [pendingRevision, setPendingRevision] = useState(null);
  const [image, setImage] = useState(null);
  const [task, setTask] = useState(null);
  const [status, setStatus] = useState("empty");
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showUploadGuidance, setShowUploadGuidance] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const inputRef = useRef(null);
  const pollAbortRef = useRef(null);
  useEffect(() => () => pollAbortRef.current?.abort(), []);
  useEffect(() => {
    if (!editOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !editBusy) setEditOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [editOpen, editBusy]);
  useEffect(() => {
    if (!["creating", "polling"].includes(status) || !generationStartedAt) return undefined;
    const update = () => setGenerationElapsedMs(Date.now() - generationStartedAt);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [generationStartedAt, status]);
  const params = { room, theme, userPrompt };
  const resultUrl = task?.result?.effectImage?.url;
  const statusText = {
    empty: "上传一张房间照片开始设计",
    ready: "照片已准备好",
    creating: "正在提交设计任务…",
    polling: "AI 正在生成设计…",
    success: "设计方案已生成",
    failed: "生成未完成，可以重试",
  }[status];
  const chooseFile = async (event) => {
    if (editBusy || pendingRevision || ['creating', 'polling'].includes(status)) return;
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice(null);
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setNotice({
        tone: "error",
        text: "请选择 10MB 以内的 JPEG 或 PNG 图片。",
      });
      event.target.value = "";
      return;
    }
    try {
      setImage(await fileToImage(file));
      setTask(null); setHistory([]); setSaved(false); setDesignParams(null);
      setStatus("ready");
      setShowUploadGuidance(false);
    } catch (error) {
      setNotice({ tone: "error", text: messageFor(error) });
    }
  };
  const generate = async () => {
    if (!room) {
      setNotice({ tone: "error", text: "请先选择空间类型，再生成设计。" });
      return;
    }
    if (!image) {
      setNotice({ tone: "error", text: "请先上传一张房间照片。" });
      inputRef.current?.focus();
      return;
    }
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    setStatus("creating");
    setGenerationStartedAt(Date.now());
    setGenerationElapsedMs(0);
    setNotice(null);
    setSaved(false);
    const submittedAt = Date.now();
    let uploadAndTaskCreateMs;
    console.info("[Generation]", { stage: "submit-started" });
    try {
      const created = await api.createGeneration({
        image: image.payload,
        params,
      });
      uploadAndTaskCreateMs = Date.now() - submittedAt;
      console.info("[Generation]", {
        stage: "task-created",
        traceId: created.task.traceId ?? created.task.id,
        taskId: created.task.id,
        status: created.task.status,
        elapsedMs: uploadAndTaskCreateMs,
      });
      setTask(created.task);
      setStatus("polling");
      const completed = await pollGeneration(created.task.id, {
        signal: controller.signal,
        onUpdate: setTask,
      });
      setTask(completed);
      const totalClientMs = Date.now() - submittedAt;
      const providerMs = completed.timings?.providerMs ?? null;
      const serverTotalMs = completed.timings?.serverTotalMs ?? null;
      console.info("[Generation Timing]", {
        traceId: completed.traceId ?? completed.id,
        totalClientMs,
        uploadAndTaskCreateMs,
        clientPollingMs: Math.max(0, totalClientMs - uploadAndTaskCreateMs),
        providerMs,
        nonProviderServerMs: completed.timings?.nonProviderMs ?? null,
        serverTotalMs,
        totalOutsideProviderMs: Number.isFinite(providerMs) ? Math.max(0, totalClientMs - providerMs) : null,
        clientAndNetworkMs: Number.isFinite(serverTotalMs) ? Math.max(0, totalClientMs - serverTotalMs) : null,
        originalStoreMs: completed.timings?.originalStoreMs ?? null,
        resultDownloadMs: completed.timings?.resultDownloadMs ?? null,
        resultUploadMs: completed.timings?.resultUploadMs ?? null,
        resultStoreMs: completed.timings?.resultStoreMs ?? null,
        creditSettlementMs: completed.timings?.creditSettlementMs ?? null,
      });
      if (completed.status === "succeeded") {
        setHistory([completed]);
        setDesignParams(params);
        setStatus("success");
        setNotice({ tone: "success", text: "生成成功，已消耗 1 次额度。" });
        refreshCredits();
      } else {
        setStatus("failed");
        setNotice({
          tone: "error",
          text: completed.error?.message ?? "生成失败，本次不会扣除额度。",
        });
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        console.info("[Generation]", { stage: "aborted", elapsedMs: Date.now() - submittedAt });
        return;
      }
      console.error("[Generation]", {
        stage: "client-failed",
        traceId: task?.traceId ?? task?.id,
        code: error?.code ?? "GENERATION_FAILED",
        httpStatus: error?.status ?? 0,
        elapsedMs: Date.now() - submittedAt,
      });
      setStatus("failed");
      setNotice({
        tone: "error",
        text: messageFor(error, "生成失败，本次不会扣除额度。"),
      });
      if (error instanceof ApiError && error.code === "INSUFFICIENT_CREDITS")
        refreshCredits();
    }
  };
  const save = async () => {
    if (!resultUrl || !image || !task) return;
    setSaving(true);
    setNotice(null);
    try {
      await api.saveWork({
        generationId: task.id,
        original: task.result.original?.url
          ? task.result.original
          : { url: image.previewUrl, mimeType: image.payload.type },
        effectImage: task.result.effectImage,
        params: designParams ?? params,
      });
      setSaved(true);
      setNotice({ tone: "success", text: "作品已保存到“我的作品”。" });
      onSaved();
    } catch (error) {
      setNotice({
        tone: "error",
        text: messageFor(error, "作品保存失败，请重试。"),
      });
    } finally {
      setSaving(false);
    }
  };
  const refine = async () => {
    if ((!pendingRevision && !editPrompt.trim()) || !image || !task || editBusy || saving) return;
    setEditBusy(true); setNotice(null);
    const controller = new AbortController(); pollAbortRef.current = controller;
    try {
      let revisionId = pendingRevision;
      if (!revisionId) {
        const created = await api.reviseGeneration(task.id, { prompt: editPrompt.trim() });
        revisionId = created.task.id; setPendingRevision(revisionId);
      }
      const completed = await pollGeneration(revisionId, { signal: controller.signal });
      setPendingRevision(null);
      console.info("[Generation Edit]", { stage: completed.status, traceId: completed.traceId });
      if (completed.status === 'succeeded') {
        setHistory((items) => [...items, completed]); setTask(completed); setSaved(false); setEditOpen(false); setEditPrompt('');
        setNotice({ tone: 'success', text: '修改完成，已切换到新版本。可继续修改或回退；本次消耗 1 次额度。' });
      }
      if (completed.status !== "succeeded") setNotice({ tone: "error", text: completed.error?.message ?? "二次修改失败，本次不会扣除额度。" });
    } catch (error) { if (error?.name !== 'AbortError') setNotice({ tone: "error", text: messageFor(error, "查询修改结果失败，请勿重复提交；请稍后重试查询。") }) } finally { setEditBusy(false); refreshCredits() }
  };
  const download = () => {
    if (!resultUrl) return;
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = `室内设计-${room}-${theme}.${task.result.effectImage.mimeType === "image/png" ? "png" : "jpg"}`;
    link.click();
  };
  return (
    <div className="page-view">
      <header className="page-heading">
        <div>
          <p className="eyebrow">
            <WandSparkles size={16} /> DESIGN STUDIO
          </p>
          <h1>设计工作台</h1>
          <p>上传真实照片，调整参数并查看生成前后。</p>
        </div>
        <div className="usage-note">
          <Coins size={18} />
          <span>
            可用额度 <strong>{credits?.available ?? "—"}</strong>
            <br />
            <small>失败不扣额度</small>
          </span>
        </div>
      </header>
      <div className="studio-grid">
        <aside className="control-panel clay-surface">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">01 / 设计参数</span>
              <h2>告诉我你的想法</h2>
            </div>
            <BookOpen size={21} />
          </div>
          <div className="fields">
            <SelectField
              label="空间类型"
              value={room}
              options={rooms}
              onChange={setRoom}
              placeholder="请选择空间类型"
            />
            <ThemePicker value={theme} onChange={setTheme} styleReferences={styleReferences} />
            <label className="input-field"><span>生成提示词（可选）</span><textarea value={userPrompt} onChange={(event) => setUserPrompt(event.target.value)} placeholder="例如：保留落地窗，增加收纳，整体更温暖" rows="3" maxLength="2000" /></label>
          </div>
          <button
            className="primary-button"
            disabled={saving || editBusy || Boolean(pendingRevision) || ["creating", "polling"].includes(status)}
            type="button"
            onClick={generate}
          >
            {["creating", "polling"].includes(status) ? (
              <LoaderCircle className="spin" />
            ) : (
              <WandSparkles size={18} />
            )}
            {["creating", "polling"].includes(status) ? "生成中…" : "生成设计"}{" "}
            <span>· 1 次</span>
          </button>
          <p className="panel-footnote">
            每次成功生成消耗 1 次额度，失败自动释放。
          </p>
        </aside>
        <section
          className="workspace-panel clay-surface"
          aria-busy={["creating", "polling"].includes(status)}
        >
          <div className="workspace-heading">
            <div>
              <span className="section-kicker">02 / 设计结果</span>
              <h2>
                {room || "未选择空间"} · {theme}
              </h2>
            </div>
            <span className="state-label" aria-live="polite">
              {statusText}
            </span>
          </div>
          <Notice tone={notice?.tone}>{notice?.text}</Notice>
          <div className="image-grid">
            <div className="image-stage original-stage">
              <span className="image-label">原始照片</span>
              {image ? (
                <img src={image.previewUrl} alt="已上传的房间" />
              ) : (
                <button
                  className="upload-prompt"
                  type="button"
                  onClick={() => inputRef.current?.click()}
                >
                  <span className="upload-icon">
                    <ImagePlus size={25} />
                  </span>
                  <strong>上传房间照片</strong>
                  <small>JPEG / PNG，最大 10MB</small>
                  <span className="upload-action">选择文件</span>
                </button>
              )}
            </div>
            <div className="image-stage result-stage">
              <span className="image-label">AI 设计效果</span>
              {resultUrl ? (
                <img src={resultUrl} alt="AI 生成的室内设计效果" />
              ) : (
                <div className="result-empty">
                  {["creating", "polling"].includes(status) ? (
                    <GenerationProgress elapsedMs={generationElapsedMs} />
                  ) : (
                    <><Sparkles size={30} /><span>生成后将在这里展示</span></>
                  )}
                </div>
              )}
            </div>
          </div>
          <UploadGuidance expanded={showUploadGuidance} onToggle={() => setShowUploadGuidance((value) => !value)} />
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png"
            aria-label="上传房间照片"
            onChange={chooseFile}
          />
          {resultUrl && image && (
            <Comparison
              before={image.previewUrl}
              after={resultUrl}
            />
          )}
          <div className="workspace-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus size={17} />
              {image ? "更换照片" : "选择照片"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!resultUrl}
              onClick={download}
            >
              <Download size={17} />
              下载结果
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!resultUrl || saving || saved || editBusy || Boolean(pendingRevision)}
              onClick={save}
            >
              {saving ? (
                <LoaderCircle className="spin" />
              ) : (
                <FolderHeart size={17} />
              )}
              {saved ? "已保存" : "保存作品"}
            </button>
          </div>
          {resultUrl && <div className="refine-area">
            <div><strong>继续完善当前设计</strong><small>可连续修改，不限次数。每次成功消耗 1 次额度；回退、下载不扣点。</small></div>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={saving || editBusy || Boolean(pendingRevision) || !task.parentTaskId || !history.some((item) => item.id === task.parentTaskId)} onClick={() => { setTask(history.find((item) => item.id === task.parentTaskId)); setSaved(false) }}>回退上一版</button>
              <button className="secondary-button" type="button" disabled={saving || editBusy || ['creating','polling'].includes(status)} onClick={() => setEditOpen(true)}><RefreshCw size={16} />{pendingRevision ? '查询修改结果' : '继续修改'}</button>
            </div>
          </div>}
          {resultUrl && history.length > 0 && <section className="revision-history" aria-label="暂存版本"><p>本次暂存版本 · 切换后以该版本继续修改；刷新或离开工作台将清空此列表，请先保存满意版本。</p><div>{history.map((version, index) => <button key={version.id} type="button" aria-pressed={version.id === task.id} disabled={editBusy || Boolean(pendingRevision) || ['creating','polling'].includes(status)} onClick={() => { setTask(version); setSaved(false) }}><img src={version.result.effectImage.url} alt="" />{index === 0 ? '首次效果' : `版本 ${index + 1}`}</button>)}</div></section>}
          {editOpen && <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && !editBusy && setEditOpen(false)}>
            <section className="dialog refine-dialog" role="dialog" aria-modal="true" aria-labelledby="refine-title">
              <header className="dialog-header">
                <div><span className="kicker">基于当前版本 · 成功扣 1 次</span><h2 id="refine-title">描述你想改的地方</h2></div>
                <button className="icon-button" type="button" disabled={editBusy} onClick={() => setEditOpen(false)} aria-label="关闭修改窗口"><X size={19} /></button>
              </header>
              <textarea autoFocus value={editPrompt} disabled={editBusy || Boolean(pendingRevision)} maxLength="2000" onChange={(event) => setEditPrompt(event.target.value)} placeholder="例如：把方桌换成圆桌，保持其他布置不变" rows="4" />
              <p className="form-help">生成通常需要 1–2 分钟。成功后自动显示新图，上一版暂存，可回退。未指定区域蒙版时，附近细节可能变化。</p>
              <Notice tone={notice?.tone}>{notice?.text}</Notice>
              <button className="primary-button" type="button" disabled={editBusy || (!pendingRevision && !editPrompt.trim())} onClick={refine}>
                {editBusy ? <LoaderCircle className="spin" /> : <WandSparkles size={17} />}
                {editBusy ? '正在修改，请稍候…' : pendingRevision ? '重试查询（不重复生成）' : '生成修改'}
              </button>
            </section>
          </div>}
        </section>
      </div>
    </div>
  );
}

function WorksPage({ refreshKey }) {
  const [state, setState] = useState({ loading: true, works: [], error: null });
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      setState({
        loading: false,
        works: (await api.works()).works,
        error: null,
      });
    } catch (error) {
      setState({ loading: false, works: [], error: messageFor(error) });
    }
  }, []);
  const openWork = async (id) => {
    setDetailLoading(true);
    setState((current) => ({ ...current, error: null }));
    try {
      setSelected((await api.work(id)).work);
    } catch (error) {
      setState((current) => ({ ...current, error: messageFor(error) }));
    } finally {
      setDetailLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    api
      .works()
      .then(({ works }) => {
        if (active) setState({ loading: false, works, error: null });
      })
      .catch((error) => {
        if (active)
          setState({ loading: false, works: [], error: messageFor(error) });
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);
  if (selected)
    return (
      <div className="page-view">
        <button
          className="text-button back-button"
          onClick={() => setSelected(null)}
        >
          <ArrowLeft size={17} />
          返回作品列表
        </button>
        <header className="page-heading compact">
          <div>
            <p className="eyebrow">WORK DETAIL</p>
            <h1>
              {selected.params.room} · {selected.params.theme}
            </h1>
            <p>{new Date(selected.createdAt).toLocaleString("zh-CN")}</p>
          </div>
        </header>
        <div className="work-detail clay-surface">
          <div className="image-grid">
            <figure>
              <img src={selected.original.url} alt="作品原始照片" loading="eager" decoding="async" />
              <figcaption>生成之前</figcaption>
            </figure>
            <figure>
              <img src={selected.effectImage.url} alt="作品设计效果" loading="eager" decoding="async" />
              <figcaption>生成之后</figcaption>
            </figure>
          </div>
          <Comparison
            before={selected.original.url}
            after={selected.effectImage.url}
          />
          <a
            className="secondary-button download-link"
            href={selected.effectImage.url}
            download={`作品-${selected.id}`}
          >
            <Download size={17} />
            下载效果图
          </a>
        </div>
      </div>
    );
  return (
    <div className="page-view">
      <header className="page-heading compact">
        <div>
          <p className="eyebrow">
            <FolderHeart size={16} /> MY WORKS
          </p>
          <h1>我的作品</h1>
          <p>查看和下载已保存的设计结果。</p>
        </div>
        <button
          className="icon-button"
          aria-label="刷新作品"
          title="刷新作品"
          onClick={load}
        >
          <RefreshCw size={19} />
        </button>
      </header>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.loading ? (
        <div className="loading-state">
          <LoaderCircle className="spin" />
          正在加载作品…
        </div>
      ) : state.works.length === 0 ? (
        <div className="empty-state clay-surface">
          <FolderHeart size={38} />
          <h2>还没有保存的作品</h2>
          <p>生成设计后点击“保存作品”，方案会出现在这里。</p>
        </div>
      ) : (
        <div className="works-grid">
          {state.works.map((work) => (
            <button
              className="work-card"
              key={work.id}
              disabled={detailLoading}
              onClick={() => openWork(work.id)}
            >
              <img src={work.effectImage.url} alt="" loading="lazy" decoding="async" />
              <span>
                <strong>
                  {work.params.room} · {work.params.theme}
                </strong>
                <small>
                  {detailLoading
                    ? "正在打开…"
                    : new Date(work.createdAt).toLocaleDateString("zh-CN")}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreditsPage({ credits, refreshCredits }) {
  const [custom, setCustom] = useState(1);
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [redemptionCode, setRedemptionCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const createOrder = async (amount) => {
    setBusy(true);
    setNotice(null);
    try {
      setOrder((await api.createOrder(Number(amount))).order);
      setNotice({
        tone: "info",
        text: "订单已创建，等待支付。当前本地 MVP 不会发起真实收款。",
      });
      refreshCredits();
    } catch (error) {
      setNotice({ tone: "error", text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  };
  const redeem = async (event) => {
    event.preventDefault();
    const code = redemptionCode.trim();
    if (!code) return;
    setRedeeming(true);
    setNotice(null);
    try {
      const result = await api.redeemCode(code);
      setRedemptionCode("");
      setNotice({ tone: "success", text: `兑换成功，已增加 ${result.creditsAdded} 点额度。` });
      await refreshCredits();
    } catch (error) {
      setNotice({ tone: "error", text: messageFor(error, "兑换失败，请检查兑换码。") });
    } finally {
      setRedeeming(false);
    }
  };
  return (
    <div className="page-view">
      <header className="page-heading compact">
        <div>
          <p className="eyebrow">
            <Coins size={16} /> CREDITS
          </p>
          <h1>额度与充值</h1>
          <p>1 点额度可生成 1 次，成功生成后扣除。</p>
        </div>
        <div className="balance-badge">
          <small>当前可用</small>
          <strong>{credits?.available ?? "—"}</strong>
          <span>次</span>
        </div>
      </header>
      <Notice tone={notice?.tone}>{notice?.text}</Notice>
      <section className="credits-layout">
        <div className="pack-section">
          <h2>选择充值方案</h2>
          <div className="pack-grid">
            {packs.map((pack) => (
              <button
                key={pack.amount}
                className="pack-card"
                disabled={busy}
                onClick={() => createOrder(pack.amount)}
              >
                <span className="pack-badge">{pack.badge}</span>
                <strong>¥{pack.amount}</strong>
                <b>{pack.credits} 次</b>
                <small>
                  约 ¥{(pack.amount / pack.credits).toFixed(2)} / 次
                </small>
              </button>
            ))}
          </div>
          <div className="custom-pack clay-surface">
            <div>
              <h3>小额自定义</h3>
              <p>1-9 元，充多少得多少次。</p>
            </div>
            <label className="input-field compact-input">
              <span>充值金额（元）</span>
              <input
                type="number"
                min="1"
                max="9"
                step="1"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
              />
            </label>
            <button
              className="secondary-button"
              disabled={
                busy ||
                !Number.isInteger(Number(custom)) ||
                Number(custom) < 1 ||
                Number(custom) > 9
              }
              onClick={() => createOrder(custom)}
            >
              创建订单
            </button>
          </div>
          <form className="redeem-card clay-surface" onSubmit={redeem}>
            <div><h3>兑换码</h3><p>输入管理员发放的兑换码，额度会立即到账。</p></div>
            <label className="input-field compact-input"><span>兑换码</span><input value={redemptionCode} onChange={(event) => setRedemptionCode(event.target.value.toUpperCase())} autoComplete="off" placeholder="ROOM-XXXX-XXXX-XXXX" /></label>
            <button className="secondary-button" type="submit" disabled={redeeming || !redemptionCode.trim()}>{redeeming ? "兑换中…" : "立即兑换"}</button>
          </form>
        </div>
        <aside className="order-panel clay-surface">
          <h2>订单状态</h2>
          {order ? (
            <div className="order-detail">
              <span className="pending-pill">待支付</span>
              <dl>
                <div>
                  <dt>金额</dt>
                  <dd>¥{order.amountYuan}</dd>
                </div>
                <div>
                  <dt>到账额度</dt>
                  <dd>{order.credits} 次</dd>
                </div>
                <div>
                  <dt>订单号</dt>
                  <dd>{order.id}</dd>
                </div>
              </dl>
              <p>
                只有支付系统确认成功后额度才会到账。当前版本未接入真实支付。
              </p>
            </div>
          ) : (
            <div className="order-empty">
              <Coins size={30} />
              <p>创建订单后可在这里查看待支付信息。</p>
            </div>
          )}
          <div className="expiry-note">
            <Info size={17} />
            <span>额度自发放起 12 个月内有效，优先使用较早到期的额度。</span>
          </div>
        </aside>
      </section>
    </div>
  );
}

function AccountPage({ user, onLogout }) {
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true);
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  };
  return (
    <div className="page-view">
      <header className="page-heading compact">
        <div>
          <p className="eyebrow">
            <UserRound size={16} /> ACCOUNT
          </p>
          <h1>账户与帮助</h1>
          <p>查看账户信息、使用说明和隐私边界。</p>
        </div>
      </header>
      <div className="account-grid">
        <section className="account-card clay-surface">
          <span className="avatar large-avatar">
            {user.email.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <small>登录邮箱</small>
            <strong>{user.email}</strong>
          </div>
          <button
            className="secondary-button danger-button"
            disabled={busy}
            onClick={logout}
          >
            <LogOut size={17} />
            退出登录
          </button>
        </section>
        <section className="help-list">
          <article>
            <CircleHelp />
            <div>
              <h2>如何获得更好的结果？</h2>
              <p>
                使用清晰、光线均匀且能看见主要墙面与家具的照片；避免截图和过度压缩。
              </p>
            </div>
          </article>
          <article>
            <ShieldCheck />
            <div>
              <h2>照片和账户如何处理？</h2>
              <p>
                当前 MVP 使用本地内存服务，重启后数据会清空。登录令牌只存在于
                HttpOnly Cookie，不写入浏览器存储。
              </p>
            </div>
          </article>
          <article>
            <Coins />
            <div>
              <h2>什么时候扣除额度？</h2>
              <p>
                只有生成成功才扣除 1
                次；生成失败会自动释放预留额度。充值订单在支付确认前不会增加额度。
              </p>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}

function FeedbackDialog({ onClose }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onClose]);
  const submit = async (event) => {
    event.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true); setNotice('');
    try {
      await api.submitFeedback(message.trim());
      setNotice('感谢你的反馈，我们会认真查看。');
      setMessage('');
    } catch (error) { setNotice(messageFor(error, '反馈提交失败，请稍后重试。')); }
    finally { setBusy(false); }
  };
  return <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}><section className="dialog feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title"><header className="dialog-header"><div><span className="kicker">帮助我们变得更好</span><h2 id="feedback-title">意见反馈</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭反馈窗口"><X size={19} /></button></header><p className="feedback-reward-note">反馈一经采纳，将发送 10 点额度到你的 QQ 邮箱。</p><form className="auth-form" onSubmit={submit}><label className="input-field"><span>告诉我们你的想法</span><textarea autoFocus value={message} maxLength="2000" rows="6" onChange={(event) => setMessage(event.target.value)} placeholder="可以反馈功能建议、使用问题或改进想法" /></label><Notice tone={notice.startsWith('感谢') ? 'success' : 'error'}>{notice}</Notice><button className="primary-button" type="submit" disabled={busy || !message.trim()}>{busy ? '提交中…' : '提交反馈'}</button></form></section></div>;
}

function AppShell({ user, onLogout }) {
  const [page, setPage] = useState("studio");
  const [menuOpen, setMenuOpen] = useState(false);
  const [credits, setCredits] = useState(null);
  const [worksRefresh, setWorksRefresh] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [styleReferences, setStyleReferences] = useState([]);
  const refreshCredits = useCallback(async () => {
    try {
      setCredits(await api.credits());
    } catch {
      /* Session handling remains owned by the next request. */
    }
  }, []);
  useEffect(() => {
    let active = true;
    api
      .credits()
      .then((nextCredits) => {
        if (active) setCredits(nextCredits);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    api.styleReferences().then(({ styleReferences: next }) => { if (active) setStyleReferences(next) }).catch(() => {});
    return () => { active = false; };
  }, []);
  const navigate = (next) => {
    setPage(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const nav = [
    ["studio", "设计工作台", WandSparkles],
    ["works", "我的作品", FolderHeart],
    ["credits", "额度充值", Coins],
    ["account", "账户帮助", UserRound],
  ];
  return (
    <main className="app-shell">
      <header className="topbar">
        <button
          className="brand brand-button"
          onClick={() => navigate("studio")}
          aria-label="返回设计工作台"
        >
          <span className="brand-mark">
            <Sparkles size={20} />
          </span>
          <span>
            <strong>AI 室内设计师</strong>
            <small>让空间更像你</small>
          </span>
        </button>
        <button
          className="icon-button mobile-menu"
          aria-label={menuOpen ? "关闭导航" : "打开导航"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
        <nav
          className={menuOpen ? "topnav open" : "topnav"}
          aria-label="主导航"
        >
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => navigate(id)}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={16} />
              {label}
              {id === "credits" && (
                <span className="credit-dot">{credits?.available ?? "—"}</span>
              )}
            </button>
          ))}
        </nav>
        <button
          className="account-button"
          type="button"
          onClick={() => navigate("account")}
        >
          <span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span>
          <span>{user.email}</span>
          <ChevronDown size={16} />
        </button>
      </header>
      {page === "studio" && (
        <Workbench
          credits={credits}
          refreshCredits={refreshCredits}
          styleReferences={styleReferences}
          onSaved={() => setWorksRefresh((value) => value + 1)}
        />
      )}
      {page === "works" && <WorksPage refreshKey={worksRefresh} />}
      {page === "credits" && (
        <CreditsPage credits={credits} refreshCredits={refreshCredits} />
      )}
      {page === "account" && <AccountPage user={user} onLogout={onLogout} />}
      <button className="feedback-fab" type="button" onClick={() => setFeedbackOpen(true)}><MessageSquare size={17} />反馈</button>
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      <footer className="page-footer">
        <span>AI 生成结果仅供设计灵感参考</span>
        <button onClick={() => navigate("account")}>隐私说明 · 帮助中心</button>
      </footer>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState({ loading: true, user: null });
  useEffect(() => {
    let active = true;
    api
      .session()
      .then(({ user }) => {
        if (active) setSession({ loading: false, user });
      })
      .catch(() => {
        if (active) setSession({ loading: false, user: null });
      });
    return () => {
      active = false;
    };
  }, []);
  if (session.loading)
    return (
      <main className="boot-screen" aria-live="polite">
        <LoaderCircle className="spin" />
        <span>正在恢复登录状态…</span>
      </main>
    );
  if (!session.user)
    return (
      <AuthScreen
        onAuthenticated={(user) => setSession({ loading: false, user })}
      />
    );
  return (
    <AppShell
      user={session.user}
      onLogout={() => setSession({ loading: false, user: null })}
    />
  );
}
