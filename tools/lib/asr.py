# -*- coding: utf-8 -*-
"""本地语音转文字（FunASR Paraformer-large + VAD + 标点）—— 2026-10-21 v0.6

为什么是这套：
  · 中文专用（Paraformer 在普通话上比 Whisper 稳，尤其中文人名/机构名）
  · 带 VAD（自动切句，长音频不会一口气喂崩）+ 标点（读起来像人话）
  · 有句子级时间戳 → 能直接出 SRT，也能和弹幕/评论对齐

用法:
  python asr.py <wav> --out-prefix <前缀> [--device cpu|cuda:0] [--hotword "词1 词2"]

产出: <前缀>.json（原始）/ .txt（[mm:ss] 一句一行）/ .srt（字幕文件）
"""
import argparse
import json
import os
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def fmt_ts(sec: float) -> str:
    sec = max(0.0, float(sec or 0))
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def fmt_srt(sec: float) -> str:
    sec = max(0.0, float(sec or 0))
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--out-prefix", default=None)
    ap.add_argument("--model", default="paraformer-zh")
    ap.add_argument("--vad", default="fsmn-vad")
    ap.add_argument("--punc", default="ct-punc")
    ap.add_argument("--device", default="cpu", help="cpu / cuda:0")
    ap.add_argument("--hotword", default="", help="热词，空格分隔（人名/机构名/新词）")
    ap.add_argument("--batch", type=int, default=300)
    args = ap.parse_args()

    if not os.path.isfile(args.wav):
        print(f"[asr] 找不到音频: {args.wav}", file=sys.stderr)
        return 2

    # 模型缓存放在 ~/.bili-ai/asr-models（跟 venv 一起，方便整个删掉）
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    os.environ.setdefault("MODELSCOPE_CACHE", os.path.join(home, ".bili-ai", "asr-models"))

    from funasr import AutoModel  # 放到函数里：--help 不该等 torch 加载

    t0 = time.time()
    print(f"[asr] 加载模型 {args.model}（device={args.device}）… 首次会下载模型，之后走缓存", flush=True)
    model = AutoModel(
        model=args.model,
        vad_model=args.vad,
        punc_model=args.punc,
        device=args.device,
        disable_update=True,
    )
    print(f"[asr] 模型就绪（{time.time() - t0:.1f}s）", flush=True)

    t1 = time.time()
    kw = {}
    if args.hotword.strip():
        kw["hotword"] = args.hotword.strip()
    print("[asr] 开始转写…", flush=True)
    res = model.generate(
        input=args.wav,
        batch_size_s=args.batch,
        sentence_timestamp=True,
        **kw,
    )
    elapsed = time.time() - t1

    item = res[0] if isinstance(res, list) and res else {}
    segs = []
    for s in item.get("sentence_info") or []:
        segs.append({
            "start": float(s.get("start", 0)) / 1000.0,
            "end": float(s.get("end", 0)) / 1000.0,
            "text": (s.get("text") or "").strip(),
        })
    if not segs:
        segs = [{"start": 0.0, "end": 0.0, "text": (item.get("text") or "").strip()}]
    segs = [s for s in segs if s["text"]]

    prefix = args.out_prefix or os.path.splitext(args.wav)[0]
    os.makedirs(os.path.dirname(prefix) or ".", exist_ok=True)
    with open(prefix + ".json", "w", encoding="utf-8") as f:
        json.dump({"model": args.model, "elapsed": round(elapsed, 1), "segments": segs}, f, ensure_ascii=False, indent=2)

    with open(prefix + ".txt", "w", encoding="utf-8") as f:
        for s in segs:
            f.write(f"[{fmt_ts(s['start'])}] {s['text']}\n")

    with open(prefix + ".srt", "w", encoding="utf-8") as f:
        for i, s in enumerate(segs, 1):
            end = s["end"] if s["end"] > s["start"] else s["start"] + 2.0
            f.write(f"{i}\n{fmt_srt(s['start'])} --> {fmt_srt(end)}\n{s['text']}\n\n")

    print(f"[asr] 完成：{len(segs)} 句 · 用时 {elapsed:.1f}s（音频 {fmt_ts(segs[-1]['end'] if segs else 0)}）")
    print(f"[asr] TXT {prefix}.txt")
    print(f"[asr] SRT {prefix}.srt")
    print("[asr] 前 5 句：")
    for s in segs[:5]:
        print(f"  [{fmt_ts(s['start'])}] {s['text']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
