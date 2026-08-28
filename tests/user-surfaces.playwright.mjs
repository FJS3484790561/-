import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteBin = fileURLToPath(new URL("../../bin/vite.js", import.meta.resolve("vite")));

const baseUrl = "http://127.0.0.1:4186/";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
  { name: "minimum-mobile", width: 320, height: 800 },
];
const processes = [
  spawn(process.execPath, ["server/start-api.js"], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: { ...process.env, API_PORT: "8796", APP_ALLOWED_ORIGINS: "http://127.0.0.1:4186" },
  }),
  spawn(
    process.execPath,
    [viteBin, "--host=127.0.0.1", "--port=4186", "--strictPort"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, API_ORIGIN: "http://127.0.0.1:8796" },
    },
  ),
];

for (const process of processes) {
  process.once("error", (error) => {
    throw new Error(`QA child process failed: ${error.message}`);
  });
}

for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    if ((await fetch(`${baseUrl}api/health`)).ok) break;
  } catch {
    if (attempt === 59)
      throw new Error("Local application did not become ready");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleErrors = [];
    const expectedUnauthorizedResponses = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (
        response.status() === 401 &&
        response.url().endsWith("/api/auth/session")
      )
        expectedUnauthorizedResponses.push(response.url());
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "忘记密码？" }).click();
    await page
      .getByLabel("邮箱")
      .fill(`recovery-${viewport.name}-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "发送重置说明" }).click();
    await page
      .getByText("如该邮箱已注册，重置说明将发送到邮箱。")
      .waitFor();
    await page.getByRole("button", { name: "返回登录" }).click();
    await page.getByRole("tab", { name: "注册" }).click();
    await page
      .getByLabel("邮箱")
      .fill(`${viewport.name}-${Date.now()}@example.com`);
    await page.getByLabel("密码").fill("correct-horse");
    await page.getByRole("button", { name: "创建账户" }).click();
    await page.getByRole("heading", { name: "设计工作台" }).waitFor();

    await page
      .getByLabel("上传房间照片")
      .setInputFiles({ name: "room.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: /生成设计/ }).click();
    await page.getByText("请先选择空间类型，再生成设计。").waitFor();
    await page.getByLabel("空间类型").selectOption("客厅");
    await page.getByRole("button", { name: /生成设计/ }).click();
    await page.getByText("设计方案已生成").waitFor();
    const slider = page.locator(".comparison-slider");
    const sliderBox = await slider.boundingBox();
    const baseBox = await slider.locator(".comparison-base").boundingBox();
    const afterBox = await slider.locator(".comparison-after-layer img").boundingBox();
    const comparisonUsesFullWidth = sliderBox && baseBox && afterBox && Math.abs(sliderBox.width - baseBox.width) < 1 && Math.abs(sliderBox.width - afterBox.width) < 1;
    const comparisonFollowsImageHeight = sliderBox && baseBox && Math.abs(sliderBox.height - baseBox.height) < 1;
    await page.getByLabel("调整改造前后图片的分界位置").fill("70");
    const dividerBox = await slider.locator(".comparison-divider").boundingBox();
    const comparisonSliderMoves = sliderBox && dividerBox && Math.abs((dividerBox.x - sliderBox.x) / sliderBox.width - 0.7) < 0.02;
    await page.getByRole("button", { name: "保存作品" }).click();
    await page.getByText("作品已保存到“我的作品”。").waitFor();

    if (viewport.width <= 700)
      await page.getByRole("button", { name: "打开导航" }).click();
    await page.getByRole("button", { name: /我的作品/ }).click();
    await page.getByRole("button", { name: /客厅 · 现代简约/ }).click();
    await page.getByRole("button", { name: "返回作品列表" }).waitFor();
    await page.getByRole("button", { name: "返回作品列表" }).click();
    if (viewport.width <= 700)
      await page.getByRole("button", { name: "打开导航" }).click();
    await page.getByRole("button", { name: /额度充值/ }).click();
    await page.getByRole("button", { name: /^常用 ¥10 / }).click();
    await page.getByText("订单已创建，等待支付").waitFor();

    if (viewport.width <= 700)
      await page.getByRole("button", { name: "打开导航" }).click();
    await page.getByRole("button", { name: /账户帮助/ }).click();
    await page.getByRole("button", { name: "退出登录" }).click();
    await page.getByRole("heading", { name: "欢迎回来" }).waitFor();

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const unexpectedConsoleErrors = consoleErrors.filter(
      (message) => !message.includes("401 (Unauthorized)"),
    );
    const result = {
      viewport: viewport.name,
      noHorizontalOverflow: metrics.scrollWidth <= metrics.clientWidth,
      comparisonUsesFullWidth,
      comparisonFollowsImageHeight,
      comparisonSliderMoves,
      expectedUnauthorizedResponses: expectedUnauthorizedResponses.length,
      unexpectedConsoleErrors,
    };
    results.push(result);
    if (
      !result.noHorizontalOverflow ||
      !result.comparisonUsesFullWidth ||
      !result.comparisonFollowsImageHeight ||
      !result.comparisonSliderMoves ||
      unexpectedConsoleErrors.length
    )
      process.exitCode = 1;
    await context.close();
  }
} finally {
  await browser.close();
  for (const process of processes) process.kill();
}
console.log(JSON.stringify(results, null, 2));
