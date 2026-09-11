@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem 清理可能干扰 Electron 启动的环境变量
set ELECTRON_RUN_AS_NODE=
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_EXE=node_modules\electron\dist\electron.exe
set LOG="%~dp0启动日志.txt"

echo ============================================================
echo   秋招管家 recruit-manager 启动器
echo ============================================================
echo.

rem ---------- 0) 检查运行环境：必须安装 Node.js（含 npm）----------
where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。本工具首次运行需要它来安装依赖。
  echo.
  echo 解决办法（约 1 分钟）：
  echo   1. 打开 https://nodejs.org 下载 "LTS" 版本
  echo   2. 安装时务必勾选 "Add to PATH"（添加到环境变量）
  echo   3. 安装完成后重新双击本「启动.bat」
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [OK] 检测到 Node.js：%%v

rem ---------- 1) 检查并安装依赖 ----------
if not exist "%ELECTRON_EXE%" (
  echo.
  echo [1/2] 首次运行，正在安装依赖（Electron 走国内镜像，约 1-3 分钟）...
  echo       不要关闭本窗口，耐心等待。
  echo.
  call npm install --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败（多半是网络无法访问 npm 镜像）。
    echo   可重试一次；完整日志已保存至：%LOG%
    echo   也可把上方红色报错发来排查。
    call npm install --registry=https://registry.npmmirror.com > %LOG% 2>&1
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
  echo.
  echo [错误] Electron 仍未安装成功（缺少 %ELECTRON_EXE%）。
  echo   多半是 Electron 二进制下载失败。请检查网络后重新双击本脚本。
  pause
  exit /b 1
)

rem ---------- 2) 同步启动，日志落盘并可见 ----------
echo.
echo [2/2] 正在启动应用...（启动日志写入 %LOG%）
echo   若窗口未出现或一闪而过，请看本窗口下方或「启动日志.txt」。
echo ------------------------------------------------------------
"%ELECTRON_EXE%" . > %LOG% 2>&1
set RC=!errorlevel!
echo ------------------------------------------------------------
if !RC!==0 (
  echo 应用已正常关闭（退出码 0）。
) else (
  echo [警告] 应用异常退出，错误码 !RC!。请把下方日志或「启动日志.txt」发来排查：
  echo.
  type %LOG%
)
echo.
echo 提示：首次使用请在应用「设置」里填写 QQ 邮箱授权码与模型密钥。
echo       （设置 → 📖 配置教程 有图文步骤）
pause
endlocal
