import nodemailer from 'nodemailer'

export function createMailer(environment = process.env, createTransport = nodemailer.createTransport) {
  if (!environment.SMTP_HOST || !environment.SMTP_USER || !environment.SMTP_PASSWORD || !environment.SMTP_FROM) return {}
  const port = Number(environment.SMTP_PORT ?? 465)
  const transport = createTransport({
    host: environment.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false, tls: { rejectUnauthorized: true },
  })
  const send = async (email, subject, text) => {
    const result = await transport.sendMail({ from: environment.SMTP_FROM, to: email, subject, text })
    if (!result.accepted?.length || result.rejected?.length) throw new Error('Mail delivery unavailable')
  }
  return {
    sendRegistrationCode: ({ email, code, expiresMinutes }) => send(email, '室内设计 · 邮箱验证码', `你的注册验证码为：${code}。${expiresMinutes} 分钟内有效，请勿透露给他人。如非本人操作，请忽略此邮件。`),
    sendPasswordReset: ({ email, token }) => send(email, '室内设计 · 重置密码', `请在网站的设置新密码页面填写此重置凭证：${token}\n30 分钟内有效。如非本人操作，请忽略此邮件。`),
  }
}
