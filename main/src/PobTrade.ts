import type { IncomingMessage, Server, ServerResponse } from "http";
import { app, net } from "electron";
import type { AssistantBackend } from "./backend/AssistantBackend";
import type { TencentLogin } from "./TencentLogin";
import type { TradeWindow } from "./TradeWindow";
import type { Logger } from "./RemoteLogger";
import { isPobRequest, passedHeaders, pobTradeRoute } from "./pob-trade-routes";

// PoB's Trader on the Tencent trade site (PoE2 assistant M04).
// PoB sends its trade requests to this local server (port in
// assistant-status.json); they go on to poe.game.qq.com in the Electron
// session the user logged in with (TencentLogin), the same way the price
// check proxy does. Cookies and tokens stay in that session: nothing here
// reads them, and PoB only sees the API answers. Search bodies get Chinese
// item names, fetched items are turned into English by the backend, so PoB's
// own parser reads them unchanged.

interface Answer {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

const LOGIN_MESSAGE =
  "国服登录已过期：请在助手弹出的“国服登录已过期”窗口里登录（不是在自己的浏览器里），登录成功后窗口自动关闭，再重新搜索。窗口没出现就点 Trader 里的“登录国服市集”。";

async function send(
  method: string,
  url: string,
  body?: Buffer,
): Promise<Answer> {
  return await new Promise((resolve, reject) => {
    const request = net.request({
      url,
      method,
      useSessionCookies: true,
      headers: {
        "content-type": "application/json",
        "user-agent": app.userAgentFallback,
      },
    });
    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function reply(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function errorBody(message: string) {
  return { error: { code: 0, message } };
}

export class PobTrade {
  constructor(
    server: Server,
    private backend: AssistantBackend,
    private login: TencentLogin,
    private tradeWindow: TradeWindow,
    private logger: Logger,
  ) {
    server.addListener("request", (req, res) => {
      if (!req.url?.startsWith("/pob-trade/")) return;
      this.handle(req, res).catch((err: Error) => {
        this.logger.write(`error [PoB trade] ${err.message}`);
        if (!res.headersSent) {
          reply(res, 502, errorBody(`助手转发失败：${err.message}`));
        }
      });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (!isPobRequest(req.headers)) {
      reply(res, 403, errorBody("forbidden"));
      return;
    }
    const route = pobTradeRoute(req.method, req.url);
    if (!route) {
      reply(res, 404, errorBody("unknown route"));
      return;
    }
    if (route.kind === "login") {
      this.login.open();
      reply(res, 200, { state: "opened" });
      return;
    }
    if (route.kind === "market") {
      // M09b: PoB's "打开市集" button.
      const realm = this.tradeWindow.open();
      reply(res, 200, { state: "opened", realm });
      return;
    }

    let body: Buffer | undefined;
    if (route.kind === "search") {
      const translated = await this.backend.request("translate-trade-query", {
        body: JSON.parse((await readBody(req)).toString("utf8")) as unknown,
      });
      if ("error" in translated) {
        reply(res, 502, errorBody(translated.error.message));
        return;
      }
      const result = translated.result as { body: unknown; missing: string[] };
      if (result.missing.length) {
        reply(
          res,
          400,
          errorBody(
            `国服市集需要简中名称，这些名称没有译名：${result.missing.join("、")}`,
          ),
        );
        return;
      }
      body = Buffer.from(JSON.stringify(result.body), "utf8");
    }

    const method = route.kind === "search" ? "POST" : "GET";
    let answer = await send(method, route.url, body);
    if (answer.status === 401) {
      // The API token may be gone while the page's refresh token is not.
      await this.login.refresh();
      answer = await send(method, route.url, body);
      if (answer.status === 401) this.login.requireLogin();
    }
    const headers = passedHeaders(answer.headers);
    this.logger.write(`info [PoB trade] ${route.kind} ${answer.status}`);
    if (answer.status === 401) {
      reply(res, 401, errorBody(LOGIN_MESSAGE), headers);
      return;
    }
    if (route.kind !== "fetch" || answer.status !== 200) {
      reply(res, answer.status, answer.body.toString("utf8"), headers);
      return;
    }
    const fetched = JSON.parse(answer.body.toString("utf8")) as {
      result?: unknown;
    };
    const translated = await this.backend.request("translate-trade-items", {
      result: fetched.result ?? [],
    });
    if ("error" in translated) {
      reply(res, 502, errorBody(translated.error.message), headers);
      return;
    }
    const english = translated.result as {
      result: unknown[];
      report: { items_skipped: unknown[]; lines_unconverted: number };
    };
    const skipped = english.report.items_skipped.length;
    const lines = english.report.lines_unconverted;
    if (skipped || lines) {
      this.logger.write(
        `info [PoB trade] fetch: ${skipped} items left out, ${lines} lines not converted`,
      );
    }
    reply(res, 200, { result: english.result }, headers);
  }
}
