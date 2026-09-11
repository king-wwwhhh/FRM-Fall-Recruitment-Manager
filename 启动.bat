@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem 清理可能干扰 Electron 启动的环境变量
set ELECTRON_RUN_AS_NODE=
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_EXE=node_modules\electron\dist\electron.exe
set LOG=%~dp0启动日志.txt

rem ---------- 若已自带依赖（完整版/已装好），直接启动，无需 Node ----------
if exist "%ELECTRON_EXE%" goto LAUNCH

rem ---------- 0) 定位 Node.js（PATH 没有就搜常见安装位置）----------
set "NODE_DIR="
where node >nul 2>&1 || (
  for %%P in (D:\node "C:\Program Files\nodejs" "%LOCALAPPDATA%\Programs\nodejs" "%APPDATA%\WorkBuddy\binaries\node\versions\22.22.2-2") do (
    if exist "%%~P\node.exe" set "NODE_DIR=%%~P"
  )
)
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"

where node >nul 2>&1 || (
  echo.
  echo [错误] 未检测到 Node.js。请先到 https://nodejs.org 下载安装 LTS 版本
  echo        （安装时务必勾选 "Add to PATH"），装好后再双击本脚本。
  echo        也可改用「完整版」压缩包，它内置依赖、无需安装 Node。
  echo.
  echo 详细步骤见：启动日志.txt
  echo %DATE% %TIME% 未检测到 Node.js > "%LOG%"
  pause
  exit /b 1
)

rem ---------- 1) 安装依赖（首次运行，控制台可见进度）----------
echo 首次运行，正在安装依赖（Electron 走国内镜像，约 1-3 分钟，请勿关闭本窗口）...
echo.
call npm install --registry=https://registry.npmmirror.com
if errorlevel 1 (
  call npm install --registry=https://registry.npmmirror.com > "%LOG%" 2>&1
  echo.
  echo [错误] 依赖安装失败，多半是网络无法访问 npm 镜像。请检查网络后重新双击本脚本。
  echo 完整日志已写入：%LOG%
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\imapflow" (
  echo [补充] 正在补装业务依赖 imapflow / mailparser...
  call npm install imapflow mailparser --registry=https://registry.npmmirror.com
)
if not exist "%ELECTRON_EXE%" (
  echo.
  echo [错误] Electron 未安装成功（缺少 %ELECTRON_EXE%），多半是 Electron 二进制下载失败。
  echo.
  pause
  exit /b 1
)

:LAUNCH
rem ---------- 2) 静默启动（隐藏控制台，仅出错才弹窗）----------
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath '%ELECTRON_EXE%' -ArgumentList '.' -RedirectStandardOutput '%LOG%' -RedirectStandardError '%LOG%'" 2>nul
if errorlevel 1 (
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
    echo.
    echo [错误] 应用启动失败（进程已退出）。请把下方的"启动日志.txt"发来排查：
    echo        %LOG%
    echo.
    pause
    exit /b 1
  )
)

rem 启动成功：不保留任何黑窗口
exit /b 0
