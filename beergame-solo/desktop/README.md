# Windows 便携版

交付文件：`../dist/BeerGame.exe`。面向 Windows 10/11 x64，使用系统已有的 .NET Framework 4.8 / WebView2。无需安装 Node、无需启动命令。没有 WebView2 的旧系统会提示缺少运行时；本包不静默安装系统组件。

## 使用

双击 EXE，在游戏内选择角色、创建房间。局域网朋友：点击窗口顶部「复制局域网地址」，把地址及房间码发给朋友；朋友可直接用浏览器打开，也可在自己的 EXE 顶部粘贴地址并点击「连接朋友」。如果有多个网卡，状态行会显示全部可用地址，选择与朋友同网段的地址。Windows 防火墙可能要求允许私人网络访问。

不同地点的朋友：点击「开启互联网联机」，等待成功后点击「复制互联网地址」，再发送游戏内的房间码。使用 Cloudflare Quick Tunnel，不需要账户或路由器端口映射；互联网连通性取决于双方网络及 Cloudflare 服务。临时地址没有可用性保证，不适合作为永久服务器。也支持在地址框连接已有的公网游戏服务器。

朋友连接的是房主的房间服务，不能只在自己的本机服务里输入房间码。切换连接前先在游戏内离开当前房间。房主关闭窗口后所有房间结束，互联网地址失效。

## 占用与清理边界

EXE 自身需要磁盘空间；运行中将内置 Node、SDK、cloudflared、网页及独立浏览器缓存放到 `%TEMP%/BeerGamePortable/随机ID`，不会安装服务、添加开机启动、修改注册表或主动创建防火墙规则。导出 CSV 仅写入你主动选择的路径。

外层进程将游戏窗口及其子进程加入 Windows Job Object。窗口退出后终止本次运行的 Node、隧道及 WebView2 子进程，再删除临时目录。外层进程异常退出时，Job Object 的 KILL_ON_JOB_CLOSE 会终止进程组。断电或清理进程被强制结束可能留下临时文件，下次启动只清理本应用拥有且未被运行实例锁定的 GUID 目录。

不承诺清除 Windows 自身的执行历史、预取、杀毒日志或系统缓存；不修改这些系统记录。系统原本已有的 WebView2 进程不会被清理。

## 开发与验证

`build.ps1` 使用系统 .NET Framework C# 编译器，内嵌压缩资源，生成一个 EXE。缺少缓存时从官方源下载 WebView2 SDK 1.0.3537.50 和 cloudflared 2026.10.0，并校验隧道程序官方 SHA256。SDK 和隧道文件放在项目内 `vendor`，不会安装到用户环境。Node 来自构建机的 `node.exe`，本次版本为 24.18.0，许可证与二进制一起打包。交付后删除构建缓存以节约磁盘空间；重新构建时会重新下载。

本次实测已通过本机和互联网两组验证，报告在 `../evidence/portable-local.json`、`../evidence/portable-internet.json`。报告中的公网网址在测试退出后已经失效。

`test-portable.ps1` 启动真实 EXE，在内嵌 WebView2 中执行教程及双席位同步测试，然后断言进程、端口、临时目录全部消失。加 `-Internet` 会临时启动真实公网通道，验证网页和房间 API，完成后自动关闭。

官方参考：
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- https://github.com/cloudflare/cloudflared/releases
