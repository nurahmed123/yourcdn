import { required, ApiError } from "./security";
export async function sendMail(to: string, subject: string, html: string) {
  const response = await fetch("https://mailapi.arionys.com/api/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required("MAIL_API_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject,
      smtpUser: process.env.MAIL_SMTP_USER || "noreply.arionys+1@gmail.com",
      to: [to],
      html,
      replyTo: process.env.MAIL_FROM || "noreply@arionys.com",
      from: process.env.MAIL_FROM || "noreply@arionys.com",
      fromName: "Arionys CDN",
      bulk: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new ApiError(
      502,
      "Verification email could not be sent. Please try again.",
    );
}
export function otpEmail(code: string, title = "Verify your sign-in") {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:36px;color:#172a3a"><h2>Arionys CDN</h2><h1>${title}</h1><p>Use this code to continue. It expires in 10 minutes.</p><p style="font-size:36px;letter-spacing:8px;font-weight:700">${code}</p><p>Never share this code. If you did not request it, you can ignore this email.</p></div>`;
}
