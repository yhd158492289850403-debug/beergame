using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher {
    internal static string Root;
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length >= 3 && args[0] == "--run") {
            Root = args[1];
            using (var gate = EventWaitHandle.OpenExisting(args[2])) { if (!gate.WaitOne(30000)) return 2; }
            SetDllDirectory(Root);
            AppDomain.CurrentDomain.AssemblyResolve += (sender, e) => {
                var name = new AssemblyName(e.Name).Name;
                if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
                return Assembly.LoadFrom(Path.Combine(Root, name + ".dll"));
            };
            return RunWindow(args.Length > 3 ? args[3] : "", args.Length > 4 && args[4] == "internet");
        }
        string tempRoot = Path.Combine(Path.GetTempPath(), "BeerGamePortable");
        Directory.CreateDirectory(tempRoot);
        // Only remove our abandoned, GUID-named directories; active supervisors hold .lock exclusively.
        foreach (var old in Directory.GetDirectories(tempRoot)) {
            Guid id;
            if (!Guid.TryParseExact(Path.GetFileName(old), "N", out id) || !File.Exists(Path.Combine(old, ".lock"))) continue;
            try { using (File.Open(Path.Combine(old, ".lock"), FileMode.Open, FileAccess.ReadWrite, FileShare.None)) {} DeleteOwned(old, tempRoot); } catch {}
        }
        Root = Path.Combine(tempRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Root);
        IntPtr job = IntPtr.Zero;
        FileStream lease = null;
        int code = 1;
        try {
            lease = File.Open(Path.Combine(Root, ".lock"), FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read)) {
                foreach (var entry in archive.Entries) {
                    string target = Path.GetFullPath(Path.Combine(Root, entry.FullName));
                    if (!target.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("无效资源路径");
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target);
                }
            }
            job = CreateJobObject(IntPtr.Zero, null);
            var limits = new ExtendedLimits(); limits.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
            if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new IOException("无法创建进程清理保护");
            string gateName = "Local\\BeerGame-" + Guid.NewGuid().ToString("N");
            using (var gate = new EventWaitHandle(false, EventResetMode.ManualReset, gateName)) {
                var start = new ProcessStartInfo(Application.ExecutablePath, "--run " + Quote(Root) + " " + Quote(gateName));
                if (args.Length >= 2 && args[0] == "--smoke") start.Arguments += " " + Quote(Path.GetFullPath(args[1])) + (args.Length > 2 && args[2] == "internet" ? " internet" : "");
                start.UseShellExecute = false;
                using (var child = Process.Start(start)) {
                    if (!AssignProcessToJobObject(job, child.Handle)) { child.Kill(); throw new IOException("无法绑定进程清理保护"); }
                    gate.Set(); child.WaitForExit(); code = child.ExitCode;
                }
            }
        } catch (Exception e) { MessageBox.Show("启动失败：" + e.Message, "啤酒游戏"); }
        finally {
            if (job != IntPtr.Zero) { TerminateJobObject(job, 0); CloseHandle(job); }
            if (lease != null) lease.Dispose();
            for (int i = 0; i < 100 && Directory.Exists(Root); i++) { try { DeleteOwned(Root, tempRoot); } catch { Thread.Sleep(100); } }
            if (Directory.Exists(Root)) MessageBox.Show("游戏进程已停止，但临时文件仍被其他程序占用。下次打开会再次清理：\n" + Root, "啤酒游戏");
            try { Directory.Delete(tempRoot, false); } catch {}
        }
        return code;
    }
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static int RunWindow(string report, bool internet) { Application.Run(new GameWindow(report, internet)); return GameWindow.ExitCode; }
    static void DeleteOwned(string folder, string parent) {
        if (!String.Equals(Path.GetDirectoryName(Path.GetFullPath(folder)), Path.GetFullPath(parent), StringComparison.OrdinalIgnoreCase)) throw new IOException("清理路径越界");
        Directory.Delete(folder, true);
    }
    internal static string Quote(string text) { return "\"" + text.Replace("\"", "") + "\""; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long PerProcess, PerJob; public uint LimitFlags; public UIntPtr Min, Max; public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A,B,C,D,E,F; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool SetDllDirectory(string path);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}
