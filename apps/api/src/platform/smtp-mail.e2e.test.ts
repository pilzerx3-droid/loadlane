// The SMTP adapter against a real SMTP server: the local Mailpit (needs MAIL_SMTP_URL and
// MAILPIT_UI_PORT, as in the local stack). Skipped when no mail server is configured.
import { describe, expect, it } from "vitest";
import { loadEnvFileIfPresent } from "../config/env.ts";
import { SmtpMailProvider } from "./mail.ts";

loadEnvFileIfPresent();

const url = process.env["MAIL_SMTP_URL"];
const uiPort = process.env["MAILPIT_UI_PORT"] ?? "8025";
const api = `http://127.0.0.1:${uiPort}/api/v1`;

describe.skipIf(!url)("SmtpMailProvider against Mailpit", () => {
  it("delivers text and a PDF attachment", async () => {
    const provider = new SmtpMailProvider({
      url: url ?? "",
      from: "Loadlane <no-reply@loadlane.local>",
    });
    const subject = `adapter test ${crypto.randomUUID()}`;
    const result = await provider.send({
      to: "customer@example.com",
      subject,
      text: "Hello from the adapter test",
      attachments: [
        {
          filename: "QT-000001.pdf",
          content: Buffer.from("%PDF-1.7 test"),
          contentType: "application/pdf",
        },
      ],
    });
    expect(result.messageId).toContain("@");

    const search = await fetch(`${api}/search?query=${encodeURIComponent(`subject:"${subject}"`)}`);
    const found = (await search.json()) as { messages: { ID: string; Subject: string }[] };
    expect(found.messages).toHaveLength(1);
    const message = (await (await fetch(`${api}/message/${found.messages[0]?.ID}`)).json()) as {
      From: { Address: string };
      To: { Address: string }[];
      Text: string;
      Attachments: { FileName: string; ContentType: string }[];
    };
    expect(message.From.Address).toBe("no-reply@loadlane.local");
    expect(message.To.map((to) => to.Address)).toEqual(["customer@example.com"]);
    expect(message.Text).toContain("Hello from the adapter test");
    expect(message.Attachments).toMatchObject([
      { FileName: "QT-000001.pdf", ContentType: "application/pdf" },
    ]);
  });

  it("rejects when the server cannot be reached", async () => {
    const provider = new SmtpMailProvider({
      url: "smtp://127.0.0.1:1",
      from: "Loadlane <no-reply@loadlane.local>",
    });
    await expect(
      provider.send({ to: "customer@example.com", subject: "x", text: "x" }),
    ).rejects.toThrow();
  });
});
