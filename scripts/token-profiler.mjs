#!/usr/bin/env node
// token-profiler — offline token-usage profiler for Claude Code sessions.
//
// Reads ~/.claude/projects/**/<uuid>.jsonl and produces a comprehensive
// token report: composition (fresh / cache read / cache write / output),
// cache hit rate and expiry gaps, per-turn distribution, explore/edit/test
// phase shares, repeated file reads, repeated commands, failed-call cost,
// top context consumers, compact events (what got dropped and what had to
// be re-read), and actionable recommendations.
//
// It never calls the network and never modifies the transcripts.
//
// Usage:
//   node scripts/token-profiler.mjs                    # overview of recent sessions
//   node scripts/token-profiler.mjs --session <id>     # deep-dive one session
//   node scripts/token-profiler.mjs --project replay   # filter by project folder
//   node scripts/token-profiler.mjs --since 7          # last 7 days
//   node scripts/token-profiler.mjs --json | jq .      # machine-readable
//   node scripts/token-profiler.mjs --md > report.md   # markdown report
//
// Token sizes that come from the API `usage` field are exact. Sizes of tool
// results / prompts are estimated at ~4 chars per token and always labeled
// "est.".

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'

import {
  MODEL_RATES,
  DEFAULT_RATE,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
  PRICING_VERSION,
} from './pricing-table.mjs'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    dir: path.join(os.homedir(), '.claude', 'projects'),
    project: null,
    session: null,
    since: null, // ms timestamp
    last: null,
    top: 10,
    format: 'pretty', // pretty | json | md
    all: false,
    export: null, // path to write profiles JSON for the web dashboard
    lang: detectLang(),
    color: process.stdout.isTTY && !process.env.NO_COLOR,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--dir':
        args.dir = argv[++i]
        break
      case '--project':
      case '-p':
        args.project = argv[++i]
        break
      case '--session':
      case '-s':
        args.session = argv[++i]
        break
      case '--since': {
        const v = argv[++i]
        const days = Number(v)
        args.since = Number.isFinite(days) && v !== ''
          ? Date.now() - days * 24 * 3600 * 1000
          : new Date(v).getTime()
        break
      }
      case '--last':
        args.last = Number(argv[++i])
        break
      case '--top':
        args.top = Number(argv[++i]) || 10
        break
      case '--json':
        args.format = 'json'
        break
      case '--md':
      case '--markdown':
        args.format = 'md'
        break
      case '--all':
        args.all = true
        break
      case '--export': {
        const next = argv[i + 1]
        if (next && !next.startsWith('-')) {
          args.export = next
          i++
        } else {
          args.export = path.join(
            path.dirname(new URL(import.meta.url).pathname),
            '..',
            'src',
            'data',
            'tokenProfiles.local.json',
          )
        }
        break
      }
      case '--no-color':
        args.color = false
        break
      case '--lang': {
        const v = String(argv[++i] || '').toLowerCase()
        if (!['en', 'zh', 'ja'].includes(v)) {
          console.error(`Unsupported --lang "${v}" (supported: en, zh, ja)`)
          process.exit(2)
        }
        args.lang = v
        break
      }
      case '-h':
      case '--help':
        printHelp()
        process.exit(0)
        break
      default:
        if (!a.startsWith('-') && !args.session) args.session = a
        else {
          console.error(`Unknown option: ${a}`)
          process.exit(2)
        }
    }
  }
  if (args.format !== 'pretty') args.color = false
  return args
}

function printHelp() {
  console.log(`token-profiler — offline token-usage profiler for Claude Code sessions

Reads ~/.claude/projects/**/*.jsonl and reports where tokens went and where
they were wasted: cache efficiency, per-turn distribution, explore/edit/test
phase shares, repeated file reads, compact losses, failed-call cost.

Usage:
  token-profiler [options] [session-id]

Options:
  --dir <path>       Transcript root (default: ~/.claude/projects)
  --project, -p <s>  Only projects whose folder name contains <s>
  --session, -s <id> Deep-dive one session (id prefix is enough)
  --since <n|date>   Only sessions started in the last <n> days, or after <date>
  --last <n>         Only the <n> most recent sessions
  --top <n>          Rows in "top" lists (default 10)
  --all              Print a detailed report for every matched session
  --export [file]    Also write profiles JSON for the web dashboard
                     (default: src/data/tokenProfiles.local.json, gitignored)
  --json             Machine-readable JSON output
  --md, --markdown   Markdown report output
  --lang <code>      Report language: en, zh, ja (default: from $LANG)
  --no-color         Disable ANSI colors
  -h, --help         Show this help`)
}

// ---------------------------------------------------------------------------
// Localization — report strings in en / zh / ja
// ---------------------------------------------------------------------------

