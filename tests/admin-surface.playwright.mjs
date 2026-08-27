import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer as createViteServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'

const baseUrl = 'http://127.0.0.1:4174/admin'
const apiUrl = 'http://127.0.0.1:8797'
const providerUrl = 'http://127.0.0.1:8798/v1/images/edits'
const adminPassword = 'qa-admin-password'
const userPassword = 'qa-user-password'
const processes = []

function start(command, args, env = {}) {
  const child = spawn(command, args, { cwd: process.cwd(), env: { ...globalThis.process.env, ...env }, stdio: 'ignore' })
  processes.push(child)
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Startup connection failures are expected until the child process is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Server did not become ready: ${url}`)
}

const providerServer = createHttpServer((request, response) => {
  request.resume()
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] }))
})
await new Promise((resolve) => providerServer.listen(8798, '127.0.0.1', resolve))
process.env.API_ORIGIN = apiUrl
start(process.execPath, ['server/start-api.js'], { ADMIN_PASSWORD: adminPassword, API_PORT: '8797', APP_ALLOWED_ORIGINS: 'http://127.0.0.1:4174' })
const vite = await createViteServer({ server: { host: '127.0.0.1', port: 4174 } })
await vite.listen()
await Promise.all([waitFor(`${apiUrl}/api/health`), waitFor(baseUrl)])

const browser = await chromium.launch({ headless: true })
const results = []
try {
  const ordinaryEmail = `ordinary-${Date.now()}@example.com`
  const register = await fetch(`${apiUrl}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:4174' }, body: JSON.stringify({ email: ordinaryEmail, password: userPassword }) })
  if (register.status !== 201) throw new Error('Could not prepare ordinary user')

  const permissionPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await permissionPage.goto(baseUrl)
  await permissionPage.getByLabel('管理员邮箱').fill(ordinaryEmail)
  await permissionPage.getByLabel('密码').fill(userPassword)
  await permissionPage.getByRole('button', { name: '安全登录' }).click()
  await permissionPage.getByRole('heading', { name: '没有管理员权限' }).waitFor()
  const forbiddenOverflow = await permissionPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  results.push({ check: 'ordinary-user-403', pass: !forbiddenOverflow })
  await permissionPage.close()

  for (const viewport of [{ name: 'desktop', width: 1366, height: 900 }, { name: 'mobile', width: 390, height: 844 }, { name: 'minimum-mobile', width: 320, height: 800 }]) {
    const providerName = `qa-render-${viewport.name}`
    const context = await browser.newContext({ viewport })
    const providerKey = randomBytes(24).toString('base64url')
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    const consoleErrors = []
    page.on('console', (entry) => {
      const expectedHttpFailure = ['status of 401', 'status of 409', 'status of 500', 'PROVIDER_ALREADY_EXISTS', 'INTERNAL_ERROR'].some((text) => entry.text().includes(text))
      if (entry.type() === 'error' && !expectedHttpFailure) consoleErrors.push(entry.text())
    })
    await page.goto(baseUrl)
    await page.getByLabel('管理员邮箱').fill('admin@example.com')
    await page.getByLabel('密码').fill(adminPassword)
    await page.getByRole('button', { name: '安全登录' }).click()
    await page.getByRole('heading', { name: '运营管理' }).waitFor()
    if (viewport.name === 'desktop') await page.getByText('尚未配置 Provider').waitFor()

    await page.getByRole('button', { name: '新建 Provider' }).first().click()
    if (viewport.name === 'desktop') {
      await page.getByRole('button', { name: '测试并保存' }).click()
      await page.getByText('请输入名称。').waitFor()
      await page.getByText('请输入端点。').waitFor()
      await page.getByText('请输入模型名称。').waitFor()
    }
    await page.getByPlaceholder('render-api').fill(providerName)
    await page.getByLabel('图片编辑 API 端点').fill(providerUrl)
    await page.getByPlaceholder('image-edit-v1').fill('interior-v1')
    await page.getByLabel('API 密钥').fill(providerKey)
    await page.getByRole('button', { name: '测试并保存' }).click()
    await page.getByText('Provider 已创建，默认处于停用状态。').waitFor()
    const secretVisible = (await page.locator('body').innerText()).includes(providerKey)
    const providerRow = page.locator('.provider-row').filter({ hasText: providerName })

    if (viewport.name === 'desktop') {
      await page.getByRole('button', { name: '新建 Provider' }).click()
      await page.getByPlaceholder('render-api').fill(providerName)
      await page.getByLabel('图片编辑 API 端点').fill(providerUrl)
      await page.getByPlaceholder('image-edit-v1').fill('interior-v1')
      await page.getByLabel('API 密钥').fill(randomBytes(24).toString('base64url'))
      await page.getByRole('button', { name: '测试并保存' }).click()
      await page.getByText('该 Provider 名称已存在。').waitFor()
      if (await page.getByLabel('API 密钥').inputValue()) throw new Error('Provider key was not cleared after a conflict')
      await page.getByRole('button', { name: '关闭表单' }).click()

      await page.route('**/api/admin/providers/test', async (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'INTERNAL_ERROR' }) }), { times: 1 })
      await page.getByRole('button', { name: '新建 Provider' }).click()
      await page.getByPlaceholder('render-api').fill(`${providerName}-service-error`)
      await page.getByLabel('图片编辑 API 端点').fill(providerUrl)
      await page.getByPlaceholder('image-edit-v1').fill('interior-v1')
      await page.getByLabel('API 密钥').fill(randomBytes(24).toString('base64url'))
      await page.getByRole('button', { name: '测试并保存' }).click()
      await page.getByText('服务暂时不可用，请稍后重试。').waitFor()
      if (await page.getByLabel('API 密钥').inputValue()) throw new Error('Provider key was not cleared after a service error')
      await page.getByRole('button', { name: '关闭表单' }).click()
    }

    await providerRow.getByRole('button', { name: '编辑' }).click()
    const rotationInput = page.getByLabel('轮换密钥（可选）')
    const keyWasRefilled = (await rotationInput.inputValue()).length > 0
    await page.getByPlaceholder('image-edit-v1').fill('interior-v2')
    await page.getByRole('button', { name: '测试并保存' }).click()
    await page.getByText('Provider 配置已更新。').waitFor()
    await providerRow.getByRole('button', { name: '启用' }).click()
    await page.getByText(`${providerName} 已启用。`).waitFor()
    await providerRow.getByRole('button', { name: '审计' }).click()
    await page.getByRole('heading', { name: `${providerName} · 审计` }).waitFor()
    await page.getByText('创建配置').waitFor()
    await page.getByText('更新配置').waitFor()
    await page.getByText('启用服务').waitFor()
    await page.getByRole('button', { name: '关闭审计记录' }).focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const focusOutline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)
    await page.getByRole('button', { name: '关闭审计记录' }).click()
    await page.getByLabel('每人增加点数').fill('8')
    await page.getByLabel('最多兑换人数').fill('3')
    await page.getByRole('button', { name: '生成兑换码' }).click()
    await page.getByText(/ROOM-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}/).waitFor()
    await page.getByText('8').last().waitFor()
    const body = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    const pass = !secretVisible && !keyWasRefilled && body.scrollWidth <= body.clientWidth && focusOutline !== 'none' && consoleErrors.length === 0
    results.push({ check: viewport.name, pass, secretVisible, keyWasRefilled, horizontalOverflow: body.scrollWidth > body.clientWidth, focusVisible: focusOutline !== 'none', consoleErrors })
    await context.close()
    if (!pass) process.exitCode = 1
  }
} finally {
  await browser.close()
  await vite.close()
  await new Promise((resolve) => providerServer.close(resolve))
  for (const child of processes) child.kill()
}

console.log(JSON.stringify(results, null, 2))
