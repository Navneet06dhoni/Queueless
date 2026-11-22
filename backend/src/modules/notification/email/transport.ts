import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../../../config';
import { EmailOptions, EmailTransport } from '../notification.types';

export class NodemailerTransport implements EmailTransport {
  private transporter: Transporter;

  constructor() {
    if (config.SMTP_HOST) {
      const auth =
        config.SMTP_USER && config.SMTP_PASS
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined;

      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        auth,
      });
    } else {
      this.transporter = nodemailer.createTransport({
        jsonTransport: true,
      });
    }
  }

  async sendMail(options: EmailOptions): Promise<void> {
    const mailOptions = {
      from: config.EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    const info = await this.transporter.sendMail(mailOptions);
    if (!config.SMTP_HOST && config.NODE_ENV !== 'test') {
      console.log('📧 [Mock Email Sent (jsonTransport)]:', info.message);
    }
  }
}

let currentTransport: EmailTransport = new NodemailerTransport();

export const getEmailTransport = (): EmailTransport => currentTransport;

export const setEmailTransport = (transport: EmailTransport): void => {
  currentTransport = transport;
};

export const resetEmailTransport = (): void => {
  currentTransport = new NodemailerTransport();
};