const STRINGS = {
  en: {
    report_title: 'TOKEN PROFILE',
    pricing: 'pricing {v}',
    unknown_model: 'unknown model',
    totals: 'TOTALS',
    api_calls: 'API calls',
    in_subagents: '({n} in subagents)',
    user_turns: 'User turns',
    tool_calls: 'Tool calls',
    n_failed: '{n} failed',
    fresh_input: 'Fresh input',
    of_input_side: '{pct} of input side',
    cache_write: 'Cache write',
    cache_write_split: '5m {a} / 1h {b}',
    cache_read: 'Cache read',
    hit_rate: 'hit rate {pct}',
    output: 'Output',
    peak_context: 'Peak context',
    peak_context_note: 'input+cache of largest call',
    est_cost: 'Est. API cost',
    est_cost_note: 'list-price equivalent',
    context_growth: 'CONTEXT GROWTH',
    context_growth_note: '(input+cache per call)',
    peak: 'peak {n}',
    compacts_hint: '{n} compact(s) detected — see COMPACTS below',
    per_turn: 'PER-TURN BREAKDOWN',
    h_turn: 'turn',
    h_prompt: 'prompt',
    h_tools: 'tools',
    h_fresh: 'fresh',
    h_cache_w: 'cache-w',
    h_cache_r: 'cache-r',
    h_out: 'out',
    h_results: 'results*',
    h_cost: 'cost',
    h_share: 'share',
    results_footnote: '*results = est. tokens injected into context by tool results (chars/4)',
    phase_breakdown: 'PHASE BREAKDOWN',
    phase_breakdown_note: '(explore / edit / execute / test / …)',
    h_phase: 'phase',
    h_tool_calls: 'tool calls',
    h_result_tokens: 'result tokens*',
    h_output_tokens: 'output tokens',
    phase_explore: 'explore',
    phase_edit: 'edit',
    phase_execute: 'execute',
    phase_test: 'test',
    phase_subagent: 'subagent',
    phase_mcp: 'mcp',
    phase_other: 'other',
    phase_respond: 'respond',
    waste_signals: 'WASTE SIGNALS',
    repeated_reads: 'Repeated file reads',
    wasted_suffix: ' — est. {n} wasted',
    no_repeats: 'No file was read more than once. ✓',
    repeated_commands: 'Repeated identical commands',
    repeated_greps: 'Repeated identical greps',
    failed_calls: 'Failed tool calls ({n})',
    top_consumers: 'Top context consumers',
    top_consumers_note: ' (largest tool results)',
    h_reads: 'reads',
    h_file: 'file',
    h_total_est: 'total est',
    h_wasted_est: 'wasted est',
    h_est_tokens: 'est tokens',
    h_tool_call: 'tool call',
    turn_n: 'turn {n}',
    turns_list: 'turns {list}',
    compacts: 'COMPACTS',
    inferred: ' (inferred from context drop)',
    context_drop: ' — context {pre} → {post} (dropped ~{d})',
    summary_kept: 'summary kept ~{n} est. tokens',
    lost_reread: 'lost & re-read afterwards (~{n} est. tokens):',
    none_reread: 'nothing previously read was re-read afterwards ✓',
    gaps: 'CACHE-EXPIRY GAPS',
    gaps_note: '  (pauses >5m; the next call re-writes the cache)',
    gap_line: '{time} after a {gap} pause — re-wrote ~{n} cache tokens',
    recommendations: 'RECOMMENDATIONS',
    overview_title: 'TOKEN PROFILER · {n} session(s)',
    h_session: 'session',
    h_project: 'project',
    h_started: 'started',
    h_title: 'title',
    h_turns: 'turns',
    h_hit: 'hit%',
    h_rewaste: 'rewaste*',
    h_cmp: 'cmp',
    h_est_cost: 'est cost',
    total_row: 'TOTAL',
    overview_footnote: '  *rewaste = est. tokens wasted on repeated file reads · cmp = compacts',
    leaderboard: 'MOST RE-READ FILES ACROSS SESSIONS',
    n_sessions: '{n} session(s)',
    deepdive_hint: 'Run with --session <id> for the per-turn / phase / compact deep-dive.',
    md_metric: 'metric',
    md_value: 'value',
    md_note: 'note',
    rec_repeated_reads:
      'Repeated file reads cost ~{tokens} est. tokens (top: {file} ×{count}). Read with offset/limit, or summarize stable files in CLAUDE.md so they are not re-read each turn.',
    rec_low_cache_hit:
      'Cache hit rate is {rate} — most input tokens were paid at full/write price. Long pauses (>5 min) and frequent system-prompt changes invalidate the cache.',
    rec_expiry_gaps:
      '{n} pause(s) longer than 5 minutes likely expired the prompt cache; the following calls re-wrote ~{tokens} cache tokens at 1.25–2× input price.',
    rec_huge_results:
      '{n} tool result(s) over ~15k est. tokens (largest: {label}, ~{tokens}). Use Read offset/limit, Grep head_limit, or delegate bulk exploration to a subagent that returns only conclusions.',
    rec_failed_calls:
      '{n} tool calls failed; each failure still pays for its context and a retry. Check the failed-calls list for permission errors or repeated bad paths.',
    rec_compact_reread:
      'After the {trigger} compact, {n} file(s) had to be re-read (~{tokens} est. tokens). Consider /compact at a natural milestone yourself, after which fewer files are still needed.',
    rec_subagent:
      'Subagents consumed ~{tokens} input-side and {output} output tokens in {calls} calls — this kept the main context smaller (good); it is included in cost totals.',
  },
  zh: {
    report_title: 'TOKEN 剖析',
    pricing: '价格表 {v}',
    unknown_model: '未知模型',
    totals: '总量',
    api_calls: 'API 调用',
    in_subagents: '（子代理 {n} 次）',
    user_turns: '用户轮次',
    tool_calls: '工具调用',
    n_failed: '{n} 次失败',
    fresh_input: '新输入',
    of_input_side: '占输入侧 {pct}',
    cache_write: '缓存写入',
    cache_write_split: '5分钟 {a} / 1小时 {b}',
    cache_read: '缓存读取',
    hit_rate: '命中率 {pct}',
    output: '输出',
    peak_context: '上下文峰值',
    peak_context_note: '最大一次调用的输入+缓存',
    est_cost: 'API 等价成本',
    est_cost_note: '按牌价折算',
    context_growth: '上下文增长',
    context_growth_note: '（每次调用的输入+缓存）',
    peak: '峰值 {n}',
    compacts_hint: '检测到 {n} 次 compact — 见下方 COMPACT 部分',
    per_turn: '逐轮分布',
    h_turn: '轮次',
    h_prompt: '提示词',
    h_tools: '工具',
    h_fresh: '新输入',
    h_cache_w: '缓存写',
    h_cache_r: '缓存读',
    h_out: '输出',
    h_results: '结果*',
    h_cost: '成本',
    h_share: '占比',
    results_footnote: '*结果 = 工具结果注入上下文的估算 token 数（按 4 字符/token）',
    phase_breakdown: '阶段分布',
    phase_breakdown_note: '（探索 / 编辑 / 执行 / 测试 / …）',
    h_phase: '阶段',
    h_tool_calls: '工具调用',
    h_result_tokens: '结果 token*',
    h_output_tokens: '输出 token',
    phase_explore: '探索',
    phase_edit: '编辑',
    phase_execute: '执行',
    phase_test: '测试',
    phase_subagent: '子代理',
    phase_mcp: 'mcp',
    phase_other: '其他',
    phase_respond: '回复',
    waste_signals: '浪费信号',
    repeated_reads: '重复读取的文件',
    wasted_suffix: ' — 估算浪费 {n}',
    no_repeats: '没有文件被读取超过一次。✓',
    repeated_commands: '重复执行的相同命令',
    repeated_greps: '重复执行的相同 grep',
    failed_calls: '失败的工具调用（{n}）',
    top_consumers: '上下文消耗排行',
    top_consumers_note: '（最大的工具结果）',
    h_reads: '次数',
    h_file: '文件',
    h_total_est: '总计(估)',
    h_wasted_est: '浪费(估)',
    h_est_tokens: '估算token',
    h_tool_call: '工具调用',
    turn_n: '第{n}轮',
    turns_list: '轮次 {list}',
    compacts: 'COMPACT',
    inferred: '（由上下文骤降推断）',
    context_drop: ' — 上下文 {pre} → {post}（丢弃约 {d}）',
    summary_kept: '摘要保留约 {n} 估算 token',
    lost_reread: '丢失并在之后重读（约 {n} 估算 token）：',
    none_reread: '之前读过的内容没有被重读 ✓',
    gaps: '缓存过期间隙',
    gaps_note: '（超过 5 分钟的停顿；之后的调用会重写缓存）',
    gap_line: '{time} 停顿 {gap} 后 — 重写了约 {n} 缓存 token',
    recommendations: '优化建议',
    overview_title: 'TOKEN 剖析 · {n} 个会话',
    h_session: '会话',
    h_project: '项目',
    h_started: '开始时间',
    h_title: '标题',
    h_turns: '轮次',
    h_hit: '命中%',
    h_rewaste: '重读浪费*',
    h_cmp: 'cmp',
    h_est_cost: '估算成本',
    total_row: '合计',
    overview_footnote: '  *重读浪费 = 重复读文件浪费的估算 token · cmp = compact 次数',
    leaderboard: '跨会话最常被重读的文件',
    n_sessions: '{n} 个会话',
    deepdive_hint: '用 --session <id> 查看逐轮 / 阶段 / compact 详细报告。',
    md_metric: '指标',
    md_value: '数值',
    md_note: '说明',
    rec_repeated_reads:
      '重复读文件花费约 {tokens} 估算 token（最多：{file} ×{count}）。可以用 offset/limit 局部读取，或把稳定文件的要点写进 CLAUDE.md，避免每轮重读。',
    rec_low_cache_hit:
      '缓存命中率只有 {rate} — 大部分输入按全价/写入价付费。超过 5 分钟的停顿和频繁变化的系统提示都会让缓存失效。',
    rec_expiry_gaps:
      '{n} 次超过 5 分钟的停顿可能导致提示缓存过期；之后的调用以 1.25–2× 输入价重写了约 {tokens} 缓存 token。',
    rec_huge_results:
      '{n} 个工具结果超过约 1.5 万估算 token（最大：{label}，约 {tokens}）。建议用 Read 的 offset/limit、Grep 的 head_limit，或把批量探索交给只返回结论的子代理。',
    rec_failed_calls:
      '{n} 次工具调用失败；每次失败仍要为其上下文和重试付费。检查失败列表中是否有权限错误或反复出错的路径。',
    rec_compact_reread:
      '{trigger} compact 之后有 {n} 个文件被迫重读（约 {tokens} 估算 token）。可以在自然的里程碑处主动 /compact，此时还需要的文件更少。',
    rec_subagent:
      '子代理在 {calls} 次调用中消耗了约 {tokens} 输入侧 token 和 {output} 输出 token — 这让主上下文更小（是好事）；已计入成本总额。',
  },
  ja: {
    report_title: 'トークンプロファイル',
    pricing: '料金表 {v}',
    unknown_model: '不明なモデル',
    totals: '合計',
    api_calls: 'API 呼び出し',
    in_subagents: '（サブエージェント {n} 回）',
    user_turns: 'ユーザーターン',
    tool_calls: 'ツール呼び出し',
    n_failed: '{n} 件失敗',
    fresh_input: '新規入力',
    of_input_side: '入力側の {pct}',
    cache_write: 'キャッシュ書き込み',
    cache_write_split: '5分 {a} / 1時間 {b}',
    cache_read: 'キャッシュ読み取り',
    hit_rate: 'ヒット率 {pct}',
    output: '出力',
    peak_context: 'コンテキスト最大値',
    peak_context_note: '最大の呼び出しの入力+キャッシュ',
    est_cost: 'API 換算コスト',
    est_cost_note: '定価換算',
    context_growth: 'コンテキストの推移',
    context_growth_note: '（呼び出しごとの入力+キャッシュ）',
    peak: '最大 {n}',
    compacts_hint: '{n} 回の compact を検出 — 下の COMPACT セクションを参照',
    per_turn: 'ターン別内訳',
    h_turn: 'ターン',
    h_prompt: 'プロンプト',
    h_tools: 'ツール',
    h_fresh: '新規',
    h_cache_w: 'キャッシュ書',
    h_cache_r: 'キャッシュ読',
    h_out: '出力',
    h_results: '結果*',
    h_cost: 'コスト',
    h_share: '割合',
    results_footnote: '*結果 = ツール結果がコンテキストへ注入した推定トークン数（4 文字/トークン）',
    phase_breakdown: 'フェーズ別内訳',
    phase_breakdown_note: '（探索 / 編集 / 実行 / テスト / …）',
    h_phase: 'フェーズ',
    h_tool_calls: 'ツール呼出',
    h_result_tokens: '結果トークン*',
    h_output_tokens: '出力トークン',
    phase_explore: '探索',
    phase_edit: '編集',
    phase_execute: '実行',
    phase_test: 'テスト',
    phase_subagent: 'サブエージェント',
    phase_mcp: 'mcp',
    phase_other: 'その他',
    phase_respond: '応答',
    waste_signals: '無駄のシグナル',
    repeated_reads: '重複して読まれたファイル',
    wasted_suffix: ' — 推定 {n} の無駄',
    no_repeats: '複数回読まれたファイルはありません。✓',
    repeated_commands: '同一コマンドの繰り返し',
    repeated_greps: '同一 grep の繰り返し',
    failed_calls: '失敗したツール呼び出し（{n}）',
    top_consumers: 'コンテキスト消費ランキング',
    top_consumers_note: '（最大のツール結果）',
    h_reads: '回数',
    h_file: 'ファイル',
    h_total_est: '合計(推定)',
    h_wasted_est: '無駄(推定)',
    h_est_tokens: '推定トークン',
    h_tool_call: 'ツール呼び出し',
    turn_n: 'ターン{n}',
    turns_list: 'ターン {list}',
    compacts: 'COMPACT',
    inferred: '（コンテキスト急落から推定）',
    context_drop: ' — コンテキスト {pre} → {post}（約 {d} を破棄）',
    summary_kept: '要約は約 {n} 推定トークンを保持',
    lost_reread: '失われて後で再読み込み（約 {n} 推定トークン）：',
    none_reread: '以前読んだものの再読み込みはありませんでした ✓',
    gaps: 'キャッシュ失効ギャップ',
    gaps_note: '（5 分超の停止。直後の呼び出しがキャッシュを書き直します）',
    gap_line: '{time} {gap} の停止後 — 約 {n} のキャッシュトークンを書き直し',
    recommendations: '改善提案',
    overview_title: 'トークンプロファイラ · {n} セッション',
    h_session: 'セッション',
    h_project: 'プロジェクト',
    h_started: '開始',
    h_title: 'タイトル',
    h_turns: 'ターン',
    h_hit: 'ヒット%',
    h_rewaste: '再読無駄*',
    h_cmp: 'cmp',
    h_est_cost: '推定コスト',
    total_row: '合計',
    overview_footnote: '  *再読無駄 = ファイル重複読み込みの推定無駄トークン · cmp = compact 回数',
    leaderboard: 'セッション横断で最も再読されたファイル',
    n_sessions: '{n} セッション',
    deepdive_hint: '--session <id> でターン別 / フェーズ / compact の詳細を表示。',
    md_metric: '指標',
    md_value: '値',
    md_note: '備考',
    rec_repeated_reads:
      'ファイルの重複読み込みに約 {tokens} 推定トークン（最多：{file} ×{count}）。offset/limit で部分読みするか、安定したファイルの要点を CLAUDE.md にまとめると毎ターンの再読を防げます。',
    rec_low_cache_hit:
      'キャッシュヒット率が {rate} です — 入力トークンの大半をフル/書き込み価格で支払っています。5 分超の停止や頻繁なシステムプロンプト変更はキャッシュを無効化します。',
    rec_expiry_gaps:
      '5 分超の停止が {n} 回あり、プロンプトキャッシュが失効した可能性があります。直後の呼び出しは約 {tokens} のキャッシュトークンを入力単価の 1.25–2 倍で書き直しました。',
    rec_huge_results:
      '約 1.5 万推定トークンを超えるツール結果が {n} 件（最大：{label}、約 {tokens}）。Read の offset/limit、Grep の head_limit、または結論のみ返すサブエージェントへの委譲を検討してください。',
    rec_failed_calls:
      '{n} 件のツール呼び出しが失敗。失敗してもコンテキストと再試行の分は支払いが発生します。失敗一覧で権限エラーや繰り返しの誤パスを確認してください。',
    rec_compact_reread:
      '{trigger} compact の後、{n} 個のファイルの再読み込みが必要でした（約 {tokens} 推定トークン）。区切りの良いタイミングで自分から /compact すると、その時点で必要なファイルが少なくて済みます。',
    rec_subagent:
      'サブエージェントは {calls} 回の呼び出しで入力側約 {tokens}・出力 {output} トークンを消費 — メインコンテキストを小さく保てています（良いこと）。コスト合計には含まれています。',
  },
}

