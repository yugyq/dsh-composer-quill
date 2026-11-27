/**
 * Live probe: does an attachment actually reach the model's context?
 *
 * Not part of `npm test` — it spends a real call and needs a credential plus the
 * DSH packages on disk. It answers what a unit test cannot: with the real image
 * in the message the model reads the digits, and without it the model invents
 * them. The file carries a warehouse id that appears nowhere in the picture, so
 * the two halves can be told apart.
 *
 *   node dev/probes/probe-attachments-live.mjs
 *
 * Set DSH_PACKAGES to the directory holding @deepseek-ai/dsh-llm-deepseek when
 * the DSH app checkout is not at the default location below.
 */
import fs from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.DSH_COMPOSER_QUILL_STATE_DIR ??= mkdtempSync(join(tmpdir(), 'quill-live-'))

const PACKAGE_ROOT = process.env.DSH_PACKAGES
  ?? 'C:/Users/dqdyfrw/.dsh/desktop-preview-test/app/resources/app/dsh/node_modules/@deepseek-ai'
const load = (specifier) => import(pathToFileURL(`${PACKAGE_ROOT}/${specifier}`).href)

let Context
let LocalAttachmentStore
try {
  ;({ Context } = await load('cordis/lib/index.js'))
  ;({ LocalAttachmentStore } = await load('dsh-attachment-local/lib/index.js'))
} catch (error) {
  console.log(`找不到 DSH 自身的包（${PACKAGE_ROOT}）；用 DSH_PACKAGES 指一下：${error.message}`)
  process.exit(2)
}

const { __test } = await import('../../index.js')
const { composeStream } = __test

const credentials = join(homedir(), '.dsh', '.credentials.yaml')
const key = fs.existsSync(credentials)
  ? (fs.readFileSync(credentials, 'utf8').match(/sk-[A-Za-z0-9]+/) ?? [])[0]
  : undefined
if (key === undefined) {
  console.log('没有可用的 sk-… 凭证，跳过')
  process.exit(2)
}

const picture = join(import.meta.dirname, 'attachments-shot.png')
const png = fs.readFileSync(picture)

const home = mkdtempSync(join(tmpdir(), 'quill-live-home-'))
const store = new LocalAttachmentStore(new Context(), { dshHome: home })
const [imageRef] = await store.saveImages([{ data: png, mediaType: 'image/png', name: 'shot.png' }])
const fileText = '订单号：BLUE-HERON-42\n仓编号：KX-7731\n处理人：林\n'
const fileRef = await store.saveFile({ data: Buffer.from(fileText, 'utf8'), name: 'notes.txt' })
const binary = Buffer.concat([
  Buffer.from('PK\u0003\u0004'), Buffer.alloc(64, 0), Buffer.from([0xff, 0xfe, 0x00, 0x01]),
])
const binaryRef = await store.saveFile({ data: binary, name: 'report.bin' })
const staged = {
  'r-image': { type: 'image', attachment: imageRef, encodedBytes: png.byteLength },
  'r-file': { type: 'file', attachment: fileRef },
  'r-bin': { type: 'file', attachment: binaryRef },
}

/** The adapter's job, done by hand: neutral blocks to the wire body. */
async function wireContent(content) {
  const out = []
  for (const block of content) {
    if (block.type === 'text') { out.push({ type: 'text', text: block.text }); continue }
    if (block.type !== 'image') continue
    const stored = await store.readImage(block.attachment)
    out.push(
      { type: 'text', text: `[image ${block.attachment.name ?? ''} ${block.attachment.width}x${block.attachment.height}]` },
      { type: 'image', source: { type: 'base64', media_type: stored.ref.mediaType, data: Buffer.from(stored.data).toString('base64') } },
    )
  }
  return out
}

let lastShape = ''

