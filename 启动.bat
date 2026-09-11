@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem 清理可能干扰 Electron 启动的环境变量
set ELECTRON_RUN_AS_NODE=
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_EXE=node_modules\electron\dist\electron.exe
set LOG=%~dp0启动日志.txt

rem 弹窗报错（保证失败一定可见，绝不黑窗口一闪而过）
set ERRBOX=powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($args[0],'秋招管家',0,'Error')"

rem ---------- 0) 检查运行环境：必须安装 Node.js（含 npm）----------
where node >nul 2>&1
if errorlevel 1 (
  %ERRBOX% "未检测到 Node.js。请先到 https://nodejs.org 下载安装 LTS 版本（安装时务必勾选 Add to PATH），装好后再双击本启动脚本。"
  pause
  exit /b 1
)

rem ---------- 1) 检查并安装依赖（首次运行，控制台可见进度）----------
if not exist "%ELECTRON_EXE%" (
  echo 首次运行，正在安装依赖（Electron 走国内镜像，约 1-3 分钟，请勿关闭本窗口）...
  echo.
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    call npm install --registry=https://registry.npmmirror.com > "%LOG%" 2>&1
    %ERRBOX% "依赖安装失败，多半是网络无法访问 npm 镜像。请检查网络后重新双击本脚本；完整日志见：%LOG%"
    pause
    exit /b 1
  )
)

rem 业务依赖（imapflow / mailparser）若缺失也补装一次
if not exist "node_modules\imapflow" (
  echo [补充] 检测到业务依赖缺失，正在补装 imapflow / mailparser...
  call npm install imapflow mailparser --registry=https://registry.npmmirror.com
)

if not exist "%ELECTRON_EXE%" (
  %ERRBOX% "Electron 仍未安装成功（缺少 %ELECTRON_EXE%），多半是 Electron 二进制下载失败。请检查网络后重新双击本脚本。"
  pause
  exit /b 1
)

rem ---------- 2) 静默启动（隐藏控制台，仅出错才弹窗）----------
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath '%ELECTRON_EXE%' -ArgumentList '.' -RedirectStandardOutput '%LOG%' -RedirectStandardError '%LOG%'" 2>nul
if errorlevel 1 (
  rem PowerShell 不可用时的兜底：直接启动（无日志）
  start "" "%ELECTRON_EXE%" .
)
ping -n 8 >nul
tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul
if errorlevel 1 (
  rem 进程已退出：多为无 GPU，自动改用软渲染重试一次
  powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath '%ELECTRON_EXE%' -ArgumentList '.','--disable-gpu','--use-angle=swiftshader' -RedirectStandardOutput '%LOG%' -RedirectStandardError '%LOG%'" 2>nul
  ping -n 6 >nul
  tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul
  if errorlevel 1 (
    %ERRBOX% "应用启动失败（进程已退出）。请把下方的『启动日志.txt』发来排查：%LOG%"
    pause
    exit /b 1
  )
)

rem 启动成功：不保留任何黑窗口
exit /b 0