let LANG = 'en'

function detectLang() {
  const env =
    process.env.TOKEN_PROFILER_LANG || process.env.LC_ALL || process.env.LANG || ''
  if (/^zh/i.test(env)) return 'zh'
  if (/^ja/i.test(env)) return 'ja'
  return 'en'
}

function tr(key, params) {
  const s = STRINGS[LANG]?.[key] ?? STRINGS.en[key] ?? key
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, name) => (params[name] == null ? m : String(params[name])))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EST_CHARS_PER_TOKEN = 4

function estTokens(text) {
  if (!text) return 0
  return Math.round(String(text).length / EST_CHARS_PER_TOKEN)
}

function rateForModel(model) {
  if (!model || model === '<synthetic>') return null
  return MODEL_RATES.find((r) => r.match.test(model)) ?? DEFAULT_RATE
}

function usageCostUsd(model, u) {
  const rate = rateForModel(model)
  if (!rate) return 0
  return (
    (u.input * rate.inputPerMTok +
      u.output * rate.outputPerMTok +
      u.cacheRead * rate.inputPerMTok * CACHE_READ_MULTIPLIER +
      u.cacheWrite5m * rate.inputPerMTok * CACHE_WRITE_5M_MULTIPLIER +
      u.cacheWrite1h * rate.inputPerMTok * CACHE_WRITE_1H_MULTIPLIER) /
    1_000_000
  )
}

function blankUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }
}

function addUsage(a, b) {
  a.input += b.input
  a.output += b.output
  a.cacheRead += b.cacheRead
  a.cacheWrite5m += b.cacheWrite5m
  a.cacheWrite1h += b.cacheWrite1h
  return a
}

function usageFromMessage(usage) {
  if (!usage) return blankUsage()
  const cc = usage.cache_creation ?? {}
  const w5 = cc.ephemeral_5m_input_tokens
  const w1 = cc.ephemeral_1h_input_tokens
  const fallback = usage.cache_creation_input_tokens ?? 0
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite5m: w5 == null && w1 == null ? fallback : w5 ?? 0,
    cacheWrite1h: w1 ?? 0,
  }
}

function contextSize(u) {
  return u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h
}

function textOf(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c?.text ?? c?.content ?? ''))
      .filter((s) => typeof s === 'string' && s)
      .join('\n')
  }
  return ''
}

// ---------------------------------------------------------------------------
// Phase classification — explore / edit / execute / test / subagent / other
// ---------------------------------------------------------------------------

const EXPLORE_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch', 'TodoRead', 'NotebookRead', 'LS',
])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TEST_COMMAND_RE =
  /\b(test|tests|jest|vitest|pytest|unittest|mocha|tsc|typecheck|type-check|eslint|lint|ruff|flake8|mypy|prettier --check|cargo\s+(test|check|clippy)|go\s+(test|vet)|mvn\s+(test|verify)|gradle\w*\s+(test|check)|rspec|phpunit)\b/i

function classifyPhase(name, input) {
  if (!name) return 'other'
  if (EXPLORE_TOOLS.has(name)) return 'explore'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (name === 'Task' || name === 'Agent' || name === 'Explore') return 'subagent'
  if (name === 'Bash' || name === 'BashOutput') {
    const cmd = String(input?.command ?? '')
    return TEST_COMMAND_RE.test(cmd) ? 'test' : 'execute'
  }
  if (name.startsWith('mcp__')) return 'mcp'
  return 'other'
}

const PHASE_ORDER = ['explore', 'edit', 'execute', 'test', 'subagent', 'mcp', 'other', 'respond']

