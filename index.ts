import { readFileSync } from 'fs'

interface FledgeMessage {
  type: string
  action?: string
  id?: string
  args?: string[]
  project?: {
    name: string
    language: string
    root: string
  }
  command?: string
  text?: string
  value?: any
  status?: string
}

async function main() {
  // 1. Read init message
  const input = readFileSync(0, 'utf8')
  const initMsg: FledgeMessage = JSON.parse(input)

  if (initMsg.args?.includes('--help') || initMsg.args?.includes('-h')) {
    console.log(`fledge release-notes — Generate AI blog posts from your changelog

USAGE:
  fledge release-notes [OPTIONS]

OPTIONS:
  --out <path>    Path to save the MDX file (default: stdout)
  --version <v>   Target version for the notes (default: latest tag)
  --help, -h      Show this help
`)
    process.exit(0)
  }

  // Helper to send messages and read responses
  async function request(msg: FledgeMessage): Promise<FledgeMessage> {
    console.log(JSON.stringify(msg))
    // We can't use readFileSync(0) again because it's buffered or synchronous
    // For fledge plugins, we usually read from stdin line by line
    for await (const line of console) {
        return JSON.parse(line)
    }
    throw new Error('No response from fledge')
  }

  const outIdx = initMsg.args?.indexOf('--out') ?? -1
  const outPath = outIdx !== -1 ? initMsg.args?.[outIdx + 1] : null

  const verIdx = initMsg.args?.indexOf('--version') ?? -1
  const targetVer = verIdx !== -1 ? initMsg.args?.[verIdx + 1] : null

  // 2. Get changelog
  const changelogCmd = targetVer ? `fledge changelog --tag ${targetVer} --json` : `fledge changelog --limit 1 --json`
  const changelogResp = await request({ type: 'exec', id: '1', command: changelogCmd })
  
  if (changelogResp.status !== 'ok') {
    request({ type: 'output', text: 'Error fetching changelog: ' + (changelogResp.value || 'unknown') })
    process.exit(1)
  }

  const changelogData = JSON.parse(changelogResp.value)
  const release = changelogData.releases?.[0] || changelogData

  // 3. Draft blog post via AI
  const prompt = `Write a developer-focused blog post in MDX format for the following release data. 
Include frontmatter with:
- title: concise and catchy
- description: summary of changes
- category: release
- date: ${new Date().toISOString().split('T')[0]}
- author: fledge-agent
- readTime: 5

Release data:
${JSON.stringify(release, null, 2)}

Ensure the body uses clean Markdown and highlights the most important fixes and features.`

  const aiCmd = `fledge ask "${prompt.replace(/"/g, '\\"')}" --json`
  const aiResp = await request({ type: 'exec', id: '2', command: aiCmd })

  if (aiResp.status !== 'ok') {
    request({ type: 'output', text: 'Error generating notes: ' + (aiResp.value || 'unknown') })
    process.exit(1)
  }

  const aiData = JSON.parse(aiResp.value)
  const content = aiData.answer || aiData.text || aiData

  // 4. Output or Save
  if (outPath) {
    // In fledge protocol, we don't have a 'write_file' capability directly in the plugin loop usually,
    // but we can use 'exec' to shell out or just use Node FS if we have permissions.
    // However, fledge-v1 plugins can use 'exec' for anything.
    const saveCmd = `cat <<EOF > ${outPath}\n${content}\nEOF`
    await request({ type: 'exec', id: '3', command: saveCmd })
    request({ type: 'output', text: `✅ Release notes saved to ${outPath}` })
  } else {
    request({ type: 'output', text: content })
  }
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
