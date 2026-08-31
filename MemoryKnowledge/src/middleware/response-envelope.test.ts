import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { accessLog } from "./response-envelope.js";
describe("access logger preserves Hono request and response bodies", () => {
  it("downstream JSON parsing still works after logging reads text", async () => {
    const app = new Hono(); app.use("*", accessLog());
    app.post("/test", async c => c.json(await c.req.json()));
    const response = await app.request("/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team_id: "offline-test", value: "content" }) });
    expect(await response.json()).toEqual({ team_id: "offline-test", value: "content" });
  });
  it("non-JSON requests and error response bodies remain intact", async () => {
    const app = new Hono(); app.use("*", accessLog());
    app.post("/test", async c => c.text(await c.req.text(), 400));
    const response = await app.request("/test", { method: "POST", body: "text body" });
    expect(response.status).toBe(400); expect(await response.text()).toBe("text body");
  });
});
