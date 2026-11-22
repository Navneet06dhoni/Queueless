import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { EmailOptions } from '../types';

export interface IEmailTransport {
  sendMail(options: EmailOptions): Promise<void>;
}

export class NodemailerTransport implements IEmailTransport {
  private transporter: Transporter | null = null;

  constructor() {
    this.init();
  }

  private init() {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST || 'localhost',
      port: config.SMTP_PORT || 1025,
      secure: false,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }

  async sendMail(options: EmailOptions): Promise<void> {
    if (!config.NOTIFICATIONS_ENABLED) return;
    if (!this.transporter) this.init();

    await this.transporter!.sendMail({
      from: config.EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  }
}

let emailTransport: IEmailTransport = new NodemailerTransport();

export const getEmailTransport = (): IEmailTransport => emailTransport;
export const setEmailTransport = (transport: IEmailTransport) => {
  emailTransport = transport;
};
