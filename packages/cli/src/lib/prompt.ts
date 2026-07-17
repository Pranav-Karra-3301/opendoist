import { createInterface } from 'node:readline/promises'

export const prompter = {
  async ask(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return (await rl.question(`${question} `)).trim()
    } finally {
      rl.close()
    }
  },
  async confirm(question: string): Promise<boolean> {
    return /^y(es)?$/i.test(await prompter.ask(`${question} [y/N]`))
  },
}
