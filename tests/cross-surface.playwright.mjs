import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4174/'
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'minimum-mobile', width: 320, height: 800 },
]

let serverProcess
if (!process.env.PLAYWRIGHT_BASE_URL) {
  serverProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host=127.0.0.1', '--port=4174'], { cwd: process.cwd(), stdio: 'ignore' })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) break
    } catch {
      if (attempt === 49) throw new Error('Local Vite server did not become ready')
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const browser = await chromium.launch({ headless: true })
const results = []

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport })
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /生成设计/ }).click()
    await page.getByText('请先上传一张 JPEG 或 PNG 房间照片').waitFor()
    await page.locator('input[type="file"]').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('qa-image') })
    await page.getByRole('button', { name: /生成设计/ }).click()
    await page.getByText('设计方案已生成，可以查看对比').waitFor()

    const slider = page.getByRole('slider', { name: '调整原图和效果图的分界位置' })
    await slider.focus()
    await slider.press('ArrowRight')
    const sliderValue = await slider.inputValue()
    const bodyMetrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    const focusOutline = await page.locator('.comparison-stage').evaluate((element) => getComputedStyle(element).outlineStyle)
    const labels = await Promise.all([
      page.getByText('生成之前', { exact: true }).boundingBox(),
      page.getByText('生成之后', { exact: true }).boundingBox(),
    ])
    const overlap = labels.every(Boolean) && labels[0].x < labels[1].x + labels[1].width && labels[0].x + labels[0].width > labels[1].x && labels[0].y < labels[1].y + labels[1].height && labels[0].y + labels[0].height > labels[1].y

    const result = {
      viewport: viewport.name,
      noHorizontalOverflow: bodyMetrics.scrollWidth <= bodyMetrics.clientWidth,
      keyboardSliderMoved: Number(sliderValue) > 50,
      focusVisible: focusOutline !== 'none',
      comparisonLabelsDoNotOverlap: !overlap,
      consoleErrors,
    }
    results.push(result)
    if (!result.noHorizontalOverflow || !result.keyboardSliderMoved || !result.focusVisible || !result.comparisonLabelsDoNotOverlap || result.consoleErrors.length) process.exitCode = 1
    await page.close()
  }
} finally {
  await browser.close()
  serverProcess?.kill()
}

console.log(JSON.stringify(results, null, 2))