function toolUseLabel(name, input) {
  if (!input || typeof input !== 'object') return name
  switch (name) {
    case 'Read':
      return `Read ${input.file_path ?? ''}`
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return `${name} ${input.file_path ?? ''}`
    case 'Bash':
      return `Bash: ${String(input.command ?? input.description ?? '').replace(/\s+/g, ' ').slice(0, 70)}`
    case 'Grep':
      return `Grep ${input.pattern ?? ''}${input.path ? ` in ${input.path}` : ''}`
    case 'Glob':
      return `Glob ${input.pattern ?? ''}`
    case 'WebFetch':
      return `WebFetch ${input.url ?? ''}`
    case 'WebSearch':
      return `WebSearch: ${String(input.query ?? '').slice(0, 60)}`
    case 'Task':
      return `Subagent: ${String(input.description ?? '').slice(0, 60)}`
    default:
      return name
  }
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

function decodeProjectName(folderName) {
  // Folder names encode absolute paths with '-' separators, e.g.
  // "-home-user-ai-replay-studio". Strip the home-dir prefix and keep the rest.
  const stripped = folderName
    .replace(/^-(home|Users)-[^-]+-/, '')
    .replace(/^-/, '')
  return stripped || folderName
}

/**
 * Parse one session transcript into a profile object.
 * Returns null when the file holds no analyzable API usage.
 */
function profileTranscript(filePath, projectFolder) {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }

  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      /* skip unparseable lines */
    }
  }
  if (events.length === 0) return null

  const sessionId = events.find((e) => e.sessionId)?.sessionId ?? path.basename(filePath, '.jsonl')

  // -- accumulators ---------------------------------------------------------
  const apiCalls = [] // { ts, model, usage, turn, sidechain, msgId, toolNames, hasText }
  const seenMsgIds = new Set()
  const toolUses = new Map() // tool_use_id -> record
  const turns = [] // { index, ts, prompt, isCommand }
  const compacts = [] // { ts, trigger, preTokens, explicit, summaryEstTokens }
  let firstUserText = ''
  let firstTs = null
  let lastTs = null
  let models = new Map() // model -> apiCall count
  let failedResults = 0
  let sidechainCalls = 0

  let currentTurn = -1
  let lastEventWasCompactBoundary = false

  for (const ev of events) {
    const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : null
    if (ts) {
      if (firstTs == null) firstTs = ts
      lastTs = ts
    }
    const sidechain = ev.isSidechain === true

    // Explicit compact boundary (system event written by Claude Code).
    if (ev.type === 'system' && ev.subtype === 'compact_boundary') {
      compacts.push({
        ts,
        trigger: ev.compactMetadata?.trigger ?? 'unknown',
        preTokens: ev.compactMetadata?.preTokens ?? null,
        explicit: true,
        summaryEstTokens: 0,
      })
      lastEventWasCompactBoundary = true
      continue
    }

    if (ev.type === 'user' && !sidechain) {
      const content = ev.message?.content
      const isToolResult =
        Array.isArray(content) && content.some((c) => c?.type === 'tool_result')

      if (isToolResult) {
        for (const c of content) {
          if (c?.type !== 'tool_result' || !c.tool_use_id) continue
          const rec = toolUses.get(c.tool_use_id)
          const resultText = textOf(c.content)
          if (rec) {
            rec.resultEstTokens = estTokens(resultText)
            rec.failed = c.is_error === true
            rec.endedTs = ts
            if (rec.failed) failedResults++
          }
        }
        continue
      }

      // Compact summary appears as a user message flagged isCompactSummary.
      if (ev.isCompactSummary === true || (lastEventWasCompactBoundary && ev.isMeta !== true)) {
        const summaryText = textOf(content)
        const target = compacts[compacts.length - 1]
        if (ev.isCompactSummary === true && (!target || target.summaryEstTokens)) {
          compacts.push({ ts, trigger: 'unknown', preTokens: null, explicit: true, summaryEstTokens: estTokens(summaryText) })
        } else if (target) {
          target.summaryEstTokens = estTokens(summaryText)
        }
        lastEventWasCompactBoundary = false
        continue
      }
      lastEventWasCompactBoundary = false

      if (ev.isMeta === true) continue
      const promptText = textOf(content)
      if (!promptText.trim()) continue

      const isCommand = /^<command-name>/.test(promptText.trim())
      currentTurn = turns.length
      turns.push({
        index: currentTurn,
        ts,
        prompt: promptText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90),
        promptEstTokens: estTokens(promptText),
        isCommand,
      })
      if (!firstUserText && !isCommand) firstUserText = promptText
      continue
    }

    if (ev.type === 'assistant') {
      const msg = ev.message
      if (!msg) continue
      const msgId = msg.id
      const firstSeen = msgId ? !seenMsgIds.has(msgId) : true
      if (msgId) seenMsgIds.add(msgId)

      let call = null
      if (firstSeen && msg.usage) {
        call = {
          ts,
          model: msg.model,
          usage: usageFromMessage(msg.usage),
          turn: sidechain ? -1 : currentTurn,
          sidechain,
          msgId,
          toolPhases: [],
          hasText: false,
        }
        apiCalls.push(call)
        if (sidechain) sidechainCalls++
        if (msg.model && msg.model !== '<synthetic>') {
          models.set(msg.model, (models.get(msg.model) ?? 0) + 1)
        }
      } else if (msgId) {
        // streamed continuation of an already-counted message
        call = apiCalls.find((c) => c.msgId === msgId)
      }

      const content = msg.content
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_use') {
            const id = c.id || `${sessionId}-tu-${toolUses.size}`
            const rec = {
              id,
              name: c.name,
              phase: classifyPhase(c.name, c.input),
              label: toolUseLabel(c.name, c.input),
              filePath:
                c.name === 'Read' || EDIT_TOOLS.has(c.name) ? c.input?.file_path ?? null : null,
              readRange:
                c.name === 'Read'
                  ? `${c.input?.offset ?? 0}+${c.input?.limit ?? 'all'}`
                  : null,
              command: c.name === 'Bash' ? String(c.input?.command ?? '') : null,
              grepKey:
                c.name === 'Grep'
                  ? `${c.input?.pattern ?? ''} @ ${c.input?.path ?? '.'}`
                  : null,
              turn: sidechain ? -1 : currentTurn,
              sidechain,
              ts,
              endedTs: ts,
              resultEstTokens: 0,
              failed: false,
            }
            toolUses.set(id, rec)
            if (call) call.toolPhases.push(rec.phase)
          } else if (c?.type === 'text' && c.text?.trim()) {
            if (call) call.hasText = true
          }
        }
      }
    }
  }

  const mainCalls = apiCalls.filter((c) => !c.sidechain)
  if (apiCalls.length === 0) return null

  // -- totals ---------------------------------------------------------------
  const totals = blankUsage()
  const sideTotals = blankUsage()
  let costUsd = 0
  for (const c of apiCalls) {
    addUsage(c.sidechain ? sideTotals : totals, c.usage)
    costUsd += usageCostUsd(c.model, c.usage)
  }
  const grand = addUsage(addUsage(blankUsage(), totals), sideTotals)
  const cacheWrite = grand.cacheWrite5m + grand.cacheWrite1h
  const inputSide = grand.input + grand.cacheRead + cacheWrite
  const cacheHitRate = inputSide > 0 ? grand.cacheRead / inputSide : 0

  // -- context growth & implicit compaction / cache-expiry gaps --------------
  const contextSeries = mainCalls.map((c) => contextSize(c.usage))
  const peakContext = Math.max(0, ...contextSeries)

  // implicit compacts: big context drop without an explicit boundary
  const implicitCompacts = []
  for (let i = 1; i < mainCalls.length; i++) {
    const prev = contextSize(mainCalls[i - 1].usage)
    const cur = contextSize(mainCalls[i].usage)
    if (prev > 30000 && cur < prev * 0.55 && prev - cur > 25000) {
      const near = compacts.some(
        (k) => k.ts && mainCalls[i].ts && Math.abs(k.ts - mainCalls[i].ts) < 5 * 60 * 1000,
      )
      if (!near) {
        implicitCompacts.push({
          ts: mainCalls[i].ts,
          trigger: 'inferred',
          preTokens: prev,
          postTokens: cur,
          explicit: false,
          summaryEstTokens: 0,
        })
      }
    }
  }
  // postTokens for explicit compacts = context of the first call after the boundary
  for (const k of compacts) {
    if (k.ts == null) continue
    const after = mainCalls.find((c) => c.ts != null && c.ts >= k.ts)
    if (after) k.postTokens = contextSize(after.usage)
    const before = [...mainCalls].reverse().find((c) => c.ts != null && c.ts < k.ts)
    if (before && k.preTokens == null) k.preTokens = contextSize(before.usage)
  }
  const allCompacts = [...compacts, ...implicitCompacts].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))

  // cache-expiry gaps: >5 minutes between consecutive main-chain calls means
  // the 5m cache likely expired and the next call pays a full cache re-write.
  const expiryGaps = []
  for (let i = 1; i < mainCalls.length; i++) {
    const a = mainCalls[i - 1].ts
    const b = mainCalls[i].ts
    if (a && b && b - a > 5 * 60 * 1000) {
      expiryGaps.push({
        ts: b,
        gapMs: b - a,
        rewriteTokens: mainCalls[i].usage.cacheWrite5m + mainCalls[i].usage.cacheWrite1h,
      })
    }
  }

  // -- per-turn breakdown -----------------------------------------------------
  const turnRows = turns.map((t) => ({
    ...t,
    calls: 0,
    toolCalls: 0,
    usage: blankUsage(),
    resultEstTokens: 0,
    costUsd: 0,
    failed: 0,
  }))
  for (const c of mainCalls) {
    const row = turnRows[c.turn]
    if (!row) continue
    row.calls++
    addUsage(row.usage, c.usage)
    row.costUsd += usageCostUsd(c.model, c.usage)
  }
  for (const tu of toolUses.values()) {
    if (tu.sidechain) continue
    const row = turnRows[tu.turn]
    if (!row) continue
    row.toolCalls++
    row.resultEstTokens += tu.resultEstTokens
    if (tu.failed) row.failed++
  }

  // -- phase breakdown --------------------------------------------------------
  const phases = new Map() // phase -> { toolCalls, resultEstTokens, outputTokens, failed }
  for (const p of PHASE_ORDER) {
    phases.set(p, { phase: p, toolCalls: 0, resultEstTokens: 0, outputTokens: 0, failed: 0 })
  }
  for (const tu of toolUses.values()) {
    if (tu.sidechain) continue
    const ph = phases.get(tu.phase) ?? phases.get('other')
    ph.toolCalls++
    ph.resultEstTokens += tu.resultEstTokens
    if (tu.failed) ph.failed++
  }
  // attribute each message's output tokens across the phases of its tool calls
  for (const c of mainCalls) {
    if (c.toolPhases.length === 0) {
      phases.get('respond').outputTokens += c.usage.output
      continue
    }
    const share = c.usage.output / c.toolPhases.length
    for (const phase of c.toolPhases) {
      const ph = phases.get(phase) ?? phases.get('other')
      ph.outputTokens += share
    }
  }
  const phaseRows = [...phases.values()]
    .map((p) => ({ ...p, outputTokens: Math.round(p.outputTokens) }))
    .filter((p) => p.toolCalls > 0 || p.outputTokens > 0)

  // -- waste: repeated reads / repeated commands / repeated greps -------------
  function dupGroups(keyFn) {
    const byKey = new Map()
    for (const tu of toolUses.values()) {
      if (tu.sidechain || tu.failed) continue
      const key = keyFn(tu)
      if (!key) continue
      const g = byKey.get(key) ?? { key, count: 0, totalEstTokens: 0, maxEstTokens: 0, turns: new Set() }
      g.count++
      g.totalEstTokens += tu.resultEstTokens
      g.maxEstTokens = Math.max(g.maxEstTokens, tu.resultEstTokens)
      g.turns.add(tu.turn)
      byKey.set(key, g)
    }
    return [...byKey.values()]
      .filter((g) => g.count > 1)
      .map((g) => ({
        key: g.key,
        count: g.count,
        totalEstTokens: g.totalEstTokens,
        // first occurrence was necessary; the rest is the waste candidate
        wastedEstTokens: g.totalEstTokens - g.maxEstTokens,
        turns: [...g.turns].filter((t) => t >= 0).map((t) => t + 1),
      }))
      .sort((a, b) => b.wastedEstTokens - a.wastedEstTokens)
  }

  const repeatedReads = dupGroups((tu) => (tu.name === 'Read' ? tu.filePath : null))
  const repeatedCommands = dupGroups((tu) =>
    tu.command ? tu.command.replace(/\s+/g, ' ').trim() : null,
  )
  const repeatedGreps = dupGroups((tu) => tu.grepKey)

  // -- failed calls ------------------------------------------------------------
  const failedCalls = [...toolUses.values()]
    .filter((tu) => tu.failed && !tu.sidechain)
    .map((tu) => ({ label: tu.label, turn: tu.turn + 1, resultEstTokens: tu.resultEstTokens }))
    .sort((a, b) => b.resultEstTokens - a.resultEstTokens)

  // -- top context consumers ----------------------------------------------------
  const topResults = [...toolUses.values()]
    .filter((tu) => !tu.sidechain && tu.resultEstTokens > 0)
    .sort((a, b) => b.resultEstTokens - a.resultEstTokens)
    .slice(0, 25)
    .map((tu) => ({
      label: tu.label,
      phase: tu.phase,
      turn: tu.turn + 1,
      resultEstTokens: tu.resultEstTokens,
      failed: tu.failed,
    }))

  // -- compact loss: files read before a compact and re-read after --------------
  for (const k of allCompacts) {
    if (k.ts == null) continue
    const before = new Set()
    const reRead = new Map()
    for (const tu of toolUses.values()) {
      if (tu.sidechain || tu.name !== 'Read' || !tu.filePath || tu.ts == null) continue
      if (tu.ts < k.ts) before.add(tu.filePath)
      else if (before.has(tu.filePath)) {
        reRead.set(tu.filePath, (reRead.get(tu.filePath) ?? 0) + tu.resultEstTokens)
      }
    }
    k.reReadFiles = [...reRead.entries()]
      .map(([file, tokens]) => ({ file, reReadEstTokens: tokens }))
      .sort((a, b) => b.reReadEstTokens - a.reReadEstTokens)
    k.reReadEstTokens = k.reReadFiles.reduce((a, f) => a + f.reReadEstTokens, 0)
  }

  // -- recommendations ------------------------------------------------------------
  // Structured as { id, params, text } so the web dashboard can re-render
  // them in its own locale; text is rendered in the CLI's --lang.
  const recommendations = []
  const recommend = (id, params) => recommendations.push({ id, params, text: tr(`rec_${id}`, params) })
  const repeatWaste = repeatedReads.reduce((a, r) => a + r.wastedEstTokens, 0)
  if (repeatWaste > 4000) {
    const top = repeatedReads[0]
    recommend('repeated_reads', { tokens: fmtTokens(repeatWaste), file: top.key, count: top.count })
  }
  if (mainCalls.length >= 10 && cacheHitRate < 0.5) {
    recommend('low_cache_hit', { rate: (cacheHitRate * 100).toFixed(1) + '%' })
  }
  if (expiryGaps.length > 0) {
    const rewrite = expiryGaps.reduce((a, g) => a + g.rewriteTokens, 0)
    recommend('expiry_gaps', { n: expiryGaps.length, tokens: fmtTokens(rewrite) })
  }
  const hugeResults = topResults.filter((r) => r.resultEstTokens > 15000)
  if (hugeResults.length > 0) {
    recommend('huge_results', {
      n: hugeResults.length,
      label: hugeResults[0].label,
      tokens: fmtTokens(hugeResults[0].resultEstTokens),
    })
  }
  if (failedCalls.length >= 3) {
    recommend('failed_calls', { n: failedCalls.length })
  }
  for (const k of allCompacts) {
    if ((k.reReadEstTokens ?? 0) > 3000) {
      recommend('compact_reread', {
        trigger: k.trigger,
        n: k.reReadFiles.length,
        tokens: fmtTokens(k.reReadEstTokens),
      })
    }
  }
  if (sideTotals.output + sideTotals.input + sideTotals.cacheRead > 0) {
    const sideCtx = sideTotals.input + sideTotals.cacheRead + sideTotals.cacheWrite5m + sideTotals.cacheWrite1h
    recommend('subagent', {
      tokens: fmtTokens(sideCtx),
      output: fmtTokens(sideTotals.output),
      calls: sidechainCalls,
    })
  }

  return {
    sessionId,
    file: filePath,
    project: decodeProjectName(projectFolder),
    title: firstUserText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || `Session ${sessionId.slice(0, 8)}`,
    startedAt: firstTs,
    endedAt: lastTs,
    durationMs: firstTs != null && lastTs != null ? lastTs - firstTs : 0,
    models: [...models.entries()].map(([model, calls]) => ({ model, calls })),
    pricingVersion: PRICING_VERSION,
    counts: {
      apiCalls: apiCalls.length,
      mainApiCalls: mainCalls.length,
      sidechainApiCalls: sidechainCalls,
      turns: turns.length,
      toolCalls: toolUses.size,
      failedToolCalls: failedResults,
    },
    totals: {
      main: totals,
      sidechain: sideTotals,
      grand,
      cacheHitRate,
      peakContext,
      estCostUsd: costUsd,
    },
    contextSeries,
    turnRows: turnRows.map((r) => ({
      turn: r.index + 1,
      prompt: r.prompt,
      isCommand: r.isCommand,
      apiCalls: r.calls,
      toolCalls: r.toolCalls,
      failed: r.failed,
      usage: r.usage,
      resultEstTokens: r.resultEstTokens,
      costUsd: r.costUsd,
    })),
    phases: phaseRows,
    waste: {
      repeatedReads,
      repeatedCommands,
      repeatedGreps,
      repeatedReadWasteEstTokens: repeatWaste,
      failedCalls,
      topResults,
    },
    compacts: allCompacts.map((k) => ({
      ts: k.ts,
      trigger: k.trigger,
      explicit: k.explicit,
      preTokens: k.preTokens ?? null,
      postTokens: k.postTokens ?? null,
      summaryEstTokens: k.summaryEstTokens ?? 0,
      reReadFiles: k.reReadFiles ?? [],
      reReadEstTokens: k.reReadEstTokens ?? 0,
    })),
    expiryGaps,
    recommendations,
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtTokens(n) {
  if (n == null) return '–'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 10_000) return Math.round(n / 1000) + 'k'
  if (n >= 1_000) return (n / 1000).toFixed(1) + 'k'
  return String(Math.round(n))
}

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US')
}

