// 图片上传（贴纸 → B站 CDN）—— 2026-10-22 从 dm.mjs 抽出来共用
//
// 为什么要抽：私信发图（dm --image）和"评论里塞自定义表情"（实验）都要先把本地图片
// 传到 B站 CDN 拿 URL。两处各抄一份的话，`biz=new_dyn` 这种坑迟早只修一处 ✗
import fs from 'node:fs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * @param {{path:string,type:string,width?:number,height?:number}} sticker  stickers.find() 的结果
 * @param {{sessdata:string,bili_jct:string,buvid3:string}} cred
 * @returns {Promise<{url:string,width:number,height:number,size:number,type:string}>}
 */
export async function uploadImage(sticker, cred) {
  const buf = fs.readFileSync(sticker.path)
  const mime = sticker.type === 'png' ? 'image/png' : sticker.type === 'jpg' ? 'image/jpeg' : 'image/gif'
  const fd = new FormData()
  fd.append('file_up', new Blob([buf], { type: mime }), `sticker.${sticker.type}`)
  fd.append('category', 'daily')
  // ⚠️ 必须带 biz=new_dyn，否则文件不进 new_dyn 存储 → URL 之后 404（消息里一张破图）
  fd.append('biz', 'new_dyn')
  fd.append('csrf', String(cred.bili_jct))
  const r = await fetch('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', {
    method: 'POST',
    headers: {
      'user-agent': UA,
      referer: 'https://www.bilibili.com/',
      cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3 || ''}`,
    },
    body: fd,
  })
  const j = await r.json().catch(() => ({}))
  if (j.code !== 0) throw new Error(`上传失败 code=${j.code} ${j.message ?? ''}`)
  // 传完立刻回读：拿不到就不发（否则是一条破图）
  const probe = await fetch(j.data.image_url, { headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' } }).catch(() => null)
  if (!probe || !probe.ok) throw new Error(`图片 URL 不可访问（HTTP ${probe?.status ?? '?'}）—— 上传可能缺 biz=new_dyn`)
  return {
    url: j.data.image_url,
    width: j.data.image_width ?? sticker.width,
    height: j.data.image_height ?? sticker.height,
    size: j.data.img_size ?? Math.round(buf.length / 1024),
    type: sticker.type,
  }
}