/** One real call, yielding the chunks ctx.llm.stream is expected to produce. */
async function* realStream(options) {
  const neutral = options.messages.at(-1).content
  lastShape = neutral.map((block) => block.type).join('+')
  const content = await wireContent(neutral)
  const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${key}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens ?? 384,
      stream: true,
      thinking: { type: 'disabled' },
      system: options.system,
      messages: [{ role: 'user', content }],
    }),
    signal: options.signal,
  })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  const raw = await response.text()
  let usage
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') continue
    let event
    try { event = JSON.parse(payload) } catch { continue }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      yield { type: 'text-delta', index: 0, text: event.delta.text }
    }
    if (event.type === 'message_start') usage = event.message?.usage ?? usage
    if (event.type === 'message_delta' && event.usage) usage = { ...usage, output_tokens: event.usage.output_tokens }
  }
  if (usage !== undefined) {
    yield {
      type: 'usage',
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      },
    }
  }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

function fakeResponse() {
  const chunks = []
  const response = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader: () => {},
    flushHeaders: () => {},
    write: (chunk) => { chunks.push(String(chunk)); return true },
    end: () => { response.writableEnded = true },
    on: () => response,
    frames: () => chunks.join(''),
  }
  return response
}

function fakeContext(sessionId) {
  const session = {
    id: sessionId,
    requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-flash' } }),
    snapshotEvents: () => [],
  }
  return {
    agents: { get: () => ({ session }) },
    llm: { stream: realStream },
    get: (name) => {
      if (name === 'fileUploads') return { resolve: (_agent, receiptId) => staged[receiptId] }
      if (name === 'attachments') return store
      return undefined
    },
  }
}

async function compose(label, draft, attachments, sessionId) {
  const response = fakeResponse()
  const started = Date.now()
  await composeStream(fakeContext(sessionId), {
    sessionId, draft, locale: 'zh-CN', forced: '', epoch: 0, receivedAt: Date.now(), attachments,
  }, response, new AbortController().signal)
  const frames = response.frames().split('\n\n')
    .map((chunk) => chunk.split('\n').filter((line) => line.startsWith('data:')))
    .flat()
    .map((line) => { try { return JSON.parse(line.slice(5).trim()) } catch { return null } })
    .filter((frame) => frame !== null)
  const final = frames.filter((frame) => frame.text !== undefined && frame.mode !== undefined).at(-1)
  const text = final?.text ?? ''
  console.log(`${label.padEnd(22)} ${JSON.stringify(text).slice(0, 68).padEnd(70)} ${String(Date.now() - started).padStart(4)}ms  内容=${lastShape}`)
  return text
}

const descriptors = [
  { kind: 'image', name: 'shot.png', bytes: png.byteLength, receiptId: 'r-image' },
  { kind: 'file', name: 'notes.txt', bytes: Buffer.byteLength(fileText), receiptId: 'r-file' },
]

const withImage = await compose('截图里的数字是（带图）', '这个截图里的数字是', [descriptors[0]], 's-live-a')
const withoutImage = await compose('同一草稿（无附件）', '这个截图里的数字是', [], 's-live-b')
const withFile = await compose('仓编号是（带文件）', '我贴的文件里仓编号是', [descriptors[1]], 's-live-c')
const withoutFile = await compose('同一草稿（无附件）', '我贴的文件里仓编号是', [], 's-live-d')
const binaryArm = await compose('二进制文件', '这个文件里写了什么', [{ kind: 'file', name: 'report.bin', bytes: binary.byteLength, receiptId: 'r-bin' }], 's-live-e')

const verdict = (label, ok) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
verdict('图片里的数字只有带着图片才说得对', withImage.includes('7342') && !withoutImage.includes('7342'))
verdict('文件里的仓编号只有带着文件才说得对', withFile.includes('KX-7731') && !withoutFile.includes('KX-7731'))
verdict('读不出正文的文件不会被编内容', !/KX-7731|BLUE-HERON/.test(binaryArm))
process.exit(0)
