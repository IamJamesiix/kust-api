// The two "here's your code" emails (verify email, reset password), drawn like
// a page from the Kust app: cream ruled paper on a desk, ink border with a hard
// ink shadow, margin line, handwriting, one highlighter swipe behind the code.
//
// Email rules: tables + inline styles (Gmail/Outlook), no JavaScript, only the
// hosted logo PNG. Caveat + Patrick Hand load in Apple Mail / iOS Mail; Gmail
// ignores web fonts and falls back to the handwriting-ish stacks below.
// Everything sits on the app's 32px line grid so text lands on the rules.

const C = {
  desk: '#E5E1D8', // paper with an 8% ink wash, like the app's desk
  paper: '#F7F1E3',
  ink: '#1F2E5A',
  muted: '#46527A',
  rule: '#D2D0CC', // rgba(31,46,90,.17) on paper
  margin: '#C7C6C5', // rgba(31,46,90,.22) on paper
  highlight: '#FFD84D',
  red: '#B42318',
}
const HAND = "'Caveat','Bradley Hand','Segoe Print','Comic Sans MS',cursive"
const BODY = "'Patrick Hand','Segoe Print','Bradley Hand','Comic Sans MS','Trebuchet MS',sans-serif"
const FONTS = 'https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Patrick+Hand&display=swap'
const LOGO = 'https://kust.onrender.com/icon-192.png'
const SITE = 'https://kust.onrender.com'

const COPY = {
  VERIFY_EMAIL: {
    title: 'Welcome to Kust!',
    lead: 'Here’s your code. Type it in the app to finish signing up.',
    after: 'Didn’t sign up for Kust? Just ignore this email. Nothing happens without the code.',
    red: false,
    textIntro: 'Welcome to Kust! Type this code in the app to finish signing up:',
    textAfter: "Didn't sign up for Kust? Just ignore this email. Nothing happens without the code.",
  },
  RESET_PASSWORD: {
    title: 'Reset your password',
    lead: 'Someone asked to reset your Kust password. If it was you, type this code in the app.',
    after: 'Wasn’t you? Ignore this email. Your password stays the same.',
    red: true,
    textIntro: 'Someone asked to reset your Kust password. If it was you, type this code in the app to reset your Kust password:',
    textAfter: "Wasn't you? Ignore this email. Your password stays the same.",
  },
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// One row of the page: `lines` ruled lines tall, content written on them.
const row = (lines, inner, extra = '') =>
  `<tr><td class="k-pad" style="padding:0 28px 0 52px;height:${lines * 32}px;vertical-align:top;${extra}">${inner}</td></tr>`

export function codeEmailParts({ code, purpose }) {
  const t = COPY[purpose] || COPY.VERIFY_EMAIL
  const digits = esc(code)
  const pre = `Your code is ${digits}. It works for 10 minutes.`

  const text = [
    t.textIntro,
    '',
    `    ${code}`,
    '',
    'It works for 10 minutes, once.',
    '',
    t.textAfter,
    '',
    'Kust · every naira, a plan.',
    SITE,
    'This is an automatic email, no need to reply.',
  ].join('\n')

  const ruled = `background-color:${C.paper};background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 31px,${C.rule} 31px,${C.rule} 32px),linear-gradient(to right,transparent 39px,${C.margin} 39px,${C.margin} 41px,transparent 41px);`

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(t.title)}</title>
<link href="${FONTS}" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  @media (max-width:420px) {
    .k-pad { padding-left:48px !important; padding-right:16px !important; }
    .k-title { font-size:38px !important; }
    .k-code { font-size:40px !important; letter-spacing:6px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.desk};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.desk};">
<tr><td align="center" style="padding:24px 12px 32px;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="max-width:480px;border:2.5px solid ${C.ink};border-radius:18px 6px 16px 8px;box-shadow:4px 5px 0 ${C.ink};${ruled}">
    ${row(1, '')}
    ${row(2, `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="height:64px;"><tr>
        <td style="vertical-align:middle;"><img src="${LOGO}" width="40" height="40" alt="" style="display:block;border:0;"></td>
        <td style="vertical-align:middle;padding-left:6px;font-family:${HAND};font-size:40px;line-height:64px;font-weight:700;color:${C.ink};">Kust</td>
      </tr></table>`)}
    ${row(2, `<div class="k-title" style="font-family:${HAND};font-size:44px;line-height:60px;padding-top:4px;font-weight:700;color:${C.ink};">${esc(t.title)}</div>`)}
    ${row(0, `<div style="width:120px;height:3px;margin-top:-6px;background:${C.ink};border-radius:3px 1px 3px 1px;font-size:0;line-height:0;">&nbsp;</div>`, 'height:0;')}
    ${row(2, `<div style="font-family:${BODY};font-size:20px;line-height:32px;color:${C.ink};">${esc(t.lead)}</div>`)}
    ${row(1, '')}
    ${row(2, `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:${C.highlight};border-radius:20px 8px 18px 10px;padding:0 20px 0 26px;height:64px;vertical-align:middle;">
          <span class="k-code" style="font-family:'Trebuchet MS',Verdana,Arial,sans-serif;font-size:44px;line-height:64px;font-weight:700;letter-spacing:10px;color:${C.ink};">${digits}</span>
        </td></tr></table>`)}
    ${row(1, `<div style="font-family:${BODY};font-size:17px;line-height:32px;color:${C.muted};">It works for 10 minutes, once.</div>`)}
    ${row(1, '')}
    ${row(2, `<div style="font-family:${BODY};font-size:17px;line-height:32px;color:${t.red ? C.red : C.muted};">${esc(t.after)}</div>`)}
    ${row(1, '')}
    ${row(1, `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="height:32px;"><tr>
        <td style="vertical-align:middle;"><img src="${LOGO}" width="20" height="20" alt="" style="display:block;border:0;"></td>
        <td style="vertical-align:middle;padding-left:6px;font-family:${BODY};font-size:15px;line-height:32px;color:${C.muted};">Kust · every naira, a plan.</td>
      </tr></table>`)}
    ${row(1, '')}
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
    <tr><td style="padding:20px 8px 0;font-family:${BODY};font-size:13px;line-height:20px;color:${C.muted};text-align:center;">
      This is an automatic email, no need to reply.<br><a href="${SITE}" style="color:${C.muted};">kust.onrender.com</a>
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`

  return { subject: `Your Kust code: ${code}`, text, html }
}
