// chat() 自动续写逻辑的单测：mock fetch，验证截断检测、断点回填、拼接与轮次上限。

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LlmProfile } from "./types";

// client.ts 在模块顶层 bind 了 globalThis.fetch，必须先打桩再动态导入
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const { chat } = await import("./client");

const profile: LlmProfile = {
  id: "t", name: "测试", kind: "openai", baseURL: "http://localhost/v1",
  apiKey: "k", model: "m", roles: ["narrative"],
};

function queueReplies(replies: { content: string; finish: string }[]) {
  fetchMock.mockReset();
  for (const r of replies) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: r.content }, finish_reason: r.finish }] }),
      text: async () => "",
    });
  }
}

describe("chat 自动续写", () => {
  beforeEach(() => fetchMock.mockReset());

  it("正常完成时只请求一次", async () => {
    queueReplies([{ content: "完整的回复。", finish: "stop" }]);
    expect(await chat(profile, [{ role: "user", content: "hi" }])).toBe("完整的回复。");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("被截断时回填断点续写并拼接", async () => {
    queueReplies([
      { content: "故事的前半段写到一半突然", finish: "length" },
      { content: "被续上了，圆满结束。", finish: "stop" },
    ]);
    const out = await chat(profile, [{ role: "user", content: "讲个故事" }]);
    expect(out).toBe("故事的前半段写到一半突然被续上了，圆满结束。");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 第二次请求应带上已输出内容（assistant）与续写指令
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const roles = secondBody.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    expect(secondBody.messages[1].content).toBe("故事的前半段写到一半突然");
    expect(secondBody.messages[2].content).toContain("续写");
  });

  it("连续截断最多补两段后返回已有内容", async () => {
    queueReplies([
      { content: "一", finish: "length" },
      { content: "二", finish: "length" },
      { content: "三", finish: "length" },
      { content: "不该请求到这里", finish: "stop" },
    ]);
    expect(await chat(profile, [{ role: "user", content: "x" }])).toBe("一二三");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