function fmtCost(n) {
  return '$' + n.toFixed(n >= 10 ? 2 : n >= 0.1 ? 3 : 4)
}

function fmtPct(x) {
  return (x * 100).toFixed(1) + '%'
}

function fmtTime(ts) {
  if (!ts) return '–'
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16)
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '–'
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

function sparkline(series, width = 48) {
  if (!series.length) return ''
  const ticks = '▁▂▃▄▅▆▇█'
  const bucketed = []
  const per = Math.max(1, Math.ceil(series.length / width))
  for (let i = 0; i < series.length; i += per) {
    bucketed.push(Math.max(...series.slice(i, i + per)))
  }
  const max = Math.max(...bucketed, 1)
  return bucketed.map((v) => ticks[Math.min(7, Math.floor((v / max) * 8))]).join('')
}

function makeColor(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s))
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    cyan: wrap('36'),
    yellow: wrap('33'),
    red: wrap('31'),
    green: wrap('32'),
    magenta: wrap('35'),
  }
}

function table(rows, { headers, aligns = [], indent = '  ' } = {}) {
  const all = headers ? [headers, ...rows] : rows
  const widths = []
  for (const row of all) {
    row.forEach((cell, i) => {
      // eslint-disable-next-line no-control-regex
      const len = String(cell).replace(/\x1b\[\d+m/g, '').length
      widths[i] = Math.max(widths[i] ?? 0, len)
    })
  }
  const fmtRow = (row) =>
    indent +
    row
      .map((cell, i) => {
        const s = String(cell)
        // eslint-disable-next-line no-control-regex
        const visible = s.replace(/\x1b\[\d+m/g, '').length
        const pad = ' '.repeat(widths[i] - visible)
        return aligns[i] === 'r' ? pad + s : s + pad
      })
      .join('  ')
  const out = []
  if (headers) {
    out.push(fmtRow(headers))
    out.push(indent + widths.map((w) => '─'.repeat(w)).join('──'))
  }
  for (const row of rows) out.push(fmtRow(row))
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Pretty (terminal) renderer — single session
// ---------------------------------------------------------------------------

function renderSessionPretty(p, opts) {
  const c = makeColor(opts.color)
  const out = []
  const g = p.totals.grand
  const cacheWrite = g.cacheWrite5m + g.cacheWrite1h
  const inputSide = g.input + g.cacheRead + cacheWrite

  out.push(
    c.bold(`${tr('report_title')} · ${p.sessionId.slice(0, 8)} · ${p.project}`),
  )
  out.push(
    c.dim(
      `"${p.title}" · ${fmtTime(p.startedAt)} → ${fmtTime(p.endedAt)} (${fmtDuration(p.durationMs)}) · ` +
        `${p.models.map((m) => m.model).join(', ') || tr('unknown_model')} · ${tr('pricing', { v: p.pricingVersion })}`,
    ),
  )
  out.push('')

  // Totals
  out.push(c.bold(tr('totals')))
  out.push(
    table(
      [
        [tr('api_calls'), fmtInt(p.counts.apiCalls), tr('in_subagents', { n: p.counts.sidechainApiCalls })],
        [tr('user_turns'), fmtInt(p.counts.turns), ''],
        [tr('tool_calls'), fmtInt(p.counts.toolCalls), p.counts.failedToolCalls ? c.red(tr('n_failed', { n: p.counts.failedToolCalls })) : ''],
        [tr('fresh_input'), fmtInt(g.input), c.dim(inputSide ? tr('of_input_side', { pct: fmtPct(g.input / inputSide) }) : '')],
        [tr('cache_write'), fmtInt(cacheWrite), c.dim(tr('cache_write_split', { a: fmtTokens(g.cacheWrite5m), b: fmtTokens(g.cacheWrite1h) }))],
        [tr('cache_read'), fmtInt(g.cacheRead), c.green(tr('hit_rate', { pct: fmtPct(p.totals.cacheHitRate) }))],
        [tr('output'), fmtInt(g.output), ''],
        [tr('peak_context'), fmtInt(p.totals.peakContext), c.dim(tr('peak_context_note'))],
        [tr('est_cost'), fmtCost(p.totals.estCostUsd), c.dim(tr('est_cost_note'))],
      ],
      { aligns: ['l', 'r', 'l'] },
    ),
  )
  out.push('')

  // Context growth
  if (p.contextSeries.length > 1) {
    out.push(c.bold(tr('context_growth')) + c.dim('  ' + tr('context_growth_note')))
    out.push('  ' + c.cyan(sparkline(p.contextSeries)) + c.dim('  ' + tr('peak', { n: fmtTokens(p.totals.peakContext) })))
    if (p.compacts.length) {
      out.push(c.dim('  ' + tr('compacts_hint', { n: p.compacts.length })))
    }
    out.push('')
  }

  // Per-turn
  if (p.turnRows.length) {
    out.push(c.bold(tr('per_turn')))
    const totalCost = p.turnRows.reduce((a, r) => a + r.costUsd, 0) || 1
    out.push(
      table(
        p.turnRows.map((r) => [
          `#${r.turn}`,
          (r.isCommand ? c.dim('[cmd] ') : '') + r.prompt.slice(0, 46),
          fmtInt(r.toolCalls),
          fmtTokens(r.usage.input),
          fmtTokens(r.usage.cacheWrite5m + r.usage.cacheWrite1h),
          fmtTokens(r.usage.cacheRead),
          fmtTokens(r.usage.output),
          fmtTokens(r.resultEstTokens),
          fmtCost(r.costUsd),
          fmtPct(r.costUsd / totalCost),
          r.failed ? c.red(`${r.failed}✗`) : '',
        ]),
        {
          headers: [tr('h_turn'), tr('h_prompt'), tr('h_tools'), tr('h_fresh'), tr('h_cache_w'), tr('h_cache_r'), tr('h_out'), tr('h_results'), tr('h_cost'), tr('h_share'), ''],
          aligns: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
        },
      ),
    )
    out.push(c.dim('  ' + tr('results_footnote')))
    out.push('')
  }

  // Phases
  if (p.phases.length) {
    out.push(c.bold(tr('phase_breakdown')) + c.dim('  ' + tr('phase_breakdown_note')))
    const totalResult = p.phases.reduce((a, r) => a + r.resultEstTokens, 0) || 1
    out.push(
      table(
        p.phases.map((r) => [
          tr(`phase_${r.phase}`),
          fmtInt(r.toolCalls),
          fmtTokens(r.resultEstTokens),
          fmtPct(r.resultEstTokens / totalResult),
          fmtTokens(r.outputTokens),
          r.failed ? c.red(`${r.failed}✗`) : '',
        ]),
        {
          headers: [tr('h_phase'), tr('h_tool_calls'), tr('h_result_tokens'), tr('h_share'), tr('h_output_tokens'), ''],
          aligns: ['l', 'r', 'r', 'r', 'r', 'l'],
        },
      ),
    )
    out.push('')
  }

  // Waste signals
  out.push(c.bold(tr('waste_signals')))
  if (p.waste.repeatedReads.length) {
    out.push('  ' + c.yellow(tr('repeated_reads')) + c.dim(tr('wasted_suffix', { n: fmtTokens(p.waste.repeatedReadWasteEstTokens) })))
    out.push(
      table(
        p.waste.repeatedReads.slice(0, opts.top).map((r) => [
          `${r.count}×`,
          r.key,
          fmtTokens(r.totalEstTokens),
          fmtTokens(r.wastedEstTokens),
          c.dim(tr('turns_list', { list: r.turns.join(',') })),
        ]),
        { headers: [tr('h_reads'), tr('h_file'), tr('h_total_est'), tr('h_wasted_est'), ''], aligns: ['r', 'l', 'r', 'r', 'l'], indent: '    ' },
      ),
    )
  } else {
    out.push(c.dim('  ' + tr('no_repeats')))
  }
  if (p.waste.repeatedCommands.length) {
    out.push('  ' + c.yellow(tr('repeated_commands')))
    out.push(
      table(
        p.waste.repeatedCommands.slice(0, 5).map((r) => [`${r.count}×`, r.key.slice(0, 70), fmtTokens(r.totalEstTokens)]),
        { aligns: ['r', 'l', 'r'], indent: '    ' },
      ),
    )
  }
  if (p.waste.repeatedGreps.length) {
    out.push('  ' + c.yellow(tr('repeated_greps')))
    out.push(
      table(
        p.waste.repeatedGreps.slice(0, 5).map((r) => [`${r.count}×`, r.key.slice(0, 70), fmtTokens(r.totalEstTokens)]),
        { aligns: ['r', 'l', 'r'], indent: '    ' },
      ),
    )
  }
  if (p.waste.failedCalls.length) {
    out.push('  ' + c.red(tr('failed_calls', { n: p.waste.failedCalls.length })))
    out.push(
      table(
        p.waste.failedCalls.slice(0, opts.top).map((r) => [r.label.slice(0, 70), tr('turn_n', { n: r.turn }), fmtTokens(r.resultEstTokens)]),
        { aligns: ['l', 'l', 'r'], indent: '    ' },
      ),
    )
  }
  out.push('  ' + c.bold(tr('top_consumers')) + c.dim(tr('top_consumers_note')))
  out.push(
    table(
      p.waste.topResults.slice(0, opts.top).map((r) => [
        fmtTokens(r.resultEstTokens),
        tr(`phase_${r.phase}`),
        (r.failed ? c.red('✗ ') : '') + r.label.slice(0, 64),
        c.dim(tr('turn_n', { n: r.turn })),
      ]),
      { headers: [tr('h_est_tokens'), tr('h_phase'), tr('h_tool_call'), ''], aligns: ['r', 'l', 'l', 'l'], indent: '    ' },
    ),
  )
  out.push('')

  // Compacts
  if (p.compacts.length) {
    out.push(c.bold(tr('compacts')))
    for (const k of p.compacts) {
      const head = `  ${fmtTime(k.ts)} · ${k.trigger}${k.explicit ? '' : tr('inferred')}`
      const drop =
        k.preTokens != null && k.postTokens != null
          ? tr('context_drop', {
              pre: fmtTokens(k.preTokens),
              post: fmtTokens(k.postTokens),
              d: fmtTokens(Math.max(0, k.preTokens - k.postTokens)),
            })
          : ''
      out.push(c.magenta(head) + c.dim(drop))
      if (k.summaryEstTokens) out.push(c.dim('    ' + tr('summary_kept', { n: fmtTokens(k.summaryEstTokens) })))
      if (k.reReadFiles.length) {
        out.push(c.dim('    ' + tr('lost_reread', { n: fmtTokens(k.reReadEstTokens) })))
        for (const f of k.reReadFiles.slice(0, opts.top)) {
          out.push(c.dim(`      • ${f.file} (~${fmtTokens(f.reReadEstTokens)})`))
        }
      } else {
        out.push(c.dim('    ' + tr('none_reread')))
      }
    }
    out.push('')
  }

  // Cache-expiry gaps
  if (p.expiryGaps.length) {
    out.push(c.bold(tr('gaps')) + c.dim(tr('gaps_note')))
    for (const gp of p.expiryGaps.slice(0, opts.top)) {
      out.push(c.dim('  ' + tr('gap_line', { time: fmtTime(gp.ts), gap: fmtDuration(gp.gapMs), n: fmtTokens(gp.rewriteTokens) })))
    }
    out.push('')
  }

  // Recommendations
  if (p.recommendations.length) {
    out.push(c.bold(tr('recommendations')))
    for (const r of p.recommendations) out.push('  • ' + (typeof r === 'string' ? r : r.text))
    out.push('')
  }

  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Pretty renderer — multi-session overview
// ---------------------------------------------------------------------------

function renderOverviewPretty(profiles, opts) {
  const c = makeColor(opts.color)
  const out = []
  out.push(c.bold(tr('overview_title', { n: profiles.length })))
  out.push('')

  const rows = profiles.map((p) => {
    const g = p.totals.grand
    return [
      p.sessionId.slice(0, 8),
      p.project.slice(0, 18),
      fmtTime(p.startedAt),
      p.title.slice(0, 36),
      fmtInt(p.counts.turns),
      fmtInt(p.counts.toolCalls),
      fmtTokens(g.input),
      fmtTokens(g.cacheWrite5m + g.cacheWrite1h),
      fmtTokens(g.cacheRead),
      fmtPct(p.totals.cacheHitRate),
      fmtTokens(g.output),
      fmtTokens(p.waste.repeatedReadWasteEstTokens),
      String(p.compacts.length || ''),
      fmtCost(p.totals.estCostUsd),
    ]
  })
  const sum = (fn) => profiles.reduce((a, p) => a + fn(p), 0)
  rows.push([
    c.bold(tr('total_row')), '', '', '',
    c.bold(fmtInt(sum((p) => p.counts.turns))),
    c.bold(fmtInt(sum((p) => p.counts.toolCalls))),
    c.bold(fmtTokens(sum((p) => p.totals.grand.input))),
    c.bold(fmtTokens(sum((p) => p.totals.grand.cacheWrite5m + p.totals.grand.cacheWrite1h))),
    c.bold(fmtTokens(sum((p) => p.totals.grand.cacheRead))),
    '',
    c.bold(fmtTokens(sum((p) => p.totals.grand.output))),
    c.bold(fmtTokens(sum((p) => p.waste.repeatedReadWasteEstTokens))),
    c.bold(String(sum((p) => p.compacts.length) || '')),
    c.bold(fmtCost(sum((p) => p.totals.estCostUsd))),
  ])
  out.push(
    table(rows, {
      headers: [tr('h_session'), tr('h_project'), tr('h_started'), tr('h_title'), tr('h_turns'), tr('h_tools'), tr('h_fresh'), tr('h_cache_w'), tr('h_cache_r'), tr('h_hit'), tr('h_out'), tr('h_rewaste'), tr('h_cmp'), tr('h_est_cost')],
      aligns: ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    }),
  )
  out.push(c.dim(tr('overview_footnote')))
  out.push('')

  // Cross-session repeated-read leaderboard
  const byFile = new Map()
  for (const p of profiles) {
    for (const r of p.waste.repeatedReads) {
      const g = byFile.get(r.key) ?? { file: r.key, reads: 0, wastedEstTokens: 0, sessions: 0 }
      g.reads += r.count
      g.wastedEstTokens += r.wastedEstTokens
      g.sessions++
      byFile.set(r.key, g)
    }
  }
  const leaderboard = [...byFile.values()].sort((a, b) => b.wastedEstTokens - a.wastedEstTokens)
  if (leaderboard.length) {
    out.push(c.bold(tr('leaderboard')))
    out.push(
      table(
        leaderboard.slice(0, opts.top).map((r) => [
          `${r.reads}×`,
          r.file,
          fmtTokens(r.wastedEstTokens),
          c.dim(tr('n_sessions', { n: r.sessions })),
        ]),
        { headers: [tr('h_reads'), tr('h_file'), tr('h_wasted_est'), ''], aligns: ['r', 'l', 'r', 'l'] },
      ),
    )
    out.push('')
  }

  out.push(c.dim(tr('deepdive_hint')))
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function mdTable(headers, rows) {
  const line = (cells) => '| ' + cells.map((x) => String(x).replace(/\|/g, '\\|')).join(' | ') + ' |'
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n')
}

function renderSessionMd(p, opts) {
  const g = p.totals.grand
  const cacheWrite = g.cacheWrite5m + g.cacheWrite1h
  const out = []
  out.push(`## ${tr('report_title')} · \`${p.sessionId.slice(0, 8)}\` · ${p.project}`)
  out.push('')
  out.push(`> ${p.title}`)
  out.push('')
  out.push(`*${fmtTime(p.startedAt)} → ${fmtTime(p.endedAt)} (${fmtDuration(p.durationMs)}) · ${p.models.map((m) => m.model).join(', ')} · ${tr('pricing', { v: p.pricingVersion })}*`)
  out.push('')
  out.push(`### ${tr('totals')}`)
  out.push('')
  out.push(
    mdTable(
      [tr('md_metric'), tr('md_value'), tr('md_note')],
      [
        [tr('api_calls'), fmtInt(p.counts.apiCalls), tr('in_subagents', { n: p.counts.sidechainApiCalls })],
        [tr('user_turns'), fmtInt(p.counts.turns), ''],
        [tr('tool_calls'), fmtInt(p.counts.toolCalls), p.counts.failedToolCalls ? tr('n_failed', { n: p.counts.failedToolCalls }) : ''],
        [tr('fresh_input'), fmtInt(g.input), ''],
        [tr('cache_write'), fmtInt(cacheWrite), tr('cache_write_split', { a: fmtTokens(g.cacheWrite5m), b: fmtTokens(g.cacheWrite1h) })],
        [tr('cache_read'), fmtInt(g.cacheRead), tr('hit_rate', { pct: fmtPct(p.totals.cacheHitRate) })],
        [tr('output'), fmtInt(g.output), ''],
        [tr('peak_context'), fmtInt(p.totals.peakContext), ''],
        [tr('est_cost'), fmtCost(p.totals.estCostUsd), tr('est_cost_note')],
      ],
    ),
  )
  out.push('')
  if (p.turnRows.length) {
    out.push(`### ${tr('per_turn')}`)
    out.push('')
    out.push(
      mdTable(
        [tr('h_turn'), tr('h_prompt'), tr('h_tools'), tr('h_fresh'), tr('h_cache_w'), tr('h_cache_r'), tr('h_out'), tr('h_results'), tr('h_cost')],
        p.turnRows.map((r) => [
          r.turn,
          r.prompt.slice(0, 60),
          r.toolCalls,
          fmtTokens(r.usage.input),
          fmtTokens(r.usage.cacheWrite5m + r.usage.cacheWrite1h),
          fmtTokens(r.usage.cacheRead),
          fmtTokens(r.usage.output),
          fmtTokens(r.resultEstTokens),
          fmtCost(r.costUsd),
        ]),
      ),
    )
    out.push('')
  }
  if (p.phases.length) {
    out.push(`### ${tr('phase_breakdown')}`)
    out.push('')
    const totalResult = p.phases.reduce((a, r) => a + r.resultEstTokens, 0) || 1
    out.push(
      mdTable(
        [tr('h_phase'), tr('h_tool_calls'), tr('h_result_tokens'), tr('h_share'), tr('h_output_tokens')],
        p.phases.map((r) => [tr(`phase_${r.phase}`), r.toolCalls, fmtTokens(r.resultEstTokens), fmtPct(r.resultEstTokens / totalResult), fmtTokens(r.outputTokens)]),
      ),
    )
    out.push('')
  }
  out.push(`### ${tr('waste_signals')}`)
  out.push('')
  if (p.waste.repeatedReads.length) {
    out.push(`**${tr('repeated_reads')}**${tr('wasted_suffix', { n: fmtTokens(p.waste.repeatedReadWasteEstTokens) })}`)
    out.push('')
    out.push(
      mdTable(
        [tr('h_reads'), tr('h_file'), tr('h_total_est'), tr('h_wasted_est'), tr('h_turn')],
        p.waste.repeatedReads.slice(0, opts.top).map((r) => [`${r.count}×`, `\`${r.key}\``, fmtTokens(r.totalEstTokens), fmtTokens(r.wastedEstTokens), r.turns.join(', ')]),
      ),
    )
    out.push('')
  }
  if (p.waste.failedCalls.length) {
    out.push(`**${tr('failed_calls', { n: p.waste.failedCalls.length })}**`)
    out.push('')
    out.push(
      mdTable(
        [tr('h_tool_call'), tr('h_turn'), tr('h_est_tokens')],
        p.waste.failedCalls.slice(0, opts.top).map((r) => [r.label.slice(0, 70), r.turn, fmtTokens(r.resultEstTokens)]),
      ),
    )
    out.push('')
  }
  out.push(`**${tr('top_consumers')}**`)
  out.push('')
  out.push(
    mdTable(
      [tr('h_est_tokens'), tr('h_phase'), tr('h_tool_call'), tr('h_turn')],
      p.waste.topResults.slice(0, opts.top).map((r) => [fmtTokens(r.resultEstTokens), tr(`phase_${r.phase}`), r.label.slice(0, 70), r.turn]),
    ),
  )
  out.push('')
  if (p.compacts.length) {
    out.push(`### ${tr('compacts')}`)
    out.push('')
    for (const k of p.compacts) {
      out.push(
        `- **${fmtTime(k.ts)}** · ${k.trigger}${k.explicit ? '' : tr('inferred')}${tr('context_drop', {
          pre: fmtTokens(k.preTokens),
          post: fmtTokens(k.postTokens),
          d: fmtTokens(Math.max(0, (k.preTokens ?? 0) - (k.postTokens ?? 0))),
        })}${k.reReadFiles.length ? `; ${tr('lost_reread', { n: fmtTokens(k.reReadEstTokens) })} ${k.reReadFiles.map((f) => `\`${f.file}\` (~${fmtTokens(f.reReadEstTokens)})`).join(', ')}` : ''}`,
      )
    }
    out.push('')
  }
  if (p.recommendations.length) {
    out.push(`### ${tr('recommendations')}`)
    out.push('')
    for (const r of p.recommendations) out.push(`- ${typeof r === 'string' ? r : r.text}`)
    out.push('')
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function discoverTranscripts(rootDir, projectFilter) {
  const found = []
  if (!fs.existsSync(rootDir)) return found
  for (const proj of fs.readdirSync(rootDir)) {
    const dir = path.join(rootDir, proj)
    let stat
    try {
      stat = fs.statSync(dir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    if (projectFilter && !proj.toLowerCase().includes(projectFilter.toLowerCase())) continue
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.jsonl')) found.push({ file: path.join(dir, f), project: proj })
    }
  }
  return found
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  LANG = opts.lang

  const transcripts = discoverTranscripts(opts.dir, opts.project)
  if (transcripts.length === 0) {
    console.error(`No transcripts found under ${opts.dir}${opts.project ? ` (project filter: ${opts.project})` : ''}`)
    process.exit(1)
  }

  let profiles = []
  for (const t of transcripts) {
    try {
      const p = profileTranscript(t.file, t.project)
      if (p) profiles.push(p)
    } catch (err) {
      console.error(`Failed to profile ${t.file}: ${err.message}`)
    }
  }

  if (opts.session) {
    profiles = profiles.filter(
      (p) => p.sessionId.startsWith(opts.session) || path.basename(p.file).startsWith(opts.session),
    )
    if (profiles.length === 0) {
      console.error(`No session matching "${opts.session}".`)
      process.exit(1)
    }
  }
  if (opts.since) profiles = profiles.filter((p) => (p.startedAt ?? 0) >= opts.since)
  profiles.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  if (opts.last) profiles = profiles.slice(0, opts.last)

  if (profiles.length === 0) {
    console.error('No sessions matched the given filters.')
    process.exit(1)
  }

  if (opts.export) {
    // Like claudeSessions.local.json this contains private prompts and file
    // paths — the default path is gitignored; keep it that way.
    fs.mkdirSync(path.dirname(opts.export), { recursive: true })
    fs.writeFileSync(opts.export, JSON.stringify(profiles, null, 2))
    console.error(`Exported ${profiles.length} profile(s) to ${opts.export}`)
  }

  const detail = opts.all || profiles.length === 1

  if (opts.format === 'json') {
    const payload = detail && profiles.length === 1 ? profiles[0] : profiles
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    return
  }

  if (opts.format === 'md') {
    if (detail) {
      process.stdout.write(profiles.map((p) => renderSessionMd(p, opts)).join('\n---\n\n') + '\n')
    } else {
      // overview as markdown
      const rows = profiles.map((p) => [
        `\`${p.sessionId.slice(0, 8)}\``,
        p.project,
        fmtTime(p.startedAt),
        p.title.slice(0, 40),
        p.counts.turns,
        p.counts.toolCalls,
        fmtTokens(p.totals.grand.input),
        fmtTokens(p.totals.grand.cacheRead),
        fmtPct(p.totals.cacheHitRate),
        fmtTokens(p.totals.grand.output),
        fmtTokens(p.waste.repeatedReadWasteEstTokens),
        fmtCost(p.totals.estCostUsd),
      ])
      process.stdout.write(
        `# ${tr('overview_title', { n: profiles.length })}\n\n` +
          mdTable([tr('h_session'), tr('h_project'), tr('h_started'), tr('h_title'), tr('h_turns'), tr('h_tools'), tr('h_fresh'), tr('h_cache_r'), tr('h_hit'), tr('h_out'), tr('h_rewaste'), tr('h_est_cost')], rows) +
          '\n',
      )
    }
    return
  }

  if (detail) {
    process.stdout.write(profiles.map((p) => renderSessionPretty(p, opts)).join('\n' + '═'.repeat(70) + '\n\n') + '\n')
  } else {
    process.stdout.write(renderOverviewPretty(profiles, opts) + '\n')
  }
}

main()
