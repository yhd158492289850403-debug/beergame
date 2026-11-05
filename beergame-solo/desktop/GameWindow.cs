using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class GameWindow : Form {
    internal static int ExitCode = 0;
    readonly WebView2 view = new WebView2();
    readonly Label status = new Label();
    readonly TextBox address = new TextBox();
    readonly Button internetButton = new Button();
    readonly Button copyInternet = new Button();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly string report;
    readonly bool testInternet;
    Process server, tunnel;
    string localUrl, lanUrl, publicUrl;
    bool closing;
    TaskCompletionSource<string> tunnelReady;
    string tunnelLog = "";
    public GameWindow(string reportPath, bool internet) {
        report = reportPath; testInternet = internet;
        Text = "啤酒游戏 · 便携版"; Width = 1280; Height = 900; MinimumSize = new Size(780, 600);
        StartPosition = FormStartPosition.CenterScreen; Font = new Font("Microsoft YaHei UI", 9F);
        BackColor = Color.FromArgb(250,250,249);
        var top = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(10), WrapContents = true };
        AddButton(top, "回到本机", async () => await Navigate(localUrl));
        AddButton(top, "复制局域网地址", () => { Copy(lanUrl); return Task.FromResult(0); });
        internetButton.Text = "开启互联网联机"; internetButton.AutoSize = true;
        internetButton.Click += async (s,e) => { try { await StartTunnel(); } catch(Exception error) { if(!closing) status.Text = "互联网连接失败，可重试；局域网仍可用。" + error.Message; } };
        top.Controls.Add(internetButton);
        copyInternet.Text = "复制互联网地址"; copyInternet.AutoSize = true; copyInternet.Enabled = false;
        copyInternet.Click += (s,e) => Copy(publicUrl); top.Controls.Add(copyInternet);
        AddButton(top, "停止互联网联机", () => { StopTunnel(); status.Text = "互联网地址已停止；本机和局域网仍可用。"; return Task.FromResult(0); });
        address.Width = 280; top.Controls.Add(address);
        AddButton(top, "连接朋友", async () => {
            Uri uri;
            if (!Uri.TryCreate(address.Text.Trim(), UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo.Length > 0) { status.Text = "请粘贴朋友分享的完整 http:// 或 https:// 地址。"; return; }
            await Navigate(uri.AbsoluteUri);
        });
        status.AutoSize = true; status.MaximumSize = new Size(1100,0); status.Padding = new Padding(6); status.Text = "正在启动游戏与联机服务…";
        top.SetFlowBreak(address, false); top.Controls.Add(status); top.SetFlowBreak(status,true);
        view.Dock = DockStyle.Fill; Controls.Add(view); Controls.Add(top);
        Shown += async (s,e) => await StartGame();
        FormClosing += (s,e) => {
            closing = true;
            StopTunnel();
            view.Dispose();
            if(server != null) { try { server.StandardInput.Close(); if(!server.WaitForExit(1500)) server.Kill(); } catch {} }
        };
    }
    void AddButton(FlowLayoutPanel panel, string label, Func<Task> action) {
        var button = new Button {Text=label, AutoSize=true};
        button.Click += async (s,e) => { try { await action(); } catch(Exception error) { if(!closing) status.Text = error.Message; } };
        panel.Controls.Add(button);
    }
    void Copy(string value) { if(!String.IsNullOrEmpty(value)) { Clipboard.SetText(value); status.Text = "已复制 " + value + " · 发给朋友，再分享游戏内的房间码。房主请保持窗口打开。"; } }
    ProcessStartInfo Child(string file, string arguments) {
        var info = new ProcessStartInfo(Path.Combine(Launcher.Root,file),arguments) { WorkingDirectory=Launcher.Root, UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true, RedirectStandardInput=true };
        info.EnvironmentVariables.Remove("NODE_OPTIONS"); info.EnvironmentVariables.Remove("NODE_PATH");
        // Child tools may write default settings; confine them to the disposable directory.
        info.EnvironmentVariables["USERPROFILE"] = Launcher.Root;
        info.EnvironmentVariables["HOME"] = Launcher.Root;
        info.EnvironmentVariables["APPDATA"] = Launcher.Root;
        info.EnvironmentVariables["LOCALAPPDATA"] = Launcher.Root;
        return info;
    }
    async Task StartGame() {
        try {
            server = Process.Start(Child("node.exe", "boot.js"));
            string errors = ""; server.ErrorDataReceived += (s,e) => { if(e.Data != null) errors = e.Data; }; server.BeginErrorReadLine();
            var ready = server.StandardOutput.ReadLineAsync();
            if(await Task.WhenAny(ready,Task.Delay(20000)) != ready) throw new Exception("本地服务启动超时。");
            string line = await ready;
            if(line == null) throw new Exception("本地服务未能启动：" + errors);
            var data = json.Deserialize<Dictionary<string,object>>(line);
            localUrl = "http://127.0.0.1:" + data["port"];
            var addresses = new List<string>();
            foreach(var item in (System.Collections.IEnumerable)data["addresses"]) addresses.Add(Convert.ToString(item));
            lanUrl = addresses.Count > 0 ? addresses[0] : localUrl;
            string allAddresses = String.Join("  /  ", addresses.ToArray());
            var options = new CoreWebView2EnvironmentOptions();
            options.AdditionalBrowserArguments = "--disable-background-networking --disable-component-update --no-first-run";
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Launcher.Root,"profile"), options);
            if(closing) return;
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.Settings.IsWebMessageEnabled = false;
            view.CoreWebView2.PermissionRequested += (s,e) => e.State = CoreWebView2PermissionState.Deny;
            view.CoreWebView2.NewWindowRequested += (s,e) => e.Handled = true;
            view.CoreWebView2.DownloadStarting += (s,e) => {
                using(var save = new SaveFileDialog { FileName=Path.GetFileName(e.ResultFilePath), Filter="CSV 文件|*.csv|所有文件|*.*" }) {
                    if(save.ShowDialog(this) == DialogResult.OK) e.ResultFilePath = save.FileName; else e.Cancel = true;
                }
            };
            view.CoreWebView2.NavigationCompleted += async (s,e) => {
                if(!e.IsSuccess) { status.Text = "页面连接失败，请检查朋友是否保持游戏开启，或点击「回到本机」。"; return; }
                if(report.Length > 0) await SmokeTest();
            };
            view.Source = new Uri(localUrl);
            status.Text = "本机已就绪 · 局域网地址：" + (addresses.Count > 0 ? allAddresses : "未检测到局域网") + " · 关闭窗口会结束房间并清理临时文件。";
        } catch(Exception error) {
            ExitCode = 1;
            if(report.Length > 0) { WriteReport(new { ok=false, error=error.ToString(), temp=Launcher.Root }); Close(); }
            else { MessageBox.Show(this,"无法打开游戏：" + error.Message + "\n需要 Windows 10/11 x64 和系统 WebView2 运行时。", "啤酒游戏"); Close(); }
        }
    }
    async Task Navigate(string url) {
        if(view.CoreWebView2 == null || String.IsNullOrEmpty(url)) return;
        var active = await view.ExecuteScriptAsync("!!(window.BeerOnline && BeerOnline.active())");
        if(active == "true") { status.Text = "请先在游戏内离开当前房间，再切换连接地址。"; return; }
        view.Source = new Uri(url);
    }
    async Task<string> StartTunnel() {
        if(tunnel != null && !tunnel.HasExited) {
            if(publicUrl != null) return publicUrl;
            throw new Exception("正在连接，请稍候。");
        }
        if(localUrl == null) throw new Exception("游戏尚未就绪。");
        internetButton.Enabled = false; status.Text = "正在生成临时互联网地址，最多等待 60 秒…";
        tunnelLog = ""; tunnelReady = new TaskCompletionSource<string>();
        var completion = tunnelReady;
        string found = null; bool connected = false;
        var process = new Process { StartInfo = Child("cloudflared.exe", "tunnel --no-autoupdate --protocol http2 --url " + localUrl), EnableRaisingEvents=true };
        tunnel = process;
        DataReceivedEventHandler output = (s,e) => {
            if(e.Data == null) return;
            lock(completion) {
                tunnelLog += e.Data + "\n"; if(tunnelLog.Length > 12000) tunnelLog = tunnelLog.Substring(tunnelLog.Length-12000);
                var match = Regex.Match(e.Data,@"https://[a-z0-9-]+\.trycloudflare\.com");
                if(match.Success) found = match.Value;
                if(e.Data.Contains("Registered tunnel connection")) connected = true;
                if(found != null && connected) completion.TrySetResult(found);
            }
        };
        process.OutputDataReceived += output; process.ErrorDataReceived += output;
        process.Exited += (s,e) => {
            completion.TrySetException(new Exception("隧道服务已退出。"));
            if(!closing && IsHandleCreated) BeginInvoke((Action)(() => { if(tunnel == process) { publicUrl=null; copyInternet.Enabled=false; internetButton.Enabled=true; status.Text="互联网联机已断开，点击开启可重试。"; } }));
        };
        try {
            process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
            if(await Task.WhenAny(completion.Task,Task.Delay(60000)) != completion.Task) throw new Exception("当前网络无法连接隧道服务。");
            publicUrl = await completion.Task;
            if(closing) return publicUrl;
            copyInternet.Enabled = true; status.Text = "互联网地址：" + publicUrl + " · 朋友打开网址后输入房间码；关闭窗口即失效。";
            return publicUrl;
        } catch { StopTunnel(); throw; }
        finally { if(!closing) internetButton.Enabled = true; }
    }
    void StopTunnel() {
        var previous = tunnel; tunnel = null; publicUrl = null; copyInternet.Enabled = false;
        if(tunnelReady != null) tunnelReady.TrySetException(new Exception("互联网联机已停止。"));
        if(previous != null) { try { if(!previous.HasExited) { previous.Kill(); previous.WaitForExit(1500); } previous.Dispose(); } catch {} }
    }
    void WriteReport(object value) { File.WriteAllText(report, json.Serialize(value)); }
    bool tested;
    async Task SmokeTest() {
        if(tested) return; tested=true;
        try {
            string script = @"(async () => {
              const api = async (action,data) => {const r=await fetch('/api/'+action,{method:'POST',body:JSON.stringify(data)}); if(!r.ok) throw Error(await r.text()); return r.json();};
              document.getElementById('tutorialOpen').click(); if(!document.getElementById('tutorialDialog').open) throw Error('tutorial'); document.getElementById('tutorialClose').click();
              const a=await api('create',{role:'retailer',config:{periods:18}}); const b=await api('join',{code:a.code,role:'factory'});
              await api('start',a); await api('order',{...a,period:1,order:4}); const next=await api('order',{...b,period:1,order:6}); if(next.state.period!==2) throw Error('sync');
              await api('leave',a); await api('leave',b); return {ok:true};
            })().then(v => window.__desktopTest=v).catch(e => window.__desktopTest={ok:false,error:String(e)});";
            await view.ExecuteScriptAsync(script);
            string result = "null";
            for(int i=0;i<100;i++) { result=await view.ExecuteScriptAsync("window.__desktopTest || null"); if(result!="null") break; await Task.Delay(100); }
            if(!result.Contains("\"ok\":true")) throw new Exception(result);
            string remote = null;
            if(testInternet) {
                remote = await StartTunnel();
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                using(var client = new HttpClient()) {
                    client.Timeout = TimeSpan.FromSeconds(20);
                    bool valid=false;
                    for(int i=0;i<6;i++) { try { var html = await client.GetStringAsync(remote); if(html.Contains("tutorialOpen")) {valid=true;break;} } catch {} await Task.Delay(2000); }
                    if(!valid) throw new Exception("公网入口未能访问");
                    var payload = new StringContent("{\"role\":\"retailer\",\"config\":{}}", System.Text.Encoding.UTF8,"application/json");
                    var response = await client.PostAsync(remote+"/api/create",payload); if(!response.IsSuccessStatusCode) throw new Exception("公网房间 API 失败");
                }
            }
            WriteReport(new {ok=true, temp=Launcher.Root, serverPid=server.Id, port=new Uri(localUrl).Port, internet=remote, browserPid=view.CoreWebView2.BrowserProcessId, childPid=Process.GetCurrentProcess().Id, tunnelPid=tunnel == null ? 0 : tunnel.Id});
        } catch(Exception error) { ExitCode=1; WriteReport(new {ok=false,error=error.ToString(),temp=Launcher.Root,tunnelLog=tunnelLog}); }
        Close();
    }
}
