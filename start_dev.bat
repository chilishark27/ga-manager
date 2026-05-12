@echo off
echo ========================================
echo   GA Manager - Development Launcher
echo ========================================
echo.

:: Check Go backend
cd /d "%~dp0backend"
if not exist ga_manager.exe (
    echo [BUILD] Compiling Go backend...
    set GONOSUMCHECK=*
    set GONOSUMDB=*
    go build -o ga_manager.exe .
    if errorlevel 1 (
        echo [ERROR] Backend build failed!
        pause
        exit /b 1
    )
)

:: Start backend
echo [START] Starting Go backend on :18600 ...
start "GA-Manager-Backend" ga_manager.exe
timeout /t 2 /nobreak >nul

:: Start frontend dev server
cd /d "%~dp0frontend"
echo [START] Starting Vite dev server on :3000 ...
start "GA-Manager-Frontend" cmd /c "npm run dev"

echo.
echo ========================================
echo   Backend:  http://localhost:18600
echo   Frontend: http://localhost:3000
echo ========================================
echo.
echo Press any key to stop all services...
pause >nul

:: Cleanup
taskkill /FI "WINDOWTITLE eq GA-Manager-Backend" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GA-Manager-Frontend" /F >nul 2>&1
echo [DONE] All services stopped.
