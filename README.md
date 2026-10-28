# TuneBridge

开源的网页工具:把**网易云音乐、QQ音乐、酷我、酷狗**的公开歌单迁移到 **Apple Music**。

粘贴歌单链接 → 服务端解析并按"谨慎匹配"原则在 Apple Music 曲库中逐曲比对 → 你确认匹配结果 → 浏览器经 MusicKit JS 授权后在你的 Apple Music 里创建歌单并批量导入。全程不下载音频、不接触你的 Apple 密码。

## 特性

- 四平台公开歌单自动识别(网易云 / QQ音乐 / 酷我 / 酷狗)
- 解析与匹配进度经 SSE 实时推送(断线自动降级为轮询)
- 谨慎匹配:证据链完整(歌名/歌手/专辑/时长/ISRC 互相印证)才自动加入;DJ、Live、Remix 等版本候选永不默认顶替,需人工勾选
- 日/韩/俄文歌曲先在原语言地区曲库确认身份,再以 ISRC 反查你所在地区的对应录音;纯汉字歌名尝试中国区/日区辅助
- 全站共享两级搜索缓存(内存 + SQLite Durable Object),在飞请求合并,保护免费额度
- Worker 侧排队与限流(每 IP 并发 1 任务、每日 5 任务、单曲单 1000 首),前端显示排队位置与预计等待
- 结果可导出 JSON

## 技术栈

- 前端:Vue 3 + TypeScript + Vite(`web/`)
- 后端:Cloudflare Workers + Hono + Durable Objects(`worker/`,模块化单体,无微服务)
- 共享类型:`shared/`
- 测试:Vitest(174 个用例,含四平台真实歌单快照 fixture)

## 本地开发

要求 Node ≥ 18、pnpm 9。

```bash
pnpm install
pnpm -r build      # 三包类型检查 + 前端构建
pnpm -r test       # 全部测试
pnpm dev:worker    # wrangler dev(http://localhost:8787)
pnpm dev:web       # Vite 开发服务器(http://localhost:5173,/api 代理到 8787)
```

本地授权联调需要 `worker/.dev.vars`(参照 `.dev.vars.example`):

```bash
cd worker
cp .dev.vars.example .dev.vars   # 填入你自己的三项 Apple 密钥
```

## 部署

1. **Apple 前置**(一次性,年费 99 美元):
   - 加入 [Apple Developer Program](https://developer.apple.com/programs/);
   - Certificates/Identifiers/Keys → Keys → 新建 **Media ID (MusicKit)** 密钥,下载 `.p8`;
   - 记录 Team ID(Membership 页)与 Key ID(密钥详情页)。
2. **域名验证(D8,重要)**:MusicKit JS 的授权要求站点域名在 Apple 后台该 Media ID 下注册并通过验证(下载 `apple-developer-*.json` 放到 `https://你的域名/.well-known/`)。**先实测 `*.workers.dev` 能否通过该验证**;若被拒,需要绑定自有域名(在 Cloudflare 上加自定义域即可,Workers 路由自动生效)。
3. **构建并部署**:

```bash
pnpm --filter @tunebridge/web build
pnpm --filter @tunebridge/worker deploy

cd worker
wrangler secret put APPLE_MUSIC_PRIVATE_KEY   # .p8 内容压成单行,\n 转义
wrangler secret put APPLE_MUSIC_TEAM_ID
wrangler secret put APPLE_MUSIC_KEY_ID
```

4. 打开 `https://tunebridge-worker.<你的子域>.workers.dev/`(或自定义域名),完成。

## 容量与限额(免费套餐)

| 项 | 值 |
| --- | --- |
| Workers 请求 | ~10 万/天 |
| 内存缓存 | 500 查询 / 4 MiB;命中 6h、空结果 5min;不缓存错误 |
| 持久缓存(SQLite DO) | 10000 查询 / 32 MiB;重启与部署后保留;载入不续期 |
| 缓存与上游并发 | 总闸 40 个待处理;上游在飞 8;ISRC 批量 25/批 |
| 队列准入 | 每 IP 并发 1、每日 5(失败退还);歌单 > 1000 曲拒绝 |
| 任务保留 | 完成/失败 24h 后清理 |

按冷缓存估算,免费额度约支撑每天 100–300 个歌单;共享缓存命中后更高。

## 隐私

- 后端只处理公开歌单链接与公开曲库搜索;**Music User Token 只存在于你的浏览器**,创建歌单、写入资料库均由浏览器直连 Apple,不经过本站后端。
- 缓存键为分地区规范化请求哈希,值只含公开曲库字段,不含任何账号标识、歌单归属或授权凭据。
- 不下载、不分发音频文件;不收集 Apple 账号密码;无用户系统。

## 已知事项 / 待实测

- MusicKit JS v3 的 `MusicKit.configure / authorize / musicUserToken` 属性名以[官方文档](https://developer.apple.com/documentation/musickitjs)为准,首次部署联调时核对。
- `*.workers.dev` 能否通过 Apple 域名验证需实测(见上文 D8 步骤)。
- 各源平台接口为非官方公开端点,若平台调整结构,对应 adapter 的 fixture 测试会先红。
