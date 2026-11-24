@echo off
rem Kingdom Core host service (Kingdom 2.0, phase 1): starts the village server and the Kingdom Core (the AI helper).
rem Run by the "Kingdom One" scheduled task at logon (tools\install_autostart.ps1), or by hand. Subscription only:
rem the helper refuses to start unless Claude Code is signed in with a Claude subscription.
cd /d "%~dp0.."
if not exist logs mkdir logs
start "Kingdom One village" /min cmd /c "python -u helper\serve.py >> logs\serve.log 2>&1"
start "Kingdom One core" /min cmd /c "python -u helper\brain.py >> logs\core.log 2>&1"
