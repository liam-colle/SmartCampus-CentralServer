import nodemailer from "nodemailer";
import { config } from "../config.js";

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

/** Sends a mail, or prints it when SMTP is not configured (handy in development). */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!transport) {
    console.log(`[mail] SMTP not configured. To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
}
