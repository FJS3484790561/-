import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
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
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import { ApiError, api, fileToImage, pollGeneration } from "./api";

const themes = ["现代简约", "北欧", "日式", "奶油风", "原木风", "轻奢"];
const rooms = ["客厅", "卧室", "餐厅", "厨房", "书房"];
const scales = ["保真", "均衡", "创意", "大胆"];
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
  NETWORK_ERROR: "无法连接本地服务，请确认服务已启动。",
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const switchMode = (next) => {
    setMode(next);
    setPassword("");
    setToken("");
    setNotice(null);
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "register") {
        await api.register(email, password);
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
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="name@example.com"
              />
            </label>
          )}
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

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="select-wrap">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <ChevronDown size={17} aria-hidden="true" />
      </span>
    </label>
  );
}

function Comparison({ before, after }) {
  return (
    <section className="comparison-block" aria-labelledby="comparison-title">
      <div className="comparison-heading">
        <div>
          <span className="section-kicker">03 / 效果对比</span>
          <h3 id="comparison-title">左右并排，完整查看空间变化</h3>
        </div>
        <span>图片保持原比例，不裁剪</span>
      </div>
      <div className="comparison-stage">
        <figure className="comparison-item comparison-before">
          <div className="comparison-image-frame">
            <img src={before} alt="改造之前的房间" />
          </div>
          <figcaption>改造之前</figcaption>
        </figure>
        <figure className="comparison-item comparison-after">
          <div className="comparison-image-frame">
            <img src={after} alt="改造之后的房间" />
          </div>
          <figcaption>改造之后</figcaption>
        </figure>
      </div>
    </section>
  );
}

function Workbench({ credits, refreshCredits, onSaved }) {
  const [theme, setTheme] = useState(themes[0]);
  const [room, setRoom] = useState(rooms[0]);
  const [scale, setScale] = useState(scales[1]);
  const [preferences, setPreferences] = useState({
    layout: true,
    storage: true,
    light: false,
  });
  const [image, setImage] = useState(null);
  const [task, setTask] = useState(null);
  const [status, setStatus] = useState("empty");
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef(null);
  const pollAbortRef = useRef(null);
  useEffect(() => () => pollAbortRef.current?.abort(), []);
  const params = { room, theme, scale, preferences };
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
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice(null);
    setTask(null);
    setSaved(false);
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
      setStatus("ready");
    } catch (error) {
      setNotice({ tone: "error", text: messageFor(error) });
    }
  };
  const generate = async () => {
    if (!image) {
      setNotice({ tone: "error", text: "请先上传一张房间照片。" });
      inputRef.current?.focus();
      return;
    }
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    setStatus("creating");
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
      console.info("[Generation Timing]", {
        traceId: completed.traceId ?? completed.id,
        totalClientMs,
        uploadAndTaskCreateMs,
        clientPollingMs: Math.max(0, totalClientMs - uploadAndTaskCreateMs),
        providerMs: completed.timings?.providerMs ?? null,
        nonProviderServerMs: completed.timings?.nonProviderMs ?? null,
        serverTotalMs: completed.timings?.serverTotalMs ?? null,
        originalStoreMs: completed.timings?.originalStoreMs ?? null,
        resultStoreMs: completed.timings?.resultStoreMs ?? null,
        creditSettlementMs: completed.timings?.creditSettlementMs ?? null,
      });
      if (completed.status === "succeeded") {
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
        original: { url: image.previewUrl, mimeType: image.payload.type },
        effectImage: task.result.effectImage,
        params,
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
            />
            <SelectField
              label="设计风格"
              value={theme}
              options={themes}
              onChange={setTheme}
            />
            <div className="field">
              <span>改造强度</span>
              <div className="scale-options">
                {scales.map((option) => (
                  <button
                    key={option}
                    className={scale === option ? "selected" : ""}
                    type="button"
                    aria-pressed={scale === option}
                    onClick={() => setScale(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <fieldset className="field fieldset">
              <legend>
                固定偏好 <small>可选</small>
              </legend>
              <div className="preference-list">
                {[
                  ["layout", "尽量保留原有布局"],
                  ["storage", "增加实用收纳"],
                  ["light", "让空间更明亮"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={
                      preferences[key] ? "preference checked" : "preference"
                    }
                    type="button"
                    aria-pressed={preferences[key]}
                    onClick={() =>
                      setPreferences((current) => ({
                        ...current,
                        [key]: !current[key],
                      }))
                    }
                  >
                    <span>{preferences[key] && <Check size={14} />}</span>
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <button
            className="primary-button"
            disabled={["creating", "polling"].includes(status)}
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
                {room} · {theme}
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
                    <LoaderCircle className="spin" />
                  ) : (
                    <Sparkles size={30} />
                  )}
                  <span>
                    {["creating", "polling"].includes(status)
                      ? "正在生成，请稍候…"
                      : "生成后将在这里展示"}
                  </span>
                </div>
              )}
            </div>
          </div>
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
              disabled={!resultUrl || saving || saved}
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
              <img src={selected.original.url} alt="作品原始照片" />
              <figcaption>生成之前</figcaption>
            </figure>
            <figure>
              <img src={selected.effectImage.url} alt="作品设计效果" />
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
              <img src={work.effectImage.url} alt="" />
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

function AppShell({ user, onLogout }) {
  const [page, setPage] = useState("studio");
  const [menuOpen, setMenuOpen] = useState(false);
  const [credits, setCredits] = useState(null);
  const [worksRefresh, setWorksRefresh] = useState(0);
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
          onSaved={() => setWorksRefresh((value) => value + 1)}
        />
      )}
      {page === "works" && <WorksPage refreshKey={worksRefresh} />}
      {page === "credits" && (
        <CreditsPage credits={credits} refreshCredits={refreshCredits} />
      )}
      {page === "account" && <AccountPage user={user} onLogout={onLogout} />}
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
