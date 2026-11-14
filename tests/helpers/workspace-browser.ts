import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { chromiumLaunchOptions } from "../../scripts/lib/chromium.mjs";

const require = createRequire(resolve("package.json"));
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");

export async function bundleWorkspaceBrowser(
  contents: string,
  {
    router,
    client,
    tsconfig,
  }: { router: string; client: string; tsconfig?: string },
): Promise<string> {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents },
    bundle: true,
    write: false,
    platform: "browser",
    tsconfig,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "workspace-browser-boundaries",
        setup(builder: {
          onResolve: (
            options: object,
            callback: (args: { path: string }) => object,
          ) => void;
          onLoad: (
            options: object,
            callback: (args: { path: string }) => object,
          ) => void;
        }) {
          builder.onResolve(
            { filter: /^(next\/navigation|@\/lib\/supabase\/client)$/ },
            (args) => ({ path: args.path, namespace: "test" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            contents:
              args.path === "next/navigation"
                ? `export const useRouter=()=>${router};`
                : `export const isSupabaseConfigured=()=>true; export const createClient=()=>${client};`,
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

export async function openWorkspacePage(
  page: Page,
  globals: Record<string, unknown>,
) {
  await page.route("https://harbor.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("https://harbor.test/");
  await page.evaluate((value) => {
    Object.assign(window, value);
  }, globals);
}

export function launchWorkspaceBrowser() {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return chromium.launch({
    ...(existsSync(chrome)
      ? { executablePath: chrome }
      : chromiumLaunchOptions),
    headless: true,
  });
}
