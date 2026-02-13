@echo off
title HW Monitor Central
color 0B

echo.
echo   ╔══════════════════════════════════════════════╗
echo   ║       HW Monitor Central — Launcher          ║
echo   ╚══════════════════════════════════════════════╝
echo.

:: Ir al directorio del script
cd /d "%~dp0"

:: Verificar que existe config.json
if not exist "config.json" (
    echo   [ERROR] No se encuentra config.json
    echo   Asegurate de que el fichero config.json esta en:
    echo   %~dp0
    echo.
    pause
    exit /b 1
)

:: Leer el puerto del config.json (buscar la linea "port")
set SERVER_PORT=3000
for /f "tokens=2 delims=:" %%a in ('findstr /C:"\"port\": " config.json ^| findstr /V "8085"') do (
    set "SERVER_PORT=%%a"
    set "SERVER_PORT=!SERVER_PORT: =!"
    set "SERVER_PORT=!SERVER_PORT:,=!"
)

:: Buscar Python
where python >nul 2>nul
if %errorlevel% equ 0 (
    set PYTHON_CMD=python
    goto :found_python
)

where python3 >nul 2>nul
if %errorlevel% equ 0 (
    set PYTHON_CMD=python3
    goto :found_python
)

where py >nul 2>nul
if %errorlevel% equ 0 (
    set PYTHON_CMD=py
    goto :found_python
)

echo   [ERROR] No se encuentra Python instalado.
echo   Instala Python desde https://www.python.org/downloads/
echo.
pause
exit /b 1

:found_python
echo   Python encontrado: %PYTHON_CMD%
echo.
echo   Iniciando servidor en http://localhost:3000
echo   (Puedes acceder desde cualquier equipo de la red)
echo.
echo   Pulsa Ctrl+C para detener el servidor
echo   ──────────────────────────────────────────────────
echo.

%PYTHON_CMD% server.py

:: Si Python termina (Ctrl+C o error)
echo.
echo   Servidor detenido.
pause
