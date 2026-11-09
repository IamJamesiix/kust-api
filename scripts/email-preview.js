// npm run email:preview -> writes verify.html and reset.html to a temp folder to open in a browser.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { codeEmailParts } from '../src/lib/code-email.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kust-email-'))
for (const [name, purpose] of [['verify', 'VERIFY_EMAIL'], ['reset', 'RESET_PASSWORD']]) {
  fs.writeFileSync(path.join(dir, `${name}.html`), codeEmailParts({ code: '482913', purpose }).html)
}
console.log(`Open these in your browser:\n  ${dir}/verify.html\n  ${dir}/reset.html`)
console.log(`On a Mac:  open ${dir}/verify.html ${dir}/reset.html`)
