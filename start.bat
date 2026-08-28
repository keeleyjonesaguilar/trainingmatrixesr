@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm was not found on PATH. Install Node.js LTS from https://nodejs.org first, then re-run this file.
  pause
  exit /b 1
)

if not exist ".env" (
  echo No .env file found. This app now needs a Postgres connection string to run.
  echo Copy .env.example to .env and fill in DATABASE_URL, then re-run this file.
  echo See .env.example for where to find that value in the Render dashboard.
  pause
  exit /b 1
)
findstr /b /r "DATABASE_URL=..*" ".env" >nul
if errorlevel 1 (
  echo .env exists but DATABASE_URL isn't set. This app now needs a Postgres connection string to run.
  echo Open .env and set DATABASE_URL - see .env.example for where to find that value in the Render dashboard.
  pause
  exit /b 1
)

echo Installing server dependencies...
call npm install
if errorlevel 1 goto :error

echo Installing client dependencies...
cd client
call npm install
if errorlevel 1 goto :error
cd ..

echo.
echo Starting server (http://localhost:4000) and client dev server (http://localhost:5173) in separate windows...
start "Training Matrix - Server" cmd /k "cd /d "%~dp0" && npm start"
start "Training Matrix - Client (dev, hot reload)" cmd /k "cd /d "%~dp0client" && npm run dev"

echo.
echo Once the client window shows a "Local:" URL, open it in your browser (usually http://localhost:5173).
goto :eof

:error
echo.
echo npm install failed - see the messages above.
pause
