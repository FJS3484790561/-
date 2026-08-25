import { chromium } from "playwright";
import { spawn } from "node:child_process";

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
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const processes = [
  spawn(process.execPath, ["server/start-api.js"], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: { ...process.env, API_PORT: "8796" },
  }),
  spawn(
    npmCommand,
    ["exec", "--", "vite", "--host=127.0.0.1", "--port=4186", "--strictPort"],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      shell: process.platform === "win32",
      env: { ...process.env, API_ORIGIN: "http://127.0.0.1:8796" },
    },
  ),
];

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
    await page.getByText("设计方案已生成").waitFor();
    const slider = page.getByRole("slider", {
      name: "调整原图和效果图的分界位置",
    });
    await slider.focus();
    await slider.press("ArrowRight");
    const sliderValue = Number(await slider.inputValue());
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
      keyboardSliderMoved: sliderValue > 50,
      expectedUnauthorizedResponses: expectedUnauthorizedResponses.length,
      unexpectedConsoleErrors,
    };
    results.push(result);
    if (
      !result.noHorizontalOverflow ||
      !result.keyboardSliderMoved ||
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
