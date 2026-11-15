# dsh-balance-bridge

一个给 **DeepSeek Harness (DSH)** 使用的**被动式局域网余额桥插件**。

它把 dsh-pet 已经查询到的 DeepSeek 余额，以只读、带令牌的 HTTP 接口提供给手机端（例如 `dshMobile` 的局域网回退路径）。插件本身**不会定时轮询**：只有在手机请求 `/refresh` 时才让 dsh-pet 刷新一次。

> 这是可选的**回退通道**。`dshMobile` 1.1.x 的主路径是在已认证的 DSH 手机页面内直接调用 dsh-pet 的 `/balance`，不需要这个桥，也不需要 43130 端口。只有页面内路由不可用时才回退到这里。手机端连接/配对完成后会立即查询，之后每 5 分钟查询；插件只在被请求时刷新，不自行轮询。

## 功能

- DSH 启动时自动启动，DSH 退出/插件卸载时关闭。
- `POST /refresh`：让 dsh-pet 立即查询 DeepSeek 余额，并返回最新结果。
- `GET /balance`：返回最近一次缓存，不触发查询。
- `GET /health`：桥的健康状态。
- 令牌保护；兼容 `X-DSH-Balance-Key` 和 `Authorization: Bearer`。
- 不读取、不保存 DeepSeek API Key；只访问本机 dsh-pet 的公开路由。
- 纯 Node.js 内置模块，无运行时依赖。

## 安装

本包符合 DSH bundle 插件的结构：

```text
package.json          # dsh.bundle.patch 指向 cordis.patch.yml
cordis.patch.yml      # 插入 id/name = dsh-balance-bridge
lib/index.js          # Cordis apply(ctx, config)
lib/bridge.js         # 独立可测的 HTTP 服务
```

发布到 GitHub 后，用你的 DSH 插件管理器从该仓库安装；如果当前 DSH 版本只支持本地包，可以先：

```bash
npm pack
# 得到 dsh-balance-bridge-1.0.0.tgz，再用插件管理器安装本地 tgz
```

安装后 DSH 会根据 `cordis.patch.yml` 自动挂载插件。安装/启用后重启 DSH，日志中应出现：

```text
[dsh-balance-bridge] listening on 0.0.0.0:43130
```

### 重要：不要和旧的独立桥同时运行

如果你之前用过独立版 `dshMobile Balance Bridge`，请先停止它并移除 `DSH Balance Bridge.lnk` 启动项，否则两个进程会争抢 43130。这个插件替代独立桥，由 DSH 负责生命周期。

## 配置

至少需要设置一个令牌。推荐在 DSH 环境里设置：

```powershell
# 生成一个随机令牌
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 当前用户环境变量（Windows）
[Environment]::SetEnvironmentVariable('DSH_BALANCE_TOKEN', '<生成的令牌>', 'User')
```

也可以在 profile 的 patch 里给插件传配置：

```yaml
- id: dsh-balance-bridge
  name: dsh-balance-bridge
  config:
    token: '<生成的令牌>'
    port: 43130
    host: '0.0.0.0'
```

可用配置 / 环境变量：

| 配置 | 环境变量 | 默认值 |
| --- | --- | --- |
| `token` | `DSH_BALANCE_TOKEN` | 无，必填；缺失时不启动桥 |
| `host` | `DSH_BALANCE_HOST` | `0.0.0.0` |
| `port` | `DSH_BALANCE_PORT` | `43130` |
| `dshPetOrigin` | `DSH_PET_ORIGIN` | `http://127.0.0.1:43129` |
| `petPrefix` | `DSH_PET_PREFIX` | `/dsh-pet-7340` |
| `requestTimeoutMs` | `DSH_BALANCE_TIMEOUT_MS` | `20000` |

### 和 dshMobile APK 的令牌对应

`dshMobile` 的局域网回退请求固定携带它编译时的 `BALANCE_TOKEN`。如果你要让这个插件服务该 APK 的回退路径，请把插件的 `DSH_BALANCE_TOKEN` 设置为同一个值（不要提交到 GitHub）；或者重新编译 APK 改成新的令牌。

如果只用页面内主动查询，则不需要这个令牌对应关系。

## 接口

所有接口都需要令牌：

```bash
curl -H "X-DSH-Balance-Key: $DSH_BALANCE_TOKEN" \
  http://127.0.0.1:43130/refresh

curl -H "X-DSH-Balance-Key: $DSH_BALANCE_TOKEN" \
  http://127.0.0.1:43130/balance
```

正常响应：

```json
{
  "ok": true,
  "service": "dsh-balance-bridge",
  "version": 1,
  "provider": "deepseek-official",
  "currency": "CNY",
  "total": "28.91",
  "granted": "0.00",
  "toppedUp": "28.91",
  "tier": "idle",
  "updatedAt": 1794735359322
}
```

`tier` 在每次响应时按北京时间重新计算：

- 周一至周五 09:00–12:00、14:00–18:00：`peak`
- 其余时间和周末：`idle`

dsh-pet 不可用时返回 `"ok": false` 和错误信息，手机端显示 `--`。

## 数据流

```text
手机（页面内查询，主路径）
  POST /dsh-pet-7340/balance + GET /state
        ↓ 已认证 DSH 页面连接（Wi-Fi / 移动数据）
DeepSeek → dsh-pet → 手机标题栏

手机（局域网回退）
  POST http://<PC>:43130/refresh
        ↓
dsh-balance-bridge (DSH plugin)
        ↓
dsh-pet /balance + /state
```

## 安全

- 桥只读；不返回聊天、会话或 API Key。
- 必须有令牌；没有令牌时插件不会启动监听。
- 默认绑定 `0.0.0.0` 是为了让同一 Wi-Fi 的手机访问；请使用随机长令牌，不要把 43130 映射到公网。
- 令牌不要写进 Git 仓库。仓库里的 `.gitignore` 已忽略 `.env` 和日志。
- dsh-pet 的余额刷新可能同时触发 dsh-pet 自己的余额展示行为。

## 开发与测试

要求 Node.js 22.19+。

```bash
npm test
node lib/standalone.js   # 用环境变量在本机单跑，不经过 DSH
```

测试使用本地 mock dsh-pet，不访问真实 DeepSeek 凭据。

## 发布到 GitHub

```bash
git init
git add .
git commit -m "feat: passive DSH balance bridge plugin"
git branch -M main
git remote add origin https://github.com/<your-name>/dsh-balance-bridge.git
git push -u origin main
```

上传前请确认：

- 没有 `.env`、令牌或 `bridge.log`；
- `package.json` 的 `name` 在 npm 上可用（或改成自己的 scope，例如 `@you/dsh-balance-bridge`）；
- 如果改包名，`cordis.patch.yml` 的 `id`/`name` 和 `package.json` 的 `dsh.bundle.patch` 保持一致；
- 在 GitHub 仓库描述里注明它是 dshMobile 的可选局域网回退桥。

## 许可

MIT，见 [LICENSE](LICENSE)。本项目不包含 dsh-pet 的代码或素材；dsh-pet 由用户单独安装。
