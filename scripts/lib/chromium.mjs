import { existsSync } from "node:fs";

const systemChromium = "/usr/bin/chromium";

export const chromiumLaunchOptions = {
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync(systemChromium) ? systemChromium : undefined),
};
