import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const viteBin = fileURLToPath(new URL('../../bin/vite.js', import.meta.resolve('vite')))

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4174/'
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'minimum-mobile', width: 320, height: 800 },
]

let serverProcess
if (!process.env.PLAYWRIGHT_BASE_URL) {
  serverProcess = spawn(process.execPath, [viteBin, '--host=127.0.0.1', '--port=4174'], { cwd: process.cwd(), stdio: 'ignore' })
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
    await page.getByLabel('空间类型').selectOption('客厅')
    await page.getByRole('button', { name: /生成设计/ }).click()
    await page.getByText('设计方案已生成，可以查看对比').waitFor()

    const bodyMetrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    const slider = page.locator('.comparison-slider')
    const sliderBox = await slider.boundingBox()
    const baseBox = await slider.locator('.comparison-base').boundingBox()
    const afterBox = await slider.locator('.comparison-after-layer img').boundingBox()
    const comparisonUsesFullWidth = sliderBox && baseBox && afterBox && Math.abs(sliderBox.width - baseBox.width) < 1 && Math.abs(sliderBox.width - afterBox.width) < 1
    const comparisonFollowsImageHeight = sliderBox && baseBox && Math.abs(sliderBox.height - baseBox.height) < 1

    const result = {
      viewport: viewport.name,
      noHorizontalOverflow: bodyMetrics.scrollWidth <= bodyMetrics.clientWidth,
      comparisonUsesFullWidth,
      comparisonFollowsImageHeight,
      consoleErrors,
    }
    results.push(result)
    if (!result.noHorizontalOverflow || !result.comparisonUsesFullWidth || !result.comparisonFollowsImageHeight || result.consoleErrors.length) process.exitCode = 1
    await page.close()
  }
} finally {
  await browser.close()
  serverProcess?.kill()
}

console.log(JSON.stringify(results, null, 2))
