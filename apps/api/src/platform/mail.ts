import { ServiceUnavailableException } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional files, for example the PDF of a quote. */
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/** Sends one e-mail. Adapters are chosen by configuration (ADR 0021); the rest of the code never sees SMTP. */
export interface MailProvider {
  /** Whether mail can be sent at all. Features that need mail say so instead of failing late. */
  readonly configured: boolean;
  /** Resolves with the id the mail server gave the message. Rejects when the server did not accept it. */
  send(message: MailMessage): Promise<{ messageId: string }>;
}

export interface SmtpSettings {
  /** For example smtp://127.0.0.1:1025 or smtps://user:password@smtp.example.com:465. */
  url: string;
  from: string;
}

/** Sends through any SMTP server. The URL may carry credentials, so it is never logged. */
export class SmtpMailProvider implements MailProvider {
  readonly configured = true;
  private readonly transport: Transporter;

  constructor(private readonly settings: SmtpSettings) {
    this.transport = nodemailer.createTransport(settings.url);
  }

  async send(message: MailMessage): Promise<{ messageId: string }> {
    const info = await this.transport.sendMail({
      from: this.settings.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.attachments ? { attachments: message.attachments } : {}),
    });
    return { messageId: String(info.messageId) };
  }
}

/** Used when no mail server is configured: sending answers 503 with a stable code. */
export class UnconfiguredMailProvider implements MailProvider {
  readonly configured = false;
  send(): Promise<{ messageId: string }> {
    return Promise.reject(
      new ServiceUnavailableException({
        statusCode: 503,
        code: "mail_not_configured",
        message: "E-mail is not configured on this server.",
      }),
    );
  }
}

/** Collects mail in memory for tests only. MOCK: nothing leaves the process. */
export class MemoryMailProvider implements MailProvider {
  readonly configured = true;
  readonly sent: MailMessage[] = [];
  /** Set to make the next sends fail, to test error handling. */
  failWith: Error | undefined;

  send(message: MailMessage): Promise<{ messageId: string }> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve({ messageId: `<memory-${this.sent.length}@loadlane.test>` });
  }
}
