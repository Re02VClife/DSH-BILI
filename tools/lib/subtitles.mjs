// 字幕轨道解析 —— 2026-10-21 加，同日又收紧
//
// ⚠️⚠️ 2026-10-21 事故（必须留档）：
//   为了兼容"WBI 端点返回 0 轨、旧端点有轨"的情况，第一版加了 `/x/player/v2` 回退。
//   实测 BV1x3nw6KEj2（时政口播）时，旧端点先后返回了三份**完全不相干**的字幕：
//     一次是二手车评测（"特斯拉/比亚迪/小米车主…"）
//     一次是英雄联盟比赛（"Faker / Oner / Keria…"）
//     一次是手机评测（"iPhone 16 Pro / 小米 14…"）
//   而这条视频讲的是法国政治。**旧端点的 subtitle_url 不可信** —— 它会回别人的字幕 ✗
//   后果：她会把"别人的台词"当成这条视频的内容去评论 —— 比"没字幕"危险得多。
//
// 所以现在：**只信 WBI 端点**。旧端点 / web/view 只在显式
// `WHALE_ALLOW_LEGACY_SUBS=1` 时才会尝试，并且会打一行警告（留作排查用，不做默认路径）。
//
// 排查结论：视频确实没字幕时，WBI 会稳定返回 0 轨；同系列前一天那期有 612 行 ai-zh，
//   说明"新视频还没生成"是常见状态，隔几小时重跑即可。
export async function resolveSubtitleTracks({ jget, bvid, cid, aid, wbi, log = () => {} }) {
  const allowLegacy = process.env.WHALE_ALLOW_LEGACY_SUBS === '1'
  const safe = async (fn, label) => {
    try { return await fn() } catch (e) {
      log(`${label} 异常：${String(e?.message ?? e).slice(0, 60)}`)
      return null
    }
  }

  // ① 唯一可信的端点（WBI 签名）
  const p1 = await safe(() => jget(`https://api.bilibili.com/x/player/wbi/v2?${wbi({ bvid, cid })}`), 'wbi/v2')
  const tracks = p1?.data?.subtitle?.subtitles ?? []
  if (tracks.length) {
    return { tracks, source: 'x/player/wbi/v2', aiStatus: p1?.data?.subtitle?.ai_status, fallback: false }
  }
  if (!allowLegacy) {
    return { tracks: [], source: 'x/player/wbi/v2（无轨道）', aiStatus: p1?.data?.subtitle?.ai_status, fallback: false }
  }

  // ② 显式开启才走的旧端点（⚠️ 内容可能不是这条视频的）
  log('⚠️ 正在使用不可信的旧端点（WHALE_ALLOW_LEGACY_SUBS=1）—— 拿到的字幕可能属于别的视频')
  const p2 = await safe(() => jget(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`), 'player/v2')
  const legacy = p2?.data?.subtitle?.subtitles ?? []
  if (legacy.length) {
    return { tracks: legacy, source: 'x/player/v2（⚠️ 不可信，仅排查用）', aiStatus: p2?.data?.subtitle?.ai_status, fallback: true }
  }

  // ③ 播放器实际调的端点（同样不可信，仅排查用）
  const ext = encodeURIComponent(JSON.stringify({ video_type: 1 }))
  const p3 = await safe(() => jget(`https://api.bilibili.com/x/v2/subtitle/web/view?oid=${aid}&pid=${cid}` +
    `&context_ext=${ext}&type=1&cur_production_type=0&preferred_language=ai-zh&playlist_switch=0`), 'web/view')
  const third = p3?.data?.subtitle?.subtitles ?? []
  if (third.length) {
    return { tracks: third, source: 'x/v2/subtitle/web/view（⚠️ 不可信，仅排查用）', aiStatus: p3?.data?.subtitle?.ai_status, fallback: true }
  }

  return { tracks: [], source: 'none', aiStatus: p1?.data?.subtitle?.ai_status ?? p2?.data?.subtitle?.ai_status, fallback: false }
}

/** 从轨道里挑一条：优先 ai-zh，其次 zh-CN / 任何 zh，最后第一条。 */
export function pickTrack(tracks, prefer = 'ai-zh') {
  const list = Array.isArray(tracks) ? tracks : []
  return list.find((s) => s.lan === prefer)
    ?? list.find((s) => s.lan === 'zh-CN')
    ?? list.find((s) => String(s.lan ?? '').startsWith('zh'))
    ?? list[0]
    ?? null
}

/** 字幕 JSON body → 带时间戳的行（两个脚本共用同一种格式）。 */
export function bodyToLines(body) {
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return (body ?? []).map((l) => `[${fmt(l.from)}] ${l.content}`)
}

/**
 * 本地转写（`asr` 产出的 txt）→ debrief 用的 body。
 * 认 `[mm:ss] 文本` 和 `[hh:mm:ss] 文本` 两种；认不出的行按 0 秒整行保留（不丢内容 ✓）。
 */
export function parseAsrTxt(text) {
  return String(text ?? '')
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const m = line.match(/^\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]\s*(.*)$/)
      if (!m) return { from: 0, content: line.trim() }
      const h = Number(m[1] || 0)
      const mm = Number(m[2])
      const ss = Number(m[3])
      return { from: h * 3600 + mm * 60 + ss, content: (m[4] ?? '').trim() }
    })
}
