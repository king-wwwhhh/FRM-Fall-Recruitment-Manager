@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

rem 清除可能干扰 Electron GUI 模式的环境变量
set ELECTRON_RUN_AS_NODE=

rem Electron 二进制走国内镜像：否则会从 GitHub 下载 180MB，国内极易超时导致安装失败
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/

set ELECTRON_EXE=node_modules\electron\dist\electron.exe

echo ============================================
echo   秋招管家 recruit-manager 启动器
echo ============================================

if not exist "%ELECTRON_EXE%" (
  echo 首次运行，正在安装依赖（Electron 走国内镜像），请稍候...
  call npm install --registry=https://registry.npmmirror.com
)

if not exist "%ELECTRON_EXE%" (
  echo.
  echo [错误] Electron 未安装成功，缺少：%ELECTRON_EXE%
  echo 请检查网络后重新双击本脚本重试。
  pause
  exit /b 1
)

echo 正在启动...
start "" "%ELECTRON_EXE%" .

rem 等约 6 秒检测进程是否存活：未存活多为无 GPU 环境（远程/无头会话），自动改用软渲染重试
ping 127.0.0.1 -n 7 >nul
tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul
if errorlevel 1 (
  echo 检测到窗口未起来（多为 GPU 不可用），改用软渲染重试...
  start "" "%ELECTRON_EXE%" . --disable-gpu --disable-gpu-compositing --use-angle=swiftshader
  ping 127.0.0.1 -n 4 >nul
  tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul
  if errorlevel 1 (
    echo [警告] 仍未启动，请把窗口报错信息发出来排查。
  ) else (
    echo 软渲染模式启动成功。
  )
) else (
  echo 启动成功。
)

echo.
echo 提示：首次使用需要在应用「设置」里填写：
echo   1) QQ 邮箱 IMAP 授权码（QQ邮箱→设置→账号→开启IMAP/SMTP 获取，16位，不是QQ密码）
echo   2) 大模型密钥（用于解析面试邮件）
echo 也可以直接编辑 config.json（已被 .gitignore 忽略，不会入库）。
endlocal
